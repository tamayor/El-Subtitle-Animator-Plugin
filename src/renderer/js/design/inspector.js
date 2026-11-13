// Mounting the shared blocks and Resolve Inspector-style controls (number boxes, RGB sliders, defaults).

// ---------------------------------------------------------------- mounting and binding the alignment & text design blocks
function mountBlocks() {
    if ($('adjustBodyU')) $('adjustBodyU').innerHTML = ALIGN_HTML('U');
    if ($('tdBodyU')) $('tdBodyU').innerHTML = TEXT_DESIGN_HTML('U');
    if ($('saveBarWrapU')) $('saveBarWrapU').innerHTML = SAVE_BAR_HTML('U');
    if ($('previewU')) $('previewU').innerHTML = PREVIEW_HTML('U');

    if ($('adjustBodyC')) $('adjustBodyC').innerHTML = ALIGN_HTML('C');
    if ($('tdBodyC')) $('tdBodyC').innerHTML = TEXT_DESIGN_HTML('C');
    if ($('configBodyC')) $('configBodyC').innerHTML = CONFIG_HTML();
    if ($('saveBarWrapC')) $('saveBarWrapC').innerHTML = SAVE_BAR_HTML('C');
    if ($('previewC')) $('previewC').innerHTML = PREVIEW_HTML('C');
    attachHexFields();
    bindInspectorChrome();
    bindConfigC();
    linkNumBoxes();
    linkRgbSliders();
    bindDblClickReset();
}

// Resolve-style tab bar (Text / Shading) and collapsible section headers.
function bindInspectorChrome() {
    for (const bar of document.querySelectorAll('.rv-tabs')) {
        bindTabGroup(bar, { key: 'pane', buttons: '.rv-tab', panes: { root: bar.closest('.rv'), selector: ':scope > .rv-pane' } });
    }
    for (const h of document.querySelectorAll('.rv-sec-head')) {
        h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed'));
    }
}

// Value boxes next to sliders: typing sets the slider, moving the slider (or code) updates the box.
function linkNumBoxes() {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    for (const box of document.querySelectorAll('.rv-num[data-for]')) {
        const rng = $(box.dataset.for);
        if (!rng || rng._numBox) continue;
        rng._numBox = box;
        const step = Number(rng.step) || 0.01;
        const dec = step >= 1 ? 0 : Math.min(3, String(step).split('.')[1].length);
        const show = () => { if (document.activeElement !== box) box.value = Number(desc.get.call(rng)).toFixed(dec); };
        Object.defineProperty(rng, 'value', {
            configurable: true,
            get() { return desc.get.call(this); },
            set(v) { desc.set.call(this, v); show(); }
        });
        rng.addEventListener('input', show);
        const apply = () => {
            const n = Number(box.value);
            if (box.value === '' || !Number.isFinite(n)) return;
            desc.set.call(rng, String(n));
            rng.dispatchEvent(new Event('input', { bubbles: true }));
            rng.dispatchEvent(new Event('change', { bubbles: true }));
        };
        box.addEventListener('input', apply);
        box.addEventListener('change', () => { apply(); box.value = Number(desc.get.call(rng)).toFixed(dec); });
        box.addEventListener('blur', () => { box.value = Number(desc.get.call(rng)).toFixed(dec); });
        box.addEventListener('keydown', (e) => { if (e.key === 'Enter') box.blur(); });
        show();
    }
}

// Red / Green / Blue sliders (0–1, like Resolve) that drive a color swatch.
function linkRgbSliders() {
    const groups = new Map();
    for (const r of document.querySelectorAll('input[data-rgb-of]')) {
        const id = r.dataset.rgbOf;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id)[Number(r.dataset.ch)] = r;
    }
    for (const [id, chans] of groups) {
        const sw = $(id);
        if (!sw || sw._rgbLinked) continue;
        sw._rgbLinked = true;
        let busy = false;
        const fromSwatch = () => {
            if (busy) return;
            const h = normHex(sw.value) || '#ffffff';
            [1, 3, 5].forEach((o, i) => { chans[i].value = (parseInt(h.substr(o, 2), 16) / 255).toFixed(3); });
        };
        const toSwatch = () => {
            const hex = '#' + chans.map(c => Math.round(clamp(Number(c.value) || 0, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
            busy = true;
            sw.value = hex;
            sw.dispatchEvent(new Event('input', { bubbles: true }));
            busy = false;
        };
        for (const c of chans) c.addEventListener('input', toSwatch);
        sw.addEventListener('input', fromSwatch);
        sw.addEventListener('colorsync', fromSwatch);
        fromSwatch();
    }
}

// Adds a typed hex code field beside every color swatch, kept in sync in both directions.
// normHex / hexToRgb01 / rgb01ToHex live in js/core/color.js.

// DaVinci Resolve authentic default parameter values for Transform, Text Design, and Alignment
const RESOLVE_DEFAULTS = {
    // Transform (DaVinci Resolve Edit Page layer transform defaults)
    scale: 1.0,
    numScale: 1.0,
    posX: 0,
    numPosX: 0,
    posY: 0,
    numPosY: 0,
    rot: 0,
    numRot: 0,

    // Text & Shading Design (DaVinci Resolve Fusion Text+ defaults)
    tdSize: 0.08,
    tdTrack: 1.0,
    tdLine: 1.0,
    shOpacity: 1.0,
    shR: 1.0,
    shRN: 1.0,
    shG: 1.0,
    shGN: 1.0,
    shB: 1.0,
    shBN: 1.0,
    shMapAngle: 0,
    shMapAngleN: 0,
    shMapSize: 1.0,
    shMapSizeN: 1.0,
    shMapAspect: 1.0,
    shMapAspectN: 1.0,
    shThickness: 0.02,
    shExtendH: 0.0,
    shExtendV: 0.0,
    shRound: 0.0,
    shSoftness: 0,
    shOffsetX: 0,
    shOffsetY: 0,

    // Alignment (DaVinci Resolve timeline audio & offset defaults)
    sfxVolume: 0,
    textOffset: 0,
    sfxOffset: 0,
    tail: 0
};

function getDefaultValue(inp) {
    if (!inp) return null;
    if (inp.dataset && inp.dataset.default !== undefined) {
        const str = String(inp.dataset.default).trim();
        const num = Number(str);
        return isNaN(num) ? str : num;
    }
    const cleanId = (inp.id || '').replace(/[UC]$/, '');
    if (cleanId in RESOLVE_DEFAULTS) {
        return RESOLVE_DEFAULTS[cleanId];
    }
    // Any other number / text field: the value written in its HTML. A field with a placeholder and no value
    // ("auto", "∞", "first", "Search…") defaults to empty. A number field with neither has no known default.
    if (inp.tagName === 'INPUT' && /^(number|text|search)$/.test(inp.type)) {
        if (inp.hasAttribute('value')) return inp.getAttribute('value');
        if (inp.type !== 'number' || inp.placeholder) return '';
    }
    return null;
}
