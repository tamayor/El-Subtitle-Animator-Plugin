// Safe-zone layouts from a reference image (e.g. a 1080x1920 social-media overlay PNG).
//
// The image is read as a mask: transparent or light pixels are the usable frame, opaque dark pixels are off-limits.
// Large dark areas become the "outside" (the safe area is what is left); thin dark marks inside the safe area are
// annotations: long rows/columns of marks (solid or dashed) are guides, and big hollow shapes (a "head" box) are
// zones that text must not cover. Everything is stored normalized (0..1, top-left origin) so it maps onto any
// timeline of the same aspect ratio.
//
// fitBox() is what placement uses: it keeps an (estimated) text box inside the safe area, off the zones, and says
// how much the text must shrink to fit. overlayFrame() draws the layout over a get_frame image so results can be checked.

module.exports = { defaultLayout, analyzeLayout, decodePng, fitBox, estimateTextBox, guideRegion, findGuide, overlayFrame, layoutSummary };

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// The built-in layout: the social-media 9:16 safe zone (src/main/layouts/social-9x16.png, analysed into the .json
// next to it). It only applies to vertical timelines of that shape. Regenerate the .json after changing the PNG:
//   node -e "..." with analyzeLayout('src/main/layouts/social-9x16.png', { guideNames: [...], zoneNames: [...] })
const DEFAULT_LAYOUT_FILE = path.join(__dirname, 'layouts', 'social-9x16.json');

function defaultLayout() {
    try {
        const l = JSON.parse(fs.readFileSync(DEFAULT_LAYOUT_FILE, 'utf8'));
        l.source = path.join(__dirname, 'layouts', l.source);
        l.builtin = true;
        return l;
    } catch (e) { return null; }
}

// ------------------------------------------------------------------ PNG decoding (8-bit, non-interlaced)

function decodePng(buf) {
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG file');
    let p = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, palette = null, trns = null;
    const idat = [];
    while (p < buf.length) {
        const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
        if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
        else if (type === 'PLTE') palette = d;
        else if (type === 'tRNS') trns = d;
        else if (type === 'IDAT') idat.push(d);
        else if (type === 'IEND') break;
        p += 12 + len;
    }
    if (depth !== 8 || interlace) throw new Error('Use an 8-bit, non-interlaced PNG (re-export it from Canva/Photoshop as PNG)');
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
    if (!ch) throw new Error('Unsupported PNG colour type ' + ctype);
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * ch, out = Buffer.alloc(w * h * 4);
    let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let i = 0; i < stride; i++) {
            const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
            let v = src[i];
            if (f === 1) v += a;
            else if (f === 2) v += b;
            else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
            cur[i] = v & 255;
        }
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4, s = x * ch;
            if (ctype === 6) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = cur[s + 3]; }
            else if (ctype === 2) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255; }
            else if (ctype === 0) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = 255; }
            else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = cur[s + 1]; }
            else { const k = cur[s]; out[o] = palette[k * 3]; out[o + 1] = palette[k * 3 + 1]; out[o + 2] = palette[k * 3 + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
        }
        [prev, cur] = [cur, prev];
    }
    return { width: w, height: h, data: out };
}

// ------------------------------------------------------------------ analysis

// 1-D min/max filter of radius r over a 0/1 mask, along rows (dx=1) or columns.
function filter1d(src, w, h, r, horizontal, isMin) {
    const out = new Uint8Array(w * h);
    const n = horizontal ? w : h, lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++) {
        const idx = (i) => horizontal ? l * w + i : i * w + l;
        // prefix count of ones along the line
        const pre = new Int32Array(n + 1);
        for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[idx(i)];
        for (let i = 0; i < n; i++) {
            const a = Math.max(0, i - r), b = Math.min(n - 1, i + r), ones = pre[b + 1] - pre[a];
            out[idx(i)] = isMin ? (ones === b - a + 1 ? 1 : 0) : (ones > 0 ? 1 : 0);
        }
    }
    return out;
}

