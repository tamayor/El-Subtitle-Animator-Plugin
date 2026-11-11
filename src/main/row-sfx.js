// Sounds that belong to one MultiText row (Upper / Emphasis / Lower): placing them at the row's start, remembering
// them per text clip and moving them when the row's timing changes.

module.exports = {
    loneRow, placeRowSfx, refitRowSfx, rowFramesFor, rowSfxSet, segSfxAdd, segSfxFor, segSfxForget, segSfxRecord, segSfxSetEmpty
};

const path = require('path');
const fs = require('fs');

const { APP_DATA_DIR } = require('./config');
const { sfxFilePath } = require('./sfx');
const { applyLevel, clampToWindow, peakOf, variations } = require('./sfx-level');
const { importSfx } = require('./sfx-import');
const { regAdd } = require('./live-preview');
const { dlog } = require('./log');
const { deleteExtraSfx, linkToText, pickTrack } = require('./placement');
const { findItemsByIds, tcToFrame } = require('./resolve');
const { snapAdd } = require('./timeline-snapshot');

// ------------------------------------------------------------------ row sounds follow the row's timing
// Sounds aligned to one MultiText row (Upper / Emphasis / Lower) are remembered per text clip, so the Animation timing
// bar can move them when that row's start is dragged, and so they come and go with the row's text on a placed clip:
// _app/seg-sounds.json = { <text item id>: { sounds: [{ id, seg, off }], layers: [the row sound settings], empty: { <n>: true } } }
// (off = frames after the row's start; empty = the rows that had no text when last looked at). Older entries were a
// plain list of sounds. Entries whose clips are gone are dropped when they are next looked up.
const SEG_SFX_FILE = path.join(APP_DATA_DIR, 'seg-sounds.json');
// Read once and kept in memory; writes are gathered and made 150 ms later (a placement writes it several times in a row).
let segSfx = null, segSfxTimer = null;
function segSfxRead() {
    if (segSfx) return segSfx;
    try { const o = JSON.parse(fs.readFileSync(SEG_SFX_FILE, 'utf8')); segSfx = (o && typeof o === 'object') ? o : {}; } catch (e) { segSfx = {}; }
    return segSfx;
}
function segSfxWrite(o) {
    segSfx = o;
    const keys = Object.keys(o);
    if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete o[k];
    if (segSfxTimer) return;
    segSfxTimer = setTimeout(segSfxFlush, 150);
    if (segSfxTimer.unref) segSfxTimer.unref();
}
function segSfxFlush() {
    if (segSfxTimer) { clearTimeout(segSfxTimer); segSfxTimer = null; }
    if (!segSfx) return;
    try {
        fs.mkdirSync(APP_DATA_DIR, { recursive: true });
        fs.writeFileSync(SEG_SFX_FILE, JSON.stringify(segSfx));
    } catch (e) { dlog('SEG-SFX-WRITE', e.message); }
}
process.on('exit', () => { try { segSfxFlush(); } catch (e) { /* ignore */ } });
// rows: the per-row copies of 'rows' sounds (Kinetic Cloud): [{ layer, end (frames after the text start the copies stop
// at), track, frames (the row frames they were placed for), ids }], one entry per sound layer.
const segRec = (v) => Array.isArray(v) ? { sounds: v, layers: [], empty: {}, rows: [] }
    : Object.assign({ sounds: [], layers: [], empty: {}, rows: [] }, v || {});
