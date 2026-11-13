// B-roll tab (js/library/broll-tab.js) and the MCP tools list_broll / broll_preview / place_broll / adjust_broll /
// remove_broll / suggest_broll: motion-graphic overlays (Remotion, in <code folder>/broll) rendered at the timeline's
// size and frame rate as ProRes 4444 with alpha and placed on a free video track over a subtitle or at the playhead.
//
// - The effects and their fields are in broll/effects.json (one Remotion composition each, broll/src/effects/).
// - Renders run in one long-lived worker, `node broll/render.mjs --serve`, started with the system's Node (Electron's
//   own runtime cannot load Remotion's renderer). The worker keeps the bundle and the headless browser warm, so a
//   render after the first costs only its frames.
// - Files go to "<footage folder>/El Subtitle Animator B-roll/" (beside "El Subtitle Animator SFX") and into a Media
//   Pool bin of the same name. Each placed clip is recorded (effect + props) in <data>/_app/broll-placed.json, so it
//   can be adjusted later: the new render replaces the clip's media (MediaPoolItem.ReplaceClip), and the clip keeps its
//   place, track and any edits to its position; only a new length re-places it.
// - Draft (draft: true): rendered at half size (draftScale) so it is quicker to make and scrub in Resolve's viewer;
//   the clip is set to Fit so it still fills the frame, and marked with an orange clip colour. Finalize
//   (brollFinalize) re-renders it at full size and swaps the media under the clip (ReplaceClip), same place and track.

module.exports = {
    brollEffects, brollPreview, brollPlace, brollPlaceMany, brollAdjust, brollRemove, brollList, brollSuggest,
    brollStatus, brollCancel, brollOpenFolder, brollFinalize, draftScale, brollShutdown, brollSuggestFromTexts, brollFrame, brollStrip, brollTrace, brollSync, brollLandingPlan, brollFromPlayhead
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const state = require('./state');
const { APP_DATA_DIR, APP_ROOT, DATA_DIR } = require('./config');
const { dlog } = require('./log');
const { findItemsByIds, getProject, getSubtitles, tcToFrame, timelineMeta } = require('./resolve');
const { timelineSfxDir } = require('./sfx-import');
const { pickTrack } = require('./placement');
const { bridgeCall } = require('./fusion-bridge');

const RUNS_DIR = 'El Subtitle Animator B-roll';
const PLACED_FILE = path.join(APP_DATA_DIR, 'broll-placed.json');
const PREFS_FILE = path.join(APP_DATA_DIR, 'broll.json');
const PREVIEW_DIR = path.join(APP_DATA_DIR, 'broll-previews');
const IDLE_MS = 10 * 60 * 1000;          // the worker quits after 10 idle minutes
const JOB_TIMEOUT_MS = 6 * 60 * 1000;

// The Remotion project: beside the code. The installed plugin finds the repo through data-location.json (codeDir).
function brollDir() {
    const tries = [];
    try { const loc = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'data-location.json'), 'utf8')); if (loc.codeDir) tries.push(path.join(loc.codeDir, 'broll')); } catch (e) { /* running from the repo */ }
    tries.push(path.join(APP_ROOT, 'broll'));
    if (DATA_DIR) tries.push(path.join(path.dirname(DATA_DIR), 'El Subtitle Animator Plugin', 'broll'));
    return tries.find(d => fs.existsSync(path.join(d, 'render.mjs'))) || tries[0];
}

// Electron runs without the user's shell PATH: look for a Node >= 18 where installers put it.
let nodeFound = null;
function findNode() {
    if (nodeFound && fs.existsSync(nodeFound)) return nodeFound;
    const c = [process.env.BROLL_NODE];
    const nvm = path.join(os.homedir(), '.nvm', 'versions', 'node');
    try {
        const vs = fs.readdirSync(nvm).filter(v => /^v\d+/.test(v))
            .sort((a, b) => b.slice(1).split('.').map(Number).reduce((r, n, i) => r || n - (Number(a.slice(1).split('.')[i]) || 0), 0));
        for (const v of vs) if (Number(v.slice(1).split('.')[0]) >= 18) c.push(path.join(nvm, v, 'bin', 'node'));
    } catch (e) { /* no nvm */ }
    c.push('/opt/homebrew/bin/node', '/usr/local/bin/node', path.join(os.homedir(), '.volta', 'bin', 'node'));
    return (nodeFound = c.find(p => p && fs.existsSync(p)) || null);
}

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }
function writeJson(file, v) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(v, null, 2)); } catch (e) { dlog('BROLL-WRITE-FAIL', file, e.message); } }
function send(msg) {
    try { if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.webContents.send('broll:progress', msg); } catch (e) { /* panel gone */ }
}

function brollTrace(event, msg) {
    try {
        const f = path.join(APP_DATA_DIR, 'broll-trace.log');
        let size = 0; try { size = fs.statSync(f).size; } catch (e) { /* new */ }
        if (size > 200000) fs.writeFileSync(f, '');
        fs.appendFileSync(f, new Date().toISOString() + ' ' + String(msg).slice(0, 300) + '\n');
    } catch (e) { /* ignore */ }
    return true;
}

// ------------------------------------------------------------------ registry

function registry() {
    const reg = readJson(path.join(brollDir(), 'effects.json'), null);
    if (!reg || !Array.isArray(reg.effects)) throw new Error('B-roll effects not found in ' + brollDir() + ' (effects.json)');
    return reg;
}

function effectById(reg, id) {
    const e = reg.effects.find(x => x.id === id || x.name.toLowerCase() === String(id || '').toLowerCase());
    if (!e) throw new Error('No B-roll effect "' + id + '". Effects: ' + reg.effects.map(x => x.id).join(', '));
    return e;
}

