// "Create using this": the two boilerplate presets of the Create tab (src/boilerplates/, built by tools/gen-boilerplates.py).
// A boilerplate is a ready preset without a real animation (Text+: one follower with a plain fade-in; MultiText:
// Upper / Emphasis / Lower rows, timing ranges and the highlight box). It goes on the timeline as a real title-template
// clip (so the Inspector shows its controls), the user animates it in Resolve, and "From timeline" in the Create tab
// saves the result to the library like any other clip.

module.exports = { boilerplateList, insertBoilerplate };

const path = require('path');
const fs = require('fs');

const state = require('./state');
const { bridgeCall } = require('./fusion-bridge');
const { dlog } = require('./log');
const { fitDuration, insertTitleAtEnd, moveTitleSafe, pickTrack } = require('./placement');
const { getProject, tcToFrame, timelineMeta } = require('./resolve');
const { settleLater } = require('./settle');
const { presetOutputFor, presetTitleFor } = require('./title-templates');

const DIR = path.join(__dirname, '..', 'boilerplates');
const BOILERPLATES = {
    text: { kind: 'text', title: 'Text+ Boilerplate', file: 'Text+ Boilerplate.comp' },
    multitext: { kind: 'multitext', title: 'MultiText Boilerplate', file: 'MultiText Boilerplate.comp' }
};

// [{ id, kind, title, path }] for the panel (path = the file, to add it to the library as it is).
function boilerplateList() {
    return Object.entries(BOILERPLATES).map(([id, b]) => ({ id, kind: b.kind, title: b.title, path: path.join(DIR, b.file) }));
}

// Puts a boilerplate on the timeline at the playhead (3 seconds, the first free layer above V1): inserted at the end of the
// timeline as a title template, then moved into place, the same safe way a placed caption goes in (placement.js).
async function insertBoilerplate(event, id) {
    const b = BOILERPLATES[String(id)];
    if (!b) return { error: 'Unknown boilerplate' };
    if (state.applying) return { error: 'Busy placing - try again in a moment.' };
    if (state.liveSession && state.liveSession.itemId) return { error: 'A Preview in Resolve is running. Click Apply or Remove on it first.' };
    const file = path.join(DIR, b.file);
    if (!fs.existsSync(file)) return { error: 'The boilerplate file is missing: ' + b.file };
    const title = presetTitleFor(file, b.title);
    if (!title) return { error: 'Could not write the title template for ' + b.title };
    const project = await getProject();
    if (!project) return { error: 'Open a project in Resolve' };
    const tl = await project.GetCurrentTimeline();
    if (!tl) return { error: 'Open a timeline in Resolve' };
    const meta = await timelineMeta(tl, project);
    const origTC = await tl.GetCurrentTimecode();
    const start = tcToFrame(origTC, meta);
    const want = Math.max(10, Math.round((meta && meta.fps) || 25) * 3);
    const notes = [];
    state.applying = true;
    try {
        const tlEnd = await tl.GetEndFrame();
        const ins = await insertTitleAtEnd(tl, meta, tlEnd, b.kind, title);
        if (ins.error) return { error: ins.error };
        if (!ins.item) return { error: 'Resolve would not insert "' + title + '". Wait a few seconds and try again (it has to scan the new template).' };
        const item = ins.item;
        const id2 = String(await item.GetUniqueId());
        const undo = async () => { try { await tl.DeleteClips([item], true); } catch (e) { /* ignore */ } };
        try {
            if (!(await fitDuration(item, want))) notes.push('The clip could not be trimmed to 3 seconds.');
            // Resolve wires an inserted title's output to "Template"; a preset with tools after the text needs its own output.
            const out = presetOutputFor(title);
            if (out && out.source !== 'Template') {
                let r = null;
                try { r = await bridgeCall('set_output', { item: id2, comp: null, source: out.source, output: out.output }); } catch (e) { r = { ok: false, why: e.message }; }
                if (!r || !r.ok) notes.push('The preset\'s effects could not be connected (' + ((r && r.why) || 'unknown') + ').');
            }
        } catch (e) { await undo(); throw e; }
        const track = await pickTrack(tl, 'video', 0, start, start + want, 2, notes);
        const mv = await moveTitleSafe(tl, item, track, start, tlEnd);
        if (!mv.ok) return { error: mv.error };
        let compName = null;
        try { const names = (await item.GetFusionCompNameList()) || []; compName = names[names.length - 1] || null; } catch (e) { /* ignore */ }
        try { await bridgeCall('refresh', { item: id2, comp: compName }); } catch (e) { /* the clip is placed */ }
        settleLater(id2, compName);
        dlog('BOILERPLATE-INSERTED', title, 'V' + track, start, want);
        return { ok: true, itemId: id2, title, track: 'V' + track, start, frames: want, notes };
    } finally {
        state.applying = false;
        try { await tl.SetCurrentTimecode(origTC); } catch (e) { /* ignore */ }
    }
}
