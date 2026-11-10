// Following the playhead: the panel's periodic poll, idle / parked state, live frame grabs and seeking.

module.exports = {
    liveFrame, parkUntilFocus, poll, seek, setAppIdle
};

const state = require('./state');
const { bridgeCall } = require('./fusion-bridge');
const { checkResolveAlive } = require('./lifecycle');
const { noteFrame } = require('./playback');
const { frameToTC, getProject, getSubtitles, tcToFrame, timelineMeta } = require('./resolve');
const PERF = require('./perf');

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
// The selection is read at most every SEL_EVERY_MS (a poll comes every 200 ms; a selection rarely changes that fast),
// and the subtitle tracks' on/off state is kept for TRACK_ON_MS.
const SEL_EVERY_MS = 500, TRACK_ON_MS = 2000;
let selCache = { at: 0, tlName: null, sub: null };
let trackOn = { at: 0, tlName: null, map: new Map() };
let inflight = null;

// Several polls arriving while one is still being answered (Resolve busy) share that answer instead of stacking up.
function poll(event, force) {
    if (state.applying && state.lastPoll) return state.lastPoll;
    if (state.appIdle && state.lastPoll && !force) return state.lastPoll;
    if (inflight && !force) return inflight;
    inflight = pollInner(force).finally(() => { inflight = null; });
    return inflight;
}

async function pollInner(force) {
    const sp = PERF.span('poll');
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
        noteFrame(tlName, frame);      // playback.js isPlaying knows a still timeline from the last two readings

        // A selected subtitle wins; otherwise the subtitle under the playhead.
        let sub = null, source = 'playhead';
        const now = Date.now();
        if (!force && selCache.tlName === tlName && now - selCache.at < SEL_EVERY_MS) {
            if (selCache.sub) { sub = selCache.sub; source = 'selection'; }
        } else {
            try {
                // With many clips selected, asking each one's track in turn flooded Resolve. Only the first MAX_SEL are
                // looked at, all at once. The items are kept in state.lastSelection for seg-watch.js.
                const MAX_SEL = 12;
                const all = (await tl.GetSelectedClips()) || [];
                const selAll = Array.isArray(all) ? all : Object.values(all);
                const sel = selAll.slice(0, MAX_SEL);
                const types = await Promise.all(sel.map(c => Promise.resolve(c.GetTrackTypeAndIndex()).catch(() => null)));
                state.lastSelection = { at: now, tlName, items: sel, types, count: selAll.length };
                for (let k = 0; k < sel.length; k++) {
                    const c = sel[k], tt = types[k];
                    if (tt && tt[0] === 'subtitle') {
                        // A turned-off subtitle (clip or track) is not the current subtitle, even when selected.
                        let on = true;
                        try {
                            if (trackOn.tlName !== tlName || now - trackOn.at > TRACK_ON_MS) trackOn = { at: now, tlName, map: new Map() };
                            if (!trackOn.map.has(tt[1])) trackOn.map.set(tt[1], (await tl.GetIsTrackEnabled('subtitle', tt[1])) !== false);
                            on = (await c.GetClipEnabled()) !== false && trackOn.map.get(tt[1]) !== false;
                        } catch (e) { on = true; }
                        if (!on) continue;
                        const [sStart, sEnd, sText] = await Promise.all([c.GetStart(), c.GetEnd(), c.GetName()]);
                        const sDur = Math.max(1, sEnd - sStart);
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
            selCache = { at: now, tlName, sub };
        }

        if (!sub) {
            // Find the enabled subtitle under the playhead across all tracks; prefer higher subtitle tracks if overlapping
            const matches = subs.filter(s => s.enabled !== false && frame >= s.start && frame < s.end);
            if (matches.length > 0) {
                const picked = matches.reduce((best, cur) => ((cur.track || 1) >= (best.track || 1) ? cur : best), matches[0]);
                const idx = subs.indexOf(picked);
                sub = Object.assign({ index: idx >= 0 ? idx + 1 : 1 }, picked);
                source = 'playhead';
            }
        }
        // The subtitle list itself is not sent on every poll (20-60 KB five times a second): the panel asks for it
        // (app:subtitles) when subsVersion changes.
        state.lastPoll = {
            ok: true, timeline: tlName, fps: meta.fps, width: meta.width, height: meta.height, frame, tc, count: subs.length, source, subtitle: sub,
            subsVersion: state.subCache.version || 1
        };
        return state.lastPoll;
    } catch (e) {
        if (state.hasSeenResolve) checkResolveAlive();
        const msg = String(e && e.message || e);
        if (msg.includes('Not supported on current page')) {
            return { ok: false, reason: 'Switch to the Edit page in Resolve' };
        }
        return { ok: false, reason: msg };
    } finally { sp.end(); }
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