// Defaults (common fields, then the effect's fields, then its own defaults), the user's last values, then `props`.
// Values are coerced to each field's type and range, unknown keys are dropped.
function mergedProps(reg, e, props, usePrefs) {
    const fields = [...reg.common, ...e.fields];
    const out = {};
    for (const f of fields) out[f.key] = f.default;
    Object.assign(out, e.defaults || {});
    if (usePrefs) Object.assign(out, (readJson(PREFS_FILE, {}).last || {})[e.id] || {});
    delete out._times;   // word times belong to one placed clip, never to the remembered panel values
    const p = props || {};
    for (const f of fields) {
        if (!(f.key in p) || p[f.key] === undefined || p[f.key] === null) continue;
        let v = p[f.key];
        if (f.type === 'number') { v = Number(v); if (!Number.isFinite(v)) continue; if (f.min !== undefined) v = Math.max(f.min, v); if (f.max !== undefined) v = Math.min(f.max, v); }
        else if (f.type === 'bool') v = v === true || v === 'true' || v === 1;
        else if (f.type === 'list') v = Array.isArray(v) ? v.map(String).filter(Boolean) : String(v).split(/\n|,/).map(s => s.trim()).filter(Boolean);
        else if (f.type === 'color') { v = String(v); if (!/^#[0-9a-f]{6}$/i.test(v)) continue; }
        else v = String(v);
        out[f.key] = v;
    }
    // per-word print frames (receipt printer word by word, set by Sync to words); not a panel field
    if (Array.isArray(p._times)) out._times = p._times.map(Number).filter(Number.isFinite).slice(0, 400);
    return out;
}

function saveLast(effect, props) {
    const prefs = readJson(PREFS_FILE, {});
    prefs.last = prefs.last || {};
    prefs.last[effect] = props;
    writeJson(PREFS_FILE, prefs);
}

// Panel / list_broll: the effects with their fields and the worker's readiness.
function brollEffects() {
    const reg = registry();
    const dir = brollDir();
    const last = readJson(PREFS_FILE, {}).last || {};
    return {
        common: reg.common,
        effects: reg.effects.map(e => {
            let thumb = null;
            try {
                const p = path.join(dir, 'previews', e.id + '.png');
                if (fs.existsSync(p)) thumb = 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
            } catch (err) { /* ignore */ }
            return { id: e.id, name: e.name, description: e.description, seconds: e.seconds, fields: e.fields,
                defaults: mergedProps(reg, e, {}, false), last: last[e.id] || null, thumb };
        }),
        ready: { node: findNode(), project: fs.existsSync(path.join(dir, 'node_modules', 'remotion')), dir },
        status: brollStatus()
    };
}

// ------------------------------------------------------------------ the render worker

let worker = null;    // { proc, ready: Promise, jobs: Map(id -> { resolve, reject, onProgress, timer }), idle }
let current = null;   // what the panel shows: { id, effect, phase, p, text }

function startWorker() {
    if (worker && worker.proc && worker.proc.exitCode === null) return worker;
    const node = findNode();
    if (!node) throw new Error('B-roll needs Node.js 18 or newer. Install it from nodejs.org (or with Homebrew: brew install node).');
    const dir = brollDir();
    if (!fs.existsSync(path.join(dir, 'node_modules', 'remotion'))) throw new Error('The B-roll renderer is not installed. In Terminal: cd "' + dir + '" && npm install');
    const proc = spawn(node, ['render.mjs', '--serve'], { cwd: dir, env: { ...process.env, PATH: path.dirname(node) + ':' + (process.env.PATH || '/usr/bin:/bin') + ':/opt/homebrew/bin:/usr/local/bin' } });
    const w = { proc, jobs: new Map(), idle: null, errTail: '' };
    let readyRes, readyRej;
    w.ready = new Promise((res, rej) => { readyRes = res; readyRej = rej; });
    let buf = '';
    proc.stdout.on('data', d => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            const sp = line.indexOf(' ');
            const tag = sp < 0 ? line : line.slice(0, sp);
            let msg = null;
            if (sp >= 0) { try { msg = JSON.parse(line.slice(sp + 1)); } catch (e) { continue; } }
            if (tag === 'READY') readyRes();
            else if (tag === 'PROGRESS' && msg) { const j = w.jobs.get(msg.id); if (j && j.onProgress) j.onProgress(msg.p); }
            else if ((tag === 'RESULT' || tag === 'ERROR') && msg) {
                if (msg.id === null && tag === 'ERROR') {
                    try { proc.kill(); } catch (e) { /* ignore */ }
                    if (worker === w) worker = null;
                    readyRej(new Error(msg.error));
                    continue;
                }
                const j = w.jobs.get(msg.id);
                if (!j) continue;
                w.jobs.delete(msg.id); clearTimeout(j.timer);
                if (tag === 'RESULT') j.resolve(msg); else j.reject(new Error(String(msg.error || 'render failed').split('\n')[0]));
                armIdle(w);
            }
        }
    });
    proc.stderr.on('data', d => { w.errTail = (w.errTail + d.toString()).slice(-3000); });
    proc.on('error', e => readyRej(e));
    proc.on('close', (code) => {
        const err = new Error('The B-roll renderer stopped (code ' + code + '): ' + (w.errTail.trim().split('\n').pop() || ''));
        readyRej(err);
        for (const j of w.jobs.values()) { clearTimeout(j.timer); j.reject(err); }
        w.jobs.clear();
        if (worker === w) worker = null;
        dlog('BROLL-WORKER-EXIT', code, w.errTail.slice(-400));
    });
    worker = w;
    dlog('BROLL-WORKER-START', node, dir);
    return w;
}

function armIdle(w) {
    clearTimeout(w.idle);
    if (w.jobs.size) return;
    w.idle = setTimeout(() => { try { w.proc.stdin.write(JSON.stringify({ op: 'quit' }) + '\n'); } catch (e) { /* gone */ } }, IDLE_MS);
}

async function renderJob(job, onProgress) {
    const w = startWorker();
    clearTimeout(w.idle);
    await w.ready;
    const id = job.id || crypto.randomBytes(5).toString('hex');
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { w.jobs.delete(id); reject(new Error('The render took over ' + (JOB_TIMEOUT_MS / 60000) + ' minutes')); armIdle(w); }, JOB_TIMEOUT_MS);
        w.jobs.set(id, { resolve, reject, onProgress, timer });
        w.proc.stdin.write(JSON.stringify({ ...job, id }) + '\n');
    });
}

function brollShutdown() {
    if (!worker) return;
    try { worker.proc.stdin.write(JSON.stringify({ op: 'quit' }) + '\n'); } catch (e) { /* gone */ }
    const p = worker.proc;
    setTimeout(() => { try { p.kill(); } catch (e) { /* gone */ } }, 3000);
    worker = null;
}

function brollStatus() { return current ? { ...current } : { phase: 'idle' }; }

let cancelAsked = false;
function brollCancel() {
    if (!worker) return false;
    cancelAsked = true;
    const p = worker.proc;
    worker = null;
    try { p.kill(); } catch (e) { /* gone */ }
    current = { phase: 'error', text: 'Cancelled' };
    send(current);
    return true;
}

// ------------------------------------------------------------------ Resolve side

async function currentTl() {
    const project = await getProject();
    if (!project) throw new Error('Open a project in Resolve');
    const tl = await project.GetCurrentTimeline();
    if (!tl) throw new Error('Open a timeline');
    const meta = await timelineMeta(tl, project);
    return { project, tl, meta, name: await tl.GetName() };
}

async function outDir(project) {
    const footage = await timelineSfxDir(project);
    return path.join(footage || DATA_DIR, RUNS_DIR);
}

async function binFor(mp) {
    const root = await mp.GetRootFolder();
    for (const f of ((await root.GetSubFolderList()) || [])) { if ((await f.GetName()) === RUNS_DIR) return f; }
    try { return await mp.AddSubFolder(root, RUNS_DIR); } catch (e) { return null; }
}

async function importFile(project, file) {
    const mp = await project.GetMediaPool();
    const bin = await binFor(mp);
    const keep = await mp.GetCurrentFolder();
    if (bin) { try { await mp.SetCurrentFolder(bin); } catch (e) { /* imports into the current bin instead */ } }
    let items;
    try { items = await mp.ImportMedia([file]); } finally { if (keep) { try { await mp.SetCurrentFolder(keep); } catch (e) { /* ignore */ } } }
    const mpi = items && items[0];
    if (!mpi) throw new Error('Resolve could not import ' + path.basename(file));
    return { mp, mpi };
}

// Where a clip goes: a subtitle's range, explicit frames, or the playhead + seconds.
// The timeline's Mark In / Mark Out (the I and O keys) as [start, end) timeline frames, or null when not both set.
// Resolve answers { video: { in, out }, audio: { in, out } }; Out is the last marked frame. Some versions count from the
// timeline's start (0 = first frame), others give record frames: a value before the start frame is shifted.
async function markRange(tl) {
    let mk = null;
    try { mk = await tl.GetMarkInOut(); } catch (e) { mk = null; }
    const r = mk && (mk.video && Number.isFinite(Number(mk.video.in)) ? mk.video : mk.audio && Number.isFinite(Number(mk.audio.in)) ? mk.audio : mk);
    if (!r || !Number.isFinite(Number(r.in)) || !Number.isFinite(Number(r.out))) return null;
    let a = Math.round(Number(r.in)), b = Math.round(Number(r.out));
    const tlStart = Number(await tl.GetStartFrame()) || 0;
    if (a < tlStart) { a += tlStart; b += tlStart; }
    if (b < a) return null;
    return { start: a, end: b + 1 };
}

