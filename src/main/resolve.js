// Connection to DaVinci Resolve, timeline metadata, timecode <-> frame conversion, subtitle track reading
// and timeline item lookups by id.

module.exports = {
    frameToTC, getProject, getSubtitles, listSubtitles, setSubtitlesEnabled, tcToFrame, timelineMeta
};

const WorkflowIntegration = require('./workflow-integration');

const state = require('./state');
const { PLUGIN_ID } = require('./config');
const { subtitleColorsFromDb } = require('./clip-colors-db');

// ------------------------------------------------------------------ Resolve connection

async function getResolve() {
    if (state.resolveObj) return state.resolveObj;
    const ok = await WorkflowIntegration.Initialize(PLUGIN_ID);
    if (!ok) throw new Error('Could not connect to DaVinci Resolve (is this Resolve Studio?)');
    state.resolveObj = await WorkflowIntegration.GetResolve();
    if (!state.resolveObj) throw new Error('Could not get the Resolve object');
    state.hasSeenResolve = true;
    return state.resolveObj;
}

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
                const pw = await proj.GetSetting('timelineResolutionWidth');
                width = parseInt(pw, 10);
            }
            if (!height) {
                const ph = await proj.GetSetting('timelineResolutionHeight');
                height = parseInt(ph, 10);
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

// The full read (five calls per subtitle) is made at most every SUB_FULL_MS. In between, from SUB_PROBE_MS on, only
// the number of clips on each subtitle track is checked (one call per track): a subtitle added, deleted or split shows
// up at once, while a long timeline is not re-read every couple of seconds while nothing changed. A text edit or a
// moved subtitle is picked up by the next full read.
const SUB_PROBE_MS = 2000, SUB_FULL_MS = 6000;
async function subtitleCounts(tl, tracks) {
    const out = [];
    for (let t = 1; t <= tracks; t++) out.push(((await tl.GetItemListInTrack('subtitle', t)) || []).length);
    return out.join(',');
}
async function getSubtitles(tl, force) {
    const key = await tl.GetName();
    const c = state.subCache, now = Date.now();
    if (!force && c.key === key) {
        const age = now - c.at;
        if (age < SUB_PROBE_MS) return c.list;
        if (age < SUB_FULL_MS) {
            if (now - (c.probedAt || 0) < SUB_PROBE_MS) return c.list;
            const tracks = (await tl.GetTrackCount('subtitle')) || 0;
            const counts = await subtitleCounts(tl, tracks);
            c.probedAt = Date.now();
            if (counts === c.counts) return c.list;
        }
    }
    const list = [];
    const tracks = (await tl.GetTrackCount('subtitle')) || 0;
    // Each subtitle needs five calls into Resolve. Made one after another that was thousands of round trips every couple
    // of seconds on a long timeline (the panel lagged), so each item's calls run together, CHUNK items at a time.
    const CHUNK = 40;
    // enabled: false when the clip or its whole subtitle track is turned off (e.g. a subtitle already animated by Place).
    const readItem = async (it, t, trackOn) => {
        const color = (typeof it.GetClipColor === 'function') ? Promise.resolve(it.GetClipColor()).catch(() => '') : '';
        const dur = (typeof it.GetDuration === 'function') ? it.GetDuration() : 0;
        const on = (typeof it.GetClipEnabled === 'function') ? Promise.resolve(it.GetClipEnabled()).catch(() => true) : true;
        const [start, end, d, c, text, clipOn] = await Promise.all([it.GetStart(), it.GetEnd(), dur, color, it.GetName(), on]);
        const duration = (d && d > 0) ? d : Math.max(1, end - start);
        return { text, start, end, duration, track: t, color: c || '', enabled: trackOn && clipOn !== false };
    };
    for (let t = 1; t <= tracks; t++) {
        const items = (await tl.GetItemListInTrack('subtitle', t)) || [];
        let trackOn = true;
        try { trackOn = (await tl.GetIsTrackEnabled('subtitle', t)) !== false; } catch (e) { /* assume on */ }
        for (let i = 0; i < items.length; i += CHUNK) {
            list.push(...await Promise.all(items.slice(i, i + CHUNK).map(it => readItem(it, t, trackOn))));
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
    list.sort((a, b) => a.start - b.start);
    list.forEach((item, i) => { item.index = i + 1; });
    state.subCache = { key, at: Date.now(), probedAt: Date.now(), list, counts: await subtitleCounts(tl, tracks) };
    return list;
}

// Turns the subtitle clips under an animated caption off (or back on), so the subtitle track stops showing the same
// words underneath the animation. range = { start, end } in timeline frames (the caption's own words, not a held
// tail). A subtitle counts when it is mostly (half its length or more) inside the range, so a regrouped phrase
// takes the subtitles it re-split. Returns the clips changed as [{ track, start, end, text }].
async function setSubtitlesEnabled(tl, range, enabled) {
    const out = [];
    if (!tl || !range || !(range.end > range.start)) return out;
    const tracks = (await tl.GetTrackCount('subtitle')) || 0;
    for (let t = 1; t <= tracks; t++) {
        if (range.track && Number(range.track) !== t) continue;
        for (const it of ((await tl.GetItemListInTrack('subtitle', t)) || [])) {
            try {
                const s = await it.GetStart(), e = await it.GetEnd();
                const overlap = Math.min(e, range.end) - Math.max(s, range.start);
                if (overlap <= 0 || overlap * 2 < (e - s)) continue;
                if (((await it.GetClipEnabled()) !== false) === !!enabled) continue;
                if (await it.SetClipEnabled(!!enabled)) out.push({ track: t, start: s, end: e, text: await it.GetName() });
            } catch (err) { /* one clip that will not switch does not stop the rest */ }
        }
    }
    if (out.length) state.subCache.at = 0;
    return out;
}

// The panel's subtitle list for the current timeline.
async function listSubtitles(event, force) {
    try {
        const project = await getProject();
        if (!project) return { ok: false, error: 'Open a project in Resolve' };
        const tl = await project.GetCurrentTimeline();
        if (!tl) return { ok: false, error: 'Open a timeline in Resolve' };
        const subs = await getSubtitles(tl, !!force);
        return { ok: true, subtitles: subs };
    } catch (err) {
        return { ok: false, error: String(err && err.message || err) };
    }
}
