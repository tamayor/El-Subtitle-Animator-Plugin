// Connection to DaVinci Resolve, timeline metadata, timecode <-> frame conversion, subtitle track reading
// and timeline item lookups by id.

module.exports = {
    findItemsByIds, frameToTC, getProject, getSubtitles, listSubtitles, setSubtitlesEnabled, tcToFrame, timelineMeta
};

const WorkflowIntegration = require('./workflow-integration');

const state = require('./state');
const { PLUGIN_ID } = require('./config');
const { subtitleColorsFromDb } = require('./clip-colors-db');
const PERF = require('./perf');
const { dlog } = require('./log');

// ------------------------------------------------------------------ Resolve connection

// Blackmagic's module offers the API twice: Initialize() / GetResolve() give objects whose every call BLOCKS this
// process until Resolve answers (the panel's IPC, the MCP server and the window all wait behind it), while
// InitializePromise() / GetResolvePromise() give objects whose calls return promises ("all further calls to the
// returned Resolve object will, in turn, return the promise objects", README of the Workflow Integrations SDK).
// Every caller here already awaits each call, so both work. Which one is used is the perf.json setting promiseApi:
// 'off' (the blocking API, the default), 'on' (the promise API) or 'probe' (the blocking API, plus a one-time check of
// the promise API logged to the perf log, see probePromiseApi).
let resolveMode = null;          // 'sync' | 'promise': how state.resolveObj was obtained
let connecting = null;

async function getResolve() {
    const mode = PERF.getPerf().promiseApi === 'on' ? 'promise' : 'sync';
    if (state.resolveObj && resolveMode === mode) return PERF.perfEnabled() ? PERF.wrapResolve(state.resolveObj) : state.resolveObj;
    if (connecting) return connecting;
    connecting = (async () => {
        if (state.resolveObj && resolveMode !== mode) resetHandles();      // handles from one API must not be mixed with the other
        let obj = null;
        if (mode === 'promise' && typeof WorkflowIntegration.InitializePromise === 'function' && typeof WorkflowIntegration.GetResolvePromise === 'function') {
            const ok = await WorkflowIntegration.InitializePromise(PLUGIN_ID);
            if (!ok) throw new Error('Could not connect to DaVinci Resolve (is this Resolve Studio?)');
            obj = await WorkflowIntegration.GetResolvePromise();
            try { if (typeof WorkflowIntegration.SetAPITimeout === 'function') WorkflowIntegration.SetAPITimeout(20); } catch (e) { /* optional */ }
        } else {
            const ok = await WorkflowIntegration.Initialize(PLUGIN_ID);
            if (!ok) throw new Error('Could not connect to DaVinci Resolve (is this Resolve Studio?)');
            obj = await WorkflowIntegration.GetResolve();
        }
        if (!obj) throw new Error('Could not get the Resolve object');
        state.resolveObj = obj;
        resolveMode = mode;
        state.hasSeenResolve = true;
        return PERF.perfEnabled() ? PERF.wrapResolve(obj) : obj;
    })().finally(() => { connecting = null; });
    return connecting;
}

// Cached API handles (templates, selection, subtitles) are dropped when the connection is made anew.
function resetHandles() {
    state.resolveObj = null;
    state.subCache = { key: '', at: 0, list: [], version: (state.subCache && state.subCache.version) || 0 };      // the next read gets a new version
    state.lastSelection = null;
    state.tplState = { text: { auto: null, broken: false, good: 0 }, multitext: { auto: null, broken: false, good: 0 } };
    state.presetTpl = new Map();
}

