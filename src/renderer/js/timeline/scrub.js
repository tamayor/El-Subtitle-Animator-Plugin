// Scrubbing: stepping through the preview frame by frame (with audio).

// ---------------------------------------------------------------- scrubbing: step through the preview frame by frame
function setScrub(ctx, on) {
    const S = ctx.s;
    stopPreview();
    if (!on) stopScrubLoop(ctx);
    state.scrub[S].on = !!on;
    if (!on) stopScrubAudio();
    const box = $('scrubBox' + S);
    if (box) box.classList.toggle('hidden', !on);
    syncPlayUI();
    renderTimeline(ctx);
}

// What the scrub viewer shows: the same render the selected preset's card plays (cardView: the subtitle / Use-tab
// render once it is in, the preset's own sample render until then).
//   a: the preset   view: what to draw   pending: a subtitle render is on its way   failed: that render failed
function scrubSource(ctx) {
    const m = ctx.model();
    if (!m) return null;
    const a = libEntry(m.id) || (ctx.s === 'U' ? selected() : null);
    if (!a) return null;
    if (ctx.s !== 'U') {
        return { a, view: a, pending: !!(window.SAThumbs && SAThumbs.isBusy && SAThumbs.isBusy(a.id)), failed: false };
    }
    let view = a;
    try { view = (typeof cardView === 'function' ? cardView(a) : a) || a; } catch (e) { view = a; }
    const u = state.use;
    let wants = false;
    try { wants = !!(u && u.id === a.id && (normSub(currentSubText()) || (u.designRev || 0) > 0 || boxOverrides(u, a) || textStylePreviewKey())); } catch (e) { wants = false; }
    const failed = view === a && wants && !!u._renderFailed && !u.rendering;
    const pending = view === a && wants && !failed && !!(u.rendering || u._timer);
    return { a, view, pending, failed };
}

// Loops the real captured animation exactly like the preset cards do (SAPreview loop timing: 3 seconds, 1x),
// from where the text starts, with the pink playhead following along. Dragging or stepping stops it.
function startScrubLoop(ctx) {
    const S = ctx.s;
    stopScrubLoop(ctx);
    const L = { raf: 0, t0: performance.now() };
    state.scrubLoop = state.scrubLoop || {};
    state.scrubLoop[S] = L;
    const b = $('scrubLoop' + S);
    if (b) b.classList.add('on');
    const tick = (now) => {
        if (state.scrubLoop[S] !== L) return;
        const m = ctx.model();
        if (!m || !state.scrub[S].on || !ctxVisible(ctx)) { stopScrubLoop(ctx); return; }
        const src = scrubSource(ctx);
        const g = geometry(m);
        if (src && window.SAPreview && SAPreview.status(src.view) === 'ready') {
            const idx = SAPreview.loopIndex(src.view, now - L.t0);
            const tf = g.textS + idx;
            state.scrub[S].f = tf;
            const sc = ctx.scale, ph = document.querySelector('#tl' + S + ' .ph.scrub');
            if (ph && sc) ph.style.left = ((tf - sc.lo) * sc.ppf) + 'px';
            scrubDraw(ctx, tf);
        } else L.t0 = now;       // waiting for the frames: start from the first one once they are in
        L.raf = requestAnimationFrame(tick);
    };
    L.raf = requestAnimationFrame(tick);
}
function stopScrubLoop(ctx) {
    const S = ctx.s, L = state.scrubLoop && state.scrubLoop[S];
    if (!L) return;
    cancelAnimationFrame(L.raf);
    state.scrubLoop[S] = null;
    const b = $('scrubLoop' + S);
    if (b) b.classList.remove('on');
}

function stopScrubAudio() {
    clearTimeout(state.scrubAudioT);
    const nodes = state.scrubNodes || [];
    state.scrubNodes = [];
    for (const n of nodes) {
        try {
            const t = state.scrubAC.currentTime;
            n.g.gain.cancelScheduledValues(t);
            n.g.gain.setValueAtTime(n.g.gain.value, t);
            n.g.gain.linearRampToValueAtTime(0, t + 0.012);
            n.s.stop(t + 0.02);
        } catch (e) { /* ignore */ }
    }
}

