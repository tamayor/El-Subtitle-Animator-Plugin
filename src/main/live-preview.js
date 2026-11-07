// "Preview in Resolve": a real Text+ clip on the timeline that the panel keeps in step with its edits
// (In/Out marks, loop playback, live updates, finishing or removing the preview clip).

module.exports = {
    liveAlive, liveClearMarks, liveFinish, liveRemove, liveSetMarks, liveUpdate, loopOn, loopRestore,
    placeLiveSfx, regAdd, regDel, sweepTempClips, waitIdle
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
    FADE_WARNING, appendSfxCut, deleteClipsById, deleteExtraSfx, findAudioItemById, findItemById, fitDuration, importSfx, layerList, pickTrack,
    placeExtraSfx, relinkToProjectCopy, sfxCutFor, sfxCutFrames, trackUsable, typingFramesFor
} = require('./placement');
const { getProject, timelineMeta } = require('./resolve');


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

async function placeLiveSfx(tl, project, meta, sfxPath, req, anim, textStart, notes, videoItem, videoId, warnings) {
    if (!sfxPath || req.useSfx === false || !fs.existsSync(sfxPath)) return null;
    const tlStart = await tl.GetStartFrame();
    const { mp, item: mpi } = await importSfx(project, sfxPath);
    if (!mpi) return null;
    const textEnd = Math.round(Number(req.end) + (Number(req.tail) || 0));
    const cut = await sfxCutFrames(mpi, meta, sfxCutFor(req, anim, sfxPath, meta, textStart, textEnd));
    const sfxStart = Math.max(tlStart, textStart + Math.round(req.sfxOffset || 0));
    const track = await pickTrack(tl, 'audio', req.sfxTrack || 0, sfxStart, sfxStart + cut.len, 1, notes, req.place);
    const it = await appendSfxCut(mp, mpi, track, sfxStart, cut);
    if (!it) return null;
    if (cut.fadeFailed && warnings) warnings.push(FADE_WARNING);
    const vol = (req.sfxVolume !== undefined && req.sfxVolume !== null) ? Number(req.sfxVolume) : (anim && anim.sfxVolume != null ? Number(anim.sfxVolume) : 0);
    try { await it.SetProperties({ AudioVolumeEnabled: true, AudioVolume: vol }); } catch (e) { /* volume is a convenience */ }
    const id = String(await it.GetUniqueId());
    regAdd(id);
    // not linked yet: liveFinish links it (the "Link text + sound" choice) once the preview is kept
    return { item: it, id, track, linked: false };
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
    try {
        const lib = loadLib();
        const anim = lib.animations.find(a => a.id === state.liveSession.animId);
        if (!anim) throw new Error('Preset not found');
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) throw new Error('Open a timeline in Resolve');
        const item = await findItemById(tl, state.liveSession.itemId);
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
                const old = state.liveSession.sfxId ? await findAudioItemById(tl, state.liveSession.sfxId) : null;
                if (old) { const ok = await tl.DeleteClips([old], false); if (ok) regDel(state.liveSession.sfxId); }
                state.liveSession.sfxId = null;
                await deleteExtraSfx(tl, state.liveSession.extraIds);
                state.liveSession.extraIds = [];
            } catch (e) { /* the sweep removes it later */ }
            if (!(req.textTrack > 0)) {
                try { const t2 = await pickTrack(tl, 'video', 0, textStart, textStart + want, 2, [], req.place); if (t2 >= 2) track = t2; } catch (e) { /* keep the current layer */ }
            }
        }
        if ((await item.GetDuration()) > want) await fitDuration(item, want);          // shorter first, so it cannot run into a neighbour
        if (track >= 2 && (moved || (ti && ti[1] !== track))) await item.SetPosition({ trackIndex: track, startFrame: textStart });
        if ((await item.GetDuration()) !== want) await fitDuration(item, want);
        let sfxMoved = false;
        if (moved) {
            try {
                if (req.sfxPath) state.liveSession.sfxPath = req.sfxPath;      // the sound is cut for THIS caption's length (Estimate / Fixed)
                const r = await placeLiveSfx(tl, project, meta, state.liveSession.sfxPath, req, anim, textStart, [], item, state.liveSession.itemId, warnings);
                if (r) { state.liveSession.sfxId = r.id; sfxMoved = true; }
            } catch (e) { warnings.push('Could not move the sound: ' + e.message); }
            try {
                if (req.useSfx !== false) {
                    const extra = await placeExtraSfx(tl, project, meta, layerList(req, anim), textStart, textStart + want, [], null, state.liveSession.itemId, warnings, req.place);
                    state.liveSession.extraIds = extra.map(x => x.id);
                    state.liveSession.extraLinkIds = extra.filter(x => x.link).map(x => x.id);
                }
            } catch (e) { warnings.push('Could not move the layered sounds: ' + e.message); }
        }
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
        try {
            if (Array.isArray(req.boxList) && req.boxList.length) {
                await bridgeCall('set_boxes', { item: itemId, comp: compName, boxes: fusionBoxes(compPath, req.boxList, true), textDesign, typingFrames: typingFramesFor(want, meta.fps), clipFrames: want });
            } else {
                await bridgeCall('set_text', { item: itemId, comp: compName, text, textDesign, typingFrames: typingFramesFor(want, meta.fps), clipFrames: want });
            }
        } catch (e) { warnings.push('Could not set the text: ' + e.message); }
        try { await item.SetProperties(transformProps(req, meta)); } catch (e) { warnings.push('Could not set transform: ' + e.message); }
        try { await bridgeCall('refresh', { item: itemId, comp: compName }); } catch (e) { /* safety refresh */ }
        await liveSetMarks(tl, item);
        try { if ((await tl.GetCurrentTimecode()) !== tc0) await tl.SetCurrentTimecode(tc0); } catch (e) { /* ignore */ }
        return { ok: true, warnings, start: textStart, frames: want, track, moved, sfxMoved };
    } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
    } finally { state.applying = false; }
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
        if (tl && s) {
            // Sounds first, each checked: a sound Resolve refused to delete stays in the registry for the next sweep.
            const sounds = [s.sfxId, ...(s.extraIds || [])].filter(Boolean);
            const leftSounds = await deleteExtraSfx(tl, sounds);
            const leftText = await deleteClipsById(tl, [s.itemId], findItemById);
            // 'restore' = Remove button / panel closed: always sweep, so a sound a preview move placed after the
            // session was read (or one Resolve refused to delete) does not outlive the preview.
            if (leftSounds.length || leftText.length || mode === 'restore') {
                // one more go through the registry sweep (also catches a sound placed by a move that was still running)
                try { await sweepTempClips(tl); } catch (e) { /* ignore */ }
            }
        }
        try { if (tl && tcR && (await tl.GetCurrentTimecode()) !== tcR) await tl.SetCurrentTimecode(tcR); } catch (e) { /* ignore */ }
    } catch (e) { /* the registry sweep removes it next time */ }
    state.subCache.at = 0;
    return { ok: true };
}

