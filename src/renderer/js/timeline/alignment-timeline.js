// The alignment timeline: geometry, drawing, and dragging the text / sound bars.

// ---------------------------------------------------------------- alignment timeline
// Frames on the timeline are relative to the subtitle's first frame (0 = where the subtitle starts).
let waveSecOverride = null;      // the real length of the sound being cut, used until its waveform has been loaded
let spanOverride = null;      // the caption a sound is being cut for (Preview in Resolve), instead of the one under the playhead
function subSpan() {
    if (spanOverride) return spanOverride;
    const L = state.live;
    if (L && L.ok && L.subtitle) return { base: L.subtitle.start, dur: Math.max(1, L.subtitle.end - L.subtitle.start) };
    if (L && L.ok) return { base: L.frame, dur: Math.round(L.fps * 3) };
    return { base: 0, dur: 75 };
}

// 'estimate' = the end follows the real caption length when added (cut shorter, or extended up to the sound's full
// length); 'fixed' = exactly the length set here, even when the caption is longer. Older presets with a set length are fixed.
function sfxLenMode(m) {
    if (m.sfxLenMode === 'fixed' || m.sfxLenMode === 'estimate') return m.sfxLenMode;
    return (m.sfxLen !== null && m.sfxLen !== undefined) ? 'fixed' : 'estimate';
}

function geometry(m) {
    const span = subSpan();
    const fps = fpsNow();
    const wave = loadWaveCached(m);
    const sfxFull = Math.max(2, Math.round(((wave && wave.seconds) || waveSecOverride || 0.5) * fps));
    const textS = m.textOffset;
    const textE = span.dur + m.tail;
    const sfxS = textS + m.sfxOffset;                       // where the sound clip starts (after any trim at its start)
    const tin = clamp(Math.round(Number(m.sfxTrimIn) || 0), 0, Math.max(0, sfxFull - 2));   // frames cut off the start of the file
    const maxLen = Math.max(2, sfxFull - tin);
    // Length: set by dragging its end; until then the sound is cut where the subtitle ends (never under 5 frames).
    const mode = sfxLenMode(m);
    const sfxFrames = (mode === 'fixed' && m.sfxLen !== null && m.sfxLen !== undefined)
        ? clamp(Math.round(Number(m.sfxLen)), 2, maxLen)
        : Math.max(Math.min(maxLen, 5), Math.min(maxLen, Math.round(textE - sfxS)));
    // Fade-out: 1 second unless changed.
    const fadeFrames = clamp((m.sfxFade === null || m.sfxFade === undefined) ? Math.round(fps) : Math.round(Number(m.sfxFade)), 0, sfxFrames);
    return { span, fps, sfxFull, sfxTrimIn: tin, sfxLenMode: mode, sfxFrames, fadeFrames, textS, textE, sfxS, sfxE: sfxS + sfxFrames, srcS: sfxS - tin };
}

function loadWaveCached(m) {
    const p = origSfxPath(m) || currentSfxPath(m);
    if (!p) return null;
    const w = state.waves.get(p);
    if (w === undefined) loadWave(p);
    return w || null;
}

function windowFor(g) {
    const lo = Math.min(0, g.textS, g.sfxS) - 12;
    const hi = Math.max(g.span.dur, g.textE, g.srcS + g.sfxFull) + 12;
    return { lo, hi };
}

function rulerStep(ppf, fps) {
    for (const s of [1, 2, 5, 10, Math.round(fps / 2), Math.round(fps), Math.round(fps * 2), Math.round(fps * 5), Math.round(fps * 10)]) {
        if (s >= 1 && s * ppf >= 46) return s;
    }
    return Math.round(fps * 30);
}

