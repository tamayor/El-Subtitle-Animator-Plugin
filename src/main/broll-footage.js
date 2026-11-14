// B-roll effects that read the footage under them (src/main/broll.js calls footageProps before each render).
// The effects stay overlays; what they need from the timeline is measured here with the app's own tools and handed to
// the Remotion side as hidden props (never panel fields, never kept in broll-placed.json):
//   _samples   the dialogue's loudness per clip frame, 0..1 (audio-pulse, cutout-puppet): the Cut tab's envelope
//              (media-analysis.js audioEnvelope) of the sound clips found by cut-tools.js timelineMedia
//   _seq       the footage of the clip's range as pictures the renderer can load: the speaker cut out of every frame
//              (c%05d.png, Spotlight's matte engine: spotlight.js matteFrames / subject_matte.py), the full frames
//              (f%05d.jpg, bridge track_frames) and / or the room with the speaker filled in (p%05d.jpg, the same
//              script's clean plate), with the speaker's box and head top. render.mjs links the folder into its
//              bundle and gives the effect its URL
//   _bg        a video backdrop as frames at the timeline's rate and size, looped to the clip's length (b%05d.jpg,
//              ffmpeg): green-screen-stage when its Backdrop is a video file
//   _track     where the spot under a label goes, frame by frame (sticky-text): subject_tracker.py on small frames
//   _image     one cut-out picture (cutout-pop: the speaker at the clip's first frame, or a chosen photo with its
//              background removed), cropped to the person
//   _outline   the speaker's outline at the clip's start, middle and end, 72 points each (doodle-boil)
//   _thumbs    small frames of the timeline's own clips (video-wall, orbit-carousel)
// Everything is cached in <data>/_app/broll-footage/<key>/, so a re-render of the same range is immediate.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { APP_DATA_DIR } = require('./config');

const CACHE_DIR = path.join(APP_DATA_DIR, 'broll-footage');
const KEEP_DIRS = 16;
const KEEP_BYTES = 4e9;          // cut-outs are ~2 MB a frame at 1080 x 1920: 20 s is about 1 GB
// The speaker cut out of every frame: the matte (~140 ms a frame, ~160 with the clean plate) runs while Resolve is still
// exporting, so 20 s of 25 fps footage is about 70-80 s the first time. Frames alone (no cut-out) are ~30 ms each.
const MAX_SEQ_SECONDS = 20;
const MAX_FULL_SECONDS = 30;
const CHUNK = 10;
const TRACK_DIM = 640;           // the tracker reads small frames
const TRACK_BOX = 0.14;          // the tracked patch under a label: this share of the frame's short side
const VIDEO_FILE = /\.(mp4|mov|m4v|webm|mkv|avi|mxf)$/i;
const OUTLINE_POINTS = 72;
const OWN_FILE = /\/El Subtitle Animator B-roll\/|\/spotlight\/[^/]+\/c\[|\/broll-footage\//;

// What an effect needs with these props; null = nothing from the footage.
//   samples, seq (cut-outs of every frame), full (full frames of every frame), still (one cropped cut-out),
//   photo (the chosen picture's background removed), outline, thumbs (how many)
const NEEDS = {
    'audio-pulse': () => ({ samples: true }),
    'cutout-puppet': (p) => (p.talk === false ? null : { samples: true }),
    'cutout-pop': (p) => (p.source === 'speaker' ? { still: true } : p.removeBg && p.image ? { photo: true } : null),
    'doodle-boil': (p) => (p.follow === false ? null : { outline: true, soft: true }),
    'video-wall': (p) => (p.realClips === false ? null : { thumbs: 24, soft: true }),
    'viewfinder-zoom': (p) => (p.pushIn ? { full: true } : null),
    'editor-reveal': (p) => (p.footage === false ? null : { full: true, soft: true }),
    'paper-cut': () => ({ seq: true }),
    'depth-scatter': () => ({ seq: true }),
    'orbit-carousel': () => ({ seq: true, thumbs: 10 }),
    'frame-break-card': () => ({ seq: true, full: true }),
    // Room grows (the classic dolly zoom) scales the clean plate; Speaker grows scales the cut-out over the frames
    'vertigo-dolly': (p) => (p.move === 'Speaker grows' ? { seq: true, full: true } : { seq: true, plate: true }),
    'green-screen-stage': (p) => (VIDEO_FILE.test(String(p.image || '')) ? { seq: true, video: true } : { seq: true }),
    'sticky-text': (p) => (p.follow === false ? null : { track: true, soft: true }),
    'before-after-wipe': (p) => (p.look === 'Tint' ? null : { full: true, soft: true })
};
function needsFor(effect, props) {
    const f = NEEDS[effect];
    const n = f ? f(props || {}) : null;
    return n && Object.keys(n).some(k => k !== 'soft') ? n : null;
}

// ------------------------------------------------------------------ pure parts (test/main/broll-footage.test.js)

// Loudness in dBFS per frame (NaN / -Infinity = no sound) -> 0..1 per frame for the audio-driven effects: the floor is
// 30 dB under the speech level (its 90th percentile), the loud syllables reach 1, and a fall is eased (a mouth or a
// bar does not snap shut in one frame).
function samplesFromDb(db) {
    const vals = Array.from(db || []).filter(v => Number.isFinite(v) && v > -90).sort((a, b) => a - b);
    if (!vals.length) return (db || []).map(() => 0);
    const at = (p) => vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))];
    const top = at(0.95), floor = Math.max(at(0.9) - 30, top - 36);
    const span = Math.max(6, top - floor);
    let prev = 0;
    return Array.from(db).map((v) => {
        let x = Number.isFinite(v) ? Math.max(0, Math.min(1, (v - floor) / span)) : 0;
        x = Math.pow(x, 1.4);                              // quiet room tone stays near 0
        if (x < prev) x = Math.max(x, prev * 0.55);        // release
        prev = x;
        return Math.round(x * 1000) / 1000;
    });
}

