// The Use tab's Clip controls: a preset's own add-ons (Box Width / Height / X / Y, Highlight Color, Row Gap / Justify /
// X / Y, Text In Pill Colour, Kinetic settings...) for the clip the user is working on, edited from the panel. They are
// hidden in Resolve's Inspector (addon-controls.js hideAddons), so this is where they live now. Which controls show is
// read from the clip's title template (its name is the clip's name), so every preset gets its own set automatically.
// The timing sliders are left to the timing bar (anim-timing.js), which re-keys segment letters when they change.

module.exports = { clipControls, setClipControls, clipRows, setClipRows };

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
    if (state.applying) return { ok: false, busy: true };
    try {
        const c = await currentFusionClip();
        if (!c) return { ok: true, none: true };
        const presetId = presetIdFor(c.name);
        const frames = (Number(c.end) > Number(c.start)) ? Number(c.end) - Number(c.start) : null;
        const controls = defsFor(c.name);
        if (!controls.length) return { ok: true, itemId: c.itemId, name: c.name, selected: !!c.selected, presetId, frames, controls: [], values: {} };
        const ids = idsOf(controls);
        // MultiText rows: the hidden UE / EL read-outs are the gaps as rendered (the panel links them to Upper / Lower Y)
        if (ids.includes('RowsSetUE')) ids.push('RowsGapUE', 'RowsGapEL');
        const r = await bridgeCall('controls_get', { item: c.itemId, ids }, 5000);
        return {
            ok: true, itemId: c.itemId, name: c.name, selected: !!c.selected, presetId, frames, controls, values: (r && r.values) || {},
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
