// The main action: turn the current subtitle into an animated Text+ clip with its sound effect(s).

module.exports = {
    apply
};

const path = require('path');
const fs = require('fs');

const state = require('./state');
const { ANIM_DIR, SAMPLE_TEXTS } = require('./config');
const { presetSfxName, sfxFilePath } = require('./sfx');
const { bridgeCall } = require('./fusion-bridge');
const { getFixes } = require('./fusion-fixes');
const { dlog } = require('./log');
const { settleLater } = require('./settle');
const { designForFusion, fusionBoxes } = require('./fusion-setting');
const { loadLib, saveLib } = require('./library');
const {
    liveClearMarks, liveRemove, liveSetMarks, placeLiveSfx, regAdd, regCount, regDel, sessionSounds, sweepTempClips, waitIdle
} = require('./live-preview');
const { ensureStopped, noteFrame } = require('./playback');
const {
    FADE_WARNING, appendSfxCut, cutCheck, cutSnapshot, directPlaceTitle, fitDuration, importSfx, insertTitleAtEnd, inspectorSafeComp,
    layerList, moveTitleSafe, pickTrack, placeExtraSfx, rowFramesFor, presetHasRowControls, presetOutputFor, presetTitleFor, presetTitleNames, presetTplState, sfxCutFor, sfxCutFrames, titleKindFor, typingFramesFor
} = require('./placement');
const { frameToTC, getProject, setSubtitlesEnabled, tcToFrame, timelineMeta } = require('./resolve');
const { snapAdd, takeSnapshot } = require('./timeline-snapshot');
const PERF = require('./perf');

async function apply(event, req) {
    const warnings = [];
    if (req && req.live) await waitIdle(6000);      // a preview move still running would place sounds for the old clip
    state.applying = true;
    const sp = PERF.span('apply', { live: !!(req && req.live) });
    let ok = false;
    try {
        const r = await applyInner(req, warnings, sp);
        ok = !!(r && r.ok);
        return r;
    } finally {
        state.applying = false;
        sp.end({ ok });
    }
}