function rowSfxSet(videoId, entry) {
    const o = segSfxRead();
    const r = segRec(o[videoId]);
    const lid = entry.layer && entry.layer.id;
    r.rows = r.rows.filter(x => !(lid && x.layer && x.layer.id === lid)).concat([entry]);
    o[videoId] = r;
    segSfxWrite(o);
}
function segSfxAdd(videoId, links, specs, empty) {
    const o = segSfxRead();
    const r = segRec(o[videoId]);
    r.sounds = r.sounds.filter(x => !links.some(y => y.id === x.id)).concat(links);
    for (const l of (specs || [])) {
        const i = r.layers.findIndex(x => x.id === l.id);
        const copy = JSON.parse(JSON.stringify(l));
        if (i >= 0) r.layers[i] = copy; else r.layers.push(copy);
    }
    if (empty) r.empty = empty;
    o[videoId] = r;
    segSfxWrite(o);
}
// -> { sounds, layers, empty } (empty lists when nothing is recorded)
function segSfxRecord(videoId) { return segRec(segSfxRead()[String(videoId)]); }
function segSfxFor(videoId) { return segSfxRecord(videoId).sounds; }
function segSfxSetEmpty(videoId, empty) {
    const o = segSfxRead(), k = String(videoId);
    if (!o[k]) return;
    o[k] = Object.assign(segRec(o[k]), { empty });
    segSfxWrite(o);
}
function segSfxForget(videoId, ids) {
    const o = segSfxRead(), k = String(videoId);
    if (!o[k]) return;
    const r = segRec(o[k]);
    r.sounds = ids ? r.sounds.filter(x => !ids.includes(x.id)) : [];
    if (!r.sounds.length && !r.layers.length && !(r.rows || []).length) delete o[k]; else o[k] = r;
    segSfxWrite(o);
}
function loneRow(rowFrames) { return !!(rowFrames && !Array.isArray(rowFrames) && rowFrames.only); }
// The clip-relative row start frames for the 'rows' layers (null when no layer repeats per row or the comp has no
// rows). Call it AFTER the text is written to the comp: the rows are counted from the Pop<k> texts.
// With layers aligned to a MultiText row ('seg'), it returns { rows, segs, empty, only } instead (only = the one row with text when the others are empty: then only that row's sound is placed, see loneRow) (empty = { <n>: true } for
// rows whose text is empty: their sounds are not placed): segs = { <n>: Seg<n>Start }, read
// from the placed clip (after any fit to a short clip), so the sound lands where that row's in-animation starts.
async function rowFramesFor(itemId, compName, layers, warnings) {
    const wantRows = !!(layers && layers.some(l => l.align === 'rows'));
    const wantSegs = !!(layers && layers.some(l => l.align === 'seg'));
    if (!wantRows && !wantSegs) return null;
    const { bridgeCall } = require('./fusion-bridge');              // required here: fusion-bridge loads before this module
    let rows = null, segs = null, empty = null, only = null;
    if (wantRows) {
        try {
            const r = await bridgeCall('row_times', { item: itemId, comp: compName });
            rows = (r && Array.isArray(r.frames) && r.frames.length) ? r.frames : null;
        } catch (e) { if (warnings) warnings.push('Could not read the row timing for the repeated sound: ' + e.message); }
    }
    if (!wantSegs) return rows;
    try {
        const r = await bridgeCall('timing_get', { item: itemId, comp: compName }, 6000);
        if (r && r.kind === 'segments' && Array.isArray(r.ranges)) {
            segs = {}; empty = {};
            only = r.only ? Number(r.only) : null;
            for (const x of r.ranges) {
                segs[Number(x.key)] = Math.max(0, Math.round(Number(x.start) || 0));
                if (x.empty) empty[Number(x.key)] = true;      // rows left without text get no sound
            }
        }
    } catch (e) { if (warnings) warnings.push('Could not read the Upper / Emphasis / Lower timing for their sounds: ' + e.message); }
    return { rows, segs, empty, only };
}
// One copy of the sound per row: each starts at its row's frame (+ the layer's offset); a 'clip' length runs until the
// next row starts (and never past the text end), a fixed length is kept. All copies share one audio track.
async function placeRowSfx(tl, project, meta, l, rows, textStart, textEnd, tlStart, notes, videoItem, warnings, place, projectCopy, snap) {
    const out = [];
    const p = sfxFilePath(l.file);
    if (!fs.existsSync(p)) { warnings.push('Layered sound "' + path.basename(l.file) + '" is missing.'); return out; }
    const { mp, item: mpi } = await importSfx(project, p, projectCopy);
    if (!mpi) { warnings.push('Resolve could not import "' + path.basename(l.file) + '".'); return out; }
    const total = Math.max(1, tcToFrame(await mpi.GetClipProperty('Duration'), meta));
    const trimIn = Math.max(0, Math.min(total - 1, Math.round(Number(l.trimIn) || 0)));
    const cap = Math.round(Number(l.len) || 0);
    const off = Math.round(Number(l.offset) || 0);
    const mode = (l.lenMode === 'fixed' || l.lenMode === 'clip') ? l.lenMode : (cap > 0 ? 'fixed' : 'clip');
    const fps = Math.round((meta && meta.fps) || 25);
    const cuts = [];
    for (let i = 0; i < rows.length; i++) {
        const start = Math.max(tlStart, textStart + Math.round(Number(rows[i]) || 0) + off);
        let len = total - trimIn;
        if (mode === 'clip') {
            const next = i + 1 < rows.length ? textStart + Math.round(Number(rows[i + 1]) || 0) + off : textEnd;
            len = Math.min(len, Math.max(1, Math.min(next, textEnd) - start));
        } else if (cap > 0) len = Math.min(len, cap);
        len = Math.max(1, len);
        if (start >= textEnd) continue;
        cuts.push({ start, len });
    }
    if (!cuts.length) return out;
    const first = cuts[0].start, last = cuts[cuts.length - 1];
    const track = await pickTrack(tl, 'audio', Math.round(Number(l.track)) || 0, first, last.start + last.len, 1, notes, place, snap);
    const items = [];
    // every copy: the cut's peak inside the window, plus a slight pitch / volume change so the run is not monotonous
    const vary = cuts.length > 1 && l.vary !== false ? variations() : null;
    const peaks = new Map();
    for (const c of cuts) {
        const placed = await mp.AppendToTimeline([{ mediaPoolItem: mpi, mediaType: 2, trackIndex: track, recordFrame: c.start, startFrame: trimIn, endFrame: trimIn + c.len }]);
        if (!placed || !placed.length) { warnings.push('Layered sound "' + path.basename(l.file) + '" could not be placed at frame ' + (c.start - textStart) + '.'); continue; }
        const it = placed[0];
        snapAdd(snap, 'audio', track, { it, name: path.basename(l.file), start: c.start, end: c.start + c.len });
        const fade = Math.max(0, Math.min(c.len, (l.fade === null || l.fade === undefined) ? Math.min(c.len, Math.round(fps / 5)) : Math.round(Number(l.fade) || 0)));
        if (fade > 0) { try { if (typeof it.SetFades === 'function') await it.SetFades({ FadeIn: 0, FadeOut: fade }); } catch (e) { /* the fade is a convenience */ } }
        if (!peaks.has(c.len)) peaks.set(c.len, await peakOf(p, trimIn, c.len, fps));
        const v = vary ? vary.next() : { cents: 0, db: 0 };
        await applyLevel(it, clampToWindow((Number(l.volume) || 0) + v.db, peaks.get(c.len)), v.cents);
        const id = String(await it.GetUniqueId());
        if (!projectCopy) regAdd(id);      // a preview's sound is temporary; a placed one is not
        items.push(it);
        out.push({ id, it, track, start: c.start, frames: c.len, link: l.link !== false });
    }
    if (l.link !== false && videoItem && items.length) {
        try { await linkToText(tl, videoItem, items); } catch (e) { /* linking is optional */ }
    }
    notes.push('sound "' + path.basename(l.file) + '" repeated for ' + items.length + ' row' + (items.length === 1 ? '' : 's'));
    return out;
}
// The animation of a placed row-by-row clip was sped up / slowed down (Animation Start / Frames): its per-row sound
// copies are placed again at the new row times (same sound, cut, volume and track), so their spacing follows the
// text. A set whose copies were all deleted by hand is forgotten, not put back; one Resolve would not delete is left.
// -> null (no per-row sounds) or { moved, failed, swaps: [{ from: [ids], to: [ids] }] }
async function refitRowSfx(tl, project, meta, textItem, itemId, projectCopy) {
    const rec = segSfxRecord(itemId);
    if (!rec.rows.length) return null;
    const { bridgeCall } = require('./fusion-bridge');
    const r = await bridgeCall('row_times', { item: String(itemId) }, 6000);
    const frames = (r && Array.isArray(r.frames)) ? r.frames.map(f => Math.round(Number(f) || 0)) : [];
    if (!frames.length) return null;
    const textStart = Number(await textItem.GetStart()), clipEnd = Number(await textItem.GetEnd());
    const tlStart = await tl.GetStartFrame();
    let moved = 0, failed = 0;
    const swaps = [], keep = [];
    for (const set of rec.rows) {
        if (JSON.stringify(set.frames || []) === JSON.stringify(frames)) { keep.push(set); continue; }
        let there = [];
        try { const found = await findItemsByIds(tl, set.ids || [], 'audio'); there = (set.ids || []).filter(id => found.has(String(id))); } catch (e) { there = []; }
        if (!there.length) continue;                       // removed by hand: stays removed
        const left = await deleteExtraSfx(tl, there);
        if (left.length) { failed++; keep.push(set); continue; }
        const end = textStart + Math.max(1, Math.min(Math.round(Number(set.end) || 0) || (clipEnd - textStart), clipEnd - textStart));
        const l = Object.assign({}, set.layer, { track: set.track });
        const warnings = [];
        const copies = await placeRowSfx(tl, project, meta, l, frames, textStart, end, tlStart, [], projectCopy ? textItem : null, warnings, null, projectCopy);
        if (!copies.length) { failed++; continue; }
        moved += copies.length;
        swaps.push({ from: there, to: copies.map(x => x.id), link: copies.filter(x => x.link).map(x => x.id) });
        keep.push(Object.assign({}, set, { track: copies[0].track, frames: frames.slice(), ids: copies.map(x => x.id) }));
    }
    const o = segSfxRead();
    o[String(itemId)] = Object.assign(segRec(o[String(itemId)]), { rows: keep });
    segSfxWrite(o);
    return { moved, failed, swaps };
}
