// Cut tab "Analyse media" tools and their MCP twins: what the timeline's footage and sound hold, measured with ffmpeg
// (media-analysis.js): speech pauses, shot changes with brightness, the music's beat grid, word timings, and the
// render check (black or frozen frames in a placed clip, from Resolve's own composited frames).
// Reads the timeline only; nothing here changes a clip.
// The panel draws the results over the range's waveform (cutToolsWave; js/library/cut-tools-view.js); a click there
// moves Resolve's playhead (cutToolsGoto). Markers are optional (cutToolsMarkers).

module.exports = { timelineMedia, resolveRange, analyse, checkRender, cutToolsStatus, cancelCutTools, cutToolsRun, cutToolsCheck, cutToolsInstall, cutToolsMarkers, cutToolsWave, cutToolsGoto, cutToolsDeletePauses, cutToolsPlayhead };

const fs = require('fs');
const os = require('os');
const path = require('path');

const { currentTimeline, getSubtitles, frameToTC, tcToFrame, timelineMeta, findItemsByIds } = require('./resolve');
const { bridgeCall } = require('./fusion-bridge');
const MEDIA = require('./media-analysis');
const { dlog } = require('./log');
const state = require('./state');

let running = null;     // { kind, cancelled } while an analysis runs (one at a time)

// Cancel: the next progress tick stops the run, and a speech engine working right now is ended at once.
function cancelCutTools() { if (running) running.cancelled = true; const stopped = MEDIA.stopAsr(); return { cancelled: !!running, stopped }; }

async function timelineOrThrow() {
    const { project, tl } = await currentTimeline();
    if (!tl) throw new Error('Open a timeline in Resolve');
    return { project, tl, meta: await timelineMeta(tl, project) };
}

// The frame range an analysis covers: subtitles [n, ...] (first start to last end), startFrame / endFrame, or the
// whole timeline. { from, to, label }
async function resolveRange(tl, args) {
    const a = Object.assign({}, args || {});
    if (a.startTC || a.endTC) {     // the panel's From / To timecodes
        const meta = await timelineMeta(tl);
        const bad = (tc) => !/^\d{1,2}[:;]\d{2}[:;]\d{2}[:;]\d{2}$/.test(String(tc).trim());
        for (const tc of [a.startTC, a.endTC]) if (tc && bad(tc)) throw new Error('Timecode "' + tc + '" is not hh:mm:ss:ff');
        if (a.startTC) a.startFrame = tcToFrame(String(a.startTC).trim(), meta);
        if (a.endTC) a.endFrame = tcToFrame(String(a.endTC).trim(), meta);
    }
    if (Array.isArray(a.subtitles) && a.subtitles.length) {
        const subs = await getSubtitles(tl, false);
        const picked = a.subtitles.map(Number).map(n => { const s = subs.find(x => x.index === n); if (!s) throw new Error('No subtitle #' + n); return s; });
        return { from: Math.min(...picked.map(s => s.start)), to: Math.max(...picked.map(s => s.end)), label: 'subtitle' + (picked.length > 1 ? 's ' : ' ') + a.subtitles.join(', ') };
    }
    const start = Number(await tl.GetStartFrame()) || 0, end = Number(await tl.GetEndFrame()) || start;
    if (Number.isFinite(a.startFrame) || Number.isFinite(a.endFrame)) {
        const f = Number.isFinite(a.startFrame) ? a.startFrame : start, t = Number.isFinite(a.endFrame) ? a.endFrame : end;
        if (t <= f) throw new Error('endFrame must be after startFrame');
        return { from: f, to: t, label: 'frames ' + f + '-' + t };
    }
    return { from: start, to: end, label: 'the whole timeline' };
}

// Sound effects the plugin placed and its generated cut-outs are not footage.
function isOwnFile(file) {
    return /\/El Subtitle Animator SFX\//.test(file) || /\/El Subtitle Animator\/sounds\//.test(file) || /\/spotlight\/[^/]+\/c\[/.test(file);
}

