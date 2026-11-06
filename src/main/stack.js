// Stacked captions placed from the REAL rendered text, not from an estimate of the font's line height.
//
// The gap between stacked lines depends on the font's metrics, the Text+ size and which glyphs each line has (a line
// without descenders looks further from the next one), so guessing it from the Inspector size is always off.
// measureText() renders the group's lines as one temporary Text+ block at the wanted Line Spacing, grabs the frame
// before and after, and reads each line's glyph rows from the pixels that changed. placeStack() then places one clip
// per subtitle so each line's glyphs land exactly where the block's did, measures the result and corrects any line
// that is off by more than a pixel.
//
// Both take the automation TOOLS object (automation.js) so they place and remove through the same path as `place`.

module.exports = { measureText, placeStack };

const { bridgeCall } = require('./fusion-bridge');
const { dlog } = require('./log');

const END_AT = 0.9;      // same point of a subtitle as get_frame's "end": every word is in
const MAX_DIM = 1280;    // the largest frame the bridge returns; 1 px here is 1.5 px of a 1920-tall timeline

const sleep = ms => new Promise(r => setTimeout(r, ms));

// The composited frame as a BGRA bitmap.
async function grabBitmap(frame) {
    const r = await bridgeCall('live_frame', { frame, maxDim: MAX_DIM }, 20000);
    if (!r || !r.data) throw new Error('Resolve did not return a frame');
    let nativeImage;
    try { ({ nativeImage } = require('electron')); } catch (e) { throw new Error('Frame decoding needs Electron'); }
    const img = nativeImage.createFromBuffer(Buffer.from(r.data, 'base64'));
    const { width, height } = img.getSize();
    if (!width || !height) throw new Error('Could not decode the frame');
    return { W: width, H: height, px: Buffer.from(img.toBitmap()) };
}

// Rows whose pixels changed between two grabs of the same frame (= the text), grouped into one run per line.
// Returns n runs sorted top to bottom as { top, bottom } in image pixels, or throws when fewer are visible.
function changedRows(before, after, n, x0, x1) {
    const { W, H } = after;
    if (before.W !== W || before.H !== H) throw new Error('The two frames differ in size');
    const c0 = Math.max(0, Math.floor(x0 * W)), c1 = Math.min(W, Math.ceil(x1 * W));
    const hits = new Array(H).fill(0);
    for (let y = 0; y < H; y++) {
        let count = 0;
        for (let x = c0; x < c1; x++) {
            const o = (y * W + x) * 4;
            const d = Math.max(Math.abs(after.px[o] - before.px[o]), Math.abs(after.px[o + 1] - before.px[o + 1]), Math.abs(after.px[o + 2] - before.px[o + 2]));
            if (d > 40) count++;
        }
        hits[y] = count;
    }
    const runs = [];
    let cur = null;
    for (let y = 0; y < H; y++) {
        if (hits[y] >= 3 && cur === null) cur = y;
        if (hits[y] < 3 && cur !== null) { runs.push({ top: cur, bottom: y - 1 }); cur = null; }
    }
    if (cur !== null) runs.push({ top: cur, bottom: H - 1 });
    // accents, dots and the odd compression speckle: merge the closest runs until one is left per line
    while (runs.length > n) {
        let k = 0, best = Infinity;
        for (let i = 0; i + 1 < runs.length; i++) { const g = runs[i + 1].top - runs[i].bottom; if (g < best) { best = g; k = i; } }
        runs[k] = { top: runs[k].top, bottom: runs[k + 1].bottom };
        runs.splice(k + 1, 1);
    }
    if (runs.length < n) throw new Error('Only ' + runs.length + ' of ' + n + ' text lines are visible in the frame (is every word in, and is the text inside the frame?)');
    return runs;
}

function linesOf(args) {
    let lines = Array.isArray(args.lines) ? args.lines.map(s => String(s || '').trim()).filter(Boolean) : null;
    if (!lines && args.text) lines = String(args.text).split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines || !lines.length) throw new Error('Give lines (an array) or text with "\\n" line breaks');
    return lines;
}

// Renders the lines as ONE temporary clip (same preset, size and Line Spacing) over the frame at the end of
// `subtitle`, measures each line's glyph rows and removes the clip again. Positions are 0..1 of the frame height.
async function measureText(TOOLS, args) {
    args = args || {};
    const lines = linesOf(args);
    if (!args.subtitle) throw new Error('Give the subtitle whose frame to measure on');
    if (!args.presetId) throw new Error('Give a presetId');
    const { tl, meta } = await TOOLS._timeline();
    const sub = await TOOLS._subtitle(tl, args.subtitle);
    const frame = Math.round(sub.start + (sub.end - sub.start) * END_AT);
    const x = Number.isFinite(Number(args.x)) ? Number(args.x) : 0.5;
    const y = Number.isFinite(Number(args.y)) ? Number(args.y) : 0.5;
    const before = await grabBitmap(frame);
    const placeArgs = {
        subtitle: sub.index, presetId: args.presetId, text: lines.join('\n'), x, y, fit: false, sound: false,
        textSize: Number(args.textSize) || 1, lineSpacing: Number(args.lineSpacing) || 1
    };
    if (args.maxSize) placeArgs.maxSize = args.maxSize;
    const tmp = await TOOLS.place(placeArgs);
    let runs;
    try {
        await sleep(300);
        const after = await grabBitmap(frame);
        runs = changedRows(before, after, lines.length, 0.02, 0.98);
    } finally {
        try { await TOOLS.remove_placed({ itemId: tmp.itemId }); } catch (e) { dlog('[stack] temp clip not removed', e && e.message); }
    }
    const H = before.H;
    const out = runs.map((r, i) => ({
        line: lines[i], top: r.top / H, bottom: (r.bottom + 1) / H, centre: (r.top + r.bottom + 1) / 2 / H, heightPx: r.bottom + 1 - r.top
    }));
    const pitches = out.slice(1).map((l, i) => l.top - out[i].top);
    return {
        lines: out,
        pitch: pitches.length ? pitches.reduce((a, b) => a + b, 0) / pitches.length : null,
        blockTop: out[0].top, blockBottom: out[out.length - 1].bottom,
        imageHeight: H, timelineHeight: meta.height, frame, centreY: y,
        note: 'Rendered as one clip at Line Spacing ' + placeArgs.lineSpacing + ' and textSize ' + placeArgs.textSize + '; top/bottom/centre are fractions of the frame height, pitch = distance between consecutive line tops'
    };
}

