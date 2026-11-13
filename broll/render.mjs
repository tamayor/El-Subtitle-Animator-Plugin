#!/usr/bin/env node
// B-roll render worker (run with the system's Node by src/main/broll.js).
//   node render.mjs --serve        one job per JSON line on stdin, answers on stdout (keeps the bundle and browser warm)
//   node render.mjs job.json       one job, then exits
// Job: { id, op: "video" | "still" | "strip", effect, props, width, height, fps, frames, frame?, scale?, count?, out }
// strip: `count` small frames spread over the clip, rendered in one parallel pass into the folder `out` (f<frame>.png),
// so the panel's Moment slider can scrub without a render per move.
// Answers: "PROGRESS {id, p}", "RESULT {id, out, ms, ...}", "ERROR {id, error}", and "READY" once warm.
// The bundle is cached in .bundle/<hash of src + effects.json>, so it is only rebuilt when an effect changes.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, openBrowser, renderFrames, renderMedia, renderStill, selectComposition } from '@remotion/renderer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, 'src', 'index.ts');
const say = (tag, obj) => process.stdout.write(tag + (obj === undefined ? '' : ' ' + JSON.stringify(obj)) + '\n');

function srcHash() {
    const h = crypto.createHash('sha1');
    const walk = (d) => {
        for (const n of fs.readdirSync(d).sort()) {
            const p = path.join(d, n), st = fs.statSync(p);
            if (st.isDirectory()) walk(p); else h.update(p + ':' + st.size + ':' + st.mtimeMs);
        }
    };
    walk(path.join(HERE, 'src'));
    const ej = path.join(HERE, 'effects.json');
    h.update(fs.readFileSync(ej));
    return h.digest('hex').slice(0, 12);
}

let serveUrl = null, servedHash = null, browser = null;

// Remotion's own Chrome (157) never draws a frame on this Mac: its GPU process hangs at start-up, so every render
// times out waiting for the root component. Chrome for Testing 154 works. Order: $BROLL_CHROME, the copy that
// setup-chrome.mjs downloads into .chrome/, Puppeteer's cached 154 / 152, then Remotion's default.
const CHROME_REL = 'chrome-headless-shell-mac-arm64/chrome-headless-shell';
function chromeExecutable() {
    const home = process.env.HOME || '';
    const tries = [
        process.env.BROLL_CHROME,
        path.join(HERE, '.chrome', CHROME_REL),
        path.join(home, '.cache/puppeteer/chrome-headless-shell/mac_arm-154.0.8037.57', CHROME_REL),
        path.join(home, '.cache/puppeteer/chrome-headless-shell/mac_arm-152.0.7977.42', CHROME_REL)
    ];
    return tries.find((p) => p && fs.existsSync(p)) || null;
}

async function warm() {
    const hash = srcHash();
    if (serveUrl && hash === servedHash) return serveUrl;
    const outDir = path.join(HERE, '.bundle', hash);
    if (fs.existsSync(path.join(outDir, 'index.html'))) {
        serveUrl = outDir;
    } else {
        // drop older bundles
        try { for (const n of fs.readdirSync(path.join(HERE, '.bundle'))) fs.rmSync(path.join(HERE, '.bundle', n), { recursive: true, force: true }); } catch { /* none yet */ }
        serveUrl = await bundle({ entryPoint: ENTRY, outDir, webpackOverride: (c) => c });
    }
    servedHash = hash;
    if (!browser) {
        const exe = chromeExecutable();
        if (!exe) await ensureBrowser();
        browser = await openBrowser('chrome', { browserExecutable: exe, chromiumOptions: { gl: 'angle' } });
    }
    return serveUrl;
}

