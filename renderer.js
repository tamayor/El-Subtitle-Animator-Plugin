// Subtitle Animator - panel logic (renderer process)
window.addEventListener('error', (e) => {
    console.error('WINDOW ERROR:', e.message, e.filename, e.lineno, e.colno, e.error);
    if (window.sa && window.sa.dlog) window.sa.dlog('WINDOW ERROR:', e.message, e.filename, e.lineno, e.colno);
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('UNHANDLED REJECTION:', e.reason);
    if (window.sa && window.sa.dlog) window.sa.dlog('UNHANDLED REJECTION:', String(e.reason && e.reason.stack || e.reason));
});

const $ = (id) => document.getElementById(id);

const state = {
    lib: { animations: [], defaultSfx: null, alwaysOnTop: true },
    selectedId: null,      // the item picked in the Use tab
    createId: null,        // the item opened in the Create tab
    use: null,             // working copy of the picked item's alignment (edits here are for one use only)
    adjustOpen: false,     // is the alignment panel in the Use tab expanded
    tdOpen: false,         // is the text design panel in the Use tab expanded
    createAdjustOpen: true,// is the alignment panel in the Create tab expanded
    createTdOpen: false,   // is the text design panel in the Create tab expanded
    sfxOrigOpen: false,    // is the SFX originals library accordion expanded
    live: null,            // last poll result
    shownKey: null,        // which subtitle the text box is currently showing
    busy: false,
    audio: null,
    drag: null,            // active drag on an alignment timeline
    stageDrag: null,       // active drag on a preview stage (positioning text)
    stageHover: null,      // 'U' or 'C' when hovering a preview stage
    zoomEnabled: { U: false, C: false }, // zoom preview disabled by default; toggled via button
    liveSyncEnabled: { U: true, C: true }, // real-time live sync to DaVinci Resolve timeline clip
    liveBg: { key: '', img: null, busy: false, pending: null, width: 1920, height: 1080 },
    preview: null,         // running preview
    waves: new Map(),      // sound path -> { peaks, seconds }
    tab: 'apply',
    draft: { animPath: null, fromSelection: false, sfxPath: null }   // what the Create tab is building
};

function setTab(t) {
    stopPreview();
    state.tab = t;
    $('tabApply').classList.toggle('hidden', t !== 'apply');
    $('tabLibrary').classList.toggle('hidden', t !== 'library');
    $('tabCreate').classList.toggle('hidden', t !== 'create');
    $('tabBtnApply').classList.toggle('on', t === 'apply');
    $('tabBtnLibrary').classList.toggle('on', t === 'library');
    $('tabBtnCreate').classList.toggle('on', t === 'create');
    document.body.className = 'tab-' + t;
    renderTimelines();
    redrawStages();
}

function baseName(p) { return String(p || '').split('/').pop(); }

// ---------------------------------------------------------------- helpers
function setStatus(msg, kind) {
    const el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
}

function libEntry(id) { return state.lib.animations.find(a => a.id === id) || null; }
function selected() { return libEntry(state.selectedId); }
function fpsNow() { return (state.live && state.live.fps) || 25; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
const sg = (n) => (n > 0 ? '+' : '') + n;

function fileUrl(p) {
    return 'file://' + p.split('/').map(encodeURIComponent).join('/');
}

function play(p, volumeDb) {
    if (!p) return;
    try {
        if (state.audio) { state.audio.pause(); }
        state.audio = new Audio(fileUrl(p));
        if (volumeDb !== undefined && volumeDb !== null) {
            const gain = Math.pow(10, Number(volumeDb) / 20);
            state.audio.volume = clamp(gain, 0, 1);
        }
        const pr = state.audio.play();
        if (pr && pr.catch) pr.catch(() => setStatus('Could not play that sound', 'bad'));
    } catch (e) { setStatus('Could not play that sound', 'bad'); }
}

function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function takeLib(res) {
    if (res && res.error) { setStatus(res.error, 'bad'); return false; }
    if (res && res.lib) { state.lib = res.lib; syncUse(false); renderAll(); return true; }
    return false;
}

// Make a region accept dropped files. handler(path) gets each file's real path.
function dropZone(el, handler) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); });
    el.addEventListener('dragleave', (e) => { e.stopPropagation(); el.classList.remove('over'); });
    el.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.remove('over');
        for (const f of Array.from(e.dataTransfer.files)) {
            const p = window.sa.pathForFile(f);
            if (p) await handler(p);
        }
    });
}

// ---------------------------------------------------------------- waveforms
// Peaks are computed once per sound; the bar on the timeline just draws them.
async function loadWave(p) {
    if (!p) return null;
    if (state.waves.has(p)) return state.waves.get(p);
    state.waves.set(p, null);                       // mark as loading
    try {
        const bytes = await window.sa.readSfx(p);
        if (!(bytes instanceof Uint8Array)) throw new Error('unreadable');
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        ctx.close();
        const channels = [];
        for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
        const len = buf.length;
        const N = 240, step = Math.max(1, Math.floor(len / N));
        const peaks = new Float32Array(N);
        let maxPeak = 0;
        for (let i = 0; i < N; i++) {
            let m = 0;
            const end = Math.min(len, (i + 1) * step);
            for (const ch of channels) {
                for (let j = i * step; j < end; j++) {
                    const a = Math.abs(ch[j]);
                    if (a > m) m = a;
                }
            }
            peaks[i] = m;
            if (m > maxPeak) maxPeak = m;
        }
        // Normalize and boost quieter sections so the waveform fills the bar height clearly.
        if (maxPeak > 0) {
            for (let i = 0; i < N; i++) {
                peaks[i] = Math.pow(peaks[i] / maxPeak, 0.6);
            }
        }
        const w = { peaks, seconds: buf.duration };
        state.waves.set(p, w);
        renderTimelines();
        return w;
    } catch (e) {
        state.waves.set(p, { peaks: new Float32Array(0), seconds: 0.5 });
        return null;
    }
}

function origSfxPath(a) {
    if (!a || a.useSfx === false) return null;
    if (a.sfxOrigPath) return a.sfxOrigPath;
    if (a.sfxOrig && state.lib && state.lib.dataDir) return state.lib.dataDir + '/sfx/' + a.sfxOrig;
    return currentSfxPath(a);
}

function currentSfxPath(a) {
    if (!a || a.useSfx === false) return null;
    if (a.sfxPath) return a.sfxPath;
    if (a.sfx && state.lib && state.lib.dataDir) return state.lib.dataDir + '/sfx/' + a.sfx;
    return state.lib && state.lib.defaultSfx ? state.lib.defaultSfx.path : null;
}

// shape: { from, frac } = the part of the sound that is shown (the rest is trimmed away),
// { fade } = fraction of the shown width that fades out at the end (drawn like Resolve: a ramp and a shaded corner).
function drawWave(canvas, wave, volumeDb, shape) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round((canvas.clientWidth || 100) * dpr));
    const h = Math.max(1, Math.round((canvas.clientHeight || 40) * dpr));
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (!wave || !wave.peaks.length) return;
    g.fillStyle = '#9be29d';
    const n = wave.peaks.length;
    const from = shape && shape.from > 0 ? Math.min(1, shape.from) : 0;
    const frac = shape && shape.frac > 0 ? Math.min(1 - from, shape.frac) : 1 - from;
    const fade = shape && shape.fade > 0 ? Math.min(1, shape.fade) : 0;
    const db = (volumeDb !== undefined && volumeDb !== null) ? Number(volumeDb) : 0;
    const linearGain = Math.pow(10, db / 20);
    // Baseline scale at 0 dB is 0.68 of height; scaled by volume gain, capped at full height (1.0)
    const ampScale = Math.max(0.04, Math.min(1.0, 0.68 * linearGain));
    const fadeX = w * (1 - fade);
    for (let x = 0; x < w; x++) {
        const v = wave.peaks[Math.min(n - 1, Math.floor((from + x / w * frac) * n))];
        const mult = (fade > 0 && x > fadeX) ? Math.max(0, (w - x) / (w * fade)) : 1;
        const bar = Math.max(2 * dpr, v * h * ampScale) * mult;
        if (bar < 1) continue;
        g.fillRect(x, (h - bar) / 2, 1, bar);
    }
    if (fade > 0) {
        g.fillStyle = 'rgba(0, 0, 0, 0.32)';
        g.beginPath(); g.moveTo(fadeX, 0); g.lineTo(w, 0); g.lineTo(w, h); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        g.lineWidth = Math.max(1, dpr);
        g.beginPath(); g.moveTo(fadeX, 0); g.lineTo(w, h); g.stroke();
    }
}

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
(async () => {
    try {
        let list = null;
        if (window.sa && window.sa.listFonts) { const r = await window.sa.listFonts(); list = r && r.fonts; if (r && r.styles) state.fontStyles = r.styles; }
        if ((!list || !list.length) && typeof window.queryLocalFonts === 'function') {
            const f = await window.queryLocalFonts();
            list = Array.from(new Set(f.map(x => x.family))).sort((a, b) => a.localeCompare(b));
            for (const x of f) { (state.fontStyles[x.family] = state.fontStyles[x.family] || []).includes(x.style) || state.fontStyles[x.family].push(x.style); }
        }
        if (list && list.length) state.fonts = list;
    } catch (e) { /* keep the short list */ }
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

const ALIGN_HTML = (S) => `
<div class="row between">
    <span class="aln-title">
        <span class="label">Alignment timeline</span>
        <span class="aln-play">
            <button type="button" id="alnPlay${S}" class="ghost aln-btn" title="Play once with its sound (click again to pause)">▶</button>
            <button type="button" id="alnMode${S}" class="ghost aln-btn" title="Loop the animation with its sound">🔁</button>
        </span>
    </span>
    <label class="check" title="When on, moving the text carries the sound with it, and links the clips on the Resolve timeline">
        <input id="linked${S}" type="checkbox" checked> Link text + sound
    </label>
</div>
<div id="tl${S}" class="tl"></div>
<div class="row sfxlen">
    <label class="sfxlen-lbl" for="sfxLenMode${S}" title="How long the sound is when it is added to the timeline">Sound length</label>
    <select id="sfxLenMode${S}">
        <option value="estimate">Estimate (follows the caption)</option>
        <option value="fixed">Fixed (keeps this length)</option>
    </select>
</div>
<div class="hint" id="sfxLenHint${S}"></div>
<div class="hint">Drag the sound to line it up. Drag the text to move both (when linked), or its edges to change when it starts and ends.${S === 'U' ? ' Click the ruler to move the Resolve playhead.' : ''}</div>
<div class="row nums">
    <label title="Double-click to reset to default (0f)">Text start <input id="textOffset${S}" type="number" step="1" value="0" data-default="0"><span class="u">f</span></label>
    <label title="Double-click to reset to default (0f)">Sound start <input id="sfxOffset${S}" type="number" step="1" value="0" data-default="0"><span class="u">f</span></label>
    <label title="Double-click to reset to default (0f)">Text ends <input id="tail${S}" type="number" step="1" value="0" data-default="0"><span class="u">f</span></label>
</div>

<div class="row between sfxhead">
    <label class="check"><input id="useSfx${S}" type="checkbox" checked> Sound effect</label>
    <div class="sfx-attached-display">
        <button type="button" id="sfxPlay${S}" class="ghost sfx-mini-play" title="Preview sound">▶</button>
        <span id="sfxName${S}" class="sfx-name-badge">No sound</span>
    </div>
</div>
<div class="ctl">
    <label title="Double-click to reset to default (0 dB)">Sound volume <span class="val" id="vSfxVolume${S}">0 dB</span></label>
    <input id="sfxVolume${S}" type="range" min="-30" max="6" step="1" value="0" data-default="0">
</div>
<div class="row two">
    <div class="ctl"><label>Text track</label><select id="textTrack${S}"></select></div>
    <div class="ctl"><label>Sound track</label><select id="sfxTrack${S}"></select></div>
</div>
${S === 'U' ? '<div class="row"><button id="resetU" class="ghost">Reset to this item\'s default</button></div>' : ''}`;

const CONFIG_HTML = () => `
<div class="cfg-panel">
    <div class="hint cfg-hint">
        Manage baseline source files for this library preset (.settings and audio). Originals are preserved and can be updated or reverted.
    </div>

    <!-- 1. .SETTINGS SECTION -->
    <div class="cfg-group">
        <div class="cfg-group-head">
            <div class="cfg-group-title">
                <span class="cfg-icon">⚙</span>
                <strong>Fusion Template (.settings)</strong>
            </div>
            <span id="cfgSettingStatus" class="cfg-status-pill orig">Original</span>
        </div>

        <div class="cfg-file-card">
            <div class="cfg-file-row">
                <span class="cfg-file-label">Active:</span>
                <span id="cfgSettingActiveFile" class="cfg-file-name" title="Active working file in animations/">—</span>
            </div>
            <div class="cfg-file-row">
                <span class="cfg-file-label">Original:</span>
                <span id="cfgSettingOrigFile" class="cfg-file-name" title="Preserved original in animations_orig/">—</span>
            </div>
        </div>

        <div class="cfg-action-row">
            <button type="button" id="cfgSettingRevert" class="ghost cfg-btn-revert" title="Revert .settings and design back to original baseline">
                ↺ Revert to original
            </button>
        </div>

        <div class="cfg-subgroup">
            <div class="cfg-subgroup-title">Overwrite original using:</div>
            <div class="cfg-btn-grid">
                <button type="button" id="cfgSettingFromTimeline" class="ghost cfg-action-btn" title="Export currently selected Text+ clip on Resolve timeline to overwrite original">
                    <span>🎞 Selected timeline</span>
                </button>
                <button type="button" id="cfgSettingFromCurrent" class="ghost cfg-action-btn" title="Overwrite original with current preset settings">
                    <span>💾 Current settings</span>
                </button>
            </div>
            <div id="cfgSettingDrop" class="drop cfg-dropzone" title="Drop a .setting or .comp file or folder here to overwrite original">
                <span class="cfg-drop-icon">📄</span>
                <span id="cfgSettingDropText" class="grow">Drop .setting or folder here</span>
                <button type="button" id="cfgSettingPick" class="ghost sm-btn">Pick folder / file…</button>
            </div>
            <input type="file" id="cfgSettingFileInput" accept=".setting,.comp" style="display:none">
        </div>
    </div>

    <!-- 2. AUDIO SECTION -->
    <div class="cfg-group">
        <div class="cfg-group-head">
            <div class="cfg-group-title">
                <span class="cfg-icon">🔊</span>
                <strong>Sound Effect (Audio)</strong>
            </div>
            <span id="cfgAudioStatus" class="cfg-status-pill none">None</span>
        </div>

        <div class="cfg-file-card">
            <div class="cfg-file-row">
                <span class="cfg-file-label">Active:</span>
                <span id="cfgAudioActiveFile" class="cfg-file-name" title="Current attached audio in sfx/">—</span>
                <button type="button" id="cfgAudioPlay" class="ghost sfx-mini-play" title="Preview audio">▶</button>
                <button type="button" id="cfgAudioRemove" class="ghost sfx-del-btn" title="Detach sound effect">🗑</button>
            </div>
            <div class="cfg-file-row">
                <span class="cfg-file-label">Original:</span>
                <span id="cfgAudioOrigFile" class="cfg-file-name" title="Original sound file in sfx/">—</span>
            </div>
        </div>

        <div class="cfg-action-row between">
            <button type="button" id="cfgAudioRevert" class="ghost cfg-btn-revert" title="Revert audio back to original sound">
                ↺ Revert to original audio
            </button>
            <div class="cfg-orig-picker-wrap">
                <button type="button" id="cfgAudioOrigBtn" class="ghost sm-btn" title="Choose from stored original sounds">From SFX Originals ▾</button>
                <div id="cfgAudioOrigDropdown" class="sfx-orig-dropdown hidden"></div>
            </div>
        </div>

        <div class="cfg-subgroup">
            <div class="cfg-subgroup-title">Overwrite original using:</div>
            <div class="cfg-btn-grid">
                <button type="button" id="cfgAudioFromTimeline" class="ghost cfg-action-btn" title="Use selected audio clip on Resolve timeline to overwrite original">
                    <span>🎞 Selected timeline</span>
                </button>
                <button type="button" id="cfgAudioFromCurrent" class="ghost cfg-action-btn" title="Overwrite original audio with current audio">
                    <span>💾 Current audio</span>
                </button>
            </div>
            <div id="cfgAudioDrop" class="drop cfg-dropzone" title="Drop an audio file or folder here to overwrite original">
                <span class="cfg-drop-icon">🎵</span>
                <span id="cfgAudioDropText" class="grow">Drop audio or folder here</span>
                <button type="button" id="cfgAudioPick" class="ghost sm-btn">Pick folder / file…</button>
            </div>
            <input type="file" id="cfgAudioFileInput" accept="audio/*,.wav,.mp3,.aif,.aiff,.m4a,.flac,.ogg" style="display:none">
        </div>
    </div>
</div>
`;

// ---- Resolve Inspector-style building blocks (label | control | value box)
const TEXT_DESIGN_HTML = (S) => `
<div class="td-panel">
    <div class="td-header">
        <span class="label">Text &amp; Shading Design</span>
        <span class="meta">${S === 'U' ? 'On-the-go override' : 'Default design'}</span>
    </div>

    <div id="tdTarget${S}" class="td-target hidden"></div>

    <div id="tdTabs${S}" class="td-tabs" role="tablist">
        <button type="button" class="td-tab on" data-tab="text">Text</button>
        <button type="button" class="td-tab" data-tab="shading">Shading Elements</button>
        <button type="button" class="td-tab" data-tab="layout">Layout</button>
    </div>

    <div class="td-pane" data-pane="text">
    <div class="row two">
        <div class="ctl">
            <label title="Double-click to reset to default (Poppins)">Font</label>
            <input id="tdFont${S}" type="text" placeholder="Search fonts…" data-default="Poppins" autocomplete="off" spellcheck="false">
        </div>
        <div class="ctl">
            <label title="Double-click to reset to default (Bold)">Style</label>
            <select id="tdStyle${S}" data-default="Bold">
                ${STYLE_OPTIONS.map(st => `<option value="${st}">${st}</option>`).join('')}
            </select>
        </div>
    </div>
    <div class="row td-color-size">
        <label class="color-pick" title="Primary text fill color (Element 1) · Double-click to reset to #ffffff">
            <span>Color</span>
            <input id="tdColor${S}" type="color" value="#ffffff" data-default="#ffffff">
        </label>
        <div class="ctl grow">
            <label title="Double-click to reset to default (0.080)">Size <span class="val" id="vTdSize${S}">0.080</span></label>
            <input id="tdSize${S}" type="range" min="0.02" max="0.40" step="0.002" value="0.08" data-default="0.08">
        </div>
    </div>
    <div class="row two">
        <div class="ctl">
            <label title="Double-click to reset to default (1.00)">Tracking <span class="val" id="vTdTrack${S}">1.00</span></label>
            <input id="tdTrack${S}" type="range" min="0.50" max="2.00" step="0.01" value="1.00" data-default="1.00">
        </div>
        <div class="ctl">
            <label title="Double-click to reset to default (1.00)">Line Spacing <span class="val" id="vTdLine${S}">1.00</span></label>
            <input id="tdLine${S}" type="range" min="0.50" max="2.00" step="0.01" value="1.00" data-default="1.00">
        </div>
    </div>
    <div class="td-textplus">
    <div class="td-line">
        <span class="td-lbl">V Anchor</span>
        <div class="td-btns" id="tdVAncBtns${S}"><button type="button" class="td-ibtn" data-anchor="v" data-val="-1" title="Top"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2h12M2 14h12" stroke="currentColor" stroke-width="1" opacity=".35"/><rect x="5" y="2" width="6" height="3" rx=".5" fill="currentColor"/></svg></button><button type="button" class="td-ibtn" data-anchor="v" data-val="0" title="Center"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2h12M2 14h12" stroke="currentColor" stroke-width="1" opacity=".35"/><rect x="5" y="7" width="6" height="3" rx=".5" fill="currentColor"/></svg></button><button type="button" class="td-ibtn" data-anchor="v" data-val="1" title="Bottom"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2h12M2 14h12" stroke="currentColor" stroke-width="1" opacity=".35"/><rect x="5" y="12" width="6" height="3" rx=".5" fill="currentColor"/></svg></button></div>
        <div class="td-slwrap">
            <input id="tdVAnc${S}" type="range" min="-1" max="1" step="0.01" value="0" data-default="0" title="Double-click to reset to default (0)">
            <div class="td-sllbl"><span>Top</span><span>Bottom</span></div>
        </div>
    </div>
    <div class="td-line">
        <span class="td-lbl">V Justify</span>
        <div class="td-slwrap full">
            <input id="tdVJust${S}" type="range" min="0" max="1" step="0.01" value="0" data-default="0" title="Double-click to reset to default (0)">
        </div>
        <span class="val td-num" id="vTdVJust${S}">0.00</span>
    </div>
    <div class="td-line">
        <span class="td-lbl">H Anchor</span>
        <div class="td-btns" id="tdHAncBtns${S}"><button type="button" class="td-ibtn" data-anchor="h" data-val="-1" title="Left"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2v12M14 2v12" stroke="currentColor" stroke-width="1" opacity=".35"/><rect x="3" y="6" width="4" height="4" rx=".5" fill="currentColor"/></svg></button><button type="button" class="td-ibtn" data-anchor="h" data-val="0" title="Center"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2v12M14 2v12" stroke="currentColor" stroke-width="1" opacity=".35"/><rect x="6" y="6" width="4" height="4" rx=".5" fill="currentColor"/></svg></button><button type="button" class="td-ibtn" data-anchor="h" data-val="1" title="Right"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2v12M14 2v12" stroke="currentColor" stroke-width="1" opacity=".35"/><rect x="9" y="6" width="4" height="4" rx=".5" fill="currentColor"/></svg></button></div>
        <div class="td-slwrap">
            <input id="tdHAnc${S}" type="range" min="-1" max="1" step="0.01" value="0" data-default="0" title="Double-click to reset to default (0)">
            <div class="td-sllbl"><span>Left</span><span>Right</span></div>
        </div>
    </div>
    <div class="td-line">
        <span class="td-lbl">H Justify</span>
        <div class="td-slwrap full">
            <input id="tdHJust${S}" type="range" min="0" max="1" step="0.01" value="0" data-default="0" title="Double-click to reset to default (0)">
        </div>
        <span class="val td-num" id="vTdHJust${S}">0.00</span>
    </div>
    <div class="td-line">
        <span class="td-lbl">Direction</span>
        <select id="tdDir${S}" class="td-sel" data-default="0"><option value="0">Automatic</option><option value="1">Horizontal</option><option value="2">Reversed Horizontal</option><option value="3">Vertical</option><option value="4">Reversed Vertical</option></select>
    </div>
    <div class="td-line">
        <span class="td-lbl">Line Direction</span>
        <select id="tdLDir${S}" class="td-sel" data-default="0"><option value="0">Automatic</option><option value="1">Top Down</option><option value="2">Bottom Up</option></select>
    </div>
    <div class="td-line">
        <span class="td-lbl">Emphasis</span>
        <div class="td-btns">
            <button type="button" class="td-ibtn" id="tdStrike${S}" title="Strikeout"><svg viewBox="0 0 16 16" width="14" height="14"><text x="3" y="12" font-size="11" font-weight="700" fill="currentColor">S</text><path d="M1 8h14" stroke="currentColor" stroke-width="1.3"/></svg></button>
            <button type="button" class="td-ibtn" id="tdUnder${S}" title="Underline"><svg viewBox="0 0 16 16" width="14" height="14"><text x="3.5" y="11" font-size="11" font-weight="700" fill="currentColor">U</text><path d="M2 14h12" stroke="currentColor" stroke-width="1.3"/></svg></button>
        </div>
    </div>
    </div>

    </div>

    <div class="td-pane hidden" data-pane="layout">
    <div class="td-layout">
        <div class="xform-grid-row">
            <label class="xform-lbl" for="lyType${S}" title="Double-click to reset to default (Point)">Type</label>
            <select id="lyType${S}" class="ly-select" data-default="0">
                <option value="0">Point</option>
                <option value="1">Frame</option>
                <option value="2">Circle</option>
                <option value="3">Path</option>
            </select>
        </div>
        <div class="xform-grid-row">
            <label class="xform-lbl" title="Where the text sits (same as dragging it on the preview). Double-click to reset to 0.5 / 0.5">Center</label>
            <div class="xform-num-cell"><span class="xform-axis">X</span><input id="lyCx${S}" type="number" class="rv-num xform-num" step="0.001" value="0.5" data-default="0.5"></div>
            <div class="xform-num-cell"><span class="xform-axis">Y</span><input id="lyCy${S}" type="number" class="rv-num xform-num" step="0.001" value="0.5" data-default="0.5"></div>
        </div>
        <div class="xform-grid-row">
            <label class="xform-lbl" for="lyCzN${S}" title="Double-click to reset to default (0.0)">Center Z</label>
            <div class="xform-slider-cell"><input id="lyCz${S}" type="range" class="rv-slider" min="-1" max="1" step="0.01" value="0" data-default="0"></div>
            <div class="xform-num-cell"><input id="lyCzN${S}" type="number" class="rv-num xform-num" step="0.01" value="0" data-default="0"></div>
        </div>
        <div class="xform-grid-row">
            <label class="xform-lbl" title="Double-click to reset to 0.5 / 0.5">Pivot</label>
            <div class="xform-num-cell"><span class="xform-axis">X</span><input id="lyPx${S}" type="number" class="rv-num xform-num" step="0.001" value="0.5" data-default="0.5"></div>
            <div class="xform-num-cell"><span class="xform-axis">Y</span><input id="lyPy${S}" type="number" class="rv-num xform-num" step="0.001" value="0.5" data-default="0.5"></div>
        </div>
        <div class="xform-grid-row">
            <label class="xform-lbl" for="lyPzN${S}" title="Double-click to reset to default (0.0)">Pivot Z</label>
            <div class="xform-slider-cell"><input id="lyPz${S}" type="range" class="rv-slider" min="-1" max="1" step="0.01" value="0" data-default="0"></div>
            <div class="xform-num-cell"><input id="lyPzN${S}" type="number" class="rv-num xform-num" step="0.01" value="0" data-default="0"></div>
        </div>
        <div class="xform-grid-row">
            <label class="xform-lbl" for="lySizeN${S}" title="Double-click to reset to default (1.0)">Size</label>
            <div class="xform-slider-cell"><input id="lySize${S}" type="range" class="rv-slider" min="0" max="5" step="0.01" value="1" data-default="1"></div>
            <div class="xform-num-cell"><input id="lySizeN${S}" type="number" class="rv-num xform-num" min="0" step="0.01" value="1" data-default="1"></div>
        </div>
        <div class="xform-grid-row">
            <label class="xform-lbl" for="lyPerspN${S}" title="Double-click to reset to default (1.0)">Perspective</label>
            <div class="xform-slider-cell"><input id="lyPersp${S}" type="range" class="rv-slider" min="0" max="5" step="0.01" value="1" data-default="1"></div>
            <div class="xform-num-cell"><input id="lyPerspN${S}" type="number" class="rv-num xform-num" min="0" step="0.01" value="1" data-default="1"></div>
        </div>
    </div>

    </div>

    <div class="td-pane hidden" data-pane="shading">
    <div class="sh-row">
        <span class="sh-lbl">Select Element</span>
        <div id="shSel${S}" class="sh-tabs">
            ${[1, 2, 3, 4, 5, 6, 7, 8].map(i => `<button type="button" class="sh-tab" data-idx="${i}">${i}</button>`).join('')}
        </div>
    </div>
    <div class="row between sh-name-row">
        <input id="shName${S}" type="text" class="sh-name" placeholder="Element name">
        <label class="check"><input id="shEnabled${S}" type="checkbox"> Enabled</label>
    </div>

    <div id="shProps${S}" class="sh-props">
        <div class="sh-row">
            <span class="sh-lbl">Appearance</span>
            <div id="shShape${S}" class="sh-shapes">
                <button type="button" class="sh-shape" data-shape="0" title="Text Fill"><b>A</b></button>
                <button type="button" class="sh-shape" data-shape="1" title="Text Outline">
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13.5 8 2.5l5 11M4.8 9.5h6.4"/></svg>
                </button>
                <button type="button" class="sh-shape" data-shape="2" title="Border Fill (Box)"><span class="ico-box-fill"></span></button>
                <button type="button" class="sh-shape" data-shape="3" title="Border Outline"><span class="ico-box-out"></span></button>
            </div>
        </div>
        <div class="rv-row">
            <label class="rv-lbl" title="Double-click to reset to default (Solid)">Type</label>
            <div id="shType${S}" class="rv-seg">
                <button type="button" class="rv-seg-btn on" data-type="0">Solid</button>
                <button type="button" class="rv-seg-btn" data-type="2">Gradient</button>
            </div>
            <span class="rv-kf-space" title="Keyframe">
                <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
            </span>
        </div>

        <!-- Solid Color & Opacity (Alpha) Section -->
        <div id="shSolidWrap${S}" class="rv-color-group">
            <div class="rv-row">
                <label class="rv-lbl" for="shColor${S}" title="Click to choose color">Color</label>
                <div class="rv-color-ctl">
                    <button type="button" class="rv-disclosure open" id="shColorToggle${S}" title="Toggle RGBA controls">
                        <svg viewBox="0 0 10 10" width="8" height="8" fill="currentColor"><path d="M2.5 1.5 L7.5 5 L2.5 8.5 Z"/></svg>
                    </button>
                    <div class="rv-swatch-box" id="shSwatchBox${S}" title="Click to choose color">
                        <div class="rv-swatch-fill" id="shSwatchFill${S}"></div>
                        <input id="shColor${S}" type="color" value="#ffffff" data-default="#ffffff" class="rv-native-color">
                    </div>
                    <input id="shHex${S}" type="text" class="hex-input" maxlength="7" spellcheck="false" placeholder="#ffffff" value="#ffffff" title="Hex color code">
                    <button type="button" class="rv-eyedropper-btn" id="shDropBtn${S}" title="Pick screen color">
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                            <path d="M13.354.646a1.207 1.207 0 0 0-1.708 0L8.5 3.793l-.646-.647a.5.5 0 1 0-.708.708L8.293 5l-7.147 7.146A.5.5 0 0 0 1 12.5v2a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .354-.146L11 7.707l1.146 1.147a.5.5 0 0 0 .708-.708l-.647-.646 3.147-3.146a1.207 1.207 0 0 0 0-1.708l-2-2zM2 12.707l7-7L10.293 7l-7 7H2v-1.293z"/>
                        </svg>
                    </button>
                </div>
                <span class="rv-kf-space">
                    <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                </span>
            </div>

            <div id="shSolidSliders${S}">
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shRN${S}" title="Double-click to reset to 1.0">Red</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-r"></span>
                        <input id="shR${S}" type="range" class="rv-slider rv-r" min="0" max="1" step="0.001" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shRN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                    <span class="rv-kf-space">
                        <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                    </span>
                </div>
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shGN${S}" title="Double-click to reset to 1.0">Green</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-g"></span>
                        <input id="shG${S}" type="range" class="rv-slider rv-g" min="0" max="1" step="0.001" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shGN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                    <span class="rv-kf-space">
                        <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                    </span>
                </div>
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shBN${S}" title="Double-click to reset to 1.0">Blue</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-b"></span>
                        <input id="shB${S}" type="range" class="rv-slider rv-b" min="0" max="1" step="0.001" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shBN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                    <span class="rv-kf-space">
                        <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                    </span>
                </div>
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="vShOpacity${S}" title="Double-click to reset to 1.00">Alpha</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-a"></span>
                        <input id="shOpacity${S}" type="range" class="rv-slider rv-a" min="0" max="1" step="0.01" value="1" data-default="1.00">
                    </div>
                    <div class="rv-num-cell">
                        <input id="vShOpacity${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.00">
                    </div>
                    <span class="rv-kf-space">
                        <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                    </span>
                </div>
            </div>
        </div>

        <!-- Gradient Section -->
        <div id="shGradWrap${S}" class="rv-color-group hidden">
            <div class="rv-row">
                <label class="rv-lbl">Shading Gradient</label>
                <div class="rv-spacer"></div>
                <span class="rv-kf-space">
                    <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                </span>
            </div>

            <div class="rv-grad-bar-wrap">
                <div class="rv-grad-bar" id="shGradBar${S}"></div>
                <div class="rv-grad-stops" id="shGradStops${S}">
                    <div class="rv-grad-stop sel" data-stop="0" id="shStop0${S}" style="left: 0%;" title="Start Color (0.0)">
                        <svg viewBox="0 0 10 10" width="10" height="10"><polygon points="5,0 10,10 0,10" fill="currentColor"/></svg>
                    </div>
                    <div class="rv-grad-stop" data-stop="1" id="shStop1${S}" style="left: 100%;" title="End Color (1.0)">
                        <svg viewBox="0 0 10 10" width="10" height="10"><polygon points="5,0 10,10 0,10" fill="currentColor"/></svg>
                    </div>
                </div>
            </div>

            <div class="rv-row rv-offset-row">
                <div class="rv-spacer"></div>
                <div class="rv-num-cell">
                    <input id="shStopOffset${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="0.0" readonly title="Stop Offset">
                </div>
            </div>

            <div class="rv-row">
                <label class="rv-lbl" id="shStopLbl${S}">Start Color</label>
                <div class="rv-color-ctl">
                    <button type="button" class="rv-disclosure open" id="shGradColorToggle${S}">
                        <svg viewBox="0 0 10 10" width="8" height="8" fill="currentColor"><path d="M2.5 1.5 L7.5 5 L2.5 8.5 Z"/></svg>
                    </button>
                    <div class="rv-swatch-box" id="shGradSwatchBox${S}" title="Click to choose stop color">
                        <div class="rv-swatch-fill" id="shGradSwatchFill${S}"></div>
                        <input id="shGradColorInput${S}" type="color" value="#ffffff" class="rv-native-color">
                    </div>
                    <input id="shGradHex${S}" type="text" class="hex-input" maxlength="7" spellcheck="false" placeholder="#ffffff" value="#ffffff" title="Hex color code for active stop">
                    <button type="button" class="rv-eyedropper-btn" id="shGradDropBtn${S}" title="Pick screen color">
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                            <path d="M13.354.646a1.207 1.207 0 0 0-1.708 0L8.5 3.793l-.646-.647a.5.5 0 1 0-.708.708L8.293 5l-7.147 7.146A.5.5 0 0 0 1 12.5v2a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .354-.146L11 7.707l1.146 1.147a.5.5 0 0 0 .708-.708l-.647-.646 3.147-3.146a1.207 1.207 0 0 0 0-1.708l-2-2zM2 12.707l7-7L10.293 7l-7 7H2v-1.293z"/>
                        </svg>
                    </button>
                    <input id="shColor2${S}" type="color" value="#f07b8e" data-default="#f07b8e" class="hidden">
                </div>
            </div>

            <div id="shGradSliders${S}">
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shGradRN${S}" title="Double-click to reset to 1.0">Red</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-r"></span>
                        <input id="shGradR${S}" type="range" class="rv-slider rv-r" min="0" max="1" step="0.001" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shGradRN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                </div>
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shGradGN${S}" title="Double-click to reset to 1.0">Green</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-g"></span>
                        <input id="shGradG${S}" type="range" class="rv-slider rv-g" min="0" max="1" step="0.001" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shGradGN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                </div>
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shGradBN${S}" title="Double-click to reset to 1.0">Blue</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-b"></span>
                        <input id="shGradB${S}" type="range" class="rv-slider rv-b" min="0" max="1" step="0.001" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shGradBN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                </div>
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shGradAN${S}" title="Double-click to reset to 1.0">Alpha</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-a"></span>
                        <input id="shGradA${S}" type="range" class="rv-slider rv-a" min="0" max="1" step="0.01" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shGradAN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                </div>
            </div>

            <div class="rv-row">
                <label class="rv-lbl" for="shMapAngleN${S}" title="Double-click to reset to default (0.0)">Mapping Angle</label>
                <div class="rv-slider-track-wrap">
                    <input id="shMapAngle${S}" type="range" class="rv-slider" min="-180" max="180" step="1" value="0" data-default="0">
                </div>
                <div class="rv-num-cell">
                    <input id="shMapAngleN${S}" type="number" class="rv-num" min="-180" max="180" step="0.1" value="0.0" data-default="0.0">
                </div>
                <span class="rv-kf-space">
                    <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                </span>
            </div>

            <div class="rv-row">
                <label class="rv-lbl" for="shMapSizeN${S}" title="Double-click to reset to default (1.00)">Mapping Size</label>
                <div class="rv-slider-track-wrap">
                    <input id="shMapSize${S}" type="range" class="rv-slider" min="0.1" max="5" step="0.01" value="1" data-default="1.00">
                </div>
                <div class="rv-num-cell">
                    <input id="shMapSizeN${S}" type="number" class="rv-num" min="0.1" max="10" step="0.01" value="1.0" data-default="1.00">
                </div>
                <span class="rv-kf-space">
                    <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                </span>
            </div>

            <div class="rv-row">
                <label class="rv-lbl" for="shMapAspectN${S}" title="Double-click to reset to default (1.00)">Mapping Aspect</label>
                <div class="rv-slider-track-wrap">
                    <input id="shMapAspect${S}" type="range" class="rv-slider" min="0.1" max="5" step="0.01" value="1" data-default="1.00">
                </div>
                <div class="rv-num-cell">
                    <input id="shMapAspectN${S}" type="number" class="rv-num" min="0.1" max="10" step="0.01" value="1.0" data-default="1.00">
                </div>
                <span class="rv-kf-space">
                    <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                </span>
            </div>

            <div class="rv-row">
                <label class="rv-lbl" for="shMapLevel${S}">Mapping Level</label>
                <select id="shMapLevel${S}" class="rv-select" data-default="3">
                    <option value="3">Character</option>
                    <option value="2">Word</option>
                    <option value="1">Line</option>
                    <option value="0">Text</option>
                </select>
                <span class="rv-kf-space">
                    <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                </span>
            </div>
        </div>
        <div id="shThickWrap${S}" class="ctl">
            <label title="Double-click to reset to default (0.020)">Thickness <span class="val" id="vShThickness${S}">0.020</span></label>
            <input id="shThickness${S}" type="range" min="0" max="0.15" step="0.002" value="0.02" data-default="0.020">
        </div>
        <div id="shBorderWrap${S}" class="sh-border-box">
            <div class="ctl">
                <label>Level</label>
                <select id="shLevel${S}" data-default="3">
                    <option value="0">Text</option>
                    <option value="1">Line</option>
                    <option value="2">Word</option>
                    <option value="3">Character</option>
                </select>
            </div>
            <div class="ctl">
                <label title="Double-click to reset to default (0.000)">Extend Horizontal <span class="val" id="vShExtendH${S}">0.000</span></label>
                <input id="shExtendH${S}" type="range" min="-0.2" max="1.0" step="0.005" value="0" data-default="0.000">
            </div>
            <div class="ctl">
                <label title="Double-click to reset to default (0.000)">Extend Vertical <span class="val" id="vShExtendV${S}">0.000</span></label>
                <input id="shExtendV${S}" type="range" min="-0.2" max="1.0" step="0.005" value="0" data-default="0.000">
            </div>
            <div class="ctl">
                <label title="Double-click to reset to default (0.000)">Round <span class="val" id="vShRound${S}">0.000</span></label>
                <input id="shRound${S}" type="range" min="0" max="1.0" step="0.005" value="0" data-default="0.000">
            </div>
        </div>
        <div class="row nums sh-soft-row">
            <label title="Double-click to reset to default (0)">Softness <input id="shSoftness${S}" type="number" min="0" max="30" step="0.5" value="0" data-default="0"></label>
            <label title="Double-click to reset to default (0)">Offset X <input id="shOffsetX${S}" type="number" min="-1" max="1" step="0.01" value="0" data-default="0"></label>
            <label title="Double-click to reset to default (0)">Offset Y <input id="shOffsetY${S}" type="number" min="-1" max="1" step="0.01" value="0" data-default="0"></label>
        </div>
    </div>
    </div>
</div>`;

const SAVE_BAR_HTML = (S) => `
<div id="tdSaveBar${S}" class="td-save-bar hidden">
    <div class="row td-var-row">
        <span class="sh-lbl">New version name</span>
        <input id="tdVarName${S}" type="text" class="sh-name" placeholder="Name v2">
    </div>
    <div class="row td-btn-row">
        <button type="button" id="tdSaveVar${S}" class="td-btn-new" title="Save this alignment, Text+ design, and sound as a new preset in your library">+ Create v2</button>
        <button type="button" id="tdUpdateLatest${S}" class="td-btn-upd" title="Update this preset and the latest Text+ subtitle clip on your timeline">Update latest</button>
        <button type="button" id="tdRevertOrig${S}" class="ghost sm-btn td-btn-revert" title="Revert this preset to its original .settings, text design, alignment, and sound">↺ Revert to original</button>
    </div>
</div>`;

const ADJUST_HTML = ALIGN_HTML;

const PREVIEW_HTML = (S) => `
<div id="stageBox${S}" class="stage-box">
    <div id="stageTopOverlay${S}" class="stage-top-overlay">
        <button type="button" id="stageResizeBtn${S}" class="stage-ov-btn" title="Toggle preview viewer height resizer">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
                <path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z"/>
            </svg>
            <span id="stageResizeLbl${S}">Resize viewer</span>
        </button>
        <button type="button" id="stageSizeReset${S}" class="stage-ov-btn stage-ov-reset hidden" title="Reset viewer height to default aspect ratio">Reset size</button>
        ${S === 'U' ? `<button type="button" id="stageLiveBtn${S}" class="stage-ov-btn stage-ov-live" title="Put the real Text+ on your Resolve timeline at this subtitle so you can play it in Resolve's own viewer. Changes in Alignment and Text Design then update that clip live.">▶ Preview in Resolve</button>` : ''}
    </div>
    <canvas id="stage${S}" class="stage" width="640" height="360" title="Drag text to move, drag corners to resize, drag top handle to rotate"></canvas>
    <div id="stageResize${S}" class="stage-resizer hidden" title="Drag to resize preview height (double-click to reset)"><span></span></div>
</div>
${S === 'U' ? `<div id="stageLive${S}" class="stage-live hidden">
    <div class="stage-live-txt"><b>Previewing in Resolve</b><span>Play it in Resolve's viewer. Alignment and Text Design changes update the clip live.</span><span class="live-note" title="The plugin tries to switch Loop on for you (it needs macOS Accessibility permission). If the playhead does not repeat the In/Out range, press Cmd+/ in Resolve.">⚠ Make sure Loop is turned on in Resolve (Playback > Loop, Cmd+/).</span></div>
    <div class="stage-live-btns">
        <button type="button" id="liveRemove${S}" class="live-remove" title="Delete the preview clip from the timeline and bring back the app preview">Remove preview</button>
        <button type="button" id="liveApply${S}" class="live-apply" title="Keep the Text+ on the timeline (with its sound) and end the preview">Apply</button>
    </div>
</div>` : ''}
${S === 'U' ? `<div id="liveAdvice${S}" class="live-advice">Preview in Resolve starts only when you click <b>▶ Preview in Resolve</b>. Playing, pausing or moving the playhead never starts it.</div>` : ''}
<div id="stageMsg${S}" class="stagemsg"></div>
<div class="xform-section">
    <div class="xform-header">
        <span class="xform-title">Transform</span>
        <div class="xform-hdr-actions">
            ${S === 'U' ? `
            <button type="button" id="liveSyncToggle${S}" class="ghost live-sync-btn" title="Live Sync: moves the subtitle on DaVinci Resolve's viewer in real time as you drag">
                <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true">
                    <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/>
                    <path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/>
                </svg>
                <span id="liveSyncLbl${S}">Live Sync</span>
            </button>` : ''}
            <button type="button" id="zoomToggle${S}" class="ghost zoom-toggle-btn" title="Enable scroll-wheel preview zoom (disabled by default)">
                <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
                    <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0"/>
                    <path d="M6.5 4a.5.5 0 0 1 .5.5V6h1.5a.5.5 0 0 1 0 1H7v1.5a.5.5 0 0 1-1 0V7H4.5a.5.5 0 0 1 0-1H6V4.5a.5.5 0 0 1 .5-.5"/>
                </svg>
                <span id="zoomLbl${S}">Zoom</span>
            </button>
            <button type="button" id="resetPos${S}" class="ghost reset-xform-btn" title="Reset transform and preview zoom">Reset</button>
        </div>
    </div>

    <!-- Zoom row -->
    <div class="xform-grid-row">
        <label class="xform-lbl" for="numScale${S}" title="Double-click to reset to default (1.000)">Zoom</label>
        <div class="xform-slider-cell">
            <input id="scale${S}" type="range" class="rv-slider" min="0.050" max="4.000" step="0.005" value="1.000" data-default="1.000">
        </div>
        <div class="xform-num-cell">
            <span class="xform-axis">X/Y</span>
            <input id="numScale${S}" type="number" class="rv-num xform-num" min="0.01" max="10.0" step="0.001" value="1.000" data-default="1.000">
        </div>
    </div>

    <!-- Position X row -->
    <div class="xform-grid-row">
        <label class="xform-lbl" for="numPosX${S}" title="Double-click to reset to default (0.000)">Position X</label>
        <div class="xform-slider-cell">
            <input id="posX${S}" type="range" class="rv-slider" min="-960" max="960" step="0.5" value="0" data-default="0">
        </div>
        <div class="xform-num-cell">
            <span class="xform-axis">X</span>
            <input id="numPosX${S}" type="number" class="rv-num xform-num" step="0.001" value="0.000" data-default="0.000">
        </div>
    </div>

    <!-- Position Y row -->
    <div class="xform-grid-row">
        <label class="xform-lbl" for="numPosY${S}" title="Double-click to reset to default (0.000)">Position Y</label>
        <div class="xform-slider-cell">
            <input id="posY${S}" type="range" class="rv-slider" min="-540" max="540" step="0.5" value="0" data-default="0">
        </div>
        <div class="xform-num-cell">
            <span class="xform-axis">Y</span>
            <input id="numPosY${S}" type="number" class="rv-num xform-num" step="0.001" value="0.000" data-default="0.000">
        </div>
    </div>

    <!-- Rotation Angle row -->
    <div class="xform-grid-row">
        <label class="xform-lbl" for="numRot${S}" title="Double-click to reset to default (0.000)">Rotation Angle</label>
        <div class="xform-slider-cell">
            <input id="rot${S}" type="range" class="rv-slider" min="-180" max="180" step="0.1" value="0" data-default="0">
        </div>
        <div class="xform-num-cell">
            <span class="xform-axis">°</span>
            <input id="numRot${S}" type="number" class="rv-num xform-num" min="-360" max="360" step="0.001" value="0.000" data-default="0.000">
        </div>
    </div>
</div>
<div class="row actions">
    <button id="prev${S}">▶ Preview</button>
    <button id="loop${S}" class="ghost loop-btn" title="Toggle continuous real-time looping preview (runs at timeline frame rate)">🔁 Live Loop</button>
    <button id="prevSfx${S}" class="ghost">▶ Sound only</button>
    ${S === 'C' ? '<button id="prevCapC" class="ghost" title="Takes new preview frames from the Text+ selected on your timeline">Update preview</button>' : ''}
</div>
<button type="button" id="collapseExpandBtn${S}" class="collapse-expand-bar" title="Show Text & Alignment settings (switches to Default view)">
    <span class="collapse-expand-label">Text | Alignment</span>
    <span class="collapse-expand-chev">▾</span>
</button>`;

const CTX = {
    U: {
        s: 'U', scale: null,
        model: () => state.use,
        changed: (m) => {
            if (state.use) {
                state.use.dirty = true;
                state.use.adjusted = true;
            }
            if (m) {
                m.adjusted = true;
                const patch = {
                    posX: Number(m.posX) || 0,
                    posY: Number(m.posY) || 0,
                    scale: Number(m.scale) || 1,
                    rotation: Number(m.rotation) || 0,
                    linked: m.linked !== false,
                    boxes: m.boxes || {}
                };
                // Use tab = one-time override: nothing is written to the preset's saved default.
                void patch;
                syncVarButtons('U', m);
            }
            renderUseSummary();
        }
    },
    C: {
        s: 'C', scale: null,
        model: () => libEntry(state.createId),
        changed: (m) => {
            state.createAdjusted = true;
            if (m) {
                m.adjusted = true;
                syncVarButtons('C', m);
            }
            saveField(m.id, {
                textOffset: m.textOffset, sfxOffset: m.sfxOffset, sfxTrimIn: m.sfxTrimIn || 0, sfxLen: m.sfxLen === undefined ? null : m.sfxLen, sfxLenMode: sfxLenMode(m), sfxFade: m.sfxFade === undefined ? null : m.sfxFade, tail: m.tail, linked: m.linked !== false,
                sfxVolume: m.sfxVolume, useSfx: m.useSfx !== false, textTrack: m.textTrack, sfxTrack: m.sfxTrack,
                posX: Number(m.posX) || 0, posY: Number(m.posY) || 0,
                scale: Number(m.scale) || 1, rotation: Number(m.rotation) || 0,
                textDesign: m.textDesign, boxes: m.boxes || {}
            });
        }
    }
};

function ctxVisible(ctx) {
    if (ctx.s === 'U') return state.tab === 'apply' && state.adjustOpen && !!state.use;
    return state.tab === 'library' && state.createAdjustOpen !== false && !!libEntry(state.createId);
}

function renderTimelines() {
    for (const c of [CTX.U, CTX.C]) if (ctxVisible(c)) renderTimeline(c);
}

// Renders trimmed & faded PCM 16-bit WAV audio data based on the preserved original sound.
async function renderTrimmedWav(m, span) {
    const p = origSfxPath(m) || currentSfxPath(m);
    if (!p || m.useSfx === false) return null;
    const bytes = await window.sa.readSfx(p);
    if (!(bytes instanceof Uint8Array)) return null;
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    let buf;
    try { buf = await ac.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); } finally { ac.close(); }
    let g;
    waveSecOverride = buf.duration;
    if (span) spanOverride = span;
    try { g = geometry(m); } finally { waveSecOverride = null; spanOverride = null; }
    const sr = buf.sampleRate, ch = Math.min(2, buf.numberOfChannels);
    const startSec = Math.min(g.sfxTrimIn / g.fps, Math.max(0, buf.duration - 2 / g.fps));
    const lenSec = Math.max(2 / g.fps, Math.min(g.sfxFrames / g.fps, buf.duration - startSec));
    const i0 = Math.round(startSec * sr);
    const n = Math.max(1, Math.round(lenSec * sr));
    const fadeN = Math.min(n, Math.round(g.fadeFrames / g.fps * sr));
    const data = new Uint8Array(44 + n * ch * 2);
    const dv = new DataView(data.buffer);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
    for (let c = 0; c < ch; c++) {
        const src = buf.getChannelData(c);
        for (let i = 0; i < n; i++) {
            let v = (i0 + i) < src.length ? src[i0 + i] : 0;
            if (fadeN > 0 && i >= n - fadeN) v *= (n - i) / fadeN;
            v = Math.max(-1, Math.min(1, v));
            dv.setInt16(44 + (i * ch + c) * 2, v < 0 ? v * 32768 : v * 32767, true);
        }
    }
    return { data, origPath: p, g };
}

let syncSfxBusy = false;
async function syncAttachedSfx(m, span) {
    if (!m || !m.id || m.useSfx === false) return null;
    if (syncSfxBusy) return null;
    syncSfxBusy = true;
    try {
        const p = origSfxPath(m) || currentSfxPath(m);
        if (!p) return null;
        const rendered = await renderTrimmedWav(m, span);
        if (!rendered || !rendered.data) return null;
        const res = await window.sa.saveAttachedClip(m.id, rendered.data, baseName(rendered.origPath));
        if (res && res.sfx) {
            m.sfx = res.sfx;
            m.sfxPath = res.sfxPath;
            if (res.sfxOrig) {
                m.sfxOrig = res.sfxOrig;
                m.sfxOrigPath = res.sfxOrigPath;
            }
            if (res.lib) {
                state.lib = res.lib;
            }
        }
        return res;
    } catch (e) {
        return null;
    } finally {
        syncSfxBusy = false;
    }
}

// The Use tab works on a copy, so changes there never touch the saved default.
function syncUse(force) {
    const a = selected();
    if (!a) { state.use = null; return; }
    if (force || !state.use || state.use.id !== a.id || !state.use.dirty) {
        // A refresh of the same preset keeps the one-time subtitle render, so it is not rendered again.
        const keepRender = (!force && state.use && state.use.id === a.id) ? state.use : null;
        state.use = {
            id: a.id, name: a.name, dirty: false, adjusted: false, designDirty: false,
            textOffset: a.textOffset, sfxOffset: a.sfxOffset, tail: a.tail, linked: a.linked !== false,
            sfxTrimIn: a.sfxTrimIn, sfxLen: a.sfxLen, sfxLenMode: a.sfxLenMode, sfxFade: a.sfxFade,
            sfxVolume: a.sfxVolume, useSfx: a.useSfx !== false, textTrack: a.textTrack, sfxTrack: a.sfxTrack,
            posX: Number(a.posX) || 0, posY: Number(a.posY) || 0,
            scale: Number(a.scale) || 1, rotation: Number(a.rotation) || 0,
            textDesign: (keepRender && keepRender.designRev > 0 && keepRender.textDesign) ? keepRender.textDesign : cloneTextDesign(a.textDesign),
            boxes: window.SABoxes ? SABoxes.cloneBoxes(a) : {},
            sfx: a.sfx,
            sfxPath: a.sfxPath,
            sfxOrig: a.sfxOrig,
            sfxOrigPath: a.sfxOrigPath
        };
        if (keepRender) {
            state.use.tempPreview = keepRender.tempPreview;
            state.use.renderReq = keepRender.renderReq;
            state.use.rendering = keepRender.rendering;
            state.use.designRev = keepRender.designRev || 0;
            state.use._shown = keepRender._shown;
            state.use._viewCache = keepRender._viewCache;
        }
    } else {
        // Keep the one-time Use tab values as they are.
        if (!state.use.textDesign) state.use.textDesign = cloneTextDesign(a.textDesign);
    }
}

const saveField = debounce(async (id, patch) => {
    const m = libEntry(id);
    if (m && m.useSfx !== false && (m.sfx || m.sfxOrig)) {
        await syncAttachedSfx(m);
        if (m.sfx) patch.sfx = m.sfx;
        if (m.sfxOrig) patch.sfxOrig = m.sfxOrig;
    }
    const res = await window.sa.updateAnimation(id, patch);
    // Do not swap the data under a drag in progress; the saved values are already what the user sees.
    if (res && res.lib && !state.drag && !state.stageDrag) {
        state.lib = res.lib;
        syncUse(false);
        if (state.createAdjusted && state.createId) {
            const ca = libEntry(state.createId);
            if (ca) { ca.adjusted = true; syncVarButtons('C', ca); }
        }
    }
}, 250);

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
    const win = state.drag && state.drag.ctx === ctx ? state.drag.win : windowFor(g);
    const W = box.clientWidth || 380;
    const ppf = W / (win.hi - win.lo);
    const X = (f) => (f - win.lo) * ppf;
    ctx.scale = { lo: win.lo, ppf };
    box.textContent = '';
    const add = (cls, parent) => { const d = document.createElement('div'); d.className = cls; (parent || box).appendChild(d); return d; };

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
    if (ctx.s === 'U') {
        ruler.addEventListener('pointerdown', (e) => {
            const rect = box.getBoundingClientRect();
            const rel = Math.round(win.lo + (e.clientX - rect.left) / ppf);
            window.sa.seek(g.span.base + rel);
        });
    }

    const laneT = add('lane text'); add('tag', laneT).textContent = 'Text';
    const laneS = add('lane sfx'); add('tag', laneS).textContent = 'Sound';

    // where the original subtitle sits, for reference
    const ghost = add('ghost', laneT);
    ghost.style.left = X(0) + 'px'; ghost.style.width = Math.max(2, g.span.dur * ppf) + 'px';

    // text bar
    const tb = add('bar text', laneT);
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
        lk.style.left = X(g.textS) + 'px'; lk.style.top = '56px'; lk.style.height = '40px';
    }

    // live Resolve playhead (Use tab only) and the preview cursor
    if (ctx.s === 'U' && state.live && state.live.ok) {
        const rel = state.live.frame - g.span.base;
        if (rel >= win.lo && rel <= win.hi) { const ph = add('ph'); ph.style.left = X(rel) + 'px'; }
    }
    add('pv');

    // The timeline is redrawn after every press, so a double press is detected here instead of with dblclick.
    const resets = {};
    const begin = (kind) => (e) => {
        e.preventDefault(); e.stopPropagation();
        stopPreview();
        const now = performance.now();
        if (resets[kind] && state.lastPress && state.lastPress.kind === kind && now - state.lastPress.t < 400) {
            state.lastPress = null;
            resets[kind]();
            ctx.changed(m);
            renderTimeline(ctx);
            return;
        }
        state.lastPress = { kind, t: now };
        state.drag = {
            ctx, kind, x0: e.clientX, ppf, win, a0: { textOffset: m.textOffset, sfxOffset: m.sfxOffset, tail: m.tail },
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
    syncNumbers(ctx);
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
            if (d.kind && d.kind.startsWith('sfx')) {
                syncAttachedSfx(m);
            }
        }
        renderTimeline(d.ctx);
    }
}

