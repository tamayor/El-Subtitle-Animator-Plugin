// Preview playback (runPreview / stopPreview).

function stopPreview() {
    if (!state.preview) return;
    cancelAnimationFrame(state.preview.raf);
    if (state.audio) { try { state.audio.pause(); } catch (e) { /* ignore */ } }
    pauseVoices(state.preview.voices);
    const { ctx, anim } = state.preview;
    state.preview = null;
    syncPlayUI();
    const pv = document.querySelector('#tl' + ctx.s + ' .pv');
    if (pv) pv.style.display = 'none';
    const prevBtn = $('prev' + ctx.s);
    const loopBtn = $('loop' + ctx.s);
    if (prevBtn) prevBtn.textContent = '▶ Preview';
    if (loopBtn) {
        loopBtn.classList.remove('on');
        loopBtn.textContent = '🔁 Live Loop';
    }
    drawStage(ctx.s, anim || ctx.model(), null);
}

function pauseVoices(vs) {
    for (const v of vs || []) { try { v.el.pause(); } catch (e) { /* ignore */ } }
}

// Every sound of the clip as a ready-to-play Audio element: the main sound plus every extra sound layer / row sound
// that is on (SASounds.voices, the same list scrubbing uses). start / end / tin / fade are timeline frames.
function previewVoices(ctx, m, g) {
    const out = [];
    const add = (path, start, end, tin, db, fade, main) => {
        if (!path || !(end > start)) return;
        try {
            const el = new Audio(fileUrl(path));
            el.preload = 'auto';
            el.load();
            const vol = clamp(Math.pow(10, (Number(db) || 0) / 20), 0, 1);
            out.push({ el, start, end, tin: Number(tin) || 0, fade: Number(fade) || 0, vol, main: !!main, fired: false, done: false });
        } catch (e) { /* ignore */ }
    };
    if (m.useSfx !== false) add(origSfxPath(m) || currentSfxPath(m), g.sfxS, g.sfxE, g.sfxTrimIn, m.sfxVolume, g.fadeFrames, true);
    if (window.SASounds && SASounds.voices) {
        try { for (const v of SASounds.voices(ctx, m, g)) add(v.path, v.start, v.end, v.tin, v.volume, v.fade, false); } catch (e) { /* ignore */ }
    }
    return out;
}

// Plays the animation frames and the sound against the Text+ alignment, so you hear and see where they land.
function runPreview(ctx, loop = false) {
    if (state.preview && state.preview.loop && loop) {
        stopPreview();
        return;
    }
    stopPreview();
    const m = ctx.model();
    if (!m) return;
    const a = libEntry(m.id);
    const fps = fpsNow();
    const g = geometry(m);
    const from = Math.min(g.textS, g.sfxS) - 4;
    const to = g.textE + 6;
    let t0 = performance.now();
    state.preview = { ctx, anim: a || m, raf: 0, loop: !!loop, paused: false };
    let heldMs = 0;
    state.preview.pause = () => {
        if (!state.preview || state.preview.paused) return;
        state.preview.paused = true;
        heldMs = performance.now() - t0;
        cancelAnimationFrame(state.preview.raf);
        if (state.audio) { try { state.audio.pause(); } catch (e) { /* ignore */ } }
        pauseVoices(voices);
        syncPlayUI();
    };
    state.preview.resume = () => {
        if (!state.preview || !state.preview.paused) return;
        state.preview.paused = false;
        t0 = performance.now() - heldMs;
        for (const v of voices) {
            if (v.fired && !v.done && v.el.paused && !v.el.ended) { try { v.el.play(); } catch (e) { /* ignore */ } }
        }
        syncPlayUI();
        frame();
    };
    syncPlayUI();

    const prevBtn = $('prev' + ctx.s);
    const loopBtn = $('loop' + ctx.s);
    if (loop && loopBtn) {
        loopBtn.classList.add('on');
        loopBtn.textContent = '⏹ Stop Loop';
    }
    if (prevBtn) prevBtn.textContent = '⏹ Stop';

    // Every sound is loaded before the clock starts (the main one, extra sound layers and row sounds), so each begins
    // exactly at its offset instead of a moment late, and they all play together like on the timeline.
    const voices = previewVoices(ctx, m, g);
    state.preview.voices = voices;
    if (state.audio) { try { state.audio.pause(); } catch (e) { /* ignore */ } }   // any other sound preview stops
    const startedAt = performance.now();

    const frame = () => {
        if (!state.preview) return;
        const curM = ctx.model() || m;
        // The picture and the sound start together: wait (up to 1.5 s) until the rendered frames are decoded.
        if (a && a.preview && window.SAThumbs && SAThumbs.ready && performance.now() - startedAt < 1500) {
            let view = a;
            try { view = (ctx.s === 'U') ? useView(a) : a; } catch (e) { view = a; }
            if (!SAThumbs.ready(view)) { t0 = performance.now(); state.preview.raf = requestAnimationFrame(frame); return; }
        }
        let tf = from + (performance.now() - t0) / 1000 * fps;
        if (tf > to) {
            if (state.preview.loop) {
                t0 = performance.now();
                tf = from;
                for (const v of voices) { v.fired = false; v.done = false; try { v.el.pause(); } catch (e) { /* ignore */ } }
            } else {
                stopPreview();
                return;
            }
        }
        const pv = document.querySelector('#tl' + ctx.s + ' .pv');
        if (pv && ctx.scale) { pv.style.display = 'block'; pv.style.left = ((tf - ctx.scale.lo) * ctx.scale.ppf) + 'px'; }
        if (state.scrub[ctx.s].on) {
            state.scrub[ctx.s].f = Math.floor(tf + 1e-6);
            const ph = document.querySelector('#tl' + ctx.s + ' .ph.scrub');
            if (ph && ctx.scale) ph.style.left = ((tf - ctx.scale.lo) * ctx.scale.ppf) + 'px';
            scrubDraw(ctx, tf);
        }
        for (const v of voices) {
            if (!v.fired && tf >= v.start) {
                v.fired = true;
                v.done = false;
                if (tf >= v.end) { v.done = true; continue; }
                try {
                    v.el.volume = v.vol;
                    v.el.currentTime = Math.max(0, (v.tin + (tf - v.start)) / g.fps);
                    const pr = v.el.play();
                    if (pr && pr.catch) pr.catch(() => { if (v.main) setStatus('Could not play that sound', 'bad'); });
                } catch (e) { /* ignore */ }
            }
            // Same as on the timeline: each sound stops where its clip ends, fading out over its last frames.
            if (v.fired && !v.done) {
                const left = v.end - tf;
                if (left <= 0) { v.done = true; if (!v.el.paused) v.el.pause(); }
                else if (v.fade > 0 && left < v.fade) v.el.volume = clamp(v.vol * left / v.fade, 0, 1);
            }
        }
        const relFrame = (tf < g.textS) ? -1 : Math.max(0, Math.floor(tf - g.textS));
        // The preset entry (not the editing copy) carries the rendered Fusion frames, so the play button shows the real preview.
        drawStage(ctx.s, a || curM, relFrame);
        state.preview.raf = requestAnimationFrame(frame);
    };
    frame();
}
