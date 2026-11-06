// Idle handling (minimized / parked window) and the live-subtitle poll loop (tick).

// ---------------------------------------------------------------- minimized: real-time rendering paused
// The main process reports when the window is minimized or hidden. Polling Resolve, rendering previews and the Resolve
// preview's follow-the-playhead all stop; when the window is back everything is refreshed once.
state.idle = false;
function parkAfterPlace() { try { if (window.sa && window.sa.parkUntilFocus) window.sa.parkUntilFocus(); } catch (e) { /* ignore */ } }
if (window.sa && window.sa.onWinIdle) window.sa.onWinIdle((idle, why) => {
    state.idle = !!idle;
    if (idle) { setStatus(why === 'parked' ? 'Done: real-time rendering is paused until you come back to this window.' : 'Minimized: real-time rendering is paused.', ''); return; }
    setStatus('Back: real-time rendering resumed.', 'ok');
    state.liveBg.key = '';
    try { redrawStages(); } catch (e) { /* ignore */ }
    try { refreshLiveBg(); } catch (e) { /* ignore */ }
});

// A render that has not come back after a minute is given up, so the preview never stays stuck on "Updating…": the next
// change (or the retry below) renders again.
setInterval(() => {
    const u = state.use;
    if (!u || !u.rendering || !u.renderStart || Date.now() - u.renderStart < 60000) return;
    u.rendering = false; u.renderReq = null; u.renderStart = 0;
    setStatus('The preview took too long, trying again.', '');
    try { redrawStages(); } catch (e) { /* ignore */ }
}, 5000);

// ---------------------------------------------------------------- live subtitle
async function tick() {
    if (state.idle) { setTimeout(tick, 500); return; }          // minimized: no real-time polling of Resolve
    if (!state.busy && !state.drag) {
        try { state.live = await window.sa.poll(false); } catch (e) { state.live = { ok: false, reason: 'Not connected' }; }
        watchPlayback(state.live);
        renderLive();
    }
    setTimeout(tick, 200);
}
