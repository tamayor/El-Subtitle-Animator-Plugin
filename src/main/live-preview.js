// "Preview in Resolve": a real Text+ clip on the timeline that the panel keeps in step with its edits
// (In/Out marks, loop playback, live updates, finishing or removing the preview clip).

module.exports = {
    liveAlive, liveClearMarks, liveFinish, liveRemove, liveSetMarks, liveUpdate, loopOn, loopRestore,
    placeLiveSfx, regAdd, regCount, regDel, sessionSounds, sweepTempClips, waitIdle
};

const fs = require('fs');
const { execFile } = require('child_process');

const state = require('./state');
const { CLIP_REG, SAMPLE_TEXTS } = require('./config');
const { presetSfxName, sfxFilePath } = require('./sfx');
const { bridgeCall } = require('./fusion-bridge');
const { designForFusion, fusionBoxes } = require('./fusion-setting');
const { loadLib, saveLib } = require('./library');
const { dlog } = require('./log');
const {
    FADE_WARNING, appendSfxCut, deleteClipsById, deleteExtraSfx, findAudioItemById, findItemById, fitDuration, importSfx, layerList, linkToText, pickTrack,
    loneRow, placeExtraSfx, relinkToProjectCopy, rowFramesFor, segSfxForget, segSfxSetEmpty, sfxCutFor, sfxCutFrames, tailFor, trackUsable, typingFramesFor
} = require('./placement');
const { findItemsByIds, getProject, setSubtitlesEnabled, timelineMeta } = require('./resolve');
const { snapAdd } = require('./timeline-snapshot');
const PERF = require('./perf');


// In/Out on the timeline around the preview clip, so Resolve plays (loops) just that range. The user's own In/Out
// are remembered once and put back when the preview ends.
async function liveSetMarks(tl, item) {
    try {
        if (liveMarks.saved === undefined) { try { liveMarks.saved = (await tl.GetMarkInOut()) || null; } catch (e) { liveMarks.saved = null; } }
        // Resolve takes mark frames relative to the start of the timeline. The marks are only ever moved, never cleared.
        const base = (await tl.GetStartFrame()) || 0;
        const s = (await item.GetStart()) - base, d = await item.GetDuration();
        await tl.SetMarkInOut(s, s + Math.max(1, d) - 1, 'all');
    } catch (e) { /* marks are a convenience */ }
}
// Takes the preview's In/Out off the timeline without losing the user's own (remembered once, restored at the end).
// Used between captions and right before a Text+ is inserted, so a stale In/Out can never influence the insert.
async function liveClearMarks(tl) {
    try {
        if (liveMarks.saved === undefined) { try { liveMarks.saved = (await tl.GetMarkInOut()) || null; } catch (e) { liveMarks.saved = null; } }
        await tl.ClearMarkInOut('all');
    } catch (e) { /* marks are a convenience */ }
}
// Puts the user's own marks back, type by type. A type that had no marks before is cleared (those are ours).
async function liveRestoreMarks(tl) {
    if (liveMarks.saved === undefined) return;
    const saved = liveMarks.saved;
    liveMarks.saved = undefined;
    for (const type of ['video', 'audio']) {
        try {
            const v = saved && saved[type];
            if (v && typeof v.in === 'number' && typeof v.out === 'number' && v.out >= v.in) await tl.SetMarkInOut(v.in, v.out, type);
            else await tl.ClearMarkInOut(type);
        } catch (e) { /* ignore */ }
    }
}

