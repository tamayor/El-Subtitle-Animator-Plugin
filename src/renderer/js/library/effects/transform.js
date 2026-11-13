// Effect Preset cards: the Transform effect (easing curves, Start / End range, zoom / move options).

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
function fxPlayheadIn(clip) {
    const f = typeof tmState !== 'undefined' ? tmState.frame : undefined;
    if (!clip || !Number.isFinite(f) || !Number.isFinite(Number(clip.start))) return null;
    const rel = f - Number(clip.start);
    return rel >= 0 && rel < Number(clip.frames) ? rel : null;
}
// opts (Spotlight): { init(last) -> {s, e}, send(s, e, last) on release only, read(s, e, last) -> html, title,
// dflt(last) -> {s, e} for double-click }. Without opts it is the Transform's Start / End frame bar.
function fxFrameRange(e, st, p, clip, last, opts) {
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
    if (opts) { const i = opts.init(last); r.s = Math.max(0, Math.min(last - 1, i.s)); r.e = Math.max(r.s + 1, Math.min(last, i.e)); }
    let sendT = null;
    const send = (now) => {
        clearTimeout(sendT);
        if (opts) { if (now) opts.send(r.s, r.e, last); return; }      // re-keyed on release only
        const v = { InF: r.s, OutF: r.e >= last ? 0 : r.e };
        if (now) fxSendParams(e, st, v, true); else sendT = setTimeout(() => fxSendParams(e, st, v, false), 60);
    };
    return frameRangeBar({
        title: opts && opts.title ? opts.title : 'Drag a head to set where the move starts or ends, drag between them to shift it. Snaps to the playhead (P). Double-click: the whole clip',
        last: () => last,
        get: () => r,
        change: (s0, e0, final) => { r.s = s0; r.e = e0; send(final); },
        read: (s0, e0, L) => opts ? opts.read(s0, e0, L)
            : 'Start <b>' + s0 + '</b> · End <b>' + e0 + '</b>' + (e0 >= L ? ' (last)' : '') + ' <span class="fxr-len">/ ' + L + ' f</span>',
        playhead: () => fxPlayheadIn(clip),
        dflt: (L) => opts && opts.dflt ? opts.dflt(L) : { s: 0, e: L },
        onSlide: (v) => { fxUI.sliding = v; }
    }).el;
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
    const slider = (key, label, min, max, fmt, title) => sliderRow({
        label, min, max, value: p[key], format: fmt, tip: title, setup: hold, onGrab: () => { fxUI.sliding = true; }, onRelease: () => { fxUI.sliding = false; },
        onInput: v => fxSendParams(e, st, { [key]: v }, false), onChange: v => fxSendParams(e, st, { [key]: v }, true),
        onReset: () => { const v = e.transform.defaults[key]; fxSendParams(e, st, { [key]: v }, true); return v; }
    }).el;
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
