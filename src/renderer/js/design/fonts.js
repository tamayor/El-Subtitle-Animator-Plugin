// Fonts and font styles for the Text Design panel, and text-design cloning / defaults.

// ---------------------------------------------------------------- the alignment block (used in both tabs)
// The same block is mounted twice: in the Use tab (edits are for one use) and in the Create tab (edits are
// the saved defaults). `ctx` says which one a function is working on.
const FONT_OPTIONS = [
    'Poppins', 'Open Sans', 'Montserrat', 'Inter', 'Bebas Neue', 'Impact',
    'Helvetica Neue', 'Arial', 'Futura', 'SF Pro Display', 'Roboto', 'Oswald', 'Lato'
];

// All fonts installed on this computer (loaded once in the background); the short list above is the fallback.
state.fonts = FONT_OPTIONS.slice();
state.fontStyles = {};      // font family -> the styles it really has
// Resolve's own list is the exact one (what Text+ shows); until Resolve answers, macOS's list stands in and the
// load is retried for a while.
(async () => {
    for (const wait of [0, 15000, 30000, 60000, 120000]) {
        if (wait) await new Promise(r => setTimeout(r, wait));
        try {
            let list = null, fromResolve = false;
            if (window.sa && window.sa.listFonts) { const r = await window.sa.listFonts(); list = r && r.fonts; if (r && r.styles) state.fontStyles = r.styles; fromResolve = !!(r && r.fromResolve); }
            if ((!list || !list.length) && typeof window.queryLocalFonts === 'function') {
                const f = await window.queryLocalFonts();
                list = Array.from(new Set(f.map(x => x.family))).sort((a, b) => a.localeCompare(b));
                for (const x of f) { (state.fontStyles[x.family] = state.fontStyles[x.family] || []).includes(x.style) || state.fontStyles[x.family].push(x.style); }
            }
            if (list && list.length) state.fonts = list;
            if (fromResolve) break;
        } catch (e) { /* keep the short list */ }
    }
})();


// null = font not in the installed list (typed by hand). A font with no styles, or whose family name already carries
// its weight (Larken-Black, Arial Black), is listed by Resolve with the single style "Regular".
const FONT_WEIGHT_NAME = /[-\s](thin|hairline|extra\s?light|ultra\s?light|light|regular|book|medium|semi\s?bold|demi\s?bold|bold|extra\s?bold|ultra\s?bold|heavy|black|italic|oblique)$/i;
function fontStylesOf(font) {
    const k = Object.keys(state.fontStyles || {}).find(x => x.toLowerCase() === String(font || '').toLowerCase());
    if (!k) return null;
    const raw = state.fontStyles[k] || [];
    if (!raw.length || (raw.length <= 1 && FONT_WEIGHT_NAME.test(String(font)))) return ['Regular'];
    return raw;
}
// A style the font has: the wanted one, else Regular, else the first.
function pickStyle(styles, want) {
    const w = String(want || '').toLowerCase();
    const hit = styles.find(x => x.toLowerCase() === w);
    if (hit) return hit;
    for (const n of ['regular', 'book', 'roman', 'normal', 'medium']) { const r = styles.find(x => x.toLowerCase() === n); if (r) return r; }
    return styles[0];
}
// The Style box lists what the chosen font really has (the general list when the font is not known).
function fillStyleSelect(S, font, value) {
    const sel = $('tdStyle' + S);
    if (!sel) return value;
    const styles = fontStylesOf(font);
    if (styles && !styles.length) {
        // The font has no styles: the Style box is empty and disabled, and no style is sent to Resolve.
        sel.textContent = '';
        const o = document.createElement('option'); o.value = ''; o.textContent = ''; sel.appendChild(o);
        sel.value = '';
        sel.disabled = true;
        return '';
    }
    sel.disabled = false;
    const opts = styles || STYLE_OPTIONS;
    let val = value;
    if (styles && !styles.some(x => x.toLowerCase() === String(value || '').toLowerCase())) val = pickStyle(styles, value);
    if (!val) val = styles ? pickStyle(styles, 'Regular') : 'Bold';
    if (opts.join('|') !== Array.from(sel.options).map(o => o.value).join('|')) {
        sel.textContent = '';
        for (const st of opts) { const o = document.createElement('option'); o.value = st; o.textContent = st; sel.appendChild(o); }
    }
    if (val && !Array.from(sel.options).some(o => o.value === val)) { const o = document.createElement('option'); o.value = val; o.textContent = val; sel.appendChild(o); }
    sel.value = val;
    return val;
}