// promiseApi 'probe': once, a few seconds after start-up, the promise API is tried next to the blocking one and what
// it does is written to the perf log (perf.probe.*): do child objects return promises, do our `typeof x.Fn ===
// 'function'` guards hold, does a failing call reject or return null, and does a batch of 40 calls run any faster.
let probed = false;
async function probePromiseApi() {
    if (probed || PERF.getPerf().promiseApi !== 'probe') return;
    probed = true;
    const out = { api: 'missing' };
    try {
        if (typeof WorkflowIntegration.InitializePromise !== 'function' || typeof WorkflowIntegration.GetResolvePromise !== 'function') { PERF.record('perf.probe.promiseApi', 0, out); return; }
        const ok = await WorkflowIntegration.InitializePromise(PLUGIN_ID);
        out.api = ok ? 'initialized' : 'init-false';
        const r = await WorkflowIntegration.GetResolvePromise();
        const pmR = r.GetProjectManager();
        out.childIsThenable = !!(pmR && typeof pmR.then === 'function');
        const pm = await pmR;
        const project = pm && await pm.GetCurrentProject();
        const tl = project && await project.GetCurrentTimeline();
        if (tl) {
            out.typeofGuard = typeof tl.GetName === 'function';
            try { const bad = await tl.GetItemListInTrack('video', 999); out.badTrackReturns = bad === null ? 'null' : Array.isArray(bad) ? 'array:' + bad.length : typeof bad; }
            catch (e) { out.badTrackReturns = 'rejects: ' + String(e && e.message || e); }
            try { const m = await tl.GetMarkInOut(); out.marksReturn = m === null ? 'null' : typeof m; } catch (e) { out.marksReturn = 'rejects: ' + String(e && e.message || e); }
            const items = (await tl.GetItemListInTrack('video', 1)) || [];
            const list = items.slice(0, 40);
            if (list.length >= 5) {
                out.itemTypeofGuard = typeof list[0].GetClipColor === 'function';
                let t0 = Date.now();
                for (let k = 0; k < 3; k++) await Promise.all(list.map(it => it.GetName()));
                out.parallel40x3Ms = Date.now() - t0;
                t0 = Date.now();
                for (let k = 0; k < 3; k++) for (const it of list) await it.GetName();
                out.serial40x3Ms = Date.now() - t0;
                out.n = list.length;
            }
        } else out.timeline = 'none';
    } catch (e) { out.error = String(e && e.message || e); }
    PERF.record('perf.probe.promiseApi', 0, out);
    dlog('perf.probe.promiseApi', out);
}
setTimeout(() => { probePromiseApi().catch(() => { /* logged */ }); }, 5000).unref();

async function getProject() {
    const resolve = await getResolve();
    const pm = await resolve.GetProjectManager();
    return pm ? await pm.GetCurrentProject() : null;
}

// ------------------------------------------------------------------ timecode <-> frames
const pad = (n) => String(n).padStart(2, '0');

async function timelineMeta(tl, proj) {
    const [rate, dfs, w, h] = await Promise.all([
        tl.GetSetting('timelineFrameRate'), tl.GetSetting('timelineDropFrameTimecode'),
        tl.GetSetting('timelineResolutionWidth'), tl.GetSetting('timelineResolutionHeight')
    ]);
    const fps = parseFloat(rate) || 25;
    const df = String(dfs) === '1';
    let width = parseInt(w, 10);
    let height = parseInt(h, 10);
    if (!width || !height) {
        if (!proj) {
            try { proj = await getProject(); } catch (e) { /* ignore */ }
        }
        if (proj) {
            if (!width) {
                try { width = parseInt(await proj.GetSetting('timelineResolutionWidth'), 10); } catch (e) { /* ignore */ }
            }
            if (!height) {
                try { height = parseInt(await proj.GetSetting('timelineResolutionHeight'), 10); } catch (e) { /* ignore */ }
            }
        }
    }
    width = width || 1920;
    height = height || 1080;
    return { fps, nominal: Math.round(fps), df, width, height };
}

function tcToFrame(tc, meta) {
    const [h, m, s, f] = String(tc).split(/[:;]/).map(Number);
    const n = meta.nominal;
    let total = ((h * 60 + m) * 60 + s) * n + f;
    if (meta.df) {
        const drop = n <= 30 ? 2 : 4;
        const tm = h * 60 + m;
        total -= drop * (tm - Math.floor(tm / 10));
    }
    return total;
}

