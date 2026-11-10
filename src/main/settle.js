// Second wake for freshly placed titles. Resolve can render a title's effects (Follower reveals and fly-ins,
// Transform/Displace/noise wiggles, any FX in the template) as blank or static right after the comp is
// inserted: the refresh apply() sends 120 ms after insertion sometimes lands while Resolve is still loading the
// comp and is lost. This module remembers every clip placed and wakes all its effects again once the panel has
// been idle for a moment, then a few more times a little later, so the animation renders without anyone touching it.
// The number of passes, the timing and the batch size are the panel's Fusion fixes settings.

module.exports = {
    settleLater, settleNow
};

const state = require('./state');
const { bridgeCall } = require('./fusion-bridge');
const { getFixes } = require('./fusion-fixes');
const { dlog } = require('./log');

// How many passes, how long to wait and how many clips per step: the panel's Fusion fixes settings (fusion-fixes.js).
const cfg = () => {
    const f = getFixes();
    return {
        passes: f.wakeMode === 'off' ? 0 : f.settlePasses, idle: f.settleDelayMs, gap: f.settleGapMs, batch: f.settleBatch
    };
};
const STEP_MS = 150;        // between batches of one pass: other helper requests (live frames, placements) get in

const pending = new Map();  // itemId -> { comp, passes, due }
let timer = null;
let running = null;

function settleLater(itemId, comp) {
    if (!itemId) return;
    const c = cfg();
    if (c.passes <= 0) return;
    pending.set(String(itemId), { comp: comp || null, passes: 0, due: 0 });
    schedule(c.idle);
}

function schedule(ms) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; runPass().catch(() => { /* logged inside */ }); }, ms);
    if (timer.unref) timer.unref();
}

// One step: wakes up to `batch` clips that are due. Clips not reached yet are taken by the next step.
async function runPass(all) {
    if (running) return running;
    const c = cfg();
    if (state.applying || state.liveSession) { schedule(c.idle); return; }      // a placement is still going: later
    if (c.passes <= 0) { pending.clear(); return; }
    running = (async () => {
        const now = Date.now();
        const due = Array.from(pending.entries()).filter(([, p]) => all || p.due <= now);
        for (const [id, p] of (all ? due : due.slice(0, c.batch))) {
            if (state.applying) break;
            try {
                await bridgeCall('refresh', { item: id, comp: p.comp }, 15000, { lane: 2 });      // background lane: live frames and placements go first
                p.passes += 1;
                p.due = Date.now() + c.gap;
                dlog('settle', 'woke', id, 'pass', p.passes);
            } catch (e) {
                dlog('settle', 'skip', id, e.message);      // removed meanwhile, or the helper is away
                pending.delete(id);
                continue;
            }
            if (p.passes >= c.passes) pending.delete(id);
        }
    })().finally(() => { running = null; });
    await running;
    if (pending.size) {
        const next = Math.min(...Array.from(pending.values()).map(p => p.due));
        schedule(Math.max(STEP_MS, next - Date.now()));
    }
}

// Before a frame is grabbed to check a placement, finish the wakes still owed so the grab shows the real render.
async function settleNow() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (running) { try { await running; } catch (e) { /* ignore */ } }
    let guard = cfg().passes + 1;
    while (pending.size && !state.applying && guard-- > 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        try { await runPass(true); } catch (e) { break; }
    }
    if (timer) { clearTimeout(timer); timer = null; }
}
