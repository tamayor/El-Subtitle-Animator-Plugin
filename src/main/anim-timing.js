// The Use tab's Animation timing bar: finds the placed clip the user is working on (the selected video clip, else the
// top clip under the playhead) and reads / sets its timing as start..end ranges (frames from the clip's start):
//   anim      one range, "Animation Start" .. "Animation Frames" (src/main/retime.js; no start on older clips)
//   typing    one range, "Typing Start" .. "Typing Frames" (no start on clips placed before it existed)
//   segments  one range per text, Seg<n>Start .. Seg<n>End (e.g. the MultiText "Highlight Select")
// Only inputs on the clip's comp are changed, so its Inspector keeps working.

module.exports = { clipTiming, currentFusionClip, setClipTiming, fitClipToWords, wordTimingStatus, activateWordTimings };

const state = require('./state');
const { RESOLVE_BATCH } = require('./config');
const { bridgeCall } = require('./fusion-bridge');
const { currentTimeline, getProject, tcToFrame, timelineMeta, videoTrackLists } = require('./resolve');
const PERF = require('./perf');
const { deleteExtraSfx, findAudioItemById, findItemById, placeExtraSfx } = require('./placement');
const { refitRowSfx, segSfxFor, segSfxForget, segSfxRecord, segSfxSetEmpty } = require('./row-sfx');
const { typingFramesFor } = require('./title-templates');

// itemId -> { at, info } : what the clip's comp said last (null info = no timing slider)
const cache = new Map();
const READ_EVERY = 1500;
let meta = { key: null, at: 0, meta: null };
let tracks = { key: null, at: 0, list: [] };

async function readInfo(itemId, force) {
    const c = cache.get(itemId);
    if (c && !force && Date.now() - c.at < READ_EVERY) return c.info;
    if (c && !force && require('./resolve-load').resolveBusy()) return c.info;      // Resolve busy: the last reading
    let info = null;
    try {
        const r = await bridgeCall('timing_get', { item: itemId }, 6000);
        info = r && r.kind ? r : null;
    } catch (e) { info = c ? c.info : null; }
    cache.set(itemId, { at: Date.now(), info });
    if (info && info.kind === 'segments') rowTextChanged(itemId, info);
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return info;
}

async function clipFacts(item) {
    const [id, name, start, end] = await Promise.all([item.GetUniqueId(), item.GetName(), item.GetStart(), item.GetEnd()]);
    return { itemId: String(id), name: String(name || ''), start: Number(start), end: Number(end) };
}

