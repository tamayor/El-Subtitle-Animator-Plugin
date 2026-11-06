// Finding the Fusion clip currently selected on the timeline.

module.exports = {
    findSelectedFusionItem
};

const { isTitleClipName } = require('./placement');
const { getProject } = require('./resolve');

async function findSelectedFusionItem() {
    const project = await getProject();
    const tl = project && await project.GetCurrentTimeline();
    if (!tl) return null;
    const sel = (await tl.GetSelectedClips()) || [];
    for (const c of sel) {
        if ((await c.GetFusionCompCount()) > 0 && isTitleClipName(await c.GetName())) return c;
    }
    for (const c of sel) { if ((await c.GetFusionCompCount()) > 0) return c; }
    return null;
}
