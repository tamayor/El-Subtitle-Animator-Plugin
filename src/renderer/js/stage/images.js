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
    // js/workers/key-worker.js holds the same pixel loops as keyedImage / keyMatteRegion below. The frame goes to a
    // worker as an ImageBitmap (no pixel copy on this thread), comes back as RGBA bytes and is turned into an
    // ImageBitmap here, which the card preview draws like a canvas (and closes when the render is replaced).
    const N = 2;
    let workers = null, next = 0, seq = 1;
    const pending = new Map();
    function boot() {
        if (workers !== null) return;
        try {
            if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') { workers = false; return; }
            workers = [];
            for (let i = 0; i < N; i++) {
                const w = new Worker('./js/workers/key-worker.js');
                w.onmessage = (e) => {
                    const m = e.data || {};
                    const p = pending.get(m.id);
                    if (!p) return;
                    pending.delete(m.id);
                    if (m.error || !m.data) { p.resolve(null); return; }
                    try {
                        const img = new ImageData(new Uint8ClampedArray(m.data), m.w, m.h);
                        createImageBitmap(img).then(bitmap => p.resolve({ bitmap, bounds: m.bounds }), () => p.resolve(null));
                    } catch (err) { p.resolve(null); }
                };
                w.onerror = () => { for (const p of pending.values()) p.resolve(null); pending.clear(); };
                workers.push(w);
            }
        } catch (e) { workers = false; }
    }
    function available() { boot(); return Array.isArray(workers) && workers.length > 0; }
    async function key(im, white, bg) {
        if (!available() || !im || !im.naturalWidth) return null;
        try {
            const [bm, wb] = await Promise.all([createImageBitmap(im), white ? createImageBitmap(white) : null]);
            const id = seq++;
            const w = workers[next++ % workers.length];
            return await new Promise((resolve) => {
                pending.set(id, { resolve });
                const transfer = wb ? [bm, wb] : [bm];
                w.postMessage({ id, bitmap: bm, white: wb, whiteBg: bg === 'white' }, transfer);
                setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, 20000);
            });
        } catch (e) { return null; }
    }
    return { key, available };
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
    if (keyMatte(im, og, oc, w, h)) { im._keyed = oc; im._kbounds = oc._bounds; return oc; }
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

// Exact transparency from the black + white render pair (preview.matte): a = 1 - (W-B)/255, C = B/a.
// Works for any colour (black text, white text, red on white...), so nothing depends on the card background.
// Keys region (sx, sy, sw, sh) of im into a canvas of that size, or returns null when there is no usable white pass.
function keyMatteRegion(im, sx, sy, sw, sh) {
    const wi = im._white;
    if (!wi || !wi.complete || wi.naturalWidth !== im.naturalWidth || wi.naturalHeight !== im.naturalHeight) return null;
    try {
        const oc = document.createElement('canvas'); oc.width = sw; oc.height = sh;
        const og = oc.getContext('2d'); og.drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
        const wc = document.createElement('canvas'); wc.width = sw; wc.height = sh;
        const wg = wc.getContext('2d'); wg.drawImage(wi, sx, sy, sw, sh, 0, 0, sw, sh);
        const wd = wg.getImageData(0, 0, sw, sh).data;
        const id = og.getImageData(0, 0, sw, sh);
        const d = id.data;
        let minX = sw, minY = sh, maxX = 0, maxY = 0, found = false, x = 0, y = 0;
        for (let p = 0; p < d.length; p += 4) {
            let a = 255 - ((wd[p] - d[p]) + (wd[p + 1] - d[p + 1]) + (wd[p + 2] - d[p + 2])) / 3;
            a = a < 0 ? 0 : (a > 255 ? 255 : a);
            if (a <= 3) { d[p + 3] = 0; }
            else {
                const k = 255 / a;
                d[p] = Math.min(255, d[p] * k); d[p + 1] = Math.min(255, d[p + 1] * k); d[p + 2] = Math.min(255, d[p + 2] * k);
                d[p + 3] = a;
                if (a > 24) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    found = true;
                }
            }
            if (++x === sw) { x = 0; y++; }
        }
        og.putImageData(id, 0, 0);
        oc._bounds = found
            ? { x: minX / sw, y: minY / sh, w: Math.max(0.08, (maxX - minX) / sw), h: Math.max(0.05, (maxY - minY) / sh) }
            : { x: 0.2, y: 0.4, w: 0.6, h: 0.2 };
        return oc;
    } catch (e) { return null; }
}
function keyMatte(im, og, oc, w, h) {
    const r = keyMatteRegion(im, 0, 0, w, h);
    if (!r) return false;
    og.clearRect(0, 0, w, h); og.drawImage(r, 0, 0);
    oc._bounds = r._bounds;
    return true;
}

// The keyed (transparent) text crop a preview card draws: only the crop is keyed and kept, so every frame of every
// card can stay cached without holding full-size keyed copies in memory.
function keyedCrop(im, x0, y0, w, h) {
    const sx = Math.round(x0), sy = Math.round(y0), sw = Math.max(1, Math.round(w)), sh = Math.max(1, Math.round(h));
    const key = sx + ',' + sy + ',' + sw + ',' + sh;
    if (im._crop && im._crop.key === key) return im._crop.cv;
    let cv = keyMatteRegion(im, sx, sy, sw, sh);
    if (!cv) {
        const full = keyedImage(im);
        cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
        cv.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
    }
    im._crop = { key, cv };
    return cv;
}

// Neutral transparency checkerboard behind preview frames, so black and white text both stay readable.
function paintChecker(c, w, h) {
    const size = Math.max(6, Math.round(Math.min(w, h) / 14));
    c.fillStyle = '#2a2d2b';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#3c403d';
    for (let y = 0, r = 0; y < h; y += size, r++) {
        for (let x = (r % 2) * size; x < w; x += size * 2) c.fillRect(x, y, size, size);
    }
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