// The sound is decoded once; each blip is a short buffer source with a tiny fade, so there is no seeking and no click.
function scrubBuffer(p) {
    if (!state.scrubBufs) state.scrubBufs = new Map();
    const e = state.scrubBufs.get(p);
    if (e) return e.buf;
    const ent = { buf: null };
    state.scrubBufs.set(p, ent);
    try {
        if (!state.scrubAC) state.scrubAC = new (window.AudioContext || window.webkitAudioContext)();
        window.sa.readSfx(p).then((bytes) => {
            if (!(bytes instanceof Uint8Array)) throw new Error('unreadable');
            return state.scrubAC.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        }).then((b) => { ent.buf = b; }).catch(() => { state.scrubBufs.delete(p); });
    } catch (err) { state.scrubBufs.delete(p); }
    return null;
}

// Every sound under frame tf (the main one and any extra sound layers), as { buf, at (seconds into the file), vol }.
function scrubVoices(ctx, m, tf, g) {
    const out = [];
    // Volume follows the line on the clip: its dB level (boosts above 0 dB included) and the fade-out at its end.
    const add = (p, start, end, tin, db, fade) => {
        if (!p || tf < start || tf >= end) return;
        const buf = scrubBuffer(p);                      // starts decoding on first use; heard from the next step on
        if (!buf) return;
        const at = Math.max(0, (tin + (tf - start)) / g.fps);
        if (at >= buf.duration) return;
        let vol = clamp(Math.pow(10, (Number(db) || 0) / 20), 0, 4);
        const left = end - tf, f = Number(fade) || 0;
        if (f > 0 && left < f) vol *= clamp(left / f, 0, 1);
        out.push({ buf, at, vol });
    };
    if (m.useSfx !== false) add(origSfxPath(m) || currentSfxPath(m), g.sfxS, g.sfxE, g.sfxTrimIn, m.sfxVolume, g.fadeFrames);
    if (window.SASounds && SASounds.voices) {
        try { for (const v of SASounds.voices(ctx, m, g)) add(v.path, v.start, v.end, v.tin, v.volume, v.fade); } catch (e) { /* ignore */ }
    }
    return out;
}

// A short blip of every sound at the playhead, so you hear exactly where each one lands against the picture.
function scrubAudio(ctx, m, tf) {
    if (state.preview) return;
    const nowT = performance.now();
    if (nowT - (state.scrubAudioAt || 0) < 40) return;
    const g = geometry(m);
    const vs = scrubVoices(ctx, m, tf, g);
    if (!vs.length || !state.scrubAC) { stopScrubAudio(); return; }
    state.scrubAudioAt = nowT;
    try {
        const ac = state.scrubAC;
        if (ac.state === 'suspended') ac.resume();
        stopScrubAudio();
        const dur = Math.max(0.06, 1.6 / g.fps), t = ac.currentTime;
        for (const v of vs) {
            const src = ac.createBufferSource(), gn = ac.createGain();
            src.buffer = v.buf;
            gn.gain.setValueAtTime(0, t);
            gn.gain.linearRampToValueAtTime(v.vol, t + 0.006);
            gn.gain.setValueAtTime(v.vol, t + dur - 0.012);
            gn.gain.linearRampToValueAtTime(0, t + dur);
            src.connect(gn); gn.connect(ac.destination);
            src.start(t, v.at, dur + 0.02);
            state.scrubNodes.push({ s: src, g: gn });
        }
    } catch (e) { /* ignore */ }
}

