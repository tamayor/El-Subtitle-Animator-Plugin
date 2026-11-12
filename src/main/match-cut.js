// Match Cut (header "Match Cut" button, MCP tool match_cut): a news-article match cut of one word. News articles that
// use the word are screenshotted, the word is found in each by OCR, and every picture is scaled and moved so the word
// sits at the same size in the same spot; the MP4 is rendered by src/python/news_match_cut.py and placed at the
// playhead (video on the top free layer, the clicks on a free audio track, linked).
// Runs are saved in "<footage folder>/El Subtitle Animator MatchCut/<word>/", beside "El Subtitle Animator SFX" (same
// footage folder: sfx-import.timelineSfxDir), and the MP4 goes into a Media Pool bin of the same name.

module.exports = { matchCutDefaults, matchCutRun, matchCutStart, matchCutCancel, matchCutStatus, matchCutOpen };

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { shell } = require('electron');

const state = require('./state');
const { APP_DATA_DIR, BRIDGE_SCRIPT, DATA_DIR } = require('./config');
const { dlog } = require('./log');
const { getProject, tcToFrame, timelineMeta } = require('./resolve');
const { timelineSfxDir } = require('./sfx-import');
const { pickTrack } = require('./placement');

const SCRIPT = path.join(path.dirname(BRIDGE_SCRIPT), 'news_match_cut.py');
const RUNS_DIR = 'El Subtitle Animator MatchCut';
const PREFS_FILE = path.join(APP_DATA_DIR, 'match-cut.json');
const DEFAULT_SFX = path.join(DATA_DIR, 'sounds', 'original', 'universfield-soft-ui-click-147352.wav');
const EXTRA_PATH = ':/opt/homebrew/bin:/usr/local/bin';
const DEFAULTS = { word: '', count: 12, highlight: true, highlightColor: '#8ccf8e', sfx: true, startFrames: 6, endFrames: 2, hold: 1.2, place: true };
// Pythons that may have Pillow (Resolve's own Python and macOS's do not ship it)
const PYTHONS = [
    '/opt/anaconda3/bin/python3', path.join(os.homedir(), 'anaconda3/bin/python3'), path.join(os.homedir(), 'miniconda3/bin/python3'),
    '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/Library/Frameworks/Python.framework/Versions/Current/bin/python3', '/usr/bin/python3'
];

let job = null;              // { word, proc, running, cancelled, progress, result, error, promise }
let pyFound = null;

function readPrefs() { try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) }; } catch (e) { return { ...DEFAULTS }; } }
function savePrefs(p) {
    try { fs.mkdirSync(APP_DATA_DIR, { recursive: true }); fs.writeFileSync(PREFS_FILE, JSON.stringify(p, null, 2)); } catch (e) { /* kept for this run only */ }
}
function send(msg) {
    try { if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.webContents.send('matchcut:progress', msg); } catch (e) { /* panel gone */ }
}
function hasPillow(py) {
    return new Promise(res => execFile(py, ['-c', 'import PIL'], { timeout: 20000 }, err => res(!err)));
}
async function pillowPython() {
    if (pyFound && fs.existsSync(pyFound)) return pyFound;
    for (const p of PYTHONS) if (fs.existsSync(p) && await hasPillow(p)) return (pyFound = p);
    return null;
}

// The panel's saved options and whether a run is going on.
function matchCutDefaults() { return { prefs: readPrefs(), defaults: DEFAULTS, status: matchCutStatus() }; }

function matchCutStatus() {
    if (!job) return { running: false };
    return { running: job.running, word: job.word, progress: job.progress, result: job.result, error: job.error };
}

function matchCutCancel() {
    if (!job || !job.running || !job.proc) return false;
    job.cancelled = true;
    try { process.kill(-job.proc.pid, 'SIGTERM'); } catch (e) { try { job.proc.kill(); } catch (e2) { /* already gone */ } }
    return true;
}

function matchCutOpen() {
    const dir = job && job.result && job.result.dir;
    if (dir && fs.existsSync(dir)) return shell.openPath(dir);
    return false;
}

// IPC: runs and waits; progress goes to the panel as matchcut:progress.
async function matchCutRun(event, opts) {
    const j = await matchCutStart(opts);
    return j.promise;
}

