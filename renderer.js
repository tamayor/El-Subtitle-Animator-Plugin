// Subtitle Animator - panel logic (renderer process)
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

function currentSfxPath(a) {
    if (!a || a.useSfx === false) return null;
    if (a.sfxPath) return a.sfxPath;
    return state.lib.defaultSfx ? state.lib.defaultSfx.path : null;
}

function drawWave(canvas, wave, volumeDb) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round((canvas.clientWidth || 100) * dpr));
    const h = Math.max(1, Math.round((canvas.clientHeight || 40) * dpr));
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (!wave || !wave.peaks.length) return;
    g.fillStyle = '#9be29d';
    const n = wave.peaks.length;
    const db = (volumeDb !== undefined && volumeDb !== null) ? Number(volumeDb) : 0;
    const linearGain = Math.pow(10, db / 20);
    // Baseline scale at 0 dB is 0.68 of height; scaled by volume gain, capped at full height (1.0)
    const ampScale = Math.max(0.04, Math.min(1.0, 0.68 * linearGain));
    for (let x = 0; x < w; x++) {
        const v = wave.peaks[Math.min(n - 1, Math.floor(x / w * n))];
        const bar = Math.max(2 * dpr, v * h * ampScale);
        g.fillRect(x, (h - bar) / 2, 1, bar);
    }
}

// ---------------------------------------------------------------- the alignment block (used in both tabs)
// The same block is mounted twice: in the Use tab (edits are for one use) and in the Create tab (edits are
// the saved defaults). `ctx` says which one a function is working on.
const FONT_OPTIONS = [
    'Poppins', 'Open Sans', 'Montserrat', 'Inter', 'Bebas Neue', 'Impact',
    'Helvetica Neue', 'Arial', 'Futura', 'SF Pro Display', 'Roboto', 'Oswald', 'Lato'
];

const STYLE_OPTIONS = [
    'Regular', 'Light', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black', 'Italic', 'Bold Italic'
];

