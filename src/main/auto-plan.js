// Planning a placement for the automation tools (automation.js, auto-place.js), without touching Resolve: which presets
// the rules' tags allow, what each preset offers, how a MultiText subtitle splits into rows, what apply() gets per
// text node, and how big the text lines will be for the layout fit. Tested in test/main/auto-plan.test.js.

module.exports = {
    autoRoles, boxListFor, defaultSplit, estimateLines, layoutFor, mtTexts, passes, presetInfo, resolveTags, sizedDesign, tagMatches
};

const fs = require('fs');
const path = require('path');

const { ANIM_DIR } = require('./config');
const { withFillColor, withGradientFill } = require('./edit-rules');
const { nodesWithDesign, parseTextStyle } = require('./fusion-setting');
const { presetSfxName } = require('./sfx');

// ------------------------------------------------------------------ tags and presets

const graphemes = (s) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(String(s || '').replace(/\s+/g, '')), x => x.segment);
const bare = (s) => s.replace(/️/g, '');      // "❤️" and "❤" are the same emoji

// A tag matches its id, its name, its whole emoji string or any one of its emoji.
function tagMatches(t, token) {
    const k = String(token).trim();
    if (!k) return false;
    if (t.id === k || t.name.toLowerCase() === k.toLowerCase()) return true;
    if (!t.emoji) return false;
    if ((t.emoji + ' ' + t.name).toLowerCase() === k.toLowerCase()) return true;      // the panel's label, "🔥 Danger"
    return bare(t.emoji) === bare(k) || graphemes(t.emoji).some(e => bare(e) === bare(k));
}

// Tag ids for a list of emoji / names / ids; tokens that match no tag are returned as unknown.
function resolveTags(lib, tokens) {
    const ids = [], unknown = [];
    for (const k of tokens || []) {
        const t = (lib.tags || []).find(x => tagMatches(x, k));
        if (t) ids.push(t.id); else unknown.push(k);
    }
    return { ids, unknown };
}

function passes(a, ids, match) {
    if (!ids.length) return true;
    const mine = Array.isArray(a.tags) ? a.tags : [];
    return match === 'all' ? ids.every(id => mine.includes(id)) : ids.some(id => mine.includes(id));
}

function presetInfo(lib, a) {
    const compPath = path.join(ANIM_DIR, a.file);
    const exists = fs.existsSync(compPath);
    const nodes = exists ? nodesWithDesign(compPath) : [];
    const td = parseTextStyle(exists ? compPath : null, a.textDesign) || {};
    const tags = (a.tags || []).map(id => (lib.tags || []).find(t => t.id === id)).filter(Boolean);
    return {
        id: a.id,
        name: a.name,
        tags: tags.map(t => (t.emoji ? t.emoji + ' ' : '') + t.name),
        multiText: nodes.some(n => n.kind === 'multitext'),
        textLayers: nodes.filter(n => !n.nested).map(n => n.kind === 'multitext' ? (n.layerName || ('Text ' + n.layer)) : n.label),
        font: td.font ? (td.font + (td.style ? ' ' + td.style : '')) : null,
        sound: a.useSfx === false ? null : (presetSfxName(a) || lib.defaultSfx || null),
        missing: !exists
    };
}

// ------------------------------------------------------------------ MultiText (same role guess as the panel's text-boxes.js)

function autoRoles(list) {
    const r = { upper: null, emphasis: null, lower: null };
    const used = new Set();
    const take = (role, re) => {
        if (r[role] !== null) return;
        const n = list.find(x => !used.has(x.layer) && re.test((x.layerName || '') + ' ' + (x.defaultText || '')));
        if (n) { r[role] = n.layer; used.add(n.layer); }
    };
    take('emphasis', /emphas|highlight|keyword|hero|\bmain\b|\bbig\b/i);
    take('upper', /upper|\btop\b|above/i);
    take('lower', /lower|bottom|below|under/i);
    const pick = (role, best) => {
        if (r[role] !== null) return;
        const p = list.filter(x => !used.has(x.layer));
        if (!p.length) return;
        const n = p.reduce((m, x) => best(x, m) ? x : m);
        r[role] = n.layer; used.add(n.layer);
    };
    pick('emphasis', (x, m) => (x.size || 0) > (m.size || 0) + 1e-6);
    pick('upper', (x, m) => x.cy > m.cy + 1e-6);
    pick('lower', (x, m) => x.cy < m.cy - 1e-6);
    return r;
}

function defaultSplit(text, how) {
    const w = String(text || '').replace(/\r?\n/g, ' ').split(/\s+/).filter(Boolean);
    const N = w.length;
    if (!N) return { upper: '', emphasis: '', lower: '' };
    const s = how === 'first' ? 0 : (how === 'center' ? Math.floor((N - 1) / 2) : N - 1);
    return { upper: w.slice(0, s).join(' '), emphasis: w[s], lower: w.slice(s + 1).join(' ') };
}

function mtTexts(nodes, parts) {
    const r = autoRoles(nodes.filter(n => n.kind === 'multitext'));
    const t = Object.assign({ upper: '', emphasis: '', lower: '' }, parts);
    const join = (x, y) => [x, y].filter(Boolean).join(' ');
    if (r.upper === null && t.upper) { if (r.lower !== null) t.lower = join(t.upper, t.lower); else if (r.emphasis !== null) t.emphasis = join(t.upper, t.emphasis); t.upper = ''; }
    if (r.lower === null && t.lower) { if (r.upper !== null) t.upper = join(t.upper, t.lower); else if (r.emphasis !== null) t.emphasis = join(t.emphasis, t.lower); t.lower = ''; }
    const byLayer = {};
    for (const role of ['upper', 'emphasis', 'lower']) if (r[role] !== null) byLayer[r[role]] = t[role];
    return byLayer;
}

