// Use tab: Effect Preset (below Text Preset). Glitch / Wiggle / Stop Motion are Resolve Fusion effects put on any clip
// (a video, a title, a placed text preset) - src/main/effect-presets.js + bridge ops fx_get / fx_set. Click an effect to
// switch it on or off for the clips selected on the timeline (or the top clip under the playhead). Several on one clip
// stack as one look (glitch -> wiggle -> stop motion). Search and the tag filter work like the Text Preset list.

const fxUI = { effects: [], search: '', clips: [], busy: false, timer: null, sig: '', sliding: false, sendTimer: null, open: {}, paramTimer: null, pending: {} };

// Strength (0..100) used when an effect is added; once on, the slider shows and sets the clip's own value.
function fxNextStrength(e) {
    try { const v = Number(localStorage.getItem('fxStrength.' + e.id)); if (localStorage.getItem('fxStrength.' + e.id) !== null && Number.isFinite(v)) return v; } catch (err) { /* no storage */ }
    return Number.isFinite(Number(e.defaultStrength)) ? Number(e.defaultStrength) : 25;
}
function fxRememberStrength(e, v) { try { localStorage.setItem('fxStrength.' + e.id, String(v)); } catch (err) { /* no storage */ } }
// the strength shown: the first target clip that has the effect, else the one used when adding
function fxStrengthShown(e) {
    for (const c of fxUI.clips) {
        const v = c.strength && c.strength[e.id];
        if (c.effects && c.effects[e.id] && Number.isFinite(Number(v))) return Number(v);
    }
    return fxNextStrength(e);
}
// ---- Glitch options (Entry > Blink at start, Colour A / B, Opacity)
const FX_PARAM_IDS = ['BlinkIn', 'ColorARed', 'ColorAGreen', 'ColorABlue', 'ColorBRed', 'ColorBGreen', 'ColorBBlue', 'Opacity'];
function fxDefaultParams(e) {
    if (e.transform) return Object.assign({}, e.transform.defaults);
    const g = e.glitch || { colorA: [1, 0, 0], colorB: [0, 1, 1], opacity: 85 };
    return { BlinkIn: 1, ColorARed: g.colorA[0], ColorAGreen: g.colorA[1], ColorABlue: g.colorA[2], ColorBRed: g.colorB[0], ColorBGreen: g.colorB[1], ColorBBlue: g.colorB[2], Opacity: g.opacity };
}
// the settings used when the effect is added (remembered per viewer)
function fxNextParams(e) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('fxParams.' + e.id) || 'null'); } catch (err) { saved = null; }
    return Object.assign(fxDefaultParams(e), saved && typeof saved === 'object' ? saved : {});
}
function fxRememberParams(e, p) { try { localStorage.setItem('fxParams.' + e.id, JSON.stringify(p)); } catch (err) { /* no storage */ } }
// shown: the first target clip that has the effect, else the ones used when adding
function fxParamsShown(e) {
    for (const c of fxUI.clips) {
        const p = c.params && c.params[e.id];
        if (c.effects && c.effects[e.id] && p) {
            const out = fxNextParams(e);
            for (const k of (e.transform ? Object.keys(e.transform.defaults) : FX_PARAM_IDS)) if (Number.isFinite(Number(p[k])) && p[k] !== null) out[k] = Number(p[k]);
            return out;
        }
    }
    return fxNextParams(e);
}
const fxHex = (r, g, b) => '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round((Number(x) || 0) * 255))).toString(16).padStart(2, '0')).join('');
const fxRgb = (hex) => [1, 3, 5].map(i => parseInt(String(hex).slice(i, i + 2), 16) / 255);

// changes go to the selected clips that have the effect (debounced), and are remembered for the next add
function fxSendParams(e, st, values, now) {
    fxRememberParams(e, Object.assign(fxNextParams(e), values));
    if (fxStateOf(e.id) === 'none') return;      // the live state (cards are updated in place, not rebuilt)
    clearTimeout(fxUI.paramTimer);
    const go = async () => {
        let r = null;
        try { r = await window.sa.fxParam(e.id, values); } catch (err) { r = { error: String(err && err.message || err) }; }
        if (r && r.error) setStatus(r.error, 'bad');
        else if (r && Array.isArray(r.clips)) { fxUI.clips = r.clips; fxUI.sig = JSON.stringify(r.clips); }
    };
    if (now) go(); else fxUI.paramTimer = setTimeout(go, 150);
}