// Resolve's own Loop (Playback > Loop/Unloop, Cmd+/). The menu item is a plain toggle with no check mark, so its state
// cannot be read: it is clicked once when a preview starts and once more when it ends (undoing only what the preview
// did). If Loop is already on, say so in the panel and it is left alone. Needs macOS Accessibility permission.
let loopToggled = false;
function clickLoopMenu() {
    return new Promise((resolve) => {
        if (process.platform !== 'darwin') return resolve({ ok: false, error: 'Only on macOS' });
        const script = [
            'tell application "System Events"',
            '  set p to first process whose name is "Resolve" or name contains "DaVinci Resolve"',
            '  tell p to click menu item "Loop/Unloop" of menu 1 of menu bar item "Playback" of menu bar 1',
            'end tell',
            'return "ok"'
        ].join('\n');
        execFile('/usr/bin/osascript', ['-e', script], { timeout: 8000 }, (err) => {
            if (!err) return resolve({ ok: true });
            const why = String(err.message || err).split('\n')[0];
            // fall back to the shortcut Cmd+/ (needs Resolve in front)
            const key = 'tell application "DaVinci Resolve" to activate\ndelay 0.3\ntell application "System Events" to keystroke "/" using command down';
            execFile('/usr/bin/osascript', ['-e', key], { timeout: 8000 }, (err2) => {
                if (err2) return resolve({ ok: false, error: why });
                resolve({ ok: true, viaKey: true });
            });
        });
    });
}
// The Loop button in Resolve's viewer is a check box, so its real state can be read (value 1 = on) instead of toggling blind.
function readLoopState() {
    return new Promise((resolve) => {
        if (process.platform !== 'darwin') return resolve('unknown');
        const script = [
            'tell application "System Events"',
            '  try',
            '    set p to first process whose name is "Resolve" or name contains "DaVinci Resolve"',
            '    set found to (every UI element of entire contents of window 1 of p whose role is "AXCheckBox" and name is "Loop")',
            '    if (count of found) is 0 then return "unknown"',
            '    set v to value of item 1 of found',
            '    if v is 1 or v is true then return "on"',
            '    return "off"',
            '  on error',
            '    return "unknown"',
            '  end try',
            'end tell'
        ].join('\n');
        execFile('/usr/bin/osascript', ['-e', script], { timeout: 12000 }, (err, out) => {
            const t = String(out || '').trim();
            resolve(!err && (t === 'on' || t === 'off') ? t : 'unknown');
        });
    });
}
async function loopOn(alreadyOn) {
    const st = await readLoopState();
    dlog('[loop] state before: ' + st + ' alreadyOn=' + alreadyOn + ' toggled=' + loopToggled);
    if (st === 'on') return { ok: true, skipped: true };
    if (st === 'off') {
        const r = await clickLoopMenu();
        if (!r.ok) return r;
        const st2 = await readLoopState();
        dlog('[loop] state after click: ' + st2);
        if (st2 === 'off') {            // the click did nothing: try the shortcut as well
            const key = 'tell application "DaVinci Resolve" to activate\ndelay 0.3\ntell application "System Events" to keystroke "/" using command down';
            await new Promise((res) => execFile('/usr/bin/osascript', ['-e', key], { timeout: 8000 }, () => res()));
        }
        loopToggled = true;
        return r;
    }
    // state cannot be read: the old blind behaviour
    if (alreadyOn || loopToggled) return { ok: true, skipped: true };
    const r = await clickLoopMenu();
    if (r.ok) loopToggled = true;
    return r;
}
async function loopRestore() {
    if (!loopToggled) return { ok: true };
    loopToggled = false;
    const st = await readLoopState();
    if (st === 'off') return { ok: true };       // already off: nothing to undo
    return await clickLoopMenu();
}

// snap: the placement's timeline snapshot (apply.js), so the track is picked from it; without one the audio tracks are read.
async function placeLiveSfx(tl, project, meta, sfxPath, req, anim, textStart, notes, videoItem, videoId, warnings, snap) {
    if (!sfxPath || req.useSfx === false || !fs.existsSync(sfxPath)) return null;
    const tlStart = await tl.GetStartFrame();
    const { mp, item: mpi } = await importSfx(project, sfxPath);
    if (!mpi) return null;
    const textEnd = Math.round(Number(req.end) + (Number(req.tail) || 0));
    const cut = await sfxCutFrames(mpi, meta, sfxCutFor(req, anim, sfxPath, meta, textStart, textEnd));
    const sfxStart = Math.max(tlStart, textStart + Math.round(req.sfxOffset || 0));
    const track = await pickTrack(tl, 'audio', req.sfxTrack || 0, sfxStart, sfxStart + cut.len, 1, notes, req.place, snap);
    const it = await appendSfxCut(mp, mpi, track, sfxStart, cut);
    if (!it) return null;
    snapAdd(snap, 'audio', track, { it, name: 'sfx', start: sfxStart, end: sfxStart + cut.len });
    if (cut.fadeFailed && warnings) warnings.push(FADE_WARNING);
    const vol = (req.sfxVolume !== undefined && req.sfxVolume !== null) ? Number(req.sfxVolume) : (anim && anim.sfxVolume != null ? Number(anim.sfxVolume) : 0);
    try { await it.SetProperties({ AudioVolumeEnabled: true, AudioVolume: vol }); } catch (e) { /* volume is a convenience */ }
    const id = String(await it.GetUniqueId());
    regAdd(id);
    // not linked yet: liveFinish links it (the "Link text + sound" choice) once the preview is kept
    return { item: it, id, track, start: sfxStart, linked: false };
}

