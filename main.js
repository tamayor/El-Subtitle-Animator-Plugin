// Subtitle Animator - DaVinci Resolve Studio Workflow Integration plugin (main process)
//
// What it does: follows the subtitle under the playhead (or the selected one), and turns it
// into an animated Text+ clip, with a sound effect, from a library of animations you keep.
//
// How placement works (all of this was tested on a copy of a real timeline):
//  - InsertFusionTitleIntoTimeline always drops the title on V1 as a RIPPLE insert, which would
//    split your footage and push everything later. So the title is inserted at the very END of the
//    timeline (nothing to split or push), then moved to a free track at the right frame and
//    trimmed to the subtitle's length with SetRightOffset.
//  - Sound effects go on a free audio track at an exact frame with MediaPool.AppendToTimeline.

const { app, BrowserWindow, ipcMain, shell, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const WorkflowIntegration = require('./WorkflowIntegration.node');

const PLUGIN_ID = 'com.el.subtitleanimator';
const INITIAL_PPID = process.ppid;
let hasSeenResolve = false;
let isQuitting = false;

// ------------------------------------------------------------------ library on disk
const DATA_DIR = path.join(os.homedir(), 'Documents', 'Subtitle Animator');
const ANIM_DIR = path.join(DATA_DIR, 'animations');
const SFX_DIR = path.join(DATA_DIR, 'sfx');
const PREV_DIR = path.join(DATA_DIR, 'previews');
const FONTS_DIR = path.join(DATA_DIR, 'fonts');
const LIB_FILE = path.join(DATA_DIR, 'library.json');

function ensureDirs() {
    for (const d of [DATA_DIR, ANIM_DIR, SFX_DIR, PREV_DIR, FONTS_DIR]) fs.mkdirSync(d, { recursive: true });
}

function newAnimation(name, file, defaults) {
    return Object.assign({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: name,
        file: file,          // file name inside animations/
        sfx: null,           // current attached audio file inside sfx/
        sfxOrig: null,       // preserved original audio file inside sfx/
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
    let changed = false;
    for (const a of lib.animations) {
        if (!a.sfxOrig && a.sfx) {
            const ext = path.extname(a.sfx);
            const stem = path.basename(a.sfx, ext);
            const trimMatch = stem.match(/^(.+?)-(\d{8}[-_]\d{6})$/);
            if (trimMatch) {
                const origStem = trimMatch[1];
                for (const e of ['.mp3', '.wav', '.m4a', '.aif', '.aiff', '.flac', '.ogg']) {
                    if (fs.existsSync(path.join(SFX_DIR, origStem + e))) {
                        a.sfxOrig = origStem + e;
                        changed = true;
                        break;
                    }
                }
            } else {
                const cleanStem = stem.replace(/(\s+\d+)+$/, '');
                if (cleanStem !== stem && fs.existsSync(path.join(SFX_DIR, cleanStem + ext))) {
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
    // Clean up orphaned duplicates in SFX_DIR
    try {
        const inUse = new Set();
        if (lib.defaultSfx) inUse.add(lib.defaultSfx);
        for (const a of lib.animations) {
            if (a.sfx) inUse.add(a.sfx);
            if (a.sfxOrig) inUse.add(a.sfxOrig);
        }
        for (const file of fs.readdirSync(SFX_DIR)) {
            if (inUse.has(file)) continue;
            const ext = path.extname(file);
            const stem = path.basename(file, ext);
            const cleanStem = stem.replace(/(\s+\d+)+$/, '');
            if (cleanStem !== stem && fs.existsSync(path.join(SFX_DIR, cleanStem + ext))) {
                try { fs.rmSync(path.join(SFX_DIR, file), { force: true }); } catch (e) { /* ignore */ }
            }
        }
    } catch (e) { /* ignore */ }
}

function loadLib() {
    ensureDirs();
    let lib = { defaultSfx: null, alwaysOnTop: true, animations: [], tags: [] };
    try {
        lib = Object.assign(lib, JSON.parse(fs.readFileSync(LIB_FILE, 'utf8')));
    } catch (e) { /* first run */ }
    if (!Array.isArray(lib.tags)) lib.tags = [];
    if (!libMigratedOnce) {
        libMigratedOnce = true;
        migrateAndCleanLib(lib);
    }
    return lib;
}

function saveLib(lib) {
    ensureDirs();
    const tmp = LIB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(lib, null, 2));
    fs.renameSync(tmp, LIB_FILE);
}

function uniqueName(dir, base) {
    const ext = path.extname(base);
    const stem = path.basename(base, ext).replace(/[^\w\- .()]/g, '_');
    let name = stem + ext, n = 2;
    while (fs.existsSync(path.join(dir, name))) name = stem + ' ' + n++ + ext;
    return name;
}

function rgbToHex(r, g, b) {
    const c = (x) => Math.max(0, Math.min(255, Math.round((Number(x) || 0) * 255))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
}

function defaultShadingElements() {
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

function extractBraceBlock(raw, startIdx) {
    const openIdx = raw.indexOf('{', startIdx);
    if (openIdx < 0) return raw.slice(startIdx, startIdx + 2000);
    let depth = 0;
    for (let i = openIdx; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return raw.slice(startIdx, i + 1);
        }
    }
    return raw.slice(startIdx, startIdx + 3000);
}

function parseSplineKeyframes(raw, splineName) {
    if (!splineName) return null;
    const reBlock = new RegExp('\\b' + splineName.replace(/[^\w]/g, '\\$&') + '\\s*=\\s*BezierSpline');
    const mBlock = reBlock.exec(raw);
    if (!mBlock) return null;
    const block = extractBraceBlock(raw, mBlock.index);
    const kfIdx = block.indexOf('KeyFrames');
    if (kfIdx < 0) return null;
    const kfBlock = extractBraceBlock(block, kfIdx);
    const pts = [];
    const re = /\[\s*(-?[\d.]+)\s*\]\s*=\s*\{\s*(-?[\d.]+)/g;
    let m;
    while ((m = re.exec(kfBlock)) !== null) {
        pts.push([parseFloat(m[1]), parseFloat(m[2])]);
    }
    return pts.length ? pts : null;
}

function parseAnimSpec(raw, tpChunk) {
    const spec = {
        frameRepeat: 1,
        displace: null,
        erode: null,
        perturb: null,
        follower: null,
        sizeKeys: null,
        opacityKeys: null,
        trackingKeys: null,
        angleKeys: null
    };
    if (!raw) return spec;

    const frMatch = /\bframeRepeat\s*=\s*Input\s*\{\s*Value\s*=\s*(\d+)/.exec(raw);
    if (frMatch) spec.frameRepeat = Math.max(1, parseInt(frMatch[1], 10));
    const frvMatch = /\bframeRepeatVar\s*=\s*Input\s*\{\s*Value\s*=\s*([\d.]+)/.exec(raw);
    if (frvMatch) spec.frameRepeatVar = parseFloat(frvMatch[1]);

    if (/\b(?:Displace|NoiseDistortion)\b/.test(raw)) {
        const fnIdx = raw.indexOf('= FastNoise');
        const fnChunk = fnIdx >= 0 ? extractBraceBlock(raw, fnIdx) : '';
        const numIn = (c, k, d) => {
            const m = new RegExp('\\b' + k + '\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*([\\d.\\-]+)').exec(c);
            return m ? parseFloat(m[1]) : d;
        };
        spec.displace = {
            detail: numIn(fnChunk, 'Detail', 2.86),
            contrast: numIn(fnChunk, 'Contrast', 0.086),
            xScale: numIn(fnChunk, 'XScale', 20),
            refraction: numIn(raw, 'RefractionStrength', 1)
        };
    }

    const edIdx = raw.indexOf('= ErodeDilate');
    if (edIdx >= 0) {
        const edChunk = extractBraceBlock(raw, edIdx);
        const srcM = /XAmount\s*=\s*Input\s*\{[^}]*?SourceOp\s*=\s*"([^"]+)"/.exec(edChunk);
        if (srcM) spec.erode = parseSplineKeyframes(raw, srcM[1]);
    }

    const ptIdx = raw.indexOf('= PerturbPoint');
    const pnIdx = raw.indexOf('= PerturbNumber');
    if (ptIdx >= 0 || pnIdx >= 0) {
        const chunk = extractBraceBlock(raw, ptIdx >= 0 ? ptIdx : pnIdx);
        const numP = (k, d) => {
            const m = new RegExp('\\b' + k + '\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*([\\d.\\-]+)').exec(chunk);
            return m ? parseFloat(m[1]) : d;
        };
        spec.perturb = {
            xScale: numP('XScale', 0.02),
            yScale: numP('YScale', 0.02),
            strength: numP('Strength', 0.04),
            wobble: numP('Wobble', 0.03),
            speed: numP('Speed', 10)
        };
    }

    const flIdx = raw.indexOf('= StyledTextFollower');
    if (flIdx >= 0) {
        const flChunk = extractBraceBlock(raw, flIdx);
        const numF = (k, d) => {
            const m = new RegExp('\\b' + k + '\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*([\\d.\\-]+)').exec(flChunk);
            return m ? parseFloat(m[1]) : d;
        };
        spec.follower = {
            order: numF('Order', 0),
            delay: numF('Delay', 0),
            rot: numF('TransformRotation', 0),
            slideY: 0,
            slideX: 0,
            pathSpline: null,
            sizeKeys: null,
            opacityKeys: null,
            rotKeys: null
        };
        const woMatch = /(?:WordOffset|CharacterOffset)\s*=\s*Input\s*\{[^}]*?SourceOp\s*=\s*"([^"]+)"/.exec(flChunk);
        if (woMatch) {
            const pIdx = raw.indexOf(woMatch[1] + ' = PolyPath');
            if (pIdx >= 0) {
                const pChunk = extractBraceBlock(raw, pIdx);
                const pts = [];
                const ptRe = /X\s*=\s*([-\d.]+),\s*Y\s*=\s*([-\d.]+)/g;
                let pm;
                while ((pm = ptRe.exec(pChunk)) !== null) {
                    pts.push({ x: parseFloat(pm[1]), y: parseFloat(pm[2]) });
                }
                if (pts.length >= 2) {
                    spec.follower.slideY = pts[0].y - pts[pts.length - 1].y;
                    spec.follower.slideX = pts[0].x - pts[pts.length - 1].x;
                }
                const dispMatch = /Displacement\s*=\s*Input\s*\{[^}]*?SourceOp\s*=\s*"([^"]+)"/.exec(pChunk);
                if (dispMatch) {
                    spec.follower.pathSpline = parseSplineKeyframes(raw, dispMatch[1]);
                }
            }
        }
        const wsMatch = /(?:WordSize[XY]|CharacterSize[XY]|TransformSize)\s*=\s*Input\s*\{[^}]*?SourceOp\s*=\s*"([^"]+)"/.exec(flChunk);
        if (wsMatch) {
            spec.follower.sizeKeys = parseSplineKeyframes(raw, wsMatch[1]);
        }
        const opMatch = /Opacity\d*\s*=\s*Input\s*\{[^}]*?SourceOp\s*=\s*"([^"]+)"/.exec(flChunk);
        if (opMatch) {
            spec.follower.opacityKeys = parseSplineKeyframes(raw, opMatch[1]);
        }
        const rotMatch = /(?:WordAngleZ|CharacterAngleZ)\s*=\s*Input\s*\{[^}]*?SourceOp\s*=\s*"([^"]+)"/.exec(flChunk);
        if (rotMatch) {
            spec.follower.rotKeys = parseSplineKeyframes(raw, rotMatch[1]);
        }
    }

    if (tpChunk) {
        const srcOp = (key) => {
            const m = new RegExp('\\b' + key + '\\s*=\\s*Input\\s*\\{[^}]*?SourceOp\\s*=\\s*"([^"]+)"').exec(tpChunk);
            return m ? m[1] : null;
        };
        spec.sizeKeys = parseSplineKeyframes(raw, srcOp('Size'));
        spec.opacityKeys = parseSplineKeyframes(raw, srcOp('Opacity1'));
        spec.trackingKeys = parseSplineKeyframes(raw, srcOp('CharacterSpacing'));
        spec.angleKeys = parseSplineKeyframes(raw, srcOp('AngleZ') || srcOp('AngleY') || srcOp('AngleX'));
    }

    return spec;
}

