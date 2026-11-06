// CTX: the Use (U) and Create (C) contexts the shared blocks are mounted in, and syncing their models.

const CTX = {
    U: {
        s: 'U', scale: null,
        model: () => state.use,
        changed: (m) => {
            if (state.use) {
                state.use.dirty = true;
                state.use.adjusted = true;
            }
            if (m) {
                m.adjusted = true;
                const patch = {
                    posX: Number(m.posX) || 0,
                    posY: Number(m.posY) || 0,
                    scale: Number(m.scale) || 1,
                    rotation: Number(m.rotation) || 0,
                    linked: m.linked !== false,
                    boxes: m.boxes || {}
                };
                // Use tab = one-time override: nothing is written to the preset's saved default.
                void patch;
                syncVarButtons('U', m);
            }
            renderUseSummary();
        }
    },
    C: {
        s: 'C', scale: null,
        model: () => libEntry(state.createId),
        changed: (m) => {
            state.createAdjusted = true;
            if (m) {
                m.adjusted = true;
                syncVarButtons('C', m);
            }
            saveField(m.id, {
                textOffset: m.textOffset, sfxOffset: m.sfxOffset, sfxTrimIn: m.sfxTrimIn || 0, sfxLen: m.sfxLen === undefined ? null : m.sfxLen, sfxLenMode: sfxLenMode(m), sfxFade: m.sfxFade === undefined ? null : m.sfxFade, tail: m.tail, linked: m.linked !== false,
                sfxVolume: m.sfxVolume, useSfx: m.useSfx !== false, textTrack: m.textTrack, sfxTrack: m.sfxTrack,
                posX: Number(m.posX) || 0, posY: Number(m.posY) || 0,
                scale: Number(m.scale) || 1, rotation: Number(m.rotation) || 0,
                textDesign: m.textDesign, boxes: m.boxes || {}
            });
        }
    }
};

function ctxVisible(ctx) {
    if (ctx.s === 'U') return state.tab === 'apply' && state.adjustOpen && !!state.use;
    return state.tab === 'library' && state.createAdjustOpen !== false && !!libEntry(state.createId);
}

function renderTimelines() {
    for (const c of [CTX.U, CTX.C]) if (ctxVisible(c)) renderTimeline(c);
}

// Renders trimmed & faded PCM 16-bit WAV audio data based on the preserved original sound.
async function renderTrimmedWav(m, span) {
    const p = origSfxPath(m) || currentSfxPath(m);
    if (!p || m.useSfx === false) return null;
    const bytes = await window.sa.readSfx(p);
    if (!(bytes instanceof Uint8Array)) return null;
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    let buf;
    try { buf = await ac.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); } finally { ac.close(); }
    let g;
    waveSecOverride = buf.duration;
    if (span) spanOverride = span;
    try { g = geometry(m); } finally { waveSecOverride = null; spanOverride = null; }
    const sr = buf.sampleRate, ch = Math.min(2, buf.numberOfChannels);
    const startSec = Math.min(g.sfxTrimIn / g.fps, Math.max(0, buf.duration - 2 / g.fps));
    const lenSec = Math.max(2 / g.fps, Math.min(g.sfxFrames / g.fps, buf.duration - startSec));
    const i0 = Math.round(startSec * sr);
    const n = Math.max(1, Math.round(lenSec * sr));
    const fadeN = Math.min(n, Math.round(g.fadeFrames / g.fps * sr));
    const data = new Uint8Array(44 + n * ch * 2);
    const dv = new DataView(data.buffer);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
    for (let c = 0; c < ch; c++) {
        const src = buf.getChannelData(c);
        for (let i = 0; i < n; i++) {
            let v = (i0 + i) < src.length ? src[i0 + i] : 0;
            if (fadeN > 0 && i >= n - fadeN) v *= (n - i) / fadeN;
            v = Math.max(-1, Math.min(1, v));
            dv.setInt16(44 + (i * ch + c) * 2, v < 0 ? v * 32768 : v * 32767, true);
        }
    }
    return { data, origPath: p, g };
}

