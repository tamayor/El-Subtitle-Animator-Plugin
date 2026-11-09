// The Fusion fixes the panel applies to placed titles, as user settings (header button "Fusion" in the panel).
//
// Resolve can render a freshly inserted title as if parts of it were missing (a Follower reveal stays blank, a fly-in
// sits still), so the panel "wakes" each title's effects - when its text is set, again right after it is placed, and a
// few more times once the panel is idle (settle.js). Each wake toggles tools in the comp, which makes Resolve re-render
// it: with many clips on the timeline that is what makes Resolve and the panel lag. These settings let the user choose
// how much of that work is done. The defaults are what the panel always did.
//
// Stored in <data>/_app/fusion-fixes.json, read once and kept in memory. The Python helper (fusion_bridge.py) gets a
// copy when it starts and whenever a setting changes ("config" operation).

const fs = require('fs');
const path = require('path');

const { APP_DATA_DIR } = require('./config');

const FILE = path.join(APP_DATA_DIR, 'fusion-fixes.json');

const FIX_DEFAULTS = Object.freeze({
    // Which tools a wake toggles. 'all': every Follower (shading elements off/on) and every other effect
    // (pass-through on/off). 'followers': only Followers - much lighter, enough for text reveals. 'off': no wakes.
    wakeMode: 'all',
    wakeOnInsert: true,         // wake while the text is set (set_text / set_boxes)
    refreshAfterPlace: true,    // re-write the text and wake once the clip and its sounds are placed
    retouchText: true,          // the refresh re-writes each text input with its own value
    settlePasses: 3,            // extra wakes once the panel is idle (0 = none)
    settleDelayMs: 1500,        // idle time before the first extra wake
    settleGapMs: 2500,          // between extra wakes
    settleBatch: 4,             // clips woken per step, so live frames and placements are not held up behind them
    fitFollowerDelay: true,     // clips shorter than the animation: shorten the Follower's per-letter Delay
    fitSegments: true,          // segment presets: scale their ranges down to fit a short clip
    clipSliderMax: true         // the timing sliders run up to the clip's length
});

const LIMITS = { settlePasses: [0, 6], settleDelayMs: [200, 20000], settleGapMs: [200, 20000], settleBatch: [1, 50] };
const WAKE_MODES = ['all', 'followers', 'off'];

let current = null;

function clean(src) {
    const out = Object.assign({}, FIX_DEFAULTS);
    if (!src || typeof src !== 'object') return out;
    for (const k of Object.keys(FIX_DEFAULTS)) {
        if (!(k in src)) continue;
        const d = FIX_DEFAULTS[k], v = src[k];
        if (k === 'wakeMode') out[k] = WAKE_MODES.includes(v) ? v : d;
        else if (typeof d === 'boolean') out[k] = !!v;
        else {
            const n = Math.round(Number(v));
            const [lo, hi] = LIMITS[k];
            out[k] = Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
        }
    }
    return out;
}

function getFixes() {
    if (current) return current;
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* first run: defaults */ }
    current = clean(raw);
    return current;
}

// patch: some settings, or { reset: true } for the defaults. Returns all settings.
async function setFixes(event, patch) {
    const next = (patch && patch.reset) ? clean(null) : clean(Object.assign({}, getFixes(), patch || {}));
    current = next;
    try {
        fs.mkdirSync(APP_DATA_DIR, { recursive: true });
        const tmp = FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
        fs.renameSync(tmp, FILE);
    } catch (e) { /* kept for this session */ }
    // tell a running helper; one started later gets the settings at start (fusion-bridge.js)
    try {
        const state = require('./state');
        if (state.bridge && state.bridge.exitCode === null) await require('./fusion-bridge').bridgeCall('config', bridgeFixes(), 5000);
    } catch (e) { /* the helper is busy or away: it reads them when it starts */ }
    return next;
}

// The part the Python helper uses.
function bridgeFixes() {
    const f = getFixes();
    return {
        wakeMode: f.wakeMode, wakeOnInsert: f.wakeOnInsert, retouchText: f.retouchText,
        fitFollowerDelay: f.fitFollowerDelay, fitSegments: f.fitSegments, clipSliderMax: f.clipSliderMax
    };
}

module.exports = { FIX_DEFAULTS, getFixes, setFixes, bridgeFixes };