// Apply: keeps the clip (it is no longer temporary) and adds the sound after it, like "Add to timeline".
async function liveFinish(event, req) {
    if (!state.liveSession) return { ok: false, error: 'No Resolve preview is running' };
    if (state.applying) return { ok: false, error: 'Resolve is busy. Try again in a moment.' };
    const s = state.liveSession;
    state.applying = true;
    const warnings = [];
    try {
        const lib = loadLib();
        const anim = lib.animations.find(a => a.id === s.animId) || {};
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) throw new Error('Open a timeline in Resolve');
        const item = await findItemById(tl, s.itemId);
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
            const sfxItem = await findAudioItemById(tl, s.sfxId);
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
        } else if (req.useSfx !== false && sfxPath) {
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
                for (const id of s.extraIds) {
                    regDel(id);
                    const it = await findAudioItemById(tl, id);
                    if (it) await relinkToProjectCopy(project, it);
                }
                for (const id of (s.extraLinkIds || [])) {
                    const it = await findAudioItemById(tl, id);
                    try { if (it && typeof tl.SetClipsLinked === 'function') await tl.SetClipsLinked([item, it], true); } catch (e) { /* linking is optional */ }
                }
            }
            else if (req.useSfx !== false) {
                const extra = layerList(req, anim);
                if (extra.length) await placeExtraSfx(tl, project, meta, extra, textStart, textStart + (await item.GetDuration()), trackNotes, item, itemId, warnings, req.place, true);
            }
        } catch (e) { warnings.push('Could not place the layered sounds: ' + e.message); }
        // remember the transform / link choice on the preset, like Add to timeline does
        try {
            const a2 = lib.animations.find(a => a.id === s.animId);
            if (a2) { a2.posX = Number(req.posX) || 0; a2.posY = Number(req.posY) || 0; a2.scale = Math.max(0.1, Math.min(5, Number(req.scale) || 1)); a2.rotation = Number(req.rotation) || 0; a2.linked = req.linked !== false; saveLib(lib); }
        } catch (e) { /* ignore */ }
        state.subCache.at = 0;
        return { ok: true, videoTrack: ((await item.GetTrackTypeAndIndex()) || [0, 0])[1], audioTrack: sfxTrack, linked: clipsLinked, start: textStart, frames: await item.GetDuration(), warnings, trackNotes };
    } catch (e) {
        return { ok: false, error: String(e && e.message || e), warnings };
    } finally { state.applying = false; }
}

