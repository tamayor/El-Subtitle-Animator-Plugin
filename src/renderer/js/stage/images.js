// Preview stage images: frame caches, keyed (transparent) frames and transform helpers.

// ---------------------------------------------------------------- preview (live timeline frame + overlay + placement)
const imgCache = new Map();

function redrawStages() {
    // The big stage canvas is gone (playback is native in Resolve); what is left in the app is the scrub preview.
    // It needs the preset rendered with the real subtitle, so that render is requested from here.
    try { if (state.tab === 'apply' && state.use && selected()) ensureUsePreview(selected()); } catch (e) { /* ignore */ }
    for (const S of ['U', 'C']) {
        const sc = state.scrub && state.scrub[S];
        const ctx = CTX[S];
        if (!sc || !sc.on || !ctx || !ctxVisible(ctx) || !ctx.model()) continue;
        scrubDraw(ctx, sc.f || 0);
    }
}

async function refreshLiveBg() {
    // Background frame fetching removed; preview is native on the Resolve timeline
}

function previewImages(a) {
    if (!a || !a.preview || !a.previewFiles || !a.previewFiles.length) return null;
    const key = a.id + ':' + a.preview.count + ':' + (a.preview.stamp || 0);
    let list = imgCache.get(key);
    if (!list) {
        // Held frames share one image (each distinct picture is decoded once). Matte renders are on black.
        const map = (Array.isArray(a.preview.map) && a.preview.map.length === a.previewFiles.length) ? a.preview.map : null;
        const one = new Map();
        list = a.previewFiles.map((p, n) => {
            const k = map ? map[n] : n;
            if (one.has(k)) return one.get(k);
            const i = new Image(); i._bg = a.preview.matte ? 'black' : (a.preview.bg || 'black');
            i.src = fileUrl(a.previewFiles[k] || p) + '?v=' + (a.preview.stamp || 0);
            one.set(k, i);
            return i;
        });
        imgCache.set(key, list);
        while (imgCache.size > 12) imgCache.delete(imgCache.keys().next().value);   // old renders are let go
    }
    return list;
}

// Background keying: preview frames are turned into transparent images on worker threads (one per spare CPU core),
// never on the panel's own thread, so playback and dragging stay smooth while a new render comes in.
// Frames rendered on black AND white (preview.matte) get their exact colour and transparency:
//   on black  B = a*C,   on white  W = a*C + (1-a)*255   ->   a = 1 - (W-B)/255,  C = B/a
// which is right for any colour, gradient, soft shadow or semi-transparent element. Older single-pass frames
// fall back to keying out the background colour they were rendered on.
const SAKey = (() => {
    return {
        key: async () => null,
        available: () => false
    };
})();

// Keys out the black (0,0,0) background of exported Text+ preview frames so they overlay cleanly on live video.
const keyedLRU = [];
function keyedBounds(im) {
    return im._kbounds || keyedImage(im)._bounds;
}
function keyedImage(im) {
    if (im._keyed) return im._keyed;
    keyedLRU.push(im);
    if (keyedLRU.length > 120) { const old = keyedLRU.shift(); if (old && old !== im) old._keyed = null; }
    const w = im.naturalWidth, h = im.naturalHeight;
    const oc = document.createElement('canvas');
    oc.width = w; oc.height = h;
    const og = oc.getContext('2d');
    og.drawImage(im, 0, 0);
    const whiteBg = im._bg === 'white';
    try {
        const id = og.getImageData(0, 0, w, h);
        const d = id.data;
        let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
        const len = d.length;
        let x = 0, y = 0;
        for (let p = 0; p < len; p += 4) {
            const cr = d[p], cg = d[p + 1], cb = d[p + 2];
            // distance from the background the frame was rendered on: black (brightest channel) or white (darkest)
            const m = whiteBg
                ? 255 - ((cr < cg) ? (cr < cb ? cr : cb) : (cg < cb ? cg : cb))
                : ((cr > cg) ? (cr > cb ? cr : cb) : (cg > cb ? cg : cb));
            if (m <= 4) {
                d[p + 3] = 0;
            } else {
                if (m < 28) d[p + 3] = (((m - 4) * d[p + 3]) / 24) | 0;
                if (m > 12) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    found = true;
                }
            }
            if (++x === w) { x = 0; y++; }
        }
        og.putImageData(id, 0, 0);
        oc._bounds = found
            ? { x: minX / w, y: minY / h, w: Math.max(0.08, (maxX - minX) / w), h: Math.max(0.05, (maxY - minY) / h) }
            : { x: 0.2, y: 0.4, w: 0.6, h: 0.2 };
    } catch (e) {
        oc._bounds = { x: 0.2, y: 0.4, w: 0.6, h: 0.2 };
    }
    im._keyed = oc;
    im._kbounds = oc._bounds;
    return oc;
}

