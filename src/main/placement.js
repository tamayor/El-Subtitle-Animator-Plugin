// Building blocks for putting clips on the timeline: picking free tracks, inserting / moving / trimming
// Text+ titles safely, importing sounds and placing layered sound effects.

// Declared before module.exports: a const used in the export list must exist when it runs.
const FADE_WARNING = 'Resolve did not take the sound\'s fade-out. Drag the fade handle on the audio clip to add it.';

module.exports = {
    FADE_WARNING, appendSfxCut, cutCheck, cutSnapshot, deleteClipsById, deleteExtraSfx, directPlaceTitle, findAudioItemById, findItemById, fitDuration,
    importSfx, insertTitleAtEnd, installAllTemplates, relinkToProjectCopy, inspectorSafeComp, isTitleClipName, layerList, moveTitleSafe, pickTrack,
    presetOutputFor, presetTitleFor, presetTitleNames, presetTplState, pruneTemplates, startupTemplates, syncTemplates,
    placeExtraSfx, rowFramesFor, segSfxFor, segSfxForget, segSfxRecord, segSfxSetEmpty, sfxCutFor, sfxCutFrames, titleKindFor, titlesDir, trackUsable, typingFramesFor
};

const path = require('path');
const fs = require('fs');
const os = require('os');

const state = require('./state');
const { ANIM_DIR, APP_DATA_DIR, DATA_DIR } = require('./config');
const { isEditedSfxName, sfxFilePath } = require('./sfx');
const { blockEnd, detectNodes, expandAllTools } = require('./fusion-setting');
const { regAdd, regDel } = require('./live-preview');
const { dlog } = require('./log');
const { upgradeRetiming } = require('./retime');
const { hideAddons } = require('./addon-controls');
const { frameToTC, tcToFrame } = require('./resolve');
const { ensureStopped } = require('./playback');

// ------------------------------------------------------------------ building the clip
// Placement options (all off by default), set from the pop-up beside "Add to timeline":
//   locked        a locked track counts as occupying its layer (Text+ then goes above it)
//   disabledTrack a disabled track counts as occupying its layer
//   disabledClip  a disabled clip counts as occupying its track
//   firstEmpty    use the lowest empty layer instead of the top one
//   rangeFrom / rangeTo  keep the Text+ between V<rangeFrom> and V<rangeTo> (rangeTo null = no upper limit). Tracks
//                 above rangeTo are ignored when looking for the top. When every layer of the range is taken there
//                 (e.g. stacked captions), the lowest free layer above the range is used, or a new track is added.
// Text+ is never put onto a locked or disabled track itself (it cannot be placed / would be invisible).
function rangeOf(o) {
    const int = (v) => { if (v === null || v === undefined || v === '') return null; const n = Math.round(Number(String(v).replace(/^v/i, ''))); return Number.isFinite(n) && n > 0 ? n : null; };
    const from = Math.max(2, int(o.rangeFrom) || 2);
    let to = int(o.rangeTo);
    if (to !== null && to < from) to = from;
    return { rangeFrom: from, rangeTo: to, ranged: int(o.rangeFrom) !== null || to !== null };
}
// Audio tracks for the sound effects (audioMode):
//   'any'  (default) the lowest free audio track
//   'same' the same numbers as the video track range (V3-V5 -> A3-A5); no video range set = 'any'
//   'own'  its own range A<audioFrom> to A<audioTo> (audioTo null = no upper limit)
function audioRangeOf(o, vr) {
    const int = (v) => { if (v === null || v === undefined || v === '') return null; const n = Math.round(Number(String(v).replace(/^a/i, ''))); return Number.isFinite(n) && n > 0 ? n : null; };
    const mode = (o.audioMode === 'same' || o.audioMode === 'own') ? o.audioMode : 'any';
    if (mode === 'same' && vr.ranged) return { audioMode: 'same', audioFrom: vr.rangeFrom, audioTo: vr.rangeTo, audioRanged: true };
    if (mode === 'own') {
        const from = int(o.audioFrom) || 1;
        let to = int(o.audioTo);
        if (to !== null && to < from) to = from;
        if (int(o.audioFrom) !== null || to !== null) return { audioMode: 'own', audioFrom: from, audioTo: to, audioRanged: true };
    }
    return { audioMode: mode, audioFrom: 1, audioTo: null, audioRanged: false };
}
function placeOpts(o) {
    o = o || {};
    const vr = rangeOf(o);
    return Object.assign({ locked: !!o.locked, disabledTrack: !!o.disabledTrack, disabledClip: !!o.disabledClip, firstEmpty: !!o.firstEmpty }, vr, audioRangeOf(o, vr));
}

async function trackUsable(tl, kind, t) {
    try { if (await tl.GetIsTrackLocked(kind, t)) return false; } catch (e) { /* ignore */ }
    try { if ((await tl.GetIsTrackEnabled(kind, t)) === false) return false; } catch (e) { /* ignore */ }
    return true;
}

// Does this track hold something in [s, e) that counts under the placement options?
async function trackHasClip(tl, kind, t, s, e, po) {
    try {
        if (!po.locked && await tl.GetIsTrackLocked(kind, t)) return false;
        if (!po.disabledTrack && (await tl.GetIsTrackEnabled(kind, t)) === false) return false;
    } catch (err) { /* ignore */ }
    for (const it of ((await tl.GetItemListInTrack(kind, t)) || [])) {
        if (!((await it.GetStart()) < e && (await it.GetEnd()) > s)) continue;
        if (!po.disabledClip) {
            let on = true;
            try { on = (await it.GetClipEnabled()) !== false; } catch (err) { on = true; }
            if (!on) continue;
        }
        return true;
    }
    return false;
}

async function trackIsFree(tl, kind, t, s, e) {
    if (await tl.GetIsTrackLocked(kind, t)) return false;
    const items = (await tl.GetItemListInTrack(kind, t)) || [];
    for (const it of items) {
        if ((await it.GetStart()) < e && (await it.GetEnd()) > s) return false;
    }
    return true;
}

