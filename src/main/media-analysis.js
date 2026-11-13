// Measuring footage and sound with ffmpeg (ideas from kajisho5/ffmpeg-skill, MIT): speech pauses, shot changes with
// their brightness, black / frozen frames in a rendered span, the music's beat grid, and word timings from a local
// speech engine. Every function measures; none of them changes a file the user keeps.
//
// Plain Node (no Electron, no project module), so the MCP script (mcp/el-sa-mcp.js) runs it in its own process for
// long jobs and the panel runs it for short ones. ffmpeg runs as a child process (execFile / spawn, never a shell).
// Times are seconds in the media file unless a name says frames.

const QUIET_SPEECH_DB = -50;        // a span whose loud parts stay under this is room tone, not speech

module.exports = {
    ffmpegBin, ffprobeBin, probeMedia, audioEnvelope, pausesFromEnvelope, findPauses, sceneCuts, shotsFromCuts,
    frameContent, beatGrid, findBeats, snapCuts, sourceMapper, pickSegments, analyseTimeline, renderFlags, asrStatus, transcribeWords, cachedWords, installAsr, stopAsr, ensureAsrModel,
    QUIET_SPEECH_DB
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const HOME_DIR = path.join(os.homedir(), '.el-subtitle-animator');
const WORDS_CACHE_DIR = path.join(HOME_DIR, 'words');
const ASR_VENV = path.join(HOME_DIR, 'asr-venv');
const HOP = 0.01;                   // envelope step, seconds

// ------------------------------------------------------------------ binaries

const BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
const binCache = {};
function findBin(name) {
    if (binCache[name] !== undefined) return binCache[name];
    binCache[name] = null;
    for (const d of BIN_DIRS) {
        const p = path.join(d, name);
        try { if (fs.existsSync(p)) { binCache[name] = p; break; } } catch (e) { /* next */ }
    }
    return binCache[name];
}
function ffmpegBin() { return findBin('ffmpeg'); }
function ffprobeBin() { return findBin('ffprobe'); }

function needFfmpeg() {
    const ff = ffmpegBin();
    if (!ff) throw new Error('ffmpeg is not installed. Install it with Homebrew: brew install ffmpeg');
    return ff;
}

function needFile(file) {
    const f = String(file || '').replace(/^~(?=\/)/, os.homedir());
    if (!f || !fs.existsSync(f)) throw new Error('No media file at ' + (f || '(none)') + (f.startsWith('/Volumes/') ? ' (is the drive connected?)' : ''));
    return f;
}

// Runs ffmpeg and resolves { stdout, stderr }. stdout as a Buffer when raw is true.
function runFfmpeg(args, opts) {
    const o = opts || {};
    return new Promise((resolve, reject) => {
        execFile(needFfmpeg(), ['-hide_banner', '-nostats'].concat(args), {
            timeout: o.timeout || 600000, maxBuffer: o.maxBuffer || 64 * 1024 * 1024, encoding: o.raw ? 'buffer' : 'utf8'
        }, (err, stdout, stderr) => {
            const se = String(stderr || '');
            if (err && !o.allowFail) {
                const last = se.trim().split('\n').slice(-3).join(' | ');
                return reject(new Error('ffmpeg failed: ' + (err.killed ? 'timed out' : last || err.message)));
            }
            resolve({ stdout, stderr: se });
        });
    });
}

// Input arguments for a window of a file: -ss / -t before -i (fast seek, times then start at 0).
function windowArgs(file, start, dur) {
    const a = [];
    if (start > 0) a.push('-ss', String(start));
    if (dur > 0) a.push('-t', String(dur));
    return a.concat(['-i', file]);
}

// { duration, video: { width, height, fps } | null, audio: { rate, channels } | null }
function probeMedia(file) {
    const f = needFile(file);
    const fp = ffprobeBin();
    if (!fp) return Promise.reject(new Error('ffprobe is not installed (brew install ffmpeg)'));
    return new Promise((resolve, reject) => {
        execFile(fp, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f], { timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
            if (err) return reject(new Error('ffprobe could not read ' + f));
            let j;
            try { j = JSON.parse(out); } catch (e) { return reject(new Error('ffprobe gave no answer for ' + f)); }
            const v = (j.streams || []).find(s => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
            const a = (j.streams || []).find(s => s.codec_type === 'audio');
            const rate = (r) => { const m = /^(\d+)\/(\d+)$/.exec(r || ''); return m && +m[2] ? +m[1] / +m[2] : null; };
            resolve({
                duration: Number(j.format && j.format.duration) || null,
                video: v ? { width: v.width, height: v.height, fps: rate(v.avg_frame_rate) || rate(v.r_frame_rate) } : null,
                audio: a ? { rate: Number(a.sample_rate) || null, channels: a.channels || null } : null
            });
        });
    });
}

// ------------------------------------------------------------------ sound: envelope, pauses

// The level of a window of the file's sound every 10 ms: { hop, db: Float32Array (dBFS), low, high } where low / high
// are the same for the bass (< 150 Hz, kicks) and treble (> 2 kHz, hats, consonants) bands when bands is true.
// peak: true = the loudest sample of each 10 ms (dBFS peak, what Resolve's Remove Silence threshold compares) instead of
// its RMS level. Peak needs the full sample rate (16 kHz), RMS is measured at 8 kHz.
async function audioEnvelope(file, opts) {
    const o = opts || {};
    const f = needFile(file);
    const rate = o.peak ? 16000 : 8000, hopN = Math.round(rate * HOP);
    const args = windowArgs(f, o.start || 0, o.duration || 0).concat(['-vn', '-sn', '-dn']);
    let ch = 1;
    if (o.bands) {
        args.push('-filter_complex', '[0:a:0]aformat=channel_layouts=mono,asplit=3[a][b][c];[b]lowpass=f=150[l];[c]highpass=f=2000[h];[a][l][h]amerge=inputs=3[out]', '-map', '[out]');
        ch = 3;
    } else {
        args.push('-map', '0:a:0', '-ac', '1');
    }
    args.push('-ar', String(rate), '-f', 's16le', '-acodec', 'pcm_s16le', '-');
    const { stdout } = await runFfmpeg(args, { raw: true, maxBuffer: 512 * 1024 * 1024, timeout: o.timeout || 600000 });
    const buf = stdout;
    const frames = Math.floor(buf.length / 2 / ch);
    const n = Math.floor(frames / hopN);
    const out = [];
    for (let c = 0; c < ch; c++) out.push(new Float32Array(n));
    for (let i = 0; i < n; i++) {
        for (let c = 0; c < ch; c++) {
            let s = 0;
            if (o.peak) {
                for (let k = 0; k < hopN; k++) { const v = Math.abs(buf.readInt16LE(((i * hopN + k) * ch + c) * 2)) / 32768; if (v > s) s = v; }
                out[c][i] = 20 * Math.log10(s + 1e-5);
            } else {
                for (let k = 0; k < hopN; k++) { const v = buf.readInt16LE(((i * hopN + k) * ch + c) * 2) / 32768; s += v * v; }
                out[c][i] = 10 * Math.log10(s / hopN + 1e-10);
            }
        }
    }
    return { hop: HOP, start: o.start || 0, db: out[0], low: o.bands ? out[1] : null, high: o.bands ? out[2] : null };
}

function percentile(arr, p) {
    const a = Array.from(arr).filter(Number.isFinite).sort((x, y) => x - y);
    if (!a.length) return -100;
    return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
}

// Pauses in an envelope. The threshold follows the recording: 22 dB under the speech level (the 90th percentile of
// the 10 ms levels), kept between -50 and -24 dBFS, unless noiseDb is given. A pause is at least minPause long.
// Returns { speechDb, thresholdDb, quiet, pauses: [{ start, end, mid, depthDb }] } in file seconds.
function pausesFromEnvelope(env, opts) {
    const o = opts || {};
    const db = env.db;
    const speech = percentile(db, 0.9);
    const thr = Number.isFinite(o.noiseDb) ? o.noiseDb : Math.max(-50, Math.min(-24, speech - 22));
    const minHops = Math.max(1, Math.round((o.minPause || 0.15) / env.hop));
    const pauses = [];
    let i = 0;
    while (i < db.length) {
        if (db[i] >= thr) { i++; continue; }
        let j = i, low = db[i];
        while (j < db.length && db[j] < thr) { low = Math.min(low, db[j]); j++; }
        if (j - i >= minHops) {
            const s = env.start + i * env.hop, e = env.start + j * env.hop;
            pauses.push({ start: r3(s), end: r3(e), mid: r3((s + e) / 2), depthDb: Math.round(thr - low) });
        }
        i = j;
    }
    return { speechDb: Math.round(speech), thresholdDb: Math.round(thr), quiet: speech < QUIET_SPEECH_DB, pauses };
}

// opts.context (seconds, default 10): the speech level is measured over this much more sound on both sides, so a
// short clip (a jump-cut piece of a few frames) gets the recording's real level; only pauses inside the window count.
async function findPauses(file, opts) {
    const o = opts || {};
    const start = o.start || 0, dur = o.duration || 0;
    const ctx = dur > 0 ? (Number.isFinite(o.context) ? o.context : 10) : 0;
    const from = Math.max(0, start - ctx);
    const env = await audioEnvelope(file, { start: from, duration: dur > 0 ? dur + (start - from) + ctx : 0 });
    const r = pausesFromEnvelope(env, o);
    if (ctx > 0) {
        const end = start + dur;
        r.pauses = r.pauses.filter(p => p.end > start && p.start < end).map(p => {
            const a = Math.max(p.start, start), b = Math.min(p.end, end);
            return Object.assign({}, p, { start: r3(a), end: r3(b), mid: r3((a + b) / 2), cutByWindow: a !== p.start || b !== p.end });
        }).filter(p => p.end - p.start >= (p.cutByWindow && o.keepEdges ? 0.02 : Math.min(o.minPause || 0.15, 0.1)));      // keepEdges: analyseTimeline joins them across a cut
    }
    return r;
}

const r3 = (x) => Math.round(x * 1000) / 1000;

// Moves cut times onto pauses. cuts: [seconds]; pauses: [{ start, end, mid }]; words: [{ start, end }] (optional).
// A cut inside a pause goes to its middle; else to the nearest pause middle within maxShift; else, with words, to the
// nearest gap between two words; else it stays. Returns [{ from, to, by: 'pause' | 'word' | null }].
function snapCuts(cuts, pauses, words, maxShift) {
    const lim = Number.isFinite(maxShift) ? maxShift : 0.35;
    const gaps = [];
    if (Array.isArray(words)) for (let i = 1; i < words.length; i++) gaps.push((words[i - 1].end + words[i].start) / 2);
    return cuts.map(t => {
        const inside = (pauses || []).find(p => t >= p.start && t <= p.end);
        if (inside) return { from: t, to: inside.mid, by: 'pause' };
        let best = null;
        for (const p of pauses || []) { const d = Math.abs(p.mid - t); if (d <= lim && (!best || d < Math.abs(best - t))) best = p.mid; }
        if (best !== null) return { from: t, to: best, by: 'pause' };
        let bw = null;
        for (const g of gaps) { const d = Math.abs(g - t); if (d <= lim && (bw === null || d < Math.abs(bw - t))) bw = g; }
        if (bw !== null) return { from: t, to: r3(bw), by: 'word' };
        return { from: t, to: t, by: null };
    });
}

// ------------------------------------------------------------------ picture: shot changes, brightness, black / frozen

// Shot changes (ffmpeg scdet) and the brightness every 0.5 s (signalstats YAVG, 0..255 at 8 bit) in a window of a
// video file. Returns { cuts: [{ t }], luma: [{ t, y }] } in file seconds.
async function sceneCuts(file, opts) {
    const o = opts || {};
    const f = needFile(file);
    const start = o.start || 0;
    const thr = Number.isFinite(o.threshold) ? o.threshold : 10;
    const vf = 'scale=256:-2,scdet=threshold=' + thr + ',metadata=mode=print:key=lavfi.scd.time,' +
        'fps=' + (1 / (o.lumaEvery || 0.5)) + ',signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG';
    const { stderr } = await runFfmpeg(windowArgs(f, start, o.duration || 0).concat(['-an', '-sn', '-dn', '-vf', vf, '-f', 'null', '-']), { timeout: o.timeout || 900000 });
    const cuts = [], luma = [];
    const lastT = {};
    for (const line of stderr.split('\n')) {
        const inst = /^\[Parsed_metadata_(\d+)/.exec(line);
        if (!inst) continue;
        const t = /pts_time:([-\d.]+)/.exec(line);
        if (t) { lastT[inst[1]] = Number(t[1]); continue; }
        if (/lavfi\.scd\.time=/.test(line) && lastT[inst[1]] !== undefined) { cuts.push({ t: r3(start + lastT[inst[1]]) }); continue; }
        const y = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
        if (y && lastT[inst[1]] !== undefined) luma.push({ t: r3(start + lastT[inst[1]]), y: Math.round(Number(y[1])) });
    }
    return { cuts: cuts.filter(c => c.t > start + 0.02), luma };
}

// Shots between the cuts, each with its mean brightness and a bright flag (light B-roll that hides white text:
// mean Y over 170 of 255). from / to / cuts in the same unit as luma's t.
function shotsFromCuts(from, to, cuts, luma) {
    const edges = [from].concat(cuts.filter(t => t > from && t < to).sort((a, b) => a - b), [to]);
    const shots = [];
    for (let i = 0; i < edges.length - 1; i++) {
        const a = edges[i], b = edges[i + 1];
        const ys = luma.filter(l => l.t >= a && l.t < b).map(l => l.y);
        const mean = ys.length ? Math.round(ys.reduce((s, y) => s + y, 0) / ys.length) : null;
        shots.push({ start: a, end: b, meanLuma: mean, bright: mean !== null && mean > 170, dark: mean !== null && mean < 40 });
    }
    return shots;
}

// Black and frozen spans in a rendered span: an image sequence (pattern like /dir/f%05d.jpg, with fps) or a movie.
// Returns { frames, black: [{ start, end, frames }], frozen: [{ start, end, frames }] } in seconds from the first
// frame. Thresholds as in ffmpeg-skill's content check: black = 98% of pixels under 10% luma, frozen = no change
// above -55 dB for minFreeze seconds.
async function frameContent(input, opts) {
    const o = opts || {};
    const fps = o.fps || 25;
    const args = [];
    if (o.sequence) args.push('-framerate', String(fps), '-start_number', String(o.startNumber || 0), '-i', input);
    else args.push('-i', needFile(input));
    const minFreeze = o.minFreeze || 0.4;
    const vf = 'blackdetect=d=' + (0.9 / fps).toFixed(3) + ':pic_th=0.98:pix_th=0.10,freezedetect=n=-55dB:d=' + minFreeze;
    const { stderr } = await runFfmpeg(args.concat(['-an', '-vf', vf, '-f', 'null', '-']), { timeout: o.timeout || 300000 });
    const black = [], frozen = [];
    let fs0 = null;
    for (const line of stderr.split('\n')) {
        const b = /black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/.exec(line);
        if (b) black.push({ start: r3(+b[1]), end: r3(+b[2]), frames: Math.round((+b[2] - +b[1]) * fps) });
        const s = /freeze_start:\s*([\d.]+)/.exec(line);
        if (s) fs0 = +s[1];
        const e = /freeze_end:\s*([\d.]+)/.exec(line);
        if (e && fs0 !== null) { frozen.push({ start: r3(fs0), end: r3(+e[1]), frames: Math.round((+e[1] - fs0) * fps) }); fs0 = null; }
    }
    const fm = /frame=\s*(\d+)/g; let m, frames = null;
    while ((m = fm.exec(stderr))) frames = +m[1];
    const total = frames ? frames / fps : null;
    // a black run that reaches the last frame ends at that frame's start in ffmpeg's log: count the frame itself
    for (const b of black) if (total !== null && b.end >= total - 1.5 / fps) { b.end = r3(total); b.frames = Math.round((total - b.start) * fps); b.toEnd = true; }
    if (fs0 !== null) frozen.push({ start: r3(fs0), end: total !== null ? r3(total) : null, frames: total !== null ? Math.round((total - fs0) * fps) : null, toEnd: true });
    return { frames, black, frozen };
}

// ------------------------------------------------------------------ music: beat grid

// The beat grid of an envelope (from audioEnvelope with bands): onset strength from rises in the bass, treble and
// full levels; tempo from the onset autocorrelation in minBpm..maxBpm (a mild preference for 120 BPM against octave
// errors); phase from the strongest regular comb; each beat moved onto a measured onset within 70 ms when there is
// one (supported). Speech, ambience or rubato has no steady pulse: tempoBpm null.
function beatGrid(env, opts) {
    const o = opts || {};
    const n = env.db.length;
    if (n < 400) return { tempoBpm: null, confidence: 0, beats: [], why: 'too short to measure (needs 4 s or more)' };
    const on = new Float32Array(n);
    const bands = [env.db, env.low, env.high].filter(Boolean);
    for (const b of bands) {
        for (let i = 2; i < n; i++) {
            const rise = b[i] - Math.max(b[i - 1], b[i - 2] - 1);
            if (rise > 0 && b[i] > -60) on[i] += rise;
        }
    }
    // remove the slow trend: onset minus its local mean over 0.5 s
    const w = 25, sm = new Float32Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
        acc += on[i];
        if (i >= 2 * w + 1) acc -= on[i - 2 * w - 1];
        const c = i - w;
        if (c >= 0) sm[c] = Math.max(0, on[c] - acc / (2 * w + 1));
    }
    const minLag = Math.round(60 / (o.maxBpm || 200) / env.hop), maxLag = Math.round(60 / (o.minBpm || 60) / env.hop);
    let e0 = 0;
    for (let i = 0; i < n; i++) e0 += sm[i] * sm[i];
    if (e0 <= 0) return { tempoBpm: null, confidence: 0, beats: [], why: 'no onsets (silence?)' };
    const acf = new Float32Array(maxLag + 2);
    for (let L = minLag - 1; L <= maxLag + 1; L++) {
        let s = 0;
        for (let i = 0; i + L < n; i++) s += sm[i] * sm[i + L];
        acf[L] = s / e0;
    }
    let best = -1, bestScore = -Infinity;
    for (let L = minLag; L <= maxLag; L++) {
        if (!(acf[L] >= acf[L - 1] && acf[L] >= acf[L + 1])) continue;
        const bpm = 60 / (L * env.hop);
        const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
        const score = acf[L] * (0.6 + 0.4 * prior);
        if (score > bestScore) { bestScore = score; best = L; }
    }
    if (best < 0) return { tempoBpm: null, confidence: 0, beats: [], why: 'no repeating pulse' };
    // sub-lag refinement (parabola through the peak)
    const y0 = acf[best - 1], y1 = acf[best], y2 = acf[best + 1];
    const den = y0 - 2 * y1 + y2;
    const lag = best + (den !== 0 ? 0.5 * (y0 - y2) / den : 0);
    const confidence = Math.max(0, Math.min(1, y1));
    const period = lag * env.hop;
    // phase: the offset whose comb collects the most onset
    let ph = 0, phScore = -1;
    for (let p = 0; p < best; p++) {
        let s = 0;
        for (let t = p; t < n; t += lag) s += sm[Math.round(t)] || 0;
        if (s > phScore) { phScore = s; ph = p; }
    }
    const minConf = Number.isFinite(o.minConfidence) ? o.minConfidence : 0.3;
    if (confidence < minConf) return { tempoBpm: null, confidence: r3(confidence), beats: [], why: 'no steady pulse (speech, ambience or free time)' };
    const peakOn = percentile(sm, 0.95) * 0.35;
    const beats = [];
    const win = Math.round(0.07 / env.hop);
    for (let t = ph; t < n; t += lag) {
        const c = Math.round(t);
        let bi = c, bv = sm[c] || 0;
        for (let k = Math.max(0, c - win); k <= Math.min(n - 1, c + win); k++) if (sm[k] > bv) { bv = sm[k]; bi = k; }
        const supported = bv >= peakOn && bv > 0;
        beats.push({ t: r3(env.start + (supported ? bi : t) * env.hop), supported });
    }
    return { tempoBpm: Math.round(600 / period) / 10, period: r3(period), confidence: r3(confidence), beats };
}

async function findBeats(file, opts) {
    const o = opts || {};
    const env = await audioEnvelope(file, { start: o.start, duration: o.duration, bands: true });
    return beatGrid(env, o);
}

// ------------------------------------------------------------------ timeline <-> file time

// seg: { tlStart, tlEnd, srcStartFrame, srcEndFrame, srcFps } of a timeline clip (GetStart / GetEnd /
// GetSourceStartFrame / GetSourceEndFrame / the media's FPS). Handles a speed change and a source frame rate that
// differs from the timeline's. toFile(frame) -> seconds in the file; toFrame(seconds) -> timeline frame (fractional).
function sourceMapper(seg) {
    const dur = Math.max(1, seg.tlEnd - seg.tlStart);
    const srcFps = seg.srcFps || 25;
    const perFrame = ((seg.srcEndFrame - seg.srcStartFrame) || dur) / dur;      // source frames per timeline frame
    return {
        toFile: (f) => (seg.srcStartFrame + (f - seg.tlStart) * perFrame) / srcFps,
        toFrame: (sec) => seg.tlStart + (sec * srcFps - seg.srcStartFrame) / perFrame
    };
}

// ------------------------------------------------------------------ word timings (local speech engine)

// Python engines, best first on Apple silicon. Each is run as `python -c <script> <wav> <model> <lang>` and prints
// [{w, start, end}] as JSON. The audio never leaves the machine (the first run downloads the model weights).
const ASR_ENGINES = {
    'mlx-whisper': {
        module: 'mlx_whisper', pip: 'mlx-whisper', model: 'mlx-community/whisper-large-v3-turbo',
        script: 'import sys,json,mlx_whisper\n' +
            'r=mlx_whisper.transcribe(sys.argv[1],path_or_hf_repo=sys.argv[2],word_timestamps=True,language=(sys.argv[3] or None))\n' +
            'print(json.dumps([{"w":w["word"].strip(),"start":w["start"],"end":w["end"]} for s in r["segments"] for w in s.get("words",[])]))'
    },
    'faster-whisper': {
        module: 'faster_whisper', pip: 'faster-whisper', model: 'large-v3-turbo',
        script: 'import sys,json\nfrom faster_whisper import WhisperModel\n' +
            'm=WhisperModel(sys.argv[2],compute_type="int8")\n' +
            'segs,_=m.transcribe(sys.argv[1],word_timestamps=True,language=(sys.argv[3] or None))\n' +
            'print(json.dumps([{"w":w.word.strip(),"start":w.start,"end":w.end} for s in segs for w in (s.words or [])]))'
    },
    'whisper': {
        module: 'whisper', pip: 'openai-whisper', model: 'turbo',
        script: 'import sys,json,whisper\n' +
            'r=whisper.load_model(sys.argv[2]).transcribe(sys.argv[1],word_timestamps=True,language=(sys.argv[3] or None))\n' +
            'print(json.dumps([{"w":w["word"].strip(),"start":w["start"],"end":w["end"]} for s in r["segments"] for w in s.get("words",[])]))'
    }
};

function pythonCandidates() {
    const list = [];
    if (process.env.ELSA_ASR_PYTHON) list.push(process.env.ELSA_ASR_PYTHON);
    list.push(path.join(ASR_VENV, 'bin', 'python3'));
    for (const d of BIN_DIRS) list.push(path.join(d, 'python3'));
    return [...new Set(list)].filter(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
}

function hasModule(py, mod) {
    return new Promise((resolve) => {
        execFile(py, ['-c', 'import importlib.util,sys;sys.exit(0 if importlib.util.find_spec("' + mod + '") else 1)'], { timeout: 20000 }, (err) => resolve(!err));
    });
}

// Which engines are installed, and with which Python. { engines: [{ engine, python }], install: [...] }
async function asrStatus() {
    const found = [];
    for (const py of pythonCandidates()) {
        for (const [name, e] of Object.entries(ASR_ENGINES)) {
            if (found.some(f => f.engine === name)) continue;
            if (await hasModule(py, e.module)) found.push({ engine: name, python: py, model: e.model });
        }
    }
    const order = Object.keys(ASR_ENGINES);
    found.sort((a, b) => order.indexOf(a.engine) - order.indexOf(b.engine));
    return {
        engines: found,
        install: found.length ? [] : [
            'transcribe_words with install: true sets up mlx-whisper in ' + ASR_VENV + ' (Apple silicon; about 1.6 GB of model weights download on first use)',
            'or: pip3 install faster-whisper'
        ]
    };
}

// Creates the plugin's own Python environment and installs one engine in it (default mlx-whisper on Apple silicon,
// faster-whisper elsewhere). Takes a few minutes.
function installAsr(engine) {
    const name = engine || (process.arch === 'arm64' ? 'mlx-whisper' : 'faster-whisper');
    const e = ASR_ENGINES[name];
    if (!e) throw new Error('Unknown engine ' + name + ' (' + Object.keys(ASR_ENGINES).join(', ') + ')');
    const sysPy = BIN_DIRS.map(d => path.join(d, 'python3')).find(p => fs.existsSync(p));
    if (!sysPy) throw new Error('No python3 found. Install it with Homebrew: brew install python');
    const run = (cmd, args) => new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = '';
        p.stderr.on('data', d => { err = (err + d).slice(-2000); });
        p.on('close', code => code === 0 ? resolve() : reject(new Error(cmd + ' ' + args.join(' ') + ' failed: ' + err.trim().split('\n').slice(-3).join(' | '))));
    });
    return (async () => {
        fs.mkdirSync(HOME_DIR, { recursive: true });
        if (!fs.existsSync(path.join(ASR_VENV, 'bin', 'python3'))) await run(sysPy, ['-m', 'venv', ASR_VENV]);
        const py = path.join(ASR_VENV, 'bin', 'python3');
        await run(py, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']);
        await run(py, ['-m', 'pip', 'install', '--quiet', e.pip]);
        return { installed: name, python: py };
    })();
}

function wordsCacheKey(file, start, dur, engine, model, lang) {
    const st = fs.statSync(file);
    return crypto.createHash('sha1').update([file, st.size, Math.round(st.mtimeMs), r3(start || 0), r3(dur || 0), engine, model, lang || ''].join('|')).digest('hex');
}

// Cached word timings that cover file seconds [from, to], from any earlier transcribe_words run of this file.
function cachedWords(file, from, to) {
    try {
        const f = needFile(file);
        const st = fs.statSync(f);
        for (const name of fs.readdirSync(WORDS_CACHE_DIR)) {
            if (!name.endsWith('.json')) continue;
            let j;
            try { j = JSON.parse(fs.readFileSync(path.join(WORDS_CACHE_DIR, name), 'utf8')); } catch (e) { continue; }
            if (j.file !== f || j.size !== st.size || j.mtime !== Math.round(st.mtimeMs)) continue;
            const end = j.duration > 0 ? j.start + j.duration : Infinity;
            if (j.start <= from + 0.01 && end >= to - 0.01) return j.words.filter(w => w.end >= from && w.start <= to);
        }
    } catch (e) { /* no cache yet */ }
    return null;
}

// ------------------------------------------------------------------ speech engine runs: one at a time, stoppable

// Every speech-engine process this plugin started (download or transcription). stopAsr() ends them: the panel's
// Cancel, and a new run (an earlier one left running would hold the model download's lock, so the new one waits
// forever). Processes of an earlier panel session are found by their command line and stopped too.
const ASR_KIDS = new Set();
const ASR_MARK = 'elsa-asr';            // in every engine command line, so a leftover of an earlier session is ours
function stopAsr() {
    let n = 0;
    for (const p of ASR_KIDS) {
        try { process.kill(-p.pid, 'SIGKILL'); n++; } catch (e) { try { p.kill('SIGKILL'); n++; } catch (_) { /* gone */ } }
    }
    ASR_KIDS.clear();
    try {     // leftovers of an earlier panel session (or of a version without the mark: the mlx-whisper one-liner)
        const out = require('child_process').execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8', timeout: 5000 });
        for (const line of out.split('\n')) {
            const m = /^\s*(\d+)\s+(.*)$/.exec(line);
            if (!m || Number(m[1]) === process.pid) continue;
            if (m[2].includes(ASR_MARK) || /-c import sys,json,mlx_whisper/.test(m[2]) || (/curl/.test(m[2]) && m[2].includes('.elsa-part'))) { try { process.kill(Number(m[1]), 'SIGKILL'); n++; } catch (e) { /* not ours */ } }
        }
    } catch (e) { /* ps not available */ }
    return n;
}

// The engines' environment. Inside Resolve the plugin's PATH has no Homebrew folders, and the engines start ffmpeg by
// name (mlx-whisper reads the audio with it): the folder of the ffmpeg this plugin uses goes first, then the usual ones.
function asrEnv() {
    const ff = ffmpegBin();
    const dirs = [ff ? path.dirname(ff) : null].concat(BIN_DIRS, String(process.env.PATH || '').split(':')).filter(Boolean);
    return Object.assign({}, process.env, { PATH: [...new Set(dirs)].join(':'), HF_HUB_DOWNLOAD_TIMEOUT: '30', HF_HUB_ETAG_TIMEOUT: '30', HF_HUB_DISABLE_PROGRESS_BARS: '1' });
}

// Runs a speech-engine Python script. tick(seconds) is called every second (it may throw to cancel, e.g. 'Cancelled');
// stall(): true when the run should be given up (the download stopped growing).
function runAsr(python, script, args, o) {
    return new Promise((resolve, reject) => {
        const p = spawn(python, ['-c', '# ' + ASR_MARK + '\n' + script].concat(args),
            { stdio: ['ignore', 'pipe', 'pipe'], env: asrEnv(), detached: true });
        ASR_KIDS.add(p);
        let out = '', err = '', done = false;
        const t0 = Date.now();
        const end = (fn, v) => { if (done) return; done = true; clearInterval(iv); ASR_KIDS.delete(p); fn(v); };
        const iv = setInterval(() => {
            try {
                if (o.tick) o.tick((Date.now() - t0) / 1000);
                if (o.stall && o.stall()) throw new Error(o.stallMessage || 'stalled');
                if (o.timeout && Date.now() - t0 > o.timeout) throw new Error('took longer than ' + Math.round(o.timeout / 60000) + ' minutes');
            } catch (e) { try { p.kill('SIGKILL'); } catch (x) { /* gone */ } end(reject, e); }
        }, 1000);
        p.stdout.on('data', d => { out += d; if (out.length > 256 * 1024 * 1024) out = out.slice(-1024 * 1024); });
        p.stderr.on('data', d => { err = (err + d).slice(-4000); });
        p.on('error', e => end(reject, e));
        p.on('close', code => code === 0 ? end(resolve, out) : end(reject, new Error(String(err || 'exit ' + code).trim().split('\n').slice(-3).join(' | '))));
    });
}

// mlx-whisper's model comes from Hugging Face on first use (about 1.6 GB). The big file is fetched here with curl, which
// resumes: a stopped or cancelled download goes on from where it was (also from the part an earlier engine run left,
// a "*.incomplete" file in the cache), and the panel sees real progress, speed and time left. Hugging Face's own
// downloader (hf_xet) shows nothing until the file is complete and starts again from zero every time.
// The finished file is checked (size and sha256) and put where Hugging Face looks for it; snapshot_download then only
// links it and fetches the small files.
const HF_LIST_SCRIPT = 'import sys,json\nfrom huggingface_hub import HfApi,snapshot_download\n' +
    'repo=sys.argv[1]\n' +
    'try:\n snapshot_download(repo,local_files_only=True); print("READY"); sys.exit(0)\nexcept Exception: pass\n' +
    'i=HfApi().model_info(repo,files_metadata=True)\n' +
    'print("FILES "+json.dumps({"sha":i.sha,"files":[{"name":s.rfilename,"size":s.size,"sha256":s.lfs.sha256} for s in i.siblings if s.lfs]}))';
const HF_LINK_SCRIPT = 'import sys\nfrom huggingface_hub import snapshot_download\nsnapshot_download(sys.argv[1])\nprint("READY")';

function sha256File(file) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
}
function fileSize(f) { try { return fs.statSync(f).size; } catch (e) { return 0; } }

