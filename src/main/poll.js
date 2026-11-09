// Following the playhead: the panel's periodic poll, idle / parked state, live frame grabs and seeking.

module.exports = {
    liveFrame, parkUntilFocus, poll, seek, setAppIdle
};

const state = require('./state');
const { bridgeCall } = require('./fusion-bridge');
const { checkResolveAlive } = require('./lifecycle');
const { frameToTC, getProject, getSubtitles, tcToFrame, timelineMeta } = require('./resolve');

let appIdleReason = '';
function setAppIdle(v, reason) {
    v = !!v;
    if (state.appIdle === v) return;
    state.appIdle = v;
    appIdleReason = v ? (reason || 'minimized') : '';
    try { if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.webContents.send('win:idle', v, appIdleReason); } catch (e) { /* ignore */ }
}
// After Add to timeline / Apply: real-time work stays paused from the moment the window loses focus (the user went back
// to Resolve) until the window gets focus again.
function parkUntilFocus() {
    state.parkArmed = true;
    try { if (state.mainWindow && !state.mainWindow.isDestroyed() && !state.mainWindow.isFocused()) setAppIdle(true, 'parked'); } catch (e) { /* ignore */ }
    return { ok: true };
}
let pollMeta = { key: null, at: 0, meta: null };
async function poll(event, force) {
    if (state.applying && state.lastPoll) return state.lastPoll;
    if (state.appIdle && state.lastPoll && !force) return state.lastPoll;
    try {
        const project = await getProject();
        if (!project) return { ok: false, reason: 'Open a project in Resolve' };
        const tl = await project.GetCurrentTimeline();
        if (!tl) return { ok: false, reason: 'Open a timeline in Resolve' };
        const tlName = await tl.GetName();
        let meta;
        if (!force && pollMeta.key === tlName && Date.now() - pollMeta.at < 3000) meta = pollMeta.meta;
        else { meta = await timelineMeta(tl, project); pollMeta = { key: tlName, at: Date.now(), meta }; }
        const [subs, tc] = await Promise.all([getSubtitles(tl, force), tl.GetCurrentTimecode()]);
        const frame = tcToFrame(tc, meta);

        // A selected subtitle wins; otherwise the subtitle under the playhead.
        let sub = null, source = 'playhead';
        try {
            // Polled 5 times a second: with many clips selected, asking each one's track in turn flooded Resolve. Only
            // the first MAX_SEL are looked at, all at once.
            const MAX_SEL = 12;
            const all = (await tl.GetSelectedClips()) || [];
            const sel = (Array.isArray(all) ? all : Object.values(all)).slice(0, MAX_SEL);
            const types = await Promise.all(sel.map(c => Promise.resolve(c.GetTrackTypeAndIndex()).catch(() => null)));
            for (let k = 0; k < sel.length; k++) {
                const c = sel[k], tt = types[k];
                if (tt && tt[0] === 'subtitle') {
                    const sStart = await c.GetStart();
                    const sEnd = await c.GetEnd();
                    let sDur = (typeof c.GetDuration === 'function') ? await c.GetDuration() : 0;
                    if (!sDur || sDur <= 0) sDur = Math.max(1, sEnd - sStart);
                    const sText = await c.GetName();
                    const idx = subs.findIndex(x => x.start === sStart && x.track === tt[1]);
                    sub = {
                        index: idx >= 0 ? idx + 1 : 1,
                        text: sText,
                        start: sStart,
                        end: sEnd,
                        duration: sDur,
                        track: tt[1]
                    };
                    source = 'selection';
                    break;
                }
            }
        } catch (e) { /* selection not available: fall back to playhead */ }

        if (!sub) {
            // Find subtitle under playhead across all tracks; prefer higher subtitle tracks if overlapping
            const matches = subs.filter(s => frame >= s.start && frame < s.end);
            if (matches.length > 0) {
                const picked = matches.reduce((best, cur) => ((cur.track || 1) >= (best.track || 1) ? cur : best), matches[0]);
                const idx = subs.indexOf(picked);
                sub = Object.assign({ index: idx >= 0 ? idx + 1 : 1 }, picked);
                source = 'playhead';
            }
        }
        state.lastPoll = { ok: true, timeline: tlName, fps: meta.fps, width: meta.width, height: meta.height, frame, tc, count: subs.length, source, subtitle: sub, subtitles: subs };
        return state.lastPoll;
    } catch (e) {
        if (state.hasSeenResolve) checkResolveAlive();
        const msg = String(e && e.message || e);
        if (msg.includes('Not supported on current page')) {
            return { ok: false, reason: 'Switch to the Edit page in Resolve' };
        }
        return { ok: false, reason: msg };
    }
}

// ------------------------------------------------------------------ live frame and seeking
async function liveFrame(event, frame) {
    if (state.applying) return { ok: false, busy: true };
    // Crisp preview frame capped at 1280 to prevent IPC flooding, memory bloat, and renderer process crashes
    const res = await bridgeCall('live_frame', { frame, maxDim: 1280 }, 15000);
    return Object.assign({ ok: true }, res);
}

async function seek(event, frame) {
    // A clip is being placed: it parks the playhead at the end of the timeline to insert, so a seek now (the jump to the
    // next caption, the preview's loop) would make Resolve insert the title in the middle of the timeline.
    if (state.applying) return false;
    const project = await getProject();
    const tl = project && await project.GetCurrentTimeline();
    if (!tl) return false;
    const meta = await timelineMeta(tl);
    return await tl.SetCurrentTimecode(frameToTC(frame, meta));
}
