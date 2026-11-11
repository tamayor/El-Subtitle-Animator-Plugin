// Building blocks for putting clips on the timeline: picking free tracks, inserting / moving / trimming
// Text+ titles safely, the cut guard, the main sound's cut and layered sound effects.
// Related: title-templates.js (presets as Resolve titles), sfx-import.js (sounds in the Media Pool), row-sfx.js
// (sounds that follow a MultiText row).

// Declared before module.exports: a const used in the export list must exist when it runs.
const FADE_WARNING = 'Resolve did not take the sound\'s fade-out. Drag the fade handle on the audio clip to add it.';

module.exports = {
    FADE_WARNING, appendSfxCut, cutCheck, cutSnapshot, deleteClipsById, deleteExtraSfx, directPlaceTitle, findAudioItemById, findItemById, fitDuration,
    insertTitleAtEnd, layerList, linkToText, moveTitleSafe, pickTrack, placeExtraSfx, presetTplState, sfxCutFor, sfxCutFrames, trackUsable
};

const path = require('path');
const fs = require('fs');

const state = require('./state');
const { isEditedSfxName, sfxFilePath } = require('./sfx');
const { applyLevel, levelVolume } = require('./sfx-level');
const { importSfx } = require('./sfx-import');
const { regAdd, regDel } = require('./live-preview');
const { dlog } = require('./log');
const { findItemsByIds, frameToTC, tcToFrame } = require('./resolve');
const { ensureStopped } = require('./playback');
const { placeRowSfx, rowSfxSet, segSfxAdd } = require('./row-sfx');
const { snapAdd, snapAddTrack, snapCutKeys, snapTrack } = require('./timeline-snapshot');
const { templateAgeMs } = require('./title-templates');
const PERF = require('./perf');

// ------------------------------------------------------------------ building the clip
// Placement options (all off by default), set from the pop-up beside "Add to timeline":
//   locked        a locked track counts as occupying its layer (Text+ then goes above it)
//   disabledTrack a disabled track counts as occupying its layer
//   disabledClip  a disabled clip counts as occupying its track
//   firstEmpty    use the lowest empty layer instead of the top one
//   rangeFrom / rangeTo  keep the Text+ between V<rangeFrom> and V<rangeTo> (rangeTo null = no upper limit). Tracks
//                 above rangeTo are ignored when looking for the top. When every layer of the range is taken there
//                 (e.g. stacked captions), the lowest free layer above the range is used, or a new track is added.
// Text+ is never put onto a locked or disabled track itself (it cannot be placed / would be invisible).
function rangeOf(o) {
    const int = (v) => { if (v === null || v === undefined || v === '') return null; const n = Math.round(Number(String(v).replace(/^v/i, ''))); return Number.isFinite(n) && n > 0 ? n : null; };
    const from = Math.max(2, int(o.rangeFrom) || 2);
    let to = int(o.rangeTo);
    if (to !== null && to < from) to = from;
    return { rangeFrom: from, rangeTo: to, ranged: int(o.rangeFrom) !== null || to !== null };
}
// Audio tracks for the sound effects (audioMode):
//   'any'  (default) the lowest free audio track
//   'same' the same numbers as the video track range (V3-V5 -> A3-A5); no video range set = 'any'
//   'own'  its own range A<audioFrom> to A<audioTo> (audioTo null = no upper limit)
function audioRangeOf(o, vr) {
    const int = (v) => { if (v === null || v === undefined || v === '') return null; const n = Math.round(Number(String(v).replace(/^a/i, ''))); return Number.isFinite(n) && n > 0 ? n : null; };
    const mode = (o.audioMode === 'same' || o.audioMode === 'own') ? o.audioMode : 'any';
    if (mode === 'same' && vr.ranged) return { audioMode: 'same', audioFrom: vr.rangeFrom, audioTo: vr.rangeTo, audioRanged: true };
    if (mode === 'own') {
        const from = int(o.audioFrom) || 1;
        let to = int(o.audioTo);
        if (to !== null && to < from) to = from;
        if (int(o.audioFrom) !== null || to !== null) return { audioMode: 'own', audioFrom: from, audioTo: to, audioRanged: true };
    }
    return { audioMode: mode, audioFrom: 1, audioTo: null, audioRanged: false };
}
function placeOpts(o) {
    o = o || {};
    const vr = rangeOf(o);
    return Object.assign({ locked: !!o.locked, disabledTrack: !!o.disabledTrack, disabledClip: !!o.disabledClip, firstEmpty: !!o.firstEmpty }, vr, audioRangeOf(o, vr));
}

// snap (optional, timeline-snapshot.js): the tracks and clips read once for this placement; without it the track is
// read from Resolve here (its clips 40 at a time).
async function trackUsable(tl, kind, t, snap) {
    const tr = snapTrack(snap, kind, t);
    if (tr) return !tr.locked && tr.enabled;
    try { if (await tl.GetIsTrackLocked(kind, t)) return false; } catch (e) { /* ignore */ }
    try { if ((await tl.GetIsTrackEnabled(kind, t)) === false) return false; } catch (e) { /* ignore */ }
    return true;
}
// The clips of a track as [{ start, end, enabled }], from the snapshot or from Resolve.
async function trackClips(tl, kind, t, snap, withEnabled) {
    const tr = snapTrack(snap, kind, t);
    if (tr) return tr.items;
    const its = (await tl.GetItemListInTrack(kind, t)) || [];
    const arr = Array.isArray(its) ? its : Object.values(its);
    const out = [];
    for (let i = 0; i < arr.length; i += 40) {
        out.push(...await Promise.all(arr.slice(i, i + 40).map(async (it) => {
            try {
                const [start, end, on] = await Promise.all([it.GetStart(), it.GetEnd(), withEnabled ? Promise.resolve(it.GetClipEnabled()).then(v => v !== false).catch(() => true) : true]);
                return { it, start: Number(start), end: Number(end), enabled: on };
            } catch (e) { return null; }
        })));
    }
    return out.filter(Boolean);
}

