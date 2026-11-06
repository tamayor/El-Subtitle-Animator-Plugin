// Building blocks for putting clips on the timeline: picking free tracks, inserting / moving / trimming
// Text+ titles safely, importing sounds and placing layered sound effects.

module.exports = {
    cutCheck, cutSnapshot, deleteExtraSfx, directPlaceTitle, findAudioItemById, findItemById, fitDuration,
    importSfx, insertTitleAtEnd, inspectorSafeComp, isTitleClipName, layerList, moveTitleSafe, pickTrack,
    placeExtraSfx, titleKindFor, trackUsable
};

const path = require('path');
const fs = require('fs');
const os = require('os');

const state = require('./state');
const { SFX_DIR } = require('./config');
const { detectNodes, expandAllTools } = require('./fusion-setting');
const { regAdd, regDel } = require('./live-preview');
const { dlog } = require('./log');
const { frameToTC, tcToFrame } = require('./resolve');

// ------------------------------------------------------------------ building the clip
// Placement options (all off by default), set from the pop-up beside "Add to timeline":
//   locked        a locked track counts as occupying its layer (Text+ then goes above it)
//   disabledTrack a disabled track counts as occupying its layer
//   disabledClip  a disabled clip counts as occupying its track
//   firstEmpty    use the lowest empty layer instead of the top one
// Text+ is never put onto a locked or disabled track itself (it cannot be placed / would be invisible).
function placeOpts(o) { o = o || {}; return { locked: !!o.locked, disabledTrack: !!o.disabledTrack, disabledClip: !!o.disabledClip, firstEmpty: !!o.firstEmpty }; }

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
// placement options), never a gap lower down; or the lowest empty layer with "first empty layer". A new track is
// added when there is none. Auto (audio) = the lowest free audio track.
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
        if (po.firstEmpty) {
            for (let t = Math.max(1, firstAuto); t <= n; t++) {
                if (!(await trackUsable(tl, kind, t))) continue;
                if (!(await trackHasClip(tl, kind, t, s, e, po))) return t;
            }
            await tl.AddTrack('video');
            notes.push('no empty layer, added ' + label + (n + 1));
            return n + 1;
        }
        let top = 0;
        for (let t = n; t >= 1; t--) {
            if (await trackHasClip(tl, kind, t, s, e, po)) { top = t; break; }
        }
        let target = Math.max(firstAuto, top + 1);
        while (target <= n && !(await trackUsable(tl, kind, target))) target++;
        if (target <= n) return target;
        await tl.AddTrack('video');
        notes.push('placed on top, added ' + label + (n + 1));
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

