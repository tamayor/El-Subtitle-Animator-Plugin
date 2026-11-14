// B-roll tab > Collage (js/library/broll/collage.js): the collage-style explainer B-roll of broll/collage/ in the panel.
// One project folder per timeline, "<footage folder>/El Subtitle Animator Collage/<timeline>/" (collage-plan.js says
// what is in it). The pane starts a project from the subtitles, edits its beats (what each shows, search words,
// date / label / title overlays), finds pictures on Wikimedia Commons (broll/collage/source-images.mjs) and picks
// them, previews the frame under the playhead and renders the clips with the B-roll tab's warm Remotion worker
// (broll.js renderJob; compositions collage-track and collage-captions), then places them over the talking head:
// B-roll and titles on one video track, the word captions on the one above. Placing again swaps the media of the
// collage clips already on the timeline (same start and length: ReplaceClip; otherwise a new clip in the old one's
// place) and takes off the ones the plan no longer has. Progress goes to the panel as collage:progress.

module.exports = {
    collageState, collageStart, collageWords, collageBeat, collageFind, collageCandidates, collagePick,
    collageStill, collageRender, collagePlace, collageOpen, collageCancel, collageSources, collageAuto, collageAutoStatus, collageContext, collageReset,
    collageAddPicture, collageEvidence
};

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');

const state = require('./state');
const { APP_DATA_DIR, DATA_DIR, SFX_ORIG_DIR } = require('./config');
const { dlog } = require('./log');
const { findItemsByIds, getSubtitles, tcToFrame } = require('./resolve');
const { timelineSfxDir } = require('./sfx-import');
const { pickTrack } = require('./placement');
const PLAN = require('./collage-plan');

const ROOT_DIR = 'El Subtitle Animator Collage';
const PREVIEW_DIR = path.join(APP_DATA_DIR, 'collage-previews');
// Stock-site API keys (Sources & API keys): on this computer only, never in the project folder (it may be shared).
const SOURCES_FILE = path.join(APP_DATA_DIR, 'collage-sources.json');
const SOURCE_SITES = { pexels: 'PEXELS_API_KEY', pixabay: 'PIXABAY_API_KEY' };
// Pages the pane may open in the browser: a candidate's source page, the sites' API key pages.
const OPEN_OK = /^https:\/\/(commons\.wikimedia\.org|(www\.)?pexels\.com|pixabay\.com|www\.google\.com\/search\?)/;
const OVERLAY_TYPES = ['date', 'label', 'title', 'callout', 'highlight'];
// The sounds for each cue kind (collage-plan.js sfxCuesOf), matched by name in the SFX Originals Library (sounds/original),
// first match first; copies of a kind take turns through its matches, so a run of cards does not repeat one whoosh.
const SFX_SOUNDS = {
    whoosh: ['quick-whoosh', 'swoosh-015', 'whoosh-short', 'swoosh-026', 'simple-whoosh', 'short-swoosh', 'whoosh', 'swoosh'],
    hit: ['punchy-bass-hit', 'thud-impact', 'hit', 'thud', 'impact'],
    pop: ['clean-minimal-pop', 'bubble-pop', 'soft-ui-pop', 'pop'],
    click: ['soft-ui-click', 'soft-interface-click', 'button-tap', 'click', 'tap'],
    marker: ['highlighter', 'pencil', 'marker']
};
const SFX_FALLBACK = { hit: 'whoosh', marker: 'click', pop: 'click', click: 'pop' };

let busy = null;            // what the pane is doing: 'find' | 'words' | 'still' | 'render' | 'place' | 'auto'
let cancelAsked = false;
let findProc = null;       // the source-images.mjs run (find / a clip download), killed by Cancel

const broll = () => require('./broll');
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }
function writeJson(file, v) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(v, null, 1) + '\n'); }
let lastProgress = null;  // the last progress message, for collage_auto { status: true }
let autoJob = null;        // the Auto-fill run: { promise, result, error, startedAt }
function send(msg) {
    lastProgress = msg;
    try { if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.webContents.send('collage:progress', msg); } catch (e) { /* panel gone */ }
}
function fileUrl(file) {
    try { return pathToFileURL(file).href + '?v=' + Math.round(fs.statSync(file).mtimeMs); } catch (e) { return null; }
}
function dataUrl(file) { try { return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'); } catch (e) { return null; } }
function sameFile(a, b) {
    try {
        if (fs.statSync(a).size !== fs.statSync(b).size) return false;
        return fs.readFileSync(a).equals(fs.readFileSync(b));
    } catch (e) { return false; }
}
// The start of a picture's file, where its size is (a JPEG's EXIF before it is at most 64 KB).
function headOf(file) {
    let fd = null;
    try {
        fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(262144);
        return buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0));
    } catch (e) { return null; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* ignore */ } } }
}
async function guard(what, fn) {
    if (busy) throw new Error('The Collage pane is still busy (' + busy + '). Wait for it, or Cancel.');
    busy = what; cancelAsked = false;
    try { return await fn(); } finally { busy = null; }
}

// Run broll/collage/source-images.mjs with the system's Node (and the stock-site keys); each JSON line it prints goes
// to onLine. Rejects with its last error line.
async function runScript(args, onLine) {
    const node = broll().findNode();
    if (!node) throw new Error('Finding pictures needs Node.js 18 or newer (nodejs.org, or brew install node).');
    const script = path.join(broll().brollDir(), 'collage', 'source-images.mjs');
    if (!fs.existsSync(script)) throw new Error('Missing ' + script);
    const env = { ...process.env, PATH: path.dirname(node) + ':' + (process.env.PATH || '/usr/bin:/bin') + ':/opt/homebrew/bin:/usr/local/bin' };
    const keys = readJson(SOURCES_FILE, {}) || {};
    for (const [site, name] of Object.entries(SOURCE_SITES)) { if (keys[site]) env[name] = keys[site]; else delete env[name]; }
    await new Promise((resolve, reject) => {
        const proc = findProc = spawn(node, [script, ...args], { cwd: path.dirname(script), env });
        let buf = '', err = '';
        proc.stdout.on('data', d => {
            buf += d.toString();
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
                let r = null;
                try { r = JSON.parse(line); } catch (e) { continue; }
                if (r) onLine(r);
            }
        });
        proc.stderr.on('data', d => { err = (err + d.toString()).slice(-2000); });
        proc.on('error', reject);
        proc.on('close', code => {
            findProc = null;
            if (cancelAsked) reject(new Error('Cancelled'));
            else if (code === 0) resolve();
            else reject(new Error((err.trim().split('\n').filter(l => /error/i.test(l)).pop() || err.trim().split('\n').pop() || 'code ' + code).replace(/^\s*(Error:\s*)+/, '')));
        });
    });
}

// The stock-site keys: o.set = { pexels, pixabay } saves them ('' takes one off). The panel only gets whether each
// is set and its last 4 characters.
function collageSources(event, o) {
    const keys = readJson(SOURCES_FILE, {}) || {};
    if (o && o.set && typeof o.set === 'object') {
        for (const site of Object.keys(SOURCE_SITES)) {
            if (o.set[site] === undefined) continue;
            const v = String(o.set[site] || '').trim();
            if (v) keys[site] = v; else delete keys[site];
        }
        writeJson(SOURCES_FILE, keys);
        try { fs.chmodSync(SOURCES_FILE, 0o600); } catch (e) { /* only tightens it */ }
    }
    const out = { commons: { set: true } };
    for (const site of Object.keys(SOURCE_SITES)) out[site] = keys[site] ? { set: true, hint: '…' + keys[site].slice(-4) } : { set: false };
    return out;
}

// ------------------------------------------------------------------ the project