function frameToTC(frame, meta) {
    const n = meta.nominal;
    let f = Math.max(0, Math.round(frame));
    if (meta.df) {
        const drop = n <= 30 ? 2 : 4;
        const per10 = n * 600 - drop * 9;
        const perMin = n * 60 - drop;
        const d = Math.floor(f / per10);
        const m = f % per10;
        f += drop * 9 * d + (m > drop ? drop * Math.floor((m - drop) / perMin) : 0);
    }
    const ff = f % n;
    const ss = Math.floor(f / n) % 60;
    const mm = Math.floor(f / (n * 60)) % 60;
    const hh = Math.floor(f / (n * 3600));
    return pad(hh) + ':' + pad(mm) + ':' + pad(ss) + (meta.df ? ';' : ':') + pad(ff);
}

// ------------------------------------------------------------------ subtitles

// Three levels of re-reading, cheapest first. From SUB_PROBE_MS on, only the number of clips on each subtitle track
// is checked (one call per track): a subtitle added, deleted or split shows up at once. From SUB_NAMES_MS on (longer
// while the user works in Resolve, SUB_NAMES_AWAY_MS) every clip's text is read (one call per clip): an edited text
// shows up. The full read (four calls per clip; a moved subtitle shows up) runs when either check differs, and in any
// case every SUB_FULL_MS. Concurrent callers share one read.
const SUB_PROBE_MS = 3000, SUB_NAMES_MS = 6000, SUB_NAMES_AWAY_MS = 15000, SUB_FULL_MS = 30000;
let subReading = null;
// GetClipColor() is always "" for subtitle items (their colours come from the project database, below) and a
// subtitle's GetDuration() is its end - start, so neither is asked for. Flip these if a Resolve version changes that.
const SUB_READ_COLOR = false, SUB_READ_DURATION = false;
const CHUNK = 40;
async function subtitleCounts(tl, tracks) {
    const out = [];
    for (let t = 1; t <= tracks; t++) out.push(((await tl.GetItemListInTrack('subtitle', t)) || []).length);
    return out.join(',');
}
function panelAway() {
    try { return state.appIdle || !!(state.mainWindow && !state.mainWindow.isDestroyed() && !state.mainWindow.isFocused()); } catch (e) { return false; }
}
// A string that changes whenever anything the panel shows about the subtitles changes (version below follows it).
function subSignature(list) {
    return list.map(s => s.track + ':' + s.start + ':' + s.end + ':' + (s.enabled === false ? 0 : 1) + ':' + s.color + ':' + s.text).join('\n');
}
async function getSubtitles(tl, force) {
    const key = await tl.GetName();
    const c = state.subCache, now = Date.now();
    if (!force && c.key === key) {
        const age = now - c.at;
        if (age < SUB_PROBE_MS) return c.list;
        if (age < SUB_FULL_MS) {
            if (now - (c.probedAt || 0) < SUB_PROBE_MS) return c.list;
            if (subReading) return subReading;
            const sp = PERF.span('sub.probe');
            const tracks = (await tl.GetTrackCount('subtitle')) || 0;
            const counts = await subtitleCounts(tl, tracks);
            c.probedAt = Date.now();
            let same = counts === c.counts;
            // the texts, one call per clip, once the list is SUB_NAMES_MS old (a probe alone cannot see an edit)
            if (same && now - (c.namedAt || c.at) >= (panelAway() ? SUB_NAMES_AWAY_MS : SUB_NAMES_MS)) {
                const names = await subtitleNames(tl, tracks);
                c.namedAt = Date.now();
                same = names === c.names;
            }
            sp.end({ same });
            if (same) return c.list;
        }
    }
    if (subReading) return subReading;
    subReading = readSubtitles(tl, key).finally(() => { subReading = null; });
    return subReading;
}
async function subtitleNames(tl, tracks) {
    const out = [];
    for (let t = 1; t <= tracks; t++) {
        const its = (await tl.GetItemListInTrack('subtitle', t)) || [];
        const arr = Array.isArray(its) ? its : Object.values(its);
        for (let i = 0; i < arr.length; i += CHUNK) out.push(...await Promise.all(arr.slice(i, i + CHUNK).map(it => Promise.resolve(it.GetName()).catch(() => ''))));
    }
    return out.join('\n');
}
async function readSubtitles(tl, key) {
    const c = state.subCache;
    const sp = PERF.span('sub.full');
    const list = [];
    const items = [];      // the Resolve handles, kept next to the list so setSubtitlesEnabled can act on them without a new walk
    const tracks = (await tl.GetTrackCount('subtitle')) || 0;
    // Each subtitle needs a few calls into Resolve. Made one after another that was thousands of round trips every couple
    // of seconds on a long timeline (the panel lagged), so each item's calls run together, CHUNK items at a time.
    // enabled: false when the clip or its whole subtitle track is turned off (e.g. a subtitle already animated by Place).
    const readItem = async (it, t, trackOn) => {
        const color = (SUB_READ_COLOR && typeof it.GetClipColor === 'function') ? Promise.resolve(it.GetClipColor()).catch(() => '') : '';
        const dur = (SUB_READ_DURATION && typeof it.GetDuration === 'function') ? it.GetDuration() : 0;
        const on = (typeof it.GetClipEnabled === 'function') ? Promise.resolve(it.GetClipEnabled()).catch(() => true) : true;
        const [start, end, d, cl, text, clipOn] = await Promise.all([it.GetStart(), it.GetEnd(), dur, color, it.GetName(), on]);
        const duration = (d && d > 0) ? d : Math.max(1, end - start);
        return { text, start, end, duration, track: t, color: cl || '', enabled: trackOn && clipOn !== false, it };
    };
    for (let t = 1; t <= tracks; t++) {
        const its = (await tl.GetItemListInTrack('subtitle', t)) || [];
        let trackOn = true;
        try { trackOn = (await tl.GetIsTrackEnabled('subtitle', t)) !== false; } catch (e) { /* assume on */ }
        for (let i = 0; i < its.length; i += CHUNK) {
            list.push(...await Promise.all(its.slice(i, i + CHUNK).map(it => readItem(it, t, trackOn))));
        }
    }
    // GetClipColor() is always "" for subtitle items: fall back to the colours saved in the project database.
    if (list.length && !list.some(s => s.color)) {
        try {
            const project = await getProject();
            const map = await subtitleColorsFromDb(project && await project.GetName(), key);
            if (map && map.size) {
                const tlStart = Number(await tl.GetStartFrame()) || 0;
                for (const s of list) {
                    s.color = map.get(s.track + ':' + s.start) || map.get(s.track + ':' + (s.start - tlStart)) || '';
                    if (s.color) s.colorFrom = 'saved project';
                }
            }
        } catch (e) { /* colours stay empty */ }
    }
    const namesInTrackOrder = list.map(s => s.text).join('\n');      // as subtitleNames reads them (track by track)
    list.sort((a, b) => a.start - b.start);
    // The handles stay out of the list (it is sent to the panel and the MCP script), in a parallel array.
    for (const s of list) { items.push(s.it); delete s.it; }
    list.forEach((item, i) => { item.index = i + 1; });
    const sig = subSignature(list);
    const version = (c.key === key && c.sig === sig) ? (c.version || 1) : ((c.version || 0) + 1);
    state.subCache = { key, at: Date.now(), probedAt: Date.now(), namedAt: Date.now(), list, items, counts: await subtitleCounts(tl, tracks), names: namesInTrackOrder, sig, version };
    sp.end({ n: list.length, tracks });
    return list;
}