// The loudest reading of each timeline frame: env = { hop, start, db } (media-analysis audioEnvelope of a window of the
// file), toFile(frame) -> seconds in the file. Frames outside [a, b) are left alone in `out`.
function frameLevels(out, env, toFile, start, a, b) {
    for (let f = Math.max(start, a); f < Math.min(start + out.length, b); f++) {
        const i0 = Math.floor((toFile(f) - env.start) / env.hop), i1 = Math.max(i0 + 1, Math.ceil((toFile(f + 1) - env.start) / env.hop));
        let m = -Infinity;
        for (let i = Math.max(0, i0); i < Math.min(env.db.length, i1); i++) if (env.db[i] > m) m = env.db[i];
        if (m > -Infinity && !(out[f - start] > m)) out[f - start] = m;
    }
    return out;
}

// The picture under a frame: the topmost footage clip there that is not one of the plugin's own overlays.
function pickFootage(segments, frame) {
    const hit = (segments || []).filter(s => s.kind === 'video' && !s.audioOnly && !OWN_FILE.test(s.file) && s.tlStart <= frame && frame < s.tlEnd);
    hit.sort((a, b) => b.track - a.track);
    return hit[0] || null;
}

// `count` moments spread over the timeline's clips: [{ file, t (seconds in the file) }], most-used files first.
function thumbMoments(segments, count, mapper) {
    const vids = (segments || []).filter(s => s.kind === 'video' && !s.audioOnly && !OWN_FILE.test(s.file) && s.tlEnd - s.tlStart >= 4);
    if (!vids.length || count < 1) return [];
    const total = vids.reduce((n, s) => n + (s.tlEnd - s.tlStart), 0);
    const out = [];
    for (let i = 0; i < count; i++) {
        let at = ((i + 0.5) / count) * total, s = vids[0];
        for (const v of vids) { if (at < v.tlEnd - v.tlStart) { s = v; break; } at -= v.tlEnd - v.tlStart; }
        out.push({ file: s.file, t: Math.max(0, Math.round(mapper(s).toFile(s.tlStart + at) * 100) / 100) });
    }
    return out;
}

const sha = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 16);

// ------------------------------------------------------------------ Resolve side

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }

