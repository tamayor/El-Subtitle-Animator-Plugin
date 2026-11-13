// What the automation tools share for one session: the clips they placed (so remove_placed / list_placed find them
// again, and per-row sounds re-placed after a timing change keep their ids), the current timeline, and waiting until
// the panel is not placing something itself.

// Declared before module.exports: a const in the export list must exist when it runs.
const placed = [];      // clips placed through automation this session: { itemId, audioId, extraAudioIds, subtitle, presetId, preset, track }

module.exports = { currentTimeline, placed, subtitleAt, swapAudioIds, waitFree };

const state = require('./state');
const { getProject, getSubtitles, timelineMeta } = require('./resolve');

function swapAudioIds(from, to) {
    for (const rec of placed) {
        const ids = rec.extraAudioIds || [];
        if (!ids.some(id => from.includes(id))) continue;
        rec.extraAudioIds = ids.filter(id => !from.includes(id)).concat(to);
    }
}

async function currentTimeline() {
    const project = await getProject();
    if (!project) throw new Error('Open a project in Resolve');
    const tl = await project.GetCurrentTimeline();
    if (!tl) throw new Error('Open a timeline in Resolve');
    return { project, tl, meta: await timelineMeta(tl, project) };
}

async function subtitleAt(tl, n) {
    const subs = await getSubtitles(tl, false);
    const s = subs.find(x => x.index === Number(n));
    if (!s) throw new Error('No subtitle #' + n + ' (the timeline has ' + subs.length + ')');
    return s;
}

async function waitFree(ms) {
    const until = Date.now() + ms;
    while (state.applying && Date.now() < until) await new Promise(r => setTimeout(r, 150));
    if (state.applying) throw new Error('The panel is busy placing a clip. Try again in a moment.');
    if (state.liveSession) throw new Error('A "Preview in Resolve" is running in the panel. Apply or cancel it first.');
}