// The preview's layered sounds, remembered in the session: their ids, which of them are linked to the text, the row
// (Upper / Emphasis / Lower) each belongs to, and each clip's handle and place (track + start). liveRemove deletes
// them by handle and checks only their own tracks; liveFinish relinks them by handle. replace: a fresh set.
function sessionSounds(s, extra, replace) {
    if (replace || !s.extraItems) { s.extraItems = new Map(); s.extraWhere = new Map(); }
    if (replace) { s.extraIds = []; s.extraLinkIds = []; s.extraSeg = {}; }
    s.extraIds = s.extraIds || []; s.extraLinkIds = s.extraLinkIds || []; s.extraSeg = s.extraSeg || {};
    for (const x of (extra || [])) {
        const id = String(x.id);
        s.extraIds.push(id);
        if (x.link) s.extraLinkIds.push(id);
        if (x.seg) s.extraSeg[id] = x.seg;
        if (x.it) s.extraItems.set(id, x.it);
        if (x.track > 0) s.extraWhere.set(id, { track: x.track, start: x.start });
    }
}
// Forgets these sounds (deleted) in the session.
function sessionForget(s, ids) {
    const drop = new Set((ids || []).map(String));
    s.extraIds = (s.extraIds || []).filter(id => !drop.has(id));
    s.extraLinkIds = (s.extraLinkIds || []).filter(id => !drop.has(id));
    for (const id of drop) { if (s.extraSeg) delete s.extraSeg[id]; if (s.extraItems) s.extraItems.delete(id); if (s.extraWhere) s.extraWhere.delete(id); }
}
// The session's sound clips by id: the handles kept in the session (one check each), the rest looked up in one pass.
async function sessionItems(tl, s, ids) {
    const out = new Map(), miss = [];
    for (const id0 of (ids || [])) {
        const id = String(id0), it = s.extraItems && s.extraItems.get(id);
        let ok = false;
        if (it) { try { ok = String(await it.GetUniqueId()) === id; } catch (e) { ok = false; } }
        if (ok) out.set(id, it); else miss.push(id);
    }
    if (miss.length) for (const [id, it] of await findItemsByIds(tl, miss, 'audio')) out.set(id, it);
    return out;
}

function transformProps(req, meta) {
    const posX = Number(req.posX) || 0, posY = Number(req.posY) || 0;
    const scale = Math.max(0.1, Math.min(5, Number(req.scale) || 1));
    let pan = posX, tilt = posY;
    if (Math.abs(pan) <= 1.0 && Math.abs(tilt) <= 1.0 && (pan !== 0 || tilt !== 0)) {
        pan = Math.round(pan * meta.width * 100) / 100;
        tilt = Math.round(-tilt * meta.height * 100) / 100;
    } else { pan = Math.round(pan * 1000) / 1000; tilt = Math.round(tilt * 1000) / 1000; }
    const zoom = Math.round(scale * 1000) / 1000;
    return { TransformEnabled: true, Pan: pan, Tilt: tilt, ZoomGang: true, ZoomX: zoom, ZoomY: zoom, RotationAngle: Math.round((Number(req.rotation) || 0) * 1000) / 1000 };
}