function dirBytes(d) {
    let n = 0;
    try { for (const f of fs.readdirSync(d)) { try { n += fs.statSync(path.join(d, f)).size; } catch (e) { /* gone */ } } } catch (e) { /* gone */ }
    return n;
}
// Newest first: keep at most KEEP_DIRS folders and KEEP_BYTES in all (the newest one always stays).
function keepNewest(dirs, maxDirs, maxBytes) {
    let total = 0;
    return dirs.filter((d, i) => { total += d.bytes; return i === 0 || (i < maxDirs && total <= maxBytes); }).map(d => d.n);
}
function prune() {
    try {
        const dirs = fs.readdirSync(CACHE_DIR).filter(n => n !== 'thumbs').map(n => ({ n, t: fs.statSync(path.join(CACHE_DIR, n)).mtimeMs })).sort((a, b) => b.t - a.t);
        for (const d of dirs) d.bytes = dirBytes(path.join(CACHE_DIR, d.n));
        const keep = new Set(keepNewest(dirs, KEEP_DIRS, KEEP_BYTES));
        for (const d of dirs) if (!keep.has(d.n)) fs.rmSync(path.join(CACHE_DIR, d.n), { recursive: true, force: true });
    } catch (e) { /* nothing cached yet */ }
}

const ENGINE_NOTE = 'the speaker cut-out engine is not installed (Use tab > Effect Preset > Spotlight sets it up once)';

// The dialogue's loudness for the clip's frames, or null when there is no sound clip under it.
async function audioSamples(media, start, frames, audioTrack) {
    const MEDIA = require('./media-analysis');
    const segs = MEDIA.pickSegments('pauses', media, { audioTrack });
    if (!segs.length) return null;
    const db = new Array(frames).fill(NaN);
    for (const s of segs) {
        const a = Math.max(start, s.tlStart), b = Math.min(start + frames, s.tlEnd);
        if (b <= a) continue;
        const map = MEDIA.sourceMapper(s);
        const t0 = Math.max(0, map.toFile(a)), t1 = map.toFile(b);
        const env = await MEDIA.audioEnvelope(s.file, { start: t0, duration: Math.max(0.05, t1 - t0 + 0.05), peak: false });
        frameLevels(db, env, map.toFile, start, a, b);
    }
    return db.some(Number.isFinite) ? samplesFromDb(db) : null;
}

// The frames `list` (timeline frames) of the footage clip as cut-outs, full frames and / or clean plates in the cache
// folder. The matte starts with the export and reads each frame as it lands (subject_matte.py `wait`).
// -> { dir, count, cut, full, plate, w, h, box, headTop, cx } | { needInstall } | { error }
async function footageFrames(seg, list, want, meta, progress) {
    const { bridgeCall } = require('./fusion-bridge');
    const SPOT = require('./spotlight');
    const key = sha([seg.itemId, seg.file, seg.srcStartFrame, seg.tlStart, list[0], list[list.length - 1], meta.width, meta.height]);
    const dir = path.join(CACHE_DIR, key), infoFile = path.join(dir, 'info.json');
    const have = readJson(infoFile) || {};
    const needPlate = !!want.plate && !have.plate;
    const needCut = (!!want.cut && !have.cut) || needPlate, needFull = !!want.full && !have.full;
    if (have.count === list.length && !needCut && !needFull) { try { fs.utimesSync(dir, new Date(), new Date()); } catch (e) { /* only for prune */ } return Object.assign({ dir }, have); }
    if (needCut && !(await SPOT.spotEngine()).ready) return { needInstall: true };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elsa-broll-'));
    try {
        fs.mkdirSync(dir, { recursive: true });
        const matte = needCut ? SPOT.matteFrames({ dir: tmp, frames: list, out: dir, width: meta.width, height: meta.height, wait: 90, plate: !!want.plate,
            progress: (d, n) => { if (progress) progress('Cutting out the speaker ' + d + ' / ' + n); } }).catch((e) => ({ error: String(e && e.message || e) })) : null;
        try {
            for (let i = 0; i < list.length; i += CHUNK) {
                if (progress && !matte) progress('Reading the footage ' + Math.min(list.length, i + CHUNK) + ' / ' + list.length);
                // the list is contiguous (a clip's own range), so a chunk is a from-to
                await bridgeCall('track_frames', { subject: String(seg.itemId), from: list[i], to: list[Math.min(list.length, i + CHUNK) - 1], outDir: tmp, full: true }, 60000);
            }
            fs.writeFileSync(path.join(tmp, 'exported'), '1');
        } catch (e) {
            try { fs.writeFileSync(path.join(tmp, 'cancel'), '1'); } catch (e2) { /* the matte times out by itself */ }
            if (matte) await matte;
            throw e;
        }
        const info = Object.assign({ count: list.length, w: meta.width, h: meta.height }, have);
        if (matte) {
            const r = await matte;
            if (r.needInstall || r.error) return r;
            Object.assign(info, { cut: true, box: r.stats.box, headTop: r.stats.headTop, cx: r.stats.cx });
            if (want.plate) info.plate = true;
        }
        if (needFull) {
            list.forEach((f, i) => fs.copyFileSync(path.join(tmp, 'f' + f + '.jpg'), path.join(dir, 'f' + String(i).padStart(5, '0') + '.jpg')));
            info.full = true;
        }
        fs.writeFileSync(infoFile, JSON.stringify(info));
        prune();
        return Object.assign({ dir }, info);
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp */ }
    }
}