async function projectFor() {
    const t = await broll().currentTl();
    const footage = await timelineSfxDir(t.project);
    const dir = path.join(footage || DATA_DIR, ROOT_DIR, PLAN.safeName(t.name));
    const tlStart = Number(await t.tl.GetStartFrame()) || 0;
    return { ...t, dir, tlStart };
}
const shotsFile = (p) => path.join(p.dir, 'shots.json');
function shotsOf(p) {
    const s = readJson(shotsFile(p), null);
    if (!s || !Array.isArray(s.beats)) throw new Error('No beat plan for this timeline yet: press Auto-fill (or ask Claude to plan the collage).');
    return s;
}
function sizeFor(p, shots) {
    return { W: (shots && shots.width) || p.meta.width, H: (shots && shots.height) || p.meta.height, FPS: (shots && shots.fps) || p.meta.fps };
}

const clipsFile = (p) => path.join(p.dir, 'assets', 'clips.json');
const isVideo = PLAN.isVideoName;

function beatView(p, b) {
    const candDir = b.candidatesDir || b.id;
    const cj = readJson(path.join(p.dir, 'candidates', candDir, 'candidates.json'), null);
    const clips = readJson(clipsFile(p), {}) || {};
    const fps = (readJson(shotsFile(p), {}) || {}).fps || p.meta.fps;
    return {
        id: b.id, frames: b.frames, line: b.line || '', visual: b.visual || 'talking-head', brief: b.brief || [], queries: b.queries || [], auto: !!b.auto,
        evidence: b.visual === 'document' ? { highlights: b.highlights || [], zoom: b.zoom || null, blurOn: !!b.blurOn, blurAuto: b.blurAuto || [],
            blurBoxes: b.blurBoxes || [], blurStrength: b.blurStrength || 50, said: (b.found && b.found.said) || [], blurred: (b.found && b.found.blurred) || [], scanned: !!b.scanned, error: b.scanError || '' } : null,
        overlays: b.overlays || [], illustration: b.illustration || '', note: b.note || '', clipStart: b.clipStart || 0,
        assets: PLAN.assetsFor(b).map(n => {
            if (!isVideo(n)) return { name: n, url: fileUrl(path.join(p.dir, 'assets', n)) };
            const c = clips[n] || {};
            // a clip shows its poster; max = the latest start that still fills the beat
            return { name: n, video: true, duration: c.duration || 0, url: c.poster ? fileUrl(path.join(p.dir, 'assets', c.poster)) : null,
                max: PLAN.clampClipStart(1e9, c.duration, b.frames[1] - b.frames[0], fps) };
        }),
        need: PLAN.pictureNeed(b), candidates: cj ? (cj.candidates || []).length : 0
    };
}

function stateOf(p) {
    const shots = readJson(shotsFile(p), null);
    const tr = readJson(path.join(p.dir, 'transcript.json'), null);
    const plan = readJson(path.join(p.dir, 'render', 'plan.json'), null);
    const beats = shots && Array.isArray(shots.beats) ? shots.beats : [];
    const { W, H, FPS } = sizeFor(p, shots);
    const notes = [];
    if (shots && (W !== p.meta.width || H !== p.meta.height)) notes.push('The plan is ' + W + '×' + H + ' and the timeline ' + p.meta.width + '×' + p.meta.height + ': the clips render at the plan\'s size.');
    return {
        ok: true, timeline: p.name, dir: p.dir, exists: fs.existsSync(p.dir), hasPlan: !!shots, width: W, height: H, fps: FPS,
        tlStart: p.tlStart, script: fs.existsSync(path.join(p.dir, 'script.txt')), context: (shots && shots.context) || '',
        words: tr ? { count: (tr.words || []).length, engine: tr.engine || '' } : null,
        beats: beats.map(b => beatView(p, b)),
        segments: PLAN.segmentsOf(beats),
        missingPictures: beats.reduce((n, b) => n + PLAN.pictureNeed(b).missing, 0),
        clips: plan ? (plan.clips || []).map(c => ({ role: c.role, start: c.start, frames: c.frames, file: path.basename(c.file), exists: fs.existsSync(c.file) })) : [],
        visuals: PLAN.VISUALS, busy, notes, sources: collageSources(),
        sfxCues: shots ? PLAN.sfxCuesOf(beats, { fps: FPS }).length : 0
    };
}

async function collageState() { return stateOf(await projectFor()); }

// Start a project from the timeline: the script from its subtitles, word timings (the transcription when the Cut tab /
// Activate word timings made one, else estimated from the subtitles) and one talking-head beat per subtitle. Files
// that are already there are kept.
// The subtitles the collage is planned from: only the subtitle tracks that are switched on, so an old or duplicate track
// left on the timeline (turned off) does not double every line. All tracks when none is on.
async function activeSubtitles(tl) {
    const subs = (await getSubtitles(tl, true)) || [];
    const tracks = [...new Set(subs.map(s => s.track))];
    if (tracks.length < 2) return subs;
    const on = [];
    for (const t of tracks) {
        let e = true;
        try { e = (await tl.GetIsTrackEnabled('subtitle', t)) !== false; } catch (err) { /* assume on */ }
        if (e) on.push(t);
    }
    return on.length ? subs.filter(s => on.includes(s.track)) : subs;
}