// Searchable font list under the Font box, like Resolve's: click to see every installed font, type to filter.
function bindFontPicker(inp) {
    if (!inp || inp._fontPicker) return;
    inp._fontPicker = true;
    let pop = null, items = [], sel = -1, typed = false;
    const close = () => { if (pop) { pop.remove(); pop = null; } sel = -1; };
    const choose = (f) => {
        inp.value = f;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        close();
        inp.blur();
    };
    const paint = () => {
        if (!pop) return;
        pop.textContent = '';
        items.forEach((f, i) => {
            const d = document.createElement('div');
            d.className = 'font-item' + (i === sel ? ' sel' : '') + (f.toLowerCase() === inp.value.trim().toLowerCase() ? ' on' : '');
            d.textContent = f;
            d.addEventListener('mousedown', (e) => { e.preventDefault(); choose(f); });
            pop.appendChild(d);
        });
        if (!items.length) {
            const d = document.createElement('div');
            d.className = 'font-empty';
            d.textContent = 'No installed font matches. Press Enter to use "' + inp.value.trim() + '" as typed.';
            pop.appendChild(d);
        }
        const cur = pop.querySelector('.font-item.sel');
        if (cur) cur.scrollIntoView({ block: 'nearest' });
    };
    const refresh = () => {
        const q = typed ? inp.value.trim().toLowerCase() : '';
        let list = state.fonts.slice();
        if (q) {
            list = list.filter(f => f.toLowerCase().includes(q));
            list.sort((x, y) => (x.toLowerCase().startsWith(q) ? 0 : 1) - (y.toLowerCase().startsWith(q) ? 0 : 1) || x.localeCompare(y));
        }
        items = list.slice(0, 200);
        const curName = inp.value.trim().toLowerCase();
        sel = q ? (items.length ? 0 : -1) : items.findIndex(f => f.toLowerCase() === curName);
        paint();
    };
    const open = () => {
        if (pop) return;
        pop = document.createElement('div');
        pop.className = 'font-pop';
        const r = inp.getBoundingClientRect();
        pop.style.left = r.left + 'px';
        pop.style.width = r.width + 'px';
        const below = window.innerHeight - r.bottom;
        if (below < 220 && r.top > below) { pop.style.bottom = (window.innerHeight - r.top + 4) + 'px'; pop.style.maxHeight = Math.min(260, r.top - 12) + 'px'; }
        else { pop.style.top = (r.bottom + 4) + 'px'; pop.style.maxHeight = Math.min(260, below - 12) + 'px'; }
        document.body.appendChild(pop);
        refresh();
    };
    inp.setAttribute('autocomplete', 'off');
    inp.addEventListener('focus', () => { typed = false; open(); try { inp.select(); } catch (e) { /* ignore */ } });
    inp.addEventListener('click', () => { if (!pop) { typed = false; open(); } });
    inp.addEventListener('input', (e) => { if (e.inputType) { typed = true; open(); refresh(); } });
    inp.addEventListener('blur', () => { close(); typed = false; });
    inp.addEventListener('keydown', (e) => {
        if (!pop) { if (e.key === 'ArrowDown') { typed = false; open(); e.preventDefault(); } return; }
        if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); paint(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paint(); e.preventDefault(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (sel >= 0 && items[sel]) choose(items[sel]); else { close(); inp.blur(); } }
        else if (e.key === 'Escape') { e.preventDefault(); close(); inp.blur(); }
    });
    window.addEventListener('scroll', () => { if (pop) close(); }, true);
}

function saStyleToCss(style) {
    // Font style name (as the Mac / Resolve lists it) -> CSS weight + italic, for the canvas preview.
    const raw = String(style === undefined || style === null ? 'Bold' : style).toLowerCase();
    const s = raw.replace(/[\s_-]+/g, '');
    let w = 400;
    if (/hairline|thin/.test(s)) w = 100;
    else if (/extralight|ultralight/.test(s)) w = 200;
    else if (/light/.test(s)) w = 300;
    else if (/semibold|demibold|demi/.test(s)) w = 600;
    else if (/extrabold|ultrabold/.test(s)) w = 800;
    else if (/black|heavy|ultra/.test(s)) w = 900;
    else if (/bold/.test(s)) w = 700;
    else if (/medium/.test(s)) w = 500;
    else if (/regular|book|roman|normal|italic|oblique|^$/.test(s)) w = 400;
    return { weight: String(w), italic: /italic|oblique/.test(s) };
}

const STYLE_OPTIONS = [
    'Regular', 'Light', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black', 'Italic', 'Bold Italic'
];

