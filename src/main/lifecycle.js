// Cleanup on exit and auto-quitting when DaVinci Resolve closes.

module.exports = {
    checkResolveAlive, cleanup, quitPlugin, watchResolve
};

const { execFile } = require('child_process');
const { app } = require('electron');
const WorkflowIntegration = require('./workflow-integration');

const state = require('./state');
const { INITIAL_PPID } = require('./config');
const { liveRemove, waitIdle } = require('./live-preview');
const { stopAutomation } = require('./automation');
const { dlog } = require('./log');


// On quit an un-applied Resolve preview (its Text+ / MultiText and sounds) is taken off the timeline and the user's
// own In/Out are put back. That has to finish BEFORE the Resolve connection is torn down, so it is awaited (capped,
// in case Resolve itself is gone). Concurrent calls (window close, beforeunload, before-quit) share one run.
let cleanupRun = null;
function cleanup() {
    if (cleanupRun) return cleanupRun;
    cleanupRun = (async () => {
        // A preview move / placement still running (state.applying) is waited for first: it may be about to put the
        // preview's sound on the timeline, and removing the preview before that would leave the sound behind.
        if (state.liveSession || state.applying) {
            const run = (async () => { await waitIdle(6000); await liveRemove('restore'); })();
            try { await Promise.race([run, new Promise(r => setTimeout(r, 10000))]); } catch (e) { /* the sweep removes it next time */ }
        }
        if (state.resolveWatchTimer) { clearInterval(state.resolveWatchTimer); state.resolveWatchTimer = null; }
        if (state.segWatchTimer) { clearInterval(state.segWatchTimer); state.segWatchTimer = null; }
        if (state.segSweepTimer) { clearInterval(state.segSweepTimer); state.segSweepTimer = null; }
        try { stopAutomation(); } catch (e) { /* ignore */ }
        try { require('./media-analysis').stopAsr(); } catch (e) { /* ignore */ }
        try { require('./broll').brollCancel(); } catch (e) { /* ignore */ }
        try { if (state.bridge) state.bridge.kill(); } catch (e) { /* ignore */ }
        try { if (state.bridgeRender) state.bridgeRender.kill(); } catch (e) { /* ignore */ }
        try { require('./perf').perfFlush(); } catch (e) { /* ignore */ }
        try { WorkflowIntegration.CleanUp(); } catch (e) { /* ignore */ }
        state.resolveObj = null;
        return true;
    })().finally(() => { cleanupRun = null; });
    return cleanupRun;
}

async function quitPlugin() {
    if (state.isQuitting) return;
    state.isQuitting = true;
    try { if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.hide(); } catch (e) { /* ignore */ }
    try { await cleanup(); } catch (e) { /* ignore */ }
    try {
        if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.destroy();
    } catch (e) { /* ignore */ }
    try { app.quit(); } catch (e) { /* ignore */ }
    setTimeout(() => process.exit(0), 150).unref();
}

function isPidAlive(pid) {
    if (!pid || pid <= 1) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return e && e.code === 'EPERM';
    }
}

// Three ways to notice Resolve going away, cheapest first: Blackmagic's 'ResolveQuit' callback (when the module has
// it), the parent process (Resolve starts this plugin) checked every 1.5 s with a signal 0, and a `pgrep` for the
// Resolve process every PGREP_MS as the fallback (it used to run every 1.5 s: 40 processes a minute for nothing).
const PGREP_MS = 15000;
let lastPgrep = 0;
function watchResolve() {
    try {
        if (typeof WorkflowIntegration.RegisterCallback === 'function') {
            const ok = WorkflowIntegration.RegisterCallback('ResolveQuit', () => quitTrace('resolve-quit-callback'));
            dlog('ResolveQuit callback registered', ok);
        }
    } catch (e) { /* the polls below still catch it */ }
    checkResolveAlive(true);
    state.resolveWatchTimer = setInterval(checkResolveAlive, 1500);
}

function checkResolveAlive(force) {
    if (state.isQuitting) return;
    // 1. If launched as a child of Resolve, auto-close immediately if the parent process exited
    if (INITIAL_PPID > 1 && (process.ppid !== INITIAL_PPID || !isPidAlive(INITIAL_PPID))) {
        if (state.hasSeenResolve) {
            quitTrace('parent-gone', { ppid: process.ppid, initial: INITIAL_PPID });
            return;
        }
    }
    // 2. Check if the DaVinci Resolve process is running on macOS (every PGREP_MS, or when asked)
    const now = Date.now();
    if (!force && now - lastPgrep < PGREP_MS) return;
    lastPgrep = now;
    // Once Resolve's PID is known, a signal 0 to it is the answer (no process spawned, no race).
    if (resolvePid) {
        if (isPidAlive(resolvePid)) { pgrepMisses = 0; return; }
        resolvePid = 0;                                 // gone (or restarted): confirm with pgrep below
    }
    execFile('pgrep', ['-x', 'Resolve'], (err, stdout) => {
        if (state.isQuitting) return;
        const pid = parseInt(String(stdout || '').trim().split(/\s+/)[0], 10);
        if (!err && pid > 1) {
            resolvePid = pid; pgrepMisses = 0;
            state.hasSeenResolve = true;
            return;
        }
        // macOS pgrep fails now and then (exit 3 "Cannot get process list" while processes start / end, e.g. the
        // ffmpeg and Python helpers a timeline preview spawns): only "no match" (exit 1), twice in a row, means gone.
        // A failed check used to quit the panel right after Start.
        const noMatch = err && err.code === 1;
        if (!noMatch) { quitTrace('pgrep-error', { code: err && err.code }, false); lastPgrep = 0; return; }
        if (!state.hasSeenResolve) return;
        if (++pgrepMisses < 2) { lastPgrep = 0; return; }   // re-checked on the next 1.5 s tick
        quitTrace('resolve-gone', { via: 'pgrep' });
    });
}
let resolvePid = 0, pgrepMisses = 0;

// Every auto-quit says why in the perf log (perf-log.jsonl, flushed on quit), so a panel that "just closes" can be traced.
function quitTrace(reason, meta, quit = true) {
    try { require('./perf').record('quit.' + reason, 0, meta); } catch (e) { /* ignore */ }
    dlog('[quit]', reason, meta || '');
    if (quit) quitPlugin();
}
