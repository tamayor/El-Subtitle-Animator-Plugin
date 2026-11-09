// The Use tab's Animation timing bar: finds the placed clip the user is working on (the selected video clip, else the
// top clip under the playhead) and reads / sets its timing as start..end ranges (frames from the clip's start):
//   anim      one range, "Animation Start" .. "Animation Frames" (src/main/retime.js; no start on older clips)
//   typing    one range, "Typing Start" .. "Typing Frames" (no start on clips placed before it existed)
//   segments  one range per text, Seg<n>Start .. Seg<n>End (e.g. the MultiText "Highlight Select")
// Only inputs on the clip's comp are changed, so its Inspector keeps working.

module.exports = { clipTiming, currentFusionClip, setClipTiming };

const state = require('./state');
const { bridgeCall } = require('./fusion-bridge');
const { getProject, tcToFrame, timelineMeta } = require('./resolve');
const { typingFramesFor, segSfxFor, segSfxForget, segSfxRecord, segSfxSetEmpty, findAudioItemById, findItemById, deleteExtraSfx, placeExtraSfx } = require('./placement');

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
    if (info && info.kind === 'segments') rowTextChanged(itemId, info);
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

// The Fusion clip the user is working on, picked like the timing bar's: the selected video clip, else the top clip
// under the playhead. -> { itemId, name, start, end, selected } or null. Used by the Clip controls (clip-controls.js).
async function currentFusionClip() {
    const project = await getProject();
    const tl = project && await project.GetCurrentTimeline();
    if (!tl) return null;
    const tlName = await tl.GetName();
    if (meta.key !== tlName || Date.now() - meta.at > 5000) meta = { key: tlName, at: Date.now(), meta: await timelineMeta(tl, project) };
    const frame = tcToFrame(await tl.GetCurrentTimecode(), meta.meta);
    const list = await candidates(tl, frame, tlName);
    return list[0] || null;
}

// ------------------------------------------------------------------ row sounds follow the row's text (placed clips)
// Each fresh read of a MultiText clip (the clip under the playhead / selected, while the Use tab is open) says which
// rows have no text. A row that got text since the sounds were placed gets its row sounds; a row that was cleared
// loses them. Only changes count (the recorded 'empty' state), so a sound deleted by hand is not put back. The clip
// of a running Resolve preview is handled by the preview itself (live-preview.js syncRowSounds).
let rowSync = Promise.resolve();
function rowTextChanged(itemId, info) {
    rowSync = rowSync.then(() => syncPlacedRowSounds(itemId, info)).catch(() => { /* tried again on the next read */ });
}
async function syncPlacedRowSounds(itemId, info) {
    if (state.liveSession && String(state.liveSession.itemId) === String(itemId)) return;
    if (state.applying) return;
    const rec = segSfxRecord(itemId);
    if (!rec.layers.length) return;
    const now = {}, segs = {};
    for (const r of info.ranges || []) {
        segs[Number(r.key)] = Math.max(0, Math.round(Number(r.start) || 0));
        if (r.empty) now[Number(r.key)] = true;
    }
    const rows = [...new Set(rec.layers.map(l => Math.max(1, Math.round(Number(l.seg) || 1))))];
    const flip = rows.filter(n => !!now[n] !== !!(rec.empty || {})[n]);
    if (!flip.length || state.applying) return;
    state.applying = true;          // claimed before the first await, so a placement cannot start in between
    try {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) return;
        const text = await findItemById(tl, itemId);
        if (!text) return;
        // cleared rows: their sounds go
        const drop = rec.sounds.filter(x => flip.includes(Number(x.seg)) && now[Number(x.seg)]).map(x => x.id);
        if (drop.length) {
            const left = await deleteExtraSfx(tl, drop);
            segSfxForget(itemId, drop.filter(id => !left.includes(id)));
        }
        // rows that got text: their sounds come in, at the row's start on this clip
        const add = rec.layers.filter(l => { const n = Math.max(1, Math.round(Number(l.seg) || 1)); return flip.includes(n) && !now[n]; });
        if (add.length) {
            const [start, end] = [Number(await text.GetStart()), Number(await text.GetEnd())];
            const tlName = await tl.GetName();
            if (meta.key !== tlName || !meta.meta) meta = { key: tlName, at: Date.now(), meta: await timelineMeta(tl, project) };
            await placeExtraSfx(tl, project, meta.meta, add, start, end, [], text, itemId, [], null, true, { rows: null, segs, empty: now });
        }
        segSfxSetEmpty(itemId, now);
    } finally { state.applying = false; }
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
            return Object.assign({
                ok: true, itemId: c.itemId, name: c.name, selected: !!c.selected, kind: info.kind,
                start: c.start, length, fps: meta.meta.fps, frame,
                playhead: frame >= c.start && frame < c.end ? frame - c.start : null
            }, { ranges: rangesFor(info, length, meta.meta.fps) });
        }
        // a Fusion clip without a timing slider (a preset saved before retiming existed): say so instead of nothing
        if (first) return { ok: true, noSlider: true, itemId: first.itemId, name: first.name, frame };
        return { ok: true, none: true, frame };
    } catch (e) {
        return { ok: false, reason: String(e && e.message || e) };
    }
}