async function applyInner(req, warnings, sp) {
    try {
        const lib = loadLib();
        const anim = lib.animations.find(a => a.id === req.animationId);
        if (!anim) throw new Error('Pick an animation first');
        let text = String(req.text || '').trim();
        if (!text) {
            text = (anim && anim.sample) || SAMPLE_TEXTS[0];
        }
        if (Array.isArray(req.boxList)) {
            for (const b of req.boxList) {
                if (b && (b.text === '' || b.text === null || b.text === undefined) && b.mode === 'sub') {
                    b.text = text;
                }
            }
        }

        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) throw new Error('Open a timeline in Resolve');
        const meta = await timelineMeta(tl);
        const origTC = await tl.GetCurrentTimecode();
        const tlStart = await tl.GetStartFrame();

        // Text+ alignment is the anchor; SFX follows Text+ start + sfxOffset.
        const textStart = Math.max(tlStart, Math.round(req.start + (req.textOffset || 0)));
        const textEnd = Math.round(req.end + (req.tail || 0));
        // holdUntil: the text clip runs on to a later subtitle's end, the sound keeps the subtitle's own length
        const sfxEnd = Number.isFinite(Number(req.sfxEnd)) ? Math.round(Number(req.sfxEnd) + (req.tail || 0)) : textEnd;
        const want = Math.max(5, textEnd - textStart);

        const trackNotes = [];
        const titleKind = titleKindFor(path.join(ANIM_DIR, anim.file));      // MultiText presets are created as MultiText clips
        // The playhead is noted before and after the snapshot: with the two readings apart and equal, the playback check
        // before the insert (playback.js isPlaying) knows the timeline stands still without a wait of its own.
        const tlName = String(await tl.GetName());
        noteFrame(tlName, tcToFrame(origTC, meta));
        if (req.live && state.liveSession) await liveRemove('keep');      // first, so a leftover preview clip cannot change which layer is picked
        sp.mark('prep');
        // One read of the timeline's clips for this whole placement (timeline-snapshot.js): the cut guard, every track
        // pick (text and each sound) and the temp-clip sweep work from it instead of walking the timeline again each.
        // Taken after the running preview's clips are removed, so it shows the timeline as it is now.
        const snap = await takeSnapshot(tl, { kinds: ['video', 'audio'], withIds: regHasEntries() });
        try { noteFrame(tlName, tcToFrame(await tl.GetCurrentTimecode(), meta)); } catch (e) { /* measured by isPlaying then */ }
        sp.mark('snapshot');
        if (req.live) await ensureStopped(tl);      // a playing (looping) timeline moves the playhead under the insert
        const cutBefore = await cutSnapshot(tl, snap);
        const vTrack = await pickTrack(tl, 'video', req.textTrack || 0, textStart, textStart + want, 2, trackNotes, req.place, snap);
        sp.mark('pickTrackV');

        // Prepare SFX before touching the timeline playhead so playhead time at tlEnd is minimal.
        let sfxInfo = null;
        let sfxPath = null;
        if (req.sfxPath && fs.existsSync(req.sfxPath)) {
            sfxPath = req.sfxPath;
        } else {
            const sfxName = req.sfx || presetSfxName(anim) || lib.defaultSfx;
            if (sfxName) sfxPath = sfxFilePath(sfxName);
        }
        const live = !!req.live;      // Preview in Resolve: no sound yet, the clip stays a temporary one until Apply
        if (!live && req.useSfx !== false && sfxPath) {
            if (!fs.existsSync(sfxPath)) {
                warnings.push('The sound effect file is missing.');
            } else {
                const { mp, item: mpi } = await importSfx(project, sfxPath, true);      // applied: the timeline keeps its own copy
                if (!mpi) {
                    warnings.push('Resolve could not import the sound effect.');
                } else {
                    // the original file, cut by the preset's settings (nothing rendered): trim / length / fade-out
                    const cut = await sfxCutFrames(mpi, meta, sfxCutFor(req, anim, sfxPath, meta, textStart, sfxEnd));
                    const sfxStart = Math.max(tlStart, textStart + Math.round(req.sfxOffset || 0));
                    const sfxTrack = await pickTrack(tl, 'audio', req.sfxTrack || 0, sfxStart, sfxStart + cut.len, 1, trackNotes, req.place, snap);
                    sfxInfo = { mp, mpi, cut, sfxStart, sfxTrack };
                    // the main sound's place is taken (the layered sounds pick their tracks later in this placement)
                    snapAdd(snap, 'audio', sfxTrack, { name: 'sfx', start: sfxStart, end: sfxStart + cut.len });
                }
            }
        }
        sp.mark('sfxPrepare');

        // 1. Insert at the very end of the timeline, trim, move to vTrack at textStart, and immediately restore playhead.
        const tlEnd = await tl.GetEndFrame();
        await sweepTempClips(tl, snap);
        sp.mark('sweep');
        // Direct placement (no playhead move, no ripple): a reusable Text+/Fusion template clip from the Media Pool is
        // appended onto the chosen track at the caption's exact frame. Used when a template exists and checks out.
        // The preset goes in as its own title template (see presetTitleFor), so Resolve builds the clip itself and the
        // Inspector shows its controls. Only when the template cannot be written or inserted is a plain Text+ / MultiText
        // inserted and the preset imported onto it (that clip works, but its Inspector stays empty).
        const compPath = path.join(ANIM_DIR, anim.file);
        let presetTitle = fs.existsSync(compPath) ? presetTitleFor(compPath, presetTitleNames(lib.animations).get(anim.id)) : null;
        sp.mark('template');
        let item = await directPlaceTitle(tl, project, vTrack, textStart, want, titleKind, presetTitle, snap);
        let insertedId = null, finalLen = null, insertedAt = Date.now();
        if (item) {
            try { insertedId = String(await item.GetUniqueId()); regAdd(insertedId); } catch (e) { /* ignore */ }
            finalLen = want;
            insertedAt = Date.now();
            PERF.record('place.insertDirect', 0);
        } else {
            // Fallback: Resolve can only insert a title at the playhead on V1, so it is parked at the end and moved up.
            if (req.live) await liveClearMarks(tl);      // an insert at the playhead would follow a set In/Out
            let ins = await insertTitleAtEnd(tl, meta, tlEnd, titleKind, presetTitle);
            if (!ins.error && !ins.item && presetTitle) {
                dlog('PRESET-TITLE-INSERT-FAIL', presetTitle);
                presetTitle = null;
                ins = await insertTitleAtEnd(tl, meta, tlEnd, titleKind);
            }
            if (ins.error) { try { await tl.SetCurrentTimecode(origTC); } catch (e) { /* ignore */ } throw new Error(ins.error); }
            item = ins.item;
            insertedAt = Date.now();
            try { if (item) { insertedId = String(await item.GetUniqueId()); regAdd(insertedId); } } catch (e) { /* ignore */ }
            if (!item) {
                await tl.SetCurrentTimecode(origTC);
                throw new Error('Resolve would not insert a ' + (titleKind === 'multitext' ? 'MultiText' : 'Text+') + ' title. Open the Edit page and try again.');
            }
            if (!(await PERF.timed('place.insert.fit', () => fitDuration(item, want)))) {
                warnings.push('The clip could not be trimmed to the subtitle length (it is ' + (await item.GetDuration()) + ' frames).');
            }
            finalLen = await item.GetDuration();
            const mv = await PERF.timed('place.insert.move', () => moveTitleSafe(tl, item, vTrack, textStart, tlEnd));
            try { await tl.SetCurrentTimecode(origTC); } catch (e) { /* ignore */ }
            if (!mv.ok) {
                if (!mv.leftOnTrack) regDel(insertedId);
                throw new Error(mv.error);
            }
            // If Resolve hands out a Media Pool item for this title, keep it as a template for direct placement next time.
            // Asked at most 3 times per template: a Fusion title has never been seen to return one.
            const T = presetTitle ? presetTplState(presetTitle) : state.tplState[titleKind];
            if (!T.auto && !T.broken && (T.mpiTries || 0) < 3) {
                T.mpiTries = (T.mpiTries || 0) + 1;
                try { const mpi = await item.GetMediaPoolItem(); if (mpi) T.auto = mpi; PERF.record('place.mediaPoolItem', 0, { got: !!mpi }); } catch (e) { /* not available */ }
            }
        }
        snapAdd(snap, 'video', vTrack, { it: item, name: presetTitle || (titleKind === 'multitext' ? 'MultiText' : 'Text+'), start: textStart, end: textStart + (finalLen || want), id: insertedId });
        sp.mark('insert');

        if (!live) regDel(insertedId);      // it is now a real subtitle clip, no longer a temporary one
        if (!live) state.segSweepHot = Date.now();      // seg-watch's sweep looks at the timeline soon
        // 2. The clip already holds the preset when it came from the preset's template; otherwise the comp is imported.
        //    Then the subtitle text is set.
        const itemId = String(await item.GetUniqueId());
        state.lastPlacedItemId = itemId;
        let compName = null;
        if (presetTitle) {
            { const left = [...new Set(state.ofxLeft.get(compPath) || [])]; if (left.length) warnings.push('This preset uses the OFX effect ' + left.join(', ') + ', so Resolve shows an empty Inspector for the clip. The effect works, but its text controls are not listed.'); }
            // Resolve wires an inserted title's output to "Template"; a preset whose text runs through effects
            // (wiggle, glitch, stop motion) would lose them all. Its output is connected back to the right tool.
            const out = presetOutputFor(presetTitle);
            if (out && out.source !== 'Template') {
                let r = null;
                try { r = await bridgeCall('set_output', { item: itemId, comp: null, source: out.source, output: out.output }); } catch (e) { r = { ok: false, why: e.message }; }
                if (!r || !r.ok) {
                    dlog('SET-OUTPUT-FAIL', presetTitle, r && r.why);
                    warnings.push('The preset\'s effects could not be connected on the clip (' + ((r && r.why) || 'unknown') + '), so it may show plain text.');
                }
            }
        } else if (fs.existsSync(compPath)) {
            // Fallback only: the preset's title template could not be written or inserted. Said out loud, so a broken
            // template path never goes unnoticed again (tools/check-inspector-safe.js guards the main path).
            dlog('INSPECTOR-FALLBACK', anim.file);
            warnings.push('Resolve\'s Inspector will be empty for this clip: the preset could not be added as a Resolve title template, so it was imported instead. The animation works.');
            const before = (await item.GetFusionCompNameList()) || [];
            // inspector-ok: logged fallback when the title template could not be used (see the warning above)
            await item.ImportFusionComp(inspectorSafeComp(compPath));
            { const left = [...new Set(state.ofxLeft.get(compPath) || [])]; if (left.length) warnings.push('This preset uses the OFX effect ' + left.join(', ') + ', so Resolve shows an empty Inspector for the clip. The effect works, but its text controls are not listed.'); }
            const after = (await item.GetFusionCompNameList()) || [];
            const added = after.find(n => !before.includes(n));
            if (added) {
                await item.LoadFusionCompByName(added);      // inspector-ok: same fallback
                compName = added;
                for (const n of before) { try { await item.DeleteFusionCompByName(n); } catch (e) { /* ignore */ } }
            }
        } else {
            warnings.push('The animation file is missing, so a plain Text+ was used.');
        }
        if (!compName) { const names = (await item.GetFusionCompNameList()) || []; compName = names[names.length - 1]; }
        sp.mark('setOutput');
        const textDesign = designForFusion(compPath, req.textDesign || anim.textDesign || null);
        const typingFrames = typingFramesFor(finalLen || want, meta.fps);
        let liveNodes = null, setTextAt = 0;
        try {
            if (Array.isArray(req.boxList) && req.boxList.length) {
                // multitext: automation's sizing for MultiText presets ({ textSize, maxSize, lineSpacing }, see fusion_bridge.size_multitext)
                const r = await bridgeCall('set_boxes', { item: itemId, comp: compName, boxes: fusionBoxes(compPath, req.boxList), textDesign, multitext: req.multitext || null, typingFrames, clipFrames: finalLen || want });
                liveNodes = r && r.nodes;
                if (r && r.unscaled && r.unscaled.length) warnings.push('Not resized (animated): ' + r.unscaled.join(', ') + '.');
                if (r && r.capped) warnings.push('MultiText size capped at maxSize.');
                if (r && r.missing && r.missing.length) warnings.push('Not found in Fusion: ' + r.missing.join(', ') + '.');
                if (r && r.fixedPosition && r.fixedPosition.length) warnings.push('Position not changed (animated or not published): ' + r.fixedPosition.join(', ') + '.');
            } else if (!(await bridgeCall('set_text', { item: itemId, comp: compName, text, textDesign, typingFrames, clipFrames: finalLen || want }))) {
                warnings.push('The animation has no Text+ node to put the text in.');
            }
        } catch (e) {
            warnings.push('Could not set the text: ' + e.message);
        }
        setTextAt = Date.now();
        sp.mark('setText');

        // 3. Apply and remember transform (position, scale, rotation) and link preference.
        const posX = Number(req.posX) || 0;
        const posY = Number(req.posY) || 0;
        const scale = Math.max(0.1, Math.min(5, Number(req.scale) || 1));
        const rotation = Number(req.rotation) || 0;
        const wantLink = req.linked !== false;
        // keepPresetDefaults: automation (src/main/automation.js) places per subtitle and must not change the preset
        if (!req.keepPresetDefaults && (anim.posX !== posX || anim.posY !== posY || anim.scale !== scale || anim.rotation !== rotation || anim.linked !== wantLink)) {
            anim.posX = posX;
            anim.posY = posY;
            anim.scale = scale;
            anim.rotation = rotation;
            anim.linked = wantLink;
            saveLib(lib);
        }
        if (posX !== 0 || posY !== 0 || scale !== 1 || rotation !== 0) {
            try {
                let pan = Number(posX) || 0;
                let tilt = Number(posY) || 0;
                // Legacy preset migration: if posX and posY are normalized ratios (<= 1.0) and non-zero, convert to timeline pixels
                if (Math.abs(pan) <= 1.0 && Math.abs(tilt) <= 1.0 && (pan !== 0 || tilt !== 0)) {
                    pan = Math.round(pan * meta.width * 100) / 100;
                    tilt = Math.round(-tilt * meta.height * 100) / 100;
                } else {
                    pan = Math.round(pan * 1000) / 1000;
                    tilt = Math.round(tilt * 1000) / 1000;
                }
                const zoom = Math.round(scale * 1000) / 1000;
                const rotAngle = Math.round(rotation * 1000) / 1000;
                await item.SetProperties({
                    TransformEnabled: true,
                    Pan: pan,
                    Tilt: tilt,
                    ZoomGang: true,
                    ZoomX: zoom,
                    ZoomY: zoom,
                    RotationAngle: rotAngle
                });
            } catch (e) {
                warnings.push('Could not set transform properties: ' + e.message);
            }
        }
        sp.mark('transform');

        // 4. Sound effect (aligned to Text+ start + sfxOffset) and clip linking on timeline.
        let sfxTrack = null;
        let clipsLinked = false;
        if (sfxInfo) {
            sfxTrack = sfxInfo.sfxTrack;
            const sfxItem = await appendSfxCut(sfxInfo.mp, sfxInfo.mpi, sfxInfo.sfxTrack, sfxInfo.sfxStart, sfxInfo.cut);
            if (!sfxItem) {
                warnings.push('The sound effect could not be placed.');
            } else {
                if (sfxInfo.cut.fadeFailed) warnings.push(FADE_WARNING);
                const targetVol = (req.sfxVolume !== undefined && req.sfxVolume !== null)
                    ? Number(req.sfxVolume)
                    : (anim.sfxVolume !== undefined && anim.sfxVolume !== null ? Number(anim.sfxVolume) : 0);
                try {
                    await sfxItem.SetProperties({
                        AudioVolumeEnabled: true,
                        AudioVolume: targetVol
                    });
                } catch (e) {
                    warnings.push('Could not set sound volume: ' + e.message);
                }
                const sfxId = String(await sfxItem.GetUniqueId());
                state.lastPlacedAudioId = sfxId;
                try {
                    let linkedOk = false;
                    if (typeof tl.SetClipsLinked === 'function') {
                        linkedOk = await tl.SetClipsLinked([item, sfxItem], wantLink);
                    }
                    if (!linkedOk) {
                        linkedOk = await bridgeCall('link_clips', { videoId: itemId, audioId: sfxId, linked: wantLink, volume: targetVol });
                    }
                    clipsLinked = !!(wantLink && linkedOk);
                } catch (e) {
                    warnings.push('Could not link text and sound clips: ' + e.message);
                }
            }
        }

        // 4b. Layered sounds: extra sound effects of the preset, each aligned to the text start or end.
        //     Every copy's id is kept (extraSfxIds) so remove_placed can delete them even after they were moved by hand.
        let extraSfxIds = [];
        if (!live && req.useSfx !== false) {
            const extra = layerList(req, anim);
            const rowFrames = await rowFramesFor(itemId, compName, extra, warnings);
            if (extra.length) extraSfxIds = (await placeExtraSfx(tl, project, meta, extra, textStart, textStart + want, trackNotes, item, itemId, warnings, req.place, true, rowFrames, snap)).map(x => x.id);
        }
        sp.mark('sfx');

        // 5. Once everything is placed, touch the text again so Resolve renders the Follower animation (it can
        //    otherwise stay blank on a freshly imported comp).
        //    Fusion fix refreshIfRecentWake (off by default = today's behaviour): skip this refresh when the insert
        //    wake (set_text / set_boxes) ran less than 200 ms ago, i.e. when nothing else was placed in between.
        // The cut guard's "after" is a real re-read of V1 and the audio tracks (that is its point). Every clip of this
        // placement is on the timeline by now, so it is read while the Fusion helper does the refresh / highlight /
        // rows work below (the helper is another process: the two overlap).
        const cutAfterP = cutSnapshot(tl);
        const fixes = getFixes();
        const recentWake = fixes.wakeOnInsert && (Date.now() - setTextAt) < 200;
        if (fixes.refreshAfterPlace && !(fixes.refreshIfRecentWake && recentWake)) {
            try {
                // the refresh waits until the comp is at least 120 ms old; the text, transform and sounds placed since
                // the insert usually took longer than that already, so there is nothing left to wait
                const left = 120 - (Date.now() - insertedAt);
                if (left > 0) await new Promise(r => setTimeout(r, left));
                await bridgeCall('refresh', { item: itemId, comp: compName });
            } catch (e) { /* the clip is placed; this is only a safety refresh */ }
        }
        sp.mark('refresh');
        // That refresh can land while Resolve is still loading the comp and be lost (the title then stays blank or
        // static in the viewer), so the clip is woken again once the panel has been idle for a moment.
        if (!live) settleLater(itemId, compName);

        // 5b. Highlight box (pill / box behind the emphasised word): the panel's width / height / x / y and auto
        //     balance (fusion_bridge.op_highlight_box). After the refresh, so the box renders when it is measured.
        if (req.highlight) {
            try {
                const r = await bridgeCall('highlight_box', Object.assign({ item: itemId, comp: compName }, req.highlight), 30000);
                for (const h of (r && r.highlights) || []) if (h.error || h.note) warnings.push('Highlight box: ' + (h.error || h.note));
            } catch (e) { warnings.push('Highlight box not adjusted: ' + e.message); }
            sp.mark('highlight');
        }
        // 5c. MultiText Row controls (gap between the rows, justify, per-row nudges; fusion_bridge.op_multitext_rows).
        //     Only for presets whose template has the Row controls (presetHasRowControls): with no rows asked for it
        //     fills the Inspector's pixel gaps from the layout on screen (Gap Mode Lines). A plain Text+ preset has
        //     nothing to fill, so the bridge round trip is skipped for it.
        if (req.rows || (presetTitle && presetHasRowControls(presetTitle))) {
            try {
                const r = await bridgeCall('multitext_rows', Object.assign({ item: itemId, comp: compName }, req.rows || {}), 30000);
                if (req.rows && r && r.hasControls === false) warnings.push('This preset has no Row controls (Row Gap / Justify): rows not adjusted.');
            } catch (e) { if (req.rows) warnings.push('Rows not adjusted: ' + e.message); }
            sp.mark('rows');
        }

        if (live) {
            let liveSfxId = null, liveSfxItem = null, liveSfxWhere = null;
            try {
                const r = await placeLiveSfx(tl, project, meta, sfxPath, req, anim, textStart, trackNotes, item, itemId, warnings, snap);
                if (r) { liveSfxId = r.id; liveSfxItem = r.item; liveSfxWhere = { track: r.track, start: r.start }; sfxTrack = r.track; }
                else if (req.useSfx !== false && sfxPath) warnings.push('The sound effect could not be placed.');
            } catch (e) { warnings.push('Could not place the sound: ' + e.message); }
            // unlinked while previewing, so a click on the Text+ selects only it and the Inspector shows its settings
            // the session also keeps each clip's handle and place, so ending the preview deletes by handle (live-preview.js sessionSounds)
            const sess = { itemId, compName, compPath, animId: anim.id, origTC, sfxId: liveSfxId, sfxItem: liveSfxItem, sfxWhere: liveSfxWhere, sfxPath, item,
                itemWhere: { track: vTrack, start: textStart } };
            sessionSounds(sess, [], true);
            try {
                if (req.useSfx !== false) {
                    // per-row sounds (Kinetic Cloud) repeat in the preview too, so a looped play sounds like the final clip
                    const layers = layerList(req, anim);
                    const rowFrames = await rowFramesFor(itemId, compName, layers, warnings);
                    const extra = await placeExtraSfx(tl, project, meta, layers, textStart, textStart + want, trackNotes, null, itemId, warnings, req.place, false, rowFrames, snap);
                    sessionSounds(sess, extra, true);      // ids, linked ones, row sounds (Upper / Emphasis / Lower), handles
                }
            } catch (e) { warnings.push('Could not place the layered sounds: ' + e.message); }
            state.liveSession = sess;
            try { await item.SetClipColor('Chocolate'); } catch (e) { /* the colour only marks the preview */ }
            await liveSetMarks(tl, item);
            if (!req.keepPlayhead) { try { await tl.SetCurrentTimecode(frameToTC(textStart, meta)); } catch (e) { /* ignore */ } }
            else { try { if ((await tl.GetCurrentTimecode()) !== origTC) await tl.SetCurrentTimecode(origTC); } catch (e) { /* ignore */ } }      // the preview goes where the playhead is; the playhead stays
        }
        { const w = cutCheck(live ? 'apply-live' : 'apply', cutBefore, await cutAfterP); if (w) warnings.push(w); }
        sp.mark('cutCheck');
        // 6. The animation is on the timeline: turn its subtitle clip(s) off so the plain subtitle does not show
        //    under it. Only for a real placement (a preview keeps the subtitle on); req.disableSubtitle = { start, end }.
        let subtitlesDisabled = [];
        if (!live && req.disableSubtitle) {
            try { subtitlesDisabled = await setSubtitlesEnabled(tl, req.disableSubtitle, false); }
            catch (e) { warnings.push('Could not disable the subtitle clip: ' + e.message); }
            sp.mark('disableSubs');
        }
        // (the subtitle list is not re-read here: nothing of this placement is a subtitle clip, and setSubtitlesEnabled
        // patches the cached entries it switched)
        return { ok: true, live, itemId, subtitlesDisabled, videoTrack: vTrack, audioTrack: sfxTrack, extraSfxIds, linked: clipsLinked, start: textStart, frames: finalLen, warnings, trackNotes, liveNodes };
    } catch (e) {
        return { ok: false, error: String(e && e.message || e), warnings };
    }
}

// Does the temp-clip registry hold anything (then the snapshot reads the clips' ids for the sweep)?
function regHasEntries() {
    try { return regCount() > 0; } catch (e) { return true; }
}
