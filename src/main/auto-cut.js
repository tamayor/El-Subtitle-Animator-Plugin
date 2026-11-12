// Cut tab (and the MCP tool auto_cut): a rough cut of a talking-head timeline, built by Resolve itself.
//   1. cutAnalyze: every clip on the source video track is listened to (src/python/auto_cut.py: pauses shortened,
//      head and tail trimmed, retakes / stutters / fillers found in the words of Resolve's own transcription or of the
//      subtitle track, loudness measured). Nothing on the timeline changes; the panel shows what would be cut.
//   2. cutBuild: a NEW timeline "<source> (cut)" is made from the kept pieces (one batched AppendToTimeline, video and
//      its own audio linked), with the source clips' transforms copied, the voice levelled to the target loudness and
//      a marker at every retake / stutter / filler that was taken out. The source timeline is never edited.
// The panel also gets each clip's waveform, speech and gaps (summary(pl, true)): it draws the cuts on the waveform and
// works the pause rules out itself (src/renderer/js/library/cut-plan.js), so settings and clicks show at once. Build then
// takes the panel's pieces (opts.live). cutListen decodes short ranges for the panel's "listen to this join".
// Pause rules adapted from ghost-editor (MIT, kurbaitaev): see the header of src/python/auto_cut.py.

module.exports = { cutDefaults, cutSetPrefs, cutAnalyze, cutBuild, cutStatus, cutCancel, cutEngine, cutInstall, cutWordsFromTc, cutListen, cutBuildWithout };

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const state = require('./state');
const { APP_DATA_DIR, BRIDGE_SCRIPT } = require('./config');
const { dlog } = require('./log');
const { getProject, getSubtitles, timelineMeta } = require('./resolve');
const { bridgeCall } = require('./fusion-bridge');

const SCRIPT = path.join(path.dirname(BRIDGE_SCRIPT), 'auto_cut.py');
const PREFS_FILE = path.join(APP_DATA_DIR, 'cut.json');
const CACHE_DIR = path.join(APP_DATA_DIR, 'cut-cache');
const FFMPEGS = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
const BATCH = 150;            // clip infos per AppendToTimeline call

// Pause styles: Tight is ghost-editor's reel setting; Natural and Gentle leave interviews room to breathe.
const STYLES = {
    tight: { maxPause: 0.26, pauseKeep: 0.18, sentenceKeep: 0.25, headLead: 0.10, tailKeep: 0.18 },
    natural: { maxPause: 0.50, pauseKeep: 0.30, sentenceKeep: 0.45, headLead: 0.15, tailKeep: 0.30 },
    gentle: { maxPause: 1.00, pauseKeep: 0.50, sentenceKeep: 0.70, headLead: 0.25, tailKeep: 0.45 }
};
const DEFAULTS = {
    track: 1, style: 'natural', ...STYLES.natural,
    retakes: true, stutters: true, fillers: false, retakeSim: 0.72, outtakes: true, retakeSpan: 45,
    wordless: true,                   // drop sounds Resolve's transcription heard no words in (murmurs, off-mic talk)
    pauseDb: 20, voiceDb: 18,         // silence = under room tone + pauseDb; speech = within voiceDb of the voice (auto_cut.py)
    script: '',                       // pasted script: keep the last complete take of each line, drop the rest
    textSource: 'transcription',      // 'transcription' (Resolve's own), 'subtitles' (the timeline's subtitle track), 'none'
    transcribe: true,                 // transcribe clips that have no transcription yet
    level: true, lufs: -16,           // voice to -16 LUFS (ghost-editor's working level; deliver at -14)
    copyTransform: true, markers: false, markPauses: 0, subtitles: false, open: true, name: ''      // no markers unless asked for
};
const NUM_KEYS = ['maxPause', 'pauseKeep', 'sentenceKeep', 'headLead', 'tailKeep', 'retakeSim', 'retakeSpan', 'lufs', 'markPauses', 'track', 'pauseDb', 'voiceDb'];
// Edit-page transform / crop values copied from a source clip to its pieces when they are not the defaults.
const TRANSFORM_DEFAULTS = {
    Pan: 0, Tilt: 0, ZoomX: 1, ZoomY: 1, RotationAngle: 0, AnchorPointX: 0, AnchorPointY: 0, Pitch: 0, Yaw: 0,
    FlipX: false, FlipY: false, CropLeft: 0, CropRight: 0, CropTop: 0, CropBottom: 0, CropSoftness: 0, Opacity: 100
};
const MARK = { retake: 'Red', outtake: 'Pink', stutter: 'Yellow', filler: 'Purple', pause: 'Blue' };

let job = null;               // { running, proc, cancelled, progress }
let plan = null;              // the last analysis: { tlName, track, meta, sources, result, prefs, at }
let pyFound = null;

// ------------------------------------------------------------------ prefs, engine