// The bridge's timing_get -> [{ key, label, start, end, defStart, defEnd, hasStart }], clamped to the clip.
// defStart / defEnd: the preset's own timing (what "Preset timing" goes back to).
function rangesFor(info, length, fps) {
    const clamp = (v, lo) => Math.max(lo, Math.min(length, Math.round(Number(v) || 0)));
    if (info.kind === 'segments') {
        // texts left empty (e.g. "Highlight Select" with only the emphasis filled) get no lane
        const all = info.ranges || [];
        const filled = all.filter(r => !r.empty);
        return (filled.length ? filled : all).map(r => {
            const start = clamp(r.start, 0);
            return {
                key: String(r.key), label: r.label || null, hasStart: true,
                start, end: Math.max(start + 1, clamp(r.end, 1)),
                defStart: clamp(r.defStart, 0), defEnd: Math.max(1, clamp(r.defEnd, 1))
            };
        });
    }
    // Typing presets: 0 = their automatic length, shown as that number
    const natural = info.kind === 'typing' ? typingFramesFor(length, fps) : Math.max(1, Math.round(Number(info.natural) || 1));
    const hasStart = (info.kind === 'anim' || info.kind === 'typing') && !!info.hasStart;
    const start = hasStart ? clamp(info.start, 0) : 0;
    const end = Math.max(start + 1, clamp(Math.round(Number(info.value) || 0) || natural, 1));
    return [{ key: info.kind, label: null, hasStart, start, end, defStart: 0, defEnd: Math.min(length, natural) }];
}

// ranges: [{ key, start, end }] (frames from the clip's start).
async function setClipTiming(event, itemId, ranges, wake) {
    if (!itemId) return { error: 'No clip' };
    const list = (Array.isArray(ranges) ? ranges : []).map(r => {
        const start = Math.max(0, Math.round(Number(r.start) || 0));
        return { key: String(r.key), start, end: Math.max(start + 1, Math.round(Number(r.end) || 1)) };
    });
    if (!list.length) return { error: 'No timing to set' };
    const r = await bridgeCall('timing_set', { item: String(itemId), ranges: list, wake: !!wake }, 6000);
    cache.delete(String(itemId));      // the next read shows what the clip really has now
    if (!(r && r.ok)) return { error: (r && r.why) || 'Could not set the timing on that clip' };
    // A change made outright (release, keys, buttons): the Upper / Emphasis / Lower sounds follow their row's start.
    let sounds = null;
    if (wake) { try { sounds = await moveSegSounds(String(itemId), list); } catch (e) { sounds = { error: e.message }; } }
    return { ok: true, sounds };
}

// Puts every sound placed for one row of this clip (placement.js segSfx*) at that row's start + its own offset.
// -> { moved, failed } (null when the clip has no row sounds)
async function moveSegSounds(itemId, list) {
    const links = segSfxFor(itemId);
    if (!links.length) return null;
    const starts = {};
    for (const r of list) if (/^\d+$/.test(r.key)) starts[Number(r.key)] = r.start;
    const want = links.filter(x => starts[x.seg] !== undefined);
    if (!want.length) return null;
    const project = await getProject();
    const tl = project && await project.GetCurrentTimeline();
    if (!tl) return null;
    const text = await findItemById(tl, itemId);
    if (!text) return null;
    const clipStart = Number(await text.GetStart());
    let moved = 0, failed = 0;
    const gone = [];
    for (const x of want) {
        const it = await findAudioItemById(tl, x.id);
        if (!it) { gone.push(x.id); continue; }
        const target = clipStart + starts[x.seg] + (Number(x.off) || 0);
        if (Number(await it.GetStart()) === target) continue;
        let ok = false;
        try { if (typeof it.SetPosition === 'function') ok = !!(await it.SetPosition({ startFrame: target }, false)); } catch (e) { ok = false; }
        if (ok) moved++; else failed++;
    }
    if (gone.length) segSfxForget(itemId, gone);
    return { moved, failed };
}
