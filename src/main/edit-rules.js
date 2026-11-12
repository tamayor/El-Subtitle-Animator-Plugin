// The editing rules for automated placements (edit-rules.json in the data folder): their defaults, cleaning what a
// client sends into a valid set, and turning the rules into what a placement needs (highlight box and row requests,
// forced colours and gradients, the share of clips that get the style overrides).
// automation.js enforces them on every placement made through the MCP script.

// Declared before module.exports: a const used in the export list must exist when it runs.
// Named vertical positions (0 = top of the frame, 1 = bottom) for rules.position.defaultZone and place's `zone`.
const ZONES = { top: 0.14, upper: 0.3, center: 0.5, lower: 0.7, bottom: 0.84 };
const RULES_FILE = require('path').join(require('./config').DATA_DIR, 'edit-rules.json');

module.exports = {
    RULES_FILE, ZONES, cleanHighlight, cleanRows, cleanRules, defaultRules, highlightReq, loadRules, rowsReq, saveRules, takeShare,
    withFillColor, withGradientFill
};

const fs = require('fs');

const LAYOUT = require('./layout');

function defaultRules() {
    return {
        allowedTags: [],            // emoji, tag names or ids; empty = every preset may be used
        tagMatch: 'any',            // 'any': a preset needs one of the tags, 'all': every one of them
        font: null,                 // { font: 'Poppins', style: 'ExtraBold' } forces this font on every placed clip
        color: null,                // '#ffffff' forces this text fill colour (shading element 1) on every placed clip
        // MultiText emphasis layer only: { font, style, color } (each optional) beats font / color there. null = same as the rest
        emphasis: null,
        // { textplus: { font, style, color }, multitext: {...} }: a pair for one kind of preset only, beating font / color there
        kindStyle: { textplus: null, multitext: null },
        // % of the clips that get the overrides (normal = font / color / kindStyle, emphasis = emphasis); the rest keep
        // the preset's default look. Spread evenly: 50 = every other clip, 20 = one clip in five.
        styleShare: { normal: 100, emphasis: 100 },
        // presets with one of these tags skip the overrides: keep 'both' = their own font and colour, 'font' = their own
        // font (the colour override still applies), 'color' = their own colour (the font override still applies)
        styleExcept: { normal: null, emphasis: null },
        // presets whose text fill is a gradient (Money Pop Up, $123,456): enabled = recolour that gradient on every one of
        // them, even presets that keep their own colour (styleExcept / keepPresetStyle). top / bottom = hex (top null =
        // the text style colour, bottom null = same as top: a plain fill); topStop / bottomStop 0..1 (null = the preset's)
        gradient: { enabled: false, top: null, bottom: null, topStop: null, bottomStop: null },
        // 'top' above all clips there, 'first-empty' lowest free layer, 'fixed' V<fixed>; from / to = keep the layer
        // between V<from> and V<to> (to null = no limit; null both = the panel's Placement range)
        track: { mode: 'top', fixed: null, from: null, to: null },
        position: { defaultZone: null, safeTop: 0.08, safeBottom: 0.92, safeLeft: 0.05, safeRight: 0.95, avoidFaces: true },
        multitext: { emphasis: 'auto', uppercaseEmphasis: false },      // auto = Claude picks the words to emphasize
        // Inspector values: maxSize caps the text Size (MultiText: its biggest layer, the group shrinks together);
        // lineSpacing sets Line Spacing (MultiText: each layer's, and the gaps between layers scale with it). null = the preset's
        text: { maxSize: null, lineSpacing: null },
        // the box / pill behind a highlighted word (Highlight Select, Glass Pill, Pill Soft / Outline / Solid, Soft
        // Marker, Underline Draw): width / height multiply the preset's box, x / y are added to its Offset (Inspector
        // units, + = right / up), auto evens out the padding around the word (fusion_bridge.op_highlight_box)
        highlight: { auto: true, width: 1, height: 1, x: 0, y: 0 },
        // MultiText row layout (Inspector Row controls, tools/add-multitext-row-controls.py): gap = space between the
        // upper / emphasis / lower rows in text lines (null = the preset's own), justify = manual / center / left / right
        // (null = the preset's: manual). fusion_bridge.op_multitext_rows
        rows: { gap: null, justify: null },
        sound: true,               // place the presets' sound effects
        notes: '',                  // free-text editing rules Claude reads before editing
        // Safe-zone layout read from a reference image (see layout.js): safe bands, named guides, zones to keep clear.
        // fit: keep the estimated text box inside it; widthFactor calibrates the text width estimate.
        // Default: the built-in social-media 9:16 safe zone (used on vertical timelines only). null = no layout.
        layout: cleanLayout(LAYOUT.defaultLayout())
    };
}

