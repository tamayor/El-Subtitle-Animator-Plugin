// Cleanup on exit and auto-quitting when DaVinci Resolve closes.

module.exports = {
    checkResolveAlive, cleanup, quitPlugin
};

const { execFile } = require('child_process');
const { app } = require('electron');
const WorkflowIntegration = require('./workflow-integration');

const state = require('./state');
const { INITIAL_PPID } = require('./config');
const { liveRemove } = require('./live-preview');


// On quit an un-applied Resolve preview (its Text+ / MultiText and sounds) is taken off the timeline and the user's
// own In/Out are put back. That has to finish BEFORE the Resolve connection is torn down, so it is awaited (capped,
// in case Resolve itself is gone). Concurrent calls (window close, beforeunload, before-quit) share one run.
let cleanupRun = null;
function cleanup() {
    if (cleanupRun) return cleanupRun;
    cleanupRun = (async () => {
        if (state.liveSession) {
            try { await Promise.race([liveRemove('restore'), new Promise(r => setTimeout(r, 5000))]); } catch (e) { /* the sweep removes it next time */ }
        }
        if (state.resolveWatchTimer) { clearInterval(state.resolveWatchTimer); state.resolveWatchTimer = null; }
        try { if (state.bridge) state.bridge.kill(); } catch (e) { /* ignore */ }
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

function checkResolveAlive() {
    if (state.isQuitting) return;
    // 1. If launched as a child of Resolve, auto-close immediately if the parent process exited
    if (INITIAL_PPID > 1 && (process.ppid !== INITIAL_PPID || !isPidAlive(INITIAL_PPID))) {
        if (state.hasSeenResolve) {
            quitPlugin();
            return;
        }
    }
    // 2. Check if the DaVinci Resolve process is running on macOS
    execFile('pgrep', ['-x', 'Resolve'], (err, stdout) => {
        if (state.isQuitting) return;
        const running = !err && Boolean(String(stdout || '').trim());
        if (running) {
            state.hasSeenResolve = true;
        } else if (state.hasSeenResolve) {
            quitPlugin();
        }
    });
}