// A 3-frame running mean of a track's points (the tracker's box jitters by a pixel or two on a still shot).
function smoothTrack(pts) {
    return pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        return [Math.round((a[0] + p[0] + b[0]) / 3 * 1e5) / 1e5, Math.round((a[1] + p[1] + b[1]) / 3 * 1e5) / 1e5];
    });
}
// The patch the tracker follows: TRACK_BOX of the short side, centred on (x, y) and kept inside the picture.
function trackBox(x, y, w, h) {
    const side = TRACK_BOX * Math.min(w, h), bw = side / w, bh = side / h;
    const c = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const n = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : 0.5);
    return [c(n(x) - bw / 2, 0, 1 - bw), c(n(y) - bh / 2, 0, 1 - bh), bw, bh].map(v => Math.round(v * 1e4) / 1e4);
}

// Where the spot at (x, y) on frame `anchor` is on every frame of [a, b): the Track Subject tracker on small frames.
// -> { pts: [[x, y] per frame, 0..1], lost (share of frames the tracker lost it) } | { needInstall } | { error }
async function trackSpot(seg, a, b, anchor, x, y, meta, progress) {
    const { bridgeCall } = require('./fusion-bridge');
    const SPOT = require('./spotlight');
    const box = trackBox(x, y, meta.width, meta.height);
    const dir = path.join(CACHE_DIR, 't' + sha([seg.itemId, seg.file, seg.srcStartFrame, seg.tlStart, a, b, anchor, box]));
    const have = readJson(path.join(dir, 'track.json'));
    if (have && Array.isArray(have.pts) && have.pts.length === b - a) { try { fs.utimesSync(dir, new Date(), new Date()); } catch (e) { /* only for prune */ } return have; }
    if (!(await SPOT.spotEngine()).ready) return { needInstall: true };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elsa-broll-'));
    try {
        for (let f = a; f < b; f += 15) {
            if (progress) progress('Following the shot ' + Math.min(b - a, f - a + 15) + ' / ' + (b - a));
            await bridgeCall('track_frames', { subject: String(seg.itemId), from: f, to: Math.min(b, f + 15) - 1, outDir: tmp, maxDim: TRACK_DIM }, 60000);
        }
        const list = []; for (let f = a; f < b; f++) list.push(f);
        const r = await SPOT.venvJson('subject_tracker.py', { dir: tmp, frames: list, anchor, box });
        if (!r || r.needInstall || r.error || !r.track) return r && r.needInstall ? r : { error: (r && r.error) || 'the tracker gave no result' };
        const raw = list.map(f => r.track[String(f)] || null);
        if (raw.some(v => !v)) return { error: 'the tracker skipped frames' };
        const out = { pts: smoothTrack(raw.map(v => [Number(v[0]), Number(v[1])])), lost: Math.round(raw.filter(v => !v[4]).length / raw.length * 100) / 100 };
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'track.json'), JSON.stringify(out));
        prune();
        return out;
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp */ }
    }
}