// Re-applies text, Text Design, boxes, transform and timing from the panel onto the live clip.
async function liveUpdate(event, req) {
    if (!state.liveSession) return { ok: false, error: 'No Resolve preview is running', gone: true };
    if (state.applying) return { ok: false, busy: true };
    state.applying = true;
    const sp = PERF.span('live.update');
    try {
        const lib = loadLib();
        const anim = lib.animations.find(a => a.id === state.liveSession.animId);
        if (!anim) throw new Error('Preset not found');
        req.tail = tailFor(req, anim);          // a MultiText clip ends with its caption
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) throw new Error('Open a timeline in Resolve');
        const item = await liveItem(tl);
        if (!item) { state.liveSession = null; return { ok: false, gone: true, error: 'The preview clip is no longer on the timeline' }; }
        const tc0 = await tl.GetCurrentTimecode();      // the playhead stays where it is while the clip is moved
        const meta = await timelineMeta(tl);
        const tlStart = await tl.GetStartFrame();
        const textStart = Math.max(tlStart, Math.round(req.start + (req.textOffset || 0)));
        const want = Math.max(5, Math.round(req.end + (req.tail || 0)) - textStart);
        const warnings = [];
        const ti = await item.GetTrackTypeAndIndex();
        let track = ti ? ti[1] : 1;
        if (req.textTrack > 0 && req.textTrack !== track) {
            const ok = req.textTrack >= 2 && await trackUsable(tl, 'video', req.textTrack) && req.textTrack <= (await tl.GetTrackCount('video'));
            if (ok) track = req.textTrack; else warnings.push('V' + req.textTrack + ' is locked or disabled, so the clip stayed where it is.');
        }
        // Another caption: the same Text+ (and its sound) is moved there, nothing is deleted or inserted again. The layer
        // is chosen with the Placement options, like a fresh insert.
        const moved = (await item.GetStart()) !== textStart;
        if (moved) {
            await liveClearMarks(tl);
            // the old sound goes first: a linked sound would otherwise be dragged along onto whatever is at the new place
            try {
                let old = null;
                if (state.liveSession.sfxId) {
                    const h = state.liveSession.sfxItem;
                    try { if (h && String(await h.GetUniqueId()) === String(state.liveSession.sfxId)) old = h; } catch (e) { old = null; }
                    if (!old) old = await findAudioItemById(tl, state.liveSession.sfxId);
                }
                if (old) { const ok = await tl.DeleteClips([old], false); if (ok) regDel(state.liveSession.sfxId); }
                state.liveSession.sfxId = null; state.liveSession.sfxItem = null; state.liveSession.sfxWhere = null;
                await deleteExtraSfx(tl, state.liveSession.extraIds, state.liveSession.extraItems, state.liveSession.extraWhere);
                sessionSounds(state.liveSession, [], true);
            } catch (e) { /* the sweep removes it later */ }
            if (!(req.textTrack > 0)) {
                try { const t2 = await pickTrack(tl, 'video', 0, textStart, textStart + want, 2, [], req.place); if (t2 >= 2) track = t2; } catch (e) { /* keep the current layer */ }
            }
        }
        const dur0 = await item.GetDuration();
        if (dur0 > want) await fitDuration(item, want);          // shorter first, so it cannot run into a neighbour
        if (track >= 2 && (moved || (ti && ti[1] !== track))) await item.SetPosition({ trackIndex: track, startFrame: textStart });
        state.liveSession.itemWhere = { track, start: textStart };
        if ((await item.GetDuration()) !== want) await fitDuration(item, want);
        // A text or design edit on a clip that stayed where it is only needs the new text in the comp. The full pass
        // (timing sliders, retime, segment fit, waking every effect, then a second wake in "refresh") is for a clip
        // that was just inserted, moved or re-cut: doing it on every edit made Resolve re-render the whole comp several
        // times per keystroke, which is what made it lag while editing MultiText.
        const light = !moved && dur0 === want && !(ti && ti[1] !== track);
        let sfxMoved = false;
        // the main and layered sounds are placed below, once the new text is in the comp (per-row copies follow its
        // rows, and a clip with text in one row only gets that row's sound alone)
        if (moved && req.sfxPath) state.liveSession.sfxPath = req.sfxPath;      // the sound is cut for THIS caption's length (Estimate / Fixed)
        const compPath = state.liveSession.compPath, compName = state.liveSession.compName, itemId = state.liveSession.itemId;
        const textDesign = designForFusion(compPath, req.textDesign || anim.textDesign || null, undefined, true);
        const text = String(req.text || '').trim() || (anim && anim.sample) || SAMPLE_TEXTS[0];
        if (Array.isArray(req.boxList)) {
            for (const b of req.boxList) {
                if (b && (b.text === '' || b.text === null || b.text === undefined) && b.mode === 'sub') {
                    b.text = text;
                }
            }
        }
        let segLead = false;      // a row left alone moved to the clip start (or back): its sounds are placed again
        try {
            if (Array.isArray(req.boxList) && req.boxList.length) {
                const br = await bridgeCall('set_boxes', { item: itemId, comp: compName, boxes: fusionBoxes(compPath, req.boxList, true), textDesign, typingFrames: typingFramesFor(want, meta.fps), clipFrames: want, light });
                segLead = !!(br && br.segLead);
            } else {
                await bridgeCall('set_text', { item: itemId, comp: compName, text, textDesign, typingFrames: typingFramesFor(want, meta.fps), clipFrames: want, light });
            }
        } catch (e) { warnings.push('Could not set the text: ' + e.message); }
        // lone: text in one MultiText row only (e.g. just the Emphasis) = that row's sound alone, no main / other sounds
        const S = state.liveSession;
        const layers0 = req.useSfx !== false ? layerList(req, anim) : [];
        const rowFrames0 = layers0.length ? await rowFramesFor(itemId, compName, layers0, warnings) : null;
        const lone = loneRow(rowFrames0);
        const loneFlip = !moved && (segLead || lone !== !!S.lone);
        S.lone = lone;
        if (loneFlip && S.sfxId) {      // the old main sound goes (and comes back below when the clip is no longer lone)
            try {
                const old = await findAudioItemById(tl, S.sfxId);
                if (old && await tl.DeleteClips([old], false)) regDel(S.sfxId);
                S.sfxId = null; S.sfxItem = null; S.sfxWhere = null;
            } catch (e) { /* the sweep removes it later */ }
        }
        if ((moved || loneFlip) && !lone && !S.sfxId) {
            try {
                const r = await placeLiveSfx(tl, project, meta, S.sfxPath, req, anim, textStart, [], item, itemId, warnings);
                if (r) { S.sfxId = r.id; S.sfxItem = r.item; S.sfxWhere = { track: r.track, start: r.start }; sfxMoved = true; }
            } catch (e) { warnings.push('Could not move the sound: ' + e.message); }
        }
        if (moved || loneFlip) {
            try {
                if (!moved) {      // a row is now alone (or no longer): every layered sound is placed again
                    await deleteExtraSfx(tl, S.extraIds, S.extraItems, S.extraWhere);
                    segSfxForget(itemId);
                    sessionSounds(S, [], true);
                }
                if (req.useSfx !== false) {
                    const layers = layers0, rowFrames = rowFrames0;
                    const extra = await placeExtraSfx(tl, project, meta, layers, textStart, textStart + want, [], null, itemId, warnings, req.place, false, rowFrames);
                    sessionSounds(state.liveSession, extra, true);
                }
            } catch (e) { warnings.push('Could not move the layered sounds: ' + e.message); }
        } else if (req.useSfx !== false) {
            // Same caption, new text: a row that just got text gets its sounds, a row that was cleared loses them.
            try { await syncRowSounds(tl, project, meta, req, anim, textStart, want, itemId, compName, warnings, segLead); }
            catch (e) { warnings.push('Could not update the row sounds: ' + e.message); }
        }
        try { await item.SetProperties(transformProps(req, meta)); } catch (e) { warnings.push('Could not set transform: ' + e.message); }
        if (!light) { try { await bridgeCall('refresh', { item: itemId, comp: compName }); } catch (e) { /* safety refresh */ } }
        await liveSetMarks(tl, item);
        try { if ((await tl.GetCurrentTimecode()) !== tc0) await tl.SetCurrentTimecode(tc0); } catch (e) { /* ignore */ }
        return { ok: true, warnings, start: textStart, frames: want, track, moved, sfxMoved };
    } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
    } finally { state.applying = false; sp.end(); }
}

