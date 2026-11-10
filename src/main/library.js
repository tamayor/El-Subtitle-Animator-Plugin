// The preset library on disk (library.json): creating, migrating, loading and saving entries,
// and the shape sent to the panel (libForUI).

module.exports = {
    libForUI, loadLib, newAnimation, saveLib, uniqueName
};

const path = require('path');
const fs = require('fs');

const { ANIM_DIR, ANIM_ORIG_DIR, DATA_DIR, LIB_FILE, PREV_DIR, SFX_DIR, SFX_ORIG_DIR, ensureDirs } = require('./config');
const { nodesWithDesign, parseTextStyle } = require('./fusion-setting');
const { frameList } = require('./previews');
const { listSfxOriginals, migrateSfxOriginals, sfxFilePath } = require('./sfx');

function newAnimation(name, file, defaults) {
    const fileOrig = (defaults && defaults.fileOrig) || file;
    const origSnapshot = (defaults && defaults.orig) ? JSON.parse(JSON.stringify(defaults.orig)) : {
        name: name,
        file: fileOrig,
        textDesign: (defaults && defaults.textDesign) ? JSON.parse(JSON.stringify(defaults.textDesign)) : null,
        boxes: (defaults && defaults.boxes) ? JSON.parse(JSON.stringify(defaults.boxes)) : {},
        sfxLayers: (defaults && Array.isArray(defaults.sfxLayers)) ? JSON.parse(JSON.stringify(defaults.sfxLayers)) : [],
        posX: defaults && defaults.posX !== undefined ? defaults.posX : 0,
        posY: defaults && defaults.posY !== undefined ? defaults.posY : 0,
        scale: defaults && defaults.scale !== undefined ? defaults.scale : 1,
        rotation: defaults && defaults.rotation !== undefined ? defaults.rotation : 0,
        textOffset: defaults && defaults.textOffset !== undefined ? defaults.textOffset : 0,
        sfxOffset: defaults && defaults.sfxOffset !== undefined ? defaults.sfxOffset : 0,
        sfxVolume: defaults && defaults.sfxVolume !== undefined ? defaults.sfxVolume : 0,
        tail: defaults && defaults.tail !== undefined ? defaults.tail : 0,
        textTrack: defaults && defaults.textTrack !== undefined ? defaults.textTrack : 0,
        sfxTrack: defaults && defaults.sfxTrack !== undefined ? defaults.sfxTrack : 0,
        useSfx: defaults && defaults.useSfx !== undefined ? defaults.useSfx : true,
        linked: defaults && defaults.linked !== undefined ? defaults.linked : true,
        sfx: (defaults && defaults.sfx) || null,
        sfxOrig: (defaults && defaults.sfxOrig) || (defaults && defaults.sfx) || null
    };

    return Object.assign({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: name,
        file: file,          // file name inside presets/current/
        fileOrig: fileOrig,  // preserved original template file inside presets/original/
        orig: origSnapshot,  // original baseline settings to revert to
        sfx: null,           // current attached audio: an edited clip inside sounds/current/, or the original (= sfxOrig) while unedited
        sfxOrig: null,       // preserved original audio file inside sounds/original/
        useSfx: true,
        preview: null,       // { count, step, fps } once frames have been captured for the preview
        linked: true,        // moving the text on the alignment timeline carries the sound with it
        textOffset: 0,     // frames: move the text start earlier (-) or later (+) than the subtitle
        sfxOffset: 0,        // frames: SFX start relative to the text start
        sfxVolume: 0,        // dB
        tail: 0,             // frames: keep the text on screen after the subtitle ends
        textTrack: 0,        // 0 = automatic free track
        sfxTrack: 0,         // 0 = automatic free audio track
        posX: 0,             // normalized horizontal offset (-1..1, 0 = center)
        posY: 0,             // normalized vertical offset (-1..1, 0 = center, + = down on screen)
        scale: 1,            // scale factor (1 = 100%)
        rotation: 0,         // rotation angle in degrees (clockwise on screen)
        boxes: {}            // per text box (Text+ / template) settings, keyed by detected node id: { mode, text, cx, cy, scale }
    }, defaults || {});
}

