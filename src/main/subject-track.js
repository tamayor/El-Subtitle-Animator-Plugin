// Track Subject (Use tab > Effect Preset > Track Subject): the selected clip follows a subject in the footage under it.
//   1. trackSource: the bridge finds the footage under the clip and sends its picture at the playhead; the panel draws
//      a box on it.
//   2. trackRun: the footage frames the two clips share are exported (bridge track_frames, in chunks for progress),
//      tracked by src/python/subject_tracker.py in the app's own OpenCV venv, and keyed into the clip's ELSA Track
//      Subject effect (bridge fx_bake_track). Resolve's scripting API cannot run its own trackers.
// The tracker venv lives in Electron's userData folder and is installed once, when the user agrees (trackInstall).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

const { bridgeCall } = require('./fusion-bridge');
const { BRIDGE_SCRIPT } = require('./config');

const TRACKER_SCRIPT = path.join(path.dirname(BRIDGE_SCRIPT), 'subject_tracker.py');
const PACKAGES = ['opencv-contrib-python-headless', 'numpy'];
const CHUNK = 15;            // frames per track_frames request: Resolve's UI waits while it exports, so short bursts
const PREVIEW_MAX = 300;     // frames sent back for the sheet's playback (longer clips: every 2nd / 3rd frame)
const MAX_DIM = 640;         // tracking picture size (long side)

function venvDir() { return path.join(app.getPath('userData'), 'tracker-venv'); }
function venvPython() { return path.join(venvDir(), 'bin', 'python3'); }
function systemPython() {
    return ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'].find(p => fs.existsSync(p)) || null;
}

let engineOk = null;         // cached: cv2 imports in the venv
let job = null;              // the running track: { cancelPath, proc, cancelled }

function run(cmd, args, opts, onLine) {
    return new Promise((resolve) => {
        let out = '', err = '', buf = '';
        let p;
        try { p = spawn(cmd, args, opts || {}); } catch (e) { resolve({ code: -1, out, err: String(e.message || e) }); return; }
        if (opts && opts.track) opts.track(p);
        p.stdout.on('data', d => {
            const s = d.toString(); out += s;
            if (onLine) { buf += s; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { onLine(l); } catch (e) { /* ignore */ } } }
        });
        p.stderr.on('data', d => { err += d.toString(); if (err.length > 20000) err = err.slice(-10000); });
        p.on('error', e => resolve({ code: -1, out, err: err + String(e.message || e) }));
        p.on('close', code => resolve({ code, out, err }));
        if (opts && opts.input !== undefined) { p.stdin.write(opts.input); p.stdin.end(); }
    });
}

async function engineReady() {
    if (engineOk) return true;
    if (!fs.existsSync(venvPython())) return false;
    const r = await run(venvPython(), ['-I', '-c', 'import cv2, numpy; print(int(hasattr(cv2, "TrackerCSRT_create") or hasattr(cv2, "legacy")))']);
    engineOk = r.code === 0 && r.out.trim() === '1';
    return engineOk;
}

// { ready, canInstall } for the panel
async function trackEngine() {
    return { ready: await engineReady(), canInstall: !!systemPython(), sizeMB: 190 };
}

// Installs the tracker venv (once). Progress goes to the panel as track:progress { phase: 'install', text }.
async function trackInstall(event) {
    if (await engineReady()) return { ready: true };
    const py = systemPython();
    if (!py) return { error: 'Tracking needs Python 3 (install it from python.org or Homebrew).' };
    const send = (text) => { try { event.sender.send('track:progress', { phase: 'install', text }); } catch (e) { /* panel gone */ } };
    send('Creating the tracking engine…');
    if (!fs.existsSync(venvPython())) {
        const r = await run(py, ['-m', 'venv', venvDir()]);
        if (r.code !== 0) return { error: 'Could not create the tracking engine: ' + (r.err || r.out).trim().slice(-300) };
    }
    send('Downloading OpenCV (about 190 MB on disk)…');
    const r = await run(venvPython(), ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', ...PACKAGES], {},
        (line) => { const m = /^(Collecting|Downloading|Installing|Successfully)\b.*/.exec(line.trim()); if (m) send(m[0].slice(0, 90)); });
    engineOk = null;
    if (r.code !== 0 || !(await engineReady())) return { error: 'Could not install OpenCV: ' + (r.err || r.out).trim().slice(-300) };
    send('Tracking engine ready.');
    return { ready: true };
}