function fxGlitchOptions(e, st) {
    const p = fxParamsShown(e);
    const d = document.createElement('details');
    d.className = 'fx-opts';
    d.open = !!fxUI.open[e.id];
    d.addEventListener('toggle', () => { fxUI.open[e.id] = d.open; });
    const sum = document.createElement('summary');
    sum.textContent = 'Options';
    d.appendChild(sum);
    const hold = (el) => {
        for (const ev of ['click', 'mousedown', 'pointerdown']) el.addEventListener(ev, (x) => x.stopPropagation());
        // only while typing / picking a colour: a slider, button or checkbox keeps the focus after use, and the card
        // must still follow the selected clips (sliders hold the rebuild with pointerdown / pointerup)
        if (el.tagName === 'INPUT' && ['number', 'text', 'color'].includes(el.type)) {
            el.addEventListener('focus', () => { fxUI.sliding = true; });
            el.addEventListener('blur', () => { fxUI.sliding = false; });
        }
    };
    // Entry
    const entry = document.createElement('div'); entry.className = 'fx-opt-head'; entry.textContent = 'Entry';
    const bl = document.createElement('label'); bl.className = 'fx-opt-row fx-check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = Number(p.BlinkIn) >= 0.5;
    hold(cb);
    cb.addEventListener('change', () => fxSendParams(e, st, { BlinkIn: cb.checked ? 1 : 0 }, true));
    bl.append(cb, document.createTextNode('Blink at start'));
    bl.title = 'The first frames flicker on and off with a glitch burst';
    // Colours
    const look = document.createElement('div'); look.className = 'fx-opt-head'; look.textContent = 'Glitch colour';
    const colRow = document.createElement('div'); colRow.className = 'fx-opt-row';
    const colour = (label, key, title) => {
        const w = document.createElement('label'); w.className = 'fx-color'; w.title = title;
        const ci = document.createElement('input'); ci.type = 'color';
        ci.value = fxHex(p[key + 'Red'], p[key + 'Green'], p[key + 'Blue']);
        hold(ci);
        const send = (now) => { const [r, g, b] = fxRgb(ci.value); fxSendParams(e, st, { [key + 'Red']: r, [key + 'Green']: g, [key + 'Blue']: b }, now); };
        ci.addEventListener('input', () => send(false));
        ci.addEventListener('change', () => { fxUI.sliding = false; send(true); });
        w.append(ci, document.createTextNode(label));
        return w;
    };
    colRow.append(colour('Right', 'ColorA', 'Colour of the copy shifted to the right'), colour('Left', 'ColorB', 'Colour of the copy shifted to the left'));
    // Opacity
    const op = document.createElement('label'); op.className = 'fx-strength';
    const cap = document.createElement('span'); cap.className = 'fx-strength-cap'; cap.textContent = 'Opacity';
    const rng = document.createElement('input'); rng.type = 'range'; rng.min = '0'; rng.max = '100'; rng.step = '1'; rng.value = String(p.Opacity);
    const val = document.createElement('span'); val.className = 'fx-strength-val'; val.textContent = Math.round(p.Opacity) + '%';
    hold(rng);
    rng.addEventListener('pointerdown', () => { fxUI.sliding = true; });
    for (const ev of ['pointerup', 'pointercancel']) rng.addEventListener(ev, () => { fxUI.sliding = false; });
    rng.addEventListener('input', () => { val.textContent = rng.value + '%'; fxSendParams(e, st, { Opacity: Number(rng.value) }, false); });
    rng.addEventListener('change', () => fxSendParams(e, st, { Opacity: Number(rng.value) }, true));
    op.title = 'How strong the coloured fringes are';
    op.append(cap, rng, val);
    d.append(entry, bl, look, colRow, op);
    for (const ev of ['click', 'mousedown', 'pointerdown']) d.addEventListener(ev, (x) => x.stopPropagation());
    return d;
}

// The easing curves of the Transform effect, in the order of its Ease list (same formulas as effect-presets.js easeExpr)
const FX_EASE_FNS = (() => {
    const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1;
    return [
        u => u,
        u => u * u,
        u => 1 - (1 - u) ** 2,
        u => u < 0.5 ? 2 * u * u : 1 - (2 - 2 * u) ** 2 / 2,
        u => u ** 4,
        u => 1 - (1 - u) ** 4,
        u => u < 0.5 ? 8 * u ** 4 : 1 - (2 - 2 * u) ** 4 / 2,
        u => u <= 0 ? 0 : 2 ** (10 * u - 10),
        u => u >= 1 ? 1 : 1 - 2 ** (-10 * u),
        u => u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 2 ** (20 * u - 10) / 2 : (2 - 2 ** (10 - 20 * u)) / 2,
        u => c3 * u ** 3 - c1 * u * u,
        u => 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2,
        u => u < 0.5 ? (2 * u) ** 2 * ((c2 + 1) * 2 * u - c2) / 2 : ((2 * u - 2) ** 2 * ((c2 + 1) * (2 * u - 2) + c2) + 2) / 2
    ];
})();
// a small chart of one curve: faint start / end lines, the curve (Back curves go past them)
function fxEaseSvg(i, w, h) {
    const NS = 'http://www.w3.org/2000/svg';
    const f = FX_EASE_FNS[i] || FX_EASE_FNS[0];
    const pad = 3, top = h * 0.22, bot = h * 0.78;      // room above / below for the Back overshoot
    const y = v => bot - v * (bot - top);
    const pts = [];
    for (let k = 0; k <= 40; k++) { const u = k / 40; pts.push((pad + u * (w - 2 * pad)).toFixed(1) + ',' + y(f(u)).toFixed(1)); }
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('class', 'fx-ease-svg'); svg.setAttribute('aria-hidden', 'true');
    for (const v of [0, 1]) {
        const ln = document.createElementNS(NS, 'line');
        ln.setAttribute('x1', pad); ln.setAttribute('x2', w - pad); ln.setAttribute('y1', y(v)); ln.setAttribute('y2', y(v));
        ln.setAttribute('class', 'fx-ease-guide');
        svg.appendChild(ln);
    }
    const pl = document.createElementNS(NS, 'polyline');
    pl.setAttribute('points', pts.join(' ')); pl.setAttribute('class', 'fx-ease-curve');
    svg.appendChild(pl);
    return svg;
}