function analyzeLayout(file, opts) {
    opts = opts || {};
    const img = decodePng(fs.readFileSync(file));
    const { width: W, height: H, data } = img;
    const N = W * H;
    // dark = off-limits ink: opaque and darker than mid grey
    const dark = new Uint8Array(N);
    let transparent = 0;
    for (let i = 0; i < N; i++) {
        const a = data[i * 4 + 3];
        if (a < 128) { transparent++; continue; }
        const lum = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
        if (lum < 128) dark[i] = 1;
    }
    // Opening (erode then dilate) removes thin marks (lines, dashes, labels, box outlines); the big dark areas stay = outside.
    const r = Math.max(4, Math.round(Math.min(W, H) * (opts.thin || 0.008)));
    const er = filter1d(filter1d(dark, W, H, r, true, true), W, H, r, false, true);
    const outside = filter1d(filter1d(er, W, H, r, true, false), W, H, r, false, false);
    const ink = new Uint8Array(N);      // annotation marks inside the safe area
    for (let i = 0; i < N; i++) if (dark[i] && !outside[i]) ink[i] = 1;

    // safe spans per row, compressed into bands
    const bands = [];
    let last = null;
    for (let y = 0; y < H; y++) {
        const spans = [];
        let s = -1;
        for (let x = 0; x <= W; x++) {
            const free = x < W && !outside[y * W + x];
            if (free && s < 0) s = x;
            if (!free && s >= 0) { if (x - s >= 4) spans.push([s, x - 1]); s = -1; }
        }
        const key = JSON.stringify(spans);
        if (last && last.key === key) last.y1 = y;
        else { last = { key, y0: y, y1: y, spans }; bands.push(last); }
    }

    // connected components of ink (8-connected) to separate zones (big shapes) from guide marks
    const comp = new Int32Array(N).fill(-1);
    const boxes = [];
    const stack = new Int32Array(N);
    for (let i = 0; i < N; i++) {
        if (!ink[i] || comp[i] >= 0) continue;
        const id = boxes.length;
        const b = { x0: W, y0: H, x1: 0, y1: 0, n: 0 };
        let sp = 0; stack[sp++] = i; comp[i] = id;
        while (sp) {
            const k = stack[--sp], x = k % W, y = (k - x) / W;
            b.n++; if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx, yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                const j = yy * W + xx;
                if (ink[j] && comp[j] < 0) { comp[j] = id; stack[sp++] = j; }
            }
        }
        boxes.push(b);
    }
    // merge pieces that touch (box outlines drawn as separate bars/corners), then keep the big 2-D ones as zones
    const gap = Math.max(3, Math.round(r / 2));
    const groups = boxes.map((b, i) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, ids: [i] }));
    for (let changed = true; changed;) {
        changed = false;
        for (let i = 0; i < groups.length && !changed; i++) for (let j = i + 1; j < groups.length; j++) {
            const a = groups[i], c = groups[j];
            if (a.x0 - gap <= c.x1 && c.x0 - gap <= a.x1 && a.y0 - gap <= c.y1 && c.y0 - gap <= a.y1) {
                const wa = a.x1 - a.x0, ha = a.y1 - a.y0, wc = c.x1 - c.x0, hc = c.y1 - c.y0;
                // only merge when one of them is 2-D-ish, so a dashed line is not glued into one long "zone"
                if (Math.min(wa, ha) < 0.04 * Math.min(W, H) && Math.min(wc, hc) < 0.04 * Math.min(W, H)
                    && !(wa > 0.08 * W && hc > 0.08 * H) && !(ha > 0.08 * H && wc > 0.08 * W)) continue;
                a.x0 = Math.min(a.x0, c.x0); a.y0 = Math.min(a.y0, c.y0); a.x1 = Math.max(a.x1, c.x1); a.y1 = Math.max(a.y1, c.y1);
                a.ids.push(...c.ids); groups.splice(j, 1); changed = true; break;
            }
        }
    }
    const zoneGroups = groups.filter(g => (g.x1 - g.x0) >= 0.06 * W && (g.y1 - g.y0) >= 0.04 * H);

    // guides: rows (columns) where ink stretches across most of the safe width (height). A zone's own edges are
    // shorter than that, and a guide may run through a zone (an "eye" line across a "head" box).
    const guidesH = lineScan(W, H, ink, outside, true);
    const guidesV = lineScan(W, H, ink, outside, false);

    const R4 = (v) => Math.round(v * 10000) / 10000;
    const name = (list, i, def) => (Array.isArray(list) && list[i] ? String(list[i]).trim() : def);
    return {
        source: file,
        width: W, height: H, aspect: R4(W / H), transparentImage: transparent > N * 0.05,
        bands: bands.filter(b => b.spans.length).map(b => ({ y0: R4(b.y0 / H), y1: R4((b.y1 + 1) / H), spans: b.spans.map(s => [R4(s[0] / W), R4((s[1] + 1) / W)]) })),
        guides: guidesH.map((y, i) => ({ name: name(opts.guideNames, i, 'h' + (i + 1)), orient: 'h', pos: R4(y / H) }))
            .concat(guidesV.map((x, i) => ({ name: name(opts.verticalNames, i, 'v' + (i + 1)), orient: 'v', pos: R4(x / W) }))),
        zones: zoneGroups.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
            .map((g, i) => ({ name: name(opts.zoneNames, i, 'zone' + (i + 1)), x0: R4(g.x0 / W), y0: R4(g.y0 / H), x1: R4((g.x1 + 1) / W), y1: R4((g.y1 + 1) / H) }))
    };
}