function defaultElementsList() {
    return [
        { index: 1, name: 'White Solid Fill', enabled: true, opacity: 1.0, type: 0, shape: 0, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#ffffff', color2: '#f07b8e', softness: 0.0, offsetX: 0.0, offsetY: 0.0 },
        { index: 2, name: 'Red Outline', enabled: false, opacity: 1.0, type: 0, shape: 1, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#ff0000', color2: '#f07b8e', softness: 0.0, offsetX: 0.0, offsetY: 0.0 },
        { index: 3, name: 'Black Shadow', enabled: false, opacity: 1.0, type: 0, shape: 0, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#000000', color2: '#f07b8e', softness: 5.0, offsetX: 0.05, offsetY: -0.05 },
        { index: 4, name: 'Blue Border', enabled: false, opacity: 1.0, type: 0, shape: 2, thickness: 0.02, level: 0, extendH: 0.176, extendV: 0.164, round: 0.197, color: '#0000ff', color2: '#f07b8e', softness: 0.0, offsetX: 0.0, offsetY: 0.0 },
        { index: 5, name: 'Element 5', enabled: false, opacity: 1.0, type: 0, shape: 0, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#ffffff', color2: '#f07b8e', softness: 0.0, offsetX: 0.0, offsetY: 0.0 },
        { index: 6, name: 'Element 6', enabled: false, opacity: 1.0, type: 0, shape: 0, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#ffffff', color2: '#f07b8e', softness: 0.0, offsetX: 0.0, offsetY: 0.0 },
        { index: 7, name: 'Element 7', enabled: false, opacity: 1.0, type: 0, shape: 0, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#ffffff', color2: '#f07b8e', softness: 0.0, offsetX: 0.0, offsetY: 0.0 },
        { index: 8, name: 'Element 8', enabled: false, opacity: 1.0, type: 0, shape: 0, thickness: 0.02, level: 3, extendH: 0.0, extendV: 0.0, round: 0.0, color: '#ffffff', color2: '#f07b8e', softness: 0.0, offsetX: 0.0, offsetY: 0.0 }
    ];
}

function cloneTextDesign(td) {
    const base = {
        font: 'Poppins',
        style: 'Bold',
        size: 0.12,
        tracking: 1.0,
        lineSpacing: 1.0,
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
                color2: el.color2 || def.color2 || '#f07b8e'
            });
        });
    }
    return base;
}

const ALIGN_HTML = (S) => `
<div class="row between">
    <span class="label">Alignment timeline</span>
    <label class="check" title="When on, moving the text carries the sound with it, and links the clips on the Resolve timeline">
        <input id="linked${S}" type="checkbox" checked> Link text + sound
    </label>
</div>
<div id="tl${S}" class="tl"></div>
<div class="hint">Drag the sound to line it up. Drag the text to move both (when linked), or its edges to change when it starts and ends.${S === 'U' ? ' Click the ruler to move the Resolve playhead.' : ''}</div>
<div class="row nums">
    <label title="Double-click to reset to default (0f)">Text start <input id="textOffset${S}" type="number" step="1" value="0" data-default="0"><span class="u">f</span></label>
    <label title="Double-click to reset to default (0f)">Sound start <input id="sfxOffset${S}" type="number" step="1" value="0" data-default="0"><span class="u">f</span></label>
    <label title="Double-click to reset to default (0f)">Text ends <input id="tail${S}" type="number" step="1" value="0" data-default="0"><span class="u">f</span></label>
</div>

<div class="row between sfxhead">
    <label class="check"><input id="useSfx${S}" type="checkbox" checked> Sound effect</label>
    <button type="button" id="sfxClear${S}" class="ghost sm-btn" title="Revert to default sound">Use default sound</button>
</div>
<div id="sfxDrop${S}" class="sfxrow drop" title="Drop a sound file here or click Choose">
    <button type="button" id="sfxPlay${S}" class="ghost" title="Preview sound">▶</button>
    <span id="sfxName${S}" class="grow">Drop a sound file here</span>
    <button type="button" id="sfxPick${S}" class="ghost">Choose…</button>
</div>
<input type="file" id="sfxFileInput${S}" accept="audio/*,.wav,.mp3,.aif,.aiff,.m4a,.flac,.ogg" style="display:none">
<div class="ctl">
    <label title="Double-click to reset to default (0 dB)">Sound volume <span class="val" id="vSfxVolume${S}">0 dB</span></label>
    <input id="sfxVolume${S}" type="range" min="-30" max="6" step="1" value="0" data-default="0">
</div>
<div class="row two">
    <div class="ctl"><label>Text track</label><select id="textTrack${S}"></select></div>
    <div class="ctl"><label>Sound track</label><select id="sfxTrack${S}"></select></div>
</div>
${S === 'U' ? '<div class="row"><button id="resetU" class="ghost">Reset to this item\'s default</button></div>' : ''}`;

// ---- Resolve Inspector-style building blocks (label | control | value box)
const TEXT_DESIGN_HTML = (S) => `
<div class="td-panel">
    <div class="td-header">
        <span class="label">Text &amp; Shading Design</span>
        <span class="meta">${S === 'U' ? 'On-the-go override' : 'Default design'}</span>
    </div>

    <div id="tdTabs${S}" class="td-tabs" role="tablist">
        <button type="button" class="td-tab on" data-tab="text">Text</button>
        <button type="button" class="td-tab" data-tab="shading">Shading Elements</button>
        <button type="button" class="td-tab" data-tab="layout">Layout</button>
    </div>

    <div class="td-pane" data-pane="text">
    <div class="row two">
        <div class="ctl">
            <label title="Double-click to reset to default (Poppins)">Font</label>
            <input id="tdFont${S}" type="text" list="fontList${S}" placeholder="Poppins" data-default="Poppins">
            <datalist id="fontList${S}">
                ${FONT_OPTIONS.map(f => `<option value="${f}"></option>`).join('')}
            </datalist>
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
        <div class="sh-row">
            <span class="sh-lbl">Type</span>
            <div id="shType${S}" class="sh-types">
                <button type="button" class="sh-type" data-type="0">Solid</button>
                <button type="button" class="sh-type" data-type="1">Image</button>
                <button type="button" class="sh-type" data-type="2">Gradient</button>
            </div>
        </div>
        <div class="row td-color-size" id="shColorRow${S}">
            <label class="color-pick">
                <span id="shColorLbl${S}">Color</span>
                <input id="shColor${S}" type="color" value="#ffffff" data-default="#ffffff">
            </label>
            <label class="color-pick hidden" id="shColor2Wrap${S}">
                <span>End Color</span>
                <input id="shColor2${S}" type="color" value="#f07b8e" data-default="#f07b8e">
            </label>
            <div class="ctl grow">
                <label title="Double-click to reset to default (1.00)">Opacity <span class="val" id="vShOpacity${S}">1.00</span></label>
                <input id="shOpacity${S}" type="range" min="0" max="1" step="0.01" value="1" data-default="1.00">
            </div>
        </div>
        <div class="row hidden" id="shImageRow${S}">
            <div class="hint grow">Image fill uses Fusion Text+ texture input</div>
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
    </div>
    <canvas id="stage${S}" class="stage" width="640" height="360" title="Drag text to move, drag corners to resize, drag top handle to rotate"></canvas>
    <div id="stageResize${S}" class="stage-resizer hidden" title="Drag to resize preview height (double-click to reset)"><span></span></div>
</div>
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
                textOffset: m.textOffset, sfxOffset: m.sfxOffset, tail: m.tail, linked: m.linked !== false,
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

// The Use tab works on a copy, so changes there never touch the saved default.
function syncUse(force) {
    const a = selected();
    if (!a) { state.use = null; return; }
    if (force || !state.use || state.use.id !== a.id || !state.use.dirty) {
        // A refresh of the same preset keeps the one-time subtitle render, so it is not rendered again.
        const keepRender = (!force && state.use && state.use.id === a.id && !(state.use.designRev > 0)) ? state.use : null;
        state.use = {
            id: a.id, name: a.name, dirty: false, adjusted: false, designDirty: false,
            textOffset: a.textOffset, sfxOffset: a.sfxOffset, tail: a.tail, linked: a.linked !== false,
            sfxVolume: a.sfxVolume, useSfx: a.useSfx !== false, textTrack: a.textTrack, sfxTrack: a.sfxTrack,
            posX: Number(a.posX) || 0, posY: Number(a.posY) || 0,
            scale: Number(a.scale) || 1, rotation: Number(a.rotation) || 0,
            textDesign: cloneTextDesign(a.textDesign),
            boxes: window.SABoxes ? SABoxes.cloneBoxes(a) : {},
            sfxPath: a.sfxPath
        };
        if (keepRender) {
            state.use.tempPreview = keepRender.tempPreview;
            state.use.renderReq = keepRender.renderReq;
            state.use.rendering = keepRender.rendering;
        }
    } else {
        // Keep the one-time Use tab values as they are.
        if (!state.use.textDesign) state.use.textDesign = cloneTextDesign(a.textDesign);
    }
}

const saveField = debounce(async (id, patch) => {
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
function subSpan() {
    const L = state.live;
    if (L && L.ok && L.subtitle) return { base: L.subtitle.start, dur: Math.max(1, L.subtitle.end - L.subtitle.start) };
    if (L && L.ok) return { base: L.frame, dur: Math.round(L.fps * 3) };
    return { base: 0, dur: 75 };
}

function geometry(m) {
    const span = subSpan();
    const fps = fpsNow();
    const wave = loadWaveCached(m);
    const sfxFrames = Math.max(2, Math.round(((wave && wave.seconds) || 0.5) * fps));
    const textS = m.textOffset;
    const textE = span.dur + m.tail;
    const sfxS = textS + m.sfxOffset;
    return { span, fps, sfxFrames, textS, textE, sfxS, sfxE: sfxS + sfxFrames };
}

function loadWaveCached(m) {
    const p = currentSfxPath(m);
    if (!p) return null;
    const w = state.waves.get(p);
    if (w === undefined) loadWave(p);
    return w || null;
}

function windowFor(g) {
    const lo = Math.min(0, g.textS, g.sfxS) - 12;
    const hi = Math.max(g.span.dur, g.textE, g.sfxE) + 12;
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

    // sound bar
    const sb = add('bar sfx' + (m.useSfx === false || !currentSfxPath(m) ? ' off' : ''), laneS);
    sb.style.left = X(g.sfxS) + 'px'; sb.style.width = Math.max(6, g.sfxFrames * ppf) + 'px';
    const cv = document.createElement('canvas'); sb.appendChild(cv);
    drawWave(cv, loadWaveCached(m), m.sfxVolume);

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

    const begin = (kind) => (e) => {
        e.preventDefault(); e.stopPropagation();
        stopPreview();
        state.drag = { ctx, kind, x0: e.clientX, ppf, win, a0: { textOffset: m.textOffset, sfxOffset: m.sfxOffset, tail: m.tail } };
    };
    tb.addEventListener('pointerdown', begin('text'));
    hl.addEventListener('pointerdown', begin('textStart'));
    hr.addEventListener('pointerdown', begin('textEnd'));
    sb.addEventListener('pointerdown', begin('sfx'));
    syncNumbers(ctx);
}

function syncNumbers(ctx) {
    const m = ctx.model(); if (!m) return;
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
        if (m) d.ctx.changed(m);
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
        list = a.previewFiles.map(p => { const i = new Image(); i._bg = a.preview.bg || 'black'; i.src = fileUrl(p) + '?v=' + (a.preview.stamp || 0); return i; });
        imgCache.set(key, list);
    }
    return list;
}

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

    const tlW = (state.liveBg && state.liveBg.width) || 1920;
    const tlH = (state.liveBg && state.liveBg.height) || 1080;

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
    if (!normSub(currentSubText()) && !(u.designRev > 0)) return a;   // nothing overridden: the preset as saved
    return Object.assign({}, a, { preview: u.tempPreview.preview, previewFiles: u.tempPreview.previewFiles });
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
    if (want && c && c.text === want && c.temp) return Object.assign({}, a, { preview: c.temp.preview, previewFiles: c.temp.previewFiles });
    return a;
}
(function () {
    let lastSub = '', subSince = 0, lastFrame = null, frameSince = 0, running = false;
    const failed = new Set();
    setInterval(async () => {
        try {
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
            const next = state.lib.animations.find(x => !x.missing && !(u && u.id === x.id)
                && !failed.has(x.id + '\u0000' + want) && !(subCards.get(x.id) && subCards.get(x.id).text === want));
            if (!next) return;
            running = true;
            if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(next.id, true);
            let res;
            try { res = await window.sa.makePreview(next.id, want, null, '', 'sub'); } catch (e) { res = { error: String(e && e.message || e) }; }
            if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(next.id, false);
            running = false;
            if (res && res.error) { if (!/busy/i.test(res.error)) failed.add(next.id + '\u0000' + want); return; }
            if (res && res.temp) subCards.set(next.id, { text: want, temp: res.temp });
        } catch (e) { running = false; }
    }, 700);
})();

// Use tab: one render per change of subtitle text or override design, into a temporary preview only.
function ensureUsePreview(a) {
    const u = state.use;
    if (!a || a.missing || !u || u.id !== a.id || !window.sa || !window.sa.makePreview) return;
    const want = normSub(currentSubText());
    const rev = u.designRev || 0;
    if (!want && rev === 0) return;
    const reqKey = want + '\u0000' + rev;
    if (u.renderReq === reqKey || u.rendering) return;
    if (u._timerKey === reqKey && u._timer) return;
    clearTimeout(u._timer);
    u._timerKey = reqKey;
    const frame0 = state.live && state.live.frame;
    u._timer = setTimeout(async () => {
        u._timer = 0; u._timerKey = null;
        if (state.use !== u || (state.live && state.live.frame !== frame0) || state.busy || state.drag || state.stageDrag || state.preview
            || normSub(currentSubText()) !== want || (u.designRev || 0) !== rev || state.tab !== 'apply') return;
        u.renderReq = reqKey;
        u.rendering = true;
        setStatus('Rendering the real animation in Resolve…');
        redrawStages();
        let res;
        try { res = await window.sa.makePreview(a.id, want || null, cloneTextDesign(u.textDesign), '', true); } catch (e) { res = { error: String(e && e.message || e) }; }
        u.rendering = false;
        if (res && res.error) {
            if (/busy/i.test(res.error)) u.renderReq = null;      // try again shortly
            else setStatus(res.error, 'bad');
            redrawStages();
            return;
        }
        if (state.use === u && res && res.temp) u.tempPreview = res.temp;
        setStatus('Preview ready.', 'ok');
        redrawStages();
    }, 600);
}
function syncStageOverlay(S, on) {
    const box = $('stageBox' + S);
    if (!box) return;
    let o = box.querySelector(':scope > .render-ov');
    if (on && !o && window.SAThumbs && SAThumbs.renderOverlay) {
        o = SAThumbs.renderOverlay(false);
        o.querySelector('.render-lbl').textContent = 'Rendering the real animation in Resolve…';
        box.appendChild(o);
    } else if (!on && o) o.remove();
}
// One render per change: a preset is re-rendered only when the subtitle text changes or you edit its design
// (each edit bumps its design revision). Once a (text, revision) pair has been rendered it is never rendered again,
// whatever the reloaded library looks like afterwards, so it can never loop.
const designRev = new Map();      // preset id -> number of design edits this session
const lastRendered = new Map();   // preset id -> 'text|revision' last rendered successfully
// Create tab: renders the preset's default preview with its sample text when its default design is edited.
function ensureRealPreview(a, m) {
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
        try { res = await window.sa.makePreview(a.id, want || null, td ? cloneTextDesign(td) : null, designKeyOf(td)); } catch (e) { res = { error: String(e && e.message || e) }; }
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
    }, 600);
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
    const tlW = (state.liveBg.width && state.liveBg.height) ? state.liveBg.width : (im ? im.naturalWidth : 1920);
    const tlH = (state.liveBg.width && state.liveBg.height) ? state.liveBg.height : (im ? im.naturalHeight : 1080);
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
    const targetW = Math.max(200, Math.round(cssW * dpr * fit));
    const targetH = Math.max(120, Math.round(cssH * dpr * fit));
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
        cv._gizmo = null;
        const painted = canUseCaptured && SABoxes.paint(g, a, m, { vx, vy, vw, vh }, gxy, idx);
        SABoxes.draw(S, a, m, cv, { vx, vy, vw, vh }, gxy, painted);
        g.restore();
        g.strokeStyle = '#29302b';
        g.lineWidth = 1;
        g.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);
        for (const id of ['prev', 'loop']) { const e = $(id + S); if (e) e.style.display = 'none'; }
        const bm = $('stageMsg' + S);
        if (bm) bm.textContent = painted ? 'Drag a box to place that text, or the empty frame to move everything.' : 'No animation preview yet. Press Make preview on this preset in the list.';
        return;
    }
    if (window.SABoxes) SABoxes.hideLayer(S);
    // Plays the rendered Fusion frames when they exist and no live subtitle or design override is active; otherwise the real text overlay stands in.
    if (canUseCaptured && window.SABoxes) {
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
            g.save();
            g.translate(cx, cy);
            if (rotRad) g.rotate(rotRad);
            if (userScale !== 1) g.scale(userScale, userScale);
            // Clip strictly to transform box boundary
            g.beginPath();
            g.rect(-vw / 2, -vh / 2, vw, vh);
            g.clip();
            g.drawImage(oc, -vw / 2 + layoutOx, -vh / 2 + layoutOy, vw, vh);
            g.restore();
        } else {
            const defaultTxt = (a && Array.isArray(a.nodes) && a.nodes.length && a.nodes[0].defaultText) || '';
            const txt = activeSubText || defaultTxt || 'Sample text';
            const lines = wrapToLines(String(txt));
            const styleLow = String(td.style || 'Bold').toLowerCase();
            let weight = '700';
            if (styleLow.includes('black') || styleLow.includes('heavy')) weight = '900';
            else if (styleLow.includes('extrabold') || styleLow.includes('ultrabold')) weight = '800';
            else if (styleLow.includes('semibold') || styleLow.includes('demi')) weight = '600';
            else if (styleLow.includes('medium')) weight = '500';
            else if (styleLow.includes('light') || styleLow.includes('thin')) weight = '300';
            else if (styleLow.includes('regular') || styleLow.includes('normal')) weight = '400';
            const isItalic = styleLow.includes('italic') || styleLow.includes('oblique');

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
                    const grad = g.createLinearGradient(-maxLineW / 2, 0, maxLineW / 2, 0);
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
        msg.textContent = prefix + 'Drag box or center to move, handles to resize, top arm to rotate.';
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

function stopPreview() {
    if (!state.preview) return;
    cancelAnimationFrame(state.preview.raf);
    if (state.audio) { try { state.audio.pause(); } catch (e) { /* ignore */ } }
    const { ctx, anim } = state.preview;
    state.preview = null;
    const pv = document.querySelector('#tl' + ctx.s + ' .pv');
    if (pv) pv.style.display = 'none';
    const prevBtn = $('prev' + ctx.s);
    const loopBtn = $('loop' + ctx.s);
    if (prevBtn) prevBtn.textContent = '▶ Preview';
    if (loopBtn) {
        loopBtn.classList.remove('on');
        loopBtn.textContent = '🔁 Live Loop';
    }
    drawStage(ctx.s, ctx.model() || anim, null);
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
    state.preview = { ctx, anim: a || m, raf: 0, loop: !!loop };

    const prevBtn = $('prev' + ctx.s);
    const loopBtn = $('loop' + ctx.s);
    if (loop && loopBtn) {
        loopBtn.classList.add('on');
        loopBtn.textContent = '⏹ Stop Loop';
    }
    if (prevBtn) prevBtn.textContent = '⏹ Stop';

    const frame = () => {
        if (!state.preview) return;
        const curM = ctx.model() || m;
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
        if (!fired && tf >= g.sfxS && (!state.preview.loop || loopCount === 0)) {
            fired = true;
            const sfx = currentSfxPath(curM);
            if (sfx) play(sfx, curM && curM.sfxVolume);
        }
        const relFrame = (tf < g.textS) ? -1 : Math.max(0, Math.floor(tf - g.textS));
        drawStage(ctx.s, curM, relFrame);
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
    if ($('saveBarWrapC')) $('saveBarWrapC').innerHTML = SAVE_BAR_HTML('C');
    if ($('previewC')) $('previewC').innerHTML = PREVIEW_HTML('C');
    attachHexFields();
    bindInspectorChrome();
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

let dblClickResetBound = false;
function bindDblClickReset() {
    if (dblClickResetBound) return;
    dblClickResetBound = true;
    document.addEventListener('dblclick', (e) => {
        // Find if target is a label or inside a label
        const label = e.target.closest('label, .xform-lbl, .sh-lbl');
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

        const row = label.closest('.xform-grid-row, .ctl, .row, .sh-border-box, .sh-soft-row, .td-color-size');
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
        if (sw._hex) continue;
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
    const opts = [[0, 'Auto (free track)']];
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

function fillTextDesign(ctx) {
    const S = ctx.s, m = ctx.model();
    if (!m) return;
    if (!m.textDesign) {
        const a = libEntry(m.id);
        m.textDesign = cloneTextDesign(a && a.textDesign);
    }
    syncVarButtons(S, m);
    const td = m.textDesign;
    const fEl = $('tdFont' + S);
    if (fEl && document.activeElement !== fEl) fEl.value = td.font || 'Poppins';
    const stEl = $('tdStyle' + S);
    if (stEl) {
        if (!Array.from(stEl.options).some(o => o.value === td.style) && td.style) {
            const opt = document.createElement('option');
            opt.value = td.style; opt.textContent = td.style;
            stEl.appendChild(opt);
        }
        stEl.value = td.style || 'Bold';
    }
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
    const typeVal = Number(curEl.type) || 0;
    if (typeBox) {
        for (const b of typeBox.querySelectorAll('.sh-type')) {
            b.classList.toggle('on', Number(b.dataset.type) === typeVal);
        }
    }
    const isGradient = typeVal === 2;
    const isImage = typeVal === 1;
    if ($('shColor2Wrap' + S)) $('shColor2Wrap' + S).classList.toggle('hidden', !isGradient);
    if ($('shColorLbl' + S)) $('shColorLbl' + S).textContent = isGradient ? 'Start Color' : 'Color';
    const c2El = $('shColor2' + S);
    if (c2El) c2El.value = curEl.color2 || '#f07b8e';
    if ($('shImageRow' + S)) $('shImageRow' + S).classList.toggle('hidden', !isImage);
    if ($('shColorRow' + S)) $('shColorRow' + S).classList.toggle('hidden', isImage);

    const shCol = $('shColor' + S);
    if (shCol) shCol.value = curEl.color || '#ffffff';

    const op = Number(curEl.opacity ?? 1);
    const opEl = $('shOpacity' + S);
    if (opEl && document.activeElement !== opEl) opEl.value = op;
    if ($('vShOpacity' + S)) $('vShOpacity' + S).textContent = op.toFixed(2);

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
    const L = () => { const m = ctx.model(); return (m && m.textDesign) ? layoutOf(m.textDesign) : null; };
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

        if (S === 'C') saveField(m.id, { textDesign: m.textDesign });

        if (typeof triggerLiveSync === 'function') {
            triggerLiveSync(m, S);
        }
    };
    const curEl = () => {
        const m = ctx.model();
        if (!m) return null;
        if (!m.textDesign) m.textDesign = cloneTextDesign(libEntry(m.id) && libEntry(m.id).textDesign);
        const idx = clamp(Number(m.textDesign.selectedElement) || 1, 1, 8);
        return m.textDesign.elements[idx - 1];
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
            const res = await window.sa.saveVariant({
                sourceId: m.id,
                boxes: m.boxes || {},
                name: customName,
                useSfx: m.useSfx !== false,
                linked: m.linked !== false,
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
            notifyMsg('Updating "' + m.name + '"…');
            const res = await window.sa.updateLatest({
                animationId: m.id,
                text: $('subText') ? $('subText').value : '',
                updateText: S === 'U',
                boxes: m.boxes || {},
                boxList: window.SABoxes ? SABoxes.payload(m, libEntry(m.id) || m, $('subText') ? $('subText').value : '', S === 'U') : [],
                useSfx: m.useSfx !== false,
                linked: m.linked !== false,
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

    $('tdFont' + S).addEventListener('input', () => {
        const m = ctx.model(); if (!m || !m.textDesign) return;
        m.textDesign.font = $('tdFont' + S).value.trim() || 'Poppins';
        commit();
    });
    $('tdStyle' + S).addEventListener('change', () => {
        const m = ctx.model(); if (!m || !m.textDesign) return;
        m.textDesign.style = $('tdStyle' + S).value;
        commit();
    });
    $('tdColor' + S).addEventListener('input', () => {
        const m = ctx.model(); if (!m || !m.textDesign) return;
        const c = $('tdColor' + S).value;
        m.textDesign.elements[0].color = c;
        m.textDesign.elements[0].modified = true;
        commit();
    });
    $('tdSize' + S).addEventListener('input', () => {
        const m = ctx.model(); if (!m || !m.textDesign) return;
        m.textDesign.size = Number($('tdSize' + S).value);
        if ($('vTdSize' + S)) $('vTdSize' + S).textContent = m.textDesign.size.toFixed(3);
        commit();
    });
    $('tdTrack' + S).addEventListener('input', () => {
        const m = ctx.model(); if (!m || !m.textDesign) return;
        m.textDesign.tracking = Number($('tdTrack' + S).value);
        if ($('vTdTrack' + S)) $('vTdTrack' + S).textContent = m.textDesign.tracking.toFixed(2);
        commit();
    });
    $('tdLine' + S).addEventListener('input', () => {
        const m = ctx.model(); if (!m || !m.textDesign) return;
        m.textDesign.lineSpacing = Number($('tdLine' + S).value);
        if ($('vTdLine' + S)) $('vTdLine' + S).textContent = m.textDesign.lineSpacing.toFixed(2);
        commit();
    });

    bindLayout(ctx, commit);

    for (const btn of $('shSel' + S).querySelectorAll('.sh-tab')) {
        btn.addEventListener('click', () => {
            const m = ctx.model(); if (!m || !m.textDesign) return;
            m.textDesign.selectedElement = Number(btn.dataset.idx) || 1;
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
        for (const b of typeBox.querySelectorAll('.sh-type')) {
            b.addEventListener('click', () => {
                const el = curEl(); if (!el) return;
                el.type = Number(b.dataset.type) || 0;
                el.enabled = true;
                el.modified = true;
                commit();
            });
        }
    }

    $('shColor' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.color = $('shColor' + S).value;
        el.modified = true;
        commit();
    });
    if ($('shColor2' + S)) {
        $('shColor2' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            el.color2 = $('shColor2' + S).value;
            el.modified = true;
            commit();
        });
    }
    $('shOpacity' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.opacity = Number($('shOpacity' + S).value);
        if ($('vShOpacity' + S)) $('vShOpacity' + S).textContent = el.opacity.toFixed(2);
        el.modified = true;
        commit();
    });
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
    const curFile = m.sfxPath ? baseName(m.sfxPath) : (m.sfx || (a && a.sfx));
    const defFile = state.lib.defaultSfx ? state.lib.defaultSfx.file : null;
    const sfxNameEl = $('sfxName' + S);
    if (sfxNameEl) {
        sfxNameEl.textContent = curFile ? 'Sound: ' + curFile : (defFile ? 'Sound: default (' + defFile + ')' : 'Drop a sound file here');
    }
    if ($('sfxClear' + S)) {
        $('sfxClear' + S).style.visibility = curFile ? 'visible' : 'hidden';
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

    const handleSfxFile = async (filePath) => {
        if (!filePath) return;
        const m = ctx.model();
        if (!m) return;
        if (S === 'C') {
            state.createAdjusted = true;
            const res = await window.sa.setAnimationSfx(m.id, filePath);
            if (takeLib(res)) {
                const ca = libEntry(state.createId);
                if (ca) ca.adjusted = true;
                setCreateStatus('Sound updated for "' + m.name + '"', 'ok');
                fillAdjust(ctx);
                renderAnimations();
                renderCreateSummary();
            }
        } else {
            m.sfxPath = filePath;
            m.sfx = baseName(filePath);
            m.dirty = true;
            m.adjusted = true;
            m.useSfx = true;
            $('useSfx' + S).checked = true;
            fillAdjust(ctx);
            renderUseSummary();
            renderAnimations();
            syncVarButtons('U', m);
            setStatus('Sound selected: ' + m.sfx + ' (save via "+ Create" or "Update").', 'ok');
        }
    };

    if ($('sfxDrop' + S)) dropZone($('sfxDrop' + S), handleSfxFile);

    const pickBtn = $('sfxPick' + S);
    const fileIn = $('sfxFileInput' + S);
    if (pickBtn && fileIn) {
        pickBtn.addEventListener('click', (e) => { e.stopPropagation(); fileIn.click(); });
        fileIn.addEventListener('change', () => {
            const f = fileIn.files && fileIn.files[0];
            if (f) {
                const p = window.sa.pathForFile(f);
                if (p) handleSfxFile(p);
            }
            fileIn.value = '';
        });
    }

    const sfxPlayBtn = $('sfxPlay' + S);
    if (sfxPlayBtn) {
        sfxPlayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const m = ctx.model();
            const p = m && (m.sfxPath || currentSfxPath(m));
            if (p) play(p);
            else setStatus('No sound file set', 'bad');
        });
    }

    const sfxClearBtn = $('sfxClear' + S);
    if (sfxClearBtn) {
        sfxClearBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const m = ctx.model();
            if (!m) return;
            if (S === 'C') {
                state.createAdjusted = true;
                const res = await window.sa.setAnimationSfx(m.id, null);
                if (takeLib(res)) {
                    const ca = libEntry(state.createId);
                    if (ca) ca.adjusted = true;
                    setCreateStatus('Reverted to default sound for "' + m.name + '"', 'ok');
                    fillAdjust(ctx);
                    renderAnimations();
                    renderCreateSummary();
                }
            } else {
                m.sfxPath = null;
                m.sfx = null;
                m.dirty = true;
                m.adjusted = true;
                fillAdjust(ctx);
                renderUseSummary();
                renderAnimations();
                syncVarButtons('U', m);
                setStatus('Reverted to default sound.', 'ok');
            }
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
}

function renderTdSummary(ctx) {
    const S = ctx.s;
    const el = $('tdSummary' + S);
    if (!el) return;
    const m = ctx.model();
    if (!m) { el.textContent = ''; return; }
    const td = m.textDesign || (libEntry(m.id) && libEntry(m.id).textDesign);
    if (!td) { el.textContent = ''; return; }
    const font = td.font || 'Poppins';
    const style = td.style || 'Bold';
    const size = (Number(td.size) || 0.12).toFixed(3);
    el.textContent = font + ' ' + style + ' · ' + size + (m.designDirty ? ' · edited' : '');
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
                it.append(ck, d, n);
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
        x.addEventListener('click', () => {
            const n = counts[t.id] || 0;
            if (n && !confirm('Delete tag "' + t.name + '"? It will be removed from ' + n + ' preset(s).')) return;
            saveTagList(allTags().filter(y => y.id !== t.id));
        });
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
        const sp = soundOf(a);
        if (sp) {
            const pl = document.createElement('button');
            pl.className = 'ghost play'; pl.textContent = '▶'; pl.title = 'Hear the sound';
            pl.addEventListener('click', (e) => { e.stopPropagation(); play(sp); });
            c.appendChild(pl);
        }
        c.addEventListener('click', () => {
            stopPreview();
            state.selectedId = a.id;
            syncUse(true);
            renderAll();
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
        const dots = tagDotsEl(a);
        if (dots) row.appendChild(dots);
        const pl = document.createElement('button'); pl.className = 'ghost'; pl.textContent = '▶'; pl.title = 'Hear the sound';
        pl.addEventListener('click', (e) => { e.stopPropagation(); const p = soundOf(a) || (a.useSfx === false ? null : null); if (p) play(p); });
        const more = document.createElement('button'); more.className = 'ghost more'; more.textContent = '⋯'; more.title = 'Tags and more';
        more.addEventListener('click', (e) => { e.stopPropagation(); openRowMenu(more, a); });
        row.append(t, pl, more);
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

function setAdjustOpen(open) {
    state.adjustOpen = open;
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
    renderCreate();
    renderTags();
    renderPin();
    renderLive();
}

// ---------------------------------------------------------------- live subtitle
async function tick() {
    if (!state.busy && !state.drag) {
        try { state.live = await window.sa.poll(false); } catch (e) { state.live = { ok: false, reason: 'Not connected' }; }
        renderLive();
    }
    setTimeout(tick, 200);
}

// ---------------------------------------------------------------- actions
async function create() {
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
    const res = await window.sa.apply({
        animationId: a.id, text, start, end,
        textOffset: m.textOffset, sfxOffset: m.sfxOffset, sfxVolume: m.sfxVolume, tail: m.tail,
        textTrack: m.textTrack, sfxTrack: m.sfxTrack, useSfx: m.useSfx !== false,
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

window.addEventListener('DOMContentLoaded', async () => {
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

    $('adjustToggle').addEventListener('click', () => { stopPreview(); setAdjustOpen(!state.adjustOpen); });
    if ($('tdToggleU')) $('tdToggleU').addEventListener('click', () => { stopPreview(); setTdOpen(!state.tdOpen); });
    if ($('adjustToggleC')) $('adjustToggleC').addEventListener('click', () => { stopPreview(); setCreateAdjustOpen(!state.createAdjustOpen); });
    if ($('tdToggleC')) $('tdToggleC').addEventListener('click', () => { stopPreview(); setCreateTdOpen(!state.createTdOpen); });
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
    $('tagsToggle').addEventListener('click', () => setTagsOpen(!tagUI.open));
    $('tagsPlus').addEventListener('click', (e) => { e.stopPropagation(); openNewTagPop($('tagsPlus'), null); });
    setTagsOpen(false);
    $('rescan').addEventListener('click', async () => { state.live = await window.sa.poll(true); renderLive(); setStatus('Subtitles re-read.', 'ok'); });
    $('create').addEventListener('click', create);

    tick();
});

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