function renderTimeline(ctx) {
    const box = $('tl' + ctx.s);
    const m = ctx.model();
    if (!box || !m) { if (box) box.textContent = ''; return; }
    const g = geometry(m);
    let win = state.drag && state.drag.ctx === ctx ? state.drag.win : windowFor(g);
    if (!(state.drag && state.drag.ctx === ctx) && window.SASounds) {
        const rg = SASounds.range(ctx, m, g);
        if (rg) win = { lo: Math.min(win.lo, rg.lo), hi: Math.max(win.hi, rg.hi) };
    }
    const W = box.clientWidth || 380;
    const ppf = W / (win.hi - win.lo);
    const X = (f) => (f - win.lo) * ppf;
    ctx.scale = { lo: win.lo, ppf };
    box.textContent = '';
    const add = (cls, parent) => { const d = document.createElement('div'); d.className = cls; (parent || box).appendChild(d); return d; };
    const L0 = 26, LH = 56;                                  // first lane's top, and every lane's height
    const nExtra = window.SASounds ? SASounds.layersFor(ctx).length : 0;
    box.style.height = (L0 + (2 + nExtra) * LH + 4) + 'px';

    // ruler
    const ruler = add('ruler');
    const step = rulerStep(ppf, g.fps);
    for (let f = Math.ceil(win.lo / step) * step; f <= win.hi; f += step) {
        const t = add('tick', ruler);
        t.style.left = X(f) + 'px';
        const s = document.createElement('span');
        s.textContent = (f / g.fps).toFixed(Math.abs(f) % g.fps === 0 ? 0 : 1) + 's';
        t.appendChild(s);
    }
    if (state.scrub[ctx.s].on) {
        ruler.style.cursor = 'ew-resize';
        ruler.addEventListener('pointerdown', (e) => startScrub(ctx, e));
    } else if (ctx.s === 'U') {
        ruler.addEventListener('pointerdown', (e) => {
            const rect = box.getBoundingClientRect();
            const rel = Math.round(win.lo + (e.clientX - rect.left) / ppf);
            window.sa.seek(g.span.base + rel);
        });
    }

    const laneT = add('lane text'); add('tag', laneT).textContent = 'Text';
    laneT.style.top = L0 + 'px'; laneT.style.height = LH + 'px';
    const laneS = add('lane sfx'); add('tag', laneS).textContent = 'Sound';
    laneS.style.top = (L0 + LH) + 'px'; laneS.style.height = LH + 'px';

    // where the original subtitle sits, for reference
    const ghost = add('ghost', laneT);
    ghost.style.left = X(0) + 'px'; ghost.style.width = Math.max(2, g.span.dur * ppf) + 'px';

    // text bar
    const tb = add('bar text', laneT);
    tb.dataset.snd = 'text';
    tb.style.left = X(g.textS) + 'px'; tb.style.width = Math.max(10, (g.textE - g.textS) * ppf) + 'px';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = m.name || ''; tb.appendChild(nm);
    const hl = add('handle l', tb), hr = add('handle r', tb);

    // the sound's full length, as a faint ghost behind the (trimmed) bar
    const hasSfx = m.useSfx !== false && !!currentSfxPath(m);
    if (hasSfx && (g.sfxTrimIn > 0 || g.sfxFrames < g.sfxFull)) {
        const gs = add('sfx-ghost', laneS);
        gs.style.left = X(g.srcS) + 'px'; gs.style.width = Math.max(6, g.sfxFull * ppf) + 'px';
        const gcv = document.createElement('canvas'); gs.appendChild(gcv);
        drawWave(gcv, loadWaveCached(m), m.sfxVolume);
    }

    // sound bar: drag it to move, drag its ends to trim or extend (up to the file's full length), drag the corner to set the fade-out
    const sb = add('bar sfx' + (m.useSfx === false || !currentSfxPath(m) ? ' off' : '') + (g.sfxLenMode === 'estimate' ? ' est' : ''), laneS);
    sb.dataset.snd = 'main';
    const sbW = Math.max(6, g.sfxFrames * ppf);
    sb.style.left = X(g.sfxS) + 'px'; sb.style.width = sbW + 'px';
    const cv = document.createElement('canvas'); sb.appendChild(cv);
    drawWave(cv, loadWaveCached(m), m.sfxVolume, { from: g.sfxTrimIn / g.sfxFull, frac: g.sfxFrames / g.sfxFull, fade: g.sfxFrames ? g.fadeFrames / g.sfxFrames : 0 });
    const secs = (f) => (f / g.fps).toFixed(f % Math.round(g.fps) === 0 ? 0 : 2) + ' s';
    sb.title = (g.sfxLenMode === 'estimate' ? 'Estimated end (set from the real caption when added). ' : 'Fixed length. ') + 'Sound ' + secs(g.sfxFrames) + ' of ' + secs(g.sfxFull) + ' · fade out ' + secs(g.fadeFrames);
    const shl = add('handle l', sb), shr = add('handle r', sb);
    shl.title = 'Drag to trim or extend the start (double-click to restore)';
    shr.title = 'Drag to trim or extend the end (double-click: cut at the subtitle end)';
    const fh = add('fade-h', sb);
    fh.style.left = Math.max(0, Math.min(sbW - 10, (g.sfxFrames - g.fadeFrames) * ppf - 5)) + 'px';
    fh.title = 'Drag to change the fade-out length (double-click: 1 s)';

    // dashed link between the start of the text and the sound
    if (m.linked !== false) {
        const lk = add('link', box);
        lk.style.left = X(g.textS) + 'px'; lk.style.top = (L0 + LH - 4) + 'px'; lk.style.height = '18px';
    }

    // the pink playhead is the scrubber: it only exists while scrubbing is on
    const scr = state.scrub[ctx.s];
    if (scr.on) {
        if (scr.f === null || scr.f === undefined) scr.f = Math.round(g.textS);
        scr.f = clamp(Math.round(scr.f), Math.ceil(win.lo), Math.floor(win.hi));
        const ph = add('ph scrub'); ph.style.left = X(scr.f) + 'px';
        const head = add('ph-head', ph);
        head.title = 'Drag to scrub (or use the arrow keys)';
        head.addEventListener('pointerdown', (e) => startScrub(ctx, e));
    }
    add('pv');

    if (scr.on && !state.preview) scrubDraw(ctx, scr.f);

    // The timeline is redrawn after every press, so a double press is detected here instead of with dblclick.
    const resets = {};
    const begin = (kind, lid) => (e) => {
        e.preventDefault(); e.stopPropagation();
        stopPreview();
        const rk = lid ? kind + ':' + lid : kind;
        if (window.SASounds) SASounds.selectFor(ctx, kind, lid);
        const now = performance.now();
        if (resets[rk] && state.lastPress && state.lastPress.kind === rk && now - state.lastPress.t < 400) {
            state.lastPress = null;
            resets[rk]();
            ctx.changed(m);
            renderTimeline(ctx);
            return;
        }
        state.lastPress = { kind: rk, t: now };
        state.drag = {
            ctx, kind, lid, x0: e.clientX, y0: e.clientY, ppf, win, a0: { textOffset: m.textOffset, sfxOffset: m.sfxOffset, tail: m.tail },
            g0: { mode: g.sfxLenMode, tin: g.sfxTrimIn, len: g.sfxFrames, fade: g.fadeFrames, full: g.sfxFull, fps: g.fps, textE: g.textE, sfxS: g.sfxS, textS: g.textS }
        };
    };
    tb.addEventListener('pointerdown', begin('text'));
    hl.addEventListener('pointerdown', begin('textStart'));
    hr.addEventListener('pointerdown', begin('textEnd'));
    sb.addEventListener('pointerdown', begin('sfx'));
    shl.addEventListener('pointerdown', begin('sfxIn'));
    shr.addEventListener('pointerdown', begin('sfxOut'));
    fh.addEventListener('pointerdown', begin('sfxFade'));
    resets.sfxIn = () => {
        const keepEnd = g.sfxLenMode === 'fixed';
        const t = g.sfxTrimIn;
        m.sfxOffset = clamp(m.sfxOffset - t, -300, 300); m.sfxTrimIn = 0;
        if (keepEnd) m.sfxLen = g.sfxFrames + t;
        syncAttachedSfx(m);
    };
    resets.sfxOut = () => { m.sfxLen = null; m.sfxLenMode = 'estimate'; syncAttachedSfx(m); };
    resets.sfxFade = () => { m.sfxFade = null; syncAttachedSfx(m); };
    resets.vol = () => { m.sfxVolume = 0; };
    if (window.SASounds) {
        SASounds.volLine(add, sb, Number(m.sfxVolume) || 0, begin, 'vol');
        SASounds.lanes({ ctx, m, g, box, add, X, ppf, begin, resets, top0: L0 + 2 * LH });
    }
    syncNumbers(ctx);
    if (window.SASounds) SASounds.sync(ctx);
}