// The footage under the selected clip at `frame` (the playhead), for the box.
async function trackSource(event, frame) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    return await bridgeCall('track_source', { frame: Number.isFinite(Number(frame)) ? Math.round(Number(frame)) : null, maxDim: 720 }, 15000, { lane: 0 });
}

function cleanValues(v) {
    const out = {};
    for (const k of ['FollowX', 'FollowY', 'FollowScale', 'FollowRot', 'Smooth']) if (v && Number.isFinite(Number(v[k]))) out[k] = Number(v[k]);
    return out;
}

// opts: { target, subject, range: [lo, hi], anchor, box: [x, y, w, h] 0..1, values }
async function trackRun(event, opts) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    if (job) return { error: 'A track is already running.' };
    if (!(await engineReady())) return { needInstall: true };
    const o = opts || {};
    const box = Array.isArray(o.box) ? o.box.map(Number) : null;
    if (!box || box.length !== 4 || box.some(v => !Number.isFinite(v)) || box[2] <= 0.002 || box[3] <= 0.002) return { error: 'Draw a box around the subject first.' };
    const lo = Math.round(Number(o.range && o.range[0])), hi = Math.round(Number(o.range && o.range[1]));
    const anchor = Math.round(Number(o.anchor));
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo || !Number.isFinite(anchor)) return { error: 'Pick the clip again.' };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elsa-track-'));
    const cancelPath = path.join(dir, 'cancel');
    job = { cancelPath, proc: null, cancelled: false };
    const send = (p) => { try { event.sender.send('track:progress', p); } catch (e) { /* panel gone */ } };
    const total = hi - lo + 1;
    try {
        // 1. footage frames
        for (let f = lo; f <= hi; f += CHUNK) {
            if (job.cancelled) return { cancelled: true };
            const to = Math.min(hi, f + CHUNK - 1);
            send({ phase: 'frames', done: f - lo, total });
            await bridgeCall('track_frames', { subject: String(o.subject), from: f, to, outDir: dir, maxDim: MAX_DIM, cancelPath }, 60000);
        }
        send({ phase: 'frames', done: total, total });
        if (job.cancelled) return { cancelled: true };
        // 2. track
        const frames = []; for (let f = lo; f <= hi; f++) frames.push(f);
        let result = null, error = null;
        const r = await run(venvPython(), ['-I', TRACKER_SCRIPT], { input: JSON.stringify({ dir, frames, anchor, box }) + '\n', track: (p) => { job.proc = p; } }, (line) => {
            let m; try { m = JSON.parse(line); } catch (e) { return; }
            if (m.progress) send({ phase: 'track', done: m.progress, total: m.total });
            else if (m.track) result = m;
            else if (m.error) error = m.error;
        });
        if (job.cancelled) return { cancelled: true };
        if (!result) return { error: 'Tracking failed: ' + (error || r.err.trim().slice(-300) || 'no result') };
        // 3. key the clip
        send({ phase: 'bake' });
        const baked = await bridgeCall('fx_bake_track', { item: String(o.target), track: result.track, anchor, box, values: cleanValues(o.values) }, 30000, { lane: 0 });
        const vals = Object.values(result.track);
        // the tracked frames for the sheet's playback (the box drawn on each), read before the temp folder goes
        const step = Math.max(1, Math.ceil(frames.length / PREVIEW_MAX));
        const preview = [];
        for (let i = 0; i < frames.length; i += step) {
            try { preview.push({ f: frames[i], data: fs.readFileSync(path.join(dir, 'f' + frames[i] + '.jpg')).toString('base64') }); } catch (e) { /* missing frame */ }
        }
        return Object.assign({}, baked, { frames: vals.length, lost: vals.filter(v => !v[4]).length, track: result.track, preview, step });
    } finally {
        job = null;
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
    }
}

function trackCancel() {
    if (!job) return { ok: true };
    job.cancelled = true;
    try { fs.writeFileSync(job.cancelPath, '1'); } catch (e) { /* ignore */ }
    try { if (job.proc) job.proc.kill(); } catch (e) { /* ignore */ }
    return { ok: true };
}

// Follow X / Y / Scale and Smoothing changed: re-key from the stored track (no tracking).
async function trackSettings(event, itemId, values) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    return await bridgeCall('fx_bake_track', { item: String(itemId), values: cleanValues(values) }, 15000, { lane: 0 });
}

module.exports = { trackEngine, trackInstall, trackSource, trackRun, trackCancel, trackSettings };