// Does this track hold something in [s, e) that counts under the placement options?
async function trackHasClip(tl, kind, t, s, e, po, snap) {
    const tr = snapTrack(snap, kind, t);
    try {
        const locked = tr ? tr.locked : !!(await tl.GetIsTrackLocked(kind, t));
        if (!po.locked && locked) return false;
        const enabled = tr ? tr.enabled : (await tl.GetIsTrackEnabled(kind, t)) !== false;
        if (!po.disabledTrack && !enabled) return false;
    } catch (err) { /* ignore */ }
    for (const x of await trackClips(tl, kind, t, snap, !po.disabledClip)) {
        if (!(x.start < e && x.end > s)) continue;
        if (!po.disabledClip && x.enabled === false) continue;
        return true;
    }
    return false;
}

async function trackIsFree(tl, kind, t, s, e, snap) {
    const tr = snapTrack(snap, kind, t);
    if (tr ? tr.locked : await tl.GetIsTrackLocked(kind, t)) return false;
    for (const x of await trackClips(tl, kind, t, snap, false)) {
        if (x.start < e && x.end > s) return false;
    }
    return true;
}

// Auto (video) = the top: one track above the highest track that counts as occupied at that moment (see the
// placement options), never a gap lower down; or the lowest empty layer with "first empty layer". With a track range
// (rangeFrom / rangeTo): the first usable empty layer from rangeFrom up, past the range when it is full. A new track is
// added when there is none. Auto (audio) = the lowest free audio track, or with an audio range (see audioRangeOf) the
// first free usable track from audioFrom up, past the range when it is full.
async function pickTrack(tl, kind, wanted, s, e, firstAuto, notes, placeIn, snap) {
    const sp = PERF.span('place.pickTrack');
    try { return await pickTrackInner(tl, kind, wanted, s, e, firstAuto, notes, placeIn, snap); }
    finally { sp.end({ kind, snap: !!snap }); }
}
async function pickTrackInner(tl, kind, wanted, s, e, firstAuto, notes, placeIn, snap) {
    const n = (snap && snap.tracks[kind]) ? snap.tracks[kind].length : await tl.GetTrackCount(kind);
    const label = (kind === 'audio' ? 'A' : 'V');
    const po = placeOpts(placeIn);
    // tracks added here are added to the snapshot too, so the rest of this placement sees them
    const addTrack = async () => { await (kind === 'audio' ? tl.AddTrack('audio', 'stereo') : tl.AddTrack('video')); if (snap) snapAddTrack(snap, kind, (snap.tracks[kind] || []).length + 1); };
    if (kind === 'video' && wanted === 1) { notes.push('V1 is never used for Text+ (it would cut the clips), so the top layer was used'); wanted = 0; }
    if (wanted > 0 && wanted <= n) {
        if (await trackIsFree(tl, kind, wanted, s, e, snap)) return wanted;
        notes.push(label + wanted + ' is busy there, so the lowest free track was used');
    }
    if (kind === 'video') {
        const lo = Math.max(firstAuto, po.rangeFrom), hi = po.rangeTo === null ? Infinity : po.rangeTo;
        const ranged = po.ranged;
        const where = ranged ? ' (range V' + lo + '-' + (hi === Infinity ? '∞' : 'V' + hi) + ')' : '';
        // adds tracks until V<t> exists (a range that starts above the current top track)
        const addUpTo = async (t) => { let c = n; while (c < t) { await addTrack(); c++; } return t; };
        let target = null;
        // a range always starts at its first track and steps up past locked / disabled / busy ones (never jumps
        // above a higher clip like "top" does); no range = the top, or the lowest empty layer with firstEmpty
        if (po.firstEmpty || ranged) {
            for (let t = Math.max(1, lo); t <= Math.min(n, hi); t++) {
                if (!(await trackUsable(tl, kind, t, snap))) continue;
                if (!(await trackHasClip(tl, kind, t, s, e, po, snap))) { target = t; break; }
            }
            if (target === null && n < lo) target = lo;            // the range starts above the existing tracks
            if (target === null && n < hi) target = n + 1;         // the range has room for a new track
        } else {
            let top = 0;
            for (let t = Math.min(n, hi); t >= lo; t--) {
                if (await trackHasClip(tl, kind, t, s, e, po, snap)) { top = t; break; }
            }
            let t = Math.max(lo, top + 1);
            while (t <= n && t <= hi && !(await trackUsable(tl, kind, t, snap))) t++;
            if (t <= hi) target = t;
        }
        if (target !== null) {
            if (target <= n) return target;
            await addUpTo(target);
            notes.push((ranged ? 'range' + where.replace(/^ \(range|\)$/g, '') + ': no free layer yet' : (po.firstEmpty ? 'no empty layer' : 'placed on top')) + ', added ' + label + (n + 1) + (target > n + 1 ? '-' + label + target : ''));
            return target;
        }
        // every layer of the range is taken: the lowest free layer above it, else a new track on top
        for (let t = hi + 1; t <= n; t++) {
            if (!(await trackUsable(tl, kind, t, snap))) continue;
            if (!(await trackHasClip(tl, kind, t, s, e, po, snap))) {
                notes.push(label + lo + '-' + label + (hi === Infinity ? '∞' : hi) + ' are all taken there, so ' + label + t + ' (above the range) was used');
                return t;
            }
        }
        await addTrack();
        notes.push(ranged ? (label + lo + '-' + label + hi + ' are all taken there, added ' + label + (n + 1) + ' above the range') : ('no empty layer, added ' + label + (n + 1)));
        return n + 1;
    }
    if (kind === 'audio' && po.audioRanged) {
        const lo = Math.max(firstAuto, po.audioFrom), hi = po.audioTo === null ? Infinity : po.audioTo;
        const span = 'A' + lo + '-' + (hi === Infinity ? '∞' : 'A' + hi);
        for (let t = lo; t <= Math.min(n, hi); t++) {
            if (!(await trackUsable(tl, kind, t, snap))) continue;
            if (await trackIsFree(tl, kind, t, s, e, snap)) return t;
        }
        if (n < hi) {                                   // room in the range for new tracks
            const target = Math.max(lo, n + 1);
            for (let c = n; c < target; c++) await addTrack();
            notes.push('audio range ' + span + ': no free track yet, added A' + (n + 1) + (target > n + 1 ? '-A' + target : ''));
            return target;
        }
        for (let t = hi + 1; t <= n; t++) {
            if (!(await trackUsable(tl, kind, t, snap))) continue;
            if (await trackIsFree(tl, kind, t, s, e, snap)) { notes.push(span + ' are all taken there, so A' + t + ' (above the range) was used'); return t; }
        }
        await addTrack();
        notes.push(span + ' are all taken there, added A' + (n + 1) + ' above the range');
        return n + 1;
    }
    for (let t = firstAuto; t <= n; t++) {
        if (await trackIsFree(tl, kind, t, s, e, snap)) return t;
        notes.push(label + t + ' busy');
    }
    await addTrack();
    notes.push('no free ' + label + ' track, added ' + label + (n + 1));
    return n + 1;
}

