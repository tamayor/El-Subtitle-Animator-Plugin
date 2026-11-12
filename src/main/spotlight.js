// Spotlight (Use tab > Effect Preset > Spotlight, MCP `spotlight`): a big word BEHIND the speaker, the room dimmed.
//   1. spotSource: the bridge finds the footage at the playhead and the moment (given range, else the timeline's In /
//      Out marks, else the subtitle under the playhead, else 3 s) - bridge spot_source.
//   2. spotRun: the footage frames of the moment are exported at timeline size (bridge track_frames, full), the person
//      is matted by Robust Video Matting (src/python/subject_matte.py, ONNX in the tracker venv) into RGBA PNG
//      cut-outs, the word is measured from its font file (same script, `measure`) and laid out (layout() below), and
//      the bridge imports the cut-outs as ONE clip over the footage with ELSA Spotlight on it (spot_place / spot_apply).
//   3. spotSet re-keys a spotlight from new settings (word, font, colours, position, animation) without matting again.
// The cut-outs live in userData/spotlight/<id>/ (the Media Pool clip points there); spotRemove deletes both.

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const { bridgeCall } = require('./fusion-bridge');
const { BRIDGE_SCRIPT } = require('./config');

const MATTE_SCRIPT = path.join(path.dirname(BRIDGE_SCRIPT), 'subject_matte.py');
const MODEL_URL = 'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx';
const MODEL_FILE = 'rvm_mobilenetv3_fp32.onnx';
const MODEL_BYTES = 14975696;
const PACKAGES = ['onnxruntime', 'pillow'];
const CHUNK = 10;            // frames per track_frames request (full size: ~30 ms each in Resolve)

const ANIMS = [
    { id: 'zoom', name: 'Zoom Out', tip: 'Starts 30% bigger and settles while it fades in' },
    { id: 'rise', name: 'Rise', tip: 'Rises up from behind the head' },
    { id: 'fade', name: 'Fade', tip: 'Fades in' },
    { id: 'pop', name: 'Pop', tip: 'Pops in with a small overshoot' },
    { id: 'blur', name: 'Blur In', tip: 'Comes into focus' },
    { id: 'flicker', name: 'Neon Flicker', tip: 'Flickers on like a neon sign' },
    { id: 'spread', name: 'Spread', tip: 'Letters close in from wide spacing' },
    { id: 'none', name: 'None', tip: 'Just there' }
];
// What a new spotlight gets. size 0 = fit `width` % of the frame; y null = from the head (overlap % of the capitals
// hidden behind it); x 0.5 = centred (captions stay horizontally centred).
const DEFAULTS = {
    wordOn: true, word: '', caps: true, font: 'DM Serif Display', style: 'Italic',
    color: [1, 1, 1], glowColor: [1, 0.3, 0.75], glow: 70, dim: 55, vig: 50,
    anim: 'zoom', inF: 12, outF: 8, size: 0, width: 86, x: 0.5, y: null, overlap: 45
};

function userDir() { return require('electron').app.getPath('userData'); }
function venvPython() { return path.join(userDir(), 'tracker-venv', 'bin', 'python3'); }
function modelPath() { return path.join(userDir(), 'models', MODEL_FILE); }
function spotRoot() { return path.join(userDir(), 'spotlight'); }

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

// ------------------------------------------------------------------ engine (once, with the user's go-ahead)
let engineOk = null;
async function engineReady() {
    if (engineOk) return true;
    if (!fs.existsSync(venvPython())) return false;
    try { if (fs.statSync(modelPath()).size !== MODEL_BYTES) return false; } catch (e) { return false; }
    const r = await run(venvPython(), ['-I', '-c', 'import onnxruntime, PIL, cv2, numpy; print(1)']);
    engineOk = r.code === 0 && r.out.trim() === '1';
    return engineOk;
}
async function spotEngine() { return { ready: await engineReady(), sizeMB: 60 }; }