function lineScan(W, H, ink, outside, horizontal) {
    const n = horizontal ? H : W, m = horizontal ? W : H;
    const hits = [];
    for (let l = 0; l < n; l++) {
        let free = 0, cov = 0, first = -1, lastI = -1, fs0 = -1, fs1 = -1;
        for (let i = 0; i < m; i++) {
            const k = horizontal ? l * W + i : i * W + l;
            if (outside[k]) continue;
            free++;
            if (fs0 < 0) fs0 = i; fs1 = i;
            if (ink[k]) { cov++; if (first < 0) first = i; lastI = i; }
        }
        const ok = free > 0.2 * m && cov >= 0.3 * free && first >= 0 && (lastI - first) >= 0.75 * (fs1 - fs0);
        hits.push(ok);
    }
    const out = [];
    for (let l = 0; l < n; l++) {
        if (!hits[l]) continue;
        let e = l; while (e + 1 < n && hits[e + 1]) e++;
        out.push((l + e + 1) / 2);
        l = e;
    }
    return out;
}

// ------------------------------------------------------------------ using a layout

function findGuide(layout, name, orient) {
    if (!layout || name === undefined || name === null || name === '') return null;
    const k = String(name).trim().toLowerCase();
    const list = layout.guides.filter(g => !orient || g.orient === orient);
    return list.find(g => g.name.toLowerCase() === k) || list.find(g => g.name.toLowerCase().startsWith(k)) || null;
}

// Safe span [x0, x1] containing x in the band at y (or the nearest span).
function spanAt(layout, y, x) {
    const b = layout.bands.find(bb => y >= bb.y0 && y < bb.y1);
    if (!b) return null;
    return b.spans.find(s => x >= s[0] && x <= s[1])
        || b.spans.reduce((m, s) => (Math.abs((s[0] + s[1]) / 2 - x) < Math.abs((m[0] + m[1]) / 2 - x) ? s : m));
}

// Vertical run of safe rows at column x around y: [top, bottom].
function columnRange(layout, x, y) {
    const inside = (bb) => bb.spans.some(s => x >= s[0] && x <= s[1]);
    let i = layout.bands.findIndex(bb => y >= bb.y0 && y < bb.y1);
    if (i < 0) i = y < 0.5 ? 0 : layout.bands.length - 1;
    let a = i, b = i;
    while (a > 0 && inside(layout.bands[a - 1]) && layout.bands[a - 1].y1 >= layout.bands[a].y0 - 1e-4) a--;
    while (b < layout.bands.length - 1 && inside(layout.bands[b + 1]) && layout.bands[b + 1].y0 <= layout.bands[b].y1 + 1e-4) b++;
    return [layout.bands[a].y0, layout.bands[b].y1];
}

