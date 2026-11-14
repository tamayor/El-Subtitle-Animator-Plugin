#!/usr/bin/env node
// Collage b-roll, stage 5 + 6: render a project's shots.json through render.mjs (the warm Remotion worker).
//   node render-collage.mjs <project dir>                    every clip (ProRes 4444 with alpha) + captions + plan.json
//   node render-collage.mjs <project dir> --stills 120,300   stills at those timeline frames into render/stills/
//   node render-collage.mjs <project dir> --only broll|title|captions [--suffix -v2]   (--suffix: new file names, so a
//   clip Resolve already has open is never overwritten; swap it in with ReplaceClip) [--segment 23]   (only the clip
//   that starts on that timeline frame)
// Clips: one per run of b-roll beats (the dark backdrop + cards; talking-head beats end a run) and one per
// talking-head beat with a title overlay (transparent but for the title), plus one caption clip over the whole range.
// render/plan.json lists each clip with its timeline record frame and role, for placing on the timeline
// (b-roll + titles on one video track, captions on the one above). render/captions.srt is written too.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROLL = path.resolve(HERE, '..');

const args = process.argv.slice(2);
const proj = args[0];
if (!proj) { console.error('usage: node render-collage.mjs <project dir> [--stills f1,f2] [--only broll|title|captions]'); process.exit(2); }
const opt = (k) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : null; };
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(proj, f), 'utf8')); } catch { return d; } };

const shots = read('shots.json');
const words = (read('transcript.json', { words: [] }).words || []).map((w) => ({ w: w.w, start: Math.round(w.start), end: Math.round(w.end) }));
const brand = read('brand/brand.json', {});
const W = shots.width || 1080, H = shots.height || 1920, FPS = shots.fps || 29.97;
const assetsDir = path.join(proj, 'assets');

const assetMeta = {};
for (const b of shots.beats) for (const n of b.assets || []) {
    if (assetMeta[n]) continue;
    const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(assetsDir, n)]).toString().trim();
    const [w, h] = out.split(',').map(Number);
    assetMeta[n] = { w, h };
}

// segments
const segs = [];
let run = null;
for (const b of shots.beats) {
    const [a, e] = b.frames;
    if (b.visual === 'talking-head') {
        if (run) { segs.push(run); run = null; }
        if ((b.overlays || []).some((o) => o.type === 'title')) segs.push({ role: 'title', from: a, to: e, beats: [b.id] });
        continue;
    }
    if (run && a <= run.to + 1) { run.to = e; run.beats.push(b.id); } else { if (run) segs.push(run); run = { role: 'broll', from: a, to: e, beats: [b.id] }; }
}
if (run) segs.push(run);
const end = Math.max(...shots.beats.map((b) => b.frames[1]));
const props = (from) => ({ beats: shots.beats, from, assetMeta, assetAnchors: shots.assetAnchors, _assets: { dir: assetsDir }, brand, titleY: shots.titleY });

// the worker
const worker = spawn(process.execPath, [path.join(BROLL, 'render.mjs'), '--serve'], { cwd: BROLL, stdio: ['pipe', 'pipe', 'inherit'] });
const waiting = new Map();
let ready;
const isReady = new Promise((r) => { ready = r; });
let buf = '';
worker.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        const sp = line.indexOf(' '), tag = sp < 0 ? line : line.slice(0, sp), body = sp < 0 ? null : JSON.parse(line.slice(sp + 1));
        if (tag === 'READY') ready();
        else if (tag === 'RESULT' || tag === 'ERROR') { const w = waiting.get(body.id); if (w) { waiting.delete(body.id); (tag === 'RESULT' ? w.ok : w.no)(body); } else if (tag === 'ERROR') { console.error(body.error); process.exit(1); } }
    }
});
let n = 0;
const job = (j) => new Promise((ok, no) => { const id = 'c' + (++n); waiting.set(id, { ok, no }); worker.stdin.write(JSON.stringify({ id, width: W, height: H, fps: FPS, ...j }) + '\n'); });