async function collageStart() {
    return guard('start', async () => startInner(await projectFor()));
}
async function startInner(p) {
    {
        const subs = await activeSubtitles(p.tl);
        if (!subs || !subs.length) throw new Error('This timeline has no subtitles. Add them (or import the SRT) first: the collage is planned from what is said.');
        for (const d of ['assets', 'candidates', 'render', 'brand']) fs.mkdirSync(path.join(p.dir, d), { recursive: true });
        const made = [];
        const script = path.join(p.dir, 'script.txt');
        if (!fs.existsSync(script)) { fs.writeFileSync(script, subs.map(s => String(s.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ') + '\n'); made.push('script.txt'); }
        if (!fs.existsSync(path.join(p.dir, 'transcript.json'))) { await writeWords(p, subs, true); made.push('transcript.json'); }
        if (!fs.existsSync(shotsFile(p))) {
            writeJson(shotsFile(p), {
                project: p.name, timeline: p.name, width: p.meta.width, height: p.meta.height, fps: p.meta.fps, brand: 'brand/brand.json',
                beats: PLAN.beatsFromSubtitles(subs, p.tlStart, Math.round(p.meta.fps * 1.5))
            });
            made.push('shots.json');
        }
        const brand = path.join(p.dir, 'brand', 'brand.json');
        if (!fs.existsSync(brand)) writeJson(brand, { note: 'brand kit for this video; laid over broll/src/collage/brand.ts DEFAULT_BRAND' });
        dlog('COLLAGE-START', p.dir, made.join(','));
        return { ...stateOf(p), made };
    }
}

async function writeWords(p, subs, cachedOnly) {
    let words = [], engine = '';
    const tlEnd = Number(await p.tl.GetEndFrame()) || (p.tlStart + Math.max(...subs.map(s => s.end - p.tlStart)));
    try {
        const r = await require('./anim-timing').spokenWordsFor(p.tlStart, tlEnd, cachedOnly ? { cachedOnly: true } : undefined);
        words = (r.words || []).map(w => ({ w: w.w, start: Math.round(w.start * 100) / 100, end: Math.round(w.end * 100) / 100 }));
        engine = 'transcription';
    } catch (e) {
        if (!cachedOnly) throw e;
    }
    if (!words.length) { words = PLAN.wordsFromSubtitles(subs, p.tlStart); engine = 'estimated from the subtitles'; }
    writeJson(path.join(p.dir, 'transcript.json'), { timeline: p.name, fps: p.meta.fps, unit: 'timeline frames', engine, words });
    return { count: words.length, engine };
}

// Word timings from the transcription (it may take a few minutes the first time).
async function collageWords() {
    return guard('words', async () => {
        const p = await projectFor();
        if (!fs.existsSync(p.dir)) throw new Error('Start the project first.');
        send({ phase: 'words', text: 'Reading the word timings (a first transcription takes a few minutes)…' });
        const r = await writeWords(p, await activeSubtitles(p.tl), false);
        send({ phase: 'done', text: r.count + ' words timed from the ' + r.engine + '.' });
        return stateOf(p);
    });
}

// One beat's settings: visual, search words (queries), overlays, pictures in use (assets, in order). -> the pane's
// state, with the beat as `beat`.
async function collageBeat(event, o) {
    o = o || {};
    const p = await projectFor();
    const shots = shotsOf(p);
    const b = shots.beats.find(x => x.id === o.id);
    if (!b) throw new Error('No beat "' + o.id + '" in the plan.');
    patchBeat(p, shots, b, o.patch || {});
    delete b.auto;          // set up by hand now: Auto-fill leaves it alone
    writeJson(shotsFile(p), shots);
    return { ...stateOf(p), beat: beatView(p, b) };
}

// visual, queries (search words), overlays, assets (pictures in use, in order), clipStart.
function patchBeat(p, shots, b, q) {
    const rects = (v) => (Array.isArray(v) ? v : []).filter(r => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite))
        .map(r => r.map(n => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000)).slice(0, 20);
    if (q.blur !== undefined) b.blurOn = !!q.blur;
    if (q.blurStrength !== undefined && Number.isFinite(Number(q.blurStrength))) b.blurStrength = Math.round(Math.min(100, Math.max(1, Number(q.blurStrength))));
    if (q.blurBoxes !== undefined) b.blurBoxes = rects(q.blurBoxes);
    if (q.highlights !== undefined) { b.highlights = rects(q.highlights); b.zoom = PLAN.zoomFor(b.highlights); }
    if (q.zoom !== undefined) b.zoom = q.zoom === false || q.zoom === null ? null : rects([q.zoom])[0] || null;
    if (q.visual !== undefined) {
        if (!PLAN.VISUALS.includes(q.visual)) throw new Error('Unknown visual "' + q.visual + '"');
        b.visual = q.visual;
    }
    if (Array.isArray(q.queries)) b.queries = q.queries.map(s => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10);
    if (Array.isArray(q.overlays)) {
        b.overlays = q.overlays.filter(x => x && OVERLAY_TYPES.includes(x.type)).map(x => {
            const y = { ...x };
            if (y.text !== undefined) y.text = String(y.text).slice(0, 80);
            if (y.sub !== undefined) y.sub = String(y.sub).slice(0, 80);
            return y;
        });
    }
    if (Array.isArray(q.assets)) b.assets = q.assets.filter(n => typeof n === 'string' && (b.assets || []).includes(n));
    if (q.clipStart !== undefined) {
        const c = (readJson(clipsFile(p), {}) || {})[(b.assets || [])[0]] || {};
        b.clipStart = PLAN.clampClipStart(q.clipStart, c.duration, b.frames[1] - b.frames[0], shots.fps || p.meta.fps);
    }
}

// ------------------------------------------------------------------ pictures (Wikimedia Commons)

// Search Commons for the beats (ids), or every picture beat still missing pictures. A beat needs search words or a
// brief. -> the pane's state, plus { found: [{ beat, kept, dropped }], skipped: [ids without search words] }
async function collageFind(event, o) {
    o = o || {};
    return guard('find', async () => findInner(await projectFor(), o.beats));
}
async function findInner(p, beatIds) {
    {
        const shots = shotsOf(p);
        const wanted = Array.isArray(beatIds) && beatIds.length ? beatIds
            : shots.beats.filter(b => PLAN.pictureNeed(b).missing > 0).map(b => b.id);
        const ids = [], skipped = [];
        for (const id of wanted) {
            const b = shots.beats.find(x => x.id === id);
            if (!b) continue;
            const words = (b.queries && b.queries.length ? b.queries : b.brief) || [];
            // source-images.mjs searches photo / stack / document beats, and any beat with its own search words
            if (!words.length || (!['photo', 'stack', 'document', 'clip'].includes(b.visual) && !(b.queries && b.queries.length))) skipped.push(id); else ids.push(id);
        }
        if (!ids.length) throw new Error(skipped.length ? 'Add search words to ' + skipped.join(', ') + ' first.' : 'Every picture beat has its pictures.');
        const found = [];
        const keys = collageSources();
        const where = ['Wikimedia Commons', keys.pexels.set ? 'Pexels' : '', keys.pixabay.set ? 'Pixabay' : ''].filter(Boolean).join(', ');
        send({ phase: 'find', p: 0, text: 'Searching ' + where + ' for ' + ids.join(', ') + '…' });
        await runScript([p.dir, ...ids], (r) => {
            if (!r.beat) return;
            found.push({ beat: r.beat, kept: r.kept, dropped: r.dropped });
            send({ phase: 'find', p: found.length / ids.length, text: r.beat + ': ' + r.kept + ' found (' + found.length + ' of ' + ids.length + ')…', beat: r.beat });
        });
        // a stock site that refused the key says so (the search itself carries on with the others)
        const keyTrouble = new Set();
        for (const f of found) {
            const b = shots.beats.find(x => x.id === f.beat);
            const cj = readJson(path.join(p.dir, 'candidates', (b && b.candidatesDir) || f.beat, 'candidates.json'), {}) || {};
            for (const d of cj.dropped || []) { const m = /^(Pexels|Pixabay) \d+ .*check the API key/.exec(d.why || ''); if (m) keyTrouble.add(m[1]); }
        }
        const n = found.reduce((s, f) => s + (f.kept || 0), 0);
        send({ phase: 'done', text: n + ' picture' + (n === 1 ? '' : 's') + ' or clip' + (n === 1 ? '' : 's') + ' found for ' + found.length + ' beat' + (found.length === 1 ? '' : 's') + '. Open a beat to pick.' + (skipped.length ? ' No search words: ' + skipped.join(', ') + '.' : '') +
            (keyTrouble.size ? ' ' + [...keyTrouble].join(' and ') + ' refused the API key: check it in Sources & API keys.' : '') });
        return { ...stateOf(p), found, skipped };
    }
}

// A beat's candidates: [{ file, url, title, creator, license, page, width, height, picked }]
async function collageCandidates(event, o) {
    const p = await projectFor();
    const b = shotsOf(p).beats.find(x => x.id === (o && o.beat));
    if (!b) throw new Error('No beat "' + (o && o.beat) + '"');
    const candDir = b.candidatesDir || b.id;
    const dir = path.join(p.dir, 'candidates', candDir);
    const cj = readJson(path.join(dir, 'candidates.json'), null);
    const used = (b.assets || []).map(n => path.join(p.dir, 'assets', n)).filter(f => fs.existsSync(f));
    const clips = readJson(clipsFile(p), {}) || {};
    const usedClips = (b.assets || []).filter(isVideo).map(n => (clips[n] || {}).title).filter(Boolean);
    const list = ((cj && cj.candidates) || []).filter(c => fs.existsSync(path.join(dir, c.file))).map(c => ({
        file: c.file, url: fileUrl(path.join(dir, c.file)), title: String(c.title || '').replace(/^File:/, ''), creator: c.creator || '',
        license: c.license || '', page: c.page || '', width: c.width, height: c.height, date: c.date || '', source: c.source || 'Wikimedia Commons',
        duration: c.video ? c.video.duration : undefined, video: !!c.video,
        picked: c.video ? usedClips.includes(c.title) : used.some(u => sameFile(u, path.join(dir, c.file)))
    }));
    return { beat: b.id, queries: (cj && cj.queries) || [], candidates: list, dropped: ((cj && cj.dropped) || []).length };
}

// Pick a candidate (on: true): copied into assets/ as <folder>-NN.jpg, added to the beat and credited in credits.csv.
// on: false takes it (or `asset`, a picture in use) off the beat; its credit goes when no beat uses it.
async function collagePick(event, o) {
    return pickInner(await projectFor(), o || {});
}
async function pickInner(p, o) {
    const shots = shotsOf(p);
    const b = shots.beats.find(x => x.id === o.beat);
    if (!b) throw new Error('No beat "' + o.beat + '"');
    const candDir = b.candidatesDir || b.id;
    const src = o.file ? path.join(p.dir, 'candidates', candDir, path.basename(String(o.file))) : null;
    const creditsFile = path.join(p.dir, 'credits.csv');
    const credits = () => { try { return fs.readFileSync(creditsFile, 'utf8'); } catch (e) { return ''; } };
    b.assets = b.assets || [];
    if (!o.inRun) delete b.auto;          // picked by hand: Auto-fill leaves it alone
    const cj = readJson(path.join(p.dir, 'candidates', candDir, 'candidates.json'), {});
    const cand = src ? ((cj && cj.candidates) || []).find(x => x.file === path.basename(src)) : null;
    if (o.on && cand && cand.video) {
        const get = () => pickClip(p, shots, b, candDir, cand, creditsFile, credits);
        return o.inRun ? await get() : await guard('clip', get);
    }
    if (!o.on && cand && cand.video) {
        const clips = readJson(clipsFile(p), {}) || {};
        o = { ...o, asset: b.assets.find(n => isVideo(n) && (clips[n] || {}).title === cand.title) || o.asset };
    }
    if (o.on) {
        if (!src || !fs.existsSync(src)) throw new Error('That picture is gone: find pictures again.');
        let name = PLAN.candidateAsset(candDir, path.basename(src));
        const ext = path.extname(name), stem = name.slice(0, -ext.length);
        for (let k = 2; fs.existsSync(path.join(p.dir, 'assets', name)) && !sameFile(path.join(p.dir, 'assets', name), src); k++) name = stem + '-' + k + ext;
        const dest = path.join(p.dir, 'assets', name);
        if (!fs.existsSync(dest)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); }
        if (!b.assets.includes(name)) b.assets.push(name);
        fs.writeFileSync(creditsFile, PLAN.withCredit(credits(), b.id, name, cand));
        if (b.visual === 'document' && PLAN.assetsFor(b)[0] === name) await scanEvidence(p, b);
    } else {
        const name = o.asset ? String(o.asset) : b.assets.find(n => src && sameFile(path.join(p.dir, 'assets', n), src));
        if (name) {
            b.assets = b.assets.filter(n => n !== name);
            if (!shots.beats.some(x => (x.assets || []).includes(name)) && fs.existsSync(creditsFile)) fs.writeFileSync(creditsFile, PLAN.withoutCredit(credits(), name));
        }
    }
    writeJson(shotsFile(p), shots);
    return { ...stateOf(p), beat: beatView(p, b) };
}

// A clip candidate picked: its video downloaded and converted (source-images.mjs --clip) into assets/<folder>-NN.mp4,
// its poster kept as assets/_posters/<name>.jpg and its size, length and source in assets/clips.json. A clip beat
// plays one clip, so it replaces the one the beat had.
async function pickClip(p, shots, b, candDir, cand, creditsFile, credits) {
    {
        const name = PLAN.candidateAsset(candDir, cand.file).replace(/\.\w+$/, '.mp4');
        const out = path.join(p.dir, 'assets', name);
        const clips = readJson(clipsFile(p), {}) || {};
        if (!(fs.existsSync(out) && clips[name] && clips[name].title === cand.title)) {
            send({ phase: 'find', text: 'Getting the clip for ' + b.id + '…' });
            let meta = null;
            await runScript([p.dir, '--clip', b.id, cand.file, out, '90'], (r) => {
                if (r.done) meta = r; else if (r.text) send({ phase: 'find', text: r.text + '…' });
            });
            if (!meta || !fs.existsSync(out)) throw new Error('The clip could not be converted.');
            const poster = path.join('_posters', name.replace(/\.mp4$/, '.jpg'));
            fs.mkdirSync(path.join(p.dir, 'assets', '_posters'), { recursive: true });
            try { fs.copyFileSync(path.join(p.dir, 'candidates', candDir, cand.file), path.join(p.dir, 'assets', poster)); } catch (e) { /* no poster */ }
            clips[name] = { w: meta.w, h: meta.h, duration: meta.duration, title: cand.title, page: cand.page, source: cand.source || 'Wikimedia Commons', poster };
            writeJson(clipsFile(p), clips);
        }
        // the beat's pictures stay (for when it is switched back to a photo); its earlier clip goes
        const before = (b.assets || []).filter(n => isVideo(n) && n !== name);
        b.assets = [...(b.assets || []).filter(n => !isVideo(n)), name];
        b.clipStart = PLAN.clampClipStart(b.clipStart, clips[name].duration, b.frames[1] - b.frames[0], shots.fps || p.meta.fps);
        let text = PLAN.withCredit(credits(), b.id, name, cand);
        for (const n of before) if (!shots.beats.some(x => x !== b && (x.assets || []).includes(n))) text = PLAN.withoutCredit(text, n);
        fs.writeFileSync(creditsFile, text);
        writeJson(shotsFile(p), shots);
        send({ phase: 'done', text: 'Clip ready for ' + b.id + ' (' + Math.round(clips[name].duration) + ' s).' });
        return { ...stateOf(p), beat: beatView(p, b) };
    }
}

// ------------------------------------------------------------------ evidence: a real post, banner or tarpaulin

// vision-scan.swift (broll/collage/) compiled once into the app's data folder, again when the source changes.
const SCAN_BIN = path.join(APP_DATA_DIR, 'bin', 'vision-scan');
let commonWords = null;
function execP(cmd, args, ms) {
    return new Promise((resolve, reject) => execFile(cmd, args, { timeout: ms, maxBuffer: 8 << 20 }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim().split('\n').pop())) : resolve(out))));
}
async function visionScan(file) {
    const src = path.join(broll().brollDir(), 'collage', 'vision-scan.swift');
    const stale = !fs.existsSync(SCAN_BIN) || (fs.existsSync(src) && fs.statSync(src).mtimeMs > fs.statSync(SCAN_BIN).mtimeMs);
    if (stale) {
        if (!fs.existsSync(src)) throw new Error('Missing ' + src);
        fs.mkdirSync(path.dirname(SCAN_BIN), { recursive: true });
        send({ phase: 'scan', text: 'Setting up the picture scanner (once)…' });
        await execP('/usr/bin/swiftc', ['-O', src, '-o', SCAN_BIN], 180000);
    }
    const r = JSON.parse(await execP(SCAN_BIN, [file], 120000));
    if (r.error) throw new Error(r.error);
    return r;
}
function common() {
    if (!commonWords) {
        try { commonWords = new Set(fs.readFileSync('/usr/share/dict/words', 'utf8').split('\n').filter(w => w && w === w.toLowerCase())); } catch (e) { commonWords = new Set(); }
    }
    return commonWords;
}