async function importSfx(project, sfxPath) {
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
    if (target) {
        for (const c of ((await target.GetClipList()) || [])) {
            if ((await c.GetName()) === want) return { mp, item: c };
        }
        try { await mp.SetCurrentFolder(target); } catch (e) { /* ignore */ }
    }
    let items = await mp.ImportMedia([sfxPath]);
    if ((!items || !items.length) && target) {
        for (const c of ((await target.GetClipList()) || [])) {
            if ((await c.GetName()) === want) { items = [c]; break; }
        }
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
// Stop Motion is swapped for a native TimeSpeed that holds every Nth frame (same look, the Inspector keeps working).
// Every tool is also saved as expanded and shown in the Inspector (see expandAllTools), so the settings show straight
// away when the clip is selected.
// The preset file on disk is never changed; the adjusted copy is written to a temp folder and imported instead.

function ofxNames(txt) { const r = [], re = /ofx\.com\.blackmagicdesign\.resolvefx\.(\w+)\s*\{/g; let m; while ((m = re.exec(txt))) r.push(m[1]); return r; }
function inspectorSafeComp(compPath) {
    try {
        const orig = fs.readFileSync(compPath, 'utf8');
        state.ofxLeft.set(compPath, ofxNames(orig).filter(n => n !== 'StopMotion'));
        const s = expandAllTools(orig);
        if (!/ofx\.com\.blackmagicdesign\.resolvefx\.StopMotion\s*\{/.test(s)) return s === orig ? compPath : writeSafeComp(compPath, s);
        const re = /([A-Za-z_][\w]*)\s*=\s*ofx\.com\.blackmagicdesign\.resolvefx\.StopMotion\s*\{/g;
        let m, out = '', last = 0, changed = false;
        while ((m = re.exec(s))) {
            const open = m.index + m[0].length - 1;
            let d = 0, k = open, inStr = false;
            for (; k < s.length; k++) {
                const c = s[k];
                if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue; }
                if (c === '"') inStr = true; else if (c === '{') d++; else if (c === '}') { d--; if (d === 0) break; }
            }
            const block = s.slice(m.index, k + 1);
            const src = /Source\s*=\s*Input\s*\{\s*SourceOp\s*=\s*"([^"]+)"\s*,\s*Source\s*=\s*"([^"]+)"/.exec(block);
            const rep = /frameRepeat\s*=\s*Input\s*\{\s*Value\s*=\s*([\d.]+)/.exec(block);
            const n = Math.max(1, Math.round(rep ? parseFloat(rep[1]) : 2));
            if (!src) continue;
            const view = /ViewInfo\s*=\s*OperatorInfo\s*\{\s*Pos\s*=\s*\{[^}]*\}\s*\}/.exec(block);
            const tool = m[1] + ' = TimeSpeed {\n\t\t\tInputs = {\n\t\t\t\tDelay = Input { Expression = "math.fmod(time, ' + n + ')", },\n' +
                '\t\t\t\tInput = Input { SourceOp = "' + src[1] + '", Source = "' + src[2] + '", },\n\t\t\t},\n' +
                (view ? '\t\t\t' + view[0] + ',\n' : '') + '\t\t}';
            out += s.slice(last, m.index) + tool; last = k + 1; changed = true;
            re.lastIndex = k + 1;
        }
        if (!changed) return s === orig ? compPath : writeSafeComp(compPath, s);
        out += s.slice(last);
        return writeSafeComp(compPath, out);
    } catch (e) { return compPath; }
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
function isTitleClipName(n) { return /^(Text\+|MultiText)/.test(String(n || '')); }
async function insertTitleAtEnd(tl, meta, endFrame, kind) {
    const titleName = kind === 'multitext' ? 'MultiText' : 'Text+';
    if (!(await parkPlayhead(tl, endFrame, meta))) return { error: 'The playhead was moved while the ' + titleName + ' was being added, so nothing was inserted. Try again.' };
    const item = await tl.InsertFusionTitleIntoTimeline(titleName);
    if (item) {
        let st = endFrame;
        try { st = await item.GetStart(); } catch (e) { /* ignore */ }
        if (st < endFrame - 1) {
            try { await tl.DeleteClips([item], true); } catch (e) { /* ignore */ }       // ripple delete closes the gap it made
            return { error: 'Resolve put the ' + titleName + ' at the playhead instead of the end, so it was taken out again. Check the timeline around the playhead and try again.' };
        }
    }
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
async function directPlaceTitle(tl, project, track, start, want, kind) {
    const T = state.tplState[kind === 'multitext' ? 'multitext' : 'text'];
    if (T.broken || !(track >= 2)) return null;
    const tpl = (await findTextTemplate(project, kind)) || T.auto;
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
// ------------------------------------------------------------------ layered sounds (extra sound effects on one preset)
// A preset can carry any number of extra sounds besides its main one: { id, file, enabled, volume (dB), offset (frames),
// align: 'start' | 'end' | 'after', trimIn, len, link }. 'start': the sound starts at the text start + offset.
// 'end': the sound ENDS at the text end + offset. 'after': the sound starts when the text ends + offset.
function layerList(req, anim) {
    const raw = (req && Array.isArray(req.sfxLayers)) ? req.sfxLayers : (anim && Array.isArray(anim.sfxLayers) ? anim.sfxLayers : []);
    return raw.filter(l => l && l.enabled !== false && l.file);
}
async function placeExtraSfx(tl, project, meta, layers, textStart, textEnd, notes, videoItem, videoId, warnings) {
    const out = [];
    if (!layers || !layers.length) return out;
    const tlStart = await tl.GetStartFrame();
    for (const l of layers) {
        try {
            const p = path.isAbsolute(l.file) ? l.file : path.join(SFX_DIR, l.file);
            if (!fs.existsSync(p)) { warnings.push('Layered sound "' + path.basename(l.file) + '" is missing.'); continue; }
            const { mp, item: mpi } = await importSfx(project, p);
            if (!mpi) { warnings.push('Resolve could not import "' + path.basename(l.file) + '".'); continue; }
            const total = Math.max(1, tcToFrame(await mpi.GetClipProperty('Duration'), meta));
            const trimIn = Math.max(0, Math.min(total - 1, Math.round(Number(l.trimIn) || 0)));
            let len = total - trimIn;
            const cap = Math.round(Number(l.len) || 0);
            if (cap > 0) len = Math.min(len, cap);
            len = Math.max(1, len);
            const off = Math.round(Number(l.offset) || 0);
            let start = l.align === 'end' ? textEnd - len + off : (l.align === 'after' ? textEnd + off : textStart + off);
            start = Math.max(tlStart, start);
            const track = await pickTrack(tl, 'audio', Math.round(Number(l.track)) || 0, start, start + len, 1, notes);
            const placed = await mp.AppendToTimeline([{ mediaPoolItem: mpi, mediaType: 2, trackIndex: track, recordFrame: start, startFrame: trimIn, endFrame: trimIn + len }]);
            if (!placed || !placed.length) { warnings.push('Layered sound "' + path.basename(l.file) + '" could not be placed.'); continue; }
            const it = placed[0];
            const vol = Number(l.volume) || 0;
            try { await it.SetProperties({ AudioVolumeEnabled: true, AudioVolume: vol }); } catch (e) { /* volume is a convenience */ }
            const id = String(await it.GetUniqueId());
            regAdd(id);
            if (l.link && videoItem) {
                try { if (typeof tl.SetClipsLinked === 'function') await tl.SetClipsLinked([videoItem, it], true); } catch (e) { /* linking is optional */ }
            }
            out.push({ id, track, start, frames: len, link: !!l.link });
        } catch (e) { warnings.push('Layered sound "' + path.basename(String(l && l.file || '?')) + '": ' + e.message); }
    }
    return out;
}
async function deleteExtraSfx(tl, ids) {
    const gone = [];
    for (const id of (ids || [])) { try { const it = await findAudioItemById(tl, id); if (it) gone.push(it); } catch (e) { /* ignore */ } }
    if (gone.length) { try { await tl.DeleteClips(gone, false); } catch (e) { /* the sweep removes it later */ } }
    for (const id of (ids || [])) regDel(id);
}

async function findItemById(tl, id) {
    const tracks = (await tl.GetTrackCount('video')) || 0;
    for (let t = 1; t <= tracks; t++) {
        for (const it of ((await tl.GetItemListInTrack('video', t)) || [])) {
            try { if (String(await it.GetUniqueId()) === String(id)) return it; } catch (e) { /* ignore */ }
        }
    }
    return null;
}