// A Text+ design with the sizing applied: Size x textSize, capped at maxSize; Line Spacing set. capped: the cap was hit.
function sizedDesign(design, sizing) {
    const s = sizing || {};
    const out = Object.assign({}, design || {});
    let capped = false;
    if (Number(out.size) > 0) {
        let size = Number(out.size) * (s.textSize || 1);
        if (s.maxSize && size > s.maxSize) { size = s.maxSize; capped = true; }
        out.size = Math.round(size * 10000) / 10000;
    }
    if (s.lineSpacing) out.lineSpacing = s.lineSpacing;
    return { design: out, capped };
}

// What apply() sends to Fusion for each detected node (the main-process twin of SABoxes.payload).
// sizing: { textSize: multiplier on each Text+ node's own size, maxSize: Size cap, lineSpacing: Line Spacing } (see sizedDesign).
// look: the rules' forced { font, color, emphasis } (null = the preset's own design).
function boxListFor(a, nodes, text, parts, look, sizing) {
    if (!nodes.length || nodes[0].nested) return [];
    const L = look || {};
    const font = L.font || null;
    const lines = String(text || '').split(/\r?\n/);
    const isMT = nodes.some(n => n.kind === 'multitext');
    const mt = isMT ? mtTexts(nodes, parts) : {};
    const emLayer = isMT ? autoRoles(nodes.filter(n => n.kind === 'multitext')).emphasis : null;
    const primary = (nodes.find(n => n.primary) || nodes.find(n => n.kind === 'textplus')) || null;
    const boxes = (a.boxes && typeof a.boxes === 'object') ? a.boxes : {};
    return nodes.map((n, i) => {
        const b = boxes[n.id] || { mode: i === 0 ? 'sub' : 'keep' };
        let t = null;
        if (n.kind === 'multitext') t = (n.layer in mt) ? mt[n.layer] : null;
        else if (b.mode === 'sub') t = text;
        else if (b.mode === 'l1') t = lines[0] || '';
        else if (b.mode === 'l2') t = lines[1] || '';
        else if (b.mode === 'l3') t = lines[2] || '';
        else if (b.mode === 'custom') t = b.text || '';
        let design = null;
        if (n.kind === 'textplus' && primary && n.id !== primary.id) {
            const own = b.design || n.design || null;
            if (own || font || L.color) design = Object.assign({}, own || {}, font ? { font: font.font, style: font.style } : {});
            const grad = design && L.gradient ? withGradientFill(design, L.gradient, L.gradientColor) : null;
            if (grad) design = grad;
            else if (design && L.color) design = withFillColor(design, L.color);
            if (design) design = sizedDesign(design, sizing).design;
        }
        const out = {
            id: n.id, kind: n.kind, tool: n.tool, input: n.input, centerInput: n.centerInput, label: n.label,
            text: t, cx: null, cy: null, size: null, design
        };
        if (n.kind === 'multitext') {
            const em = (L.emphasis && n.layer === emLayer) ? L.emphasis : null;
            const f = (em && em.font) ? { font: em.font, style: em.style } : ((em && em.keepFont) ? null : font);
            if (f) { out.font = f.font; out.style = f.style; }
            // the emphasis colour is the highlight's background (box / pill behind the word) and the word keeps the
            // normal text colour; presets without a box get it on the word itself (fusion_bridge.set_highlight_bg)
            const c = ((em && em.keepColor) ? null : L.color) || null;
            if (c) out.color = c;
            if (em && em.color) out.bgColor = em.color;
        }
        return out;
    });
}

// The layout only applies to timelines of its own shape (a 9:16 social safe zone is not used on a 16:9 edit).
function layoutFor(layout, meta) {
    if (!layout || !meta || !meta.width || !meta.height) return layout || null;
    return Math.abs(meta.width / meta.height - layout.aspect) <= 0.02 ? layout : null;
}

// The text lines as they will render ({ text, size } top to bottom), for the layout fit. null = sizes unknown.
function estimateLines(nodes, isMT, text, parts, textDesign, textSize, maxSize) {
    if (isMT) {
        const layers = nodes.filter(n => n.kind === 'multitext' && !n.nested);
        if (!layers.length) return null;
        const texts = mtTexts(nodes, parts);
        const biggest = Math.max(...layers.map(n => Number(n.size) || 0.08)) * textSize;
        const k = maxSize && biggest > maxSize ? maxSize / biggest : 1;
        return layers.slice().sort((p, q) => (q.cy || 0) - (p.cy || 0))
            .filter(n => texts[n.layer])
            .flatMap(n => String(texts[n.layer]).split(/\r?\n/).map(t => ({ text: t, size: (Number(n.size) || 0.08) * textSize * k })));
    }
    const base = Number(textDesign && textDesign.size);
    if (!(base > 0)) return null;
    let size = base * textSize;
    if (maxSize && size > maxSize) size = maxSize;
    return String(text).split(/\r?\n/).map(t => ({ text: t, size }));
}