function cleanRules(r) {
    const d = defaultRules();
    r = (r && typeof r === 'object') ? r : {};
    const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
    const pos = Object.assign({}, d.position, r.position || {});
    const trk = Object.assign({}, d.track, r.track || {});
    const mt = Object.assign({}, d.multitext, r.multitext || {});
    const tx = Object.assign({}, d.text, r.text || {});
    const opt = (v, lo, hi) => (v === null || v === undefined || v === '') ? null : num(v, lo, hi, null);
    return {
        allowedTags: (Array.isArray(r.allowedTags) ? r.allowedTags : []).map(x => String(x).trim()).filter(Boolean).slice(0, 50),
        tagMatch: r.tagMatch === 'all' ? 'all' : 'any',
        font: (r.font && typeof r.font === 'object' && String(r.font.font || '').trim())
            ? { font: String(r.font.font).trim(), style: String(r.font.style || '').trim() || null }
            : null,
        color: cleanHex(r.color),
        emphasis: cleanEmphasis(r.emphasis),
        styleShare: {
            normal: num(r.styleShare && r.styleShare.normal, 0, 100, 100),
            emphasis: num(r.styleShare && r.styleShare.emphasis, 0, 100, 100)
        },
        styleExcept: {
            normal: cleanExcept(r.styleExcept && r.styleExcept.normal),
            emphasis: cleanExcept(r.styleExcept && r.styleExcept.emphasis)
        },
        gradient: cleanGradient(r.gradient),
        kindStyle: {
            textplus: cleanEmphasis(r.kindStyle && r.kindStyle.textplus),
            multitext: cleanEmphasis(r.kindStyle && r.kindStyle.multitext)
        },
        track: {
            mode: ['top', 'first-empty', 'fixed'].includes(trk.mode) ? trk.mode : 'top',
            fixed: trk.fixed ? Math.max(2, Math.round(Number(trk.fixed)) || 2) : null,
            from: trk.from ? Math.max(2, Math.round(Number(trk.from)) || 2) : null,
            to: trk.to ? Math.max(trk.from ? Math.max(2, Math.round(Number(trk.from)) || 2) : 2, Math.round(Number(trk.to)) || 2) : null
        },
        position: {
            defaultZone: (pos.defaultZone && ZONES[pos.defaultZone] !== undefined) ? pos.defaultZone : null,
            safeTop: num(pos.safeTop, 0, 0.5, d.position.safeTop),
            safeBottom: num(pos.safeBottom, 0.5, 1, d.position.safeBottom),
            safeLeft: num(pos.safeLeft, 0, 0.5, d.position.safeLeft),
            safeRight: num(pos.safeRight, 0.5, 1, d.position.safeRight),
            avoidFaces: pos.avoidFaces !== false
        },
        multitext: {
            emphasis: ['auto', 'last', 'first', 'center'].includes(mt.emphasis) ? mt.emphasis : 'auto',
            uppercaseEmphasis: !!mt.uppercaseEmphasis
        },
        text: { maxSize: opt(tx.maxSize, 0.01, 1), lineSpacing: opt(tx.lineSpacing, 0.3, 3) },
        highlight: cleanHighlight(r.highlight),
        rows: cleanRows(r.rows),
        sound: r.sound !== false,
        notes: String(r.notes || '').slice(0, 4000),
        layout: r.layout === undefined ? d.layout : cleanLayout(r.layout)
    };
}