async function rangeFor(tl, meta, o, e) {
    const minF = Math.round(meta.fps * 1.2);
    let maxF = Math.round(meta.fps * 12);
    let start, end, subtitle = null;
    if (o.marks) {
        // Mark In -> Mark Out: exactly the marked range (up to a minute), labelled with the first subtitle in it
        const m = await markRange(tl);
        if (!m) throw new Error('Set a Mark In and a Mark Out on the timeline first (I and O in Resolve)');
        maxF = Math.round(meta.fps * 60);
        try {
            const s = (await getSubtitles(tl, false)).find(x => x.end > m.start && x.start < m.end);
            if (s) subtitle = { index: s.index, text: s.text };
        } catch (err) { /* no subtitles */ }
        const len = m.end - m.start;
        if (len > maxF) throw new Error('The marked range is ' + (len / meta.fps).toFixed(1) + ' s; B-roll clips go up to 60 s');
        return { start: m.start, end: Math.max(m.end, m.start + minF), frames: Math.max(len, minF), subtitle, marks: true };
    }
    if (o.subtitle === 'playhead') {
        const at = tcToFrame(await tl.GetCurrentTimecode(), meta);
        const subs = await getSubtitles(tl, false);
        const s = subs.find(x => at >= x.start && at < x.end) || subs.find(x => x.start >= at);
        if (!s) throw new Error('No subtitle under or after the playhead');
        o = { ...o, subtitle: s.index };
    }
    if (o.subtitle !== undefined && o.subtitle !== null && o.subtitle !== '') {
        const subs = await getSubtitles(tl, false);
        const s = subs.find(x => x.index === Number(o.subtitle));
        if (!s) throw new Error('No subtitle #' + o.subtitle + ' (the timeline has ' + subs.length + ')');
        subtitle = { index: s.index, text: s.text };
        start = s.start; end = s.end;
    } else {
        start = Number.isFinite(Number(o.startFrame)) ? Math.round(Number(o.startFrame)) : tcToFrame(await tl.GetCurrentTimecode(), meta);
        end = start + Math.round((Number(o.seconds) || e.seconds || 3) * meta.fps);
    }
    if (Number.isFinite(Number(o.startFrame))) start = Math.round(Number(o.startFrame));
    if (Number.isFinite(Number(o.endFrame))) end = Math.round(Number(o.endFrame));
    if (Number.isFinite(Number(o.seconds)) && Number(o.seconds) > 0 && !Number.isFinite(Number(o.endFrame))) end = start + Math.round(Number(o.seconds) * meta.fps);
    if (end - start < minF) end = start + minF;            // too short to read: held a little past the subtitle
    if (end - start > maxF) end = start + maxF;
    return { start, end, frames: end - start, subtitle };
}

// Draft size: half, or the nearest smaller step where both sides stay whole even numbers (ProRes, odd timelines).
function draftScale(w, h) {
    for (const s of [0.5, 0.4, 0.25, 0.2]) {
        const a = w * s, b = h * s;
        if (Number.isInteger(a) && Number.isInteger(b) && a % 2 === 0 && b % 2 === 0) return s;
    }
    return 0.5;
}
const DRAFT_COLOR = 'Orange';

// A draft clip fills the frame at Fit (same aspect as the timeline); its colour marks it until it is finalized.
async function markDraft(item, draft) {
    if (!item) return;
    try { await item.SetProperty('Scaling', 2); } catch (e) { /* 2 = Fit; harmless at full size too */ }
    try { if (draft) await item.SetClipColor(DRAFT_COLOR); else await item.ClearClipColor(); } catch (e) { /* only a marker */ }
}

function fileFor(dir, effect, uid, v) { return path.join(dir, effect + '-' + uid + (v > 1 ? '-v' + v : '') + '.mov'); }

// ------------------------------------------------------------------ preview (a still, no Resolve change)

// The composited frame under the playhead (JPEG, base64), for the tab's preview background, and the subtitle there.
async function brollFrame() {
    const { tl, meta } = await currentTl();
    const at = tcToFrame(await tl.GetCurrentTimecode(), meta);
    let sub = null;
    try {
        const subs = await getSubtitles(tl, false);
        const s = subs.find(x => at >= x.start && at < x.end);
        if (s) sub = { index: s.index, text: s.text, start: s.start, end: s.end };
    } catch (e) { /* no subtitles */ }
    let img = null;
    if (!state.applying) {
        try { const r = await bridgeCall('live_frame', { frame: at, maxDim: 960 }, 15000); if (r && r.data) img = 'data:image/jpeg;base64,' + r.data; } catch (e) { /* the preview falls back to a plain background */ }
    }
    return { frame: at, width: meta.width, height: meta.height, fps: meta.fps, subtitle: sub, img };
}

