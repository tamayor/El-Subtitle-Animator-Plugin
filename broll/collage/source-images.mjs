#!/usr/bin/env node
// Collage b-roll, stage 3: image candidates for each beat of shots.json from Wikimedia Commons (open licences only), and
// from Pexels / Pixabay when PEXELS_API_KEY / PIXABAY_API_KEY are set.
//   node source-images.mjs <project dir> [beat ids...]
// For every beat with `queries` (else its `brief`), each query is searched on Commons (bitmaps only); up to 8 candidates
// per beat are kept after the auto-filter (short side >= 1000 px, a licence that is public domain / CC0 / CC BY /
// CC BY-SA / no known restrictions). Each candidate is downloaded at 1600 px wide into candidates/<beat>/NN.jpg with
// its record (title, page, creator, date, size, licence) in candidates/<beat>/candidates.json, and a contact sheet
// candidates/<beat>/sheet.jpg (numbered left to right, top to bottom) is made with ffmpeg for the pick.
// A beat of visual "clip" searches videos instead (filetype:video; at least 720 px on the short side and 3 s long):
// NN.jpg is then the video's poster, and its record has `video` (duration, the transcode to download, size).
//   node source-images.mjs <project dir> --clip <beat> <NN.jpg> <out.mp4> [max seconds]
// downloads that candidate's video and converts it for the collage (H.264, no sound, short side at most 1080 px, a key
// frame every 15 frames so any start point seeks fast, the first `max seconds`, default 90). Prints { w, h, duration }.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'ElSA-collage/0.1 (b-roll research tool)';
const OK_LICENSE = /^(public domain|pd\b|cc0|cc[- ]by(-sa)?([- ][\d.]+)?|no restrictions|pexels license|pixabay content license)/i;
// Stock sites searched too when their free API key is set (the panel's Collage pane > Sources & API keys passes them):
// their own licences allow use without attribution; the credit is still written.
const KEYS = { pexels: process.env.PEXELS_API_KEY || '', pixabay: process.env.PIXABAY_API_KEY || '' };
const MIN_SHORT = 1000, PER_BEAT = 8, THUMB_W = 1600;
const VIDEO_MIME = /^(video\/(webm|ogg|mpeg|mp4)|application\/ogg)$/, MIN_VIDEO_SHORT = 720, MIN_VIDEO_SEC = 3;

const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A query "Category:Name" lists that Commons category's files instead of searching. video: videos (videoinfo, with
// the transcodes Commons made of each).
async function search(q, video) {
    const u = new URL(API);
    const gen = /^category:/i.test(q)
        ? { generator: 'categorymembers', gcmtitle: q, gcmtype: 'file', gcmlimit: '30' }
        : { generator: 'search', gsrnamespace: '6', gsrsearch: `${q} filetype:${video ? 'video' : 'bitmap'}`, gsrlimit: '15' };
    const info = video
        ? { prop: 'videoinfo', viprop: 'url|size|mime|extmetadata|derivatives', viurlwidth: String(THUMB_W) }
        : { prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(THUMB_W) };
    Object.entries({ action: 'query', format: 'json', ...gen, ...info }).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`Commons ${r.status} for "${q}"`);
    const d = await r.json();
    return Object.values(d.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
}

// Pexels (pexels.com/api): photos or videos. -> candidate records like record()'s.
async function searchPexels(q, video) {
    const u = new URL(video ? 'https://api.pexels.com/videos/search' : 'https://api.pexels.com/v1/search');
    u.searchParams.set('query', q); u.searchParams.set('per_page', '12');
    const r = await fetch(u, { headers: { Authorization: KEYS.pexels, 'User-Agent': UA } });
    if (!r.ok) throw new Error(`Pexels ${r.status} for "${q}"${r.status === 401 ? ' (check the API key)' : ''}`);
    const d = await r.json();
    const base = (x, rank) => ({ page: x.url, creator: x.photographer || x.user?.name || '', date: '', description: '', license: 'Pexels License',
        licenseUrl: 'https://www.pexels.com/license/', attributionRequired: false, query: q, rank, source: 'Pexels' });
    if (video) return (d.videos || []).map((x, rank) => {
        const files = (x.video_files || []).filter((f) => f.file_type === 'video/mp4' && f.width && f.height)
            .map((f) => ({ src: f.link, w: f.width, h: f.height, short: Math.min(f.width, f.height) })).sort((a, b) => a.short - b.short);
        const f = files.find((y) => y.short >= MIN_VIDEO_SHORT && y.short <= 1440) || files[files.length - 1];
        return { ...base(x, rank), title: `Pexels video ${x.id}`, thumb: x.image, original: f && f.src, width: x.width, height: x.height, mime: 'video/mp4',
            video: f ? { duration: x.duration, src: f.src, w: f.w, h: f.h } : undefined };
    });
    return (d.photos || []).map((x, rank) => ({ ...base(x, rank), title: x.alt ? `${x.alt} (Pexels ${x.id})` : `Pexels photo ${x.id}`,
        thumb: x.src?.large2x || x.src?.large, original: x.src?.original, width: x.width, height: x.height, mime: 'image/jpeg' }));
}