function cleanGradient(g) {
    g = (g && typeof g === 'object') ? g : {};
    const stop = (v) => { const n = Number(v); return (v === null || v === undefined || v === '' || !Number.isFinite(n)) ? null : Math.max(0, Math.min(1, n)); };
    return { enabled: !!g.enabled, top: cleanHex(g.top), bottom: cleanHex(g.bottom), topStop: stop(g.topStop), bottomStop: stop(g.bottomStop) };
}

function cleanHighlight(h) {
    h = (h && typeof h === 'object') ? h : {};
    const num = (v, lo, hi, def) => { const n = Number(v); return (v !== null && v !== '' && Number.isFinite(n)) ? Math.max(lo, Math.min(hi, n)) : def; };
    return { auto: h.auto === undefined ? true : !!h.auto, width: num(h.width, 0.2, 4, 1), height: num(h.height, 0.2, 4, 1), x: num(h.x, -2, 2, 0), y: num(h.y, -2, 2, 0) };
}

const ROW_JUSTIFY = ['manual', 'center', 'left', 'right'];
function cleanRows(r) {
    r = (r && typeof r === 'object') ? r : {};
    const g = Number(r.gap);
    return {
        gap: (r.gap === null || r.gap === undefined || r.gap === '' || !Number.isFinite(g)) ? null : Math.max(-3, Math.min(6, g)),
        justify: ROW_JUSTIFY.includes(String(r.justify || '').toLowerCase()) ? String(r.justify).toLowerCase() : null
    };
}

// The bridge's multitext_rows args from the rules' rows and this call's (gap, justify, link, all / upper / emphasis /
// lower {x, y}), or null when nothing is set.
function rowsReq(rules, own) {
    const out = {};
    const r = cleanRows(rules);
    if (r.gap !== null) out.gap = r.gap;
    if (r.justify) out.justify = r.justify;
    own = (own && typeof own === 'object') ? own : {};
    const o = cleanRows(own);
    if (o.gap !== null) out.gap = o.gap;
    if (out.gap === undefined) out.gap = 0;        // default: rows touching (the minimum); a rule or per-call gap overrides
    if (o.justify) out.justify = o.justify;
    if (own.link !== undefined && own.link !== null) out.link = !!own.link;
    if (own.equalize !== undefined && own.equalize !== null) out.equalize = !!own.equalize;
    if (own.distance && typeof own.distance === 'object') {
        const d = {};
        if (own.distance.on !== undefined && own.distance.on !== null) d.on = !!own.distance.on;
        for (const k of ['upperEmphasis', 'emphasisLower']) { const n = Number(own.distance[k]); if (own.distance[k] !== null && own.distance[k] !== undefined && Number.isFinite(n)) d[k] = Math.max(-300, Math.min(1000, n)); }
        if (Object.keys(d).length) out.distance = d;
    }
    for (const k of ['all', 'upper', 'emphasis', 'lower']) {
        const v = own[k];
        if (!v || typeof v !== 'object') continue;
        const xy = {};
        for (const ax of ['x', 'y']) { const n = Number(v[ax]); if (v[ax] !== null && v[ax] !== undefined && Number.isFinite(n)) xy[ax] = Math.max(-2, Math.min(2, n)); }
        if (Object.keys(xy).length) out[k] = xy;
    }
    return Object.keys(out).length ? out : null;
}

// The bridge's highlight_box args, or null when nothing would change (no auto, every slider at its default).
function highlightReq(h) {
    h = cleanHighlight(h);
    return (h.auto || h.width !== 1 || h.height !== 1 || h.x !== 0 || h.y !== 0) ? h : null;
}

// Whether this clip gets the override, so that `pct` % of the clips do, spread evenly over the session's clips.
// peek: only look (dry runs, measuring) without counting the clip.
const shareCount = { normal: 0, emphasis: 0 };
function takeShare(which, pct, peek) {
    const p = Number.isFinite(Number(pct)) ? Math.max(0, Math.min(100, Number(pct))) : 100;
    if (p >= 100) return true;
    if (p <= 0) return false;
    const n = shareCount[which];
    if (!peek) shareCount[which] = n + 1;
    return Math.floor((n + 1) * p / 100) > Math.floor(n * p / 100);
}