// ---------------------------------------------------------------- preview (live timeline frame + overlay + placement)
const imgCache = new Map();

function redrawStages() {
    if (state.preview) return;
    if (state.tab === 'apply') {
        const a = selected();
        if (a) drawStage('U', a, null);
    } else if (state.tab === 'library') {
        const a = libEntry(state.createId);
        if (a) drawStage('C', a, null);
    }
}

async function refreshLiveBg() {
    if (state.idle) return;
    const L = state.live;
    if (!L || !L.ok) return;
    if (L.width && L.height) {
        state.liveBg.width = L.width;
        state.liveBg.height = L.height;
    }
    const key = L.timeline + ':' + L.frame;
    if (state.liveBg.key === key) return;
    if (state.liveBg.busy) {
        state.liveBg.pending = { key, frame: L.frame };
        return;
    }
    state.liveBg.busy = true;
    state.liveBg.key = key;
    try {
        const res = await window.sa.liveFrame(L.frame);
        if (res && res.ok && res.data) {
            if (res.width && res.height) {
                state.liveBg.width = res.width;
                state.liveBg.height = res.height;
            }
            const im = new Image();
            im.onload = () => {
                if (im.naturalWidth && im.naturalHeight) {
                    const imgAr = im.naturalWidth / im.naturalHeight;
                    const metaAr = (state.liveBg.width && state.liveBg.height) ? (state.liveBg.width / state.liveBg.height) : 0;
                    if (Math.abs(imgAr - metaAr) > 0.05) {
                        state.liveBg.width = im.naturalWidth;
                        state.liveBg.height = im.naturalHeight;
                    }
                }
                state.liveBg.img = im;
                redrawStages();
            };
            im.src = 'data:image/jpeg;base64,' + res.data;
        }
    } catch (e) { /* ignore */ }
    state.liveBg.busy = false;
    if (state.liveBg.pending && state.liveBg.pending.key !== state.liveBg.key) {
        const next = state.liveBg.pending;
        state.liveBg.pending = null;
        if (state.live && state.live.ok && state.live.frame === next.frame) refreshLiveBg();
    }
}

function previewImages(a) {
    if (!a || !a.preview || !a.previewFiles || !a.previewFiles.length) return null;
    const key = a.id + ':' + a.preview.count + ':' + (a.preview.stamp || 0);
    let list = imgCache.get(key);
    if (!list) {
        // Held frames share one image (each distinct picture is decoded once). Matte renders are on black.
        const map = (Array.isArray(a.preview.map) && a.preview.map.length === a.previewFiles.length) ? a.preview.map : null;
        const one = new Map();
        list = a.previewFiles.map((p, n) => {
            const k = map ? map[n] : n;
            if (one.has(k)) return one.get(k);
            const i = new Image(); i._bg = a.preview.matte ? 'black' : (a.preview.bg || 'black');
            i.src = fileUrl(a.previewFiles[k] || p) + '?v=' + (a.preview.stamp || 0);
            one.set(k, i);
            return i;
        });
        imgCache.set(key, list);
        while (imgCache.size > 12) imgCache.delete(imgCache.keys().next().value);   // old renders are let go
    }
    return list;
}

// Background keying: preview frames are turned into transparent images on worker threads (one per spare CPU core),
// never on the panel's own thread, so playback and dragging stay smooth while a new render comes in.
// Frames rendered on black AND white (preview.matte) get their exact colour and transparency:
//   on black  B = a*C,   on white  W = a*C + (1-a)*255   ->   a = 1 - (W-B)/255,  C = B/a
// which is right for any colour, gradient, soft shadow or semi-transparent element. Older single-pass frames
// fall back to keying out the background colour they were rendered on.
const SAKey = (() => {
    const code = `
self.onmessage = (ev) => {
    const { id, b, w, bg } = ev.data;
    try {
        const W = b.width, H = b.height;
        const c = new OffscreenCanvas(W, H);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(b, 0, 0);
        const img = g.getImageData(0, 0, W, H);
        const d = img.data;
        let wd = null;
        if (w) { g.clearRect(0, 0, W, H); g.drawImage(w, 0, 0, W, H); wd = g.getImageData(0, 0, W, H).data; }
        const white = bg === 'white';
        let minX = W, minY = H, maxX = -1, maxY = -1, x = 0, y = 0;
        for (let p = 0; p < d.length; p += 4) {
            let a;
            if (wd) {
                const diff = ((wd[p] - d[p]) + (wd[p + 1] - d[p + 1]) + (wd[p + 2] - d[p + 2])) / 3;
                a = 255 - diff;
                if (a < 3) { d[p] = d[p + 1] = d[p + 2] = 0; d[p + 3] = 0; a = 0; }
                else {
                    if (a > 255) a = 255;
                    const k = 255 / a;
                    let r = d[p] * k, gg = d[p + 1] * k, bb = d[p + 2] * k;
                    d[p] = r > 255 ? 255 : r; d[p + 1] = gg > 255 ? 255 : gg; d[p + 2] = bb > 255 ? 255 : bb;
                    d[p + 3] = a;
                }
            } else {
                const cr = d[p], cg = d[p + 1], cb = d[p + 2];
                const m = white ? 255 - Math.min(cr, cg, cb) : Math.max(cr, cg, cb);
                if (m <= 4) { d[p + 3] = 0; a = 0; }
                else { if (m < 28) d[p + 3] = (((m - 4) * d[p + 3]) / 24) | 0; a = m; }
            }
            if (a > 12) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
            if (++x === W) { x = 0; y++; }
        }
        g.putImageData(img, 0, 0);
        const bm = c.transferToImageBitmap();
        b.close(); if (w) w.close();
        const bounds = maxX >= 0
            ? { x: minX / W, y: minY / H, w: Math.max(0.08, (maxX - minX) / W), h: Math.max(0.05, (maxY - minY) / H) }
            : { x: 0.2, y: 0.4, w: 0.6, h: 0.2 };
        self.postMessage({ id, bitmap: bm, bounds }, [bm]);
    } catch (e) { self.postMessage({ id, error: String(e && e.message || e) }); }
};`;
    let pool = null, rr = 0, seq = 0;
    const pending = new Map();
    let broken = false;
    function ensure() {
        if (pool) return pool;
        pool = [];
        try {
            if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') return pool;
            const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
            const n = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
            for (let i = 0; i < n; i++) {
                const w = new Worker(url);
                w.onmessage = (ev) => { const f = pending.get(ev.data.id); if (f) { pending.delete(ev.data.id); f(ev.data); } };
                w.onerror = () => {      // workers cannot run here: every waiting frame falls back to keying on this thread at once
                    broken = true;
                    for (const [pid, f] of pending) { pending.delete(pid); try { f(null); } catch (e) { /* ignore */ } }
                };
                pool.push(w);
            }
        } catch (e) { pool = []; }
        return pool;
    }
    // Resolves to { bitmap, bounds } or null (no workers: the caller keys on this thread instead).
    async function key(im, white, bg) {
        const P = ensure();
        if (!P.length || broken) return null;
        try {
            const [b, w] = await Promise.all([createImageBitmap(im), white ? createImageBitmap(white) : Promise.resolve(null)]);
            const id = ++seq;
            const wk = P[rr++ % P.length];
            return await new Promise((res) => {
                const timer = setTimeout(() => { pending.delete(id); res(null); }, 4000);
                pending.set(id, (m) => { clearTimeout(timer); res(m && m.bitmap ? m : null); });
                wk.postMessage({ id, b, w, bg }, w ? [b, w] : [b]);
            });
        } catch (e) { return null; }
    }
    return { key, available: () => ensure().length > 0 && !broken };
})();

// Keys out the black (0,0,0) background of exported Text+ preview frames so they overlay cleanly on live video.
const keyedLRU = [];
function keyedBounds(im) {
    return im._kbounds || keyedImage(im)._bounds;
}
function keyedImage(im) {
    if (im._keyed) return im._keyed;
    keyedLRU.push(im);
    if (keyedLRU.length > 120) { const old = keyedLRU.shift(); if (old && old !== im) old._keyed = null; }
    const w = im.naturalWidth, h = im.naturalHeight;
    const oc = document.createElement('canvas');
    oc.width = w; oc.height = h;
    const og = oc.getContext('2d');
    og.drawImage(im, 0, 0);
    const whiteBg = im._bg === 'white';
    try {
        const id = og.getImageData(0, 0, w, h);
        const d = id.data;
        let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
        const len = d.length;
        let x = 0, y = 0;
        for (let p = 0; p < len; p += 4) {
            const cr = d[p], cg = d[p + 1], cb = d[p + 2];
            // distance from the background the frame was rendered on: black (brightest channel) or white (darkest)
            const m = whiteBg
                ? 255 - ((cr < cg) ? (cr < cb ? cr : cb) : (cg < cb ? cg : cb))
                : ((cr > cg) ? (cr > cb ? cr : cb) : (cg > cb ? cg : cb));
            if (m <= 4) {
                d[p + 3] = 0;
            } else {
                if (m < 28) d[p + 3] = (((m - 4) * d[p + 3]) / 24) | 0;
                if (m > 12) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    found = true;
                }
            }
            if (++x === w) { x = 0; y++; }
        }
        og.putImageData(id, 0, 0);
        oc._bounds = found
            ? { x: minX / w, y: minY / h, w: Math.max(0.08, (maxX - minX) / w), h: Math.max(0.05, (maxY - minY) / h) }
            : { x: 0.2, y: 0.4, w: 0.6, h: 0.2 };
    } catch (e) {
        oc._bounds = { x: 0.2, y: 0.4, w: 0.6, h: 0.2 };
    }
    im._keyed = oc;
    im._kbounds = oc._bounds;
    return oc;
}

function syncXformUI(S, posX, posY, scale, rotation) {
    const pxEl = $('posX' + S);
    const pyEl = $('posY' + S);
    const scEl = $('scale' + S);
    const rotEl = $('rot' + S);
    const numPxEl = $('numPosX' + S);
    const numPyEl = $('numPosY' + S);
    const numScEl = $('numScale' + S);
    const numRotEl = $('numRot' + S);

    const bg = state.liveBg && state.liveBg.img;
    let tlW = (state.liveBg && state.liveBg.width) || 1920;
    let tlH = (state.liveBg && state.liveBg.height) || 1080;
    if (bg && bg.complete && bg.naturalWidth && bg.naturalHeight) {
        const bgAr = bg.naturalWidth / bg.naturalHeight;
        if (Math.abs(bgAr - (tlW / tlH)) > 0.05) {
            tlW = bg.naturalWidth;
            tlH = bg.naturalHeight;
        }
    }

    let px = Number(posX) || 0;
    let py = Number(posY) || 0;
    if (Math.abs(px) <= 1.0 && Math.abs(py) <= 1.0 && (px !== 0 || py !== 0)) {
        px = Math.round(px * tlW * 10) / 10;
        py = Math.round(-py * tlH * 10) / 10;
    }
    const sc = Number(scale) || 1.0;
    const rot = Number(rotation) || 0;

    const maxPan = Math.round(tlW / 2);
    const maxTilt = Math.round(tlH / 2);

    if (pxEl) {
        pxEl.min = -maxPan;
        pxEl.max = maxPan;
        if (document.activeElement !== pxEl) pxEl.value = clamp(px, -maxPan, maxPan);
    }
    if (pyEl) {
        pyEl.min = -maxTilt;
        pyEl.max = maxTilt;
        if (document.activeElement !== pyEl) pyEl.value = clamp(py, -maxTilt, maxTilt);
    }
    if (scEl && document.activeElement !== scEl) scEl.value = clamp(sc, 0.05, 4.0);
    if (rotEl && document.activeElement !== rotEl) rotEl.value = clamp(rot, -180, 180);

    if (numPxEl && document.activeElement !== numPxEl) numPxEl.value = px.toFixed(3);
    if (numPyEl && document.activeElement !== numPyEl) numPyEl.value = py.toFixed(3);
    if (numScEl && document.activeElement !== numScEl) numScEl.value = sc.toFixed(3);
    if (numRotEl && document.activeElement !== numRotEl) numRotEl.value = rot.toFixed(3);

    const isZoomOn = !!(state.zoomEnabled && state.zoomEnabled[S]);
    const zoomVal = (state.stageZoom && state.stageZoom[S]) || 1.0;
    const zoomBtn = $('zoomToggle' + S);
    const zoomLbl = $('zoomLbl' + S);
    if (zoomBtn) {
        zoomBtn.classList.toggle('on', isZoomOn);
        zoomBtn.title = isZoomOn
            ? `Preview zoom ON (${Math.round(zoomVal * 100)}%) — click to disable scroll-wheel zoom`
            : `Preview zoom disabled — click to enable scroll-wheel zoom`;
    }
    if (zoomLbl) {
        zoomLbl.textContent = isZoomOn ? `Zoom (${Math.round(zoomVal * 100)}%)` : 'Zoom';
    }

    const liveSyncBtn = $('liveSyncToggle' + S);
    if (liveSyncBtn) {
        const isLiveOn = !!(state.liveSyncEnabled && state.liveSyncEnabled[S]);
        liveSyncBtn.classList.toggle('on', isLiveOn);
        liveSyncBtn.title = isLiveOn
            ? 'Live Sync is ON: subtitle moves on DaVinci Resolve viewer in real-time as you drag'
            : 'Live Sync is OFF: click to sync transform to DaVinci Resolve timeline in real-time';
    }
}

function evalSpline(keys, f, defVal) {
    if (!Array.isArray(keys) || !keys.length) return defVal;
    if (f <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
        const [f0, v0] = keys[i], [f1, v1] = keys[i + 1];
        if (f <= f1) {
            const t = f1 > f0 ? (f - f0) / (f1 - f0) : 1;
            return v0 + (v1 - v0) * t;
        }
    }
    return keys[keys.length - 1][1];
}

// Built-in pop-in used when a preset has no size keys of its own: grows past full size, then settles (about 8 frames).
function introPop(idx) {
    const t = clamp(idx / 8, 0, 1);
    const c1 = 1.70158, c3 = c1 + 1;
    const e = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    return Math.max(0.05, 0.6 + 0.4 * e);
}

function wrapToLines(text) {
    if (!text) return [];
    return String(text).split(/\r?\n/).filter(Boolean);
}