// Row sounds (layers aligned to Upper / Emphasis / Lower) of the running preview follow which rows have text: the
// rows are read from the clip (timing_get 'empty'), compared with the sounds placed (session.extraSeg = { id: row }),
// and only the rows that changed are added or removed. Nothing happens for presets without row sounds.
async function syncRowSounds(tl, project, meta, req, anim, textStart, want, itemId, compName, warnings, replace) {
    const s = state.liveSession;
    const segLayers = layerList(req, anim).filter(l => l.align === 'seg');
    if (!s || !segLayers.length) return;
    const rf = await rowFramesFor(itemId, compName, segLayers, warnings);
    if (!rf || !rf.segs) return;
    const wanted = new Set(segLayers.map(l => Math.max(1, Math.round(Number(l.seg) || 1))).filter(n => !(rf.empty && rf.empty[n])));
    const seg = s.extraSeg || (s.extraSeg = {});
    // replace: the rows' starts moved (fusion_bridge.lead_single_segment), so every row sound is placed again
    const have = replace ? new Set() : new Set(Object.values(seg).map(Number));
    // cleared rows: their sounds go
    const drop = Object.keys(seg).filter(id => replace || !wanted.has(Number(seg[id])));
    if (drop.length) {
        const left = await deleteExtraSfx(tl, drop, s.extraItems, s.extraWhere);
        const gone = drop.filter(id => !left.includes(id));
        segSfxForget(itemId, gone);
        sessionForget(s, gone);
    }
    // rows that just got text: their sounds come in
    const add = segLayers.filter(l => { const n = Math.max(1, Math.round(Number(l.seg) || 1)); return wanted.has(n) && !have.has(n); });
    if (add.length) {
        const extra = await placeExtraSfx(tl, project, meta, add, textStart, textStart + want, [], null, itemId, warnings, req.place, false, rf);
        sessionSounds(s, extra, false);
    }
    segSfxSetEmpty(itemId, rf.empty || {});
}

// The preview clip. The handle kept in the session is checked first (one call); the timeline is only scanned
// (every clip on every video track) when that handle no longer answers, e.g. after the clip was cut or replaced.
async function liveItem(tl) {
    const s = state.liveSession;
    if (!s) return null;
    try { if (s.item && String(await s.item.GetUniqueId()) === String(s.itemId)) return s.item; } catch (e) { /* stale handle */ }
    const found = await findItemById(tl, s.itemId);
    if (found && state.liveSession === s) s.item = found;
    return found;
}

// Is the preview clip still on the timeline? When it was deleted by hand, its sound and In/Out are cleaned up too.
async function liveAlive() {
    const s = state.liveSession;
    if (!s) return { ok: true, alive: false, none: true };
    if (state.applying) return { ok: true, alive: true };
    // A preset switch can start while this check is running and replace the clip. Only a clip that is missing while
    // the SAME session is still current (and nothing is being placed) counts as deleted by hand; otherwise the new
    // preview clip would be removed as well.
    const stale = () => state.liveSession !== s || state.applying;
    try {
        let ok = false;
        try { const st = await s.item.GetStart(); ok = typeof st === 'number' && st >= 0; } catch (e) { ok = false; }
        if (!ok) {
            const project = await getProject();
            const tl = project && await project.GetCurrentTimeline();
            if (!tl) return { ok: true, alive: true };            // cannot tell: assume it is there
            ok = !!(await findItemById(tl, s.itemId));
        }
        if (ok || stale()) return { ok: true, alive: true };
        await liveRemove(true);
        return { ok: true, alive: false };
    } catch (e) { return { ok: true, alive: true }; }
}

// Waits (up to ms) until no other timeline step (a preview move / update) is running, so a preset switch never
// deletes the preview while that step is still placing sounds for it.
async function waitIdle(ms) {
    const until = Date.now() + (ms || 6000);
    while (state.applying && Date.now() < until) await new Promise(r => setTimeout(r, 50));
    return !state.applying;
}

