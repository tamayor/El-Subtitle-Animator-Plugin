// Resolve's ExportFrame writes preview PNGs uncompressed (a 1080x1920 frame is ~6 MB). They are re-encoded here,
// losslessly and under the same file name, so nothing that points at them has to change: same pixels, a fraction of the size.

module.exports = { compressPng, compressPngTree, isUncompressedPng };

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const inflate = promisify(zlib.inflate);
const deflate = promisify(zlib.deflate);

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
    return t;
})();
function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function parse(buf) {
    if (buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) return null;
    const chunks = [];
    let o = 8;
    while (o + 12 <= buf.length) {
        const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8);
        if (o + 12 + len > buf.length) return null;
        chunks.push({ type, data: buf.subarray(o + 8, o + 8 + len) });
        o += 12 + len;
        if (type === 'IEND') break;
    }
    const ihdr = chunks[0] && chunks[0].type === 'IHDR' ? chunks[0].data : null;
    if (!ihdr) return null;
    return {
        chunks, width: ihdr.readUInt32BE(0), height: ihdr.readUInt32BE(4),
        depth: ihdr[8], color: ihdr[9], interlace: ihdr[12]
    };
}

// Cheap test without decoding: an uncompressed PNG is about as big as its raw pixels.
function isUncompressedPng(file) {
    try {
        const fd = fs.openSync(file, 'r');
        const head = Buffer.alloc(33);
        fs.readSync(fd, head, 0, 33, 0);
        fs.closeSync(fd);
        if (!head.subarray(0, 8).equals(SIG) || head.toString('latin1', 12, 16) !== 'IHDR') return false;
        const w = head.readUInt32BE(16), h = head.readUInt32BE(20), depth = head[24], ch = CHANNELS[head[25]];
        if (!ch) return false;
        const raw = h * (1 + Math.ceil(w * ch * depth / 8));
        return fs.statSync(file).size > raw * 0.6;
    } catch (e) { return false; }
}

function paeth(a, b, c) {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

// Undoes whatever filters the file used, then picks the best filter per row (smallest sum of |bytes|).
function refilter(raw, height, stride, bpp) {
    const out = Buffer.alloc(raw.length);
    let prev = Buffer.alloc(stride);
    const cur = Buffer.alloc(stride);
    const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
    for (let y = 0; y < height; y++) {
        const ro = y * (stride + 1), ft = raw[ro];
        for (let x = 0; x < stride; x++) {
            const v = raw[ro + 1 + x], a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
            cur[x] = (ft === 0 ? v : ft === 1 ? v + a : ft === 2 ? v + b : ft === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xff;
        }
        let best = 0, bestSum = Infinity;
        for (let f = 0; f < 5; f++) {
            const cb = cand[f];
            let sum = 0;
            for (let x = 0; x < stride; x++) {
                const v = cur[x], a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
                const r = (f === 0 ? v : f === 1 ? v - a : f === 2 ? v - b : f === 3 ? v - ((a + b) >> 1) : v - paeth(a, b, c)) & 0xff;
                cb[x] = r;
                sum += r < 128 ? r : 256 - r;
            }
            if (sum < bestSum) { bestSum = sum; best = f; }
        }
        out[ro] = best;
        cand[best].copy(out, ro + 1);
        cur.copy(prev);
    }
    return out;
}

function chunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
}

// Re-encodes one PNG in place (written to a temp file, then renamed over the original). Returns bytes saved.
async function compressPng(file) {
    const buf = fs.readFileSync(file);
    const png = parse(buf);
    if (!png || png.interlace || png.depth < 8 || !CHANNELS[png.color]) return 0;
    const bpp = CHANNELS[png.color] * png.depth / 8;
    const stride = png.width * bpp;
    const raw = await inflate(Buffer.concat(png.chunks.filter(c => c.type === 'IDAT').map(c => c.data)));
    if (raw.length !== png.height * (stride + 1)) return 0;
    const idat = await deflate(refilter(raw, png.height, stride, bpp), { level: 9, memLevel: 9 });
    const parts = [SIG];
    let wroteIdat = false;
    for (const c of png.chunks) {
        if (c.type === 'IDAT') { if (!wroteIdat) { parts.push(chunk('IDAT', idat)); wroteIdat = true; } continue; }
        parts.push(chunk(c.type, c.data));
    }
    const next = Buffer.concat(parts);
    if (next.length >= buf.length) return 0;
    const tmp = file + '.tmp' + process.pid;
    fs.writeFileSync(tmp, next);
    fs.renameSync(tmp, file);
    return buf.length - next.length;
}

// Every still-uncompressed PNG under dir (recursively). One file at a time, so the app stays responsive.
let treeRun = Promise.resolve();
function compressPngTree(dir) {
    treeRun = treeRun.then(async () => {
        let saved = 0, count = 0;
        const walk = async d => {
            let names = [];
            try { names = fs.readdirSync(d); } catch (e) { return; }
            for (const n of names) {
                const f = path.join(d, n);
                let st;
                try { st = fs.statSync(f); } catch (e) { continue; }
                if (st.isDirectory()) await walk(f);
                else if (/\.png$/i.test(n) && isUncompressedPng(f)) {
                    try { const s = await compressPng(f); if (s) { saved += s; count++; } } catch (e) { /* leave it as is */ }
                    await new Promise(r => setImmediate(r));
                }
            }
        };
        await walk(dir);
        return { saved, count };
    }).catch(() => ({ saved: 0, count: 0 }));
    return treeRun;
}
