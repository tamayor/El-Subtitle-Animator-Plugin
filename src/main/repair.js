// Repairs clips whose Edit-page Inspector is empty.
//
// A clip named just "Text+" or "MultiText" that holds a preset got it through the fallback in apply.js: the preset's
// title template could not be inserted (e.g. Resolve had not scanned a template written a moment before), so a plain
// title was inserted and the preset imported onto it. Such a clip animates, but Resolve shows nothing for it in the
// Inspector (see "Presets are inserted as Resolve title templates" in README.md). The same happens to a preview-render
// clip that was left behind.
//
// repairInspector finds those clips on the current timeline, tells which preset each one holds (its tool names match
// the preset's template), inserts that preset as a real title-template clip of the same length, copies every plain
// input value across (texts, positions, sizes, timing sliders, colours; animated and expression-driven inputs are the
// same in both), puts it where the old clip was and removes the old clip. The clip's transform (position / zoom /
// rotation set on the clip itself) is copied too. A link to a sound clip is not kept.

module.exports = { fallbackClips, repairInspector };

const fs = require('fs');
const path = require('path');

const state = require('./state');
const { ANIM_DIR } = require('./config');
const { bridgeCall } = require('./fusion-bridge');
const { blockEnd } = require('./fusion-setting');
const { loadLib } = require('./library');
const { dlog } = require('./log');
const { settleLater } = require('./settle');
const {
    fitDuration, insertTitleAtEnd, isTitleClipName, moveTitleSafe, pickTrack, presetOutputFor, presetTitleFor, presetTitleNames, titleKindFor, titlesDir
} = require('./placement');
const { getProject, timelineMeta } = require('./resolve');

// Tools that say nothing about which preset a clip holds: the output, and the white background a preview render adds.
const EXTRA = /^(MediaOut|Saver|Background|Merge)\d*$/;
// Clip transform properties carried over to the rebuilt clip.
const PROPS = ['TransformEnabled', 'Pan', 'Tilt', 'ZoomGang', 'ZoomX', 'ZoomY', 'RotationAngle', 'AnchorPointX', 'AnchorPointY', 'Pitch', 'Yaw', 'FlipX', 'FlipY', 'Opacity', 'CompositeMode'];
const PLAIN = /^(Text\+|MultiText)$/;