async function fitDuration(item, want) {
    // SetRightOffset(x) leaves x frames trimmed off the right edge (tested: ro + (current - wanted)).
    // A clip can only grow until nothing is trimmed off (offset 0): asking for more made Resolve throw
    // "SetRightOffset: Invalid offset", so the offset is clamped and the clip is left as long as it can get.
    want = Math.round(Number(want));
    if (!(want >= 1)) return false;
    for (let i = 0; i < 3; i++) {
        const d = await item.GetDuration();
        if (d === want) return true;
        const ro = Number(await item.GetRightOffset()) || 0;
        const next = Math.max(0, ro + (d - want));
        if (next === ro) break;                              // already at its full length
        try { await item.SetRightOffset(next); } catch (e) { break; }
    }
    return (await item.GetDuration()) === want;
}

// InsertFusionTitleIntoTimeline drops the title at the PLAYHEAD as a ripple insert. If the playhead is dragged while
// it is being parked at the end, the title would cut and push the real clips. So the playhead is checked after it is
// moved, the insert is refused when it is not at the end, and an insert that still landed early is ripple-deleted.
async function parkPlayhead(tl, frame, meta) {
    for (let i = 0; i < 4; i++) {
        try {
            await tl.SetCurrentTimecode(frameToTC(frame, meta));
            // read back as soon as Resolve reports the move (up to 4 x 10 ms) instead of a fixed 40 ms wait
            for (let k = 0; k < 4; k++) {
                if (tcToFrame(await tl.GetCurrentTimecode(), meta) === frame) return true;
                await new Promise(r => setTimeout(r, 10));
            }
        } catch (e) { /* retry */ }
        await new Promise(r => setTimeout(r, 120));
    }
    return false;
}
// title: a preset's template name (see presetTitleFor); without it the plain Text+ / MultiText is inserted.
async function insertTitleAtEnd(tl, meta, endFrame, kind, title) {
    const titleName = title || (kind === 'multitext' ? 'MultiText' : 'Text+');
    // While the timeline plays (e.g. looping a preview) the playhead leaves the end again before the insert lands,
    // so the title would be ripple-inserted in the middle of the timeline. Playback is stopped first.
    if (!(await PERF.timed('place.insert.stop', () => ensureStopped(tl)))) return { error: 'The timeline is playing in Resolve. Stop playback (K), then select the preset again.' };
    if (!(await PERF.timed('place.insert.park', () => parkPlayhead(tl, endFrame, meta)))) return { error: 'The playhead was moved while the ' + titleName + ' was being added, so nothing was inserted. Try again.' };
    // Resolve 21.2 THROWS ("Expected valid string type title name") instead of returning null for a template it has
    // not scanned yet - e.g. a preset's template written a moment ago on its first use. Retry once after a short wait,
    // then return no item so the caller's fallback (plain Text+ / MultiText) runs instead of the whole apply failing.
    // A template Resolve has not picked up yet is tried again for a few seconds (every attempt about 1.5 s apart): a
    // clip that falls back to the plain title gets an EMPTY Inspector, so the fallback is the last resort.
    // An In/Out mark makes Resolve insert at the In instead of the playhead. They are cleared for the insert and put
    // back afterwards (a Preview in Resolve has already cleared and saved its own, see liveClearMarks).
    let marks = null;
    try {
        const m = await tl.GetMarkInOut();
        if (m && ((m.video && typeof m.video.in === 'number') || (m.audio && typeof m.audio.in === 'number'))) { marks = m; await tl.ClearMarkInOut('all'); }
    } catch (e) { marks = null; }
    const restoreMarks = async () => {
        if (!marks) return;
        for (const type of ['video', 'audio']) {
            const v = marks[type];
            try { if (v && typeof v.in === 'number' && typeof v.out === 'number' && v.out >= v.in) await tl.SetMarkInOut(v.in, v.out, type); } catch (e) { /* ignore */ }
        }
    };
    // The playhead is parked again right before EVERY attempt: while a fresh template is retried (1.5 s apart) the
    // preview's loop playback or a panel seek could move it, and the title then went in mid-timeline. A title that
    // still lands before the end is ripple-deleted and inserted once more before giving up.
    let item = null, misplaced = 0;
    const attempts = title ? 5 : 1;
    try {
        for (let attempt = 0; attempt < attempts; attempt++) {
            if (attempt > 0 || misplaced) {
                if (!(await ensureStopped(tl))) return { error: 'The timeline is playing in Resolve. Stop playback (K), then select the preset again.' };
                if (!(await parkPlayhead(tl, endFrame, meta))) return { error: 'The playhead was moved while the ' + titleName + ' was being added, so nothing was inserted. Try again.' };
            }
            try { item = await PERF.timed('place.insert.insert', () => tl.InsertFusionTitleIntoTimeline(titleName)); }
            catch (e) {
                dlog('TITLE-INSERT-THREW', titleName, String(e && e.message || e));
                PERF.record('place.insertThrew', 0, { title: titleName, attempt });
                if (!title) throw e;
                // a template written moments ago needs Resolve's scan (about 1.5 s); an older one that throws is
                // more likely a passing refusal, tried again sooner
                if (attempt < attempts - 1) await new Promise(r => setTimeout(r, templateAgeMs(titleName) < 10000 ? 1500 : 500));
                continue;
            }
            if (!item) break;
            let st = endFrame;
            try { st = await item.GetStart(); } catch (e) { /* ignore */ }
            if (st >= endFrame - 1) break;
            dlog('TITLE-INSERT-MISPLACED', titleName, { st, endFrame, attempt });
            try { await tl.DeleteClips([item], true); } catch (e) { /* ignore */ }       // ripple delete closes the gap it made
            item = null;
            if (++misplaced > 1) return { error: 'Resolve put the ' + titleName + ' at the playhead instead of the end, so it was taken out again. Check the timeline around the playhead and try again.' };
            attempt--;      // a misplaced insert does not use up a template retry
        }
    } finally { await restoreMarks(); }
    return { item };
}

