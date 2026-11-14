// B-roll tab (js/library/broll/) and the MCP tools list_broll / broll_preview / place_broll / adjust_broll /
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

// Required before module.exports: two of the exported names come from these modules.
const { ANY_ORDER, KEY_WORD, WORD_UNITS, findWordHit, keyBlock, mergeSplitNumbers, unitTimes, wordMatches, wordSpans } = require('./broll-words');
const { brollSuggestFromTexts, propsFor } = require('./broll-suggest');

module.exports = {
    brollEffects, brollPreview, brollPlace, brollPlaceMany, brollAdjust, brollRemove, brollList, brollSuggest,
    brollStatus, brollCancel, brollOpenFolder, brollFinalize, draftScale, brollShutdown, brollSuggestFromTexts, brollFrame, brollStrip, brollTrace, brollSync, brollLandingPlan, brollFromPlayhead, findWordHit, brollWordLane,
    brollVibeProps, brollRestyle
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
const { vibeArgs, applyVibe, vibeList } = require('./broll-vibe');

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

// The starting looks (broll/vibes.json, drawn by broll/src/lib/vibe.tsx). A vibe is passed per MCP call and kept with
// the placed clip (broll-vibe.js): it is not a field of an effect and not a remembered panel value.
function vibes() {
    const v = readJson(path.join(brollDir(), 'vibes.json'), null);
    return v && Array.isArray(v.vibes) && v.vibes.length ? v.vibes : [];
}
const accentDefault = (reg) => (reg.common.find(f => f.key === 'accent') || {}).default || '';

// MCP `vibe` (a starter id, or { base, ...changes }) -> `props` with the look in it. An accent the caller did not ask
// for goes back to the default, so the last one used in the panel (or the look before) does not override the vibe's.
function brollVibeProps(vibe, props) {
    const all = vibes();
    const v = all.length ? vibeArgs(vibe, all) : null;
    if (!v) return props;
    const p = { ...(props || {}) };
    if (!p.accent) p.accent = accentDefault(registry());
    return { ...p, ...v };
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
    delete out._times; delete out._ends; delete out._manual; delete out._samples;   // word times belong to one placed clip, never to the remembered panel values
    delete out.vibe; delete out._vibe;   // ...and so does its look
    const p = props || {};
    for (const f of fields) {
        if (!(f.key in p) || p[f.key] === undefined || p[f.key] === null) continue;
        let v = p[f.key];
        if (f.type === 'number') { v = Number(v); if (!Number.isFinite(v)) continue; if (f.min !== undefined) v = Math.max(f.min, v); if (f.max !== undefined) v = Math.min(f.max, v); }
        else if (f.type === 'bool') v = v === true || v === 'true' || v === 1;
        else if (f.type === 'list') v = Array.isArray(v) ? v.map(String).filter(Boolean) : String(v).split(/\n|,/).map(s => s.trim()).filter(Boolean);
        else if (f.type === 'color') { v = String(v); if (!/^#[0-9a-f]{6}$/i.test(v)) continue; }
        else if (f.type === 'select') { v = String(v).trim().toLowerCase(); if (!(f.options || []).includes(v)) continue; }
        else v = String(v);
        out[f.key] = v;
    }
    out.exit = 0;   // no animation out: every B-roll holds its finished graphic to the end of the clip (the subtitle's end)
    // per-word print frames (receipt printer word by word, set by Sync to words); not a panel field
    if (Array.isArray(p._times)) out._times = p._times.map(Number).filter(Number.isFinite).slice(0, 400);
    // per-word end frames (the word fully in) and whether the user set the word timings by hand in the word lane
    if (Array.isArray(p._ends)) out._ends = p._ends.map(Number).filter(Number.isFinite).slice(0, 400);
    if (p._manual) out._manual = true;
    // the clip's loudness per frame (0..1) for the audio-driven effects (audio-pulse, cutout-puppet); not a panel field
    if (Array.isArray(p._samples)) out._samples = p._samples.map(Number).filter(Number.isFinite).slice(0, 3000).map(v => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000);
    // the look an MCP call gave it (vibe + _vibe); not a panel field
    if (typeof p.vibe === 'string' && p.vibe) applyVibe(out, p, vibes(), accentDefault(reg));
    return out;
}

function saveLast(effect, props) {
    const prefs = readJson(PREFS_FILE, {});
    prefs.last = prefs.last || {};
    const keep = { ...props };
    // a vibe belongs to the clip it was placed with: the panel's next placement keeps the effect's own look and accent
    if (keep.vibe) { const before = (prefs.last[effect] || {}).accent; if (before) keep.accent = before; else delete keep.accent; }
    delete keep.vibe; delete keep._vibe;
    prefs.last[effect] = keep;
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
            return { id: e.id, name: e.name, group: e.group || '', description: e.description, seconds: e.seconds, fields: e.fields,
                defaults: mergedProps(reg, e, {}, false), last: last[e.id] || null, thumb };
        }),
        vibes: vibeList(vibes()),
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
    const minF = Math.max(4, Math.round(meta.fps * 0.4));
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
        maxF = Math.round(meta.fps * 60);                  // on a subtitle: its whole length (up to a minute)
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

// What the effect reads from the footage under it (broll-footage.js): the dialogue's loudness, the speaker cut out of
// the frames, the frames themselves. Hidden props for this render only; the placed record keeps the panel's props.
async function withFootage(e, props, start, frames, meta, o) {
    const FOOT = require('./broll-footage');
    if (!FOOT.needsFor(e.id, props)) return { props, notes: [] };
    const say = (text) => { current = { ...current, text: e.name + ': ' + text + '…' }; send(current); };
    const r = await FOOT.footageProps(e.id, props, start, frames, meta, { ...(o || {}), progress: say });
    return { props: { ...props, ...r.extra }, notes: r.notes };
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
    // effects that read the footage: the frame under the playhead stands in for the clip (a preview reads one frame)
    let shown = props;
    if (require('./broll-footage').needsFor(e.id, props) && !(o.width && o.height)) {
        try {
            const { tl, meta } = await currentTl();
            const ph = tcToFrame(await tl.GetCurrentTimecode(), meta);
            current = { phase: 'preview', effect: e.id, text: 'Reading the footage for ' + e.name + '…' };
            shown = (await withFootage(e, props, ph, frames, meta, { still: ph })).props;
        } catch (err) { dlog('BROLL-FOOTAGE-PREVIEW', e.id, String(err.message || err)); }
    }
    const key = crypto.createHash('sha1').update(JSON.stringify([e.id, shown, w, h, fps, frames, at, scale])).digest('hex').slice(0, 14);
    const out = path.join(PREVIEW_DIR, e.id + '-' + key + '.png');
    if (!fs.existsSync(out)) {
        current = { phase: 'preview', effect: e.id, text: 'Drawing a preview of ' + e.name + '…' };
        send(current);
        await renderJob({ op: 'still', effect: e.id, props: shown, width: w, height: h, fps, frames, frame: Math.round(frames * at), out, scale });
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
        if (Number.isFinite(landed.delay)) props.delay = landed.delay;
        if (landed.times) { props._times = landed.times; props._ends = landed.ends || []; if (!landed.manual) delete props._manual; }
        else { delete props._times; delete props._ends; if (!landed.manual) delete props._manual; }
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
    let footNotes = [];
    try {
        const foot = await withFootage(e, props, r.start, r.frames, meta);
        footNotes = foot.notes;
        current = { ...current, text: 'Rendering ' + label + '…' };
        await renderJob({ op: 'video', effect: e.id, props: foot.props, width: meta.width, height: meta.height, fps: meta.fps, frames: r.frames, out, scale },
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
    placed.notes.push(...footNotes);
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
    let newStart = Number.isFinite(Number(o.startFrame)) ? Math.round(Number(o.startFrame)) : Number(curStart);
    const hasCustomSec = Number.isFinite(Number(o.seconds)) && Number(o.seconds) > 0;
    if (hasCustomSec) frames = Math.round(Number(o.seconds) * meta.fps);
    if (Number.isFinite(Number(o.frames)) && Number(o.frames) > 0) frames = Math.round(Number(o.frames));
    // A clip on a subtitle follows that subtitle: same start, same length (unless a length / start / extend was asked for)
    if (rec.subtitle && !rec.marks && !hasCustomSec && !(Number(o.frames) > 0) && !Number.isFinite(Number(o.startFrame)) && !(Number(o.extend) > 0)) {
        try {
            const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
            const s = (await getSubtitles(tl, false)).find(x => x.index === Number(rec.subtitle.index));
            if (s && s.end - s.start >= 4 && (!rec.subtitle.text || norm(s.text) === norm(rec.subtitle.text))) { newStart = s.start; frames = s.end - s.start; }
        } catch (err) { /* keep the clip's own range */ }
    }
    let landed = null;
    if (o.landOnWord && o.settle === undefined && !Number.isFinite(Number(o.startFrame))) {
        const plan = await brollLandingPlan(tl, meta, e.id, props, newStart, newStart + frames, rec.subtitle && rec.subtitle.index);
        if (plan.times) { props._times = plan.times; props._ends = plan.ends || []; if (!plan.manual) delete props._manual; }
        props.settle = plan.settle;
        if (Number.isFinite(plan.delay)) props.delay = plan.delay;
        newStart = plan.start;
        if (!hasCustomSec) frames = plan.end - plan.start;
        landed = { word: plan.word, source: plan.source, wordFrame: plan.wordFrame };
    } else if (o.landOnWord === false) {
        props.settle = 0;
        delete props._times; delete props._ends; delete props._manual;   // the word-by-word timing belongs to Land on word
    }
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
    let footNotes = [];
    try {
        const foot = await withFootage(e, props, newStart, frames, meta);
        footNotes = foot.notes;
        current = { ...current, text: verb + e.name + '…' };
        await renderJob({ op: 'video', effect: e.id, props: foot.props, width: meta.width, height: meta.height, fps: meta.fps, frames, out, scale },
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
    return { ...rec, how, seconds: Number(sec), notes: footNotes.length ? footNotes : undefined };
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

// adjust_broll { all: true, vibe }: gives every B-roll on the open timeline the same look (and any other `props`).
// Each clip is re-rendered in place; a draft stays a draft.
async function brollRestyle(event, o) {
    o = o || {};
    const { tl, name } = await currentTl();
    const mine = readJson(PLACED_FILE, []).filter(r => r.timeline === name && r.itemId);
    const on = mine.length ? new Set((await findItemsByIds(tl, mine.map(r => r.itemId), 'video')).keys()) : new Set();
    const ids = mine.filter(r => on.has(r.itemId)).map(r => r.id);
    cancelAsked = false;
    const results = [];
    for (const id of ids) {
        if (cancelAsked) break;
        try { const r = await brollAdjust(event, { id, props: o.props }); results.push({ id, ok: true, how: r.how }); }
        catch (e) { results.push({ id, ok: false, error: String(e.message || e) }); }
    }
    cancelAsked = false;
    return { restyled: results.filter(r => r.ok).length, results, note: ids.length ? undefined : 'No B-roll on this timeline.' };
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

// The transcription's words, with numbers it split back together ("1" + ",600" -> "1,600", "$" + "174,953").
async function spokenWords(start, end, opts) {
    const r = await require('./anim-timing').spokenWordsFor(start, end, opts);
    return { ...r, words: mergeSplitNumbers(r.words || []) };
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
        const { words } = await spokenWords(s0, s1);
        if (words && words.length) {
            const inSub = sub ? words.filter(w => s0 + w.start < sub.end && s0 + w.end > sub.start) : words;
            const list = inSub.length ? inSub : words;
            const hit = key ? findWordHit(list, key) : null;
            const w = hit || list[list.length - 1];
            if (w) return { frame: s0 + Math.round((w.start + (w.end ?? w.start)) / 2), word: w.w, source: 'speech' };
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
        const word = (text.slice(pos).match(/\S+/) || [''])[0];
        const frac = acc > 0 ? (pos + word.length * 0.5) / acc : 0;
        return { frame: Math.round(sub.start + frac * (sub.end - sub.start)), word, source: 'estimate' };
    }
    return { frame: Math.round((start + end) / 2), word: '', source: 'middle' };
}

// The new range and settle for a clip spanning start..end so its build lands on the key word while keeping the
// subtitle's own duration (start..end).
async function brollLandingPlan(tl, meta, effect, props, start, end, subIndex) {
    if (effect === 'receipt-printer' && props && props.byWord) {
        const r = await receiptWordPlan(meta, props, start, end);
        if (r) return r;
    }
    const wp = await wordUnitsPlan(effect, props, start, end);
    if (wp) return wp;
    const dur = Math.max(6, end - start);
    // landing set by hand in the word lane (the key word block's matcha end): kept until Sync to words
    if (props && props._manual && Number(props.settle) > 0) {
        const st = Math.max(2, Math.min(dur - 1, Math.round(Number(props.settle))));
        return { start, end: start + dur, settle: st, wordFrame: start + st, word: '', source: 'manual', manual: true };
    }
    if (WORD_UNITS[effect] || KEY_WORD[effect]) {
        // one key word: the build runs over the word, from a little before it is said (delay) to its middle (settle)
        const b = await keyBuildSpan(effect, props, start, dur);
        if (b) return { start, end: start + dur, settle: b.land, delay: b.from, wordFrame: start + b.land, word: b.word, source: b.source };
    }
    const k = await keyWordFrame(tl, effect, props, start, end, subIndex);
    const settle = Math.max(4, Math.min(dur - 2, k.frame - start));
    return { start, end: start + dur, settle, wordFrame: k.frame, word: k.word, source: k.source };
}

// The B-roll tab's word lane under the In bar: what Land on word times, in frames from the clip start.
// Word-by-word effects: one segment per shown word / item (the clip's saved _times when they still fit, else matched
// now). Other effects: the subtitle's spoken words, the key word marked. Words come from an existing transcription
// only (never a new speech run for a preview), else they are estimated from the subtitle text.
// o: { effect, props, id (a placed clip) | subtitle (number) } -> { segs: [{ s, e, label, key }], frames, source }
async function brollWordLane(event, o) {
    o = o || {};
    const reg = registry();
    const e = effectById(reg, o.effect);
    const props = mergedProps(reg, e, o.props, false);
    const { tl } = await currentTl();
    let start, end, text = '';
    const rec = o.id ? readJson(PLACED_FILE, []).find(r => r.id === o.id) : null;
    const subs = await getSubtitles(tl, false).catch(() => []);
    if (rec) {
        start = Number(rec.start); end = start + Number(rec.frames);
        const s = rec.subtitle && subs.find(x => x.index === Number(rec.subtitle.index));
        text = s ? s.text : (rec.subtitle && rec.subtitle.text) || '';
    } else {
        const s = subs.find(x => x.index === Number(o.subtitle));
        if (!s) return { segs: [], frames: 0, source: 'none' };
        start = s.start; end = s.end; text = s.text;
    }
    const dur = Math.max(1, end - start);
    let words = [], source = 'speech';
    try { ({ words } = await spokenWords(start, end, { cachedOnly: true })); } catch (err) { words = []; }
    if (!words || !words.length) {
        // estimate: the clip's frames shared out by the characters of the subtitle's words
        source = 'estimate';
        const toks = String(text || '').split(/\s+/).filter(Boolean);
        const total = toks.reduce((a, t) => a + t.length + 1, 0) || 1;
        let acc = 0;
        words = toks.map(t => { const w = { w: t, start: acc / total * dur, end: (acc + t.length) / total * dur }; acc += t.length + 1; return w; });
    }
    const span = (list) => list.map((x, i) => ({ s: Math.max(0, Math.round(x.at)), e: Math.min(dur, Math.round(i + 1 < list.length ? list[i + 1].at : dur)), label: x.label, key: !!x.key }));
    const f = WORD_UNITS[e.id];
    const units = f ? f(props) : [];
    if (units.length >= 2) {
        const saved = Array.isArray(props._times) && props._times.length === units.length ? props._times.map(Number) : null;
        let sp = null;
        if (saved) {
            const ends = Array.isArray(props._ends) && props._ends.length === units.length ? props._ends.map(Number) : wordSpans(e.id, units, saved, dur).ends;
            sp = { ins: saved, ends };
        } else if (words.length) sp = wordSpans(e.id, units, unitTimes(units, words, ANY_ORDER.has(e.id)), dur);
        if (sp) {
            // one row: the subtitle's other spoken words (locked) with the shown words as blocks on top
            const used = words.length ? unitTimes(units, words, ANY_ORDER.has(e.id)).used : new Set();
            const rest = words.filter((_, x) => !used.has(x));
            const locked = rest.map((w, x) => ({ s: Math.max(0, Math.round(w.start)), e: Math.min(dur, Math.round(x + 1 < rest.length ? rest[x + 1].start : Math.max(w.end, w.start + 1))), label: w.w, locked: true }));
            const blocks = units.map((u, i) => ({ s: Math.max(0, Math.round(sp.ins[i])), e: Math.min(dur, Math.max(Math.round(sp.ins[i]) + 1, Math.round(sp.ends[i]))), label: u, key: false, unit: i }));
            const segs = [...locked, ...blocks].sort((a, b) => a.s - b.s || (a.locked ? -1 : 1));
            return { segs, frames: dur, source: props._manual ? 'manual' : saved ? 'saved' : source, units: true, editable: true };
        }
    }
    const keyFn = KEY_WORD[e.id];
    const key = keyFn ? keyFn(props) : null;
    const kb = keyBlock(words, key, dur);
    // one row: the spoken words (locked) with the key word as its build block, from where the build starts (strawberry)
    // to where it lands (matcha); set by hand it is the clip's delay / settle
    const others = words.filter(w => !kb || w !== kb.hit);
    const segs = span(others.map(w => ({ at: w.start, label: w.w }))).map(g => ({ ...g, locked: true }));
    if (kb) {
        const manual = props._manual && Number(props.settle) > 0;
        const land = manual ? Math.round(Number(props.settle)) : kb.land;
        const from = manual ? Math.max(0, Math.min(land - 1, Math.round(Number(props.delay) || 0))) : kb.from;
        // the locked word before it ends where the block starts
        const prev = segs.filter(g => g.s < from).pop();
        if (prev && prev.e > from) prev.e = Math.max(prev.s + 1, from);
        segs.push({ s: from, e: Math.min(dur, land), label: String(kb.word), key: true, build: true });
        segs.sort((a, b) => a.s - b.s);
    }
    return { segs, frames: dur, source, units: false, editable: !!kb };
}

async function keyBuildSpan(effect, props, start, dur) {
    const key = (KEY_WORD[effect] || (() => null))(props || {});
    if (!key) return null;
    let words;
    try { ({ words } = await spokenWords(start, start + dur)); } catch (e) { return null; }
    if (!words || !words.length) return null;
    const b = keyBlock(words, key, dur);
    return b ? { ...b, source: 'speech' } : null;
}

async function wordUnitsPlan(effect, props, start, end) {
    const f = WORD_UNITS[effect];
    const units = f ? f(props || {}) : [];
    if (units.length < 2) return null;            // one word: the single key-word landing does it
    const dur0 = Math.max(6, end - start);
    // timings set by hand in the word lane stay (while they still fit the words); Sync to words re-times them
    if (props && props._manual && Array.isArray(props._times) && props._times.length === units.length) {
        const ends = Array.isArray(props._ends) && props._ends.length === units.length ? props._ends : wordSpans(effect, units, props._times, dur0).ends;
        return { start, end: start + dur0, settle: 0, times: props._times, ends, manual: true, wordFrame: start + Math.max(...ends), word: units[units.length - 1], source: 'manual' };
    }
    let words;
    try { ({ words } = await spokenWords(start, end)); } catch (e) { return null; }
    if (!words || !words.length) return null;
    const dur = Math.max(6, end - start);
    const sp = wordSpans(effect, units, unitTimes(units, words, ANY_ORDER.has(effect)).map(v => Math.min(dur - 2, v)), dur);
    return { start, end: start + dur, settle: 0, times: sp.ins, ends: sp.ends, wordFrame: start + Math.max(...sp.ends), word: units[units.length - 1], source: 'speech' };
}

// Receipt printer, word by word: every printed word on the frame it is spoken (the transcription), so the clip spans
// the whole subtitle (from just before the first word, room for the header) instead of landing on one word.
// Printed words are matched to spoken ones in order (a few words of look-ahead); unmatched ones fall between.
async function receiptWordPlan(meta, props, start, end) {
    let words;
    try { ({ words } = await spokenWords(start, end)); } catch (e) { return null; }
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
            const plan = await brollLandingPlan(tl, meta, rec.effect, { ...rec.props, _manual: false }, start, end, rec.subtitle && rec.subtitle.index);
            const sameTimes = JSON.stringify(rec.props._times || null) === JSON.stringify(plan.times || null);
            if (plan.start === start && plan.end === end && Number(rec.props.settle) === plan.settle && sameTimes) {
                out.push({ id: rec.id, ok: true, unchanged: true, word: plan.word, source: plan.source });
                continue;
            }
            const r = await brollAdjust(event, { id: rec.id, props: { settle: plan.settle, ...(Number.isFinite(plan.delay) ? { delay: plan.delay } : {}), _times: plan.times || [], _ends: plan.ends || [], _manual: false }, startFrame: plan.start, frames: plan.end - plan.start });
            out.push({ id: rec.id, ok: true, word: plan.word, source: plan.source, wordFrame: plan.wordFrame, moved: plan.start - start, how: r.how });
        } catch (e) { out.push({ id: rec.id, ok: false, error: String(e.message || e) }); }
    }
    const est = out.filter(x => x.source === 'estimate').length;
    return { results: out, note: est ? est + ' landed on an estimated word time (no transcription). For exact timing: Activate word timings, or the Cut tab\'s Analyse.' : undefined };
}

// ------------------------------------------------------------------ suggest

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