// ---- Transform Start / End: a bar from the clip's first to its last frame with a start head (hollow) and an end head
// (solid), the move between them (drag it to shift the move), and Resolve's playhead (red, from the timing bar's poll,
// anim-timing.js tmState.frame). Heads snap to the playhead; End on the last frame is stored as 0 ("the last frame"),
// so a trimmed clip keeps the move to its end. Keys: arrows 1 frame (Shift 5), Alt moves both, S / E pick, P = playhead.
const FXR_SNAP_PX = 10, FXR_HEAD_PX = 10;
function fxPlayheadIn(clip) {
    const f = typeof tmState !== 'undefined' ? tmState.frame : undefined;
    if (!clip || !Number.isFinite(f) || !Number.isFinite(Number(clip.start))) return null;
    const rel = f - Number(clip.start);
    return rel >= 0 && rel < Number(clip.frames) ? rel : null;
}
function fxFrameRange(e, st, p, clip, last) {
    if (!last) {
        const box = document.createElement('div'); box.className = 'fxr fxr-off';
        box.title = 'Select a clip on the timeline to set where the move starts and ends';
        const bar = document.createElement('div'); bar.className = 'fxr-bar';
        for (const c of ['fxr-track', 'fxr-range', 'fxr-knob fxr-start', 'fxr-knob fxr-end']) { const x = document.createElement('div'); x.className = c; bar.appendChild(x); }
        bar.children[1].style.cssText = 'left:0;width:100%'; bar.children[2].style.left = '0%'; bar.children[3].style.left = '100%';
        const read = document.createElement('div'); read.className = 'fxr-read'; read.textContent = 'Start / End: select a clip';
        box.append(bar, read);
        return box;
    }
    const r = { s: Math.max(0, Math.min(last - 1, Math.round(Number(p.InF)) || 0)), e: 0 };
    const out = Math.round(Number(p.OutF)) || 0;
    r.e = Math.max(r.s + 1, Math.min(last, out > 0 ? out : last));
    let active = 'e', drag = null, sendT = null;
    const box = document.createElement('div'); box.className = 'fxr';
    const bar = document.createElement('div'); bar.className = 'fxr-bar'; bar.tabIndex = 0;
    bar.title = 'Drag a head to set where the move starts or ends, drag between them to shift it. Snaps to the playhead (P). Double-click: the whole clip';
    const mk = (cls, parent) => { const x = document.createElement('div'); x.className = cls; (parent || bar).appendChild(x); return x; };
    mk('fxr-track');
    const range = mk('fxr-range');
    const ph = mk('fxr-ph hidden');
    const phLab = document.createElement('span'); ph.appendChild(phLab);
    const hs = mk('fxr-knob fxr-start'), he = mk('fxr-knob fxr-end');
    const read = document.createElement('div'); read.className = 'fxr-read';
    box.append(bar, read);
    const pct = (f) => (Math.max(0, Math.min(1, f / last)) * 100) + '%';
    const paint = () => {
        range.style.left = pct(r.s); range.style.width = ((r.e - r.s) / last * 100) + '%';
        hs.style.left = pct(r.s); he.style.left = pct(r.e);
        hs.classList.toggle('on', active !== 'e'); he.classList.toggle('on', active !== 's');
        const at = fxPlayheadIn(clip);
        ph.classList.toggle('hidden', at === null);
        if (at !== null) { ph.style.left = pct(at); phLab.textContent = String(at); }
        read.innerHTML = 'Start <b>' + r.s + '</b> · End <b>' + r.e + '</b>' + (r.e >= last ? ' (last)' : '') + ' <span class="fxr-len">/ ' + last + ' f</span>';
    };
    const glide = () => { bar.classList.add('glide'); clearTimeout(bar._g); bar._g = setTimeout(() => bar.classList.remove('glide'), 220); };
    const send = (now) => {
        clearTimeout(sendT);
        const v = { InF: r.s, OutF: r.e >= last ? 0 : r.e };
        if (now) fxSendParams(e, st, v, true); else sendT = setTimeout(() => fxSendParams(e, st, v, false), 60);
    };
    const apply = (part, v) => {
        v = Math.round(v);
        if (part === 'm') { const d = r.e - r.s; r.s = Math.max(0, Math.min(last - d, v)); r.e = r.s + d; }
        else if (part === 's') r.s = Math.max(0, Math.min(r.e - 1, v));
        else r.e = Math.max(r.s + 1, Math.min(last, v));
    };
    const frameAt = (x, part, grab) => {
        const b = bar.getBoundingClientRect();
        const px = Math.max(0, Math.min(b.width, x - b.left));
        let f = Math.round(px / b.width * last) - (part === 'm' ? grab : 0);
        const at = fxPlayheadIn(clip);
        let snap = false;
        if (at !== null) {
            const toPx = (q) => q / last * b.width;
            const edges = part === 'm' ? [[0, f], [r.e - r.s, f + r.e - r.s]] : [[0, f]];
            let best = FXR_SNAP_PX + 1;
            for (const [off, q] of edges) { const d = Math.abs(toPx(q) - toPx(at)); if (d <= FXR_SNAP_PX && d < best) { best = d; f = at - off; snap = true; } }
        }
        return { f, snap };
    };
    for (const ev of ['click', 'mousedown']) bar.addEventListener(ev, (x) => x.stopPropagation());
    bar.addEventListener('pointerdown', (x) => {
        if (x.button !== 0) return;
        x.stopPropagation();
        bar.setPointerCapture(x.pointerId); bar.focus();
        fxUI.sliding = true;
        const b = bar.getBoundingClientRect(), px = x.clientX - b.left, toPx = (q) => q / last * b.width;
        const dS = Math.abs(px - toPx(r.s)), dE = Math.abs(px - toPx(r.e));
        let part;
        if (Math.min(dS, dE) <= FXR_HEAD_PX) part = dS < dE || (dS === dE && px < toPx(r.s)) ? 's' : 'e';
        else if (px > toPx(r.s) && px < toPx(r.e)) part = 'm';
        else part = dS < dE ? 's' : 'e';
        drag = { part, grab: part === 'm' ? Math.round(px / b.width * last) - r.s : 0, snap: false };
        active = part;
        bar.classList.add('dragging');
        if (part !== 'm') { const q = frameAt(x.clientX, part, 0); drag.snap = q.snap; apply(part, q.f); glide(); send(false); }
        paint();
    });
    bar.addEventListener('pointermove', (x) => {
        if (!drag) return;
        const q = frameAt(x.clientX, drag.part, drag.grab);
        if (q.snap !== drag.snap) glide();
        drag.snap = q.snap;
        ph.classList.toggle('hot', q.snap);
        const before = r.s + ':' + r.e;
        apply(drag.part, q.f);
        if (r.s + ':' + r.e !== before) { paint(); send(false); }
    });
    const end = (x) => {
        if (!drag) return;
        try { bar.releasePointerCapture(x.pointerId); } catch (err) { /* ignore */ }
        drag = null; fxUI.sliding = false;
        bar.classList.remove('dragging'); ph.classList.remove('hot');
        glide(); paint(); send(true);
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('dblclick', () => { r.s = 0; r.e = last; glide(); paint(); send(true); });
    bar.addEventListener('keydown', (x) => {
        const step = x.shiftKey ? 5 : 1;
        let part = x.altKey ? 'm' : (active === 's' ? 's' : 'e');
        const base = part === 'e' ? r.e : r.s;
        let v = null;
        if (x.key === 'ArrowLeft') v = base - step;
        else if (x.key === 'ArrowRight') v = base + step;
        else if (x.key === 'Home') v = 0;
        else if (x.key === 'End') v = part === 'm' ? last - (r.e - r.s) : last;
        else if (x.key === 's' || x.key === 'S') { active = 's'; paint(); return; }
        else if (x.key === 'e' || x.key === 'E') { active = 'e'; paint(); return; }
        else if (x.key === 'p' || x.key === 'P') { v = fxPlayheadIn(clip); if (part === 'm') part = 's'; }
        if (v === null || v === undefined) return;
        x.preventDefault(); x.stopPropagation();
        apply(part, v); glide(); paint(); send(true);
    });
    // the playhead follows Resolve while the bar is on screen
    const tick = () => { if (!box.isConnected) return; if (!drag) { const at = fxPlayheadIn(clip); ph.classList.toggle('hidden', at === null); if (at !== null) { ph.style.left = pct(at); phLab.textContent = String(at); } } setTimeout(tick, 150); };
    paint();
    setTimeout(tick, 150);
    return box;
}

// ---- Transform: Zoom % / Left-Right % / Up-Down % (where it ends), easing curve, Reverse, Length
function fxTransformOptions(e, st) {
    const p = fxParamsShown(e);
    const d = document.createElement('details');
    d.className = 'fx-opts';
    d.open = fxUI.open[e.id] !== undefined ? !!fxUI.open[e.id] : true;
    d.addEventListener('toggle', () => { fxUI.open[e.id] = d.open; });
    const sum = document.createElement('summary');
    sum.textContent = 'Options';
    d.appendChild(sum);
    const hold = (el) => {
        for (const ev of ['click', 'mousedown', 'pointerdown']) el.addEventListener(ev, (x) => x.stopPropagation());
        // only while typing / picking a colour: a slider, button or checkbox keeps the focus after use, and the card
        // must still follow the selected clips (sliders hold the rebuild with pointerdown / pointerup)
        if (el.tagName === 'INPUT' && ['number', 'text', 'color'].includes(el.type)) {
            el.addEventListener('focus', () => { fxUI.sliding = true; });
            el.addEventListener('blur', () => { fxUI.sliding = false; });
        }
    };
    const slider = (key, label, min, max, fmt, title) => {
        const row = document.createElement('label'); row.className = 'fx-strength'; row.title = title;
        const cap = document.createElement('span'); cap.className = 'fx-strength-cap'; cap.textContent = label;
        const rng = document.createElement('input'); rng.type = 'range'; rng.min = String(min); rng.max = String(max); rng.step = '1'; rng.value = String(p[key]);
        const val = document.createElement('span'); val.className = 'fx-strength-val'; val.textContent = fmt(Number(p[key]));
        hold(rng);
        rng.addEventListener('pointerdown', () => { fxUI.sliding = true; });
        for (const ev of ['pointerup', 'pointercancel']) rng.addEventListener(ev, () => { fxUI.sliding = false; });
        rng.addEventListener('input', () => { val.textContent = fmt(Number(rng.value)); fxSendParams(e, st, { [key]: Number(rng.value) }, false); });
        rng.addEventListener('change', () => fxSendParams(e, st, { [key]: Number(rng.value) }, true));
        rng.addEventListener('dblclick', () => {
            const v = e.transform.defaults[key];
            rng.value = String(v); val.textContent = fmt(v); fxSendParams(e, st, { [key]: v }, true);
        });
        row.append(cap, rng, val);
        return row;
    };
    const signed = (v) => (v > 0 ? '+' : '') + Math.round(v) + '%';
    const zoom = slider('ZoomPct', 'Zoom', 50, 200, v => Math.round(v) + '%', 'Zoom at the end of the move (100% = no zoom, 120% = push in, 80% = pull out)');
    const mx = slider('MoveX', 'Left / Right', -50, 50, signed, 'Moves the picture sideways, in percent of the frame (+ = right, - = left)');
    const my = slider('MoveY', 'Up / Down', -50, 50, signed, 'Moves the picture up or down, in percent of the frame (+ = up, - = down)');
    // easing curve: a button with the current curve; click = a grid of every curve (drawn like easings.net)
    const er = document.createElement('div'); er.className = 'fx-opt-row'; er.title = 'How the move speeds up and slows down';
    const ec = document.createElement('span'); ec.className = 'fx-strength-cap'; ec.textContent = 'Ease';
    let cur = Math.round(Number(p.Ease)) || 0;
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'fx-ease-btn';
    const paint = () => { btn.textContent = ''; btn.append(fxEaseSvg(cur, 34, 22), document.createTextNode(e.transform.eases[cur] || 'Linear')); };
    paint();
    hold(btn);
    btn.addEventListener('click', () => {
        openPop(btn, 'fx-ease-pop', (el) => {
            e.transform.eases.forEach((n, i) => {
                const it = document.createElement('button');
                it.type = 'button';
                it.className = 'fx-ease-tile' + (i === cur ? ' on' : '');
                it.title = n;
                const lab = document.createElement('span'); lab.textContent = n.replace(/^Ease /, '');
                it.append(lab, fxEaseSvg(i, 84, 54));
                it.addEventListener('click', () => {
                    cur = i; paint(); closePop();
                    fxSendParams(e, st, { Ease: i }, true);
                });
                el.appendChild(it);
            });
        });
    });
    er.append(ec, btn);
    // Start / End: clip frames the move runs between (Start 0 = the first frame, End = the last frame by default; the
    // effect stores End 0 for "the last frame", so it follows a trimmed clip)
    // the clip with the effect, else the first selected clip (the bar sets the values used when adding it)
    const clip = fxUI.clips.find(c => c.effects && c.effects[e.id] && Number(c.frames) > 0) || fxUI.clips.find(c => Number(c.frames) > 1);
    const last = clip ? Number(clip.frames) - 1 : null;
    const rr = document.createElement('div'); rr.className = 'fx-opt-row';
    // a clip with the effect selected: Start / End as a range bar like the Animation timing bar (playhead included);
    // no clip yet: the number boxes, remembered for the next add
    // no clip selected: the same bar, greyed, until one is
    rr.appendChild(last !== null && last > 0 ? fxFrameRange(e, st, p, clip, last) : fxFrameRange(e, st, p, null, 0));
    // reverse
    const rv = document.createElement('div'); rv.className = 'fx-opt-row';
    const rl = document.createElement('label'); rl.className = 'fx-check'; rl.title = 'Start at the values above and end neutral (zoom out / move back)';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = Number(p.Reverse) >= 0.5;
    hold(cb);
    cb.addEventListener('change', () => fxSendParams(e, st, { Reverse: cb.checked ? 1 : 0 }, true));
    rl.append(cb, document.createTextNode('Reverse'));
    rv.appendChild(rl);
    d.append(zoom, mx, my, er, rr, rv);
    for (const ev of ['click', 'mousedown', 'pointerdown']) d.addEventListener(ev, (x) => x.stopPropagation());
    return d;
}

function fxStrengthLabel(v, e) { return e && e.repeat ? Math.round(v) + ' fr' : (v <= 0 ? 'Off' : String(Math.round(v))); }

function fxTagsOf(e) {
    const t = (state.lib && state.lib.effectTags) || {};
    return Array.isArray(t[e.id]) ? t[e.id] : [];
}

// target clips that already have this effect as a node in their own Fusion graph (dragged in by hand): the panel does
// not add it on top (it would run twice)
function fxInNodes(id) { return fxUI.clips.filter(c => Array.isArray(c.inNodes) && c.inNodes.includes(id)); }

// "Glitch" on all of the target clips / some of them / none
function fxStateOf(id) {
    const n = fxUI.clips.length;
    if (!n) return 'none';
    const on = fxUI.clips.filter(c => c.effects && c.effects[id]).length;
    return on === n ? 'on' : (on ? 'some' : 'none');
}

// The cards are built once per shown list (search / tags / effects) and then updated in place, like the Clip controls:
// the switch, status, notes and Strength follow the selected clips; an Options block is rebuilt only when what it shows
// changed (its own values, or the clip it is for), keeping its open / closed state.
function renderEffects() {
    const grid = $('fxGrid');
    if (!grid || fxUI.sliding) return;      // never touch a slider being dragged
    renderTagFilter('fx', 'fxFilter');
    const q = fxUI.search.trim().toLowerCase();
    const shown = fxUI.effects.filter(e => {
        if (!passesTagFilter({ tags: fxTagsOf(e) }, 'fx')) return false;
        if (q && !(e.name.toLowerCase().includes(q) || (e.tags || []).some(t => t.includes(q)))) return false;
        return true;
    });
    const n = fxUI.effects.length;
    $('fxCount').textContent = n ? (shown.length !== n ? shown.length + ' of ' + n : n + ' effects') : '';
    const target = $('fxTarget');
    if (target) {
        const names = fxUI.clips.map(c => c.name || 'clip');
        const t = names.length
            ? 'Applies to: ' + (names.length > 3 ? names.slice(0, 3).join(', ') + ' +' + (names.length - 3) : names.join(', '))
            : 'Select a clip on the timeline (video, title or text preset)';
        if (target.textContent !== t) target.textContent = t;
    }
    const layout = shown.map(e => e.id + ':' + fxTagsOf(e).join('.')).join(',') + '|' + (shown.length ? '' : q + '|' + n);
    if (grid.dataset.layout !== layout || !grid.querySelector('.fx-card') !== !shown.length) {
        grid.dataset.layout = layout;
        grid.textContent = '';
        if (!shown.length) {
            const d = document.createElement('div');
            d.className = 'empty';
            d.textContent = n ? (q ? 'No effect presets matching "' + fxUI.search.trim() + '".' : 'No effect presets have the selected tags.') : 'Loading effects…';
            grid.appendChild(d);
            return;
        }
        for (const e of shown) grid.appendChild(fxBuildCard(e));
    }
    for (const c of grid.querySelectorAll('.fx-card')) {
        const e = fxUI.effects.find(x => x.id === c.dataset.id);
        if (e) fxFillCard(c, e);
    }
}

// The parts of a card that never change; the rest is set by fxFillCard.
function fxBuildCard(e) {
    const c = document.createElement('div');
    c.className = 'card fx-card';
    c.dataset.id = e.id;
    const sw = document.createElement('span');
    sw.className = 'fx-switch';
    sw.setAttribute('role', 'switch');
    const nm = document.createElement('div');
    nm.className = 'nm'; nm.textContent = e.name;
    const sub = document.createElement('div');
    sub.className = 'sub';
    c.append(sw, nm, sub);
    let note = null;
    if ((e.noStrength || e.repeat) && !e.transform) {
        note = document.createElement('div');
        note.className = 'fx-note';
        c.appendChild(note);
    }
    // Strength: 0 = no effect, default = a light, visible look
    const row = document.createElement('label');
    if (e.noStrength) row.style.display = 'none';
    row.className = 'fx-strength';
    const cap = document.createElement('span'); cap.className = 'fx-strength-cap'; cap.textContent = e.repeat ? 'Frame Repeat' : 'Strength';
    const rng = document.createElement('input');
    rng.type = 'range'; rng.min = e.repeat ? '1' : '0'; rng.max = e.repeat ? '10' : '100'; rng.step = '1';
    const val = document.createElement('span'); val.className = 'fx-strength-val';
    const live = () => fxStateOf(e.id) !== 'none';
    for (const ev of ['click', 'mousedown', 'pointerdown']) row.addEventListener(ev, (x) => x.stopPropagation());
    rng.addEventListener('pointerdown', () => { fxUI.sliding = true; });
    for (const ev of ['pointerup', 'pointercancel', 'blur']) rng.addEventListener(ev, () => { fxUI.sliding = false; });
    rng.addEventListener('input', () => {
        const v = Number(rng.value);
        val.textContent = fxStrengthLabel(v, e);
        fxRememberStrength(e, v);
        if (live()) fxSendStrength(e, v);
    });
    rng.addEventListener('change', () => { fxUI.sliding = false; if (live()) fxSendStrength(e, Number(rng.value), true); });
    rng.addEventListener('dblclick', () => {
        const d = Number(e.defaultStrength) || 25;
        rng.value = String(d); val.textContent = fxStrengthLabel(d, e); fxRememberStrength(e, d);
        if (live()) fxSendStrength(e, d, true);
    });
    row.append(cap, rng, val);
    c.appendChild(row);
    const optsAt = document.createElement('div');
    optsAt.className = 'fx-opts-slot';
    optsAt.style.display = 'contents';
    c.appendChild(optsAt);
    const dots = tagDotsEl({ tags: fxTagsOf(e) });
    if (dots) c.appendChild(dots);
    c.addEventListener('click', () => fxToggle(e));
    c.addEventListener('contextmenu', (ev) => { ev.preventDefault(); fxTagMenu(c, e); });
    c._fx = { sw, sub, note, row, rng, val, optsAt, optsSig: null };
    return c;
}

const fxPut = (el, prop, v) => { if (el[prop] !== v) el[prop] = v; };
function fxFillCard(c, e) {
    const f = c._fx;
    const st = fxStateOf(e.id);
    const cls = 'card fx-card' + (st === 'on' ? ' fx-on' : (st === 'some' ? ' fx-some' : '')) + (fxUI.pending[e.id] ? ' fx-pending' : '');
    fxPut(c, 'className', cls);
    const nodeClips = fxInNodes(e.id);
    // dragged in as a node AND switched on here (the node went in after): it runs twice - click the card to remove this one
    const twice = nodeClips.some(x => x.effects && x.effects[e.id]);
    let title = e.tip + (st === 'on' ? '\nClick to remove it from the selected clip(s)' : '\nClick to add it to the selected clip(s)');
    if (twice) title += '\nAlso a node in the clip\'s Fusion graph, so it runs twice: click to remove the panel one';
    if (nodeClips.length) title += '\nAlready a node in the Fusion graph of: ' + nodeClips.map(x => x.name).join(', ') + ' (not added again there)';
    fxPut(c, 'title', title);
    const aria = st === 'on' ? 'true' : (st === 'some' ? 'mixed' : 'false');
    if (f.sw.getAttribute('aria-checked') !== aria) f.sw.setAttribute('aria-checked', aria);
    fxPut(f.sub, 'textContent', twice ? 'Twice!' : (st === 'on' ? 'On' : (st === 'some' ? 'Some' : (nodeClips.length ? 'In nodes' : ''))));
    f.sub.classList.toggle('fx-twice', twice);
    if (f.note) {
        // zoomed / panned clips get DaVinci's OFX Stop Motion, whose Frame Repeat only Resolve's Inspector can set
        const ofx = fxUI.clips.some(x => x.stopMotionKind === 'ofx');
        fxPut(f.note, 'textContent', e.repeat
            ? (ofx ? 'A zoomed / panned clip uses DaVinci\'s Stop Motion: set the same Frame Repeat in Resolve\'s Inspector → Effects'
                : 'Holds the finished look, glitch / wiggle included')
            : 'DaVinci\'s Stop Motion: set Frame Repeat in Resolve\'s Inspector → Effects');
    }
    fxPut(f.row, 'title', (e.repeat
        ? 'Frame Repeat: each picture (and the glitch / wiggle on it) is held this many frames. ' + (e.defaultStrength || 2) + ' = default'
        : 'Strength: 0 = no effect, ' + (e.defaultStrength || 25) + ' = default (light), 100 = strongest') +
        (st === 'none' ? '\nUsed when you add it' : ''));
    if (!f.rng.matches(':active')) {      // (a slider keeps the focus after use: only a press holds it)
        const v0 = fxStrengthShown(e);
        fxPut(f.rng, 'value', String(v0));
        fxPut(f.val, 'textContent', fxStrengthLabel(v0, e));
    }
    // Options: rebuilt only when what they show changed, and never while one of their fields is being typed in
    if (e.glitch || e.transform) {
        const clip = e.transform ? (fxUI.clips.find(x => x.effects && x.effects[e.id] && Number(x.frames) > 0) || fxUI.clips.find(x => Number(x.frames) > 1)) : null;
        const sig = JSON.stringify([fxParamsShown(e), clip ? [clip.id, clip.frames, clip.start] : null]);
        const ae = document.activeElement;
        const typing = !!ae && f.optsAt.contains(ae) && ae.tagName === 'INPUT' && ['number', 'text', 'color'].includes(ae.type);
        if (sig !== f.optsSig && !typing) {
            f.optsSig = sig;
            f.optsAt.textContent = '';
            f.optsAt.appendChild(e.glitch ? fxGlitchOptions(e, st) : fxTransformOptions(e, st));
        }
    }
}

// Click: the card flips straight away (optimistic) and the change goes to Resolve on the fast lane; if Resolve refuses,
// the card flips back. Each effect has its own pending flag, so other cards stay clickable meanwhile.
async function fxToggle(e) {
    if (fxUI.pending[e.id]) return;
    if (!fxUI.clips.length) await fxRefresh(true);
    if (!fxUI.clips.length) { setStatus('Select a clip on the timeline first.', 'bad'); return; }
    const want = fxStateOf(e.id) !== 'on';
    // every target clip already has it as a node in its own graph: nothing to add (it would run twice)
    if (want && fxInNodes(e.id).length === fxUI.clips.length) {
        setStatus(e.name + ' is already a node in ' + (fxUI.clips.length === 1 ? 'this clip\'s' : 'these clips\'') + ' Fusion graph - not added again.', 'bad');
        return;
    }
    const before = fxUI.clips;
    fxUI.clips = before.map(c => Object.assign({}, c, { effects: Object.assign({}, c.effects || {}, { [e.id]: want }) }));
    if (!want) for (const c of fxUI.clips) delete c.effects[e.id];
    fxUI.pending[e.id] = true;
    renderEffects();
    let r = null;
    // the Stop Motion Frame Repeat the clip's glitch / wiggle hold for (the bridge uses it only while Stop Motion is on)
    const sm = fxUI.effects.find(x => x.repeat);
    const hold = sm ? fxStrengthShown(sm) : null;
    try { r = await window.sa.fxSet(e.id, want, want && !e.noStrength ? fxNextStrength(e) : null, want && (e.glitch || e.transform) ? fxNextParams(e) : null, hold); } catch (err) { r = { error: String(err && err.message || err) }; }
    delete fxUI.pending[e.id];
    if (!r || r.busy || r.error) {
        fxUI.clips = before;
        setStatus(r && r.busy ? 'Busy placing - try again in a moment.' : ((r && r.error) || 'Could not change the effect'), 'bad');
    } else {
        if (Array.isArray(r.clips)) { fxUI.clips = r.clips; fxUI.sig = JSON.stringify(r.clips); }
        const n = fxUI.clips.length;
        if (r.failed && r.failed.length) setStatus(e.name + ' could not be changed on ' + r.failed.join(', '), 'bad');
        else if (r.inNodes && r.inNodes.length) setStatus(e.name + ' skipped on ' + r.inNodes.join(', ') + ': already a node in its Fusion graph.', 'bad');
        else setStatus(e.name + (r.on ? ' added to ' : ' removed from ') + n + ' clip' + (n === 1 ? '' : 's') + '.', 'ok');
    }
    renderEffects();
}

// Live strength while dragging (at most every 120 ms), and once more on release.
function fxSendStrength(e, v, now) {
    clearTimeout(fxUI.sendTimer);
    const go = async () => {
        let r = null;
        try { r = await window.sa.fxStrength(e.id, v); } catch (err) { r = { error: String(err && err.message || err) }; }
        if (r && r.error) setStatus(r.error, 'bad');
        else if (r && Array.isArray(r.clips)) { fxUI.clips = r.clips; fxUI.sig = JSON.stringify(r.clips); }
    };
    if (now) go(); else fxUI.sendTimer = setTimeout(go, 120);
}

// right-click: the same tags as the text presets
function fxTagMenu(anchor, e) {
    openPop(anchor, 'pop-menu', (el) => {
        const head = document.createElement('div');
        head.className = 'pop-title'; head.textContent = 'Tags';
        el.appendChild(head);
        if (!allTags().length) {
            const x = document.createElement('div');
            x.className = 'pop-empty'; x.textContent = 'No tags yet (make them on the Library tab)';
            el.appendChild(x);
        }
        for (const t of allTags()) {
            const it = document.createElement('button');
            it.className = 'pop-item' + (fxTagsOf(e).includes(t.id) ? ' on' : '');
            const ck = document.createElement('span'); ck.className = 'pop-check'; ck.textContent = '✓';
            const n = document.createElement('span'); n.className = 'pop-label'; n.textContent = t.name;
            it.append(ck, tagMarkEl(t), n);
            it.addEventListener('click', async () => {
                const mine = fxTagsOf(e);
                const next = mine.includes(t.id) ? mine.filter(x => x !== t.id) : mine.concat(t.id);
                takeLib(await window.sa.fxSetTags(e.id, next));
                it.classList.toggle('on', next.includes(t.id));
            });
            el.appendChild(it);
        }
    });
}

// The effects on the selected clips, read while the Use tab is showing and the panel is not busy.
async function fxRefresh(force) {
    if (state.busy || (!force && Object.keys(fxUI.pending).length)) return;
    let r = null;
    try { r = await window.sa.fxGet(); } catch (e) { r = null; }
    if (!r || r.busy || r.error || !Array.isArray(r.clips)) return;
    if (!force && Object.keys(fxUI.pending).length) return;      // a toggle started meanwhile: its own answer wins
    const sig = JSON.stringify(r.clips);
    if (sig === fxUI.sig) return;
    fxUI.sig = sig;
    fxUI.clips = r.clips;
    renderEffects();
}
// The toggles follow the clips selected in Resolve (what is on them, added here or dragged in from Resolve's Effects),
// also while Resolve has the focus - that is where clips get selected. Paced like the Clip controls: 700 ms while the
// selection or its effects change, 1500 ms once nothing has changed for 3 s (fxGet backs off when Resolve is busy).
const fxPace = { sig: '', changedAt: 0 };
function fxPoll() {
    clearTimeout(fxUI.timer);
    const calm = Date.now() - fxPace.changedAt > 3000;
    fxUI.timer = setTimeout(async () => {
        if (!document.hidden && state.tab === 'apply' && !state.idle) {
            await fxRefresh();
            if (fxUI.sig !== fxPace.sig) { fxPace.sig = fxUI.sig; fxPace.changedAt = Date.now(); }
        }
        fxPoll();
    }, calm ? 1500 : 700);
}

async function initEffects() {
    try { const r = await window.sa.fxList(); fxUI.effects = (r && r.effects) || []; } catch (e) { fxUI.effects = []; }
    const input = $('fxSearch'), clear = $('fxSearchClear');
    if (input) {
        input.addEventListener('input', () => { fxUI.search = input.value; if (clear) clear.classList.toggle('hidden', !fxUI.search); renderEffects(); });
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { input.value = ''; fxUI.search = ''; if (clear) clear.classList.add('hidden'); renderEffects(); } });
    }
    if (clear) clear.addEventListener('click', () => { if (input) { input.value = ''; input.focus(); } fxUI.search = ''; clear.classList.add('hidden'); renderEffects(); });
    window.addEventListener('focus', () => { if (state.tab === 'apply') fxRefresh(); });
    renderEffects();
    fxPoll();
}
