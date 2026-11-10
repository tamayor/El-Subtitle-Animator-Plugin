// The Use tab's Clip controls: a preset's own add-ons (Box Width / Height / X / Y, Highlight Color, Row Gap / Justify /
// X / Y, Text In Pill Colour, Kinetic settings...) for the clip the user is working on, edited from the panel. They are
// hidden in Resolve's Inspector (addon-controls.js hideAddons), so this is where they live now. Which controls show is
// read from the clip's title template (its name is the clip's name), so every preset gets its own set automatically.
// The timing sliders are left to the timing bar (anim-timing.js), which re-keys segment letters when they change.

module.exports = { clipControls, setClipControls };

const fs = require('fs');
const path = require('path');

const state = require('./state');
const { ANIM_DIR } = require('./config');
const { parseAddons } = require('./addon-controls');
const { currentFusionClip } = require('./anim-timing');
const { bridgeCall } = require('./fusion-bridge');
const { loadLib } = require('./library');
const { presetTitleNames, titlesDir } = require('./placement');

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

function idsOf(defs) {
    const ids = [];
    for (const d of defs) {
        if (d.kind === 'header') continue;
        if (d.kind === 'color') ids.push(...d.ids.filter(Boolean));
        else ids.push(d.id);
    }
    return ids;
}

async function clipControls() {
    if (state.applying) return { ok: false, busy: true };
    try {
        const c = await currentFusionClip();
        if (!c) return { ok: true, none: true };
        const controls = defsFor(c.name);
        if (!controls.length) return { ok: true, itemId: c.itemId, name: c.name, controls: [], values: {} };
        const ids = idsOf(controls);
        // MultiText rows: the hidden UE / EL read-outs are the gaps as rendered (the panel links them to Upper / Lower Y)
        if (ids.includes('RowsSetUE')) ids.push('RowsGapUE', 'RowsGapEL');
        const r = await bridgeCall('controls_get', { item: c.itemId, ids }, 5000);
        return {
            ok: true, itemId: c.itemId, name: c.name, selected: !!c.selected, controls, values: (r && r.values) || {},
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
