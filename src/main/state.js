// Mutable runtime state shared between main-process modules.
// Anything that more than one module reads or writes lives here (always access it as `state.x`, never copy it).

module.exports = {
    hasSeenResolve: false,
    isQuitting: false,
    resolveObj: null,
    subCache: { key: '', at: 0, list: [] },
    applying: false,
    lastPoll: null,
    lastPlacedItemId: null,
    lastPlacedAudioId: null,
    appIdle: false,
    parkArmed: false,
    ofxLeft: new Map(),
    tplState: { text: { auto: null, broken: false, good: 0 }, multitext: { auto: null, broken: false, good: 0 } },
    presetTpl: new Map(),      // preset title template name -> { auto, broken, good } (see presetTplState)
    titleMpiTries: 0,          // how often GetMediaPoolItem was asked of an inserted title (apply.js; never answers)
    liveSession: null,
    placePrefs: null,          // the panel's Placement settings (locked / disabled / first-empty / track range), for MCP placements
    bridge: null,
    bridgeRender: null,        // optional second Fusion helper for renders (perf.json renderProcess, fusion-bridge.js)
    lastSelection: null,       // { at, items, types } the clips selected in Resolve, read by poll() and reused by seg-watch.js / anim-timing.js
    playhead: null,            // { tlName, frame, at, prevFrame, prevAt } the poll's last two playhead readings (playback.js isPlaying)
    segSweepHot: 0,            // Date.now() of the last change that seg-watch's sweep should look at soon
    mainWindow: null,
    resolveWatchTimer: null,
    segWatchTimer: null,
    segSweepTimer: null
};
