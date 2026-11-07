// Reading Fusion .setting / .comp files: animation keyframes, Text+ styling, and the Text+ / template
// nodes a preset contains, plus converting a panel text design back into Fusion input values.

module.exports = {
    blockEnd, clearDesignCache, copyPreset, designForFusion, detectNodes, expandAllTools, expandToolsInFile,
    fusionBoxes, nodesWithDesign, parseTextStyle
};

const fs = require('fs');

const { validFontStyle } = require('./fonts');
const { addRetiming } = require('./retime');

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
    // the first Text+ that is a real text box (not a mirror Text+, see isMirrorBlock)
    const mirrors = [];
    for (let i = raw.indexOf('= TextPlus'); i >= 0; i = raw.indexOf('= TextPlus', i + 1)) {
        const b = extractBraceBlock(raw, i);
        if (!isMirrorBlock(b, raw)) return b;
        mirrors.push(b);
        // and the follower that feeds it (its element inputs are the highlight's too)
        const via = /(?:^|[\s,{])StyledText\s*=\s*Input\s*\{\s*SourceOp\s*=\s*"(\w+)"/.exec(b);
        const fm = via && new RegExp('(?:^|[\\s,{])' + via[1] + '\\s*=\\s*(?:StyledTextFollower|Follower)\\s*\\{').exec(raw);
        if (fm) mirrors.push(extractBraceBlock(raw, fm.index + fm[0].indexOf(via[1])));
    }
    // only mirrors (e.g. a MultiText preset with a highlight box): the whole file, without them, so their shape and
    // colour inputs are not read as the preset's text design
    let rest = raw;
    for (const b of mirrors) rest = rest.split(b).join('');
    return rest;
}

// A helper Text+ whose StyledText is an expression of another node's text (e.g. the highlight box of "Highlight
// Select", which copies the MultiText's emphasis). It draws a shape, not text: it is never a text box of its own.
// raw: the whole file, to follow a StyledText that comes through a follower whose Text is such an expression.
function isMirrorBlock(block, raw) {
    const b = String(block || '');
    if (/(?:^|[\s,{])StyledText\s*=\s*Input\s*\{[^{}]*\bExpression\s*=/.test(b)) return true;
    const via = /(?:^|[\s,{])StyledText\s*=\s*Input\s*\{\s*SourceOp\s*=\s*"(\w+)"/.exec(b);
    if (!via || !raw) return false;
    const m = new RegExp('(?:^|[\\s,{])' + via[1] + '\\s*=\\s*(?:StyledTextFollower|Follower)\\s*\\{').exec(raw);
    if (!m) return false;
    const fb = extractBraceBlock(raw, m.index + m[0].indexOf(via[1]));
    return /(?:^|[\s,{])Text\s*=\s*Input\s*\{(?:[^{}]|\{[^{}]*\})*\bExpression\s*=/.test(fb);
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
    const decl = /(?:^|[\s,{])([A-Za-z_][\w]*)\s*=\s*(TextPlus|MacroOperator|GroupOperator|MultiText)\s*\{/g;
    const found = [];
    let m;
    while ((m = decl.exec(raw)) !== null) {
        const start = m.index + m[0].indexOf(m[1]);
        const block = extractBraceBlock(raw, start);
        found.push({ name: m[1], type: m[2], start, end: start + block.length, block });
    }
    const groups = found.filter(f => f.type === 'MacroOperator' || f.type === 'GroupOperator');
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
    for (const f of found.filter(x => x.type === 'TextPlus' && !insideGroup(x) && !isMirrorBlock(x.block, raw))) {
        nodes.push(Object.assign({
            id: f.name, kind: 'textplus', tool: f.name, input: 'StyledText', centerInput: 'Center', canMove: true,
            label: 'Text+ · ' + f.name
        }, textPlusInfo(f)));
    }
    // MultiText: one node per text layer (Text1, Text2, ...). Layer ids look like ["Text2.StyledText"] in the file.
    for (const f of found.filter(x => x.type === 'MultiText' && !insideGroup(x))) {
        const keyRe = (k) => '(?:\\["' + k.replace(/\./g, '\\.') + '"\\]|\\b' + k.replace(/\./g, '\\.') + ')\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*';
        const mStr = (k) => { const mm = new RegExp(keyRe(k) + '"((?:[^"\\\\]|\\\\.)*)"').exec(f.block); return mm ? unescapeFusion(mm[1]) : null; };
        const mNum = (k) => { const mm = new RegExp(keyRe(k) + '(-?[\\d.]+(?:e-?\\d+)?)').exec(f.block); return mm ? parseFloat(mm[1]) : null; };
        const mPt = (k) => { const mm = new RegExp(keyRe(k) + '\\{\\s*(-?[\\d.]+(?:e-?\\d+)?)\\s*,\\s*(-?[\\d.]+(?:e-?\\d+)?)').exec(f.block); return mm ? [parseFloat(mm[1]), parseFloat(mm[2])] : null; };
        const layers = new Set([1]);
        let lm;
        const lre = /\["Text(\d+)\.[A-Za-z0-9]+"\]|\bTextName(\d+)\s*=|\bTextEnabled(\d+)\s*=/g;
        while ((lm = lre.exec(f.block)) !== null) layers.add(parseInt(lm[1] || lm[2] || lm[3], 10));
        for (const n of Array.from(layers).sort((p, q) => p - q)) {
            const c = mPt('Text' + n + '.Center') || [0.5, 0.5];
            const sz = mNum('Text' + n + '.Size');
            const nm = mStr('TextName' + n) || ('Text ' + n);
            nodes.push({
                id: f.name + '/Text' + n, kind: 'multitext', tool: f.name, input: 'Text' + n + '.StyledText',
                centerInput: 'Text' + n + '.Center', canMove: true, layer: n, layerName: nm,
                label: 'MultiText · ' + nm, defaultText: mStr('Text' + n + '.StyledText') || ('Text ' + n),
                cx: c[0], cy: c[1], size: sz !== null && sz > 0 ? sz : 0.08
            });
        }
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
const nodeDesignCache = new Map(); function clearDesignCache() { nodeDesignCache.clear(); }
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

// Index of the "}" that closes the "{" at `open` (strings skipped).
function blockEnd(s, open) {
    let d = 0, inStr = false;
    for (let k = open; k < s.length; k++) {
        const c = s[k];
        if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true; else if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return k; }
    }
    return s.length - 1;
}

// Every tool of the preset opens fully in the Inspector: a tool saved with CtrlWZoom = false shows only as a folded
// header, and one saved with CtrlWShown = false is left out of the Inspector. Each tool in a Tools list (macros and
// groups included) gets CtrlWZoom = true (added when the preset does not say) and CtrlWShown = true.
function expandAllTools(s) {
    const edits = [];      // [position, text to remove (length), text to insert]
    const listRe = /\bTools\s*=\s*(?:ordered\(\)\s*)?\{/g;      // .setting: Tools = ordered() {   .comp: Tools = {
    let L;
    while ((L = listRe.exec(s))) {
        const listOpen = L.index + L[0].length - 1;
        const listClose = blockEnd(s, listOpen);
        // the list's direct children are the tools: Name = Type {
        const toolRe = /([A-Za-z_]\w*)\s*=\s*[A-Za-z_][\w.]*\s*\{/y;
        let d = 0, inStr = false;
        for (let k = listOpen; k < listClose; k++) {
            const c = s[k];
            if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue; }
            if (c === '"') { inStr = true; continue; }
            if (c === '{') { d++; continue; }
            if (c === '}') { d--; continue; }
            if (d !== 1 || !/[A-Za-z_]/.test(c) || /\w/.test(s[k - 1])) continue;
            toolRe.lastIndex = k;
            const t = toolRe.exec(s);
            if (!t) continue;
            const open = k + t[0].length - 1;
            const close = blockEnd(s, open);
            let td = 0, tStr = false, zoom = -1;
            for (let j = open; j < close; j++) {
                const ch = s[j];
                if (tStr) { if (ch === '\\') j++; else if (ch === '"') tStr = false; continue; }
                if (ch === '"') tStr = true; else if (ch === '{') td++; else if (ch === '}') td--;
                else if (td === 1 && !/\w/.test(s[j - 1])) {
                    const z = /^CtrlWZoom\s*=\s*\w+/.exec(s.slice(j, j + 40));
                    if (z) { zoom = j; edits.push([j, z[0].length, 'CtrlWZoom = true']); }
                    const w = /^CtrlWShown\s*=\s*\w+/.exec(s.slice(j, j + 40));
                    if (w) edits.push([j, w[0].length, 'CtrlWShown = true']);
                }
            }
            if (zoom < 0) edits.push([open + 1, 0, ' CtrlWZoom = true,']);
            k = close;      // nested tool lists are found by the outer loop
        }
    }
    edits.sort((x, y) => y[0] - x[0]);
    for (const [pos, del, ins] of edits) s = s.slice(0, pos) + ins + s.slice(pos + del);
    return s;
}

// Every preset the plugin saves is stored with all its tools expanded and shown in the Inspector.
function expandToolsInFile(file) {
    try {
        const s = fs.readFileSync(file, 'utf8');
        // the Animation Frames retiming (src/main/retime.js) goes into every preset saved into the library
        const out = addRetiming(expandAllTools(s));
        if (out !== s) fs.writeFileSync(file, out);
    } catch (e) { /* the file stays as it was */ }
    return file;
}

// Copies a preset file into the library (see expandToolsInFile).
function copyPreset(src, dst) {
    fs.copyFileSync(src, dst);
    return expandToolsInFile(dst);
}