// The region between a horizontal guide and the next guide below/above it (or the safe edge), at column x.
function guideRegion(layout, guide, side, x) {
    const hs = layout.guides.filter(g => g.orient === 'h').map(g => g.pos).sort((a, b) => a - b);
    const [top, bottom] = columnRange(layout, x === undefined ? 0.5 : x, guide.pos);
    if (side === 'below') { const nx = hs.find(p => p > guide.pos + 1e-4); return [guide.pos, Math.min(bottom, nx === undefined ? bottom : nx)]; }
    const pv = hs.filter(p => p < guide.pos - 1e-4).pop();
    return [Math.max(top, pv === undefined ? top : pv), guide.pos];
}

// Rough rendered size of text (normalized to the frame) from Fusion sizes: Text+ Size 1 = an em as wide as the frame.
// lines: [{ text, size }] stacked top to bottom. widthFactor calibrates the average glyph width (bold display fonts ~0.6).
function estimateTextBox(lines, frameW, frameH, lineSpacing, widthFactor) {
    const wf = widthFactor || 0.6;
    const glyph = (c) => (c === ' ' ? 0.45 : /[A-Z0-9$%#@&MW]/.test(c) ? 1.15 : /[il.,'!|:;]/.test(c) ? 0.5 : 1);
    let w = 0, h = 0;
    for (const l of lines) {
        const em = l.size * frameW;      // px
        const units = Array.from(String(l.text || '')).reduce((s, c) => s + glyph(c), 0);
        w = Math.max(w, units * wf * em);
        h += em * 1.15 * (lineSpacing || 1);
    }
    return { w: w / frameW, h: h / frameH };
}

// Keeps a box (centre cx, cy; size bw, bh, all normalized) inside the safe area and off the zones.
// Returns the new centre, the scale the box needs to fit the safe width there (<1 = shrink), and notes.
function fitBox(layout, cx, cy, bw, bh, opts) {
    opts = opts || {};
    const pad = opts.pad === undefined ? 0.01 : opts.pad;
    const notes = [];
    let scale = 1;
    for (let pass = 0; pass < 3; pass++) {
        let w = bw * scale, h = bh * scale;
        // vertical: inside the safe rows of this column (and inside opts.region [top, bottom], e.g. between two guides)
        let [top, bottom] = columnRange(layout, cx, cy);
        if (opts.region) { top = Math.max(top, opts.region[0]); bottom = Math.min(bottom, opts.region[1]); }
        if (h > bottom - top - 2 * pad) { scale = Math.min(scale, (bottom - top - 2 * pad) / bh); w = bw * scale; h = bh * scale; }
        cy = Math.max(top + pad + h / 2, Math.min(bottom - pad - h / 2, cy));
        // horizontal: the narrowest safe span over the rows the box covers
        let L = 0, R = 1;
        const y0 = cy - h / 2, y1 = cy + h / 2;
        for (const b of layout.bands) {
            if (b.y1 <= y0 || b.y0 >= y1) continue;
            const s = spanAt(layout, (Math.max(b.y0, y0) + Math.min(b.y1, y1)) / 2, cx);
            if (s) { L = Math.max(L, s[0]); R = Math.min(R, s[1]); }
        }
        if (w > R - L - 2 * pad) { scale = Math.min(scale, (R - L - 2 * pad) / bw); if (pass < 2) continue; }
        cx = Math.max(L + pad + w / 2, Math.min(R - pad - w / 2, cx));
        // zones: move the box off them vertically (to whichever side is nearer and still safe)
        if (opts.avoidZones !== false) {
            for (const z of layout.zones) {
                const hit = cx - w / 2 < z.x1 && cx + w / 2 > z.x0 && cy - h / 2 < z.y1 && cy + h / 2 > z.y0;
                if (!hit) continue;
                const up = z.y0 - pad - h / 2, down = z.y1 + pad + h / 2;
                const [t2, b2] = opts.region || columnRange(layout, cx, cy);
                const canUp = up - h / 2 >= t2 + pad, canDown = down + h / 2 <= b2 - pad;
                if (opts.lockY) notes.push('covers the "' + z.name + '" zone');
                else if (canUp && (!canDown || cy - up <= down - cy)) { cy = up; notes.push('moved above the "' + z.name + '" zone'); }
                else if (canDown) { cy = down; notes.push('moved below the "' + z.name + '" zone'); }
                else notes.push('covers the "' + z.name + '" zone (no room above or below)');
            }
        }
        break;
    }
    return { cx, cy, scale: Math.max(0.2, Math.min(1, scale)), notes };
}

function layoutSummary(layout, frame) {
    if (!layout) return null;
    const hs = layout.guides.filter(g => g.orient === 'h').sort((a, b) => a.pos - b.pos);
    const out = {
        source: layout.source, image: layout.width + 'x' + layout.height,
        guides: layout.guides.map(g => ({ name: g.name, orient: g.orient === 'h' ? 'horizontal' : 'vertical', [g.orient === 'h' ? 'y' : 'x']: g.pos })),
        zones: layout.zones.map(z => ({ name: z.name, x0: z.x0, y0: z.y0, x1: z.x1, y1: z.y1 })),
        safeBands: layout.bands.map(b => ({ y0: b.y0, y1: b.y1, x: b.spans }))
    };
    out.regions = hs.map(g => {
        const [a, b] = guideRegion(layout, g, 'below', 0.5);
        const s = spanAt(layout, (a + b) / 2, 0.5);
        return { below: g.name, y0: a, y1: b, centreY: Math.round((a + b) / 2 * 10000) / 10000, safeX: s };
    });
    if (frame && frame.width && frame.height && Math.abs(frame.width / frame.height - layout.aspect) > 0.02) {
        out.warning = 'The layout is for ' + layout.width + 'x' + layout.height + ' timelines; this one is ' + frame.width + 'x' + frame.height + ', so it is not used here (rules.position safe margins apply instead).';
    }
    return out;
}

// ------------------------------------------------------------------ drawing the layout over a frame (Electron only)

function overlayFrame(jpegBase64, layout) {
    let nativeImage;
    try { ({ nativeImage } = require('electron')); } catch (e) { return null; }
    if (!nativeImage) return null;
    const img = nativeImage.createFromBuffer(Buffer.from(jpegBase64, 'base64'));
    const { width: W, height: H } = img.getSize();
    if (!W || !H) return null;
    const px = Buffer.from(img.toBitmap());      // BGRA
    const blend = (x, y, r, g, b, a) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const o = (y * W + x) * 4;
        px[o] = px[o] * (1 - a) + b * a; px[o + 1] = px[o + 1] * (1 - a) + g * a; px[o + 2] = px[o + 2] * (1 - a) + r * a;
    };
    // outside the safe area: red tint
    for (let y = 0; y < H; y++) {
        const ny = (y + 0.5) / H;
        const b = layout.bands.find(bb => ny >= bb.y0 && ny < bb.y1);
        for (let x = 0; x < W; x++) {
            const nx = (x + 0.5) / W;
            if (!b || !b.spans.some(s => nx >= s[0] && nx < s[1])) blend(x, y, 255, 0, 0, 0.45);
        }
    }
    const t = Math.max(1, Math.round(Math.min(W, H) / 300));
    for (const g of layout.guides) {
        if (g.orient === 'h') { const y = Math.round(g.pos * H); for (let x = 0; x < W; x++) for (let k = -t; k <= t; k++) blend(x, y + k, 0, 220, 255, 0.85); }
        else { const x = Math.round(g.pos * W); for (let y = 0; y < H; y++) for (let k = -t; k <= t; k++) blend(x + k, y, 0, 220, 255, 0.85); }
    }
    for (const z of layout.zones) {
        const x0 = Math.round(z.x0 * W), x1 = Math.round(z.x1 * W), y0 = Math.round(z.y0 * H), y1 = Math.round(z.y1 * H);
        for (let x = x0; x <= x1; x++) for (let k = 0; k <= t; k++) { blend(x, y0 + k, 255, 210, 0, 0.9); blend(x, y1 - k, 255, 210, 0, 0.9); }
        for (let y = y0; y <= y1; y++) for (let k = 0; k <= t; k++) { blend(x0 + k, y, 255, 210, 0, 0.9); blend(x1 - k, y, 255, 210, 0, 0.9); }
    }
    return nativeImage.createFromBitmap(px, { width: W, height: H }).toJPEG(85).toString('base64');
}