// Pixabay (pixabay.com/api/docs): photos or videos.
async function searchPixabay(q, video) {
    const u = new URL(video ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/');
    Object.entries({ key: KEYS.pixabay, q: q.slice(0, 100), per_page: '12', safesearch: 'true', ...(video ? {} : { image_type: 'photo' }) })
        .forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`Pixabay ${r.status} for "${q}"${r.status === 400 ? ' (check the API key)' : ''}`);
    const d = await r.json();
    return (d.hits || []).map((x, rank) => {
        const c = { page: x.pageURL, creator: x.user || '', date: '', description: x.tags || '', license: 'Pixabay Content License',
            licenseUrl: 'https://pixabay.com/service/license-summary/', attributionRequired: false, query: q, rank, source: 'Pixabay' };
        if (video) {
            const v = x.videos || {};
            const f = [v.medium, v.large, v.small].find((y) => y && y.url && Math.min(y.width, y.height) >= MIN_VIDEO_SHORT) || v.large || v.medium;
            return { ...c, title: `Pixabay video ${x.id}${x.tags ? ' (' + x.tags + ')' : ''}`, thumb: (v.medium && v.medium.thumbnail) || (v.large && v.large.thumbnail),
                original: f && f.url, width: f && f.width, height: f && f.height, mime: 'video/mp4', video: f ? { duration: x.duration, src: f.url, w: f.width, h: f.height } : undefined };
        }
        return { ...c, title: `Pixabay photo ${x.id}${x.tags ? ' (' + x.tags + ')' : ''}`, thumb: x.largeImageURL, original: x.largeImageURL,
            width: x.imageWidth, height: x.imageHeight, mime: 'image/jpeg' };
    });
}

// The transcode to download: the smallest WebM at least MIN_VIDEO_SHORT on its short side, else the largest one, else
// the original file.
function bestVideo(ii) {
    const ds = (ii.derivatives || []).filter((d) => /^video\/webm/.test(d.type || '') && d.width && d.height)
        .map((d) => ({ src: d.src, w: Number(d.width), h: Number(d.height), short: Math.min(Number(d.width), Number(d.height)) }))
        .sort((a, b) => a.short - b.short);
    const d = ds.find((x) => x.short >= MIN_VIDEO_SHORT) || ds[ds.length - 1];
    return d ? { src: d.src, w: d.w, h: d.h } : { src: ii.url, w: ii.width, h: ii.height };
}

function record(page, query, rank) {
    const ii = page.imageinfo?.[0] || page.videoinfo?.[0] || {}, m = ii.extmetadata || {};
    const v = (k) => strip(m[k]?.value);
    const isVideo = VIDEO_MIME.test(ii.mime || '');
    return {
        title: page.title, page: ii.descriptionurl, thumb: ii.thumburl, original: ii.url, width: ii.width, height: ii.height, mime: ii.mime,
        creator: v('Artist') || v('Credit'), date: v('DateTimeOriginal') || v('DateTime'), description: v('ImageDescription').slice(0, 300),
        license: v('LicenseShortName'), licenseUrl: v('LicenseUrl'), attributionRequired: v('AttributionRequired') === 'true',
        query, rank, source: 'Wikimedia Commons',
        video: isVideo ? { duration: Math.round((Number(ii.duration) || 0) * 100) / 100, ...bestVideo(ii) } : undefined
    };
}