// Removes the preview clip again and puts the playhead back. What happens to the In/Out:
//   'restore' (default, also false/undefined): Remove button or app quit, the user's own marks come back;
//   'clear'   (also true): the clip was deleted by hand, its marks must not stay behind on the old caption;
//   'keep':   switching presets, the marks stay exactly where they are (the new clip lands in the same place).
async function liveRemove(marks) {
    const mode = marks === 'keep' ? 'keep' : (marks === true || marks === 'clear') ? 'clear' : 'restore';
    const s = state.liveSession;
    state.liveSession = null;
    if (!s && mode !== 'restore') return { ok: true };
    try {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        let tcR = null;
        try { if (tl) tcR = await tl.GetCurrentTimecode(); } catch (e) { tcR = null; }
        if (tl && mode === 'restore') await liveRestoreMarks(tl);
        else if (tl && mode === 'clear') await liveClearMarks(tl);
        if (tl && !s && mode === 'restore') {
            // Remove with no session in main (the panel lost track of it, or the place was still running): the
            // registry still lists every temporary preview clip, so they are swept off the timeline anyway.
            try { await sweepTempClips(tl); } catch (e) { /* ignore */ }
        }
        if (tl && s) {
            // Sounds first, each checked: a sound Resolve refused to delete stays in the registry for the next sweep.
            const sounds = [s.sfxId, ...(s.extraIds || [])].filter(Boolean);
            const known = new Map(s.extraItems || []), where = new Map(s.extraWhere || []);
            if (s.sfxId && s.sfxItem) known.set(String(s.sfxId), s.sfxItem);
            if (s.sfxId && s.sfxWhere) where.set(String(s.sfxId), s.sfxWhere);
            const leftSounds = await deleteExtraSfx(tl, sounds, known, where);
            const leftText = await deleteClipsById(tl, [s.itemId], findItemById, s.item ? new Map([[String(s.itemId), s.item]]) : null,
                s.itemWhere ? new Map([[String(s.itemId), s.itemWhere]]) : null);
            // 'restore' = Remove button / panel closed: always sweep, so a sound a preview move placed after the
            // session was read (or one Resolve refused to delete) does not outlive the preview.
            if (leftSounds.length || leftText.length || mode === 'restore') {
                // one more go through the registry sweep (also catches a sound placed by a move that was still running)
                try { await sweepTempClips(tl); } catch (e) { /* ignore */ }
            }
        }
        try { if (tl && tcR && (await tl.GetCurrentTimecode()) !== tcR) await tl.SetCurrentTimecode(tcR); } catch (e) { /* ignore */ }
    } catch (e) { /* the registry sweep removes it next time */ }
    // (no subtitle re-read: a preview never changes the subtitle clips)
    return { ok: true };
}

