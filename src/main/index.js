// Main-process entry point: process-level error guards, app lifecycle hooks and start-up.

const { app } = require('electron');

const state = require('./state');
const { ensureDirs } = require('./config');
const { startAutomation } = require('./automation');
const { prepareColorScript, startJxaHelper, stopJxaHelper } = require('./color-picker');
const { listSystemFonts, syncAllPresetFonts } = require('./fonts');
const { bridgeCall } = require('./fusion-bridge');
const { registerIpcHandlers } = require('./ipc');
const { cleanup, quitPlugin, watchResolve } = require('./lifecycle');
const { dlog } = require('./log');
const { createWindow } = require('./window');
const { loadLib } = require('./library');
const { startupTemplates } = require('./title-templates');
const { pruneSfxCache } = require('./sfx');
const { prunePreviews } = require('./previews');
const { startSegWatch } = require('./seg-watch');
const PERF = require('./perf');

// A stray error anywhere must never take the panel down or leave Resolve with a dead plugin.
process.on('uncaughtException', (err) => { try { console.error('[uncaughtException]', err && err.stack || err); dlog('[uncaughtException]', String(err && err.stack || err)); } catch (e) { /* ignore */ } });
process.on('unhandledRejection', (err) => { try { console.error('[unhandledRejection]', err && err.stack || err); dlog('[unhandledRejection]', String(err && err.stack || err)); } catch (e) { /* ignore */ } });

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    try { process.on(sig, () => quitPlugin()); } catch (e) { /* ignore */ }
}
// Cmd+Q and friends: hold the quit until an un-applied preview is off the timeline (quitPlugin quits afterwards).
app.on('before-quit', (e) => {
    stopJxaHelper();
    try { require('./broll').brollShutdown(); } catch (err) { /* the B-roll worker quits on its own when idle */ }
    if (!state.isQuitting) { e.preventDefault(); quitPlugin(); return; }
    cleanup();
});

app.whenReady().then(() => {
    ensureDirs();
    registerIpcHandlers();
    createWindow();
    try { startAutomation(); } catch (e) { dlog('[automation] not started', String(e && e.message || e)); }      // for the MCP script (mcp/)

    // Auto-close together with DaVinci Resolve.
    watchResolve();

    // Warm-ups, staggered so the window shows first. Each one is timed (perf.js) so a slow start can be traced.
    const warm = (name, ms, fn) => setTimeout(() => { const t0 = Date.now(); try { const r = fn(); if (r && typeof r.then === 'function') r.catch(() => { /* only a warm-up */ }).finally(() => PERF.record('startup.' + name, Date.now() - t0)); else PERF.record('startup.' + name, Date.now() - t0); } catch (e) { PERF.record('startup.' + name, Date.now() - t0, { error: String(e && e.message || e) }); } }, ms);
    warm('fonts', 800, () => listSystemFonts());
    warm('jxa', 800, () => startJxaHelper());      // compiled and warmed once, so the first click is quick too
    warm('bridgePing', 1200, () => bridgeCall('ping', {}, 30000));
    warm('segWatch', 3000, () => startSegWatch());      // Inspector timing sliders of MultiText clips
    warm('colorScript', 1500, () => prepareColorScript());
    warm('presetFonts', 2000, () => syncAllPresetFonts());
    // Title templates are renamed to their preset's name, and those of presets removed while the plugin was closed go.
    warm('templates', 2500, () => startupTemplates(loadLib().animations));
    // Expired trimmed sound clips and previews are cleared at start-up and every 6 hours while the panel stays open
    // (deferred to their own turn of the event loop, after the window's first requests; the walks are timed as startup.prune).
    const pruneCaches = () => Promise.resolve().then(() => pruneSfxCache()).catch(() => { /* ignore */ }).then(() => prunePreviews()).catch(() => { /* ignore */ });
    warm('prune', 4000, () => pruneCaches());
    setInterval(pruneCaches, 6 * 3600 * 1000).unref();
});

app.on('window-all-closed', () => quitPlugin());