// Drawing is coalesced to one paint per display frame: dragging fires far more pointer events than the screen can
// show, and painting each of them made the scrub stutter and lag behind the playhead. Only the latest position is drawn.
const scrubPending = { U: null, C: null };
function scrubDraw(ctx, tf, tries) {
    const S = ctx.s;
    const q = scrubPending[S];
    if (q) { q.ctx = ctx; q.tf = tf; q.tries = tries; return; }
    scrubPending[S] = { ctx, tf, tries };
    requestAnimationFrame(() => {
        const job = scrubPending[S];
        scrubPending[S] = null;
        if (!job || !state.scrub[S].on) return;
        try { scrubPaint(job.ctx, job.tf, job.tries); } catch (e) { console.error('scrub paint:', e); }
    });
}

function scrubPaint(ctx, tf, tries) {
    const S = ctx.s;
    const cv = $('scrubCv' + S);
    const m = ctx.model();
    if (!cv || !m) return;
    const src = scrubSource(ctx);
    if (!src) return;
    const { a, view } = src;
    cv._view = view; cv._pend = src.pending; cv._fail = src.failed;
    const g = geometry(m);
    const tfi = Math.floor(tf + 1e-6);                                    // same rounding as playback, so both land on the same frame
    const rel = tfi - g.textS;
    const live = rel >= 0 && tfi <= g.textE;
    const P = window.SAPreview;
    const pvm = view.preview || {};
    // timeline frame -> captured frame, 1x like the cards (SAPreview loop): frame n of the text is captured frame n,
    // the last frame is held past the end of the capture
    const pvTotal = P ? P.count(view) : 0;
    const idx = clamp(Math.max(0, rel), 0, Math.max(0, pvTotal - 1));
    const pvState = P ? P.status(view) : 'none';
    const info = $('scrubInfo' + S), msg = $('scrubMsg' + S);
    const srel = tfi - g.sfxS;
    const hasSfx = m.useSfx !== false && !!currentSfxPath(m);
    if (info) {
        const html = '<span>Text <b>' + (rel < 0 ? 'starts in ' + (-rel) + 'f' : (live ? sg(rel) + 'f' : 'ended')) + '</b></span>'
            + (hasSfx ? '<span>Sound <b>' + (srel < 0 ? 'starts in ' + (-srel) + 'f' : (tfi >= g.sfxE ? 'ended' : sg(srel) + 'f')) + '</b></span>' : '')
            + '<span>' + (tfi / g.fps).toFixed(2) + ' s</span>'
            + (src.pending ? '<span>Rendering your subtitle…</span>' : '') + (src.failed ? '<span>Showing sample text (subtitle render failed)</span>' : '')
            + '<span class="scrub-keys">← → step · Shift ×5</span>';
        if (info._html !== html) { info._html = html; info.innerHTML = html; }
    }
    let fr = false, note = '', fixBtn = false, noteTip = '';
    const again = (n) => { if (n < 40 && state.scrub[S].on && !state.preview) setTimeout(() => { if (state.scrub[S].on && !state.preview) scrubDraw(ctx, state.scrub[S].f, n + 1); }, 200); };
    // While a subtitle render is on its way the preset's own frames keep showing (the info line says it is rendering).
    if (pvState === 'none') note = src.pending ? (live ? 'Rendering your subtitle in Resolve…' : '') : 'No preview frames yet for this preset';
    else if (live) {
        if (pvState === 'ready') fr = true;
        else if (pvState === 'broken') {
            // a file is listed but cannot be read: it is gone from disk or damaged
            note = 'This preset\'s preview frames can\'t be read';
            fixBtn = true;
            noteTip = String((view.previewFiles && view.previewFiles[0]) || '');
        } else if (pvState === 'blank') note = 'This preset\'s preview came back empty';
        else { note = 'Loading frames…'; again(tries || 0); }
    }
    const loadingLive = live && !fr && !fixBtn && note === 'Loading frames…';
    if (msg && (msg._note !== note + '|' + fixBtn)) {
        msg._note = note + '|' + fixBtn;
        msg.textContent = note;
        msg.title = noteTip;
        if (fixBtn) {
            const bt = document.createElement('button');
            bt.type = 'button'; bt.className = 'sm-btn scrub-fix'; bt.textContent = 'Render preview';
            bt.addEventListener('click', () => { if (window.SAThumbs) SAThumbs.render([a.id]); });
            msg.appendChild(document.createElement('br'));
            msg.appendChild(bt);
        }
    }
    // The SAPreview component draws it: the preset card's exact picture (same frames, crop, background and fit),
    // only bigger, so the scrub viewer and the card always match.
    if (!cv._styled) { cv.style.maxWidth = '560px'; cv._styled = true; }
    if (P && P.fit(cv, 560)) cv._sig = null;
    // Frames still decoding: keep showing the last picture instead of flashing black on every step.
    if (loadingLive && cv._sig) return;
    const sig = [m.id, view === a ? 'own' : 'sub', pvm.stamp || 0, cv.width, cv.height, fr ? idx : (live ? 'x' : 'off')].join('|');
    if (cv._sig === sig) return;
    cv._sig = sig;
    if (fr && P.paint(cv, view, idx)) return;
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, cv.width, cv.height);
}