// Places a group of consecutive subtitles as a stack: one clip per subtitle, every clip but the last held until the
// group's last subtitle ends, lines spaced exactly like one Text+ block at `lineSpacing`, the group centred on `y`.
async function placeStack(TOOLS, args) {
    args = args || {};
    const subs = Array.isArray(args.subtitles) ? args.subtitles.map(Number).filter(Number.isFinite) : [];
    if (subs.length < 2) throw new Error('Give at least two subtitle numbers');
    if (!args.presetId) throw new Error('Give a presetId');
    const { tl } = await TOOLS._timeline();
    const subRecs = [];
    for (const n of subs) subRecs.push(await TOOLS._subtitle(tl, n));
    const texts = Array.isArray(args.texts) && args.texts.length === subs.length ? args.texts.map(t => String(t)) : subRecs.map(s => s.text.replace(/\s*\n\s*/g, ' ').trim());
    const last = subRecs[subRecs.length - 1];
    const x = Number.isFinite(Number(args.x)) ? Number(args.x) : 0.5;
    const y = Number.isFinite(Number(args.y)) ? Number(args.y) : 0.5;
    const textSize = Number(args.textSize) || 1;
    const lineSpacing = Number(args.lineSpacing) || 1;
    const n = subs.length;

    // 1. the real geometry: the lines as one block
    const ref = await measureText(TOOLS, { subtitle: last.index, presetId: args.presetId, lines: texts, x, y, textSize, lineSpacing, maxSize: args.maxSize });
    const H = ref.imageHeight;
    // the block is centred on y by its line boxes, so the single clips start from the same evenly spaced centres
    const ys = texts.map((t, i) => y + (i - (n - 1) / 2) * ref.pitch);
    const frame = ref.frame;
    const notes = ['block measured: pitch ' + (ref.pitch * H).toFixed(1) + ' px of ' + H + ' (' + ref.pitch.toFixed(4) + ' of the frame)'];

    const placeOne = async (i, yi) => {
        const a = {
            subtitle: subRecs[i].index, presetId: args.presetId, text: texts[i], x, y: yi, fit: false, textSize,
            sound: args.sound !== false
        };
        if (args.maxSize) a.maxSize = args.maxSize;
        if (i < n - 1) a.holdUntil = last.index;
        return TOOLS.place(a);
    };

    // 2. place, measure, correct (at most twice: posY is whole timeline pixels, so the second pass settles it)
    const before = await grabBitmap(frame);
    let recs = [];
    for (let i = 0; i < n; i++) recs.push(await placeOne(i, ys[i]));
    let rows = null, passes = 0;
    for (let pass = 0; pass < 3; pass++) {
        await sleep(300);
        const after = await grabBitmap(frame);
        rows = changedRows(before, after, n, 0.02, 0.98);
        const deltas = rows.map((r, i) => (ref.lines[i].top * H - r.top) / H);
        const worst = Math.max(...deltas.map(d => Math.abs(d) * H));
        passes = pass + 1;
        if (worst <= 1) break;
        notes.push('pass ' + (pass + 1) + ': lines off by up to ' + worst.toFixed(1) + ' px, corrected');
        for (let i = 0; i < n; i++) {
            if (Math.abs(deltas[i]) * H <= 1) continue;
            try { await TOOLS.remove_placed({ itemId: recs[i].itemId }); } catch (e) { /* ignore */ }
            ys[i] += deltas[i];
            recs[i] = await placeOne(i, ys[i]);
        }
    }
    return {
        placed: recs.map((r, i) => ({
            subtitle: r.subtitle, itemId: r.itemId, text: texts[i], y: Math.round(ys[i] * 10000) / 10000, videoTrack: r.videoTrack, audioTrack: r.audioTrack,
            holdUntil: r.holdUntil, textSize: r.textSize, glyphTop: rows[i].top / H, glyphBottom: (rows[i].bottom + 1) / H,
            warnings: r.warnings || []
        })),
        measured: { pitch: ref.pitch, lineSpacing, blockTop: rows[0].top / H, blockBottom: (rows[n - 1].bottom + 1) / H, centreY: y, passes },
        preset: recs[0].preset,
        notes
    };
}