// Scan a document beat's picture: highlights on the words its line says, the zoom onto them, and the names, faces and
// hashtags it could blur (blurAuto, used when the beat's Blur switch is on). Hand-drawn blur boxes stay.
async function scanEvidence(p, b) {
    const n = PLAN.assetsFor(b)[0];
    if (!n) return null;
    send({ phase: 'scan', text: 'Reading the words and faces on ' + b.id + '\'s picture…' });
    let scan;
    try { scan = await visionScan(path.join(p.dir, 'assets', n)); } catch (e) { b.scanError = String(e.message || e); return null; }
    const shots = readJson(shotsFile(p), {}) || {};
    const e = PLAN.evidencePlan(scan, { line: b.line, common: common(), keep: String(shots.context || '').split(/\s+/) });
    Object.assign(b, { highlights: e.highlights, zoom: e.zoom, blurAuto: e.blurs, scanned: n, found: e.found });
    delete b.scanError;
    if (b.blurOn === undefined) b.blurOn = false;
    return e;
}

// Your own picture on a beat (a file chosen, dropped or pasted: dataUrl; or dragged from a browser: url). Copied into
// assets/ as <beat>-own-N.<ext>, credited "supplied by the editor (rights to confirm)", and the beat becomes a Document:
// the said words highlighted and zoomed, blurs found but off.
async function collageAddPicture(event, o) {
    o = o || {};
    return guard('add', async () => {
        const p = await projectFor();
        const shots = shotsOf(p);
        const b = shots.beats.find(x => x.id === o.beat);
        if (!b) throw new Error('No beat "' + o.beat + '"');
        let buf, ext, from = 'your file';
        const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(o.dataUrl || ''));
        if (m) { buf = Buffer.from(m[2], 'base64'); ext = m[1].toLowerCase() === 'png' ? '.png' : m[1].toLowerCase() === 'webp' ? '.webp' : '.jpg'; } else if (/^https:\/\//.test(String(o.url || ''))) {
            send({ phase: 'add', text: 'Downloading the picture…' });
            const r = await fetch(String(o.url), { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
            const type = r.headers.get('content-type') || '';
            if (!r.ok || !/^image\/(png|jpe?g|webp)/i.test(type)) throw new Error('That link is not a picture (' + (r.ok ? type || 'unknown type' : r.status) + '). Save the picture and drop the file instead.');
            buf = Buffer.from(await r.arrayBuffer());
            ext = /png/i.test(type) ? '.png' : /webp/i.test(type) ? '.webp' : '.jpg';
            from = String(o.url);
        } else throw new Error('No picture: choose a file, drop one, or paste one.');
        if (buf.length > 40e6) throw new Error('The picture is over 40 MB.');
        const size = PLAN.imageSize(buf);
        if (!size) throw new Error('Could not read that picture.');
        let k = 1;
        while (fs.existsSync(path.join(p.dir, 'assets', b.id + '-own-' + k + ext))) k++;
        const name = b.id + '-own-' + k + ext;
        fs.mkdirSync(path.join(p.dir, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(p.dir, 'assets', name), buf);
        const creditsFile = path.join(p.dir, 'credits.csv');
        let credits = ''; try { credits = fs.readFileSync(creditsFile, 'utf8'); } catch (e) { /* none yet */ }
        fs.writeFileSync(creditsFile, PLAN.withCredit(credits, b.id, name, { title: o.name || name, source: 'supplied by the editor', license: 'rights to confirm',
            page: /^https:/.test(from) ? from : '', width: size.w, height: size.h }));
        b.visual = 'document';
        b.assets = [name, ...(b.assets || []).filter(x => x !== name)];
        delete b.auto;
        delete b.blurOn;
        b.blurBoxes = [];
        await scanEvidence(p, b);
        writeJson(shotsFile(p), shots);
        const said = (b.found && b.found.said) || [];
        send({ phase: 'done', text: 'Picture added to ' + b.id + (said.length ? ': highlight and zoom on “' + said.join('”, “') + '”' : ': no spoken words found on it (draw a highlight in the viewer)') + '.' });
        return { ...stateOf(p), beat: beatView(p, b) };
    });
}

// A document beat's evidence: blur (the switch), blurBoxes / highlights drawn in the viewer, zoom, rescan.
async function collageEvidence(event, o) {
    o = o || {};
    const p = await projectFor();
    const shots = shotsOf(p);
    const b = shots.beats.find(x => x.id === o.beat);
    if (!b) throw new Error('No beat "' + o.beat + '"');
    if (o.rescan) await guard('scan', () => scanEvidence(p, b));
    patchBeat(p, shots, b, o);
    delete b.auto;
    writeJson(shotsFile(p), shots);
    return { ...stateOf(p), beat: beatView(p, b) };
}

// ------------------------------------------------------------------ reset

// Back to an empty project: the plan, word timings, script, pictures found and picked, credits and brand move to
// _old/<date time>/ in the project folder (nothing is deleted). render/ stays: clips placed on the timeline play from it.
async function collageReset() {
    return guard('reset', async () => {
        const p = await projectFor();
        const keep = new Set(['render', '_old']);
        const names = fs.existsSync(p.dir) ? fs.readdirSync(p.dir).filter(n => !keep.has(n) && !n.startsWith('.')) : [];
        if (names.length) {
            const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
            const to = path.join(p.dir, '_old', stamp);
            fs.mkdirSync(to, { recursive: true });
            for (const n of names) fs.renameSync(path.join(p.dir, n), path.join(to, n));
            dlog('COLLAGE-RESET', p.dir, '->', to);
        }
        autoJob = null;
        return { ...stateOf(p), moved: names.length };
    });
}

// ------------------------------------------------------------------ Auto-fill (panel button, MCP collage_auto)

// The project's context ("Philippines", "1960s surfing"): added to every picture search (source-images.mjs). Saved in
// shots.json; with no project yet the panel keeps it and passes it to Auto-fill.
async function collageContext(event, o) {
    const p = await projectFor();
    if (!fs.existsSync(shotsFile(p))) return stateOf(p);
    const shots = shotsOf(p);
    shots.context = String((o && o.context) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    writeJson(shotsFile(p), shots);
    return stateOf(p);
}

// The whole set-up in one run, instead of beat by beat: starts the project if there is none; joins the untouched
// one-subtitle beats into thoughts and gives the strongest of them B-roll (PLAN.autoPlanBeats: what to search, date and
// name tags), or applies o.beats (Claude's plan: [{ id, visual, queries, overlays, brief }]) instead; searches every
// beat still missing pictures (pictures found before are reused); picks the first candidates no other beat uses; puts a
// beat nothing was found for back on the speaker; with o.render, renders and places too. Beats someone set up by hand
// are left as they are. -> the pane's state plus auto: { planned, picked: { id: [assets] }, empty, notes }
async function collageAuto(event, o) {
    o = o || {};
    const job = { startedAt: Date.now(), result: null, error: null };
    job.promise = guard('auto', () => autoInner(o)).then(r => { job.result = r; return r; }, e => { job.error = String(e.message || e); throw e; });
    autoJob = job;
    return job.promise;
}

// collage_auto { status: true }: how the last Auto-fill run is doing.
function collageAutoStatus() {
    if (!autoJob) return { running: false, note: 'No Auto-fill run yet.' };
    const sec = Math.round((Date.now() - autoJob.startedAt) / 1000);
    if (autoJob.error) return { running: false, error: autoJob.error, seconds: sec };
    if (autoJob.result) return { running: false, done: true, auto: autoJob.result.auto, placed: autoJob.result.placed, notes: autoJob.result.notes };
    return { running: true, seconds: sec, progress: lastProgress };
}

async function autoInner(o) {
    const p = await projectFor();
    const notes = [];
    if (!fs.existsSync(shotsFile(p))) { send({ phase: 'auto', p: 0, text: 'Starting the project from the subtitles…' }); await startInner(p); }
    let shots = shotsOf(p);
    const fps = shots.fps || p.meta.fps || 30;
    const stop = () => { if (cancelAsked) throw new Error('Cancelled'); };
    if (o.context !== undefined) shots.context = String(o.context || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const context = shots.context || '';

    // 0 redo: when the context changed since the last run (or o.redo), the beats Auto-fill set up itself are cleared and
    // planned again; beats changed by hand (no `auto` flag) stay
    const redo = !!o.redo || (shots.autoContext !== undefined && shots.autoContext !== context);
    if (redo && !(Array.isArray(o.beats) && o.beats.length)) {
        let credits = (() => { try { return fs.readFileSync(path.join(p.dir, 'credits.csv'), 'utf8'); } catch (e) { return ''; } })();
        const cleared = shots.beats.filter(b => b.auto);
        for (const b of cleared) {
            const gone = b.assets || [];
            Object.assign(b, { visual: 'talking-head', queries: [], overlays: [], brief: [], assets: [] });
            delete b.auto;
            for (const n of gone) if (!shots.beats.some(x => (x.assets || []).includes(n))) credits = PLAN.withoutCredit(credits, n);
        }
        if (cleared.length) fs.writeFileSync(path.join(p.dir, 'credits.csv'), credits);
    }

    // 1 plan
    let planned = [];
    if (Array.isArray(o.beats) && o.beats.length) {
        for (const q of o.beats) {
            const b = q && shots.beats.find(x => x.id === q.id);
            if (!b) { notes.push('No beat ' + (q && q.id)); continue; }
            patchBeat(p, shots, b, q);
            if (Array.isArray(q.brief)) b.brief = q.brief.map(String).slice(0, 6);
            b.auto = true;
            planned.push(b.id);
        }
    } else if (o.plan !== false) {
        const keys = collageSources();
        const r = PLAN.autoPlanBeats(shots.beats, { fps, coverage: Number.isFinite(o.coverage) ? o.coverage : 0.5, video: keys.pexels.set || keys.pixabay.set });
        shots.beats = r.beats.map(b => (r.planned.includes(b.id) ? { ...b, auto: true } : b));
        planned = r.planned;
    }
    shots.autoContext = context;
    writeJson(shotsFile(p), shots);
    if (o.planOnly) {
        send({ phase: 'done', p: 1, text: planned.length + ' beat' + (planned.length === 1 ? '' : 's') + ' set to B-roll (nothing searched yet).' });
        return { ...stateOf(p), auto: { planned, picked: {}, empty: [], notes } };
    }
    send({ phase: 'auto', p: 0.1, text: planned.length + ' beat' + (planned.length === 1 ? '' : 's') + ' set to B-roll. Searching for pictures…' });
    stop();

    // 2 search the beats missing pictures that have not been searched yet
    const candOf = (b) => readJson(path.join(p.dir, 'candidates', b.candidatesDir || b.id, 'candidates.json'), null);
    const searchable = (b) => ['photo', 'stack', 'document', 'clip'].includes(b.visual) || (b.queries && b.queries.length);
    const toFind = shots.beats.filter(b => PLAN.pictureNeed(b).missing > 0 && searchable(b) && ((b.queries && b.queries.length) || (b.brief && b.brief.length)) &&
        (o.research || !candOf(b) || !(candOf(b).candidates || []).length || (candOf(b).context || '') !== context)).map(b => b.id);
    if (toFind.length) {
        try { await findInner(p, toFind); } catch (e) { if (cancelAsked) throw e; notes.push(String(e.message || e)); }
    }
    stop();

    // 3 pick
    shots = shotsOf(p);
    const picked = {}, empty = [];
    const titles = () => {
        const clips = readJson(clipsFile(p), {}) || {};
        const credits = PLAN.parseCsv((() => { try { return fs.readFileSync(path.join(p.dir, 'credits.csv'), 'utf8'); } catch (e) { return ''; } })());
        const byAsset = new Map(credits.slice(1).map(r => [r[1], r[2]]));
        return shots.beats.flatMap(b => (b.assets || []).map(n => (clips[n] && clips[n].title) || byAsset.get(n) || n));
    };
    const missing = shots.beats.filter(b => PLAN.pictureNeed(b).missing > 0);
    for (const [i, b] of missing.entries()) {
        stop();
        const cj = candOf(b);
        const files = PLAN.autoPicks((cj && cj.candidates) || [], b.visual, titles());
        send({ phase: 'auto', p: 0.5 + 0.4 * i / Math.max(1, missing.length), text: 'Picking for ' + b.id + ' (' + (i + 1) + ' of ' + missing.length + ')…' });
        for (const file of files) {
            try { await pickInner(p, { beat: b.id, file, on: true, inRun: true }); } catch (e) { if (cancelAsked) throw e; notes.push(b.id + ': ' + String(e.message || e)); }
            shots = shotsOf(p);
            const nb = shots.beats.find(x => x.id === b.id);
            if (nb && PLAN.pictureNeed(nb).missing === 0 && nb.visual !== 'stack') break;
        }
        const nb = shots.beats.find(x => x.id === b.id);
        if (nb && PLAN.pictureNeed(nb).missing > 0) {
            // nothing usable found: back on the speaker, search words kept so a re-run does not plan it again
            nb.visual = 'talking-head';
            nb.overlays = (nb.overlays || []).filter(x => x.type === 'title');
            empty.push(nb.id);
        } else if (nb) picked[nb.id] = PLAN.assetsFor(nb);
    }
    for (const b of shots.beats) {
        if (b.visual === 'document' && PLAN.assetsFor(b)[0] && b.scanned !== PLAN.assetsFor(b)[0]) { stop(); await scanEvidence(p, b); }
    }
    writeJson(shotsFile(p), shots);
    const auto = { planned, picked, empty, notes, context, redone: redo };
    dlog('COLLAGE-AUTO', p.dir, 'planned', planned.length, 'picked', Object.keys(picked).length, 'empty', empty.length);
    const summary = Object.keys(picked).length + ' beat' + (Object.keys(picked).length === 1 ? '' : 's') + ' got pictures' +
        (empty.length ? ', ' + empty.length + ' left on the speaker (nothing found: ' + empty.join(', ') + ')' : '');
    if (!o.render) {
        send({ phase: 'done', p: 1, text: summary + '. Check the beats, then Render and place.' });
        return { ...stateOf(p), auto };
    }
    stop();
    send({ phase: 'render', p: 0, text: summary + '. Rendering…' });
    const r = await renderInner(p, o);
    return { ...r, auto };
}

// ------------------------------------------------------------------ preview, render, place

function trackProps(p, shots, from) {
    const assetsDir = path.join(p.dir, 'assets');
    const assetMeta = PLAN.assetMetaOf(shots.beats, (n) => headOf(path.join(assetsDir, n)), readJson(clipsFile(p), {}));
    return { beats: PLAN.renderBeats(shots.beats), from, assetMeta, assetAnchors: shots.assetAnchors, _assets: { dir: assetsDir }, brand: brandOf(p, shots), titleY: shots.titleY };
}
function brandOf(p, shots) { return readJson(path.join(p.dir, (shots && shots.brand) || 'brand/brand.json'), {}) || {}; }
function wordsOf(p) {
    return ((readJson(path.join(p.dir, 'transcript.json'), {}) || {}).words || []).map(w => ({ w: w.w, start: Math.round(w.start), end: Math.round(w.end) }));
}
const endOf = (shots, words) => Math.max(1, ...shots.beats.map(b => b.frames[1]), ...words.map(w => Math.ceil(w.end)));

// The frame under the playhead (or `frame`, from the timeline's first frame), small: the B-roll layer and the captions
// layer as PNG data URLs, so the pane lays them over the playhead frame.
async function collageStill(event, o) {
    o = o || {};
    return guard('still', async () => {
        const p = await projectFor();
        const shots = shotsOf(p);
        const { W, H, FPS } = sizeFor(p, shots);
        let g = Number(o.frame);
        if (!Number.isFinite(g)) g = tcToFrame(await p.tl.GetCurrentTimecode(), p.meta) - p.tlStart;
        g = Math.max(0, Math.round(g));
        const segs = PLAN.segmentsOf(shots.beats);
        const seg = segs.find(s => g >= s.from && g < s.to) || { from: g, to: g + 1 };
        const scale = Math.min(1, 720 / Math.max(W, H));
        fs.mkdirSync(PREVIEW_DIR, { recursive: true });
        const fOut = path.join(PREVIEW_DIR, 'track.png'), cOut = path.join(PREVIEW_DIR, 'captions.png');
        send({ phase: 'still', text: 'Drawing frame ' + g + '…' });
        await broll().renderJob({ op: 'still', effect: 'collage-track', props: trackProps(p, shots, seg.from), width: W, height: H, fps: FPS, frames: Math.max(1, seg.to - seg.from), frame: g - seg.from, out: fOut, scale });
        let caps = null;
        const words = wordsOf(p);
        if (o.captions !== false && words.length) {
            await broll().renderJob({ op: 'still', effect: 'collage-captions', props: { words, from: 0, brand: brandOf(p, shots) }, width: W, height: H, fps: FPS, frames: endOf(shots, words), frame: g, out: cOut, scale });
            caps = dataUrl(cOut);
        }
        const beat = shots.beats.find(b => g >= b.frames[0] && g < b.frames[1]);
        send({ phase: 'idle' });
        return { frame: g, width: W, height: H, track: dataUrl(fOut), captions: caps, beat: beat ? beat.id : null, onBroll: segs.some(s => s.role === 'broll' && g >= s.from && g < s.to) };
    });
}

// Render every clip of the plan (and the captions) as ProRes 4444 with alpha into render/, then place them (place:
// true). A new set gets a -v<n> suffix once render/ has clips, so a clip Resolve has open is never overwritten.
async function collageRender(event, o) {
    o = o || {};
    return guard('render', async () => renderInner(await projectFor(), o));
}
async function renderInner(p, o) {
    {
        const shots = shotsOf(p);
        const { W, H, FPS } = sizeFor(p, shots);
        const segs = PLAN.segmentsOf(shots.beats);
        if (!segs.length) throw new Error('No B-roll beats yet: set some beats to Photo, Stack, Medallion or Title (talking-head beats show the speaker).');
        const short = shots.beats.filter(b => PLAN.pictureNeed(b).missing > 0);
        if (short.length) throw new Error('Pictures missing for ' + short.map(b => b.id).join(', ') + ': pick them (or change the beat to Talking head).');
        const rdir = path.join(p.dir, 'render');
        fs.mkdirSync(rdir, { recursive: true });
        const suffix = PLAN.nextSuffix(fs.readdirSync(rdir));
        const words = wordsOf(p);
        const jobs = segs.map(s => ({ role: s.role, start: s.from, frames: s.to - s.from, beats: s.beats, effect: 'collage-track', props: trackProps(p, shots, s.from), file: path.join(rdir, PLAN.clipFile(s.role, s.from, s.to, suffix)) }));
        if (o.captions !== false && words.length) {
            const end = endOf(shots, words);
            jobs.push({ role: 'captions', start: 0, frames: end, effect: 'collage-captions', props: { words, from: 0, brand: brandOf(p, shots) }, file: path.join(rdir, PLAN.clipFile('captions', 0, end, suffix)) });
        }
        const total = jobs.reduce((n, j) => n + j.frames, 0);
        const nBeats = segs.reduce((n, sg) => n + sg.beats.length, 0);
        send({ phase: 'render', p: 0, text: nBeats + ' B-roll beat' + (nBeats === 1 ? '' : 's') + ' in ' + segs.length + ' clip' + (segs.length === 1 ? '' : 's') + (jobs.length > segs.length ? ' + captions' : '') + '…' });
        let done = 0;
        const t0 = Date.now();
        for (const [i, j] of jobs.entries()) {
            // one clip holds a whole run of back-to-back B-roll beats: say which, so "2 of 4" is not read as 4 beats
            const inside = j.beats && j.beats.length ? ' (' + j.beats.length + ' beat' + (j.beats.length === 1 ? '' : 's') + (j.beats.length > 1 ? ', ' + j.beats[0] + '–' + j.beats[j.beats.length - 1] : ', ' + j.beats[0]) + ')' : '';
            const what = (j.role === 'captions' ? 'captions' : j.role === 'title' ? 'title' : 'B-roll') + ' clip ' + (i + 1) + ' of ' + jobs.length + inside;
            send({ phase: 'render', p: done / total, text: 'Rendering ' + what + '…' });
            try {
                await broll().renderJob({ op: 'video', effect: j.effect, props: j.props, width: W, height: H, fps: FPS, frames: j.frames, out: j.file },
                    (q) => send({ phase: 'render', p: (done + q * j.frames) / total, text: 'Rendering ' + what + ' ' + Math.round(q * 100) + '%' }),
                    j.frames * 400);
            } catch (e) {
                throw new Error(cancelAsked ? 'Cancelled' : String(e.message || e));
            }
            if (cancelAsked) throw new Error('Cancelled');
            done += j.frames;
        }
        const clips = jobs.map(j => ({ role: j.role, file: j.file, start: j.start, frames: j.frames, beats: j.beats }));
        writeJson(path.join(rdir, 'plan.json'), { timeline: p.name, fps: FPS, width: W, height: H, clips });
        if (o.captions !== false && words.length) fs.writeFileSync(path.join(rdir, 'captions.srt'), PLAN.srtOf(words, FPS, brandOf(p, shots).caption));
        const sec = Math.round((Date.now() - t0) / 1000);
        dlog('COLLAGE-RENDER', p.dir, jobs.length, sec + 's');
        if (o.place === false) {
            send({ phase: 'done', text: jobs.length + ' clip' + (jobs.length === 1 ? '' : 's') + ' rendered (' + sec + ' s).' });
            return { ...stateOf(p), rendered: clips.map(c => path.basename(c.file)) };
        }
        return await placeInner(p, { clips }, o, sec);
    }
}

async function collagePlace(event, o) {
    return guard('place', async () => {
        const p = await projectFor();
        const plan = readJson(path.join(p.dir, 'render', 'plan.json'), null);
        if (!plan || !(plan.clips || []).length) throw new Error('Nothing rendered yet: Render first.');
        return await placeInner(p, plan, o || {});
    });
}

// The collage clips on the timeline: video items whose media is in this project's render/ folder.
async function collageItems(p) {
    const root = path.join(p.dir, 'render') + path.sep;
    const out = [];
    const n = Number(await p.tl.GetTrackCount('video')) || 0;
    for (let t = 1; t <= n; t++) {
        const raw = (await p.tl.GetItemListInTrack('video', t)) || [];
        for (const item of (Array.isArray(raw) ? raw : Object.values(raw))) {
            let name = '';
            try { name = String(await item.GetName()); } catch (e) { continue; }
            if (!/^(broll|title|captions)\b.*\.mov$/i.test(name)) continue;
            let file = '';
            try { const mpi = await item.GetMediaPoolItem(); file = mpi ? String(await mpi.GetClipProperty('File Path')) : ''; } catch (e) { continue; }
            if (!file.startsWith(root)) continue;
            const base = path.basename(file);
            out.push({
                item, file, track: t, role: /^captions/.test(base) ? 'captions' : /^title/.test(base) ? 'title' : 'broll',
                start: Number(await item.GetStart()) - p.tlStart, frames: Number(await item.GetDuration())
            });
        }
    }
    return out;
}

async function putClip(p, ours, c, track, notes) {
    const ex = ours.find(x => !x.used && x.role === c.role && x.start === c.start);
    let how = 'placed';
    if (ex) {
        ex.used = true;
        if (ex.file === c.file) return { role: c.role, start: c.start, track: 'V' + ex.track, how: 'already there' };
        if (ex.frames === c.frames) {
            // same place and length: swap the media under the clip; it keeps its track and any edits
            const mpi = await ex.item.GetMediaPoolItem();
            if (mpi && await mpi.ReplaceClip(c.file)) return { role: c.role, start: c.start, track: 'V' + ex.track, how: 'replaced' };
        }
        await p.tl.DeleteClips([ex.item], false);
        track = ex.track;
        how = 'a new clip in the old one\'s place';
    }
    const placed = await broll().placeFile(p.project, p.tl, c.file, p.tlStart + c.start, c.frames, track, false);
    notes.push(...placed.notes);
    return { role: c.role, start: c.start, track: placed.track, how };
}

async function placeInner(p, plan, o, renderSec) {
    const clips = (plan.clips || []).filter(c => fs.existsSync(c.file) && (o.captions !== false || c.role !== 'captions'));
    if (!clips.length) throw new Error('The rendered files are gone: Render again.');
    const now = await p.project.GetCurrentTimeline();
    if (!now || (await now.GetName()) !== p.name) throw new Error('The timeline changed. Open "' + p.name + '" and place again.');
    send({ phase: 'place', text: 'Placing ' + clips.length + ' clip' + (clips.length === 1 ? '' : 's') + ' on "' + p.name + '"…' });
    const ours = await collageItems(p);
    const notes = [], results = [];
    const vis = clips.filter(c => c.role !== 'captions'), caps = clips.filter(c => c.role === 'captions');
    // B-roll and titles share a track: where the collage's B-roll already is, else the lowest free one over the range
    let vB = (ours.find(x => x.role !== 'captions') || {}).track || 0;
    if (!vB && vis.length) {
        const s = Math.min(...vis.map(c => c.start)), e = Math.max(...vis.map(c => c.start + c.frames));
        vB = await pickTrack(p.tl, 'video', 0, p.tlStart + s, p.tlStart + e, 2, notes);
    }
    for (const c of vis) results.push(await putClip(p, ours, c, vB, notes));
    // the captions go above the B-roll
    let vC = (ours.find(x => x.role === 'captions') || {}).track || 0;
    if (!vC && caps.length) {
        vC = Math.max(2, vB) + 1;
        let n = Number(await p.tl.GetTrackCount('video')) || 0;
        while (n < vC) { await p.tl.AddTrack('video'); n++; }
    }
    for (const c of caps) results.push(await putClip(p, ours, c, vC, notes));
    // collage B-roll the plan no longer has (a beat turned back into the speaker) comes off
    const stale = ours.filter(x => !x.used && (x.role !== 'captions' || caps.length));
    if (stale.length) { try { await p.tl.DeleteClips(stale.map(x => x.item), false); } catch (e) { notes.push('Could not take off ' + stale.length + ' old collage clip(s)'); } }
    // the sounds: a whoosh as each card comes in, hits on titles, pops and clicks (o.sfx: false leaves them out)
    let sfx = null;
    if (o.sfx !== false) {
        send({ phase: 'place', text: 'Placing the sound effects…' });
        try { sfx = await placeSfx(p, readJson(shotsFile(p), { beats: [] }), notes); } catch (e) { notes.push('Sound effects: ' + (e.message || e)); }
    }
    const tracks = [...new Set(results.map(r => r.track))].join(' + ');
    const text = (renderSec !== undefined ? 'Rendered in ' + renderSec + ' s · ' : '') + results.length + ' clip' + (results.length === 1 ? '' : 's') + ' on ' + tracks +
        (results.some(r => r.how === 'replaced') ? ' (updated in place)' : '') + (stale.length ? ' · ' + stale.length + ' old clip' + (stale.length === 1 ? '' : 's') + ' taken off' : '') +
        (sfx && sfx.count ? ' · ' + sfx.count + ' sound' + (sfx.count === 1 ? '' : 's') + ' on ' + sfx.track : '') +
        (notes.length ? ' · ' + [...new Set(notes)].join('; ') : '');
    send({ phase: 'done', text });
    dlog('COLLAGE-PLACE', p.name, JSON.stringify(results));
    return { ...stateOf(p), placed: results, removed: stale.length, sfx, notes: [...new Set(notes)] };
}

// ------------------------------------------------------------------ sound effects

// -> { kind: [file, ...] } from the SFX Originals Library.
function sfxLibrary() {
    let names = [];
    try { names = fs.readdirSync(SFX_ORIG_DIR).filter(n => /\.(wav|mp3|m4a|aiff?|flac)$/i.test(n)); } catch (e) { return {}; }
    const out = {};
    for (const [kind, keys] of Object.entries(SFX_SOUNDS)) {
        const files = [];
        for (const key of keys) for (const n of names) { if (n.toLowerCase().includes(key) && !files.includes(n)) files.push(n); }
        out[kind] = files.map(n => path.join(SFX_ORIG_DIR, n));
    }
    for (const [kind, alt] of Object.entries(SFX_FALLBACK)) if (!out[kind].length) out[kind] = out[alt] || [];
    return out;
}

// The collage's sounds on a free audio track (one track; the cues never overlap): each copied next to the footage
// like every placed sound, cut to its cue's length with a short fade, its peak in the -20..-15 dBFS window and a slight
// pitch / volume change per copy. The ones placed before (render/sfx-placed.json) come off first.
async function placeSfx(p, shots, notes) {
    const { importSfx } = require('./sfx-import');
    const { peakOf, clampToWindow, variations, applyLevel } = require('./sfx-level');
    const fps = shots.fps || p.meta.fps;
    const recFile = path.join(p.dir, 'render', 'sfx-placed.json');
    const before = readJson(recFile, null);
    let removed = 0;
    if (before && before.timeline === p.name && (before.ids || []).length) {
        const found = await findItemsByIds(p.tl, before.ids, 'audio');
        if (found.size) { try { await p.tl.DeleteClips([...found.values()], false); removed = found.size; } catch (e) { notes.push('Could not take off the earlier collage sounds'); } }
    }
    const cues = PLAN.sfxCuesOf(shots.beats, { fps });
    if (!cues.length) { writeJson(recFile, { timeline: p.name, ids: [] }); return { count: 0, removed }; }
    const lib = sfxLibrary();
    const mp = await p.project.GetMediaPool();
    const first = cues[0].frame, last = cues[cues.length - 1];
    const track = await pickTrack(p.tl, 'audio', 0, p.tlStart + first, p.tlStart + last.frame + last.len, 1, notes);
    const turn = {}, items = new Map(), ids = [], missing = new Set();
    const vary = variations();
    for (const c of cues) {
        const files = lib[c.kind] || [];
        if (!files.length) { missing.add(c.kind); continue; }
        const file = files[(turn[c.kind] = ((turn[c.kind] ?? -1) + 1)) % files.length];
        if (!items.has(file)) {
            const r = await importSfx(p.project, file, true);
            const total = r && r.item ? Math.max(1, tcToFrame(await r.item.GetClipProperty('Duration'), p.meta)) : 0;
            items.set(file, r && r.item ? { mpi: r.item, total } : null);
        }
        const it = items.get(file);
        if (!it) { notes.push('Resolve could not import ' + path.basename(file)); continue; }
        const len = Math.max(1, Math.min(c.len, it.total));
        const placed = await mp.AppendToTimeline([{ mediaPoolItem: it.mpi, mediaType: 2, trackIndex: track, recordFrame: p.tlStart + c.frame, startFrame: 0, endFrame: len }]);
        if (!placed || !placed[0]) { notes.push('A ' + c.kind + ' sound could not be placed at ' + c.frame); continue; }
        const item = placed[0];
        const fade = Math.min(len, Math.round(fps / 5));
        try { if (typeof item.SetFades === 'function') await item.SetFades({ FadeIn: 0, FadeOut: fade }); } catch (e) { /* the fade is a convenience */ }
        const v = vary.next();
        await applyLevel(item, clampToWindow(v.db, await peakOf(file, 0, len, fps)), v.cents);
        try { ids.push(String(await item.GetUniqueId())); } catch (e) { /* cannot be taken off automatically next time */ }
    }
    if (missing.size) notes.push('No ' + [...missing].join(' / ') + ' sound in the SFX library');
    writeJson(recFile, { timeline: p.name, track, ids });
    return { count: ids.length, removed, track: 'A' + track };
}

// ------------------------------------------------------------------ folder, cancel

// The project folder, or (url) a candidate's source page / a site's API key page in the browser.
async function collageOpen(event, o) {
    const { shell } = require('electron');
    if (o && o.url) {
        if (!OPEN_OK.test(String(o.url))) throw new Error('Only Wikimedia Commons, Pexels and Pixabay pages open from here.');
        return shell.openExternal(String(o.url));
    }
    const p = await projectFor();
    const dir = fs.existsSync(p.dir) ? p.dir : path.dirname(p.dir);
    if (fs.existsSync(dir)) return shell.openPath(dir);
    return false;
}

function collageCancel() {
    cancelAsked = true;
    if (findProc) { try { findProc.kill(); } catch (e) { /* gone */ } }
    if (busy === 'render' || busy === 'still') { try { broll().brollCancel(); } catch (e) { /* no worker */ } }
    send({ phase: 'error', text: 'Cancelled' });
    return true;
}
