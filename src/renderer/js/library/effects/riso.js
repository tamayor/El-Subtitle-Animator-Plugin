// Effect Preset cards: the Riso options (brightness, dot size, offset, colour block, the two inks and the paper).

// ink pairs from the app / Before 2028 palette: [name, ink, colour]
const FX_RISO_INKS = [
    ['Strawberry', '#1c2738', '#c7385a'],
    ['Matcha', '#1c2738', '#3f7f45'],
    ['Ink', '#c7385a', '#1c2738']
];

function fxRisoOptions(e, st) {
    const p = fxParamsShown(e);
    const d = createEl('details', 'fx-opts');
    d.open = !!fxUI.open[e.id];
    d.addEventListener('toggle', () => { fxUI.open[e.id] = d.open; });
    d.appendChild(createEl('summary', '', 'Options'));
    const hold = (el) => {
        for (const ev of ['click', 'mousedown', 'pointerdown']) el.addEventListener(ev, (x) => x.stopPropagation());
        if (el.tagName === 'INPUT' && el.type === 'color') {
            el.addEventListener('focus', () => { fxUI.sliding = true; });
            el.addEventListener('blur', () => { fxUI.sliding = false; });
        }
    };
    const slider = (label, key, min, max, step, format, tip) => sliderRow({
        label, min, max, step, value: Number(p[key]), format, tip,
        setup: hold, onGrab: () => { fxUI.sliding = true; }, onRelease: () => { fxUI.sliding = false; },
        onInput: v => fxSendParams(e, st, { [key]: v }, false), onChange: v => fxSendParams(e, st, { [key]: v }, true),
        onReset: () => { const v = e.riso.defaults[key]; fxSendParams(e, st, { [key]: v }, true); return v; }
    }).el;
    const print = createEl('div', 'fx-opt-head', 'Print');
    const light = slider('Brightness', 'Light', 0.5, 3, 0.05, v => Number(v).toFixed(2), 'Lightens (above 1) or darkens the picture before it is printed. Raise it when the print is nearly solid ink');
    const dot = slider('Dot size', 'Dot', 2, 30, 1, v => String(Math.round(v)), 'Size of the halftone dots (7 = the poster look; bigger = coarser print)');
    const shift = slider('Offset', 'Shift', 0, 3, 0.1, v => Number(v).toFixed(1) + '%', 'How far the colour block is printed out of register: the coloured edge beside the dark shapes');
    const block = slider('Colour block', 'Block', 0, 100, 1, v => Math.round(v) + '%', 'How much of the picture the flat colour covers: 0 = none (one ink on paper), 100 = everything');
    // Colours
    const look = createEl('div', 'fx-opt-head', 'Inks');
    const colRow = createEl('div', 'fx-opt-row');
    const pickers = {};
    const colour = (label, key, title) => {
        const ci = createEl('input', { type: 'color' });
        ci.value = rgbToHex(p[key + 'Red'], p[key + 'Green'], p[key + 'Blue']);
        hold(ci);
        const send = (now) => { const [r, g, b] = (hexToRgb(ci.value, 3) || [1, 1, 1]); fxSendParams(e, st, { [key + 'Red']: r, [key + 'Green']: g, [key + 'Blue']: b }, now); };
        ci.addEventListener('input', () => send(false));
        ci.addEventListener('change', () => { fxUI.sliding = false; send(true); });
        pickers[key] = ci;
        return createEl('label', { class: 'fx-color', title }, [ci, document.createTextNode(label)]);
    };
    colRow.append(
        colour('Ink', 'Ink', 'The dark ink: the halftone dots and the solid shadows'),
        colour('Colour', 'Ink2', 'The second ink: the flat colour block printed out of register'),
        colour('Paper', 'Paper', 'The paper: the highlights and everything the inks leave bare'));
    // one click: an ink pair from the palette (the paper stays)
    const pairs = createEl('div', 'fx-opt-row');
    for (const [name, ink, ink2] of FX_RISO_INKS) {
        const b = createEl('button', { class: 'ghost fx-riso-pair', type: 'button', text: name, title: 'Ink ' + ink + ' with ' + ink2 + ' as the colour block' });
        hold(b);
        b.addEventListener('click', () => {
            pickers.Ink.value = ink; pickers.Ink2.value = ink2;
            const a = hexToRgb(ink, 3), c = hexToRgb(ink2, 3);
            fxSendParams(e, st, { InkRed: a[0], InkGreen: a[1], InkBlue: a[2], Ink2Red: c[0], Ink2Green: c[1], Ink2Blue: c[2] }, true);
        });
        pairs.appendChild(b);
    }
    d.append(print, light, dot, shift, block, look, colRow, pairs);
    for (const ev of ['click', 'mousedown', 'pointerdown']) d.addEventListener(ev, (x) => x.stopPropagation());
    return d;
}