// Cut guard: the boundaries of the real clips (V1 and every audio track, Text+ ignored) are noted before and after
// each step this plugin takes on the timeline. A difference is written to _debug/preview-log.txt and shown as a
// warning, so any cut the plugin could cause is caught the moment it happens.
// snap: a timeline snapshot with V1 and the audio tracks (timeline-snapshot.js) read for this placement; without one
// the clips are read here, 40 at a time.
async function cutSnapshot(tl, snap) {
    if (snap && snap.tracks && snap.tracks.video && snap.tracks.audio) return snapCutKeys(snap);
    const sp = PERF.span('place.cutSnapshot');
    const out = [];
    try {
        const na = (await tl.GetTrackCount('audio')) || 0;
        const tracks = [['video', 1]];
        for (let t = 1; t <= na; t++) tracks.push(['audio', t]);
        for (const [kind, t] of tracks) {
            const its = (await tl.GetItemListInTrack(kind, t)) || [];
            const arr = Array.isArray(its) ? its : Object.values(its);
            // only a video clip can be one of this plugin's titles (left out of the keys): no names read on audio
            const named = kind === 'video';
            for (let i = 0; i < arr.length; i += 40) {
                const facts = await Promise.all(arr.slice(i, i + 40).map(it => Promise.all([named ? it.GetName() : '', it.GetStart(), it.GetEnd()]).catch(() => null)));
                for (const f of facts) {
                    if (!f || (named && /^Text\+/.test(String(f[0])))) continue;
                    out.push(kind[0] + t + ':' + f[1] + '-' + f[2]);
                }
            }
        }
    } catch (e) { sp.end({ failed: true }); return null; }
    sp.end({ n: out.length });
    return out;
}
function cutCheck(label, before, after) {
    if (!before || !after) return null;
    const b = new Set(before), a = new Set(after);
    const gone = before.filter(x => !a.has(x)), added = after.filter(x => !b.has(x));
    // A sound effect this plugin places on purpose is the only expected addition.
    if (!gone.length && !added.length) return null;
    dlog('CUTGUARD', label, { removed: gone.slice(0, 20), added: added.slice(0, 20) });
    return gone.length ? 'Warning: clips on the timeline changed during this step (' + gone.length + ' boundaries moved). Details in _debug/preview-log.txt.' : null;
}