// ---------------------------------------------------------------- real Fusion preview with the live subtitle
// Renders the preset in Fusion with the subtitle's own text (only the text changes, every node and keyframe stays as
// the preset was built), then the stage plays those real first-3-seconds frames.
const subPv = { key: null, timer: 0, running: false, failed: new Map(), done: new Set() };
const designTouched = new Set();   // presets whose text design was edited in this session
function normSub(t) { return String(t || '').replace(/\r\n/g, '\n').trim(); }
function currentSubText() {
    return (($('subText') && $('subText').value.trim()) || (state.live && state.live.subtitle && state.live.subtitle.text) || '');
}
// Stable fingerprint of a text design (sorted keys, no derived animation data), to tell whether frames match it.
function designKeyOf(td) {
    const norm = (v) => {
        if (Array.isArray(v)) return v.map(norm);
        if (v && typeof v === 'object') {
            const o = {};
            for (const k of Object.keys(v).sort()) {
                if (k === 'animSpec' || k === 'selectedElement' || v[k] === undefined) continue;
                o[k] = norm(v[k]);
            }
            return o;
        }
        return typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v;
    };
    try { return JSON.stringify(norm(td || null)); } catch (e) { return ''; }
}
function previewMatchesText(a, text) {
    const want = normSub(text);
    if (!want) return true;   // no subtitle: any real render is fine
    return !!(a && a.preview && typeof a.preview.text === 'string' && normSub(a.preview.text) === want);
}
function previewMatchesDesign(a, m) {
    if (!a || !a.preview) return false;
    const dirty = !!((m && m.designDirty) || a.designDirty || designTouched.has(a.id));
    const stored = a.preview.designKey;
    if (!dirty && (stored === undefined || stored === null)) return true;   // older renders: the preset as saved
    return stored === designKeyOf((m && m.textDesign) || a.textDesign);
}
function stageRendering(S, a) {
    if (S === 'U' && state.use && a && state.use.id === a.id && state.use.rendering) return true;
    return !!(a && window.SAThumbs && SAThumbs.isBusy && SAThumbs.isBusy(a.id));
}
// Use tab: the one-time render (subtitle text and/or override design) stands in for the preset's own frames.
function useView(a) {
    const u = state.use;
    if (!a || !u || u.id !== a.id || !u.tempPreview) return a;
    if (!normSub(currentSubText()) && !(u.designRev > 0) && !boxOverrides(u, a)) return a;   // nothing overridden: the preset as saved
    const t = u.tempPreview;
    if (!u._viewCache || u._viewCache.t !== t || u._viewCache.a !== a) {
        u._viewCache = { t, a, v: Object.assign({}, a, { preview: t.preview, previewFiles: t.previewFiles, previewWhite: t.previewWhite || null }) };
    }
    const v = u._viewCache.v;
    // A new render takes over only once all its frames are loaded and keyed; until then the last one keeps playing,
    // so the viewer never blinks or shows a half-loaded animation.
    if (window.SAThumbs && SAThumbs.ready && !SAThumbs.ready(v)) return (u._shown && u._shown.id === a.id && SAThumbs.ready(u._shown)) ? u._shown : a;
    u._shown = v;
    return v;
}
// Preset cards show the subtitle too. The selected preset's card mirrors the viewer (subtitle + Use tab changes);
// the other cards get a render of the subtitle with their saved design, made one at a time in the background once
// the subtitle and the playhead have settled. These never replace a preset's saved default preview.
const subCards = new Map();      // preset id -> { text, temp }
function cardView(a) {
    if (!a) return a;
    const want = normSub(currentSubText());
    if (state.use && state.use.id === a.id) {
        const v = useView(a);
        if (v !== a) return v;
    }
    const c = subCards.get(a.id);
    if (want && c && c.text === want && c.temp) {
        if (!c.view) c.view = Object.assign({}, a, { preview: c.temp.preview, previewFiles: c.temp.previewFiles, previewWhite: c.temp.previewWhite || null });
        if (!window.SAThumbs || !SAThumbs.ready || SAThumbs.ready(c.view)) return c.view;
    }
    return a;
}
(function () {
    let lastSub = '', subSince = 0, lastFrame = null, frameSince = 0, running = false;
    const failed = new Set();
    // Cards keep their default look (sample text). Only the selected preset is rendered, by the viewer below.
    const RENDER_ALL_CARDS_WITH_SUBTITLE = false;
    setInterval(async () => {
        try {
            if (!RENDER_ALL_CARDS_WITH_SUBTITLE) return;
            const want = normSub(currentSubText());
            const now = Date.now();
            if (want !== lastSub) { lastSub = want; subSince = now; }
            const fr = state.live && state.live.frame;
            if (fr !== lastFrame) { lastFrame = fr; frameSince = now; }
            if (running || !want || state.tab !== 'apply' || !state.live || !state.live.ok) return;
            if (now - subSince < 1500 || now - frameSince < 1500) return;               // still scrubbing / typing
            const u = state.use;
            if (state.busy || state.drag || state.stageDrag || state.preview || (u && (u._timer || u.rendering)) || (subPv && subPv.running)) return;
            if (window.SAThumbs && SAThumbs.isBusy && state.lib.animations.some(x => SAThumbs.isBusy(x.id))) return;
            const next = state.lib.animations.find(x => !x.missing && !(u && u.id === x.id) && passesTagFilter(x, 'use')
                && !failed.has(x.id + '\u0000' + want) && !(subCards.get(x.id) && subCards.get(x.id).text === want));
            if (!next) return;
            running = true;
            if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(next.id, true);
            let res;
            try { res = await window.sa.makePreview(next.id, want, null, '', 'sub', boxRenderList(next, next, want, true)); } catch (e) { res = { error: String(e && e.message || e) }; }
            if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(next.id, false);
            running = false;
            if (res && res.error) { if (!/busy/i.test(res.error)) failed.add(next.id + '\u0000' + want); return; }
            if (res && res.temp) subCards.set(next.id, { text: want, temp: res.temp });
        } catch (e) { running = false; }
    }, 700);
})();

// How many pixels the viewer really shows the timeline frame at (Retina included): renders are made at that size,
// not bigger, which is what keeps them quick. Rounded up so small layout changes reuse the same size.
function stageDim(S) {
    const cv = $('stage' + S);
    const vp = cv && cv._viewport;
    if (!vp) return 0;
    const px = Math.max(vp.vw, vp.vh) * Math.max(1, Math.min(2, cv._zoom || 1));
    return Math.ceil(px / 128) * 128;
}

// Several Text+: each box's own text / position / Text Design is part of what has to be rendered.
function boxOverrides(m, a) {
    return !!(window.SABoxes && SABoxes.hasOverrides && SABoxes.hasOverrides(m, a, currentSubText()));
}
function boxRenderKey(m, a) {
    return (window.SABoxes && SABoxes.renderKey) ? SABoxes.renderKey(m, a, currentSubText()) : '';
}
function boxRenderList(m, a, sub, withText) {
    if (!window.SABoxes || !m || !a || SABoxes.nodesOf(a).length < 2) return null;
    try { return JSON.parse(JSON.stringify(SABoxes.payload(m, a, sub, withText))); } catch (e) { return null; }
}

// A quick low-resolution draft of the Use tab render arrives first; the full-size render replaces it when done.
if (window.sa && window.sa.onPreviewDraft) window.sa.onPreviewDraft((d) => {
    const u = state.use;
    if (!u || !d || !d.temp || u.id !== d.id || !u.rendering || u.renderReq !== d.key) return;
    u.tempPreview = d.temp;
    redrawStages();
});

// Use tab: one render per change of subtitle text, override design or text box, into a temporary preview only.
function ensureUsePreview(a) {
    if (state.idle) return;
    if (state.livePrev) return;
    const u = state.use;
    if (!a || a.missing || !u || u.id !== a.id || !window.sa || !window.sa.makePreview) return;
    const want = normSub(currentSubText());
    const rev = u.designRev || 0;
    const bkey = boxRenderKey(u, a);
    if (!want && rev === 0 && !boxOverrides(u, a)) return;
    const reqKey = want + '\u0000' + rev + '\u0000' + bkey;
    if (u.renderReq === reqKey || u.rendering) return;
    if (u._timerKey === reqKey && u._timer) return;
    clearTimeout(u._timer);
    u._timerKey = reqKey;
    const frame0 = state.live && state.live.frame;
    u._timer = setTimeout(async () => {
        u._timer = 0; u._timerKey = null;
        if (state.use !== u || (state.live && state.live.frame !== frame0) || state.busy || state.drag || state.stageDrag || state.preview
            || normSub(currentSubText()) !== want || (u.designRev || 0) !== rev || boxRenderKey(u, a) !== bkey || state.tab !== 'apply') return;
        u.renderReq = reqKey;
        u.rendering = true;
        u.renderStart = Date.now();
        setStatus('Rendering the real animation in Resolve…');
        redrawStages();
        let res;
        try { res = await window.sa.makePreview(a.id, want || null, cloneTextDesign(u.textDesign), '', true, boxRenderList(u, a, currentSubText(), true), { maxDim: stageDim('U'), draftKey: reqKey }); } catch (e) { res = { error: String(e && e.message || e) }; }
        u.rendering = false;
        if (res && res.error) {
            if (/busy/i.test(res.error)) {
                u.renderReq = null;      // try again shortly: a single change (e.g. from the macOS colour panel) gives no later redraw, so one is scheduled
                setTimeout(() => { if (state.use === u && !u.rendering) redrawStages(); }, 700);
            }
            else setStatus(res.error, 'bad');
            redrawStages();
            return;
        }
        if (state.use === u && res && res.temp) u.tempPreview = res.temp;
        setStatus('Preview ready.', 'ok');
        redrawStages();
    }, 250);
}
function syncStageOverlay(S, on) {
    const box = $('stageBox' + S);
    if (!box) return;
    let o = box.querySelector(':scope > .render-ov');
    if (on && !o && window.SAThumbs && SAThumbs.renderOverlay) {
        // While the last render keeps playing, only a small "Updating" pill shows in the corner; the full overlay
        // is kept for the very first render, when there is nothing to show yet.
        o = SAThumbs.renderOverlay(true);
        o.classList.add('quiet');
        o.querySelector('.render-lbl').textContent = 'Updating…';
        box.appendChild(o);
        o._delay = setTimeout(() => o.classList.add('shown'), 250);   // quick renders never flash it at all
    } else if (!on && o) { clearTimeout(o._delay); o.remove(); }
}
// One render per change: a preset is re-rendered only when the subtitle text changes or you edit its design
// (each edit bumps its design revision). Once a (text, revision) pair has been rendered it is never rendered again,
// whatever the reloaded library looks like afterwards, so it can never loop.
const designRev = new Map();      // preset id -> number of design edits this session
const lastRendered = new Map();   // preset id -> 'text|revision' last rendered successfully
// Create tab: renders the preset's default preview with its sample text when its default design is edited.
function ensureRealPreview(a, m) {
    if (state.idle) return;
    if (!a || a.missing || !window.sa || !window.sa.makePreview) return;
    const want = '';
    const rev = designRev.get(a.id) || 0;
    const reqKey = want + '\u0000' + rev;
    if (lastRendered.get(a.id) === reqKey) return;                                    // already rendered once
    if (rev === 0 && a.preview && previewMatchesText(a, want)) return;                // untouched design, frames fit
    const key = a.id + '\u0000' + reqKey;
    if (subPv.running || subPv.failed.has(key)) return;
    if (subPv.key === key && subPv.timer) return;
    clearTimeout(subPv.timer);
    subPv.key = key;
    const frame0 = state.live && state.live.frame;
    subPv.timer = setTimeout(async () => {
        subPv.timer = 0;
        // Wait while Resolve is playing / scrubbing, the panel is busy, or the design is still being changed.
        const cur = state.tab === 'apply' ? selected() : libEntry(state.createId);
        const curM = (state.tab === 'apply' && state.use) ? state.use : cur;
        if ((state.live && state.live.frame !== frame0) || state.busy || state.drag || state.stageDrag || state.preview
            || !cur || cur.id !== a.id
            || (designRev.get(a.id) || 0) !== rev) { subPv.key = null; return; }
        const td = (curM && curM.textDesign) || cur.textDesign || null;
        subPv.running = true;
        lastRendered.set(a.id, reqKey);       // claim it now so nothing can queue the same render again
        if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(a.id, true);
        setStatus('Rendering the real animation in Resolve…');
        let res;
        try { res = await window.sa.makePreview(a.id, want || null, td ? cloneTextDesign(td) : null, designKeyOf(td), false, boxRenderList(curM || cur, cur, '', false), { maxDim: Math.max(stageDim('C'), 1280) }); } catch (e) { res = { error: String(e && e.message || e) }; }
        subPv.running = false;
        subPv.key = null;
        if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(a.id, false);
        if (res && res.error) {
            if (lastRendered.get(a.id) === reqKey) lastRendered.delete(a.id);
            if (!/busy/i.test(res.error)) { subPv.failed.set(key, res.error); setStatus(res.error, 'bad'); }
            return;
        }
        if (res && res.lib) { state.lib = res.lib; syncUse(false); }
        setStatus('Preview ready.', 'ok');
        renderAll();
        redrawStages();
    }, 250);
}

// idx: which frame to show, null = the last frame (the finished look), -1 = nothing
function drawStage(S, a, idx) {
    const cv = $('stage' + S);
    if (!cv) return;
    if (S === 'U') a = useView(a);

    const ctx = CTX[S];
    const m = (ctx && ctx.model()) || a;

    const imgs = previewImages(a);
    let im = null;
    if (imgs && idx !== -1) {
        const i = idx === null ? imgs.length - 1 : clamp(idx, 0, imgs.length - 1);
        im = imgs[i];
        if (!im.complete || !im.naturalWidth) { im.onload = () => drawStage(S, a, idx); im = null; }
    }

    const bg = state.liveBg.img;
    let tlW = (state.liveBg.width && state.liveBg.height) ? state.liveBg.width : (im ? im.naturalWidth : 1920);
    let tlH = (state.liveBg.width && state.liveBg.height) ? state.liveBg.height : (im ? im.naturalHeight : 1080);
    if (bg && bg.complete && bg.naturalWidth && bg.naturalHeight) {
        const bgAr = bg.naturalWidth / bg.naturalHeight;
        const currentAr = tlW / tlH;
        if (Math.abs(bgAr - currentAr) > 0.05) {
            tlW = bg.naturalWidth;
            tlH = bg.naturalHeight;
        }
    }
    const ar = tlW / tlH;

    let rawPosX = Number(m && m.posX) || 0;
    let rawPosY = Number(m && m.posY) || 0;
    if (Math.abs(rawPosX) <= 1.0 && Math.abs(rawPosY) <= 1.0 && (rawPosX !== 0 || rawPosY !== 0)) {
        rawPosX = Math.round(rawPosX * tlW * 10) / 10;
        rawPosY = Math.round(-rawPosY * tlH * 10) / 10;
    }
    const posX = rawPosX;
    const posY = rawPosY;
    const userScale = Number(m && m.scale) || 1;
    const userRot = Number(m && m.rotation) || 0;
    const zoomVal = (state.stageZoom && state.stageZoom[S]) || 1.0;
    const isZoomOn = !!(state.zoomEnabled && state.zoomEnabled[S]);
    const resetBtn = $('resetPos' + S);
    if (resetBtn) resetBtn.disabled = (Math.abs(posX) < 0.1 && Math.abs(posY) < 0.1 && Math.abs(userScale - 1) < 0.005 && Math.abs(userRot) < 0.1 && Math.abs(zoomVal - 1.0) < 0.01 && !isZoomOn);
    syncXformUI(S, posX, posY, userScale, userRot);

    // Match the stage canvas to the full container width by default, or the user's custom viewer height.
    const stageBox = $('stageBox' + S);
    const customH = (state.stageHeight && state.stageHeight[S]) || (state.stageSize && state.stageSize[S] && state.stageSize[S].h);
    const inResizeMode = !!(state.stageResizeMode && state.stageResizeMode[S]);

    if (stageBox) {
        stageBox.classList.toggle('resize-mode', inResizeMode);
        stageBox.style.width = '100%';
    }
    if ($('stageResize' + S)) $('stageResize' + S).classList.toggle('hidden', !inResizeMode);
    if ($('stageResizeBtn' + S)) $('stageResizeBtn' + S).classList.toggle('on', inResizeMode);
    if ($('stageResizeLbl' + S)) $('stageResizeLbl' + S).textContent = inResizeMode ? 'Done resizing' : 'Resize viewer';
    if ($('stageSizeReset' + S)) $('stageSizeReset' + S).classList.toggle('hidden', !customH);

    cv.style.width = '100%';
    if (customH) {
        const wantH = Math.round(customH) + 'px';
        if (cv.style.height !== wantH) cv.style.height = wantH;
        if (cv.style.aspectRatio !== 'auto') cv.style.aspectRatio = 'auto';
    } else {
        if (cv.style.height !== 'auto') cv.style.height = 'auto';
        const wantAspect = tlW + ' / ' + tlH;
        if (cv.style.aspectRatio !== wantAspect) cv.style.aspectRatio = wantAspect;
    }

    const domRect = cv.getBoundingClientRect();
    const boxAr = (customH && domRect.width > 10 && domRect.height > 10) ? (domRect.width / domRect.height) : ar;
    // Canvas pixels = the viewer's real screen pixels (Retina included), never more than the timeline itself, so the
    // frame is drawn 1:1 instead of being scaled up from a small canvas.
    const dpr = window.devicePixelRatio || 1;
    const cssW = domRect.width > 10 ? domRect.width : 640;
    const cssH = (customH && domRect.height > 10) ? domRect.height : cssW / boxAr;
    const fit = Math.min(1, Math.max(tlW, tlH) / Math.max(cssW * dpr, cssH * dpr));
    let targetW, targetH;
    if (boxAr >= 1) {
        targetW = Math.max(200, Math.round(cssW * dpr * fit));
        targetH = Math.max(100, Math.round(targetW / boxAr));
    } else {
        targetH = Math.max(200, Math.round(cssH * dpr * fit));
        targetW = Math.max(100, Math.round(targetH * boxAr));
    }
    if (cv.width !== targetW || cv.height !== targetH) {
        cv.width = targetW;
        cv.height = targetH;
    }

    const g = cv.getContext('2d');
    let vw = cv.width, vh = cv.height;
    if (Math.abs(boxAr - ar) > 0.005) {
        if (ar > boxAr) {
            vw = cv.width;
            vh = cv.width / ar;
        } else {
            vh = cv.height;
            vw = cv.height * ar;
        }
    }
    const vx = (cv.width - vw) * 0.5;
    const vy = (cv.height - vh) * 0.5;
    cv._viewport = { vx, vy, vw, vh };
    cv._zoom = zoomVal;

    g.save();
    g.beginPath();
    g.rect(0, 0, cv.width, cv.height);
    g.clip();

    // Always clear the whole canvas first so zooming out never leaves smeared copies behind.
    g.clearRect(0, 0, cv.width, cv.height);
    const hasSurround = zoomVal < 1.0 || vx > 0.5 || vy > 0.5;
    if (hasSurround) {
        // Fill any area around the active frame with a blurred, darkened copy of the frame.
        g.fillStyle = '#0b0d0c';
        g.fillRect(0, 0, cv.width, cv.height);
        if (bg && bg.complete && bg.naturalWidth) {
            g.save();
            g.filter = 'blur(' + Math.round(18 * (Math.min(cv.width, cv.height) / 360)) + 'px) brightness(0.32) saturate(0.7)';
            const over = 40;   // overdraw so the blur doesn't fade to transparent at the edges
            g.drawImage(bg, -over, -over, cv.width + over * 2, cv.height + over * 2);
            g.restore();
        }
    }

    if (zoomVal !== 1.0) {
        g.translate(cv.width * 0.5, cv.height * 0.5);
        g.scale(zoomVal, zoomVal);
        g.translate(-cv.width * 0.5, -cv.height * 0.5);
    }

    // 1. Live timeline background frame filling the timeline-aspect stage
    if (bg && bg.complete && bg.naturalWidth) {
        g.drawImage(bg, vx, vy, vw, vh);
    } else {
        g.fillStyle = '#16161a';
        g.fillRect(vx, vy, vw, vh);
    }
    if (hasSurround) {
        // Outline the real frame so its edges read clearly against the dimmed surround.
        g.save();
        g.strokeStyle = 'rgba(239, 245, 240, 0.35)';
        g.lineWidth = 1 / zoomVal;
        g.strokeRect(vx, vy, vw, vh);
        g.restore();
    }

    // Presets with detected Text+ / template nodes show the preset's real rendered animation (captured from Fusion)
    // looping over the video frame. One text: the usual move / resize / rotate handles. Several texts: one box each.
    const boxMode = !!(window.SABoxes && SABoxes.active(a));
    const multiBox = boxMode && SABoxes.nodesOf(a).length > 1;
    let previewSingle = false;
    let paintedSingle = false;
    const gxy = { zoom: zoomVal, rot: userRot, scale: userScale, posX, posY, tlW, tlH };
    const activeSubText = (($('subText') && $('subText').value.trim()) || (state.live && state.live.subtitle && state.live.subtitle.text) || '');
    const isDesignDirty = !!((m && m.designDirty) || (a && a.designDirty));
    const isAdjustOpen = (S === 'U' && state.adjustOpen);
    const isTdOpen = (S === 'U' && state.tdOpen) || (S === 'C' && state.createTdOpen);
    // Captured Fusion frames are the preset exactly as built (nodes + keyframes untouched), so they are used whenever
    // they exist. With a live subtitle, Fusion re-renders the preset with that text in the background and the stage
    // swaps to those frames when they are ready; the approximation below is only a last resort when no frames exist.
    // Edited designs are rendered by Fusion too; until those frames arrive the last real render keeps playing
    // (with a Rendering overlay) instead of switching to a hand-drawn imitation, which is what made it glitch.
    const canUseCaptured = true;
    if (S === 'U') ensureUsePreview(a); else ensureRealPreview(a, m);
    syncStageOverlay(S, stageRendering(S, a));

    if (multiBox) {
        // Several Text+: the whole group gets the same move / resize / rotate handles as any other preset (drawn
        // below); the numbered boxes only pick which Text+ the Text Design panel edits.
        paintedSingle = canUseCaptured && SABoxes.paint(g, a, m, { vx, vy, vw, vh }, gxy, idx);
        SABoxes.draw(S, a, m, cv, { vx, vy, vw, vh }, gxy, paintedSingle);
        previewSingle = true;      // never hand-draw the first Text+ on its own over the group
    } else if (window.SABoxes) SABoxes.hideLayer(S);
    // Plays the rendered Fusion frames when they exist and no live subtitle or design override is active; otherwise the real text overlay stands in.
    if (!multiBox && canUseCaptured && window.SABoxes) {
        paintedSingle = SABoxes.paint(g, a, m, { vx, vy, vw, vh }, gxy, idx);
        previewSingle = paintedSingle;
    }
    for (const id of ['prev', 'loop']) { const e = $(id + S); if (e) e.style.display = 'none'; }

    // 2. Animated Text+ overlay with (posX, posY, userScale, userRot) and full Text & Shading Elements (1..8)
    const dx = (posX / tlW) * vw;
    const dy = -(posY / tlH) * vh;
    const rotRad = (userRot * Math.PI) / 180;
    const cx = vx + vw * 0.5 + dx;
    const cy = vy + vh * 0.5 + dy;
    const hw0 = vw * 0.5;
    const hh0 = vh * 0.5;

    // Resolve Text+ layout position: locate text inside layer based on template node or custom box center
    let layoutCx = 0.5;
    let layoutCy = 0.5;
    let layoutScale = 1.0;
    if (a && Array.isArray(a.nodes) && a.nodes.length) {
        const primaryNode = a.nodes[0];
        if (typeof primaryNode.cx === 'number') layoutCx = primaryNode.cx;
        if (typeof primaryNode.cy === 'number') layoutCy = primaryNode.cy;
        const b = (m && m.boxes && m.boxes[primaryNode.id]) || (a.boxes && a.boxes[primaryNode.id]);
        if (b) {
            if (typeof b.cx === 'number') layoutCx = b.cx;
            if (typeof b.cy === 'number') layoutCy = b.cy;
            if (typeof b.scale === 'number' && b.scale > 0) layoutScale = b.scale;
        }
    } else if (m && m.boxes) {
        const firstKey = Object.keys(m.boxes)[0];
        if (firstKey && m.boxes[firstKey]) {
            const b = m.boxes[firstKey];
            if (typeof b.cx === 'number') layoutCx = b.cx;
            if (typeof b.cy === 'number') layoutCy = b.cy;
            if (typeof b.scale === 'number' && b.scale > 0) layoutScale = b.scale;
        }
    } else if (a && a.boxes) {
        const firstKey = Object.keys(a.boxes)[0];
        if (firstKey && a.boxes[firstKey]) {
            const b = a.boxes[firstKey];
            if (typeof b.cx === 'number') layoutCx = b.cx;
            if (typeof b.cy === 'number') layoutCy = b.cy;
            if (typeof b.scale === 'number' && b.scale > 0) layoutScale = b.scale;
        }
    }
    const layoutOx = (layoutCx - 0.5) * vw;
    const layoutOy = -(layoutCy - 0.5) * vh;

    const td = cloneTextDesign((m && m.textDesign) || (a && a.textDesign));
    if (idx !== -1 && !previewSingle) {
        // Timeline frame clipping: text does not render outside the active timeline frame
        g.save();
        g.beginPath();
        g.rect(vx, vy, vw, vh);
        g.clip();

        const useCapturedPreview = !!(im && canUseCaptured && !(window.SAThumbs && SAThumbs.isBlank(a)));
        if (useCapturedPreview) {
            const oc = keyedImage(im);
            const imgW = (oc && oc.width) || (im && im.naturalWidth) || 0;
            const imgH = (oc && oc.height) || (im && im.naturalHeight) || 0;
            let drawW = vw;
            let drawH = vh;
            if (imgW > 0 && imgH > 0) {
                const imgAr = imgW / imgH;
                const vpAr = vw / vh;
                if (Math.abs(imgAr - vpAr) > 0.005) {
                    if (imgAr < vpAr) {
                        drawH = vh;
                        drawW = vh * imgAr;
                    } else {
                        drawW = vw;
                        drawH = vw / imgAr;
                    }
                }
            }
            g.save();
            g.translate(cx, cy);
            if (rotRad) g.rotate(rotRad);
            if (userScale !== 1) g.scale(userScale, userScale);
            // Clip strictly to transform box boundary
            g.beginPath();
            g.rect(-vw / 2, -vh / 2, vw, vh);
            g.clip();
            g.drawImage(oc, -drawW / 2 + layoutOx, -drawH / 2 + layoutOy, drawW, drawH);
            g.restore();
        } else {
            const defaultTxt = (a && Array.isArray(a.nodes) && a.nodes.length && a.nodes[0].defaultText) || '';
            const txt = activeSubText || defaultTxt || 'Sample text';
            const lines = wrapToLines(String(txt));
            const _css = saStyleToCss(td.style === '' ? 'Regular' : (td.style || 'Bold'));
            const weight = _css.weight;
            const isItalic = _css.italic;

            const spec = td.animSpec || (a && a.textDesign && a.textDesign.animSpec) || null;
            const frameRepeat = Math.max(1, Number(spec && spec.frameRepeat) || (td.wiggle ? 4 : 1));
            const isPlaying = (idx !== null && idx >= 0);
            const qFrame = isPlaying ? Math.floor(idx / frameRepeat) * frameRepeat : null;
            const stepIdx = isPlaying ? Math.floor(idx / frameRepeat) : 0;

            const presetName = String((a && a.name) || (m && m.name) || '').toLowerCase();
            const isSlideDown = presetName.includes('slide down') || (spec && spec.follower && Number(spec.follower.slideY) > 0.005);
            const isSlideIn = presetName.includes('slide in') || (spec && spec.follower && Number(spec.follower.slideY) < -0.005);
            const isSlide = isSlideDown || isSlideIn;
            const isTyping = presetName.includes('typing') || presetName.includes('typewriter');
            const hasFollower = !!(spec && spec.follower) || isSlide || isTyping;

            const baseSize = Number(td.size) || 0.12;
            const animSize = (isPlaying && spec && spec.sizeKeys) ? evalSpline(spec.sizeKeys, qFrame, baseSize) : baseSize;
            let popScale = baseSize > 0.001 ? (animSize / baseSize) : 1;
            if (isPlaying && (!spec || !spec.sizeKeys) && !hasFollower) popScale *= introPop(idx);
            const animOpacity = (isPlaying && spec && spec.opacityKeys) ? clamp(evalSpline(spec.opacityKeys, qFrame, 1), 0, 1) : (isPlaying ? clamp(idx / 4, 0, 1) : 1);
            const animTrack = (isPlaying && spec && spec.trackingKeys) ? evalSpline(spec.trackingKeys, qFrame, Number(td.tracking) || 1) : (Number(td.tracking) || 1);
            const erodeVal = (isPlaying && spec && spec.erode) ? evalSpline(spec.erode, qFrame, 0) : 0;

            const baseScale = clamp(baseSize * 0.62, 0.015, 0.65);
            const fontPx = Math.max(12, Math.round(vw * baseScale));
            g.font = (isItalic ? 'italic ' : '') + weight + ' ' + fontPx + 'px "' + (td.font || 'Poppins') + '", -apple-system, sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            try {
                g.letterSpacing = Math.round((animTrack - 1) * fontPx * 0.22) + 'px';
            } catch (e) { /* ignore if unsupported */ }

            let jx = 0, jy = 0, animRot = 0;
            if (isPlaying && spec && spec.angleKeys) {
                animRot += (evalSpline(spec.angleKeys, qFrame, 0) * Math.PI) / 180;
            }

            const hasWiggle = !!(spec && (spec.displace || spec.perturb)) || !!td.wiggle || presetName.includes('wiggle');
            if (isPlaying && hasWiggle) {
                jx = Math.sin(stepIdx * 1.7 + 0.5) * fontPx * 0.025;
                jy = Math.cos(stepIdx * 2.1 + 0.3) * fontPx * 0.025;
                animRot += Math.sin(stepIdx * 1.3) * 0.005;
            }

            const hasBoil = hasWiggle;
            if (hasBoil) {
                const turbEl = $('saTurb' + S);
                const dispEl = $('saDisp' + S);
                if (turbEl) turbEl.setAttribute('seed', String(((stepIdx * 13) % 89) + 2));
                if (dispEl) {
                    const refr = Number(spec && spec.displace && spec.displace.refraction) || 1;
                    dispEl.setAttribute('scale', Math.max(1.0, Math.min(2.5, fontPx * 0.018 * refr)).toFixed(2));
                }
            }

            const lineWidths = lines.map(l => g.measureText(l).width);
            const maxLineW = Math.max(24, ...lineWidths);
            const lineH = fontPx * clamp(Number(td.lineSpacing) || 1, 0.4, 2.5) * 1.16;
            const totalH = lineH * lines.length;

            g.save();
            g.translate(cx, cy);
            if (rotRad || animRot) g.rotate(rotRad + animRot);
            if (userScale !== 1) g.scale(userScale, userScale);
            // Clip strictly to transform box boundary
            g.beginPath();
            g.rect(-vw / 2, -vh / 2, vw, vh);
            g.clip();
            g.translate(layoutOx + jx, layoutOy + jy);
            if (layoutScale !== 1) g.scale(layoutScale, layoutScale);
            const erodeScaleX = erodeVal < 0 ? Math.max(0.84, 1 + erodeVal * 6.5) : 1;
            const erodeScaleY = erodeVal < 0 ? Math.max(0.88, 1 + erodeVal * 3.5) : 1;
            const sxTotal = popScale * erodeScaleX;
            const syTotal = popScale * erodeScaleY;
            if (sxTotal !== 1 || syTotal !== 1) g.scale(sxTotal, syTotal);

            // Compute global word index map so timing is sequential across multiple lines
            let totalWords = 0;
            const lineWordInfo = lines.map(line => {
                const toks = String(line).split(/(\s+)/);
                return toks.map(tok => {
                    const isWord = !!tok.trim();
                    const wIdx = isWord ? totalWords++ : -1;
                    return { tok, isWord, wIdx };
                });
            });

            const rawDelay = Number(spec && spec.follower && spec.follower.delay) || 0.5;
            const wordDelayFrames = isTyping ? 4 : Math.max(4, Math.min(12, Math.round(rawDelay <= 2 ? rawDelay * 10 : rawDelay)));
            const currentF = isPlaying ? ((qFrame !== null && qFrame !== undefined) ? qFrame : idx) : 999;

            // Render Shading Elements 8 down to 1 (Priority order: higher elements sit behind Element 1)
            const drawRRect = (x, y, w, h, r) => {
                const rad = Math.max(0, Math.min(r, Math.min(w, h) / 2));
                g.beginPath();
                if (typeof g.roundRect === 'function') {
                    g.roundRect(x, y, w, h, rad);
                } else {
                    g.rect(x, y, w, h);
                }
            };

            const pt = (spec && spec.perturb) || null;
            const drawGlyphLine = (line, li, ox, oy, isStroke) => {
                const ly = (li - (lines.length - 1) / 2) * lineH + oy;
                const lineToks = lineWordInfo[li] || [];

                if (!isPlaying || !hasFollower) {
                    let wx = ox, wy = ly;
                    if (isPlaying && pt) {
                        const seed = stepIdx * 2.3 + li * 1.7;
                        wx += Math.cos(seed) * vw * (Number(pt.xScale) || 0) * 0.18;
                        wy += Math.sin(seed) * vh * (Number(pt.yScale) ?? 0.02) * 0.18;
                    }
                    if (isStroke) g.strokeText(line, wx, wy); else g.fillText(line, wx, wy);
                    return;
                }

                const fullW = g.measureText(line).width;
                let curX = ox - fullW * 0.5;

                lineToks.forEach(({ tok, isWord, wIdx }) => {
                    const tw = g.measureText(tok).width;
                    if (!isWord) {
                        curX += tw;
                        return;
                    }

                    const wordStart = wIdx * wordDelayFrames;
                    const wordAge = currentF - wordStart;

                    if (wordAge >= 0) {
                        let easeOut = 1;
                        if (spec && spec.follower && spec.follower.pathSpline) {
                            easeOut = clamp(evalSpline(spec.follower.pathSpline, wordAge, 1), 0, 1);
                        } else {
                            const animDur = isSlide ? 16 : 4;
                            const progress = clamp(wordAge / animDur, 0, 1);
                            easeOut = 1 - Math.pow(1 - progress, 3);
                        }

                        let dySlide = 0;
                        let dxSlide = 0;
                        if (spec && spec.follower && Math.abs(spec.follower.slideY) > 0.001) {
                            const targetDy = clamp(-spec.follower.slideY * vh * 0.8, -fontPx * 1.1, fontPx * 1.1);
                            dySlide = (1 - easeOut) * targetDy;
                        } else if (isSlideDown) {
                            dySlide = -(1 - easeOut) * (fontPx * 0.75);
                        } else if (isSlideIn) {
                            dySlide = (1 - easeOut) * (fontPx * 0.85);
                        }

                        if (spec && spec.follower && Math.abs(spec.follower.slideX) > 0.001) {
                            const targetDx = clamp(spec.follower.slideX * vw * 0.8, -fontPx * 1.2, fontPx * 1.2);
                            dxSlide = (1 - easeOut) * targetDx;
                        }

                        let wordAlpha = 1;
                        if (spec && spec.follower && spec.follower.opacityKeys) {
                            wordAlpha = clamp(evalSpline(spec.follower.opacityKeys, wordAge, 1), 0, 1);
                        } else {
                            wordAlpha = clamp(wordAge / (isSlide ? 6 : 2), 0, 1);
                        }

                        let wordScale = 1;
                        if (spec && spec.follower && spec.follower.sizeKeys) {
                            wordScale = clamp(evalSpline(spec.follower.sizeKeys, wordAge, 1), 0.7, 1.3);
                        } else if (isTyping) {
                            wordScale = wordAge < 4 ? 0.93 + 0.07 * easeOut : 1.0;
                        } else if (isSlide) {
                            wordScale = wordAge < 16 ? 0.97 + 0.03 * easeOut : 1.0;
                        }

                        let wordRot = 0;
                        if (spec && spec.follower && spec.follower.rotKeys) {
                            wordRot = (evalSpline(spec.follower.rotKeys, wordAge, 0) * Math.PI) / 180;
                        }

                        let glitchDx = 0;
                        if (isSlideIn && wordAge < 8) {
                            glitchDx = (Math.sin(wordAge * 12.3) > 0.4 ? 2 : -1.5) * (1 - wordAge / 8);
                        }

                        g.save();
                        g.translate(curX + tw * 0.5 + dxSlide + glitchDx, ly + dySlide);
                        if (wordRot) g.rotate(wordRot);
                        if (wordScale !== 1) g.scale(wordScale, wordScale);
                        if (wordAlpha < 1) g.globalAlpha = (g.globalAlpha || 1) * wordAlpha;

                        if (isStroke) g.strokeText(tok, 0, 0); else g.fillText(tok, 0, 0);
                        g.restore();
                    }
                    curX += tw;
                });
            };

            for (let ei = 8; ei >= 1; ei--) {
                const el = td.elements[ei - 1];
                if (!el || !el.enabled || el.alpha === 0) continue;
                const op = clamp(Number(el.opacity ?? 1) * animOpacity, 0, 1);
                if (op <= 0.005) continue;

                g.save();
                g.globalAlpha = op;
                const ox = (Number(el.offsetX) || 0) * fontPx * 0.85;
                const oy = -(Number(el.offsetY) || 0) * fontPx * 0.85;
                const soft = Number(el.softness) || 0;
                const filters = [];
                if (soft > 0) {
                    filters.push('blur(' + Math.min(24, soft * fontPx * 0.06).toFixed(1) + 'px)');
                }
                if (hasBoil) {
                    filters.push('url(#saBoil' + S + ')');
                }
                if (filters.length) {
                    g.filter = filters.join(' ');
                }

                const shape = Number(el.shape) || 0;
                const elType = Number(el.type) || 0;
                let col = el.color || '#ffffff';
                if (elType === 2) {
                    const angleRad = ((Number(el.mappingAngle) || 0) * Math.PI) / 180;
                    const hw = (maxLineW / 2) * (Number(el.mappingSize) || 1);
                    const dx = Math.cos(angleRad) * hw;
                    const dy = Math.sin(angleRad) * hw;
                    const grad = g.createLinearGradient(-dx, -dy, dx, dy);
                    grad.addColorStop(0, el.color || '#ffffff');
                    grad.addColorStop(1, el.color2 || '#f07b8e');
                    col = grad;
                }

                if (shape === 2 || shape === 3) {
                    // Border Fill (2) or Border Outline (3)
                    const padX = fontPx * (0.24 + (Number(el.extendH) || 0) * 1.4);
                    const padY = fontPx * (0.14 + (Number(el.extendV) || 0) * 1.1);
                    const bw = Math.max(8, maxLineW + padX * 2);
                    const bh = Math.max(8, totalH + padY * 2);
                    const rad = clamp(Number(el.round) || 0, 0, 1) * Math.min(bw, bh) * 0.5;
                    drawRRect(-bw / 2 + ox, -bh / 2 + oy, bw, bh, rad);
                    if (shape === 2) {
                        g.fillStyle = col;
                        g.fill();
                    } else {
                        g.strokeStyle = col;
                        g.lineWidth = Math.max(1.5, (Number(el.thickness) || 0.02) * fontPx * 4);
                        g.stroke();
                    }
                } else if (shape === 1) {
                    // Text Outline (1)
                    g.strokeStyle = col;
                    g.lineJoin = 'round';
                    g.lineWidth = Math.max(1.5, (Number(el.thickness) || 0.02) * fontPx * 5);
                    lines.forEach((line, li) => drawGlyphLine(line, li, ox, oy, true));
                } else {
                    // Text Fill (0)
                    g.fillStyle = col;
                    lines.forEach((line, li) => drawGlyphLine(line, li, ox, oy, false));
                }
                g.restore();
            }
            g.restore();
        }
        g.restore(); // end timeline resolution clip
    }

    // Center guides while moving (drawn in the zoomed frame space)
    const isDragging = state.stageDrag && state.stageDrag.S === S;
    const isHovering = state.stageHover === S;
    if (isDragging && state.stageDrag.mode === 'move') {
        g.strokeStyle = 'rgba(140, 207, 142, 0.85)';
        g.lineWidth = 1 / zoomVal;
        if (Math.abs(posX) < 2) { g.beginPath(); g.moveTo(vx + vw / 2, vy); g.lineTo(vx + vw / 2, vy + vh); g.stroke(); }
        if (Math.abs(posY) < 2) { g.beginPath(); g.moveTo(vx, vy + vh / 2); g.lineTo(vx + vw, vy + vh / 2); g.stroke(); }
    }
    // Leave the zoomed space: the gizmo is drawn and hit-tested in plain canvas pixels,
    // with handle sizes in screen pixels so they stay grabbable at any panel size or zoom.
    g.restore();

    const rectW = cv.getBoundingClientRect().width || cv.width;
    const k = cv.width / Math.max(1, rectW);                 // canvas px per screen px
    const toScreen = (x, y) => ({ x: (x - cv.width * 0.5) * zoomVal + cv.width * 0.5, y: (y - cv.height * 0.5) * zoomVal + cv.height * 0.5 });
    const sc = toScreen(cx, cy);
    const hw = (vw * 0.5) * userScale * zoomVal;
    const hh = (vh * 0.5) * userScale * zoomVal;
    const cos = Math.cos(rotRad), sin = Math.sin(rotRad);
    const toCanvas = (lx, ly) => ({ x: sc.x + lx * cos - ly * sin, y: sc.y + lx * sin + ly * cos });
    // Rotation stem points up from center anchor point to rotation handle (matching DaVinci Resolve)
    const rotArmLen = Math.max(30 * k, Math.min(hh * 0.42, 100 * k));
    const rotHandle = toCanvas(0, -rotArmLen);
    const rawCorners = [
        toCanvas(-hw, -hh), // 0: Top-Left
        toCanvas(hw, -hh),  // 1: Top-Right
        toCanvas(hw, hh),   // 2: Bottom-Right
        toCanvas(-hw, hh)   // 3: Bottom-Left
    ];
    const rawEdges = [
        toCanvas(0, -hh),   // 0: Top-Center
        toCanvas(hw, 0),    // 1: Right-Center
        toCanvas(0, hh),    // 2: Bottom-Center
        toCanvas(-hw, 0)    // 3: Left-Center
    ];
    cv._gizmo = {
        cx: sc.x,
        cy: sc.y,
        hw,
        hh,
        rotRad,
        rotHandle,
        corners: rawCorners,
        rawCorners,
        edges: rawEdges,
        rawEdges,
        center: sc,
        k
    };

    // 3. DaVinci Resolve authentic layer transform gizmo
    // Solid white bounding box, 4 corners, 4 edge midpoints, center anchor point, and rotation stem & handle
    const isDraggingGizmo = isDragging && state.stageDrag;
    const mode = isDraggingGizmo ? state.stageDrag.mode : null;
    const hov = (!isDraggingGizmo && state.stageHoverHit && state.stageHoverHit.S === S) ? state.stageHoverHit : null;

    g.save();
    // Bounding box: solid white
    g.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    g.lineWidth = 1.35 * k;
    g.beginPath();
    rawCorners.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.stroke();

    // Rotation stem: solid white line from center anchor point up to rotation handle
    g.beginPath();
    g.moveTo(sc.x, sc.y);
    g.lineTo(rotHandle.x, rotHandle.y);
    g.stroke();

    // DaVinci Resolve circular control handles: white fill with royal blue border
    const drawHandle = (pt, isActive, isHov, isCenter) => {
        const hr = (isActive ? 5.8 : (isHov ? 5.2 : 4.4)) * k;
        g.beginPath();
        g.arc(pt.x, pt.y, hr, 0, Math.PI * 2);
        g.fillStyle = '#ffffff';
        g.fill();
        g.strokeStyle = isActive ? '#5b95ff' : '#2b62c9';
        g.lineWidth = (isActive ? 2.0 : 1.4) * k;
        g.stroke();
        if (isCenter) {
            g.beginPath();
            g.arc(pt.x, pt.y, 1.3 * k, 0, Math.PI * 2);
            g.fillStyle = isActive ? '#5b95ff' : '#2b62c9';
            g.fill();
        }
    };

    // 4 Corner resize handles
    rawCorners.forEach((c, i) => {
        const cActive = (mode === 'scale' && state.stageDrag.corner === i);
        const cHov = (hov && hov.mode === 'scale' && hov.corner === i);
        drawHandle(c, cActive, cHov, false);
    });

    // 4 Edge midpoint resize handles
    rawEdges.forEach((ePt, i) => {
        const eActive = (mode === 'scale-edge' && state.stageDrag.edge === i);
        const eHov = (hov && hov.mode === 'scale-edge' && hov.edge === i);
        drawHandle(ePt, eActive, eHov, false);
    });

    // Center Anchor Point handle
    const centerActive = (mode === 'move' && state.stageDrag && state.stageDrag.isCenter);
    const centerHov = (hov && hov.mode === 'move' && hov.isCenter);
    drawHandle(sc, centerActive, centerHov, true);

    // Rotation handle
    const rotActive = (mode === 'rotate');
    const rotHov = (hov && hov.mode === 'rotate');
    drawHandle(rotHandle, rotActive, rotHov, false);

    g.restore();

    // Border around the active video frame
    g.strokeStyle = '#29302b';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);

    const msg = $('stageMsg' + S);
    if (msg) {
        const metaParts = [];
        if (state.liveBg.width && state.liveBg.height) metaParts.push(state.liveBg.width + '×' + state.liveBg.height);
        if (Math.abs(zoomVal - 1.0) >= 0.01) metaParts.push('Preview Zoom ' + Math.round(zoomVal * 100) + '%');
        if (posX !== 0 || posY !== 0) metaParts.push('Pos X: ' + posX.toFixed(1) + ' px, Y: ' + posY.toFixed(1) + ' px');
        if (Math.abs(userScale - 1) >= 0.005) metaParts.push('Zoom ' + userScale.toFixed(3));
        if (Math.abs(userRot) >= 0.1) metaParts.push('Rot ' + userRot.toFixed(1) + '°');
        const prefix = metaParts.length ? metaParts.join(' · ') + ' — ' : '';
        msg.textContent = prefix + (multiBox
            ? (paintedSingle ? 'Drag to move all the text, handles to resize, top arm to rotate. Click a box to edit that Text+ in Text Design.' : 'No animation preview yet. Press Make preview on this preset in the list.')
            : 'Drag box or center to move, handles to resize, top arm to rotate.');
    }
}

