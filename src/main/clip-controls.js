// The Use tab's Clip controls: a preset's own add-ons (Box Width / Height / X / Y, Highlight Color, Row Gap / Justify /
// X / Y, Text In Pill Colour, Kinetic settings...) for the clip the user is working on, edited from the panel. They are
// hidden in Resolve's Inspector (addon-controls.js hideAddons), so this is where they live now. Which controls show is
// read from the clip's title template (its name is the clip's name), so every preset gets its own set automatically.
// The timing sliders are left to the timing bar (anim-timing.js), which re-keys segment letters when they change.

module.exports = { clipControls, setClipControls, clipRows, setClipRows, setClipGradient, gradientsOf };

const fs = require('fs');
const path = require('path');

const state = require('./state');
const { ANIM_DIR } = require('./config');
const { parseAddons } = require('./addon-controls');
const { currentFusionClip } = require('./anim-timing');
const { bridgeCall } = require('./fusion-bridge');
const { loadLib } = require('./library');
const { presetTitleNames, titlesDir } = require('./title-templates');

const cache = new Map();    // file -> { mtime, defs }

function defsFromFile(file, unhide) {
    let st;
    try { st = fs.statSync(file); } catch (e) { return null; }
    const c = cache.get(file);
    if (c && c.mtime === st.mtimeMs) return c.defs;
    let s = fs.readFileSync(file, 'utf8');
    // the template marks every add-on hidden right after its "{" (hideAddons); the preset's own hidden ones say so later
    if (unhide) s = s.replace(/\{ IC_Visible = false,/g, '{');
    const defs = parseAddons(s);
    cache.set(file, { mtime: st.mtimeMs, defs });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return defs;
}

// The clip's add-ons: from its title template (named like the clip), else from the library preset of that name.
function defsFor(clipName) {
    const name = String(clipName || '').trim();
    if (!name || /[/\\]/.test(name)) return [];
    const fromTpl = defsFromFile(path.join(titlesDir(), name + '.setting'), true);
    if (fromTpl) return fromTpl;
    try {
        const lib = loadLib();
        for (const [id, tname] of presetTitleNames(lib.animations)) {
            if (tname.toLowerCase() !== name.toLowerCase()) continue;
            const a = lib.animations.find(x => x.id === id);
            const d = a && defsFromFile(path.join(ANIM_DIR, a.file), false);
            if (d) return d;
        }
    } catch (e) { /* no library */ }
    return [];
}

// ---- Gradient fills
// A Text+ element whose shading is a gradient (TypeN = 2 with a ShadingGradientN table), read from the clip's title
// template / library preset file, never from the placed comp: a script read of a follower-fed Text+ (Money Pop Up,
// $123,456) can freeze Resolve. -> [{ tool, index, angle, stops: [[pos, '#rrggbb', alpha], ...] }]
const gradCache = new Map();    // file -> { mtime, grads }

function braceBlock(s, from) {
    const open = s.indexOf('{', from);
    if (open < 0) return '';
    let depth = 0;
    for (let i = open; i < s.length; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}' && --depth === 0) return s.slice(open, i + 1);
    }
    return '';
}
const hex2 = v => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 255).toString(16).padStart(2, '0');