// Starts a run (the MCP tool waits on job.promise for a while, then polls matchCutStatus).
async function matchCutStart(opts) {
    if (job && job.running) throw new Error('A match cut for "' + job.word + '" is already running');
    const o = { ...readPrefs(), ...(opts || {}) };
    const word = String(o.word || '').trim();
    if (!word) throw new Error('Type the word to match on');
    if (word.length > 60) throw new Error('Use one word or a short phrase');
    savePrefs({ ...o, word });

    const project = await getProject();
    if (!project) throw new Error('Open a project in Resolve');
    const tl = await project.GetCurrentTimeline();
    if (!tl) throw new Error('Open a timeline');
    const meta = await timelineMeta(tl, project);
    const start = tcToFrame(await tl.GetCurrentTimecode(), meta);
    const tlName = await tl.GetName();
    const footage = await timelineSfxDir(project);
    const outRoot = path.join(footage || DATA_DIR, RUNS_DIR);

    const py = await pillowPython();
    if (!py) throw new Error('Match Cut needs Python with Pillow. In Terminal run: pip3 install pillow');

    const args = [SCRIPT, word, '--out-dir', outRoot, '--size', meta.width + 'x' + meta.height, '--fps', String(meta.fps),
        '--count', String(Math.max(2, Math.min(40, Number(o.count) || DEFAULTS.count))),
        '--start-frames', String(Number(o.startFrames) || DEFAULTS.startFrames),
        '--end-frames', String(Number(o.endFrames) || DEFAULTS.endFrames),
        '--hold', String(Number.isFinite(Number(o.hold)) ? Number(o.hold) : DEFAULTS.hold)];
    if (o.highlight) args.push('--highlight', /^#[0-9a-f]{6}$/i.test(o.highlightColor || '') ? o.highlightColor : DEFAULTS.highlightColor);
    const sfx = typeof o.sfx === 'string' && fs.existsSync(o.sfx) ? o.sfx : (o.sfx ? DEFAULT_SFX : null);
    if (sfx && fs.existsSync(sfx)) args.push('--sfx', sfx);

    job = { word, running: true, cancelled: false, progress: { phase: 'start', text: 'Starting…' }, result: null, error: null };
    send({ ...job.progress, word });
    dlog('MATCHCUT-START', word, outRoot, meta.width + 'x' + meta.height, meta.fps);
    const j = job;

    j.promise = new Promise((resolve) => {
        let buf = '', errTail = '', result = null;
        const proc = spawn(py, args, { detached: true, env: { ...process.env, PATH: (process.env.PATH || '/usr/bin:/bin') + EXTRA_PATH } });
        j.proc = proc;
        proc.stdout.on('data', d => {
            buf += d.toString();
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
                if (line.startsWith('PROGRESS ')) {
                    try { j.progress = JSON.parse(line.slice(9)); send({ ...j.progress, word }); } catch (e) { /* partial line */ }
                } else if (line.startsWith('RESULT ')) {
                    try { result = JSON.parse(line.slice(7)); } catch (e) { /* ignore */ }
                }
            }
        });
        proc.stderr.on('data', d => { errTail = (errTail + d.toString()).slice(-2000); });
        proc.on('error', e => { errTail += String(e.message || e); });
        proc.on('close', async (code) => {
            j.proc = null;
            const fail = (msg) => {
                j.running = false; j.error = msg;
                send({ phase: 'error', text: msg, word });
                dlog('MATCHCUT-FAIL', word, msg);
                resolve({ ok: false, error: msg });
            };
            if (j.cancelled) return fail('Cancelled');
            if (code !== 0 || !result) {
                const last = errTail.trim().split('\n').filter(Boolean).pop() || ('the renderer stopped (code ' + code + ')');
                return fail(last);
            }
            let placed = null;
            if (o.place !== false) {
                send({ phase: 'place', text: 'Placing on ' + tlName, word });
                try { placed = await placeOnTimeline(project, tlName, result, start, !!(sfx && fs.existsSync(sfx))); } catch (e) { placed = { error: String(e && e.message || e) }; }
            }
            j.running = false;
            j.result = { ...result, placed };
            const sec = (result.frames / result.fps).toFixed(1);
            const where = placed && !placed.error ? ' on ' + placed.track + ' at the playhead' : '';
            const text = result.articles + ' articles, ' + sec + ' s' + where + (placed && placed.error ? ' (not placed: ' + placed.error + ')' : '');
            send({ phase: 'done', text, word, result: j.result });
            dlog('MATCHCUT-DONE', word, result.out, JSON.stringify(placed));
            resolve({ ok: true, ...j.result, text });
        });
    });
    return j;
}

// The MP4 goes into the "El Subtitle Animator MatchCut" bin and onto the timeline at `start`.
async function placeOnTimeline(project, tlName, result, start, withAudio) {
    const tl = await project.GetCurrentTimeline();
    if (!tl || (await tl.GetName()) !== tlName) throw new Error('the timeline changed while rendering; the MP4 is in ' + result.dir);
    const mp = await project.GetMediaPool();
    const root = await mp.GetRootFolder();
    let bin = null;
    for (const f of ((await root.GetSubFolderList()) || [])) { if ((await f.GetName()) === RUNS_DIR) { bin = f; break; } }
    if (!bin) { try { bin = await mp.AddSubFolder(root, RUNS_DIR); } catch (e) { bin = null; } }
    const keep = await mp.GetCurrentFolder();
    if (bin) { try { await mp.SetCurrentFolder(bin); } catch (e) { /* imports into the current bin instead */ } }
    let items;
    try { items = await mp.ImportMedia([result.out]); } finally { if (keep) { try { await mp.SetCurrentFolder(keep); } catch (e) { /* ignore */ } } }
    const mpi = items && items[0];
    if (!mpi) throw new Error('Resolve could not import ' + path.basename(result.out));

    const frames = result.frames, end = start + frames, notes = [];
    const vt = await pickTrack(tl, 'video', 0, start, end, 2, notes);
    const v = await mp.AppendToTimeline([{ mediaPoolItem: mpi, mediaType: 1, trackIndex: vt, recordFrame: start, startFrame: 0, endFrame: frames }]);
    if (!v || !v[0]) throw new Error('Resolve did not place the clip on V' + vt);
    let at = null;
    if (withAudio) {
        try {
            at = await pickTrack(tl, 'audio', 0, start, end, 1, notes);
            const a = await mp.AppendToTimeline([{ mediaPoolItem: mpi, mediaType: 2, trackIndex: at, recordFrame: start, startFrame: 0, endFrame: frames }]);
            if (!a || !a[0]) at = null;
            else if (typeof tl.SetClipsLinked === 'function') await tl.SetClipsLinked([v[0], a[0]], true);
        } catch (e) { at = null; notes.push('the clicks could not be placed: ' + String(e && e.message || e)); }
    }
    return { track: 'V' + vt, audio: at ? 'A' + at : null, start, frames, notes };
}