// The ffmpeg arguments that turn a video into `count` backdrop frames at the timeline's rate, filling its size, looped
// when the video is shorter than the clip. only: just that frame (a preview).
function backdropArgs(file, outPattern, meta, count, only) {
    const vf = ['fps=' + meta.fps, 'scale=' + meta.width + ':' + meta.height + ':force_original_aspect_ratio=increase', 'crop=' + meta.width + ':' + meta.height];
    if (Number.isFinite(only)) vf.push("select='gte(n," + Math.max(0, Math.round(only)) + ")'");
    return ['-v', 'error', '-y', '-stream_loop', '-1', '-i', file, '-an', '-vf', vf.join(','), '-frames:v', String(Number.isFinite(only) ? 1 : count),
        '-q:v', '4', '-start_number', '0', outPattern];
}
// A video file as backdrop frames in the cache. -> { dir, count } | { error }
async function backdropFrames(file, frames, meta, only, progress) {
    const MEDIA = require('./media-analysis');
    const ff = MEDIA.ffmpegBin();
    if (!ff) return { error: 'ffmpeg was not found' };
    file = String(file).replace(/^file:\/\//, '').replace(/^~(?=\/)/, os.homedir());
    let st;
    try { st = fs.statSync(file); } catch (e) { return { error: 'The backdrop video was not found: ' + file }; }
    const count = Number.isFinite(only) ? 1 : frames;
    const dir = path.join(CACHE_DIR, 'v' + sha([file, st.size, st.mtimeMs, frames, meta.fps, meta.width, meta.height, Number.isFinite(only) ? only : 'all']));
    const have = readJson(path.join(dir, 'info.json'));
    if (have && have.count === count) { try { fs.utimesSync(dir, new Date(), new Date()); } catch (e) { /* only for prune */ } return { dir, count }; }
    fs.mkdirSync(dir, { recursive: true });
    if (progress) progress('Reading the backdrop video');
    const err = await new Promise((resolve) => execFile(ff, backdropArgs(file, path.join(dir, 'b%05d.jpg'), meta, count, only), { timeout: 180000 },
        (e, so, se) => resolve(e ? String(se || e.message).trim().split('\n').pop() : null)));
    const got = fs.readdirSync(dir).filter(n => /^b\d{5}\.jpg$/.test(n)).length;
    if (err || !got) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* cache */ } return { error: 'The backdrop video could not be read' + (err ? ' (' + err + ')' : '') }; }
    fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({ count: got }));
    prune();
    return { dir, count: got };
}

// A chosen picture with its background removed, cropped to the person. -> { image, box } | { needInstall } | { error }
async function photoCutout(image) {
    const SPOT = require('./spotlight');
    let st;
    try { st = fs.statSync(image); } catch (e) { return { error: 'The picture was not found: ' + image }; }
    const dir = path.join(CACHE_DIR, 'p' + sha([image, st.size, st.mtimeMs])), out = path.join(dir, 'crop.png');
    const have = readJson(path.join(dir, 'info.json'));
    if (have && fs.existsSync(out)) return { image: out, box: have.box };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elsa-broll-'));
    try {
        const prep = await SPOT.venvJson('broll_cutout.py', { op: 'prep', image, dir: tmp });
        if (prep.needInstall || prep.error) return prep;
        const m = await SPOT.matteFrames({ dir: tmp, frames: [0], out: tmp, width: prep.width, height: prep.height });
        if (m.needInstall || m.error) return m;
        fs.mkdirSync(dir, { recursive: true });
        const c = await SPOT.venvJson('broll_cutout.py', { op: 'crop', png: path.join(tmp, 'c00000.png'), out });
        if (c.error) return c;
        fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({ box: c.box }));
        prune();
        return { image: out, box: c.box };
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp */ }
    }
}