async function ensureModel(pick, model, progress) {
    if (pick.engine !== 'mlx-whisper' || !/\//.test(model)) return;
    const say = (t) => { if (progress) progress(t); };
    let list;
    try {
        list = await runAsr(pick.python, HF_LIST_SCRIPT, [model], { tick: () => say('Checking the speech model…'), timeout: 120000 });
    } catch (e) { throw new Error(/Cancelled/.test(e.message) ? 'Cancelled' : 'Could not reach Hugging Face for the speech model: ' + e.message); }
    if (/READY/.test(list)) return;
    const m = /FILES (\{.*\})/.exec(list);
    if (!m) throw new Error('Could not read the speech model\'s file list');
    const info = JSON.parse(m[1]);
    const dir = path.join(process.env.HF_HOME || path.join(os.homedir(), '.cache', 'huggingface'), 'hub', 'models--' + model.replace(/\//g, '--'), 'blobs');
    fs.mkdirSync(dir, { recursive: true });
    const curl = ['/usr/bin/curl', '/opt/homebrew/bin/curl'].find(p => fs.existsSync(p));
    if (!curl) throw new Error('curl is missing');
    const total = info.files.reduce((t, f) => t + (f.size || 0), 0);
    for (const f of info.files) {
        const blob = path.join(dir, f.sha256);
        if (fileSize(blob) === f.size) continue;
        const part = blob + '.elsa-part';
        if (!fs.existsSync(part)) {        // start from the biggest piece an earlier download left
            const old = fs.readdirSync(dir).filter(n => n.startsWith(f.sha256 + '.') && n.endsWith('.incomplete')).map(n => path.join(dir, n))
                .sort((x, y) => fileSize(y) - fileSize(x))[0];
            if (old && fileSize(old) > 0 && fileSize(old) < f.size) fs.renameSync(old, part);
        }
        // one downloader per file: another one running (the panel and the MCP tool, or a run of an earlier session that
        // stopAsr could not end) is waited for instead of writing the same file twice
        const lock = part + '.lock';
        const holder = (() => { try { const pid = Number(fs.readFileSync(lock, 'utf8')); if (pid && pid !== process.pid) { process.kill(pid, 0); return pid; } } catch (e) { /* free */ } return 0; })();
        if (holder) {
            let last = fileSize(part), lastAt = Date.now();
            while (fileSize(blob) !== f.size) {
                await new Promise(r => setTimeout(r, 1000));
                if (progress) progress('Downloading the speech model (once): ' + Math.round(fileSize(part) / 1048576) + ' / ' + Math.round(f.size / 1048576) + ' MB');
                if (fileSize(part) > last) { last = fileSize(part); lastAt = Date.now(); }
                let alive = true;
                try { process.kill(holder, 0); } catch (e) { alive = false; }
                if (!alive) break;
                if (Date.now() - lastAt > 120000) throw new Error('Another speech model download stopped getting data. Press Words again.');
            }
            if (fileSize(blob) === f.size) continue;
        }
        fs.writeFileSync(lock, String(process.pid));
        try {
        const url = 'https://huggingface.co/' + model + '/resolve/' + info.sha + '/' + f.name.split('/').map(encodeURIComponent).join('/');
        const others = info.files.filter(x => x !== f).reduce((t, x) => t + Math.min(x.size, fileSize(path.join(dir, x.sha256))), 0);
        let stalls = 0;
        while (fileSize(part) < f.size) {
            const before = fileSize(part);
            const hist = [[Date.now(), before]];
            let lastGrow = Date.now();
            try {
                await runCmd(curl, ['-L', '-f', '-sS', '-C', '-', '--retry', '3', '--retry-delay', '2', '-o', part, url], {
                    tick: () => {
                        const now = fileSize(part), t = Date.now();
                        if (now > hist[hist.length - 1][1]) lastGrow = t;
                        hist.push([t, now]);
                        while (hist.length > 2 && t - hist[0][0] > 15000) hist.shift();
                        const rate = (now - hist[0][1]) / Math.max(1, (t - hist[0][0]) / 1000);
                        const done = others + now, left = rate > 1000 ? (total - done) / rate : null;
                        say('Downloading the speech model (once): ' + Math.round(done / 1048576) + ' / ' + Math.round(total / 1048576) + ' MB' +
                            (rate > 1000 ? ' · ' + (rate / 1048576).toFixed(1) + ' MB/s · about ' + (left > 90 ? Math.round(left / 60) + ' min' : Math.round(left) + ' s') + ' left' : ' · waiting for data'));
                    },
                    stall: () => Date.now() - lastGrow > 60000
                });
            } catch (e) {
                if (/Cancelled/.test(e.message)) throw new Error('Cancelled (the download goes on from ' + Math.round(fileSize(part) / 1048576) + ' MB next time)');
                if (/416/.test(e.message)) { try { fs.unlinkSync(part); } catch (x) { /* gone */ } continue; }      // the part did not fit: start it again
                if (fileSize(part) <= before && ++stalls >= 3) throw new Error('The speech model download is not getting data from Hugging Face (' + Math.round(fileSize(part) / 1048576) + ' of ' + Math.round(f.size / 1048576) + ' MB). Check the internet connection and press Words again: it goes on from there.');
            }
        }
        say('Checking the downloaded speech model…');
        const sum = fileSize(part) === f.size ? await sha256File(part) : '';
        if (sum !== f.sha256) { try { fs.unlinkSync(part); } catch (e) { /* gone */ } throw new Error('The downloaded speech model was damaged and was removed. Press Words again to download it again.'); }
        fs.renameSync(part, blob);
        } finally { try { if (Number(fs.readFileSync(lock, 'utf8')) === process.pid) fs.unlinkSync(lock); } catch (e) { /* gone */ } }
        for (const n of fs.readdirSync(dir)) if (n.startsWith(f.sha256 + '.') && n.endsWith('.incomplete')) { try { fs.unlinkSync(path.join(dir, n)); } catch (e) { /* in use */ } }
    }
    try {
        await runAsr(pick.python, HF_LINK_SCRIPT, [model], { tick: () => say('Setting up the speech model…'), timeout: 600000 });
    } catch (e) { throw new Error(/Cancelled/.test(e.message) ? 'Cancelled' : 'Could not set up the speech model: ' + e.message); }
}

// The speech model, downloaded on its own (MCP / scripts): the default engine's model, with progress(text).
async function ensureAsrModel(progress) {
    const status = await asrStatus();
    const pick = status.engines[0];
    if (!pick) throw new Error('No speech engine is installed');
    await ensureModel(pick, ASR_ENGINES[pick.engine].model, progress);
    return { engine: pick.engine, model: ASR_ENGINES[pick.engine].model, ready: true };
}

// A command (curl) run like runAsr: ended by Cancel / stopAsr, ticks every second.
function runCmd(cmd, args, o) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: asrEnv() });
        ASR_KIDS.add(p);
        let err = '', done = false;
        const end = (fn, v) => { if (done) return; done = true; clearInterval(iv); ASR_KIDS.delete(p); fn(v); };
        const iv = setInterval(() => {
            try {
                if (o.tick) o.tick();
                if (o.stall && o.stall()) throw new Error('stalled');
            } catch (e) { try { p.kill('SIGKILL'); } catch (x) { /* gone */ } end(reject, e); }
        }, 1000);
        p.stdout.on('data', () => { /* -o file */ });
        p.stderr.on('data', d => { err = (err + d).slice(-2000); });
        p.on('error', e => end(reject, e));
        p.on('close', code => code === 0 ? end(resolve) : end(reject, new Error((err.trim() || 'curl exit ' + code) + (code === 22 && /416/.test(err) ? ' 416' : ''))));
    });
}

