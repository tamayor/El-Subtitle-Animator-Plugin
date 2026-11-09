// Inspector timing sliders of the segment MultiText presets (Upper / Emphasis / Lower Start and End).
//
// Their letters are animated by keyframes written from those values (fusion_bridge.key_followers), not by expressions
// (per-letter expressions made Resolve lag). A drag of the sliders in Resolve's own Inspector does not re-key by
// itself, so while a MultiText clip is selected on the timeline this asks the bridge (op seg_watch) to compare its
// values with the last keyed ones and re-key when they changed. It keeps running while the panel is parked or
// minimized, since that is exactly when the user is working in the Inspector. Off with the Fusion setting
// inspectorTimingWatch.

module.exports = {
    startSegWatch
};

const state = require('./state');
const { bridgeCall } = require('./fusion-bridge');
const { getFixes } = require('./fusion-fixes');
const { getProject } = require('./resolve');

const EVERY_MS = 700;
const MAX_SEL = 4;
const notSegment = new Set();      // clip ids that hold no segment preset (never asked again this session)
let busy = false;

async function tick() {
    if (busy || state.applying || state.isQuitting || !state.hasSeenResolve) return;
    if (getFixes().inspectorTimingWatch === false) return;
    busy = true;
    try {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) return;
        const all = (await tl.GetSelectedClips()) || [];
        const sel = (Array.isArray(all) ? all : Object.values(all)).slice(0, MAX_SEL);
        for (const c of sel) {
            if (state.applying) return;
            const name = String((await c.GetName()) || '');
            if (!/^MultiText/.test(name)) continue;
            const id = String(await c.GetUniqueId());
            if (notSegment.has(id)) continue;
            const r = await bridgeCall('seg_watch', { item: id }, 4000);
            if (r && r.segments === false) notSegment.add(id);
        }
    } catch (e) {
        /* Resolve busy, clip gone or another page: next tick */
    } finally {
        busy = false;
    }
}

// ------------------------------------------------------------------ trim sweep
// The letters' keyframes sit at fixed frames, so a clip whose head was trimmed (or a trimmed copy pasted) while it was
// not selected - or while the panel was closed - would play its letters out of step with its highlight box. Every
// SWEEP_MS this lists the timeline's MultiText clips and sends the new ones and the ones whose start / end changed
// since the last look to the bridge (op seg_sweep), which re-keys only those whose start or timing really moved.
// The first sweep after the panel opens checks every MultiText clip once. Off with inspectorTimingWatch too.
const SWEEP_MS = 6000;
const SWEEP_BATCH = 6;
const seen = new Map();     // clip id -> "start|end" at the last check
let sweepBusy = false, sweepTl = null;

async function sweep() {
    if (sweepBusy || busy || state.applying || state.isQuitting || !state.hasSeenResolve) return;
    if (getFixes().inspectorTimingWatch === false) return;
    sweepBusy = true;
    try {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) return;
        const tlName = String(await tl.GetName());
        if (tlName !== sweepTl) { seen.clear(); sweepTl = tlName; }
        const todo = [];
        const n = (await tl.GetTrackCount('video')) || 0;
        for (let t = 1; t <= n; t++) {
            if (state.applying) return;
            const items = (await tl.GetItemListInTrack('video', t)) || [];
            const list = Array.isArray(items) ? items : Object.values(items);
            const names = await Promise.all(list.map(it => Promise.resolve(it.GetName()).catch(() => '')));
            const mt = list.filter((it, k) => /^MultiText/.test(String(names[k] || '')));
            const facts = await Promise.all(mt.map(it => Promise.all([it.GetUniqueId(), it.GetStart(), it.GetEnd()]).catch(() => null)));
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
            const res = (r && r.items) || {};
            for (const x of part) {
                const v = res[x.id];
                if (!v || v.error) continue;               // gone or busy: tried again next sweep
                if (v.segments === false) notSegment.add(x.id);
                seen.set(x.id, x.key);
            }
        }
        if (seen.size > 2000) seen.clear();
    } catch (e) {
        /* Resolve busy, another page or no timeline: next sweep */
    } finally {
        sweepBusy = false;
    }
}

function startSegWatch() {
    if (state.segWatchTimer) return;
    state.segWatchTimer = setInterval(tick, EVERY_MS);
    state.segSweepTimer = setInterval(sweep, SWEEP_MS);
    setTimeout(sweep, 1500);                                // straight away on open: clips trimmed while it was closed
}
