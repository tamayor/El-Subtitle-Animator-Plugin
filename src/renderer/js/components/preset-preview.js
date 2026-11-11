// Preset card previews (window.SAThumbs) and the reusable preview component (window.SAPreview).
// Moved here unchanged from textboxes.js; the protected block below is byte-for-byte identical.

// ================================================================================================================
// 🔒 PROTECTED — PRESET CARD PREVIEW (FINALIZED & VERIFIED ACCURATE). AI AGENTS / ASSISTANTS: DO NOT MODIFY. 🔒
//
// This section (from here to the matching "END PROTECTED" marker below) plays the real Resolve/Fusion frames of each
// preset on its gallery card. It is correct as it stands: frames are shown 1:1 at the speed they were captured at.
//   - Do NOT re-time, re-scale, compress, re-order, "optimise" or refactor frames(), prepare(), geometry(), draw()
//     or frameIndex().
//   - draw() and frameIndex() are the stable version from commit 122295f (restored at the user's request): frames
//     play 1x at the timeline fps over a 3-second window, and cards show cardView() (the subtitle render once in).
//   - Do NOT make drawSynthetic() win over real Fusion frames.
//   - Card background is a neutral checkerboard (paintChecker) behind the matte-keyed text crop (keyedCrop), never
//     solid black/white — approved by the user so dark and light text both read.
//   - The alignment-timeline scrub viewer draws through SAPreview (below), which reuses these exact functions.
// If a card ever looks wrong, tell the user and ask before touching anything here. The user must explicitly approve
// any change to this block. Unrelated edits elsewhere in this file are fine.
// ================================================================================================================
(function () {
    'use strict';
    const LOOP_MS = 3000;
    const busy = new Set();            // preset ids being rendered right now
    const failed = new Map();          // preset id -> why its preview could not be rendered
    let batch = null;                  // { done, total } while "Make previews" runs
    const geoCache = new Map();

    const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const isDefaultBounds = (b) => b && Math.abs(b.x - 0.2) < 1e-6 && Math.abs(b.y - 0.4) < 1e-6 && Math.abs(b.w - 0.6) < 1e-6 && Math.abs(b.h - 0.2) < 1e-6;

    // Preview frames loaded directly from file URLs (or through previewFrames cache), avoiding heavy base64 IPC.
    const dataCache = new Map();
    function frames(a) {
        if (!a || !a.preview) return null;
        if (typeof previewFrames === 'function') {
            const list = previewFrames(a);
            if (list && list.length) return list;
        }
        const key = a.id + ':' + (a.preview.stamp || 0) + ':' + a.preview.count;
        let e = dataCache.get(key);
        // least-recently-used: a hit moves to the back, so frames in use (every card, the scrub viewer) are never evicted
        if (e) { dataCache.delete(key); dataCache.set(key, e); }
        if (!e) {
            e = { imgs: null };
            dataCache.set(key, e);
            trimCache(key);
            if (a.previewFiles && a.previewFiles.length) {
                // Held frames (Stop Motion, still tails) point at the frame they hold: each distinct picture is
                // loaded and keyed once, however many frames show it.
                const map = (Array.isArray(a.preview.map) && a.preview.map.length === a.previewFiles.length) ? a.preview.map : null;
                const whites = (a.preview.matte && Array.isArray(a.previewWhite) && a.previewWhite.length === a.previewFiles.length) ? a.previewWhite : null;
                const url = (p) => (typeof fileUrl === 'function' ? fileUrl(p) : ('file://' + p)) + '?v=' + (a.preview.stamp || 0);
                const byIdx = new Map();
                e.imgs = a.previewFiles.map((p, i) => {
                    const k = map ? map[i] : i;
                    if (byIdx.has(k)) return byIdx.get(k);
                    const im = new Image();
                    im._bg = whites ? 'black' : (a.preview.bg || 'black');
                    im.src = url(a.previewFiles[k] || p);
                    if (whites) { const wi = new Image(); wi.src = url(whites[i]); im._white = wi; }
                    byIdx.set(k, im);
                    return im;
                });
                e.imgs._cardBg = a.preview.bg || 'black';
                prepare(e.imgs, Array.from(byIdx.values()));
            } else if (window.sa && window.sa.previewData) {
                window.sa.previewData(a.id).then((r) => {
                    if (r && r.frames && r.frames.length) {
                        const list = r.frames.map((b64) => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; return i; });
                        prepare(list, list);
                        e.imgs = list;
                    }
                }).catch(() => { dataCache.delete(key); });
            }
        }
        return e.imgs;
    }

    // Keeps the last few renders in memory; older ones release their keyed images.
    function trimCache(keep) {
        // Room for every preset's card plus the subtitle renders: a smaller cache made the cards and the scrub viewer
        // evict each other on every redraw, so frames were loaded again and again ("Loading frames…").
        const nLib = (typeof state !== 'undefined' && state.lib && state.lib.animations) ? state.lib.animations.length : 0;
        const MAX = Math.max(24, nLib + 8);
        if (dataCache.size <= MAX) return;
        for (const [k, v] of dataCache) {
            if (dataCache.size <= MAX) break;
            if (k === keep) continue;
            dataCache.delete(k);
            if (v && v.imgs) for (const im of (v.imgs._unique || v.imgs)) { try { if (im._keyed && im._keyed.close) im._keyed.close(); } catch (e) { /* ignore */ } im._keyed = null; }
        }
    }

    // Loads every distinct frame, keys it on a worker, and only then marks the set ready, so a new render replaces
    // the old one in a single step (the old one keeps playing until then).
    function prepare(list, unique) {
        list._unique = unique;
        list._ready = false;
        const loaded = (im) => (im.decode ? im.decode() : new Promise((res, rej) => { im.onload = res; im.onerror = rej; })).catch(() => null);
        Promise.all(unique.map(im => Promise.all([loaded(im), im._white ? loaded(im._white) : null]))).then(async () => {
            const useWorkers = typeof SAKey !== 'undefined' && SAKey.available();
            if (useWorkers) {
                await Promise.all(unique.map(async (im) => {
                    if (!im.naturalWidth) return;
                    const white = (im._white && im._white.naturalWidth) ? im._white : null;
                    const r = await SAKey.key(im, white, im._bg);
                    if (r) { r.bitmap._bounds = r.bounds; im._keyed = r.bitmap; im._kbounds = r.bounds; }
                }));
            }
            list._ready = true;
            if (typeof redrawStages === 'function') redrawStages();
        });
    }

    function framesReady(imgs) {
        if (!imgs || !imgs.length) return false;
        if (imgs._ready === false) return false;
        return (imgs._unique || imgs).every(i => i.complete && i.naturalWidth);
    }

    // Scan captured frames (sampled across the animation for speed) to compute the text bounding box.
    function geometry(a, imgs) {
        const key = a.id + ':' + (a.preview && a.preview.stamp) + ':' + imgs.length;
        let g = geoCache.get(key);
        if (g) return g;
        let minX = 1, minY = 1, maxX = 0, maxY = 0, any = false;
        const step = Math.max(1, Math.floor(imgs.length / 12));
        for (let i = 0; i < imgs.length; i += step) {
            const im = imgs[i];
            const b = (typeof keyedBounds === 'function' ? keyedBounds(im) : keyedImage(im)._bounds);   // where the text pixels are
            if (!b || isDefaultBounds(b)) continue;
            any = true;
            minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
        }
        if (imgs.length > 1) {
            const lastIm = imgs[imgs.length - 1];
            const b = (typeof keyedBounds === 'function' ? keyedBounds(lastIm) : keyedImage(lastIm)._bounds);
            if (b && !isDefaultBounds(b)) {
                any = true;
                minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
            }
        }
        if (!any) { minX = 0.25; minY = 0.42; maxX = 0.75; maxY = 0.58; }
        const W = imgs[0].naturalWidth, H = imgs[0].naturalHeight;
        const bw = (maxX - minX) * W, bh = (maxY - minY) * H;
        const px = Math.max(3, bw * 0.05), py = Math.max(3, bh * 0.1);
        const x0 = clampN(minX * W - px, 0, W - 4), y0 = clampN(minY * H - py, 0, H - 4);
        const x1 = clampN(maxX * W + px, x0 + 4, W), y1 = clampN(maxY * H + py, y0 + 4, H);
        g = { x0, y0, rw: x1 - x0, rh: y1 - y0, nb: { x0: minX, y0: minY, x1: maxX, y1: maxY }, blank: !any };
        geoCache.set(key, g);
        return g;
    }

    function activeSubtitleText() {
        const el = document.getElementById('subText');
        const v = el ? el.value.trim() : '';
        return v || (typeof state !== 'undefined' && state.live && state.live.subtitle && state.live.subtitle.text && state.live.subtitle.text.trim()) || '';
    }

    function draw(cv, t) {
        const a = libEntry(cv.dataset.id);
        if (!a) return;
        const sub = activeSubtitleText();
        // The card shows the same render as the viewer: your subtitle (and, for the selected preset, your Use tab
        // changes) once it has been rendered, the preset's own sample render until then.
        const view = (typeof cardView === 'function') ? cardView(a) : a;
        const imgs = frames(view);
        // Real Fusion frames always win: they are the preset's own nodes and keyframes, never re-animated here.
        if (!framesReady(imgs) || geometry(view, imgs).blank) {
            drawSynthetic(cv, a, t, sub);
            return;
        }
        const g = geometry(view, imgs);
        const idx = holdIndex(view, imgs, frameIndex(view, imgs, t));
        const c = cv.getContext('2d');
        // Neutral checkerboard (not black or white) behind the keyed frame, so dark and light text both read.
        paintChecker(c, cv.width, cv.height);
        const scale = Math.min((cv.width - 14) / g.rw, (cv.height - 10) / g.rh, 3);
        const dw = g.rw * scale, dh = g.rh * scale;
        c.imageSmoothingQuality = 'high';
        const src = keyedCrop(imgs[idx], g.x0, g.y0, g.rw, g.rh);
        c.drawImage(src, 0, 0, src.width, src.height, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
    }

    // Restored from the stable version (commit 122295f) at the user's request.
    function frameIndex(a, imgs, t) {
        const total = imgs ? imgs.length : 0;
        if (total <= 1) return 0;
        const fps = (typeof fpsNow === 'function' ? fpsNow() : 25) || 25;
        // 1x real-time playback: calculate the real timeline frame over the 3-second window
        const elapsedMs = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS;
        const f = Math.floor((elapsedMs / 1000) * fps);
        // Cut at first 3 seconds: do not compress. If animation is longer, cut after 3s; if shorter, hold last frame.
        return Math.min(total - 1, f);
    }

    // ===== END PROTECTED: preset card preview playback (frames / prepare / geometry / draw / frameIndex) =====

    // The 3-second capture keeps running after the text clip ends, so its last frames can be empty (black).
    // Frames after the last one that shows text hold that frame instead: the subtitle stays on screen.
    // Found once per render (scanning back from the end on a small copy) and cached.
    const holdCache = new Map();
    function lastContentFrame(imgs) {
        const W = imgs[0].naturalWidth || 1, H = imgs[0].naturalHeight || 1;
        const w = 96, h = Math.max(1, Math.round(w * H / W));
        const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
        const g = oc.getContext('2d', { willReadFrequently: true });
        for (let i = imgs.length - 1; i >= 0; i--) {
            const im = imgs[i];
            if (!im || !im.naturalWidth) continue;
            const onWhite = im._bg === 'white';
            g.fillStyle = onWhite ? '#fff' : '#000'; g.fillRect(0, 0, w, h);
            try { g.drawImage(im, 0, 0, w, h); } catch (e) { return -1; }
            let d;
            try { d = g.getImageData(0, 0, w, h).data; } catch (e) { return -1; }
            for (let p = 0; p < d.length; p += 4) {
                const hit = onWhite ? (d[p] < 231 || d[p + 1] < 231 || d[p + 2] < 231) : (d[p] > 24 || d[p + 1] > 24 || d[p + 2] > 24);
                if (hit) return i;
            }
        }
        return -1;
    }
    function holdIndex(view, imgs, idx) {
        if (!imgs || imgs.length < 2) return idx;
        const key = (view && view.id) + ':' + (view && view.preview && view.preview.stamp) + ':' + imgs.length;
        let last = holdCache.get(key);
        if (last === undefined) {
            last = lastContentFrame(imgs);
            holdCache.set(key, last);
            if (holdCache.size > 96) holdCache.delete(holdCache.keys().next().value);
        }
        return (last >= 0 && idx > last) ? last : idx;
    }

    // ============================================================================================================
    // SAPreview — the preset-card preview as one reusable component.
    // It draws a preset's real Resolve frames with exactly the card's look (the same frames() cache, the same text
    // crop from geometry(), the same background and the same fit), at any canvas size: at the card's own size
    // (208 x 116) the result is identical to draw() above, bigger canvases are the same picture scaled up.
    // It only READS the protected helpers above; it never changes how the cards play.
    //   loop  mode: plays the capture on repeat with the cards' 3-second timing (frameIndex / LOOP_MS)
    //   scrub mode: shows the one captured frame the caller asks for (the alignment timeline playhead)
    // ============================================================================================================
    const CARD_W = 208, CARD_H = 116;

    // 'none' (no frames yet) | 'loading' | 'broken' (a file can't be read) | 'blank' (render holds no text) | 'ready'
    function pvStatus(view) {
        if (!view || !view.preview || !view.previewFiles || !view.previewFiles.length) return 'none';
        const imgs = frames(view);
        if (!imgs || !imgs.length) return 'loading';
        if ((imgs._unique || imgs).some(i => i.complete && !i.naturalWidth)) return 'broken';
        if (!framesReady(imgs)) return 'loading';
        return geometry(view, imgs).blank ? 'blank' : 'ready';
    }
    function pvCount(view) { const imgs = view && frames(view); return imgs ? imgs.length : 0; }
    // Which captured frame the cards show at clock time ms (holds the last frame until the 3 s loop restarts).
    function pvLoopIndex(view, ms) { const imgs = frames(view); return imgs ? frameIndex(view, imgs, ms) : 0; }

    // Paints captured frame idx of view onto cv. Returns true when a real frame was drawn.
    function pvPaint(cv, view, idx) {
        if (pvStatus(view) !== 'ready') return false;
        const imgs = frames(view);
        const i = holdIndex(view, imgs, clampN(Math.floor(idx) || 0, 0, imgs.length - 1));
        const g = geometry(view, imgs);
        const c = cv.getContext('2d');
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.filter = 'none';
        paintChecker(c, cv.width, cv.height);
        const k = cv.width / CARD_W;                       // margins and zoom cap scale with the canvas, as on a card
        const scale = Math.min((cv.width - 14 * k) / g.rw, (cv.height - 10 * k) / g.rh, 3 * k);
        const dw = g.rw * scale, dh = g.rh * scale;
        c.imageSmoothingQuality = 'high';
        const src = keyedCrop(imgs[i], g.x0, g.y0, g.rw, g.rh);
        try { c.drawImage(src, 0, 0, src.width, src.height, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh); } catch (e) { return false; }
        return true;
    }
    // The built-in animation the cards fall back to while there are no real frames.
    function pvPaintOwn(cv, a, ms) { drawSynthetic(cv, a, ms, '', true); }

    // Gives the canvas the card's shape at its on-screen width (Retina included). Returns true when it was resized.
    function pvFit(cv, maxCss) {
        const dpr = window.devicePixelRatio || 1;
        const cssW = Math.min(cv.clientWidth || CARD_W, maxCss || 1e9);
        const W = Math.max(CARD_W, Math.round(cssW * dpr)), H = Math.round(W * CARD_H / CARD_W);
        if (!cv._pvStyled) { cv.style.aspectRatio = CARD_W + ' / ' + CARD_H; cv._pvStyled = true; }
        if (cv.width === W && cv.height === H) return false;
        cv.width = W; cv.height = H;
        return true;
    }

    // A preview player bound to one canvas.
    //   const p = SAPreview.create(canvas, { view: () => preset, synthetic: true });
    //   p.play()          loop the 3 seconds (onFrame(idx) is called for every new frame shown)
    //   p.show(idx)       scrub: show captured frame idx
    //   p.stop()
    function pvCreate(cv, opts) {
        const o = Object.assign({ view: null, synthetic: false, onFrame: null }, opts || {});
        let raf = 0, t0 = 0, lastIdx = -1;
        const viewOf = () => (typeof o.view === 'function' ? o.view() : o.view);
        const api = {
            canvas: cv,
            status: () => pvStatus(viewOf()),
            count: () => pvCount(viewOf()),
            fit: (maxCss) => pvFit(cv, maxCss),
            show(idx) {
                const v = viewOf();
                if (pvPaint(cv, v, idx)) return true;
                if (o.synthetic && v) pvPaintOwn(cv, v, 0);
                return false;
            },
            play(onFrame) {
                api.stop();
                if (onFrame) o.onFrame = onFrame;
                t0 = performance.now(); lastIdx = -1;
                const tick = (now) => {
                    raf = requestAnimationFrame(tick);
                    const v = viewOf();
                    if (pvStatus(v) !== 'ready') {
                        t0 = now;                          // start from the first frame once the render is in
                        if (o.synthetic && v) pvPaintOwn(cv, v, now);
                        return;
                    }
                    const i = pvLoopIndex(v, now - t0);
                    if (i === lastIdx) return;
                    lastIdx = i;
                    pvPaint(cv, v, i);
                    if (o.onFrame) { try { o.onFrame(i, v); } catch (e) { /* ignore */ } }
                };
                raf = requestAnimationFrame(tick);
                return api;
            },
            stop() { if (raf) cancelAnimationFrame(raf); raf = 0; return api; },
            playing: () => !!raf
        };
        return api;
    }
    window.SAPreview = { create: pvCreate, paint: pvPaint, paintOwn: pvPaintOwn, status: pvStatus, count: pvCount, loopIndex: pvLoopIndex, fit: pvFit, LOOP_MS, CARD_W, CARD_H };

    // Normalized text bounds over the whole animation, or null while the frames are not loaded.
    function bounds(a) {
        const imgs = frames(a);
        return (framesReady(imgs) && !geometry(a, imgs).blank) ? geometry(a, imgs).nb : null;
    }

    // True when the captured frames loaded but hold no visible text (an empty render).
    function isBlank(a) {
        const imgs = frames(a);
        return !!(framesReady(imgs) && geometry(a, imgs).blank);
    }

    function hasRealFrames(a) {
        const imgs = frames(a);
        return !!(framesReady(imgs) && !geometry(a, imgs).blank);
    }

    // Frame of the built-in animation loop at time t (timeline frames).
    function autoFrame(t) {
        const fps = (typeof fpsNow === 'function') ? fpsNow() : 25;
        const elapsedMs = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS;
        return Math.floor((elapsedMs / 1000) * fps);
    }

    function wrapToLines(text) {
        if (!text) return [];
        return String(text).split(/\r?\n/).filter(Boolean);
    }

    // Draws the preset's text design with a built-in animation (pop-in, keys from the Fusion file, wiggle),
    // used until real Fusion frames exist or when the capture came back empty, or for live subtitle rendering.
    function drawSynthetic(cv, a, t, customSub, ownSample) {
        const c = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.filter = 'none';
        paintChecker(c, W, H);
        const curModel = (typeof state !== 'undefined' && state.tab === 'apply' && state.selectedId === a.id && state.use)
            ? state.use
            : (typeof state !== 'undefined' && state.tab === 'library' && state.createId === a.id && libEntry(state.createId))
                ? libEntry(state.createId)
                : a;
        const rawTd = (curModel && curModel.textDesign) || (a && a.textDesign) || {};
        const td = (typeof cloneTextDesign === 'function') ? cloneTextDesign(rawTd) : rawTd;
        const spec = td.animSpec || null;
        const f = autoFrame(t);
        const rep = Math.max(1, Number(spec && spec.frameRepeat) || (td.wiggle ? 4 : 1));
        const q = Math.floor(f / rep) * rep, step = Math.floor(f / rep);
        const ev = (typeof evalSpline === 'function') ? evalSpline : (k, x, d) => d;
        const presetName = String((a && a.name) || (curModel && curModel.name) || '').toLowerCase();
        const isSlideDown = presetName.includes('slide down') || (spec && spec.follower && Number(spec.follower.slideY) > 0.005);
        const isSlideIn = presetName.includes('slide in') || (spec && spec.follower && Number(spec.follower.slideY) < -0.005);
        const isSlide = isSlideDown || isSlideIn;
        const isTyping = presetName.includes('typing') || presetName.includes('typewriter');
        const hasFollower = !!(spec && spec.follower) || isSlide || isTyping;

        const baseSize = Number(td.size) || 0.12;
        let s = (spec && spec.sizeKeys) ? ev(spec.sizeKeys, q, baseSize) / baseSize : 1;
        if (!hasFollower && (!spec || !spec.sizeKeys) && typeof introPop === 'function') {
            s *= introPop(f);
        }
        const op = (spec && spec.opacityKeys) ? clampN(ev(spec.opacityKeys, q, 1), 0, 1) : clampN(f / 4, 0, 1);
        let rot = (spec && spec.angleKeys) ? (ev(spec.angleKeys, q, 0) * Math.PI) / 180 : 0;
        let jx = 0, jy = 0;
        const hasWiggle = !!(spec && (spec.displace || spec.perturb)) || !!td.wiggle || presetName.includes('wiggle');
        const _css = (typeof saStyleToCss === 'function') ? saStyleToCss(td.style === '' ? 'Regular' : (td.style || 'Bold')) : { weight: '700', italic: false };
        const weight = _css.weight;
        const italic = _css.italic ? 'italic ' : '';

        const subText = (customSub !== undefined && customSub !== null && String(customSub).trim() !== '')
            ? String(customSub).trim()
            : (ownSample ? '' : activeSubtitleText());
        const rawText = subText || 'Sample text';
        const lines = wrapToLines(rawText);
        if (!lines.length) { c.restore(); return; }

        let totalWords = 0;
        const lineWordInfo = lines.map(line => {
            const toks = String(line).split(/(\s+)/);
            return toks.map(tok => {
                const isWord = !!tok.trim();
                const wIdx = isWord ? totalWords++ : -1;
                return { tok, isWord, wIdx };
            });
        });

        const rawDelay = Number(spec && spec.follower && spec.follower.delay) || 0.5;
        const wordDelay = isTyping ? 4 : Math.max(4, Math.min(12, Math.round(rawDelay <= 2 ? rawDelay * 10 : rawDelay)));

        const numLines = lines.length;
        let px = Math.round(H * (numLines > 1 ? 0.22 : 0.28));
        const setFont = () => { c.font = italic + weight + ' ' + px + 'px "' + (td.font || 'Poppins') + '", -apple-system, sans-serif'; };
        setFont();
        const maxFullLineW = Math.max(...lines.map(l => c.measureText(l).width));
        const fitW = (W * 0.82) / Math.max(1, maxFullLineW);
        if (fitW < 1) { px = Math.max(10, Math.floor(px * fitW)); setFont(); }
        const lineSpacing = clampN(Number(td.lineSpacing) || 1, 0.6, 2.0);
        const curLineH = px * lineSpacing * 1.18;
        const totalFullH = curLineH * numLines;
        if (totalFullH > H * 0.82) {
            px = Math.max(10, Math.floor(px * ((H * 0.82) / totalFullH)));
            setFont();
        }

        if (hasWiggle) {
            jx = Math.sin(step * 1.7 + 0.5) * px * 0.025;
            jy = Math.cos(step * 2.1 + 0.3) * px * 0.025;
            rot += Math.sin(step * 1.3) * 0.005;
        }

        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const startY = -((lines.length - 1) / 2) * curLineH;

        const drawSyntheticLine = (li, ox, oy, isStroke) => {
            const line = lines[li];
            const ly = startY + li * curLineH + oy;
            const fullW = c.measureText(line).width;
            let curX = ox - fullW * 0.5;
            const lineToks = lineWordInfo[li] || [];

            if (!hasFollower) {
                if (isStroke) c.strokeText(line, ox, ly);
                else c.fillText(line, ox, ly);
                return;
            }

            lineToks.forEach(({ tok, isWord, wIdx }) => {
                const tw = c.measureText(tok).width;
                if (!isWord) {
                    curX += tw;
                    return;
                }
                const wordStart = wIdx * wordDelay;
                const wordAge = f - wordStart;

                if (wordAge >= 0) {
                    let easeOut = 1;
                    if (spec && spec.follower && spec.follower.pathSpline) {
                        easeOut = clampN(ev(spec.follower.pathSpline, wordAge, 1), 0, 1);
                    } else {
                        const animDur = isSlide ? 16 : 4;
                        const progress = clampN(wordAge / animDur, 0, 1);
                        easeOut = 1 - Math.pow(1 - progress, 3);
                    }

                    let dySlide = 0;
                    let dxSlide = 0;
                    if (spec && spec.follower && Math.abs(spec.follower.slideY) > 0.001) {
                        const targetDy = clampN(-spec.follower.slideY * H * 0.8, -px * 1.1, px * 1.1);
                        dySlide = (1 - easeOut) * targetDy;
                    } else if (isSlideDown) {
                        dySlide = -(1 - easeOut) * (px * 0.75);
                    } else if (isSlideIn) {
                        dySlide = (1 - easeOut) * (px * 0.85);
                    }

                    if (spec && spec.follower && Math.abs(spec.follower.slideX) > 0.001) {
                        const targetDx = clampN(spec.follower.slideX * W * 0.8, -px * 1.2, px * 1.2);
                        dxSlide = (1 - easeOut) * targetDx;
                    }

                    let wordAlpha = 1;
                    if (spec && spec.follower && spec.follower.opacityKeys) {
                        wordAlpha = clampN(ev(spec.follower.opacityKeys, wordAge, 1), 0, 1);
                    } else {
                        wordAlpha = clampN(wordAge / (isSlide ? 6 : 2), 0, 1);
                    }

                    let wordScale = 1;
                    if (spec && spec.follower && spec.follower.sizeKeys) {
                        wordScale = clampN(ev(spec.follower.sizeKeys, wordAge, 1), 0.7, 1.3);
                    } else if (isTyping) {
                        wordScale = wordAge < 4 ? 0.93 + 0.07 * easeOut : 1.0;
                    } else if (isSlide) {
                        wordScale = wordAge < 16 ? 0.97 + 0.03 * easeOut : 1.0;
                    }

                    let wordRot = 0;
                    if (spec && spec.follower && spec.follower.rotKeys) {
                        wordRot = (ev(spec.follower.rotKeys, wordAge, 0) * Math.PI) / 180;
                    }

                    let glitchDx = 0;
                    if (isSlideIn && wordAge < 8) {
                        glitchDx = (Math.sin(wordAge * 12.3) > 0.4 ? 2 : -1) * (1 - wordAge / 8);
                    }

                    c.save();
                    c.translate(curX + tw * 0.5 + dxSlide + glitchDx, ly + dySlide);
                    if (wordRot) c.rotate(wordRot);
                    if (wordScale !== 1) c.scale(wordScale, wordScale);
                    if (wordAlpha < 1) c.globalAlpha = (c.globalAlpha || 1) * wordAlpha;

                    if (isStroke) c.strokeText(tok, 0, 0);
                    else c.fillText(tok, 0, 0);
                    c.restore();
                }
                curX += tw;
            });
        };

        c.save();
        c.translate(W / 2 + jx, H / 2 + jy);
        if (rot) c.rotate(rot);
        if (s !== 1) c.scale(s, s);
        const els = Array.isArray(td.elements) ? td.elements : [];
        let drew = false;
        for (let i = Math.min(8, els.length); i >= 1; i--) {
            const el = els[i - 1];
            if (!el || !el.enabled || el.alpha === 0) continue;
            const o = clampN(Number(el.opacity ?? 1) * op, 0, 1);
            if (o <= 0.005) continue;
            drew = true;
            c.save();
            c.globalAlpha = o;
            const ox = (Number(el.offsetX) || 0) * px * 0.85, oy = -(Number(el.offsetY) || 0) * px * 0.85;
            const soft = Number(el.softness) || 0;
            if (soft > 0) c.filter = 'blur(' + Math.min(8, soft * px * 0.06).toFixed(1) + 'px)';
            let col = el.color || '#ffffff';
            if (Number(el.type) === 2) {
                const maxW = Math.max(12, maxFullLineW);
                const angleRad = ((Number(el.mappingAngle) || 0) * Math.PI) / 180;
                const hw = (maxW / 2) * (Number(el.mappingSize) || 1);
                const dx = Math.cos(angleRad) * hw;
                const dy = Math.sin(angleRad) * hw;
                const gr = c.createLinearGradient(-dx, -dy, dx, dy);
                gr.addColorStop(0, el.color || '#ffffff');
                gr.addColorStop(1, el.color2 || '#f07b8e');
                col = gr;
            }
            const shape = Number(el.shape) || 0;
            if (shape === 2 || shape === 3) {
                const maxW = Math.max(12, maxFullLineW);
                const bw = maxW + px * (0.48 + (Number(el.extendH) || 0) * 2.8);
                const bh = (numLines * curLineH) + px * (0.28 + (Number(el.extendV) || 0) * 2.2);
                const r = clampN(Number(el.round) || 0, 0, 1) * Math.min(bw, bh) * 0.5;
                c.beginPath();
                if (typeof c.roundRect === 'function') c.roundRect(-bw / 2 + ox, -bh / 2 + oy, bw, bh, r);
                else c.rect(-bw / 2 + ox, -bh / 2 + oy, bw, bh);
                if (shape === 2) { c.fillStyle = col; c.fill(); }
                else { c.strokeStyle = col; c.lineWidth = Math.max(1, (Number(el.thickness) || 0.02) * px * 4); c.stroke(); }
            } else if (shape === 1) {
                c.strokeStyle = col;
                c.lineJoin = 'round';
                c.lineWidth = Math.max(1, (Number(el.thickness) || 0.02) * px * 5);
                lines.forEach((_, li) => drawSyntheticLine(li, ox, oy, true));
            } else {
                c.fillStyle = col;
                lines.forEach((_, li) => drawSyntheticLine(li, ox, oy, false));
            }
            c.restore();
        }
        if (!drew) {
            c.globalAlpha = op;
            c.fillStyle = '#ffffff';
            lines.forEach((_, li) => drawSyntheticLine(li, 0, 0, false));
        }
        c.restore();
    }

    // The frame to show at time t (keyed so the black background is transparent over the video).
    // isFrame: t is a timeline frame number; otherwise t is a clock time in ms. (Telling them apart by "is it a whole
    // number" was wrong: the clock often lands on whole milliseconds, which made the preview jump to its last frame.)
    function keyedFrame(a, t, isFrame) {
        const imgs = frames(a);
        if (!framesReady(imgs)) return null;
        if (geometry(a, imgs).blank) return null;
        const total = imgs ? imgs.length : 0;
        if (total <= 0) return null;
        let idx = 0;
        if (isFrame === true) {
            // Timeline frame number: play at 1x real speed, hold final frame if reached
            idx = Math.min(total - 1, t);
        } else {
            // Millisecond timestamp: play at 1x real speed, cut at 3 seconds
            idx = frameIndex(a, imgs, t);
        }
        return keyedImage(imgs[idx]);
    }

    let last = 0;
    function loop(ts) {
        // Always schedule the next frame first, so one drawing error can never freeze the previews.
        requestAnimationFrame(loop);
        try { tick(ts); } catch (e) { console.error('preview loop:', e); }
    }
    // Only the thumbnails inside the window are drawn each frame (a long preset list draws a dozen, not all of them);
    // which ones are inside is worked out every VISIBLE_EVERY_MS, not every frame.
    const VISIBLE_EVERY_MS = 300;
    let visibleThumbs = [], visibleAt = 0;
    function thumbsToDraw(ts) {
        if (ts - visibleAt < VISIBLE_EVERY_MS) return visibleThumbs;
        visibleAt = ts;
        const all = document.querySelectorAll('canvas.thumb');
        const H = window.innerHeight || 0, W = window.innerWidth || 0;
        const out = [];
        all.forEach((cv) => {
            if (!cv.isConnected || cv.offsetParent === null) return;
            const r = cv.getBoundingClientRect();
            if (r.bottom < -40 || r.top > H + 40 || r.right < -40 || r.left > W + 40) return;
            out.push(cv);
        });
        visibleThumbs = out;
        return out;
    }
    function tick(ts) {
        if (!document.hidden) {
            const curFps = (typeof fpsNow === 'function' ? fpsNow() : 25) || 25;
            const targetFps = (curFps >= 28 && curFps <= 32) ? 30 : (curFps >= 23 && curFps <= 26 ? 25 : curFps);
            const interval = 1000 / Math.max(20, Math.min(60, targetFps));

            if (state.tab === 'apply' && ts - last >= interval - 2) {
                last = ts;
                for (const cv of thumbsToDraw(ts)) draw(cv, ts);
            }
        }
    }

    async function render(ids) {
        const list = Array.isArray(ids) ? ids : [ids];
        batch = list.length > 1 ? { done: 0, total: list.length } : null;
        const liveSub = activeSubtitleText();
        for (const id of list) {
            busy.add(id);
            renderAnimations();
            setStatus('Rendering preview ' + (batch ? (batch.done + 1) + ' of ' + batch.total + ' ' : '') + 'in Resolve…');
            let res;
            // Card previews are the preset's default look, so they always use its sample text.
            void liveSub;
            try { res = await window.sa.makePreview(id, null); } catch (e) { res = { error: String(e && e.message || e) }; }
            busy.delete(id);
            if (batch) batch.done++;
            if (res && res.error) {
                if (!/busy/i.test(res.error)) failed.set(id, res.error);
                setStatus(res.error, 'bad'); batch = null; renderAnimations(); return;
            }
            failed.delete(id);
            if (res && res.lib) { state.lib = res.lib; syncUse(false); }
        }
        batch = null;
        setStatus('Preview ready.', 'ok');
        renderAll();
    }

    function thumb(a) {
        const wrap = document.createElement('div');
        wrap.className = 'thumb-wrap';
        const hasFrames = a.preview && a.previewFiles && a.previewFiles.length;
        // Always a live canvas: real Fusion frames when they exist, the built-in animation until then.
        const cv = document.createElement('canvas');
        cv.className = 'thumb';
        cv.width = 208; cv.height = 116;
        cv.dataset.id = a.id;
        wrap.appendChild(cv);
        if (busy.has(a.id)) wrap.appendChild(renderOverlay(true));
        if (!hasFrames && !busy.has(a.id) && (failed.has(a.id) || a.missing)) {
            const e = document.createElement('div');
            e.className = 'thumb-badge';
            {
                const b = document.createElement('button');
                b.className = 'ghost';
                b.textContent = a.missing ? 'File missing' : (failed.has(a.id) ? 'Retry' : 'Rendering\u2026');
                b.title = failed.get(a.id) || '';
                b.disabled = !!a.missing || !failed.has(a.id);
                b.addEventListener('click', (ev) => { ev.stopPropagation(); failed.delete(a.id); render(a.id); });
                e.appendChild(b);
            }
            wrap.appendChild(e);
        }
        return wrap;
    }

    // Only presets shown by the current tag filter are rendered automatically.
    function inFilter(a) {
        try { return typeof passesTagFilter !== 'function' || passesTagFilter(a, state.tab === 'library' ? 'lib' : 'use'); } catch (e) { return true; }
    }

    function needsPreview(a) {
        if (!a || a.missing) return false;
        if (!a.preview || !a.previewFiles || !a.previewFiles.length) return true;
        if (isBlank(a)) return true;
        // The card's default look always shows "Sample text": previews captured from a timeline clip (or older
        // renders made with a subtitle) still show that clip's own words, so they are rendered again once.
        if (a.preview.text !== '') return true;
        // MultiText cards show "Sample Text 1, 2, 3...": older renders of them are made again once.
        if ((a.nodes || []).some(n => n.kind === 'multitext') && a.preview.sample !== 'mt-n') return true;
        return false;
    }

    function syncHeader() {
        const btn = document.getElementById('makePrevAll');
        if (!btn) return;
        const missing = state.lib.animations.filter(x => needsPreview(x) && inFilter(x));
        btn.classList.toggle('hidden', !missing.length && !batch);
        btn.disabled = !!busy.size;
        btn.textContent = batch ? 'Rendering ' + Math.min(batch.done + 1, batch.total) + '/' + batch.total + '…' : 'Make previews';
        if (!btn._bound) {
            btn._bound = true;
            btn.addEventListener('click', () => {
                const ids = state.lib.animations.filter(x => needsPreview(x) && inFilter(x)).map(a => a.id);
                if (ids.length) { ids.forEach(i => failed.delete(i)); render(ids); }
            });
        }
    }

    // Presets without a preview are rendered one at a time as soon as Resolve is connected.
    // Each preset is tried automatically once per state of its preview; a render that comes back empty is not
    // retried over and over (that was an endless render loop) - its card offers Retry instead.
    const autoTried = new Map();
    setInterval(() => {
        if (busy.size || batch || state.busy || !state.live || !state.live.ok) return;
        const sig = (a) => a.preview ? String(a.preview.stamp || 0) : 'none';
        const wantId = state.tab === 'library' ? state.createId : state.selectedId;
        const next = state.lib.animations.find(a => a.id === wantId && needsPreview(a) && inFilter(a) && !failed.has(a.id) && autoTried.get(a.id) !== sig(a));
        if (!next) return;
        autoTried.set(next.id, sig(next));
        render(next.id).then(() => {
            const a = libEntry(next.id);
            if (a) autoTried.set(a.id, sig(a));
            if (a && needsPreview(a)) failed.set(a.id, 'The render came back empty. Press Retry to render it again.');
        });
    }, 2500);

    // A "Rendering…" layer over a preview while Fusion renders it.
    function renderOverlay(small) {
        const o = document.createElement('div');
        o.className = 'render-ov' + (small ? ' small' : '');
        o.innerHTML = '<span class="render-spin"></span><span class="render-lbl">Rendering…</span>';
        return o;
    }
    function syncOverlays() {
        document.querySelectorAll('canvas.thumb').forEach((cv) => {
            const wrap = cv.parentElement;
            if (!wrap) return;
            const cur = wrap.querySelector('.render-ov');
            const on = busy.has(cv.dataset.id);
            if (on && !cur) wrap.appendChild(renderOverlay(true));
            else if (!on && cur) cur.remove();
        });
        if (typeof redrawStages === 'function') redrawStages();
    }
    function markBusy(id, on) {
        if (on) busy.add(id); else busy.delete(id);
        syncOverlays();
    }
    function isBusy(id) { return busy.has(id); }

    function drawAll(t) {
        const ts = (t !== undefined) ? t : performance.now();
        document.querySelectorAll('canvas.thumb').forEach(cv => draw(cv, ts));
    }

    // True once this view's frames are loaded and keyed (starts loading them if needed).
    function ready(a) { return !!(a && a.preview && framesReady(frames(a))); }
    // drawOwn: draws a preset's own animation in the app (no Resolve frames, no timeline) at clock time t in ms.
    const drawOwn = (cv, a, t) => drawSynthetic(cv, a, t, '', true);
    window.SAThumbs = { drawOwn, thumb, syncHeader, render, bounds, keyedFrame, isBlank, hasRealFrames, drawAll, wrapToLines, markBusy, isBusy, renderOverlay, ready };
    requestAnimationFrame(loop);
})();