// The clips worth looking at: the selected video clips first, then the clips under the playhead from the top track down.
// The clip list is read every TRACKS_MS (40 clips at a time, in parallel; one call at a time it was every clip of
// the timeline, serially, every 2 s); the answer for one (frame, selection) is shared by the timing bar and the Clip
// controls, which poll 300 ms and 700 ms apart, for CAND_MS.
// Every TRACKS_MS the track lists are looked at (listed again when older than LISTS_MS, or after a change this
// plugin made) and only a track whose clip count changed has its clips' start / end read again (a placement changes
// its track's count). Besides that ONE track per look, the one read longest ago, is read again once it is
// TRACKS_FULL_MS old: all tracks at once every 20 s was a 1-2 s burst of calls that held up Resolve and every other
// reader. A clip trimmed by hand is seen by its start / end a little later, or at once when it is selected (the
// selection is read every time). Nothing is re-read while a placement runs (the old list serves).
const TRACKS_MS = 5000, TRACKS_FULL_MS = 20000, LISTS_MS = 10000, CAND_MS = 600;
let candMemo = { key: '', at: 0, list: null };
// -> [{ item, start, end, comps }] for one track's items, 40 at a time
async function trackFacts(arr) {
    const list = [];
    for (let i = 0; i < arr.length; i += RESOLVE_BATCH) {
        const part = arr.slice(i, i + RESOLVE_BATCH);
        const se = await Promise.all(part.map(it => Promise.all([it.GetStart(), it.GetEnd()]).catch(() => null)));
        for (let k = 0; k < part.length; k++) if (se[k]) list.push({ item: part[k], start: Number(se[k][0]), end: Number(se[k][1]), comps: null });
    }
    return list;
}
async function candidates(tl, frame, tlName) {
    const ls = state.lastSelection;
    const selKey = (ls && Date.now() - ls.at < 1500) ? ls.items.length + ':' + ls.at : 'q';
    const key = tlName + ':' + frame + ':' + selKey;
    if (candMemo.list && candMemo.key === key && Date.now() - candMemo.at < CAND_MS) return candMemo.list;
    // Resolve answering one call per frame (resolve-load.js): keep the last list rather than re-walk the tracks
    if (candMemo.list && require('./resolve-load').resolveBusy()) return candMemo.list;
    const sp = PERF.span('timing.candidates');
    const out = [];
    try {
        // the selection the panel's poll just read (poll.js), else Resolve's
        let sel, types;
        if (ls && Date.now() - ls.at < 1500) { sel = ls.items; types = ls.types; }
        else {
            const all = (await tl.GetSelectedClips()) || [];
            sel = Array.isArray(all) ? all : Object.values(all);
            types = await Promise.all(sel.map(c => Promise.resolve(c.GetTrackTypeAndIndex()).catch(() => null)));
        }
        const vid = sel.filter((c, k) => types[k] && types[k][0] === 'video');
        const comps = await Promise.all(vid.map(c => Promise.resolve(c.GetFusionCompCount()).catch(() => 0)));
        const facts = await Promise.all(vid.filter((c, k) => comps[k] > 0).map(c => clipFacts(c).catch(() => null)));
        for (const f of facts) if (f) out.push(Object.assign(f, { selected: true }));
    } catch (e) { /* no selection API: playhead only */ }
    if (tracks.key !== tlName || (Date.now() - tracks.at > TRACKS_MS && !state.applying)) {
        const now = Date.now();
        const fresh = tracks.key !== tlName;
        const byTrack = new Map(), reread = [];
        const lists = await videoTrackLists(tl, tlName, LISTS_MS);      // shared with seg-watch's sweep
        const n = lists.length;
        // the one track (with clips) read longest ago gets its turn when that was TRACKS_FULL_MS or more back
        let due = 0, dueAt = now - TRACKS_FULL_MS;
        if (!fresh) for (let t = 1; t <= n; t++) {
            const old = tracks.byTrack && tracks.byTrack.get(t);
            if (old && old.list.length && old.list.length === lists[t - 1].length && old.at <= dueAt) { due = t; dueAt = old.at; }
        }
        for (let t = n; t >= 1; t--) {
            const arr = lists[t - 1];
            const old = !fresh && tracks.byTrack && tracks.byTrack.get(t);
            if (old && old.list.length === arr.length && t !== due) { byTrack.set(t, old); continue; }
            byTrack.set(t, { at: Date.now(), list: await trackFacts(arr) });
            reread.push(t);
        }
        const list = [];
        for (let t = n; t >= 1; t--) list.push(...byTrack.get(t).list);
        tracks = { key: tlName, at: now, byTrack, list };
        PERF.record('timing.tracks', Date.now() - now, { full: fresh, reread: reread.length, tracks: n });
    }
    const under = tracks.list.filter(x => frame >= x.start && frame < x.end);
    // the comp count of a clip is read once per list (it does not change while the clip sits there)
    const counts = await Promise.all(under.map(x => x.comps !== null ? x.comps : Promise.resolve(x.item.GetFusionCompCount()).then(v => { x.comps = Number(v) || 0; return x.comps; }).catch(() => 0)));
    // a clip's id and name do not change while it sits in the list: read once, then only its start / end
    for (let k = 0; k < under.length; k++) {
        if (!(counts[k] > 0)) continue;
        const x = under[k];
        try {
            if (!x.facts) x.facts = await clipFacts(x.item);
            else { const [s, e] = await Promise.all([x.item.GetStart(), x.item.GetEnd()]); x.facts.start = Number(s); x.facts.end = Number(e); }
            out.push(Object.assign({}, x.facts));
        } catch (e) { x.facts = null; /* gone */ }
    }
    candMemo = { key, at: Date.now(), list: out };
    sp.end({ n: out.length });
    return out;
}