// Word timings of a window of a media file: [{ w, start, end }] in file seconds. Cached per file version, window,
// engine and model in ~/.el-subtitle-animator/words.
async function transcribeWords(file, opts) {
    const o = opts || {};
    const f = needFile(file);
    const status = await asrStatus();
    const pick = o.engine ? status.engines.find(e => e.engine === o.engine) : status.engines[0];
    if (!pick) {
        throw new Error((o.engine ? o.engine + ' is not installed. ' : 'No speech engine is installed. ') + status.install.join('; '));
    }
    const eng = ASR_ENGINES[pick.engine];
    const model = o.model || eng.model;
    const start = o.start || 0, dur = o.duration || 0;
    const key = wordsCacheKey(f, start, dur, pick.engine, model, o.language);
    const cacheFile = path.join(WORDS_CACHE_DIR, key + '.json');
    if (!o.refresh) {
        try { const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); return Object.assign({ cached: true }, j); } catch (e) { /* not cached */ }
    }
    stopAsr();          // an earlier run left behind would hold the model's download lock
    await ensureModel(pick, model, o.progress);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elsa-asr-'));
    const wav = path.join(tmp, 'speech.wav');
    try {
        await runFfmpeg(windowArgs(f, start, dur).concat(['-vn', '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', wav]));
        let out;
        try {
            out = await runAsr(pick.python, eng.script, [wav, model, o.language || ''], {
                tick: (s) => { if (o.progress) o.progress('Listening for words' + (dur ? ' in ' + Math.round(dur) + ' s of sound' : '') + ': ' + Math.round(s) + ' s'); },
                timeout: o.timeout || 3600000
            });
        } catch (e) { throw new Error(/Cancelled/.test(e.message) ? 'Cancelled' : pick.engine + ' failed: ' + e.message); }
        const line = String(out).trim().split('\n').filter(l => l.startsWith('[')).pop() || '[]';
        const words = JSON.parse(line).filter(w => w.w && Number.isFinite(w.start) && Number.isFinite(w.end))
            .map(w => ({ w: w.w, start: r3(w.start + start), end: r3(w.end + start) }));
        const st = fs.statSync(f);
        const rec = { file: f, size: st.size, mtime: Math.round(st.mtimeMs), start, duration: dur, engine: pick.engine, model, language: o.language || null, words };
        fs.mkdirSync(WORDS_CACHE_DIR, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(rec));
        return Object.assign({ cached: false }, rec);
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp folder */ }
    }
}