// Moves the freshly inserted title (it sits at the END of V1) to its own track, in two steps. Step 1 changes only the
// track and keeps the start at the end of the timeline, so no real clip can be cut or pushed even if Resolve refuses
// the move. Step 2 slides it along that track (an overwrite track that is free there). A title that did not leave V1
// is deleted, with a ripple delete if it had already pushed clips.
async function moveTitleSafe(tl, item, track, textStart, endFrame) {
    const fail = async (msg) => {
        let st = endFrame;
        try { st = await item.GetStart(); } catch (e) { /* ignore */ }
        try { await tl.DeleteClips([item], st < endFrame - 1); } catch (e) { /* the sweep removes it later */ }
        return { ok: false, error: msg };
    };
    if (!(track >= 2)) return await fail('Text+ is never placed on V1 (it would cut your clips).');
    let ok = false;
    try { ok = await item.SetPosition({ trackIndex: track, startFrame: endFrame }); } catch (e) { ok = false; }
    let landed = null;
    try { landed = await item.GetTrackTypeAndIndex(); } catch (e) { landed = null; }
    if (!ok || !landed || landed[1] !== track) return await fail('Could not move the title to track V' + track + '. It was taken out again and nothing else was changed.');
    if (textStart !== endFrame) {
        try { ok = await item.SetPosition({ trackIndex: track, startFrame: textStart }); } catch (e) { ok = false; }
        let st = null;
        try { st = await item.GetStart(); landed = await item.GetTrackTypeAndIndex(); } catch (e) { /* ignore */ }
        if (!ok || st !== textStart || !landed || landed[1] !== track) return { ok: false, error: 'The title is on V' + track + ' but could not be moved to the subtitle position.', leftOnTrack: true };
    }
    return { ok: true };
}

// ---- Direct placement of a Text+ from a template clip in the Media Pool
// AppendToTimeline takes a track and a record frame, so a template clip can go exactly where the caption is: no playhead
// move, no ripple. The template is a clip named "Subtitle Animator Template" in the Media Pool (a Fusion Composition or
// Text+ clip), or one Resolve handed out earlier in this session. The result is checked (track, start, length, no real
// clip moved); on any doubt it is taken out again and the app falls back to the park-at-the-end insert for good.