// The Fusion clip the user is working on, picked like the timing bar's: the selected video clip, else the top clip
// under the playhead. -> { itemId, name, start, end, selected } or null. Used by the Clip controls (clip-controls.js).
async function currentFusionClip() {
    const { project, tl, tlName } = await currentTimeline(700);
    if (!tl) return null;
    if (meta.key !== tlName || Date.now() - meta.at > 5000) meta = { key: tlName, at: Date.now(), meta: await timelineMeta(tl, project) };
    const frame = tcToFrame(await tl.GetCurrentTimecode(), meta.meta);
    const list = await candidates(tl, frame, tlName);
    return list[0] || null;
}

// ------------------------------------------------------------------ row sounds follow the row's text (placed clips)
// Each fresh read of a MultiText clip (the clip under the playhead / selected, while the Use tab is open) says which
// rows have no text. A row that got text since the sounds were placed gets its row sounds; a row that was cleared
// loses them. Only changes count (the recorded 'empty' state), so a sound deleted by hand is not put back. The clip
// of a running Resolve preview is handled by the preview itself (live-preview.js syncRowSounds).
let rowSync = Promise.resolve();
function rowTextChanged(itemId, info) {
    rowSync = rowSync.then(() => syncPlacedRowSounds(itemId, info)).catch(() => { /* tried again on the next read */ });
}
async function syncPlacedRowSounds(itemId, info) {
    if (state.liveSession && String(state.liveSession.itemId) === String(itemId)) return;
    if (state.applying) return;
    const rec = segSfxRecord(itemId);
    if (!rec.layers.length) return;
    const now = {}, segs = {};
    for (const r of info.ranges || []) {
        segs[Number(r.key)] = Math.max(0, Math.round(Number(r.start) || 0));
        if (r.empty) now[Number(r.key)] = true;
    }
    const rows = [...new Set(rec.layers.map(l => Math.max(1, Math.round(Number(l.seg) || 1))))];
    const flip = rows.filter(n => !!now[n] !== !!(rec.empty || {})[n]);
    if (!flip.length || state.applying) return;
    state.applying = true;          // claimed before the first await, so a placement cannot start in between
    try {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) return;
        const text = await findItemById(tl, itemId);
        if (!text) return;
        // cleared rows: their sounds go
        const drop = rec.sounds.filter(x => flip.includes(Number(x.seg)) && now[Number(x.seg)]).map(x => x.id);
        if (drop.length) {
            const left = await deleteExtraSfx(tl, drop);
            segSfxForget(itemId, drop.filter(id => !left.includes(id)));
        }
        // rows that got text: their sounds come in, at the row's start on this clip
        const add = rec.layers.filter(l => { const n = Math.max(1, Math.round(Number(l.seg) || 1)); return flip.includes(n) && !now[n]; });
        if (add.length) {
            const [start, end] = [Number(await text.GetStart()), Number(await text.GetEnd())];
            const tlName = await tl.GetName();
            if (meta.key !== tlName || !meta.meta) meta = { key: tlName, at: Date.now(), meta: await timelineMeta(tl, project) };
            await placeExtraSfx(tl, project, meta.meta, add, start, end, [], text, itemId, [], null, true, { rows: null, segs, empty: now });
        }
        segSfxSetEmpty(itemId, now);
    } finally { state.applying = false; }
}

