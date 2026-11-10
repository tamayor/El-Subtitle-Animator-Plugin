// How busy Resolve is right now, judged from the poll's own cheap calls (GetCurrentTimeline / GetName).
// An idle Resolve answers a script call in well under 1 ms. While it renders something heavy every frame (playback, or
// a clip with several effect presets stacked) it answers ONE call per frame: every call then takes ~40 ms at 25 fps.
// The panel's background readers (subtitle probe / full read, seg-watch, timing candidates, Clip controls, effect
// state) made ~25 calls a second, which at 40 ms each is all of Resolve's script time: Resolve and the panel froze
// (perf summary 2026-11-10: sub.full 41 s, controls_get waiting 39 s, every resolve.* call 40.0 ms for 7 minutes).
// While busy() is true those readers wait; the poll itself slows to BUSY_POLL_MS. User actions (place, toggles) still run.

const BUSY_PER_CALL_MS = 15;      // ms per call at or above which a sample counts as busy (idle ~0.1-1 ms, busy ~40)
const SAMPLES = 4;                // the last few poll samples
const HOLD_MS = 4000;             // stays busy this long after the last busy sample
const BUSY_POLL_MS = 1500;        // the poll's pace while busy (normally every 200 ms)

let samples = [];
let busyUntil = 0;

// ms = how long `calls` Resolve calls took together
function noteResolveLatency(ms, calls) {
    const per = Number(ms) / Math.max(1, calls || 1);
    if (!Number.isFinite(per)) return;
    samples.push(per);
    if (samples.length > SAMPLES) samples = samples.slice(-SAMPLES);
    const sorted = samples.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median >= BUSY_PER_CALL_MS) busyUntil = Date.now() + HOLD_MS;
    else if (per < BUSY_PER_CALL_MS / 3) busyUntil = Math.min(busyUntil, Date.now());      // a clearly fast answer ends it
}

function resolveBusy() { return Date.now() < busyUntil; }

module.exports = { noteResolveLatency, resolveBusy, BUSY_POLL_MS };
