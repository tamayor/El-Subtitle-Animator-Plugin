#!/usr/bin/env node
// Collage b-roll, stage 3: image candidates for each beat of shots.json from Wikimedia Commons (open licences only).
//   node source-images.mjs <project dir> [beat ids...]
// For every beat with `queries` (else its `brief`), each query is searched on Commons (bitmaps only); up to 8 candidates
// per beat are kept after the auto-filter (short side >= 1000 px, a licence that is public domain / CC0 / CC BY /
// CC BY-SA / no known restrictions). Each candidate is downloaded at 1600 px wide into candidates/<beat>/NN.jpg with
// its record (title, page, creator, date, size, licence) in candidates/<beat>/candidates.json, and a contact sheet
// candidates/<beat>/sheet.jpg (numbered left to right, top to bottom) is made with ffmpeg for the pick.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'ElSA-collage/0.1 (b-roll research tool)';
const OK_LICENSE = /^(public domain|pd\b|cc0|cc[- ]by(-sa)?([- ][\d.]+)?|no restrictions)/i;
const MIN_SHORT = 1000, PER_BEAT = 8, THUMB_W = 1600;

const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A query "Category:Name" lists that Commons category's files instead of searching.
async function search(q) {
    const u = new URL(API);
    const gen = /^category:/i.test(q)
        ? { generator: 'categorymembers', gcmtitle: q, gcmtype: 'file', gcmlimit: '30' }
        : { generator: 'search', gsrnamespace: '6', gsrsearch: `${q} filetype:bitmap`, gsrlimit: '15' };
    Object.entries({ action: 'query', format: 'json', ...gen,
        prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(THUMB_W) }).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`Commons ${r.status} for "${q}"`);
    const d = await r.json();
    return Object.values(d.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
}

function record(page, query, rank) {
    const ii = page.imageinfo?.[0] || {}, m = ii.extmetadata || {};
    const v = (k) => strip(m[k]?.value);
    return {
        title: page.title, page: ii.descriptionurl, thumb: ii.thumburl, original: ii.url, width: ii.width, height: ii.height, mime: ii.mime,
        creator: v('Artist') || v('Credit'), date: v('DateTimeOriginal') || v('DateTime'), description: v('ImageDescription').slice(0, 300),
        license: v('LicenseShortName'), licenseUrl: v('LicenseUrl'), attributionRequired: v('AttributionRequired') === 'true',
        query, rank
    };
}

function why(c) {
    if (!/^image\/(jpeg|png|tiff|webp)$/.test(c.mime || '')) return 'not a photo file';
    if (Math.min(c.width || 0, c.height || 0) < MIN_SHORT) return `short side ${Math.min(c.width, c.height)} px`;
    if (!OK_LICENSE.test(c.license || '')) return `licence unclear: ${c.license || 'none'}`;
    if (!c.thumb) return 'no thumbnail';
    return null;
}

async function download(url, file) {
    for (let i = 0; i < 3; i++) {
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        if (r.ok) { fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); return; }
        if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
        throw new Error(`download ${r.status}`);
    }
    throw new Error('download rate-limited');
}

function sheet(dir, n) {
    if (!n) return null;
    const inputs = [], scales = [];
    for (let i = 0; i < n; i++) {
        inputs.push('-i', path.join(dir, `${String(i + 1).padStart(2, '0')}.jpg`));
        scales.push(`[${i}:v]scale=420:420:force_original_aspect_ratio=decrease,pad=440:440:(ow-iw)/2:(oh-ih)/2:color=0x222222,setsar=1[v${i}]`);
    }
    const cols = Math.min(4, n), rows = Math.ceil(n / cols);
    const pads = Array.from({ length: cols * rows - n }, (_, k) => `color=c=0x222222:s=440x440:d=1[e${k}]`);
    const all = [...Array.from({ length: n }, (_, i) => `[v${i}]`), ...pads.map((_, k) => `[e${k}]`)].join('');
    const layout = Array.from({ length: cols * rows }, (_, i) => `${(i % cols) * 440}_${Math.floor(i / cols) * 440}`).join('|');
    const graph = [...scales, ...pads, `${all}xstack=inputs=${cols * rows}:layout=${layout}[out]`].join(';');
    const out = path.join(dir, 'sheet.jpg');
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', '-q:v', '3', out]);
    return out;
}

async function main() {
    const [proj, ...only] = process.argv.slice(2);
    if (!proj) { console.error('usage: node source-images.mjs <project dir> [beat ids...]'); process.exit(2); }
    const shots = JSON.parse(fs.readFileSync(path.join(proj, 'shots.json'), 'utf8'));
    const report = [];
    for (const b of shots.beats) {
        if (only.length && !only.includes(b.id)) continue;
        // pictures for photo / stack / document beats, and for any beat that names its own queries (a medallion's suit)
        if (!['photo', 'stack', 'document'].includes(b.visual) && !(b.queries && b.queries.length)) continue;
        const queries = (b.queries && b.queries.length ? b.queries : b.brief) || [];
        const seen = new Map(), dropped = [];
        for (const q of queries) {
            let pages = [];
            try { pages = await search(q); } catch (e) { dropped.push({ query: q, why: String(e.message) }); }
            pages.forEach((p, rank) => {
                if (seen.has(p.title)) { seen.get(p.title).hits++; return; }
                const c = record(p, q, rank), w = why(c);
                if (w) { dropped.push({ title: c.title, why: w }); return; }
                seen.set(c.title, { ...c, hits: 1 });
            });
            await sleep(400);
        }
        // a file that several queries found ranks first, then the search order
        const keep = [...seen.values()].sort((a, b) => b.hits - a.hits || a.rank - b.rank).slice(0, b.candidates || PER_BEAT);
        const dir = path.join(proj, 'candidates', b.candidatesDir || b.id);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        const got = [];
        for (const c of keep) {
            const file = path.join(dir, `${String(got.length + 1).padStart(2, '0')}.jpg`);
            try { await download(c.thumb, file); got.push({ n: got.length + 1, file: path.basename(file), ...c }); }
            catch (e) { dropped.push({ title: c.title, why: String(e.message) }); }
            await sleep(250);
        }
        fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify({ beat: b.id, brief: b.brief, queries, candidates: got, dropped }, null, 1));
        let s = null;
        try { s = sheet(dir, got.length); } catch (e) { dropped.push({ why: 'contact sheet: ' + e.message }); }
        report.push({ beat: b.id, kept: got.length, dropped: dropped.length, sheet: s });
        console.log(JSON.stringify(report[report.length - 1]));
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