async function clipTiming(event, opts) {
    if (state.applying) return { ok: false, busy: true };
    try {
        const { project, tl, tlName } = await currentTimeline(700);
        if (!tl) return { ok: false, reason: 'Open a timeline in Resolve' };
        if (meta.key !== tlName || Date.now() - meta.at > 5000) meta = { key: tlName, at: Date.now(), meta: await timelineMeta(tl, project) };
        const frame = tcToFrame(await tl.GetCurrentTimecode(), meta.meta);
        const force = !!(opts && opts.force);
        const seen = new Set();
        let first = null;
        for (const c of await candidates(tl, frame, tlName)) {
            if (!first) first = c;
            if (seen.has(c.itemId)) continue;
            seen.add(c.itemId);
            const info = await readInfo(c.itemId, force && opts.itemId === c.itemId);
            if (!info) continue;
            const length = Math.max(1, c.end - c.start);
            return Object.assign({
                ok: true, itemId: c.itemId, name: c.name, selected: !!c.selected, kind: info.kind,
                start: c.start, length, fps: meta.meta.fps, frame, fitted: !!info.fitted,
                playhead: frame >= c.start && frame < c.end ? frame - c.start : null
            }, { ranges: rangesFor(info, length, meta.meta.fps) });
        }
        // a Fusion clip without a timing slider (a preset saved before retiming existed): say so instead of nothing
        if (first) return { ok: true, noSlider: true, itemId: first.itemId, name: first.name, frame };
        return { ok: true, none: true, frame };
    } catch (e) {
        return { ok: false, reason: String(e && e.message || e) };
    }
}

// The bridge's timing_get -> [{ key, label, start, end, defStart, defEnd, hasStart }], clamped to the clip.
// defStart / defEnd: the preset's own timing (what "Preset timing" goes back to).
function rangesFor(info, length, fps) {
    const clamp = (v, lo) => Math.max(lo, Math.min(length, Math.round(Number(v) || 0)));
    if (info.kind === 'segments') {
        // texts left empty (e.g. "Highlight Select" with only the emphasis filled) get no lane
        const all = info.ranges || [];
        const filled = all.filter(r => !r.empty);
        return (filled.length ? filled : all).map(r => {
            const start = clamp(r.start, 0);
            return {
                key: String(r.key), label: r.label || null, hasStart: true,
                start, end: Math.max(start + 1, clamp(r.end, 1)),
                defStart: clamp(r.defStart, 0), defEnd: Math.max(1, clamp(r.defEnd, 1))
            };
        });
    }
    // Typing presets: 0 = their automatic length, shown as that number
    const natural = info.kind === 'typing' ? typingFramesFor(length, fps) : Math.max(1, Math.round(Number(info.natural) || 1));
    const hasStart = (info.kind === 'anim' || info.kind === 'typing') && !!info.hasStart;
    const start = hasStart ? clamp(info.start, 0) : 0;
    const end = Math.max(start + 1, clamp(Math.round(Number(info.value) || 0) || natural, 1));
    return [{ key: info.kind, label: null, hasStart, start, end, defStart: 0, defEnd: Math.min(length, natural) }];
}

// ranges: [{ key, start, end }] (frames from the clip's start).
async function setClipTiming(event, itemId, ranges, wake) {
    if (!itemId) return { error: 'No clip' };
    const list = (Array.isArray(ranges) ? ranges : []).map(r => {
        const start = Math.max(0, Math.round(Number(r.start) || 0));
        return { key: String(r.key), start, end: Math.max(start + 1, Math.round(Number(r.end) || 1)) };
    });
    if (!list.length) return { error: 'No timing to set' };
    const r = await bridgeCall('timing_set', { item: String(itemId), ranges: list, wake: !!wake }, 6000);
    cache.delete(String(itemId));      // the next read shows what the clip really has now
    candMemo.list = null;
    state.segSweepHot = Date.now();    // seg-watch's sweep looks soon
    if (!(r && r.ok)) return { error: (r && r.why) || 'Could not set the timing on that clip' };
    // A change made outright (release, keys, buttons): the Upper / Emphasis / Lower sounds follow their row's start.
    let sounds = null;
    if (wake) { try { sounds = await moveSegSounds(String(itemId), list); } catch (e) { sounds = { error: e.message }; } }
    // ... and the per-row copies of a 'Repeat per row' sound (Kinetic Cloud) re-space with the animation's speed
    if (wake && list.some(r => r.key === 'anim' || r.key === 'typing')) {      // typing: one keystroke per word follows the words
        let rs = null;
        try { rs = await refitRowSounds(String(itemId)); } catch (e) { rs = { error: e.message }; }
        if (rs) sounds = sounds ? { moved: (sounds.moved || 0) + (rs.moved || 0), failed: (sounds.failed || 0) + (rs.failed || 0), error: sounds.error || rs.error, rows: rs.moved || 0 }
            : Object.assign({ rows: rs.moved || 0 }, rs);
    }
    return { ok: true, sounds };
}