// Apply: keeps the clip (it is no longer temporary) and adds the sound after it, like "Add to timeline".
async function liveFinish(event, req) {
    if (!state.liveSession) return { ok: false, error: 'No Resolve preview is running' };
    if (state.applying) return { ok: false, error: 'Resolve is busy. Try again in a moment.' };
    const s = state.liveSession;
    state.applying = true;
    state.segSweepHot = Date.now();
    const warnings = [];
    try {
        const lib = loadLib();
        const anim = lib.animations.find(a => a.id === s.animId) || {};
        if (req) req.tail = tailFor(req, anim);          // a MultiText clip ends with its caption
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) throw new Error('Open a timeline in Resolve');
        const item = await liveItem(tl);
        if (!item) { state.liveSession = null; throw new Error('The preview clip is no longer on the timeline'); }
        const meta = await timelineMeta(tl);
        const tlStart = await tl.GetStartFrame();
        regDel(s.itemId);
        state.liveSession = null;
        try { await item.ClearClipColor(); } catch (e) { /* ignore */ }
        await liveRestoreMarks(tl);
        const textStart = await item.GetStart();
        const itemId = String(s.itemId);
        state.lastPlacedItemId = itemId;
        let sfxPath = null;
        if (req.sfxPath && fs.existsSync(req.sfxPath)) sfxPath = req.sfxPath;
        else { const n = req.sfx || presetSfxName(anim) || lib.defaultSfx; if (n) sfxPath = sfxFilePath(n); }
        let sfxTrack = null, clipsLinked = false;
        const trackNotes = [];
        if (s.sfxId) {
            // the sound is already on the timeline from the preview (maybe moved or trimmed by hand): keep it as it is
            let sfxItem = null;
            try { if (s.sfxItem && String(await s.sfxItem.GetUniqueId()) === String(s.sfxId)) sfxItem = s.sfxItem; } catch (e) { sfxItem = null; }
            if (!sfxItem) sfxItem = await findAudioItemById(tl, s.sfxId);
            regDel(s.sfxId);
            if (sfxItem) {
                await relinkToProjectCopy(project, sfxItem);      // placed from the library while previewing
                state.lastPlacedAudioId = String(s.sfxId);
                try { const ti2 = await sfxItem.GetTrackTypeAndIndex(); sfxTrack = ti2 ? ti2[1] : null; } catch (e) { /* ignore */ }
                const wantLink = req.linked !== false;
                const vol = (req.sfxVolume !== undefined && req.sfxVolume !== null) ? Number(req.sfxVolume) : (anim.sfxVolume != null ? Number(anim.sfxVolume) : 0);
                try {
                    let ok = false;
                    if (typeof tl.SetClipsLinked === 'function') ok = await tl.SetClipsLinked([item, sfxItem], wantLink);
                    if (!ok) ok = await bridgeCall('link_clips', { videoId: itemId, audioId: String(s.sfxId), linked: wantLink, volume: vol });
                    clipsLinked = !!(wantLink && ok);
                } catch (e) { warnings.push('Could not link text and sound clips: ' + e.message); }
            }
        } else if (req.useSfx !== false && sfxPath && !s.lone) {
            if (!fs.existsSync(sfxPath)) warnings.push('The sound effect file is missing.');
            else {
                const { mp, item: mpi } = await importSfx(project, sfxPath, true);      // kept = applied: the timeline keeps its own copy
                if (!mpi) warnings.push('Resolve could not import the sound effect.');
                else {
                    const textEnd = Math.round(Number(req.end) + (Number(req.tail) || 0));
                    const cut = await sfxCutFrames(mpi, meta, sfxCutFor(req, anim, sfxPath, meta, textStart, textEnd));
                    const sfxStart = Math.max(tlStart, textStart + Math.round(req.sfxOffset || 0));
                    sfxTrack = await pickTrack(tl, 'audio', req.sfxTrack || 0, sfxStart, sfxStart + cut.len, 1, trackNotes, req.place);
                    const sfxItem = await appendSfxCut(mp, mpi, sfxTrack, sfxStart, cut);
                    if (!sfxItem) warnings.push('The sound effect could not be placed.');
                    else {
                        if (cut.fadeFailed) warnings.push(FADE_WARNING);
                        const vol = (req.sfxVolume !== undefined && req.sfxVolume !== null) ? Number(req.sfxVolume) : (anim.sfxVolume != null ? Number(anim.sfxVolume) : 0);
                        try { await sfxItem.SetProperties({ AudioVolumeEnabled: true, AudioVolume: vol }); } catch (e) { warnings.push('Could not set sound volume: ' + e.message); }
                        const sfxId = String(await sfxItem.GetUniqueId());
                        state.lastPlacedAudioId = sfxId;
                        const wantLink = req.linked !== false;
                        try {
                            let ok = false;
                            if (typeof tl.SetClipsLinked === 'function') ok = await tl.SetClipsLinked([item, sfxItem], wantLink);
                            if (!ok) ok = await bridgeCall('link_clips', { videoId: itemId, audioId: sfxId, linked: wantLink, volume: vol });
                            clipsLinked = !!(wantLink && ok);
                        } catch (e) { warnings.push('Could not link text and sound clips: ' + e.message); }
                    }
                }
            }
        }
        // layered sounds: the ones from the preview stay; if the preview had none, they are placed now
        try {
            if (s.extraIds && s.extraIds.length) {
                const its = await sessionItems(tl, s, s.extraIds);
                for (const id of s.extraIds) {
                    regDel(id);
                    const it = its.get(String(id));
                    if (it) await relinkToProjectCopy(project, it);
                }
                // all in one call, on top of the main sound's link: one call per sound would keep only the last one linked
                const linkIts = (s.extraLinkIds || []).map(id => its.get(String(id))).filter(Boolean);
                try { await linkToText(tl, item, linkIts); } catch (e) { /* linking is optional */ }
            }
            else if (req.useSfx !== false) {
                const extra = layerList(req, anim);
                const rowFrames = await rowFramesFor(itemId, s.compName, extra, warnings);
                if (extra.length) await placeExtraSfx(tl, project, meta, extra, textStart, textStart + (await item.GetDuration()), trackNotes, item, itemId, warnings, req.place, true, rowFrames);
            }
        } catch (e) { warnings.push('Could not place the layered sounds: ' + e.message); }
        // remember the transform / link choice on the preset, like Add to timeline does
        try {
            const a2 = lib.animations.find(a => a.id === s.animId);
            if (a2) { a2.posX = Number(req.posX) || 0; a2.posY = Number(req.posY) || 0; a2.scale = Math.max(0.1, Math.min(5, Number(req.scale) || 1)); a2.rotation = Number(req.rotation) || 0; a2.linked = req.linked !== false; saveLib(lib); }
        } catch (e) { /* ignore */ }
        // the preview is now a real clip: its subtitle clip is turned off, like Add to timeline does (see apply.js step 6)
        let subtitlesDisabled = [];
        if (req.disableSubtitle !== false) {
            try { subtitlesDisabled = await setSubtitlesEnabled(tl, { start: Number(req.start), end: Number(req.end) }, false); }
            catch (e) { warnings.push('Could not disable the subtitle clip: ' + e.message); }
        }
        // (setSubtitlesEnabled patched the cached list; nothing else here is a subtitle clip)
        return { ok: true, subtitlesDisabled, videoTrack: ((await item.GetTrackTypeAndIndex()) || [0, 0])[1], audioTrack: sfxTrack, linked: clipsLinked, start: textStart, frames: await item.GetDuration(), warnings, trackNotes };
    } catch (e) {
        return { ok: false, error: String(e && e.message || e), warnings };
    } finally { state.applying = false; }
}

