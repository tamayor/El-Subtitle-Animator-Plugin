// Library actions invoked from the panel: creating presets (from files or the timeline), variants,
// editing, tags, ordering, removal / revert and per-preset sounds.

module.exports = {
    addAnimationFile, createCombo, draftFromTimeline, pickFile, removeAnimation, reorderAnimations,
    replaceAnimationFile, revertAnimation, saveAnimationVariant, saveSelectedAsAnimation, saveTags,
    setAnimationSfx, setDefaultSfx, updateAnimation
};

const path = require('path');
const fs = require('fs');
const { dialog } = require('electron');

const state = require('./state');
const { ANIM_DIR, ANIM_ORIG_DIR, DATA_DIR, PREV_DIR, SFX_DIR, ensureDirs } = require('./config');
const { copyFontsForSetting } = require('./fonts');
const { clearDesignCache, copyPreset, detectNodes, expandToolsInFile } = require('./fusion-setting');
const { libForUI, loadLib, newAnimation, saveLib, uniqueName } = require('./library');
const { capturePreview, exportSelectedClip, makePreview } = require('./previews');
const { pruneTemplates } = require('./placement');
const { findSelectedFusionItem } = require('./selection');
const { copySfx } = require('./sfx');

// "From timeline": takes the Text+ selected in Resolve RIGHT NOW (its animation file, its position/scale, and a looping
// preview of how it looks), so the Create tab keeps it even when the selection in Resolve changes afterwards.
let draftBusy = false;
async function draftFromTimeline(event, opts) {
    if (draftBusy) return { error: 'Still reading the clip - one moment' };
    draftBusy = true;
    try {
        const item = await findSelectedFusionItem();
        if (!item) return { error: 'Select the Text+ clip on your Resolve timeline first' };
        const DRAFT_DIR = path.join(DATA_DIR, 'draft');
        fs.mkdirSync(DRAFT_DIR, { recursive: true });
        // keep only the newest few snapshots
        try {
            const old = fs.readdirSync(DRAFT_DIR).filter(f => /\.comp$/.test(f)).map(f => ({ f, t: fs.statSync(path.join(DRAFT_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(5);
            for (const o of old) fs.rmSync(path.join(DRAFT_DIR, o.f), { force: true });
        } catch (e) { /* ignore */ }
        const file = path.join(DRAFT_DIR, 'timeline-' + Date.now() + '.comp');
        const compCount = Math.max(1, (await item.GetFusionCompCount()) || 1);
        const ok = await item.ExportFusionComp(file, compCount);
        if (!ok || !fs.existsSync(file)) return { error: "Resolve could not export that clip's animation" };
        expandToolsInFile(file);
        let props = null;
        try { if (typeof item.GetProperties === 'function') props = await item.GetProperties(); } catch (e) { /* ignore */ }
        const itemId = String(await item.GetUniqueId());
        let name = '';
        try { name = String(await item.GetName()); } catch (e) { /* ignore */ }
        const dir = path.join(PREV_DIR, '__draft');
        let preview = null, previewError = null;
        try {
            const r = await capturePreview('__draft', itemId, null, null, dir, { maxDim: Number(opts && opts.maxDim) > 0 ? Number(opts.maxDim) : 640 });
            preview = { count: r.preview.count, fps: r.preview.fps, stamp: r.preview.stamp, files: r.previewFiles, white: r.previewWhite };
        } catch (e) { previewError = String(e && e.message || e); }
        return { ok: true, path: file, props, itemId, name, preview, previewError };
    } finally { draftBusy = false; }
}

// The Create tab: a text animation (from the timeline or a dropped file) plus an optional sound.
async function createCombo(event, req) {
    const label = String(req.name || '').trim();
    if (!label) return { error: 'Give it a name first' };
    ensureDirs();
    let file, fromItem = null;
    let clipProps = null;
    if (req.fromSelection) {
        const ex = await exportSelectedClip(label);
        file = ex.file; fromItem = ex.itemId; clipProps = ex.props;
        try { copyPreset(path.join(ANIM_DIR, file), path.join(ANIM_ORIG_DIR, file)); } catch (e) {}
    } else if (req.animPath) {
        const ext = path.extname(req.animPath).toLowerCase();
        if (!['.comp', '.setting'].includes(ext)) return { error: 'The text animation must be a Fusion .comp or .setting file' };
        file = uniqueName(ANIM_DIR, label + ext);
        copyPreset(req.animPath, path.join(ANIM_DIR, file));
        try { copyPreset(req.animPath, path.join(ANIM_ORIG_DIR, file)); } catch (e) {}
    } else {
        return { error: 'Add the text animation first: drop a .comp file, or use the Text+ selected on your timeline' };
    }
    if (!clipProps && req.clipProps && typeof req.clipProps === 'object') clipProps = req.clipProps;   // read when "From timeline" was clicked
    const lib = loadLib();
    const a = newAnimation(label, file);
    if (clipProps) {
        if (clipProps.Pan !== undefined && !isNaN(Number(clipProps.Pan))) a.posX = Math.round(Number(clipProps.Pan) * 1000) / 1000;
        if (clipProps.Tilt !== undefined && !isNaN(Number(clipProps.Tilt))) a.posY = Math.round(Number(clipProps.Tilt) * 1000) / 1000;
        if (clipProps.ZoomX !== undefined && !isNaN(Number(clipProps.ZoomX))) a.scale = Math.round(Number(clipProps.ZoomX) * 1000) / 1000;
        if (clipProps.RotationAngle !== undefined && !isNaN(Number(clipProps.RotationAngle))) a.rotation = Math.round(Number(clipProps.RotationAngle) * 1000) / 1000;
    }
    if (req.sfxPath) {
        const origFile = copySfx(req.sfxPath);
        a.sfxOrig = origFile;
        a.sfx = origFile;
    }
    lib.animations.push(a);
    saveLib(lib);
    copyFontsForSetting(path.join(ANIM_DIR, a.file), a.textDesign).catch(() => {});
    if (fromItem) {
        try {
            await makePreview(null, a.id);
        } catch (e) {
            try { await capturePreview(a.id, fromItem); } catch (e2) { /* the preview is optional */ }
        }
    }
    return { lib: libForUI(), createdId: a.id };
}

async function saveSelectedAsAnimation(event, name) {
    const label = String(name || '').trim() || 'My animation';
    const ex = await exportSelectedClip(label);
    try { copyPreset(path.join(ANIM_DIR, ex.file), path.join(ANIM_ORIG_DIR, ex.file)); } catch (e) {}
    const lib = loadLib();
    const a = newAnimation(label, ex.file);
    if (ex.props) {
        if (ex.props.Pan !== undefined && !isNaN(Number(ex.props.Pan))) a.posX = Math.round(Number(ex.props.Pan) * 1000) / 1000;
        if (ex.props.Tilt !== undefined && !isNaN(Number(ex.props.Tilt))) a.posY = Math.round(Number(ex.props.Tilt) * 1000) / 1000;
        if (ex.props.ZoomX !== undefined && !isNaN(Number(ex.props.ZoomX))) a.scale = Math.round(Number(ex.props.ZoomX) * 1000) / 1000;
        if (ex.props.RotationAngle !== undefined && !isNaN(Number(ex.props.RotationAngle))) a.rotation = Math.round(Number(ex.props.RotationAngle) * 1000) / 1000;
    }
    lib.animations.push(a);
    saveLib(lib);
    copyFontsForSetting(path.join(ANIM_DIR, a.file), a.textDesign).catch(() => {});
    return { lib: libForUI() };
}

function addAnimationFile(event, p) {
    const ext = path.extname(p).toLowerCase();
    if (!['.comp', '.setting'].includes(ext)) return { error: 'Drop a Fusion .comp or .setting file' };
    ensureDirs();
    const file = uniqueName(ANIM_DIR, path.basename(p));
    copyPreset(p, path.join(ANIM_DIR, file));
    try { copyPreset(p, path.join(ANIM_ORIG_DIR, file)); } catch (e) {}
    const lib = loadLib();
    const a = newAnimation(path.basename(file, path.extname(file)), file);
    lib.animations.push(a);
    saveLib(lib);
    copyFontsForSetting(path.join(ANIM_DIR, a.file), a.textDesign).catch(() => {});
    return { lib: libForUI() };
}

function nextVersionName(baseName, animations) {
    const stem = String(baseName || 'Animation').trim().replace(/\s+v\d+$/i, '');
    const taken = new Set((animations || []).map(a => String(a.name || '').trim().toLowerCase()));
    let v = 2;
    while (taken.has((stem + ' v' + v).toLowerCase())) v++;
    return stem + ' v' + v;
}

function saveAnimationVariant(event, req) {
    ensureDirs();
    const lib = loadLib();
    const src = lib.animations.find(x => x.id === req.sourceId);
    if (!src) return { error: 'Source animation not found' };
    const newName = String(req.name || '').trim() || nextVersionName(src.name, lib.animations);
    const srcPath = path.join(ANIM_DIR, src.file);
    const ext = path.extname(src.file) || '.setting';
    const newFile = uniqueName(ANIM_DIR, newName + ext);
    if (fs.existsSync(srcPath)) {
        copyPreset(srcPath, path.join(ANIM_DIR, newFile));
        try { copyPreset(srcPath, path.join(ANIM_ORIG_DIR, newFile)); } catch (e) {}
    }
    let sfxOrigFile = src.sfxOrig || src.sfx || null;
    let sfxFile = src.sfx;
    if (req.sfxPath) {
        try {
            sfxOrigFile = copySfx(req.sfxPath);
            sfxFile = sfxOrigFile;
        } catch (e) { /* ignore */ }
    } else if (req.sfxOrig !== undefined) {
        sfxOrigFile = req.sfxOrig;
    } else if (req.sfx !== undefined) {
        sfxFile = req.sfx;
    }
    const newAnim = newAnimation(newName, newFile, {
        sfx: sfxFile,
        sfxOrig: sfxOrigFile,
        useSfx: req.useSfx !== undefined ? !!req.useSfx : src.useSfx !== false,
        linked: req.linked !== undefined ? !!req.linked : src.linked !== false,
        textOffset: req.textOffset !== undefined ? Number(req.textOffset) || 0 : src.textOffset,
        sfxOffset: req.sfxOffset !== undefined ? Number(req.sfxOffset) || 0 : src.sfxOffset,
        sfxLayers: Array.isArray(req.sfxLayers) ? JSON.parse(JSON.stringify(req.sfxLayers)) : (Array.isArray(src.sfxLayers) ? JSON.parse(JSON.stringify(src.sfxLayers)) : []),
        sfxVolume: req.sfxVolume !== undefined ? Number(req.sfxVolume) || 0 : src.sfxVolume,
        tail: req.tail !== undefined ? Number(req.tail) || 0 : src.tail,
        textTrack: req.textTrack !== undefined ? Number(req.textTrack) || 0 : src.textTrack,
        sfxTrack: req.sfxTrack !== undefined ? Number(req.sfxTrack) || 0 : src.sfxTrack,
        posX: req.posX !== undefined ? Number(req.posX) || 0 : (Number(src.posX) || 0),
        posY: req.posY !== undefined ? Number(req.posY) || 0 : (Number(src.posY) || 0),
        scale: req.scale !== undefined ? Number(req.scale) || 1 : (Number(src.scale) || 1),
        rotation: req.rotation !== undefined ? Number(req.rotation) || 0 : (Number(src.rotation) || 0),
        textDesign: req.textDesign || src.textDesign || null,
        boxes: JSON.parse(JSON.stringify(req.boxes || src.boxes || {})),
        preview: src.preview ? Object.assign({}, src.preview) : null
    });
    const srcPrevDir = path.join(PREV_DIR, src.id);
    if (fs.existsSync(srcPrevDir)) {
        try { fs.cpSync(srcPrevDir, path.join(PREV_DIR, newAnim.id), { recursive: true }); } catch (e) { /* ignore */ }
    }
    lib.animations.push(newAnim);
    saveLib(lib);
    copyFontsForSetting(path.join(ANIM_DIR, newAnim.file), newAnim.textDesign).catch(() => {});
    return { ok: true, lib: libForUI(), createdId: newAnim.id, createdName: newName };
}

function updateAnimation(event, id, patch) {
    const lib = loadLib();
    const a = lib.animations.find(x => x.id === id);
    if (!a) return { error: 'Animation not found' };
    const allowed = ['name', 'useSfx', 'linked', 'textOffset', 'sfxOffset', 'sfxTrimIn', 'sfxLen', 'sfxLenMode', 'sfxFade', 'sfxVolume', 'tail', 'textTrack', 'sfxTrack', 'posX', 'posY', 'scale', 'rotation', 'textDesign', 'boxes', 'tags', 'sfx', 'sfxOrig', 'sfxLayers'];
    for (const k of allowed) if (k in patch) a[k] = patch[k];
    if ('tags' in patch) {
        const known = new Set(lib.tags.map(t => t.id));
        a.tags = Array.isArray(a.tags) ? Array.from(new Set(a.tags)).filter(id => known.has(id)) : [];
    }
    saveLib(lib);
    if (patch.textDesign || a.textDesign) {
        copyFontsForSetting(path.join(ANIM_DIR, a.file), a.textDesign).catch(() => {});
    }
    return { lib: libForUI() };
}

// Tags (like Finder tags): a name and a color, kept in library.json inside the library folder.
// The panel sends the whole list; presets lose any tag that no longer exists.
function saveTags(event, tags) {
    const lib = loadLib();
    const seen = new Set();
    lib.tags = (Array.isArray(tags) ? tags : []).map(t => ({
        id: String((t && t.id) || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6))),
        name: String((t && t.name) || '').trim().slice(0, 40),
        color: /^#[0-9a-f]{6}$/i.test(String(t && t.color)) ? String(t.color).toLowerCase() : '#8e8e93'
    })).filter(t => t.name && !seen.has(t.id) && seen.add(t.id));
    for (const a of lib.animations) {
        if (Array.isArray(a.tags)) a.tags = a.tags.filter(id => seen.has(id));
    }
    saveLib(lib);
    return { lib: libForUI() };
}

// New order of the presets (a list of ids). Presets missing from the list keep their relative order at the end.
function reorderAnimations(event, ids) {
    const lib = loadLib();
    const byId = new Map(lib.animations.map(a => [a.id, a]));
    const out = [];
    for (const id of (Array.isArray(ids) ? ids : [])) {
        const a = byId.get(id);
        if (a) { out.push(a); byId.delete(id); }
    }
    for (const a of lib.animations) if (byId.has(a.id)) out.push(a);
    lib.animations = out;
    saveLib(lib);
    return { lib: libForUI() };
}

function removeAnimation(event, id) {
    const lib = loadLib();
    const a = lib.animations.find(x => x.id === id);
    if (a) {
        try { fs.unlinkSync(path.join(ANIM_DIR, a.file)); } catch (e) { /* ignore */ }
        if (a.fileOrig) {
            const otherUsesOrig = lib.animations.some(other => other.id !== a.id && (other.fileOrig === a.fileOrig || other.file === a.fileOrig));
            if (!otherUsesOrig) {
                try { fs.unlinkSync(path.join(ANIM_ORIG_DIR, a.fileOrig)); } catch (e) { /* ignore */ }
            }
        }
        // When deleting a text preset, delete the attached SFX too
        if (a.sfx) {
            try {
                const sfxPath = path.join(SFX_DIR, a.sfx);
                if (a.sfx !== a.sfxOrig || /-\d{8}[-_]\d{6}\.wav$/i.test(a.sfx)) {
                    if (fs.existsSync(sfxPath)) fs.rmSync(sfxPath, { force: true });
                } else {
                    const otherUses = lib.animations.some(other => other.id !== a.id && (other.sfx === a.sfx || other.sfxOrig === a.sfx));
                    const isDefault = lib.defaultSfx === a.sfx;
                    if (!otherUses && !isDefault) {
                        if (fs.existsSync(sfxPath)) fs.rmSync(sfxPath, { force: true });
                    }
                }
            } catch (e) { /* ignore */ }
        }
    }
    try { fs.rmSync(path.join(PREV_DIR, id), { recursive: true, force: true }); } catch (e) { /* ignore */ }
    lib.animations = lib.animations.filter(x => x.id !== id);
    saveLib(lib);
    pruneTemplates(lib.animations.map(x => path.join(ANIM_DIR, x.file)));      // its Resolve title template goes too
    return { lib: libForUI() };
}

function revertAnimation(event, id) {
    const lib = loadLib();
    const a = lib.animations.find(x => x.id === id);
    if (!a) return { error: 'Animation not found' };
    ensureDirs();

    const origFile = a.fileOrig || a.file;
    const origPath = path.join(ANIM_ORIG_DIR, origFile);
    const curPath = path.join(ANIM_DIR, a.file);

    // 1. Restore the original .setting / .comp file contents if present
    if (fs.existsSync(origPath)) {
        try {
            copyPreset(origPath, curPath);
        } catch (e) {
            return { error: 'Failed to restore original file: ' + e.message };
        }
    }

    // 2. Clean up any trimmed audio file attached to this preset that was not the original
    if (a.sfx && a.sfxOrig && a.sfx !== a.sfxOrig) {
        try {
            const trimmedPath = path.join(SFX_DIR, a.sfx);
            if (fs.existsSync(trimmedPath)) fs.rmSync(trimmedPath, { force: true });
        } catch (e) { /* ignore */ }
    }

    // 3. Restore metadata
    const snap = a.orig;
    if (snap) {
        a.name = snap.name || a.name;
        a.textDesign = snap.textDesign ? JSON.parse(JSON.stringify(snap.textDesign)) : null;
        a.boxes = snap.boxes ? JSON.parse(JSON.stringify(snap.boxes)) : {};
        a.posX = snap.posX || 0;
        a.posY = snap.posY || 0;
        a.scale = snap.scale !== undefined ? snap.scale : 1;
        a.rotation = snap.rotation || 0;
        a.textOffset = snap.textOffset || 0;
        a.sfxOffset = snap.sfxOffset || 0;
        a.sfxTrimIn = 0;
        a.sfxLen = 0;
        a.tail = snap.tail || 0;
        a.sfxVolume = snap.sfxVolume || 0;
        a.textTrack = snap.textTrack || 0;
        a.sfxTrack = snap.sfxTrack || 0;
        a.useSfx = snap.useSfx !== false;
        a.linked = snap.linked !== false;
        a.sfx = snap.sfxOrig || snap.sfx || a.sfxOrig || null;
        a.sfxOrig = snap.sfxOrig || a.sfxOrig || null;
    } else {
        a.textDesign = null;
        a.boxes = {};
        a.posX = 0; a.posY = 0; a.scale = 1; a.rotation = 0;
        a.textOffset = 0; a.sfxOffset = 0; a.sfxTrimIn = 0; a.sfxLen = 0; a.tail = 0;
        a.sfxVolume = 0;
        a.sfx = a.sfxOrig || null;
    }

    clearDesignCache();
    saveLib(lib);

    try {
        fs.rmSync(path.join(PREV_DIR, a.id), { recursive: true, force: true });
        a.preview = null;
    } catch (e) { /* ignore */ }

    copyFontsForSetting(curPath, a.textDesign).catch(() => {});

    return { ok: true, lib: libForUI(), revertedId: a.id };
}

function setDefaultSfx(event, p) {
    const lib = loadLib();
    lib.defaultSfx = p ? copySfx(p) : null;
    saveLib(lib);
    return { lib: libForUI() };
}

function setAnimationSfx(event, id, p) {
    const lib = loadLib();
    const a = lib.animations.find(x => x.id === id);
    if (!a) return { error: 'Animation not found' };
    if (a.sfx && a.sfxOrig && a.sfx !== a.sfxOrig) {
        try { fs.rmSync(path.join(SFX_DIR, a.sfx), { force: true }); } catch (e) { /* ignore */ }
    }
    if (!p) {
        a.sfx = null;
        a.sfxOrig = null;
    } else {
        const file = copySfx(p);
        a.sfxOrig = file;
        a.sfx = file;
    }
    saveLib(lib);
    return { lib: libForUI() };
}

// Swap the Fusion .comp/.setting attached to a preset. Text and positions are carried over when the new file has
// the same number of text boxes (matched by order).
function replaceAnimationFile(event, id, p, keep) {
    const ext = path.extname(String(p || '')).toLowerCase();
    if (!['.comp', '.setting'].includes(ext)) return { error: 'Pick a Fusion .comp or .setting file' };
    if (!fs.existsSync(p)) return { error: 'That file does not exist' };
    ensureDirs();
    const lib = loadLib();
    const a = lib.animations.find(x => x.id === id);
    if (!a) return { error: 'Animation not found' };
    const oldPath = path.join(ANIM_DIR, a.file);
    const oldNodes = fs.existsSync(oldPath) ? detectNodes(oldPath) : [];
    const newFile = uniqueName(ANIM_DIR, path.basename(p));
    copyPreset(p, path.join(ANIM_DIR, newFile));
    const newNodes = detectNodes(path.join(ANIM_DIR, newFile));
    let kept = false;
    if (keep !== false && a.boxes && oldNodes.length && oldNodes.length === newNodes.length) {
        const remap = {};
        oldNodes.forEach((n, i) => {
            if (a.boxes[n.id]) remap[newNodes[i].id] = Object.assign({}, a.boxes[n.id]);
        });
        a.boxes = remap;
        kept = true;
    } else {
        a.boxes = {};
    }
    if (!lib.animations.some(x => x !== a && x.file === a.file)) { try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ } }
    a.file = newFile;
    a.textDesign = null;   // the new file's own design takes over
    a.preview = null;
    try { fs.rmSync(path.join(PREV_DIR, a.id), { recursive: true, force: true }); } catch (e) { /* ignore */ }
    saveLib(lib);
    pruneTemplates(lib.animations.map(x => path.join(ANIM_DIR, x.file)));      // the old file's title template goes
    copyFontsForSetting(path.join(ANIM_DIR, a.file), null).catch(() => {});
    return { ok: true, lib: libForUI(), kept, oldCount: oldNodes.length, newCount: newNodes.length };
}

async function pickFile(event, kind) {
    const filters = kind === 'sfx'
        ? [{ name: 'Audio', extensions: ['wav', 'mp3', 'aif', 'aiff', 'm4a', 'flac', 'ogg'] }]
        : [{ name: 'Fusion comp / setting', extensions: ['comp', 'setting'] }];
    const r = await dialog.showOpenDialog(state.mainWindow, { properties: ['openFile'], filters });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
}