// ------------------------------------------------------------------ timeline ranges (shared by the panel and MCP)

// media: what cut-tools.js timelineMedia() read from Resolve: { fps, from, to, segments: [{ kind: 'video' | 'audio',
// track, itemId, name, file, audioOnly, tlStart, tlEnd, srcStartFrame, srcEndFrame, srcFps }] }.
// The clips a kind of analysis listens to / looks at:
// - cuts: every footage clip on every video track (shot changes inside clips, plus the edit points between clips);
// - pauses, words: the dialogue: opts.audioTrack, else the lowest audio track with sound in the range;
// - beats: the music: opts.audioTrack, else the highest audio track whose clips are audio-only files.
function pickSegments(kind, media, opts) {
    const o = opts || {};
    const inRange = (s) => s.tlEnd > media.from && s.tlStart < media.to;
    if (kind === 'cuts') return media.segments.filter(s => s.kind === 'video' && inRange(s));
    const audio = media.segments.filter(s => s.kind === 'audio' && inRange(s));
    if (o.audioTrack) return audio.filter(s => s.track === Number(o.audioTrack));
    const tracks = [...new Set(audio.map(s => s.track))].sort((a, b) => a - b);
    if (kind === 'beats') {
        const music = tracks.filter(t => audio.some(s => s.track === t && s.audioOnly));
        const t = music[music.length - 1];
        return t === undefined ? [] : audio.filter(s => s.track === t);
    }
    return tracks.length ? audio.filter(s => s.track === tracks[0]) : [];
}