async function run(job) {
    const t0 = Date.now();
    const url = await warm();
    const inputProps = { ...(job.props || {}), _w: job.width, _h: job.height, _fps: job.fps, _frames: job.frames };
    const composition = await selectComposition({ serveUrl: url, id: job.effect, inputProps, puppeteerInstance: browser });
    fs.mkdirSync(path.dirname(job.out), { recursive: true });
    const scale = Math.max(0.1, Math.min(1, Number(job.scale) || 1));
    if (job.op === 'still') {
        const frame = Math.max(0, Math.min(composition.durationInFrames - 1, Math.round(job.frame ?? composition.durationInFrames * 0.6)));
        await renderStill({ serveUrl: url, composition, inputProps, frame, output: job.out, imageFormat: 'png', puppeteerInstance: browser, overwrite: true, scale });
        return { out: job.out, frame, ms: Date.now() - t0 };
    }
    if (job.op === 'strip') {
        const D = composition.durationInFrames, n = Math.max(2, Math.min(60, Math.round(job.count || 24)));
        const frames = [...new Set(Array.from({ length: n }, (_, i) => Math.round(i * (D - 1) / (n - 1))))];
        fs.mkdirSync(job.out, { recursive: true });
        const tmp = job.out + '.part';
        fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
        try {
            await renderFrames({ serveUrl: url, composition, inputProps, frames, imageFormat: 'png', puppeteerInstance: browser, scale,
                outputDir: null, onStart: () => {}, onFrameUpdate: () => {},
                onFrameBuffer: (buf, frame) => { fs.writeFileSync(path.join(tmp, 'f' + frame + '.png'), buf); } });
            fs.rmSync(job.out, { recursive: true, force: true });
            fs.renameSync(tmp, job.out);
        } catch (err) {
            fs.rmSync(tmp, { recursive: true, force: true });
            throw err;
        }
        return { out: job.out, frames, total: D, ms: Date.now() - t0 };
    }
    const tmp = job.out + '.part.mov';
    try {
        await renderMedia({
            serveUrl: url, composition, inputProps, outputLocation: tmp, overwrite: true, puppeteerInstance: browser,
            codec: 'prores', proResProfile: '4444', pixelFormat: 'yuva444p10le', imageFormat: 'png', muted: true,
            // draft: a smaller file for scrubbing in Resolve (the clip is set to Fit there); finalize re-renders at 1
            scale,
            onProgress: ({ progress }) => say('PROGRESS', { id: job.id, p: Math.round(progress * 100) / 100 })
        });
        fs.renameSync(tmp, job.out);
    } catch (err) {
        fs.rmSync(tmp, { force: true });
        throw err;
    }
    return { out: job.out, frames: composition.durationInFrames, fps: composition.fps, ms: Date.now() - t0 };
}

async function main() {
    const arg = process.argv[2];
    if (arg === '--serve') {
        try { await warm(); say('READY'); } catch (e) { say('ERROR', { id: null, error: String(e && e.stack || e) }); process.exit(1); }
        const rl = readline.createInterface({ input: process.stdin });
        let chain = Promise.resolve();
        rl.on('line', (line) => {
            let job;
            try { job = JSON.parse(line); } catch { return; }
            if (job.op === 'quit') { chain.then(async () => { try { await browser?.close({ silent: true }); } catch { /* gone */ } process.exit(0); }); return; }
            chain = chain.then(async () => {
                try { say('RESULT', { id: job.id, ...(await run(job)) }); } catch (e) { say('ERROR', { id: job.id, error: String(e && e.message || e) }); }
            });
        });
        rl.on('close', async () => { await chain; try { await browser?.close({ silent: true }); } catch { /* gone */ } process.exit(0); });
        return;
    }
    if (!arg) { console.error('usage: node render.mjs --serve | job.json'); process.exit(2); }
    const job = JSON.parse(fs.readFileSync(arg, 'utf8'));
    try { say('RESULT', { id: job.id, ...(await run(job)) }); } catch (e) { say('ERROR', { id: job.id, error: String(e && e.stack || e) }); process.exitCode = 1; }
    try { await browser?.close({ silent: true }); } catch { /* gone */ }
}

main();
