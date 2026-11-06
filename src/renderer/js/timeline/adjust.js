// The alignment Adjust panel (fillAdjust / bindAdjust).

function fillAdjust(ctx) {
    const S = ctx.s, m = ctx.model();
    if (!m) return;
    syncNumbers(ctx);
    syncXformUI(S, m.posX, m.posY, m.scale, m.rotation);
    if (window.SASounds) SASounds.sync(ctx, true);
    fillTextDesign(ctx);
}

function bindAdjust(ctx) {
    const S = ctx.s;
    const changed = () => {
        const m = ctx.model();
        if (m) {
            ctx.changed(m);
            renderTimeline(ctx);
            if (S === 'U') renderUseSummary();
            else renderCreateSummary();
        }
    };
    for (const f of ['textOffset', 'sfxOffset', 'tail']) {
        const el = $(f + S);
        if (el) el.addEventListener('input', () => {
            const m = ctx.model(); if (!m) return;
            const v = clamp(Math.round(Number(el.value) || 0), -300, 300);
            if (f === 'textOffset' && m.linked === false) m.sfxOffset = clamp(m.sfxOffset - (v - m.textOffset), -300, 300);
            m[f] = v;
            changed();
        });
    }
    const lkEl = $('linked' + S);
    if (lkEl) lkEl.addEventListener('change', () => { const m = ctx.model(); if (m) { m.linked = lkEl.checked; changed(); } });
    const sfxEl = $('useSfx' + S);
    if (sfxEl) sfxEl.addEventListener('change', () => { const m = ctx.model(); if (m) { m.useSfx = sfxEl.checked; changed(); renderAnimations(); } });
    const sfxVolEl = $('sfxVolume' + S);
    if (sfxVolEl) sfxVolEl.addEventListener('input', () => {
        const m = ctx.model(); if (!m) return;
        m.sfxVolume = Number(sfxVolEl.value);
        if ($('vSfxVolume' + S)) $('vSfxVolume' + S).textContent = m.sfxVolume + ' dB';
        ctx.changed(m);
        renderTimeline(ctx);
        triggerLiveSync(m, S);
    });
    const txtTrkEl = $('textTrack' + S);
    if (txtTrkEl) txtTrkEl.addEventListener('change', () => { const m = ctx.model(); if (m) { m.textTrack = Number(txtTrkEl.value); ctx.changed(m); } });
    const sfxTrkEl = $('sfxTrack' + S);
    if (sfxTrkEl) sfxTrkEl.addEventListener('change', () => { const m = ctx.model(); if (m) { m.sfxTrack = Number(sfxTrkEl.value); ctx.changed(m); } });
    const lenSel = $('sfxLenMode' + S);
    if (lenSel) lenSel.addEventListener('change', () => {
        const m = ctx.model(); if (!m) return;
        stopPreview();
        if (lenSel.value === 'fixed') { m.sfxLen = geometry(m).sfxFrames; m.sfxLenMode = 'fixed'; }   // freezes the length shown now
        else { m.sfxLen = null; m.sfxLenMode = 'estimate'; }
        ctx.changed(m);
        syncAttachedSfx(m);
        renderTimeline(ctx);
    });
    const alnPlay = $('alnPlay' + S), alnMode = $('alnMode' + S);
    if (alnPlay) alnPlay.addEventListener('click', () => {
        const pv = state.preview;
        if (pv && pv.ctx === ctx && !pv.loop) { if (pv.paused) pv.resume(); else pv.pause(); }
        else runPreview(ctx, false);                      // plays once from the start (also replaces a running loop)
    });
    if (alnMode) alnMode.addEventListener('click', () => {
        const pv = state.preview;
        if (pv && pv.ctx === ctx && pv.loop) stopPreview();
        else runPreview(ctx, true);                       // loops, sound included, until clicked again
    });
    const alnScrub = $('alnScrub' + S);
    if (alnScrub) alnScrub.addEventListener('click', () => setScrub(ctx, !state.scrub[S].on));
    const scrubLoopBtn = $('scrubLoop' + S);
    if (scrubLoopBtn) scrubLoopBtn.addEventListener('click', () => {
        if (state.scrubLoop && state.scrubLoop[S]) stopScrubLoop(ctx); else { stopPreview(); startScrubLoop(ctx); }
    });
    bindScrubKeys();
    syncPlayUI();
    const prevBtn = $('prev' + S);
    if (prevBtn) prevBtn.addEventListener('click', () => {
        if (state.preview) stopPreview();
        else runPreview(ctx, false);
    });
    const loopBtn = $('loop' + S);
    if (loopBtn) {
        loopBtn.addEventListener('click', () => {
            if (state.preview && state.preview.loop) stopPreview();
            else runPreview(ctx, true);
        });
    }
    const prevSfxBtn = $('prevSfx' + S);
    if (prevSfxBtn) prevSfxBtn.addEventListener('click', () => {
        const m = ctx.model(); const p = m && (m.useSfx === false ? null : (m.sfxPath || currentSfxPath(m)));
        if (p) play(p, m && m.sfxVolume); else setStatus('This item has no sound to play.', 'bad');
    });

    const sfxPlayBtn = $('sfxPlay' + S);
    if (sfxPlayBtn) {
        sfxPlayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const m = ctx.model();
            const p = m && (m.sfxPath || currentSfxPath(m));
            if (p) play(p, m && m.sfxVolume);
            else if (S === 'C') setCreateStatus('No sound file set', 'bad');
            else setStatus('No sound file set', 'bad');
        });
    }

    bindStage(ctx);
    bindSaveBar(ctx);
    bindTextDesign(ctx);
}