function defaultElementsList() {
    return [
        { index: 1, name: 'White Solid Fill', enabled: true, opacity: 1.0, type: 0, shape: 0, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#ffffff', color2: '#f07b8e', mappingAngle: 0.0, mappingSize: 1.0, mappingAspect: 1.0, mappingLevel: 3, softness: 0.0, offsetX: 0.0, offsetY: 0.0 },
        { index: 2, name: 'Red Outline', enabled: false, opacity: 1.0, type: 0, shape: 1, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#ff0000', color2: '#f07b8e', mappingAngle: 0.0, mappingSize: 1.0, mappingAspect: 1.0, mappingLevel: 3, softness: 0.0, offsetX: 0.0, offsetY: 0.0 },
        { index: 3, name: 'Black Shadow', enabled: false, opacity: 1.0, type: 0, shape: 0, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#000000', color2: '#f07b8e', mappingAngle: 0.0, mappingSize: 1.0, mappingAspect: 1.0, mappingLevel: 3, softness: 5.0, offsetX: 0.05, offsetY: -0.05 },
        { index: 4, name: 'Blue Border', enabled: false, opacity: 1.0, type: 0, shape: 2, thickness: 0.02, level: 0, extendH: 0.176, extendV: 0.164, round: 0.197, color: '#0000ff', color2: '#f07b8e', mappingAngle: 0.0, mappingSize: 1.0, mappingAspect: 1.0, mappingLevel: 3, softness: 0.0, offsetX: 0.0, offsetY: 0.0 },
        { index: 5, name: 'Element 5', enabled: false, opacity: 1.0, type: 0, shape: 0, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#ffffff', color2: '#f07b8e', mappingAngle: 0.0, mappingSize: 1.0, mappingAspect: 1.0, mappingLevel: 3, softness: 0.0, offsetX: 0.0, offsetY: 0.0 },
        { index: 6, name: 'Element 6', enabled: false, opacity: 1.0, type: 0, shape: 0, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#ffffff', color2: '#f07b8e', mappingAngle: 0.0, mappingSize: 1.0, mappingAspect: 1.0, mappingLevel: 3, softness: 0.0, offsetX: 0.0, offsetY: 0.0 },
        { index: 7, name: 'Element 7', enabled: false, opacity: 1.0, type: 0, shape: 0, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#ffffff', color2: '#f07b8e', mappingAngle: 0.0, mappingSize: 1.0, mappingAspect: 1.0, mappingLevel: 3, softness: 0.0, offsetX: 0.0, offsetY: 0.0 },
        { index: 8, name: 'Element 8', enabled: false, opacity: 1.0, type: 0, shape: 0, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#ffffff', color2: '#f07b8e', mappingAngle: 0.0, mappingSize: 1.0, mappingAspect: 1.0, mappingLevel: 3, softness: 0.0, offsetX: 0.0, offsetY: 0.0 }
    ];
}

const TD_EXTRA = ['vAnchor', 'vJustify', 'hAnchor', 'hJustify', 'direction', 'lineDirection', 'strikeout', 'underline'];

function cloneTextDesign(td) {
    const base = {
        font: 'Poppins',
        style: 'Bold',
        size: 0.12,
        tracking: 1.0,
        lineSpacing: 1.0,
        vAnchor: 0, vJustify: 0, hAnchor: 0, hJustify: 0, direction: 0, lineDirection: 0, strikeout: 0, underline: 0,
        wiggle: false,
        animSpec: null,
        selectedElement: 1,
        elements: defaultElementsList()
    };
    if (!td || typeof td !== 'object') return base;
    const copy = JSON.parse(JSON.stringify(td));
    base.font = copy.font || base.font;
    base.style = copy.style || base.style;
    if (copy.size !== undefined) base.size = Number(copy.size) || base.size;
    if (copy.tracking !== undefined) base.tracking = Number(copy.tracking);
    if (copy.lineSpacing !== undefined) base.lineSpacing = Number(copy.lineSpacing);
    for (const k of TD_EXTRA) if (copy[k] !== undefined && !isNaN(Number(copy[k]))) base[k] = Number(copy[k]);
    base.wiggle = !!copy.wiggle;
    base.animSpec = copy.animSpec || null;
    base.selectedElement = Number(copy.selectedElement) || 1;
    base.layout = Object.assign({ type: 0, centerZ: 0, pivotX: 0.5, pivotY: 0.5, pivotZ: 0, size: 1, perspective: 1, animated: [] },
        (copy.layout && typeof copy.layout === 'object') ? copy.layout : {});
    if (Array.isArray(copy.elements)) {
        base.elements = copy.elements.map((el, i) => {
            const def = base.elements[i] || {};
            return Object.assign({}, def, el, {
                type: el.type !== undefined ? Number(el.type) : (def.type || 0),
                color2: el.color2 || def.color2 || '#f07b8e',
                mappingAngle: el.mappingAngle !== undefined ? Number(el.mappingAngle) : (def.mappingAngle || 0.0),
                mappingSize: el.mappingSize !== undefined ? Number(el.mappingSize) : (def.mappingSize || 1.0),
                mappingAspect: el.mappingAspect !== undefined ? Number(el.mappingAspect) : (def.mappingAspect || 1.0),
                mappingLevel: el.mappingLevel !== undefined ? Number(el.mappingLevel) : (def.mappingLevel || 3)
            });
        });
    }
    return base;
}