// '#fff', 'fff', '#FFFFFF' -> '#ffffff'; anything else -> null
function cleanHex(v) {
    let s = String(v === null || v === undefined ? '' : v).trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map(c => c + c).join('');
    return /^[0-9a-f]{6}$/.test(s) ? '#' + s : null;
}

// { tags: [...], keep: 'both' | 'font' | 'color' } or null (no exception)
function cleanExcept(x) {
    if (!x || typeof x !== 'object') return null;
    const tags = (Array.isArray(x.tags) ? x.tags : []).map(t => String(t).trim()).filter(Boolean).slice(0, 50);
    if (!tags.length) return null;
    const k = String(x.keep || 'both').toLowerCase();
    return { tags, keep: /^font$/.test(k) ? 'font' : (/^colou?r$/.test(k) ? 'color' : 'both') };
}

function cleanEmphasis(e) {
    if (!e || typeof e !== 'object') return null;
    const font = String(e.font || '').trim() || null;
    const out = { font, style: font ? (String(e.style || '').trim() || null) : null, color: cleanHex(e.color) };
    return (out.font || out.color) ? out : null;
}

// The text fill colour: shading element 1, made solid (a gradient fill would keep its second stop).
function withFillColor(design, color) {
    if (!color) return design;
    const out = Object.assign({}, design || {});
    const els = Array.isArray(out.elements) ? out.elements.map(e => Object.assign({}, e)) : [];
    const i = els.findIndex(e => Number(e.index) === 1);
    const el1 = Object.assign(i >= 0 ? els[i] : { index: 1 }, { color, type: 0, enabled: true, modified: true });
    if (i >= 0) els[i] = el1; else els.unshift(el1);
    out.elements = els;
    return out;
}

// The rules' gradient recolour for a design whose fill (shading element 1) is a gradient, or null when it is not one.
// fallback: the text style colour, used for an unset top. The fill stays a gradient (type 2) with the new stops.
function withGradientFill(design, g, fallback) {
    if (!g || !g.enabled || !design || !Array.isArray(design.elements)) return null;
    const i = design.elements.findIndex(e => Number(e.index) === 1);
    const cur = i >= 0 ? design.elements[i] : null;
    if (!cur || Number(cur.type) !== 2) return null;
    const top = g.top || fallback || cur.color || '#ffffff';
    const bottom = g.bottom || top;
    const el1 = Object.assign({}, cur, { type: 2, color: top, color2: bottom, enabled: true, modified: true });
    if (g.topStop !== null && g.topStop !== undefined) el1.stop1 = g.topStop;
    if (g.bottomStop !== null && g.bottomStop !== undefined) el1.stop2 = g.bottomStop;
    if (el1.stop1 !== undefined && el1.stop2 !== undefined && el1.stop2 < el1.stop1) el1.stop2 = el1.stop1;
    const els = design.elements.map(e => Object.assign({}, e));
    els[i] = el1;
    return Object.assign({}, design, { elements: els });
}

function cleanLayout(l) {
    if (!l || typeof l !== 'object' || !Array.isArray(l.bands) || !l.bands.length) return null;
    const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
    const fit = l.fit || {};
    return Object.assign({}, l, {
        guides: Array.isArray(l.guides) ? l.guides : [],
        zones: Array.isArray(l.zones) ? l.zones : [],
        fit: { enabled: fit.enabled !== false, avoidZones: fit.avoidZones !== false, widthFactor: num(fit.widthFactor, 0.3, 1.2, 0.6), pad: num(fit.pad, 0, 0.1, 0.01) }
    });
}

function loadRules() {
    try { return cleanRules(JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'))); } catch (e) { return defaultRules(); }
}

function saveRules(r) {
    const clean = cleanRules(r);
    const tmp = RULES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(clean, null, 2));
    fs.renameSync(tmp, RULES_FILE);
    return clean;
}