// Auto (video) = the top: one track above the highest track that counts as occupied at that moment (see the
// placement options), never a gap lower down; or the lowest empty layer with "first empty layer". With a track range
// (rangeFrom / rangeTo): the first usable empty layer from rangeFrom up, past the range when it is full. A new track is
// added when there is none. Auto (audio) = the lowest free audio track, or with an audio range (see audioRangeOf) the
// first free usable track from audioFrom up, past the range when it is full.
async function pickTrack(tl, kind, wanted, s, e, firstAuto, notes, placeIn) {
    const n = await tl.GetTrackCount(kind);
    const label = (kind === 'audio' ? 'A' : 'V');
    const po = placeOpts(placeIn);
    if (kind === 'video' && wanted === 1) { notes.push('V1 is never used for Text+ (it would cut the clips), so the top layer was used'); wanted = 0; }
    if (wanted > 0 && wanted <= n) {
        if (await trackIsFree(tl, kind, wanted, s, e)) return wanted;
        notes.push(label + wanted + ' is busy there, so the lowest free track was used');
    }
    if (kind === 'video') {
        const lo = Math.max(firstAuto, po.rangeFrom), hi = po.rangeTo === null ? Infinity : po.rangeTo;
        const ranged = po.ranged;
        const where = ranged ? ' (range V' + lo + '-' + (hi === Infinity ? '∞' : 'V' + hi) + ')' : '';
        // adds tracks until V<t> exists (a range that starts above the current top track)
        const addUpTo = async (t) => { let c = n; while (c < t) { await tl.AddTrack('video'); c++; } return t; };
        let target = null;
        // a range always starts at its first track and steps up past locked / disabled / busy ones (never jumps
        // above a higher clip like "top" does); no range = the top, or the lowest empty layer with firstEmpty
        if (po.firstEmpty || ranged) {
            for (let t = Math.max(1, lo); t <= Math.min(n, hi); t++) {
                if (!(await trackUsable(tl, kind, t))) continue;
                if (!(await trackHasClip(tl, kind, t, s, e, po))) { target = t; break; }
            }
            if (target === null && n < lo) target = lo;            // the range starts above the existing tracks
            if (target === null && n < hi) target = n + 1;         // the range has room for a new track
        } else {
            let top = 0;
            for (let t = Math.min(n, hi); t >= lo; t--) {
                if (await trackHasClip(tl, kind, t, s, e, po)) { top = t; break; }
            }
            let t = Math.max(lo, top + 1);
            while (t <= n && t <= hi && !(await trackUsable(tl, kind, t))) t++;
            if (t <= hi) target = t;
        }
        if (target !== null) {
            if (target <= n) return target;
            await addUpTo(target);
            notes.push((ranged ? 'range' + where.replace(/^ \(range|\)$/g, '') + ': no free layer yet' : (po.firstEmpty ? 'no empty layer' : 'placed on top')) + ', added ' + label + (n + 1) + (target > n + 1 ? '-' + label + target : ''));
            return target;
        }
        // every layer of the range is taken: the lowest free layer above it, else a new track on top
        for (let t = hi + 1; t <= n; t++) {
            if (!(await trackUsable(tl, kind, t))) continue;
            if (!(await trackHasClip(tl, kind, t, s, e, po))) {
                notes.push(label + lo + '-' + label + (hi === Infinity ? '∞' : hi) + ' are all taken there, so ' + label + t + ' (above the range) was used');
                return t;
            }
        }
        await tl.AddTrack('video');
        notes.push(ranged ? (label + lo + '-' + label + hi + ' are all taken there, added ' + label + (n + 1) + ' above the range') : ('no empty layer, added ' + label + (n + 1)));
        return n + 1;
    }
    if (kind === 'audio' && po.audioRanged) {
        const lo = Math.max(firstAuto, po.audioFrom), hi = po.audioTo === null ? Infinity : po.audioTo;
        const span = 'A' + lo + '-' + (hi === Infinity ? '∞' : 'A' + hi);
        for (let t = lo; t <= Math.min(n, hi); t++) {
            if (!(await trackUsable(tl, kind, t))) continue;
            if (await trackIsFree(tl, kind, t, s, e)) return t;
        }
        if (n < hi) {                                   // room in the range for new tracks
            const target = Math.max(lo, n + 1);
            for (let c = n; c < target; c++) await tl.AddTrack('audio', 'stereo');
            notes.push('audio range ' + span + ': no free track yet, added A' + (n + 1) + (target > n + 1 ? '-A' + target : ''));
            return target;
        }
        for (let t = hi + 1; t <= n; t++) {
            if (!(await trackUsable(tl, kind, t))) continue;
            if (await trackIsFree(tl, kind, t, s, e)) { notes.push(span + ' are all taken there, so A' + t + ' (above the range) was used'); return t; }
        }
        await tl.AddTrack('audio', 'stereo');
        notes.push(span + ' are all taken there, added A' + (n + 1) + ' above the range');
        return n + 1;
    }
    for (let t = firstAuto; t <= n; t++) {
        if (await trackIsFree(tl, kind, t, s, e)) return t;
        notes.push(label + t + ' busy');
    }
    if (kind === 'audio') await tl.AddTrack('audio', 'stereo'); else await tl.AddTrack('video');
    notes.push('no free ' + label + ' track, added ' + label + (n + 1));
    return n + 1;
}

async function fitDuration(item, want) {
    // SetRightOffset(x) leaves x frames trimmed off the right edge (tested: ro + (current - wanted)).
    for (let i = 0; i < 3; i++) {
        const d = await item.GetDuration();
        if (d === want) return true;
        const ro = await item.GetRightOffset();
        await item.SetRightOffset(ro + (d - want));
    }
    return (await item.GetDuration()) === want;
}