// Every media clip of the range on the timeline, with what maps its timeline frames to file seconds.
async function timelineMedia(args) {
    const { tl, meta } = await timelineOrThrow();
    const range = await resolveRange(tl, args);
    const segments = [];
    for (const kind of ['video', 'audio']) {
        const n = Number(await tl.GetTrackCount(kind)) || 0;
        for (let t = 1; t <= n; t++) {
            const items = (await tl.GetItemListInTrack(kind, t)) || [];
            for (const it of items) {
                const [s, e] = await Promise.all([it.GetStart(), it.GetEnd()]);
                if (!(e > range.from && s < range.to)) continue;
                let mpi = null;
                try { mpi = await it.GetMediaPoolItem(); } catch (err) { /* a title or generator: not media */ }
                if (!mpi) continue;
                const [fp, ty, fpsProp] = await Promise.all(['File Path', 'Type', 'FPS'].map(k => Promise.resolve(mpi.GetClipProperty(k)).catch(() => '')));
                const props = { FPS: fpsProp };
                const file = String(fp || '');
                if (!file || isOwnFile(file)) continue;
                const type = String(ty || '').toLowerCase();
                if (kind === 'video' && /still|image|png|jpg|timeline|compound/.test(type)) continue;
                const [ss, se, name, id] = await Promise.all([it.GetSourceStartFrame(), it.GetSourceEndFrame(), it.GetName(), it.GetUniqueId()]);
                segments.push({
                    kind, track: t, itemId: id, name, file, audioOnly: type.startsWith('audio'),
                    tlStart: Number(s), tlEnd: Number(e), srcStartFrame: Number(ss) || 0, srcEndFrame: Number(se) || 0,
                    srcFps: parseFloat(props.FPS) || meta.fps
                });
            }
        }
    }
    return { fps: meta.fps, from: range.from, to: range.to, label: range.label, segments, timeline: await tl.GetName() };
}

// One analysis over a range (see media-analysis.js analyseTimeline). progress(done, total, label) for the panel.
async function analyse(kind, args, progress) {
    if (!['pauses', 'cuts', 'beats', 'words'].includes(kind)) throw new Error('Unknown analysis ' + kind);
    if (running) throw new Error('An analysis is already running (' + running.kind + ')');
    running = { kind, cancelled: false };
    const job = running;
    try {
        const media = await timelineMedia(args);
        const { meta } = await timelineOrThrow();
        const res = await MEDIA.analyseTimeline(kind, media, Object.assign({}, args, {
            progress: (d, n, label) => {
                if (job.cancelled) throw new Error('Cancelled');
                if (progress) progress({ kind, done: d, total: n, label });
            }
        }));
        res.range = media.label;
        res.timeline = media.timeline;
        const tc = (f) => frameToTC(f, meta);
        for (const list of [res.pauses, res.beats, res.cuts, res.shots, res.words]) {
            for (const x of list || []) x.tc = tc(x.frame !== undefined ? x.frame : x.start);
        }
        return res;
    } finally {
        running = null;
    }
}

// Render check: Resolve's composited frames of each clip (plus 3 frames after it, where the black tail of a short
// Pop / Drop / Glitch clip showed up) go through ffmpeg's blackdetect and freezedetect.
// args: { itemIds } (titles placed by the tool) or { startFrame, endFrame } / { subtitles }; step = every nth frame
// (default: at most 90 frames per clip).
async function checkRender(args, progress) {
    const a = args || {};
    const { tl, meta } = await timelineOrThrow();
    const spans = [];
    if (Array.isArray(a.itemIds) && a.itemIds.length) {
        const found = await findItemsByIds(tl, a.itemIds.map(String), 'video');
        for (const id of a.itemIds.map(String)) {
            const it = found.get(id);
            if (!it) { spans.push({ itemId: id, error: 'not on the timeline' }); continue; }
            spans.push({ itemId: id, name: await it.GetName(), from: Number(await it.GetStart()), to: Number(await it.GetEnd()) });
        }
    } else {
        const r = await resolveRange(tl, a);
        if (r.to - r.from > meta.fps * 120) throw new Error('Check at most 2 minutes at a time (give subtitles, startFrame / endFrame or itemIds)');
        spans.push({ name: r.label, from: r.from, to: r.to });
    }
    const out = [];
    let i = 0;
    for (const s of spans) {
        if (progress) progress({ kind: 'render', done: i++, total: spans.length, label: s.name || '' });
        if (s.error) { out.push(s); continue; }
        const len = s.to - s.from;
        const step = Math.max(1, Number(a.step) || Math.ceil((len + 3) / 90));
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elsa-render-'));
        const r = Object.assign({}, s, { tcIn: frameToTC(s.from, meta), frames: len, step });
        try {
            const ex = await bridgeCall('timeline_frames', { from: s.from, to: s.to + 2, step, dir, maxDim: 480 }, 180000);
            if (!ex.count) throw new Error('Resolve exported no frames');
            const content = await MEDIA.frameContent(path.join(dir, 'f%05d.jpg'), { sequence: true, fps: meta.fps / step, minFreeze: Math.max(0.3, 6 * step / meta.fps) });
            const flags = MEDIA.renderFlags(content, meta.fps / step, Math.ceil(len / step));
            r.flags = flags.map(f => Object.assign(f, { from: f.from * step, to: f.to * step, frames: f.frames * step, tc: frameToTC(s.from + f.from * step, meta) }));
            r.ok = !r.flags.some(f => f.kind === 'black' || f.kind === 'static' || f.kind === 'staticStart');
            r.exported = ex.count;
            if (ex.failed && ex.failed.length) r.notExported = ex.failed.length;
        } catch (e) {
            r.error = e.message;
            dlog('[cut-tools] render check ' + (s.name || s.itemId) + ': ' + e.message);
        } finally {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp frames */ }
        }
        out.push(r);
    }
    if (progress) progress({ kind: 'render', done: spans.length, total: spans.length, label: '' });
    const checked = out.filter(x => !x.error);
    return { checked: checked.length, problems: checked.filter(x => !x.ok).length, clips: out };
}