// Runs one analysis over a timeline range and answers in timeline frames.
// kind: 'pauses' | 'cuts' | 'beats' | 'words'. progress(done, total, label) is optional.
async function analyseTimeline(kind, media, opts) {
    const o = opts || {};
    const segs = pickSegments(kind, media, o);
    if (!segs.length) {
        const what = kind === 'cuts' ? 'no footage clips' : kind === 'beats' ? 'no music (an audio-only clip; give audioTrack)' : 'no sound clips' + (o.audioTrack ? ' on A' + o.audioTrack : '');
        throw new Error('There are ' + what + ' between frames ' + media.from + ' and ' + media.to + '.');
    }
    const fr = (x) => Math.round(x * 100) / 100;
    const res = { kind, from: media.from, to: media.to, fps: media.fps, clips: [], warnings: [] };
    if (kind === 'pauses') res.pauses = [];
    if (kind === 'cuts') { res.cuts = []; res.luma = []; }
    if (kind === 'beats') res.beats = [];
    if (kind === 'words') res.words = [];
    let done = 0;
    for (const s of segs) {
        if (o.progress) o.progress(done, segs.length, s.name);
        const a = Math.max(media.from, s.tlStart), b = Math.min(media.to, s.tlEnd);
        const map = sourceMapper(s);
        const t0 = map.toFile(a), t1 = map.toFile(b);
        const win = { start: Math.max(0, t0), duration: Math.max(0.05, t1 - t0) };
        const inside = (f) => f >= a - 0.5 && f <= b + 0.5;
        const clip = { track: (s.kind === 'video' ? 'V' : 'A') + s.track, name: s.name, file: s.file, from: a, to: b };
        try {
            if (kind === 'pauses') {
                const p = await findPauses(s.file, Object.assign({}, win, { noiseDb: o.noiseDb, minPause: o.minPause, keepEdges: true }));
                clip.speechDb = p.speechDb; clip.thresholdDb = p.thresholdDb;
                if (p.quiet) res.warnings.push(clip.name + ': very quiet (speech around ' + p.speechDb + ' dBFS); pauses may be wrong');
                for (const q of p.pauses) {
                    const ps = Math.max(a, map.toFrame(q.start)), pe = Math.min(b, map.toFrame(q.end));
                    if (pe - ps >= 0.4) res.pauses.push({ start: fr(ps), end: fr(pe), mid: fr((ps + pe) / 2), frames: Math.round(pe - ps), depthDb: q.depthDb });
                }
            } else if (kind === 'cuts') {
                const c = await sceneCuts(s.file, Object.assign({}, win, { threshold: o.threshold }));
                for (const x of c.cuts) { const f = map.toFrame(x.t); if (inside(f)) res.cuts.push({ frame: Math.round(f), track: clip.track, inClip: true }); }
                for (const l of c.luma) { const f = map.toFrame(l.t); if (inside(f)) res.luma.push({ t: f, y: l.y, track: s.track }); }
                for (const e of [s.tlStart, s.tlEnd]) if (e > media.from && e < media.to) res.cuts.push({ frame: e, track: clip.track, edit: true });
            } else if (kind === 'beats') {
                const g = await findBeats(s.file, Object.assign({}, win, { minBpm: o.minBpm, maxBpm: o.maxBpm }));
                clip.tempoBpm = g.tempoBpm; clip.confidence = g.confidence;
                if (!g.tempoBpm) res.warnings.push(clip.name + ': ' + (g.why || 'no beat'));
                for (const x of g.beats) { const f = map.toFrame(x.t); if (inside(f)) res.beats.push({ frame: fr(f), supported: x.supported }); }
            } else if (kind === 'words') {
                const w = await transcribeWords(s.file, Object.assign({}, win, { engine: o.engine, model: o.model, language: o.language,
                    progress: o.progress ? (label) => o.progress(done, segs.length, s.name + ': ' + label) : null }));
                clip.engine = w.engine; clip.cached = w.cached;
                for (const x of w.words) { const f0 = map.toFrame(x.start), f1 = map.toFrame(x.end); if (inside(f0)) res.words.push({ w: x.w, start: fr(f0), end: fr(f1) }); }
            }
        } catch (e) {
            if (e.message === 'Cancelled') throw e;
            clip.error = e.message;
            res.warnings.push(clip.name + ': ' + e.message);
        }
        res.clips.push(clip);
        done++;
    }
    if (o.progress) o.progress(done, segs.length, '');
    if (kind === 'cuts') {
        // one cut per frame (an edit point and a shot change in the same place are one cut); top track's brightness
        const byFrame = new Map();
        for (const c of res.cuts.sort((x, y) => x.frame - y.frame)) {
            const k = [...byFrame.keys()].find(f => Math.abs(f - c.frame) <= 1);
            if (k === undefined) byFrame.set(c.frame, c); else if (c.edit) byFrame.get(k).edit = true;
        }
        res.cuts = [...byFrame.values()];
        const top = Math.max(...res.luma.map(l => l.track), 0);
        res.shots = shotsFromCuts(media.from, media.to, res.cuts.map(c => c.frame), res.luma.filter(l => l.track === top))
            .map(x => Object.assign(x, { start: Math.round(x.start), end: Math.round(x.end), frames: Math.round(x.end - x.start) }));
        delete res.luma;
    }
    if (kind === 'pauses') {
        // A silence that runs across a cut (the end of one piece and the start of the next) is one pause on the
        // timeline: join the two halves, then drop what is still shorter than a pause.
        const all = res.pauses.sort((x, y) => x.start - y.start), out = [];
        for (const p of all) {
            const last = out[out.length - 1];
            if (last && p.start - last.end <= 0.75) { last.end = Math.max(last.end, p.end); last.depthDb = Math.max(last.depthDb, p.depthDb); }
            else out.push(Object.assign({}, p));
        }
        const min = Math.max(1, (o.minPause || 0.15) * media.fps - 0.5);
        res.pauses = out.filter(p => p.end - p.start >= min).map(p => Object.assign(p, { mid: fr((p.start + p.end) / 2), frames: Math.round(p.end - p.start) }));
    }
    if (kind === 'beats') {
        res.beats.sort((x, y) => x.frame - y.frame);
        const t = res.clips.find(c => c.tempoBpm);
        res.tempoBpm = t ? t.tempoBpm : null;
    }
    return res;
}