// Pointer position in canvas pixels (the canvas fills its element box with matching aspect ratio).
function stagePoint(cv, clientX, clientY) {
    const rect = cv.getBoundingClientRect();
    return {
        px: (clientX - rect.left) * (cv.width / Math.max(1, rect.width)),
        py: (clientY - rect.top) * (cv.height / Math.max(1, rect.height))
    };
}

// Helper to determine the directional cursor based on handle angle relative to center
function angleCursor(rad) {
    let deg = ((rad * 180 / Math.PI) % 180 + 180) % 180;
    if (deg >= 22.5 && deg < 67.5) return 'nwse-resize';
    if (deg >= 67.5 && deg < 112.5) return 'ns-resize';
    if (deg >= 112.5 && deg < 157.5) return 'nesw-resize';
    return 'ew-resize';
}

function stageHitTest(cv, clientX, clientY) {
    const { px, py } = stagePoint(cv, clientX, clientY);
    const gz = cv._gizmo;
    if (!gz) return { mode: 'move', px, py };
    const hitR = 14 * (gz.k || 1);

    // 1. Rotation handle (circle atop stem)
    const dRot = Math.hypot(px - gz.rotHandle.x, py - gz.rotHandle.y);
    if (dRot <= hitR) return { mode: 'rotate', px, py };

    // 2. Corner handles (4 corners)
    let bestC = -1, bestCD = hitR;
    gz.rawCorners.forEach((c, i) => {
        const d = Math.hypot(px - c.x, py - c.y);
        if (d < bestCD) { bestCD = d; bestC = i; }
    });
    if (bestC !== -1) return { mode: 'scale', corner: bestC, px, py };

    // 3. Edge midpoint handles (0:Top, 1:Right, 2:Bottom, 3:Left)
    let bestE = -1, bestED = hitR;
    gz.rawEdges.forEach((ePt, i) => {
        const d = Math.hypot(px - ePt.x, py - ePt.y);
        if (d < bestED) { bestED = d; bestE = i; }
    });
    if (bestE !== -1) return { mode: 'scale-edge', edge: bestE, px, py };

    // 4. Center Anchor Point handle
    const dCenter = Math.hypot(px - gz.cx, py - gz.cy);
    if (dCenter <= hitR) return { mode: 'move', isCenter: true, px, py };

    // 5. Inside bounding box (with padding)
    const dx = px - gz.cx, dy = py - gz.cy;
    const cos = Math.cos(gz.rotRad), sin = Math.sin(gz.rotRad);
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const pad = 14 * (gz.k || 1);
    if (Math.abs(lx) <= gz.hw + pad && Math.abs(ly) <= gz.hh + pad) {
        return { mode: 'move', px, py };
    }

    return { mode: 'none', px, py };
}

let liveSyncBusy = false;
let liveSyncPending = null;
async function triggerLiveSync(m, S) {
    const tabKey = S || (state.tab === 'library' ? 'C' : 'U');
    if (!state.liveSyncEnabled || !state.liveSyncEnabled[tabKey]) return;
    // While Preview in Resolve runs, its own clip is the one that is updated; touching the selected / latest Text+ as well
    // would queue a second heavy update in Resolve and could change a subtitle that was already applied.
    if (state.livePrev || state.idle) return;
    if (!m) return;
    const a = libEntry(m.id) || m;
    const subTextVal = $('subText') ? $('subText').value : '';
    const payload = {
        id: m.id,
        posX: m.posX,
        posY: m.posY,
        scale: m.scale,
        rotation: m.rotation,
        sfxVolume: m.sfxVolume,
        textDesign: m.textDesign,
        text: subTextVal,
        boxList: (window.SABoxes && a) ? SABoxes.payload(m, a, subTextVal, tabKey === 'U') : []
    };
    if (liveSyncBusy) {
        liveSyncPending = payload;
        return;
    }
    liveSyncBusy = true;
    try {
        await window.sa.syncLiveTransform(payload);
    } catch (e) { /* ignore */ }
    liveSyncBusy = false;
    if (liveSyncPending) {
        const next = liveSyncPending;
        liveSyncPending = null;
        triggerLiveSync(next, tabKey);
    }
}

function bindStage(ctx) {
    const S = ctx.s;
    const cv = $('stage' + S);
    if (!cv) return;
    cv.addEventListener('pointerenter', () => { state.stageHover = S; redrawStages(); });
    cv.addEventListener('pointerleave', () => {
        if (state.stageHover === S) {
            state.stageHover = null;
            state.stageHoverHit = null;
            cv.style.cursor = 'default';
            redrawStages();
        }
    });
    cv.addEventListener('pointermove', (e) => {
        if (state.stageDrag) return;
        const hit = stageHitTest(cv, e.clientX, e.clientY);
        const gz = cv._gizmo;
        if (!gz || hit.mode === 'none') {
            cv.style.cursor = 'default';
        } else if (hit.mode === 'rotate') {
            cv.style.cursor = 'crosshair';
        } else if (hit.mode === 'scale') {
            const c = gz.rawCorners[hit.corner];
            cv.style.cursor = angleCursor(Math.atan2(c.y - gz.cy, c.x - gz.cx));
        } else if (hit.mode === 'scale-edge') {
            const ed = gz.rawEdges[hit.edge];
            cv.style.cursor = angleCursor(Math.atan2(ed.y - gz.cy, ed.x - gz.cx));
        } else if (hit.mode === 'move') {
            cv.style.cursor = 'grab';
        }

        const prev = state.stageHoverHit;
        const next = hit.mode === 'none' ? null : {
            S,
            mode: hit.mode,
            corner: hit.corner,
            edge: hit.edge,
            isCenter: hit.isCenter
        };
        if (JSON.stringify(prev) !== JSON.stringify(next)) {
            state.stageHoverHit = next;
            redrawStages();
        }
    });
    cv.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const m = ctx.model();
        if (!m) return;
        const hit = stageHitTest(cv, e.clientX, e.clientY);
        if (hit.mode === 'none') return;
        e.preventDefault();
        stopPreview();
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        const gz = cv._gizmo || { cx: cv.width / 2, cy: cv.height / 2, k: 1 };
        let ux = 0, uy = 0, dist0 = 100;
        if (hit.mode === 'scale') {
            const cIdx = hit.corner !== undefined ? hit.corner : 0;
            const rawC = (gz.rawCorners && gz.rawCorners[cIdx]) || { x: gz.cx + 50, y: gz.cy + 50 };
            const vx0 = rawC.x - gz.cx, vy0 = rawC.y - gz.cy;
            dist0 = Math.max(12, Math.hypot(vx0, vy0));
            ux = vx0 / dist0;
            uy = vy0 / dist0;
        } else if (hit.mode === 'scale-edge') {
            const eIdx = hit.edge !== undefined ? hit.edge : 0;
            const rawE = (gz.rawEdges && gz.rawEdges[eIdx]) || { x: gz.cx, y: gz.cy - 50 };
            const vx0 = rawE.x - gz.cx, vy0 = rawE.y - gz.cy;
            dist0 = Math.max(12, Math.hypot(vx0, vy0));
            ux = vx0 / dist0;
            uy = vy0 / dist0;
        }
        let initPosX = Number(m.posX) || 0;
        let initPosY = Number(m.posY) || 0;
        const tlW = (state.liveBg && state.liveBg.width) || 1920;
        const tlH = (state.liveBg && state.liveBg.height) || 1080;
        if (Math.abs(initPosX) <= 1.0 && Math.abs(initPosY) <= 1.0 && (initPosX !== 0 || initPosY !== 0)) {
            initPosX = Math.round(initPosX * tlW * 10) / 10;
            initPosY = Math.round(-initPosY * tlH * 10) / 10;
        }
        state.stageDrag = {
            S, ctx, mode: hit.mode, corner: hit.corner, edge: hit.edge, isCenter: hit.isCenter,
            x0: e.clientX, y0: e.clientY,
            px0: hit.px, py0: hit.py,
            cx: gz.cx, cy: gz.cy,
            ux, uy, dist0,
            startAng: Math.atan2(hit.py - gz.cy, hit.px - gz.cx),
            posX0: initPosX,
            posY0: initPosY,
            scale0: Number(m.scale) || 1,
            rot0: Number(m.rotation) || 0
        };
        if (hit.mode === 'move') cv.style.cursor = 'grabbing';
        redrawStages();
    });
    const resizeBtn = $('stageResizeBtn' + S);
    const sizeResetBtn = $('stageSizeReset' + S);
    const resizeBar = $('stageResize' + S);
    const stageBox = $('stageBox' + S);
    if (resizeBtn) {
        resizeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!state.stageResizeMode) state.stageResizeMode = { U: false, C: false };
            state.stageResizeMode[S] = !state.stageResizeMode[S];
            redrawStages();
        });
    }
    if (sizeResetBtn) {
        sizeResetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (state.stageSize) delete state.stageSize[S];
            if (state.stageHeight) delete state.stageHeight[S];
            if (state.stageResizeMode) state.stageResizeMode[S] = false;
            redrawStages();
        });
    }
    if (resizeBar) {
        resizeBar.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            try { resizeBar.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            const startY = e.clientY;
            const cvRect = cv.getBoundingClientRect();
            const startH = cvRect.height || 240;
            const onMove = (ev) => {
                const dy = ev.clientY - startY;
                const nextH = clamp(Math.round(startH + dy), 120, 1400);
                if (!state.stageHeight) state.stageHeight = {};
                state.stageHeight[S] = nextH;
                redrawStages();
            };
            const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
        resizeBar.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (state.stageHeight) delete state.stageHeight[S];
            if (state.stageSize) delete state.stageSize[S];
            redrawStages();
        });
    }

    const zoomToggleBtn = $('zoomToggle' + S);
    if (zoomToggleBtn) {
        zoomToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (!state.zoomEnabled) state.zoomEnabled = { U: false, C: false };
            state.zoomEnabled[S] = !state.zoomEnabled[S];
            const m = ctx.model();
            syncXformUI(S, m && m.posX, m && m.posY, m && m.scale, m && m.rotation);
            redrawStages();
        });
    }

    const liveSyncToggleBtn = $('liveSyncToggle' + S);
    if (liveSyncToggleBtn) {
        liveSyncToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (!state.liveSyncEnabled) state.liveSyncEnabled = { U: false, C: false };
            state.liveSyncEnabled[S] = !state.liveSyncEnabled[S];
            const m = ctx.model();
            syncXformUI(S, m && m.posX, m && m.posY, m && m.scale, m && m.rotation);
            if (state.liveSyncEnabled[S] && m) triggerLiveSync(m);
        });
    }

    cv.addEventListener('wheel', (e) => {
        if (!state.zoomEnabled || !state.zoomEnabled[S]) {
            // Disabled by default: allow normal page scrolling without intercepting wheel events
            return;
        }
        e.preventDefault();
        stopPreview();
        if (!state.stageZoom) state.stageZoom = { U: 1.0, C: 1.0 };
        const cur = state.stageZoom[S] || 1.0;
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        state.stageZoom[S] = Number(clamp(cur + delta, 0.5, 3.5).toFixed(2));
        const m = ctx.model();
        syncXformUI(S, m && m.posX, m && m.posY, m && m.scale, m && m.rotation);
        redrawStages();
    }, { passive: false });
    cv.addEventListener('dblclick', () => resetStagePos(ctx));
    const resetBtn = $('resetPos' + S);
    if (resetBtn) resetBtn.addEventListener('click', () => resetStagePos(ctx));

    const pxEl = $('posX' + S);
    const numPxEl = $('numPosX' + S);
    const pyEl = $('posY' + S);
    const numPyEl = $('numPosY' + S);
    const scEl = $('scale' + S);
    const numScEl = $('numScale' + S);
    const rotEl = $('rot' + S);
    const numRotEl = $('numRot' + S);

    if (pxEl) {
        pxEl.addEventListener('input', () => {
            const m = ctx.model(); if (!m) return;
            m.posX = Number(pxEl.value);
            if (numPxEl && document.activeElement !== numPxEl) numPxEl.value = m.posX.toFixed(3);
            const a = libEntry(m.id); if (a) a.posX = m.posX;
            ctx.changed(m);
            redrawStages();
            triggerLiveSync(m);
        });
    }
    if (numPxEl) {
        const updatePx = () => {
            const m = ctx.model(); if (!m) return;
            const v = Number(numPxEl.value);
            if (!isNaN(v)) {
                m.posX = v;
                if (pxEl && document.activeElement !== pxEl) pxEl.value = v;
                const a = libEntry(m.id); if (a) a.posX = m.posX;
                ctx.changed(m);
                redrawStages();
                triggerLiveSync(m);
            }
        };
        numPxEl.addEventListener('input', updatePx);
        numPxEl.addEventListener('change', updatePx);
    }

    if (pyEl) {
        pyEl.addEventListener('input', () => {
            const m = ctx.model(); if (!m) return;
            m.posY = Number(pyEl.value);
            if (numPyEl && document.activeElement !== numPyEl) numPyEl.value = m.posY.toFixed(3);
            const a = libEntry(m.id); if (a) a.posY = m.posY;
            ctx.changed(m);
            redrawStages();
            triggerLiveSync(m);
        });
    }
    if (numPyEl) {
        const updatePy = () => {
            const m = ctx.model(); if (!m) return;
            const v = Number(numPyEl.value);
            if (!isNaN(v)) {
                m.posY = v;
                if (pyEl && document.activeElement !== pyEl) pyEl.value = v;
                const a = libEntry(m.id); if (a) a.posY = m.posY;
                ctx.changed(m);
                redrawStages();
                triggerLiveSync(m);
            }
        };
        numPyEl.addEventListener('input', updatePy);
        numPyEl.addEventListener('change', updatePy);
    }

    if (scEl) {
        scEl.addEventListener('input', () => {
            const m = ctx.model(); if (!m) return;
            m.scale = Number(scEl.value);
            if (numScEl && document.activeElement !== numScEl) numScEl.value = m.scale.toFixed(3);
            const a = libEntry(m.id); if (a) a.scale = m.scale;
            ctx.changed(m);
            redrawStages();
            triggerLiveSync(m);
        });
    }
    if (numScEl) {
        const updateSc = () => {
            const m = ctx.model(); if (!m) return;
            const v = Number(numScEl.value);
            if (!isNaN(v) && v > 0) {
                m.scale = v;
                if (scEl && document.activeElement !== scEl) scEl.value = v;
                const a = libEntry(m.id); if (a) a.scale = m.scale;
                ctx.changed(m);
                redrawStages();
                triggerLiveSync(m);
            }
        };
        numScEl.addEventListener('input', updateSc);
        numScEl.addEventListener('change', updateSc);
    }

    if (rotEl) {
        rotEl.addEventListener('input', () => {
            const m = ctx.model(); if (!m) return;
            m.rotation = Number(rotEl.value);
            if (numRotEl && document.activeElement !== numRotEl) numRotEl.value = m.rotation.toFixed(3);
            const a = libEntry(m.id); if (a) a.rotation = m.rotation;
            ctx.changed(m);
            redrawStages();
            triggerLiveSync(m);
        });
    }
    if (numRotEl) {
        const updateRot = () => {
            const m = ctx.model(); if (!m) return;
            const v = Number(numRotEl.value);
            if (!isNaN(v)) {
                m.rotation = v;
                if (rotEl && document.activeElement !== rotEl) rotEl.value = v;
                const a = libEntry(m.id); if (a) a.rotation = m.rotation;
                ctx.changed(m);
                redrawStages();
                triggerLiveSync(m);
            }
        };
        numRotEl.addEventListener('input', updateRot);
        numRotEl.addEventListener('change', updateRot);
    }
}

function resetStagePos(ctx) {
    const m = ctx.model();
    if (!m) return;
    m.posX = 0; m.posY = 0; m.scale = 1; m.rotation = 0;
    if (state.stageZoom) state.stageZoom[ctx.s] = 1.0;
    if (state.zoomEnabled) state.zoomEnabled[ctx.s] = false;
    const a = libEntry(m.id);
    if (a) { a.posX = 0; a.posY = 0; a.scale = 1; a.rotation = 0; }
    ctx.changed(m);
    syncXformUI(ctx.s, 0, 0, 1, 0);
    redrawStages();
    triggerLiveSync(m);
}

function onStageDragMove(e) {
    const d = state.stageDrag;
    if (!d) return;
    const m = d.ctx.model();
    const cv = $('stage' + d.S);
    if (!m || !cv) return;
    const rect = cv.getBoundingClientRect();
    const zoom = cv._zoom || 1.0;
    const { px, py } = stagePoint(cv, e.clientX, e.clientY);

    if (d.mode === 'rotate') {
        const curAng = Math.atan2(py - d.cy, px - d.cx);
        let deg = d.rot0 + ((curAng - d.startAng) * 180) / Math.PI;
        while (deg > 180) deg -= 360;
        while (deg < -180) deg += 360;
        if (!e.shiftKey) {
            for (const snap of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
                if (Math.abs(deg - snap) <= 3.0) { deg = snap; break; }
            }
        }
        m.rotation = Number(deg.toFixed(3));
    } else if (d.mode === 'scale' || d.mode === 'scale-edge') {
        const curDist = (px - d.cx) * d.ux + (py - d.cy) * d.uy;
        const ratio = Math.max(0.05, curDist / Math.max(8, d.dist0));
        const sc = clamp(d.scale0 * ratio, 0.05, 5.0);
        m.scale = Number(sc.toFixed(3));
    } else if (d.mode === 'move') {
        const tlW = (state.liveBg && state.liveBg.width) || 1920;
        const tlH = (state.liveBg && state.liveBg.height) || 1080;
        const vp = cv._viewport || { vx: 0, vy: 0, vw: cv.width, vh: cv.height };
        const cssVw = Math.max(40, rect.width * (vp.vw / cv.width)) * zoom;
        const cssVh = Math.max(40, rect.height * (vp.vh / cv.height)) * zoom;
        let nx = d.posX0 + ((e.clientX - d.x0) / cssVw) * tlW;
        let ny = d.posY0 - ((e.clientY - d.y0) / cssVh) * tlH; // negative Tilt is down on screen in Resolve
        if (!e.shiftKey) {
            if (Math.abs(nx) < 4) nx = 0;
            if (Math.abs(ny) < 4) ny = 0;
        }
        m.posX = Number(nx.toFixed(1));
        m.posY = Number(ny.toFixed(1));
    }
    const a = libEntry(m.id);
    if (a) {
        a.posX = m.posX;
        a.posY = m.posY;
        a.scale = m.scale;
        a.rotation = m.rotation;
    }
    syncXformUI(d.S, m.posX, m.posY, m.scale, m.rotation);
    drawStage(d.S, a || m, null);
    triggerLiveSync(m);
}

function onStageDragEnd() {
    const d = state.stageDrag;
    state.stageDrag = null;
    if (d) {
        const cv = $('stage' + d.S);
        if (cv) cv.style.cursor = 'default';
        const m = d.ctx.model();
        if (m) d.ctx.changed(m);
        redrawStages();
    }
}

// Alignment header: ▶ plays once (click again to pause / resume), 🔁 loops with the sound until clicked again.
function syncPlayUI() {
    for (const S of ['U', 'C']) {
        const pb = $('alnPlay' + S), mb = $('alnMode' + S);
        const pv = state.preview && state.preview.ctx && state.preview.ctx.s === S ? state.preview : null;
        const playing = !!pv && !pv.paused;
        if (pb) {
            pb.textContent = playing ? '⏸' : '▶';
            pb.classList.toggle('on', !!pv && !pv.loop);
            pb.title = playing ? 'Pause' : (pv && !pv.loop ? 'Resume' : 'Play once with its sound');
        }
        if (mb) {
            mb.textContent = '🔁';
            mb.classList.toggle('on', !!pv && pv.loop);
            mb.title = pv && pv.loop ? 'Stop looping' : 'Loop the animation with its sound';
        }
    }
}

function stopPreview() {
    if (!state.preview) return;
    cancelAnimationFrame(state.preview.raf);
    if (state.audio) { try { state.audio.pause(); } catch (e) { /* ignore */ } }
    const { ctx, anim } = state.preview;
    state.preview = null;
    syncPlayUI();
    const pv = document.querySelector('#tl' + ctx.s + ' .pv');
    if (pv) pv.style.display = 'none';
    const prevBtn = $('prev' + ctx.s);
    const loopBtn = $('loop' + ctx.s);
    if (prevBtn) prevBtn.textContent = '▶ Preview';
    if (loopBtn) {
        loopBtn.classList.remove('on');
        loopBtn.textContent = '🔁 Live Loop';
    }
    drawStage(ctx.s, anim || ctx.model(), null);
}

// Plays the animation frames and the sound against the Text+ alignment, so you hear and see where they land.
function runPreview(ctx, loop = false) {
    if (state.preview && state.preview.loop && loop) {
        stopPreview();
        return;
    }
    stopPreview();
    const m = ctx.model();
    if (!m) return;
    const a = libEntry(m.id);
    const fps = fpsNow();
    const g = geometry(m);
    const from = Math.min(g.textS, g.sfxS) - 4;
    const to = g.textE + 6;
    let t0 = performance.now();
    let fired = false;
    let loopCount = 0;
    state.preview = { ctx, anim: a || m, raf: 0, loop: !!loop, paused: false };
    let heldMs = 0;
    state.preview.pause = () => {
        if (!state.preview || state.preview.paused) return;
        state.preview.paused = true;
        heldMs = performance.now() - t0;
        cancelAnimationFrame(state.preview.raf);
        if (state.audio) { try { state.audio.pause(); } catch (e) { /* ignore */ } }
        syncPlayUI();
    };
    state.preview.resume = () => {
        if (!state.preview || !state.preview.paused) return;
        state.preview.paused = false;
        t0 = performance.now() - heldMs;
        if (fired && state.audio && !state.audio.ended) { try { state.audio.play(); } catch (e) { /* ignore */ } }
        syncPlayUI();
        frame();
    };
    syncPlayUI();

    const prevBtn = $('prev' + ctx.s);
    const loopBtn = $('loop' + ctx.s);
    if (loop && loopBtn) {
        loopBtn.classList.add('on');
        loopBtn.textContent = '⏹ Stop Loop';
    }
    if (prevBtn) prevBtn.textContent = '⏹ Stop';

    // The sound is loaded before the clock starts, so it begins exactly at its offset instead of a moment late.
    const sfx0 = origSfxPath(m) || currentSfxPath(m);
    let sfxEl = null;
    if (sfx0) {
        try {
            sfxEl = new Audio(fileUrl(sfx0));
            sfxEl.preload = 'auto';
            if (m.sfxVolume !== undefined && m.sfxVolume !== null) sfxEl.volume = clamp(Math.pow(10, Number(m.sfxVolume) / 20), 0, 1);
            sfxEl.load();
        } catch (e) { sfxEl = null; }
    }
    const baseVol = sfxEl ? sfxEl.volume : 1;
    const startedAt = performance.now();

    const frame = () => {
        if (!state.preview) return;
        const curM = ctx.model() || m;
        // The picture and the sound start together: wait (up to 1.5 s) until the rendered frames are decoded.
        if (a && a.preview && window.SAThumbs && SAThumbs.ready && performance.now() - startedAt < 1500) {
            let view = a;
            try { view = (ctx.s === 'U') ? useView(a) : a; } catch (e) { view = a; }
            if (!SAThumbs.ready(view)) { t0 = performance.now(); state.preview.raf = requestAnimationFrame(frame); return; }
        }
        let tf = from + (performance.now() - t0) / 1000 * fps;
        if (tf > to) {
            if (state.preview.loop) {
                t0 = performance.now();
                tf = from;
                fired = false;
                loopCount++;
            } else {
                stopPreview();
                return;
            }
        }
        const pv = document.querySelector('#tl' + ctx.s + ' .pv');
        if (pv && ctx.scale) { pv.style.display = 'block'; pv.style.left = ((tf - ctx.scale.lo) * ctx.scale.ppf) + 'px'; }
        if (!fired && tf >= g.sfxS) {
            fired = true;
            if (sfxEl) {
                try {
                    if (state.audio && state.audio !== sfxEl) state.audio.pause();
                    state.audio = sfxEl;
                    sfxEl.volume = baseVol;
                    sfxEl.currentTime = g.sfxTrimIn / g.fps;
                    const pr = sfxEl.play();
                    if (pr && pr.catch) pr.catch(() => setStatus('Could not play that sound', 'bad'));
                } catch (e) { /* ignore */ }
            }
        }
        // Same as on the timeline: the sound stops where the subtitle ends, fading out over its last second.
        if (sfxEl && fired) {
            const left = g.sfxE - tf;
            if (left <= 0) { if (!sfxEl.paused) sfxEl.pause(); }
            else if (left < g.fadeFrames) sfxEl.volume = clamp(baseVol * left / g.fadeFrames, 0, 1);
        }
        const relFrame = (tf < g.textS) ? -1 : Math.max(0, Math.floor(tf - g.textS));
        // The preset entry (not the editing copy) carries the rendered Fusion frames, so the play button shows the real preview.
        drawStage(ctx.s, a || curM, relFrame);
        state.preview.raf = requestAnimationFrame(frame);
    };
    frame();
}

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
        const panel = bar.closest('.rv');
        for (const t of bar.querySelectorAll('.rv-tab')) {
            t.addEventListener('click', () => {
                for (const o of bar.querySelectorAll('.rv-tab')) o.classList.toggle('on', o === t);
                for (const p of panel.querySelectorAll(':scope > .rv-pane')) p.classList.toggle('hidden', p.dataset.pane !== t.dataset.pane);
            });
        }
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
function normHex(v) {
    let s = String(v || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map(c => c + c).join('');
    return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : null;
}

function hexToRgb01(hex) {
    const h = normHex(hex) || '#ffffff';
    const s = h.slice(1);
    return {
        r: parseInt(s.slice(0, 2), 16) / 255,
        g: parseInt(s.slice(2, 4), 16) / 255,
        b: parseInt(s.slice(4, 6), 16) / 255
    };
}

function rgb01ToHex(r, g, b) {
    const toH = (x) => Math.max(0, Math.min(255, Math.round((Number(x) || 0) * 255))).toString(16).padStart(2, '0');
    return '#' + toH(r) + toH(g) + toH(b);
}

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
    return null;
}


// ---- Placement pop-up beside "Add to timeline" (all unchecked by default; remembered per computer)
const PLACE_IDS = { locked: 'placeLocked', disabledTrack: 'placeDisabledTrack', disabledClip: 'placeDisabledClip', firstEmpty: 'placeFirstEmpty', loopOn: 'placeLoopOn' };
function placeOptions() {
    const o = {};
    for (const k in PLACE_IDS) { const e = $(PLACE_IDS[k]); o[k] = !!(e && e.checked); }
    return o;
}
function bindPlacementMenu() {
    const btn = $('placeBtn'), menu = $('placeMenu');
    if (!btn || !menu) return;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('sa.place') || '{}') || {}; } catch (e) { saved = {}; }
    for (const k in PLACE_IDS) {
        const e = $(PLACE_IDS[k]); if (!e) continue;
        e.checked = !!saved[k];
        e.addEventListener('change', () => {
            try { localStorage.setItem('sa.place', JSON.stringify(placeOptions())); } catch (err) { /* optional */ }
            syncPlaceBtn();
        });
    }
    const syncPlaceBtn = () => {
        const n = Object.values(placeOptions()).filter(Boolean).length;
        btn.textContent = 'Placement' + (n ? ' (' + n + ')' : '') + ' ▴';
    };
    const setOpen = (open) => { menu.classList.toggle('hidden', !open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.classList.contains('hidden')); });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== btn) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    syncPlaceBtn();
}


