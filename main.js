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
const LIB_FILE = path.join(DATA_DIR, 'library.json');

function ensureDirs() {
    for (const d of [DATA_DIR, ANIM_DIR, SFX_DIR, PREV_DIR]) fs.mkdirSync(d, { recursive: true });
}

function newAnimation(name, file, defaults) {
    return Object.assign({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: name,
        file: file,          // file name inside animations/
        sfx: null,           // file name inside sfx/, or null to use the default SFX
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

function loadLib() {
    ensureDirs();
    let lib = { defaultSfx: null, alwaysOnTop: true, animations: [], tags: [] };
    try {
        lib = Object.assign(lib, JSON.parse(fs.readFileSync(LIB_FILE, 'utf8')));
    } catch (e) { /* first run */ }
    if (!Array.isArray(lib.tags)) lib.tags = [];
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
function parseTextStyle(filePath, savedDesign, toolName) {
    const def = {
        font: 'Poppins',
        style: 'Bold',
        size: 0.12,
        tracking: 1.0,
        lineSpacing: 1.0,
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
function designForFusion(compPath, wanted, toolName) {
    if (!wanted || typeof wanted !== 'object') return null;
    const base = parseTextStyle(compPath && fs.existsSync(compPath) ? compPath : null, null, toolName);
    const out = {};
    for (const k of ['font', 'style', 'size', 'tracking', 'lineSpacing']) {
        if (wanted[k] === undefined || wanted[k] === null) continue;
        const differs = typeof base[k] === 'number' ? Math.abs(Number(wanted[k]) - base[k]) > 1e-6 : String(wanted[k]) !== String(base[k]);
        if (differs) out[k] = wanted[k];
    }
    // A new font must come with a style that font really has, or Resolve shows "Font Not Found".
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
                if (!same) diff[k] = el[k];
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
function fusionBoxes(compPath, list) {
    if (!Array.isArray(list)) return list;
    return list.map(b => {
        if (!b || !b.design || typeof b.design !== 'object' || b.kind !== 'textplus') return b ? Object.assign({}, b, { design: null }) : b;
        return Object.assign({}, b, { design: designForFusion(compPath, b.design, b.tool) || {} });
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
        animations: lib.animations.map(a => {
            const animPath = path.join(ANIM_DIR, a.file);
            const exists = fs.existsSync(animPath);
            const textDesign = parseTextStyle(exists ? animPath : null, a.textDesign);
            return Object.assign({}, a, {
                missing: !exists,
                nodes: exists ? nodesWithDesign(animPath) : [],
                textDesign,
                textStyle: textDesign,
                previewFiles: a.preview ? frameList(path.join(PREV_DIR, a.id), 'p', a.preview) : [],
                previewWhite: (a.preview && a.preview.matte) ? frameList(path.join(PREV_DIR, a.id), 'w', a.preview) : null,
                sfxPath: a.sfx ? path.join(SFX_DIR, a.sfx) : null
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

async function poll(event, force) {
    if (applying && lastPoll) return lastPoll;
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
async function trackIsFree(tl, kind, t, s, e) {
    if (await tl.GetIsTrackLocked(kind, t)) return false;
    const items = (await tl.GetItemListInTrack(kind, t)) || [];
    for (const it of items) {
        if ((await it.GetStart()) < e && (await it.GetEnd()) > s) return false;
    }
    return true;
}

// Auto (video) = the top: one track above the highest track that has a clip at that moment, never a gap lower
// down. A new track is added when there is none above. Auto (audio) = the lowest free audio track.
async function pickTrack(tl, kind, wanted, s, e, firstAuto, notes) {
    const n = await tl.GetTrackCount(kind);
    const label = (kind === 'audio' ? 'A' : 'V');
    if (wanted > 0 && wanted <= n) {
        if (await trackIsFree(tl, kind, wanted, s, e)) return wanted;
        notes.push(label + wanted + ' is busy there, so the lowest free track was used');
    }
    if (kind === 'video') {
        // Text+ always goes on top: one track above the highest track that has a clip anywhere in this time span.
        // Empty tracks lower down (V2 empty, V3 busy) are skipped on purpose.
        let top = 0;
        for (let t = n; t >= 1; t--) {
            if (!(await trackIsFree(tl, kind, t, s, e))) { top = t; break; }
        }
        const target = Math.max(firstAuto, top + 1);
        if (target <= n) return target;
        for (let t = n + 1; t <= target; t++) await tl.AddTrack('video');
        notes.push('placed on top, added ' + label + target);
        return target;
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

        // Text+ alignment is the anchor; SFX follows Text+ start + sfxOffset.
        const textStart = Math.max(tlStart, Math.round(req.start + (req.textOffset || 0)));
        const textEnd = Math.round(req.end + (req.tail || 0));
        const want = Math.max(5, textEnd - textStart);

        const trackNotes = [];
        const vTrack = await pickTrack(tl, 'video', req.textTrack || 0, textStart, textStart + want, 2, trackNotes);

        // Prepare SFX before touching the timeline playhead so playhead time at tlEnd is minimal.
        let sfxInfo = null;
        let sfxPath = null;
        if (req.sfxPath && fs.existsSync(req.sfxPath)) {
            sfxPath = req.sfxPath;
        } else {
            const sfxName = req.sfx || anim.sfx || lib.defaultSfx;
            if (sfxName) sfxPath = path.join(SFX_DIR, sfxName);
        }
        if (req.useSfx !== false && sfxPath) {
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
        const tlEnd = await tl.GetEndFrame();
        await tl.SetCurrentTimecode(frameToTC(tlEnd, meta));
        const item = await tl.InsertFusionTitleIntoTimeline('Text+');
        if (!item) {
            await tl.SetCurrentTimecode(origTC);
            throw new Error('Resolve would not insert a Text+ title. Open the Edit page and try again.');
        }
        if (!(await fitDuration(item, want))) {
            warnings.push('The clip could not be trimmed to the subtitle length (it is ' + (await item.GetDuration()) + ' frames).');
        }
        const finalLen = await item.GetDuration();
        const moved = await item.SetPosition({ trackIndex: vTrack, startFrame: textStart });
        await tl.SetCurrentTimecode(origTC);
        const landed = await item.GetTrackTypeAndIndex();
        if (!moved || !landed || landed[1] !== vTrack) {
            throw new Error('Could not move the title to track V' + vTrack + '. It was left at the end of V1 (frame ' + tlEnd + '); delete it and try again.');
        }

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
            await new Promise(r => setTimeout(r, 250));
            await bridgeCall('refresh', { item: itemId, comp: compName });
        } catch (e) { /* the clip is placed; this is only a safety refresh */ }

        subCache.at = 0;
        return { ok: true, videoTrack: vTrack, audioTrack: sfxTrack, linked: clipsLinked, start: textStart, frames: finalLen, warnings, trackNotes, liveNodes };
    } catch (e) {
        return { ok: false, error: String(e && e.message || e), warnings };
    } finally {
        applying = false;
    }
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
    if (req.sfxPath) a.sfx = copySfx(req.sfxPath);
    lib.animations.push(a);
    saveLib(lib);
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
    return { lib: libForUI() };
}

function addAnimationFile(event, p) {
    const ext = path.extname(p).toLowerCase();
    if (!['.comp', '.setting'].includes(ext)) return { error: 'Drop a Fusion .comp or .setting file' };
    ensureDirs();
    const file = uniqueName(ANIM_DIR, path.basename(p));
    fs.copyFileSync(p, path.join(ANIM_DIR, file));
    const lib = loadLib();
    lib.animations.push(newAnimation(path.basename(file, path.extname(file)), file));
    saveLib(lib);
    return { lib: libForUI() };
}

function copySfx(p) {
    const ext = path.extname(p).toLowerCase();
    if (!['.wav', '.mp3', '.aif', '.aiff', '.m4a', '.flac', '.ogg'].includes(ext)) throw new Error('Drop an audio file (wav, mp3, aif, m4a, flac)');
    ensureDirs();
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
    let sfxFile = src.sfx;
    if (req.sfxPath) {
        try { sfxFile = copySfx(req.sfxPath); } catch (e) { /* ignore */ }
    } else if (req.sfx !== undefined) {
        sfxFile = req.sfx;
    }
    const newAnim = newAnimation(newName, newFile, {
        sfx: sfxFile,
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
    const allowed = ['name', 'useSfx', 'linked', 'textOffset', 'sfxOffset', 'sfxVolume', 'tail', 'textTrack', 'sfxTrack', 'posX', 'posY', 'scale', 'rotation', 'textDesign', 'boxes'];
    for (const k of allowed) if (k in req && req[k] !== undefined) a[k] = req[k];
    if (req.sfxPath) {
        try { a.sfx = copySfx(req.sfxPath); } catch (e) { /* ignore */ }
    } else if (req.sfx !== undefined) {
        a.sfx = req.sfx;
    }
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
    if (applying) return { ok: false };
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
            liveDesign = (cp && fs.existsSync(cp)) ? designForFusion(cp, req.textDesign) : null;
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
                    boxes: fusionBoxes(cp, req.boxList),
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

        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function updateAnimation(event, id, patch) {
    const lib = loadLib();
    const a = lib.animations.find(x => x.id === id);
    if (!a) return { error: 'Animation not found' };
    const allowed = ['name', 'useSfx', 'linked', 'textOffset', 'sfxOffset', 'sfxVolume', 'tail', 'textTrack', 'sfxTrack', 'posX', 'posY', 'scale', 'rotation', 'textDesign', 'boxes', 'tags'];
    for (const k of allowed) if (k in patch) a[k] = patch[k];
    if ('tags' in patch) {
        const known = new Set(lib.tags.map(t => t.id));
        a.tags = Array.isArray(a.tags) ? Array.from(new Set(a.tags)).filter(id => known.has(id)) : [];
    }
    saveLib(lib);
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
    if (a) { try { fs.unlinkSync(path.join(ANIM_DIR, a.file)); } catch (e) { /* ignore */ } }
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
    a.sfx = p ? copySfx(p) : null;
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
const DEBUG_LOG = path.join(__dirname, '_debug', 'preview-log.txt');
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

let previewRunning = null;
async function makePreviewInner(event, animId, customText, design, designKey, temp, boxList, opts) {
    if (applying) return { error: 'Resolve is busy. Try again in a moment.' };
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
        origTC = await tl.GetCurrentTimecode();
        endBefore = await tl.GetEndFrame();
        await tl.SetCurrentTimecode(frameToTC(endBefore, meta));
        item = await tl.InsertFusionTitleIntoTimeline('Text+');
        // The playhead is only needed for the insert itself: put it straight back, so it is away for a split second
        // instead of for the whole render (the frames are exported from the clip, not from the playhead).
        try { await tl.SetCurrentTimecode(origTC); } catch (e) { /* restored again below */ }
        if (!item) throw new Error('Resolve would not insert a Text+ title. Open the Edit page and try again.');
        await fitDuration(item, Math.round(meta.fps * 3));
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
        clearCancel();
        try { if (item) { const ok = await tl.DeleteClips([item], false); if (!ok) leftover = true; } } catch (e) { leftover = true; }
        // Make sure the render clip is really gone: whatever this render (or an interrupted earlier one) left at the
        // end of the timeline is found again and deleted.
        try { if (tl && item && await removePreviewLeftovers(tl, endBefore, itemId)) leftover = false; } catch (e) { /* ignore */ }
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
        const timer = setTimeout(() => { bridgePending.delete(id); reject(new Error('The Fusion helper did not answer')); }, timeoutMs || 20000);
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

// The panel draws the waveform itself; it only gets bytes of files inside the library's sfx folder.
function readSfx(event, p) {
    const full = path.resolve(String(p));
    if (!full.startsWith(SFX_DIR + path.sep)) throw new Error('Not a library sound');
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
    applyOnTop(loadLib().alwaysOnTop !== false);   // stays above Resolve by default
    mainWindow.loadFile('index.html');
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    try { process.on(sig, () => quitPlugin()); } catch (e) { /* ignore */ }
}
app.on('before-quit', () => cleanup());

app.whenReady().then(() => {
    ensureDirs();
    ipcMain.handle('fonts:list', async () => await listSystemFonts());
    setTimeout(() => { listSystemFonts(); }, 800);
    ipcMain.handle('app:poll', poll);
    ipcMain.handle('app:liveFrame', wrap(liveFrame));
    ipcMain.handle('app:openFolder', () => shell.openPath(DATA_DIR));
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
    ipcMain.handle('act:updateLatest', wrap(updateLatest));
    ipcMain.handle('act:syncLiveTransform', wrap(syncLiveTransform));
    ipcMain.handle('act:seek', wrap(seek));
    ipcMain.handle('sfx:read', wrap(readSfx));
    ipcMain.handle('sfx:saveClip', wrap(saveSfxClip));
    ipcMain.handle('win:setOnTop', wrap(setOnTop));
    ipcMain.handle('win:setLayoutMode', wrap(setLayoutMode));
    ipcMain.handle('win:fitWidth', wrap(fitWidth));
    ipcMain.handle('dbg:log', (e, ...parts) => { dlog('[panel]', ...parts); return true; });
    ipcMain.handle('resolve:cleanup', cleanup);
    createWindow();
    checkResolveAlive();
    resolveWatchTimer = setInterval(checkResolveAlive, 1500);
    setTimeout(() => { bridgeCall('ping', {}, 30000).catch(() => { /* only a warm-up */ }); }, 1200);
});

app.on('window-all-closed', () => quitPlugin());