// What a render check found, as plain warnings. content: frameContent() of the exported frames; fps: their rate;
// clipFrames: the clip's own length (the frames after it are the tail that follows the clip).
function renderFlags(content, fps, clipFrames) {
    const flags = [];
    const fr = (sec) => Math.round(sec * fps);
    for (const b of content.black) {
        const s = fr(b.start), e = fr(b.end);
        flags.push({ kind: 'black', from: s, to: e, frames: e - s, note: (s >= clipFrames - 3 ? 'black frames at the end of the clip' : 'black frames') + ' (frames ' + s + '-' + e + ' of the clip)' });
    }
    for (const z of content.frozen) {
        const s = fr(z.start), e = z.end === null ? clipFrames : fr(z.end);
        if (s <= 1 && e >= clipFrames - 2) flags.push({ kind: 'static', from: s, to: e, frames: e - s, note: 'nothing on screen moves for the whole clip: the animation did not render (or the footage is a still)' });
        else if (s <= 1 && e - s >= Math.min(10, clipFrames / 3)) flags.push({ kind: 'staticStart', from: s, to: e, frames: e - s, note: 'the first ' + (e - s) + ' frames do not move: the entrance animation did not play' });
        else flags.push({ kind: 'frozen', from: s, to: e, frames: e - s, note: 'frozen frames ' + s + '-' + e + ' (a hold, or a stalled render)' });
    }
    return flags;
}