// Turns the subtitle clips under an animated caption off (or back on), so the subtitle track stops showing the same
// words underneath the animation. range = { start, end } in timeline frames (the caption's own words, not a held
// tail). A subtitle counts when it is mostly (half its length or more) inside the range, so a regrouped phrase
// takes the subtitles it re-split. Returns the clips changed as [{ track, start, end, text }].
// The subtitle list just read (getSubtitles keeps the clips' handles) says which clips overlap, so only those are
// asked and switched; the full walk is the fallback when no current list is at hand.
async function setSubtitlesEnabled(tl, range, enabled) {
    const out = [];
    if (!tl || !range || !(range.end > range.start)) return out;
    const sp = PERF.span('sub.setEnabled');
    const overlaps = (s, e) => { const o = Math.min(e, range.end) - Math.max(s, range.start); return o > 0 && o * 2 >= (e - s); };
    const flip = async (it, t, s, e) => {
        try {
            if (((await it.GetClipEnabled()) !== false) === !!enabled) return;
            if (await it.SetClipEnabled(!!enabled)) out.push({ track: t, start: s, end: e, text: await it.GetName() });
        } catch (err) { /* one clip that will not switch does not stop the rest */ }
    };
    let viaCache = false;
    try {
        const c = state.subCache;
        const key = await tl.GetName();
        if (c.key === key && Array.isArray(c.items) && c.items.length === c.list.length && c.list.length) {
            viaCache = true;
            for (let i = 0; i < c.list.length; i++) {
                const s = c.list[i];
                if (range.track && Number(range.track) !== s.track) continue;
                if (!overlaps(s.start, s.end)) continue;
                const it = c.items[i];
                // the handle must still be this clip (the list is at most a few seconds old; a moved clip is skipped)
                let st; try { st = await it.GetStart(); } catch (e) { st = null; }
                if (st !== s.start) { viaCache = false; break; }      // the rest is found by the full walk; what was flipped stays in `out`
                await flip(it, s.track, s.start, s.end);
            }
        }
    } catch (e) { viaCache = false; }
    if (!viaCache) {
        const tracks = (await tl.GetTrackCount('subtitle')) || 0;
        for (let t = 1; t <= tracks; t++) {
            if (range.track && Number(range.track) !== t) continue;
            const its = (await tl.GetItemListInTrack('subtitle', t)) || [];
            for (let i = 0; i < its.length; i += CHUNK) {
                const part = its.slice(i, i + CHUNK);
                const se = await Promise.all(part.map(async (it) => { try { return [await it.GetStart(), await it.GetEnd()]; } catch (e) { return null; } }));
                for (let k = 0; k < part.length; k++) {
                    if (!se[k] || !overlaps(se[k][0], se[k][1])) continue;
                    await flip(part[k], t, se[k][0], se[k][1]);
                }
            }
        }
    }
    // The cached list is patched instead of thrown away (a full re-read is 4 calls per subtitle): the flipped clips
    // get their new state and the version moves on, so the panel asks for the list once.
    if (out.length) {
        const c = state.subCache;
        try {
            if (c.key === (await tl.GetName()) && Array.isArray(c.list)) {
                for (const o of out) { const s = c.list.find(x => x.track === o.track && x.start === o.start); if (s) s.enabled = !!enabled; }
                c.sig = subSignature(c.list);
                c.version = (c.version || 1) + 1;
            } else c.at = 0;
        } catch (e) { c.at = 0; }
    }
    sp.end({ changed: out.length, viaCache });
    return out;
}