// For the panel: is ffmpeg there, which speech engines are installed.
async function cutToolsStatus() {
    const asr = await MEDIA.asrStatus();
    return { ffmpeg: !!MEDIA.ffmpegBin(), engines: asr.engines.map(e => e.engine), install: asr.install, running: running ? running.kind : null };
}

// ------------------------------------------------------------------ panel (ipc cuttools:*)

function sendProgress(msg) {
    try { if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.webContents.send('cuttools:progress', msg); } catch (e) { /* panel gone */ }
}

// The panel's range: { range: 'selection' | 'inout' | 'all', subtitles, startFrame, endFrame } -> analyse args.
async function cutToolsRun(event, opts) {
    const o = opts || {};
    return analyse(o.kind, o, sendProgress);
}

async function cutToolsCheck(event, opts) { return checkRender(opts || {}, sendProgress); }

async function cutToolsInstall(event, opts) {
    sendProgress({ kind: 'install', done: 0, total: 1, label: 'Installing the speech engine (a few minutes)' });
    const r = await MEDIA.installAsr(opts && opts.engine);
    sendProgress({ kind: 'install', done: 1, total: 1, label: '' });
    return r;
}

// The sound of a range as the panel's waveform: the dialogue track (music: true = the music track, for beats), the
// peak level of each 10 ms (as Resolve's Remove Silence measures it), 0..255 for -90..-6 dBFS, base64 (the panel finds pauses in it with its own threshold). Buckets run evenly over the range's timeline frames.
async function cutToolsWave(event, opts) {
    const o = opts || {};
    const media = await timelineMedia(o);
    const segs = MEDIA.pickSegments(o.music ? 'beats' : 'pauses', media, o);
    const span = Math.max(1, media.to - media.from);
    const n = Math.max(400, Math.min(180000, Math.round(span / media.fps * 100)));    // 10 ms buckets (the envelope's own step) up to 30 min
    const out = new Uint8Array(n);
    for (const s of segs) {
        const a = Math.max(media.from, s.tlStart), b = Math.min(media.to, s.tlEnd);
        const map = MEDIA.sourceMapper(s);
        const t0 = Math.max(0, map.toFile(a));
        let env;
        try { env = await MEDIA.audioEnvelope(s.file, { start: t0, duration: Math.max(0.05, map.toFile(b) - t0), peak: true }); } catch (e) { continue; }
        // every bucket of this clip reads the readings it covers (going the other way round left some buckets empty,
        // and an empty bucket read as silence)
        const k0 = Math.max(0, Math.floor((a - media.from) / span * n)), k1 = Math.min(n, Math.ceil((b - media.from) / span * n));
        const at = (f) => (map.toFile(f) - env.start) / env.hop;
        for (let k = k0; k < k1; k++) {
            const f0 = Math.max(a, media.from + k * span / n), f1 = Math.min(b, media.from + (k + 1) * span / n);
            if (f1 <= f0) continue;
            let i = Math.max(0, Math.floor(at(f0))), m = -200;
            const j = Math.min(env.db.length, Math.max(i + 1, Math.ceil(at(f1))));
            for (; i < j; i++) if (env.db[i] > m) m = env.db[i];
            if (m <= -200) continue;
            const v = Math.max(1, Math.min(255, Math.round((m + 90) / 84 * 255)));
            if (v > out[k]) out[k] = v;
        }
    }
    return { from: media.from, to: media.to, fps: media.fps, n, wave: Buffer.from(out).toString('base64'), track: segs.length ? 'A' + segs[0].track : null };
}

// Where Resolve's playhead is (timeline frame), for the red line on the panel's picture.
// One call to Resolve per tick: the timeline and its frame rate are looked up again only every 4 s.
let headCache = null;
async function cutToolsPlayhead() {
    if (state.applying || running) return { busy: true };
    if (!headCache || Date.now() - headCache.at > 4000) { const { tl, meta } = await timelineOrThrow(); headCache = { tl, meta, at: Date.now() }; }
    try { return { frame: tcToFrame(String(await headCache.tl.GetCurrentTimecode()), headCache.meta) }; } catch (e) { headCache = null; throw e; }
}