function download(url, file, onPct, hops) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'el-subtitle-animator' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hops || 0) < 6) {
                res.resume();
                download(res.headers.location, file, onPct, (hops || 0) + 1).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
            const total = Number(res.headers['content-length']) || MODEL_BYTES;
            let got = 0;
            const tmp = file + '.part';
            const out = fs.createWriteStream(tmp);
            res.on('data', (d) => { got += d.length; if (onPct) onPct(Math.round(got / total * 100)); });
            res.pipe(out);
            out.on('finish', () => out.close(() => { try { fs.renameSync(tmp, file); resolve(); } catch (e) { reject(e); } }));
            out.on('error', reject);
        }).on('error', reject);
    });
}

// Installs the matting engine: the tracker venv (OpenCV, from Track Subject) + onnxruntime + Pillow, and the
// Robust Video Matting model (15 MB). Progress: spot:progress { phase: 'install', text }.
async function spotInstall(event) {
    if (await engineReady()) return { ready: true };
    const send = (text) => { try { event.sender.send('spot:progress', { phase: 'install', text }); } catch (e) { /* panel gone */ } };
    if (!fs.existsSync(venvPython())) {
        const t = await require('./subject-track').trackInstall(event);
        if (!t || !t.ready) return { error: (t && t.error) || 'Could not install the engine' };
    }
    send('Installing the matting engine (onnxruntime, Pillow)…');
    const r = await run(venvPython(), ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', ...PACKAGES], {},
        (line) => { const m = /^(Collecting|Downloading|Installing|Successfully)\b.*/.exec(line.trim()); if (m) send(m[0].slice(0, 90)); });
    if (r.code !== 0) return { error: 'Could not install onnxruntime: ' + (r.err || r.out).trim().slice(-300) };
    try {
        fs.mkdirSync(path.dirname(modelPath()), { recursive: true });
        let last = -1;
        await download(MODEL_URL, modelPath(), (p) => { if (p !== last && p % 10 === 0) { last = p; send('Downloading the matting model… ' + p + '%'); } });
    } catch (e) { return { error: 'Could not download the matting model: ' + e.message }; }
    engineOk = null;
    if (!(await engineReady())) return { error: 'The matting engine did not start' };
    send('Matting engine ready.');
    return { ready: true };
}

// ------------------------------------------------------------------ word + layout
const STOP = new Set('about after again also always another because been before being both cause could doing does down during each every from going have having here into just like many more most much must need only other over really same should since some still such than that their them then there these they thing things think this those though through want what when where which while will with would your yours yeah okay gonna wanna'.split(' '));
// The word to put behind the speaker when none is given: the subtitle's strongest word - a name / proper noun first,
// else a number, else the longest word that is not filler.
function pickWord(text) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    let best = null, bestScore = -1;
    words.forEach((raw, i) => {
        const w = raw.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, '');
        if (!w || w.length < 3) return;
        const low = w.toLowerCase();
        if (STOP.has(low)) return;
        let s = Math.min(w.length, 10);
        if (i > 0 && /^\p{Lu}/u.test(w)) s += 4;          // a name mid-sentence
        if (/\d/.test(w)) s += 3;
        if (s > bestScore) { bestScore = s; best = w; }
    });
    return best || (words[0] || '').replace(/[^\p{L}\p{N}$%]+/gu, '');
}

async function measure(font, style, text) {
    if (!fs.existsSync(venvPython())) return null;
    const r = await run(venvPython(), ['-I', MATTE_SCRIPT, 'measure'], { input: JSON.stringify({ font, style, text: text || 'H' }) + '\n' });
    try { return JSON.parse(r.out.trim().split('\n').pop()); } catch (e) { return null; }
}