function textPlusChunk(raw, toolName) {
    if (toolName) {
        const esc = String(toolName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = new RegExp('(?:^|[\\s,{])' + esc + '\\s*=\\s*TextPlus\\s*\\{').exec(raw);
        if (m) return extractBraceBlock(raw, m.index + m[0].indexOf(toolName));
    }
    const tpIdx = raw.indexOf('= TextPlus');
    return tpIdx >= 0 ? extractBraceBlock(raw, tpIdx) : raw;
}

// toolName: read the design of that Text+ (a preset with several Text+ has one Text Design per Text+).
// Text tab controls: model field -> Fusion Text+ input id
const TEXT_EXTRA_IDS = [['vAnchor', 'VerticalTopCenterBottom'], ['vJustify', 'VerticallyJustified'], ['hAnchor', 'HorizontalLeftCenterRight'], ['hJustify', 'HorizontallyJustified'], ['direction', 'Direction'], ['lineDirection', 'LineDirection'], ['strikeout', 'Strikeout'], ['underline', 'Underline']];

function parseTextStyle(filePath, savedDesign, toolName) {
    const def = {
        font: 'Poppins',
        style: 'Bold',
        size: 0.12,
        tracking: 1.0,
        lineSpacing: 1.0,
        vAnchor: 0, vJustify: 0, hAnchor: 0, hJustify: 0, direction: 0, lineDirection: 0, strikeout: 0, underline: 0,
        wiggle: false,
        animSpec: null,
        selectedElement: 1,
        elements: defaultShadingElements(),
        // Text+ Layout tab (Center X/Y is the text box position, edited through the boxes)
        layout: { type: 0, centerZ: 0, pivotX: 0.5, pivotY: 0.5, pivotZ: 0, size: 1, perspective: 1, animated: [] }
    };
    const fileSoftnessSet = new Set();
    try {
        if (filePath && fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const chunk = textPlusChunk(raw, toolName);
            const num = (key) => {
                const m = new RegExp('\\b' + key + '\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*(?:Number\\s*\\{\\s*Value\\s*=\\s*)?([\\d.\\-]+)').exec(chunk);
                return m ? parseFloat(m[1]) : null;
            };
            const str = (key) => {
                const m = new RegExp('\\b' + key + '\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*"([^"]+)"').exec(chunk);
                return m ? m[1] : null;
            };
            const pt2 = (key) => {
                const m = new RegExp('\\b' + key + '\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*\\{\\s*([\\d.\\-]+)\\s*,\\s*([\\d.\\-]+)').exec(chunk);
                return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
            };
            const font = str('Font');
            if (font) def.font = font;
            const style = str('Style');
            if (style) def.style = style;
            const sz = num('Size');
            if (sz !== null && sz > 0) def.size = sz;
            const trk = num('CharacterSpacing');
            if (trk !== null) def.tracking = trk;
            const lsp = num('LineSpacing');
            if (lsp !== null) def.lineSpacing = lsp;
            for (const [k, key] of TEXT_EXTRA_IDS) { const v = num(key); if (v !== null) def[k] = v; }
            // Layout tab. Inputs driven by a spline / path (keyframed) are listed as animated and never overridden.
            const animatedIn = (key) => new RegExp('\\b' + key + '\\s*=\\s*Input\\s*\\{\\s*SourceOp').test(chunk);
            const L = def.layout;
            const lt = num('LayoutType');
            if (lt !== null) L.type = Math.round(lt);
            const cz = num('CenterZ');
            if (cz !== null) L.centerZ = cz;
            const pv = pt2('Pivot');
            if (pv) { L.pivotX = pv[0]; L.pivotY = pv[1]; }
            const pz = num('PivotZ');
            if (pz !== null) L.pivotZ = pz;
            const ls = num('LayoutSize');
            if (ls !== null) L.size = ls;
            const pp = num('Perspective');
            if (pp !== null) L.perspective = pp;
            L.animated = ['LayoutType', 'Center', 'CenterZ', 'Pivot', 'PivotZ', 'LayoutSize', 'Perspective'].filter(animatedIn);
            const selEl = num('SelectElement');
            if (selEl !== null && selEl >= 1 && selEl <= 8) def.selectedElement = Math.round(selEl);

            for (let i = 1; i <= 8; i++) {
                const el = def.elements[i - 1];
                const nm = str('Name' + i);
                if (nm) el.name = nm;
                const en = num('Enabled' + i);
                if (en !== null) el.enabled = en > 0.5;
                const op = num('Opacity' + i);
                if (op !== null) el.opacity = op;
                // A colour with zero alpha draws nothing visible (used as a cut-out that reveals the text).
                const al = num('Alpha' + i);
                if (al !== null) el.alpha = al;
                const ty = num('Type' + i);
                el.type = ty !== null ? Math.round(ty) : (el.type !== undefined ? el.type : 0);
                // Gradient stops: ShadingGradientN = Input { Value = Gradient { Colors = { [0] = { r, g, b, a }, ... } } }
                const gIdx = chunk.search(new RegExp('\\bShadingGradient' + i + '\\s*=\\s*Input'));
                if (gIdx >= 0) {
                    const gb = extractBraceBlock(chunk, gIdx);
                    const stops = [];
                    const sre = /\[\s*([\d.\-]+)\s*\]\s*=\s*\{\s*([\d.\-e]+)\s*,\s*([\d.\-e]+)\s*,\s*([\d.\-e]+)/g;
                    let sm;
                    while ((sm = sre.exec(gb)) !== null) stops.push([parseFloat(sm[1]), parseFloat(sm[2]), parseFloat(sm[3]), parseFloat(sm[4])]);
                    if (stops.length) {
                        stops.sort((p, q) => p[0] - q[0]);
                        const f0 = stops[0], f1 = stops[stops.length - 1];
                        if (el.type === 2) el.color = rgbToHex(f0[1], f0[2], f0[3]);
                        el.color2 = rgbToHex(f1[1], f1[2], f1[3]);
                    }
                }
                for (const [key, fld, int] of [['MappingAngle', 'mappingAngle', false], ['MappingSize', 'mappingSize', false], ['MappingAspect', 'mappingAspect', false], ['MappingLevel', 'mappingLevel', true]]) {
                    const v = num(key + i);
                    if (v !== null) el[fld] = int ? Math.round(v) : v;
                }
                const sh = num('ElementShape' + i);
                if (sh !== null) el.shape = Math.round(sh);
                const th = num('Thickness' + i);
                if (th !== null) el.thickness = th;
                const lv = num('Level' + i);
                if (lv !== null) el.level = Math.round(lv);
                const eh = num('ExtendHorizontal' + i);
                if (eh !== null) el.extendH = eh;
                const ev = num('ExtendVertical' + i);
                if (ev !== null) el.extendV = ev;
                const rd = num('Round' + i);
                if (rd !== null) el.round = rd;
                const r = num('Red' + i), g = num('Green' + i), b = num('Blue' + i);
                if (r !== null || g !== null || b !== null) {
                    // Fusion leaves out channels that match its default, so a missing channel means the default
                    // colour of that element (Element 2 is red, 3 black, 4 blue), not 1.
                    const dc = String(el.color || '#ffffff').replace('#', '');
                    const dch = (k) => parseInt(dc.substr(k * 2, 2), 16) / 255;
                    el.color = rgbToHex(r !== null ? r : dch(0), g !== null ? g : dch(1), b !== null ? b : dch(2));
                }
                const sx = num('SoftnessX' + i) !== null ? num('SoftnessX' + i) : num('SoftnessY' + i);
                if (sx !== null) {
                    el.softness = sx;
                    fileSoftnessSet.add(i);
                }
                const off = pt2('Offset' + i);
                if (off) {
                    el.offsetX = off[0];
                    el.offsetY = off[1];
                }
            }
            if (/Perturb|Shake|Displace|NoiseDistortion/.test(raw)) def.wiggle = true;
            def.animSpec = parseAnimSpec(raw, chunk);
        }
    } catch (e) { /* use default */ }

    if (savedDesign && typeof savedDesign === 'object') {
        if (savedDesign.font) def.font = savedDesign.font;
        if (savedDesign.style) def.style = savedDesign.style;
        if (savedDesign.size !== undefined) def.size = Number(savedDesign.size) || def.size;
        if (savedDesign.tracking !== undefined) def.tracking = Number(savedDesign.tracking);
        if (savedDesign.lineSpacing !== undefined) def.lineSpacing = Number(savedDesign.lineSpacing);
        for (const [k] of TEXT_EXTRA_IDS) if (savedDesign[k] !== undefined && !isNaN(Number(savedDesign[k]))) def[k] = Number(savedDesign[k]);
        if (savedDesign.selectedElement) def.selectedElement = Number(savedDesign.selectedElement) || 1;
        if (savedDesign.layout && typeof savedDesign.layout === 'object') {
            for (const k of ['type', 'centerZ', 'pivotX', 'pivotY', 'pivotZ', 'size', 'perspective']) {
                const v = Number(savedDesign.layout[k]);
                if (savedDesign.layout[k] !== undefined && savedDesign.layout[k] !== null && !isNaN(v)) def.layout[k] = v;
            }
        }
        if (Array.isArray(savedDesign.elements)) {
            for (const sEl of savedDesign.elements) {
                const idx = Number(sEl && sEl.index);
                if (idx >= 1 && idx <= 8 && sEl.modified) {
                    const merged = Object.assign({}, def.elements[idx - 1], sEl, { index: idx });
                    if (!fileSoftnessSet.has(idx) && merged.softness === 1) {
                        merged.softness = def.elements[idx - 1].softness;
                    }
                    def.elements[idx - 1] = merged;
                }
            }
        }
    }
    return def;
}

// ------------------------------------------------------------------ detect Text+ / template nodes in a preset file
// Lists every top-level Text+ in a .comp/.setting, and every macro (title template) that publishes a text input.
// Text+ nodes buried inside a macro are reached through the macro's published inputs instead.
const nodeCache = new Map();

function unescapeFusion(str) {
    return String(str || '').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseNodes(raw) {
    const decl = /(?:^|[\s,{])([A-Za-z_][\w]*)\s*=\s*(TextPlus|MacroOperator|GroupOperator)\s*\{/g;
    const found = [];
    let m;
    while ((m = decl.exec(raw)) !== null) {
        const start = m.index + m[0].indexOf(m[1]);
        const block = extractBraceBlock(raw, start);
        found.push({ name: m[1], type: m[2], start, end: start + block.length, block });
    }
    const groups = found.filter(f => f.type !== 'TextPlus');
    const insideGroup = (f) => groups.some(g => g !== f && f.start > g.start && f.end <= g.end);
    const strIn = (blk, key) => {
        const mm = new RegExp('\\b' + key + '\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(blk);
        return mm ? unescapeFusion(mm[1]) : null;
    };
    const numIn = (blk, key) => {
        const mm = new RegExp('\\b' + key + '\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*(-?[\\d.]+)').exec(blk);
        return mm ? parseFloat(mm[1]) : null;
    };
    const ptIn = (blk, key) => {
        const mm = new RegExp('\\b' + key + '\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*\\{\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)').exec(blk);
        return mm ? [parseFloat(mm[1]), parseFloat(mm[2])] : null;
    };
    const textPlusInfo = (f) => {
        const c = ptIn(f.block, 'Center') || [0.5, 0.5];
        const sz = numIn(f.block, 'Size');
        return { defaultText: strIn(f.block, 'StyledText') || '', cx: c[0], cy: c[1], size: sz !== null && sz > 0 ? sz : 0.08 };
    };

    const nodes = [];
    for (const f of found.filter(x => x.type === 'TextPlus' && !insideGroup(x))) {
        nodes.push(Object.assign({
            id: f.name, kind: 'textplus', tool: f.name, input: 'StyledText', centerInput: 'Center', canMove: true,
            label: 'Text+ · ' + f.name
        }, textPlusInfo(f)));
    }
    for (const g of groups.filter(x => !insideGroup(x))) {
        const inst = /([A-Za-z_]\w*)\s*=\s*InstanceInput\s*\{/g;
        const published = [];
        let im;
        while ((im = inst.exec(g.block)) !== null) {
            const blk = extractBraceBlock(g.block, im.index);
            const get = (k) => { const mm = new RegExp('\\b' + k + '\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(blk); return mm ? mm[1] : null; };
            published.push({ key: im[1], op: get('SourceOp'), source: get('Source'), name: get('Name'), def: get('Default') });
        }
        for (const p of published.filter(x => x.source === 'StyledText')) {
            const inner = found.find(x => x.type === 'TextPlus' && x.name === p.op && x.start > g.start && x.end <= g.end);
            const info = inner ? textPlusInfo(inner) : { defaultText: '', cx: 0.5, cy: 0.5, size: 0.08 };
            const ctr = published.find(x => x.op === p.op && x.source === 'Center');
            if (p.def) info.defaultText = unescapeFusion(p.def);
            nodes.push(Object.assign({
                id: g.name + '/' + p.key, kind: 'template', tool: g.name, input: p.key,
                centerInput: ctr ? ctr.key : null, canMove: !!ctr,
                label: 'Template · ' + (p.name || g.name)
            }, info));
        }
    }
    if (!nodes.length) {
        // Nothing reachable: list the buried Text+ nodes so the panel can still tell the user what is in there.
        for (const f of found.filter(x => x.type === 'TextPlus')) {
            nodes.push(Object.assign({
                id: f.name, kind: 'textplus', tool: f.name, input: 'StyledText', centerInput: 'Center', canMove: true,
                label: 'Text+ · ' + f.name, nested: true
            }, textPlusInfo(f)));
        }
    }
    return nodes;
}

function detectNodes(filePath) {
    let st;
    try { st = fs.statSync(filePath); } catch (e) { return []; }
    const key = filePath + ':' + st.mtimeMs;
    if (nodeCache.has(key)) return nodeCache.get(key);
    let out = [];
    try { out = parseNodes(fs.readFileSync(filePath, 'utf8')); } catch (e) { out = []; }
    nodeCache.set(key, out);
    return out;
}

// Only the Text+ design values you actually changed are sent to Fusion. Everything the preset file already says
// (including animated sizes and shading) is left exactly as the preset made it.
function designForFusion(compPath, wanted, toolName, force) {
    // force: the design goes onto a clip that already exists (live preview), which still carries the previous values -
    // so the text values are sent even when they equal the preset file's.
    if (!wanted || typeof wanted !== 'object') return null;
    const base = parseTextStyle(compPath && fs.existsSync(compPath) ? compPath : null, null, toolName);
    const out = {};
    for (const k of ['font', 'style', 'size', 'tracking', 'lineSpacing', 'vAnchor', 'vJustify', 'hAnchor', 'hJustify', 'direction', 'lineDirection', 'strikeout', 'underline']) {
        if (wanted[k] === undefined || wanted[k] === null) continue;
        const differs = typeof base[k] === 'number' ? Math.abs(Number(wanted[k]) - base[k]) > 1e-6 : String(wanted[k]) !== String(base[k]);
        if (differs || (force && ['font', 'style', 'size', 'tracking', 'lineSpacing'].includes(k))) out[k] = wanted[k];
    }
    // A new font must come with a style that font really has, or Resolve shows "Font Not Found".
    // A preset file with no Font input of its own: the chosen font is sent even when it equals the built-in default (Poppins),
    // so picking Poppins really changes Resolve. Presets that state their font keep the old, lighter behaviour.
    if (wanted.font && !out.font && !force) {
        let fileHasFont = true;
        try {
            const raw = (compPath && fs.existsSync(compPath)) ? fs.readFileSync(compPath, 'utf8') : '';
            fileHasFont = /\bFont\s*=\s*Input\s*\{\s*Value\s*=\s*"/.test(textPlusChunk(raw, toolName));
        } catch (e) { fileHasFont = true; }
        if (!fileHasFont) out.font = wanted.font;      // the preset states no font: Resolve's default would win otherwise
    }
    if (out.font || (wanted.font && out.style)) {
        const f = out.font || wanted.font;
        const st = validFontStyle(f, out.style || wanted.style || base.style);
        if (typeof st === 'string') out.style = st;
    }
    // Per shading element, only the fields that really differ from the preset file are sent (changing the colour
    // sends the colour and nothing else), so untouched inputs - and their keyframes - stay exactly as built.
    const keys = ['name', 'enabled', 'opacity', 'shape', 'thickness', 'level', 'extendH', 'extendV', 'round', 'color', 'color2', 'mappingAngle', 'mappingSize', 'mappingAspect', 'mappingLevel', 'softness', 'offsetX', 'offsetY', 'type'];
    const els = [];
    if (Array.isArray(wanted.elements)) {
        for (const el of wanted.elements) {
            const idx = Number(el && el.index);
            if (!(idx >= 1 && idx <= 8) || !el.modified) continue;
            const b = base.elements[idx - 1] || {};
            const diff = { index: idx, modified: true };
            for (const k of keys) {
                if (el[k] === undefined || el[k] === null) continue;
                const same = (typeof el[k] === 'number' && typeof b[k] === 'number')
                    ? Math.abs(el[k] - b[k]) <= 1e-6
                    : String(el[k]).toLowerCase() === String(b[k]).toLowerCase();
                if (!same || (force && ['color', 'color2', 'enabled', 'opacity', 'softness', 'thickness', 'offsetX', 'offsetY'].includes(k))) diff[k] = el[k];
            }
            // A gradient is sent whole (type + both colours), so changing one stop or switching to Gradient
            // always gives exactly the gradient shown in the panel.
            const effType = Number(el.type !== undefined ? el.type : b.type) || 0;
            if (effType === 2 && (diff.type !== undefined || diff.color !== undefined || diff.color2 !== undefined)) {
                diff.type = 2;
                diff.color = el.color || b.color || '#ffffff';
                diff.color2 = el.color2 || b.color2 || '#ffffff';
            }
            if (Object.keys(diff).length > 2) els.push(diff);
        }
    }
    if (els.length) out.elements = els;
    if (wanted.layout && typeof wanted.layout === 'object' && base.layout) {
        const lay = {};
        for (const k of ['type', 'centerZ', 'pivotX', 'pivotY', 'pivotZ', 'size', 'perspective']) {
            const v = Number(wanted.layout[k]);
            if (wanted.layout[k] === undefined || wanted.layout[k] === null || isNaN(v)) continue;
            if (Math.abs(v - Number(base.layout[k])) > 1e-6) lay[k] = v;
        }
        if (Object.keys(lay).length) out.layout = lay;
    }
    return Object.keys(out).length ? out : null;
}

// The first Text+ of a preset uses the preset's Text Design; every other Text+ can carry its own (box.design),
// which is turned into "only what differs from that Text+ in the file" here.
function primaryTextPlus(nodes) {
    const n = (nodes || []).find(x => x && x.kind === 'textplus' && !x.nested);
    return n ? n.id : null;
}
function fusionBoxes(compPath, list, force) {
    if (!Array.isArray(list)) return list;
    return list.map(b => {
        if (!b || !b.design || typeof b.design !== 'object' || b.kind !== 'textplus') return b ? Object.assign({}, b, { design: null }) : b;
        return Object.assign({}, b, { design: designForFusion(compPath, b.design, b.tool, force) || {} });
    });
}
const nodeDesignCache = new Map();
function nodesWithDesign(animPath) {
    let st;
    try { st = fs.statSync(animPath); } catch (e) { return []; }
    const key = animPath + ':' + st.mtimeMs;
    if (nodeDesignCache.has(key)) return JSON.parse(JSON.stringify(nodeDesignCache.get(key)));
    const nodes = detectNodes(animPath);
    const first = primaryTextPlus(nodes);
    const out = nodes.map(n => (n.kind === 'textplus' && !n.nested && n.id !== first)
        ? Object.assign({}, n, { design: parseTextStyle(animPath, null, n.tool) })
        : Object.assign({}, n, { primary: n.id === first }));
    nodeDesignCache.set(key, out);
    return JSON.parse(JSON.stringify(out));
}

function libForUI() {
    const lib = loadLib();
    return {
        dataDir: DATA_DIR,
        alwaysOnTop: lib.alwaysOnTop !== false,
        defaultSfx: lib.defaultSfx ? { file: lib.defaultSfx, path: path.join(SFX_DIR, lib.defaultSfx) } : null,
        tags: lib.tags,
        sfxOriginals: listSfxOriginals(),
        animations: lib.animations.map(a => {
            const animPath = path.join(ANIM_DIR, a.file);
            const exists = fs.existsSync(animPath);
            const textDesign = parseTextStyle(exists ? animPath : null, a.textDesign);
            const sfxOrig = a.sfxOrig || a.sfx || null;
            return Object.assign({}, a, {
                missing: !exists,
                nodes: exists ? nodesWithDesign(animPath) : [],
                textDesign,
                textStyle: textDesign,
                previewFiles: a.preview ? frameList(path.join(PREV_DIR, a.id), 'p', a.preview) : [],
                previewWhite: (a.preview && a.preview.matte) ? frameList(path.join(PREV_DIR, a.id), 'w', a.preview) : null,
                sfx: a.sfx || null,
                sfxOrig,
                sfxPath: a.sfx ? path.join(SFX_DIR, a.sfx) : null,
                sfxOrigPath: sfxOrig ? path.join(SFX_DIR, sfxOrig) : null
            });
        })
    };
}

// ------------------------------------------------------------------ Resolve connection
let resolveObj = null;

async function getResolve() {
    if (resolveObj) return resolveObj;
    const ok = await WorkflowIntegration.Initialize(PLUGIN_ID);
    if (!ok) throw new Error('Could not connect to DaVinci Resolve (is this Resolve Studio?)');
    resolveObj = await WorkflowIntegration.GetResolve();
    if (!resolveObj) throw new Error('Could not get the Resolve object');
    hasSeenResolve = true;
    return resolveObj;
}

async function getProject() {
    const resolve = await getResolve();
    const pm = await resolve.GetProjectManager();
    return pm ? await pm.GetCurrentProject() : null;
}

// ------------------------------------------------------------------ timecode <-> frames
const pad = (n) => String(n).padStart(2, '0');

async function timelineMeta(tl) {
    const [rate, dfs, w, h] = await Promise.all([
        tl.GetSetting('timelineFrameRate'), tl.GetSetting('timelineDropFrameTimecode'),
        tl.GetSetting('timelineResolutionWidth'), tl.GetSetting('timelineResolutionHeight')
    ]);
    const fps = parseFloat(rate) || 25;
    const df = String(dfs) === '1';
    const width = parseInt(w, 10) || 1920;
    const height = parseInt(h, 10) || 1080;
    return { fps, nominal: Math.round(fps), df, width, height };
}

function tcToFrame(tc, meta) {
    const [h, m, s, f] = String(tc).split(/[:;]/).map(Number);
    const n = meta.nominal;
    let total = ((h * 60 + m) * 60 + s) * n + f;
    if (meta.df) {
        const drop = n <= 30 ? 2 : 4;
        const tm = h * 60 + m;
        total -= drop * (tm - Math.floor(tm / 10));
    }
    return total;
}

function frameToTC(frame, meta) {
    const n = meta.nominal;
    let f = Math.max(0, Math.round(frame));
    if (meta.df) {
        const drop = n <= 30 ? 2 : 4;
        const per10 = n * 600 - drop * 9;
        const perMin = n * 60 - drop;
        const d = Math.floor(f / per10);
        const m = f % per10;
        f += drop * 9 * d + (m > drop ? drop * Math.floor((m - drop) / perMin) : 0);
    }
    const ff = f % n;
    const ss = Math.floor(f / n) % 60;
    const mm = Math.floor(f / (n * 60)) % 60;
    const hh = Math.floor(f / (n * 3600));
    return pad(hh) + ':' + pad(mm) + ':' + pad(ss) + (meta.df ? ';' : ':') + pad(ff);
}

// ------------------------------------------------------------------ subtitles
let subCache = { key: '', at: 0, list: [] };
let applying = false;
let lastPoll = null;
let lastPlacedItemId = null;
let lastPlacedAudioId = null;

async function getSubtitles(tl, force) {
    const key = await tl.GetName();
    if (!force && subCache.key === key && Date.now() - subCache.at < 2000) return subCache.list;
    const list = [];
    const tracks = (await tl.GetTrackCount('subtitle')) || 0;
    for (let t = 1; t <= tracks; t++) {
        const items = (await tl.GetItemListInTrack('subtitle', t)) || [];
        for (const it of items) {
            const start = await it.GetStart();
            const end = await it.GetEnd();
            let duration = (typeof it.GetDuration === 'function') ? await it.GetDuration() : 0;
            if (!duration || duration <= 0) duration = Math.max(1, end - start);
            list.push({ text: await it.GetName(), start, end, duration, track: t });
        }
    }
    list.sort((a, b) => a.start - b.start);
    subCache = { key, at: Date.now(), list };
    return list;
}

// Minimized or hidden window: no real-time work (the panel stops polling and rendering), so nothing disturbs Resolve while you work.
// macOS's own Colors panel (with the swatches you saved in it) instead of the web colour picker.
let colorPanelOpen = false, colorChild = null;
function cancelNativeColor() { try { if (colorChild) colorChild.kill('SIGTERM'); } catch (e) { /* ignore */ } try { if (colorViaHelper) { stopJxaHelper(); setTimeout(startJxaHelper, 300); } } catch (e) { /* ignore */ } return true; }
let colorViaHelper = false;
// The Colors panel script is compiled once (osacompile) and warmed up when the app starts, so a click only has to run it:
// no compiling and no cold start of the AppleScript runtime on the click.
const COLOR_SCRIPT_LINES = [
    'on run argv',
    'if (count of argv) < 3 then return "warm"',
    'tell current application to activate',
    'set c to choose color default color {(item 1 of argv as integer), (item 2 of argv as integer), (item 3 of argv as integer)}',
    'return (item 1 of c as text) & "," & (item 2 of c as text) & "," & (item 3 of c as text)',
    'end run'
];
let colorScriptPath = null, colorScriptPromise = null;
function prepareColorScript() {
    if (colorScriptPromise) return colorScriptPromise;
    colorScriptPromise = new Promise((resolve) => {
        if (process.platform !== 'darwin') return resolve(null);
        try {
            ensureDirs();
            const h = require('crypto').createHash('sha1').update(COLOR_SCRIPT_LINES.join('\n')).digest('hex').slice(0, 8);
            const file = path.join(DATA_DIR, 'pick-color-' + h + '.scpt');
            const warm = () => execFile('/usr/bin/osascript', [file], { timeout: 20000 }, () => { colorScriptPath = file; resolve(file); });
            if (fs.existsSync(file)) return warm();
            const args = ['-o', file]; for (const l of COLOR_SCRIPT_LINES) args.push('-e', l);
            execFile('/usr/bin/osacompile', args, { timeout: 20000 }, (err) => { if (err) return resolve(null); warm(); });
        } catch (e) { resolve(null); }
    });
    return colorScriptPromise;
}

// A persistent helper (JXA) keeps AppleScript's runtime loaded, so the Colors panel opens at once.
// If it is not ready or does not answer quickly, the per-click script below is used as before.
const JXA_HELPER = [
    "ObjC.import('Foundation'); ObjC.import('AppKit');",
    "var app = Application.currentApplication(); app.includeStandardAdditions = true;",
    "var sin = $.NSFileHandle.fileHandleWithStandardInput, sout = $.NSFileHandle.fileHandleWithStandardOutput;",
    "function say(t) { sout.writeData($(t + '\\n').dataUsingEncoding($.NSUTF8StringEncoding)); }",
    "say('READY');",
    "while (true) {",
    "  var d = sin.availableData; if (d.length == 0) break;",
    "  var txt = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(d, $.NSUTF8StringEncoding)) || '';",
    "  var lines = txt.split('\\n');",
    "  for (var i = 0; i < lines.length; i++) {",
    "    var ln = lines[i].trim(); if (ln.indexOf('SHOW') !== 0) continue;",
    "    var a = ln.split(' ').slice(1).map(function (x) { return parseInt(x, 10); });",
    "    try {",
    "      var NSApp = $.NSApplication.sharedApplication; NSApp.setActivationPolicy(1);",
    "      var panel = $.NSColorPanel.sharedColorPanel; panel.setShowsAlpha(false);",
    "      panel.setColor($.NSColor.colorWithSRGBRedGreenBlueAlpha(a[0] / 65535, a[1] / 65535, a[2] / 65535, 1));",
    "      panel.setMode(1); panel.setContentSize($.NSMakeSize(264, 372)); panel.center();",
    "      panel.makeKeyAndOrderFront(null); NSApp.activateIgnoringOtherApps(true); say('SHOWN');",
    "      var last = '', cur = '';",
    "      while (panel.isVisible) {",
    "        var ev = NSApp.nextEventMatchingMaskUntilDateInModeDequeue(4294967295, $.NSDate.dateWithTimeIntervalSinceNow(0.06), $.NSDefaultRunLoopMode, true);",
    "        if (ev) NSApp.sendEvent(ev);",
    "        var c = panel.color.colorUsingColorSpace($.NSColorSpace.sRGBColorSpace);",
    "        cur = [c.redComponent, c.greenComponent, c.blueComponent].map(function (x) { return Math.round(x * 65535); }).join(',');",
    "        if (cur !== last) { last = cur; say('LIVE ' + cur); }",
    "      }",
    "      say('COLOR ' + (cur || a.join(',')));",
    "    } catch (e) { say('ERR ' + e); }",
    "  }",
    "}"
].join('\n');
let jxa = null, jxaReady = false, jxaWait = null, jxaBuf = '';
function jxaLine(line) {
    line = line.trim(); if (!line) return;
    if (line === 'READY') { jxaReady = true; return; }
    if (jxaWait) jxaWait(line);
}
function startJxaHelper() {
    if (process.platform !== 'darwin' || jxa) return;
    try {
        ensureDirs();
        const file = path.join(DATA_DIR, 'color-helper.js');
        fs.writeFileSync(file, JXA_HELPER);
        jxaReady = false; jxaBuf = '';
        const ch = require('child_process').spawn('/usr/bin/osascript', ['-l', 'JavaScript', file], { stdio: ['pipe', 'pipe', 'ignore'] });
        jxa = ch;
        ch.stdout.on('data', (b) => { jxaBuf += b.toString(); let i; while ((i = jxaBuf.indexOf('\n')) >= 0) { const l = jxaBuf.slice(0, i); jxaBuf = jxaBuf.slice(i + 1); jxaLine(l); } });
        const gone = () => { if (jxa === ch) { jxa = null; jxaReady = false; if (jxaWait) { const w = jxaWait; w('CANCEL'); } } };
        ch.on('exit', gone); ch.on('error', gone);
        ch.stdin.on('error', () => { });
    } catch (e) { jxa = null; }
}
function stopJxaHelper() { try { if (jxa) jxa.kill('SIGTERM'); } catch (e) { /* ignore */ } jxa = null; jxaReady = false; }
// resolves null when the helper cannot be used (caller falls back), otherwise {hex} / {cancelled}
function pickViaHelper(c, onLive) {
    return new Promise((resolve) => {
        if (!jxa) startJxaHelper();
        const t0 = Date.now();
        const go = () => {
            if (!jxa) return resolve(null);
            if (!jxaReady) { if (Date.now() - t0 > 6000) { stopJxaHelper(); return resolve(null); } return setTimeout(go, 50); }
            let shown = false, done = false;
            const fin = (v) => { if (done) return; done = true; clearTimeout(st); jxaWait = null; resolve(v); };
            const st = setTimeout(() => { if (!shown) { stopJxaHelper(); fin(null); } }, 4000);
            jxaWait = (line) => {
                if (line === 'SHOWN') { shown = true; clearTimeout(st); return; }
                if (line === 'CANCEL') return fin({ cancelled: true, shown });
                if (line.indexOf('ERR') === 0) { if (!shown) { stopJxaHelper(); return fin(null); } return fin({ cancelled: true, shown }); }
                if (line.indexOf('LIVE ') === 0) { try { onLive && onLive(line.slice(5)); } catch (e) { /* ignore */ } return; }
                if (line.indexOf('COLOR ') === 0) return fin({ rgb: line.slice(6) });
            };
            try { jxa.stdin.write('SHOW ' + c.join(' ') + '\n'); } catch (e) { stopJxaHelper(); fin(null); }
        };
        go();
    });
}
function pickNativeColor(event, hex) {
    return new Promise((resolve) => {
        if (process.platform !== 'darwin') return resolve({ ok: false, unsupported: true });
        if (colorPanelOpen) return resolve({ ok: true, busy: true });      // one Colors panel at a time
        colorPanelOpen = true;
        const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
        const v = m ? m[1] : 'ffffff';
        const c = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) * 257);
        const finishH = (r) => {
            colorPanelOpen = false; colorViaHelper = false;
            try { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } } catch (e) { /* ignore */ }
            if (r.cancelled) return resolve({ ok: true, cancelled: true });
            const p = String(r.rgb || '').split(',').map(x => Math.max(0, Math.min(255, Math.round(parseInt(x, 10) / 257))));
            if (p.length !== 3 || p.some(x => !Number.isFinite(x))) return resolve({ ok: false, error: 'Unexpected colour answer' });
            resolve({ ok: true, hex: '#' + p.map(x => x.toString(16).padStart(2, '0')).join('') });
        };
        colorViaHelper = true;
        pickViaHelper(c, (rgb) => { try { const q = rgb.split(',').map(x => Math.max(0, Math.min(255, Math.round(parseInt(x, 10) / 257)))); if (q.length === 3 && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('color:live', '#' + q.map(x => x.toString(16).padStart(2, '0')).join('')); } catch (e) { /* ignore */ } }).then((r) => {
            if (r) return finishH(r);
            colorViaHelper = false;
            runOsaFallback();
        });
        const runOsaFallback = () => {
        const script = [
            'tell current application to activate',
            'set c to choose color default color {' + c.join(', ') + '}',
            'return (item 1 of c as text) & "," & (item 2 of c as text) & "," & (item 3 of c as text)'
        ].join('\n');
        // the precompiled script when it is ready, otherwise the same thing inline
        const osaArgs = colorScriptPath ? [colorScriptPath, String(c[0]), String(c[1]), String(c[2])] : ['-e', script];
        colorChild = execFile('/usr/bin/osascript', osaArgs, { timeout: 15 * 60 * 1000 }, (err, out) => {
            colorPanelOpen = false;
            colorChild = null;
            try { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } } catch (e) { /* ignore */ }      // the panel closed: the app is in front again
            if (err) {
                if (err.killed || err.signal || /-128|User canceled/i.test(String(err.message || err))) return resolve({ ok: true, cancelled: true });
                return resolve({ ok: false, error: String(err.message || err).split('\n')[0] });
            }
            const p = String(out || '').trim().split(',').map(x => Math.max(0, Math.min(255, Math.round(parseInt(x, 10) / 257))));
            if (p.length !== 3 || p.some(x => !Number.isFinite(x))) return resolve({ ok: false, error: 'Unexpected colour answer' });
            resolve({ ok: true, hex: '#' + p.map(x => x.toString(16).padStart(2, '0')).join('') });
        });
        };
    });
}
let appIdle = false;
let parkArmed = false, appIdleReason = '';
function setAppIdle(v, reason) {
    v = !!v;
    if (appIdle === v) return;
    appIdle = v;
    appIdleReason = v ? (reason || 'minimized') : '';
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('win:idle', v, appIdleReason); } catch (e) { /* ignore */ }
}
// After Add to timeline / Apply: real-time work stays paused from the moment the window loses focus (the user went back
// to Resolve) until the window gets focus again.
function parkUntilFocus() {
    parkArmed = true;
    try { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) setAppIdle(true, 'parked'); } catch (e) { /* ignore */ }
    return { ok: true };
}
async function poll(event, force) {
    if (applying && lastPoll) return lastPoll;
    if (appIdle && lastPoll && !force) return lastPoll;
    try {
        const project = await getProject();
        if (!project) return { ok: false, reason: 'Open a project in Resolve' };
        const tl = await project.GetCurrentTimeline();
        if (!tl) return { ok: false, reason: 'Open a timeline in Resolve' };
        const meta = await timelineMeta(tl);
        const subs = await getSubtitles(tl, force);
        const tc = await tl.GetCurrentTimecode();
        const frame = tcToFrame(tc, meta);

        // A selected subtitle wins; otherwise the subtitle under the playhead.
        let sub = null, source = 'playhead';
        try {
            const sel = (await tl.GetSelectedClips()) || [];
            for (const c of sel) {
                const tt = await c.GetTrackTypeAndIndex();
                if (tt && tt[0] === 'subtitle') {
                    const sStart = await c.GetStart();
                    const sEnd = await c.GetEnd();
                    let sDur = (typeof c.GetDuration === 'function') ? await c.GetDuration() : 0;
                    if (!sDur || sDur <= 0) sDur = Math.max(1, sEnd - sStart);
                    const sText = await c.GetName();
                    const idx = subs.findIndex(x => x.start === sStart && x.track === tt[1]);
                    sub = {
                        index: idx >= 0 ? idx + 1 : 1,
                        text: sText,
                        start: sStart,
                        end: sEnd,
                        duration: sDur,
                        track: tt[1]
                    };
                    source = 'selection';
                    break;
                }
            }
        } catch (e) { /* selection not available: fall back to playhead */ }

        if (!sub) {
            // Find subtitle under playhead across all tracks; prefer higher subtitle tracks if overlapping
            const matches = subs.filter(s => frame >= s.start && frame < s.end);
            if (matches.length > 0) {
                const picked = matches.reduce((best, cur) => ((cur.track || 1) >= (best.track || 1) ? cur : best), matches[0]);
                const idx = subs.indexOf(picked);
                sub = Object.assign({ index: idx >= 0 ? idx + 1 : 1 }, picked);
                source = 'playhead';
            }
        }
        lastPoll = { ok: true, timeline: await tl.GetName(), fps: meta.fps, width: meta.width, height: meta.height, frame, tc, count: subs.length, source, subtitle: sub };
        return lastPoll;
    } catch (e) {
        if (hasSeenResolve) checkResolveAlive();
        const msg = String(e && e.message || e);
        if (msg.includes('Not supported on current page')) {
            return { ok: false, reason: 'Switch to the Edit page in Resolve' };
        }
        return { ok: false, reason: msg };
    }
}

// ------------------------------------------------------------------ building the clip
// Placement options (all off by default), set from the pop-up beside "Add to timeline":
//   locked        a locked track counts as occupying its layer (Text+ then goes above it)
//   disabledTrack a disabled track counts as occupying its layer
//   disabledClip  a disabled clip counts as occupying its track
//   firstEmpty    use the lowest empty layer instead of the top one
// Text+ is never put onto a locked or disabled track itself (it cannot be placed / would be invisible).
function placeOpts(o) { o = o || {}; return { locked: !!o.locked, disabledTrack: !!o.disabledTrack, disabledClip: !!o.disabledClip, firstEmpty: !!o.firstEmpty }; }

async function trackUsable(tl, kind, t) {
    try { if (await tl.GetIsTrackLocked(kind, t)) return false; } catch (e) { /* ignore */ }
    try { if ((await tl.GetIsTrackEnabled(kind, t)) === false) return false; } catch (e) { /* ignore */ }
    return true;
}

// Does this track hold something in [s, e) that counts under the placement options?
async function trackHasClip(tl, kind, t, s, e, po) {
    try {
        if (!po.locked && await tl.GetIsTrackLocked(kind, t)) return false;
        if (!po.disabledTrack && (await tl.GetIsTrackEnabled(kind, t)) === false) return false;
    } catch (err) { /* ignore */ }
    for (const it of ((await tl.GetItemListInTrack(kind, t)) || [])) {
        if (!((await it.GetStart()) < e && (await it.GetEnd()) > s)) continue;
        if (!po.disabledClip) {
            let on = true;
            try { on = (await it.GetClipEnabled()) !== false; } catch (err) { on = true; }
            if (!on) continue;
        }
        return true;
    }
    return false;
}

async function trackIsFree(tl, kind, t, s, e) {
    if (await tl.GetIsTrackLocked(kind, t)) return false;
    const items = (await tl.GetItemListInTrack(kind, t)) || [];
    for (const it of items) {
        if ((await it.GetStart()) < e && (await it.GetEnd()) > s) return false;
    }
    return true;
}

// Auto (video) = the top: one track above the highest track that counts as occupied at that moment (see the
// placement options), never a gap lower down; or the lowest empty layer with "first empty layer". A new track is
// added when there is none. Auto (audio) = the lowest free audio track.
async function pickTrack(tl, kind, wanted, s, e, firstAuto, notes, placeIn) {
    const n = await tl.GetTrackCount(kind);
    const label = (kind === 'audio' ? 'A' : 'V');
    const po = placeOpts(placeIn);
    if (kind === 'video' && wanted === 1) { notes.push('V1 is never used for Text+ (it would cut the clips), so the top layer was used'); wanted = 0; }
    if (wanted > 0 && wanted <= n) {
        if (await trackIsFree(tl, kind, wanted, s, e)) return wanted;
        notes.push(label + wanted + ' is busy there, so the lowest free track was used');
    }
    if (kind === 'video') {
        if (po.firstEmpty) {
            for (let t = Math.max(1, firstAuto); t <= n; t++) {
                if (!(await trackUsable(tl, kind, t))) continue;
                if (!(await trackHasClip(tl, kind, t, s, e, po))) return t;
            }
            await tl.AddTrack('video');
            notes.push('no empty layer, added ' + label + (n + 1));
            return n + 1;
        }
        let top = 0;
        for (let t = n; t >= 1; t--) {
            if (await trackHasClip(tl, kind, t, s, e, po)) { top = t; break; }
        }
        let target = Math.max(firstAuto, top + 1);
        while (target <= n && !(await trackUsable(tl, kind, target))) target++;
        if (target <= n) return target;
        await tl.AddTrack('video');
        notes.push('placed on top, added ' + label + (n + 1));
        return n + 1;
    }
    for (let t = firstAuto; t <= n; t++) {
        if (await trackIsFree(tl, kind, t, s, e)) return t;
        notes.push(label + t + ' busy');
    }
    if (kind === 'audio') await tl.AddTrack('audio', 'stereo'); else await tl.AddTrack('video');
    notes.push('no free ' + label + ' track, added ' + label + (n + 1));
    return n + 1;
}

async function fitDuration(item, want) {
    // SetRightOffset(x) leaves x frames trimmed off the right edge (tested: ro + (current - wanted)).
    for (let i = 0; i < 3; i++) {
        const d = await item.GetDuration();
        if (d === want) return true;
        const ro = await item.GetRightOffset();
        await item.SetRightOffset(ro + (d - want));
    }
    return (await item.GetDuration()) === want;
}

async function importSfx(project, sfxPath) {
    const mp = await project.GetMediaPool();
    const keep = await mp.GetCurrentFolder();
    let target = null;
    try {
        const root = await mp.GetRootFolder();
        const subs = (await root.GetSubFolderList()) || [];
        for (const f of subs) { if ((await f.GetName()) === 'Subtitle Animator') { target = f; break; } }
        if (!target) target = await mp.AddSubFolder(root, 'Subtitle Animator');
    } catch (e) { /* ignore */ }
    const want = path.basename(sfxPath);
    if (target) {
        for (const c of ((await target.GetClipList()) || [])) {
            if ((await c.GetName()) === want) return { mp, item: c };
        }
        try { await mp.SetCurrentFolder(target); } catch (e) { /* ignore */ }
    }
    let items = await mp.ImportMedia([sfxPath]);
    if ((!items || !items.length) && target) {
        for (const c of ((await target.GetClipList()) || [])) {
            if ((await c.GetName()) === want) { items = [c]; break; }
        }
    }
    try { if (keep) await mp.SetCurrentFolder(keep); } catch (e) { /* ignore */ }
    return { mp, item: items && items[0] };
}


// InsertFusionTitleIntoTimeline drops the title at the PLAYHEAD as a ripple insert. If the playhead is dragged while
// it is being parked at the end, the title would cut and push the real clips. So the playhead is checked after it is
// moved, the insert is refused when it is not at the end, and an insert that still landed early is ripple-deleted.
async function parkPlayhead(tl, frame, meta) {
    for (let i = 0; i < 4; i++) {
        try {
            await tl.SetCurrentTimecode(frameToTC(frame, meta));
            await new Promise(r => setTimeout(r, 40));
            if (tcToFrame(await tl.GetCurrentTimecode(), meta) === frame) return true;
        } catch (e) { /* retry */ }
        await new Promise(r => setTimeout(r, 120));
    }
    return false;
}
async function insertTitleAtEnd(tl, meta, endFrame) {
    if (!(await parkPlayhead(tl, endFrame, meta))) return { error: 'The playhead was moved while the Text+ was being added, so nothing was inserted. Try again.' };
    const item = await tl.InsertFusionTitleIntoTimeline('Text+');
    if (item) {
        let st = endFrame;
        try { st = await item.GetStart(); } catch (e) { /* ignore */ }
        if (st < endFrame - 1) {
            try { await tl.DeleteClips([item], true); } catch (e) { /* ignore */ }       // ripple delete closes the gap it made
            return { error: 'Resolve put the Text+ at the playhead instead of the end, so it was taken out again. Check the timeline around the playhead and try again.' };
        }
    }
    return { item };
}


// Cut guard: the boundaries of the real clips (V1 and every audio track, Text+ ignored) are noted before and after
// each step this plugin takes on the timeline. A difference is written to _debug/preview-log.txt and shown as a
// warning, so any cut the plugin could cause is caught the moment it happens.
async function cutSnapshot(tl) {
    const out = [];
    try {
        const na = (await tl.GetTrackCount('audio')) || 0;
        const tracks = [['video', 1]];
        for (let t = 1; t <= na; t++) tracks.push(['audio', t]);
        for (const [kind, t] of tracks) {
            for (const it of ((await tl.GetItemListInTrack(kind, t)) || [])) {
                try {
                    const nm = String(await it.GetName());
                    if (/^Text\+/.test(nm)) continue;
                    out.push(kind[0] + t + ':' + (await it.GetStart()) + '-' + (await it.GetEnd()));
                } catch (e) { /* ignore */ }
            }
        }
    } catch (e) { return null; }
    return out;
}
function cutCheck(label, before, after) {
    if (!before || !after) return null;
    const b = new Set(before), a = new Set(after);
    const gone = before.filter(x => !a.has(x)), added = after.filter(x => !b.has(x));
    // A sound effect this plugin places on purpose is the only expected addition.
    if (!gone.length && !added.length) return null;
    dlog('CUTGUARD', label, { removed: gone.slice(0, 20), added: added.slice(0, 20) });
    return gone.length ? 'Warning: clips on the timeline changed during this step (' + gone.length + ' boundaries moved). Details in _debug/preview-log.txt.' : null;
}


// Moves the freshly inserted title (it sits at the END of V1) to its own track, in two steps. Step 1 changes only the
// track and keeps the start at the end of the timeline, so no real clip can be cut or pushed even if Resolve refuses
// the move. Step 2 slides it along that track (an overwrite track that is free there). A title that did not leave V1
// is deleted, with a ripple delete if it had already pushed clips.
async function moveTitleSafe(tl, item, track, textStart, endFrame) {
    const fail = async (msg) => {
        let st = endFrame;
        try { st = await item.GetStart(); } catch (e) { /* ignore */ }
        try { await tl.DeleteClips([item], st < endFrame - 1); } catch (e) { /* the sweep removes it later */ }
        return { ok: false, error: msg };
    };
    if (!(track >= 2)) return await fail('Text+ is never placed on V1 (it would cut your clips).');
    let ok = false;
    try { ok = await item.SetPosition({ trackIndex: track, startFrame: endFrame }); } catch (e) { ok = false; }
    let landed = null;
    try { landed = await item.GetTrackTypeAndIndex(); } catch (e) { landed = null; }
    if (!ok || !landed || landed[1] !== track) return await fail('Could not move the title to track V' + track + '. It was taken out again and nothing else was changed.');
    if (textStart !== endFrame) {
        try { ok = await item.SetPosition({ trackIndex: track, startFrame: textStart }); } catch (e) { ok = false; }
        let st = null;
        try { st = await item.GetStart(); landed = await item.GetTrackTypeAndIndex(); } catch (e) { /* ignore */ }
        if (!ok || st !== textStart || !landed || landed[1] !== track) return { ok: false, error: 'The title is on V' + track + ' but could not be moved to the subtitle position.', leftOnTrack: true };
    }
    return { ok: true };
}

async function apply(event, req) {
    const warnings = [];
    applying = true;
    try {
        const lib = loadLib();
        const anim = lib.animations.find(a => a.id === req.animationId);
        if (!anim) throw new Error('Pick an animation first');
        const text = String(req.text || '').trim();
        if (!text) throw new Error('There is no subtitle text to animate');

        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) throw new Error('Open a timeline in Resolve');
        const meta = await timelineMeta(tl);
        const origTC = await tl.GetCurrentTimecode();
        const tlStart = await tl.GetStartFrame();
        const cutBefore = await cutSnapshot(tl);

        // Text+ alignment is the anchor; SFX follows Text+ start + sfxOffset.
        const textStart = Math.max(tlStart, Math.round(req.start + (req.textOffset || 0)));
        const textEnd = Math.round(req.end + (req.tail || 0));
        const want = Math.max(5, textEnd - textStart);

        const trackNotes = [];
        if (req.live && liveSession) await liveRemove();      // first, so a leftover preview clip cannot change which layer is picked
        const vTrack = await pickTrack(tl, 'video', req.textTrack || 0, textStart, textStart + want, 2, trackNotes, req.place);

        // Prepare SFX before touching the timeline playhead so playhead time at tlEnd is minimal.
        let sfxInfo = null;
        let sfxPath = null;
        if (req.sfxPath && fs.existsSync(req.sfxPath)) {
            sfxPath = req.sfxPath;
        } else {
            const sfxName = req.sfx || anim.sfx || lib.defaultSfx;
            if (sfxName) sfxPath = path.join(SFX_DIR, sfxName);
        }
        const live = !!req.live;      // Preview in Resolve: no sound yet, the clip stays a temporary one until Apply
        if (!live && req.useSfx !== false && sfxPath) {
            if (!fs.existsSync(sfxPath)) {
                warnings.push('The sound effect file is missing.');
            } else {
                const { mp, item: mpi } = await importSfx(project, sfxPath);
                if (!mpi) {
                    warnings.push('Resolve could not import the sound effect.');
                } else {
                    const durTC = await mpi.GetClipProperty('Duration');
                    const sfxFrames = Math.max(1, tcToFrame(durTC, meta));
                    const sfxStart = Math.max(tlStart, textStart + Math.round(req.sfxOffset || 0));
                    const sfxTrack = await pickTrack(tl, 'audio', req.sfxTrack || 0, sfxStart, sfxStart + sfxFrames, 1, trackNotes);
                    sfxInfo = { mp, mpi, sfxFrames, sfxStart, sfxTrack };
                }
            }
        }

        // 1. Insert at the very end of the timeline, trim, move to vTrack at textStart, and immediately restore playhead.
        if (req.live) await liveClearMarks(tl);      // no In/Out while Resolve inserts the title
        const tlEnd = await tl.GetEndFrame();
        await sweepTempClips(tl);
        // Direct placement (no playhead move, no ripple): a reusable Text+/Fusion template clip from the Media Pool is
        // appended onto the chosen track at the caption's exact frame. Used when a template exists and checks out.
        let item = await directPlaceTitle(tl, project, vTrack, textStart, want);
        let insertedId = null, finalLen = null;
        if (item) {
            try { insertedId = String(await item.GetUniqueId()); regAdd(insertedId); } catch (e) { /* ignore */ }
            finalLen = want;
        } else {
            // Fallback: Resolve can only insert a title at the playhead on V1, so it is parked at the end and moved up.
            const ins = await insertTitleAtEnd(tl, meta, tlEnd);
            if (ins.error) { try { await tl.SetCurrentTimecode(origTC); } catch (e) { /* ignore */ } throw new Error(ins.error); }
            item = ins.item;
            try { if (item) { insertedId = String(await item.GetUniqueId()); regAdd(insertedId); } } catch (e) { /* ignore */ }
            if (!item) {
                await tl.SetCurrentTimecode(origTC);
                throw new Error('Resolve would not insert a Text+ title. Open the Edit page and try again.');
            }
            if (!(await fitDuration(item, want))) {
                warnings.push('The clip could not be trimmed to the subtitle length (it is ' + (await item.GetDuration()) + ' frames).');
            }
            finalLen = await item.GetDuration();
            const mv = await moveTitleSafe(tl, item, vTrack, textStart, tlEnd);
            try { await tl.SetCurrentTimecode(origTC); } catch (e) { /* ignore */ }
            if (!mv.ok) {
                if (!mv.leftOnTrack) regDel(insertedId);
                throw new Error(mv.error);
            }
            // If Resolve hands out a Media Pool item for this title, keep it as a template for direct placement next time.
            if (!autoTemplate && !templateBroken) { try { const mpi = await item.GetMediaPoolItem(); if (mpi) autoTemplate = mpi; } catch (e) { /* not available */ } }
        }

        if (!live) regDel(insertedId);      // it is now a real subtitle clip, no longer a temporary one
        // 2. Import the animation Fusion comp onto the clip and set the subtitle text.
        const itemId = String(await item.GetUniqueId());
        lastPlacedItemId = itemId;
        const compPath = path.join(ANIM_DIR, anim.file);
        let compName = null;
        if (fs.existsSync(compPath)) {
            const before = (await item.GetFusionCompNameList()) || [];
            await item.ImportFusionComp(compPath);
            const after = (await item.GetFusionCompNameList()) || [];
            const added = after.find(n => !before.includes(n));
            if (added) {
                await item.LoadFusionCompByName(added);
                compName = added;
                for (const n of before) { try { await item.DeleteFusionCompByName(n); } catch (e) { /* ignore */ } }
            }
        } else {
            warnings.push('The animation file is missing, so a plain Text+ was used.');
        }
        if (!compName) { const names = (await item.GetFusionCompNameList()) || []; compName = names[names.length - 1]; }
        const textDesign = designForFusion(compPath, req.textDesign || anim.textDesign || null);
        let liveNodes = null;
        try {
            if (Array.isArray(req.boxList) && req.boxList.length) {
                const r = await bridgeCall('set_boxes', { item: itemId, comp: compName, boxes: fusionBoxes(compPath, req.boxList), textDesign });
                liveNodes = r && r.nodes;
                if (r && r.missing && r.missing.length) warnings.push('Not found in Fusion: ' + r.missing.join(', ') + '.');
                if (r && r.fixedPosition && r.fixedPosition.length) warnings.push('Position not changed (animated or not published): ' + r.fixedPosition.join(', ') + '.');
            } else if (!(await bridgeCall('set_text', { item: itemId, comp: compName, text, textDesign }))) {
                warnings.push('The animation has no Text+ node to put the text in.');
            }
        } catch (e) {
            warnings.push('Could not set the text: ' + e.message);
        }

        // 3. Apply and remember transform (position, scale, rotation) and link preference.
        const posX = Number(req.posX) || 0;
        const posY = Number(req.posY) || 0;
        const scale = Math.max(0.1, Math.min(5, Number(req.scale) || 1));
        const rotation = Number(req.rotation) || 0;
        const wantLink = req.linked !== false;
        if (anim.posX !== posX || anim.posY !== posY || anim.scale !== scale || anim.rotation !== rotation || anim.linked !== wantLink) {
            anim.posX = posX;
            anim.posY = posY;
            anim.scale = scale;
            anim.rotation = rotation;
            anim.linked = wantLink;
            saveLib(lib);
        }
        if (posX !== 0 || posY !== 0 || scale !== 1 || rotation !== 0) {
            try {
                let pan = Number(posX) || 0;
                let tilt = Number(posY) || 0;
                // Legacy preset migration: if posX and posY are normalized ratios (<= 1.0) and non-zero, convert to timeline pixels
                if (Math.abs(pan) <= 1.0 && Math.abs(tilt) <= 1.0 && (pan !== 0 || tilt !== 0)) {
                    pan = Math.round(pan * meta.width * 100) / 100;
                    tilt = Math.round(-tilt * meta.height * 100) / 100;
                } else {
                    pan = Math.round(pan * 1000) / 1000;
                    tilt = Math.round(tilt * 1000) / 1000;
                }
                const zoom = Math.round(scale * 1000) / 1000;
                const rotAngle = Math.round(rotation * 1000) / 1000;
                await item.SetProperties({
                    TransformEnabled: true,
                    Pan: pan,
                    Tilt: tilt,
                    ZoomGang: true,
                    ZoomX: zoom,
                    ZoomY: zoom,
                    RotationAngle: rotAngle
                });
            } catch (e) {
                warnings.push('Could not set transform properties: ' + e.message);
            }
        }

        // 4. Sound effect (aligned to Text+ start + sfxOffset) and clip linking on timeline.
        let sfxTrack = null;
        let clipsLinked = false;
        if (sfxInfo) {
            sfxTrack = sfxInfo.sfxTrack;
            const placed = await sfxInfo.mp.AppendToTimeline([{
                mediaPoolItem: sfxInfo.mpi, mediaType: 2, trackIndex: sfxInfo.sfxTrack,
                recordFrame: sfxInfo.sfxStart, startFrame: 0, endFrame: sfxInfo.sfxFrames
            }]);
            if (!placed || !placed.length) {
                warnings.push('The sound effect could not be placed.');
            } else {
                const sfxItem = placed[0];
                const targetVol = (req.sfxVolume !== undefined && req.sfxVolume !== null)
                    ? Number(req.sfxVolume)
                    : (anim.sfxVolume !== undefined && anim.sfxVolume !== null ? Number(anim.sfxVolume) : 0);
                try {
                    await sfxItem.SetProperties({
                        AudioVolumeEnabled: true,
                        AudioVolume: targetVol
                    });
                } catch (e) {
                    warnings.push('Could not set sound volume: ' + e.message);
                }
                const sfxId = String(await sfxItem.GetUniqueId());
                lastPlacedAudioId = sfxId;
                try {
                    let linkedOk = false;
                    if (typeof tl.SetClipsLinked === 'function') {
                        linkedOk = await tl.SetClipsLinked([item, sfxItem], wantLink);
                    }
                    if (!linkedOk) {
                        linkedOk = await bridgeCall('link_clips', { videoId: itemId, audioId: sfxId, linked: wantLink, volume: targetVol });
                    }
                    clipsLinked = !!(wantLink && linkedOk);
                } catch (e) {
                    warnings.push('Could not link text and sound clips: ' + e.message);
                }
            }
        }

        // 5. Once everything is placed, touch the text again so Resolve renders the Follower animation (it can
        //    otherwise stay blank on a freshly imported comp).
        try {
            await new Promise(r => setTimeout(r, 120));
            await bridgeCall('refresh', { item: itemId, comp: compName });
        } catch (e) { /* the clip is placed; this is only a safety refresh */ }

        if (live) {
            let liveSfxId = null;
            try {
                const r = await placeLiveSfx(tl, project, meta, sfxPath, req, anim, textStart, trackNotes, item, itemId);
                if (r) { liveSfxId = r.id; sfxTrack = r.track; }
                else if (req.useSfx !== false && sfxPath) warnings.push('The sound effect could not be placed.');
            } catch (e) { warnings.push('Could not place the sound: ' + e.message); }
            liveSession = { itemId, compName, compPath, animId: anim.id, origTC, sfxId: liveSfxId, sfxPath, item };
            try { await item.SetClipColor('Chocolate'); } catch (e) { /* the colour only marks the preview */ }
            await liveSetMarks(tl, item);
            if (!req.keepPlayhead) { try { await tl.SetCurrentTimecode(frameToTC(textStart, meta)); } catch (e) { /* ignore */ } }
            else { try { if ((await tl.GetCurrentTimecode()) !== origTC) await tl.SetCurrentTimecode(origTC); } catch (e) { /* ignore */ } }      // the preview goes where the playhead is; the playhead stays
        }
        { const w = cutCheck(live ? 'apply-live' : 'apply', cutBefore, await cutSnapshot(tl)); if (w) warnings.push(w); }
        subCache.at = 0;
        return { ok: true, live, itemId, videoTrack: vTrack, audioTrack: sfxTrack, linked: clipsLinked, start: textStart, frames: finalLen, warnings, trackNotes, liveNodes };
    } catch (e) {
        return { ok: false, error: String(e && e.message || e), warnings };
    } finally {
        applying = false;
    }
}


// ------------------------------------------------------------------ Preview in Resolve (live Text+ on the timeline)

// In/Out on the timeline around the preview clip, so Resolve plays (loops) just that range. The user's own In/Out
// are remembered once and put back when the preview ends.
async function liveSetMarks(tl, item) {
    try {
        if (liveMarks.saved === undefined) { try { liveMarks.saved = (await tl.GetMarkInOut()) || null; } catch (e) { liveMarks.saved = null; } }
        // Resolve takes mark frames relative to the start of the timeline. The marks are only ever moved, never cleared.
        const base = (await tl.GetStartFrame()) || 0;
        const s = (await item.GetStart()) - base, d = await item.GetDuration();
        await tl.SetMarkInOut(s, s + Math.max(1, d) - 1, 'all');
    } catch (e) { /* marks are a convenience */ }
}
// Takes the preview's In/Out off the timeline without losing the user's own (remembered once, restored at the end).
// Used between captions and right before a Text+ is inserted, so a stale In/Out can never influence the insert.
async function liveClearMarks(tl) {
    try {
        if (liveMarks.saved === undefined) { try { liveMarks.saved = (await tl.GetMarkInOut()) || null; } catch (e) { liveMarks.saved = null; } }
        await tl.ClearMarkInOut('all');
    } catch (e) { /* marks are a convenience */ }
}
// Puts the user's own marks back, type by type. A type that had no marks before is cleared (those are ours).
async function liveRestoreMarks(tl) {
    if (liveMarks.saved === undefined) return;
    const saved = liveMarks.saved;
    liveMarks.saved = undefined;
    for (const type of ['video', 'audio']) {
        try {
            const v = saved && saved[type];
            if (v && typeof v.in === 'number' && typeof v.out === 'number' && v.out >= v.in) await tl.SetMarkInOut(v.in, v.out, type);
            else await tl.ClearMarkInOut(type);
        } catch (e) { /* ignore */ }
    }
}


// Resolve's own Loop (Playback > Loop/Unloop, Cmd+/). The menu item is a plain toggle with no check mark, so its state
// cannot be read: it is clicked once when a preview starts and once more when it ends (undoing only what the preview
// did). If Loop is already on, say so in the panel and it is left alone. Needs macOS Accessibility permission.
let loopToggled = false;
function clickLoopMenu() {
    return new Promise((resolve) => {
        if (process.platform !== 'darwin') return resolve({ ok: false, error: 'Only on macOS' });
        const script = [
            'tell application "System Events"',
            '  set p to first process whose name contains "DaVinci Resolve"',
            '  tell p to click menu item "Loop/Unloop" of menu 1 of menu bar item "Playback" of menu bar 1',
            'end tell',
            'return "ok"'
        ].join('\n');
        execFile('/usr/bin/osascript', ['-e', script], { timeout: 8000 }, (err) => {
            if (!err) return resolve({ ok: true });
            const why = String(err.message || err).split('\n')[0];
            // fall back to the shortcut Cmd+/ (needs Resolve in front)
            const key = 'tell application "DaVinci Resolve" to activate\ndelay 0.3\ntell application "System Events" to keystroke "/" using command down';
            execFile('/usr/bin/osascript', ['-e', key], { timeout: 8000 }, (err2) => {
                if (err2) return resolve({ ok: false, error: why });
                resolve({ ok: true, viaKey: true });
            });
        });
    });
}
// The Loop button in Resolve's viewer is a check box, so its real state can be read (value 1 = on) instead of toggling blind.
function readLoopState() {
    return new Promise((resolve) => {
        if (process.platform !== 'darwin') return resolve('unknown');
        const script = [
            'tell application "System Events"',
            '  try',
            '    set p to first process whose name contains "DaVinci Resolve"',
            '    set found to (every UI element of entire contents of window 1 of p whose role is "AXCheckBox" and name is "Loop")',
            '    if (count of found) is 0 then return "unknown"',
            '    set v to value of item 1 of found',
            '    if v is 1 or v is true then return "on"',
            '    return "off"',
            '  on error',
            '    return "unknown"',
            '  end try',
            'end tell'
        ].join('\n');
        execFile('/usr/bin/osascript', ['-e', script], { timeout: 12000 }, (err, out) => {
            const t = String(out || '').trim();
            resolve(!err && (t === 'on' || t === 'off') ? t : 'unknown');
        });
    });
}
async function loopOn(alreadyOn) {
    const st = await readLoopState();
    dlog('[loop] state before: ' + st + ' alreadyOn=' + alreadyOn + ' toggled=' + loopToggled);
    if (st === 'on') return { ok: true, skipped: true };
    if (st === 'off') {
        const r = await clickLoopMenu();
        if (!r.ok) return r;
        const st2 = await readLoopState();
        dlog('[loop] state after click: ' + st2);
        if (st2 === 'off') {            // the click did nothing: try the shortcut as well
            const key = 'tell application "DaVinci Resolve" to activate\ndelay 0.3\ntell application "System Events" to keystroke "/" using command down';
            await new Promise((res) => execFile('/usr/bin/osascript', ['-e', key], { timeout: 8000 }, () => res()));
        }
        loopToggled = true;
        return r;
    }
    // state cannot be read: the old blind behaviour
    if (alreadyOn || loopToggled) return { ok: true, skipped: true };
    const r = await clickLoopMenu();
    if (r.ok) loopToggled = true;
    return r;
}
async function loopRestore() {
    if (!loopToggled) return { ok: true };
    loopToggled = false;
    const st = await readLoopState();
    if (st === 'off') return { ok: true };       // already off: nothing to undo
    return await clickLoopMenu();
}


// ---- Direct placement of a Text+ from a template clip in the Media Pool
// AppendToTimeline takes a track and a record frame, so a template clip can go exactly where the caption is: no playhead
// move, no ripple. The template is a clip named "Subtitle Animator Template" in the Media Pool (a Fusion Composition or
// Text+ clip), or one Resolve handed out earlier in this session. The result is checked (track, start, length, no real
// clip moved); on any doubt it is taken out again and the app falls back to the park-at-the-end insert for good.
let autoTemplate = null, templateBroken = false, templateGood = 0;      // templateGood: successful placements so far (3 proven = the clip-boundary snapshots are skipped to save time)
async function findTextTemplate(project) {
    try {
        const mp = await project.GetMediaPool();
        const root = await mp.GetRootFolder();
        const folders = [root];
        for (const f of ((await root.GetSubFolderList()) || [])) folders.push(f);
        for (const f of folders) {
            for (const c of ((await f.GetClipList()) || [])) {
                try { if (/^subtitle animator template$/i.test(String(await c.GetName()))) return c; } catch (e) { /* ignore */ }
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}
async function directPlaceTitle(tl, project, track, start, want) {
    if (templateBroken || !(track >= 2)) return null;
    const tpl = (await findTextTemplate(project)) || autoTemplate;
    if (!tpl) return null;
    let item = null;
    const undo = async () => { if (item) { try { await tl.DeleteClips([item], false); } catch (e) { /* the sweep removes it later */ } } };
    try {
        const mp = await project.GetMediaPool();
        const full = templateGood < 3;
        const before = full ? await cutSnapshot(tl) : null;
        const placed = await mp.AppendToTimeline([{ mediaPoolItem: tpl, mediaType: 1, trackIndex: track, recordFrame: start, startFrame: 0, endFrame: want }]);
        item = placed && placed[0];
        let ok = !!item, why = 'no clip returned';
        if (ok) {
            const ti = await item.GetTrackTypeAndIndex();
            if (!ti || ti[0] !== 'video' || ti[1] !== track) { ok = false; why = 'landed on ' + JSON.stringify(ti); }
            else if ((await item.GetStart()) !== start) { ok = false; why = 'start ' + (await item.GetStart()); }
            else if ((await item.GetDuration()) !== want) { ok = false; why = 'length ' + (await item.GetDuration()); }
            else if (typeof item.GetFusionCompCount === 'function' && !((await item.GetFusionCompCount()) >= 1)) { ok = false; why = 'no Fusion comp on it'; }
        }
        if (ok && full) {
            const after = await cutSnapshot(tl);
            if (before && after && (before.length !== after.length || before.some(x => !after.includes(x)))) { ok = false; why = 'real clips changed'; }
        }
        if (!ok) { dlog('TEMPLATE-FAIL', why); await undo(); templateBroken = true; return null; }
        templateGood++;
        if (templateGood <= 3) dlog('TEMPLATE-OK', { track, start, want });
        return item;
    } catch (e) {
        dlog('TEMPLATE-ERROR', String(e && e.message || e));
        await undo();
        templateBroken = true;
        return null;
    }
}

async function findAudioItemById(tl, id) {
    if (!id) return null;
    const tracks = (await tl.GetTrackCount('audio')) || 0;
    for (let t = 1; t <= tracks; t++) {
        for (const it of ((await tl.GetItemListInTrack('audio', t)) || [])) {
            try { if (String(await it.GetUniqueId()) === String(id)) return it; } catch (e) { /* ignore */ }
        }
    }
    return null;
}
// The sound of a Preview in Resolve: a real clip on the timeline, linked to the Text+ unless linking is off; it can still be moved / trimmed by hand.
async function placeLiveSfx(tl, project, meta, sfxPath, req, anim, textStart, notes, videoItem, videoId) {
    if (!sfxPath || req.useSfx === false || !fs.existsSync(sfxPath)) return null;
    const tlStart = await tl.GetStartFrame();
    const { mp, item: mpi } = await importSfx(project, sfxPath);
    if (!mpi) return null;
    const sfxFrames = Math.max(1, tcToFrame(await mpi.GetClipProperty('Duration'), meta));
    const sfxStart = Math.max(tlStart, textStart + Math.round(req.sfxOffset || 0));
    const track = await pickTrack(tl, 'audio', req.sfxTrack || 0, sfxStart, sfxStart + sfxFrames, 1, notes);
    const placed = await mp.AppendToTimeline([{ mediaPoolItem: mpi, mediaType: 2, trackIndex: track, recordFrame: sfxStart, startFrame: 0, endFrame: sfxFrames }]);
    if (!placed || !placed.length) return null;
    const it = placed[0];
    const vol = (req.sfxVolume !== undefined && req.sfxVolume !== null) ? Number(req.sfxVolume) : (anim && anim.sfxVolume != null ? Number(anim.sfxVolume) : 0);
    try { await it.SetProperties({ AudioVolumeEnabled: true, AudioVolume: vol }); } catch (e) { /* volume is a convenience */ }
    const id = String(await it.GetUniqueId());
    regAdd(id);
    // linked with the Text+ by default (the "Link text + sound" choice), so they move together in Resolve
    let linked = false;
    if (req.linked !== false && videoItem) {
        try {
            if (typeof tl.SetClipsLinked === 'function') linked = !!(await tl.SetClipsLinked([videoItem, it], true));
            if (!linked && videoId) linked = !!(await bridgeCall('link_clips', { videoId: String(videoId), audioId: id, linked: true, volume: vol }));
        } catch (e) { linked = false; }
    }
    return { item: it, id, track, linked };
}

async function findItemById(tl, id) {
    const tracks = (await tl.GetTrackCount('video')) || 0;
    for (let t = 1; t <= tracks; t++) {
        for (const it of ((await tl.GetItemListInTrack('video', t)) || [])) {
            try { if (String(await it.GetUniqueId()) === String(id)) return it; } catch (e) { /* ignore */ }
        }
    }
    return null;
}

function transformProps(req, meta) {
    const posX = Number(req.posX) || 0, posY = Number(req.posY) || 0;
    const scale = Math.max(0.1, Math.min(5, Number(req.scale) || 1));
    let pan = posX, tilt = posY;
    if (Math.abs(pan) <= 1.0 && Math.abs(tilt) <= 1.0 && (pan !== 0 || tilt !== 0)) {
        pan = Math.round(pan * meta.width * 100) / 100;
        tilt = Math.round(-tilt * meta.height * 100) / 100;
    } else { pan = Math.round(pan * 1000) / 1000; tilt = Math.round(tilt * 1000) / 1000; }
    const zoom = Math.round(scale * 1000) / 1000;
    return { TransformEnabled: true, Pan: pan, Tilt: tilt, ZoomGang: true, ZoomX: zoom, ZoomY: zoom, RotationAngle: Math.round((Number(req.rotation) || 0) * 1000) / 1000 };
}

// Re-applies text, Text Design, boxes, transform and timing from the panel onto the live clip.
async function liveUpdate(event, req) {
    if (!liveSession) return { ok: false, error: 'No Resolve preview is running', gone: true };
    if (applying) return { ok: false, busy: true };
    applying = true;
    try {
        const lib = loadLib();
        const anim = lib.animations.find(a => a.id === liveSession.animId);
        if (!anim) throw new Error('Preset not found');
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) throw new Error('Open a timeline in Resolve');
        const item = await findItemById(tl, liveSession.itemId);
        if (!item) { liveSession = null; return { ok: false, gone: true, error: 'The preview clip is no longer on the timeline' }; }
        const tc0 = await tl.GetCurrentTimecode();      // the playhead stays where it is while the clip is moved
        const meta = await timelineMeta(tl);
        const tlStart = await tl.GetStartFrame();
        const textStart = Math.max(tlStart, Math.round(req.start + (req.textOffset || 0)));
        const want = Math.max(5, Math.round(req.end + (req.tail || 0)) - textStart);
        const warnings = [];
        const ti = await item.GetTrackTypeAndIndex();
        let track = ti ? ti[1] : 1;
        if (req.textTrack > 0 && req.textTrack !== track) {
            const ok = req.textTrack >= 2 && await trackUsable(tl, 'video', req.textTrack) && req.textTrack <= (await tl.GetTrackCount('video'));
            if (ok) track = req.textTrack; else warnings.push('V' + req.textTrack + ' is locked or disabled, so the clip stayed where it is.');
        }
        // Another caption: the same Text+ (and its sound) is moved there, nothing is deleted or inserted again. The layer
        // is chosen with the Placement options, like a fresh insert.
        const moved = (await item.GetStart()) !== textStart;
        if (moved) {
            await liveClearMarks(tl);
            // the old sound goes first: a linked sound would otherwise be dragged along onto whatever is at the new place
            try {
                const old = liveSession.sfxId ? await findAudioItemById(tl, liveSession.sfxId) : null;
                if (old) { const ok = await tl.DeleteClips([old], false); if (ok) regDel(liveSession.sfxId); }
                liveSession.sfxId = null;
            } catch (e) { /* the sweep removes it later */ }
            if (!(req.textTrack > 0)) {
                try { const t2 = await pickTrack(tl, 'video', 0, textStart, textStart + want, 2, [], req.place); if (t2 >= 2) track = t2; } catch (e) { /* keep the current layer */ }
            }
        }
        if ((await item.GetDuration()) > want) await fitDuration(item, want);          // shorter first, so it cannot run into a neighbour
        if (track >= 2 && (moved || (ti && ti[1] !== track))) await item.SetPosition({ trackIndex: track, startFrame: textStart });
        if ((await item.GetDuration()) !== want) await fitDuration(item, want);
        let sfxMoved = false;
        if (moved) {
            try {
                if (req.sfxPath) liveSession.sfxPath = req.sfxPath;      // the sound is cut for THIS caption's length (Estimate / Fixed)
                const r = await placeLiveSfx(tl, project, meta, liveSession.sfxPath, req, anim, textStart, [], item, liveSession.itemId);
                if (r) { liveSession.sfxId = r.id; sfxMoved = true; }
            } catch (e) { warnings.push('Could not move the sound: ' + e.message); }
        }
        const compPath = liveSession.compPath, compName = liveSession.compName, itemId = liveSession.itemId;
        const textDesign = designForFusion(compPath, req.textDesign || anim.textDesign || null, undefined, true);
        const text = String(req.text || '').trim() || SAMPLE_TEXTS[0];
        try {
            if (Array.isArray(req.boxList) && req.boxList.length) {
                await bridgeCall('set_boxes', { item: itemId, comp: compName, boxes: fusionBoxes(compPath, req.boxList, true), textDesign });
            } else {
                await bridgeCall('set_text', { item: itemId, comp: compName, text, textDesign });
            }
        } catch (e) { warnings.push('Could not set the text: ' + e.message); }
        try { await item.SetProperties(transformProps(req, meta)); } catch (e) { warnings.push('Could not set transform: ' + e.message); }
        try { await bridgeCall('refresh', { item: itemId, comp: compName }); } catch (e) { /* safety refresh */ }
        await liveSetMarks(tl, item);
        try { if ((await tl.GetCurrentTimecode()) !== tc0) await tl.SetCurrentTimecode(tc0); } catch (e) { /* ignore */ }
        return { ok: true, warnings, start: textStart, frames: want, track, moved, sfxMoved };
    } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
    } finally { applying = false; }
}

// Is the preview clip still on the timeline? When it was deleted by hand, its sound and In/Out are cleaned up too.
async function liveAlive() {
    if (!liveSession) return { ok: true, alive: false, none: true };
    if (applying) return { ok: true, alive: true };
    try {
        let ok = false;
        try { const st = await liveSession.item.GetStart(); ok = typeof st === 'number' && st >= 0; } catch (e) { ok = false; }
        if (!ok) {
            const project = await getProject();
            const tl = project && await project.GetCurrentTimeline();
            if (!tl) return { ok: true, alive: true };            // cannot tell: assume it is there
            ok = !!(await findItemById(tl, liveSession.itemId));
        }
        if (ok) return { ok: true, alive: true };
        await liveRemove(true);
        return { ok: true, alive: false };
    } catch (e) { return { ok: true, alive: true }; }
}

// Removes the preview clip again and puts the playhead back.
async function liveRemove(keepMarks) {
    const s = liveSession;
    liveSession = null;
    if (!s && keepMarks) return { ok: true };
    try {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        let tcR = null;
        try { if (tl) tcR = await tl.GetCurrentTimecode(); } catch (e) { tcR = null; }
        if (tl && !keepMarks) await liveRestoreMarks(tl);
        else if (tl && keepMarks) await liveClearMarks(tl);       // the clip is gone: its In/Out must not stay behind on the old caption
        if (tl && s) {
            const item = await findItemById(tl, s.itemId);
            const sfxItem = s.sfxId ? await findAudioItemById(tl, s.sfxId) : null;
            const gone = [item, sfxItem].filter(Boolean);
            if (gone.length) { const ok = await tl.DeleteClips(gone, false); if (ok) { regDel(s.itemId); if (s.sfxId) regDel(s.sfxId); } }
            else { regDel(s.itemId); if (s.sfxId) regDel(s.sfxId); }
        }
        try { if (tl && tcR && (await tl.GetCurrentTimecode()) !== tcR) await tl.SetCurrentTimecode(tcR); } catch (e) { /* ignore */ }
    } catch (e) { /* the registry sweep removes it next time */ }
    subCache.at = 0;
    return { ok: true };
}

// Apply: keeps the clip (it is no longer temporary) and adds the sound after it, like "Add to timeline".
async function liveFinish(event, req) {
    if (!liveSession) return { ok: false, error: 'No Resolve preview is running' };
    if (applying) return { ok: false, error: 'Resolve is busy. Try again in a moment.' };
    const s = liveSession;
    applying = true;
    const warnings = [];
    try {
        const lib = loadLib();
        const anim = lib.animations.find(a => a.id === s.animId) || {};
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) throw new Error('Open a timeline in Resolve');
        const item = await findItemById(tl, s.itemId);
        if (!item) { liveSession = null; throw new Error('The preview clip is no longer on the timeline'); }
        const meta = await timelineMeta(tl);
        const tlStart = await tl.GetStartFrame();
        regDel(s.itemId);
        liveSession = null;
        try { await item.ClearClipColor(); } catch (e) { /* ignore */ }
        await liveRestoreMarks(tl);
        const textStart = await item.GetStart();
        const itemId = String(s.itemId);
        lastPlacedItemId = itemId;
        let sfxPath = null;
        if (req.sfxPath && fs.existsSync(req.sfxPath)) sfxPath = req.sfxPath;
        else { const n = req.sfx || anim.sfx || lib.defaultSfx; if (n) sfxPath = path.join(SFX_DIR, n); }
        let sfxTrack = null, clipsLinked = false;
        const trackNotes = [];
        if (s.sfxId) {
            // the sound is already on the timeline from the preview (maybe moved or trimmed by hand): keep it as it is
            const sfxItem = await findAudioItemById(tl, s.sfxId);
            regDel(s.sfxId);
            if (sfxItem) {
                lastPlacedAudioId = String(s.sfxId);
                try { const ti2 = await sfxItem.GetTrackTypeAndIndex(); sfxTrack = ti2 ? ti2[1] : null; } catch (e) { /* ignore */ }
                const wantLink = req.linked !== false;
                const vol = (req.sfxVolume !== undefined && req.sfxVolume !== null) ? Number(req.sfxVolume) : (anim.sfxVolume != null ? Number(anim.sfxVolume) : 0);
                try {
                    let ok = false;
                    if (typeof tl.SetClipsLinked === 'function') ok = await tl.SetClipsLinked([item, sfxItem], wantLink);
                    if (!ok) ok = await bridgeCall('link_clips', { videoId: itemId, audioId: String(s.sfxId), linked: wantLink, volume: vol });
                    clipsLinked = !!(wantLink && ok);
                } catch (e) { warnings.push('Could not link text and sound clips: ' + e.message); }
            }
        } else if (req.useSfx !== false && sfxPath) {
            if (!fs.existsSync(sfxPath)) warnings.push('The sound effect file is missing.');
            else {
                const { mp, item: mpi } = await importSfx(project, sfxPath);
                if (!mpi) warnings.push('Resolve could not import the sound effect.');
                else {
                    const sfxFrames = Math.max(1, tcToFrame(await mpi.GetClipProperty('Duration'), meta));
                    const sfxStart = Math.max(tlStart, textStart + Math.round(req.sfxOffset || 0));
                    sfxTrack = await pickTrack(tl, 'audio', req.sfxTrack || 0, sfxStart, sfxStart + sfxFrames, 1, trackNotes);
                    const placed = await mp.AppendToTimeline([{ mediaPoolItem: mpi, mediaType: 2, trackIndex: sfxTrack, recordFrame: sfxStart, startFrame: 0, endFrame: sfxFrames }]);
                    if (!placed || !placed.length) warnings.push('The sound effect could not be placed.');
                    else {
                        const sfxItem = placed[0];
                        const vol = (req.sfxVolume !== undefined && req.sfxVolume !== null) ? Number(req.sfxVolume) : (anim.sfxVolume != null ? Number(anim.sfxVolume) : 0);
                        try { await sfxItem.SetProperties({ AudioVolumeEnabled: true, AudioVolume: vol }); } catch (e) { warnings.push('Could not set sound volume: ' + e.message); }
                        const sfxId = String(await sfxItem.GetUniqueId());
                        lastPlacedAudioId = sfxId;
                        const wantLink = req.linked !== false;
                        try {
                            let ok = false;
                            if (typeof tl.SetClipsLinked === 'function') ok = await tl.SetClipsLinked([item, sfxItem], wantLink);
                            if (!ok) ok = await bridgeCall('link_clips', { videoId: itemId, audioId: sfxId, linked: wantLink, volume: vol });
                            clipsLinked = !!(wantLink && ok);
                        } catch (e) { warnings.push('Could not link text and sound clips: ' + e.message); }
                    }
                }
            }
        }
        // remember the transform / link choice on the preset, like Add to timeline does
        try {
            const a2 = lib.animations.find(a => a.id === s.animId);
            if (a2) { a2.posX = Number(req.posX) || 0; a2.posY = Number(req.posY) || 0; a2.scale = Math.max(0.1, Math.min(5, Number(req.scale) || 1)); a2.rotation = Number(req.rotation) || 0; a2.linked = req.linked !== false; saveLib(lib); }
        } catch (e) { /* ignore */ }
        subCache.at = 0;
        return { ok: true, videoTrack: ((await item.GetTrackTypeAndIndex()) || [0, 0])[1], audioTrack: sfxTrack, linked: clipsLinked, start: textStart, frames: await item.GetDuration(), warnings, trackNotes };
    } catch (e) {
        return { ok: false, error: String(e && e.message || e), warnings };
    } finally { applying = false; }
}

// ------------------------------------------------------------------ library actions
// Every font family installed on this Mac with the styles each one really has (what Text+ offers in its Font
// and Style boxes), looked up once per run. A Text+ shows "Font Not Found" when the style is not one of these.
let fontCache = null, fontStyleMap = {};
function listSystemFonts() {
    return new Promise((resolve) => {
        if (fontCache) return resolve({ fonts: fontCache, styles: fontStyleMap });
        if (process.platform !== 'darwin') return resolve({ fonts: [], styles: {} });
        const js = 'ObjC.import("AppKit"); const fm = $.NSFontManager.sharedFontManager; const out = {};' +
            'for (const f of ObjC.deepUnwrap(fm.availableFontFamilies)) { let st = []; try { st = (ObjC.deepUnwrap(fm.availableMembersOfFontFamily(f)) || []).map(m => String(m[1])); } catch (e) {} out[f] = st; }' +
            'JSON.stringify(out)';
        execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', js], { timeout: 60000, maxBuffer: 32 * 1024 * 1024 }, (err, out) => {
            try {
                const map = JSON.parse(String(out || '').trim());
                const names = Object.keys(map).filter(x => x && !x.startsWith('.')).sort((a, b) => a.localeCompare(b));
                fontStyleMap = {};
                for (const n of names) fontStyleMap[n] = Array.from(new Set((map[n] || []).filter(Boolean)));
                fontCache = names;
            } catch (e) { fontCache = null; }
            resolve({ fonts: fontCache || [], styles: fontStyleMap });
        });
    });
}
const FONT_WEIGHT_NAME = /[-\s](thin|hairline|extra\s?light|ultra\s?light|light|regular|book|medium|semi\s?bold|demi\s?bold|bold|extra\s?bold|ultra\s?bold|heavy|black|italic|oblique)$/i;
// A style that exists for this font: the wanted one when it does, else Regular (or the first the font has).
function validFontStyle(font, wanted) {
    const key = Object.keys(fontStyleMap).find(k => k.toLowerCase() === String(font || '').toLowerCase());
    const list = key ? fontStyleMap[key] : null;
    if (!key) return wanted;
    // A font with no styles, or one whose family name already carries its weight (Larken-Black, Arial Black), is
    // listed by Resolve with the single style "Regular".
    if (!list || !list.length || (list.length <= 1 && FONT_WEIGHT_NAME.test(String(font)))) return 'Regular';
    const w = String(wanted || '').toLowerCase();
    const hit = list.find(x => x.toLowerCase() === w);
    if (hit) return hit;
    for (const n of ['regular', 'book', 'roman', 'normal', 'medium']) { const r = list.find(x => x.toLowerCase() === n); if (r) return r; }
    return list[0];
}

function resolveFontFiles(fontsList) {
    return new Promise((resolve) => {
        if (!Array.isArray(fontsList) || !fontsList.length) return resolve({});
        if (process.platform !== 'darwin') {
            const found = {};
            const dirs = process.platform === 'win32'
                ? [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts')]
                : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local/share/fonts')];
            for (const item of fontsList) {
                const fam = String(item.family || '').trim();
                if (!fam) continue;
                for (const d of dirs) {
                    if (!fs.existsSync(d)) continue;
                    try {
                        for (const f of fs.readdirSync(d)) {
                            if (f.toLowerCase().includes(fam.toLowerCase())) {
                                found[fam + '|' + (item.style || '')] = path.join(d, f);
                                break;
                            }
                        }
                    } catch (e) { /* ignore */ }
                    if (found[fam + '|' + (item.style || '')]) break;
                }
            }
            return resolve(found);
        }

        const js = `
ObjC.import("AppKit");
ObjC.import("CoreText");
(function() {
    const items = ${JSON.stringify(fontsList)};
    const fm = $.NSFontManager.sharedFontManager;
    const out = {};
    for (const it of items) {
        const family = it.family;
        const style = it.style || "";
        if (!family) continue;
        let postscript = null;
        let members = [];
        try { members = ObjC.deepUnwrap(fm.availableMembersOfFontFamily($(family))) || []; } catch (e) {}
        if (style && members.length) {
            const sLow = String(style).toLowerCase();
            for (const m of members) {
                if (String(m[1]).toLowerCase() === sLow) {
                    postscript = String(m[0]);
                    break;
                }
            }
        }
        if (!postscript && members.length) {
            postscript = String(members[0][0]);
        }
        if (!postscript) {
            postscript = family;
        }

        const nf = $.NSFont.fontWithNameSize($(postscript), 12);
        if (!nf || !nf.fontName) {
            const nfFam = $.NSFont.fontWithNameSize($(family), 12);
            if (nfFam && nfFam.fontName) postscript = family;
            else continue;
        }

        const ct = $.CTFontCreateWithName($(postscript), 12, null);
        if (!ct) continue;
        const url = $.CTFontCopyAttribute(ct, $.kCTFontURLAttribute);
        if (url && url.path) {
            out[family + "|" + style] = String(ObjC.unwrap(url.path));
        }
    }
    return JSON.stringify(out);
})();`;

        execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', js], { timeout: 15000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
            if (err || !stdout) return resolve({});
            try {
                const map = JSON.parse(String(stdout).trim());
                resolve(map || {});
            } catch (e) {
                resolve({});
            }
        });
    });
}

async function copyFontsForSetting(settingFilePath, textDesign) {
    try {
        ensureDirs();
        const fontsToCheck = [];
        const seen = new Set();
        const add = (fam, sty) => {
            if (!fam) return;
            const key = fam.trim() + '|' + (sty || 'Regular').trim();
            if (seen.has(key.toLowerCase())) return;
            seen.add(key.toLowerCase());
            fontsToCheck.push({ family: fam.trim(), style: (sty || 'Regular').trim() });
        };

        if (textDesign && textDesign.font) {
            add(textDesign.font, textDesign.style);
        }
        if (settingFilePath && fs.existsSync(settingFilePath)) {
            try {
                const raw = fs.readFileSync(settingFilePath, 'utf8');
                const fontMatches = [...raw.matchAll(/\bFont\s*=\s*Input\s*\{\s*Value\s*=\s*"([^"]+)"/g)].map(m => m[1]);
                const styleMatches = [...raw.matchAll(/\bStyle\s*=\s*Input\s*\{\s*Value\s*=\s*"([^"]+)"/g)].map(m => m[1]);
                for (let i = 0; i < fontMatches.length; i++) {
                    add(fontMatches[i], styleMatches[i] || 'Regular');
                }
            } catch (e) { /* ignore */ }
        }

        if (!fontsToCheck.length) return [];

        const map = await resolveFontFiles(fontsToCheck);
        const copied = [];
        for (const [key, srcPath] of Object.entries(map)) {
            if (!srcPath || !fs.existsSync(srcPath)) continue;
            const destName = path.basename(srcPath);
            const destPath = path.join(FONTS_DIR, destName);
            try {
                if (!fs.existsSync(destPath)) {
                    fs.copyFileSync(srcPath, destPath);
                    dlog('[fonts] Saved font to fonts folder:', destName, 'from', srcPath);
                }
                copied.push(destName);
            } catch (e) {
                dlog('[fonts] Failed copying font:', srcPath, e.message);
            }
        }
        return copied;
    } catch (err) {
        dlog('[fonts] Error in copyFontsForSetting:', err.message);
        return [];
    }
}

async function syncAllPresetFonts() {
    try {
        ensureDirs();
        const lib = loadLib();
        const fontsToCheck = [];
        const seen = new Set();
        const add = (fam, sty) => {
            if (!fam) return;
            const key = fam.trim() + '|' + (sty || 'Regular').trim();
            if (seen.has(key.toLowerCase())) return;
            seen.add(key.toLowerCase());
            fontsToCheck.push({ family: fam.trim(), style: (sty || 'Regular').trim() });
        };

        for (const a of lib.animations) {
            if (a.textDesign && a.textDesign.font) {
                add(a.textDesign.font, a.textDesign.style);
            }
            if (a.file) {
                const fp = path.join(ANIM_DIR, a.file);
                if (fs.existsSync(fp)) {
                    try {
                        const raw = fs.readFileSync(fp, 'utf8');
                        const fontMatches = [...raw.matchAll(/\bFont\s*=\s*Input\s*\{\s*Value\s*=\s*"([^"]+)"/g)].map(m => m[1]);
                        const styleMatches = [...raw.matchAll(/\bStyle\s*=\s*Input\s*\{\s*Value\s*=\s*"([^"]+)"/g)].map(m => m[1]);
                        for (let i = 0; i < fontMatches.length; i++) {
                            add(fontMatches[i], styleMatches[i] || 'Regular');
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        }

        if (fontsToCheck.length) {
            const map = await resolveFontFiles(fontsToCheck);
            for (const [key, srcPath] of Object.entries(map)) {
                if (!srcPath || !fs.existsSync(srcPath)) continue;
                const destName = path.basename(srcPath);
                const destPath = path.join(FONTS_DIR, destName);
                try {
                    if (!fs.existsSync(destPath)) {
                        fs.copyFileSync(srcPath, destPath);
                        dlog('[fonts] Synced font:', destName);
                    }
                } catch (e) { /* ignore */ }
            }
        }
    } catch (e) { /* ignore */ }
}

function formatAudioDateTime(d = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function cleanAudioStem(name) {
    const base = path.basename(String(name || 'audio'));
    const ext = path.extname(base);
    let stem = base.slice(0, base.length - ext.length);
    stem = stem.replace(/-\d{8}[-_]\d{6}$/, '');
    stem = stem.replace(/(\s+\d+)+$/, '');
    return stem.replace(/[^\w.\- ]+/g, '_').trim().slice(0, 50) || 'audio';
}

function listSfxOriginals() {
    ensureDirs();
    const files = fs.readdirSync(SFX_DIR);
    const out = [];
    for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if (!['.mp3', '.wav', '.m4a', '.aif', '.aiff', '.flac', '.ogg'].includes(ext)) continue;
        if (/-\d{8}[-_]\d{6}\.wav$/i.test(f) || /\(trim [a-f0-9]+\)\.wav$/i.test(f)) continue;
        const full = path.join(SFX_DIR, f);
        try {
            const stat = fs.statSync(full);
            out.push({
                file: f,
                name: path.basename(f, ext),
                ext: ext.slice(1).toUpperCase(),
                size: stat.size,
                path: full,
                mtime: stat.mtimeMs
            });
        } catch (e) { /* ignore */ }
    }
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    return out;
}

function addSfxOriginal(event, p) {
    if (!p) return { error: 'Pick an audio file first' };
    try {
        const file = copySfx(p);
        return { ok: true, file, lib: libForUI() };
    } catch (e) {
        return { error: e.message };
    }
}

function removeSfxOriginal(event, name) {
    if (!name) return { error: 'No file specified' };
    const p = path.join(SFX_DIR, name);
    if (fs.existsSync(p)) {
        try { fs.rmSync(p, { force: true }); } catch (e) { return { error: e.message }; }
    }
    const lib = loadLib();
    let changed = false;
    for (const a of lib.animations) {
        if (a.sfxOrig === name) {
            a.sfxOrig = null;
            changed = true;
        }
        if (a.sfx === name) {
            a.sfx = null;
            changed = true;
        }
    }
    if (lib.defaultSfx === name) {
        lib.defaultSfx = null;
        changed = true;
    }
    if (changed) saveLib(lib);
    return { ok: true, lib: libForUI() };
}

// Stores the trimmed/adjusted audio attached to a preset (.setting) inside sfx/.
// Based on the preserved original audio; overwrites previous attached trimmed audio on every alignment manipulation.
function saveAttachedClip(event, animId, bytes, origName) {
    ensureDirs();
    const lib = loadLib();
    const a = animId ? lib.animations.find(x => x.id === animId) : null;
    let orig = (a && a.sfxOrig) ? a.sfxOrig : (origName || (a && a.sfx) || null);
    if (orig) orig = path.basename(orig);

    const stem = cleanAudioStem(orig || (a && a.name) || 'audio');
    const newFileName = `${stem}-${formatAudioDateTime()}.wav`;
    const newPath = path.join(SFX_DIR, newFileName);
    const buf = Buffer.from(bytes);
    fs.writeFileSync(newPath, buf);

    if (a) {
        // If the preset has an existing attached audio that is not the original, delete it to prevent bloat
        const oldSfx = a.sfx;
        if (oldSfx && oldSfx !== newFileName && oldSfx !== a.sfxOrig && (!orig || oldSfx !== orig)) {
            const oldPath = path.join(SFX_DIR, oldSfx);
            if (fs.existsSync(oldPath)) {
                try { fs.rmSync(oldPath, { force: true }); } catch (e) { /* ignore */ }
            }
        }
        if (!a.sfxOrig && orig) {
            a.sfxOrig = orig;
        }
        a.sfx = newFileName;
        saveLib(lib);
        return { ok: true, sfx: a.sfx, sfxPath: newPath, sfxOrig: a.sfxOrig, sfxOrigPath: a.sfxOrig ? path.join(SFX_DIR, a.sfxOrig) : null, path: newPath, lib: libForUI() };
    }
    return { ok: true, path: newPath, file: newFileName };
}

// A trimmed copy of a sound effect (made in the panel, with its fade-out already applied) is stored here; the
// name carries a hash of its content, so the same trim is only imported into Resolve once.
function saveSfxClip(event, name, bytes) {
    const dir = path.join(DATA_DIR, 'sfx-cache');
    fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(bytes);
    const h = require('crypto').createHash('sha1').update(buf).digest('hex').slice(0, 8);
    const base = String(name || 'sound').replace(/\.[^.]+$/, '').replace(/[^\w.\- ]+/g, '_').slice(0, 60);
    const file = path.join(dir, base + ' (trim ' + h + ').wav');
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
    try {
        const all = fs.readdirSync(dir).map(n => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((x, y) => y.t - x.t);
        for (const o of all.slice(80)) fs.rmSync(path.join(dir, o.n), { force: true });
    } catch (e) { /* ignore */ }
    return { path: file };
}

function wrap(fn) {
    return async (...args) => {
        try { return await fn(...args); } catch (e) { return { error: String(e && e.message || e) }; }
    };
}

// Grabs real 25fps or 30fps frames from a clip on the timeline so the panel can preview the animation in a 3-second loop.
// text: the exact text the frames were rendered with ('' = sample text, null = whatever the captured clip held).
let previewBgNext = null;
let lastCaptureStats = null;   // background the next captured preview was rendered on ('black' | 'white')
// tempDir: write the frames there and leave the preset's saved preview untouched (Use tab one-time overrides).
const CANCEL_FLAG = path.join(os.tmpdir(), 'sa-preview-cancel-' + process.pid);
function clearCancel() { try { fs.rmSync(CANCEL_FLAG, { force: true }); } catch (e) { /* ignore */ } }
function frameList(dir, prefix, info) {
    const n = info.count;
    const map = Array.isArray(info.map) && info.map.length === n ? info.map : null;
    return Array.from({ length: n }, (_, i) => path.join(dir, prefix + String(map && prefix === 'w' ? map[i] : i).padStart(2, '0') + '.png'));
}

// opts: { maxDim, hold, matteBg } - maxDim is the viewer's real pixel size (no point rendering more than the screen
// shows), hold is the preset's Stop Motion frame repeat, matteBg the preview background node used for the white pass.
async function capturePreview(animId, itemId, text, designKey, tempDir, opts) {
    opts = opts || {};
    let meta = opts.meta;
    if (!meta) {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        meta = tl ? await timelineMeta(tl) : { fps: 25 };
    }
    const fps = Math.round(meta.fps || 25);
    const targetCount = Math.round(fps * 3);
    const dir = tempDir || path.join(PREV_DIR, animId);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    // Viewer previews are taken at the timeline's own resolution (1:1 with what Resolve renders); the small
    // background card renders stay light.
    const fullDim = Math.max(meta.width || 1920, meta.height || 1080);
    const want = Number(opts.maxDim) > 0 ? Math.round(Number(opts.maxDim)) : Math.min(fullDim, 1440);
    const maxDim = (tempDir && /__sub$/.test(tempDir)) ? 400 : Math.max(480, Math.min(fullDim, want));
    const t0 = Date.now();
    const res = await bridgeCall('capture', {
        item: itemId, comp: opts.comp || null, count: targetCount, step: 1, maxDim, outDir: dir,
        unique: true, hold: Number(opts.hold) || 1, matteBg: opts.matteBg || null, cancelPath: CANCEL_FLAG
    }, 240000);
    lastCaptureStats = { ms: Date.now() - t0, maxDim, unique: res && res.unique, matte: !!(res && res.matte), hold: Number(opts.hold) || 1 };
    const count = (res && typeof res.count === 'number') ? res.count : ((res && res.frames) ? res.frames.length : 0);
    if (!count) throw new Error('No frames came back');
    if (res && res.frames && res.frames.length) {
        res.frames.forEach((b64, i) => fs.writeFileSync(path.join(dir, 'p' + String(i).padStart(2, '0') + '.png'), Buffer.from(b64, 'base64')));
    }
    const info = { count, step: res.step || 1, fps: res.fps || fps, stamp: Date.now(), text: (typeof text === 'string') ? text : null, designKey: (typeof designKey === 'string') ? designKey : null, bg: previewBgNext || 'black' };
    if (res && Array.isArray(res.map) && res.map.length === count) info.map = res.map;
    if (res && res.matte) info.matte = true;      // p = on black, w = on white: the panel works out the real alpha
    previewBgNext = null;
    if (tempDir) {
        return { preview: info, previewFiles: frameList(dir, 'p', info), previewWhite: info.matte ? frameList(dir, 'w', info) : null };
    }
    const lib = loadLib();
    const a = lib.animations.find(x => x.id === animId);
    if (a) { a.preview = info; saveLib(lib); }
    return true;
}

async function captureFromSelection(event, animId) {
    const item = await findSelectedFusionItem();
    if (!item) return { error: 'Select the Text+ clip on your timeline first' };
    await capturePreview(animId, String(await item.GetUniqueId()));
    return { lib: libForUI() };
}

// Exports the Fusion animation of the Text+ clip selected on the timeline into the library folder.
async function exportSelectedClip(label) {
    const project = await getProject();
    const tl = project && await project.GetCurrentTimeline();
    if (!tl) throw new Error('Open a timeline in Resolve');
    const sel = (await tl.GetSelectedClips()) || [];
    let pick = null;
    for (const c of sel) {
        if ((await c.GetFusionCompCount()) > 0 && String(await c.GetName()).startsWith('Text+')) { pick = c; break; }
    }
    if (!pick) for (const c of sel) { if ((await c.GetFusionCompCount()) > 0) { pick = c; break; } }
    if (!pick) throw new Error('Select an animated Text+ clip on the timeline first, then save');
    const file = uniqueName(ANIM_DIR, label + '.comp');
    ensureDirs();
    const compCount = Math.max(1, (await pick.GetFusionCompCount()) || 1);
    const ok = await pick.ExportFusionComp(path.join(ANIM_DIR, file), compCount);
    if (!ok || !fs.existsSync(path.join(ANIM_DIR, file))) throw new Error('Resolve could not export that clip\'s animation');
    let clipProps = null;
    try {
        if (typeof pick.GetProperties === 'function') {
            clipProps = await pick.GetProperties();
        }
    } catch (e) { /* ignore */ }
    return { file, itemId: String(await pick.GetUniqueId()), props: clipProps };
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
    } else if (req.animPath) {
        const ext = path.extname(req.animPath).toLowerCase();
        if (!['.comp', '.setting'].includes(ext)) return { error: 'The text animation must be a Fusion .comp or .setting file' };
        file = uniqueName(ANIM_DIR, label + ext);
        fs.copyFileSync(req.animPath, path.join(ANIM_DIR, file));
    } else {
        return { error: 'Add the text animation first: drop a .comp file, or use the Text+ selected on your timeline' };
    }
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
    fs.copyFileSync(p, path.join(ANIM_DIR, file));
    const lib = loadLib();
    const a = newAnimation(path.basename(file, path.extname(file)), file);
    lib.animations.push(a);
    saveLib(lib);
    copyFontsForSetting(path.join(ANIM_DIR, a.file), a.textDesign).catch(() => {});
    return { lib: libForUI() };
}

function copySfx(p) {
    if (!p) return null;
    const ext = path.extname(p).toLowerCase();
    if (!['.wav', '.mp3', '.aif', '.aiff', '.m4a', '.flac', '.ogg'].includes(ext)) throw new Error('Drop an audio file (wav, mp3, aif, m4a, flac)');
    ensureDirs();
    const resolved = path.resolve(String(p));
    // If file is already inside sfx dir, do not copy again
    if (resolved.startsWith(SFX_DIR + path.sep)) {
        return path.relative(SFX_DIR, resolved);
    }
    const base = path.basename(p);
    const existing = path.join(SFX_DIR, base);
    if (fs.existsSync(existing)) {
        try {
            const statSrc = fs.statSync(resolved);
            const statDst = fs.statSync(existing);
            if (statSrc.size === statDst.size) {
                return base;
            }
        } catch (e) { /* ignore */ }
    }
    // Check if an existing file has identical content
    try {
        const buf = fs.readFileSync(resolved);
        const h = require('crypto').createHash('sha1').update(buf).digest('hex');
        for (const f of fs.readdirSync(SFX_DIR)) {
            const fp = path.join(SFX_DIR, f);
            if (fs.statSync(fp).isFile()) {
                const fbuf = fs.readFileSync(fp);
                if (fbuf.length === buf.length && require('crypto').createHash('sha1').update(fbuf).digest('hex') === h) {
                    return f;
                }
            }
        }
    } catch (e) { /* ignore */ }
    const file = uniqueName(SFX_DIR, path.basename(p));
    fs.copyFileSync(p, path.join(SFX_DIR, file));
    return file;
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
        fs.copyFileSync(srcPath, path.join(ANIM_DIR, newFile));
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

async function findLatestTimelineTextItem(tl, meta) {
    try {
        const sel = (await tl.GetSelectedClips()) || [];
        for (const c of sel) {
            if ((await c.GetFusionCompCount()) > 0 && String(await c.GetName()).startsWith('Text+')) return c;
        }
        for (const c of sel) {
            if ((await c.GetFusionCompCount()) > 0) return c;
        }
    } catch (e) { /* ignore */ }

    const vCount = await tl.GetTrackCount('video');
    if (lastPlacedItemId) {
        for (let t = vCount; t >= 1; t--) {
            const items = (await tl.GetItemListInTrack('video', t)) || [];
            for (const it of items) {
                if (String(await it.GetUniqueId()) === String(lastPlacedItemId)) return it;
            }
        }
    }

    try {
        const frame = tcToFrame(await tl.GetCurrentTimecode(), meta);
        for (let t = vCount; t >= 2; t--) {
            const items = (await tl.GetItemListInTrack('video', t)) || [];
            for (const it of items) {
                const s = await it.GetStart(), e = await it.GetEnd();
                if (frame >= s && frame < e && (await it.GetFusionCompCount()) > 0) return it;
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}

async function updateLatest(event, req) {
    const lib = loadLib();
    const a = lib.animations.find(x => x.id === req.animationId);
    if (!a) return { error: 'Animation not found' };
    const allowed = ['name', 'useSfx', 'linked', 'textOffset', 'sfxOffset', 'sfxTrimIn', 'sfxLen', 'sfxLenMode', 'sfxFade', 'sfxVolume', 'tail', 'textTrack', 'sfxTrack', 'posX', 'posY', 'scale', 'rotation', 'textDesign', 'boxes', 'sfxOrig'];
    for (const k of allowed) if (k in req && req[k] !== undefined) a[k] = req[k];
    if (req.sfxPath) {
        try {
            const f = copySfx(req.sfxPath);
            if (!a.sfxOrig) a.sfxOrig = f;
            a.sfx = f;
        } catch (e) { /* ignore */ }
    } else if (req.sfx !== undefined) {
        a.sfx = req.sfx;
    }
    if (req.sfxOrig !== undefined) a.sfxOrig = req.sfxOrig;
    saveLib(lib);

    let updatedClip = false;
    try {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (tl) {
            const meta = await timelineMeta(tl);
            const item = await findLatestTimelineTextItem(tl, meta);
            if (item) {
                const itemId = String(await item.GetUniqueId());
                const names = (await item.GetFusionCompNameList()) || [];
                const compName = names[names.length - 1] || null;
                const textArg = (req.updateText && String(req.text || '').trim()) ? String(req.text).trim() : null;
                if (Array.isArray(req.boxList) && req.boxList.length) {
                    await bridgeCall('set_boxes', { item: itemId, comp: compName, boxes: fusionBoxes(path.join(ANIM_DIR, a.file), req.boxList), textDesign: designForFusion(path.join(ANIM_DIR, a.file), a.textDesign || null) });
                } else {
                    await bridgeCall('set_text', {
                        item: itemId,
                        comp: compName,
                        text: textArg,
                        textDesign: designForFusion(path.join(ANIM_DIR, a.file), a.textDesign || null)
                    });
                }
                const posX = Number(a.posX) || 0;
                const posY = Number(a.posY) || 0;
                const scale = Math.max(0.01, Math.min(10, Number(a.scale) || 1));
                const rotation = Number(a.rotation) || 0;
                let pan = Number(posX) || 0;
                let tilt = Number(posY) || 0;
                if (Math.abs(pan) <= 1.0 && Math.abs(tilt) <= 1.0 && (pan !== 0 || tilt !== 0)) {
                    pan = Math.round(pan * meta.width * 100) / 100;
                    tilt = Math.round(-tilt * meta.height * 100) / 100;
                } else {
                    pan = Math.round(pan * 1000) / 1000;
                    tilt = Math.round(tilt * 1000) / 1000;
                }
                const zoom = Math.round(scale * 1000) / 1000;
                const rotAngle = Math.round(rotation * 1000) / 1000;
                await item.SetProperties({
                    TransformEnabled: true,
                    Pan: pan,
                    Tilt: tilt,
                    ZoomGang: true,
                    ZoomX: zoom,
                    ZoomY: zoom,
                    RotationAngle: rotAngle
                });
                updatedClip = true;
            }
        }
    } catch (e) { /* timeline update is best-effort */ }

    return { ok: true, lib: libForUI(), updatedClip, animName: a.name };
}

async function syncLiveTransform(event, req) {
    if (applying || liveSession) return { ok: false };      // a Resolve preview is running: only its own clip is updated
    try {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) return { ok: false };
        const meta = await timelineMeta(tl);
        const item = (await findSelectedFusionItem()) || (await findLatestTimelineTextItem(tl, meta));
        if (!item) return { ok: false };

        let pan = Number(req.posX) || 0;
        let tilt = Number(req.posY) || 0;
        if (Math.abs(pan) <= 1.0 && Math.abs(tilt) <= 1.0 && (pan !== 0 || tilt !== 0)) {
            pan = Math.round(pan * meta.width * 100) / 100;
            tilt = Math.round(-tilt * meta.height * 100) / 100;
        } else {
            pan = Math.round(pan * 1000) / 1000;
            tilt = Math.round(tilt * 1000) / 1000;
        }
        const zoom = Math.round((Number(req.scale) || 1) * 1000) / 1000;
        const rotAngle = Math.round((Number(req.rotation) || 0) * 1000) / 1000;
        await item.SetProperties({
            TransformEnabled: true,
            Pan: pan,
            Tilt: tilt,
            ZoomGang: true,
            ZoomX: zoom,
            ZoomY: zoom,
            RotationAngle: rotAngle
        });

        // Live sync Text Design & text content to timeline Fusion clip. Only the values that differ from the preset
        // file are sent (never the whole design), so the clip's keyframes and follower animation keep playing.
        let liveDesign = null;
        if (req.textDesign) {
            const animE = req.id ? loadLib().animations.find(x => x.id === req.id) : null;
            const cp = animE ? path.join(ANIM_DIR, animE.file) : null;
            liveDesign = (cp && fs.existsSync(cp)) ? designForFusion(cp, req.textDesign, undefined, true) : null;
        }
        if (liveDesign) {
            const itemId = String(await item.GetUniqueId());
            const names = (await item.GetFusionCompNameList()) || [];
            const compName = names[names.length - 1] || null;
            const textArg = (req.text && String(req.text).trim()) ? String(req.text).trim() : null;
            if (Array.isArray(req.boxList) && req.boxList.length) {
                await bridgeCall('set_boxes', {
                    item: itemId,
                    comp: compName,
                    boxes: fusionBoxes(cp, req.boxList, true),
                    textDesign: liveDesign
                }, 4000);
            } else {
                await bridgeCall('set_text', {
                    item: itemId,
                    comp: compName,
                    text: textArg,
                    textDesign: liveDesign
                }, 4000);
            }
        }

        // Live sync sound volume to timeline audio clip if present
        if (req.sfxVolume !== undefined && req.sfxVolume !== null && lastPlacedAudioId) {
            try {
                const project = await getProject();
                const tl = project && await project.GetCurrentTimeline();
                if (tl) {
                    const audioTracks = (await tl.GetTrackCount('audio')) || 0;
                    for (let t = 1; t <= audioTracks; t++) {
                        const aItems = (await tl.GetItemListInTrack('audio', t)) || [];
                        for (const ai of aItems) {
                            if (String(await ai.GetUniqueId()) === String(lastPlacedAudioId)) {
                                await ai.SetProperties({
                                    AudioVolumeEnabled: true,
                                    AudioVolume: Number(req.sfxVolume)
                                });
                                break;
                            }
                        }
                    }
                }
            } catch (e) { /* ignore */ }
        }

        if (req.textDesign) {
            const animId = req.animId;
            const a = animId ? loadLib().animations.find(x => x.id === animId) : null;
            if (a) copyFontsForSetting(path.join(ANIM_DIR, a.file), req.textDesign).catch(() => {});
        }

        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function updateAnimation(event, id, patch) {
    const lib = loadLib();
    const a = lib.animations.find(x => x.id === id);
    if (!a) return { error: 'Animation not found' };
    const allowed = ['name', 'useSfx', 'linked', 'textOffset', 'sfxOffset', 'sfxTrimIn', 'sfxLen', 'sfxLenMode', 'sfxFade', 'sfxVolume', 'tail', 'textTrack', 'sfxTrack', 'posX', 'posY', 'scale', 'rotation', 'textDesign', 'boxes', 'tags', 'sfx', 'sfxOrig'];
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
    return { lib: libForUI() };
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
    fs.copyFileSync(p, path.join(ANIM_DIR, newFile));
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
    copyFontsForSetting(path.join(ANIM_DIR, a.file), null).catch(() => {});
    return { ok: true, lib: libForUI(), kept, oldCount: oldNodes.length, newCount: newNodes.length };
}

async function pickFile(event, kind) {
    const filters = kind === 'sfx'
        ? [{ name: 'Audio', extensions: ['wav', 'mp3', 'aif', 'aiff', 'm4a', 'flac', 'ogg'] }]
        : [{ name: 'Fusion comp / setting', extensions: ['comp', 'setting'] }];
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
}

// The captured preview frames as base64, so the panel can read their pixels (to crop and key them) without any
// cross-origin limits on local files.
function previewData(event, id) {
    const lib = loadLib();
    const a = lib.animations.find(x => x.id === id);
    if (!a || !a.preview) return { frames: [] };
    const dir = path.join(PREV_DIR, id);
    const frames = [];
    for (let i = 0; i < a.preview.count; i++) {
        const f = path.join(dir, 'p' + String(i).padStart(2, '0') + '.png');
        if (fs.existsSync(f)) frames.push(fs.readFileSync(f).toString('base64'));
    }
    return { frames };
}

// Renders a 3-second preview of a preset with sample text, straight from Fusion: a Text+ is dropped at the end of the
// timeline, the preset is loaded onto it, its frames are exported, and the clip is removed again.
const SAMPLE_TEXTS = ['Sample text', 'Second line', 'Third line', 'Fourth line'];

// design / designKey (optional): the panel's current, maybe unsaved, text design to render with.
// temp: render a one-time preview (Use tab) into its own folder; the preset's default preview is not changed.
// Diagnostics: one line per event in _debug/preview-log.txt inside the plugin folder.
// The log goes to the project folder in Documents when it exists (easy to find and share), otherwise next to the plugin.
const DEV_DEBUG_DIR = path.join(os.homedir(), 'Documents', 'Subtitle Animator Plugin', '_debug');
const DEBUG_LOG = fs.existsSync(path.dirname(DEV_DEBUG_DIR)) ? path.join(DEV_DEBUG_DIR, 'preview-log.txt') : path.join(__dirname, '_debug', 'preview-log.txt');
function dlog(...parts) {
    try {
        fs.mkdirSync(path.dirname(DEBUG_LOG), { recursive: true });
        const line = new Date().toISOString() + ' ' + parts.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join(' ') + '\n';
        fs.appendFileSync(DEBUG_LOG, line);
    } catch (e) { /* ignore */ }
}
function frameStats(files) {
    const crypto = require('crypto');
    const hashes = files.map(f => { try { return crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex').slice(0, 8); } catch (e) { return 'missing'; } });
    const runs = [];
    for (const h of hashes) { if (runs.length && runs[runs.length - 1][0] === h) runs[runs.length - 1][1]++; else runs.push([h, 1]); }
    return { frames: hashes.length, unique: new Set(hashes).size, runs: runs.map(r => r[0] + 'x' + r[1]).join(' ') };
}

async function makePreview(event, animId, customText, design, designKey, temp, boxList, opts) {
    const t0 = Date.now();
    // A change you just made wins over a render that is still running: that render stops between two frames and
    // the panel asks again a moment later. Background card renders never cancel anything.
    if (applying && temp !== 'sub' && previewRunning && (previewRunning.temp === 'sub' || previewRunning.id === animId)) {
        try { fs.writeFileSync(CANCEL_FLAG, '1'); } catch (e) { /* ignore */ }
    }
    if (!applying) previewRunning = { id: animId, temp };
    const r = await makePreviewInner(event, animId, customText, design, designKey, temp, boxList, opts);
    if (r && !/busy/i.test(String(r.error || ''))) previewRunning = null;
    const ms = Date.now() - t0, cap = lastCaptureStats;
    // The log is written after the answer goes back, so it never slows the preview down.
    setTimeout(() => {
        try {
            const lib = loadLib();
            const a = lib.animations.find(x => x.id === animId);
            const compPath = a ? path.join(ANIM_DIR, a.file) : null;
            dlog('makePreview', { id: animId, name: a && a.name, temp: temp || false, text: customText || null, ms, error: r && r.error, capture: cap,
                boxes: Array.isArray(boxList) ? boxList.map(b => ({ id: b.id, text: b.text, design: b.design ? designForFusion(compPath, b.design, b.tool) : null })) : null,
                sent: compPath ? designForFusion(compPath, (design && typeof design === 'object') ? design : (a.textDesign || null)) : null });
        } catch (e) { dlog('makePreview log failed', String(e)); }
    }, 50);
    return r;
}

// Preview frames come back from Resolve on black. Text that is (nearly) all dark - e.g. black words with no bright
// outline - would vanish into that black and look like an empty, frozen render, so it is rendered on white instead.
function previewBackground(compPath, design, boxList) {
    try {
        const td = parseTextStyle(compPath, design || null);
        for (const b of (Array.isArray(boxList) ? boxList : [])) {
            if (b && b.design && Array.isArray(b.design.elements)) td.elements = td.elements.concat(b.design.elements);
        }
        const lum = (hex) => {
            const h = String(hex || '#ffffff').replace('#', '');
            const c = (k) => parseInt(h.substr(k * 2, 2), 16) / 255;
            return 0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2);
        };
        const shown = td.elements.filter(e => e && e.enabled && Number(e.opacity ?? 1) > 0.05 && e.alpha !== 0);
        if (!shown.length) return 'black';
        return shown.some(e => lum(e.color) > 0.3 || (Number(e.type) === 2 && lum(e.color2) > 0.3)) ? 'black' : 'white';
    } catch (e) { return 'black'; }
}

// ------------------------------------------------------------------ preview cache
// A finished one-time preview (Use tab / subtitle cards) is kept on disk by what it was rendered from, so going back
// to a text, design or size that was already rendered shows instantly instead of rendering again.
const PREV_CACHE_DIR = path.join(PREV_DIR, '_cache');
const PREV_CACHE_MAX = 24;
function previewCacheKey(animId, anim, compPath, customText, design, boxList, temp, opts, meta) {
    let st = null;
    try { const x = fs.statSync(compPath); st = [x.mtimeMs, x.size]; } catch (e) { return null; }
    const h = require('crypto').createHash('sha1');
    h.update(JSON.stringify([animId, anim.file, st, customText || null, design || null, anim.textDesign || null, boxList || null,
        String(temp), opts && opts.maxDim || 0, meta.fps, meta.width, meta.height, 1]));
    return h.digest('hex').slice(0, 24);
}
function linkOrCopy(src, dst) {
    try { fs.rmSync(dst, { force: true }); } catch (e) { /* ignore */ }
    try { fs.linkSync(src, dst); } catch (e) { fs.copyFileSync(src, dst); }
}
function previewCacheGet(key, animId, temp) {
    if (!key) return null;
    try {
        const cdir = path.join(PREV_CACHE_DIR, key);
        const info = JSON.parse(fs.readFileSync(path.join(cdir, 'info.json'), 'utf8'));
        const first = path.join(cdir, 'p00.png'), lastF = path.join(cdir, 'p' + String(info.count - 1).padStart(2, '0') + '.png');
        if (!fs.existsSync(first) || !fs.existsSync(lastF)) return null;
        const dir = path.join(PREV_DIR, animId + (temp === 'sub' ? '__sub' : '__use'));
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        for (const f of fs.readdirSync(cdir)) if (/^[pw]\d+\.png$/.test(f)) linkOrCopy(path.join(cdir, f), path.join(dir, f));
        if (info.matte && !fs.existsSync(path.join(dir, 'w00.png'))) return null;
        info.stamp = Date.now();
        try { const now = new Date(); fs.utimesSync(cdir, now, now); } catch (e) { /* ignore */ }
        return { preview: info, previewFiles: frameList(dir, 'p', info), previewWhite: info.matte ? frameList(dir, 'w', info) : null };
    } catch (e) { return null; }
}
function previewCachePut(key, t) {
    if (!key || !t || !t.preview || !t.previewFiles || !t.previewFiles.length) return;
    try {
        const cdir = path.join(PREV_CACHE_DIR, key);
        fs.rmSync(cdir, { recursive: true, force: true });
        fs.mkdirSync(cdir, { recursive: true });
        const dir = path.dirname(t.previewFiles[0]);
        for (const f of fs.readdirSync(dir)) if (/^[pw]\d+\.png$/.test(f)) linkOrCopy(path.join(dir, f), path.join(cdir, f));
        fs.writeFileSync(path.join(cdir, 'info.json'), JSON.stringify(t.preview));
        const all = fs.readdirSync(PREV_CACHE_DIR).map(n => ({ n, t: fs.statSync(path.join(PREV_CACHE_DIR, n)).mtimeMs })).sort((a, b) => b.t - a.t);
        for (const o of all.slice(PREV_CACHE_MAX)) fs.rmSync(path.join(PREV_CACHE_DIR, o.n), { recursive: true, force: true });
    } catch (e) { /* the cache is only a shortcut */ }
}

// Deletes preview Text+ clips that are still on the timeline: the render clip itself (by id), and any Text+ that
// starts at or after the old end of the timeline (only the app puts clips there). Returns true when nothing is left.
async function removePreviewLeftovers(tl, endBefore, itemId) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const stray = [];
        const tracks = (await tl.GetTrackCount('video')) || 0;
        for (let t = 1; t <= tracks; t++) {
            for (const it of ((await tl.GetItemListInTrack('video', t)) || [])) {
                try {
                    const id = String(await it.GetUniqueId());
                    const isMine = itemId && id === String(itemId);
                    const pastEnd = endBefore != null && (await it.GetStart()) >= endBefore && String(await it.GetName()).startsWith('Text+');
                    if (isMine || pastEnd) stray.push(it);
                } catch (e) { /* ignore */ }
            }
        }
        if (!stray.length) return true;
        try { await tl.DeleteClips(stray, false); } catch (e) { /* retried once */ }
    }
    return false;
}

// Ids of the temporary Text+ clips this app has put on the timeline. They are written to disk the moment a clip is
// inserted and forgotten only once it is deleted, so a clip left behind by a crash, a quit, a cancelled render or a
// failed "Add to timeline" is found and removed by the next sweep (start of every preview / apply).
let liveMarks = { saved: undefined };      // the timeline's own In/Out before the preview touched them
let liveSession = null;      // the Text+ clip of a running "Preview in Resolve": {itemId, compName, compPath, animId, origTC}
const CLIP_REG = path.join(DATA_DIR, 'temp-clips.json');
function regRead() { try { const a = JSON.parse(fs.readFileSync(CLIP_REG, 'utf8')); return Array.isArray(a) ? a.map(String) : []; } catch (e) { return []; } }
function regWrite(a) { try { fs.writeFileSync(CLIP_REG, JSON.stringify(a)); } catch (e) { /* best effort */ } }
function regAdd(id) { if (!id) return; const a = regRead(); if (!a.includes(String(id))) { a.push(String(id)); regWrite(a); } }
function regDel(id) { if (!id) return; regWrite(regRead().filter(x => x !== String(id))); }
async function sweepTempClips(tl) {
    const ids = new Set(regRead());
    if (liveSession) { ids.delete(String(liveSession.itemId)); if (liveSession.sfxId) ids.delete(String(liveSession.sfxId)); }      // the clip of a running Resolve preview stays
    if (!ids.size || !tl) return;
    try {
        const stray = [], seen = new Set();
        for (const kind of ['video', 'audio']) {
            const tracks = (await tl.GetTrackCount(kind)) || 0;
            for (let t = 1; t <= tracks; t++) {
                for (const it of ((await tl.GetItemListInTrack(kind, t)) || [])) {
                    try { const id = String(await it.GetUniqueId()); if (ids.has(id)) { stray.push(it); seen.add(id); } } catch (e) { /* ignore */ }
                }
            }
        }
        if (stray.length) { try { await tl.DeleteClips(stray, false); } catch (e) { return; } }
        // Entries not on this timeline any more (already deleted, or on another timeline) are dropped once checked.
        regWrite(regRead().filter(x => !seen.has(x)).slice(-60));
    } catch (e) { /* ignore */ }
}

let previewRunning = null;
async function makePreviewInner(event, animId, customText, design, designKey, temp, boxList, opts) {
    if (applying) { dlog('[render] refused: Resolve busy (another step is running)'); return { error: 'Resolve is busy. Try again in a moment.' }; }
    const tRender = Date.now();
    dlog('[render] start', animId, 'temp=' + String(temp));
    applying = true;
    clearCancel();
    lastCaptureStats = null;
    let tl = null, item = null, origTC = null, leftover = false, endBefore = null, itemId = null, ckey = null;
    try {
        const lib = loadLib();
        const anim = lib.animations.find(a => a.id === animId);
        if (!anim) throw new Error('Preset not found');
        const compPath = path.join(ANIM_DIR, anim.file);
        if (!fs.existsSync(compPath)) throw new Error('This preset’s Fusion file is missing');
        const project = await getProject();
        tl = project && await project.GetCurrentTimeline();
        if (!tl) throw new Error('Open a timeline in Resolve');
        const meta = await timelineMeta(tl);
        if (temp) {
            ckey = previewCacheKey(animId, anim, compPath, customText, design, boxList, temp, opts, meta);
            const hit = previewCacheGet(ckey, animId, temp);
            if (hit) { lastCaptureStats = { ms: 0, cached: true }; return { ok: true, temp: hit }; }
        }
        await sweepTempClips(tl);
        origTC = await tl.GetCurrentTimecode();
        endBefore = await tl.GetEndFrame();
        // The render clip goes past the old end of the timeline on a free layer, straight from the template when there is
        // one (no playhead move, no ripple). Otherwise the title is inserted at the end of V1 as before.
        const renderLen = Math.round(meta.fps * 3);
        try {
            const rt = await pickTrack(tl, 'video', 0, endBefore, endBefore + renderLen, 2, []);
            item = await directPlaceTitle(tl, project, rt, endBefore, renderLen);
        } catch (e) { item = null; }
        if (item) {
            try { itemId = String(await item.GetUniqueId()); regAdd(itemId); } catch (e) { /* ignore */ }
        } else {
            const ins = await insertTitleAtEnd(tl, meta, endBefore);
            if (ins.error) { try { await tl.SetCurrentTimecode(origTC); } catch (e) { /* ignore */ } throw new Error(ins.error); }
            item = ins.item;
            try { if (item) { itemId = String(await item.GetUniqueId()); regAdd(itemId); } } catch (e) { /* ignore */ }
            // The playhead is only needed for the insert itself: put it straight back, so it is away for a split second
            // instead of for the whole render (the frames are exported from the clip, not from the playhead).
            try { await tl.SetCurrentTimecode(origTC); } catch (e) { /* restored again below */ }
            if (!item) throw new Error('Resolve would not insert a Text+ title. Open the Edit page and try again.');
            await fitDuration(item, renderLen);
        }
        itemId = String(await item.GetUniqueId());

        const before = (await item.GetFusionCompNameList()) || [];
        await item.ImportFusionComp(compPath);
        const after = (await item.GetFusionCompNameList()) || [];
        const added = after.find(n => !before.includes(n));
        let compName = null;
        if (added) {
            await item.LoadFusionCompByName(added);
            compName = added;
            for (const n of before) { try { await item.DeleteFusionCompByName(n); } catch (e) { /* ignore */ } }
        }
        if (!compName) { const names = (await item.GetFusionCompNameList()) || []; compName = names[names.length - 1]; }

        const textDesign = designForFusion(compPath, (design && typeof design === 'object') ? design : (anim.textDesign || null));
        const nodes = detectNodes(compPath).filter(n => !n.nested);
        const sampleText = (customText && typeof customText === 'string' && customText.trim()) ? customText.trim() : null;
        if (nodes.length) {
            // Every Text+ gets its own text (subtitle, one line, custom text or the preset's own), its own position
            // and its own Text Design, exactly as it will be on the timeline. The saved preview (not temp) keeps
            // sample texts, but still shows each Text+'s own design.
            const given = Array.isArray(boxList) ? boxList : [];
            const multi = nodes.length > 1;
            const boxes = nodes.map((n, i) => {
                const g = given.find(x => x && x.id === n.id) || null;
                const fallback = sampleText || SAMPLE_TEXTS[i % SAMPLE_TEXTS.length];
                let text = fallback;
                if (temp && g) {
                    if (typeof g.text === 'string' && g.text.trim()) text = g.text;
                    else if (g.text === null) text = null;      // "Keep preset's text"
                }
                return {
                    id: n.id, kind: n.kind, tool: n.tool, input: n.input, centerInput: n.centerInput, label: n.label, text,
                    cx: (multi && g && typeof g.cx === 'number') ? g.cx : null,
                    cy: (multi && g && typeof g.cy === 'number') ? g.cy : null,
                    size: (multi && g && typeof g.size === 'number') ? g.size : null,
                    design: (g && g.design && typeof g.design === 'object') ? g.design : null
                };
            });
            await bridgeCall('set_boxes', { item: itemId, comp: compName, boxes: fusionBoxes(compPath, boxes), textDesign });
        } else {
            await bridgeCall('set_text', { item: itemId, comp: compName, text: sampleText || SAMPLE_TEXTS[0], textDesign });
        }
        try {
            await bridgeCall('refresh', { item: itemId, comp: compName });
        } catch (e) { /* only a safety refresh */ }
        // Every preview is rendered on black and then on white. Together they give each pixel's real colour and
        // transparency, so dark text, light text, gradients and soft shadows all show exactly, whatever their colour.
        // The black/white choice below is only the backdrop of the small preset cards.
        let bg = previewBackground(compPath, (design && typeof design === 'object') ? design : (anim.textDesign || null), boxList);
        let matteBg = null;
        try { const r = await bridgeCall('preview_bg', { item: itemId, comp: compName, color: [0, 0, 0] }); if (r && r.ok && r.bg) matteBg = r.bg; } catch (e) { matteBg = null; }
        if (!matteBg && bg === 'white') {
            try { const r = await bridgeCall('preview_bg', { item: itemId, comp: compName, color: [1, 1, 1] }); if (!r || !r.ok) bg = 'black'; } catch (e) { bg = 'black'; }
        }
        previewBgNext = matteBg ? bg : bg;
        const spec = parseTextStyle(compPath, null).animSpec || {};
        const copts = { comp: compName, matteBg, meta, maxDim: opts && opts.maxDim, hold: spec.frameRepeatVar ? 1 : (spec.frameRepeat || 1) };
        if (temp) {
            // Big viewer: a small, quick version goes to the panel first (about a tenth of the pixels), then the
            // full-size one replaces it.
            if (temp === true && opts && opts.draftKey && Number(opts.maxDim) >= 800 && event && event.sender) {
                const keepBg = previewBgNext;
                try {
                    const dt = await capturePreview(animId, itemId, sampleText || '', designKey, path.join(PREV_DIR, animId + '__draft'), Object.assign({}, copts, { maxDim: 480 }));
                    if (!event.sender.isDestroyed()) event.sender.send('preview:draft', { key: opts.draftKey, id: animId, temp: dt });
                } catch (e) {
                    if (/cancelled/i.test(String(e && e.message || e))) throw e;     // a draft is optional; anything else is ignored
                }
                previewBgNext = keepBg;
            }
            const t = await capturePreview(animId, itemId, sampleText || '', designKey, path.join(PREV_DIR, animId + (temp === 'sub' ? '__sub' : '__use')), copts);
            previewCachePut(ckey, t);
            return { ok: true, temp: t };
        }
        await capturePreview(animId, itemId, sampleText || '', designKey, null, copts);
        return { ok: true, lib: libForUI() };
    } catch (e) {
        const msg = String(e && e.message || e);
        return { error: /cancelled/i.test(msg) ? 'Resolve is busy (replaced by a newer change).' : msg };
    } finally {
        dlog('[render] end', animId, (Date.now() - tRender) + ' ms');
        clearCancel();
        try { if (item) { const ok = await tl.DeleteClips([item], false); if (!ok) leftover = true; } } catch (e) { leftover = true; }
        // Make sure the render clip is really gone: whatever this render (or an interrupted earlier one) left at the
        // end of the timeline is found again and deleted.
        try { if (tl && item && await removePreviewLeftovers(tl, endBefore, itemId)) leftover = false; } catch (e) { /* ignore */ }
        if (!leftover && itemId) regDel(itemId);
        try { if (tl && origTC) await tl.SetCurrentTimecode(origTC); } catch (e) { /* ignore */ }
        applying = false;
        if (leftover) console.error('Preview clip could not be removed from the timeline');
    }
}

// Reads the Text+ / template nodes of the clip selected on the timeline, as Fusion really has them.
async function scanClip() {
    const item = await findSelectedFusionItem();
    if (!item) return { error: 'Select the Text+ clip on your timeline first' };
    const names = (await item.GetFusionCompNameList()) || [];
    const res = await bridgeCall('scan', { item: String(await item.GetUniqueId()), comp: names[names.length - 1] || null });
    return { ok: true, nodes: res.nodes || [], clipName: String(await item.GetName()) };
}

// ------------------------------------------------------------------ Fusion helper (Python)
// Resolve's JavaScript plugin interface cannot read the nodes inside a Fusion composition, but its Python
// scripting can, so a small helper (fusion_bridge.py) is kept running and asked to do those parts.
let bridge = null, bridgeBuf = '', bridgeErr = '';
let bridgeSeq = 1;
const bridgePending = new Map();

function pythonPath() {
    const list = [
        '/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Resources/ResolvePython/ResolvePython',
        '/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3'
    ];
    return list.find(p => fs.existsSync(p)) || 'python3';
}

function startBridge() {
    const api = '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting';
    const env = Object.assign({}, process.env, {
        RESOLVE_SCRIPT_API: api,
        RESOLVE_SCRIPT_LIB: '/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so',
        PYTHONPATH: path.join(api, 'Modules') + path.delimiter + (process.env.PYTHONPATH || '')
    });
    bridgeBuf = ''; bridgeErr = '';
    const proc = spawn(pythonPath(), [path.join(__dirname, 'fusion_bridge.py')], { env });
    proc.stdout.on('data', (d) => {
        bridgeBuf += d.toString();
        let i;
        while ((i = bridgeBuf.indexOf('\n')) >= 0) {
            const line = bridgeBuf.slice(0, i); bridgeBuf = bridgeBuf.slice(i + 1);
            try {
                const msg = JSON.parse(line);
                const p = bridgePending.get(msg.id);
                if (p) { bridgePending.delete(msg.id); clearTimeout(p.timer); msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || 'Fusion helper error')); }
            } catch (e) { /* ignore stray output */ }
        }
    });
    proc.stderr.on('data', (d) => { bridgeErr = (bridgeErr + d.toString()).slice(-400); });
    const fail = (why) => {
        for (const [id, p] of bridgePending) { clearTimeout(p.timer); p.reject(new Error(why + (bridgeErr ? ' ' + bridgeErr : ''))); }
        bridgePending.clear();
        if (bridge === proc) bridge = null;
    };
    proc.on('error', (e) => fail('Could not start Python: ' + e.message));
    proc.on('exit', () => fail('The Fusion helper stopped.'));
    return proc;
}

function bridgeCall(op, args, timeoutMs) {
    if (!bridge) bridge = startBridge();
    const id = bridgeSeq++;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            bridgePending.delete(id);
            reject(new Error('The Fusion helper did not answer'));
            if (op === 'capture') { try { if (bridge) bridge.kill(); } catch (e) { /* ignore */ } bridge = null; }      // a stuck render: the helper is started fresh next time
        }, op === 'capture' ? Math.min(timeoutMs || 90000, 90000) : (timeoutMs || 20000));
        bridgePending.set(id, { resolve, reject, timer });
        try { bridge.stdin.write(JSON.stringify({ id, op, args }) + '\n'); } catch (e) { bridgePending.delete(id); clearTimeout(timer); reject(e); }
    });
}

// ------------------------------------------------------------------ selected Fusion clip helper
async function findSelectedFusionItem() {
    const project = await getProject();
    const tl = project && await project.GetCurrentTimeline();
    if (!tl) return null;
    const sel = (await tl.GetSelectedClips()) || [];
    for (const c of sel) {
        if ((await c.GetFusionCompCount()) > 0 && String(await c.GetName()).startsWith('Text+')) return c;
    }
    for (const c of sel) { if ((await c.GetFusionCompCount()) > 0) return c; }
    return null;
}

// ------------------------------------------------------------------ playhead, live frame, sounds, always-on-top
async function liveFrame(event, frame) {
    if (applying) return { ok: false, busy: true };
    // Full timeline resolution for the viewer's background frame.
    const res = await bridgeCall('live_frame', { frame, maxDim: 8192 }, 15000);
    return Object.assign({ ok: true }, res);
}

async function seek(event, frame) {
    const project = await getProject();
    const tl = project && await project.GetCurrentTimeline();
    if (!tl) return false;
    const meta = await timelineMeta(tl);
    return await tl.SetCurrentTimecode(frameToTC(frame, meta));
}

// The panel draws the waveform itself; it gets bytes of library or dropped sound files.
function readSfx(event, p) {
    const full = path.resolve(String(p));
    if (!fs.existsSync(full)) throw new Error('Sound file not found: ' + full);
    return fs.readFileSync(full);
}

function applyOnTop(flag) {
    if (!mainWindow) return;
    if (flag) {
        mainWindow.setAlwaysOnTop(true, 'floating');
        try { mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch (e) { /* ignore */ }
    } else {
        mainWindow.setAlwaysOnTop(false);
        try { mainWindow.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true }); } catch (e) { /* ignore */ }
    }
}

function setOnTop(event, flag) {
    const lib = loadLib();
    lib.alwaysOnTop = !!flag;
    saveLib(lib);
    applyOnTop(lib.alwaysOnTop);
    return { lib: libForUI() };
}

let preSidebarBounds = null;

// Sizes the window so its content area is exactly `contentWidth` wide (kept on screen); the height is left alone.
// Called by the panel each time it opens, so the window always starts at the width its layout needs.
async function fitWidth(event, contentWidth, mode) {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    const bounds = mainWindow.getBounds();
    const [cw] = mainWindow.getContentSize();
    const frameExtra = Math.max(0, bounds.width - cw);
    const display = screen ? screen.getDisplayMatching(bounds) : null;
    const wa = display ? display.workArea : { x: 0, y: 0, width: 1920, height: 1080 };
    const minW = (mainWindow.getMinimumSize() || [380])[0] || 380;
    const w = Math.round(Math.max(minW, Math.min(wa.width - 20, Number(contentWidth) + frameExtra)));
    let x = bounds.x;
    if (x + w > wa.x + wa.width) x = Math.max(wa.x + 10, wa.x + wa.width - w);
    if (x < wa.x) x = wa.x + 10;
    mainWindow.setBounds({ x: Math.round(x), y: Math.round(bounds.y), width: w, height: Math.round(bounds.height) }, false);
    // Opening straight into the sidebar layout: remember the narrow width so leaving the sidebar restores it.
    if (mode === 'sidebar') preSidebarBounds = { x: Math.round(x), y: Math.round(bounds.y), width: 460, height: Math.round(bounds.height) };
    else preSidebarBounds = null;
    return { ok: true, width: w };
}

async function setLayoutMode(event, mode) {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    const bounds = mainWindow.getBounds();
    const currentScreen = screen ? screen.getDisplayMatching(bounds) : null;
    const workArea = currentScreen ? currentScreen.workArea : { x: 0, y: 0, width: 1920, height: 1080 };

    if (mode === 'sidebar') {
        if (!preSidebarBounds) {
            preSidebarBounds = { ...bounds };
        }
        const targetW = Math.min(workArea.width - 20, Math.max(1160, bounds.width + 440));
        let newX = bounds.x;
        if (newX + targetW > workArea.x + workArea.width) {
            newX = Math.max(workArea.x + 10, workArea.x + workArea.width - targetW);
        }
        mainWindow.setBounds({
            x: Math.round(newX),
            y: Math.round(bounds.y),
            width: Math.round(targetW),
            height: Math.round(bounds.height)
        }, true);
        return { ok: true, mode: 'sidebar', width: targetW };
    } else {
        if (preSidebarBounds && bounds.width > 700) {
            const restoreW = Math.min(bounds.width, Math.max(460, preSidebarBounds.width));
            let newX = bounds.x;
            if (newX + restoreW > workArea.x + workArea.width) {
                newX = Math.max(workArea.x + 10, workArea.x + workArea.width - restoreW);
            }
            mainWindow.setBounds({
                x: Math.round(newX),
                y: Math.round(bounds.y),
                width: Math.round(restoreW),
                height: Math.round(bounds.height)
            }, true);
            preSidebarBounds = null;
            return { ok: true, mode, width: restoreW };
        } else if (bounds.width > 800) {
            const restoreW = 460;
            mainWindow.setBounds({
                x: Math.round(bounds.x),
                y: Math.round(bounds.y),
                width: Math.round(restoreW),
                height: Math.round(bounds.height)
            }, true);
            return { ok: true, mode, width: restoreW };
        }
        return { ok: true, mode, width: bounds.width };
    }
}

function getAppVersion() {
    try {
        const pkgPath = path.join(__dirname, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg && pkg.version) return { version: String(pkg.version).trim() };
        }
    } catch (e) {
        console.warn('Failed reading package.json version:', e);
    }
    try {
        if (app && app.getVersion) {
            const v = app.getVersion();
            if (v && v !== '0.0.0') return { version: String(v).trim() };
        }
    } catch (e) {}
    return { version: '1.0.0' };
}

function setAppVersion(event, newVer) {
    if (!newVer || typeof newVer !== 'string') {
        return { error: 'Invalid version string' };
    }
    const cleanVer = newVer.trim().replace(/^v/i, '').trim();
    if (!cleanVer) return { error: 'Invalid version string' };

    const pkgPath = path.join(__dirname, 'package.json');
    try {
        let pkg = {};
        if (fs.existsSync(pkgPath)) {
            pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        }
        pkg.version = cleanVer;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n', 'utf8');
    } catch (e) {
        return { error: 'Failed to update package.json: ' + (e.message || e) };
    }

    const manifestPath = path.join(__dirname, 'manifest.xml');
    try {
        if (fs.existsSync(manifestPath)) {
            let xml = fs.readFileSync(manifestPath, 'utf8');
            if (/<Version>.*?<\/Version>/.test(xml)) {
                xml = xml.replace(/<Version>.*?<\/Version>/, `<Version>${cleanVer}</Version>`);
                fs.writeFileSync(manifestPath, xml, 'utf8');
            }
        }
    } catch (e) {
        console.warn('Failed to update manifest.xml:', e);
    }

    return { ok: true, version: cleanVer };
}

// ------------------------------------------------------------------ app & auto-close with DaVinci Resolve
let mainWindow = null;
let resolveWatchTimer = null;

function cleanup() {
    try { if (liveSession) liveRemove(); } catch (e) { /* the sweep removes it next time */ }
    if (resolveWatchTimer) { clearInterval(resolveWatchTimer); resolveWatchTimer = null; }
    try { if (bridge) bridge.kill(); } catch (e) { /* ignore */ }
    try { WorkflowIntegration.CleanUp(); } catch (e) { /* ignore */ }
    resolveObj = null;
    return true;
}

function quitPlugin() {
    if (isQuitting) return;
    isQuitting = true;
    cleanup();
    try {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    } catch (e) { /* ignore */ }
    try { app.quit(); } catch (e) { /* ignore */ }
    setTimeout(() => process.exit(0), 150).unref();
}

function isPidAlive(pid) {
    if (!pid || pid <= 1) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return e && e.code === 'EPERM';
    }
}

function checkResolveAlive() {
    if (isQuitting) return;
    // 1. If launched as a child of Resolve, auto-close immediately if the parent process exited
    if (INITIAL_PPID > 1 && (process.ppid !== INITIAL_PPID || !isPidAlive(INITIAL_PPID))) {
        if (hasSeenResolve) {
            quitPlugin();
            return;
        }
    }
    // 2. Check if the DaVinci Resolve process is running on macOS
    execFile('pgrep', ['-x', 'Resolve'], (err, stdout) => {
        if (isQuitting) return;
        const running = !err && Boolean(String(stdout || '').trim());
        if (running) {
            hasSeenResolve = true;
        } else if (hasSeenResolve) {
            quitPlugin();
        }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 460,
        height: 860,
        minWidth: 380,
        minHeight: 560,
        title: 'El Subtitle Animator',
        backgroundColor: '#131614',
        webPreferences: { preload: path.join(__dirname, 'preload.js') }
    });
    mainWindow.setMenu(null);
    // Dropping a file must never navigate the window away from the panel.
    mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
    mainWindow.on('close', () => quitPlugin());
    mainWindow.on('minimize', () => setAppIdle(true));
    mainWindow.on('hide', () => setAppIdle(true));
    mainWindow.on('restore', () => { parkArmed = false; setAppIdle(false); });
    mainWindow.on('blur', () => { if (parkArmed) setAppIdle(true, 'parked'); });
    mainWindow.on('focus', () => { parkArmed = false; if (appIdle && !mainWindow.isMinimized()) setAppIdle(false); });
    mainWindow.on('show', () => setAppIdle(mainWindow.isMinimized()));
    applyOnTop(loadLib().alwaysOnTop !== false);   // stays above Resolve by default
    mainWindow.loadFile('index.html');
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    try { process.on(sig, () => quitPlugin()); } catch (e) { /* ignore */ }
}
app.on('before-quit', () => { stopJxaHelper(); cleanup(); });

app.whenReady().then(() => {
    ensureDirs();
    ipcMain.handle('win:park', () => parkUntilFocus());
    ipcMain.handle('fonts:list', async () => await listSystemFonts());
    setTimeout(() => { listSystemFonts(); }, 800);
    ipcMain.handle('app:poll', poll);
    ipcMain.handle('color:pick', pickNativeColor);
    setTimeout(() => { prepareColorScript(); }, 1500);
    setTimeout(() => { startJxaHelper(); }, 800);      // compiled and warmed once, so the first click is quick too
    ipcMain.handle('color:cancel', cancelNativeColor);
    ipcMain.handle('app:liveFrame', wrap(liveFrame));
    ipcMain.handle('app:openFolder', () => shell.openPath(DATA_DIR));
    ipcMain.handle('app:openFontsFolder', () => shell.openPath(FONTS_DIR));
    ipcMain.handle('app:getVersion', wrap(getAppVersion));
    ipcMain.handle('app:setVersion', wrap(setAppVersion));
    ipcMain.handle('lib:get', wrap(() => ({ lib: libForUI() })));
    ipcMain.handle('lib:addAnimationFile', wrap(addAnimationFile));
    ipcMain.handle('lib:saveSelected', wrap(saveSelectedAsAnimation));
    ipcMain.handle('lib:create', wrap(createCombo));
    ipcMain.handle('lib:saveVariant', wrap(saveAnimationVariant));
    ipcMain.handle('lib:capture', wrap(captureFromSelection));
    ipcMain.handle('lib:update', wrap(updateAnimation));
    ipcMain.handle('lib:remove', wrap(removeAnimation));
    ipcMain.handle('lib:saveTags', wrap(saveTags));
    ipcMain.handle('lib:reorder', wrap(reorderAnimations));
    ipcMain.handle('lib:setDefaultSfx', wrap(setDefaultSfx));
    ipcMain.handle('lib:setAnimationSfx', wrap(setAnimationSfx));
    ipcMain.handle('lib:replaceFile', wrap(replaceAnimationFile));
    ipcMain.handle('dialog:pick', wrap(pickFile));
    ipcMain.handle('act:scanClip', wrap(scanClip));
    ipcMain.handle('lib:makePreview', wrap(makePreview));
    ipcMain.handle('lib:previewData', wrap(previewData));
    ipcMain.handle('act:apply', apply);
    ipcMain.handle('live:update', liveUpdate);
    ipcMain.handle('live:alive', liveAlive);
    ipcMain.handle('live:remove', () => liveRemove(false));
    ipcMain.handle('live:drop', () => liveRemove(true));
    ipcMain.handle('live:loopOn', (e, already) => loopOn(!!already));
    ipcMain.handle('live:loopRestore', () => loopRestore());
    ipcMain.handle('live:finish', liveFinish);
    ipcMain.handle('act:updateLatest', wrap(updateLatest));
    ipcMain.handle('act:syncLiveTransform', wrap(syncLiveTransform));
    ipcMain.handle('act:seek', wrap(seek));
    ipcMain.handle('sfx:read', wrap(readSfx));
    ipcMain.handle('sfx:saveClip', wrap(saveSfxClip));
    ipcMain.handle('sfx:saveAttachedClip', wrap(saveAttachedClip));
    ipcMain.handle('sfx:listOriginals', wrap(listSfxOriginals));
    ipcMain.handle('sfx:addOriginal', wrap(addSfxOriginal));
    ipcMain.handle('sfx:removeOriginal', wrap(removeSfxOriginal));
    ipcMain.handle('win:setOnTop', wrap(setOnTop));
    ipcMain.handle('win:setLayoutMode', wrap(setLayoutMode));
    ipcMain.handle('win:fitWidth', wrap(fitWidth));
    ipcMain.handle('dbg:log', (e, ...parts) => { dlog('[panel]', ...parts); return true; });
    ipcMain.handle('resolve:cleanup', cleanup);
    createWindow();
    checkResolveAlive();
    resolveWatchTimer = setInterval(checkResolveAlive, 1500);
    setTimeout(() => { bridgeCall('ping', {}, 30000).catch(() => { /* only a warm-up */ }); }, 1200);
    setTimeout(() => { syncAllPresetFonts(); }, 2000);
});

app.on('window-all-closed', () => quitPlugin());
