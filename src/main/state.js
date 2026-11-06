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
    liveSession: null,
    bridge: null,
    mainWindow: null,
    resolveWatchTimer: null
};