// Settings + matte statistics + font metrics -> what the effect gets: size (Text+ Size) and cx / cy (0..1, top-left).
// metrics: per unit of (Size x frame height): width of the word, cap height, gap above the caps (top).
function layout(s, stats, metrics, W, H) {
    const m = metrics || { width: 0.19 * Math.max(1, String(s.word || 'H').length), cap: 0.21, top: 0 };
    const out = Object.assign({}, s);
    const fit = (Number(s.width) || 86) / 100 * W / Math.max(1e-6, m.width * H);
    out.size = Number(s.size) > 0 ? Number(s.size) : Math.max(0.05, Math.min(0.6, fit));
    const capPx = m.cap * out.size * H;
    let cy;
    if (s.y !== null && s.y !== undefined && Number.isFinite(Number(s.y))) cy = Number(s.y);
    else {
        const head = stats && Number.isFinite(Number(stats.headTop)) ? Number(stats.headTop) * H : 0.2 * H;
        const baseline = head + (Number.isFinite(Number(s.overlap)) ? Number(s.overlap) : 45) / 100 * capPx;
        const top = 0.05 * H + capPx / 2;           // the capitals stay inside the frame (5% margin)
        cy = Math.max(top, baseline - capPx / 2) / H;
    }
    out.cx = Number.isFinite(Number(s.x)) ? Number(s.x) : 0.5;
    out.cy = Math.max(0, Math.min(1, cy));
    return out;
}

function clean(s) {
    const o = {};
    const src = s && typeof s === 'object' ? s : {};
    for (const k of Object.keys(DEFAULTS)) {
        if (!(k in src)) continue;
        const v = src[k], d = DEFAULTS[k];
        if (k === 'y') o.y = v === null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
        else if (Array.isArray(d)) { if (Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(Number(x)))) o[k] = v.map(Number); }
        else if (typeof d === 'number') { if (Number.isFinite(Number(v))) o[k] = Number(v); }
        else if (typeof d === 'boolean') o[k] = !!v;
        else if (k === 'anim') { if (ANIMS.some(a => a.id === v)) o.anim = v; }
        else o[k] = String(v).slice(0, 60);
    }
    return o;
}

// The settings sent to the effect: word ('' when switched off), measured size and position.
async function resolveSettings(s, stats, W, H) {
    const word = s.wordOn === false ? '' : String(s.word || '');
    const shown = s.caps === false ? word : word.toUpperCase();
    const metrics = shown ? await measure(s.font, s.style, shown) : null;
    const out = layout(Object.assign({}, s, { word }), stats, metrics, W, H);
    out.word = word;
    if (metrics && !metrics.found) out.fontWarning = 'Font "' + s.font + ' ' + s.style + '" was not found to measure; the size is estimated';
    return out;
}

// ------------------------------------------------------------------ panel / MCP actions
let job = null;

async function spotSource(event, opts) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    const o = opts && typeof opts === 'object' ? opts : { frame: opts };
    const r = await bridgeCall('spot_source', { frame: Number.isFinite(Number(o.frame)) ? Math.round(Number(o.frame)) : null, from: o.from, to: o.to, maxDim: 540 }, 15000, { lane: 0 });
    if (r && !r.error) r.word = pickWord(r.subtitle);
    return r;
}

