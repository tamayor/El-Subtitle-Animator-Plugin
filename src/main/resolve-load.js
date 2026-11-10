// How busy Resolve is right now, judged from the poll's own cheap calls (GetCurrentTimeline / GetName).
// An idle Resolve answers a script call in well under 1 ms. While it renders something heavy every frame (playback, or
// a clip with several effect presets stacked) it answers ONE call per frame: every call then takes ~40 ms at 25 fps.
// The panel's background readers (subtitle probe / full read, seg-watch, timing candidates, Clip controls, effect
// state) made ~25 calls a second, which at 40 ms each is all of Resolve's script time: Resolve and the panel froze
// (perf summary 2026-11-10: sub.full 41 s, controls_get waiting 39 s, every resolve.* call 40.0 ms for 7 minutes).
// While busy() is true those readers wait; the poll itself slows to BUSY_POLL_MS. User actions (place, toggles) still run.

const BUSY_PER_CALL_MS = 15;      // ms per call at or above which a sample counts as busy (idle ~0.1-1 ms, busy ~40)
const FAST_PER_CALL_MS = 5;       // a sample this fast ends the busy state
const SAMPLES = 4;                // the last few samples
const STALE_MS = 60000;           // no sample for this long: assume it recovered (never stay muted for good)
const PROBE_EVERY_MS = 5000;      // while busy, a background reader may send one timed test call this often
const BUSY_POLL_MS = 1500;        // the poll's pace while busy (normally every 200 ms)

let samples = [];
let busy = false, lastSampleAt = 0, lastProbeAt = 0;

// ms = how long `calls` Resolve calls took together. Busy starts when the median of the last samples is slow and lasts
// until a clearly fast answer: it does not run out on a timer (with the panel in the background the poll stops, and a
// timed-out flag let seg-watch flood a still-busy Resolve again - perf log 2026-11-10 23:00).
function noteResolveLatency(ms, calls) {
    const per = Number(ms) / Math.max(1, calls || 1);
    if (!Number.isFinite(per)) return;
    lastSampleAt = Date.now();
    samples.push(per);
    if (samples.length > SAMPLES) samples = samples.slice(-SAMPLES);
    const sorted = samples.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (per < FAST_PER_CALL_MS) { busy = false; samples = [per]; }
    else if (median >= BUSY_PER_CALL_MS) busy = true;
}

function resolveBusy() {
    if (busy && Date.now() - lastSampleAt > STALE_MS) busy = false;
    return busy;
}

// While busy: true at most every PROBE_EVERY_MS, for a reader that then times ONE cheap call (noteResolveLatency) so
// the busy state can end even when the panel's poll is not running.
function probeDue() {
    if (Date.now() - lastProbeAt < PROBE_EVERY_MS) return false;
    lastProbeAt = Date.now();
    return true;
}

module.exports = { noteResolveLatency, resolveBusy, probeDue, BUSY_POLL_MS };