let libMigratedOnce = false;
function migrateAndCleanLib(lib) {
    if (!lib || !Array.isArray(lib.animations)) return;
    ensureDirs();
    migrateSfxOriginals();      // originals used to sit in sounds/current/ next to the edited clips
    let changed = false;
    for (const a of lib.animations) {
        if (a.file) {
            const curPath = path.join(ANIM_DIR, a.file);
            const origFile = a.fileOrig || a.file;
            const origPath = path.join(ANIM_ORIG_DIR, origFile);
            if (!a.fileOrig) {
                a.fileOrig = origFile;
                changed = true;
            }
            if (!fs.existsSync(origPath) && fs.existsSync(curPath)) {
                try {
                    fs.copyFileSync(curPath, origPath);
                    changed = true;
                } catch (e) { /* ignore */ }
            }
            if (!a.orig) {
                a.orig = {
                    name: a.name,
                    file: a.fileOrig || a.file,
                    textDesign: a.textDesign ? JSON.parse(JSON.stringify(a.textDesign)) : null,
                    boxes: a.boxes ? JSON.parse(JSON.stringify(a.boxes)) : {},
                    posX: a.posX || 0,
                    posY: a.posY || 0,
                    scale: a.scale !== undefined ? a.scale : 1,
                    rotation: a.rotation || 0,
                    textOffset: a.textOffset || 0,
                    sfxOffset: a.sfxOffset || 0,
                    sfxVolume: a.sfxVolume || 0,
                    tail: a.tail || 0,
                    textTrack: a.textTrack || 0,
                    sfxTrack: a.sfxTrack || 0,
                    useSfx: a.useSfx !== false,
                    linked: a.linked !== false,
                    sfx: a.sfxOrig || a.sfx || null,
                    sfxOrig: a.sfxOrig || a.sfx || null
                };
                changed = true;
            }
        }
        if (!a.sfxOrig && a.sfx) {
            const ext = path.extname(a.sfx);
            const stem = path.basename(a.sfx, ext);
            const trimMatch = stem.match(/^(.+?)-(\d{8}[-_]\d{6})$/);
            if (trimMatch) {
                const origStem = trimMatch[1];
                for (const e of ['.mp3', '.wav', '.m4a', '.aif', '.aiff', '.flac', '.ogg']) {
                    if (fs.existsSync(path.join(SFX_ORIG_DIR, origStem + e))) {
                        a.sfxOrig = origStem + e;
                        changed = true;
                        break;
                    }
                }
            } else {
                const cleanStem = stem.replace(/(\s+\d+)+$/, '');
                if (cleanStem !== stem && fs.existsSync(path.join(SFX_ORIG_DIR, cleanStem + ext))) {
                    a.sfxOrig = cleanStem + ext;
                    a.sfx = cleanStem + ext;
                    changed = true;
                } else {
                    a.sfxOrig = a.sfx;
                    changed = true;
                }
            }
        }
    }
    if (changed) {
        try {
            const tmp = LIB_FILE + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(lib, null, 2));
            fs.renameSync(tmp, LIB_FILE);
        } catch (e) { /* ignore */ }
    }
    // Clean up orphaned "name 2.mp3" duplicates of originals
    try {
        const inUse = new Set();
        if (lib.defaultSfx) inUse.add(lib.defaultSfx);
        for (const a of lib.animations) {
            if (a.sfx) inUse.add(a.sfx);
            if (a.sfxOrig) inUse.add(a.sfxOrig);
        }
        for (const a of lib.animations) for (const l of (Array.isArray(a.sfxLayers) ? a.sfxLayers : [])) if (l && l.file) inUse.add(l.file);
        for (const file of fs.readdirSync(SFX_ORIG_DIR)) {
            if (inUse.has(file)) continue;
            const ext = path.extname(file);
            const stem = path.basename(file, ext);
            const cleanStem = stem.replace(/(\s+\d+)+$/, '');
            if (cleanStem !== stem && fs.existsSync(path.join(SFX_ORIG_DIR, cleanStem + ext))) {
                try { fs.rmSync(path.join(SFX_ORIG_DIR, file), { force: true }); } catch (e) { /* ignore */ }
            }
        }
    } catch (e) { /* ignore */ }
}