// opts: { frame?, from?, to?, settings? } -> { item, track, moved, notes, settings }
async function spotRun(event, opts) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    if (job) return { error: 'A spotlight is already being made.' };
    if (!(await engineReady())) return { needInstall: true };
    const o = opts || {};
    const send = (p) => { try { if (event && event.sender) event.sender.send('spot:progress', p); } catch (e) { /* panel gone */ } };
    const src = await spotSource(event, { frame: o.frame, from: o.from, to: o.to });
    if (!src || src.error || src.busy) return src || { error: 'No footage found' };
    const s = Object.assign({}, DEFAULTS, clean(o.settings));
    if (!s.word && s.wordOn !== false) s.word = src.word || '';
    const [lo, hi] = src.range;
    const id = Date.now().toString(36);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elsa-spot-'));
    const dir = path.join(spotRoot(), id);
    fs.mkdirSync(dir, { recursive: true });
    const cancelPath = path.join(tmp, 'cancel');
    job = { cancelPath, proc: null, cancelled: false };
    const total = hi - lo + 1;
    let keep = false;
    try {
        for (let f = lo; f <= hi; f += CHUNK) {
            if (job.cancelled) return { cancelled: true };
            send({ phase: 'frames', done: f - lo, total });
            await bridgeCall('track_frames', { subject: src.footage.id, from: f, to: Math.min(hi, f + CHUNK - 1), outDir: tmp, full: true, cancelPath }, 60000);
        }
        send({ phase: 'frames', done: total, total });
        const frames = []; for (let f = lo; f <= hi; f++) frames.push(f);
        let stats = null, error = null;
        const r = await run(venvPython(), ['-I', MATTE_SCRIPT], { input: JSON.stringify({ dir: tmp, frames, model: modelPath(), out: dir }) + '\n', track: (p) => { job.proc = p; } }, (line) => {
            let m; try { m = JSON.parse(line); } catch (e) { return; }
            if (m.progress) send({ phase: 'matte', done: m.progress, total: m.total });
            else if (m.done) stats = m.stats;
            else if (m.error) error = m.error;
        });
        if (job.cancelled) return { cancelled: true };
        if (!stats) return { error: 'Matting failed: ' + (error || r.err.trim().slice(-300) || 'no result') };
        send({ phase: 'place' });
        const fin = await resolveSettings(s, stats, src.width, src.height);
        const small = { headTop: stats.headTop, cx: stats.cx, box: stats.box, width: stats.width, height: stats.height };
        const placed = await bridgeCall('spot_place', { footage: src.footage.id, from: lo, to: hi, seq: path.join(dir, 'c%05d.png'), count: total, dir, label: fin.word, settings: fin, stats: small }, 60000, { lane: 0 });
        keep = true;
        if (placed && placed.needRestart) placed.error = 'The cut-out is on V' + placed.track + ', but Resolve has not loaded the new Spotlight effect yet: restart DaVinci Resolve once, select the cut-out clip and press Update on the Spotlight card.';
        return Object.assign({}, placed, { settings: fin, range: [lo, hi], why: src.why, footage: src.footage, ms: stats.ms });
    } finally {
        job = null;
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp */ }
        if (!keep) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
    }
}

function spotCancel() {
    if (!job) return { ok: true };
    job.cancelled = true;
    try { fs.writeFileSync(job.cancelPath, '1'); } catch (e) { /* ignore */ }
    try { if (job.proc) job.proc.kill(); } catch (e) { /* ignore */ }
    return { ok: true };
}

async function spotGet(event, itemId) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    return await bridgeCall('spot_get', itemId ? { item: String(itemId) } : {}, 8000);
}

// New settings for a placed spotlight (merged into its stored ones): re-measured and re-laid-out, then re-keyed.
// `addEffect`: the clip was made before Resolve knew the effect (needRestart) - add it now.
async function spotSet(event, itemId, settings, addEffect) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    const cur = await bridgeCall('spot_get', { item: String(itemId) }, 8000);
    const had = (cur && cur.settings) || {};
    const s = Object.assign({}, DEFAULTS, clean(had), clean(settings));
    // the word moved by hand (y given) keeps its place; a new word / size re-fits
    const stats = had.stats || null;
    const W = (stats && stats.width) || 1080, H = (stats && stats.height) || 1920;
    const fin = await resolveSettings(s, stats, W, H);
    return await bridgeCall('spot_set', { item: String(itemId), settings: fin, addEffect: !!addEffect }, 20000, { lane: 0 });
}

async function spotRemove(event, itemId) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    const r = await bridgeCall('spot_remove', { item: String(itemId) }, 20000, { lane: 0 });
    const dir = r && r.dir ? path.resolve(String(r.dir)) : null;
    // only ever our own folders
    if (dir && dir.startsWith(path.resolve(spotRoot()) + path.sep)) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* in use */ } }
    return r;
}

function spotInfo() { return { anims: ANIMS, defaults: DEFAULTS }; }

module.exports = { spotEngine, spotInstall, spotSource, spotRun, spotCancel, spotGet, spotSet, spotRemove, spotInfo, pickWord, layout, DEFAULTS, ANIMS };