// The top-level tool names of an installed title template (EXTRA ones left out), or null when it cannot be read.
function templateTools(title) {
    try {
        const s = fs.readFileSync(path.join(titlesDir(), title + '.setting'), 'utf8');
        const m = /\bTools\s*=\s*(?:ordered\(\)\s*)?\{/.exec(s);
        if (!m) return null;
        const open = m.index + m[0].length - 1, close = blockEnd(s, open);
        const names = new Set();
        const toolRe = /([A-Za-z_]\w*)\s*=\s*[A-Za-z_][\w.]*\s*\{/y;
        for (let k = open + 1; k < close; k++) {
            if (!/[A-Za-z_]/.test(s[k]) || /\w/.test(s[k - 1])) continue;
            toolRe.lastIndex = k;
            const t = toolRe.exec(s);
            if (!t) continue;
            if (!EXTRA.test(t[1])) names.add(t[1]);
            k = blockEnd(s, k + t[0].length - 1);
        }
        return names;
    } catch (e) { return null; }
}

// Every preset with its template installed and its tool-name signature. A signature of one tool is not used: a plain
// Resolve title must never be mistaken for a preset.
function presetSignatures(lib) {
    const names = presetTitleNames(lib.animations);
    const out = [];
    for (const a of lib.animations || []) {
        const compPath = a.file ? path.join(ANIM_DIR, a.file) : null;
        if (!compPath || !fs.existsSync(compPath)) continue;
        const title = presetTitleFor(compPath, names.get(a.id));
        const tools = title ? templateTools(title) : null;
        if (tools && tools.size >= 2) out.push({ anim: a, title, compPath, tools });
    }
    return out;
}

function sameSet(a, b) {
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
}

// The clips on the timeline that hold a preset without being a title-template clip. only: a Set of item ids to look
// at (any clip name) instead of every plain "Text+" / "MultiText".
// Title clips with NO tools at all are listed as empty: Resolve loads a title's comp from its template file the first
// time the clip is opened, and when the file was renamed or removed before that (a title dragged in from the Effects
// Library, never shown, then its preset renamed or deleted in the panel) nothing is left to rebuild from.
async function fallbackClips(tl, sigs, only) {
    const found = [], skipped = [], empty = [];
    const tracks = (await tl.GetTrackCount('video')) || 0;
    for (let t = 1; t <= tracks; t++) {
        for (const it of ((await tl.GetItemListInTrack('video', t)) || [])) {
            let id = null, name = '';
            try { id = String(await it.GetUniqueId()); name = String(await it.GetName()).trim(); } catch (e) { continue; }
            if (only ? !only.has(id) : !isTitleClipName(name)) continue;
            let tools = null;
            try { tools = await bridgeCall('tools', { item: id, comp: null }); } catch (e) { tools = null; }
            const all = (tools && tools.tools) || [];
            const start = await it.GetStart(), frames = await it.GetDuration();
            if (tools && !all.length) { empty.push({ itemId: id, name, track: 'V' + t, start, frames }); continue; }
            if (!only && !PLAIN.test(name)) continue;      // a title-template clip: its Inspector works
            const names = new Set(all.map(x => x[0]).filter(n => n && !EXTRA.test(n)));
            const match = sigs.find(s => sameSet(s.tools, names));
            if (match) found.push({ item: it, id, name, track: t, start, frames, match });
            else if (only || names.size > 2) skipped.push({ itemId: id, name, track: 'V' + t, start, reason: names.size ? 'its tools (' + [...names].join(', ') + ') match no preset in the library' : 'a plain title, no preset on it' });
        }
    }
    return { found, skipped, empty };
}
const EMPTY_NOTE = 'These clips have no composition at all (Resolve could not load their title template; see repair.js). Nothing can be rebuilt from them: delete each one and place the subtitle again.';

async function rebuildOne(tl, meta, f) {
    const { item, id: oldId, match } = f;
    const warnings = [];
    let props = null;
    try { props = await item.GetProperties(); } catch (e) { /* no transform copied */ }
    const tlEnd = await tl.GetEndFrame();
    const ins = await insertTitleAtEnd(tl, meta, tlEnd, titleKindFor(match.compPath), match.title);
    if (ins.error) throw new Error(ins.error);
    if (!ins.item) throw new Error('Resolve would not insert the title template "' + match.title + '"');
    const fresh = ins.item;
    const newId = String(await fresh.GetUniqueId());
    const undo = async () => { try { await tl.DeleteClips([fresh], true); } catch (e) { /* ignore */ } };
    try {
        if (!(await fitDuration(fresh, f.frames))) warnings.push('The rebuilt clip could not be trimmed to ' + f.frames + ' frames.');
        // Resolve wires an inserted title's output to "Template"; presets with effects after the text need their own output.
        const out = presetOutputFor(match.title);
        if (out && out.source !== 'Template') {
            let r = null;
            try { r = await bridgeCall('set_output', { item: newId, comp: null, source: out.source, output: out.output }); } catch (e) { r = { ok: false, why: e.message }; }
            if (!r || !r.ok) warnings.push('The preset\'s effects could not be connected (' + ((r && r.why) || 'unknown') + ').');
        }
        const c = await bridgeCall('copy_inputs', { from: oldId, to: newId }, 120000);
        if (c && Array.isArray(c.failed) && c.failed.length) warnings.push('Not copied: ' + c.failed.slice(0, 10).join(', ') + (c.failed.length > 10 ? ', ...' : '') + '.');
    } catch (e) {
        await undo();
        throw e;
    }
    // The old clip goes first, then the new one takes its place (a stray on V1 moves to the lowest free layer).
    try { if (!(await tl.DeleteClips([item], false))) throw new Error('refused'); } catch (e) {
        await undo();
        throw new Error('The old clip could not be removed (' + (e && e.message || e) + '), so nothing was changed.');
    }
    let dest = f.track;
    if (!(dest >= 2)) dest = await pickTrack(tl, 'video', 0, f.start, f.start + f.frames, 2, []);
    const mv = await moveTitleSafe(tl, fresh, dest, f.start, tlEnd);
    if (!mv.ok) throw new Error(mv.error + (mv.leftOnTrack ? ' The rebuilt clip is at the end of the timeline on V' + dest + '; the old clip was removed.' : ' The old clip was removed.'));
    if (props) {
        const keep = {};
        for (const k of PROPS) if (props[k] !== undefined && props[k] !== null) keep[k] = props[k];
        try { await fresh.SetProperties(keep); } catch (e) { warnings.push('The clip transform was not copied: ' + e.message); }
    }
    let compName = null;
    try { const names = (await fresh.GetFusionCompNameList()) || []; compName = names[names.length - 1] || null; } catch (e) { /* ignore */ }
    try { await bridgeCall('refresh', { item: newId, comp: compName }); } catch (e) { /* the clip is placed */ }
    settleLater(newId, compName);
    dlog('INSPECTOR-REPAIRED', f.name, '->', match.title, 'V' + dest, f.start);
    return { oldItemId: oldId, itemId: newId, name: match.title, preset: match.anim.name, track: 'V' + dest, start: f.start, frames: f.frames, warnings };
}

// args: { dryRun, itemIds }
async function repairInspector(args) {
    args = args || {};
    const project = await getProject();
    if (!project) throw new Error('Open a project in Resolve');
    const tl = await project.GetCurrentTimeline();
    if (!tl) throw new Error('Open a timeline in Resolve');
    const meta = await timelineMeta(tl, project);
    const sigs = presetSignatures(loadLib());
    const only = Array.isArray(args.itemIds) && args.itemIds.length ? new Set(args.itemIds.map(String)) : null;
    const { found, skipped, empty } = await fallbackClips(tl, sigs, only);
    const describe = (f) => ({ itemId: f.id, name: f.name, preset: f.match.anim.name, template: f.match.title, track: 'V' + f.track, start: f.start, frames: f.frames });
    const emptyOut = empty.length ? { empty, emptyNote: EMPTY_NOTE } : {};
    if (args.dryRun) return Object.assign({ found: found.map(describe), skipped, note: found.length ? 'Call again without dryRun to rebuild these clips.' : 'No clip on this timeline needs rebuilding.' }, emptyOut);
    if (!found.length) return Object.assign({ rebuilt: [], failed: [], skipped, note: 'No clip on this timeline needs rebuilding.' }, emptyOut);
    const origTC = await tl.GetCurrentTimecode();
    const rebuilt = [], failed = [];
    state.applying = true;
    try {
        for (const f of found) {
            try { rebuilt.push(await rebuildOne(tl, meta, f)); }
            catch (e) { failed.push(Object.assign(describe(f), { error: String(e && e.message || e) })); dlog('INSPECTOR-REPAIR-FAIL', f.name, String(e && e.message || e)); }
        }
    } finally {
        state.applying = false;
        try { await tl.SetCurrentTimecode(origTC); } catch (e) { /* ignore */ }
    }
    return Object.assign({
        rebuilt, failed, skipped,
        note: (rebuilt.length ? 'Rebuilt ' + rebuilt.length + ' clip(s) as title-template clips: the Inspector now shows their controls. A link to a sound clip is not kept; relink by hand if needed. ' : '') +
            (failed.length ? failed.length + ' clip(s) could not be rebuilt (see failed).' : '')
    }, emptyOut);
}