function readPrefs() { try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) }; } catch (e) { return { ...DEFAULTS }; } }
function cleanPrefs(o) {
    const p = readPrefs();
    for (const k of Object.keys(DEFAULTS)) if (o && o[k] !== undefined && o[k] !== null) p[k] = o[k];
    if (STYLES[p.style]) Object.assign(p, STYLES[p.style]);       // 'custom' keeps the numbers as given
    else p.style = 'custom';
    for (const k of NUM_KEYS) if (p[k] !== undefined) p[k] = Number(p[k]);
    p.track = Math.max(1, Math.round(p.track) || 1);
    if (!['transcription', 'subtitles', 'none'].includes(p.textSource)) p.textSource = DEFAULTS.textSource;
    return p;
}
function pick(o, keys) { const r = {}; for (const k of keys) r[k] = o[k]; return r; }
function cutSetPrefs(event, o) {
    const p = cleanPrefs(o);
    try { fs.mkdirSync(APP_DATA_DIR, { recursive: true }); fs.writeFileSync(PREFS_FILE, JSON.stringify(p, null, 2)); } catch (e) { /* kept for this run */ }
    return p;
}
function send(msg) {
    if (job) job.progress = msg;
    try { if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.webContents.send('cut:progress', msg); } catch (e) { /* panel gone */ }
}
function userDir() { return require('electron').app.getPath('userData'); }
function venvPython(name) { return path.join(userDir(), name, 'bin', 'python3'); }
function hasNumpy(py) { return new Promise(res => execFile(py, ['-I', '-c', 'import numpy'], { timeout: 20000 }, err => res(!err))); }
function ffmpegPath() { return FFMPEGS.find(p => fs.existsSync(p)) || null; }