function srt() {
    const tc = (f) => { const ms = Math.round(f / FPS * 1000); const z = (v, l = 2) => String(v).padStart(l, '0'); return `${z(Math.floor(ms / 3600000))}:${z(Math.floor(ms / 60000) % 60)}:${z(Math.floor(ms / 1000) % 60)},${z(ms % 1000, 3)}`; };
    // same chunking as src/collage/Captions.tsx
    const c = { maxWords: 3, maxChars: 18, ...(brand.caption || {}) };
    const out = []; let cur = [];
    const len = (ws) => ws.map((w) => w.w).join(' ').length;
    for (const w of words) {
        if (cur.length && (cur.length >= c.maxWords || w.start - cur[cur.length - 1].end > 8 || len([...cur, w]) > c.maxChars)) { out.push(cur); cur = []; }
        cur.push(w);
        if (/[.,?!;:]$/.test(w.w)) { out.push(cur); cur = []; }
    }
    if (cur.length) out.push(cur);
    return out.map((ws, i) => {
        const e = Math.min(out[i + 1] ? out[i + 1][0].start : Infinity, ws[ws.length - 1].end + 10);
        return `${i + 1}\n${tc(ws[0].start)} --> ${tc(e)}\n${ws.map((w) => w.w).join(' ')}\n`;
    }).join('\n');
}

async function main() {
    await isReady;
    const rdir = path.join(proj, 'render');
    fs.mkdirSync(rdir, { recursive: true });
    const stills = opt('--stills');
    if (stills) {
        const sdir = path.join(rdir, 'stills');
        fs.mkdirSync(sdir, { recursive: true });
        for (const g of stills.split(',').map(Number)) {
            const seg = segs.find((s) => g >= s.from && g < s.to) || { from: g, to: g + 1 };
            const r = await job({ op: 'still', effect: 'collage-track', props: props(seg.from), frames: seg.to - seg.from, frame: g - seg.from, out: path.join(sdir, `f${g}.png`) });
            const rc = await job({ op: 'still', effect: 'collage-captions', props: { words, from: 0, brand }, frames: end, frame: g, out: path.join(sdir, `c${g}.png`) });
            console.log(JSON.stringify({ frame: g, ms: r.ms, out: r.out, captions: rc.out }));
        }
    } else {
        const only = opt('--only');
        const plan = [];
        for (const s of segs) {
            if (only && only !== s.role) continue;
            if (opt('--segment') && Number(opt('--segment')) !== s.from) continue;
            const out = path.join(rdir, `${s.role}-${String(s.from).padStart(5, '0')}-${String(s.to).padStart(5, '0')}${opt('--suffix') || ''}.mov`);
            const r = await job({ op: 'video', effect: 'collage-track', props: props(s.from), frames: s.to - s.from, out });
            plan.push({ role: s.role, file: out, start: s.from, frames: s.to - s.from, beats: s.beats });
            console.log(JSON.stringify({ role: s.role, from: s.from, to: s.to, ms: r.ms }));
        }
        if (!only || only === 'captions') {
            const out = path.join(rdir, `captions${opt('--suffix') || ''}.mov`);
            const r = await job({ op: 'video', effect: 'collage-captions', props: { words, from: 0, brand }, frames: end, out });
            plan.push({ role: 'captions', file: out, start: 0, frames: end });
            fs.writeFileSync(path.join(rdir, 'captions.srt'), srt());
            console.log(JSON.stringify({ role: 'captions', frames: end, ms: r.ms }));
        }
        const prev = read('render/plan.json', { clips: [] }).clips.filter((c) => (only || opt('--segment')) && !plan.some((x) => x.role === c.role && x.start === c.start));
        fs.writeFileSync(path.join(rdir, 'plan.json'), JSON.stringify({ timeline: shots.timeline, fps: FPS, width: W, height: H, clips: [...prev, ...plan] }, null, 1));
    }
    worker.stdin.write(JSON.stringify({ op: 'quit' }) + '\n');
}

main().catch((e) => { console.error(e && e.error || e); worker.kill(); process.exit(1); });
