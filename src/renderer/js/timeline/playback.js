// Preview playback (runPreview / stopPreview).

function stopPreview() {
    if (!state.preview) return;
    cancelAnimationFrame(state.preview.raf);
    if (state.audio) { try { state.audio.pause(); } catch (e) { /* ignore */ } }
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
    let fired = false;
    state.preview = { ctx, anim: a || m, raf: 0, loop: !!loop, paused: false };
    let heldMs = 0;
    state.preview.pause = () => {
        if (!state.preview || state.preview.paused) return;
        state.preview.paused = true;
        heldMs = performance.now() - t0;
        cancelAnimationFrame(state.preview.raf);
        if (state.audio) { try { state.audio.pause(); } catch (e) { /* ignore */ } }
        syncPlayUI();
    };
    state.preview.resume = () => {
        if (!state.preview || !state.preview.paused) return;
        state.preview.paused = false;
        t0 = performance.now() - heldMs;
        if (fired && state.audio && !state.audio.ended) { try { state.audio.play(); } catch (e) { /* ignore */ } }
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

    // The sound is loaded before the clock starts, so it begins exactly at its offset instead of a moment late.
    const sfx0 = origSfxPath(m) || currentSfxPath(m);
    let sfxEl = null;
    if (sfx0) {
        try {
            sfxEl = new Audio(fileUrl(sfx0));
            sfxEl.preload = 'auto';
            if (m.sfxVolume !== undefined && m.sfxVolume !== null) sfxEl.volume = clamp(Math.pow(10, Number(m.sfxVolume) / 20), 0, 1);
            sfxEl.load();
        } catch (e) { sfxEl = null; }
    }
    const baseVol = sfxEl ? sfxEl.volume : 1;
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
                fired = false;
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
        if (!fired && tf >= g.sfxS) {
            fired = true;
            if (sfxEl) {
                try {
                    if (state.audio && state.audio !== sfxEl) state.audio.pause();
                    state.audio = sfxEl;
                    sfxEl.volume = baseVol;
                    sfxEl.currentTime = g.sfxTrimIn / g.fps;
                    const pr = sfxEl.play();
                    if (pr && pr.catch) pr.catch(() => setStatus('Could not play that sound', 'bad'));
                } catch (e) { /* ignore */ }
            }
        }
        // Same as on the timeline: the sound stops where the subtitle ends, fading out over its last second.
        if (sfxEl && fired) {
            const left = g.sfxE - tf;
            if (left <= 0) { if (!sfxEl.paused) sfxEl.pause(); }
            else if (left < g.fadeFrames) sfxEl.volume = clamp(baseVol * left / g.fadeFrames, 0, 1);
        }
        const relFrame = (tf < g.textS) ? -1 : Math.max(0, Math.floor(tf - g.textS));
        // The preset entry (not the editing copy) carries the rendered Fusion frames, so the play button shows the real preview.
        drawStage(ctx.s, a || curM, relFrame);
        state.preview.raf = requestAnimationFrame(frame);
    };
    frame();
}