// The library file (hundreds of KB) is asked for by most actions. Its text is kept with the file's size and
// modification time, so an unchanged file is not read from disk again; it is still parsed each time, so every
// caller gets its own copy to change.
// The parsed object is kept too (libRaw.parsed) and every caller gets a structuredClone of it: parsing 337 KB of
// JSON on every one of the dozens of calls per action was a visible part of each action's time.
const libRaw = { key: '', raw: null, parsed: null };
function readLibRaw() {
    let st = null;
    try { st = fs.statSync(LIB_FILE); } catch (e) { libRaw.key = ''; libRaw.raw = null; libRaw.parsed = null; return null; }
    const key = st.size + ':' + st.mtimeMs;
    if (libRaw.key === key && libRaw.raw !== null) return libRaw.raw;
    let raw = null;
    try { raw = fs.readFileSync(LIB_FILE, 'utf8'); } catch (e) { raw = null; }
    libRaw.key = raw === null ? '' : key; libRaw.raw = raw; libRaw.parsed = null;
    return raw;
}
// The library file as an object (shared, never handed out: callers clone), or null when it cannot be read.
function readLibParsed() {
    const raw = readLibRaw();
    if (raw === null) return null;
    if (libRaw.parsed) return libRaw.parsed;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    libRaw.parsed = parsed;
    return parsed;
}
const segCache = new Map();      // segmentsOf: preset file -> { mt, list }
let dirsEnsured = false;
function loadLib() {
    if (!dirsEnsured) { ensureDirs(); dirsEnsured = true; }
    let lib = { defaultSfx: null, alwaysOnTop: true, animations: [], tags: [] };
    const raw = readLibRaw();
    if (raw !== null) {
        let parsed = readLibParsed();
        if (!parsed) {
            // Damaged file: keep it for inspection and fall back to the last good copy instead of starting empty.
            try { fs.copyFileSync(LIB_FILE, LIB_FILE + '.corrupt-' + Date.now()); } catch (e) { /* ignore */ }
            try { parsed = JSON.parse(fs.readFileSync(LIB_FILE + '.bak', 'utf8')); } catch (e) { parsed = null; }
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                try { fs.copyFileSync(LIB_FILE + '.bak', LIB_FILE); } catch (e) { /* ignore */ }
            } else parsed = null;
        }
        if (parsed) lib = Object.assign(lib, structuredClone(parsed));
    }
    if (!Array.isArray(lib.animations)) lib.animations = [];
    if (!Array.isArray(lib.tags)) lib.tags = [];
    if (!libMigratedOnce) {
        libMigratedOnce = true;
        migrateAndCleanLib(lib);
    }
    const seeded = seedRowSounds(lib);
    const linked = linkLayersOnce(lib);
    const capped = capRowTailsOnce(lib);
    if (seeded || linked || capped) { try { saveLib(lib); } catch (e) { /* seeded again next time */ } }
    return lib;
}

// MultiText row presets were saved with a 12-frame tail ("Ends" after the caption). A MultiText clip now always ends
// with its caption (placement.js tailFor), so the saved tail goes to 0 once per preset (tailCapped) and the Alignment
// timeline shows what is placed.
function capRowTailsOnce(lib) {
    let changed = false;
    for (const a of lib.animations) {
        if (!a || a.tailCapped || !a.file) continue;
        if (!segmentsOf(path.join(ANIM_DIR, a.file)).length) continue;
        if (Number(a.tail) > 0) a.tail = 0;
        if (a.orig && Number(a.orig.tail) > 0) a.orig.tail = 0;
        a.tailCapped = true;
        changed = true;
    }
    return changed;
}

