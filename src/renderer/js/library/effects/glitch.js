// Effect Preset cards: the Glitch options.

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
    const du = sliderRow({
        label: 'Duration', min: 0, max: 120, value: Math.round(Number(p.Dur) || 0), format: v => (v > 0 ? v + 'f' : 'All'),
        tip: 'How many frames the glitch lasts from the start of the clip, then it stops. All (0) = the whole clip',
        setup: hold, onGrab: () => { fxUI.sliding = true; }, onRelease: () => { fxUI.sliding = false; },
        onInput: v => fxSendParams(e, st, { Dur: v }, false), onChange: v => fxSendParams(e, st, { Dur: v }, true)
    }).el;
    // Colours
    const look = document.createElement('div'); look.className = 'fx-opt-head'; look.textContent = 'Glitch colour';
    const colRow = document.createElement('div'); colRow.className = 'fx-opt-row';
    const colour = (label, key, title) => {
        const w = document.createElement('label'); w.className = 'fx-color'; w.title = title;
        const ci = document.createElement('input'); ci.type = 'color';
        ci.value = rgbToHex(p[key + 'Red'], p[key + 'Green'], p[key + 'Blue']);
        hold(ci);
        const send = (now) => { const [r, g, b] = (hexToRgb(ci.value) || [1, 1, 1]); fxSendParams(e, st, { [key + 'Red']: r, [key + 'Green']: g, [key + 'Blue']: b }, now); };
        ci.addEventListener('input', () => send(false));
        ci.addEventListener('change', () => { fxUI.sliding = false; send(true); });
        w.append(ci, document.createTextNode(label));
        return w;
    };
    colRow.append(colour('Right', 'ColorA', 'Colour of the copy shifted to the right'), colour('Left', 'ColorB', 'Colour of the copy shifted to the left'));
    // Opacity
    const op = sliderRow({
        label: 'Opacity', min: 0, max: 100, value: p.Opacity, format: v => v + '%', tip: 'How strong the coloured fringes are',
        setup: hold, onGrab: () => { fxUI.sliding = true; }, onRelease: () => { fxUI.sliding = false; },
        onInput: v => fxSendParams(e, st, { Opacity: v }, false), onChange: v => fxSendParams(e, st, { Opacity: v }, true)
    }).el;
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