// ---- Preview in Resolve: the real Text+ is on the timeline; the panel keeps it in step with Alignment / Text Design.
function liveReq(m, a, text) {
    const p = state.livePrev;
    return {
        animationId: a.id, text, start: p.start, end: p.end,
        textOffset: m.textOffset, sfxOffset: m.sfxOffset, sfxVolume: m.sfxVolume, tail: m.tail,
        textTrack: m.textTrack, sfxTrack: m.sfxTrack, useSfx: m.useSfx !== false, place: placeOptions(),
        linked: m.linked !== false, sfxPath: p.sfxPath || undefined,
        posX: Number(m.posX) || 0, posY: Number(m.posY) || 0,
        scale: Number(m.scale) || 1, rotation: Number(m.rotation) || 0,
        textDesign: m.textDesign || a.textDesign || null,
        boxList: window.SABoxes ? SABoxes.payload(m, a, text) : []
    };
}
function setLiveUI(on) {
    state.liveUI = !!on;
    const box = $('stageBoxU'), bar = $('stageLiveU');
    if (box) box.classList.toggle('hidden', on);
    if (bar) bar.classList.toggle('hidden', !on);
    if ($('stageMsgU')) $('stageMsgU').classList.toggle('hidden', on);
    const b = $('stageLiveBtnU'); if (b) b.disabled = on;
    $('create').disabled = state.busy || !selected();
    // Alignment is collapsed and disabled while a preview runs: the sound is moved / trimmed on the Resolve timeline itself.
    if ($('adjustWrapU')) $('adjustWrapU').classList.toggle('live-locked', !!state.livePrev);
    setAdjustOpen(state.adjustOpen);
    refreshLiveBar();
}
// Labels of the Preview bar: it stays on screen after Apply and only "Remove preview" brings the player back.
function refreshLiveBar() {
    const bar = $('stageLiveU'); if (!bar) return;
    const a = selected();
    const btn = $('liveApplyU');
    if (btn) {
        // nothing is previewing: the button previews the selected preset first; while previewing it sets (keeps) it
        btn.textContent = !state.livePrev ? 'Preview Text preset' : (state.livePrev.removed ? 'Preview again' : ((state.liveApplied && a) ? 'Set ' + a.name : 'Apply'));
        btn.title = state.livePrev ? 'Keep the Text+ on the timeline (with its sound)' : 'Preview the selected text preset on the subtitle at the playhead before setting it';
    }
    // While a preview runs, "Add to timeline" is the same green button as Apply: it keeps the previewed Text+.
    const addBtn = $('create');
    if (addBtn) {
        addBtn.textContent = (state.livePrev && btn) ? btn.textContent : 'Add to timeline';
        addBtn.title = state.livePrev ? 'Keep the previewed Text+ on the timeline (with its sound)' : '';
    }
    const title = bar.querySelector('.stage-live-txt b');
    if (title) title.textContent = state.livePrev ? 'Previewing in Resolve' : (state.liveApplied ? 'Applied to the timeline' : 'Preview in Resolve');
    const note = bar.querySelector('.live-note');
    if (note) note.style.display = state.livePrev ? '' : 'none';
    if (!state.livePrev) liveCard(state.liveApplied
        ? 'The Text+ and its sound stay on the timeline. Pick another text preset to preview it on the subtitle at the playhead.'
        : 'Click any text preset to preview it on the subtitle at the playhead.');
    const adv = $('liveAdviceU');
    if (adv) adv.innerHTML = state.liveUI
        ? 'Click any text preset to preview it. Playing, pausing or moving the playhead never starts a preview. <b>Remove preview</b> brings the player back.'
        : 'Preview in Resolve starts only when you click <b>▶ Preview in Resolve</b>. Playing, pausing or moving the playhead never starts it.';
}
function exitLiveSession() {
    state.liveApplied = false;
    setLiveUI(false);
    redrawStages();
}
// "Set <preset>" with no preview running: previews the selected preset on the playhead's subtitle and applies it at once.
async function setPresetNow() {
    if (state.livePrev || state.busy) return;
    await startLivePreview();
    for (let i = 0; i < 80 && state.livePrev; i++) {
        if (state.livePrev.hasClip && !state.livePrev.busy) break;
        await new Promise(r => setTimeout(r, 250));
    }
    if (state.livePrev && state.livePrev.hasClip) await endLivePreview(true);
    else if (state.livePrev) setStatus('Move the playhead onto a subtitle; the preview appears there. Then press Set again.', '');
}
function liveCard(msg) {
    const s = document.querySelector('#stageLiveU .stage-live-txt span');
    if (s) s.textContent = msg;
}
// The sound for one caption: cut to THAT caption's length (Estimate) or to the fixed length, with its fade, like Add to
// timeline. Remembered per caption length and sound settings, so moving between captions stays quick.
const liveSfxCache = new Map();
async function liveSfxFor(m, start, end) {
    if (!m || m.useSfx === false) return null;
    const span = { base: start, dur: Math.max(1, end - start) };
    const key = [currentSfxPath(m), span.dur, m.sfxTrimIn, m.sfxLen, sfxLenMode(m), m.sfxFade, m.textOffset, m.sfxOffset, m.tail, fpsNow()].join('|');
    if (liveSfxCache.has(key)) return liveSfxCache.get(key);
    let out = null;
    try { out = await buildFadedSfx(m, span); } catch (e) { out = null; }
    if (out) liveSfxCache.set(key, out);
    return out;
}
// The preview clip was deleted by hand: the button offers "Preview again" and nothing is put back by itself.
function markRemoved(p) {
    p.hasClip = false; p.key = ''; p.removed = true;
    liveCard('The preview clip was removed. Click Preview again to put it back on the subtitle at the playhead.');
    setStatus('Preview clip removed.', '');
    refreshLiveBar();
}
async function previewAgain() {
    const p = state.livePrev, L = state.live;
    if (!p || p.busy || state.busy) return;
    if (!L || !L.ok) { setStatus('Resolve is not reachable right now.', 'bad'); return; }
    p.removed = false;
    refreshLiveBar();
    const s = L.subtitle;
    if (s && L.frame >= s.start && L.frame < s.end) await addLiveClip({ start: s.start, end: s.end, text: $('subText').value || s.text }, true);
    else await addLiveClip({ start: L.frame, end: L.frame + Math.round(L.fps * 3), text: $('subText').value }, true);
}
// Puts the preview clip on the subtitle `sub` ({start, end, text}).
async function addLiveClip(sub, keepPlayhead) {
    const p = state.livePrev, a = libEntry(p.animId), m = state.use;
    if (!p || !a || !m) return;
    p.busy = true;
    p.start = sub.start; p.end = sub.end; p.subStart = sub.start; p.text = sub.text || '';
    setStatus('Putting the Text+ on the timeline…');
    p.sfxPath = await liveSfxFor(m, sub.start, sub.end);
    const res = await window.sa.apply(Object.assign(liveReq(m, a, p.text), { live: true, keepPlayhead: !!keepPlayhead }));
    p.busy = false;
    if (!state.livePrev) return;
    if (res && res.ok) {
        p.hasClip = true;
        p.clipS = res.start; p.clipE = res.start + res.frames;
        p.key = JSON.stringify(liveReq(m, a, p.text));
        liveCard('The Text+ and its sound are on the timeline, with In/Out around the Text+. Move or trim the sound in Resolve if you like. Move the playhead to another subtitle and both move there.');
        setStatus('Previewing in Resolve · V' + res.videoTrack, 'ok');
        state.liveBg.key = '';
    } else {
        p.hasClip = false; p.key = '';
        setStatus((res && res.error) || 'Could not put the preview on the timeline', 'bad');
    }
}
async function startLivePreview() {
    const a = selected(), m = state.use, L = state.live;
    if (!a || !m || !L || !L.ok || state.livePrev || state.busy) return;
    state.livePrev = { animId: a.id, hasClip: false, busy: false, key: '', start: 0, end: 0, subStart: null, text: '', clipS: 0, clipE: 0 };
    setLiveUI(true);
    liveCard('Waiting for a subtitle: move the playhead onto one.');
    window.sa.liveLoopOn(placeOptions().loopOn).then((lr) => { if (lr && lr.viaKey) setStatus('Sent Cmd+/ to Resolve to toggle Loop. Check the loop button is red; if not, press Cmd+/ once.', ''); else if (lr && lr.ok === false) setStatus('Could not switch on Resolve\'s Loop (' + (lr.error || 'allow Accessibility for this app in System Settings') + '). The panel still loops the clip itself.', ''); }).catch(() => { });
    const s = L.subtitle;
    if (!state.livePrev) return;
    if (s && L.frame >= s.start && L.frame < s.end) await addLiveClip({ start: s.start, end: s.end, text: $('subText').value || s.text }, true);
    else if (!s) {
        // no subtitle track: preview at the playhead for 3 seconds
        await addLiveClip({ start: L.frame, end: L.frame + Math.round(L.fps * 3), text: $('subText').value }, true);
    }
}
async function endLivePreview(keep) {
    const p = state.livePrev;
    if (!p || p.busy) return;
    p.busy = true;
    const a = libEntry(p.animId), m = state.use;
    let res = { ok: true };
    if (keep) {
        if (!p.hasClip) { p.busy = false; setStatus('There is no preview clip right now. Move the playhead onto a subtitle first.', 'bad'); return; }
        state.busy = true; setStatus('Applying…');
        let sfxClip = null;
        try { sfxClip = await buildFadedSfx(m); } catch (e) { sfxClip = null; }
        res = await window.sa.liveFinish(Object.assign(liveReq(m, a, p.text), { sfxPath: sfxClip || undefined }));
        state.busy = false;
    } else if (p.hasClip) {
        await window.sa.liveRemove();
    }
    if (keep && res && !res.ok && !res.gone) { p.busy = false; setStatus((res && res.error) || 'Could not apply', 'bad'); return; }
    state.livePrev = null;
    state.liveApplied = !!(keep && res && res.ok) || (keep ? state.liveApplied : false);
    setLiveUI(keep);                 // Apply: the bar stays. Remove preview: back to the player.
    if (keep && res && res.ok) parkAfterPlace();
    try { window.sa.liveLoopRestore(); } catch (e) { /* ignore */ }
    if (state.use) { state.use.renderReq = null; }
    state.liveBg.key = '';
    refreshLiveBg();
    if (keep && res && res.ok) {
        const parts = ['Applied on V' + res.videoTrack, res.frames + ' frames'];
        if (res.audioTrack) parts.push('sound on A' + res.audioTrack + (res.linked ? ' (linked)' : ''));
        parts.push('click any text preset to preview it');
        setStatus(parts.join(' · ') + (res.warnings && res.warnings.length ? ' · ' + res.warnings.join(' ') : ''), res.warnings && res.warnings.length ? '' : 'ok');
    } else setStatus(keep ? ((res && res.error) || 'The preview clip was gone') : 'Preview removed.', keep ? 'bad' : 'ok');
    try { const r = await window.sa.getLib(); if (r && r.lib) { state.lib = r.lib; syncUse(false); renderAll(); } } catch (e) { /* ignore */ }
    redrawStages();
}
// Resolve has no "is playing" call, so playback is recognised by the playhead moving forward at about real-time
// speed on consecutive polls (a scrub or a jump does not look like that). While the timeline plays, Preview in
// Resolve ends at once: inserting clips would interrupt playback.
const playWatch = { f: null, t: 0, hits: 0, still: 0, playing: false, graceUntil: 0 };
function watchPlayback(L) {
    const p = state.livePrev;
    if (!p || p.busy || state.busy || !L || !L.ok || typeof L.frame !== 'number') { playWatch.f = null; playWatch.hits = 0; playWatch.playing = false; return; }
    const now = performance.now();
    if (playWatch.f !== null) {
        const dt = (now - playWatch.t) / 1000, df = L.frame - playWatch.f;
        const fps = L.fps || 25;
        const rate = dt > 0 ? df / (dt * fps) : 0;          // 1 = real time
        if (df > 0 && dt > 0.08 && dt < 1.2 && rate > 0.4 && rate < 4.5) { playWatch.hits++; if (playWatch.hits >= 2) playWatch.playing = true; }
        else if (df !== 0) { if (now > playWatch.graceUntil) { playWatch.hits = 0; playWatch.playing = false; } }       // a jump: the playhead was moved by hand
        else { playWatch.still++; if (playWatch.still >= 3) { playWatch.hits = 0; playWatch.playing = false; } }
    }
    if (L.frame !== playWatch.f) playWatch.still = 0;
    playWatch.f = L.frame; playWatch.t = now;
    // Loop: while it plays, the playhead is sent back to the In when it reaches the Out (Resolve's own Loop button
    // cannot be read or switched by a plugin, so this works whether or not it is on).
    if (playWatch.playing && p.hasClip && now > playWatch.graceUntil && L.frame >= p.clipE - 2 && L.frame <= p.clipE + Math.round((L.fps || 25) * 0.6)) {
        playWatch.graceUntil = now + 900;
        playWatch.f = null; playWatch.hits = 2; playWatch.playing = true; playWatch.still = 0;
        try { window.sa.seek(p.clipS); } catch (e) { /* ignore */ }
    }
}

function bindLivePreview() {
    document.addEventListener('click', (e) => {
        const t = e.target.closest && e.target.closest('#stageLiveBtnU, #liveRemoveU, #liveApplyU');
        if (!t) return;
        if (t.id === 'stageLiveBtnU') startLivePreview();
        else if (t.id === 'liveRemoveU') { if (state.livePrev) endLivePreview(false); else exitLiveSession(); }
        else { if (state.livePrev) { if (state.livePrev.removed) previewAgain(); else endLivePreview(true); } else startLivePreview(); }
    });
    // The preview stays on while you play or scrub: the clip is removed when the playhead leaves it and added again on
    // the next subtitle the playhead reaches. Edits made in the panel are pushed to the clip while it is there.
    setInterval(async () => {
        const p = state.livePrev;
        if (state.idle || !p || p.busy || state.busy) return;
        let m = state.use, a = libEntry(p.animId);
        if (m && m.id !== p.animId && libEntry(m.id)) {
            // another preset was picked: the clip at the playhead is swapped for the new animation, same subtitle
            const keepHad = p.hasClip;
            p.animId = m.id;
            a = libEntry(p.animId);
            // the new preset brings its own sound (its saved one, or the default): the old preset's sound is dropped with the old clip
            p.busy = true;
            if (keepHad) { try { await window.sa.liveDrop(); } catch (e) { /* the sweep removes it later */ } }
            p.sfxPath = await liveSfxFor(m, p.start, p.end);
            p.busy = false;
            p.hasClip = false; p.key = '';
            if (!state.livePrev) return;
            if (keepHad) await addLiveClip({ start: p.start, end: p.end, text: p.text }, true);
            return;
        }
        if (!m || !a || m.id !== p.animId) { endLivePreview(false); return; }
        const L = state.live;
        if (!L || !L.ok) return;
        const f = L.frame;
        if (p.hasClip) {
            const tNow = Date.now();
            if (tNow - (p.aliveAt || 0) > 900) {
                p.aliveAt = tNow;
                let al = null;
                try { al = await window.sa.liveAlive(); } catch (e) { al = null; }
                if (al && al.alive === false && !al.none) { markRemoved(p); return; }
            }
            if ((f < p.clipS || f >= p.clipE) && !(f >= p.start && f < p.end)) {
                if (playWatch.playing) return;             // playing (looping) - the clip is only moved when the playhead is moved by hand
                if (playWatch.still < 2) return;           // still being dragged: wait until it rests
                const ns = L.subtitle;
                if (ns && f >= ns.start && f < ns.end && ns.start !== p.subStart) {
                    // another caption: the same Text+ and sound are moved onto it (much quicker than removing and inserting again)
                    p.start = ns.start; p.end = ns.end; p.subStart = ns.start; p.text = ns.text || $('subText').value;
                    p.busy = true;
                    p.sfxPath = await liveSfxFor(m, ns.start, ns.end);
                    const mres = await window.sa.liveUpdate(liveReq(m, a, p.text));
                    p.busy = false;
                    if (mres && mres.busy) { p.subStart = null; return; }
                    if (mres && mres.gone) { markRemoved(p); return; }
                    if (mres && !mres.ok) { p.subStart = null; setStatus(mres.error || 'Could not move the preview', 'bad'); return; }
                    if (mres && mres.frames) { p.clipS = mres.start; p.clipE = mres.start + mres.frames; }
                    p.key = JSON.stringify(liveReq(m, a, p.text));
                    setStatus('Preview moved to this subtitle' + (mres.warnings && mres.warnings.length ? ' · ' + mres.warnings.join(' ') : ''), 'ok');
                    return;
                }
                p.busy = true;
                try { await window.sa.liveDrop(); } catch (e) { /* the sweep removes it later */ }
                p.busy = false;
                p.hasClip = false; p.key = '';
                liveCard('Waiting for a subtitle: move the playhead onto one.');
                setStatus('Preview clip removed (playhead left it).', 'ok');
                return;
            }
            if (!p.key) return;
            if (L.subtitle && L.subtitle.start === p.subStart) p.text = $('subText').value;
            const req = liveReq(m, a, p.text);
            const key = JSON.stringify(req);
            if (key === p.key) return;
            p.busy = true;
            const res = await window.sa.liveUpdate(req);
            p.busy = false;
            if (res && res.busy) return;                   // Resolve was busy: same change is tried again
            p.key = key;
            if (res && res.gone) { markRemoved(p); return; }
            if (res && !res.ok) { setStatus(res.error || 'Could not update the preview', 'bad'); return; }
            if (res && res.frames) { p.clipS = res.start; p.clipE = res.start + res.frames; }
            setStatus('Preview in Resolve updated' + (res.warnings && res.warnings.length ? ' · ' + res.warnings.join(' ') : ''), 'ok');
        } else {
            const s = L.subtitle;
            // only once the playhead has stopped moving (a clip is inserted at the playhead, so never while it is dragged)
            if (s && f >= s.start && f < s.end && !p.removed && !playWatch.playing && playWatch.still >= 3) await addLiveClip({ start: s.start, end: s.end, text: s.text || $('subText').value }, true);
        }
    }, 250);
}

// Every colour box opens macOS's own Colors panel (your saved swatches, the magnifier, the sliders). Hold Option to get the
// web colour picker instead. If the system panel cannot open, the web picker is used.
let colorPanelBusy = false, colorPanelUntil = 0, colorPanelSince = 0, colorLiveTarget = null, colorLiveApplied = false, colorLiveTimer = 0, colorLiveLast = 0;
if (window.sa && window.sa.onColorLive) window.sa.onColorLive((hex) => {
    // the Colors panel changes the colour while you drag in it: the settings and the preview follow at once (no OK needed)
    const t = colorLiveTarget;
    if (!t || !colorPanelBusy || hex === t.value) return;
    const run = () => { colorLiveTimer = 0; colorLiveLast = Date.now(); if (t.value === hex) return; t.value = hex; colorLiveApplied = true; t.dispatchEvent(new Event('input', { bubbles: true })); };
    clearTimeout(colorLiveTimer);
    const wait = Math.max(0, 150 - (Date.now() - colorLiveLast));
    colorLiveTimer = setTimeout(() => { if (t.value !== hex) { t.value = hex; colorLiveApplied = true; colorLiveLast = Date.now(); colorLiveTimer = 0; t.dispatchEvent(new Event('input', { bubbles: true })); } }, wait);
});
document.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'color' || e.altKey || !window.sa || !window.sa.pickColor) return;
    e.preventDefault();
    e.stopPropagation();
    // one panel only: further clicks (and the click a label passes on to its box) are ignored while it is open
    if (colorPanelBusy) {
        // a panel that has been open a while (maybe hidden behind another window) is closed by clicking the box again
        if (Date.now() - colorPanelSince > 1500) { try { window.sa.cancelColor(); } catch (err) { /* ignore */ } }
        return;
    }
    if (Date.now() < colorPanelUntil) return;
    colorPanelBusy = true;
    colorPanelSince = Date.now();
    colorLiveTarget = t; colorLiveApplied = false;
    const dbg = (msg) => { try { window.sa.dlog('[color] ' + msg + ' (' + (Date.now() - colorPanelSince) + ' ms) id=' + (t.id || '?') + ' from=' + t.value); } catch (err) { /* ignore */ } };
    dbg('panel opening');
    setStatus('Pick a color in the macOS Colors panel: it applies as you pick. Close the panel (or click the color box again) when done.', '');
    let r = null;
    try { r = await window.sa.pickColor(t.value); } catch (err) { r = null; }
    colorPanelBusy = false;
    clearTimeout(colorLiveTimer); colorLiveTimer = 0;
    colorPanelUntil = Date.now() + 400;
    dbg('panel returned ' + JSON.stringify(r));
    await new Promise(res => setTimeout(res, 150));    // let the window settle before the change is applied
    if (r && r.busy) return;
    setStatus('', '');
    if (r && r.ok && r.hex) {
        if (r.hex !== t.value) {
            t.value = r.hex;
            dbg('applying ' + r.hex);
            t.dispatchEvent(new Event('input', { bubbles: true }));
            dbg('input handled');
            setTimeout(() => { try { t.dispatchEvent(new Event('change', { bubbles: true })); } catch (err) { /* ignore */ } }, 60);      // boxes that listen for 'change' follow right after
        } else if (colorLiveApplied) {
            setTimeout(() => { try { t.dispatchEvent(new Event('change', { bubbles: true })); } catch (err) { /* ignore */ } }, 60);
        }
    } else if (!(r && r.ok)) {
        try { if (t.showPicker) t.showPicker(); } catch (err) { /* ignore */ }
    }
}, true);

let dblClickResetBound = false;
function bindDblClickReset() {
    if (dblClickResetBound) return;
    dblClickResetBound = true;
    document.addEventListener('dblclick', (e) => {
        // Find if target is a label or inside a label
        const label = e.target.closest('label, .xform-lbl, .sh-lbl, .rv-lbl, .td-lbl');
        if (!label) return;

        // Do not trigger if user was double clicking inside an input box to select text
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

        const inputs = [];
        const forId = label.getAttribute('for');
        if (forId) {
            const el = document.getElementById(forId);
            if (el) inputs.push(el);
        }
        label.querySelectorAll('input, select').forEach(inp => {
            if (!inputs.includes(inp)) inputs.push(inp);
        });

        const row = label.closest('.xform-grid-row, .ctl, .row, .sh-border-box, .sh-soft-row, .td-color-size, .rv-row, .td-line');
        if (row) {
            row.querySelectorAll('input, select').forEach(inp => {
                if (!inputs.includes(inp)) inputs.push(inp);
            });
        }

        if (!inputs.length) return;

        let handled = false;
        inputs.forEach(inp => {
            const def = getDefaultValue(inp);
            if (def !== null && def !== undefined) {
                inp.value = def;
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                handled = true;
            }
        });

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
            try {
                if (window.getSelection) window.getSelection().removeAllRanges();
            } catch (err) { }
        }
    });
}

function attachHexFields() {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    for (const sw of document.querySelectorAll('input[type=color]')) {
        if (sw._hex || sw.classList.contains('rv-native-color') || sw.classList.contains('hidden') || (sw.closest && sw.closest('.rv-swatch-box'))) continue;
        const hex = document.createElement('input');
        hex.type = 'text';
        hex.className = 'hex-input';
        hex.maxLength = 7;
        hex.spellcheck = false;
        hex.placeholder = '#ffffff';
        hex.title = 'Hex color code (e.g. #1e3036)';
        hex.value = sw.value;
        sw._hex = hex;
        const row = document.createElement('div');
        row.className = 'color-field';
        sw.parentNode.insertBefore(row, sw);
        row.appendChild(sw);
        row.appendChild(hex);

        // Keep the text field current when code sets the swatch value (loading a preset, switching element).
        Object.defineProperty(sw, 'value', {
            configurable: true,
            get() { return desc.get.call(this); },
            set(v) {
                desc.set.call(this, v);
                if (document.activeElement !== hex) hex.value = desc.get.call(this);
                this.dispatchEvent(new Event('colorsync'));
            }
        });
        sw.addEventListener('input', () => { if (document.activeElement !== hex) hex.value = sw.value; });

        const apply = (final) => {
            const h = normHex(hex.value);
            hex.classList.toggle('bad', !h && hex.value.trim() !== '');
            if (!h) return;
            if (h !== sw.value) {
                desc.set.call(sw, h);
                sw.dispatchEvent(new Event('input', { bubbles: true }));
                sw.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (final) hex.value = h;
        };
        hex.addEventListener('click', (e) => e.preventDefault()); // don't open the swatch picker via the label
        hex.addEventListener('input', () => apply(false));
        hex.addEventListener('change', () => apply(true));
        hex.addEventListener('blur', () => { apply(true); if (!normHex(hex.value)) { hex.value = sw.value; hex.classList.remove('bad'); } });
        hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(true); hex.blur(); } });
        hex.addEventListener('paste', () => setTimeout(() => apply(true), 0));
    }
}

function fillTrackSelect(sel, prefix, value) {
    sel.textContent = '';
    const opts = [[0, prefix === 'A' ? 'Auto (free track)' : 'Auto (top layer)']];
    for (let i = 1; i <= 12; i++) opts.push([i, prefix + i]);
    for (const [v, t] of opts) {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        if (Number(v) === Number(value)) o.selected = true;
        sel.appendChild(o);
    }
}

function nextVersionNameUI(baseName) {
    const stem = String(baseName || 'Animation').trim().replace(/\s+v\d+$/i, '');
    const taken = new Set((state.lib.animations || []).map(a => String(a.name || '').trim().toLowerCase()));
    let v = 2;
    while (taken.has((stem + ' v' + v).toLowerCase())) v++;
    return stem + ' v' + v;
}

function syncVarButtons(S, m) {
    const varIn = $('tdVarName' + S);
    const btnNew = $('tdSaveVar' + S);
    const btnUpd = $('tdUpdateLatest' + S);
    const bar = $('tdSaveBar' + S);
    if (!m) {
        if (bar) {
            bar.classList.add('hidden');
            bar.classList.remove('dirty');
        }
        return;
    }
    const autoName = nextVersionNameUI(m.name);
    if (varIn && document.activeElement !== varIn && varIn.dataset.forId !== m.id + ':' + m.name) {
        varIn.value = autoName;
        varIn.dataset.forId = m.id + ':' + m.name;
    }
    const chosen = (varIn && varIn.value.trim()) || autoName;
    if (btnNew) btnNew.textContent = '+ Create "' + chosen + '"';
    if (btnUpd) btnUpd.textContent = 'Update "' + (m.name || 'latest') + '"';
    const isAdjusted = !!(m.adjusted || m.dirty || m.designDirty || (S === 'C' && state.createAdjusted));
    if (bar) {
        bar.classList.toggle('hidden', !isAdjusted);
        bar.classList.toggle('dirty', isAdjusted);
    }
}

function syncGradientStopUI(S, curEl, stopIdx) {
    if (!curEl) return;
    const s0 = $('shStop0' + S), s1 = $('shStop1' + S);
    if (s0) s0.classList.toggle('sel', stopIdx === 0);
    if (s1) s1.classList.toggle('sel', stopIdx === 1);

    const offsetEl = $('shStopOffset' + S);
    if (offsetEl) offsetEl.value = stopIdx === 0 ? '0.0' : '1.0';

    const lbl = $('shStopLbl' + S);
    if (lbl) lbl.textContent = stopIdx === 0 ? 'Start Color' : 'End Color';

    const col = stopIdx === 0 ? (curEl.color || '#ffffff') : (curEl.color2 || '#f07b8e');
    const rgb = hexToRgb01(col);
    const op = clamp(Number(curEl.opacity ?? 1), 0, 1);

    const setVal = (slId, numId, val, dec) => {
        const sl = $(slId + S), nm = $(numId + S);
        if (sl && document.activeElement !== sl) sl.value = val;
        if (nm && document.activeElement !== nm) nm.value = Number(val).toFixed(dec);
    };

    setVal('shGradR', 'shGradRN', rgb.r, 2);
    setVal('shGradG', 'shGradGN', rgb.g, 2);
    setVal('shGradB', 'shGradBN', rgb.b, 2);
    setVal('shGradA', 'shGradAN', op, 2);

    if ($('shGradSwatchFill' + S)) $('shGradSwatchFill' + S).style.backgroundColor = col;
    if ($('shGradColorInput' + S)) $('shGradColorInput' + S).value = col;
    const hexEl = $('shGradHex' + S);
    if (hexEl && document.activeElement !== hexEl) hexEl.value = col;
}

// The design the Text Design panel edits: the preset's own (first Text+), or the Text+ picked at the top of the
// panel / in the text boxes (each detected Text+ has its own, numbered and named after it).
function editTD(m, S) {
    if (!m) return null;
    if (!m.textDesign) m.textDesign = cloneTextDesign(libEntry(m.id) && libEntry(m.id).textDesign);
    const own = (window.SABoxes && SABoxes.designFor) ? SABoxes.designFor(S, m) : null;
    return own || m.textDesign;
}

function fillTextDesign(ctx) {
    const S = ctx.s, m = ctx.model();
    if (!m) return;
    if (!m.textDesign) {
        const a = libEntry(m.id);
        m.textDesign = cloneTextDesign(a && a.textDesign);
    }
    syncVarButtons(S, m);
    if (window.SABoxes && SABoxes.renderTarget) SABoxes.renderTarget(S);
    const td = editTD(m, S);
    const fEl = $('tdFont' + S);
    if (fEl && document.activeElement !== fEl) fEl.value = td.font || 'Poppins';
    { const ns = fillStyleSelect(S, td.font || 'Poppins', td.style); if (typeof ns === 'string') td.style = ns; }
    const el1 = td.elements[0];
    const c1El = $('tdColor' + S);
    if (c1El && el1) c1El.value = el1.color || '#ffffff';

    const sz = Number(td.size) || 0.12;
    const szEl = $('tdSize' + S);
    if (szEl && document.activeElement !== szEl) szEl.value = sz;
    if ($('vTdSize' + S)) $('vTdSize' + S).textContent = sz.toFixed(3);

    const trk = Number(td.tracking ?? 1);
    const trkEl = $('tdTrack' + S);
    if (trkEl && document.activeElement !== trkEl) trkEl.value = trk;
    if ($('vTdTrack' + S)) $('vTdTrack' + S).textContent = trk.toFixed(2);

    const lsp = Number(td.lineSpacing ?? 1);
    const lspEl = $('tdLine' + S);
    if (lspEl && document.activeElement !== lspEl) lspEl.value = lsp;
    if ($('vTdLine' + S)) $('vTdLine' + S).textContent = lsp.toFixed(2);

    {
        const setR = (id, v, valId) => { const e = $(id + S); if (e && document.activeElement !== e) e.value = v; if (valId && $(valId + S)) $(valId + S).textContent = Number(v).toFixed(2); };
        setR('tdVAnc', td.vAnchor ?? 0); setR('tdVJust', td.vJustify ?? 0, 'vTdVJust');
        setR('tdHAnc', td.hAnchor ?? 0); setR('tdHJust', td.hJustify ?? 0, 'vTdHJust');
        if ($('tdDir' + S)) $('tdDir' + S).value = String(Math.round(td.direction ?? 0));
        if ($('tdLDir' + S)) $('tdLDir' + S).value = String(Math.round(td.lineDirection ?? 0));
        if ($('tdStrike' + S)) $('tdStrike' + S).classList.toggle('on', !!td.strikeout);
        if ($('tdUnder' + S)) $('tdUnder' + S).classList.toggle('on', !!td.underline);
        for (const b of document.querySelectorAll('#tdVAncBtns' + S + ' .td-ibtn, #tdHAncBtns' + S + ' .td-ibtn')) {
            const cur = b.dataset.anchor === 'v' ? Number(td.vAnchor ?? 0) : Number(td.hAnchor ?? 0);
            b.classList.toggle('on', Math.abs(cur - Number(b.dataset.val)) < 0.005);
        }
    }

    fillLayout(S, td);
    applyTdTab(S);

    const selIdx = clamp(Number(td.selectedElement) || 1, 1, 8);
    td.selectedElement = selIdx;
    const curEl = td.elements[selIdx - 1];

    const tabsBox = $('shSel' + S);
    if (tabsBox) {
        for (const btn of tabsBox.querySelectorAll('.sh-tab')) {
            const idx = Number(btn.dataset.idx);
            const eObj = td.elements[idx - 1];
            btn.classList.toggle('on', idx === selIdx);
            btn.classList.toggle('enabled', !!(eObj && eObj.enabled));
        }
    }

    if (!curEl) return;
    const nmEl = $('shName' + S);
    if (nmEl && document.activeElement !== nmEl) nmEl.value = curEl.name || ('Element ' + selIdx);
    const enEl = $('shEnabled' + S);
    if (enEl) enEl.checked = !!curEl.enabled;

    const propsBox = $('shProps' + S);
    if (propsBox) propsBox.classList.toggle('disabled-props', !curEl.enabled);

    const shapeBox = $('shShape' + S);
    const shVal = Number(curEl.shape) || 0;
    if (shapeBox) {
        for (const b of shapeBox.querySelectorAll('.sh-shape')) {
            b.classList.toggle('on', Number(b.dataset.shape) === shVal);
        }
    }

    const typeBox = $('shType' + S);
    const typeVal = Number(curEl.type) === 2 ? 2 : 0;
    curEl.type = typeVal;
    if (typeBox) {
        for (const b of typeBox.querySelectorAll('.rv-seg-btn, .sh-type')) {
            b.classList.toggle('on', Number(b.dataset.type) === typeVal);
        }
    }
    const isGradient = typeVal === 2;
    if ($('shSolidWrap' + S)) $('shSolidWrap' + S).classList.toggle('hidden', isGradient);
    if ($('shGradWrap' + S)) $('shGradWrap' + S).classList.toggle('hidden', !isGradient);

    const c1 = curEl.color || '#ffffff';
    const c2 = curEl.color2 || '#f07b8e';
    const op = clamp(Number(curEl.opacity ?? 1), 0, 1);

    // Sync Solid inputs
    const rgb1 = hexToRgb01(c1);
    const setVal = (slId, numId, val, dec) => {
        const sl = $(slId + S), nm = $(numId + S);
        if (sl && document.activeElement !== sl) sl.value = val;
        if (nm && document.activeElement !== nm) nm.value = Number(val).toFixed(dec);
    };

    setVal('shR', 'shRN', rgb1.r, 2);
    setVal('shG', 'shGN', rgb1.g, 2);
    setVal('shB', 'shBN', rgb1.b, 2);
    setVal('shOpacity', 'vShOpacity', op, 2);

    if ($('shColor' + S)) $('shColor' + S).value = c1;
    if ($('shSwatchFill' + S)) $('shSwatchFill' + S).style.backgroundColor = c1;
    const hexEl = $('shHex' + S);
    if (hexEl && document.activeElement !== hexEl) hexEl.value = c1;

    // Sync Gradient inputs
    if ($('shColor2' + S)) $('shColor2' + S).value = c2;
    if ($('shGradBar' + S)) $('shGradBar' + S).style.background = `linear-gradient(to right, ${c1}, ${c2})`;

    const activeStop = typeBox ? (typeBox._activeStop ?? 0) : 0;
    syncGradientStopUI(S, curEl, activeStop);

    // Sync mapping inputs
    const mAngle = Number(curEl.mappingAngle ?? 0);
    const mSize = Number(curEl.mappingSize ?? 1);
    const mAspect = Number(curEl.mappingAspect ?? 1);
    const mLevel = Number(curEl.mappingLevel ?? 3);

    setVal('shMapAngle', 'shMapAngleN', mAngle, 1);
    setVal('shMapSize', 'shMapSizeN', mSize, 2);
    setVal('shMapAspect', 'shMapAspectN', mAspect, 2);
    const mlEl = $('shMapLevel' + S);
    if (mlEl) mlEl.value = String(mLevel);

    const th = Number(curEl.thickness ?? 0.02);
    const thEl = $('shThickness' + S);
    if (thEl && document.activeElement !== thEl) thEl.value = th;
    if ($('vShThickness' + S)) $('vShThickness' + S).textContent = th.toFixed(3);
    if ($('shThickWrap' + S)) $('shThickWrap' + S).classList.toggle('hidden', !(shVal === 1 || shVal === 3));

    const isBorder = (shVal === 2 || shVal === 3);
    if ($('shBorderWrap' + S)) $('shBorderWrap' + S).classList.toggle('hidden', !isBorder);

    const lvEl = $('shLevel' + S);
    if (lvEl) lvEl.value = String(curEl.level ?? 0);

    const eh = Number(curEl.extendH ?? 0);
    const ehEl = $('shExtendH' + S);
    if (ehEl && document.activeElement !== ehEl) ehEl.value = eh;
    if ($('vShExtendH' + S)) $('vShExtendH' + S).textContent = eh.toFixed(3);

    const ev = Number(curEl.extendV ?? 0);
    const evEl = $('shExtendV' + S);
    if (evEl && document.activeElement !== evEl) evEl.value = ev;
    if ($('vShExtendV' + S)) $('vShExtendV' + S).textContent = ev.toFixed(3);

    const rd = Number(curEl.round ?? 0);
    const rdEl = $('shRound' + S);
    if (rdEl && document.activeElement !== rdEl) rdEl.value = rd;
    if ($('vShRound' + S)) $('vShRound' + S).textContent = rd.toFixed(3);

    const sfEl = $('shSoftness' + S);
    if (sfEl && document.activeElement !== sfEl) sfEl.value = Number(curEl.softness ?? 0);
    const oxEl = $('shOffsetX' + S);
    if (oxEl && document.activeElement !== oxEl) oxEl.value = Number(curEl.offsetX ?? 0);
    const oyEl = $('shOffsetY' + S);
    if (oyEl && document.activeElement !== oyEl) oyEl.value = Number(curEl.offsetY ?? 0);
    renderTdSummary(ctx);
}

// ---- Text / Shading Elements / Layout tabs of the Text & Shading Design panel
const tdTabSel = { U: 'text', C: 'text' };
function applyTdTab(S) {
    const tabs = $('tdTabs' + S);
    const panel = tabs ? tabs.closest('.td-panel') : null;
    if (!panel) return;
    const want = tdTabSel[S] || 'text';
    panel.querySelectorAll('.td-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === want));
    panel.querySelectorAll('.td-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== want));
}
document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.td-tab');
    if (!b || !b.parentElement || !b.parentElement.id) return;
    const S = b.parentElement.id.slice(-1);
    tdTabSel[S] = b.dataset.tab;
    applyTdTab(S);
});