// Every sound layer (layered, row-slot and per-row repeat sounds) is linked to its text clip by default. Layers saved
// before that default were stored with link: false, so they are switched on once per preset (sfxLinkedDefault); a
// layer the user unticks afterwards stays unlinked.
function linkLayersOnce(lib) {
    let changed = false;
    for (const a of lib.animations) {
        if (!a || a.sfxLinkedDefault) continue;
        for (const l of (Array.isArray(a.sfxLayers) ? a.sfxLayers : [])) if (l && l.link === false) l.link = true;
        a.sfxLinkedDefault = true;
        changed = true;
    }
    return changed;
}

// Every MultiText row preset (Upper / Emphasis / Lower timing) starts with a default sound in each row's slot, aligned
// to that row's in-animation start. Done once per preset (segSfxSeeded), so a slot the user empties stays empty.
// Rows other than these three get no default. Sounds missing from sounds/original are skipped.
const ROW_SOUND_DEFAULTS = {
    upper: { file: 'tap-tiny-wooden-gamemaster-audio-higher-tone-1-00-00.mp3', volume: -10 },
    emphasis: { file: 'faith_mulato-shine-193240.mp3', volume: -8 },
    lower: { file: 'tap-tiny-wooden-gamemaster-audio-higher-tone-1-00-00.mp3', volume: -12 }
};
function seedRowSounds(lib) {
    let changed = false;
    for (const a of lib.animations) {
        if (!a || a.segSfxSeeded || !a.file) continue;
        const segs = segmentsOf(path.join(ANIM_DIR, a.file));
        if (!segs.length) continue;
        if (!Array.isArray(a.sfxLayers)) a.sfxLayers = [];
        for (const sg of segs) {
            const d = ROW_SOUND_DEFAULTS[String(sg.label || '').toLowerCase()];
            if (!d || !fs.existsSync(path.join(SFX_ORIG_DIR, d.file))) continue;
            if (a.sfxLayers.some(l => l && l.align === 'seg' && Number(l.seg) === sg.n)) continue;
            a.sfxLayers.push({
                id: 'lseg' + sg.n + Date.now().toString(36) + Math.floor(Math.random() * 1e3), file: d.file, orig: d.file, enabled: true,
                volume: d.volume, offset: 0, align: 'seg', seg: sg.n, trimIn: 0, len: 0, lenMode: 'clip', link: true, track: 0
            });
        }
        a.segSfxSeeded = true;
        changed = true;
    }
    return changed;
}

// Stamps updatedAt on every preset that is new or changed since the last save (shown and sorted in the Library tab).
function stampUpdated(lib) {
    let prev = null;
    try { prev = readLibParsed(); } catch (e) { prev = null; }
    const key = (a) => { const c = Object.assign({}, a); delete c.updatedAt; return JSON.stringify(c); };
    const before = new Map(((prev && Array.isArray(prev.animations)) ? prev.animations : []).map(a => [a.id, a]));
    const now = Date.now();
    for (const a of (Array.isArray(lib.animations) ? lib.animations : [])) {
        const old = before.get(a.id);
        if (!old || key(old) !== key(a)) a.updatedAt = now;
        else if (!a.updatedAt && old.updatedAt) a.updatedAt = old.updatedAt;
    }
}

function saveLib(lib) {
    if (!dirsEnsured) { ensureDirs(); dirsEnsured = true; }
    stampUpdated(lib);
    const tmp = LIB_FILE + '.tmp';
    const text = JSON.stringify(lib, null, 2);
    fs.writeFileSync(tmp, text);
    // Keep the previous good version (at most once a minute, so rapid edits stay cheap).
    try {
        if (fs.existsSync(LIB_FILE) && (!fs.existsSync(LIB_FILE + '.bak') || Date.now() - fs.statSync(LIB_FILE + '.bak').mtimeMs > 60000)) {
            fs.copyFileSync(LIB_FILE, LIB_FILE + '.bak');
        }
    } catch (e) { /* ignore */ }
    fs.renameSync(tmp, LIB_FILE);
    // the next loadLib finds the file changed (stat) and would parse again: hand it what was just written instead
    try { const st = fs.statSync(LIB_FILE); libRaw.key = st.size + ':' + st.mtimeMs; libRaw.raw = text; libRaw.parsed = structuredClone(lib); } catch (e) { libRaw.key = ''; }
}

