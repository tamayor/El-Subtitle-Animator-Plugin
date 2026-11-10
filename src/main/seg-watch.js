// Inspector timing sliders of the segment MultiText presets (Upper / Emphasis / Lower Start and End), and the
// Kinetic Cloud / Lines timing (their row pop-ins are keyframes too, see fusion_bridge.key_kinetic).
//
// Their letters are animated by keyframes written from those values (fusion_bridge.key_followers), not by expressions
// (per-letter expressions made Resolve lag). A drag of the sliders in Resolve's own Inspector does not re-key by
// itself, so while a MultiText clip is selected on the timeline this asks the bridge (op seg_watch) to compare its
// values with the last keyed ones and re-key when they changed. It keeps running while the panel is parked or
// minimized, since that is exactly when the user is working in the Inspector. Off with the Fusion setting
// inspectorTimingWatch.

module.exports = {
    markSegSweepHot, startSegWatch
};

const state = require('./state');
const { bridgeCall } = require('./fusion-bridge');
const { getFixes } = require('./fusion-fixes');
const { currentTimeline, videoTrackLists } = require('./resolve');
const PERF = require('./perf');
const { resolveBusy } = require('./resolve-load');

const EVERY_MS = 700;
// clips whose letters / rows are keyed by the bridge: the segment MultiText presets and Kinetic Cloud / Lines (their
// rows' pop-in keys follow Animation Start / Frames, Frames Per Row, the text's row count and the clip's start)
const KEYED_CLIP = /^(MultiText|Text\+ Kinetic (Cloud|Lines))/;
const MAX_SEL = 4;
// While the panel itself has the focus nobody is dragging a slider in Resolve's Inspector (and the panel's own timing
// bar re-keys what it changes), so the look comes every FOCUSED_MS instead of every EVERY_MS.
const FOCUSED_MS = 2100;
let lastTickAt = 0;
function panelFocused() {
    try { return !!(state.mainWindow && !state.mainWindow.isDestroyed() && state.mainWindow.isFocused()); } catch (e) { return false; }
}
const notSegment = new Set();      // clip ids that hold no segment preset (never asked again this session)
let busy = false;

async function tick() {
    if (busy || state.applying || state.isQuitting || !state.hasSeenResolve || resolveBusy()) return;
    if (getFixes().inspectorTimingWatch === false) return;
    if (Date.now() - lastTickAt < FOCUSED_MS - 50 && panelFocused()) return;
    lastTickAt = Date.now();
    busy = true;
    const sp = PERF.span('segwatch.tick');
    try {
        // The panel's poll just read the selection (poll.js, every 200-500 ms): reuse it instead of asking again.
        let sel = null;
        const ls = state.lastSelection;
        if (ls && Date.now() - ls.at < EVERY_MS) sel = ls.items.slice(0, MAX_SEL);
        if (!sel) {
            const { tl } = await currentTimeline(EVERY_MS);
            if (!tl) return;
            const all = (await tl.GetSelectedClips()) || [];
            sel = (Array.isArray(all) ? all : Object.values(all)).slice(0, MAX_SEL);
        }
        if (!sel.length) return;
        const names = await Promise.all(sel.map(c => Promise.resolve(c.GetName()).then(String).catch(() => '')));
        const keyed = sel.filter((c, k) => KEYED_CLIP.test(names[k]));
        if (!keyed.length) return;
        const ids = await Promise.all(keyed.map(c => Promise.resolve(c.GetUniqueId()).then(String).catch(() => '')));
        for (let k = 0; k < keyed.length; k++) {
            if (state.applying) return;
            const id = ids[k];
            if (!id || notSegment.has(id)) continue;
            const r = await bridgeCall('seg_watch', { item: id }, 4000);
            if (r && r.segments === false) notSegment.add(id);
        }
    } catch (e) {
        /* Resolve busy, clip gone or another page: next tick */
    } finally {
        busy = false;
        sp.end();
    }
}