// ---- Text+ Layout tab (Type, Center, Center Z, Pivot, Pivot Z, Size, Perspective)
const LAYOUT_FIELDS = [
    // [key, slider id, number id, Fusion input, decimals]
    ['centerZ', 'lyCz', 'lyCzN', 'CenterZ', 2],
    ['pivotZ', 'lyPz', 'lyPzN', 'PivotZ', 2],
    ['size', 'lySize', 'lySizeN', 'LayoutSize', 2],
    ['perspective', 'lyPersp', 'lyPerspN', 'Perspective', 2]
];
const ANIMATED_TIP = 'Animated in this preset: its keyframes are kept, so this value cannot be overridden here';
function layoutOf(td) {
    if (!td.layout || typeof td.layout !== 'object') td.layout = { type: 0, centerZ: 0, pivotX: 0.5, pivotY: 0.5, pivotZ: 0, size: 1, perspective: 1, animated: [] };
    return td.layout;
}
function lockField(el, locked) {
    if (!el) return;
    el.disabled = !!locked;
    if (locked) el.title = ANIMATED_TIP; else if (el.title === ANIMATED_TIP) el.title = '';
}
function setNum(el, v, dec) {
    if (!el || document.activeElement === el) return;
    el.value = Number(v).toFixed(dec);
}
function fillLayout(S, td) {
    const L = layoutOf(td);
    const anim = new Set(Array.isArray(L.animated) ? L.animated : []);
    const ty = $('lyType' + S);
    if (ty && document.activeElement !== ty) ty.value = String(Math.round(Number(L.type) || 0));
    lockField(ty, anim.has('LayoutType'));
    const pc = window.SABoxes ? SABoxes.primaryCenter(S) : null;
    setNum($('lyCx' + S), pc ? pc.cx : 0.5, 3);
    setNum($('lyCy' + S), pc ? pc.cy : 0.5, 3);
    const cLocked = !pc || !pc.movable || anim.has('Center');
    lockField($('lyCx' + S), cLocked);
    lockField($('lyCy' + S), cLocked);
    setNum($('lyPx' + S), L.pivotX, 3);
    setNum($('lyPy' + S), L.pivotY, 3);
    lockField($('lyPx' + S), anim.has('Pivot'));
    lockField($('lyPy' + S), anim.has('Pivot'));
    for (const [key, sid, nid, input, dec] of LAYOUT_FIELDS) {
        const v = Number(L[key]);
        const sl = $(sid + S);
        if (sl && document.activeElement !== sl) sl.value = v;
        setNum($(nid + S), v, dec);
        lockField(sl, anim.has(input));
        lockField($(nid + S), anim.has(input));
    }
}
function bindLayout(ctx, commit) {
    const S = ctx.s;
    const L = () => { const m = ctx.model(); const td = editTD(m, S); return td ? layoutOf(td) : null; };
    const ty = $('lyType' + S);
    if (ty) ty.addEventListener('change', () => { const l = L(); if (!l) return; l.type = Number(ty.value) || 0; commit(); });
    for (const [key, sid, nid, , dec] of LAYOUT_FIELDS) {
        const sl = $(sid + S), nm = $(nid + S);
        if (sl) sl.addEventListener('input', () => {
            const l = L(); if (!l) return;
            l[key] = Number(sl.value);
            if (nm) nm.value = l[key].toFixed(dec);
            commit();
        });
        if (nm) nm.addEventListener('change', () => {
            const l = L(); if (!l) return;
            const v = Number(nm.value);
            if (isNaN(v)) { nm.value = Number(l[key]).toFixed(dec); return; }
            l[key] = v;
            if (sl) sl.value = v;
            commit();
        });
    }
    for (const [axis, id] of [['pivotX', 'lyPx'], ['pivotY', 'lyPy']]) {
        const el = $(id + S);
        if (el) el.addEventListener('change', () => {
            const l = L(); if (!l) return;
            const v = Number(el.value);
            if (isNaN(v)) { el.value = Number(l[axis]).toFixed(3); return; }
            l[axis] = v;
            commit();
        });
    }
    for (const id of ['lyCx', 'lyCy']) {
        const el = $(id + S);
        if (el) el.addEventListener('change', () => {
            const cx = Number($('lyCx' + S).value), cy = Number($('lyCy' + S).value);
            if (isNaN(cx) || isNaN(cy) || !window.SABoxes) return;
            SABoxes.setPrimaryCenter(S, cx, cy);
        });
    }
}

function bindTextDesign(ctx) {
    const S = ctx.s;
    const notifyMsg = (msg, kind) => {
        if (S === 'C') setCreateStatus(msg, kind);
        else setStatus(msg, kind);
    };
    const commit = () => {
        const m = ctx.model();
        if (!m) return;
        if (S === 'U') m.designRev = (m.designRev || 0) + 1;
        else designRev.set(m.id, (designRev.get(m.id) || 0) + 1);
        m.designDirty = true;
        m.adjusted = true;
        m.dirty = true;
        if (S === 'U' && state.use) {
            state.use.dirty = true;
            state.use.adjusted = true;
            state.use.designDirty = true;
        }
        if (S === 'C') state.createAdjusted = true;

        // Create tab edits the preset's default design; the Use tab is a one-time override and saves nothing.
        const a = S === 'C' ? libEntry(m.id) : null;
        if (a) {
            a.textDesign = cloneTextDesign(m.textDesign);
            a.designDirty = true;
            a.adjusted = true;
        }

        fillTextDesign(ctx);
        renderUseSummary();
        if (S === 'C') renderCreateSummary();
        redrawStages();

        if (window.SAThumbs && typeof SAThumbs.drawAll === 'function') {
            SAThumbs.drawAll(performance.now());
        }

        if (S === 'C') saveField(m.id, { textDesign: m.textDesign, boxes: m.boxes || {} });

        if (typeof triggerLiveSync === 'function') {
            triggerLiveSync(m, S);
        }
    };
    const curEl = () => {
        const m = ctx.model();
        if (!m) return null;
        const td = editTD(m, S);
        const idx = clamp(Number(td.selectedElement) || 1, 1, 8);
        return td.elements[idx - 1];
    };

    const varIn = $('tdVarName' + S);
    if (varIn) {
        varIn.addEventListener('input', () => {
            const m = ctx.model();
            if (m) syncVarButtons(S, m);
        });
    }

    const btnSaveVar = $('tdSaveVar' + S);
    if (btnSaveVar) {
        btnSaveVar.addEventListener('click', async () => {
            const m = ctx.model();
            if (!m) return;
            const customName = ($('tdVarName' + S) && $('tdVarName' + S).value.trim()) || nextVersionNameUI(m.name);
            notifyMsg('Creating "' + customName + '"…');
            const origSfx = m.sfxOrig || (libEntry(m.id) && libEntry(m.id).sfxOrig) || m.sfx || null;
            const res = await window.sa.saveVariant({
                sourceId: m.id,
                boxes: m.boxes || {},
                name: customName,
                useSfx: m.useSfx !== false,
                linked: m.linked !== false,
                sfxOrig: origSfx,
                sfx: m.sfx !== undefined ? m.sfx : null,
                sfxPath: m.sfxPath || null,
                textOffset: m.textOffset,
                sfxOffset: m.sfxOffset,
                sfxVolume: m.sfxVolume,
                tail: m.tail,
                textTrack: m.textTrack,
                sfxTrack: m.sfxTrack,
                posX: Number(m.posX) || 0,
                posY: Number(m.posY) || 0,
                scale: Number(m.scale) || 1,
                rotation: Number(m.rotation) || 0,
                textDesign: m.textDesign
            });
            if (res && res.error) {
                notifyMsg(res.error, 'bad');
                return;
            }
            if (res && res.lib) {
                m.designDirty = false;
                m.adjusted = false;
                m.dirty = false;
                state.createAdjusted = false;
                state.lib = res.lib;
                state.selectedId = res.createdId;
                if (S === 'C') state.createId = res.createdId;
                const newM = libEntry(res.createdId);
                if (newM && newM.useSfx !== false && (newM.sfx || newM.sfxOrig)) {
                    await syncAttachedSfx(newM);
                }
                syncUse(true);
                renderAll();
                notifyMsg('Created new preset "' + res.createdName + '".', 'ok');
            }
        });
    }

    const btnUpd = $('tdUpdateLatest' + S);
    if (btnUpd) {
        btnUpd.addEventListener('click', async () => {
            const m = ctx.model();
            if (!m) return;
            if (m.useSfx !== false && (m.sfx || m.sfxOrig)) {
                await syncAttachedSfx(m);
            }
            notifyMsg('Updating "' + m.name + '"…');
            const res = await window.sa.updateLatest({
                animationId: m.id,
                text: $('subText') ? $('subText').value : '',
                updateText: S === 'U',
                boxes: m.boxes || {},
                boxList: window.SABoxes ? SABoxes.payload(m, libEntry(m.id) || m, $('subText') ? $('subText').value : '', S === 'U') : [],
                useSfx: m.useSfx !== false,
                linked: m.linked !== false,
                sfxOrig: m.sfxOrig || (libEntry(m.id) && libEntry(m.id).sfxOrig) || m.sfx || null,
                sfx: m.sfx !== undefined ? m.sfx : null,
                sfxPath: m.sfxPath || null,
                textOffset: m.textOffset,
                sfxOffset: m.sfxOffset,
                sfxVolume: m.sfxVolume,
                tail: m.tail,
                textTrack: m.textTrack,
                sfxTrack: m.sfxTrack,
                posX: Number(m.posX) || 0,
                posY: Number(m.posY) || 0,
                scale: Number(m.scale) || 1,
                rotation: Number(m.rotation) || 0,
                textDesign: m.textDesign
            });
            if (res && res.error) {
                notifyMsg(res.error, 'bad');
                return;
            }
            if (res && res.lib) {
                m.designDirty = false;
                m.adjusted = false;
                m.dirty = false;
                state.createAdjusted = false;
                state.lib = res.lib;
                syncUse(true);
                renderAll();
                refreshLiveBg();
                notifyMsg(
                    res.updatedClip
                        ? 'Updated "' + res.animName + '" and latest Text+ clip on timeline.'
                        : 'Updated "' + res.animName + '" default design.',
                    'ok'
                );
            }
        });
    }

    const btnRevertOrig = $('tdRevertOrig' + S);
    if (btnRevertOrig) {
        btnRevertOrig.addEventListener('click', (e) => {
            e.stopPropagation();
            const m = ctx.model();
            if (!m) return;
            const targetId = m.id || (S === 'C' ? state.createId : state.selectedId);
            const a = libEntry(targetId);
            if (!a) return;
            openConfirmPop(btnRevertOrig, {
                title: 'Revert to original version?',
                message: 'Restore "' + a.name + '" back to its original .settings file, text design, alignment, and sound? Any saved updates will be overwritten.',
                confirmText: 'Revert',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.revertAnimation(a.id);
                    if (takeLib(res)) {
                        setStatus('Reverted "' + a.name + '" to original version.', 'ok');
                    }
                }
            });
        });
    }

    bindFontPicker($('tdFont' + S));
    const applyFont = (typedOnly) => {
        const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
        let v = $('tdFont' + S).value.trim();
        const known = state.fonts.find(f => f.toLowerCase() === v.toLowerCase());
        if (typedOnly && !known) return;                     // half-typed names wait for Enter / a pick
        if (known) v = known;
        td.font = v || 'Poppins';
        { const ns = fillStyleSelect(S, td.font, td.style); if (typeof ns === 'string') td.style = ns; }     // never a style the new font does not have
        commit();
    };
    $('tdFont' + S).addEventListener('input', (e) => applyFont(!!(e && e.inputType)));
    $('tdFont' + S).addEventListener('change', () => applyFont(false));
    $('tdStyle' + S).addEventListener('change', () => {
        const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
        td.style = $('tdStyle' + S).value;
        commit();
    });
    $('tdColor' + S).addEventListener('input', () => {
        const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
        const c = $('tdColor' + S).value;
        td.elements[0].color = c;
        td.elements[0].modified = true;
        commit();
    });
    $('tdSize' + S).addEventListener('input', () => {
        const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
        td.size = Number($('tdSize' + S).value);
        if ($('vTdSize' + S)) $('vTdSize' + S).textContent = td.size.toFixed(3);
        commit();
    });
    $('tdTrack' + S).addEventListener('input', () => {
        const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
        td.tracking = Number($('tdTrack' + S).value);
        if ($('vTdTrack' + S)) $('vTdTrack' + S).textContent = td.tracking.toFixed(2);
        commit();
    });
    $('tdLine' + S).addEventListener('input', () => {
        const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
        td.lineSpacing = Number($('tdLine' + S).value);
        if ($('vTdLine' + S)) $('vTdLine' + S).textContent = td.lineSpacing.toFixed(2);
        commit();
    });

    {
        const slider = (id, key, valId) => $(id + S).addEventListener('input', () => {
            const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
            td[key] = Number($(id + S).value);
            if (valId && $(valId + S)) $(valId + S).textContent = td[key].toFixed(2);
            commit();
            if (!valId) for (const b of document.querySelectorAll('#td' + (key === 'vAnchor' ? 'V' : 'H') + 'AncBtns' + S + ' .td-ibtn')) b.classList.toggle('on', Math.abs(td[key] - Number(b.dataset.val)) < 0.005);
        });
        slider('tdVAnc', 'vAnchor'); slider('tdHAnc', 'hAnchor');
        slider('tdVJust', 'vJustify', 'vTdVJust'); slider('tdHJust', 'hJustify', 'vTdHJust');
        for (const b of document.querySelectorAll('#tdVAncBtns' + S + ' .td-ibtn, #tdHAncBtns' + S + ' .td-ibtn')) {
            b.addEventListener('click', () => {
                const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
                td[b.dataset.anchor === 'v' ? 'vAnchor' : 'hAnchor'] = Number(b.dataset.val);
                commit();
                fillTextDesign(ctx);
            });
        }
        $('tdDir' + S).addEventListener('change', () => {
            const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
            td.direction = Number($('tdDir' + S).value); commit();
        });
        $('tdLDir' + S).addEventListener('change', () => {
            const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
            td.lineDirection = Number($('tdLDir' + S).value); commit();
        });
        for (const [id, key] of [['tdStrike', 'strikeout'], ['tdUnder', 'underline']]) {
            $(id + S).addEventListener('click', () => {
                const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
                td[key] = td[key] ? 0 : 1;
                $(id + S).classList.toggle('on', !!td[key]);
                commit();
            });
        }
    }

    bindLayout(ctx, commit);

    for (const btn of $('shSel' + S).querySelectorAll('.sh-tab')) {
        btn.addEventListener('click', () => {
            const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
            td.selectedElement = Number(btn.dataset.idx) || 1;
            fillTextDesign(ctx);
        });
    }

    $('shName' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.name = $('shName' + S).value;
        el.modified = true;
        commit();
    });
    $('shEnabled' + S).addEventListener('change', () => {
        const el = curEl(); if (!el) return;
        el.enabled = $('shEnabled' + S).checked;
        el.modified = true;
        commit();
    });

    for (const b of $('shShape' + S).querySelectorAll('.sh-shape')) {
        b.addEventListener('click', () => {
            const el = curEl(); if (!el) return;
            el.shape = Number(b.dataset.shape) || 0;
            el.enabled = true;
            el.modified = true;
            commit();
        });
    }

    const typeBox = $('shType' + S);
    if (typeBox) {
        for (const b of typeBox.querySelectorAll('.rv-seg-btn, .sh-type')) {
            b.addEventListener('click', () => {
                const el = curEl(); if (!el) return;
                el.type = Number(b.dataset.type) === 2 ? 2 : 0;
                el.enabled = true;
                el.modified = true;
                fillTextDesign(ctx);
                commit();
            });
        }
    }

    // --- Solid Color & Opacity RGBA controls
    const updateSolidRgb = () => {
        const el = curEl(); if (!el) return;
        const r = clamp(Number($('shR' + S).value), 0, 1);
        const g = clamp(Number($('shG' + S).value), 0, 1);
        const b = clamp(Number($('shB' + S).value), 0, 1);
        const hex = rgb01ToHex(r, g, b);
        el.color = hex;
        if ($('shColor' + S)) $('shColor' + S).value = hex;
        if ($('shSwatchFill' + S)) $('shSwatchFill' + S).style.backgroundColor = hex;
        const hexEl = $('shHex' + S);
        if (hexEl && document.activeElement !== hexEl) hexEl.value = hex;
        el.modified = true;
        commit();
    };

    if ($('shR' + S)) {
        $('shR' + S).addEventListener('input', () => {
            if ($('shRN' + S)) $('shRN' + S).value = Number($('shR' + S).value).toFixed(2);
            updateSolidRgb();
        });
    }
    if ($('shRN' + S)) {
        $('shRN' + S).addEventListener('input', () => {
            const v = clamp(Number($('shRN' + S).value) || 0, 0, 1);
            if ($('shR' + S)) $('shR' + S).value = v;
            updateSolidRgb();
        });
    }

    if ($('shG' + S)) {
        $('shG' + S).addEventListener('input', () => {
            if ($('shGN' + S)) $('shGN' + S).value = Number($('shG' + S).value).toFixed(2);
            updateSolidRgb();
        });
    }
    if ($('shGN' + S)) {
        $('shGN' + S).addEventListener('input', () => {
            const v = clamp(Number($('shGN' + S).value) || 0, 0, 1);
            if ($('shG' + S)) $('shG' + S).value = v;
            updateSolidRgb();
        });
    }

    if ($('shB' + S)) {
        $('shB' + S).addEventListener('input', () => {
            if ($('shBN' + S)) $('shBN' + S).value = Number($('shB' + S).value).toFixed(2);
            updateSolidRgb();
        });
    }
    if ($('shBN' + S)) {
        $('shBN' + S).addEventListener('input', () => {
            const v = clamp(Number($('shBN' + S).value) || 0, 0, 1);
            if ($('shB' + S)) $('shB' + S).value = v;
            updateSolidRgb();
        });
    }

    if ($('shHex' + S)) {
        const hexEl = $('shHex' + S);
        const applyHex = () => {
            const el = curEl(); if (!el) return;
            const norm = normHex(hexEl.value);
            hexEl.classList.toggle('bad', !norm && hexEl.value.trim() !== '');
            if (!norm) return;
            el.color = norm;
            const rgb = hexToRgb01(norm);
            if ($('shR' + S)) $('shR' + S).value = rgb.r;
            if ($('shRN' + S)) $('shRN' + S).value = rgb.r.toFixed(2);
            if ($('shG' + S)) $('shG' + S).value = rgb.g;
            if ($('shGN' + S)) $('shGN' + S).value = rgb.g.toFixed(2);
            if ($('shB' + S)) $('shB' + S).value = rgb.b;
            if ($('shBN' + S)) $('shBN' + S).value = rgb.b.toFixed(2);
            if ($('shSwatchFill' + S)) $('shSwatchFill' + S).style.backgroundColor = norm;
            if ($('shColor' + S)) $('shColor' + S).value = norm;
            el.modified = true;
            commit();
        };
        hexEl.addEventListener('input', applyHex);
        hexEl.addEventListener('blur', () => {
            const el = curEl();
            const norm = normHex(hexEl.value);
            if (norm) hexEl.value = norm;
            else if (el) { hexEl.value = el.color || '#ffffff'; hexEl.classList.remove('bad'); }
        });
    }

    const updateSolidOpacity = (v) => {
        const el = curEl(); if (!el) return;
        el.opacity = clamp(Number(v), 0, 1);
        el.modified = true;
        commit();
    };

    if ($('shOpacity' + S)) {
        $('shOpacity' + S).addEventListener('input', () => {
            const v = Number($('shOpacity' + S).value);
            if ($('vShOpacity' + S)) $('vShOpacity' + S).value = v.toFixed(2);
            updateSolidOpacity(v);
        });
    }
    if ($('vShOpacity' + S)) {
        $('vShOpacity' + S).addEventListener('input', () => {
            const v = clamp(Number($('vShOpacity' + S).value) || 0, 0, 1);
            if ($('shOpacity' + S)) $('shOpacity' + S).value = v;
            updateSolidOpacity(v);
        });
    }

    if ($('shColor' + S)) {
        $('shColor' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            el.color = $('shColor' + S).value;
            const rgb = hexToRgb01(el.color);
            if ($('shR' + S)) $('shR' + S).value = rgb.r;
            if ($('shRN' + S)) $('shRN' + S).value = rgb.r.toFixed(2);
            if ($('shG' + S)) $('shG' + S).value = rgb.g;
            if ($('shGN' + S)) $('shGN' + S).value = rgb.g.toFixed(2);
            if ($('shB' + S)) $('shB' + S).value = rgb.b;
            if ($('shBN' + S)) $('shBN' + S).value = rgb.b.toFixed(2);
            if ($('shSwatchFill' + S)) $('shSwatchFill' + S).style.backgroundColor = el.color;
            const hexEl = $('shHex' + S);
            if (hexEl && document.activeElement !== hexEl) hexEl.value = el.color;
            el.modified = true;
            commit();
        });
    }

    if ($('shDropBtn' + S)) {
        $('shDropBtn' + S).addEventListener('click', async () => {
            if (window.EyeDropper) {
                try {
                    const ed = new EyeDropper();
                    const res = await ed.open();
                    if (res && res.sRGBHex) {
                        const colEl = $('shColor' + S);
                        if (colEl) {
                            colEl.value = res.sRGBHex;
                            colEl.dispatchEvent(new Event('input'));
                        }
                    }
                } catch (e) { }
            } else {
                const colEl = $('shColor' + S);
                if (colEl) colEl.click();
            }
        });
    }

    if ($('shColorToggle' + S)) {
        $('shColorToggle' + S).addEventListener('click', () => {
            const toggle = $('shColorToggle' + S);
            toggle.classList.toggle('open');
            const sliders = $('shSolidSliders' + S);
            if (sliders) sliders.classList.toggle('hidden', !toggle.classList.contains('open'));
        });
    }

    // --- Gradient controls
    let activeGradStop = 0;
    if ($('shStop0' + S)) {
        $('shStop0' + S).addEventListener('click', () => {
            activeGradStop = 0;
            if (typeBox) typeBox._activeStop = 0;
            const el = curEl(); if (el) syncGradientStopUI(S, el, 0);
        });
    }
    if ($('shStop1' + S)) {
        $('shStop1' + S).addEventListener('click', () => {
            activeGradStop = 1;
            if (typeBox) typeBox._activeStop = 1;
            const el = curEl(); if (el) syncGradientStopUI(S, el, 1);
        });
    }

    const updateGradRgb = () => {
        const el = curEl(); if (!el) return;
        const r = clamp(Number($('shGradR' + S).value), 0, 1);
        const g = clamp(Number($('shGradG' + S).value), 0, 1);
        const b = clamp(Number($('shGradB' + S).value), 0, 1);
        const hex = rgb01ToHex(r, g, b);
        if (activeGradStop === 0) {
            el.color = hex;
            if ($('shColor' + S)) $('shColor' + S).value = hex;
        } else {
            el.color2 = hex;
            if ($('shColor2' + S)) $('shColor2' + S).value = hex;
        }
        if ($('shGradSwatchFill' + S)) $('shGradSwatchFill' + S).style.backgroundColor = hex;
        if ($('shGradColorInput' + S)) $('shGradColorInput' + S).value = hex;
        const hexEl = $('shGradHex' + S);
        if (hexEl && document.activeElement !== hexEl) hexEl.value = hex;
        if ($('shGradBar' + S)) $('shGradBar' + S).style.background = `linear-gradient(to right, ${el.color || '#ffffff'}, ${el.color2 || '#f07b8e'})`;
        el.modified = true;
        commit();
    };

    if ($('shGradR' + S)) {
        $('shGradR' + S).addEventListener('input', () => {
            if ($('shGradRN' + S)) $('shGradRN' + S).value = Number($('shGradR' + S).value).toFixed(2);
            updateGradRgb();
        });
    }
    if ($('shGradRN' + S)) {
        $('shGradRN' + S).addEventListener('input', () => {
            const v = clamp(Number($('shGradRN' + S).value) || 0, 0, 1);
            if ($('shGradR' + S)) $('shGradR' + S).value = v;
            updateGradRgb();
        });
    }

    if ($('shGradG' + S)) {
        $('shGradG' + S).addEventListener('input', () => {
            if ($('shGradGN' + S)) $('shGradGN' + S).value = Number($('shGradG' + S).value).toFixed(2);
            updateGradRgb();
        });
    }
    if ($('shGradGN' + S)) {
        $('shGradGN' + S).addEventListener('input', () => {
            const v = clamp(Number($('shGradGN' + S).value) || 0, 0, 1);
            if ($('shGradG' + S)) $('shGradG' + S).value = v;
            updateGradRgb();
        });
    }

    if ($('shGradB' + S)) {
        $('shGradB' + S).addEventListener('input', () => {
            if ($('shGradBN' + S)) $('shGradBN' + S).value = Number($('shGradB' + S).value).toFixed(2);
            updateGradRgb();
        });
    }
    if ($('shGradBN' + S)) {
        $('shGradBN' + S).addEventListener('input', () => {
            const v = clamp(Number($('shGradBN' + S).value) || 0, 0, 1);
            if ($('shGradB' + S)) $('shGradB' + S).value = v;
            updateGradRgb();
        });
    }

    if ($('shGradHex' + S)) {
        const hexEl = $('shGradHex' + S);
        const applyGradHex = () => {
            const el = curEl(); if (!el) return;
            const norm = normHex(hexEl.value);
            hexEl.classList.toggle('bad', !norm && hexEl.value.trim() !== '');
            if (!norm) return;
            if (activeGradStop === 0) {
                el.color = norm;
                if ($('shColor' + S)) $('shColor' + S).value = norm;
            } else {
                el.color2 = norm;
                if ($('shColor2' + S)) $('shColor2' + S).value = norm;
            }
            syncGradientStopUI(S, el, activeGradStop);
            if ($('shGradBar' + S)) $('shGradBar' + S).style.background = `linear-gradient(to right, ${el.color || '#ffffff'}, ${el.color2 || '#f07b8e'})`;
            el.modified = true;
            commit();
        };
        hexEl.addEventListener('input', applyGradHex);
        hexEl.addEventListener('blur', () => {
            const el = curEl();
            const norm = normHex(hexEl.value);
            if (norm) hexEl.value = norm;
            else if (el) {
                const cur = activeGradStop === 0 ? el.color : el.color2;
                hexEl.value = cur || '#ffffff';
                hexEl.classList.remove('bad');
            }
        });
    }

    if ($('shGradA' + S)) {
        $('shGradA' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = clamp(Number($('shGradA' + S).value), 0, 1);
            if ($('shGradAN' + S)) $('shGradAN' + S).value = v.toFixed(2);
            el.opacity = v;
            el.modified = true;
            commit();
        });
    }
    if ($('shGradAN' + S)) {
        $('shGradAN' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = clamp(Number($('shGradAN' + S).value) || 0, 0, 1);
            if ($('shGradA' + S)) $('shGradA' + S).value = v;
            el.opacity = v;
            el.modified = true;
            commit();
        });
    }

    if ($('shGradColorInput' + S)) {
        $('shGradColorInput' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const hex = $('shGradColorInput' + S).value;
            if (activeGradStop === 0) {
                el.color = hex;
                if ($('shColor' + S)) $('shColor' + S).value = hex;
            } else {
                el.color2 = hex;
                if ($('shColor2' + S)) $('shColor2' + S).value = hex;
            }
            syncGradientStopUI(S, el, activeGradStop);
            if ($('shGradBar' + S)) $('shGradBar' + S).style.background = `linear-gradient(to right, ${el.color || '#ffffff'}, ${el.color2 || '#f07b8e'})`;
            el.modified = true;
            commit();
        });
    }

    if ($('shGradDropBtn' + S)) {
        $('shGradDropBtn' + S).addEventListener('click', async () => {
            if (window.EyeDropper) {
                try {
                    const ed = new EyeDropper();
                    const res = await ed.open();
                    if (res && res.sRGBHex) {
                        const inEl = $('shGradColorInput' + S);
                        if (inEl) {
                            inEl.value = res.sRGBHex;
                            inEl.dispatchEvent(new Event('input'));
                        }
                    }
                } catch (e) { }
            } else {
                const inEl = $('shGradColorInput' + S);
                if (inEl) inEl.click();
            }
        });
    }

    if ($('shGradColorToggle' + S)) {
        $('shGradColorToggle' + S).addEventListener('click', () => {
            const toggle = $('shGradColorToggle' + S);
            toggle.classList.toggle('open');
            const sliders = $('shGradSliders' + S);
            if (sliders) sliders.classList.toggle('hidden', !toggle.classList.contains('open'));
        });
    }

    // Mapping Angle
    if ($('shMapAngle' + S)) {
        $('shMapAngle' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = Number($('shMapAngle' + S).value);
            if ($('shMapAngleN' + S)) $('shMapAngleN' + S).value = v.toFixed(1);
            el.mappingAngle = v;
            el.modified = true;
            commit();
        });
    }
    if ($('shMapAngleN' + S)) {
        $('shMapAngleN' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = clamp(Number($('shMapAngleN' + S).value) || 0, -180, 180);
            if ($('shMapAngle' + S)) $('shMapAngle' + S).value = v;
            el.mappingAngle = v;
            el.modified = true;
            commit();
        });
    }

    // Mapping Size
    if ($('shMapSize' + S)) {
        $('shMapSize' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = Number($('shMapSize' + S).value);
            if ($('shMapSizeN' + S)) $('shMapSizeN' + S).value = v.toFixed(2);
            el.mappingSize = v;
            el.modified = true;
            commit();
        });
    }
    if ($('shMapSizeN' + S)) {
        $('shMapSizeN' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = clamp(Number($('shMapSizeN' + S).value) || 0.1, 0.1, 10);
            if ($('shMapSize' + S)) $('shMapSize' + S).value = v;
            el.mappingSize = v;
            el.modified = true;
            commit();
        });
    }

    // Mapping Aspect
    if ($('shMapAspect' + S)) {
        $('shMapAspect' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = Number($('shMapAspect' + S).value);
            if ($('shMapAspectN' + S)) $('shMapAspectN' + S).value = v.toFixed(2);
            el.mappingAspect = v;
            el.modified = true;
            commit();
        });
    }
    if ($('shMapAspectN' + S)) {
        $('shMapAspectN' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = clamp(Number($('shMapAspectN' + S).value) || 0.1, 0.1, 10);
            if ($('shMapAspect' + S)) $('shMapAspect' + S).value = v;
            el.mappingAspect = v;
            el.modified = true;
            commit();
        });
    }

    // Mapping Level
    if ($('shMapLevel' + S)) {
        $('shMapLevel' + S).addEventListener('change', () => {
            const el = curEl(); if (!el) return;
            el.mappingLevel = Number($('shMapLevel' + S).value);
            el.modified = true;
            commit();
        });
    }
    $('shThickness' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.thickness = Number($('shThickness' + S).value);
        if ($('vShThickness' + S)) $('vShThickness' + S).textContent = el.thickness.toFixed(3);
        el.modified = true;
        commit();
    });
    $('shLevel' + S).addEventListener('change', () => {
        const el = curEl(); if (!el) return;
        el.level = Number($('shLevel' + S).value);
        el.modified = true;
        commit();
    });
    $('shExtendH' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.extendH = Number($('shExtendH' + S).value);
        if ($('vShExtendH' + S)) $('vShExtendH' + S).textContent = el.extendH.toFixed(3);
        el.modified = true;
        commit();
    });
    $('shExtendV' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.extendV = Number($('shExtendV' + S).value);
        if ($('vShExtendV' + S)) $('vShExtendV' + S).textContent = el.extendV.toFixed(3);
        el.modified = true;
        commit();
    });
    $('shRound' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.round = Number($('shRound' + S).value);
        if ($('vShRound' + S)) $('vShRound' + S).textContent = el.round.toFixed(3);
        el.modified = true;
        commit();
    });
    $('shSoftness' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.softness = clamp(Number($('shSoftness' + S).value) || 0, 0, 30);
        el.modified = true;
        commit();
    });
    $('shOffsetX' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.offsetX = clamp(Number($('shOffsetX' + S).value) || 0, -1, 1);
        el.modified = true;
        commit();
    });
    $('shOffsetY' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.offsetY = clamp(Number($('shOffsetY' + S).value) || 0, -1, 1);
        el.modified = true;
        commit();
    });
}

