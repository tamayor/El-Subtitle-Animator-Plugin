// Use tab: Effect Preset (below Text Preset). Glitch / Wiggle / Stop Motion are Resolve Fusion effects put on any clip
// (a video, a title, a placed text preset) - src/main/effect-presets.js + bridge ops fx_get / fx_set. Click an effect to
// switch it on or off for the clips selected on the timeline (or the top clip under the playhead). Several on one clip
// stack as one look (glitch -> wiggle -> stop motion). Search and the tag filter work like the Text Preset list.

const fxUI = { effects: [], search: '', clips: [], busy: false, timer: null, sig: '', sliding: false, sendTimer: null, open: {}, show: {}, paramTimer: null, pending: {} };

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
// ---- Glitch options (Entry > Blink at start, Duration, Colour A / B, Opacity)
const FX_PARAM_IDS = ['BlinkIn', 'ColorARed', 'ColorAGreen', 'ColorABlue', 'ColorBRed', 'ColorBGreen', 'ColorBBlue', 'Opacity', 'Dur'];
function fxDefaultParams(e) {
    if (e.transform) return Object.assign({}, e.transform.defaults);
    if (e.track) return Object.assign({}, e.track.defaults);
    const g = e.glitch || { colorA: [1, 0, 0], colorB: [0, 1, 1], opacity: 85, duration: 0 };
    return { BlinkIn: 1, ColorARed: g.colorA[0], ColorAGreen: g.colorA[1], ColorABlue: g.colorA[2], ColorBRed: g.colorB[0], ColorBGreen: g.colorB[1], ColorBBlue: g.colorB[2], Opacity: g.opacity, Dur: g.duration || 0, Sfx: 1 };
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
            for (const k of (e.transform ? Object.keys(e.transform.defaults) : (e.track ? Object.keys(e.track.defaults) : FX_PARAM_IDS))) if (Number.isFinite(Number(p[k])) && p[k] !== null) out[k] = Number(p[k]);
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
    // Duration (frames from the clip start, 0 = the whole clip)
    const du = document.createElement('label'); du.className = 'fx-strength';
    const dcap = document.createElement('span'); dcap.className = 'fx-strength-cap'; dcap.textContent = 'Duration';
    const drng = document.createElement('input'); drng.type = 'range'; drng.min = '0'; drng.max = '120'; drng.step = '1'; drng.value = String(Math.round(Number(p.Dur) || 0));
    const dval = document.createElement('span'); dval.className = 'fx-strength-val';
    const dtxt = (v) => Number(v) > 0 ? v + 'f' : 'All';
    dval.textContent = dtxt(drng.value);
    hold(drng);
    drng.addEventListener('pointerdown', () => { fxUI.sliding = true; });
    for (const ev of ['pointerup', 'pointercancel']) drng.addEventListener(ev, () => { fxUI.sliding = false; });
    drng.addEventListener('input', () => { dval.textContent = dtxt(drng.value); fxSendParams(e, st, { Dur: Number(drng.value) }, false); });
    drng.addEventListener('change', () => fxSendParams(e, st, { Dur: Number(drng.value) }, true));
    du.title = 'How many frames the glitch lasts from the start of the clip, then it stops. All (0) = the whole clip';
    du.append(dcap, drng, dval);
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
    // Sound effect (the glitch sound put on the timeline with the effect; unticked = no sound, existing ones removed)
    const sfxHead = document.createElement('div'); sfxHead.className = 'fx-opt-head'; sfxHead.textContent = 'Sound';
    const sl = document.createElement('label'); sl.className = 'fx-opt-row fx-check';
    const scb = document.createElement('input'); scb.type = 'checkbox'; scb.checked = Number(p.Sfx) !== 0;
    hold(scb);
    scb.addEventListener('change', () => fxSendParams(e, st, { Sfx: scb.checked ? 1 : 0 }, true));
    sl.append(scb, document.createTextNode('SFX'));
    sl.title = 'Put the glitch sound effect on the timeline with this effect. Untick to leave it out (the sound already on the selected clips is removed)';
    d.append(entry, bl, du, look, colRow, op, sfxHead, sl);
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
        const temp = fxUI.clips.some(c => c.temp);
        const t2 = temp ? 'Temporary preview text preset selected - effects are not allowed on it' : t;
        target.classList.toggle('fx-target-warn', temp);
        if (target.textContent !== t2) target.textContent = t2;
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

// Each effect card shows only its switch and name until it is in use: its Strength slider and Options open when the
// effect is on or you click the card, and close again (the effect stays on) once the card scrolls out of view.
function fxIsShut(id, st) { return fxUI.show[id] === undefined ? st === 'none' : !fxUI.show[id]; }
function fxShow(id, open) {
    fxUI.show[id] = !!open;
    const c = document.querySelector('#fxGrid .fx-card[data-id="' + id + '"]');
    if (c) c.classList.toggle('fx-shut', !open);
}
let fxObserver = null;
function fxViewObserver() {
    if (!fxObserver) {
        fxObserver = new IntersectionObserver((entries) => {
            for (const en of entries) {
                const c = en.target;
                if (en.isIntersecting || !c.isConnected || c.classList.contains('fx-shut')) continue;
                if (c.contains(document.activeElement)) continue;      // being edited
                if (c.classList.contains('fx-on') || c.classList.contains('fx-some')) continue;      // an effect that is on keeps its options open
                fxShow(c.dataset.id, false);
            }
        }, { threshold: 0 });
    }
    return fxObserver;
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
    if ((e.noStrength || e.repeat) && !e.transform && !e.track) {
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
    // the switch alone turns the effect on / off; clicking the rest of the card only opens / closes its options
    for (const ev of ['mousedown', 'pointerdown']) sw.addEventListener(ev, (x) => x.stopPropagation());
    sw.addEventListener('click', (x) => { x.stopPropagation(); if (fxStateOf(e.id) === 'none') fxShow(e.id, true); fxToggle(e); });
    c.addEventListener('click', () => fxShow(e.id, c.classList.contains('fx-shut')));
    fxViewObserver().observe(c);
    c.addEventListener('contextmenu', (ev) => { ev.preventDefault(); fxTagMenu(c, e); });
    c._fx = { sw, sub, note, row, rng, val, optsAt, optsSig: null };
    return c;
}

const fxPut = (el, prop, v) => { if (el[prop] !== v) el[prop] = v; };
function fxFillCard(c, e) {
    const f = c._fx;
    const st = fxStateOf(e.id);
    const cls = 'card fx-card' + (st === 'on' ? ' fx-on' : (st === 'some' ? ' fx-some' : '')) + (fxUI.pending[e.id] ? ' fx-pending' : '') + (fxIsShut(e.id, st) ? ' fx-shut' : '');
    fxPut(c, 'className', cls);
    const nodeClips = fxInNodes(e.id);
    // dragged in as a node AND switched on here (the node went in after): it runs twice - click the card to remove this one
    const twice = nodeClips.some(x => x.effects && x.effects[e.id]);
    let title = e.tip + (st === 'on' ? '\nUse the switch to remove it from the selected clip(s); click here to show / hide its options' : '\nUse the switch to add it to the selected clip(s); click here to show / hide its options');
    if (twice) title += '\nAlso a node in the clip\'s Fusion graph, so it runs twice: use the switch to remove the panel one';
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
    if (e.track) {
        const clip = fxUI.clips.find(x => x.effects && x.effects[e.id]);
        const sig = JSON.stringify([fxParamsShown(e), st, clip ? [clip.id, clip.track] : null]);
        if (sig !== f.optsSig && !fxUI.sliding) {
            f.optsSig = sig;
            f.optsAt.textContent = '';
            f.optsAt.appendChild(fxTrackOptions(e, st, clip));
        }
    }
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
    // the Resolve preview clip is a temporary text preset: it is replaced / removed, so an effect on it would be lost
    if (fxUI.clips.some(c => c.temp)) {
        setStatus('Effects cannot be applied to a temporary preview text preset. Click Apply (or Remove) on the preview first, then select the placed clip.', 'bad');
        return;
    }
    const want = fxStateOf(e.id) !== 'on';
    // Track Subject is added by tracking: switching it on opens the Track sheet (draw the box, Track)
    if (e.track && want) { fxTrackOpen(e); return; }
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


// ---- Track Subject (src/main/subject-track.js): the selected clip follows a subject in the footage under it.
// The card's options: what was tracked, Follow X / Y / Scale and Smoothing (re-keyed from the stored track at once,
// no tracking), and Re-track. Switching the card on (or Re-track) opens the Track sheet.
function fxTrackOptions(e, st, clip) {
    const p = fxParamsShown(e);
    const d = document.createElement('div');
    d.className = 'fx-opts fx-track-opts';
    const info = document.createElement('div'); info.className = 'fx-note';
    const t = clip && clip.track;
    info.textContent = st === 'none' ? 'Click to pick a subject in the footage under the selected clip'
        : (t && t.tracked ? 'Tracked ' + t.frames + ' frames' + (t.lost ? ' · lost on ' + t.lost : '') : 'Not tracked yet');
    d.appendChild(info);
    const send = (vals, now) => fxSendParams(e, st, vals, now);
    const checks = document.createElement('div'); checks.className = 'fx-opt-row fx-track-checks';
    for (const [k, label, tip] of [['FollowX', 'Follow X', 'Move left / right with the subject'], ['FollowY', 'Follow Y', 'Move up / down with the subject'], ['FollowScale', 'Scale', 'Grow / shrink as the subject comes closer or moves away'], ['FollowRot', 'Rotation', 'Turn with the subject as it tilts in the picture']]) {
        const l = document.createElement('label'); l.className = 'fx-check'; l.title = tip;
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = Number(p[k]) >= 0.5;
        cb.addEventListener('change', () => send({ [k]: cb.checked ? 1 : 0 }, true));
        l.append(cb, document.createTextNode(label));
        checks.appendChild(l);
    }
    const row = document.createElement('label'); row.className = 'fx-strength'; row.title = 'Smooths out tracking jitter (0 = raw track). Double-click: default';
    const cap = document.createElement('span'); cap.className = 'fx-strength-cap'; cap.textContent = 'Smoothing';
    const rng = document.createElement('input'); rng.type = 'range'; rng.min = '0'; rng.max = '100'; rng.step = '1'; rng.value = String(p.Smooth);
    const val = document.createElement('span'); val.className = 'fx-strength-val'; val.textContent = String(Math.round(p.Smooth));
    rng.addEventListener('pointerdown', () => { fxUI.sliding = true; });
    for (const ev of ['pointerup', 'pointercancel']) rng.addEventListener(ev, () => { fxUI.sliding = false; });
    // re-keys on release only: re-keying on every drag step while Resolve renders is what preceded a crash
    rng.addEventListener('input', () => { val.textContent = rng.value; });
    rng.addEventListener('change', () => send({ Smooth: Number(rng.value) }, true));
    rng.addEventListener('dblclick', () => { const v = e.track.defaults.Smooth; rng.value = String(v); val.textContent = String(v); send({ Smooth: v }, true); });
    row.append(cap, rng, val);
    // moved / trimmed since it was keyed: the panel never re-keys by itself (no writes from the background poll)
    if (t && t.tracked && t.stale && clip) {
        const up = document.createElement('button'); up.type = 'button'; up.className = 'btn small fx-track-btn';
        up.textContent = 'Update'; up.title = 'The clip moved or was trimmed since it was tracked: re-attach it from the stored track';
        info.textContent += ' · clip moved since';
        up.addEventListener('click', async () => {
            up.disabled = true;
            let r = null;
            try { r = await window.sa.trackSettings(clip.id, {}); } catch (err) { r = { error: String(err && err.message || err) }; }
            if (r && r.error) setStatus(r.error, 'bad'); else { setStatus('Re-attached ' + clip.name + '.', 'ok'); fxRefresh(true); }
            up.disabled = false;
        });
        d.appendChild(up);
    }
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small fx-track-btn';
    btn.textContent = st === 'none' ? 'Pick subject…' : 'Re-track…';
    btn.addEventListener('click', () => fxTrackOpen(e));
    d.append(checks, row, btn);
    for (const ev of ['click', 'mousedown', 'pointerdown']) d.addEventListener(ev, (x) => x.stopPropagation());
    return d;
}

const trackUI = { el: null, src: null, box: null, running: false };
function fxTrackClose() {
    if (trackUI.running) return;
    if (trackUI.el) trackUI.el.remove();
    trackUI.el = null; trackUI.src = null; trackUI.box = null;
}

async function fxTrackOpen(e) {
    fxTrackClose();
    if (!fxUI.clips.length) await fxRefresh(true);
    if (!fxUI.clips.length) { setStatus('Select the clip to attach on the timeline first.', 'bad'); return; }
    const wrap = document.createElement('div'); wrap.className = 'trk-backdrop';
    const sh = document.createElement('div'); sh.className = 'trk-sheet';
    wrap.appendChild(sh);
    wrap.addEventListener('pointerdown', (x) => { if (x.target === wrap) fxTrackClose(); });
    document.body.appendChild(wrap);
    trackUI.el = wrap;
    const head = document.createElement('div'); head.className = 'trk-head';
    const title = document.createElement('div'); title.className = 'trk-title'; title.textContent = 'Track Subject';
    const x = document.createElement('button'); x.type = 'button'; x.className = 'trk-x'; x.textContent = '×'; x.title = 'Close';
    x.addEventListener('click', fxTrackClose);
    head.append(title, x);
    const body = document.createElement('div'); body.className = 'trk-body';
    const msg = document.createElement('div'); msg.className = 'trk-msg';
    sh.append(head, body, msg);
    const say = (t, kind) => { msg.textContent = t || ''; msg.className = 'trk-msg' + (kind ? ' ' + kind : ''); };

    // tracking engine (OpenCV) - installed once, with the user's go-ahead
    let eng = null;
    try { eng = await window.sa.trackEngine(); } catch (err) { eng = null; }
    if (!eng || !eng.ready) {
        body.textContent = '';
        const p = document.createElement('p'); p.className = 'trk-p';
        p.textContent = 'Tracking uses OpenCV, which is installed once into the app\'s own folder (about ' + ((eng && eng.sizeMB) || 190) + ' MB, needs internet).';
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn primary'; b.textContent = 'Install tracking engine';
        b.disabled = !(eng && eng.canInstall);
        if (eng && !eng.canInstall) say('Python 3 was not found on this Mac (install it from python.org or Homebrew).', 'bad');
        b.addEventListener('click', async () => {
            b.disabled = true; trackUI.running = true;
            let r = null;
            try { r = await window.sa.trackInstall(); } catch (err) { r = { error: String(err && err.message || err) }; }
            trackUI.running = false;
            if (r && r.ready) { fxTrackClose(); fxTrackOpen(e); } else { b.disabled = false; say((r && r.error) || 'Install failed', 'bad'); }
        });
        body.append(p, b);
        return;
    }

    say('Loading the footage…');
    const frame = typeof tmState !== 'undefined' ? tmState.frame : null;
    let src = null;
    try { src = await window.sa.trackSource(frame); } catch (err) { src = { error: String(err && err.message || err) }; }
    if (!trackUI.el || trackUI.el !== wrap) return;
    if (!src || src.error || src.busy) { say(src && src.busy ? 'Busy placing - try again in a moment.' : ((src && src.error) || 'Could not read the footage'), 'bad'); return; }
    trackUI.src = src;
    say('');
    const info = document.createElement('div'); info.className = 'trk-info';
    const n = src.range[1] - src.range[0] + 1;
    info.textContent = 'Attach: ' + src.target.name + '  ·  to footage: ' + src.subject.name + '  ·  ' + n + ' frames';
    const stage = document.createElement('div'); stage.className = 'trk-stage';
    stage.style.aspectRatio = src.width + ' / ' + src.height;
    stage.style.width = 'min(100%, calc(56vh * ' + (src.width / src.height).toFixed(4) + '))';
    const img = document.createElement('img'); img.src = 'data:image/jpeg;base64,' + src.data; img.draggable = false;
    const box = document.createElement('div'); box.className = 'trk-box hidden';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'trk-path'); svg.setAttribute('viewBox', '0 0 1 1'); svg.setAttribute('preserveAspectRatio', 'none');
    stage.append(img, svg, box);
    const hint = document.createElement('div'); hint.className = 'trk-hint'; hint.textContent = 'Drag a box around the subject (a face, a product, a person).';
    // box: 0..1 of the picture, top-left origin
    // after a track: the tracked frames play back here with the tracked box on each (pv), until a new box is drawn
    const pv = { on: false, r: null, i: 0, timer: null };
    const player = document.createElement('div'); player.className = 'trk-player hidden';
    const play = document.createElement('button'); play.type = 'button'; play.className = 'trk-play'; play.textContent = '▶';
    const scrub = document.createElement('input'); scrub.type = 'range'; scrub.min = '0'; scrub.step = '1'; scrub.value = '0';
    const pvLab = document.createElement('span'); pvLab.className = 'trk-pvlab';
    player.append(play, scrub, pvLab);
    const showFrame = (i) => {
        const fr = pv.r.preview[i];
        if (!fr) return;
        pv.i = i; scrub.value = String(i);
        img.src = 'data:image/jpeg;base64,' + fr.data;
        const b = pv.r.track[fr.f];
        box.classList.toggle('hidden', !b);
        if (b) {
            Object.assign(box.style, { left: (b[0] - b[2] / 2) * 100 + '%', top: (b[1] - b[3] / 2) * 100 + '%', width: b[2] * 100 + '%', height: b[3] * 100 + '%' });
            box.classList.toggle('lost', !b[4]);
            box.style.transform = 'rotate(' + (Number(b[5]) || 0) + 'deg)';
        }
        pvLab.textContent = (fr.f - src.range[0]) + ' / ' + (src.range[1] - src.range[0]) + (b && !b[4] ? '  lost' : '');
    };
    const stop = () => { clearInterval(pv.timer); pv.timer = null; play.textContent = '▶'; };
    const start = () => {
        if (!pv.on) return;
        stop(); play.textContent = '❚❚';
        const fps = Math.max(1, (Number(src.fps) || 25) / (pv.r.step || 1));
        pv.timer = setInterval(() => {
            if (!trackUI.el || trackUI.el !== wrap) { stop(); return; }
            showFrame((pv.i + 1) % pv.r.preview.length);
        }, 1000 / fps);
    };
    play.addEventListener('click', () => { if (pv.timer) stop(); else start(); });
    scrub.addEventListener('input', () => { stop(); showFrame(Number(scrub.value)); });
    const enterPreview = (r) => {
        if (!r.preview || !r.preview.length) return;
        pv.on = true; pv.r = r;
        scrub.max = String(r.preview.length - 1);
        player.classList.remove('hidden');
        stage.classList.add('previewing');
        hint.textContent = 'Playing the tracked frames: the box should stay on the subject. Drag on the picture to draw a new box and track again.';
        showFrame(0); start();
    };
    const exitPreview = () => {
        stop(); pv.on = false;
        player.classList.add('hidden');
        stage.classList.remove('previewing');
        box.classList.remove('lost'); box.style.transform = '';
        img.src = 'data:image/jpeg;base64,' + src.data;
        hint.textContent = 'Drag a box around the subject (a face, a product, a person).';
        go.textContent = 'Track'; go.classList.remove('trk-done');
        svg.textContent = '';
    };
    const paintBox = () => {
        const b = trackUI.box;
        box.classList.toggle('hidden', !b);
        if (b) Object.assign(box.style, { left: b[0] * 100 + '%', top: b[1] * 100 + '%', width: b[2] * 100 + '%', height: b[3] * 100 + '%' });
        go.disabled = !b || trackUI.running;
        if (!pv.on && !go.classList.contains('trk-done')) go.textContent = b ? 'Track' : 'Draw a box around the subject first';
    };
    let drag = null;
    const at = (ev) => { const r = stage.getBoundingClientRect(); return [Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))]; };
    stage.addEventListener('pointerdown', (ev) => {
        if (trackUI.running || ev.button !== 0) return;
        if (pv.on) exitPreview();
        stage.setPointerCapture(ev.pointerId);
        const p = at(ev), b = trackUI.box;
        // inside the current box: move it; else draw a new one
        if (b && p[0] > b[0] && p[0] < b[0] + b[2] && p[1] > b[1] && p[1] < b[1] + b[3]) drag = { move: true, p0: p, b0: b.slice() };
        else drag = { move: false, p0: p };
        svg.textContent = '';
    });
    stage.addEventListener('pointermove', (ev) => {
        if (!drag) return;
        const p = at(ev);
        if (drag.move) {
            const b = drag.b0;
            trackUI.box = [Math.max(0, Math.min(1 - b[2], b[0] + p[0] - drag.p0[0])), Math.max(0, Math.min(1 - b[3], b[1] + p[1] - drag.p0[1])), b[2], b[3]];
        } else {
            const x0 = Math.min(p[0], drag.p0[0]), y0 = Math.min(p[1], drag.p0[1]);
            trackUI.box = [x0, y0, Math.abs(p[0] - drag.p0[0]), Math.abs(p[1] - drag.p0[1])];
        }
        paintBox();
    });
    const endDrag = () => { if (!drag) return; drag = null; if (trackUI.box && (trackUI.box[2] < 0.01 || trackUI.box[3] < 0.01)) trackUI.box = null; paintBox(); };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    // Follow X / Y / Scale + Smoothing used for this track (and remembered for the next one)
    const p = fxParamsShown(e);
    const opts = document.createElement('div'); opts.className = 'trk-opts';
    const vals = { FollowX: Number(p.FollowX) >= 0.5 ? 1 : 0, FollowY: Number(p.FollowY) >= 0.5 ? 1 : 0, FollowScale: Number(p.FollowScale) >= 0.5 ? 1 : 0, FollowRot: Number(p.FollowRot) >= 0.5 ? 1 : 0, Smooth: Number(p.Smooth) };
    for (const [k, label] of [['FollowX', 'Follow X'], ['FollowY', 'Follow Y'], ['FollowScale', 'Scale'], ['FollowRot', 'Rotation']]) {
        const l = document.createElement('label'); l.className = 'fx-check';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = vals[k] === 1;
        cb.addEventListener('change', () => { vals[k] = cb.checked ? 1 : 0; fxRememberParams(e, Object.assign(fxNextParams(e), vals)); });
        l.append(cb, document.createTextNode(label));
        opts.appendChild(l);
    }
    const sl = document.createElement('label'); sl.className = 'fx-strength trk-smooth';
    const sc = document.createElement('span'); sc.className = 'fx-strength-cap'; sc.textContent = 'Smoothing';
    const sr = document.createElement('input'); sr.type = 'range'; sr.min = '0'; sr.max = '100'; sr.value = String(vals.Smooth);
    const sv = document.createElement('span'); sv.className = 'fx-strength-val'; sv.textContent = String(Math.round(vals.Smooth));
    sr.addEventListener('input', () => { vals.Smooth = Number(sr.value); sv.textContent = sr.value; fxRememberParams(e, Object.assign(fxNextParams(e), vals)); });
    sl.append(sc, sr, sv);
    opts.appendChild(sl);
    if (/Text\+|MultiText|Title/i.test(src.target.name || '')) {
        const note = document.createElement('div'); note.className = 'trk-note';
        note.textContent = 'Captions normally stay horizontally centred - untick Follow X to keep this one centred.';
        opts.appendChild(note);
    }
    for (const w of src.warnings || []) { const note = document.createElement('div'); note.className = 'trk-note'; note.textContent = w; opts.appendChild(note); }

    const bar = document.createElement('div'); bar.className = 'trk-progress hidden';
    const fill = document.createElement('div'); bar.appendChild(fill);
    const foot = document.createElement('div'); foot.className = 'trk-foot';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = 'Close';
    const go = document.createElement('button'); go.type = 'button'; go.className = 'btn primary'; go.textContent = 'Track';
    foot.append(cancel, go);
    body.textContent = '';
    body.append(info, stage, player, hint, opts, bar, foot);
    // re-track: start from where the last track found the subject on this frame (or the box drawn last time)
    const prev = src.previous || {};
    if (Array.isArray(prev.trackedBox)) trackUI.box = prev.trackedBox.slice();
    else if (Array.isArray(prev.box) && prev.anchor === src.anchor) trackUI.box = prev.box.slice();
    if (trackUI.box) hint.textContent = 'The box is where the last track found the subject. Drag it to move it, or drag outside it to draw a new one, then Track.';
    paintBox();

    const PH = { frames: 'Reading footage frames', track: 'Tracking', bake: 'Attaching the clip' };
    window.sa.onTrackProgress && !fxTrackOpen._hooked && (fxTrackOpen._hooked = true, window.sa.onTrackProgress((d) => {
        const el = trackUI.el && trackUI.el.querySelector('.trk-progress > div');
        const m = trackUI.el && trackUI.el.querySelector('.trk-msg');
        if (!el || !m) return;
        if (d.phase === 'install') { m.textContent = d.text || ''; return; }
        const frac = d.total ? d.done / d.total : 1;
        const base = d.phase === 'frames' ? 0 : (d.phase === 'track' ? 0.4 : 0.95);
        const span = d.phase === 'frames' ? 0.4 : (d.phase === 'track' ? 0.55 : 0.05);
        el.style.width = Math.round((base + span * frac) * 100) + '%';
        m.textContent = (PH[d.phase] || '') + (d.total ? ' ' + d.done + ' / ' + d.total : '') + '…';
        m.className = 'trk-msg';
    }));

    cancel.addEventListener('click', async () => {
        if (trackUI.running) { await window.sa.trackCancel(); return; }
        fxTrackClose();
    });
    go.addEventListener('click', async () => {
        if (!trackUI.box || trackUI.running) return;
        trackUI.running = true; go.disabled = true; go.textContent = 'Tracking…'; cancel.textContent = 'Stop';
        bar.classList.remove('hidden'); fill.style.width = '0%';
        fxRememberParams(e, Object.assign(fxNextParams(e), vals));
        let r = null;
        try {
            r = await window.sa.trackRun({ target: src.target.id, subject: src.subject.id, range: src.range, anchor: src.anchor, box: trackUI.box, values: vals });
        } catch (err) { r = { error: String(err && err.message || err) }; }
        trackUI.running = false; cancel.textContent = 'Close'; paintBox();
        if (!r || r.error || r.busy) { bar.classList.add('hidden'); say(r && r.busy ? 'Busy placing - try again in a moment.' : ((r && r.error) || 'Tracking failed'), 'bad'); return; }
        if (r.cancelled) { bar.classList.add('hidden'); say('Stopped.'); return; }
        if (r.needInstall) { fxTrackClose(); fxTrackOpen(e); return; }
        fill.style.width = '100%';
        // the tracked path over the picture (lost frames in red)
        svg.textContent = '';
        const pts = Object.keys(r.track || {}).map(Number).sort((a, b) => a - b).map(f => r.track[f]);
        for (let i = 1; i < pts.length; i++) {
            const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            ln.setAttribute('x1', pts[i - 1][0]); ln.setAttribute('y1', pts[i - 1][1]); ln.setAttribute('x2', pts[i][0]); ln.setAttribute('y2', pts[i][1]);
            ln.setAttribute('class', pts[i][4] ? 'ok' : 'lost');
            svg.appendChild(ln);
        }
        if (Array.isArray(r.clips)) {
            const byId = new Map(r.clips.map(c => [c.id, c]));
            fxUI.clips = fxUI.clips.map(c => byId.get(c.id) || c);
            fxUI.sig = JSON.stringify(fxUI.clips);
            renderEffects();
        }
        say('Attached: ' + r.frames + ' frames tracked' + (r.lost ? ', subject lost on ' + r.lost + ' (the clip holds still there)' : '') + '.', r.lost ? '' : 'ok');
        go.textContent = r.lost ? 'Tracked (lost on ' + r.lost + ')' : 'Tracked Successfully ✓';
        go.classList.add('trk-done'); go.disabled = true;
        bar.classList.add('hidden');
        enterPreview(r);
        setStatus(src.target.name + ' now follows the subject.', 'ok');
    });
}
