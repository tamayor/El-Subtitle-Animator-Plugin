// The Use tab's Animation timing bar: finds the placed clip the user is working on (the selected video clip, else the
// top clip under the playhead) and reads / sets its "Animation Frames" (src/main/retime.js) or "Typing Frames" slider.
// Only an input on the clip's comp is changed, so its Inspector keeps working.

module.exports = { clipTiming, setClipTiming };

const state = require('./state');
const { bridgeCall } = require('./fusion-bridge');
const { getProject, tcToFrame, timelineMeta } = require('./resolve');
const { typingFramesFor } = require('./placement');

// itemId -> { at, info } : what the clip's comp said last (null info = no timing slider)
const cache = new Map();
const READ_EVERY = 1500;
let meta = { key: null, at: 0, meta: null };
let tracks = { key: null, at: 0, list: [] };

async function readInfo(itemId, force) {
    const c = cache.get(itemId);
    if (c && !force && Date.now() - c.at < READ_EVERY) return c.info;
    let info = null;
    try {
        const r = await bridgeCall('timing_get', { item: itemId }, 6000);
        info = r && r.kind ? r : null;
    } catch (e) { info = c ? c.info : null; }
    cache.set(itemId, { at: Date.now(), info });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return info;
}

async function clipFacts(item) {
    const [id, name, start, end] = await Promise.all([item.GetUniqueId(), item.GetName(), item.GetStart(), item.GetEnd()]);
    return { itemId: String(id), name: String(name || ''), start: Number(start), end: Number(end) };
}

// The clips worth looking at: the selected video clips first, then the clips under the playhead from the top track down.
async function candidates(tl, frame, tlName) {
    const out = [];
    try {
        for (const c of (await tl.GetSelectedClips()) || []) {
            const tt = await c.GetTrackTypeAndIndex();
            if (tt && tt[0] === 'video' && (await c.GetFusionCompCount()) > 0) out.push(Object.assign(await clipFacts(c), { selected: true }));
        }
    } catch (e) { /* no selection API: playhead only */ }
    if (tracks.key !== tlName || Date.now() - tracks.at > 2000) {
        const list = [];
        const n = (await tl.GetTrackCount('video')) || 0;
        for (let t = n; t >= 1; t--) {
            for (const it of (await tl.GetItemListInTrack('video', t)) || []) {
                try { list.push({ item: it, start: Number(await it.GetStart()), end: Number(await it.GetEnd()) }); } catch (e) { /* skip */ }
            }
        }
        tracks = { key: tlName, at: Date.now(), list };
    }
    for (const x of tracks.list) {
        if (frame < x.start || frame >= x.end) continue;
        try { if ((await x.item.GetFusionCompCount()) > 0) out.push(await clipFacts(x.item)); } catch (e) { /* gone */ }
    }
    return out;
}

async function clipTiming(event, opts) {
    if (state.applying) return { ok: false, busy: true };
    try {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) return { ok: false, reason: 'Open a timeline in Resolve' };
        const tlName = await tl.GetName();
        if (meta.key !== tlName || Date.now() - meta.at > 5000) meta = { key: tlName, at: Date.now(), meta: await timelineMeta(tl, project) };
        const frame = tcToFrame(await tl.GetCurrentTimecode(), meta.meta);
        const force = !!(opts && opts.force);
        const seen = new Set();
        let first = null;
        for (const c of await candidates(tl, frame, tlName)) {
            if (!first) first = c;
            if (seen.has(c.itemId)) continue;
            seen.add(c.itemId);
            const info = await readInfo(c.itemId, force && opts.itemId === c.itemId);
            if (!info) continue;
            const length = Math.max(1, c.end - c.start);
            // Typing presets: 0 = their automatic length, shown as that number
            const natural = info.kind === 'typing' ? typingFramesFor(length, meta.meta.fps) : Math.max(1, Math.round(Number(info.natural) || 1));
            const value = Math.round(Number(info.value) || 0) || natural;
            return {
                ok: true, itemId: c.itemId, name: c.name, selected: !!c.selected, kind: info.kind,
                start: c.start, length, fps: meta.meta.fps, frame,
                playhead: frame >= c.start && frame < c.end ? frame - c.start : null,
                value: Math.min(length, value), natural: Math.min(length, natural)
            };
        }
        // a Fusion clip without a timing slider (a preset saved before retiming existed): say so instead of nothing
        if (first) return { ok: true, noSlider: true, itemId: first.itemId, name: first.name, frame };
        return { ok: true, none: true, frame };
    } catch (e) {
        return { ok: false, reason: String(e && e.message || e) };
    }
}

async function setClipTiming(event, itemId, value, wake) {
    if (!itemId) return { error: 'No clip' };
    const v = Math.max(1, Math.round(Number(value) || 1));
    const r = await bridgeCall('timing_set', { item: String(itemId), value: v, wake: !!wake }, 6000);
    const c = cache.get(String(itemId));
    if (c && c.info) { c.info = Object.assign({}, c.info, { value: v }); c.at = Date.now(); }
    return r && r.ok ? { ok: true, value: v } : { error: (r && r.why) || 'Could not set the timing on that clip' };
}