function fillAdjust(ctx) {
    const S = ctx.s, m = ctx.model();
    if (!m) return;
    syncNumbers(ctx);
    $('linked' + S).checked = m.linked !== false;
    $('useSfx' + S).checked = m.useSfx !== false;
    $('sfxVolume' + S).value = m.sfxVolume; $('vSfxVolume' + S).textContent = m.sfxVolume + ' dB';
    const a = libEntry(m.id);
    const origFile = m.sfxOrig || (a && a.sfxOrig);
    const curFile = m.sfxPath ? baseName(m.sfxPath) : (m.sfx || (a && a.sfx));
    const defFile = state.lib.defaultSfx ? state.lib.defaultSfx.file : null;
    const sfxNameEl = $('sfxName' + S);
    if (sfxNameEl) {
        if (origFile && curFile && curFile !== origFile) {
            sfxNameEl.textContent = origFile + ' (' + curFile + ')';
        } else if (origFile || curFile) {
            sfxNameEl.textContent = origFile || curFile;
        } else if (defFile) {
            sfxNameEl.textContent = 'default (' + defFile + ')';
        } else {
            sfxNameEl.textContent = 'No sound';
        }
    }
    const sfxPlayBtn = $('sfxPlay' + S);
    if (sfxPlayBtn) {
        sfxPlayBtn.style.display = (curFile || origFile || defFile) ? 'inline-flex' : 'none';
    }
    fillTrackSelect($('textTrack' + S), 'V', m.textTrack);
    fillTrackSelect($('sfxTrack' + S), 'A', m.sfxTrack);
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
        $(f + S).addEventListener('input', () => {
            const m = ctx.model(); if (!m) return;
            const v = clamp(Math.round(Number($(f + S).value) || 0), -300, 300);
            if (f === 'textOffset' && m.linked === false) m.sfxOffset = clamp(m.sfxOffset - (v - m.textOffset), -300, 300);
            m[f] = v;
            changed();
        });
    }
    $('linked' + S).addEventListener('change', () => { const m = ctx.model(); if (m) { m.linked = $('linked' + S).checked; changed(); } });
    $('useSfx' + S).addEventListener('change', () => { const m = ctx.model(); if (m) { m.useSfx = $('useSfx' + S).checked; changed(); renderAnimations(); } });
    $('sfxVolume' + S).addEventListener('input', () => {
        const m = ctx.model(); if (!m) return;
        m.sfxVolume = Number($('sfxVolume' + S).value);
        $('vSfxVolume' + S).textContent = m.sfxVolume + ' dB';
        const a = libEntry(m.id);
        if (a) a.sfxVolume = m.sfxVolume;
        ctx.changed(m);
        renderTimeline(ctx);
        triggerLiveSync(m, S);
    });
    $('textTrack' + S).addEventListener('change', () => { const m = ctx.model(); if (m) { m.textTrack = Number($('textTrack' + S).value); ctx.changed(m); } });
    $('sfxTrack' + S).addEventListener('change', () => { const m = ctx.model(); if (m) { m.sfxTrack = Number($('sfxTrack' + S).value); ctx.changed(m); } });
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
    syncPlayUI();
    $('prev' + S).addEventListener('click', () => {
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
    $('prevSfx' + S).addEventListener('click', () => {
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
    bindTextDesign(ctx);
}


// ---------------------------------------------------------------- rendering
function renderUseSummary() {
    const m = state.use;
    const el = $('adjustSummary');
    if (el) {
        if (!m) { el.textContent = ''; }
        else {
            const f = (n) => sg(n) + 'f';
            el.textContent = 'text ' + f(m.textOffset) + ' · sound ' + f(m.sfxOffset) + (m.linked !== false ? ' · linked' : '') + (m.dirty ? ' · edited' : '');
        }
    }
    renderTdSummary(CTX.U);
}

function renderCreateSummary() {
    const a = libEntry(state.createId);
    const el = $('adjustSummaryC');
    if (el) {
        if (!a) { el.textContent = ''; }
        else {
            const f = (n) => sg(n) + 'f';
            el.textContent = 'text ' + f(a.textOffset) + ' · sound ' + f(a.sfxOffset) + (a.linked !== false ? ' · linked' : '');
        }
    }
    renderTdSummary(CTX.C);
    renderConfigSummaryC();
}

function renderConfigSummaryC() {
    const a = libEntry(state.createId);
    const sumEl = $('configSummaryC');
    if (!sumEl) return;
    if (!a) { sumEl.textContent = ''; return; }
    const sName = a.file ? baseName(a.file) : '—';
    const aName = a.sfx ? baseName(a.sfx) : 'no audio';
    sumEl.textContent = sName + ' · ' + aName;
}

function renderConfigC() {
    const a = libEntry(state.createId);
    if (!a) return;

    // 1. .settings section
    const activeSetting = $('cfgSettingActiveFile');
    const origSetting = $('cfgSettingOrigFile');
    const statusSetting = $('cfgSettingStatus');

    if (activeSetting) activeSetting.textContent = a.file || '—';
    if (origSetting) origSetting.textContent = a.fileOrig || a.file || '—';
    if (statusSetting) {
        const isMod = a.adjusted || a.designDirty || (a.orig && (a.orig.file !== a.file || JSON.stringify(a.textDesign) !== JSON.stringify(a.orig.textDesign)));
        statusSetting.textContent = isMod ? 'Modified' : 'Original';
        statusSetting.className = 'cfg-status-pill ' + (isMod ? 'mod' : 'orig');
    }

    // 2. Audio section
    const activeAudio = $('cfgAudioActiveFile');
    const origAudio = $('cfgAudioOrigFile');
    const statusAudio = $('cfgAudioStatus');
    const playAudioBtn = $('cfgAudioPlay');
    const removeAudioBtn = $('cfgAudioRemove');
    const revertAudioBtn = $('cfgAudioRevert');

    const curAudio = a.sfx || null;
    const origAud = a.sfxOrig || null;

    if (activeAudio) activeAudio.textContent = curAudio || 'No sound';
    if (origAudio) origAudio.textContent = origAud || 'None';

    if (statusAudio) {
        if (!curAudio && !origAud) {
            statusAudio.textContent = 'None';
            statusAudio.className = 'cfg-status-pill none';
        } else if (curAudio && origAud && curAudio !== origAud) {
            statusAudio.textContent = 'Trimmed / Modified';
            statusAudio.className = 'cfg-status-pill mod';
        } else {
            statusAudio.textContent = 'Original';
            statusAudio.className = 'cfg-status-pill orig';
        }
    }

    if (playAudioBtn) {
        playAudioBtn.style.visibility = (curAudio || origAud) ? 'visible' : 'hidden';
    }
    if (removeAudioBtn) {
        removeAudioBtn.style.visibility = (curAudio || origAud) ? 'visible' : 'hidden';
    }
    if (revertAudioBtn) {
        revertAudioBtn.style.visibility = (curAudio && origAud && curAudio !== origAud) ? 'visible' : 'hidden';
    }

    renderConfigSummaryC();
}

function bindConfigC() {
    // 1. .settings operations
    const revertSettingBtn = $('cfgSettingRevert');
    if (revertSettingBtn) {
        revertSettingBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a) return;
            openConfirmPop(revertSettingBtn, {
                title: 'Revert .settings to original?',
                message: 'Reset "' + a.name + '" back to original baseline template? Current edits will be discarded.',
                confirmText: 'Revert to original',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.revertAnimation(a.id);
                    if (takeLib(res)) {
                        a.adjusted = false;
                        a.designDirty = false;
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Reverted "' + a.name + '" to original version', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const fromTlSettingBtn = $('cfgSettingFromTimeline');
    if (fromTlSettingBtn) {
        fromTlSettingBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a) return;
            openConfirmPop(fromTlSettingBtn, {
                title: 'Overwrite original from timeline?',
                message: 'Export selected Text+ clip on Resolve timeline and overwrite original .settings baseline for "' + a.name + '"?',
                confirmText: 'Overwrite original',
                danger: true,
                onConfirm: async () => {
                    setCreateStatus('Exporting clip from Resolve timeline…');
                    const res = await window.sa.overwriteSettingFromTimeline(a.id);
                    if (takeLib(res)) {
                        a.adjusted = false;
                        a.designDirty = false;
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Overwrote original .settings from timeline for "' + a.name + '"', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const fromCurSettingBtn = $('cfgSettingFromCurrent');
    if (fromCurSettingBtn) {
        fromCurSettingBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a) return;
            openConfirmPop(fromCurSettingBtn, {
                title: 'Save current settings as original?',
                message: 'Make current settings and design the permanent original baseline for "' + a.name + '"?',
                confirmText: 'Overwrite original',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.overwriteSettingFromCurrent(a.id);
                    if (takeLib(res)) {
                        a.adjusted = false;
                        a.designDirty = false;
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Overwrote original with current settings for "' + a.name + '"', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const settingDrop = $('cfgSettingDrop');
    const settingPick = $('cfgSettingPick');

    const handleSettingFile = (filePath) => {
        const a = libEntry(state.createId);
        if (!a || !filePath) return;
        const bName = baseName(filePath);
        openConfirmPop(settingDrop || settingPick, {
            title: 'Overwrite original .settings?',
            message: 'Overwrite original .settings baseline with "' + bName + '" for "' + a.name + '"?',
            confirmText: 'Overwrite original',
            danger: true,
            onConfirm: async () => {
                setCreateStatus('Updating .settings from file…');
                const res = await window.sa.overwriteSettingFromFile(a.id, filePath);
                if (takeLib(res)) {
                    a.adjusted = false;
                    a.designDirty = false;
                    renderCreate();
                    renderAnimations();
                    setCreateStatus('Overwrote original .settings with "' + bName + '"', 'ok');
                } else if (res && res.error) {
                    setCreateStatus(res.error, 'bad');
                }
            }
        });
    };

    if (settingDrop) dropZone(settingDrop, handleSettingFile);
    if (settingPick) {
        settingPick.addEventListener('click', async (e) => {
            e.stopPropagation();
            const p = await window.sa.pickFileOrFolder('setting');
            if (p) handleSettingFile(p);
        });
    }

    // 2. Audio operations
    const audioPlayBtn = $('cfgAudioPlay');
    if (audioPlayBtn) {
        audioPlayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            const p = a && currentSfxPath(a);
            if (p) play(p);
            else setCreateStatus('No audio attached', 'bad');
        });
    }

    const audioRemoveBtn = $('cfgAudioRemove');
    if (audioRemoveBtn) {
        audioRemoveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a || !a.sfx) return;
            openConfirmPop(audioRemoveBtn, {
                title: 'Detach audio effect?',
                message: 'Remove attached audio from preset "' + a.name + '"?',
                confirmText: 'Remove audio',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.setAnimationSfx(a.id, null);
                    if (takeLib(res)) {
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Removed audio from "' + a.name + '"', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const audioRevertBtn = $('cfgAudioRevert');
    if (audioRevertBtn) {
        audioRevertBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a || !a.sfxOrig) return;
            openConfirmPop(audioRevertBtn, {
                title: 'Revert audio to original sound?',
                message: 'Discard trimmed audio adjustments and revert to original sound "' + a.sfxOrig + '"?',
                confirmText: 'Revert audio',
                danger: false,
                onConfirm: async () => {
                    const res = await window.sa.revertAudio(a.id);
                    if (takeLib(res)) {
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Reverted audio to original sound for "' + a.name + '"', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const audioFromTlBtn = $('cfgAudioFromTimeline');
    if (audioFromTlBtn) {
        audioFromTlBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a) return;
            openConfirmPop(audioFromTlBtn, {
                title: 'Overwrite original audio from timeline?',
                message: 'Use the audio clip selected on Resolve timeline as the new original sound for "' + a.name + '"?',
                confirmText: 'Overwrite original',
                danger: true,
                onConfirm: async () => {
                    setCreateStatus('Reading selected audio from timeline…');
                    const res = await window.sa.overwriteAudioFromTimeline(a.id);
                    if (takeLib(res)) {
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Overwrote original audio from timeline for "' + a.name + '"', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const audioFromCurBtn = $('cfgAudioFromCurrent');
    if (audioFromCurBtn) {
        audioFromCurBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a || !a.sfx) return;
            openConfirmPop(audioFromCurBtn, {
                title: 'Save current audio as original?',
                message: 'Make current audio ("' + a.sfx + '") the permanent original sound for "' + a.name + '"?',
                confirmText: 'Overwrite original',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.overwriteAudioFromCurrent(a.id);
                    if (takeLib(res)) {
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Overwrote original audio with current audio for "' + a.name + '"', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const audioDrop = $('cfgAudioDrop');
    const audioPick = $('cfgAudioPick');
    const handleAudioFile = (filePath) => {
        const a = libEntry(state.createId);
        if (!a || !filePath) return;
        const bName = baseName(filePath);
        openConfirmPop(audioDrop || audioPick, {
            title: 'Overwrite original audio?',
            message: 'Overwrite original sound with "' + bName + '" for "' + a.name + '"?',
            confirmText: 'Overwrite original',
            danger: true,
            onConfirm: async () => {
                setCreateStatus('Updating audio from file…');
                const res = await window.sa.overwriteAudioFromFile(a.id, filePath);
                if (takeLib(res)) {
                    renderCreate();
                    renderAnimations();
                    setCreateStatus('Overwrote original audio with "' + bName + '"', 'ok');
                } else if (res && res.error) {
                    setCreateStatus(res.error, 'bad');
                }
            }
        });
    };

    if (audioDrop) dropZone(audioDrop, handleAudioFile);
    if (audioPick) {
        audioPick.addEventListener('click', async (e) => {
            e.stopPropagation();
            const p = await window.sa.pickFileOrFolder('sfx');
            if (p) handleAudioFile(p);
        });
    }

    // Dropdown from SFX Originals
    const audioOrigBtn = $('cfgAudioOrigBtn');
    const audioOrigDrop = $('cfgAudioOrigDropdown');
    if (audioOrigBtn && audioOrigDrop) {
        const closeOrigDropdown = () => { audioOrigDrop.classList.add('hidden'); };
        audioOrigBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = audioOrigDrop.classList.contains('hidden');
            if (!isHidden) { closeOrigDropdown(); return; }
            audioOrigDrop.innerHTML = '';
            const originals = (state.lib && state.lib.sfxOriginals) || [];
            if (!originals.length) {
                const empty = document.createElement('div');
                empty.className = 'hint';
                empty.style.padding = '6px 10px';
                empty.textContent = 'No stored original sounds. Add some in the SFX Originals accordion below!';
                audioOrigDrop.appendChild(empty);
            } else {
                for (const item of originals) {
                    const dItem = document.createElement('div');
                    dItem.className = 'sfx-orig-dropdown-item';

                    const pBtn = document.createElement('button');
                    pBtn.type = 'button';
                    pBtn.className = 'ghost sm-btn';
                    pBtn.textContent = '▶';
                    pBtn.title = 'Preview sound';
                    pBtn.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        play(item.path);
                    });

                    const label = document.createElement('span');
                    label.className = 'sfx-orig-dropdown-name grow';
                    label.textContent = item.file;
                    label.title = item.file;

                    const delOrigBtn = document.createElement('button');
                    delOrigBtn.type = 'button';
                    delOrigBtn.className = 'ghost sm-btn sfx-del-btn';
                    delOrigBtn.textContent = '🗑';
                    delOrigBtn.title = 'Delete original sound';
                    delOrigBtn.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        openConfirmPop(delOrigBtn, {
                            title: 'Delete original sound?',
                            message: 'Permanently delete "' + item.file + '" from originals library? Presets already using it will retain their audio.',
                            confirmText: 'Delete',
                            danger: true,
                            onConfirm: async () => {
                                const res = await window.sa.removeSfxOriginal(item.file);
                                if (takeLib(res)) {
                                    setCreateStatus('Deleted "' + item.file + '" from originals library.', 'ok');
                                }
                            }
                        });
                    });

                    dItem.appendChild(pBtn);
                    dItem.appendChild(label);
                    dItem.appendChild(delOrigBtn);
                    dItem.addEventListener('click', async (ev) => {
                        if (ev.target.closest('.sfx-del-btn') || ev.target.closest('button')) return;
                        closeOrigDropdown();
                        handleAudioFile(item.path);
                    });
                    audioOrigDrop.appendChild(dItem);
                }
            }
            audioOrigDrop.classList.remove('hidden');
        });
        document.addEventListener('click', (e) => {
            if (!audioOrigDrop.contains(e.target) && e.target !== audioOrigBtn) {
                closeOrigDropdown();
            }
        });
    }
}

function renderTdSummary(ctx) {
    const S = ctx.s;
    const el = $('tdSummary' + S);
    if (!el) return;
    const m = ctx.model();
    if (!m) { el.textContent = ''; return; }
    const td = editTD(m, S) || (libEntry(m.id) && libEntry(m.id).textDesign);
    if (!td) { el.textContent = ''; return; }
    const font = td.font || 'Poppins';
    const style = td.style === '' ? '' : (td.style || 'Bold');
    const size = (Number(td.size) || 0.12).toFixed(3);
    const who = (window.SABoxes && SABoxes.targetLabel) ? SABoxes.targetLabel(S) : '';
    el.textContent = (who ? who + ' · ' : '') + font + ' ' + style + ' · ' + size + (m.designDirty ? ' · edited' : '');
}

function soundOf(a) {
    return a.useSfx === false ? null : (a.sfxPath || (state.lib.defaultSfx && state.lib.defaultSfx.path));
}

// ---------------------------------------------------------------- tags (Finder-style: name + color)
const TAG_COLORS = ['#ff453a', '#ff9f0a', '#ffd60a', '#32d74b', '#0a84ff', '#bf5af2', '#8e8e93'];
const tagUI = { open: false, color: TAG_COLORS[4], filter: { use: [], lib: [] } };

function allTags() { return Array.isArray(state.lib.tags) ? state.lib.tags : []; }
function tagById(id) { return allTags().find(t => t.id === id) || null; }
function tagsOf(a) { return (Array.isArray(a.tags) ? a.tags : []).map(tagById).filter(Boolean); }

// A preset passes the filter when it has any of the picked tags (no picks = show everything).
function passesTagFilter(a, key) {
    const f = tagUI.filter[key];
    if (!f.length) return true;
    const mine = Array.isArray(a.tags) ? a.tags : [];
    return f.some(id => mine.includes(id));
}

function tagDotsEl(a) {
    const tags = tagsOf(a);
    if (!tags.length) return null;
    const w = document.createElement('span');
    w.className = 'tag-dots';
    w.title = tags.map(t => t.name).join(', ');
    for (const t of tags.slice(0, 5)) {
        const d = document.createElement('span');
        d.className = 'tag-dot'; d.style.background = t.color;
        w.appendChild(d);
    }
    return w;
}

function tagChip(t, on, onClick) {
    const b = document.createElement('button');
    b.className = 'tag-chip' + (on ? ' on' : '');
    b.style.setProperty('--chip', t.color);
    const d = document.createElement('span');
    d.className = 'tag-dot'; d.style.background = t.color;
    const n = document.createElement('span');
    n.textContent = t.name;
    b.append(d, n);
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
}

// The dropdown filter button above a list; clicking opens dropdown to toggle tags.
function renderTagFilter(key, boxId) {
    const box = $(boxId);
    if (!box) return;
    const tags = allTags();
    const f = tagUI.filter[key] = tagUI.filter[key].filter(id => tagById(id));
    box.textContent = '';
    if (!tags.length) return;

    const btn = document.createElement('button');
    btn.className = 'tag-filter-btn' + (f.length ? ' active' : '');

    // Label & count
    let label = 'Filter tags';
    if (f.length === 0) {
        label = 'All Tags';
    } else if (f.length === 1) {
        const t = tagById(f[0]);
        label = t ? t.name : '1 Tag';
    } else {
        label = f.length + ' Tags';
    }

    // Dot indicators inside dropdown button
    if (f.length > 0) {
        const dotsWrap = document.createElement('span');
        dotsWrap.className = 'tag-dots';
        for (const tid of f.slice(0, 4)) {
            const t = tagById(tid);
            if (t) {
                const d = document.createElement('span');
                d.className = 'tag-dot';
                d.style.background = t.color;
                dotsWrap.appendChild(d);
            }
        }
        btn.appendChild(dotsWrap);
    } else {
        const icon = document.createElement('span');
        icon.className = 'tag-filter-icon';
        icon.textContent = '🏷️';
        btn.appendChild(icon);
    }

    const txt = document.createElement('span');
    txt.className = 'tag-filter-label';
    txt.textContent = label;
    btn.appendChild(txt);

    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '▾';
    btn.appendChild(chev);

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPop(btn, 'pop-menu pop-tagfilter', (el) => {
            const head = document.createElement('div');
            head.className = 'pop-title';
            head.textContent = 'Filter by Tags';
            el.appendChild(head);

            // 'All' option
            const allItem = document.createElement('button');
            allItem.className = 'pop-item' + (f.length === 0 ? ' on' : '');
            const allCk = document.createElement('span');
            allCk.className = 'pop-check';
            allCk.textContent = '✓';
            const allLbl = document.createElement('span');
            allLbl.className = 'pop-label';
            allLbl.textContent = 'All (Show All)';
            allItem.append(allCk, allLbl);
            allItem.addEventListener('click', () => {
                tagUI.filter[key] = [];
                closePop();
                renderAll();
            });
            el.appendChild(allItem);

            const sep = document.createElement('div');
            sep.className = 'pop-sep';
            el.appendChild(sep);

            for (const t of tags) {
                const isSelected = f.includes(t.id);
                const it = document.createElement('button');
                it.className = 'pop-item' + (isSelected ? ' on' : '');
                const ck = document.createElement('span');
                ck.className = 'pop-check';
                ck.textContent = '✓';
                const d = document.createElement('span');
                d.className = 'tag-dot';
                d.style.background = t.color;
                const n = document.createElement('span');
                n.className = 'pop-label';
                n.textContent = t.name;
                const rm = document.createElement('span');
                rm.className = 'pop-rm'; rm.textContent = '×'; rm.title = 'Delete tag'; rm.setAttribute('role', 'button');
                rm.addEventListener('mousedown', (ev) => ev.stopPropagation());
                rm.addEventListener('click', (ev) => { ev.stopPropagation(); closePop(); deleteTagWithConfirm(t); });
                it.append(ck, d, n, rm);
                it.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const cur = tagUI.filter[key];
                    tagUI.filter[key] = cur.includes(t.id) ? cur.filter(x => x !== t.id) : cur.concat(t.id);
                    it.classList.toggle('on', tagUI.filter[key].includes(t.id));
                    allItem.classList.toggle('on', tagUI.filter[key].length === 0);
                    renderAll();
                });
                el.appendChild(it);
            }
        });
    });

    box.appendChild(btn);

    // If active filters, show an instant clear '×' chip
    if (f.length > 0) {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'ghost tag-filter-clear';
        clearBtn.textContent = 'Reset filter';
        clearBtn.addEventListener('click', () => {
            tagUI.filter[key] = [];
            renderAll();
        });
        box.appendChild(clearBtn);
    }
}

// In-panel confirmation dialog (resolves true when the confirm button is pressed).
function confirmDialog(opts) {
    return new Promise((resolve) => {
        const ov = document.createElement('div');
        ov.className = 'sa-dlg-ov';
        const box = document.createElement('div');
        box.className = 'sa-dlg';
        box.setAttribute('role', 'alertdialog');
        const h = document.createElement('div'); h.className = 'sa-dlg-title'; h.textContent = opts.title || 'Are you sure?';
        const m = document.createElement('div'); m.className = 'sa-dlg-msg'; m.textContent = opts.message || '';
        const row = document.createElement('div'); row.className = 'sa-dlg-btns';
        const no = document.createElement('button'); no.className = 'ghost'; no.textContent = opts.cancelLabel || 'Cancel';
        const yes = document.createElement('button'); yes.className = 'sa-dlg-danger'; yes.textContent = opts.confirmLabel || 'Delete';
        row.append(no, yes);
        box.append(h, m, row);
        ov.appendChild(box);
        const done = (v) => { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); done(false); }
            else if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); done(true); }
        };
        document.addEventListener('keydown', onKey, true);
        no.addEventListener('click', () => done(false));
        yes.addEventListener('click', () => done(true));
        ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(false); });
        document.body.appendChild(ov);
        no.focus();
    });
}

function tagUseCount(id) { return state.lib.animations.filter(a => (a.tags || []).includes(id)).length; }

// Asks first, then removes the tag from the list (and from every preset that has it).
async function deleteTagWithConfirm(t) {
    const n = tagUseCount(t.id);
    const ok = await confirmDialog({
        title: 'Delete tag "' + t.name + '"?',
        message: n ? ('It will be removed from ' + n + ' preset' + (n === 1 ? '' : 's') + '. The presets themselves are not deleted.')
            : 'No presets use this tag. This cannot be undone.',
        confirmLabel: 'Delete tag'
    });
    if (!ok) return false;
    tagUI.filter.use = tagUI.filter.use.filter(id => id !== t.id);
    tagUI.filter.lib = tagUI.filter.lib.filter(id => id !== t.id);
    await saveTagList(allTags().filter(y => y.id !== t.id));
    return true;
}

async function saveTagList(tags) {
    return takeLib(await window.sa.saveTags(tags));
}

function setTagsOpen(open) {
    tagUI.open = !!open;
    $('tagsBody').classList.toggle('hidden', !open);
    $('tagsWrap').classList.toggle('open', !!open);
    $('tagsToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    const chev = $('tagsToggle').querySelector('.chev');
    if (chev) chev.textContent = open ? '▾' : '▸';
}

// ---------------------------------------------------------------- small floating popovers (menus, new tag)
let popEl = null;
function closePop() {
    if (!popEl) return;
    popEl.remove();
    popEl = null;
    document.removeEventListener('mousedown', popOutside, true);
    document.removeEventListener('keydown', popKey, true);
    window.removeEventListener('resize', closePop);
}
function popOutside(e) { if (popEl && !popEl.contains(e.target) && !(popEl._anchor && popEl._anchor.contains(e.target))) closePop(); }
function popKey(e) { if (e.key === 'Escape') closePop(); }

// Opens a popover under `anchor`; build(el) fills it. Clicking the same anchor again closes it.
function openPop(anchor, cls, build) {
    const again = popEl && popEl._anchor === anchor && popEl._cls === cls;
    closePop();
    if (again) return null;
    const el = document.createElement('div');
    el.className = 'pop ' + cls;
    el._anchor = anchor; el._cls = cls;
    build(el);
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = Math.min(r.right - w, window.innerWidth - w - 8);
    if (left < 8) left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8 && r.top - h - 4 > 8) top = r.top - h - 4;
    el.style.left = left + window.scrollX + 'px';
    el.style.top = top + window.scrollY + 'px';
    popEl = el;
    document.addEventListener('mousedown', popOutside, true);
    document.addEventListener('keydown', popKey, true);
    window.addEventListener('resize', closePop);
    return el;
}

function openConfirmPop(anchor, opts) {
    const { title = 'Confirm', message = '', confirmText = 'Delete', danger = true, onConfirm } = opts || {};
    return openPop(anchor, 'pop-confirm', (el) => {
        const t = document.createElement('div');
        t.className = 'pop-confirm-title';
        t.textContent = title;
        el.appendChild(t);

        if (message) {
            const m = document.createElement('div');
            m.className = 'pop-confirm-msg';
            m.textContent = message;
            el.appendChild(m);
        }

        const actions = document.createElement('div');
        actions.className = 'pop-confirm-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'ghost sm-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closePop();
        });

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = (danger ? 'danger sm-btn' : 'ghost sm-btn');
        okBtn.textContent = confirmText;
        okBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            closePop();
            if (typeof onConfirm === 'function') await onConfirm();
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(okBtn);
        el.appendChild(actions);
    });
}

// "New tag" popover: pick a color, type a name. assignTo = preset id that gets the new tag right away.
function openNewTagPop(anchor, assignTo) {
    let color = tagUI.color;
    openPop(anchor, 'pop-newtag', (el) => {
        const title = document.createElement('div');
        title.className = 'pop-title'; title.textContent = 'New tag';
        const sw = document.createElement('div');
        sw.className = 'tag-swatches';
        const inp = document.createElement('input');
        inp.type = 'text'; inp.placeholder = 'Tag name'; inp.maxLength = 40; inp.autocomplete = 'off';
        const add = document.createElement('button');
        add.className = 'tag-add'; add.textContent = 'Add';
        const paint = () => {
            sw.textContent = '';
            for (const c of TAG_COLORS) {
                const s = document.createElement('button');
                s.className = 'tag-swatch' + (color === c ? ' on' : '');
                s.style.background = c; s.title = c;
                s.addEventListener('click', () => { color = c; paint(); inp.focus(); });
                sw.appendChild(s);
            }
            const custom = document.createElement('label');
            custom.className = 'tag-swatch custom' + (TAG_COLORS.includes(color) ? '' : ' on');
            custom.title = 'Custom color';
            const ci = document.createElement('input');
            ci.type = 'color'; ci.value = color;
            ci.addEventListener('change', () => { color = ci.value.toLowerCase(); paint(); });
            custom.appendChild(ci);
            sw.appendChild(custom);
            add.style.setProperty('--chip', color);
        };
        paint();
        const go = async () => {
            const name = inp.value.trim();
            if (!name) { inp.focus(); return; }
            if (allTags().some(t => t.name.toLowerCase() === name.toLowerCase())) {
                inp.setCustomValidity('A tag named "' + name + '" already exists.');
                inp.reportValidity();
                inp.addEventListener('input', () => inp.setCustomValidity(''), { once: true });
                return;
            }
            tagUI.color = color;
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            closePop();
            if (await saveTagList(allTags().concat({ id, name, color })) && assignTo) {
                const a = libEntry(assignTo);
                if (a) takeLib(await window.sa.updateAnimation(a.id, { tags: (a.tags || []).concat(id) }));
            }
        };
        add.addEventListener('click', go);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        const row = document.createElement('div');
        row.className = 'tag-new-row';
        row.append(inp, add);
        el.append(title, sw, row);
        setTimeout(() => inp.focus(), 0);
    });
}

async function toggleTagOn(id, tagId) {
    const a = libEntry(id);
    if (!a) return false;
    const mine = Array.isArray(a.tags) ? a.tags : [];
    const next = mine.includes(tagId) ? mine.filter(x => x !== tagId) : mine.concat(tagId);
    takeLib(await window.sa.updateAnimation(a.id, { tags: next }));
    return next.includes(tagId);
}

// The ⋯ menu on a library row: tick tags on/off, make a new tag, or delete the preset.
function openRowMenu(anchor, a) {
    openPop(anchor, 'pop-menu', (el) => {
        const head = document.createElement('div');
        head.className = 'pop-title'; head.textContent = 'Tags';
        el.appendChild(head);
        const mine = Array.isArray(a.tags) ? a.tags : [];
        if (!allTags().length) {
            const e = document.createElement('div');
            e.className = 'pop-empty'; e.textContent = 'No tags yet';
            el.appendChild(e);
        }
        for (const t of allTags()) {
            const it = document.createElement('button');
            it.className = 'pop-item' + (mine.includes(t.id) ? ' on' : '');
            const ck = document.createElement('span'); ck.className = 'pop-check'; ck.textContent = '✓';
            const d = document.createElement('span'); d.className = 'tag-dot'; d.style.background = t.color;
            const n = document.createElement('span'); n.className = 'pop-label'; n.textContent = t.name;
            it.append(ck, d, n);
            it.addEventListener('click', async () => { it.classList.toggle('on', await toggleTagOn(a.id, t.id)); });
            el.appendChild(it);
        }
        const nt = document.createElement('button');
        nt.className = 'pop-item';
        nt.innerHTML = '<span class="pop-check">+</span><span class="pop-label">New tag…</span>';
        nt.addEventListener('click', () => { closePop(); openNewTagPop(anchor, a.id); });
        el.appendChild(nt);
        const sep = document.createElement('div'); sep.className = 'pop-sep';
        el.appendChild(sep);
        const rev = document.createElement('button');
        rev.className = 'pop-item';
        rev.innerHTML = '<span class="pop-check">↺</span><span class="pop-label">Revert to original version</span>';
        rev.addEventListener('click', () => {
            closePop();
            openConfirmPop(anchor, {
                title: 'Revert to original version?',
                message: 'Restore "' + a.name + '" back to its original .settings file, text design, alignment, and sound? Any saved updates will be overwritten.',
                confirmText: 'Revert',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.revertAnimation(a.id);
                    if (takeLib(res)) {
                        setStatus('Reverted "' + a.name + '" to original version.', 'ok');
                    }
                }
            });
        });
        el.appendChild(rev);
        const del = document.createElement('button');
        del.className = 'pop-item danger';
        del.innerHTML = '<span class="pop-check">🗑</span><span class="pop-label">Delete preset</span>';
        del.addEventListener('click', async () => {
            closePop();
            if (!confirm('Delete "' + a.name + '" from your library?')) return;
            if (state.selectedId === a.id) state.selectedId = null;
            if (state.createId === a.id) state.createId = null;
            stopPreview();
            takeLib(await window.sa.removeAnimation(a.id));
        });
        el.appendChild(del);
    });
}

// Library tab: the Tags accordion (rename / recolor / delete; + makes a new one) and the editor's tag picker.
function renderTags() {
    const tags = allTags();
    const counts = {};
    for (const a of state.lib.animations) for (const id of (a.tags || [])) counts[id] = (counts[id] || 0) + 1;
    $('tagsSummary').textContent = tags.length ? String(tags.length) : 'none yet';
    const dots = $('tagsDots');
    dots.textContent = '';
    for (const t of tags.slice(0, 12)) {
        const d = document.createElement('span');
        d.className = 'tag-dot'; d.style.background = t.color; d.title = t.name;
        dots.appendChild(d);
    }

    const list = $('tagList');
    const editing = list.contains(document.activeElement);   // don't wipe a rename in progress
    if (!editing) list.textContent = '';
    if (!editing && !tags.length) {
        const e = document.createElement('div');
        e.className = 'empty-tags';
        e.textContent = 'No tags yet. Click + to make one.';
        list.appendChild(e);
    }
    for (const t of (editing ? [] : tags)) {
        const row = document.createElement('div');
        row.className = 'tag-row';
        row.dataset.tagId = t.id;

        // Drag handle & order buttons
        const handle = document.createElement('span');
        handle.className = 'tag-handle';
        handle.textContent = '⋮⋮';
        handle.title = 'Drag to reorder tag sequence';
        handle.draggable = true;

        handle.addEventListener('dragstart', (e) => {
            row.classList.add('dragging');
            e.dataTransfer.setData('text/plain', t.id);
            e.dataTransfer.effectAllowed = 'move';
        });
        handle.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            document.querySelectorAll('#tagList .tag-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
        });

        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = row.getBoundingClientRect();
            const relY = e.clientY - rect.top;
            if (relY < rect.height / 2) {
                row.classList.add('drag-over-top');
                row.classList.remove('drag-over-bottom');
            } else {
                row.classList.add('drag-over-bottom');
                row.classList.remove('drag-over-top');
            }
        });
        row.addEventListener('dragleave', () => {
            row.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('drag-over-top', 'drag-over-bottom');
            const draggedId = e.dataTransfer.getData('text/plain');
            if (!draggedId || draggedId === t.id) return;
            const current = allTags().slice();
            const fromIdx = current.findIndex(x => x.id === draggedId);
            const toIdx = current.findIndex(x => x.id === t.id);
            if (fromIdx < 0 || toIdx < 0) return;
            const rect = row.getBoundingClientRect();
            const relY = e.clientY - rect.top;
            const [item] = current.splice(fromIdx, 1);
            let targetIdx = current.findIndex(x => x.id === t.id);
            if (relY >= rect.height / 2) targetIdx++;
            current.splice(targetIdx, 0, item);
            saveTagList(current);
        });

        // Quick up / down arrows for accessible reordering
        const orderWrap = document.createElement('span');
        orderWrap.className = 'tag-order-btns';
        const upBtn = document.createElement('button');
        upBtn.className = 'ghost tag-arrow';
        upBtn.textContent = '▲';
        upBtn.title = 'Move up';
        upBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const current = allTags().slice();
            const idx = current.findIndex(x => x.id === t.id);
            if (idx > 0) {
                const temp = current[idx - 1];
                current[idx - 1] = current[idx];
                current[idx] = temp;
                saveTagList(current);
            }
        });
        const dnBtn = document.createElement('button');
        dnBtn.className = 'ghost tag-arrow';
        dnBtn.textContent = '▼';
        dnBtn.title = 'Move down';
        dnBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const current = allTags().slice();
            const idx = current.findIndex(x => x.id === t.id);
            if (idx >= 0 && idx < current.length - 1) {
                const temp = current[idx + 1];
                current[idx + 1] = current[idx];
                current[idx] = temp;
                saveTagList(current);
            }
        });
        orderWrap.append(upBtn, dnBtn);

        const col = document.createElement('label');
        col.className = 'tag-color'; col.style.background = t.color; col.title = 'Change color';
        const ci = document.createElement('input');
        ci.type = 'color'; ci.value = t.color;
        ci.addEventListener('input', () => { col.style.background = ci.value; });
        ci.addEventListener('change', () => saveTagList(allTags().map(x => x.id === t.id ? Object.assign({}, x, { color: ci.value }) : x)));
        col.appendChild(ci);
        const nm = document.createElement('input');
        nm.type = 'text'; nm.className = 'tag-name'; nm.value = t.name; nm.maxLength = 40; nm.title = 'Rename';
        nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') nm.blur(); if (e.key === 'Escape') { nm.value = t.name; nm.blur(); } });
        nm.addEventListener('change', () => {
            const v = nm.value.trim();
            if (!v) { nm.value = t.name; return; }
            if (v !== t.name) saveTagList(allTags().map(x => x.id === t.id ? Object.assign({}, x, { name: v }) : x));
        });
        const cnt = document.createElement('span');
        cnt.className = 'tag-count'; cnt.textContent = counts[t.id] || ''; cnt.title = (counts[t.id] || 0) + ' preset(s)';
        const x = document.createElement('button');
        x.className = 'ghost'; x.textContent = '×'; x.title = 'Delete tag';
        x.addEventListener('click', () => { deleteTagWithConfirm(t); });
        row.append(handle, orderWrap, col, nm, cnt, x);
        list.appendChild(row);
    }

    // the open preset's tags, with a + to make a new one on the spot
    const pick = $('animTags');
    const a = libEntry(state.createId);
    if (pick && a) {
        pick.textContent = '';
        const mine = Array.isArray(a.tags) ? a.tags : [];
        for (const t of tags) {
            pick.appendChild(tagChip(t, mine.includes(t.id), () => toggleTagOn(a.id, t.id)));
        }
        const plus = document.createElement('button');
        plus.className = 'tag-chip tag-chip-plus';
        plus.textContent = '+';
        plus.title = 'New tag';
        plus.addEventListener('click', (e) => { e.stopPropagation(); openNewTagPop(plus, a.id); });
        pick.appendChild(plus);
    }
}

// Library: drag a preset by its handle to a new place in the list; the order is saved and used everywhere.
function startLibDrag(e, rowEl, a, list) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const scroller = (() => {
        for (let el = list.parentElement; el; el = el.parentElement) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
        }
        return document.scrollingElement;
    })();
    const startY = e.clientY, startScroll = scroller.scrollTop;
    let lastY = startY, target = null, timer = 0;
    const rows = () => Array.from(list.querySelectorAll(':scope > .libitem')).filter(r => r !== rowEl);
    const line = document.createElement('div');
    line.className = 'lib-drop-line';
    rowEl.classList.add('dragging');
    document.body.classList.add('lib-dragging');
    const update = () => {
        rowEl.style.transform = 'translateY(' + (lastY - startY + scroller.scrollTop - startScroll) + 'px)';
        const others = rows();
        target = null;
        for (const r of others) {
            const b = r.getBoundingClientRect();
            if (lastY < b.top + b.height / 2) { target = r; break; }
        }
        if (target) target.before(line);
        else if (others.length) others[others.length - 1].after(line);
    };
    const tick = () => {
        const sb = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
        let d = 0;
        if (lastY < sb.top + 36) d = -10; else if (lastY > sb.bottom - 36) d = 10;
        if (d) { scroller.scrollTop += d; update(); }
    };
    const move = (ev) => { lastY = ev.clientY; update(); };
    const up = async () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        clearInterval(timer);
        const ids = rows().map(r => r.dataset.id);
        const at = target ? ids.indexOf(target.dataset.id) : ids.length;
        ids.splice(at < 0 ? ids.length : at, 0, a.id);
        line.remove();
        rowEl.classList.remove('dragging');
        rowEl.style.transform = '';
        document.body.classList.remove('lib-dragging');
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener('click', swallow, true);
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);
        // The shown rows (maybe filtered by tag) take the slots those presets already had in the full list.
        const full = state.lib.animations.map(x => x.id);
        const shownSet = new Set(Array.from(list.querySelectorAll(':scope > .libitem')).map(r => r.dataset.id));
        const queue = ids.slice();
        const next = full.map(id => shownSet.has(id) ? queue.shift() : id);
        if (next.join('|') === full.join('|')) return;
        const byId = new Map(state.lib.animations.map(x => [x.id, x]));
        state.lib.animations = next.map(id => byId.get(id)).filter(Boolean);
        renderAll();
        takeLib(await window.sa.reorderAnimations(next));
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
    timer = setInterval(tick, 30);
    update();
}

// Use tab: the text + sound effects that are already made. Click one to pick it.
function renderAnimations() {
    const grid = $('animGrid');
    grid.textContent = '';
    const n = state.lib.animations.length;
    $('libCount').textContent = n ? n + ' saved' : '';
    if (window.SAThumbs) SAThumbs.syncHeader();
    renderTagFilter('use', 'useFilter');
    if (!n) {
        const d = document.createElement('div');
        d.className = 'empty';
        d.textContent = 'Nothing here yet. Open the Create tab to make your first text + sound effect.';
        grid.appendChild(d);
    }
    const shown = state.lib.animations.filter(a => passesTagFilter(a, 'use'));
    if (n && !shown.length) {
        const d = document.createElement('div');
        d.className = 'empty';
        d.textContent = 'No presets have the selected tags.';
        grid.appendChild(d);
    }
    if (n && shown.length !== n) $('libCount').textContent = shown.length + ' of ' + n;
    for (const a of shown) {
        const c = document.createElement('div');
        c.className = 'card' + (a.id === state.selectedId ? ' sel' : '') + (a.missing ? ' missing' : '');
        const nm = document.createElement('div');
        nm.className = 'nm'; nm.textContent = a.name;
        const sub = document.createElement('div');
        sub.className = 'sub';
        const hasSound = a.useSfx !== false && (a.sfx || state.lib.defaultSfx);
        sub.textContent = hasSound ? '\u266a' : '';
        sub.title = a.useSfx === false ? 'No sound' : (a.sfx ? a.sfx : (state.lib.defaultSfx ? 'Default sound' : 'No sound set'));
        if (window.SAThumbs) c.appendChild(SAThumbs.thumb(a));
        c.append(nm, sub);
        const dots = tagDotsEl(a);
        if (dots) c.appendChild(dots);
        c.addEventListener('click', () => {
            stopPreview();
            state.selectedId = a.id;
            syncUse(true);
            renderAll();
            refreshLiveBar();
            if (state.liveUI && !state.livePrev && !state.busy) startLivePreview();      // bar is on: a clicked preset is previewed
        });
        grid.appendChild(c);
    }
}

function setCreateStatus(msg, kind) {
    const el = $('createStatus');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
}