let syncSfxBusy = false;
async function syncAttachedSfx(m, span) {
    if (!m || !m.id || m.useSfx === false) return null;
    if (syncSfxBusy) return null;
    syncSfxBusy = true;
    try {
        // The cut lives in the preset's settings (saved with it); the sound stays the original file, so nothing is
        // rendered here. Only a preset still pointing at an edited clip from an older version is switched back.
        if (!m.sfx || (m.sfxOrig && m.sfx === m.sfxOrig)) return null;
        const res = await window.sa.useOriginalSfx(m.id);
        if (res && res.changed && res.sfx) {
            m.sfx = res.sfx;
            m.sfxPath = res.sfxPath;
            if (res.sfxOrig) {
                m.sfxOrig = res.sfxOrig;
                m.sfxOrigPath = res.sfxOrigPath;
            }
            if (res.lib) {
                state.lib = res.lib;
            }
        }
        return res;
    } catch (e) {
        return null;
    } finally {
        syncSfxBusy = false;
    }
}

// The Use tab works on a copy, so changes there never touch the saved default.
function syncUse(force) {
    const a = selected();
    if (!a) { state.use = null; return; }
    if (force || !state.use || state.use.id !== a.id || !state.use.dirty) {
        // A refresh of the same preset keeps the one-time subtitle render, so it is not rendered again.
        const keepRender = (!force && state.use && state.use.id === a.id) ? state.use : null;
        state.use = {
            id: a.id, name: a.name, dirty: false, adjusted: false, designDirty: false,
            textOffset: a.textOffset, sfxOffset: a.sfxOffset, tail: a.tail, linked: a.linked !== false,
            sfxTrimIn: a.sfxTrimIn, sfxLen: a.sfxLen, sfxLenMode: a.sfxLenMode, sfxFade: a.sfxFade,
            sfxVolume: a.sfxVolume, useSfx: a.useSfx !== false, textTrack: a.textTrack, sfxTrack: a.sfxTrack,
            posX: Number(a.posX) || 0, posY: Number(a.posY) || 0,
            scale: Number(a.scale) || 1, rotation: Number(a.rotation) || 0,
            textDesign: (keepRender && keepRender.designRev > 0 && keepRender.textDesign) ? keepRender.textDesign : cloneTextDesign(a.textDesign),
            boxes: window.SABoxes ? SABoxes.cloneBoxes(a) : {},
            sfx: a.sfx,
            sfxPath: a.sfxPath,
            sfxOrig: a.sfxOrig,
            sfxOrigPath: a.sfxOrigPath,
            sfxLayers: Array.isArray(a.sfxLayers) ? JSON.parse(JSON.stringify(a.sfxLayers)) : []
        };
        if (keepRender) {
            state.use.tempPreview = keepRender.tempPreview;
            state.use.renderReq = keepRender.renderReq;
            state.use.rendering = keepRender.rendering;
            state.use.designRev = keepRender.designRev || 0;
            state.use._shown = keepRender._shown;
            state.use._viewCache = keepRender._viewCache;
        }
    } else {
        // Keep the one-time Use tab values as they are.
        if (!state.use.textDesign) state.use.textDesign = cloneTextDesign(a.textDesign);
    }
}

const saveField = debounce(async (id, patch) => {
    const m = libEntry(id);
    if (m && m.useSfx !== false && (m.sfx || m.sfxOrig)) {
        await syncAttachedSfx(m);
        if (m.sfx) patch.sfx = m.sfx;
        if (m.sfxOrig) patch.sfxOrig = m.sfxOrig;
    }
    const res = await window.sa.updateAnimation(id, patch);
    // Do not swap the data under a drag in progress; the saved values are already what the user sees.
    if (res && res.lib && !state.drag && !state.stageDrag) {
        state.lib = res.lib;
        syncUse(false);
        if (state.createAdjusted && state.createId) {
            const ca = libEntry(state.createId);
            if (ca) { ca.adjusted = true; syncVarButtons('C', ca); }
        }
    }
}, 250);