function uniqueName(dir, base) {
    const ext = path.extname(base);
    const stem = path.basename(base, ext).replace(/[^\w\- .()]/g, '_');
    let name = stem + ext, n = 2;
    while (fs.existsSync(path.join(dir, name))) name = stem + ' ' + n++ + ext;
    return name;
}

// The preset's own row timing (MultiText segment presets: Seg<n>Start / Seg<n>End on the Template) as
// [{ n, label, start, end }], so the Alignment timeline can line the Upper / Emphasis / Lower sounds up with them.
function segmentsOf(file) {
    let mt = 0;
    try { mt = fs.statSync(file).mtimeMs; } catch (e) { return []; }
    const c = segCache.get(file);
    if (c && c.mt === mt) return c.list;
    const list = [];
    try {
        const txt = fs.readFileSync(file, 'utf8');
        for (let n = 1; n <= 16; n++) {
            const s = new RegExp('\\bSeg' + n + 'Start = Input \\{ Value = (-?[\\d.]+)').exec(txt);
            const e = new RegExp('\\bSeg' + n + 'End = Input \\{ Value = (-?[\\d.]+)').exec(txt);
            if (!s || !e) break;
            const nm = new RegExp('\\bSeg' + n + 'Start = \\{[^}]*?LINKS_Name = "([^"]*)"').exec(txt);
            let label = nm ? nm[1].replace(/\s*start$/i, '') : '';
            list.push({ n, label: label || ('Text ' + n), start: Math.round(Number(s[1]) || 0), end: Math.round(Number(e[1]) || 0) });
        }
    } catch (e) { /* no segments */ }
    segCache.set(file, { mt, list });
    return list;
}

function libForUI() {
    const lib = loadLib();
    return {
        dataDir: DATA_DIR,
        sfxDir: SFX_DIR,
        sfxOrigDir: SFX_ORIG_DIR,
        alwaysOnTop: lib.alwaysOnTop !== false,
        defaultSfx: lib.defaultSfx ? { file: lib.defaultSfx, path: sfxFilePath(lib.defaultSfx) } : null,
        tags: lib.tags,
        effectTags: (lib.effectTags && typeof lib.effectTags === 'object') ? lib.effectTags : {},
        useOrder: Array.isArray(lib.useOrder) ? lib.useOrder : [],
        sfxOriginals: listSfxOriginals(),
        animations: lib.animations.map(a => {
            const animPath = path.join(ANIM_DIR, a.file);
            const exists = fs.existsSync(animPath);
            const textDesign = parseTextStyle(exists ? animPath : null, a.textDesign);
            const sfxOrig = a.sfxOrig || a.sfx || null;
            const fileOrig = a.fileOrig || a.file;
            const hasOriginal = fs.existsSync(path.join(ANIM_ORIG_DIR, fileOrig));
            const nodes = exists ? nodesWithDesign(animPath) : [];
            const hasPreview = !!(a.preview && a.preview.count > 0 && fs.existsSync(path.join(PREV_DIR, a.id, 'p00.png')));
            let updatedAt = a.updatedAt || 0;
            if (!updatedAt && exists) { try { updatedAt = fs.statSync(animPath).mtimeMs; } catch (e) { /* ignore */ } }
            return Object.assign({}, a, {
                updatedAt,
                missing: !exists,
                fileOrig,
                hasOriginal,
                nodes,
                isMultiText: nodes.some(n => n.kind === 'multitext'),
                segments: exists ? segmentsOf(animPath) : [],
                textDesign,
                textStyle: textDesign,
                // Frames deleted from disk (previews folder cleared): reported as no preview, so the panel renders one.
                preview: hasPreview ? a.preview : null,
                previewFiles: hasPreview ? frameList(path.join(PREV_DIR, a.id), 'p', a.preview) : [],
                previewWhite: (hasPreview && a.preview.matte) ? frameList(path.join(PREV_DIR, a.id), 'w', a.preview) : null,
                sfx: a.sfx || null,
                sfxOrig,
                sfxPath: sfxFilePath(a.sfx),
                sfxOrigPath: sfxFilePath(sfxOrig)
            });
        })
    };
}
