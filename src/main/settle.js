// Second wake for freshly placed titles. Resolve can render a title's effects (Follower reveals and fly-ins,
// Transform/Displace/noise wiggles, any FX in the template) as blank or static right after the comp is
// inserted: the refresh apply() sends 120 ms after insertion sometimes lands while Resolve is still loading the
// comp and is lost. This module remembers every clip placed and wakes all its effects again once the panel has
// been idle for a moment, then twice more a little later, so the animation renders without anyone touching it.

module.exports = {
    settleLater, settleNow
};

const state = require('./state');
const { bridgeCall } = require('./fusion-bridge');
const { dlog } = require('./log');

const IDLE_MS = 1500;       // wait this long after the last placement before the first pass
const GAP_MS = 2500;        // between the first and the second pass
const PASSES = 3;           // the third pass catches titles Resolve finished loading late

const pending = new Map();  // itemId -> { comp, passes }
let timer = null;
let running = null;

function settleLater(itemId, comp) {
    if (!itemId) return;
    pending.set(String(itemId), { comp: comp || null, passes: 0 });
    schedule(IDLE_MS);
}

function schedule(ms) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; runPass().catch(() => { /* logged inside */ }); }, ms);
    if (timer.unref) timer.unref();
}

async function runPass() {
    if (running) return running;
    if (state.applying || state.liveSession) { schedule(IDLE_MS); return; }      // a placement is still going: later
    running = (async () => {
        for (const [id, p] of Array.from(pending.entries())) {
            try {
                await bridgeCall('refresh', { item: id, comp: p.comp }, 15000);
                p.passes += 1;
                dlog('settle', 'woke', id, 'pass', p.passes);
            } catch (e) {
                dlog('settle', 'skip', id, e.message);      // removed meanwhile, or the helper is away
                pending.delete(id);
                continue;
            }
            if (p.passes >= PASSES) pending.delete(id);
        }
    })().finally(() => { running = null; });
    await running;
    if (pending.size) schedule(GAP_MS);
}

// Before a frame is grabbed to check a placement, finish the wakes still owed so the grab shows the real render.
async function settleNow() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (running) { try { await running; } catch (e) { /* ignore */ } }
    let guard = PASSES + 1;
    while (pending.size && !state.applying && guard-- > 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        try { await runPass(); } catch (e) { break; }
    }
    if (timer) { clearTimeout(timer); timer = null; }
}