function syncNumbers(ctx) {
    const m = ctx.model(); if (!m) return;
    const lm = $('sfxLenMode' + ctx.s);
    if (lm) {
        const mode = sfxLenMode(m);
        if (document.activeElement !== lm) lm.value = mode;
        const hint = $('sfxLenHint' + ctx.s);
        if (hint) hint.textContent = mode === 'fixed'
            ? 'Keeps exactly this length, even when the caption is longer.'
            : 'Starts here. The end is set from the real caption length when added: cut shorter, or extended up to the sound\'s full length.';
    }
    for (const f of ['textOffset', 'sfxOffset', 'tail']) {
        const el = $(f + ctx.s);
        if (el && document.activeElement !== el) el.value = m[f];
    }
}

function onDragMove(e) {
    if (state.stageDrag) {
        onStageDragMove(e);
        return;
    }
    const d = state.drag;
    if (!d) return;
    const m = d.ctx.model();
    if (!m) return;
    const df = Math.round((e.clientX - d.x0) / d.ppf);
    const o = d.a0;
    const dur = subSpan().dur;
    if (d.kind === 'sfx') {
        // Sound aligns relative to the Text+ bar (0 = Text+ start).
        let v = o.sfxOffset + df;
        if (Math.abs(v) <= 1) v = 0;                                // snap to Text+ start
        else if (Math.abs(o.textOffset + v) <= 1) v = -o.textOffset; // secondary snap to subtitle start
        m.sfxOffset = clamp(v, -300, 300);
    } else if (d.kind === 'sfxIn') {
        // Start of the sound: trims it (or brings back what was trimmed). The sound itself stays where it is in time.
        const q = d.g0;
        const dd = clamp(df, -q.tin, q.len - 2);
        m.sfxTrimIn = q.tin + dd;
        m.sfxOffset = clamp(o.sfxOffset + dd, -300, 300);
        if (q.mode === 'fixed') m.sfxLen = q.len - dd;       // fixed: the end stays put (estimate: it keeps following the caption)
    } else if (d.kind === 'sfxOut') {
        const q = d.g0;
        let len = clamp(q.len + df, 2, q.full - q.tin);
        if (Math.abs(q.sfxS + len - q.textE) <= 1 && q.textE - q.sfxS >= 2 && q.textE - q.sfxS <= q.full - q.tin) len = q.textE - q.sfxS;   // snap to the subtitle end
        m.sfxLen = len;
        m.sfxLenMode = 'fixed';                              // dragging the end sets a fixed length
    } else if (d.kind === 'sfxFade') {
        const q = d.g0;
        let f = clamp(q.fade - df, 0, q.len);                // dragging the corner left makes the fade longer
        if (Math.abs(f - Math.round(q.fps)) <= 1) f = Math.round(q.fps);   // snap to 1 s
        m.sfxFade = f;
    } else if (d.kind === 'vol') {
        // The line on the sound: up = louder, down = quieter (+6 dB at the top, -30 dB at the bottom)
        const bh = d.bh || 36;
        let v = Math.round((Number(d.v0) - (e.clientY - d.y0) / bh * 36) * 2) / 2;
        if (Math.abs(v) <= 0.75) v = 0;
        m.sfxVolume = clamp(v, -30, 6);
    } else if (d.kind.indexOf('lyr') === 0) {
        if (window.SASounds) SASounds.drag(d, df, e.clientY - d.y0);
    } else if (d.kind === 'text') {
        // Moving the whole Text+ bar shifts both its start and end together so its duration is preserved.
        let ts = o.textOffset + df;
        if (Math.abs(ts) <= 1) ts = 0;
        const delta = clamp(ts, -300, 300) - o.textOffset;
        m.textOffset = o.textOffset + delta;
        m.tail = clamp(o.tail + delta, -(dur - 5) - m.textOffset, 300);
        m.sfxOffset = m.linked !== false ? o.sfxOffset : clamp(o.sfxOffset - delta, -300, 300);
    } else if (d.kind === 'textStart') {
        let ts = clamp(o.textOffset + df, -300, dur + o.tail - 5);       // move the start only; the end stays put
        if (Math.abs(ts) <= 1) ts = 0;
        m.textOffset = ts;
        m.sfxOffset = m.linked !== false ? o.sfxOffset : clamp(o.sfxOffset - (ts - o.textOffset), -300, 300);
    } else if (d.kind === 'textEnd') {
        let t = clamp(o.tail + df, -(dur - 5) - o.textOffset, 300);
        if (Math.abs(t) <= 1) t = 0;
        m.tail = t;
    }
    renderTimeline(d.ctx);
}

function onDragEnd() {
    if (state.stageDrag) {
        onStageDragEnd();
        return;
    }
    const d = state.drag;
    state.drag = null;
    if (d) {
        const m = d.ctx.model();
        if (m) {
            d.ctx.changed(m);
            if (d.kind === 'vol') triggerLiveSync(m, d.ctx.s);
            if (d.kind && d.kind.startsWith('sfx')) {
                syncAttachedSfx(m);
            }
        }
        renderTimeline(d.ctx);
    }
}