// Create tab: the builder, the default sound, the saved list, and the default settings of the clicked item.
function renderCreate() {
    const d = state.draft;
    const pk = $('animPicked');
    pk.classList.toggle('hidden', !(d.animPath || d.fromSelection));
    pk.textContent = d.fromSelection ? '✓ Text+ selected on the timeline (read when you save)' : (d.animPath ? '✓ ' + baseName(d.animPath) : '');
    $('animDrop').classList.toggle('chosen', !!d.animPath);
    $('useSelected').classList.toggle('chosen', !!d.fromSelection);
    $('newSfx').classList.toggle('chosen', !!d.sfxPath);
    if ($('crNum2')) $('crNum2').classList.toggle('done', !!(d.animPath || d.fromSelection));
    if ($('crNum3')) $('crNum3').classList.toggle('done', !!d.sfxPath);
    $('saveCombo').disabled = !(d.animPath || d.fromSelection);
    $('saveCombo').title = $('saveCombo').disabled ? 'Pick a text animation first' : '';
    $('newSfxName').textContent = d.sfxPath ? baseName(d.sfxPath) : 'Drop a sound file here';
    $('newSfxPlay').style.visibility = d.sfxPath ? 'visible' : 'hidden';
    $('newSfxClear').style.visibility = d.sfxPath ? 'visible' : 'hidden';

    if (state.createId && !libEntry(state.createId)) state.createId = null;

    const list = $('libList');
    const ed = $('editor');
    renderTagFilter('lib', 'libFilter');
    const libShown = state.lib.animations.filter(a => passesTagFilter(a, 'lib'));
    const openId = libShown.some(a => a.id === state.createId) ? state.createId : null;
    // Rebuild the rows around the settings panel without moving it when it is already in place
    // (moving it would drop focus from whatever you are typing in it).
    for (const ch of Array.from(list.children)) if (ch !== ed) ch.remove();
    if (openId) { if (ed.parentNode !== list) list.appendChild(ed); }
    else if (ed.parentNode !== $('editorPark')) $('editorPark').appendChild(ed);
    const put = (el, beforeEditor) => { if (beforeEditor && ed.parentNode === list) list.insertBefore(el, ed); else list.appendChild(el); };
    if (!state.lib.animations.length) {
        const e = document.createElement('div'); e.className = 'hint'; e.textContent = 'Nothing saved yet.'; put(e, true);
    }
    if (state.lib.animations.length && !libShown.length) {
        const e = document.createElement('div'); e.className = 'hint'; e.textContent = 'No presets have the selected tags.'; put(e, true);
    }
    let beforeEditor = !!openId;
    for (const a of libShown) {
        const row = document.createElement('div');
        row.className = 'libitem' + (a.id === state.createId ? ' sel' : '');
        row.dataset.id = a.id;
        const t = document.createElement('div'); t.className = 't';
        const b = document.createElement('b'); b.textContent = a.name;
        const s = document.createElement('span');
        s.textContent = a.sfx ? '♪ ' + a.sfx : (state.lib.defaultSfx ? '♪ default sound' : 'no sound');
        t.append(b, s);
        const grip = document.createElement('span');
        grip.className = 'lib-grip'; grip.textContent = '⋮⋮'; grip.title = 'Drag to change the order';
        grip.addEventListener('mousedown', (e) => startLibDrag(e, row, a, list));
        grip.addEventListener('click', (e) => e.stopPropagation());
        row.appendChild(grip);
        const dots = tagDotsEl(a);
        if (dots) row.appendChild(dots);
        const more = document.createElement('button'); more.className = 'ghost more'; more.textContent = '⋯'; more.title = 'Tags and more';
        more.addEventListener('click', (e) => { e.stopPropagation(); openRowMenu(more, a); });
        row.append(t, more);
        row.addEventListener('click', () => {
            stopPreview();
            state.createAdjusted = false;
            a.adjusted = false;
            a.designDirty = false;
            state.createId = state.createId === a.id ? null : a.id;
            renderCreate();
            if (state.createId) {
                // bring the opened preset to the top so its settings are right there below it
                requestAnimationFrame(() => {
                    const r = list.querySelector('.libitem.sel');
                    if (r) r.scrollIntoView({ block: 'start', behavior: 'smooth' });
                });
            }
        });
        dropZone(row, async (p) => { if (takeLib(await window.sa.setAnimationSfx(a.id, p))) setCreateStatus('Sound changed for "' + a.name + '"', 'ok'); });
        put(row, beforeEditor);
        if (a.id === openId) beforeEditor = false;
    }

    const a = openId ? libEntry(openId) : null;
    $('editor').classList.toggle('hidden', !a);
    if (a) {
        if ($('editTitle')) $('editTitle').textContent = a.name;
        if (document.activeElement !== $('animName')) $('animName').value = a.name;
        fillAdjust(CTX.C);
        if (window.SABoxes) SABoxes.render('C');
        if (!state.preview) drawStage('C', a, null);
        setCreateAdjustOpen(state.createAdjustOpen !== false);
        setCreateTdOpen(!!state.createTdOpen);
        setCreateConfigOpen(!!state.createConfigOpen);
        renderConfigC();
        renderCreateSummary();
        renderTags();
    }
}

// Use tab: the picked item, its preview and the collapsible alignment.
function renderSettings() {
    const a = selected();
    $('settings').classList.toggle('hidden', !a);
    if (!a) return;
    syncUse(false);
    $('useTitle').textContent = a.name;
    fillAdjust(CTX.U);
    if (window.SABoxes) SABoxes.render('U');
    if (!state.preview) drawStage('U', a, null);
    setAdjustOpen(state.adjustOpen);
    setTdOpen(state.tdOpen);
    renderUseSummary();
}

function setAdjustOpen(wanted) {
    state.adjustOpen = wanted;
    const open = !!wanted && !state.livePrev;
    if ($('adjustBodyU')) $('adjustBodyU').classList.toggle('hidden', !open);
    if ($('adjustWrapU')) $('adjustWrapU').classList.toggle('open', !!open);
    if ($('adjustToggle')) {
        $('adjustToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = $('adjustToggle').querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
    }
    if (open) renderTimeline(CTX.U);
}

function setTdOpen(open) {
    state.tdOpen = open;
    if ($('tdBodyU')) $('tdBodyU').classList.toggle('hidden', !open);
    if ($('tdWrapU')) $('tdWrapU').classList.toggle('open', !!open);
    if ($('tdToggleU')) {
        $('tdToggleU').setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = $('tdToggleU').querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
    }
    redrawStages();
}

function setCreateAdjustOpen(open) {
    state.createAdjustOpen = open;
    if ($('adjustBodyC')) $('adjustBodyC').classList.toggle('hidden', !open);
    if ($('adjustWrapC')) $('adjustWrapC').classList.toggle('open', !!open);
    if ($('adjustToggleC')) {
        $('adjustToggleC').setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = $('adjustToggleC').querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
    }
    if (open) renderTimeline(CTX.C);
}

function setCreateTdOpen(open) {
    state.createTdOpen = open;
    if ($('tdBodyC')) $('tdBodyC').classList.toggle('hidden', !open);
    if ($('tdWrapC')) $('tdWrapC').classList.toggle('open', !!open);
    if ($('tdToggleC')) {
        $('tdToggleC').setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = $('tdToggleC').querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
    }
    redrawStages();
}

function setCreateConfigOpen(open) {
    state.createConfigOpen = open;
    if ($('configBodyC')) $('configBodyC').classList.toggle('hidden', !open);
    if ($('configWrapC')) $('configWrapC').classList.toggle('open', !!open);
    if ($('configToggleC')) {
        $('configToggleC').setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = $('configToggleC').querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
    }
    if (open) renderConfigC();
}

function setSfxOrigAccordionOpen(open) {
    state.sfxOrigOpen = open;
    const body = $('sfxOrigAccordionBody');
    const wrap = $('sfxOrigAccordionWrap');
    const toggle = $('sfxOrigAccordionToggle');
    if (body) body.classList.toggle('hidden', !open);
    if (wrap) wrap.classList.toggle('open', !!open);
    if (toggle) {
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = toggle.querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
    }
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(i ? 1 : 0) + ' ' + sizes[i];
}

async function attachOriginalSfx(item) {
    if (!item || !item.path) return;
    if (state.tab === 'create' && state.createId) {
        const ca = libEntry(state.createId);
        if (ca) {
            const res = await window.sa.setAnimationSfx(ca.id, item.path);
            if (takeLib(res)) {
                const updated = libEntry(ca.id);
                if (updated) {
                    updated.adjusted = true;
                    await syncAttachedSfx(updated);
                }
                fillAdjust(CTX.C);
                renderAnimations();
                renderCreateSummary();
                setStatus('Sound "' + item.file + '" attached to "' + ca.name + '".', 'ok');
            }
            return;
        }
    }
    if (state.use) {
        const m = state.use;
        m.sfxOrigPath = item.path;
        m.sfxOrig = item.file;
        m.sfxPath = item.path;
        m.sfx = item.file;
        m.dirty = true;
        m.adjusted = true;
        m.useSfx = true;
        if ($('useSfxU')) $('useSfxU').checked = true;
        await syncAttachedSfx(m);
        fillAdjust(CTX.U);
        renderUseSummary();
        renderAnimations();
        syncVarButtons('U', m);
        setStatus('Sound "' + item.file + '" attached to active preset.', 'ok');
    } else if (state.selectedId) {
        const a = libEntry(state.selectedId);
        if (a) {
            const res = await window.sa.setAnimationSfx(a.id, item.path);
            if (takeLib(res)) {
                syncUse(true);
                fillAdjust(CTX.U);
                renderAnimations();
                renderUseSummary();
                setStatus('Sound "' + item.file + '" attached to "' + a.name + '".', 'ok');
            }
        }
    }
}

function renderSfxOriginals() {
    const listEl = $('sfxOrigList');
    const countEl = $('sfxOrigCount');
    const originals = (state.lib && state.lib.sfxOriginals) || [];
    if (countEl) countEl.textContent = originals.length ? '(' + originals.length + ')' : '(0)';
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!originals.length) {
        const empty = document.createElement('div');
        empty.className = 'hint';
        empty.style.padding = '8px 12px';
        empty.textContent = 'No stored original sounds yet. Drop sounds above or browse to store them.';
        listEl.appendChild(empty);
        return;
    }
    const currentOrig = (state.use && (state.use.sfxOrig || state.use.sfx)) ||
        (selected() && (selected().sfxOrig || selected().sfx));
    for (const item of originals) {
        const row = document.createElement('div');
        row.className = 'sfx-orig-item' + (currentOrig === item.file ? ' attached' : '');

        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'ghost sm-btn';
        playBtn.title = 'Preview sound';
        playBtn.textContent = '▶';
        playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            play(item.path);
        });

        const info = document.createElement('div');
        info.className = 'sfx-orig-info grow';
        const name = document.createElement('div');
        name.className = 'sfx-orig-name';
        name.textContent = item.file;
        name.title = item.file;
        const meta = document.createElement('div');
        meta.className = 'hint sm';
        meta.textContent = (item.ext ? item.ext + ' · ' : '') + formatBytes(item.size);
        info.appendChild(name);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'sfx-orig-actions';

        const attachBtn = document.createElement('button');
        attachBtn.type = 'button';
        attachBtn.className = 'ghost sm-btn';
        attachBtn.title = 'Attach this sound to active preset';
        attachBtn.textContent = currentOrig === item.file ? 'Attached' : 'Attach';
        attachBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            attachOriginalSfx(item);
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'ghost sm-btn sfx-orig-del';
        delBtn.title = 'Delete original sound';
        delBtn.textContent = '🗑';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openConfirmPop(delBtn, {
                title: 'Delete original sound?',
                message: 'Permanently delete "' + item.file + '" from your originals library? Presets already using it will retain their audio.',
                confirmText: 'Delete',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.removeSfxOriginal(item.file);
                    if (takeLib(res)) {
                        setStatus('Deleted "' + item.file + '" from originals library.', 'ok');
                    }
                }
            });
        });

        actions.appendChild(attachBtn);
        actions.appendChild(delBtn);

        row.appendChild(playBtn);
        row.appendChild(info);
        row.appendChild(actions);
        listEl.appendChild(row);
    }
}

function renderDefaultSfx() {
    const d = state.lib.defaultSfx;
    $('defName').textContent = d ? d.file : 'Drop a sound file here';
    $('defPlay').disabled = !d;
    $('defClear').style.visibility = d ? 'visible' : 'hidden';
    $('defPlay').style.visibility = d ? 'visible' : 'hidden';
    $('defSfx').classList.toggle('chosen', !!d);
}

function renderPin() {
    const on = state.lib.alwaysOnTop !== false;
    const btn = $('pin');
    if (!btn) return;
    btn.classList.toggle('on', on);
    btn.title = on
        ? 'Pinned above DaVinci Resolve (click to unpin)'
        : 'Pin panel above DaVinci Resolve';
}

function renderLive() {
    const L = state.live;
    const conn = $('conn');
    if (!L || !L.ok) {
        conn.textContent = L && L.reason ? L.reason : 'Not connected';
        conn.className = 'pill off';
        $('subMeta').textContent = '–';
        $('create').disabled = true;
        return;
    }
    conn.textContent = L.timeline;
    conn.className = 'pill on';
    const s = L.subtitle;
    const key = s ? s.start + ':' + s.end + ':' + s.text : 'none:' + L.timeline;
    const changed = key !== state.shownKey;
    if (changed) {                           // the subtitle changed: show the new text
        state.shownKey = key;
        $('subText').value = s ? s.text : '';
        redrawStages();
    }
    $('subMeta').textContent = s
        ? '#' + s.index + ' of ' + L.count + ' · ' + (L.source === 'selection' ? 'selected' : 'at playhead')
        : (L.count ? 'no subtitle at the playhead' : 'this timeline has no subtitles');
    $('subHint').textContent = s ? '' : 'You can still type text here and it will be placed at the playhead for 3 seconds.';
    $('create').disabled = state.busy || !selected();
    if (changed || state.lastFrame !== L.frame) {
        state.lastFrame = L.frame;
        if (!state.drag && !state.preview) renderTimelines();
        refreshLiveBg();
    } else if (!state.liveBg.img) {
        refreshLiveBg();
    }
}

function renderAll() {
    renderAnimations();
    renderSettings();
    renderDefaultSfx();
    renderSfxOriginals();
    renderCreate();
    renderTags();
    renderPin();
    renderLive();
}

// ---------------------------------------------------------------- minimized: real-time rendering paused
// The main process reports when the window is minimized or hidden. Polling Resolve, rendering previews and the Resolve
// preview's follow-the-playhead all stop; when the window is back everything is refreshed once.
state.idle = false;
function parkAfterPlace() { try { if (window.sa && window.sa.parkUntilFocus) window.sa.parkUntilFocus(); } catch (e) { /* ignore */ } }
if (window.sa && window.sa.onWinIdle) window.sa.onWinIdle((idle, why) => {
    state.idle = !!idle;
    if (idle) { setStatus(why === 'parked' ? 'Done: real-time rendering is paused until you come back to this window.' : 'Minimized: real-time rendering is paused.', ''); return; }
    setStatus('Back: real-time rendering resumed.', 'ok');
    state.liveBg.key = '';
    try { redrawStages(); } catch (e) { /* ignore */ }
    try { refreshLiveBg(); } catch (e) { /* ignore */ }
});

// A render that has not come back after a minute is given up, so the preview never stays stuck on "Updating…": the next
// change (or the retry below) renders again.
setInterval(() => {
    const u = state.use;
    if (!u || !u.rendering || !u.renderStart || Date.now() - u.renderStart < 60000) return;
    u.rendering = false; u.renderReq = null; u.renderStart = 0;
    setStatus('The preview took too long, trying again.', '');
    try { redrawStages(); } catch (e) { /* ignore */ }
}, 5000);

// ---------------------------------------------------------------- live subtitle
async function tick() {
    if (state.idle) { setTimeout(tick, 500); return; }          // minimized: no real-time polling of Resolve
    if (!state.busy && !state.drag) {
        try { state.live = await window.sa.poll(false); } catch (e) { state.live = { ok: false, reason: 'Not connected' }; }
        watchPlayback(state.live);
        renderLive();
    }
    setTimeout(tick, 200);
}

// ---------------------------------------------------------------- actions
// The sound that goes on the timeline: cut where the subtitle ends and faded out over its last second. Made here
// (the panel can decode any audio file), saved by the app as a WAV, and imported into Resolve in place of the original.
async function buildFadedSfx(m, span) {
    const p = origSfxPath(m) || currentSfxPath(m);
    if (!p || m.useSfx === false) return null;
    const rendered = await renderTrimmedWav(m, span);
    if (!rendered || !rendered.data) return null;
    if (m && m.id && !span) {
        const res = await window.sa.saveAttachedClip(m.id, rendered.data, baseName(p));
        return (res && (res.sfxPath || res.path)) || null;
    }
    const res = await window.sa.saveSfxClip(baseName(p), rendered.data);
    return (res && res.path) || null;
}

async function create() {
    if (state.livePrev) {       // a Preview in Resolve is running: this button does what the Apply button does
        if (state.livePrev.removed) previewAgain(); else endLivePreview(true);
        return;
    }
    const a = selected();
    const m = state.use;
    const L = state.live;
    if (!a || !m || !L || !L.ok) return;
    const text = $('subText').value;
    const s = L.subtitle;
    const start = s ? s.start : L.frame;
    const end = s ? s.end : L.frame + Math.round(L.fps * 3);
    state.busy = true;
    $('create').disabled = true;
    setStatus('Creating…');
    let sfxClip = null;
    try { sfxClip = await buildFadedSfx(m); } catch (e) { sfxClip = null; }      // falls back to the original sound
    const res = await window.sa.apply({
        animationId: a.id, text, start, end, sfxPath: sfxClip || undefined,
        textOffset: m.textOffset, sfxOffset: m.sfxOffset, sfxVolume: m.sfxVolume, tail: m.tail,
        textTrack: m.textTrack, sfxTrack: m.sfxTrack, useSfx: m.useSfx !== false, place: placeOptions(),
        linked: m.linked !== false,
        posX: Number(m.posX) || 0, posY: Number(m.posY) || 0,
        scale: Number(m.scale) || 1, rotation: Number(m.rotation) || 0,
        textDesign: m.textDesign || a.textDesign || null,
        boxList: window.SABoxes ? SABoxes.payload(m, a, text) : []
    });
    state.busy = false;
    if (res && res.ok) {
        const parts = ['Placed on V' + res.videoTrack, res.frames + ' frames'];
        if (res.audioTrack) parts.push('sound on A' + res.audioTrack + (res.linked ? ' (linked)' : ''));
        if (res.trackNotes && res.trackNotes.length) parts.push('(' + res.trackNotes.join(', ') + ')');
        if (window.SABoxes && res.liveNodes && res.liveNodes.length) parts.push(SABoxes.liveSummary(res.liveNodes));
        state.liveBg.key = '';
        refreshLiveBg();
        setStatus(parts.join(' · ') + (res.warnings.length ? ' · ' + res.warnings.join(' ') : ''), res.warnings.length ? '' : 'ok');
        // a preview may have been captured while placing it
        try { const r = await window.sa.getLib(); if (r && r.lib) { state.lib = r.lib; syncUse(false); renderAll(); } } catch (e) { /* ignore */ }
        parkAfterPlace();
    } else {
        setStatus((res && res.error) || 'Something went wrong', 'bad');
    }
    renderLive();
}

async function initVersion() {
    const el = $('appVersion');
    if (!el) return;

    let currentVersion = '1.0.0';

    if (window.sa && window.sa.getVersion) {
        try {
            const res = await window.sa.getVersion();
            if (res && res.version) {
                currentVersion = res.version;
                el.textContent = currentVersion.startsWith('v') ? currentVersion : `v${currentVersion}`;
            }
        } catch (e) {
            console.warn('Could not load version:', e);
        }
    }

    el.addEventListener('click', () => {
        if (el.querySelector('input')) return;

        const currentText = el.textContent.trim().replace(/^v/i, '');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'version-input';
        input.value = currentText;
        input.title = 'Press Enter to save, Esc to cancel';

        let finished = false;
        const finish = async (save) => {
            if (finished) return;
            finished = true;
            const val = input.value.trim();
            if (save && val) {
                const cleaned = val.replace(/^v/i, '').trim();
                if (cleaned) {
                    if (window.sa && window.sa.setVersion) {
                        try {
                            const res = await window.sa.setVersion(cleaned);
                            if (res && res.version) {
                                currentVersion = res.version;
                            } else if (res && res.error) {
                                console.error('Failed to set version:', res.error);
                            } else {
                                currentVersion = cleaned;
                            }
                        } catch (e) {
                            console.error('Error calling setVersion:', e);
                            currentVersion = cleaned;
                        }
                    } else {
                        currentVersion = cleaned;
                    }
                }
            }
            el.textContent = currentVersion.startsWith('v') ? currentVersion : `v${currentVersion}`;
            el.classList.remove('editing');
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                input.value = currentText;
                input.blur();
            }
        });

        input.addEventListener('blur', () => finish(true));

        el.textContent = '';
        el.classList.add('editing');
        el.appendChild(input);
        input.focus();
        input.select();
    });
}

function initInspectorLayoutModes() {
    let savedMode = 'default';
    try {
        savedMode = localStorage.getItem('sa_inspector_layout_mode') || 'default';
    } catch (e) { }
    applyLayoutMode(savedMode, false);

    document.addEventListener('click', async (e) => {
        const modeBtn = e.target.closest('.layout-mode-btn');
        if (modeBtn) {
            e.preventDefault();
            e.stopPropagation();
            const mode = modeBtn.dataset.mode;
            if (mode) await applyLayoutMode(mode, true);
            return;
        }

        const expandBtn = e.target.closest('.collapse-expand-bar');
        if (expandBtn) {
            e.preventDefault();
            e.stopPropagation();
            await applyLayoutMode('default', true);
            return;
        }
    });
}

// On every launch: size the window to the width its content needs for the saved layout (collapse / default use the
// single-column panel, sidebar the two-column one), then widen it if anything still overflows sideways.
const PANEL_WIDTH = { collapse: 460, default: 460, sidebar: 1160 };
async function fitWindowToContent() {
    if (!window.sa || typeof window.sa.fitWidth !== 'function') return;
    const mode = state.inspectorLayoutMode || 'default';
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* ignore */ }
    try {
        await window.sa.fitWidth(PANEL_WIDTH[mode] || 460, mode);
        await wait(180);
        const de = document.documentElement;
        const overflow = Math.ceil(de.scrollWidth - de.clientWidth);
        if (overflow > 1) await window.sa.fitWidth(window.innerWidth + overflow, mode);
    } catch (e) { console.warn('Could not fit the window width:', e); }
    renderTimelines();
    redrawStages();
}

async function applyLayoutMode(mode, triggerResize) {
    state.inspectorLayoutMode = mode;
    try { localStorage.setItem('sa_inspector_layout_mode', mode); } catch (e) { }

    // Update buttons in both tabs
    document.querySelectorAll('.layout-mode-btn').forEach(b => {
        b.classList.toggle('on', b.dataset.mode === mode);
    });

    // Update inspector grids
    ['U', 'C'].forEach(S => {
        const grid = $('inspectorGrid' + S);
        if (grid) {
            grid.classList.remove('layout-collapse', 'layout-default', 'layout-sidebar');
            grid.classList.add('layout-' + mode);
        }
    });

    // Update body classes for viewport styling
    document.body.classList.toggle('inspector-sidebar', mode === 'sidebar');
    document.body.classList.toggle('inspector-collapse', mode === 'collapse');

    // Expand or restore electron window viewport
    if (triggerResize && window.sa && typeof window.sa.setLayoutMode === 'function') {
        try {
            await window.sa.setLayoutMode(mode);
        } catch (err) {
            console.warn('Failed to resize window for layout mode:', err);
        }
    }

    setTimeout(() => {
        renderTimelines();
        redrawStages();
    }, 120);
}

async function initApp() {
    try {
        // Stop the window from opening a file that misses a drop zone.
    for (const ev of ['dragover', 'drop']) window.addEventListener(ev, (e) => e.preventDefault());
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('resize', () => {
        renderTimelines();
        redrawStages();
    });

    mountBlocks();
    initVersion();
    initInspectorLayoutModes();
    bindAdjust(CTX.U);
    bindAdjust(CTX.C);

    takeLib(await window.sa.getLib());
    if (state.lib.animations.length) { state.selectedId = state.lib.animations[0].id; syncUse(true); }
    renderAll();
    fitWindowToContent();

    $('adjustToggle').addEventListener('click', () => { if (state.livePrev) return; stopPreview(); setAdjustOpen(!state.adjustOpen); });
    if ($('tdToggleU')) $('tdToggleU').addEventListener('click', () => { stopPreview(); setTdOpen(!state.tdOpen); });
    if ($('adjustToggleC')) $('adjustToggleC').addEventListener('click', () => { stopPreview(); setCreateAdjustOpen(!state.createAdjustOpen); });
    if ($('tdToggleC')) $('tdToggleC').addEventListener('click', () => { stopPreview(); setCreateTdOpen(!state.createTdOpen); });
    if ($('configToggleC')) $('configToggleC').addEventListener('click', () => { stopPreview(); setCreateConfigOpen(!state.createConfigOpen); });
    if ($('sfxOrigAccordionToggle')) $('sfxOrigAccordionToggle').addEventListener('click', () => {
        setSfxOrigAccordionOpen(!state.sfxOrigOpen);
    });
    $('subText').addEventListener('input', () => redrawStages());
    $('resetU').addEventListener('click', () => {
        syncUse(true);
        if (state.use) {
            state.use.dirty = false;
            state.use.adjusted = false;
            state.use.designDirty = false;
        }
        fillAdjust(CTX.U);
        renderUseSummary();
        renderTimelines();
        redrawStages();
    });
    $('animName').addEventListener('input', () => {
        const a = libEntry(state.createId); if (!a) return;
        const name = $('animName').value.trim();
        if (!name) return;
        a.name = name;
        saveField(a.id, { name });
        if ($('editTitle')) $('editTitle').textContent = name;
        renderAnimations(); renderTimeline(CTX.C);
        const b = document.querySelector('#libList .libitem.sel b'); if (b) b.textContent = name;
    });
    $('prevCapC').addEventListener('click', async () => {
        if (!state.createId) return;
        setCreateStatus('Taking preview frames…');
        const res = await window.sa.capturePreview(state.createId);
        if (takeLib(res)) setCreateStatus('Preview updated.', 'ok'); else if (res && res.error) setCreateStatus(res.error, 'bad');
    });

    $('tabBtnApply').addEventListener('click', () => setTab('apply'));
    $('tabBtnLibrary').addEventListener('click', () => setTab('library'));
    $('tabBtnCreate').addEventListener('click', () => setTab('create'));

    $('defPlay').addEventListener('click', () => play(state.lib.defaultSfx && state.lib.defaultSfx.path));
    $('defClear').addEventListener('click', async () => takeLib(await window.sa.setDefaultSfx(null)));
    dropZone($('defSfx'), async (p) => { if (takeLib(await window.sa.setDefaultSfx(p))) setCreateStatus('Default sound set', 'ok'); });

    if ($('sfxOrigDrop')) {
        dropZone($('sfxOrigDrop'), async (p) => {
            const res = await window.sa.addSfxOriginal(p);
            if (takeLib(res)) {
                setStatus('Added "' + baseName(p) + '" to originals library.', 'ok');
            }
        });
    }
    const sfxOrigPick = $('sfxOrigPick');
    const sfxOrigFileIn = $('sfxOrigFileInput');
    if (sfxOrigPick && sfxOrigFileIn) {
        sfxOrigPick.addEventListener('click', (e) => {
            e.stopPropagation();
            sfxOrigFileIn.click();
        });
        sfxOrigFileIn.addEventListener('change', async () => {
            if (sfxOrigFileIn.files && sfxOrigFileIn.files.length) {
                for (const f of sfxOrigFileIn.files) {
                    const p = window.sa.pathForFile(f);
                    if (p) {
                        const res = await window.sa.addSfxOriginal(p);
                        takeLib(res);
                    }
                }
                setStatus('Original sounds added.', 'ok');
            }
            sfxOrigFileIn.value = '';
        });
    }
    if ($('sfxOrigDrop') && sfxOrigFileIn) {
        $('sfxOrigDrop').addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            sfxOrigFileIn.click();
        });
    }

    const browse = (el, kind, handler) => {
        const go = async (e) => {
            if (e.target.closest('button')) return;
            const p = await window.sa.pickFile(kind);
            if (p && typeof p === 'string') await handler(p);
        };
        el.addEventListener('click', go);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
    };
    browse($('defSfx'), 'sfx', async (p) => { if (takeLib(await window.sa.setDefaultSfx(p))) setCreateStatus('Default sound set', 'ok'); });
    browse($('newSfx'), 'sfx', async (p) => { state.draft.sfxPath = p; setCreateStatus(''); renderCreate(); });
    browse($('animDrop'), 'anim', async (p) => {
        state.draft.animPath = p; state.draft.fromSelection = false;
        if (!$('newName').value.trim()) $('newName').value = baseName(p).replace(/\.[^.]+$/, '');
        setCreateStatus('');
        renderCreate();
    });
    dropZone($('animDrop'), async (p) => {
        const ext = p.toLowerCase().split('.').pop();
        if (!['comp', 'setting'].includes(ext)) { setCreateStatus('Drop a Fusion .comp or .setting file', 'bad'); return; }
        state.draft.animPath = p; state.draft.fromSelection = false;
        if (!$('newName').value.trim()) $('newName').value = baseName(p).replace(/\.[^.]+$/, '');
        setCreateStatus('');
        renderCreate();
    });
    $('useSelected').addEventListener('click', () => {
        state.draft.fromSelection = true; state.draft.animPath = null;
        setCreateStatus('');
        renderCreate();
    });
    dropZone($('newSfx'), async (p) => { state.draft.sfxPath = p; setCreateStatus(''); renderCreate(); });
    $('newSfxClear').addEventListener('click', () => { state.draft.sfxPath = null; renderCreate(); });
    $('newSfxPlay').addEventListener('click', () => play(state.draft.sfxPath));
    $('saveCombo').addEventListener('click', async () => {
        const d = state.draft;
        setCreateStatus('Saving…');
        const res = await window.sa.createCombo({
            name: $('newName').value, animPath: d.animPath, fromSelection: d.fromSelection, sfxPath: d.sfxPath
        });
        if (res && res.error) { setCreateStatus(res.error, 'bad'); return; }
        if (takeLib(res)) {
            state.selectedId = res.createdId;
            state.createId = res.createdId;
            syncUse(true);
            state.draft = { animPath: null, fromSelection: false, sfxPath: null };
            $('newName').value = '';
            renderAll();
            setCreateStatus('Saved. Set its default alignment below; it is now in the Use tab.', 'ok');
        }
    });

    $('pin').addEventListener('click', async () => takeLib(await window.sa.setOnTop(state.lib.alwaysOnTop === false)));
    $('openFolder').addEventListener('click', () => window.sa.openFolder());
    if ($('openFontsFolder')) $('openFontsFolder').addEventListener('click', () => window.sa.openFontsFolder());
    const revertOrigEditor = $('revertOrigEditor');
    if (revertOrigEditor) {
        revertOrigEditor.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a) return;
            openConfirmPop(revertOrigEditor, {
                title: 'Revert to original version?',
                message: 'Restore "' + a.name + '" back to its original .settings file, text design, alignment, and sound? Any saved updates will be overwritten.',
                confirmText: 'Revert',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.revertAnimation(a.id);
                    if (takeLib(res)) {
                        setStatus('Reverted "' + a.name + '" to original version.', 'ok');
                    }
                }
            });
        });
    }
    $('tagsToggle').addEventListener('click', () => setTagsOpen(!tagUI.open));
    $('tagsPlus').addEventListener('click', (e) => { e.stopPropagation(); openNewTagPop($('tagsPlus'), null); });
    setTagsOpen(false);
    $('rescan').addEventListener('click', async () => { state.live = await window.sa.poll(true); renderLive(); setStatus('Subtitles re-read.', 'ok'); });
    bindPlacementMenu();
    bindLivePreview();
    $('create').addEventListener('click', create);

    tick();
    } catch (err) {
        console.error('Fatal initialization error:', err);
        if (window.sa && window.sa.dlog) window.sa.dlog('FATAL INIT ERROR:', String(err && err.stack || err));
    }
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

window.addEventListener('beforeunload', () => { window.sa.cleanup(); });


// ---------------------------------------------------------------- drag-to-adjust number fields (like Resolve)
// Press and drag left/right anywhere on a number field to change it. Shift = 10x faster, Option/Alt = 10x finer.
// A click without dragging puts the cursor in the field for typing.
(function () {
    let drag = null;
    const decimalsOf = (n) => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
    // The value read-out next to a slider (e.g. "Size 0.104") drives that slider: vTdSizeU -> tdSizeU.
    function sliderForVal(span) {
        if (!span || !span.id || span.id[0] !== 'v') return null;
        const id = span.id.charAt(1).toLowerCase() + span.id.slice(2);
        const el = document.getElementById(id);
        return (el && el.matches('input[type=range]')) ? el : null;
    }
    function fieldFrom(target) {
        if (!target || !target.closest) return null;
        if (target.matches && target.matches('input[type=number]')) return target;
        const cell = target.closest('.xform-num-cell');
        if (cell) return cell.querySelector('input[type=number]');
        // The value read-out, or the label holding it ("Size 0.140"), drives that slider.
        const val = target.closest('.val') || (target.closest('label') && target.closest('label').querySelector('.val[id]'));
        return val ? sliderForVal(val) : null;
    }
    document.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const inp = fieldFrom(e.target);
        if (!inp || inp.disabled || inp.readOnly || document.activeElement === inp) return;
        e.preventDefault();
        const step = Number(inp.step) > 0 ? Number(inp.step) : 1;
        const min = inp.min !== '' ? Number(inp.min) : -Infinity;
        const max = inp.max !== '' ? Number(inp.max) : Infinity;
        let perPx = step;
        if (isFinite(min) && isFinite(max) && max > min) perPx = Math.max(inp.type === 'range' ? step / 4 : step, (max - min) / 400);
        drag = { inp, x0: e.clientX, v0: Number(inp.value) || 0, step, min, max, perPx, dec: decimalsOf(inp.step || '1'), moved: false, id: e.pointerId };
        try { (e.target).setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }, true);
    document.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x0;
        if (!drag.moved && Math.abs(dx) < 3) return;
        if (!drag.moved) { drag.moved = true; document.body.classList.add('num-scrubbing'); }
        const mult = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
        let v = drag.v0 + dx * drag.perPx * mult;
        v = Math.round(v / drag.step) * drag.step;
        v = Math.max(drag.min, Math.min(drag.max, v));
        const txt = v.toFixed(Math.max(drag.dec, e.altKey ? drag.dec + 1 : 0));
        if (drag.inp.value === txt) return;
        drag.inp.value = txt;
        drag.inp.dispatchEvent(new Event('input', { bubbles: true }));
        drag.inp.dispatchEvent(new Event('change', { bubbles: true }));
    }, true);
    const end = (e) => {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        const d = drag;
        drag = null;
        document.body.classList.remove('num-scrubbing');
        if (!d.moved && d.inp.type === 'number') { d.inp.focus(); try { d.inp.select(); } catch (err) { /* ignore */ } }
    };
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
})();


// ---------------------------------------------------------------- diagnostics: what the viewer is showing, every 2 s
(function () {
    let lastFrames = [];
    const origPaint = () => window.SABoxes && SABoxes.paint;
    let paintInfo = null;
    const hook = setInterval(() => {
        if (!window.SABoxes || SABoxes._dbgHooked) return;
        const p = SABoxes.paint;
        SABoxes.paint = function (g, a, m, vp, gx, frameIdx) {
            const r = p.apply(this, arguments);
            paintInfo = { r, frameIdx, files: (a && a.previewFiles && a.previewFiles.length) || 0, f0: a && a.previewFiles && a.previewFiles[0] && a.previewFiles[0].split('/').slice(-2).join('/'), stamp: a && a.preview && a.preview.stamp };
            return r;
        };
        SABoxes._dbgHooked = true;
        clearInterval(hook);
    }, 200);
    setInterval(() => {
        try {
            if (!window.sa || !window.sa.dlog || state.tab !== 'apply') return;
            const a = selected(); const u = state.use;
            const v = (typeof useView === 'function' && a) ? useView(a) : a;
            let real = null, blank = null;
            try { real = SAThumbs.hasRealFrames(v); blank = SAThumbs.isBlank(v); } catch (e) { /* ignore */ }
            window.sa.dlog({
                tab: state.tab, id: a && a.id, sub: normSub(currentSubText()).slice(0, 30), rev: u && u.designRev, rendering: u && u.rendering,
                temp: !!(u && u.tempPreview), tempCount: u && u.tempPreview && u.tempPreview.preview && u.tempPreview.preview.count,
                usingTemp: !!(v && a && v !== a), real, blank, paint: paintInfo, previewLoop: !!state.preview, drag: !!state.drag, stageDrag: !!state.stageDrag
            });
            paintInfo = null;
        } catch (e) { try { window.sa.dlog('diag error', String(e && e.message || e)); } catch (e2) { /* ignore */ } }
    }, 2000);
})();