function why(c, video) {
    if (video) {
        if (!c.video) return 'not a video file';
        if (Math.min(c.width || 0, c.height || 0) < MIN_VIDEO_SHORT) return `short side ${Math.min(c.width, c.height)} px`;
        if (!(c.video.duration >= MIN_VIDEO_SEC)) return `only ${c.video.duration || 0} s`;
    } else {
        if (!/^image\/(jpeg|png|tiff|webp)$/.test(c.mime || '')) return 'not a photo file';
        if (Math.min(c.width || 0, c.height || 0) < MIN_SHORT) return `short side ${Math.min(c.width, c.height)} px`;
    }
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

// --clip: download a picked video candidate and convert it for the collage.
async function clip(proj, beatId, file, out, maxSec) {
    const shots = JSON.parse(fs.readFileSync(path.join(proj, 'shots.json'), 'utf8'));
    const b = shots.beats.find((x) => x.id === beatId);
    if (!b) throw new Error(`no beat ${beatId}`);
    const dir = path.join(proj, 'candidates', b.candidatesDir || b.id);
    const c = (JSON.parse(fs.readFileSync(path.join(dir, 'candidates.json'), 'utf8')).candidates || []).find((x) => x.file === file);
    if (!c || !c.video || !c.video.src) throw new Error(`${file} is not a video candidate of ${beatId}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = out + '.part.mp4';
    const convert = (input, extra) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...extra, '-i', input, '-t', String(maxSec || 90), '-an', '-sn',
        '-vf', "scale=w='if(gte(iw,ih),-2,min(iw,1080))':h='if(gte(iw,ih),min(ih,1080),-2)',setsar=1",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', '15', '-movflags', '+faststart', tmp]);
    // ffmpeg reads the transcode straight from the site and stops after maxSec (a long video is never fully downloaded);
    // if the site will not stream it, the whole file is downloaded first
    console.log(JSON.stringify({ phase: 'convert', text: `Getting the first ${maxSec || 90} s of ${c.title.replace(/^File:/, '')}` }));
    try {
        convert(c.video.src, ['-user_agent', UA, '-reconnect', '1', '-reconnect_streamed', '1']);
    } catch (e) {
        const src = path.join(dir, file.replace(/\.\w+$/, '') + '.source' + (path.extname(new URL(c.video.src).pathname) || '.webm'));
        console.log(JSON.stringify({ phase: 'download', text: 'Downloading the whole clip' }));
        if (!fs.existsSync(src)) { await download(c.video.src, src + '.part'); fs.renameSync(src + '.part', src); }
        convert(src, []);
    }
    fs.renameSync(tmp, out);
    const [w, h, d] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'csv=p=0:s=,', out])
        .toString().trim().split(/[\n,]/).map(Number).filter((n) => Number.isFinite(n));
    console.log(JSON.stringify({ done: true, w, h, duration: Math.round(d * 100) / 100 }));
}

async function main() {
    const [proj, ...only] = process.argv.slice(2);
    if (!proj) { console.error('usage: node source-images.mjs <project dir> [beat ids...]'); process.exit(2); }
    if (only[0] === '--clip') return clip(proj, only[1], only[2], only[3], Number(only[4]) || 90);
    const shots = JSON.parse(fs.readFileSync(path.join(proj, 'shots.json'), 'utf8'));
    const report = [];
    for (const b of shots.beats) {
        if (only.length && !only.includes(b.id)) continue;
        // pictures for photo / stack / document beats, and for any beat that names its own queries (a medallion's suit);
        // videos for clip beats
        if (!['photo', 'stack', 'document', 'clip'].includes(b.visual) && !(b.queries && b.queries.length)) continue;
        const video = b.visual === 'clip';
        const queries = (b.queries && b.queries.length ? b.queries : b.brief) || [];
        // the project's context ("Philippines") goes on each search first; the plain search fills in after it
        const ctx = String(shots.context || '').trim();
        const searches = ctx ? queries.flatMap((q) => (/^category:/i.test(q) || q.toLowerCase().includes(ctx.toLowerCase()) ? [[q, true]] : [[q + ' ' + ctx, true], [q, false]]))
            : queries.map((q) => [q, false]);
        const seen = new Map(), dropped = [];
        for (const [q, inCtx] of searches) {
            const recs = [];
            try { (await search(q, video)).forEach((p, rank) => recs.push(record(p, q, rank))); } catch (e) { dropped.push({ query: q, why: String(e.message) }); }
            if (KEYS.pexels && !/^category:/i.test(q)) { try { recs.push(...await searchPexels(q, video)); } catch (e) { dropped.push({ query: q, why: String(e.message) }); } }
            if (KEYS.pixabay && !/^category:/i.test(q)) { try { recs.push(...await searchPixabay(q, video)); } catch (e) { dropped.push({ query: q, why: String(e.message) }); } }
            for (const c of recs) {
                if (seen.has(c.title)) { const s = seen.get(c.title); s.hits++; s.ctx = s.ctx || inCtx; continue; }
                const w = why(c, video);
                if (w) { dropped.push({ title: c.title, why: w }); continue; }
                seen.set(c.title, { ...c, hits: 1, ctx: inCtx });
            }
            await sleep(400);
        }
        // Stock sites answer any search with something generic (a "Supreme Court Philippines" search gives the US one), so:
        // a picture whose title or description names the context first, then the ones a context search found, and for a
        // name (a capitalised search) Commons before stock; then a file several searches found, then the search order.
        const ctxWords = ctx.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        const named = queries.some((q) => /\p{Lu}/u.test(q));
        const score = (c) => (ctxWords.length && ctxWords.every((w) => (c.title + ' ' + (c.description || '')).toLowerCase().includes(w)) ? 4 : 0) +
            (c.ctx ? 2 : 0) + (named && c.source === 'Wikimedia Commons' ? 1 : 0);
        const keep = [...seen.values()].sort((a, b) => score(b) - score(a) || b.hits - a.hits || a.rank - b.rank).slice(0, b.candidates || PER_BEAT);
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
        fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify({ beat: b.id, brief: b.brief, queries, context: ctx, candidates: got, dropped }, null, 1));
        let s = null;
        try { s = sheet(dir, got.length); } catch (e) { dropped.push({ why: 'contact sheet: ' + e.message }); }
        report.push({ beat: b.id, kept: got.length, dropped: dropped.length, sheet: s });
        console.log(JSON.stringify(report[report.length - 1]));
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