// Ids of the temporary Text+ clips this app has put on the timeline. They are written to disk the moment a clip is
// inserted and forgotten only once it is deleted, so a clip left behind by a crash, a quit, a cancelled render or a
// failed "Add to timeline" is found and removed by the next sweep (start of every preview / apply).
let liveMarks = { saved: undefined };      // the timeline's own In/Out before the preview touched them

// The registry is read once and kept in memory; adding an id writes the file at once (that write is the crash safety),
// removing one is written a moment later (several removals in a row cost one write).
// An id the sweep does not find on the current timeline may belong to a preview left on another timeline, so it is
// kept, with the number of sweeps that missed it ("id|misses" in the file), and dropped after REG_MAX_MISSES of them.
// (Keeping every unfound id for good is what used to leave the registry full and every placement walking the timeline.)
const REG_MAX_MISSES = 20, REG_MAX = 60;
let reg = null, regTimer = null;
const regMiss = new Map();      // id -> sweeps that did not find it
function regRead() {
    if (reg) return reg.slice();
    reg = [];
    try {
        const a = JSON.parse(fs.readFileSync(CLIP_REG, 'utf8'));
        for (const x of (Array.isArray(a) ? a : [])) {
            const [id, m] = String(x).split('|');
            if (!id) continue;
            reg.push(id);
            if (m && Number(m) > 0) regMiss.set(id, Number(m));
        }
    } catch (e) { reg = []; }
    return reg.slice();
}
function regWrite(a, later) {
    reg = a.slice();
    for (const id of regMiss.keys()) if (!reg.includes(id)) regMiss.delete(id);
    if (!later) { if (regTimer) { clearTimeout(regTimer); regTimer = null; } regFlush(); return; }
    if (regTimer) return;
    regTimer = setTimeout(() => { regTimer = null; regFlush(); }, 150);
    if (regTimer.unref) regTimer.unref();
}
function regFlush() { try { fs.writeFileSync(CLIP_REG, JSON.stringify((reg || []).map(id => regMiss.get(id) ? id + '|' + regMiss.get(id) : id))); } catch (e) { /* best effort */ } }
function regCount() { return regRead().length; }
function regAdd(id) { if (!id) return; const a = regRead(); if (!a.includes(String(id))) { a.push(String(id)); regWrite(a); } }
function regDel(id) { if (!id) return; regWrite(regRead().filter(x => x !== String(id)), true); }
// snap: a timeline snapshot taken by the caller (timeline-snapshot.js) with the items' ids, so the sweep does not
// walk the timeline again. Without one (or one without ids) it reads the ids itself - CHUNK at a time, by track.
async function sweepTempClips(tl, snap) {
    const ids = new Set(regRead());
    if (state.liveSession) { ids.delete(String(state.liveSession.itemId)); if (state.liveSession.sfxId) ids.delete(String(state.liveSession.sfxId)); for (const x of (state.liveSession.extraIds || [])) ids.delete(String(x)); }      // the clip of a running Resolve preview stays
    if (!ids.size || !tl) return;
    const sp = PERF.span('tl.sweepTemp');
    try {
        const stray = [], seen = new Set();
        const take = (id, it) => { if (ids.has(id) && !seen.has(id)) { stray.push(it); seen.add(id); } };
        if (snap && snap.withIds) {
            for (const kind of ['video', 'audio']) for (const tr of (snap.tracks[kind] || [])) for (const x of tr.items) if (x.id) take(x.id, x.it);
        } else {
            for (const kind of ['video', 'audio']) {
                const tracks = (await tl.GetTrackCount(kind)) || 0;
                for (let t = 1; t <= tracks; t++) {
                    const its = (await tl.GetItemListInTrack(kind, t)) || [];
                    for (let i = 0; i < its.length; i += 40) {
                        const part = its.slice(i, i + 40);
                        const got = await Promise.all(part.map(it => Promise.resolve(it.GetUniqueId()).then(String).catch(() => null)));
                        for (let k = 0; k < part.length; k++) if (got[k]) take(got[k], part[k]);
                    }
                }
            }
        }
        let deleted = true;
        if (stray.length) { try { deleted = (await tl.DeleteClips(stray, false)) !== false; } catch (e) { deleted = false; } }
        // Found ids were deleted: dropped (kept only when Resolve refused the delete). Ids not found are not on this
        // timeline: already deleted, or a preview left on another timeline - kept for up to REG_MAX_MISSES sweeps so
        // that timeline's next sweep can still remove them, then forgotten.
        for (const id of ids) if (!seen.has(id)) regMiss.set(id, (regMiss.get(id) || 0) + 1);
        regWrite(regRead().filter(x => !ids.has(x) || (seen.has(x) ? !deleted : (regMiss.get(x) || 0) < REG_MAX_MISSES)).slice(-REG_MAX));
    } catch (e) { /* ignore */ }
    sp.end({ ids: ids.size, viaSnapshot: !!(snap && snap.withIds) });
}
