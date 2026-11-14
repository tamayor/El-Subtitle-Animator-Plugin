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
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROLL = path.resolve(HERE, '..');
// the segments, captions and picture sizes are worked out the same way as the panel's Collage pane does it
const { segmentsOf, srtOf, assetMetaOf, renderBeats } = createRequire(import.meta.url)(path.resolve(BROLL, '..', 'src', 'main', 'collage-plan.js'));

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

const head = (n) => { try { return fs.readFileSync(path.join(assetsDir, n)).subarray(0, 262144); } catch { return null; } };
const assetMeta = assetMetaOf(shots.beats, head, read('assets/clips.json', {}));

// segments
const segs = segmentsOf(shots.beats);
const end = Math.max(...shots.beats.map((b) => b.frames[1]));
const props = (from) => ({ beats: renderBeats(shots.beats), from, assetMeta, assetAnchors: shots.assetAnchors, _assets: { dir: assetsDir }, brand, titleY: shots.titleY });

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
            fs.writeFileSync(path.join(rdir, 'captions.srt'), srtOf(words, FPS, brand.caption));
            console.log(JSON.stringify({ role: 'captions', frames: end, ms: r.ms }));
        }
        const prev = read('render/plan.json', { clips: [] }).clips.filter((c) => (only || opt('--segment')) && !plan.some((x) => x.role === c.role && x.start === c.start));
        fs.writeFileSync(path.join(rdir, 'plan.json'), JSON.stringify({ timeline: shots.timeline, fps: FPS, width: W, height: H, clips: [...prev, ...plan] }, null, 1));
    }
    worker.stdin.write(JSON.stringify({ op: 'quit' }) + '\n');
}

main().catch((e) => { console.error(e && e.error || e); worker.kill(); process.exit(1); });