// Places the clip's per-row sound copies again at its new row times (row-sfx.js refitRowSfx). The clip of a
// running Resolve preview keeps its sounds unlinked and temporary; the preview's and automation's id lists follow.
async function refitRowSounds(itemId) {
    if (state.applying) return null;
    state.applying = true;
    try {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        if (!tl) return null;
        const text = await findItemById(tl, itemId);
        if (!text) return null;
        const tlName = await tl.GetName();
        if (meta.key !== tlName || !meta.meta) meta = { key: tlName, at: Date.now(), meta: await timelineMeta(tl, project) };
        const live = state.liveSession && String(state.liveSession.itemId) === String(itemId) ? state.liveSession : null;
        const r = await refitRowSfx(tl, project, meta.meta, text, itemId, !live);
        if (!r) return null;
        for (const sw of r.swaps) {
            if (live) {
                live.extraIds = (live.extraIds || []).filter(id => !sw.from.includes(id)).concat(sw.to);
                live.extraLinkIds = (live.extraLinkIds || []).filter(id => !sw.from.includes(id)).concat(sw.link);
            }
            try { require('./automation').swapAudioIds(sw.from, sw.to); } catch (e) { /* only automation-placed clips are listed there */ }
        }
        return { moved: r.moved, failed: r.failed };
    } finally { state.applying = false; }
}

// Puts every sound placed for one row of this clip (row-sfx.js segSfx*) at that row's start + its own offset.
// -> { moved, failed } (null when the clip has no row sounds)
async function moveSegSounds(itemId, list) {
    const links = segSfxFor(itemId);
    if (!links.length) return null;
    const starts = {};
    for (const r of list) if (/^\d+$/.test(r.key)) starts[Number(r.key)] = r.start;
    const want = links.filter(x => starts[x.seg] !== undefined);
    if (!want.length) return null;
    const project = await getProject();
    const tl = project && await project.GetCurrentTimeline();
    if (!tl) return null;
    const text = await findItemById(tl, itemId);
    if (!text) return null;
    const clipStart = Number(await text.GetStart());
    let moved = 0, failed = 0;
    const gone = [];
    for (const x of want) {
        const it = await findAudioItemById(tl, x.id);
        if (!it) { gone.push(x.id); continue; }
        const target = clipStart + starts[x.seg] + (Number(x.off) || 0);
        if (Number(await it.GetStart()) === target) continue;
        let ok = false;
        try { if (typeof it.SetPosition === 'function') ok = !!(await it.SetPosition({ startFrame: target }, false)); } catch (e) { ok = false; }
        if (ok) moved++; else failed++;
    }
    if (gone.length) segSfxForget(itemId, gone);
    // A linked sound moved on its own is now out of sync with its text clip (Resolve's red "-00:10" badge on both).
    // Linking the same group again takes the new positions as the sync point. An unlinked clip (live preview) stays so.
    if (moved && typeof tl.SetClipsLinked === 'function' && typeof text.GetLinkedItems === 'function') {
        try {
            let have = (await text.GetLinkedItems()) || [];
            if (!Array.isArray(have)) have = Object.values(have);
            if (have.length) {
                await tl.SetClipsLinked([text, ...have], false);
                await tl.SetClipsLinked([text, ...have], true);
            }
        } catch (e) { /* the sounds are in place; only the badge stays */ }
    }
    return { moved, failed };
}

