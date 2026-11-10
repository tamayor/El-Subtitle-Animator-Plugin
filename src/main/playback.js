// Resolve's scripting API cannot read or stop playback. Playback is recognised by the playhead moving between two
// reads, and stopped through Resolve's Playback > Stop menu (or the K key as a fallback; needs macOS Accessibility).
// Used before anything that depends on the playhead staying put (InsertFusionTitleIntoTimeline inserts AT the playhead).

module.exports = { ensureStopped, isPlaying, noteFrame, stopPlayback };

const { execFile } = require('child_process');
const state = require('./state');
const { dlog } = require('./log');

const PROC = 'first process whose name is "Resolve" or name contains "DaVinci Resolve"';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// A reading of the playhead (the panel's poll every 200-1200 ms, and a placement before and after its timeline
// snapshot): the last two are kept, so isPlaying can tell a still timeline without a wait of its own.
function noteFrame(tlName, frame, tc) {
    const h = state.playhead, same = !!(h && h.tlName === tlName);
    state.playhead = { tlName, frame, tc: tc == null ? null : String(tc), at: Date.now(), prevFrame: same ? h.frame : null, prevAt: same ? h.at : 0 };
}

// A playing timeline moves 2+ frames in STILL_GAP_MS (24-60 fps); two equal readings at least that far apart mean it stands.
const STILL_GAP_MS = 100, RECENT_MS = 2500;
async function isPlaying(tl) {
    // The playhead was read twice in the last moment, far enough apart, and did not move: standing still, no wait.
    try {
        const h = state.playhead;
        if (h && h.prevAt && Date.now() - h.at < RECENT_MS && h.at - h.prevAt >= STILL_GAP_MS && h.at - h.prevAt <= RECENT_MS && h.frame === h.prevFrame) {
            if (String(await tl.GetName()) === h.tlName) return false;
        }
        // One recent reading (e.g. right after a placement's snapshot): one more now, after the rest of STILL_GAP_MS,
        // instead of a fresh pair 130 ms apart. Only "still" is concluded from it: a different reading may be this
        // plugin's own move (parkPlayhead, a seek) since, so that case is measured below.
        if (h && h.tc && Date.now() - h.at < RECENT_MS && String(await tl.GetName()) === h.tlName) {
            const rest = STILL_GAP_MS - (Date.now() - h.at);
            if (rest > 0) await wait(rest);
            if (String(await tl.GetCurrentTimecode()) === h.tc) return false;
        }
    } catch (e) { /* measured below */ }
    try {
        const a = await tl.GetCurrentTimecode();
        await wait(130);
        const b = await tl.GetCurrentTimecode();
        return a !== b;
    } catch (e) { return false; }
}

function osa(script) {
    return new Promise((resolve) => {
        if (process.platform !== 'darwin') return resolve(false);
        execFile('/usr/bin/osascript', ['-e', script], { timeout: 6000 }, (err) => resolve(!err));
    });
}

async function stopPlayback() {
    const menu = 'tell application "System Events"\n  tell (' + PROC + ') to click (first menu item of menu 1 of menu bar item "Playback" of menu bar 1 whose name is "Stop")\nend tell';
    if (await osa(menu)) return 'menu';
    const key = 'tell application "System Events"\n  set frontmost of (' + PROC + ') to true\n  delay 0.15\n  keystroke "k"\nend tell';
    if (await osa(key)) return 'key';
    return null;
}

// true when the timeline is (now) standing still.
async function ensureStopped(tl) {
    if (!(await isPlaying(tl))) return true;
    for (let i = 0; i < 2; i++) {
        const how = await stopPlayback();
        dlog('[playback] stop via ' + how);
        await wait(150);
        if (!(await isPlaying(tl))) return true;
    }
    return false;
}
