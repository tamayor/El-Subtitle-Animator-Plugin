// Keying worker: turns a preview frame into a transparent image off the panel's thread (stage/images.js SAKey).
//
// Message in:  { id, bitmap: ImageBitmap (the frame on black, or on its single background), white: ImageBitmap | null
//                (the same frame rendered on white: exact alpha), whiteBg: bool (single pass rendered on white) }
// Message out: { id, data: ArrayBuffer (RGBA, w x h), w, h, bounds: { x, y, w, h } (0..1, where the text pixels are) }
// The pixel loops are those of stage/images.js keyedImage / keyMatteRegion, so the result is the same as keying on the
// panel's thread.

self.onmessage = (e) => {
    const m = e.data || {};
    let out;
    try { out = keyFrame(m); }
    catch (err) { out = { id: m.id, error: String(err && err.message || err) }; }
    if (out.data) self.postMessage(out, [out.data]); else self.postMessage(out);
    try { if (m.bitmap && m.bitmap.close) m.bitmap.close(); } catch (err) { /* ignore */ }
    try { if (m.white && m.white.close) m.white.close(); } catch (err) { /* ignore */ }
};

function pixels(bitmap) {
    const w = bitmap.width, h = bitmap.height;
    const oc = new OffscreenCanvas(w, h);
    const g = oc.getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, 0, 0);
    return g.getImageData(0, 0, w, h);
}

function keyFrame(m) {
    const im = m.bitmap;
    const w = im.width, h = im.height;
    const id = pixels(im);
    const d = id.data;
    let minX = w, minY = h, maxX = 0, maxY = 0, found = false, x = 0, y = 0;
    const white = (m.white && m.white.width === w && m.white.height === h) ? m.white : null;
    if (white) {
        // Exact transparency from the black + white render pair: a = 1 - (W-B)/255, C = B/a.
        const wd = pixels(white).data;
        for (let p = 0; p < d.length; p += 4) {
            let a = 255 - ((wd[p] - d[p]) + (wd[p + 1] - d[p + 1]) + (wd[p + 2] - d[p + 2])) / 3;
            a = a < 0 ? 0 : (a > 255 ? 255 : a);
            if (a <= 3) { d[p + 3] = 0; }
            else {
                const k = 255 / a;
                d[p] = Math.min(255, d[p] * k); d[p + 1] = Math.min(255, d[p + 1] * k); d[p + 2] = Math.min(255, d[p + 2] * k);
                d[p + 3] = a;
                if (a > 24) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    found = true;
                }
            }
            if (++x === w) { x = 0; y++; }
        }
    } else {
        const whiteBg = !!m.whiteBg;
        for (let p = 0; p < d.length; p += 4) {
            const cr = d[p], cg = d[p + 1], cb = d[p + 2];
            // distance from the background the frame was rendered on: black (brightest channel) or white (darkest)
            const v = whiteBg
                ? 255 - ((cr < cg) ? (cr < cb ? cr : cb) : (cg < cb ? cg : cb))
                : ((cr > cg) ? (cr > cb ? cr : cb) : (cg > cb ? cg : cb));
            if (v <= 4) {
                d[p + 3] = 0;
            } else {
                if (v < 28) d[p + 3] = (((v - 4) * d[p + 3]) / 24) | 0;
                if (v > 12) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    found = true;
                }
            }
            if (++x === w) { x = 0; y++; }
        }
    }
    const bounds = found
        ? { x: minX / w, y: minY / h, w: Math.max(0.08, (maxX - minX) / w), h: Math.max(0.05, (maxY - minY) / h) }
        : { x: 0.2, y: 0.4, w: 0.6, h: 0.2 };
    return { id: m.id, data: d.buffer, w, h, bounds };
}
