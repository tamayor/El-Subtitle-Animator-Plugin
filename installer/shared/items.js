// Everything the installer can set up here: the panel, then what this platform adds (mac/items.js; none on Windows).
// Each item has a detect() (what is on this computer now) and an install(). detect() returns { state, note }:
//   ok       nothing to do            missing   not installed
//   update   installed but out of date (older code, or it points to the folder's old location)
//   blocked  cannot be installed here; note says what is needed first

const P = require('./platform');
const PLUGIN = require('./plugin');

const GROUPS = [
    { id: 'resolve', title: 'DaVinci Resolve' },
    { id: 'claude', title: 'Claude Code (optional)' },
    { id: 'tools', title: 'Tools' },
    { id: 'engines', title: 'Engines (Python and Node)' },
];

// In install order.
const ITEMS = [PLUGIN.ITEM, ...P.ITEMS];

async function scan(ctx) {
    return Promise.all(ITEMS.map(async (item) => {
        const base = { id: item.id, group: item.group, title: item.title, detail: item.detail, size: item.size || '', required: !!item.required };
        try { return { ...base, ...(await item.detect(ctx)) }; }
        catch (e) { return { ...base, state: 'missing', note: 'Could not check: ' + String(e.message || e).slice(0, 120) }; }
    }));
}

module.exports = { GROUPS, ITEMS, scan };