// Moves Resolve's playhead to a timeline frame (a click on the panel's overlay or on a result row).
async function cutToolsGoto(event, opts) {
    const { tl, meta } = await timelineOrThrow();
    const tc = frameToTC(Math.round(Number(opts && opts.frame) || 0), meta);
    return { ok: !!(await tl.SetCurrentTimecode(tc)), tc };
}

// "Delete marked pauses": the pauses that carry an "ELSA pause" marker (Add markers puts them there; delete a marker
// in Resolve to keep that pause) are taken out. `leave` seconds of each stay (60 % after the words, 40 % before the next
// ones) so the words do not collide. The result is a new timeline next to this one (auto-cut.js cutBuildWithout); this
// timeline keeps its clips and loses the pause markers.
async function cutToolsDeletePauses(event, opts) {
    const o = opts || {};
    const { tl, meta } = await timelineOrThrow();
    const start = Number(await tl.GetStartFrame()) || 0;
    const ms = (await tl.GetMarkers()) || {};
    const leave = Math.max(0, Number(o.leave) || 0) * meta.fps;
    const ranges = [];
    for (const [f, m] of Object.entries(ms)) {
        if (!m || String(m.name || '') !== 'ELSA pause') continue;
        const a = start + Number(f), b = a + Math.max(1, Number(m.duration) || 1);
        const x = Math.round(a + leave * 0.6), y = Math.round(b - leave * 0.4);
        if (y - x >= 1) ranges.push([x, y]);
    }
    if (!ranges.length) throw new Error('There are no pause markers on this timeline. Measure Pauses, then Add markers.');
    const r = await require('./auto-cut').cutBuildWithout(ranges, { track: 1, name: o.name || (await tl.GetName()) + ' (no pauses)' });
    // the pause markers of the timeline they were on
    let cleared = 0;
    for (const [f, m] of Object.entries(ms)) {
        if (m && String(m.name || '') === 'ELSA pause') { try { if (await tl.DeleteMarkerAtFrame(Number(f))) cleared++; } catch (e) { /* the bridge tries below */ } }
    }
    if (cleared < ranges.length) {
        try {
            const c = await bridgeCall('markers_clear', { kind: 'pauses', timeline: r.source }, 30000, { lane: 1 });
            cleared += (c && c.removed) || 0;
        } catch (e) { dlog('[cut-tools] markers_clear after delete: ' + e.message); }
    }
    return Object.assign(r, { pauses: ranges.length, cleared });
}

// Timeline markers for a result the panel shows (cuts: bright shots, beats: every beat, pauses: long pauses), so the
// editor sees them on the timeline. Only markers the plugin names "ELSA ..." are ever removed (clear: true).
const MARKER_COLOR = { cuts: 'Cream', bright: 'Yellow', beats: 'Purple', pauses: 'Sky', render: 'Red' };
async function cutToolsMarkers(event, opts) {
    const o = opts || {};
    const { tl } = await timelineOrThrow();
    const start = Number(await tl.GetStartFrame()) || 0;
    const ms = (await tl.GetMarkers()) || {};
    let removed = 0;
    if (o.clear) {
        // The plugin's own markers: the "ELSA ..." ones from here and, with all: true (the Clear button), the
        // "Retake cut" / "Pause ... cut" ones a Cut build left (custom data "elsa-cut").
        const mine = (m) => m && ((/^ELSA /.test(String(m.name || '')) && (!o.kind || String(m.note || '').startsWith(o.kind))) ||
            (o.all && (String(m.customData || '') === 'elsa-cut' || /^(Retake|Outtake|Stutter|Filler|Pause [\d.]+ s) cut$/.test(String(m.name || '')))));
        const want = Object.entries(ms).filter(([, m]) => mine(m)).length;
        for (const [f, m] of Object.entries(ms)) {
            if (mine(m)) { try { if (await tl.DeleteMarkerAtFrame(Number(f))) removed++; } catch (e) { /* the bridge tries below */ } }
        }
        if (removed < want) {       // Resolve's panel API did not delete them all: its Python API does
            try {
                const r = await bridgeCall('markers_clear', { kind: o.kind || '', all: !!o.all }, 30000, { lane: 1 });
                if (r && r.removed) removed += r.removed;
            } catch (e) { dlog('[cut-tools] markers_clear: ' + e.message); }
        }
        if (!o.marks) return { removed, left: want - removed };
    }
    let added = 0;
    for (const m of (o.marks || []).slice(0, 500)) {
        const f = Math.round(Number(m.frame)) - start;
        if (!Number.isFinite(f) || f < 0) continue;
        try {
            if (await tl.AddMarker(f, MARKER_COLOR[m.color] || MARKER_COLOR[o.kind] || 'Blue', 'ELSA ' + String(m.name || o.kind), String(o.kind || '') + ': ' + String(m.note || ''), Math.max(1, Math.round(m.frames || 1)), '')) added++;
        } catch (e) { /* a marker already there */ }
    }
    return { added, removed };
}
