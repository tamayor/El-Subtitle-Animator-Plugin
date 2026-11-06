// Main-process entry point: process-level error guards, app lifecycle hooks and start-up.

const { app } = require('electron');

const state = require('./state');
const { ensureDirs } = require('./config');
const { prepareColorScript, startJxaHelper, stopJxaHelper } = require('./color-picker');
const { listSystemFonts, syncAllPresetFonts } = require('./fonts');
const { bridgeCall } = require('./fusion-bridge');
const { registerIpcHandlers } = require('./ipc');
const { checkResolveAlive, cleanup, quitPlugin } = require('./lifecycle');
const { dlog } = require('./log');
const { createWindow } = require('./window');
const { loadLib } = require('./library');
const { startupTemplates } = require('./placement');
const { pruneSfxCache } = require('./sfx');
const { prunePreviews } = require('./previews');

// A stray error anywhere must never take the panel down or leave Resolve with a dead plugin.
process.on('uncaughtException', (err) => { try { console.error('[uncaughtException]', err && err.stack || err); dlog('[uncaughtException]', String(err && err.stack || err)); } catch (e) { /* ignore */ } });
process.on('unhandledRejection', (err) => { try { console.error('[unhandledRejection]', err && err.stack || err); dlog('[unhandledRejection]', String(err && err.stack || err)); } catch (e) { /* ignore */ } });

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    try { process.on(sig, () => quitPlugin()); } catch (e) { /* ignore */ }
}
// Cmd+Q and friends: hold the quit until an un-applied preview is off the timeline (quitPlugin quits afterwards).
app.on('before-quit', (e) => {
    stopJxaHelper();
    if (!state.isQuitting) { e.preventDefault(); quitPlugin(); return; }
    cleanup();
});

app.whenReady().then(() => {
    ensureDirs();
    registerIpcHandlers();
    createWindow();

    // Auto-close together with DaVinci Resolve.
    checkResolveAlive();
    state.resolveWatchTimer = setInterval(checkResolveAlive, 1500);

    // Warm-ups, staggered so the window shows first.
    setTimeout(() => { listSystemFonts(); }, 800);
    setTimeout(() => { startJxaHelper(); }, 800);      // compiled and warmed once, so the first click is quick too
    setTimeout(() => { bridgeCall('ping', {}, 30000).catch(() => { /* only a warm-up */ }); }, 1200);
    setTimeout(() => { prepareColorScript(); }, 1500);
    setTimeout(() => { syncAllPresetFonts(); }, 2000);
    // Title templates are renamed to their preset's name, and those of presets removed while the plugin was closed go.
    setTimeout(() => { try { startupTemplates(loadLib().animations); } catch (e) { /* next start */ } }, 2500);
    // Expired trimmed sound clips and previews are cleared at start-up and every 6 hours while the panel stays open.
    const pruneCaches = () => { try { pruneSfxCache(); } catch (e) { /* ignore */ } try { prunePreviews(); } catch (e) { /* ignore */ } };
    setTimeout(pruneCaches, 4000);
    setInterval(pruneCaches, 6 * 3600 * 1000).unref();
});

app.on('window-all-closed', () => quitPlugin());