// A Python with numpy: the app's cut engine, the Track Subject engine (it has numpy too), then common installs.
async function numpyPython() {
    if (pyFound && fs.existsSync(pyFound)) return pyFound;
    const home = require('os').homedir();
    const list = [venvPython('cut-venv'), venvPython('tracker-venv'), '/opt/anaconda3/bin/python3', path.join(home, 'anaconda3/bin/python3'),
        path.join(home, 'miniconda3/bin/python3'), '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'];
    for (const p of list) if (fs.existsSync(p) && await hasNumpy(p)) return (pyFound = p);
    return null;
}
function systemPython() { return ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'].find(p => fs.existsSync(p)) || null; }

async function cutEngine() {
    return { python: !!(await numpyPython()), ffmpeg: !!ffmpegPath(), canInstall: !!systemPython() };
}

// Installs numpy in the app's own venv (about 40 MB), once, when the user agrees.
async function cutInstall() {
    if (await numpyPython()) return { ready: true };
    const py = systemPython();
    if (!py) throw new Error('Cut needs Python 3 (python.org or Homebrew).');
    const dir = path.join(userDir(), 'cut-venv');
    send({ phase: 'install', text: 'Creating the cut engine…' });
    let r = await run(py, ['-m', 'venv', dir]);
    if (r.code !== 0) throw new Error('Could not create the cut engine: ' + r.err.trim().slice(-200));
    send({ phase: 'install', text: 'Installing numpy…' });
    r = await run(venvPython('cut-venv'), ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', 'numpy']);
    pyFound = null;
    if (r.code !== 0 || !(await numpyPython())) throw new Error('Could not install numpy: ' + r.err.trim().slice(-200));
    send({ phase: 'install', text: 'Cut engine ready.' });
    return { ready: true };
}

function run(cmd, args, opts, input, onLine) {
    return new Promise((resolve) => {
        let out = '', err = '', buf = '';
        let p;
        try { p = spawn(cmd, args, opts || {}); } catch (e) { resolve({ code: -1, out, err: String(e.message || e) }); return; }
        if (job) job.proc = p;
        p.stdout.on('data', d => {
            const s = d.toString(); out += s;
            if (onLine) { buf += s; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { onLine(l); } catch (e) { /* ignore */ } } }
        });
        p.stderr.on('data', d => { err = (err + d.toString()).slice(-4000); });
        p.on('error', e => resolve({ code: -1, out, err: err + String(e.message || e) }));
        p.on('close', code => { if (job && job.proc === p) job.proc = null; resolve({ code, out, err }); });
        if (input !== undefined) { p.stdin.write(input); p.stdin.end(); }
    });
}

function cutDefaults() {
    return { prefs: readPrefs(), defaults: DEFAULTS, styles: STYLES, status: cutStatus(), plan: plan ? summary(plan, true) : null };
}
function cutStatus() { return job ? { running: !!job.running, progress: job.progress } : { running: false }; }
function cutCancel() {
    if (!job || !job.running) return false;
    job.cancelled = true;
    if (job.proc) { try { job.proc.kill(); } catch (e) { /* gone */ } }
    return true;
}

// ------------------------------------------------------------------ timecode, words

function tcFrames(tc, nominal) {
    const m = /^(\d+)[:;](\d+)[:;](\d+)[:;.](\d+)$/.exec(String(tc || '').trim());
    if (!m) return null;
    return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * nominal + +m[4];
}

// Resolve transcription words ([start TC, end TC, text], in the clip's own timecode) -> media seconds.
function cutWordsFromTc(words, startTc, fps) {
    const nominal = Math.round(fps) || 25;
    const t0 = tcFrames(startTc, nominal) || 0;
    const first = words.length ? tcFrames(words[0][0], nominal) : null;
    const base = first !== null && first < t0 ? 0 : t0;      // some media carry no start timecode
    const out = [];
    for (const [s, e, w] of words) {
        const a = tcFrames(s, nominal), b = tcFrames(e, nominal);
        if (a === null || !w || w === '(...)') continue;
        out.push({ a: (a - base) / fps, b: ((b === null ? a + 1 : b) - base) / fps, w: String(w) });
    }
    return out;
}

// Subtitle clips over a source clip -> words with times spread evenly over each subtitle (phrase-level retakes only).
function wordsFromSubtitles(subs, src, tlFps) {
    const out = [];
    for (const s of subs) {
        if (s.end <= src.start || s.start >= src.start + src.duration) continue;
        const ws = String(s.text || '').split(/\s+/).filter(Boolean);
        if (!ws.length) continue;
        const a = src.mediaStart / src.fps + (s.start - src.start) / tlFps;
        const b = src.mediaStart / src.fps + (s.end - src.start) / tlFps;
        const step = (b - a) / ws.length;
        ws.forEach((w, i) => out.push({ a: a + i * step, b: a + (i + 1) * step - 0.01, w }));
    }
    return out;
}

// ------------------------------------------------------------------ analyse

async function sourceTimeline(name) {
    const project = await getProject();
    if (!project) throw new Error('Open a project in Resolve');
    let tl = await project.GetCurrentTimeline();
    if (name && tl && (await tl.GetName()) !== name) {
        tl = null;
        const n = await project.GetTimelineCount();
        for (let i = 1; i <= n; i++) {
            const t = await project.GetTimelineByIndex(i);
            if (t && (await t.GetName()) === name) { tl = t; break; }
        }
        if (!tl) throw new Error('The timeline "' + name + '" is gone. Analyse again.');
    }
    if (!tl) throw new Error('Open a timeline');
    return { project, tl };
}

async function readSources(tl, track, meta) {
    const items = (await tl.GetItemListInTrack('video', track)) || [];
    const out = [], warn = [];
    for (const it of items) {
        const mpi = await it.GetMediaPoolItem();
        if (!mpi) continue;                                   // titles, generators, compound clips without media
        const [id, start, duration, s0, s1, props, mid] = await Promise.all([it.GetUniqueId(), it.GetStart(), it.GetDuration(),
            it.GetSourceStartFrame(), it.GetSourceEndFrame(), mpi.GetClipProperty(), mpi.GetUniqueId()]);
        const p = props || {};
        const file = p['File Path'];
        const fps = parseFloat(p.FPS) || meta.fps;
        // GetSourceEndFrame is the last frame on some items and the one after it on others (Timeline 30: 0..2927 for
        // 2928 frames; its cut: 36..165 for 129): take the reading that matches the clip's length.
        const want = duration * fps / meta.fps;
        const end = Math.abs((s1 - s0) - want) < Math.abs((s1 + 1 - s0) - want) ? s1 : s1 + 1;
        const name = await it.GetName();
        const hasAudio = /audio/i.test(String(p.Type || '')) || Number(p['Audio Ch']) > 0;
        const src = { id: String(id), mediaId: String(mid), name, file, fps, start, duration, mediaStart: s0, mediaEnd: end,
            startTc: p['Start TC'], analyse: !!(file && fs.existsSync(file) && hasAudio) };
        const playS = duration / meta.fps, mediaS = (src.mediaEnd - s0) / fps;
        if (Math.abs(playS - mediaS) > Math.max(0.1, mediaS * 0.02)) warn.push(name + ': a speed change is not kept (pieces play at 100 %)');
        if (!src.analyse) warn.push(name + ': ' + (!file ? 'no media file' : !fs.existsSync(file) ? 'media offline' : 'no audio') + ', kept whole');
        out.push(src);
    }
    return { sources: out, warn };
}

async function readWords(prefs, tl, sources, meta) {
    if (prefs.textSource === 'none' || !(prefs.retakes || prefs.stutters || prefs.fillers || prefs.outtakes || String(prefs.script || '').trim())) return { words: {}, note: null };
    const words = {};
    if (prefs.textSource === 'subtitles') {
        const subs = await getSubtitles(tl, true);
        for (const s of sources) words[s.id] = wordsFromSubtitles(subs, s, meta.fps);
        return { words, note: subs.length ? null : 'No subtitles on the timeline: retakes were not looked for' };
    }
    const ids = [...new Set(sources.filter(s => s.analyse).map(s => s.mediaId))];
    let r = await bridgeCall('cut_words', { track: prefs.track, mediaIds: ids }, 60000, { lane: 1 });
    let missing = ids.filter(id => !(r && r.media && r.media[id]));
    if (missing.length && prefs.transcribe) {
        send({ phase: 'transcribe', text: 'Resolve is transcribing ' + missing.length + ' clip' + (missing.length > 1 ? 's' : '') + '…' });
        await bridgeCall('cut_transcribe', { track: prefs.track, mediaIds: missing }, 30 * 60000, { lane: 2 });
        if (job && job.cancelled) throw new Error('Cancelled');
        r = await bridgeCall('cut_words', { track: prefs.track, mediaIds: ids }, 60000, { lane: 1 });
        missing = ids.filter(id => !(r && r.media && r.media[id]));
    }
    for (const s of sources) {
        const m = r && r.media && r.media[s.mediaId];
        if (m) words[s.id] = cutWordsFromTc(m.words || [], s.startTc, s.fps);
    }
    const note = missing.length ? missing.length + ' clip(s) have no transcription: no retakes looked for there' + (prefs.transcribe ? '' : ' (turn on "Transcribe")') : null;
    return { words, note };
}

async function cutAnalyze(event, opts) {
    if (job && job.running) throw new Error('Cut is already working');
    const prefs = cutSetPrefs(null, opts);
    job = { running: true, cancelled: false, progress: { phase: 'start', text: 'Reading the timeline…' } };
    try {
        const py = await numpyPython();
        if (!py) throw new Error('NEEDS_ENGINE');
        const ffmpeg = ffmpegPath();
        if (!ffmpeg) throw new Error('Cut needs ffmpeg. In Terminal: brew install ffmpeg');
        const reuse = opts && opts.reuse && plan;
        const { tl } = await sourceTimeline(reuse ? plan.tlName : null);
        const tlName = await tl.GetName();
        const meta = await timelineMeta(tl);
        send({ phase: 'start', text: 'Reading ' + tlName + ' V' + prefs.track + '…' });
        const { sources, warn } = reuse && plan.track === prefs.track ? { sources: plan.sources, warn: plan.warnSources } : await readSources(tl, prefs.track, meta);
        if (!sources.length) throw new Error('No clips with media on V' + prefs.track + ' of ' + tlName);
        const sameText = reuse && plan.textSource === prefs.textSource && plan.words;
        const { words, note } = sameText ? { words: plan.words, note: plan.wordsNote } : await readWords(prefs, tl, sources, meta);
        if (job.cancelled) throw new Error('Cancelled');

        const req = {
            ffmpeg, cacheDir: CACHE_DIR, params: { ...pick(prefs, ['maxPause', 'pauseKeep', 'sentenceKeep', 'headLead', 'tailKeep', 'retakes', 'stutters', 'fillers', 'retakeSim', 'outtakes', 'retakeSpan', 'script', 'pauseDb', 'voiceDb']), loudness: !!prefs.level,
                wordless: !!prefs.wordless && prefs.textSource === 'transcription' },
            sources: sources.filter(s => s.analyse).map(s => ({ id: s.id, path: s.file, a: s.mediaStart / s.fps, b: s.mediaEnd / s.fps, fps: s.fps })),
            words, ignore: (opts && Array.isArray(opts.ignore)) ? opts.ignore : (reuse ? plan.ignore || [] : []),
            wave: !!event                       // the panel's waveform (not for the MCP tool)
        };
        let result = null;
        const r = await run(py, ['-I', SCRIPT], {}, JSON.stringify(req), (line) => {
            if (line.startsWith('PROGRESS ')) { try { send(JSON.parse(line.slice(9))); } catch (e) { /* partial */ } }
            else if (line.startsWith('RESULT ')) { try { result = JSON.parse(line.slice(7)); } catch (e) { /* bad line */ } }
        });
        if (job.cancelled) throw new Error('Cancelled');
        if (!result || result.error) throw new Error((result && result.error) || (r.err.trim().split('\n').pop() || 'the analysis stopped'));
        plan = { tlName, track: prefs.track, meta, sources, warnSources: warn, words, wordsNote: note, textSource: prefs.textSource,
            result, prefs, ignore: req.ignore, at: Date.now() };
        const sum = summary(plan, !!event);
        send({ phase: 'done', text: sum.headline });
        dlog('CUT-ANALYSE', tlName, sum.headline);
        return sum;
    } catch (e) {
        const msg = String(e && e.message || e);
        send({ phase: 'error', text: msg === 'NEEDS_ENGINE' ? 'Cut needs its engine (numpy)' : msg });
        if (msg === 'NEEDS_ENGINE') return { needsEngine: true, ...(await cutEngine()) };
        throw e;
    } finally { job.running = false; job.proc = null; }
}

function fmt(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

// What the panel shows: totals, a strip per clip and the list of retakes / stutters / fillers (each can be kept).
function summary(pl, detail) {
    const byId = new Map((pl.result.sources || []).map(r => [r.id, r]));
    let before = 0, after = 0;
    const counts = { pause: 0, head: 0, tail: 0 }, warn = [...(pl.warnSources || [])];
    if (pl.wordsNote) warn.push(pl.wordsNote);
    for (const w of pl.result.warn || []) warn.push(w);
    const clips = pl.sources.map(s => {
        const r = byId.get(s.id);
        const len = (s.mediaEnd - s.mediaStart) / s.fps;
        before += len;
        if (!r) { after += len; return { name: s.name, before: len, after: len, keeps: [[0, 1]], whole: true }; }
        if (r.error) warn.push(s.name + ': ' + r.error + ' (kept whole)');
        for (const w of r.warn || []) warn.push(s.name + ': ' + w);
        for (const c of r.cuts || []) counts[c.kind] = (counts[c.kind] || 0) + 1;
        const total = Math.max(1, s.mediaEnd - s.mediaStart);
        const k = r.error ? [[0, total]] : r.keeps;
        const a = k.reduce((t, [x, y]) => t + y - x, 0) / s.fps;
        after += a;
        const clip = { name: s.name, before: len, after: a, lufs: r.lufs, keeps: k.map(([x, y]) => [x / total, y / total]) };
        if (detail && r.wave && !r.error) {      // what the panel's waveform and its own pause rules need (clip seconds)
            const t0 = s.mediaStart / s.fps;
            Object.assign(clip, { id: s.id, t0, fps: s.fps, dur: r.dur, speech: r.speech || [], gapf: r.gapf || [], wave: r.wave, waveDt: r.wave_dt,
                words: ((pl.words || {})[s.id] || []).filter(w => w.b > t0 && w.a < t0 + r.dur).map(w => [Math.round((w.a - t0) * 1000) / 1000, Math.round((w.b - t0) * 1000) / 1000, w.w]) });
        }
        return clip;
    });
    const drops = (pl.result.drops || []).map(d => {
        const s = pl.sources.find(x => x.id === d.src) || {};
        const t0 = s.fps ? s.mediaStart / s.fps : 0;
        return { id: d.id, kind: d.kind, text: d.text, of: d.of, ignored: !!d.ignored, secs: Math.max(0, d.b - d.a), clip: s.name, at: d.a,
            src: d.src, a: d.a - t0, b: d.b - t0 };          // a / b: seconds from the clip's start
    });
    const active = drops.filter(d => !d.ignored);
    const n = k => active.filter(d => d.kind === k).length;
    const parts = [counts.pause + ' pauses shortened'];
    if (counts.noword) parts.push(counts.noword + ' sounds without words');
    if (n('retake')) parts.push(n('retake') + ' retakes');
    if (n('outtake')) parts.push(n('outtake') + ' outtakes');
    if (n('stutter')) parts.push(n('stutter') + ' stutters');
    if (n('filler')) parts.push(n('filler') + ' fillers');
    return {
        timeline: pl.tlName, track: pl.track, before, after, saved: before - after, counts, clips, drops, warn,
        headline: fmt(before) + ' → ' + fmt(after) + ' (−' + fmt(before - after) + '): ' + parts.join(', ')
    };
}

// ------------------------------------------------------------------ build

async function uniqueName(project, base) {
    const names = new Set();
    const n = await project.GetTimelineCount();
    for (let i = 1; i <= n; i++) { const t = await project.GetTimelineByIndex(i); if (t) names.add(await t.GetName()); }
    let name = base, k = 2;
    while (names.has(name)) name = base + ' ' + k++;
    return name;
}

// The current timeline without some ranges of it (Cut tab > Measure > "Delete marked pauses"): a NEW timeline made of
// the source track's clips minus `ranges` ([[from, to)] in timeline frames), built like a cut. The scripting API cannot
// trim or split a clip in place, so the timeline itself is left as it is. Only the source track and its own sound are
// carried over; `others` in the answer counts what was on other tracks.
async function cutBuildWithout(ranges, o) {
    if (job && job.running) throw new Error('Cut is already working');
    const opts = o || {};
    const { tl } = await sourceTimeline(null);
    const tlName = await tl.GetName();
    const meta = await timelineMeta(tl);
    const track = Math.max(1, Number(opts.track) || 1);
    const { sources, warn } = await readSources(tl, track, meta);
    if (!sources.length) throw new Error('No clips with media on V' + track + ' of ' + tlName);
    const rs = (ranges || []).map(r => [Number(r[0]), Number(r[1])]).filter(r => r[1] > r[0]).sort((a, b) => a[0] - b[0]);
    let cutFrames = 0;
    const result = { sources: [], drops: [] };
    for (const s of sources) {
        const total = s.mediaEnd - s.mediaStart, k = total / Math.max(1, s.duration);      // media frames per timeline frame
        let keeps = [[0, total]];
        for (const [a, b] of rs) {
            const x = Math.round((Math.max(a, s.start) - s.start) * k), y = Math.round((Math.min(b, s.start + s.duration) - s.start) * k);
            if (y <= x) continue;
            cutFrames += Math.min(b, s.start + s.duration) - Math.max(a, s.start);
            keeps = keeps.flatMap(([p, q]) => (y <= p || x >= q) ? [[p, q]] : [[p, x], [y, q]].filter(([m, n]) => n - m >= 2));
        }
        result.sources.push({ id: s.id, keeps, cuts: [], lufs: null, dur: total / s.fps });
    }
    let others = 0;
    for (const kind of ['video', 'audio', 'subtitle']) {
        const n = Number(await tl.GetTrackCount(kind)) || 0;
        for (let t = kind === 'subtitle' ? 1 : 2; t <= n; t++) others += ((await tl.GetItemListInTrack(kind, t)) || []).length;
    }
    const before = plan;
    plan = { tlName, track, meta, sources, warnSources: warn, words: {}, wordsNote: null, textSource: 'none', result, prefs: readPrefs(), ignore: [], at: Date.now() };
    try {
        const r = await cutBuild(null, { prefsOnce: { level: false, markers: false, markPauses: 0, subtitles: false, copyTransform: true, open: true, name: opts.name || '' } });
        return Object.assign(r, { source: tlName, cutSeconds: cutFrames / meta.fps, others });
    } finally { plan = before; }
}

// The source clip's non-default transform / crop / opacity values.
async function transformOf(it) {
    let all = null;
    try { all = await it.GetProperty(); } catch (e) { return null; }
    if (!all) return null;
    const out = {};
    for (const [k, d] of Object.entries(TRANSFORM_DEFAULTS)) {
        const v = all[k];
        if (v !== undefined && v !== null && (typeof d === 'boolean' ? !!v !== d : Math.abs(Number(v) - d) > 1e-6)) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
}

// The panel's own cut (its pause settings, the lines the user kept, clicks on the waveform) replaces the analysis'
// pieces: live = { source id: { keeps: [[frame, frame)], cuts: [{ a, dur }] (the pauses, for the pause markers) } }.
function applyLive(live, ignore) {
    const byId = new Map(plan.sources.map(s => [s.id, s]));
    for (const r of plan.result.sources || []) {
        const l = live[r.id], s = byId.get(r.id);
        if (!l || !s || r.error || !Array.isArray(l.keeps)) continue;
        const total = s.mediaEnd - s.mediaStart;
        const keeps = [];
        for (const k of l.keeps) {
            const a = Math.max(0, Math.round(Number(k[0]))), b = Math.min(total, Math.round(Number(k[1])));
            if (!(b > a) || (keeps.length && a < keeps[keeps.length - 1][1])) continue;      // in order, no overlap
            keeps.push([a, b]);
        }
        r.keeps = keeps;
        if (Array.isArray(l.cuts)) r.cuts = l.cuts.map(c => ({ kind: 'pause', a: Number(c.a) || 0, dur: Number(c.dur) || 0 }));
    }
    if (Array.isArray(ignore)) {
        const ig = new Set(ignore);
        for (const d of plan.result.drops || []) d.ignored = ig.has(d.id);
        plan.ignore = ignore;
    }
}

// A few short ranges of one analysed clip as sound for the panel (it plays the kept parts back to back, so a join can
// be heard before Build): 32 kHz mono 16-bit. ranges = [[a, b]] in seconds from the clip's start, at most 30 s in all.
const LISTEN_SR = 32000;
async function cutListen(event, opts) {
    if (!plan) throw new Error('Analyse first');
    const s = plan.sources.find(x => x.id === String(opts && opts.id));
    if (!s || !s.file || !fs.existsSync(s.file)) throw new Error('The clip\'s media is not there');
    const ffmpeg = ffmpegPath();
    if (!ffmpeg) throw new Error('Listening needs ffmpeg');
    const t0 = s.mediaStart / s.fps, dur = (s.mediaEnd - s.mediaStart) / s.fps;
    let left = 30;
    const ranges = [];
    for (const r of ((opts && opts.ranges) || []).slice(0, 16)) {
        const a = Math.max(0, Number(r[0]) || 0), b = Math.min(dur, Number(r[1]) || 0, a + left);
        if (b - a < 0.01) continue;
        ranges.push([a, b]); left -= b - a;
    }
    if (!ranges.length) throw new Error('Nothing to play there');
    const bufs = await Promise.all(ranges.map(([a, b]) => new Promise((resolve, reject) => {
        execFile(ffmpeg, ['-nostdin', '-hide_banner', '-v', 'error', '-ss', (t0 + a).toFixed(4), '-t', (b - a).toFixed(4), '-i', s.file,
            '-vn', '-sn', '-dn', '-ac', '1', '-ar', String(LISTEN_SR), '-f', 's16le', '-'],
        { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 20000 }, (err, out) => {
            if (err && !(out && out.length)) reject(new Error('Could not read the sound of ' + s.name)); else resolve(out);
        });
    })));
    return { sr: LISTEN_SR, lens: bufs.map(b => b.length >> 1), pcm: Buffer.concat(bufs) };
}

async function cutBuild(event, opts) {
    if (!plan) throw new Error('Analyse first');
    if (job && job.running) throw new Error('Cut is already working');
    const prefs = opts && opts.prefsOnce ? { ...readPrefs(), ...opts.prefsOnce } : cutSetPrefs(null, opts);     // prefsOnce: not saved
    if (opts && opts.live && typeof opts.live === 'object') applyLive(opts.live, opts.ignore);
    else if (opts && Array.isArray(opts.ignore) && JSON.stringify(opts.ignore) !== JSON.stringify(plan.ignore || [])) {
        await cutAnalyze(null, { ...prefs, ignore: opts.ignore, reuse: true });
    }
    job = { running: true, cancelled: false, progress: { phase: 'build', text: 'Building the cut…' } };
    try {
        const { project, tl: src } = await sourceTimeline(plan.tlName);
        const mp = await project.GetMediaPool();
        const meta = plan.meta;
        const srcItems = (await src.GetItemListInTrack('video', plan.track)) || [];
        const itemById = new Map();
        for (const it of srcItems) itemById.set(String(await it.GetUniqueId()), it);
        const byId = new Map((plan.result.sources || []).map(r => [r.id, r]));

        // pieces in timeline order: [source, media start frame, media end frame (exclusive)]
        const pieces = [];
        for (const s of plan.sources) {
            const r = byId.get(s.id);
            const keeps = r && !r.error ? r.keeps : [[0, s.mediaEnd - s.mediaStart]];
            for (const [a, b] of keeps) {
                const pa = s.mediaStart + Math.max(0, a), pb = s.mediaStart + Math.min(b, s.mediaEnd - s.mediaStart);
                if (pb - pa >= 2) pieces.push({ s, a: pa, b: pb });           // never a piece of one frame or outside the clip
            }
        }
        if (!pieces.length) throw new Error('Nothing to keep');
        const mpis = new Map();
        for (const s of plan.sources) {
            const it = itemById.get(s.id);
            if (!it) throw new Error(s.name + ' is no longer on V' + plan.track + ' of ' + plan.tlName + '. Analyse again.');
            mpis.set(s.id, await it.GetMediaPoolItem());
        }

        const name = await uniqueName(project, String(prefs.name || '').trim() || plan.tlName + ' (cut)');
        send({ phase: 'build', text: 'Creating ' + name + '…' });
        const startTc = await src.GetStartTimecode();
        const tl = await mp.CreateEmptyTimeline(name, startTc);
        if (!tl) throw new Error('Resolve could not create the timeline "' + name + '"');
        // same frame rate and size as the source (only possible while the timeline is empty)
        try {
            await tl.SetSetting('useCustomSettings', '1');
            for (const k of ['timelineFrameRate', 'timelineResolutionWidth', 'timelineResolutionHeight', 'timelineDropFrameTimecode']) {
                const v = await src.GetSetting(k);
                if (v !== undefined && v !== null && v !== '') await tl.SetSetting(k, String(v));
            }
        } catch (e) { /* the project's own settings are used instead */ }
        await project.SetCurrentTimeline(tl);

        const info = (p, fix) => ({ mediaPoolItem: mpis.get(p.s.id), startFrame: p.a, endFrame: p.b - 1 + fix });
        // Resolve's endFrame is inclusive in some versions and exclusive in others: append one piece, measure, adjust.
        let fix = 0;
        let first = (await mp.AppendToTimeline([info(pieces[0], 0)])) || [];
        if (!first.length) throw new Error('Resolve did not append ' + pieces[0].s.name);
        const v0 = first.find(Boolean);
        const got = (await v0.GetSourceEndFrame()) - (await v0.GetSourceStartFrame()) + 1;
        const want = pieces[0].b - pieces[0].a;
        if (got !== want) {
            fix = want - got;
            // The test piece goes, with its linked audio: deleting only the video left the first piece's sound at the
            // head of the cut, so it played twice (once without picture). Then make sure the timeline is empty.
            const gone = first.filter(Boolean);
            for (const it of first.filter(Boolean)) { try { gone.push(...((await it.GetLinkedItems()) || [])); } catch (e) { /* swept below */ } }
            await tl.DeleteClips(gone, false);
            for (const kind of ['video', 'audio']) {
                const tracks = Number(await tl.GetTrackCount(kind)) || 0;
                for (let t = 1; t <= tracks; t++) {
                    const left = (await tl.GetItemListInTrack(kind, t)) || [];
                    if (left.length) await tl.DeleteClips(left, false);
                }
            }
            first = [];
        }
        const todo = first.length ? pieces.slice(1) : pieces;
        const skipped = [];
        for (let i = 0; i < todo.length; i += BATCH) {
            if (job.cancelled) throw new Error('Cancelled (the timeline "' + name + '" is partly built)');
            send({ phase: 'build', text: 'Placing pieces ' + (i + 1) + '–' + Math.min(todo.length, i + BATCH) + ' of ' + todo.length + '…', done: i, total: todo.length });
            const batch = todo.slice(i, i + BATCH);
            let r = null;
            try { r = await mp.AppendToTimeline(batch.map(p => info(p, fix))); } catch (e) { r = null; }
            if (!r || !r.length) {
                // Resolve refuses the whole batch for one bad piece: place them one by one and skip the ones it refuses
                for (const p of batch) {
                    let one = null;
                    try { one = await mp.AppendToTimeline([info(p, fix)]); } catch (e) { one = null; }
                    if (!one || !one.length) skipped.push(p.s.name + ' ' + p.a + '–' + p.b);
                }
                if (skipped.length >= batch.length) throw new Error('Resolve refused every piece from ' + (i + 1) + ' on (' + skipped[0] + ')');
            }
        }
        if (skipped.length) dlog('CUT-BUILD skipped', skipped.join(', '));

        const vItems = (await tl.GetItemListInTrack('video', 1)) || [];
        const aItems = (await tl.GetItemListInTrack('audio', 1)) || [];
        const notes = [];
        if (skipped.length) notes.push(skipped.length + ' piece(s) Resolve refused were left out');
        if (vItems.length !== pieces.length) notes.push('Resolve placed ' + vItems.length + ' of ' + pieces.length + ' pieces');
        if (aItems.length > vItems.length) notes.push((aItems.length - vItems.length) + ' sound clip(s) without picture are on the cut: check its start');

        // transforms, per source clip
        if (prefs.copyTransform) {
            send({ phase: 'build', text: 'Copying zoom / position…' });
            const tf = new Map();
            for (const s of plan.sources) tf.set(s.id, await transformOf(itemById.get(s.id)));
            let n = 0;
            for (let i = 0; i < Math.min(vItems.length, pieces.length); i++) {
                const t = tf.get(pieces[i].s.id);
                if (t) { try { await vItems[i].SetProperties(t); n++; } catch (e) { /* one clip keeps the default framing */ } }
            }
            if (n) notes.push('zoom / position copied to ' + n + ' pieces');
        }

        // voice level, per source clip
        if (prefs.level && aItems.length === pieces.length) {
            let n = 0;
            for (let i = 0; i < pieces.length; i++) {
                const r = byId.get(pieces[i].s.id);
                if (!r || r.lufs === null || r.lufs === undefined) continue;
                const gain = Math.max(-12, Math.min(12, prefs.lufs - r.lufs));
                if (Math.abs(gain) < 0.5) continue;
                try { await aItems[i].SetProperties({ AudioVolumeEnabled: true, AudioVolume: Math.round(gain * 10) / 10 }); n++; } catch (e) { /* level is a convenience */ }
            }
            if (n) notes.push('voice levelled to ' + prefs.lufs + ' LUFS');
        } else if (prefs.level && aItems.length !== pieces.length) notes.push('voice not levelled (audio pieces did not line up)');

        // markers at the joins where a retake / stutter / filler / long pause was taken out
        let marks = 0;
        if (prefs.markers || prefs.markPauses > 0) {
            const joins = [];
            let rec = 0;
            for (let i = 0; i < pieces.length; i++) {
                const p = pieces[i];
                rec += Math.round((p.b - p.a) * meta.fps / p.s.fps);
                const n = pieces[i + 1];
                if (n && n.s === p.s) joins.push({ s: p.s, from: p.b / p.s.fps, to: n.a / p.s.fps, at: rec });
            }
            const out = [];
            if (prefs.markers) {
                for (const d of (plan.result.drops || []).filter(d => !d.ignored)) {
                    const j = joins.find(j => j.s.id === d.src && d.a >= j.from - 0.05 && d.a < j.to + 0.05);
                    if (j) out.push({ at: j.at, color: MARK[d.kind] || 'Red', name: d.kind[0].toUpperCase() + d.kind.slice(1) + ' cut', note: d.text + (d.of ? '  →  ' + d.of : '') });
                }
            }
            if (prefs.markPauses > 0) {
                for (const s of plan.sources) {
                    for (const c of ((byId.get(s.id) || {}).cuts || []).filter(c => c.kind === 'pause' && c.dur >= prefs.markPauses)) {
                        const t = s.mediaStart / s.fps + c.a;
                        const j = joins.find(j => j.s.id === s.id && t >= j.from - 0.05 && t < j.to + 0.05);
                        if (j) out.push({ at: j.at, color: MARK.pause, name: 'Pause ' + c.dur.toFixed(1) + ' s cut', note: '' });
                    }
                }
            }
            const used = new Set();
            for (const m of out.sort((x, y) => x.at - y.at)) {
                if (used.has(m.at)) continue;
                used.add(m.at);
                try { if (await tl.AddMarker(m.at, m.color, m.name, String(m.note).slice(0, 400), 1, 'elsa-cut')) marks++; } catch (e) { /* a marker is a convenience */ }
            }
        }

        // subtitles from the cut audio (Resolve's own speech to text), ready for the Use tab
        if (prefs.subtitles) {
            send({ phase: 'build', text: 'Resolve is creating subtitles…' });
            try {
                const ok = await bridgeCall('cut_subtitles', { timeline: name }, 30 * 60000, { lane: 2 });
                notes.push(ok && ok.ok ? 'subtitles created' : 'subtitles not created' + (ok && ok.error ? ': ' + ok.error : ''));
            } catch (e) { notes.push('subtitles not created: ' + String(e && e.message || e)); }
        }

        if (!prefs.open) { try { await project.SetCurrentTimeline(src); } catch (e) { /* stays on the cut */ } }
        const sum = summary(plan);
        const recFrames = vItems.length ? (await vItems[vItems.length - 1].GetEnd()) - (await vItems[0].GetStart()) : 0;
        const text = name + ': ' + pieces.length + ' pieces, ' + fmt(recFrames / meta.fps) + ' (was ' + fmt(sum.before) + ')' + (marks ? ', ' + marks + ' markers' : '') + (notes.length ? '. ' + notes.join('; ') : '');
        send({ phase: 'built', text });
        dlog('CUT-BUILD', text, 'endFrame fix', fix);
        return { ok: true, timeline: name, pieces: pieces.length, seconds: recFrames / meta.fps, before: sum.before, markers: marks, notes, text, endFrameFix: fix };
    } catch (e) {
        send({ phase: 'error', text: String(e && e.message || e) });
        throw e;
    } finally { job.running = false; }
}