function presetTplState(title) {
    if (!state.presetTpl) state.presetTpl = new Map();
    if (!state.presetTpl.has(title)) state.presetTpl.set(title, { auto: null, broken: false, good: 0 });
    return state.presetTpl.get(title);
}
async function findTextTemplate(project, kind) {
    const nameRe = kind === 'multitext' ? /^subtitle animator template multitext$/i : /^subtitle animator template$/i;
    try {
        const mp = await project.GetMediaPool();
        const root = await mp.GetRootFolder();
        const folders = [root];
        for (const f of ((await root.GetSubFolderList()) || [])) folders.push(f);
        for (const f of folders) {
            for (const c of ((await f.GetClipList()) || [])) {
                try { if (nameRe.test(String(await c.GetName()))) return c; } catch (e) { /* ignore */ }
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}
// title: a preset's template name; only a Media Pool item Resolve handed out for that same template is used then.
async function directPlaceTitle(tl, project, track, start, want, kind, title, snap) {
    const T = title ? presetTplState(title) : state.tplState[kind === 'multitext' ? 'multitext' : 'text'];
    if (T.broken || !(track >= 2)) return null;
    const tpl = title ? T.auto : ((await findTextTemplate(project, kind)) || T.auto);
    if (!tpl) return null;
    let item = null;
    const undo = async () => { if (item) { try { await tl.DeleteClips([item], false); } catch (e) { /* the sweep removes it later */ } } };
    try {
        const mp = await project.GetMediaPool();
        const full = T.good < 3;
        const before = full ? await cutSnapshot(tl, snap) : null;
        const placed = await mp.AppendToTimeline([{ mediaPoolItem: tpl, mediaType: 1, trackIndex: track, recordFrame: start, startFrame: 0, endFrame: want }]);
        item = placed && placed[0];
        let ok = !!item, why = 'no clip returned';
        if (ok) {
            const ti = await item.GetTrackTypeAndIndex();
            if (!ti || ti[0] !== 'video' || ti[1] !== track) { ok = false; why = 'landed on ' + JSON.stringify(ti); }
            else if ((await item.GetStart()) !== start) { ok = false; why = 'start ' + (await item.GetStart()); }
            else if ((await item.GetDuration()) !== want) { ok = false; why = 'length ' + (await item.GetDuration()); }
            else if (typeof item.GetFusionCompCount === 'function' && !((await item.GetFusionCompCount()) >= 1)) { ok = false; why = 'no Fusion comp on it'; }
        }
        if (ok && full) {
            const after = await cutSnapshot(tl);
            if (before && after && (before.length !== after.length || before.some(x => !after.includes(x)))) { ok = false; why = 'real clips changed'; }
        }
        if (!ok) { dlog('TEMPLATE-FAIL', kind, why); await undo(); T.broken = true; return null; }
        T.good++;
        if (T.good <= 3) dlog('TEMPLATE-OK', { kind, track, start, want });
        return item;
    } catch (e) {
        dlog('TEMPLATE-ERROR', String(e && e.message || e));
        await undo();
        T.broken = true;
        return null;
    }
}

async function findAudioItemById(tl, id) {
    if (!id) return null;
    return (await findItemsByIds(tl, [id], 'audio')).get(String(id)) || null;
}
// The sound of a Preview in Resolve: a real clip on the timeline that can be moved / trimmed by hand. It is NOT linked
// to the Text+ while the preview runs (clicking a linked clip selects both, and Resolve's Inspector then hides the
// Text+ settings); liveFinish links them when the preview is kept.
// ------------------------------------------------------------------ the main sound: the original file, cut by settings
// The main sound is placed from its ORIGINAL file, cut by the preset's settings instead of a rendered WAV:
// { trimIn, len, fade } in frames = source frames cut off the start, the length used, and the fade-out (set as
// Resolve's own fade handle). The whole original stays underneath, so the clip can be extended on the timeline later.
// Without a cut from the panel, it is worked out from the preset (an already-cut file from older versions is placed whole).
function sfxCutFor(req, anim, file, meta, textStart, textEnd) {
    if (req && req.sfxCut) return req.sfxCut;
    if (!anim || isEditedSfxName(path.basename(String(file || '')))) return null;
    const sfxStart = textStart + Math.round(Number(req && req.sfxOffset) || 0);
    const fixed = anim.sfxLenMode === 'fixed' || (anim.sfxLenMode !== 'estimate' && anim.sfxLen !== null && anim.sfxLen !== undefined);
    // The sound never runs past the subtitle it belongs to (textEnd is the subtitle's own end even when the text clip
    // is held longer for a stack): a fixed cut longer than the subtitle is shortened to it, a shorter one is kept.
    const span = Math.max(5, textEnd - sfxStart);
    const len = (fixed && anim.sfxLen !== null && anim.sfxLen !== undefined) ? Math.min(Number(anim.sfxLen), span) : span;
    const fade = (anim.sfxFade === null || anim.sfxFade === undefined) ? Math.round((meta && meta.fps) || 25) : Number(anim.sfxFade);
    return { trimIn: Number(anim.sfxTrimIn) || 0, len, fade };
}
// The cut, clamped to the imported clip's real length.
async function sfxCutFrames(mpi, meta, cut) {
    const total = Math.max(1, tcToFrame(await mpi.GetClipProperty('Duration'), meta));
    if (!cut) return { total, trimIn: 0, len: total, fade: 0 };
    const trimIn = Math.max(0, Math.min(total - 1, Math.round(Number(cut.trimIn) || 0)));
    let len = total - trimIn;
    const want = Math.round(Number(cut.len) || 0);
    if (want > 0) len = Math.min(len, want);
    len = Math.max(1, len);
    const fade = Math.max(0, Math.min(len, Math.round(Number(cut.fade) || 0)));
    return { total, trimIn, len, fade };
}
// Places the cut on the timeline and sets its fade-out. Returns the timeline item (or null); c.fadeFailed is set
// when Resolve did not take the fade.
async function appendSfxCut(mp, mpi, track, recordFrame, c) {
    const placed = await mp.AppendToTimeline([{ mediaPoolItem: mpi, mediaType: 2, trackIndex: track, recordFrame, startFrame: c.trimIn, endFrame: c.trimIn + c.len }]);
    if (!placed || !placed.length) return null;
    const it = placed[0];
    if (c.fade > 0) {
        let ok = false;
        try { if (typeof it.SetFades === 'function') ok = await it.SetFades({ FadeIn: 0, FadeOut: c.fade }); } catch (e) { ok = false; }
        if (!ok) { c.fadeFailed = true; dlog('SFX-FADE-FAILED', c); }
    }
    return it;
}

// ------------------------------------------------------------------ layered sounds (extra sound effects on one preset)
// A preset can carry any number of extra sounds besides its main one: { id, file, enabled, volume (dB), offset (frames),
// align: 'start' | 'end' | 'after', trimIn, len, link }. 'start': the sound starts at the text start + offset.
// 'end': the sound ENDS at the text end + offset. 'after': the sound starts when the text ends + offset.
function layerList(req, anim) {
    const raw = (req && Array.isArray(req.sfxLayers)) ? req.sfxLayers : (anim && Array.isArray(anim.sfxLayers) ? anim.sfxLayers : []);
    return raw.filter(l => l && l.enabled !== false && l.file);
}
// rowFrames: for layers aligned to 'rows' (one sound per row of a row-by-row preset such as Kinetic Cloud), the
// clip-relative frames where the rows start (bridge row_times); null / empty = those layers fall back to the text start.
// rowFrames may also be { rows, segs } (rowFramesFor): segs = { <n>: clip-relative start of segment n's in-animation }
// for layers aligned to one row of a MultiText preset (align 'seg', seg: n = Upper / Emphasis / Lower).
// Links sound clips to the text clip WITHOUT dropping the sounds already linked to it. Resolve's SetClipsLinked makes
// one new link group out of the clips it is given: linking [text, sound B] after [text, sound A] leaves only B linked
// (checked in Resolve 21.2). So the text's current link group is read and linked again together with the new sounds.
async function linkToText(tl, videoItem, items) {
    items = (items || []).filter(Boolean);
    if (!videoItem || !items.length || typeof tl.SetClipsLinked !== 'function') return false;
    let have = [];
    try { if (typeof videoItem.GetLinkedItems === 'function') have = (await videoItem.GetLinkedItems()) || []; } catch (e) { have = []; }
    if (!Array.isArray(have)) have = Object.values(have);
    return !!(await tl.SetClipsLinked([videoItem, ...have, ...items], true));
}
async function placeExtraSfx(tl, project, meta, layers, textStart, textEnd, notes, videoItem, videoId, warnings, place, projectCopy, rowFrames, snap) {
    const out = [];
    if (!layers || !layers.length) return out;
    const sp = PERF.span('place.extraSfx');
    try { return await placeExtraSfxInner(tl, project, meta, layers, textStart, textEnd, notes, videoItem, videoId, warnings, place, projectCopy, rowFrames, snap, out); }
    finally { sp.end({ layers: layers.length, placed: out.length }); }
}
async function placeExtraSfxInner(tl, project, meta, layers, textStart, textEnd, notes, videoItem, videoId, warnings, place, projectCopy, rowFrames, snap, out) {
    const tlStart = await tl.GetStartFrame();
    const rf = Array.isArray(rowFrames) ? { rows: rowFrames, segs: null } : (rowFrames || {});
    rowFrames = rf.rows || null;
    const segLinks = [];
    const segSpecs = layers.filter(l => l && l.align === 'seg');
    for (const l of layers) {
        try {
            if (l.align === 'seg') {
                const n = Math.max(1, Math.round(Number(l.seg) || 1));
                if (rf.empty && rf.empty[n]) continue;          // that row has no text: no sound for it
                const segStart = rf.segs && rf.segs[n] !== undefined ? rf.segs[n] : null;
                if ((segStart || 0) + (Math.round(Number(l.offset) || 0)) >= textEnd - textStart) {      // would start after the text ends
                    notes.push('sound "' + path.basename(l.file) + '": row ' + n + ' starts after the clip ends, not placed');
                    continue;
                }
                if (segStart === null) notes.push('sound "' + path.basename(l.file) + '": the preset has no row ' + n + ' timing, placed at the text start');
                const placed = await placeExtraSfx(tl, project, meta, [Object.assign({}, l, { align: 'start', offset: (segStart || 0) + (Math.round(Number(l.offset) || 0)) })],
                    textStart, textEnd, notes, videoItem, videoId, warnings, place, projectCopy, null, snap);
                for (const x of placed) { x.seg = n; x.off = Math.round(Number(l.offset) || 0); segLinks.push({ id: x.id, seg: n, off: x.off }); }
                out.push(...placed);
                continue;
            }
            // A MultiText clip with text in one row only (e.g. just the Emphasis) gets that row's sound and nothing else:
            // no main sound (apply.js / live-preview.js loneRow) and none of the other layered sounds.
            if (rf.only) continue;
            if (l.align === 'rows') {
                const rows = (Array.isArray(rowFrames) && rowFrames.length) ? rowFrames : [0];
                if (rows.length === 1 && !(Array.isArray(rowFrames) && rowFrames.length)) notes.push('sound "' + path.basename(l.file) + '": the preset has no rows, placed once');
                const copies = await placeRowSfx(tl, project, meta, l, rows, textStart, textEnd, tlStart, notes, videoItem, warnings, place, projectCopy, snap);
                // remembered per text clip, so a later change of the animation's speed re-spaces the copies (refitRowSfx)
                if (videoId && copies.length && Array.isArray(rowFrames) && rowFrames.length) {
                    rowSfxSet(String(videoId), { layer: JSON.parse(JSON.stringify(l)), end: textEnd - textStart, track: copies[0].track,
                        frames: rows.slice(), ids: copies.map(x => x.id) });
                }
                out.push(...copies);
                continue;
            }
            const p = sfxFilePath(l.file);
            if (!fs.existsSync(p)) { warnings.push('Layered sound "' + path.basename(l.file) + '" is missing.'); continue; }
            const { mp, item: mpi } = await importSfx(project, p, projectCopy);
            if (!mpi) { warnings.push('Resolve could not import "' + path.basename(l.file) + '".'); continue; }
            const total = Math.max(1, tcToFrame(await mpi.GetClipProperty('Duration'), meta));
            const trimIn = Math.max(0, Math.min(total - 1, Math.round(Number(l.trimIn) || 0)));
            let len = total - trimIn;
            const cap = Math.round(Number(l.len) || 0);
            const off = Math.round(Number(l.offset) || 0);
            // 'clip' (default): follows the text clip's duration; 'fixed': the set length (0 = the rest of the sound)
            const mode = (l.lenMode === 'fixed' || l.lenMode === 'clip') ? l.lenMode : (cap > 0 ? 'fixed' : 'clip');
            if (mode === 'clip') len = Math.min(len, (l.align === 'end' || l.align === 'after') ? textEnd - textStart : textEnd - (textStart + off));
            else if (cap > 0) len = Math.min(len, cap);
            len = Math.max(1, len);
            let start = l.align === 'end' ? textEnd - len + off : (l.align === 'after' ? textEnd + off : textStart + off);
            if (l.align !== 'end' && l.align !== 'after' && off > 0 && start >= textEnd) {      // would start after the text ends
                notes.push('sound "' + path.basename(l.file) + '": starts after the clip ends, not placed');
                continue;
            }
            start = Math.max(tlStart, start);
            const track = await pickTrack(tl, 'audio', Math.round(Number(l.track)) || 0, start, start + len, 1, notes, place, snap);
            const placed = await mp.AppendToTimeline([{ mediaPoolItem: mpi, mediaType: 2, trackIndex: track, recordFrame: start, startFrame: trimIn, endFrame: trimIn + len }]);
            if (!placed || !placed.length) { warnings.push('Layered sound "' + path.basename(l.file) + '" could not be placed.'); continue; }
            const it = placed[0];
            snapAdd(snap, 'audio', track, { it, name: path.basename(l.file), start, end: start + len });
            const fps = Math.round((meta && meta.fps) || 25);
            const fade = Math.max(0, Math.min(len, (l.fade === null || l.fade === undefined) ? fps : Math.round(Number(l.fade) || 0)));
            if (fade > 0) { try { if (typeof it.SetFades === 'function') await it.SetFades({ FadeIn: 0, FadeOut: fade }); } catch (e) { /* the fade is a convenience */ } }
            // peak window (sfx-level.js): the cut's real peak lands between -20 and -15 dBFS
            const vol = await levelVolume(p, Number(l.volume) || 0, trimIn, len, fps);
            await applyLevel(it, vol, 0);
            const id = String(await it.GetUniqueId());
            if (!projectCopy) regAdd(id);      // a preview's sound is temporary; a placed one is not (the sweep would delete it)
            if (l.link !== false && videoItem) {
                try { await linkToText(tl, videoItem, [it]); } catch (e) { /* linking is optional */ }
            }
            out.push({ id, it, track, start, frames: len, link: l.link !== false });
        } catch (e) { warnings.push('Layered sound "' + path.basename(String(l && l.file || '?')) + '": ' + e.message); }
    }
    if (segSpecs.length && videoId && rf.segs) segSfxAdd(String(videoId), segLinks, segSpecs, rf.empty || {});
    return out;
}

// Deletes the given sound clips and forgets only the ones that are really gone. One that Resolve refused to delete
// stays in the registry, so the next sweep removes it (before, all ids were forgotten and a refused one stayed for good).
// find: findItemById / findAudioItemById (says which kind of track to look on); all ids are looked up in one pass.
// known: Map id -> item the caller already holds (a preview's own clips); each is checked with one call instead of a
// walk of the tracks. Each clip's track and start are read from its handle right before the delete (hints: Map id ->
// { track, start } where it was placed, used when that read fails), so the check that it is really gone lists only
// its own track (stillThere) instead of reading the id of every clip on every track.
async function deleteClipsById(tl, ids, find, known, hints) {
    ids = (ids || []).filter(Boolean).map(String);
    if (!ids.length) return [];
    const kind = find === findAudioItemById ? 'audio' : 'video';
    let left = ids;
    for (let attempt = 0; attempt < 2 && left.length; attempt++) {
        let found = new Map();
        if (attempt === 0 && known && known.size) {
            for (const id of left) {
                const it = known.get(id);
                if (!it) continue;
                try { if (String(await it.GetUniqueId()) === id) found.set(id, it); } catch (e) { /* stale */ }
            }
        }
        const missing = left.filter(id => !found.has(id));
        if (missing.length) for (const [id, it] of await findItemsByIds(tl, missing, kind)) found.set(id, it);
        const items = left.map(id => found.get(id)).filter(Boolean);
        const where = new Map();
        for (const id of left) {
            const it = found.get(id);
            if (!it) continue;
            try {
                const [ti, st] = await Promise.all([it.GetTrackTypeAndIndex(), it.GetStart()]);
                if (ti && ti[1] > 0 && Number.isFinite(Number(st))) { where.set(id, { track: ti[1], start: Number(st) }); continue; }
            } catch (e) { /* the hint, else a walk */ }
            const h = hints && hints.get(id);
            if (h && h.track > 0 && Number.isFinite(Number(h.start))) where.set(id, { track: h.track, start: Number(h.start) });
        }
        if (items.length) {
            let ok = false;
            try { ok = (await tl.DeleteClips(items, false)) !== false; } catch (e) { ok = false; }
            // a delete Resolve did not confirm is given a moment before the check (a confirmed one is final)
            if (!ok && attempt === 0) await new Promise(r => setTimeout(r, 60));
        }
        // an id that was not on the timeline at all is gone already
        const still = await stillThere(tl, kind, left.filter(id => found.has(id)), where);
        left = left.filter(id => still.has(id));
    }
    for (const id of ids) if (!left.includes(id)) regDel(id);
    if (left.length) dlog('DELETE-LEFT', left);
    return left;
}
// Which of these ids are still on the timeline: for an id with a known place only that track is listed and only the
// clips starting at that frame have their id read; the others are looked up with a walk. -> Set of ids still there.
async function stillThere(tl, kind, ids, where) {
    const out = new Set();
    if (!ids.length) return out;
    const sp = PERF.span('tl.stillThere');
    const byTrack = new Map(), walk = [];
    for (const id of ids) {
        const w = where.get(id);
        if (w) { if (!byTrack.has(w.track)) byTrack.set(w.track, []); byTrack.get(w.track).push({ id, start: w.start }); } else walk.push(id);
    }
    for (const [t, want] of byTrack) {
        try {
            const its = (await tl.GetItemListInTrack(kind, t)) || [];
            const arr = Array.isArray(its) ? its : Object.values(its);
            const starts = new Set(want.map(w => w.start));
            const cands = [];
            for (let i = 0; i < arr.length; i += 40) {
                const part = arr.slice(i, i + 40);
                const st = await Promise.all(part.map(it => Promise.resolve(it.GetStart()).then(Number).catch(() => NaN)));
                for (let k = 0; k < part.length; k++) if (starts.has(st[k])) cands.push(part[k]);
            }
            const got = await Promise.all(cands.map(it => Promise.resolve(it.GetUniqueId()).then(String).catch(() => null)));
            for (const w of want) if (got.includes(w.id)) out.add(w.id);
        } catch (e) { for (const w of want) walk.push(w.id); }
    }
    if (walk.length) for (const id of (await findItemsByIds(tl, walk, kind)).keys()) out.add(id);
    sp.end({ kind, n: ids.length, tracks: byTrack.size, walked: walk.length, still: out.size });
    return out;
}
async function deleteExtraSfx(tl, ids, known, hints) { return deleteClipsById(tl, ids, findAudioItemById, known, hints); }

async function findItemById(tl, id) {
    if (!id) return null;
    return (await findItemsByIds(tl, [id], 'video')).get(String(id)) || null;
}