// ------------------------------------------------------------------ Fit to words (src/main/word-fit.js)
// The spoken words under a placed clip, in frames from the clip's start: the cached transcription of the dialogue
// track when one covers the clip (Cut tab Analyse, transcribe_words), else that span is transcribed now.
// The dialogue clips under a timeline span (the lowest audio track with sound, as the Cut tab's word analysis).
async function wordSegs(start, end) {
    const MEDIA = require('./media-analysis');
    const CUTTOOLS = require('./cut-tools');
    const pad = 12;
    const media = await CUTTOOLS.timelineMedia({ startFrame: Math.max(0, start - pad), endFrame: end + pad });
    const segs = MEDIA.pickSegments('words', media, {}).filter(s => s.tlEnd > start && s.tlStart < end);
    return { media, segs };
}
// Cached words of those clips over the span ([{ w, start, end }] in timeline frames), or null when one has none.
function cachedSpanWords(media, segs) {
    const MEDIA = require('./media-analysis');
    const words = [];
    for (const seg of segs) {
        const m = MEDIA.sourceMapper(seg);
        const a = Math.max(media.from, seg.tlStart), b = Math.min(media.to, seg.tlEnd);
        const w = MEDIA.cachedWords(seg.file, m.toFile(a), m.toFile(b));
        if (!w) return null;
        for (const x of w) words.push({ w: x.w, start: m.toFrame(x.start), end: m.toFrame(x.end) });
    }
    return words;
}

// The spoken words under a placed clip, in frames from the clip's start: the cached transcription of the dialogue
// track when one covers the clip (Activate word timings, Cut tab Analyse, transcribe_words), else that span is
// transcribed now.
async function spokenWordsFor(start, end) {
    const MEDIA = require('./media-analysis');
    const { media, segs } = await wordSegs(start, end);
    const inClip = (w) => w.end > start && w.start < end && (w.start + w.end) / 2 >= start - 1 && (w.start + w.end) / 2 < end;
    const rel = (w) => ({ w: w.w, start: w.start - start, end: w.end - start });
    let words = segs.length ? cachedSpanWords(media, segs) : null, cached = true;
    if (!words) {
        cached = false;
        const r = await MEDIA.analyseTimeline('words', media, {});
        if (!r.words.length && r.warnings.length) throw new Error(r.warnings[0]);
        words = r.words;
    }
    return { words: words.filter(inClip).map(rel).sort((x, y) => x.start - y.start), cached };
}

async function clipSpan(itemId) {
    const project = await getProject();
    const tl = project && await project.GetCurrentTimeline();
    if (!tl) throw new Error('Open a timeline in Resolve');
    const item = await findItemById(tl, String(itemId));
    if (!item) throw new Error('That clip is no longer on the timeline');
    return { start: Number(await item.GetStart()), end: Number(await item.GetEnd()) };
}

// Is there a word transcription for the dialogue under this clip? (the timing card's Word timings row)
// -> { ok, available, engine, sound }. Read once per clip (and again after a while), not on every poll.
const wordsSeen = new Map();
let asrSeen = { at: 0, engine: null };
async function wordTimingStatus(event, itemId, force) {
    if (!itemId) return { ok: false };
    const k = String(itemId);
    const c = wordsSeen.get(k);
    if (c && !force && Date.now() - c.at < 60000) return c.r;
    try {
        if (Date.now() - asrSeen.at > 300000 || asrSeen.engine === null) {
            const st = await require('./media-analysis').asrStatus();
            asrSeen = { at: Date.now(), engine: st.engines.length > 0 };
        }
        const { start, end } = await clipSpan(k);
        const { media, segs } = await wordSegs(start, end);
        const r = { ok: true, itemId: k, sound: segs.length > 0, available: segs.length > 0 && !!cachedSpanWords(media, segs), engine: asrSeen.engine };
        wordsSeen.set(k, { at: Date.now(), r });
        if (wordsSeen.size > 300) wordsSeen.delete(wordsSeen.keys().next().value);
        return r;
    } catch (e) {
        return { ok: false, reason: e.message };
    }
}

// "Activate word timings": transcribes the whole recording(s) under the clip once, so this clip and every other one
// cut from the same recording can be fitted without waiting again.
let activating = null;
async function activateWordTimings(event, itemId) {
    if (activating) return { error: 'Word timings are already being worked out' };
    const MEDIA = require('./media-analysis');
    activating = String(itemId);
    try {
        const { start, end } = await clipSpan(itemId);
        const { segs } = await wordSegs(start, end);
        if (!segs.length) return { error: 'No dialogue under this clip (the lowest audio track with sound is used)' };
        const st = await MEDIA.asrStatus();
        if (!st.engines.length) return { error: 'No speech engine is installed: ' + st.install.join('; ') };
        const files = [...new Set(segs.map(x => x.file))];
        let words = 0;
        for (const f of files) {
            const r = await MEDIA.transcribeWords(f, {});
            words += (r.words || []).length;
        }
        wordsSeen.clear();
        return { ok: true, files: files.length, words, names: segs.map(x => x.name).filter((v, i, a) => a.indexOf(v) === i) };
    } catch (e) {
        return { error: e.message };
    } finally { activating = null; }
}