function syncXformUI(S, posX, posY, scale, rotation) {
    const pxEl = $('posX' + S);
    const pyEl = $('posY' + S);
    const scEl = $('scale' + S);
    const rotEl = $('rot' + S);
    const numPxEl = $('numPosX' + S);
    const numPyEl = $('numPosY' + S);
    const numScEl = $('numScale' + S);
    const numRotEl = $('numRot' + S);
    if (!pxEl && !numPxEl) return;

    const bg = state.liveBg && state.liveBg.img;
    let tlW = (state.liveBg && state.liveBg.width) || 1920;
    let tlH = (state.liveBg && state.liveBg.height) || 1080;
    if (bg && bg.complete && bg.naturalWidth && bg.naturalHeight) {
        const bgAr = bg.naturalWidth / bg.naturalHeight;
        if (Math.abs(bgAr - (tlW / tlH)) > 0.05) {
            tlW = bg.naturalWidth;
            tlH = bg.naturalHeight;
        }
    }

    let px = Number(posX) || 0;
    let py = Number(posY) || 0;
    if (Math.abs(px) <= 1.0 && Math.abs(py) <= 1.0 && (px !== 0 || py !== 0)) {
        px = Math.round(px * tlW * 10) / 10;
        py = Math.round(-py * tlH * 10) / 10;
    }
    const sc = Number(scale) || 1.0;
    const rot = Number(rotation) || 0;

    const maxPan = Math.round(tlW / 2);
    const maxTilt = Math.round(tlH / 2);

    if (pxEl) {
        pxEl.min = -maxPan;
        pxEl.max = maxPan;
        if (document.activeElement !== pxEl) pxEl.value = clamp(px, -maxPan, maxPan);
    }
    if (pyEl) {
        pyEl.min = -maxTilt;
        pyEl.max = maxTilt;
        if (document.activeElement !== pyEl) pyEl.value = clamp(py, -maxTilt, maxTilt);
    }
    if (scEl && document.activeElement !== scEl) scEl.value = clamp(sc, 0.05, 4.0);
    if (rotEl && document.activeElement !== rotEl) rotEl.value = clamp(rot, -180, 180);

    if (numPxEl && document.activeElement !== numPxEl) numPxEl.value = px.toFixed(3);
    if (numPyEl && document.activeElement !== numPyEl) numPyEl.value = py.toFixed(3);
    if (numScEl && document.activeElement !== numScEl) numScEl.value = sc.toFixed(3);
    if (numRotEl && document.activeElement !== numRotEl) numRotEl.value = rot.toFixed(3);

    const isZoomOn = !!(state.zoomEnabled && state.zoomEnabled[S]);
    const zoomVal = (state.stageZoom && state.stageZoom[S]) || 1.0;
    const zoomBtn = $('zoomToggle' + S);
    const zoomLbl = $('zoomLbl' + S);
    if (zoomBtn) {
        zoomBtn.classList.toggle('on', isZoomOn);
        zoomBtn.title = isZoomOn
            ? `Preview zoom ON (${Math.round(zoomVal * 100)}%) — click to disable scroll-wheel zoom`
            : `Preview zoom disabled — click to enable scroll-wheel zoom`;
    }
    if (zoomLbl) {
        zoomLbl.textContent = isZoomOn ? `Zoom (${Math.round(zoomVal * 100)}%)` : 'Zoom';
    }

    const liveSyncBtn = $('liveSyncToggle' + S);
    if (liveSyncBtn) {
        const isLiveOn = !!(state.liveSyncEnabled && state.liveSyncEnabled[S]);
        liveSyncBtn.classList.toggle('on', isLiveOn);
        liveSyncBtn.title = isLiveOn
            ? 'Live Sync is ON: subtitle moves on DaVinci Resolve viewer in real-time as you drag'
            : 'Live Sync is OFF: click to sync transform to DaVinci Resolve timeline in real-time';
    }
}

function evalSpline(keys, f, defVal) {
    if (!Array.isArray(keys) || !keys.length) return defVal;
    if (f <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
        const [f0, v0] = keys[i], [f1, v1] = keys[i + 1];
        if (f <= f1) {
            const t = f1 > f0 ? (f - f0) / (f1 - f0) : 1;
            return v0 + (v1 - v0) * t;
        }
    }
    return keys[keys.length - 1][1];
}

// Built-in pop-in used when a preset has no size keys of its own: grows past full size, then settles (about 8 frames).
function introPop(idx) {
    const t = clamp(idx / 8, 0, 1);
    const c1 = 1.70158, c3 = c1 + 1;
    const e = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    return Math.max(0.05, 0.6 + 0.4 * e);
}

function wrapToLines(text) {
    if (!text) return [];
    return String(text).split(/\r?\n/).filter(Boolean);
}
