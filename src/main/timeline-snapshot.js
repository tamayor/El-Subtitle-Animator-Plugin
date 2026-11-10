// One read of the timeline's clips for a whole placement.
//
// A placement used to walk the timeline several times, one call at a time: the cut guard before and after, the track
// pick for the text, a track pick for every sound layer, the temp-clip sweep... each asking every clip for its start and
// end again. takeSnapshot reads the tracks of the kinds asked for once, 40 clips at a time in parallel, and the helpers
// in placement.js work from that (pickTrack, cutSnapshot, sweepTempClips take an optional snapshot). The clips this
// plugin adds during the placement are pushed into the snapshot (snapAdd), so the next pick sees them; nothing else
// changes the timeline while state.applying is set.

module.exports = {
    snapAdd, snapAddTrack, snapCutKeys, snapTrack, takeSnapshot
};

const PERF = require('./perf');

const CHUNK = 40;

// opts: { kinds: ['video', 'audio'], withIds: false, withEnabled: true }
// -> { at, withIds, tracks: { video: [{ t, locked, enabled, items: [{ it, name, start, end, enabled, id }] }], audio: [...] } }
// Per clip only what the placement uses is read: its name on V1 only (the cut guard leaves titles out of its keys; a
// sound is never a title), its on/off state on V2 and up only (withEnabled; the track picks skip clips that are off),
// its id when withIds. Everything else is start and end: two calls per clip instead of four.
async function takeSnapshot(tl, opts) {
    const o = Object.assign({ kinds: ['video', 'audio'], withIds: false, withEnabled: true }, opts || {});
    const sp = PERF.span('tl.snapshot');
    const snap = { at: Date.now(), withIds: !!o.withIds, tracks: {} };
    let items = 0;
    for (const kind of o.kinds) {
        const list = [];
        const n = (await tl.GetTrackCount(kind)) || 0;
        for (let t = 1; t <= n; t++) {
            let locked = false, enabled = true;
            try { locked = !!(await tl.GetIsTrackLocked(kind, t)); } catch (e) { locked = false; }
            try { enabled = (await tl.GetIsTrackEnabled(kind, t)) !== false; } catch (e) { enabled = true; }
            const its = (await tl.GetItemListInTrack(kind, t)) || [];
            const arr = Array.isArray(its) ? its : Object.values(its);
            const out = [];
            const ro = { withName: kind === 'video' && t === 1, withEnabled: o.withEnabled && kind === 'video' && t >= 2, withIds: o.withIds };
            for (let i = 0; i < arr.length; i += CHUNK) {
                out.push(...await Promise.all(arr.slice(i, i + CHUNK).map(it => readItem(it, ro))));
            }
            items += out.length;
            list.push({ t, locked, enabled, items: out.filter(Boolean) });
        }
        snap.tracks[kind] = list;
    }
    sp.end({ kinds: o.kinds.join('+'), items, withIds: snap.withIds });
    return snap;
}

async function readItem(it, o) {
    try {
        const [name, start, end, enabled, id] = await Promise.all([
            o.withName ? Promise.resolve(it.GetName()).then(String).catch(() => '') : '',
            it.GetStart(), it.GetEnd(),
            o.withEnabled ? Promise.resolve(it.GetClipEnabled()).then(v => v !== false).catch(() => true) : true,
            o.withIds ? Promise.resolve(it.GetUniqueId()).then(String).catch(() => null) : null
        ]);
        return { it, name, start: Number(start), end: Number(end), enabled, id };
    } catch (e) { return null; }
}

// The snapshot's entry for a track (null when the snapshot has none for it, e.g. a track added since).
function snapTrack(snap, kind, t) {
    const list = snap && snap.tracks && snap.tracks[kind];
    if (!list) return null;
    return list.find(x => x.t === t) || null;
}

// A clip this plugin just put on the timeline: remembered so later picks in the same placement see it.
function snapAdd(snap, kind, t, item) {
    if (!snap || !item) return;
    let tr = snapTrack(snap, kind, t);
    if (!tr) tr = snapAddTrack(snap, kind, t);
    tr.items.push({ it: item.it || null, name: item.name || '', start: Number(item.start), end: Number(item.end), enabled: item.enabled !== false, id: item.id || null });
}
function snapAddTrack(snap, kind, t) {
    if (!snap.tracks[kind]) snap.tracks[kind] = [];
    const tr = { t, locked: false, enabled: true, items: [] };
    snap.tracks[kind].push(tr);
    snap.tracks[kind].sort((a, b) => a.t - b.t);
    return tr;
}

// The cut guard's keys (placement.js cutSnapshot) from a snapshot that holds V1 and the audio tracks.
function snapCutKeys(snap) {
    const out = [];
    const v1 = snapTrack(snap, 'video', 1);
    if (v1) for (const x of v1.items) if (!/^Text\+/.test(x.name)) out.push('v1:' + x.start + '-' + x.end);
    for (const tr of (snap.tracks.audio || [])) for (const x of tr.items) if (!/^Text\+/.test(x.name)) out.push('a' + tr.t + ':' + x.start + '-' + x.end);
    return out;
}