async function fitClipToWords(event, itemId) {
    if (!itemId) return { error: 'No clip' };
    if (state.applying) return { error: 'Busy placing: try again in a moment' };
    const WF = require('./word-fit');
    let start, end;
    try { ({ start, end } = await clipSpan(itemId)); } catch (e) { return { error: e.message }; }
    const length = Math.max(1, end - start);
    let spoken;
    try { spoken = await spokenWordsFor(start, end); } catch (e) { return { error: 'No word timings: ' + e.message }; }
    if (!spoken.words.length) return { error: 'No spoken words under this clip (the dialogue is on the lowest audio track with sound)' };
    const info = await bridgeCall('word_fit_info', { item: String(itemId) }, 8000);
    const kind = info && info.kind;
    if (!kind) return { error: 'This clip\'s preset has no timing slider' };
    const done = (r, extra) => { cache.delete(String(itemId)); candMemo.list = null; return Object.assign({ ok: true, kind, spokenWords: spoken.words.length, transcribed: !spoken.cached }, extra, r); };

    if (kind === 'segments') {
        const rows = ((await bridgeCall('mt_rows_get', { item: String(itemId) }, 6000)) || {}).rows || [];
        const plan = WF.planRows(rows.filter(r => String(r.text || '').trim()).map(r => ({ key: String(r.n), text: r.text })), spoken.words, length);
        if (!plan || !plan.ranges.length) return { error: 'Could not match the rows\' text to the spoken words' };
        const r = await setClipTiming(event, itemId, plan.ranges, true);
        if (r.error) return r;
        return done({ mode: 'rows', rows: plan.ranges.length, matched: plan.matched, words: plan.words, sounds: r.sounds });
    }
    // word-pop presets: a curve through the spoken words (fusion_bridge op_word_fit_set)
    let plan = null, mode = null;
    if (info.target === 'animtime') {
        // the Follower that sets the natural length carries the reveal
        const len = (t) => (Number(t.a) || 0) + (Number(t.delay) || 0) * Math.max(0, WF.textWords(t.text).letters - 1);
        const term = info.terms.slice().sort((x, y) => len(y) - len(x))[0];
        plan = WF.planAnimKeys(term, spoken.words, length);
        mode = 'letters';
    } else if (info.target === 'step') {
        plan = WF.planStepKeys(info.units || [], spoken.words, length, info.pop);
        mode = info.preset === 'justpop' ? 'words' : 'rows-pop';
    } else if (info.target === 'typing') {
        plan = WF.planTypingKeys(info.text, spoken.words, length);
        mode = 'typing';
    }
    if (plan) {
        const r = await bridgeCall('word_fit_set', { item: String(itemId), target: info.target, keys: plan.keys, frames: plan.frames,
            start: plan.start, end: plan.end, wake: true }, 15000);
        if (!(r && r.ok)) return { error: (r && r.why) || 'Could not key the clip' };
        let sounds = null;
        try { sounds = await refitRowSounds(String(itemId)); } catch (e) { sounds = { error: e.message }; }
        return done({ mode, keys: plan.keys.length, matched: plan.matched, words: plan.words, units: plan.units,
            speed: info.target === 'typing' ? null : WF.speedRange(plan.keys), start: plan.start, end: plan.end, sounds });
    }
    // whole-text animations (or nothing matched): one range on the spoken words
    const lin = WF.planLinear(kind, spoken.words, length);
    if (!lin) return { error: 'Could not fit the timing' };
    const r = await setClipTiming(event, itemId, [{ key: kind, start: lin.start, end: lin.end }], true);
    if (r.error) return r;
    return done({ mode: 'range', start: lin.start, end: lin.end, sounds: r.sounds });
}