async function brollPreview(event, o) {
    o = o || {};
    const reg = registry();
    const e = effectById(reg, o.effect);
    const props = mergedProps(reg, e, o.props, !!o.usePrefs);
    let w = 1920, h = 1080, fps = 30;
    try { const { meta } = await currentTl(); w = meta.width; h = meta.height; fps = meta.fps; } catch (err) { /* no timeline: 16:9 */ }
    if (o.width && o.height) { w = Number(o.width); h = Number(o.height); }
    const frames = Math.round((Number(o.seconds) || e.seconds || 3) * fps);
    const at = Math.max(0, Math.min(1, Number.isFinite(Number(o.at)) ? Number(o.at) : 0.62));
    // the panel shows the preview small: render at its size (longest side `maxDim`), full size for Claude (no maxDim)
    const scale = o.maxDim ? Math.min(1, Number(o.maxDim) / Math.max(w, h)) : 1;
    const key = crypto.createHash('sha1').update(JSON.stringify([e.id, props, w, h, fps, frames, at, scale])).digest('hex').slice(0, 14);
    const out = path.join(PREVIEW_DIR, e.id + '-' + key + '.png');
    if (!fs.existsSync(out)) {
        current = { phase: 'preview', effect: e.id, text: 'Drawing a preview of ' + e.name + '…' };
        send(current);
        await renderJob({ op: 'still', effect: e.id, props, width: w, height: h, fps, frames, frame: Math.round(frames * at), out, scale });
        // keep the preview folder small
        try {
            const files = fs.readdirSync(PREVIEW_DIR).map(f => ({ f, t: fs.statSync(path.join(PREVIEW_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t);
            for (const x of files.slice(80)) fs.unlinkSync(path.join(PREVIEW_DIR, x.f));
        } catch (err) { /* ignore */ }
        current = { phase: 'idle' };
        send({ phase: 'preview-done', effect: e.id });
    }
    const png = fs.readFileSync(out);
    return { path: out, width: w, height: h, effect: e.id, props, dataUrl: o.dataUrl === false ? undefined : 'data:image/png;base64,' + png.toString('base64') };
}

// The Moment slider's frames: `count` small PNGs spread over the clip, rendered in one pass and cached per settings.
// Returns them as data URLs in clip order with their position (0..1), so the panel scrubs without asking again.
let stripJob = null;     // one strip at a time: a newer request waits for (and usually reuses the worker after) the last
async function brollStrip(event, o) {
    o = o || {};
    const reg = registry();
    const e = effectById(reg, o.effect);
    const props = mergedProps(reg, e, o.props, false);
    let w = 1920, h = 1080, fps = 30;
    try { const { meta } = await currentTl(); w = meta.width; h = meta.height; fps = meta.fps; } catch (err) { /* no timeline: 16:9 */ }
    const frames = Math.round((Number(o.seconds) || e.seconds || 3) * fps);
    const count = Math.max(2, Math.min(60, Math.round(Number(o.count) || 24)));
    const scale = Math.min(1, (Number(o.maxDim) || 560) / Math.max(w, h));
    const key = crypto.createHash('sha1').update(JSON.stringify([e.id, props, w, h, fps, frames, count, scale])).digest('hex').slice(0, 14);
    const dir = path.join(PREVIEW_DIR, 'strip-' + e.id + '-' + key);
    if (!fs.existsSync(dir)) {
        while (stripJob) { try { await stripJob; } catch (err) { /* the next one tries */ } }
        if (!fs.existsSync(dir)) {
            stripJob = renderJob({ op: 'strip', effect: e.id, props, width: w, height: h, fps, frames, count, scale, out: dir });
            try { await stripJob; } finally { stripJob = null; }
            // keep the 12 newest strips
            try {
                const old = fs.readdirSync(PREVIEW_DIR).filter(f => f.startsWith('strip-')).map(f => ({ f, t: fs.statSync(path.join(PREVIEW_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t);
                for (const x of old.slice(12)) fs.rmSync(path.join(PREVIEW_DIR, x.f), { recursive: true, force: true });
            } catch (err) { /* ignore */ }
        }
    }
    const list = fs.readdirSync(dir).filter(f => /^f\d+\.png$/.test(f)).map(f => Number(f.slice(1, -4))).sort((a, b) => a - b);
    return { effect: e.id, width: w, height: h, total: frames,
        frames: list.map(f => ({ at: frames > 1 ? f / (frames - 1) : 0, url: 'data:image/png;base64,' + fs.readFileSync(path.join(dir, 'f' + f + '.png')).toString('base64') })) };
}

// ------------------------------------------------------------------ place

async function brollPlace(event, o) {
    o = o || {};
    const reg = registry();
    const e = effectById(reg, o.effect);
    const props = mergedProps(reg, e, o.props, o.usePrefs !== false);
    const { project, tl, meta, name: tlName } = await currentTl();
    const r = await rangeFor(tl, meta, o, e);
    let landed = null;
    if (o.landOnWord) {
        // land the animation on the spoken key word: the clip may start earlier so the build finishes on the word
        landed = await brollLandingPlan(tl, meta, e.id, props, r.start, r.end, r.subtitle && r.subtitle.index);
        r.start = landed.start; r.end = landed.end; r.frames = landed.end - landed.start;
        props.settle = landed.settle;
        if (landed.times) props._times = landed.times; else delete props._times;
    }
    // Extend by: the clip runs this many seconds past the subtitle / marks (the finished graphic holds, then fades)
    const extendF = Math.round(Math.max(0, Math.min(30, Number(o.extend) || 0)) * meta.fps);
    if (extendF > 0) { r.end = Math.min(r.end + extendF, r.start + Math.round(meta.fps * 60)); r.frames = r.end - r.start; }
    const dir = await outDir(project);
    const uid = crypto.randomBytes(3).toString('hex');
    const out = fileFor(dir, e.id, uid, 1);
    cancelAsked = false;
    const draft = !!o.draft;
    const scale = draft ? draftScale(meta.width, meta.height) : 1;
    const label = (draft ? 'draft ' : '') + e.name + (r.marks ? ' In → Out' : r.subtitle ? ' on #' + r.subtitle.index : '');
    current = { phase: 'render', effect: e.id, p: 0, text: 'Rendering ' + label + '…' };
    send(current);
    const t0 = Date.now();
    try {
        await renderJob({ op: 'video', effect: e.id, props, width: meta.width, height: meta.height, fps: meta.fps, frames: r.frames, out, scale },
            (p) => { current = { ...current, p }; send(current); });
    } catch (err) {
        current = { phase: 'error', effect: e.id, text: cancelAsked ? 'Cancelled' : String(err.message || err) };
        send(current);
        throw err;
    }
    if (cancelAsked) throw new Error('Cancelled');
    saveLast(e.id, props);
    if (o.place === false) {
        current = { phase: 'done', effect: e.id, text: 'Rendered ' + path.basename(out) };
        send(current);
        return { rendered: out, frames: r.frames, ms: Date.now() - t0 };
    }
    current = { phase: 'place', effect: e.id, text: 'Placing ' + label + '…' };
    send(current);
    const tlNow = await project.GetCurrentTimeline();
    if (!tlNow || (await tlNow.GetName()) !== tlName) throw new Error('The timeline changed while rendering; the file is in ' + dir);
    const placed = await placeFile(project, tlNow, out, r.start, r.frames, Number(o.track) || 0, draft);
    const rec = {
        id: uid, effect: e.id, name: e.name, props, timeline: tlName, start: r.start, frames: r.frames, fps: meta.fps,
        width: meta.width, height: meta.height, file: out, version: 1, itemId: placed.itemId, track: placed.track,
        subtitle: r.subtitle, draft: draft || undefined, created: new Date().toISOString()
    };
    const all = readJson(PLACED_FILE, []);
    all.push(rec);
    writeJson(PLACED_FILE, all.slice(-500));
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    current = { phase: 'done', effect: e.id, id: uid, text: label + ' on ' + placed.track + ' (' + sec + ' s)' + (draft ? ' · half size: Finalize before export' : '') + (placed.notes.length ? ' · ' + placed.notes.join('; ') : '') };
    send({ ...current, placed: rec });
    dlog('BROLL-PLACED', e.id, uid, placed.track, r.start, r.frames, sec + 's');
    return { ...rec, notes: placed.notes, seconds: Number(sec), landed: landed || undefined };
}

async function placeFile(project, tl, file, start, frames, wantedTrack, draft) {
    const { mp, mpi } = await importFile(project, file);
    const notes = [];
    const vt = await pickTrack(tl, 'video', wantedTrack || 0, start, start + frames, 2, notes);
    const v = await mp.AppendToTimeline([{ mediaPoolItem: mpi, mediaType: 1, trackIndex: vt, recordFrame: start, startFrame: 0, endFrame: frames }]);
    if (!v || !v[0]) throw new Error('Resolve did not place the clip on V' + vt);
    let itemId = null;
    try { itemId = String(await v[0].GetUniqueId()); } catch (e) { /* adjust falls back to the file name */ }
    await markDraft(v[0], draft);
    return { itemId, track: 'V' + vt, notes };
}

// Several in a row (the tab's "Place ticked", suggest_broll's result). One at a time, so Resolve stays responsive.
async function brollPlaceMany(event, list) {
    const out = [];
    for (const o of (Array.isArray(list) ? list : [])) {
        if (cancelAsked) break;
        try { out.push({ ok: true, ...(await brollPlace(event, o)) }); } catch (e) { out.push({ ok: false, effect: o.effect, subtitle: o.subtitle, error: String(e.message || e) }); }
    }
    cancelAsked = false;
    return out;
}

// ------------------------------------------------------------------ adjust / remove / list

function findRec(all, id) {
    const i = all.findIndex(r => r.id === id || r.itemId === id);
    if (i < 0) throw new Error('No placed B-roll "' + id + '" (see list_broll / the B-roll tab\'s Placed list)');
    return i;
}

async function brollAdjust(event, o) {
    o = o || {};
    const reg = registry();
    const all = readJson(PLACED_FILE, []);
    const i = findRec(all, String(o.id || ''));
    const rec = all[i];
    const e = effectById(reg, o.effect || rec.effect);
    const props = mergedProps(reg, e, { ...(e.id === rec.effect ? rec.props : {}), ...(o.props || {}) }, false);
    const { project, tl, meta, name: tlName } = await currentTl();
    if (tlName !== rec.timeline) throw new Error('That clip is on the timeline "' + rec.timeline + '". Open it first.');
    const items = rec.itemId ? await findItemsByIds(tl, [rec.itemId], 'video') : new Map();
    const item = items.get(rec.itemId);
    if (!item) throw new Error('The clip is no longer on the timeline (deleted or the id changed). Place it again.');
    const [curStart, curDur] = await Promise.all([item.GetStart(), item.GetDuration()]);
    let frames = Number(curDur) || rec.frames;
    if (Number(o.extend) > 0) frames += Math.round(Math.min(30, Number(o.extend)) * meta.fps);
    const newStart = Number.isFinite(Number(o.startFrame)) ? Math.round(Number(o.startFrame)) : Number(curStart);
    if (Number.isFinite(Number(o.seconds)) && Number(o.seconds) > 0) frames = Math.round(Number(o.seconds) * meta.fps);
    if (Number.isFinite(Number(o.frames)) && Number(o.frames) > 0) frames = Math.round(Number(o.frames));
    const v = (rec.version || 1) + 1;
    const out = fileFor(path.dirname(rec.file), e.id, rec.id, v);
    cancelAsked = false;
    // draft: true / false switches; left out, the clip stays as it is (Sync and edits keep a draft a draft)
    const draft = o.draft === undefined ? !!rec.draft : !!o.draft;
    const scale = draft ? draftScale(meta.width, meta.height) : 1;
    const verb = rec.draft && !draft ? 'Finalizing ' : 'Re-rendering ' + (draft ? 'draft ' : '');
    current = { phase: 'render', effect: e.id, id: rec.id, p: 0, text: verb + e.name + '…' };
    send(current);
    const t0 = Date.now();
    try {
        await renderJob({ op: 'video', effect: e.id, props, width: meta.width, height: meta.height, fps: meta.fps, frames, out, scale },
            (p) => { current = { ...current, p }; send(current); });
    } catch (err) {
        current = { phase: 'error', effect: e.id, text: cancelAsked ? 'Cancelled' : String(err.message || err) };
        send(current);
        throw err;
    }
    if (cancelAsked) throw new Error('Cancelled');
    let how;
    const oldFile = rec.file, wasDraft = !!rec.draft;
    let oldMpi = null;
    if (frames === Number(curDur) && e.id === rec.effect && newStart === Number(curStart)) {
        // same length: swap the media under the clip; it keeps its place, track and transform
        const mpi = await item.GetMediaPoolItem();
        const ok = mpi && await mpi.ReplaceClip(out);
        if (!ok) throw new Error('Resolve could not swap the media (ReplaceClip). The new render is ' + out);
        await markDraft(item, draft);
        how = 'replaced';
    } else {
        // new length or effect: a new clip in the old one's place
        try { oldMpi = await item.GetMediaPoolItem(); } catch (err) { /* only for the draft clean-up below */ }
        const trackInfo = await item.GetTrackTypeAndIndex();
        const track = Array.isArray(trackInfo) ? Number(trackInfo[1]) : 0;
        await tl.DeleteClips([item], false);
        const placed = await placeFile(project, tl, out, newStart, frames, track, draft);
        rec.itemId = placed.itemId; rec.track = placed.track;
        how = 'replaced with a new clip (' + (newStart !== Number(curStart) ? 'moved' : frames !== Number(curDur) ? 'new length' : 'new effect') + ')';
    }
    Object.assign(rec, { effect: e.id, name: e.name, props, file: out, version: v, frames, start: newStart, draft: draft || undefined, updated: new Date().toISOString() });
    all[i] = rec;
    writeJson(PLACED_FILE, all);
    saveLast(e.id, props);
    // A replaced draft is throwaway (live updates make one per change): drop its file, and its Media Pool item when
    // the clip went in as a new one. Full-size files are kept (undo / other timelines).
    if (wasDraft && oldFile && oldFile !== out) {
        try { if (oldMpi) await project.GetMediaPool().DeleteClips([oldMpi]); } catch (err) { /* stays in the bin */ }
        try { fs.rmSync(oldFile, { force: true }); } catch (err) { /* keep it */ }
    }
    // live: Resolve's viewer keeps the old picture until the playhead moves; set it where it is to redraw
    if (o.live) { try { const tc = await tl.GetCurrentTimecode(); if (tc) await tl.SetCurrentTimecode(tc); } catch (err) { /* only a redraw */ } }
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    const what = rec.draft ? ' (draft)' : o.draft === false ? ' finalized at full size' : ' updated';
    current = { phase: 'done', effect: e.id, id: rec.id, text: e.name + what + ' (' + how + ', ' + sec + ' s)' };
    send({ ...current, placed: rec });
    return { ...rec, how, seconds: Number(sec) };
}

// Finalize: re-render drafts at full size and swap them in place. One id, or all: true for this timeline's drafts.
async function brollFinalize(event, o) {
    o = o || {};
    const { tl, name } = await currentTl();
    const all = readJson(PLACED_FILE, []);
    let ids;
    if (o.all) {
        const mine = all.filter(r => r.timeline === name && r.draft && r.itemId);
        const on = mine.length ? new Set((await findItemsByIds(tl, mine.map(r => r.itemId), 'video')).keys()) : new Set();
        ids = mine.filter(r => on.has(r.itemId)).map(r => r.id);
    } else ids = [all[findRec(all, String(o.id || ''))].id];
    cancelAsked = false;
    const results = [];
    for (const id of ids) {
        if (cancelAsked) break;
        try { const r = await brollAdjust(event, { id, draft: false }); results.push({ id, ok: true, how: r.how, seconds: r.seconds }); }
        catch (e) { results.push({ id, ok: false, error: String(e.message || e) }); }
    }
    cancelAsked = false;
    return { finalized: results.filter(r => r.ok).length, results, note: ids.length ? undefined : 'No drafts on this timeline.' };
}

async function brollRemove(event, o) {
    const id = String((o && o.id) || o || '');
    const all = readJson(PLACED_FILE, []);
    const i = findRec(all, id);
    const rec = all[i];
    let removed = false;
    try {
        const { tl, name } = await currentTl();
        if (name === rec.timeline && rec.itemId) {
            const it = (await findItemsByIds(tl, [rec.itemId], 'video')).get(rec.itemId);
            if (it) removed = !!(await tl.DeleteClips([it], false));
        }
    } catch (e) { /* not on this timeline */ }
    all.splice(i, 1);
    writeJson(PLACED_FILE, all);
    return { removed, id: rec.id, note: removed ? undefined : 'Forgotten; the clip was not on the open timeline.' };
}

// The placed clips of the open timeline (all timelines with all: true); onTimeline says which are still there.
async function brollList(event, o) {
    const all = readJson(PLACED_FILE, []);
    let name = null, ids = new Set();
    try {
        const t = await currentTl();
        name = t.name;
        const mine = all.filter(r => r.timeline === name && r.itemId).map(r => r.itemId);
        if (mine.length) ids = new Set((await findItemsByIds(t.tl, mine, 'video')).keys());
    } catch (e) { /* no timeline */ }
    const list = all.filter(r => (o && o.all) || r.timeline === name).map(r => ({ ...r, onTimeline: r.timeline === name ? ids.has(r.itemId) : undefined }));
    const drafts = list.filter(r => r.draft && r.onTimeline).length;
    return { timeline: name, placed: list.reverse(), drafts, note: drafts ? drafts + ' draft (half-size) B-roll on this timeline: finalize_broll { all: true } before export.' : undefined };
}

function brollOpenFolder(event, o) {
    const { shell } = require('electron');
    const all = readJson(PLACED_FILE, []);
    const rec = o && o.id ? all.find(r => r.id === o.id) : all[all.length - 1];
    const dir = rec ? path.dirname(rec.file) : null;
    if (dir && fs.existsSync(dir)) return shell.openPath(dir);
    return false;
}

// ------------------------------------------------------------------ land on the spoken word ("Sync to words")
// Each effect has a moment where its build has landed (the comment posted, the number counted, the word drawn; the
// Remotion side warps its clock so that moment is props.settle). These put that moment on the spoken key word.

const normWord = (w) => String(w || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const firstWordOf = (t) => String(t || '').trim().split(/\s+/)[0] || '';
const lastWordOf = (t) => String(t || '').trim().split(/\s+/).pop() || '';
// The word each effect shows off; null = the subtitle's last word.
const KEY_WORD = {
    'comment-drop': p => p.keyword,
    'money-counter': p => String(Math.round(Math.abs(Number(p.value) || 0))),
    'post-wall': p => String(Math.round(Number(p.count) || 0)),
    'day-dial': p => p.word,
    'predict-keys': p => lastWordOf(p.text),
    'sketch-words': p => p.word,
    'voice-note': p => firstWordOf(p.caption),
    'tag-stack': p => firstWordOf((p.tags || []).slice(-1)[0]),
    'chapter-list': p => firstWordOf((p.items || [])[Math.max(0, (Number(p.active) || 1) - 1)]),
    'live-cursor': () => null,
    'receipt-printer': () => null,
    'versus-split': p => firstWordOf(p.right),
    'stat-bar': p => String(Math.round(Number(p.percent) || 0)),
    'marker-highlight': p => p.focusWord,
    'quote-card': p => firstWordOf(p.body),
    'stamp-verdict': p => p.verdict,
    'year-timeline': p => String(Math.round(Number(p.year) || 0)),
    'key-combo': p => (p.keys || []).slice(-1)[0] || null,
    'url-bar': p => firstWordOf(p.url)
};

// Does a spoken / written word match the key? Numbers compare by digits ("$174,953" = "174953", "13K" = "13").
function wordMatches(word, key) {
    const k = normWord(key), w = normWord(word);
    if (!k || !w) return false;
    if (/^\d+$/.test(k)) { const d = String(word).replace(/[^0-9]/g, ''); return d.length > 0 && (d === k || (k.length >= 3 && d.startsWith(k.slice(0, 3)) && Math.abs(d.length - k.length) <= 1)); }
    return w === k || (k.length >= 3 && (w.startsWith(k) || k.startsWith(w) && w.length >= 3));
}

// Where the key word is said, in timeline frames: the transcription when there is one (Activate word timings / the Cut
// tab's Analyse), else estimated from the word's place in the subtitle text (the subtitle's frames shared by characters).
async function keyWordFrame(tl, effect, props, start, end, subIndex) {
    const key = (KEY_WORD[effect] || (() => null))(props || {});
    let sub = null;
    try {
        const subs = await getSubtitles(tl, false);
        sub = subIndex ? subs.find(x => x.index === Number(subIndex)) : null;
        if (!sub) { const mid = (start + end) / 2; sub = subs.find(x => mid >= x.start && mid < x.end) || subs.find(x => x.end > start && x.start < end) || null; }
    } catch (e) { /* no subtitles */ }
    const s0 = sub ? Math.min(sub.start, start) : start, s1 = sub ? Math.max(sub.end, end) : end;
    try {
        const { words } = await require('./anim-timing').spokenWordsFor(s0, s1);
        if (words && words.length) {
            const inSub = sub ? words.filter(w => s0 + w.start < sub.end && s0 + w.end > sub.start) : words;
            const list = inSub.length ? inSub : words;
            const hit = key ? list.find(w => wordMatches(w.w, key)) : null;
            const w = hit || (key ? null : list[list.length - 1]);
            if (w) return { frame: s0 + w.start, word: w.w, source: 'speech' };
        }
    } catch (e) { /* no transcription: estimate */ }
    if (sub) {
        const text = String(sub.text || '');
        const toks = text.split(/(\s+)/);
        let pos = -1, acc = 0, lastStart = 0;
        for (const t of toks) {
            if (/\S/.test(t)) { lastStart = acc; if (pos < 0 && key && wordMatches(t, key)) pos = acc; }
            acc += t.length;
        }
        if (pos < 0) pos = lastStart;
        const frac = acc > 0 ? pos / acc : 0;
        const word = (text.slice(pos).match(/\S+/) || [''])[0];
        return { frame: Math.round(sub.start + frac * (sub.end - sub.start)), word, source: 'estimate' };
    }
    return { frame: Math.round((start + end) / 2), word: '', source: 'middle' };
}

// The new range and settle for a clip spanning start..end so its build lands on the key word: the clip starts 0.5-1.6 s
// before the word (earlier than before if needed) and holds at least 1 s after it.
async function brollLandingPlan(tl, meta, effect, props, start, end, subIndex) {
    if (effect === 'receipt-printer' && props && props.byWord) {
        const r = await receiptWordPlan(meta, props, start, end);
        if (r) return r;
    }
    const k = await keyWordFrame(tl, effect, props, start, end, subIndex);
    const fps = meta.fps;
    const minLead = Math.round(fps * 0.5), maxLead = Math.round(fps * 1.6);
    const lead = Math.max(minLead, Math.min(maxLead, k.frame - start));
    const ns = k.frame - lead;
    let ne = Math.max(end, k.frame + Math.round(fps * 1.0));
    ne = Math.min(ne, ns + Math.round(fps * 12));
    return { start: ns, end: ne, settle: k.frame - ns, wordFrame: k.frame, word: k.word, source: k.source };
}

// Receipt printer, word by word: every printed word on the frame it is spoken (the transcription), so the clip spans
// the whole subtitle (from just before the first word, room for the header) instead of landing on one word.
// Printed words are matched to spoken ones in order (a few words of look-ahead); unmatched ones fall between.
async function receiptWordPlan(meta, props, start, end) {
    let words;
    try { ({ words } = await require('./anim-timing').spokenWordsFor(start, end)); } catch (e) { return null; }
    if (!words || !words.length) return null;
    const fps = meta.fps;
    const printed = [];
    for (const raw of props.lines || []) {
        const [l, r] = String(raw).split('|').map(x => x.trim());
        printed.push(...String(l || '').split(/\s+/).filter(Boolean));
        if (r) printed.push(r);
    }
    if (!printed.length) return null;
    const lead = Math.round(fps * 0.8);
    const ns = Math.min(start, start + words[0].start - lead);
    const rel = (w) => start + w.start - ns;
    const t = new Array(printed.length).fill(null);
    let cur = 0;
    printed.forEach((pw, i) => {
        for (let k = cur; k < Math.min(words.length, cur + 4); k++) if (wordMatches(words[k].w, pw)) { t[i] = rel(words[k]); cur = k + 1; return; }
    });
    // nothing matched (the lines are not the spoken words): print them in step with the speech, word for word
    if (t.every(v => v === null)) printed.forEach((_, i) => { t[i] = rel(words[Math.min(words.length - 1, Math.round(i * (words.length - 1) / Math.max(1, printed.length - 1)))]); });
    for (let i = 0; i < t.length; i++) {
        if (t[i] !== null) continue;
        let j = i; while (j < t.length && t[j] === null) j++;
        const a = i > 0 ? t[i - 1] : Math.max(0, (j < t.length ? t[j] : lead) - (j - i) * 4);
        const b = j < t.length ? t[j] : a + (j - i + 1) * 4;
        for (let k = i; k < j; k++) t[k] = Math.round(a + (b - a) * (k - i + 1) / (j - i + 1));
        i = j - 1;
    }
    const last = Math.max(...t);
    const ne = Math.min(ns + Math.round(fps * 20), Math.max(end, ns + last + Math.round(fps * 1.2)));
    return { start: ns, end: ne, settle: 0, times: t, wordFrame: ns + last, word: printed[printed.length - 1], source: 'speech' };
}

// "Sync to words": re-times placed clips (one id, or all: true for this timeline) so each lands on its key word.
async function brollSync(event, o) {
    o = o || {};
    const { tl, meta, name } = await currentTl();
    const all = readJson(PLACED_FILE, []);
    const recs = o.all ? all.filter(r => r.timeline === name && r.itemId) : [all[findRec(all, String(o.id || ''))]];
    const out = [];
    for (const rec of recs) {
        try {
            const it = (await findItemsByIds(tl, [rec.itemId], 'video')).get(rec.itemId);
            if (!it) { out.push({ id: rec.id, ok: false, error: 'not on the timeline' }); continue; }
            const [s, d] = await Promise.all([it.GetStart(), it.GetDuration()]);
            const start = Number(s), end = Number(s) + Number(d);
            const plan = await brollLandingPlan(tl, meta, rec.effect, rec.props, start, end, rec.subtitle && rec.subtitle.index);
            const sameTimes = JSON.stringify(rec.props._times || null) === JSON.stringify(plan.times || null);
            if (plan.start === start && plan.end === end && Number(rec.props.settle) === plan.settle && sameTimes) {
                out.push({ id: rec.id, ok: true, unchanged: true, word: plan.word, source: plan.source });
                continue;
            }
            const r = await brollAdjust(event, { id: rec.id, props: { settle: plan.settle, _times: plan.times || [] }, startFrame: plan.start, frames: plan.end - plan.start });
            out.push({ id: rec.id, ok: true, word: plan.word, source: plan.source, wordFrame: plan.wordFrame, moved: plan.start - start, how: r.how });
        } catch (e) { out.push({ id: rec.id, ok: false, error: String(e.message || e) }); }
    }
    const est = out.filter(x => x.source === 'estimate').length;
    return { results: out, note: est ? est + ' landed on an estimated word time (no transcription). For exact timing: Activate word timings, or the Cut tab\'s Analyse.' : undefined };
}

// ------------------------------------------------------------------ suggest

const SCORE = { 'stat-bar': 4, 'money-counter': 3, 'post-wall': 3, 'comment-drop': 3, 'stamp-verdict': 3, 'versus-split': 3,
    'year-timeline': 3, 'key-combo': 3, 'url-bar': 3, 'day-dial': 2, 'predict-keys': 2, 'voice-note': 2,
    'receipt-printer': 2, 'marker-highlight': 2, 'quote-card': 2, 'chapter-list': 1, 'live-cursor': 1, 'tag-stack': 1, 'sketch-words': 1 };
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function parseNumber(text) {
    const m = /(\$)?\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|b|million|billion|thousand|grand|%|percent)?\b/i.exec(text);
    if (!m) return null;
    let v = Number(m[2].replace(/,/g, ''));
    const unit = (m[3] || '').toLowerCase();
    let suffix = '', decimals = /\./.test(m[2]) ? Math.min(2, m[2].split('.')[1].length) : 0;
    if (unit === 'k' || unit === 'thousand' || unit === 'grand') { if (v < 1000) { suffix = 'K'; } }
    else if (unit === 'm' || unit === 'million') suffix = 'M';
    else if (unit === 'b' || unit === 'billion') suffix = 'B';
    else if (unit === '%' || unit === 'percent') suffix = '%';
    const money = !!m[1] || /\b(dollars?|bucks|grand|usd|revenue|salary|income|profit|made|earn)/i.test(text);
    return { value: v, prefix: money ? '$' : '', suffix, decimals, raw: m[0] };
}

function propsFor(effect, text) {
    const t = String(text || '').trim();
    const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trim() + '…' : s);
    switch (effect) {
    case 'money-counter': {
        const n = parseNumber(t);
        if (!n) return null;
        const rest = t.replace(n.raw, ' ').replace(/\b(dollars?|bucks|percent)\b/ig, '').replace(/\s+/g, ' ').trim();
        return { prefix: n.prefix, value: n.value, suffix: n.suffix, decimals: n.decimals, label: short(rest.replace(/^[,.\s]+|[,.\s]+$/g, ''), 28) };
    }
    case 'post-wall': {
        const m = /(\d[\d,]*)\s*(posts?|videos?|reels?|uploads?|days?)/i.exec(t);
        if (!m) return null;
        return { count: Number(m[1].replace(/,/g, '')), unit: m[2].toLowerCase() };
    }
    case 'comment-drop': {
        const m = /\bcomment(?:ing)?\s+(?:the word\s+)?["“']?([A-Za-z0-9#]+)/i.exec(t);
        const kw = m ? m[1].toUpperCase() : 'YES';
        return { keyword: kw, comment: '{keyword} to get access' };
    }
    case 'day-dial': {
        const m = /\b(every ?day|daily|each day|days?|hours?|weeks?|morning|routine)\b/i.exec(t);
        const w = m ? m[1].toLowerCase().replace(/^every ?/, '').replace(/s$/, '').replace('daily', 'day').replace('each ', '') : 'day';
        return { word: w || 'day', title: m ? m[1].toLowerCase() : 'day' };
    }
    case 'predict-keys': return { text: short(t.replace(/[.!?]+$/, ''), 30) };
    case 'voice-note': return { caption: short(t.replace(/[.!?]+$/, ''), 30) };
    case 'receipt-printer': {
        // the sentence, one line per clause (at most 5), printed word by word
        const parts = t.replace(/[.!?]+$/, '').split(/\s*[,;:\u2014]\s*|\s+-\s+|\.\s+/).map(s => s.trim()).filter(Boolean).slice(0, 5);
        return { lines: parts.length ? parts.map(s => short(s, 40)) : [short(t, 40)], byWord: true, header: 'Receipt', subheader: '', mark: parts.length > 1 ? parts.length : 0 };
    }
    case 'chapter-list': {
        const m = /\b(?:number|step|tip|part|chapter)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i.exec(t);
        const n = m ? (WORDNUM[m[1].toLowerCase()] || Number(m[1])) : 1;
        return { active: n };
    }
    case 'sketch-words': {
        const words = t.replace(/[^\p{L}\p{N}'\s-]/gu, ' ').split(/\s+/).filter(Boolean);
        const STOP = /^(the|a|an|and|or|but|so|to|of|in|on|at|for|is|it|its|this|that|i|you|we|they|he|she|my|your|be|was|are|with|just|like|if|then|literally|word|one|focus)$/i;
        const pick = words.filter(w => !STOP.test(w)).sort((a, b) => b.length - a.length)[0] || words[0];
        return pick ? { word: short(pick, 18), note: '' } : null;
    }
    case 'versus-split': {
        const m = /\s+\b(?:vs\.?|versus|instead of|rather than|better than|compared to)\b\s+/i.exec(t);
        if (m) {
            const a = short(t.slice(0, m.index).replace(/^[,.\s]+|[,.\s]+$/g, ''), 26);
            const b = short(t.slice(m.index + m[0].length).replace(/[.!?]+$/, ''), 26);
            const swap = /instead of|rather than|better than/i.test(m[0]);
            if (a && b) return { left: swap ? b : a, right: swap ? a : b, strikeLeft: swap };
        }
        const stopStart = /\bstop doing\s+(.+?)\s+(?:and\s+)?start\s+(?:doing\s+)?(.+)/i.exec(t);
        if (stopStart) return { left: short(stopStart[1], 26), right: short(stopStart[2].replace(/[.!?]+$/, ''), 26), strikeLeft: true };
        return null;
    }
    case 'stat-bar': {
        const ratio = /\b(\d+)\s+out of\s+(\d+)\b/i.exec(t);
        if (ratio) {
            const num = Number(ratio[1]), den = Math.max(1, Number(ratio[2]));
            const rest = t.replace(ratio[0], ' ').replace(/\s+/g, ' ').trim();
            return { percent: Math.min(100, Math.round(num / den * 100)), valueText: `${num}/${den}`,
                label: short(rest.replace(/^[,.\s]+|[,.\s]+$/g, ''), 28) || 'Total', down: /\b(dropped|fell|down|lost|failed)\b/i.test(t) };
        }
        const pct = /\b(\d{1,3}(?:\.\d+)?)\s*(?:%|\bpercent\b)/i.exec(t);
        if (!pct) return null;
        const p = Math.min(100, Math.max(0, Number(pct[1])));
        const rest = t.replace(pct[0], ' ').replace(/\s+/g, ' ').trim();
        return { percent: p, valueText: `${Math.round(p)}%`, label: short(rest.replace(/^[,.\s]+|[,.\s]+$/g, ''), 28) || 'Share',
            down: /\b(dropped|fell|down|decreased|lost|less)\b/i.test(t) };
    }
    case 'marker-highlight': {
        const clean = short(t.replace(/[.!?]+$/, ''), 48);
        const words = clean.replace(/[^\p{L}\p{N}'\s-]/gu, ' ').split(/\s+/).filter(Boolean);
        const STOP = /^(the|a|an|and|or|but|so|to|of|in|on|at|for|is|it|its|this|that|i|you|we|they|he|she|my|your|be|was|are|with|just|like|if|then|about|talks|nobody)$/i;
        const focus = words.filter(w => !STOP.test(w)).sort((a, b) => b.length - a.length)[0] || words[words.length - 1] || '';
        return { phrase: clean, focusWord: focus, redact: /\b(secret|hidden|banned)\b/i.test(t) };
    }
    case 'quote-card': {
        const q = /["“]([^"”]{6,})["”]/.exec(t);
        const isAlert = /\b(warning|reminder|just announced)\b/i.exec(t);
        if (isAlert) return { title: isAlert[1].toUpperCase(), body: short(t.replace(/[.!?]+$/, ''), 60), author: '', alert: true };
        return { title: /\brule of thumb\b/i.test(t) ? 'Rule of thumb' : 'Remember', body: short((q ? q[1] : t).replace(/[.!?]+$/, ''), 64), author: '', alert: false };
    }
    case 'stamp-verdict': {
        const isTrue = /\b(fact check|actually works)\b/i.test(t);
        const claim = short(t.replace(/\b(that'?s a |this is a )?(myth|total lie|a lie|completely wrong|fact check)[:,\s-]*/ig, '').replace(/[.!?]+$/, ''), 56);
        return { claim: claim || short(t, 56), verdict: isTrue ? 'FACT' : 'MYTH', isTrue };
    }
    case 'year-timeline': {
        const ym = /\b(19\d{2}|20\d{2})\b/.exec(t);
        let year = ym ? Number(ym[1]) : 0;
        let raw = ym ? ym[0] : '';
        if (!year) {
            const ago = /\b(\d+)\s+years?\s+ago\b/i.exec(t);
            if (ago) { year = new Date().getFullYear() - Number(ago[1]); raw = ago[0]; }
        }
        if (!year) return null;
        const cap = t.replace(raw, ' ').replace(/\b(back in|in|since|by|from|until)\b/ig, ' ').replace(/\s+/g, ' ').trim();
        return { year, caption: short(cap.replace(/^[,.\s]+|[,.\s]+$/g, ''), 36) };
    }
    case 'key-combo': {
        const keys = [];
        if (/\b(command|cmd)\b/i.test(t)) keys.push('⌘');
        if (/\b(control|ctrl)\b/i.test(t)) keys.push('Ctrl');
        if (/\b(option|alt)\b/i.test(t)) keys.push('⌥');
        if (/\bshift\b/i.test(t)) keys.push('Shift');
        const special = /\b(enter|return|space|tab|escape|esc)\b/i.exec(t);
        if (special) {
            const s = special[1].toLowerCase();
            keys.push(s === 'enter' || s === 'return' ? '↵' : s === 'escape' || s === 'esc' ? 'Esc' : s[0].toUpperCase() + s.slice(1));
        } else {
            const k = /\b(?:command|cmd|ctrl|control|shift|option|alt|press|hit|hold)\s*\+?\s*([a-z0-9])\b/i.exec(t);
            if (k) keys.push(k[1].toUpperCase());
        }
        if (!keys.length) return null;
        return { keys, label: short(t.replace(/[.!?]+$/, ''), 28) };
    }
    case 'url-bar': {
        const dom = /\b([a-z0-9-]+\.(?:com|io|ai|org|app|dev|co|net))\b/i.exec(t);
        return { url: dom ? dom[1].toLowerCase() : 'link in bio', cta: dom ? 'Visit' : 'Open' };
    }
    default: return {};
    }
}

// The tab's "Fill from subtitle": the subtitle under the playhead (else the next one) turned into this effect's text
// fields, the same way Auto reads a line. Only the fields the words decide come back, so the user's own header,
// colours and layout stay as they are.
async function brollFromPlayhead(event, o) {
    const reg = registry();
    const e = effectById(reg, o && o.effect);
    const { tl, meta } = await currentTl();
    const at = tcToFrame(await tl.GetCurrentTimecode(), meta);
    const subs = await getSubtitles(tl, false);
    const s = subs.find(x => at >= x.start && at < x.end) || subs.find(x => x.start >= at);
    if (!s) throw new Error('No subtitle under or after the playhead');
    const text = String(s.text || '').replace(/\s+/g, ' ').trim();
    let props = propsFor(e.id, text);
    if (props === null) {
        const what = e.id === 'money-counter' ? 'a number' : e.id === 'post-wall' ? 'a count (e.g. "100 posts")' : 'what this effect needs';
        throw new Error('Subtitle #' + s.index + ' has no ' + what + ': “' + text + '”');
    }
    props = { ...props };
    if (e.id === 'receipt-printer') { delete props.header; delete props.subheader; delete props.byWord; }
    if (e.id === 'comment-drop') delete props.comment;
    const words = text.replace(/[^\p{L}\p{N}'$%\s-]/gu, ' ').split(/\s+/).filter(Boolean);
    const STOP = /^(the|a|an|and|or|but|so|to|of|in|on|at|for|is|it|its|it's|this|that|i|you|we|they|he|she|my|your|be|was|are|with|just|like|if|then)$/i;
    const key = words.filter(w => !STOP.test(w)).sort((a, b) => b.length - a.length);
    if (e.id === 'sketch-words' && key[0]) props.word = key[0];
    if (e.id === 'tag-stack' && key.length) props.tags = key.slice(0, 4);
    const keys = new Set(e.fields.map(f => f.key));
    for (const k of Object.keys(props)) if (!keys.has(k)) delete props[k];
    if (!Object.keys(props).length) throw new Error(e.name + ' has no text fields to fill from a subtitle');
    return { subtitle: { index: s.index, text, start: s.start, end: s.end }, props };
}

// Which subtitles would carry which effect. Not placed: the result goes to the tab (ticks) or to Claude, who can
// change any props and pass the list to place_broll { items }.
function brollSuggestFromTexts(subs, o, reg, fps) {
    o = o || {};
    const max = Math.max(1, Math.min(40, Number(o.max) || 8));
    const gapF = Math.round((Number.isFinite(Number(o.minGap)) ? Number(o.minGap) : 4) * fps);
    const allow = Array.isArray(o.effects) && o.effects.length ? new Set(o.effects) : null;
    const res = reg.effects.filter(e => !allow || allow.has(e.id)).map(e => ({ e, re: (e.triggers || []).map(t => new RegExp(t, 'i')) })).filter(x => x.re.length);
    const cands = [];
    for (const s of subs) {
        const text = String(s.text || '');
        for (const { e, re } of res) {
            const hit = re.find(r => r.test(text));
            if (!hit) continue;
            const props = propsFor(e.id, text);
            if (!props) continue;
            const m = hit.exec(text);
            cands.push({ subtitle: s.index, text, start: s.start, end: s.end, effect: e.id, name: e.name, props,
                why: 'matched "' + (m ? m[0] : '') + '"', score: (SCORE[e.id] || 1) + (text.length < 60 ? 0.2 : 0) });
        }
    }
    cands.sort((a, b) => b.score - a.score || a.start - b.start);
    const picked = [];
    const usedSub = new Set();
    for (const c of cands) {
        if (picked.length >= max) break;
        if (usedSub.has(c.subtitle)) continue;
        if (picked.some(p => Math.abs(p.start - c.start) < gapF)) continue;
        if (picked.length && picked[picked.length - 1].effect === c.effect && picked.filter(p => p.effect === c.effect).length >= 2) continue;
        picked.push(c); usedSub.add(c.subtitle);
    }
    picked.sort((a, b) => a.start - b.start);
    return picked.map(({ score, ...c }) => c);
}

async function brollSuggest(event, o) {
    o = o || {};
    const reg = registry();
    const { tl, meta } = await currentTl();
    let subs = await getSubtitles(tl, false);
    if (o.from || o.to) subs = subs.filter(s => s.index >= (Number(o.from) || 1) && s.index <= (Number(o.to) || Infinity));
    if (o.marks) {
        const m = await markRange(tl);
        if (!m) throw new Error('Set a Mark In and a Mark Out on the timeline first (I and O in Resolve)');
        subs = subs.filter(s => s.end > m.start && s.start < m.end);
    }
    const taken = new Set(readJson(PLACED_FILE, []).filter(r => r.subtitle).map(r => r.subtitle.index));
    if (o.skipPlaced !== false) subs = subs.filter(s => !taken.has(s.index));
    const list = brollSuggestFromTexts(subs.map(s => ({ index: s.index, text: s.text, start: s.start, end: s.end })), o, reg, meta.fps);
    return { subtitles: subs.length, suggestions: list,
        note: 'Nothing is placed yet. Change any props, then place them (B-roll tab: Place ticked; MCP: place_broll { items: [...] }).' };
}
