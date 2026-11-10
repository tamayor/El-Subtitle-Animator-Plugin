// A preset's own Inspector add-ons: the UserControls of its "Template" tool (Box Width / Height / X / Y, Highlight
// Color, Row Gap / Justify / X / Y, Text In Pill Colour, Kinetic settings, the timing sliders...).
//
// They are edited from the panel's Clip controls (src/main/clip-controls.js), not in Resolve's Inspector: the timing
// sliders there could not re-key the letters on their own, and the user wanted every add-on in one place. So
// hideAddons() marks them IC_Visible = false in the title template written for placement (presetTitleFor), and
// parseAddons() reads their definitions from the preset file so the panel can draw them. Only the Template tool's
// controls are touched: controls inside a preset's own macros (e.g. the wiggle presets' NoiseDistortion group) stay.

module.exports = { hideAddons, parseAddons };

const { blockEnd } = require('./fusion-setting');

// [{ open, close }] of each UserControls entry (ID = { ... }) of the Template tool, plus the block itself.
function templateControls(s) {
    const tm = /\n\s*Template\s*=\s*[A-Za-z_][\w.]*\s*\{/.exec(s);
    if (!tm) return null;
    const tOpen = tm.index + tm[0].length - 1, tClose = blockEnd(s, tOpen);
    const um = /\bUserControls\s*=\s*ordered\(\)\s*\{/g;
    um.lastIndex = tOpen;
    const u = um.exec(s);
    if (!u || u.index > tClose) return null;
    const uOpen = u.index + u[0].length - 1, uClose = blockEnd(s, uOpen);
    const entries = [];
    const re = /([A-Za-z_]\w*)\s*=\s*\{/y;
    let i = uOpen + 1;
    while (i < uClose) {
        while (i < uClose && /[\s,]/.test(s[i])) i++;
        if (i >= uClose) break;
        re.lastIndex = i;
        const m = re.exec(s);
        if (!m) break;
        const open = i + m[0].length - 1, close = blockEnd(s, open);
        entries.push({ id: m[1], open, close });
        i = close + 1;
    }
    return entries;
}

function hideAddons(s) {
    const entries = templateControls(s);
    if (!entries || !entries.length) return s;
    let out = s;
    for (const e of entries.slice().reverse()) {          // from the end, so earlier offsets stay valid
        const body = s.slice(e.open + 1, e.close);
        if (/\bIC_Visible\s*=/.test(body)) continue;
        out = out.slice(0, e.open + 1) + ' IC_Visible = false,' + out.slice(e.open + 1);
    }
    return out;
}

function str(body, key) {
    const m = new RegExp('\\b' + key + '\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(body);
    return m ? m[1].replace(/\\"/g, '"') : null;
}
function numOf(body, key) {
    const m = new RegExp('\\b' + key + '\\s*=\\s*(-?[\\d.]+(?:e-?\\d+)?)').exec(body);
    return m ? Number(m[1]) : null;
}

// Controls the panel already edits elsewhere (the timing bar) or that are internal read-outs.
const SKIP = /^(Seg\d+(Start|End)|AnimStart|AnimFrames|AnimNatural|TypingStart|TypingFrames)$/;

// The visible add-ons in Inspector order: { id, kind: 'header' | 'slider' | 'check' | 'combo' | 'color', label, ... }.
// Colour controls (one ColorControl group of R / G / B inputs) come as one item with ids [r, g, b].
function parseAddons(s) {
    const entries = templateControls(s) || [];
    const out = [];
    const colors = new Map();
    for (const e of entries) {
        const b = s.slice(e.open + 1, e.close);
        if (/\bIC_Visible\s*=\s*false/.test(b) || SKIP.test(e.id)) continue;
        const ctl = str(b, 'INPID_InputControl') || 'SliderControl';
        const label = str(b, 'LINKS_Name') || e.id;
        const tip = str(b, 'INPS_StatusText') || '';
        if (ctl === 'LabelControl') { out.push({ id: e.id, kind: 'header', label }); continue; }
        if (ctl === 'ColorControl') {
            const g = numOf(b, 'IC_ControlGroup') || 0, k = numOf(b, 'IC_ControlID') || 0;
            let c = colors.get(g);
            if (!c) { c = { id: e.id, kind: 'color', label, tip, ids: [], defs: [] }; colors.set(g, c); out.push(c); }
            if (k === 0 && label !== e.id) c.label = label;
            c.ids[k] = e.id;
            c.defs[k] = numOf(b, 'INP_Default') ?? 0;
            continue;
        }
        const def = numOf(b, 'INP_Default') ?? 0;
        const integer = /\bINP_Integer\s*=\s*true/.test(b);
        if (ctl === 'CheckboxControl') { out.push({ id: e.id, kind: 'check', label, tip, def }); continue; }
        if (ctl === 'ComboControl' || ctl === 'MultiButtonControl') {
            const options = [...b.matchAll(/\b(?:CCS_AddString|MBTNC_AddButton)\s*=\s*"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
            out.push({ id: e.id, kind: 'combo', label, tip, def, options });
            continue;
        }
        if (ctl === 'ButtonControl') continue;                   // runs a script in Fusion: nothing to set
        const minScale = numOf(b, 'INP_MinScale'), maxScale = numOf(b, 'INP_MaxScale');
        const minAllowed = numOf(b, 'INP_MinAllowed'), maxAllowed = numOf(b, 'INP_MaxAllowed');
        out.push({
            id: e.id, kind: 'slider', label, tip, def, integer,
            min: minScale ?? 0, max: maxScale ?? 1,
            minAllowed: minAllowed ?? -1e6, maxAllowed: maxAllowed ?? 1e6
        });
    }
    // a header with nothing under it (e.g. all its controls were skipped) is dropped
    return out.filter((x, i) => x.kind !== 'header' || (out[i + 1] && out[i + 1].kind !== 'header'));
}