// Moves the pink playhead to frame tf, shows that frame and (while dragging / stepping) plays a blip of the sound.
function scrubTo(ctx, tf, audible, cache) {
    const S = ctx.s;
    const m = ctx.model();
    if (!m || !state.scrub[S].on) return;
    stopScrubLoop(ctx);
    const sc = ctx.scale;
    if (sc) tf = clamp(tf, sc.lo, sc.lo + ((cache && cache.w) || ($('tl' + S) && $('tl' + S).clientWidth) || 380) / sc.ppf);
    tf = Math.round(tf);
    state.scrub[S].f = tf;
    const ph = (cache && cache.ph) || document.querySelector('#tl' + S + ' .ph.scrub');
    if (ph && sc) ph.style.left = ((tf - sc.lo) * sc.ppf) + 'px';
    scrubDraw(ctx, tf);
    if (audible) scrubAudio(ctx, m, tf);
}

function startScrub(ctx, e) {
    e.preventDefault(); e.stopPropagation();
    stopPreview();
    const box = $('tl' + ctx.s);
    if (!box || !ctx.scale) return;
    // measured once: reading layout on every pointer event (right after writing the playhead position) forced a
    // re-layout each time, which is what made fast scrubbing choppy
    const rect = box.getBoundingClientRect();
    const cache = { w: box.clientWidth, ph: box.querySelector('.ph.scrub') };
    const move = (ev) => {
        if (!ctx.scale) return;
        scrubTo(ctx, ctx.scale.lo + (ev.clientX - rect.left) / ctx.scale.ppf, true, cache);
    };
    const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        box.classList.remove('scrubbing');
    };
    box.classList.add('scrubbing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    move(e);
}

let scrubKeysBound = false;
function bindScrubKeys() {
    if (scrubKeysBound) return;
    scrubKeysBound = true;
    setInterval(() => {
        if (document.hidden) return;
        for (const S of ['U', 'C']) {
            const ctx = CTX[S];
            if (!state.scrub[S].on || !ctxVisible(ctx) || !ctx.model() || state.drag) continue;
            const cv = $('scrubCv' + S);
            if (!cv) continue;
            try {
                if (S === 'U') ensureUsePreview(selected());
                const src = scrubSource(ctx);
                if (src && (src.view !== cv._view || src.pending !== cv._pend || src.failed !== cv._fail)) scrubDraw(ctx, state.scrub[S].f || 0);
            } catch (e) { /* ignore */ }
        }
    }, 250);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        for (const S of ['U', 'C']) {
            const ctx = CTX[S];
            if (!state.scrub[S].on || !ctxVisible(ctx) || !ctx.model()) continue;
            e.preventDefault();
            const step = (e.shiftKey ? 5 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
            scrubTo(ctx, (state.scrub[S].f || 0) + step, true);
            return;
        }
    });
}