// Small frames of the timeline's own clips (9:16, 180 x 320), cached per file and moment.
async function thumbs(count, progress) {
    const MEDIA = require('./media-analysis');
    const ff = MEDIA.ffmpegBin();
    if (!ff) return [];
    const { timelineMedia } = require('./cut-tools');
    const media = await timelineMedia({});
    const dir = path.join(CACHE_DIR, 'thumbs');
    fs.mkdirSync(dir, { recursive: true });
    const out = [];
    const moments = thumbMoments(media.segments, count, MEDIA.sourceMapper);
    for (let i = 0; i < moments.length; i++) {
        const m = moments[i], file = path.join(dir, sha([m.file, m.t]) + '.jpg');
        if (!fs.existsSync(file)) {
            if (progress) progress('Reading clips ' + (i + 1) + ' / ' + moments.length);
            await new Promise((resolve) => execFile(ff, ['-v', 'error', '-y', '-ss', String(m.t), '-i', m.file, '-frames:v', '1',
                '-vf', 'scale=180:320:force_original_aspect_ratio=increase,crop=180:320', '-q:v', '5', file], { timeout: 20000 }, () => resolve()));
        }
        if (fs.existsSync(file)) out.push(file);
    }
    return out;
}

// The hidden props an effect gets from the footage under [start, start + frames).
// o.still: a preview frame (only the frame `o.still` is read, as a one-frame sequence); o.progress(text).
// -> { extra, notes }. Throws when an effect that is nothing without the footage cannot get it.
async function footageProps(effect, props, start, frames, meta, o) {
    o = o || {};
    const need = needsFor(effect, props);
    const extra = {}, notes = [];
    if (!need) return { extra, notes };
    const fail = (msg) => { if (need.soft) { notes.push(msg); return { extra, notes }; } throw new Error(msg); };
    if (require('./state').applying) return fail('Resolve is busy placing something: try again in a moment');
    const { timelineMedia } = require('./cut-tools');
    const still = Number.isFinite(o.still);
    const from = still ? o.still : start, to = still ? o.still + 1 : start + frames;
    const media = await timelineMedia({ startFrame: Math.min(from, start), endFrame: Math.max(to, start + Math.max(1, frames)) });

    if (need.samples && !still && !Array.isArray(props._samples)) {
        try {
            const s = await audioSamples(media, start, frames, props.audioTrack);
            if (s) extra._samples = s; else notes.push('no sound under the clip: it moves on a stand-in rhythm');
        } catch (e) { notes.push('the sound could not be read (' + e.message + '): it moves on a stand-in rhythm'); }
    }
    if (need.thumbs) {
        try { const t = await thumbs(need.thumbs, o.progress); if (t.length) extra._thumbs = t; } catch (e) { /* placeholders */ }
    }
    if (need.photo) {
        const r = await photoCutout(String(props.image));
        if (r.needInstall) notes.push('background not removed: ' + ENGINE_NOTE);
        else if (r.error) notes.push('background not removed: ' + r.error);
        else extra._image = r.image;
    }
    if (need.video) {
        // the backdrop is a video: its frames for the clip (one for a preview); the stage stands in when it fails
        const r = await backdropFrames(props.image, frames, meta, still ? o.still - start : undefined, o.progress);
        if (r.error) notes.push(r.error + ': the lit stage is used');
        else extra._bg = { dir: r.dir, count: r.count };
    }
    if (need.track) {
        if (still) return { extra, notes };            // a preview frame: the label is where it was put
        const seg = pickFootage(media.segments, Math.floor((from + to) / 2)) || pickFootage(media.segments, from);
        if (!seg) return fail('no footage under the clip: the label stays where it is put');
        const a = Math.max(from, seg.tlStart), b = Math.min(to, seg.tlEnd);
        if (b - a < 2) return { extra, notes };
        if ((b - a) / meta.fps > MAX_FULL_SECONDS) return fail('the clip is over ' + MAX_FULL_SECONDS + ' s: the label stays where it is put');
        // the label lands on frame `delay`: that is the frame the spot under it is picked on
        const anchor = Math.max(a, Math.min(b - 1, start + Math.max(0, Math.round(Number(props.delay) || 0))));
        const r = await trackSpot(seg, a, b, anchor, props.x, props.y, meta, o.progress);
        if (r.needInstall) return fail('the label does not follow the shot: ' + ENGINE_NOTE);
        if (r.error) return fail('the label does not follow the shot (' + r.error + ')');
        extra._track = { first: a - start, anchor: anchor - a, pts: r.pts };
        if (r.lost > 0.3) notes.push('the tracker lost the spot under the label on ' + Math.round(r.lost * 100) + '% of the frames: move the label onto something with more detail');
        return { extra, notes };
    }
    if (need.seq || need.full || need.still || need.outline) {
        const seg = pickFootage(media.segments, Math.floor((from + to) / 2)) || pickFootage(media.segments, from);
        if (!seg) return fail('There is no footage under the clip to read the speaker from');
        const a = Math.max(from, seg.tlStart), b = Math.min(to, seg.tlEnd);
        const cap = need.seq ? MAX_SEQ_SECONDS : MAX_FULL_SECONDS;
        if (!still && (b - a) / meta.fps > cap && (need.seq || need.full)) {
            return fail('This effect reads every frame of the footage: keep it under ' + cap + ' s (the clip is ' + ((b - a) / meta.fps).toFixed(1) + ' s)');
        }
        // one frame is enough for a cropped cut-out; an outline takes the start, the middle and the end
        let list = [];
        if (need.still) list = [a];
        else if (need.outline && !still) list = null;
        else for (let f = a; f < b; f++) list.push(f);
        const want = { cut: !!(need.seq || need.still || need.outline), full: !!need.full, plate: !!need.plate };
        const SPOT = require('./spotlight');
        if (list === null) {
            // three separate one-frame reads (start / middle / end) blended by the effect
            const picks = [...new Set([a, Math.floor((a + b - 1) / 2), b - 1])];
            const outs = [];
            for (const f of picks) {
                const r = await footageFrames(seg, [f], want, meta, o.progress);
                if (r.needInstall) return fail('outline not followed: ' + ENGINE_NOTE);
                if (r.error) return fail(r.error);
                const ol = await SPOT.venvJson('broll_cutout.py', { op: 'outline', dir: r.dir, picks: [0], points: OUTLINE_POINTS });
                if (ol && ol.outlines && ol.outlines[0]) outs.push({ at: f - start, pts: ol.outlines[0] });
            }
            if (outs.length) extra._outline = { at: outs.map(x => x.at), pts: outs.map(x => x.pts) };
            else notes.push('no person found in the footage: the oval is used');
            return { extra, notes };
        }
        const r = await footageFrames(seg, list, want, meta, o.progress);
        if (r.needInstall) return fail(ENGINE_NOTE);
        if (r.error) return fail(r.error);
        if (need.still) {
            const out = path.join(r.dir, 'crop.png');
            const c = fs.existsSync(out) && r.crop ? { box: r.crop } : await SPOT.venvJson('broll_cutout.py', { op: 'crop', png: path.join(r.dir, 'c00000.png'), out });
            if (c.error) return fail(c.error);
            if (!r.crop) fs.writeFileSync(path.join(r.dir, 'info.json'), JSON.stringify(Object.assign({}, readJson(path.join(r.dir, 'info.json')), { crop: c.box })));
            extra._image = out; extra._box = c.box;
        } else if (need.outline) {
            const ol = await SPOT.venvJson('broll_cutout.py', { op: 'outline', dir: r.dir, picks: [0], points: OUTLINE_POINTS });
            if (ol && ol.outlines && ol.outlines[0]) extra._outline = { at: [0], pts: [ol.outlines[0]] };
        } else {
            // first: the clip frame the sequence starts on (the footage may begin after the clip does)
            extra._seq = { dir: r.dir, count: r.count, first: a - start, cut: !!r.cut, full: !!r.full, plate: !!r.plate, w: r.w, h: r.h, box: r.box || null, headTop: r.headTop ?? null, cx: r.cx ?? null };
        }
    }
    return { extra, notes };
}

// At the end: the export list names consts, which must exist when it runs.
module.exports = { footageProps, needsFor, samplesFromDb, frameLevels, pickFootage, thumbMoments, smoothTrack, trackBox, backdropArgs, keepNewest, NEEDS, MAX_SEQ_SECONDS, MAX_FULL_SECONDS };