// ------------------------------------------------------------------ trim sweep
// The letters' keyframes sit at fixed frames, so a clip whose head was trimmed (or a trimmed copy pasted) while it was
// not selected - or while the panel was closed - would play its letters out of step with its highlight box. The sweep
// lists the timeline's MultiText clips and sends the new ones and the ones whose start / end changed since the last
// look to the bridge (op seg_sweep), which re-keys only those whose start or timing really moved.
// It runs every SWEEP_HOT_MS for HOT_FOR_MS after a change this plugin made (a placement, a timing change, a kept
// preview: markSegSweepHot), otherwise every SWEEP_MS. Every run compares each MultiText clip's start | end with the
// last look (a trim changes no clip count, so counts alone would miss it); the clips are read 40 at a time.
// The first sweep after the panel opens checks every MultiText clip once. Off with inspectorTimingWatch too.
const SWEEP_HOT_MS = 6000, SWEEP_MS = 30000, HOT_FOR_MS = 90000, SWEEP_SETTLE_MS = 4000;
const SWEEP_BATCH = 6;
const seen = new Map();     // clip id -> "start|end" at the last check
// A clip's name never changes and reading every clip's name was the panel's biggest single cost (35,000 calls in ten
// minutes), so each track remembers where its keyed clips sit: { count, at, keyed: [{ pos, id }] }. While the track's
// clip count is the same, only those positions are read (id, start, end); an id that is not where it was, a changed
// count, or NAMES_FULL_MS since the last full look reads the whole track's names again.
const NAMES_FULL_MS = 60000;
let trackKeyed = new Map();
// budget.full: how many tracks may have their names read again this sweep only because they are NAMES_FULL_MS old
// (one: all tracks at once was a second of calls every minute).
async function keyedFacts(t, list, budget) {
    const mem = trackKeyed.get(t);
    const old = mem && Date.now() - mem.at >= NAMES_FULL_MS && list.length > 0;
    if (mem && mem.count === list.length && !(old && budget.full > 0)) {
        const facts = await Promise.all(mem.keyed.map(k => Promise.all([list[k.pos].GetUniqueId(), list[k.pos].GetStart(), list[k.pos].GetEnd()]).catch(() => null)));
        if (facts.every((f, i) => f && String(f[0]) === mem.keyed[i].id)) return facts;
    }
    if (old && mem.count === list.length) budget.full--;
    const keyed = [], out = [];
    for (let i = 0; i < list.length; i += 40) {
        const part = list.slice(i, i + 40);
        const names = await Promise.all(part.map(it => Promise.resolve(it.GetName()).catch(() => '')));
        const pos = part.map((it, k) => i + k).filter((p, k) => KEYED_CLIP.test(String(names[k] || '')));
        const facts = await Promise.all(pos.map(p => Promise.all([list[p].GetUniqueId(), list[p].GetStart(), list[p].GetEnd()]).catch(() => null)));
        for (let k = 0; k < pos.length; k++) if (facts[k]) { keyed.push({ pos: pos[k], id: String(facts[k][0]) }); out.push(facts[k]); }
    }
    trackKeyed.set(t, { count: list.length, at: Date.now(), keyed });
    return out;
}
let sweepBusy = false, sweepTl = null, lastSweepAt = 0;

function markSegSweepHot() { state.segSweepHot = Date.now(); }

async function sweep() {
    if (sweepBusy || busy || state.applying || state.isQuitting || !state.hasSeenResolve || resolveBusy()) return;
    if (getFixes().inspectorTimingWatch === false) return;
    const hot = Date.now() - (state.segSweepHot || 0) < HOT_FOR_MS;
    if (Date.now() - lastSweepAt < (hot ? SWEEP_HOT_MS : SWEEP_MS)) return;
    // placements a few seconds apart: the sweep (a read of every clip's name) waits until that run is over
    if (Date.now() - (state.segSweepHot || 0) < SWEEP_SETTLE_MS) return;
    sweepBusy = true;
    const sp = PERF.span('segwatch.sweep');
    let checked = 0, sent = 0, keyed = 0, pathKeyed = 0, pathExprs = 0;
    try {
        const { tl, tlName } = await currentTimeline(2000);
        if (!tl) return;
        if (tlName !== sweepTl) { seen.clear(); trackKeyed = new Map(); sweepTl = tlName; }
        const lists = await videoTrackLists(tl, tlName, 10000);
        if (state.applying) return;
        lastSweepAt = Date.now();
        const todo = [], budget = { full: 1 };
        for (let t = 0; t < lists.length; t++) {
            if (state.applying) return;
            const facts = await keyedFacts(t, lists[t], budget);
            checked += facts.length;
            for (const f of facts) {
                if (!f) continue;
                const id = String(f[0]);
                if (notSegment.has(id)) continue;
                const key = f[1] + '|' + f[2];
                if (seen.get(id) !== key) todo.push({ id, key });
            }
        }
        for (let k = 0; k < todo.length; k += SWEEP_BATCH) {
            if (state.applying || state.isQuitting) return;
            const part = todo.slice(k, k + SWEEP_BATCH);
            const r = await bridgeCall('seg_sweep', { items: part.map(x => x.id) }, 20000);
            sent += part.length;
            const res = (r && r.items) || {};
            for (const x of part) {
                const v = res[x.id];
                if (!v || v.error) continue;               // gone or busy: tried again next sweep
                if (v.segments === false) notSegment.add(x.id);
                keyed += Number(v.keyed) || 0; pathKeyed += Number(v.pathKeyed) || 0; pathExprs += Number(v.pathExprs) || 0;
                seen.set(x.id, x.key);
            }
        }
        if (seen.size > 2000) seen.clear();
    } catch (e) {
        /* Resolve busy, another page or no timeline: next sweep */
    } finally {
        sweepBusy = false;
        sp.end(sent ? { checked, sent, keyed, pathKeyed, pathExprs } : { checked, sent });
    }
}

function startSegWatch() {
    if (state.segWatchTimer) return;
    state.segWatchTimer = setInterval(tick, EVERY_MS);
    state.segSweepTimer = setInterval(sweep, 1000);         // the interval itself decides (hot: 6 s, else 30 s)
    state.segSweepHot = Date.now();                         // straight away on open: clips trimmed while it was closed
    setTimeout(sweep, 1500);
}
