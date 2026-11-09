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
// Every poll is a handful of calls into Resolve (project, timeline, timecode, selection). While this window is the
// active one it polls 5 times a second; while the user works in Resolve itself (this window unfocused) it polls at
// POLL_BG_MS, so the panel following the playhead costs Resolve less while they edit. A running Resolve preview keeps
// the quick rate, since it follows the playhead from caption to caption.
const POLL_FG_MS = 200, POLL_BG_MS = 400;
async function tick() {
    if (state.idle) { setTimeout(tick, 500); return; }          // minimized: no real-time polling of Resolve
    if (!state.busy && !state.drag) {
        try { state.live = await window.sa.poll(false); } catch (e) { state.live = { ok: false, reason: 'Not connected' }; }
        watchPlayback(state.live);
        renderLive();
    }
    let focused = true;
    try { focused = document.hasFocus(); } catch (e) { focused = true; }
    setTimeout(tick, (focused || state.livePrev) ? POLL_FG_MS : POLL_BG_MS);
}
