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
function noteFrame(tlName, frame) {
    const h = state.playhead, same = !!(h && h.tlName === tlName);
    state.playhead = { tlName, frame, at: Date.now(), prevFrame: same ? h.frame : null, prevAt: same ? h.at : 0 };
}

async function isPlaying(tl) {
    // The playhead was read twice in the last moment, at least 150 ms apart, and did not move: standing still, no
    // 130 ms wait (a playing timeline moves 3+ frames in 150 ms).
    try {
        const h = state.playhead;
        if (h && h.prevAt && Date.now() - h.at < 2500 && h.at - h.prevAt >= 150 && h.at - h.prevAt <= 2500 && h.frame === h.prevFrame) {
            if (String(await tl.GetName()) === h.tlName) return false;
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
