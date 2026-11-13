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
    pollWake();
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
// Every poll is a handful of calls into Resolve (project, timeline, timecode, selection). The rate adapts to what is
// going on: POLL_FG_MS while something moves (the playhead, the selection, a Resolve preview, the user's hand on the
// panel), POLL_FG_REST_MS once nothing has changed for REST_AFTER_MS, and the slower pair while the user works in
// Resolve itself (this window unfocused). Any input on the panel brings the quick rate back at once, so the first
// interaction never waits for a slow tick.
const POLL_FG_MS = 200, POLL_FG_REST_MS = 500, POLL_BG_MS = 400, POLL_BG_REST_MS = 1200, REST_AFTER_MS = 2000;
const pollState = { lastChange: 0, sig: '', rtt: [], longTasks: 0, perfOn: false, perfAt: 0 };
function pollWake() { pollState.lastChange = Date.now(); }
for (const ev of ['mousedown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(ev, pollWake, { passive: true, capture: true });
window.addEventListener('focus', pollWake);

function pollSignature(L) {
    if (!L || !L.ok) return 'off';
    return L.frame + '|' + L.source + '|' + (L.subtitle ? L.subtitle.start + ':' + L.subtitle.track : '-') + '|' + L.count + '|' + L.subsVersion + '|' + L.timeline;
}
function pollDelay(focused) {
    const moving = state.livePrev || (typeof playWatch !== 'undefined' && playWatch.playing) || (Date.now() - pollState.lastChange < REST_AFTER_MS);
    if (focused) return moving ? POLL_FG_MS : POLL_FG_REST_MS;
    return (moving && state.livePrev) ? POLL_FG_MS : (moving ? POLL_BG_MS : POLL_BG_REST_MS);
}
// Preview in Resolve: clicking its Text+ on the timeline (to work on it) drops the subtitle selection, and the
// subtitle under the playhead can be another one (a higher subtitle track, a neighbour). While the preview's own clip
// is selected the panel stays on the preview's subtitle, so its text is not replaced and the clip is not re-rendered.
function pinLiveSubtitle(L) {
    const p = state.livePrev;
    if (!L || !L.ok || !p) return;
    const f = L.frame;
    const onClip = typeof f === 'number' && ((f >= p.clipS && f < p.clipE) || (f >= p.start && f < p.end));
    if (L.liveSelected && onClip) {          // scrubbing to another caption still moves the preview there
        if (p.sub) { L.subtitle = p.sub; L.source = 'preview'; }
        return;
    }
    if (L.subtitle && L.subtitle.start === p.subStart) p.sub = L.subtitle;
}
async function tick() {
    if (state.idle) { setTimeout(tick, 500); return; }          // minimized: no real-time polling of Resolve
    if (!state.busy && !state.drag) {
        const t0 = performance.now();
        try { state.live = await window.sa.poll(false); } catch (e) { state.live = { ok: false, reason: 'Not connected' }; }
        pinLiveSubtitle(state.live);
        pollSample(performance.now() - t0);
        const sig = pollSignature(state.live);
        if (sig !== pollState.sig) { pollState.sig = sig; pollState.lastChange = Date.now(); }
        watchPlayback(state.live);
        renderLive();
    }
    let focused = true;
    try { focused = document.hasFocus(); } catch (e) { focused = true; }
    setTimeout(tick, pollDelay(focused));
}

// ---------------------------------------------------------------- the panel's own measurements (perf.js)
// While performance measuring is on in the main process, the poll's round trip (p50 / p95 over the last minute) and
// the number of long tasks (> 50 ms) on this thread are reported once a minute as renderer.pollRtt / renderer.longTasks.
function pollSample(ms) {
    pollState.rtt.push(ms);
    if (pollState.rtt.length > 600) pollState.rtt.splice(0, pollState.rtt.length - 600);
}
try {
    if (typeof PerformanceObserver !== 'undefined') {
        new PerformanceObserver((list) => { pollState.longTasks += list.getEntries().length; }).observe({ entryTypes: ['longtask'] });
    }
} catch (e) { /* not supported */ }
setInterval(async () => {
    try {
        if (!window.sa || !window.sa.getPerf) return;
        if (Date.now() - pollState.perfAt > 60000) {
            pollState.perfAt = Date.now();
            const r = await window.sa.getPerf();
            pollState.perfOn = !!(r && r.perf && r.perf.enabled && r.perf.sampleRenderer);
        }
        if (!pollState.perfOn) { pollState.longTasks = 0; return; }
        const arr = pollState.rtt.slice().sort((a, b) => a - b);
        if (arr.length) {
            const q = (p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
            window.sa.perfRecord('pollRtt.p50', q(0.5), { n: arr.length });
            window.sa.perfRecord('pollRtt.p95', q(0.95), { n: arr.length });
        }
        window.sa.perfRecord('longTasks', pollState.longTasks);
        pollState.rtt = []; pollState.longTasks = 0;
    } catch (e) { /* ignore */ }
}, 60000);