// Timeline items by unique id, in one pass over the tracks of `kind` (video / audio) with the ids read CHUNK at a time.
// Returns Map id -> item for the ids found. Used wherever one id per walk used to be looked up.
async function findItemsByIds(tl, ids, kind) {
    const want = new Set((ids || []).map(String));
    const found = new Map();
    if (!tl || !want.size) return found;
    const sp = PERF.span('tl.findItems');
    const tracks = (await tl.GetTrackCount(kind || 'video')) || 0;
    let scanned = 0;
    for (let t = 1; t <= tracks && found.size < want.size; t++) {
        const its = (await tl.GetItemListInTrack(kind || 'video', t)) || [];
        for (let i = 0; i < its.length && found.size < want.size; i += CHUNK) {
            const part = its.slice(i, i + CHUNK);
            const got = await Promise.all(part.map(it => Promise.resolve(it.GetUniqueId()).then(String).catch(() => null)));
            scanned += part.length;
            for (let k = 0; k < part.length; k++) if (got[k] && want.has(got[k]) && !found.has(got[k])) found.set(got[k], part[k]);
        }
    }
    sp.end({ kind: kind || 'video', want: want.size, found: found.size, scanned });
    return found;
}

// The panel's subtitle list for the current timeline.
async function listSubtitles(event, force) {
    try {
        const project = await getProject();
        if (!project) return { ok: false, error: 'Open a project in Resolve' };
        const tl = await project.GetCurrentTimeline();
        if (!tl) return { ok: false, error: 'Open a timeline in Resolve' };
        const subs = await getSubtitles(tl, !!force);
        return { ok: true, subtitles: subs, version: state.subCache.version || 1 };
    } catch (err) {
        return { ok: false, error: String(err && err.message || err) };
    }
}