function gradientsOf(text) {
    const out = [];
    const re = /(\w+)\s*=\s*TextPlus\s*\{/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const tool = m[1], block = braceBlock(text, m.index);
        for (let i = 1; i <= 8; i++) {
            if (!new RegExp('\\bType' + i + '\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*2\\b').test(block)) continue;
            const gi = block.search(new RegExp('\\bShadingGradient' + i + '\\s*=\\s*Input'));
            if (gi < 0) continue;
            const gb = braceBlock(block, gi);
            if (/SourceOp\s*=/.test(gb)) continue;     // animated / connected gradient: not a plain edit
            const stops = [];
            const sre = /\[\s*([\d.eE+-]+)\s*\]\s*=\s*\{\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*(?:,\s*([\d.eE+-]+))?/g;
            let sm;
            while ((sm = sre.exec(gb)) !== null) {
                stops.push([Number(sm[1]), '#' + hex2(sm[2]) + hex2(sm[3]) + hex2(sm[4]), sm[5] != null ? Number(sm[5]) : 1]);
            }
            if (stops.length < 2) continue;
            stops.sort((a, b) => a[0] - b[0]);
            const am = new RegExp('\\bShadingMappingAngle' + i + '\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*([\\d.eE+-]+)').exec(block);
            out.push({ tool, index: i, angle: am ? Number(am[1]) : null, stops });
        }
    }
    return out;
}
function gradFromFile(file) {
    let st;
    try { st = fs.statSync(file); } catch (e) { return null; }
    const c = gradCache.get(file);
    if (c && c.mtime === st.mtimeMs) return c.grads;
    const grads = gradientsOf(fs.readFileSync(file, 'utf8'));
    gradCache.set(file, { mtime: st.mtimeMs, grads });
    if (gradCache.size > 100) gradCache.delete(gradCache.keys().next().value);
    return grads;
}
function gradsFor(clipName) {
    const name = String(clipName || '').trim();
    if (!name || /[/\\]/.test(name)) return [];
    const fromTpl = gradFromFile(path.join(titlesDir(), name + '.setting'));
    if (fromTpl) return fromTpl;
    try {
        const lib = loadLib();
        for (const [id, tname] of presetTitleNames(lib.animations)) {
            if (tname.toLowerCase() !== name.toLowerCase()) continue;
            const a = lib.animations.find(x => x.id === id);
            const g = a && gradFromFile(path.join(ANIM_DIR, a.file));
            if (g) return g;
        }
    } catch (e) { /* no library */ }
    return [];
}

function idsOf(defs) {
    const ids = [];
    for (const d of defs) {
        if (d.kind === 'header') continue;
        if (d.kind === 'color') ids.push(...d.ids.filter(Boolean));
        else ids.push(d.id);
    }
    return ids;
}

// The library preset a clip was placed from (its title template name is the clip's name) -> id or null.
function presetIdFor(clipName) {
    const name = String(clipName || '').trim().toLowerCase();
    if (!name) return null;
    try {
        for (const [id, tname] of presetTitleNames(loadLib().animations)) if (String(tname).toLowerCase() === name) return id;
    } catch (e) { /* no library */ }
    return null;
}

async function clipControls() {
    if (state.applying || require('./resolve-load').resolveBusy()) return { ok: false, busy: true };
    try {
        const c = await currentFusionClip();
        if (!c) return { ok: true, none: true };
        const presetId = presetIdFor(c.name);
        const frames = (Number(c.end) > Number(c.start)) ? Number(c.end) - Number(c.start) : null;
        const controls = defsFor(c.name);
        const gradient = gradsFor(c.name);
        if (!controls.length) return { ok: true, itemId: c.itemId, name: c.name, selected: !!c.selected, presetId, frames, controls: [], values: {}, gradient };
        const ids = idsOf(controls);
        // MultiText rows: the hidden UE / EL read-outs are the gaps as rendered (the panel links them to Upper / Lower Y)
        if (ids.includes('RowsSetUE')) ids.push('RowsGapUE', 'RowsGapEL');
        const r = await bridgeCall('controls_get', { item: c.itemId, ids }, 5000);
        return {
            ok: true, itemId: c.itemId, name: c.name, selected: !!c.selected, presetId, frames, controls, values: (r && r.values) || {}, gradient,
            frameHeight: (r && Number(r.frameHeight)) || null
        };
    } catch (e) {
        return { ok: false, reason: String(e && e.message || e) };
    }
}

// values: { inputId: number }
async function setClipControls(event, itemId, values) {
    if (state.applying) return { busy: true };
    if (!itemId || !values || typeof values !== 'object') return { error: 'Nothing to set' };
    const clean = {};
    for (const [k, v] of Object.entries(values)) {
        if (/^[A-Za-z_]\w*$/.test(k) && Number.isFinite(Number(v))) clean[k] = Number(v);
    }
    return await bridgeCall('controls_set', { item: String(itemId), values: clean }, 5000);
}

// Writes a gradient fill on the clip: tool + element index, stops [[pos, '#rrggbb', alpha], ...] (the whole table,
// as Fusion keeps it). Write-only: nothing is read back from the follower-fed Text+.
async function setClipGradient(event, itemId, tool, index, stops) {
    if (state.applying) return { busy: true };
    const i = Math.round(Number(index));
    if (!itemId || !/^[A-Za-z_]\w*$/.test(String(tool || '')) || !(i >= 1 && i <= 8) || !Array.isArray(stops)) return { error: 'Nothing to set' };
    const clean = [];
    for (const s of stops.slice(0, 32)) {
        const m = Array.isArray(s) && /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(s[1] || ''));
        const pos = Number(s && s[0]);
        if (!m || !Number.isFinite(pos)) continue;
        const a = Number.isFinite(Number(s[2])) ? Math.max(0, Math.min(1, Number(s[2]))) : 1;
        clean.push([Math.max(0, Math.min(1, pos)), ...[1, 2, 3].map(k => parseInt(m[k], 16) / 255), a]);
    }
    if (clean.length < 2) return { error: 'A gradient needs two colours' };
    return await bridgeCall('gradient_set', { item: String(itemId), tool: String(tool), index: i, stops: clean }, 5000);
}

// ---- MultiText split of a placed clip (the Upper / Emphasize / Lower splitter in Clip controls)
// Row texts are read inside the bridge (through the row's follower, like the timing read), never by a Resolve script:
// a script read of a follower-driven text freezes Resolve.
async function clipRows(event, itemId) {
    if (state.applying) return { busy: true };
    if (!itemId) return { error: 'No clip' };
    return await bridgeCall('mt_rows_get', { item: String(itemId) }, 5000);
}

// texts: { rowNumber: text }; frames: the clip's length (a row left alone moves to the clip start and is re-fitted)
async function setClipRows(event, itemId, texts, frames) {
    if (state.applying) return { busy: true };
    if (!itemId || !texts || typeof texts !== 'object') return { error: 'Nothing to set' };
    const clean = {};
    for (const [k, v] of Object.entries(texts)) if (/^\d+$/.test(k) && typeof v === 'string') clean[k] = v;
    const f = Math.round(Number(frames));
    return await bridgeCall('mt_rows_set', { item: String(itemId), texts: clean, clipFrames: f > 0 ? f : null }, 5000);
}