// Ids of the temporary Text+ clips this app has put on the timeline. They are written to disk the moment a clip is
// inserted and forgotten only once it is deleted, so a clip left behind by a crash, a quit, a cancelled render or a
// failed "Add to timeline" is found and removed by the next sweep (start of every preview / apply).
let liveMarks = { saved: undefined };      // the timeline's own In/Out before the preview touched them

function regRead() { try { const a = JSON.parse(fs.readFileSync(CLIP_REG, 'utf8')); return Array.isArray(a) ? a.map(String) : []; } catch (e) { return []; } }
function regWrite(a) { try { fs.writeFileSync(CLIP_REG, JSON.stringify(a)); } catch (e) { /* best effort */ } }
function regAdd(id) { if (!id) return; const a = regRead(); if (!a.includes(String(id))) { a.push(String(id)); regWrite(a); } }
function regDel(id) { if (!id) return; regWrite(regRead().filter(x => x !== String(id))); }
async function sweepTempClips(tl) {
    const ids = new Set(regRead());
    if (state.liveSession) { ids.delete(String(state.liveSession.itemId)); if (state.liveSession.sfxId) ids.delete(String(state.liveSession.sfxId)); for (const x of (state.liveSession.extraIds || [])) ids.delete(String(x)); }      // the clip of a running Resolve preview stays
    if (!ids.size || !tl) return;
    try {
        const stray = [], seen = new Set();
        for (const kind of ['video', 'audio']) {
            const tracks = (await tl.GetTrackCount(kind)) || 0;
            for (let t = 1; t <= tracks; t++) {
                for (const it of ((await tl.GetItemListInTrack(kind, t)) || [])) {
                    try { const id = String(await it.GetUniqueId()); if (ids.has(id)) { stray.push(it); seen.add(id); } } catch (e) { /* ignore */ }
                }
            }
        }
        if (stray.length) { try { await tl.DeleteClips(stray, false); } catch (e) { return; } }
        // Entries not on this timeline any more (already deleted, or on another timeline) are dropped once checked.
        regWrite(regRead().filter(x => !seen.has(x)).slice(-60));
    } catch (e) { /* ignore */ }
}