// ------------------------------------------------------------------ sounds copied next to the footage
// When a subtitle is APPLIED (not while previewing), its sounds are copied into
// "<footage folder>/El Subtitle Animator SFX/" and imported from there, so the project keeps its own copy beside its
// media (it stays online when moved or archived with the footage, and does not depend on the plugin's library).
// The footage folder is chosen once per timeline - the folder most of the timeline's own clips come from (titles,
// generators and the plugin's sounds skipped) - and saved in _app/timeline-sfx-dirs.json, so every later apply on that
// timeline reuses the same location. With no footage on the timeline yet, or when the folder cannot be written, the
// sound is imported from the library as before (and nothing is saved, so the next apply tries again).
const PROJECT_SFX_DIR = 'El Subtitle Animator SFX';
const TL_SFX_DIRS_FILE = path.join(APP_DATA_DIR, 'timeline-sfx-dirs.json');
function readTlSfxDirs() { try { return JSON.parse(fs.readFileSync(TL_SFX_DIRS_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function isOwnSound(dir) {
    return path.basename(dir) === PROJECT_SFX_DIR || dir.startsWith(DATA_DIR + path.sep) || dir === DATA_DIR;
}
async function scanFootageDir(tl) {
    const counts = new Map(), seen = new Set();
    for (const kind of ['video', 'audio']) {
        const n = (await tl.GetTrackCount(kind)) || 0;
        for (let t = 1; t <= n; t++) {
            for (const it of ((await tl.GetItemListInTrack(kind, t)) || [])) {
                let p = '';
                try { const m = await it.GetMediaPoolItem(); p = m ? String(await m.GetClipProperty('File Path') || '') : ''; } catch (e) { /* title / generator */ }
                if (!p || seen.has(p)) continue;
                seen.add(p);
                const dir = path.dirname(p);
                if (!isOwnSound(dir)) counts.set(dir, (counts.get(dir) || 0) + 1);
            }
        }
    }
    let dir = null, best = 0;
    for (const [d, c] of counts) if (c > best) { dir = d; best = c; }
    return dir;
}
// The timeline's saved footage folder, or (first apply) the scanned one, saved for next time.
async function timelineSfxDir(project) {
    const tl = await project.GetCurrentTimeline();
    if (!tl) return null;
    const key = String(await project.GetName()) + '::' + String(await tl.GetUniqueId());
    const saved = readTlSfxDirs();
    if (saved[key] && fs.existsSync(saved[key])) return saved[key];
    const dir = await scanFootageDir(tl);
    if (!dir || !fs.existsSync(dir)) return null;
    saved[key] = dir;
    try { fs.mkdirSync(APP_DATA_DIR, { recursive: true }); fs.writeFileSync(TL_SFX_DIRS_FILE, JSON.stringify(saved, null, 2)); } catch (e) { /* reused this session only */ }
    dlog('TIMELINE-SFX-DIR', key, dir);
    return dir;
}
function sameFile(a, b) {
    try {
        const sa = fs.statSync(a), sb = fs.statSync(b);
        return sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
    } catch (e) { return false; }
}
// The path to import: the timeline's copy of sfxPath (made when missing), or sfxPath itself when no copy can be made.
async function projectSfxCopy(project, sfxPath) {
    try {
        if (path.basename(path.dirname(sfxPath)) === PROJECT_SFX_DIR) return sfxPath;      // already a timeline copy
        const dir = await timelineSfxDir(project);
        if (!dir) return sfxPath;
        const outDir = path.join(dir, PROJECT_SFX_DIR);
        fs.mkdirSync(outDir, { recursive: true });
        let dst = path.join(outDir, path.basename(sfxPath));
        if (fs.existsSync(dst) && !sameFile(sfxPath, dst)) {
            // another sound under the same name (e.g. a re-edited cut): keep both, tag this one by its content
            const tag = require('crypto').createHash('sha1').update(fs.readFileSync(sfxPath)).digest('hex').slice(0, 8);
            const ext = path.extname(sfxPath);
            dst = path.join(outDir, path.basename(sfxPath, ext) + ' ' + tag + ext);
        }
        if (!fs.existsSync(dst)) fs.copyFileSync(sfxPath, dst);
        return dst;
    } catch (e) {
        dlog('PROJECT-SFX-COPY-FAIL', String(e && e.message || e));
        return sfxPath;
    }
}
// A kept preview's sound was placed from the library: its Media Pool clip is pointed at the timeline's copy instead.
async function relinkToProjectCopy(project, sfxItem) {
    try {
        const mpi = await sfxItem.GetMediaPoolItem();
        const cur = mpi ? String(await mpi.GetClipProperty('File Path') || '') : '';
        if (!cur || !fs.existsSync(cur) || path.basename(path.dirname(cur)) === PROJECT_SFX_DIR) return;
        const copy = await projectSfxCopy(project, cur);
        if (copy !== cur) await mpi.ReplaceClip(copy);
    } catch (e) { dlog('PROJECT-SFX-RELINK-FAIL', String(e && e.message || e)); }
}

// projectCopy: true when the subtitle is being applied (see projectSfxCopy); previews import from the library.
async function importSfx(project, sfxPath, projectCopy) {
    if (projectCopy) sfxPath = await projectSfxCopy(project, sfxPath);
    const mp = await project.GetMediaPool();
    const keep = await mp.GetCurrentFolder();
    let target = null;
    try {
        const root = await mp.GetRootFolder();
        const subs = (await root.GetSubFolderList()) || [];
        for (const f of subs) { if ((await f.GetName()) === 'Subtitle Animator') { target = f; break; } }
        if (!target) target = await mp.AddSubFolder(root, 'Subtitle Animator');
    } catch (e) { /* ignore */ }
    const want = path.basename(sfxPath);
    // A clip is reused only when it is THIS file: matching the name alone picked up stale clips imported from an older
    // data folder (e.g. ~/Documents/Subtitle Animator/sfx/applepay.mp3), which are offline once that folder is gone.
    const samePath = async (c) => {
        try { return path.resolve(String(await c.GetClipProperty('File Path') || '')) === path.resolve(sfxPath); } catch (e) { return false; }
    };
    const findSame = async () => {
        for (const c of ((await target.GetClipList()) || [])) {
            if ((await c.GetName()) === want && await samePath(c)) return c;
        }
        return null;
    };
    if (target) {
        const hit = await findSame();
        if (hit) return { mp, item: hit };
        try { await mp.SetCurrentFolder(target); } catch (e) { /* ignore */ }
    }
    let items = await mp.ImportMedia([sfxPath]);
    if ((!items || !items.length) && target) {
        const hit = await findSame();
        if (hit) items = [hit];
    }
    try { if (keep) await mp.SetCurrentFolder(keep); } catch (e) { /* ignore */ }
    return { mp, item: items && items[0] };
}

// InsertFusionTitleIntoTimeline drops the title at the PLAYHEAD as a ripple insert. If the playhead is dragged while
// it is being parked at the end, the title would cut and push the real clips. So the playhead is checked after it is
// moved, the insert is refused when it is not at the end, and an insert that still landed early is ripple-deleted.
async function parkPlayhead(tl, frame, meta) {
    for (let i = 0; i < 4; i++) {
        try {
            await tl.SetCurrentTimecode(frameToTC(frame, meta));
            await new Promise(r => setTimeout(r, 40));
            if (tcToFrame(await tl.GetCurrentTimecode(), meta) === frame) return true;
        } catch (e) { /* retry */ }
        await new Promise(r => setTimeout(r, 120));
    }
    return false;
}
// Which title a preset needs: a preset built on a MultiText tool is created as a MultiText clip, everything else as Text+.
// Resolve's Edit-page Inspector stays EMPTY for a Fusion title whose comp contains an OFX node (e.g. the ResolveFX Stop Motion).
// Stop Motion is swapped for a native TimeStretcher whose SourceTime steps in blocks of N frames (floor(time/N)*N), so
// every Nth frame is held: the same stepped look, and the Inspector keeps working. (A TimeSpeed with a fmod Delay was
// used before; it evaluates but Resolve renders every frame anyway, so the wiggle played smooth.)
// Every tool is also saved as expanded and shown in the Inspector (see expandAllTools), so the settings show straight
// away when the clip is selected.
// The preset file on disk is never changed; the adjusted copy is written to a temp folder and imported instead.

function ofxNames(txt) { const r = [], re = /ofx\.com\.blackmagicdesign\.resolvefx\.(\w+)\s*\{/g; let m; while ((m = re.exec(txt))) r.push(m[1]); return r; }

function inspectorSafeComp(compPath) {
    try {
        const orig = fs.readFileSync(compPath, 'utf8');
        state.ofxLeft.set(compPath, ofxNames(orig).filter(n => n !== 'StopMotion'));
        const s = stopMotionToNative(expandAllTools(orig));
        return s === orig ? compPath : writeSafeComp(compPath, s);
    } catch (e) { return compPath; }
}

// The stop-motion stand-in: a TimeStretcher whose SourceTime steps in blocks of n frames. inp = [SourceOp, Source] or null.
function stopMotionTool(name, n, inp, view) {
    return name + ' = TimeStretcher {\n\t\t\tInputs = {\n' +
        '\t\t\t\tSourceTime = Input { Value = 0, Expression = "floor(time/' + n + ')*' + n + '", },\n' +
        '\t\t\t\tInterpolateBetweenFrames = Input { Value = 0, },\n' +
        (inp ? '\t\t\t\tInput = Input { SourceOp = "' + inp[0] + '", Source = "' + inp[1] + '", },\n' : '') +
        '\t\t\t},\n' + (view ? '\t\t\t' + view + ',\n' : '') + '\t\t}';
}
// Replaces every tool block matched by `re` (group 1 = tool name) with what make(name, block) returns (null = keep).
function replaceTools(s, re, make) {
    let m, out = '', last = 0;
    re.lastIndex = 0;
    while ((m = re.exec(s))) {
        const open = m.index + m[0].length - 1;
        const close = blockEnd(s, open);
        const rep = make(m[1], s.slice(m.index, close + 1));
        if (rep !== null) { out += s.slice(last, m.index) + rep; last = close + 1; }
        re.lastIndex = close + 1;
    }
    return last ? out + s.slice(last) : s;
}
// ResolveFX Stop Motion (OFX, empties the Inspector) and the older TimeSpeed stand-in (Delay = math.fmod(time, n), which
// Resolve renders unheld, so the wiggle played smooth) both become the TimeStretcher stand-in. A Stop Motion that is
// not connected to anything is converted too, so no OFX node is left behind.
function stopMotionToNative(s) {
    const viewOf = (b) => { const v = /ViewInfo\s*=\s*OperatorInfo\s*\{\s*Pos\s*=\s*\{[^}]*\}\s*\}/.exec(b); return v ? v[0] : null; };
    s = replaceTools(s, /([A-Za-z_]\w*)\s*=\s*ofx\.com\.blackmagicdesign\.resolvefx\.StopMotion\s*\{/g, (name, b) => {
        const src = /Source\s*=\s*Input\s*\{\s*SourceOp\s*=\s*"([^"]+)"\s*,\s*Source\s*=\s*"([^"]+)"/.exec(b);
        const rep = /frameRepeat\s*=\s*Input\s*\{\s*Value\s*=\s*([\d.]+)/.exec(b);
        return stopMotionTool(name, Math.max(1, Math.round(rep ? parseFloat(rep[1]) : 2)), src ? [src[1], src[2]] : null, viewOf(b));
    });
    s = replaceTools(s, /([A-Za-z_]\w*)\s*=\s*TimeSpeed\s*\{/g, (name, b) => {
        const fm = /Delay\s*=\s*Input\s*\{[^{}]*Expression\s*=\s*"math\.fmod\(time,\s*(\d+)\)"/.exec(b);
        if (!fm) return null;      // a TimeSpeed of the preset's own
        const src = /\bInput\s*=\s*Input\s*\{\s*SourceOp\s*=\s*"([^"]+)"\s*,\s*Source\s*=\s*"([^"]+)"/.exec(b);
        return stopMotionTool(name, Math.max(1, parseInt(fm[1], 10)), src ? [src[1], src[2]] : null, viewOf(b));
    });
    return s;
}

function writeSafeComp(compPath, out) {
    try {
        const dir = path.join(os.tmpdir(), 'sa-safe-comps');
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, require('crypto').createHash('md5').update(compPath).digest('hex').slice(0, 10) + '-' + path.basename(compPath));
        fs.writeFileSync(f, out);
        return f;
    } catch (e) { return compPath; }
}

function titleKindFor(compPath) {
    try { return detectNodes(compPath).some(n => n.kind === 'multitext') ? 'multitext' : 'text'; } catch (e) { return 'text'; }
}
// ------------------------------------------------------------------ presets as Resolve title templates
// Resolve's Edit-page Inspector only shows a Fusion title's controls for a title Resolve built itself. Once the clip's
// comp is replaced (ImportFusionComp, even with the clip's own exported comp), the Inspector shows only a folded
// "Text+" header. So each preset is installed as a Fusion title template (Edit/Titles/Subtitle Animator/<name>.setting)
// and inserted by name with InsertFusionTitleIntoTimeline: the clip is then a real Resolve title with working controls.
// Resolve picks up a new or rewritten template file straight away. The name starts with "Text+" / "MultiText", so
// isTitleClipName and cutSnapshot still recognise the clip.
function titlesDir() {
    const tail = ['Fusion', 'Templates', 'Edit', 'Titles', 'Subtitle Animator'];
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve', ...tail);
    if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Blackmagic Design', 'DaVinci Resolve', 'Support', ...tail);
    return path.join(os.homedir(), '.local', 'share', 'DaVinciResolve', ...tail);
}
// A title template is a .setting ({ Tools = ordered() { ... } }); a .comp preset is cut down to its tool list.
function asSetting(s) {
    if (!/^\s*Composition\s*\{/.test(s)) return s;
    const m = /\n\s*Tools\s*=\s*(?:ordered\(\)\s*)?\{/.exec(s);      // the first Tools list is the comp's own (group ones come later)
    if (!m) return null;
    const open = m.index + m[0].length - 1;
    return '{\n\tTools = ordered() ' + s.slice(open, blockEnd(s, open) + 1) + '\n}\n';
}
// Tool types that are modifiers / splines / annotations, not image tools: never a preset's final output.
const NOT_OUTPUT = /^(BezierSpline|CubicSpline|LUTBezier|PolyPath|XYPath|Path|StyledTextFollower|Follower|PerturbNumber|PerturbPoint|Calculation|Expression|CoordinateTransform|Shake|KeyStretcher|Probe|Offset|PublishNumber|PublishPoint|PublishText|PublishPolyLine|PublishImage|Note|Underlay|MediaOut|Saver)$/;
// A preset without a MediaOut (e.g. nodes copied out of the Fusion page, or a macro) gets one, connected to its final
// tool: Resolve adds an UNCONNECTED MediaOut when it inserts such a template (a black clip), and the MediaOut here is
// what presetOutputFor / set_output use to connect it. The final tool is the one image tool nothing else reads from
// (the ActiveTool when there are several). Left as it is when that cannot be told.
function withOutput(s) {
    if (/\b[A-Za-z_]\w*\s*=\s*(?:MediaOut|Saver)\s*\{/.test(s)) return s;
    const m = /\bTools\s*=\s*(?:ordered\(\)\s*)?\{/.exec(s);
    if (!m) return s;
    const listOpen = m.index + m[0].length - 1, listClose = blockEnd(s, listOpen);
    const tools = [];      // the list's direct children: Name = Type {
    const toolRe = /([A-Za-z_]\w*)\s*=\s*([A-Za-z_][\w.]*)\s*\{/y;
    for (let k = listOpen + 1; k < listClose; k++) {
        if (!/[A-Za-z_]/.test(s[k]) || /\w/.test(s[k - 1])) continue;
        toolRe.lastIndex = k;
        const t = toolRe.exec(s);
        if (!t) continue;
        tools.push({ name: t[1], type: t[2] });
        k = blockEnd(s, k + t[0].length - 1);
    }
    const used = new Set();
    for (const r of s.matchAll(/SourceOp\s*=\s*"([^"]+)"/g)) used.add(r[1]);
    const ends = tools.filter(t => !used.has(t.name) && !NOT_OUTPUT.test(t.type));
    const act = /\bActiveTool\s*=\s*"([^"]+)"/.exec(s);
    const end = ends.length === 1 ? ends[0] : ends.find(t => act && t.name === act[1]);
    if (!end || /^(MacroOperator|GroupOperator)$/.test(end.type)) return s;      // Resolve wires a macro title itself
    const mo = '\t\tMediaOut1 = MediaOut {\n\t\t\tInputs = {\n\t\t\t\tIndex = Input { Value = "0", },\n' +
        '\t\t\t\tInput = Input { SourceOp = "' + end.name + '", Source = "Output", },\n\t\t\t},\n\t\t}';
    const before = s.slice(0, listClose).replace(/\s*$/, '');
    return before + (before.endsWith(',') || before.endsWith('{') ? '\n' : ',\n') + mo + '\n\t' + s.slice(listClose);
}
// The template name for a preset: "Text+ <name>" / "MultiText <name>", from the preset's name in the panel (the file
// name when it has none), so Resolve's Titles list matches the plugin's preset list.
function cleanTitle(s) {
    return String(s || '').replace(/[^\w ()&+,.'-]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim();
}
function presetTitleName(compPath, presetName) {
    const base = cleanTitle(presetName) || cleanTitle(path.basename(compPath).replace(/\.(setting|comp)$/i, '')) || 'Preset';
    return (titleKindFor(compPath) === 'multitext' ? 'MultiText ' : 'Text+ ') + base;
}
// Template names of every preset whose file exists, by preset id. Two presets with the same name get " 2", " 3", ...
// in library order (compared without case: the macOS file system ignores it). animations: library.json entries.
function presetTitleNames(animations) {
    const out = new Map(), used = new Set();
    for (const a of animations || []) {
        try {
            const f = path.join(ANIM_DIR, a.file);
            if (!a.file || !fs.existsSync(f)) continue;
            const base = presetTitleName(f, a.name);
            let name = base, n = 2;
            while (used.has(name.toLowerCase())) name = base + ' ' + n++;
            used.add(name.toLowerCase());
            out.set(a.id, name);
        } catch (e) { /* skip */ }
    }
    return out;
}
// Deletes the templates of presets that are gone (removed, file replaced) from the plugin's own template folder, so
// they do not stay in Resolve's Titles list. animations: every preset in the library. Only *.setting files in that
// folder are touched. Clips already made from a deleted template keep working (the project holds their comp).
function pruneTemplates(animations) {
    const removed = [];
    try {
        const dir = titlesDir();
        if (!fs.existsSync(dir)) return removed;
        const keep = new Set([...presetTitleNames(animations).values()].map(n => (n + '.setting').toLowerCase()));
        for (const f of fs.readdirSync(dir)) {
            if (!/\.setting$/i.test(f) || keep.has(f.toLowerCase())) continue;
            try { fs.unlinkSync(path.join(dir, f)); removed.push(f); } catch (e) { /* in use or gone */ }
        }
        if (removed.length) dlog('TEMPLATES-PRUNED', removed);
    } catch (e) { dlog('TEMPLATES-PRUNE-FAIL', String(e && e.message || e)); }
    return removed;
}
// Keeps Resolve's Titles list in step with the library after presets are renamed, removed or replaced.
// before: presetTitleNames() taken before the change. A template whose preset got a new name is renamed (Resolve
// shows the new name straight away); templates of presets that are gone are deleted.
function syncTemplates(animations, before) {
    try {
        const dir = titlesDir();
        const after = presetTitleNames(animations);
        const moves = [];
        for (const [id, oldName] of (before || new Map())) {
            const newName = after.get(id);
            if (newName && newName !== oldName && fs.existsSync(path.join(dir, oldName + '.setting'))) moves.push([oldName, newName]);
        }
        // Two steps through a temporary name, so swapped or case-only renames never overwrite each other.
        const tmp = moves.map(([o], i) => {
            const t = path.join(dir, '.sa-rename-' + i + '-' + Date.now() + '.tmp');
            try { fs.renameSync(path.join(dir, o + '.setting'), t); return t; } catch (e) { return null; }
        });
        moves.forEach(([o, n], i) => {
            if (!tmp[i]) return;
            try { fs.renameSync(tmp[i], path.join(dir, n + '.setting')); } catch (e) { try { fs.unlinkSync(tmp[i]); } catch (e2) { /* gone */ } }
            if (state.presetTpl) state.presetTpl.delete(o);      // its cached Media Pool title belongs to the old name
            dlog('TEMPLATE-RENAMED', o, '->', n);
        });
    } catch (e) { dlog('TEMPLATES-SYNC-FAIL', String(e && e.message || e)); }
    const removed = pruneTemplates(animations);
    installAllTemplates(animations);
    return removed;
}
// Writes the title template of every preset whose file exists (presetTitleFor), so each one is installed - and scanned
// by Resolve - long before its first use. Written only on first use, a template could still be unknown to Resolve at
// that moment; the clip then fell back to a plain title with an empty Inspector. Returns the names written or refreshed.
function installAllTemplates(animations) {
    const done = [];
    try {
        const names = presetTitleNames(animations);
        for (const a of animations || []) {
            const name = names.get(a.id);
            if (!name) continue;
            const f = path.join(ANIM_DIR, a.file);
            const file = path.join(titlesDir(), name + '.setting');
            const had = fs.existsSync(file);
            let before = null;
            try { before = had ? fs.statSync(file).mtimeMs : null; } catch (e) { /* ignore */ }
            if (presetTitleFor(f, name)) {
                let after = null;
                try { after = fs.statSync(file).mtimeMs; } catch (e) { /* ignore */ }
                if (!had || after !== before) done.push(name);
            }
        }
        if (done.length) dlog('TEMPLATES-INSTALLED', done);
    } catch (e) { dlog('TEMPLATES-INSTALL-FAIL', String(e && e.message || e)); }
    return done;
}
// At start-up: templates made by older versions are named after the preset's file; they are renamed to the preset's
// name (instead of deleted and rebuilt on the next apply), and templates of presets that are gone are deleted.
function startupTemplates(animations) {
    const before = new Map();
    for (const a of animations || []) {
        try { const f = path.join(ANIM_DIR, a.file); if (a.file && fs.existsSync(f)) before.set(a.id, presetTitleName(f)); } catch (e) { /* skip */ }
    }
    const want = new Set([...presetTitleNames(animations).values()]);
    for (const [id, n] of before) if (want.has(n)) before.delete(id);      // already right, or another preset's name
    return syncTemplates(animations, before);
}

// Installs (or refreshes) the template for a preset and returns its name, or null when it could not be written.
// name: the preset's template name from presetTitleNames (the file name is used without it).
function presetTitleFor(compPath, name) {
    try {
        name = name || presetTitleName(compPath);
        // presets retimed before the Animation Start slider existed get it here (src/main/retime.js)
        const raw = asSetting(upgradeRetiming(fs.readFileSync(inspectorSafeComp(compPath), 'utf8')));
        if (!raw) return null;
        // the preset's add-ons are edited from the panel's Clip controls, not Resolve's Inspector (addon-controls.js)
        const body = hideAddons(withOutput(raw));
        const dir = titlesDir();
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, name + '.setting');
        let cur = null;
        try { cur = fs.readFileSync(file, 'utf8'); } catch (e) { /* not installed yet */ }
        if (cur !== body) fs.writeFileSync(file, body);
        return name;
    } catch (e) {
        dlog('PRESET-TITLE-FAIL', String(e && e.message || e));
        return null;
    }
}
function isTitleClipName(n) { return /^(Text\+|MultiText)/.test(String(n || '')); }
// The tool that feeds a preset's output (its MediaOut's SourceOp in the title template), e.g. "StopMotion1" for a
// wiggle preset. Resolve connects an inserted title's MediaOut to "Template" regardless, so apply reconnects it to
// this one (bridge op set_output). Null when the template cannot be read or has no MediaOut.
// Word-by-word typing presets have a "Typing Frames" slider (0 = follow the clip length). Placement sets it from the
// clip's length so the typing takes the clip minus 1 second (at least 10 frames, never past the last frame); extending
// the clip afterwards then leaves the typing as it is, and the user can change it in the Inspector.
function typingFramesFor(len, fps) {
    const n = Math.round(Number(len) || 0);
    if (n < 2) return 1;
    return Math.max(1, Math.min(n - 1, Math.max(10, n - Math.round(Number(fps) || 25))));
}
function presetOutputFor(title) {
    try {
        const s = fs.readFileSync(path.join(titlesDir(), title + '.setting'), 'utf8');
        const re = /([A-Za-z_]\w*)\s*=\s*(?:MediaOut|Saver)\s*\{/g;
        let m;
        while ((m = re.exec(s))) {
            const open = m.index + m[0].length - 1;
            const b = s.slice(open, blockEnd(s, open) + 1);
            const src = /\bInput\s*=\s*Input\s*\{\s*SourceOp\s*=\s*"([^"]+)"\s*,\s*Source\s*=\s*"([^"]+)"/.exec(b);
            if (!src) continue;
            // a macro / group output: Resolve wires a macro title correctly itself, and its outputs are not "Output"
            if (new RegExp('\\b' + src[1] + '\\s*=\\s*(?:MacroOperator|GroupOperator)\\s*\\{').test(s)) return null;
            return { source: src[1], output: src[2] };
        }
    } catch (e) { /* no template */ }
    return null;
}
// title: a preset's template name (see presetTitleFor); without it the plain Text+ / MultiText is inserted.
async function insertTitleAtEnd(tl, meta, endFrame, kind, title) {
    const titleName = title || (kind === 'multitext' ? 'MultiText' : 'Text+');
    // While the timeline plays (e.g. looping a preview) the playhead leaves the end again before the insert lands,
    // so the title would be ripple-inserted in the middle of the timeline. Playback is stopped first.
    if (!(await ensureStopped(tl))) return { error: 'The timeline is playing in Resolve. Stop playback (K), then select the preset again.' };
    if (!(await parkPlayhead(tl, endFrame, meta))) return { error: 'The playhead was moved while the ' + titleName + ' was being added, so nothing was inserted. Try again.' };
    // Resolve 21.2 THROWS ("Expected valid string type title name") instead of returning null for a template it has
    // not scanned yet - e.g. a preset's template written a moment ago on its first use. Retry once after a short wait,
    // then return no item so the caller's fallback (plain Text+ / MultiText) runs instead of the whole apply failing.
    // A template Resolve has not picked up yet is tried again for a few seconds (every attempt about 1.5 s apart): a
    // clip that falls back to the plain title gets an EMPTY Inspector, so the fallback is the last resort.
    // An In/Out mark makes Resolve insert at the In instead of the playhead. They are cleared for the insert and put
    // back afterwards (a Preview in Resolve has already cleared and saved its own, see liveClearMarks).
    let marks = null;
    try {
        const m = await tl.GetMarkInOut();
        if (m && ((m.video && typeof m.video.in === 'number') || (m.audio && typeof m.audio.in === 'number'))) { marks = m; await tl.ClearMarkInOut('all'); }
    } catch (e) { marks = null; }
    const restoreMarks = async () => {
        if (!marks) return;
        for (const type of ['video', 'audio']) {
            const v = marks[type];
            try { if (v && typeof v.in === 'number' && typeof v.out === 'number' && v.out >= v.in) await tl.SetMarkInOut(v.in, v.out, type); } catch (e) { /* ignore */ }
        }
    };
    // The playhead is parked again right before EVERY attempt: while a fresh template is retried (1.5 s apart) the
    // preview's loop playback or a panel seek could move it, and the title then went in mid-timeline. A title that
    // still lands before the end is ripple-deleted and inserted once more before giving up.
    let item = null, misplaced = 0;
    const attempts = title ? 5 : 1;
    try {
        for (let attempt = 0; attempt < attempts; attempt++) {
            if (attempt > 0 || misplaced) {
                if (!(await ensureStopped(tl))) return { error: 'The timeline is playing in Resolve. Stop playback (K), then select the preset again.' };
                if (!(await parkPlayhead(tl, endFrame, meta))) return { error: 'The playhead was moved while the ' + titleName + ' was being added, so nothing was inserted. Try again.' };
            }
            try { item = await tl.InsertFusionTitleIntoTimeline(titleName); }
            catch (e) {
                dlog('TITLE-INSERT-THREW', titleName, String(e && e.message || e));
                if (!title) throw e;
                if (attempt < attempts - 1) await new Promise(r => setTimeout(r, 1500));
                continue;
            }
            if (!item) break;
            let st = endFrame;
            try { st = await item.GetStart(); } catch (e) { /* ignore */ }
            if (st >= endFrame - 1) break;
            dlog('TITLE-INSERT-MISPLACED', titleName, { st, endFrame, attempt });
            try { await tl.DeleteClips([item], true); } catch (e) { /* ignore */ }       // ripple delete closes the gap it made
            item = null;
            if (++misplaced > 1) return { error: 'Resolve put the ' + titleName + ' at the playhead instead of the end, so it was taken out again. Check the timeline around the playhead and try again.' };
            attempt--;      // a misplaced insert does not use up a template retry
        }
    } finally { await restoreMarks(); }
    return { item };
}

// Cut guard: the boundaries of the real clips (V1 and every audio track, Text+ ignored) are noted before and after
// each step this plugin takes on the timeline. A difference is written to _debug/preview-log.txt and shown as a
// warning, so any cut the plugin could cause is caught the moment it happens.
async function cutSnapshot(tl) {
    const out = [];
    try {
        const na = (await tl.GetTrackCount('audio')) || 0;
        const tracks = [['video', 1]];
        for (let t = 1; t <= na; t++) tracks.push(['audio', t]);
        for (const [kind, t] of tracks) {
            for (const it of ((await tl.GetItemListInTrack(kind, t)) || [])) {
                try {
                    const nm = String(await it.GetName());
                    if (/^Text\+/.test(nm)) continue;
                    out.push(kind[0] + t + ':' + (await it.GetStart()) + '-' + (await it.GetEnd()));
                } catch (e) { /* ignore */ }
            }
        }
    } catch (e) { return null; }
    return out;
}
function cutCheck(label, before, after) {
    if (!before || !after) return null;
    const b = new Set(before), a = new Set(after);
    const gone = before.filter(x => !a.has(x)), added = after.filter(x => !b.has(x));
    // A sound effect this plugin places on purpose is the only expected addition.
    if (!gone.length && !added.length) return null;
    dlog('CUTGUARD', label, { removed: gone.slice(0, 20), added: added.slice(0, 20) });
    return gone.length ? 'Warning: clips on the timeline changed during this step (' + gone.length + ' boundaries moved). Details in _debug/preview-log.txt.' : null;
}

// Moves the freshly inserted title (it sits at the END of V1) to its own track, in two steps. Step 1 changes only the
// track and keeps the start at the end of the timeline, so no real clip can be cut or pushed even if Resolve refuses
// the move. Step 2 slides it along that track (an overwrite track that is free there). A title that did not leave V1
// is deleted, with a ripple delete if it had already pushed clips.
async function moveTitleSafe(tl, item, track, textStart, endFrame) {
    const fail = async (msg) => {
        let st = endFrame;
        try { st = await item.GetStart(); } catch (e) { /* ignore */ }
        try { await tl.DeleteClips([item], st < endFrame - 1); } catch (e) { /* the sweep removes it later */ }
        return { ok: false, error: msg };
    };
    if (!(track >= 2)) return await fail('Text+ is never placed on V1 (it would cut your clips).');
    let ok = false;
    try { ok = await item.SetPosition({ trackIndex: track, startFrame: endFrame }); } catch (e) { ok = false; }
    let landed = null;
    try { landed = await item.GetTrackTypeAndIndex(); } catch (e) { landed = null; }
    if (!ok || !landed || landed[1] !== track) return await fail('Could not move the title to track V' + track + '. It was taken out again and nothing else was changed.');
    if (textStart !== endFrame) {
        try { ok = await item.SetPosition({ trackIndex: track, startFrame: textStart }); } catch (e) { ok = false; }
        let st = null;
        try { st = await item.GetStart(); landed = await item.GetTrackTypeAndIndex(); } catch (e) { /* ignore */ }
        if (!ok || st !== textStart || !landed || landed[1] !== track) return { ok: false, error: 'The title is on V' + track + ' but could not be moved to the subtitle position.', leftOnTrack: true };
    }
    return { ok: true };
}

// ---- Direct placement of a Text+ from a template clip in the Media Pool
// AppendToTimeline takes a track and a record frame, so a template clip can go exactly where the caption is: no playhead
// move, no ripple. The template is a clip named "Subtitle Animator Template" in the Media Pool (a Fusion Composition or
// Text+ clip), or one Resolve handed out earlier in this session. The result is checked (track, start, length, no real
// clip moved); on any doubt it is taken out again and the app falls back to the park-at-the-end insert for good.

function presetTplState(title) {
    if (!state.presetTpl) state.presetTpl = new Map();
    if (!state.presetTpl.has(title)) state.presetTpl.set(title, { auto: null, broken: false, good: 0 });
    return state.presetTpl.get(title);
}
async function findTextTemplate(project, kind) {
    const nameRe = kind === 'multitext' ? /^subtitle animator template multitext$/i : /^subtitle animator template$/i;
    try {
        const mp = await project.GetMediaPool();
        const root = await mp.GetRootFolder();
        const folders = [root];
        for (const f of ((await root.GetSubFolderList()) || [])) folders.push(f);
        for (const f of folders) {
            for (const c of ((await f.GetClipList()) || [])) {
                try { if (nameRe.test(String(await c.GetName()))) return c; } catch (e) { /* ignore */ }
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}
// title: a preset's template name; only a Media Pool item Resolve handed out for that same template is used then.
async function directPlaceTitle(tl, project, track, start, want, kind, title) {
    const T = title ? presetTplState(title) : state.tplState[kind === 'multitext' ? 'multitext' : 'text'];
    if (T.broken || !(track >= 2)) return null;
    const tpl = title ? T.auto : ((await findTextTemplate(project, kind)) || T.auto);
    if (!tpl) return null;
    let item = null;
    const undo = async () => { if (item) { try { await tl.DeleteClips([item], false); } catch (e) { /* the sweep removes it later */ } } };
    try {
        const mp = await project.GetMediaPool();
        const full = T.good < 3;
        const before = full ? await cutSnapshot(tl) : null;
        const placed = await mp.AppendToTimeline([{ mediaPoolItem: tpl, mediaType: 1, trackIndex: track, recordFrame: start, startFrame: 0, endFrame: want }]);
        item = placed && placed[0];
        let ok = !!item, why = 'no clip returned';
        if (ok) {
            const ti = await item.GetTrackTypeAndIndex();
            if (!ti || ti[0] !== 'video' || ti[1] !== track) { ok = false; why = 'landed on ' + JSON.stringify(ti); }
            else if ((await item.GetStart()) !== start) { ok = false; why = 'start ' + (await item.GetStart()); }
            else if ((await item.GetDuration()) !== want) { ok = false; why = 'length ' + (await item.GetDuration()); }
            else if (typeof item.GetFusionCompCount === 'function' && !((await item.GetFusionCompCount()) >= 1)) { ok = false; why = 'no Fusion comp on it'; }
        }
        if (ok && full) {
            const after = await cutSnapshot(tl);
            if (before && after && (before.length !== after.length || before.some(x => !after.includes(x)))) { ok = false; why = 'real clips changed'; }
        }
        if (!ok) { dlog('TEMPLATE-FAIL', kind, why); await undo(); T.broken = true; return null; }
        T.good++;
        if (T.good <= 3) dlog('TEMPLATE-OK', { kind, track, start, want });
        return item;
    } catch (e) {
        dlog('TEMPLATE-ERROR', String(e && e.message || e));
        await undo();
        T.broken = true;
        return null;
    }
}

async function findAudioItemById(tl, id) {
    if (!id) return null;
    const tracks = (await tl.GetTrackCount('audio')) || 0;
    for (let t = 1; t <= tracks; t++) {
        for (const it of ((await tl.GetItemListInTrack('audio', t)) || [])) {
            try { if (String(await it.GetUniqueId()) === String(id)) return it; } catch (e) { /* ignore */ }
        }
    }
    return null;
}
// The sound of a Preview in Resolve: a real clip on the timeline that can be moved / trimmed by hand. It is NOT linked
// to the Text+ while the preview runs (clicking a linked clip selects both, and Resolve's Inspector then hides the
// Text+ settings); liveFinish links them when the preview is kept.
// ------------------------------------------------------------------ the main sound: the original file, cut by settings
// The main sound is placed from its ORIGINAL file, cut by the preset's settings instead of a rendered WAV:
// { trimIn, len, fade } in frames = source frames cut off the start, the length used, and the fade-out (set as
// Resolve's own fade handle). The whole original stays underneath, so the clip can be extended on the timeline later.
// Without a cut from the panel, it is worked out from the preset (an already-cut file from older versions is placed whole).
function sfxCutFor(req, anim, file, meta, textStart, textEnd) {
    if (req && req.sfxCut) return req.sfxCut;
    if (!anim || isEditedSfxName(path.basename(String(file || '')))) return null;
    const sfxStart = textStart + Math.round(Number(req && req.sfxOffset) || 0);
    const fixed = anim.sfxLenMode === 'fixed' || (anim.sfxLenMode !== 'estimate' && anim.sfxLen !== null && anim.sfxLen !== undefined);
    // The sound never runs past the subtitle it belongs to (textEnd is the subtitle's own end even when the text clip
    // is held longer for a stack): a fixed cut longer than the subtitle is shortened to it, a shorter one is kept.
    const span = Math.max(5, textEnd - sfxStart);
    const len = (fixed && anim.sfxLen !== null && anim.sfxLen !== undefined) ? Math.min(Number(anim.sfxLen), span) : span;
    const fade = (anim.sfxFade === null || anim.sfxFade === undefined) ? Math.round((meta && meta.fps) || 25) : Number(anim.sfxFade);
    return { trimIn: Number(anim.sfxTrimIn) || 0, len, fade };
}
// The cut, clamped to the imported clip's real length.
async function sfxCutFrames(mpi, meta, cut) {
    const total = Math.max(1, tcToFrame(await mpi.GetClipProperty('Duration'), meta));
    if (!cut) return { total, trimIn: 0, len: total, fade: 0 };
    const trimIn = Math.max(0, Math.min(total - 1, Math.round(Number(cut.trimIn) || 0)));
    let len = total - trimIn;
    const want = Math.round(Number(cut.len) || 0);
    if (want > 0) len = Math.min(len, want);
    len = Math.max(1, len);
    const fade = Math.max(0, Math.min(len, Math.round(Number(cut.fade) || 0)));
    return { total, trimIn, len, fade };
}
// Places the cut on the timeline and sets its fade-out. Returns the timeline item (or null); c.fadeFailed is set
// when Resolve did not take the fade.
async function appendSfxCut(mp, mpi, track, recordFrame, c) {
    const placed = await mp.AppendToTimeline([{ mediaPoolItem: mpi, mediaType: 2, trackIndex: track, recordFrame, startFrame: c.trimIn, endFrame: c.trimIn + c.len }]);
    if (!placed || !placed.length) return null;
    const it = placed[0];
    if (c.fade > 0) {
        let ok = false;
        try { if (typeof it.SetFades === 'function') ok = await it.SetFades({ FadeIn: 0, FadeOut: c.fade }); } catch (e) { ok = false; }
        if (!ok) { c.fadeFailed = true; dlog('SFX-FADE-FAILED', c); }
    }
    return it;
}

// ------------------------------------------------------------------ layered sounds (extra sound effects on one preset)
// A preset can carry any number of extra sounds besides its main one: { id, file, enabled, volume (dB), offset (frames),
// align: 'start' | 'end' | 'after', trimIn, len, link }. 'start': the sound starts at the text start + offset.
// 'end': the sound ENDS at the text end + offset. 'after': the sound starts when the text ends + offset.
function layerList(req, anim) {
    const raw = (req && Array.isArray(req.sfxLayers)) ? req.sfxLayers : (anim && Array.isArray(anim.sfxLayers) ? anim.sfxLayers : []);
    return raw.filter(l => l && l.enabled !== false && l.file);
}
// rowFrames: for layers aligned to 'rows' (one sound per row of a row-by-row preset such as Kinetic Cloud), the
// clip-relative frames where the rows start (bridge row_times); null / empty = those layers fall back to the text start.
// rowFrames may also be { rows, segs } (rowFramesFor): segs = { <n>: clip-relative start of segment n's in-animation }
// for layers aligned to one row of a MultiText preset (align 'seg', seg: n = Upper / Emphasis / Lower).
async function placeExtraSfx(tl, project, meta, layers, textStart, textEnd, notes, videoItem, videoId, warnings, place, projectCopy, rowFrames) {
    const out = [];
    if (!layers || !layers.length) return out;
    const tlStart = await tl.GetStartFrame();
    const rf = Array.isArray(rowFrames) ? { rows: rowFrames, segs: null } : (rowFrames || {});
    rowFrames = rf.rows || null;
    const segLinks = [];
    const segSpecs = layers.filter(l => l && l.align === 'seg');
    for (const l of layers) {
        try {
            if (l.align === 'seg') {
                const n = Math.max(1, Math.round(Number(l.seg) || 1));
                if (rf.empty && rf.empty[n]) continue;          // that row has no text: no sound for it
                const segStart = rf.segs && rf.segs[n] !== undefined ? rf.segs[n] : null;
                if ((segStart || 0) + (Math.round(Number(l.offset) || 0)) >= textEnd - textStart) {      // would start after the text ends
                    notes.push('sound "' + path.basename(l.file) + '": row ' + n + ' starts after the clip ends, not placed');
                    continue;
                }
                if (segStart === null) notes.push('sound "' + path.basename(l.file) + '": the preset has no row ' + n + ' timing, placed at the text start');
                const placed = await placeExtraSfx(tl, project, meta, [Object.assign({}, l, { align: 'start', offset: (segStart || 0) + (Math.round(Number(l.offset) || 0)) })],
                    textStart, textEnd, notes, videoItem, videoId, warnings, place, projectCopy, null);
                for (const x of placed) { x.seg = n; x.off = Math.round(Number(l.offset) || 0); segLinks.push({ id: x.id, seg: n, off: x.off }); }
                out.push(...placed);
                continue;
            }
            if (l.align === 'rows') {
                const rows = (Array.isArray(rowFrames) && rowFrames.length) ? rowFrames : [0];
                if (rows.length === 1 && !(Array.isArray(rowFrames) && rowFrames.length)) notes.push('sound "' + path.basename(l.file) + '": the preset has no rows, placed once');
                out.push(...await placeRowSfx(tl, project, meta, l, rows, textStart, textEnd, tlStart, notes, videoItem, warnings, place, projectCopy));
                continue;
            }
            const p = sfxFilePath(l.file);
            if (!fs.existsSync(p)) { warnings.push('Layered sound "' + path.basename(l.file) + '" is missing.'); continue; }
            const { mp, item: mpi } = await importSfx(project, p, projectCopy);
            if (!mpi) { warnings.push('Resolve could not import "' + path.basename(l.file) + '".'); continue; }
            const total = Math.max(1, tcToFrame(await mpi.GetClipProperty('Duration'), meta));
            const trimIn = Math.max(0, Math.min(total - 1, Math.round(Number(l.trimIn) || 0)));
            let len = total - trimIn;
            const cap = Math.round(Number(l.len) || 0);
            const off = Math.round(Number(l.offset) || 0);
            // 'clip' (default): follows the text clip's duration; 'fixed': the set length (0 = the rest of the sound)
            const mode = (l.lenMode === 'fixed' || l.lenMode === 'clip') ? l.lenMode : (cap > 0 ? 'fixed' : 'clip');
            if (mode === 'clip') len = Math.min(len, (l.align === 'end' || l.align === 'after') ? textEnd - textStart : textEnd - (textStart + off));
            else if (cap > 0) len = Math.min(len, cap);
            len = Math.max(1, len);
            let start = l.align === 'end' ? textEnd - len + off : (l.align === 'after' ? textEnd + off : textStart + off);
            start = Math.max(tlStart, start);
            const track = await pickTrack(tl, 'audio', Math.round(Number(l.track)) || 0, start, start + len, 1, notes, place);
            const placed = await mp.AppendToTimeline([{ mediaPoolItem: mpi, mediaType: 2, trackIndex: track, recordFrame: start, startFrame: trimIn, endFrame: trimIn + len }]);
            if (!placed || !placed.length) { warnings.push('Layered sound "' + path.basename(l.file) + '" could not be placed.'); continue; }
            const it = placed[0];
            const fps = Math.round((meta && meta.fps) || 25);
            const fade = Math.max(0, Math.min(len, (l.fade === null || l.fade === undefined) ? fps : Math.round(Number(l.fade) || 0)));
            if (fade > 0) { try { if (typeof it.SetFades === 'function') await it.SetFades({ FadeIn: 0, FadeOut: fade }); } catch (e) { /* the fade is a convenience */ } }
            const vol = Number(l.volume) || 0;
            try { await it.SetProperties({ AudioVolumeEnabled: true, AudioVolume: vol }); } catch (e) { /* volume is a convenience */ }
            const id = String(await it.GetUniqueId());
            if (!projectCopy) regAdd(id);      // a preview's sound is temporary; a placed one is not (the sweep would delete it)
            if (l.link && videoItem) {
                try { if (typeof tl.SetClipsLinked === 'function') await tl.SetClipsLinked([videoItem, it], true); } catch (e) { /* linking is optional */ }
            }
            out.push({ id, track, start, frames: len, link: !!l.link });
        } catch (e) { warnings.push('Layered sound "' + path.basename(String(l && l.file || '?')) + '": ' + e.message); }
    }
    if (segSpecs.length && videoId && rf.segs) segSfxAdd(String(videoId), segLinks, segSpecs, rf.empty || {});
    return out;
}

// ------------------------------------------------------------------ row sounds follow the row's timing
// Sounds aligned to one MultiText row (Upper / Emphasis / Lower) are remembered per text clip, so the Animation timing
// bar can move them when that row's start is dragged, and so they come and go with the row's text on a placed clip:
// _app/seg-sounds.json = { <text item id>: { sounds: [{ id, seg, off }], layers: [the row sound settings], empty: { <n>: true } } }
// (off = frames after the row's start; empty = the rows that had no text when last looked at). Older entries were a
// plain list of sounds. Entries whose clips are gone are dropped when they are next looked up.
const SEG_SFX_FILE = path.join(APP_DATA_DIR, 'seg-sounds.json');
function segSfxRead() { try { const o = JSON.parse(fs.readFileSync(SEG_SFX_FILE, 'utf8')); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
function segSfxWrite(o) {
    try {
        const keys = Object.keys(o);
        if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete o[k];
        fs.mkdirSync(APP_DATA_DIR, { recursive: true });
        fs.writeFileSync(SEG_SFX_FILE, JSON.stringify(o));
    } catch (e) { dlog('SEG-SFX-WRITE', e.message); }
}
const segRec = (v) => Array.isArray(v) ? { sounds: v, layers: [], empty: {} }
    : Object.assign({ sounds: [], layers: [], empty: {} }, v || {});
function segSfxAdd(videoId, links, specs, empty) {
    const o = segSfxRead();
    const r = segRec(o[videoId]);
    r.sounds = r.sounds.filter(x => !links.some(y => y.id === x.id)).concat(links);
    for (const l of (specs || [])) {
        const i = r.layers.findIndex(x => x.id === l.id);
        const copy = JSON.parse(JSON.stringify(l));
        if (i >= 0) r.layers[i] = copy; else r.layers.push(copy);
    }
    if (empty) r.empty = empty;
    o[videoId] = r;
    segSfxWrite(o);
}
// -> { sounds, layers, empty } (empty lists when nothing is recorded)
function segSfxRecord(videoId) { return segRec(segSfxRead()[String(videoId)]); }
function segSfxFor(videoId) { return segSfxRecord(videoId).sounds; }
function segSfxSetEmpty(videoId, empty) {
    const o = segSfxRead(), k = String(videoId);
    if (!o[k]) return;
    o[k] = Object.assign(segRec(o[k]), { empty });
    segSfxWrite(o);
}
function segSfxForget(videoId, ids) {
    const o = segSfxRead(), k = String(videoId);
    if (!o[k]) return;
    const r = segRec(o[k]);
    r.sounds = ids ? r.sounds.filter(x => !ids.includes(x.id)) : [];
    if (!r.sounds.length && !r.layers.length) delete o[k]; else o[k] = r;
    segSfxWrite(o);
}
// The clip-relative row start frames for the 'rows' layers (null when no layer repeats per row or the comp has no
// rows). Call it AFTER the text is written to the comp: the rows are counted from the Pop<k> texts.
// With layers aligned to a MultiText row ('seg'), it returns { rows, segs, empty } instead (empty = { <n>: true } for
// rows whose text is empty: their sounds are not placed): segs = { <n>: Seg<n>Start }, read
// from the placed clip (after any fit to a short clip), so the sound lands where that row's in-animation starts.
async function rowFramesFor(itemId, compName, layers, warnings) {
    const wantRows = !!(layers && layers.some(l => l.align === 'rows'));
    const wantSegs = !!(layers && layers.some(l => l.align === 'seg'));
    if (!wantRows && !wantSegs) return null;
    const { bridgeCall } = require('./fusion-bridge');              // required here: fusion-bridge loads before this module
    let rows = null, segs = null, empty = null;
    if (wantRows) {
        try {
            const r = await bridgeCall('row_times', { item: itemId, comp: compName });
            rows = (r && Array.isArray(r.frames) && r.frames.length) ? r.frames : null;
        } catch (e) { if (warnings) warnings.push('Could not read the row timing for the repeated sound: ' + e.message); }
    }
    if (!wantSegs) return rows;
    try {
        const r = await bridgeCall('timing_get', { item: itemId, comp: compName }, 6000);
        if (r && r.kind === 'segments' && Array.isArray(r.ranges)) {
            segs = {}; empty = {};
            for (const x of r.ranges) {
                segs[Number(x.key)] = Math.max(0, Math.round(Number(x.start) || 0));
                if (x.empty) empty[Number(x.key)] = true;      // rows left without text get no sound
            }
        }
    } catch (e) { if (warnings) warnings.push('Could not read the Upper / Emphasis / Lower timing for their sounds: ' + e.message); }
    return { rows, segs, empty };
}
// One copy of the sound per row: each starts at its row's frame (+ the layer's offset); a 'clip' length runs until the
// next row starts (and never past the text end), a fixed length is kept. All copies share one audio track.
async function placeRowSfx(tl, project, meta, l, rows, textStart, textEnd, tlStart, notes, videoItem, warnings, place, projectCopy) {
    const out = [];
    const p = sfxFilePath(l.file);
    if (!fs.existsSync(p)) { warnings.push('Layered sound "' + path.basename(l.file) + '" is missing.'); return out; }
    const { mp, item: mpi } = await importSfx(project, p, projectCopy);
    if (!mpi) { warnings.push('Resolve could not import "' + path.basename(l.file) + '".'); return out; }
    const total = Math.max(1, tcToFrame(await mpi.GetClipProperty('Duration'), meta));
    const trimIn = Math.max(0, Math.min(total - 1, Math.round(Number(l.trimIn) || 0)));
    const cap = Math.round(Number(l.len) || 0);
    const off = Math.round(Number(l.offset) || 0);
    const mode = (l.lenMode === 'fixed' || l.lenMode === 'clip') ? l.lenMode : (cap > 0 ? 'fixed' : 'clip');
    const fps = Math.round((meta && meta.fps) || 25);
    const cuts = [];
    for (let i = 0; i < rows.length; i++) {
        const start = Math.max(tlStart, textStart + Math.round(Number(rows[i]) || 0) + off);
        let len = total - trimIn;
        if (mode === 'clip') {
            const next = i + 1 < rows.length ? textStart + Math.round(Number(rows[i + 1]) || 0) + off : textEnd;
            len = Math.min(len, Math.max(1, Math.min(next, textEnd) - start));
        } else if (cap > 0) len = Math.min(len, cap);
        len = Math.max(1, len);
        if (start >= textEnd) continue;
        cuts.push({ start, len });
    }
    if (!cuts.length) return out;
    const first = cuts[0].start, last = cuts[cuts.length - 1];
    const track = await pickTrack(tl, 'audio', Math.round(Number(l.track)) || 0, first, last.start + last.len, 1, notes, place);
    const items = [];
    for (const c of cuts) {
        const placed = await mp.AppendToTimeline([{ mediaPoolItem: mpi, mediaType: 2, trackIndex: track, recordFrame: c.start, startFrame: trimIn, endFrame: trimIn + c.len }]);
        if (!placed || !placed.length) { warnings.push('Layered sound "' + path.basename(l.file) + '" could not be placed at frame ' + (c.start - textStart) + '.'); continue; }
        const it = placed[0];
        const fade = Math.max(0, Math.min(c.len, (l.fade === null || l.fade === undefined) ? Math.min(c.len, Math.round(fps / 5)) : Math.round(Number(l.fade) || 0)));
        if (fade > 0) { try { if (typeof it.SetFades === 'function') await it.SetFades({ FadeIn: 0, FadeOut: fade }); } catch (e) { /* the fade is a convenience */ } }
        const vol = Number(l.volume) || 0;
        try { await it.SetProperties({ AudioVolumeEnabled: true, AudioVolume: vol }); } catch (e) { /* volume is a convenience */ }
        const id = String(await it.GetUniqueId());
        if (!projectCopy) regAdd(id);      // a preview's sound is temporary; a placed one is not
        items.push(it);
        out.push({ id, track, start: c.start, frames: c.len, link: !!l.link });
    }
    if (l.link && videoItem && items.length) {
        try { if (typeof tl.SetClipsLinked === 'function') await tl.SetClipsLinked([videoItem, ...items], true); } catch (e) { /* linking is optional */ }
    }
    notes.push('sound "' + path.basename(l.file) + '" repeated for ' + items.length + ' row' + (items.length === 1 ? '' : 's'));
    return out;
}
// Deletes the given sound clips and forgets only the ones that are really gone. One that Resolve refused to delete
// stays in the registry, so the next sweep removes it (before, all ids were forgotten and a refused one stayed for good).
async function deleteClipsById(tl, ids, find) {
    ids = (ids || []).filter(Boolean).map(String);
    if (!ids.length) return [];
    let left = ids;
    for (let attempt = 0; attempt < 2 && left.length; attempt++) {
        const items = [];
        for (const id of left) { try { const it = await find(tl, id); if (it) items.push(it); } catch (e) { /* ignore */ } }
        if (items.length) {
            try { await tl.DeleteClips(items, false); } catch (e) { /* checked below */ }
            if (attempt === 0) await new Promise(r => setTimeout(r, 60));
        }
        const still = [];
        for (const id of left) { try { if (await find(tl, id)) still.push(id); } catch (e) { /* ignore */ } }
        left = still;
    }
    for (const id of ids) if (!left.includes(id)) regDel(id);
    if (left.length) dlog('DELETE-LEFT', left);
    return left;
}
async function deleteExtraSfx(tl, ids) { return deleteClipsById(tl, ids, findAudioItemById); }

async function findItemById(tl, id) {
    const tracks = (await tl.GetTrackCount('video')) || 0;
    for (let t = 1; t <= tracks; t++) {
        for (const it of ((await tl.GetItemListInTrack('video', t)) || [])) {
            try { if (String(await it.GetUniqueId()) === String(id)) return it; } catch (e) { /* ignore */ }
        }
    }
    return null;
}
