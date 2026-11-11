// Pushing panel edits (transform, text design, text) onto the latest placed Text+ on the timeline.

module.exports = {
    syncLiveTransform, updateLatest
};

const path = require('path');
const fs = require('fs');

const state = require('./state');
const { ANIM_DIR } = require('./config');
const { copyFontsForSetting } = require('./fonts');
const { bridgeCall } = require('./fusion-bridge');
const { designForFusion, fusionBoxes } = require('./fusion-setting');
const { libForUI, loadLib, saveLib } = require('./library');
const { isTitleClipName } = require('./title-templates');
const { getProject, tcToFrame, timelineMeta } = require('./resolve');
const { findSelectedFusionItem } = require('./selection');
const { copySfx } = require('./sfx');
const { levelVolume } = require('./sfx-level');

async function findLatestTimelineTextItem(tl, meta) {
    try {
        const sel = (await tl.GetSelectedClips()) || [];
        for (const c of sel) {
            if ((await c.GetFusionCompCount()) > 0 && isTitleClipName(await c.GetName())) return c;
        }
        for (const c of sel) {
            if ((await c.GetFusionCompCount()) > 0) return c;
        }
    } catch (e) { /* ignore */ }

    const vCount = await tl.GetTrackCount('video');
    if (state.lastPlacedItemId) {
        for (let t = vCount; t >= 1; t--) {
            const items = (await tl.GetItemListInTrack('video', t)) || [];
            for (const it of items) {
                if (String(await it.GetUniqueId()) === String(state.lastPlacedItemId)) return it;
            }
        }
    }

    try {
        const frame = tcToFrame(await tl.GetCurrentTimecode(), meta);
        for (let t = vCount; t >= 2; t--) {
            const items = (await tl.GetItemListInTrack('video', t)) || [];
            for (const it of items) {
                const s = await it.GetStart(), e = await it.GetEnd();
                if (frame >= s && frame < e && (await it.GetFusionCompCount()) > 0) return it;
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}

async function updateLatest(event, req) {
    const lib = loadLib();
    const a = lib.animations.find(x => x.id === req.animationId);
    if (!a) return { error: 'Animation not found' };
    const allowed = ['name', 'useSfx', 'linked', 'textOffset', 'sfxOffset', 'sfxTrimIn', 'sfxLen', 'sfxLenMode', 'sfxFade', 'sfxVolume', 'tail', 'textTrack', 'sfxTrack', 'posX', 'posY', 'scale', 'rotation', 'textDesign', 'boxes', 'sfxOrig', 'sfxLayers'];
    for (const k of allowed) if (k in req && req[k] !== undefined) a[k] = req[k];
    if (req.sfxPath) {
        try {
            const f = copySfx(req.sfxPath);
            if (!a.sfxOrig) a.sfxOrig = f;
            a.sfx = f;
        } catch (e) { /* ignore */ }
    } else if (req.sfx !== undefined) {
        a.sfx = req.sfx;
    }
    if (req.sfxOrig !== undefined) a.sfxOrig = req.sfxOrig;
    saveLib(lib);

    let updatedClip = false;
    try {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (tl) {
            const meta = await timelineMeta(tl);
            const item = await findLatestTimelineTextItem(tl, meta);
            if (item) {
                const itemId = String(await item.GetUniqueId());
                const names = (await item.GetFusionCompNameList()) || [];
                const compName = names[names.length - 1] || null;
                const textArg = (req.updateText && String(req.text || '').trim()) ? String(req.text).trim() : null;
                if (Array.isArray(req.boxList) && req.boxList.length) {
                    await bridgeCall('set_boxes', { item: itemId, comp: compName, boxes: fusionBoxes(path.join(ANIM_DIR, a.file), req.boxList), textDesign: designForFusion(path.join(ANIM_DIR, a.file), a.textDesign || null) }, 4000);
                } else {
                    await bridgeCall('set_text', {
                        item: itemId,
                        comp: compName,
                        text: textArg,
                        textDesign: designForFusion(path.join(ANIM_DIR, a.file), a.textDesign || null)
                    }, 4000);
                }
                const posX = Number(a.posX) || 0;
                const posY = Number(a.posY) || 0;
                const scale = Math.max(0.01, Math.min(10, Number(a.scale) || 1));
                const rotation = Number(a.rotation) || 0;
                let pan = Number(posX) || 0;
                let tilt = Number(posY) || 0;
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
                updatedClip = true;
            }
        }
    } catch (e) { /* timeline update is best-effort */ }

    return { ok: true, lib: libForUI(), updatedClip, animName: a.name };
}

async function syncLiveTransform(event, req) {
    if (state.applying || state.liveSession) return { ok: false };      // a Resolve preview is running: only its own clip is updated
    try {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) return { ok: false };
        const meta = await timelineMeta(tl);
        const item = (await findSelectedFusionItem()) || (await findLatestTimelineTextItem(tl, meta));
        if (!item) return { ok: false };

        let pan = Number(req.posX) || 0;
        let tilt = Number(req.posY) || 0;
        if (Math.abs(pan) <= 1.0 && Math.abs(tilt) <= 1.0 && (pan !== 0 || tilt !== 0)) {
            pan = Math.round(pan * meta.width * 100) / 100;
            tilt = Math.round(-tilt * meta.height * 100) / 100;
        } else {
            pan = Math.round(pan * 1000) / 1000;
            tilt = Math.round(tilt * 1000) / 1000;
        }
        const zoom = Math.round((Number(req.scale) || 1) * 1000) / 1000;
        const rotAngle = Math.round((Number(req.rotation) || 0) * 1000) / 1000;
        await item.SetProperties({
            TransformEnabled: true,
            Pan: pan,
            Tilt: tilt,
            ZoomGang: true,
            ZoomX: zoom,
            ZoomY: zoom,
            RotationAngle: rotAngle
        });

        // Live sync Text Design & text content to timeline Fusion clip. Only the values that differ from the preset
        // file are sent (never the whole design), so the clip's keyframes and follower animation keep playing.
        let liveDesign = null, cp = null;
        if (req.textDesign) {
            const animE = req.id ? loadLib().animations.find(x => x.id === req.id) : null;
            cp = animE ? path.join(ANIM_DIR, animE.file) : null;
            liveDesign = (cp && fs.existsSync(cp)) ? designForFusion(cp, req.textDesign, undefined, true) : null;
        }
        if (liveDesign) {
            const itemId = String(await item.GetUniqueId());
            const names = (await item.GetFusionCompNameList()) || [];
            const compName = names[names.length - 1] || null;
            const textArg = (req.text && String(req.text).trim()) ? String(req.text).trim() : null;
            if (Array.isArray(req.boxList) && req.boxList.length) {
                await bridgeCall('set_boxes', {
                    item: itemId,
                    comp: compName,
                    boxes: fusionBoxes(cp, req.boxList, true),
                    textDesign: liveDesign
                }, 4000);
            } else {
                await bridgeCall('set_text', {
                    item: itemId,
                    comp: compName,
                    text: textArg,
                    textDesign: liveDesign
                }, 4000);
            }
        }

        // Live sync sound volume to timeline audio clip if present
        if (req.sfxVolume !== undefined && req.sfxVolume !== null && state.lastPlacedAudioId) {
            try {
                const project = await getProject();
                const tl = project && await project.GetCurrentTimeline();
                if (tl) {
                    const audioTracks = (await tl.GetTrackCount('audio')) || 0;
                    for (let t = 1; t <= audioTracks; t++) {
                        const aItems = (await tl.GetItemListInTrack('audio', t)) || [];
                        for (const ai of aItems) {
                            if (String(await ai.GetUniqueId()) === String(state.lastPlacedAudioId)) {
                                // peak window (sfx-level.js): the slider moves the level inside -20..-15 dBFS peak
                                let vol = Number(req.sfxVolume);
                                try {
                                    const mpi = await ai.GetMediaPoolItem();
                                    const file = mpi ? await mpi.GetClipProperty('File Path') : '';
                                    const fps = Number(await tl.GetSetting('timelineFrameRate')) || 25;
                                    vol = await levelVolume(String(file || ''), vol, Number(await ai.GetLeftOffset()) || 0, Number(await ai.GetDuration()) || 0, fps);
                                } catch (e) { /* unmeasured: the slider's value */ }
                                await ai.SetProperties({ AudioVolumeEnabled: true, AudioVolume: vol });
                                break;
                            }
                        }
                    }
                }
            } catch (e) { /* ignore */ }
        }

        if (req.textDesign) {
            const animId = req.animId;
            const a = animId ? loadLib().animations.find(x => x.id === animId) : null;
            if (a) copyFontsForSetting(path.join(ANIM_DIR, a.file), req.textDesign).catch(() => {});
        }

        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}
