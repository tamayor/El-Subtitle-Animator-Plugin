// Performance instrumentation: per-stage timings, Resolve call counts and bridge timings, switched on at runtime.
//
// Resolve starts the plugin, so an environment variable is awkward to set; the switch lives in <data>/_app/perf.json
// (header "Fusion" popover > Performance, or the MCP tool `perf`). While it is on, every measurement is kept in an
// in-memory summary (perfSummary) and appended as one JSON line to _debug/perf-log.jsonl (buffered, written
// asynchronously; never a synchronous write on a hot path). While it is off, every helper here is a cheap no-op.
//
// What is measured:
//   span(name, meta)      a stage with marks:  const s = span('apply'); ... s.mark('insert'); ... s.end({ ok })
//   timed(name, fn)       one awaited function
//   record(name, ms, meta) a raw measurement (also used for the Python helper's own timings and counters)
//   wrapResolve(obj)      a Proxy around the Resolve API object: every method call is counted and timed as
//                         resolve.<Method>; objects it hands back (project, timeline, items) are wrapped the same way.
//
// This module must not require any project module except config (resolve.js and fusion-bridge.js require it).

const fs = require('fs');
const path = require('path');

const { APP_DATA_DIR, DEBUG_LOG } = require('./config');

const FILE = path.join(APP_DATA_DIR, 'perf.json');
const LOG_FILE = path.join(path.dirname(DEBUG_LOG), 'perf-log.jsonl');
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const FLUSH_MS = 1000;
const RATE_WINDOW_MS = 60000;

const PERF_DEFAULTS = Object.freeze({
    enabled: false,          // measure and log
    promiseApi: 'off',       // 'off' | 'probe' | 'on': Resolve's promise-based scripting API (resolve.js)
    renderProcess: false,    // a second Python helper for renders (capture / live_frame) so they never block the rest
    sampleRenderer: false    // the panel reports its own poll round trips and long tasks (dbg:perf)
});
const PROMISE_MODES = ['off', 'probe', 'on'];

let current = null;
let on = false;
let since = 0;

const stats = new Map();          // name -> { n, totalMs, maxMs, lastMs }
let resolveTimes = [];            // timestamps of Resolve API calls (last RATE_WINDOW_MS), for calls per second
let lines = [];                   // JSON lines waiting to be written
let flushTimer = null;
let logBytes = -1;

function clean(src) {
    const out = Object.assign({}, PERF_DEFAULTS);
    if (!src || typeof src !== 'object') return out;
    for (const k of Object.keys(PERF_DEFAULTS)) {
        if (!(k in src)) continue;
        if (k === 'promiseApi') out[k] = PROMISE_MODES.includes(src[k]) ? src[k] : 'off';
        else out[k] = !!src[k];
    }
    return out;
}

function getPerf() {
    if (current) return current;
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* first run: defaults */ }
    current = clean(raw);
    on = current.enabled;
    if (on && !since) since = Date.now();
    return current;
}

function perfEnabled() {
    if (!current) getPerf();
    return on;
}

// patch: some settings, or { reset: true }. Returns all settings.
function setPerf(patch) {
    const next = (patch && patch.reset) ? clean(null) : clean(Object.assign({}, getPerf(), patch || {}));
    const wasOn = on;
    current = next;
    on = next.enabled;
    if (on && !wasOn) { since = Date.now(); perfReset(); }
    if (!on && wasOn) flushNow();
    try {
        fs.mkdirSync(APP_DATA_DIR, { recursive: true });
        const tmp = FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
        fs.renameSync(tmp, FILE);
    } catch (e) { /* kept for this session */ }
    return next;
}

// ------------------------------------------------------------------ recording

function record(name, ms, meta) {
    if (!on) return;
    const v = Number(ms);
    if (!Number.isFinite(v)) return;
    let s = stats.get(name);
    if (!s) { s = { n: 0, totalMs: 0, maxMs: 0, lastMs: 0 }; stats.set(name, s); }
    s.n += 1; s.totalMs += v; s.lastMs = v; if (v > s.maxMs) s.maxMs = v;
    const now = Date.now();
    if (name.startsWith('resolve.')) {
        resolveTimes.push(now);
        if (resolveTimes.length > 20000) pruneRate(now);
    }
    const line = { t: now, name, ms: Math.round(v * 1000) / 1000 };
    if (meta && typeof meta === 'object') line.meta = meta;
    lines.push(JSON.stringify(line));
    if (!flushTimer) { flushTimer = setTimeout(flush, FLUSH_MS); if (flushTimer.unref) flushTimer.unref(); }
}

const NOOP_SPAN = Object.freeze({ mark() { }, end() { } });
function nowMs() { return Number(process.hrtime.bigint()) / 1e6; }

// A stage with sub-stages: s.mark('x') records name.x = time since the previous mark (or the start); s.end() the total.
function span(name, meta) {
    if (!on) return NOOP_SPAN;
    const t0 = nowMs();
    let last = t0, ended = false;
    return {
        mark(stage, extra) {
            const t = nowMs();
            record(name + '.' + stage, t - last, extra);
            last = t;
        },
        end(extra) {
            if (ended) return;
            ended = true;
            record(name, nowMs() - t0, (meta || extra) ? Object.assign({}, meta || {}, extra || {}) : undefined);
        }
    };
}

async function timed(name, fn, meta) {
    if (!on) return fn();
    const t0 = nowMs();
    try { return await fn(); } finally { record(name, nowMs() - t0, meta); }
}

// ------------------------------------------------------------------ the Resolve API proxy

const toNative = new WeakMap();   // proxy -> native object
const toProxy = new WeakMap();    // native object -> proxy (one proxy per object, so identity comparisons hold)

function isPlain(v) {
    if (!v || typeof v !== 'object') return false;
    const p = Object.getPrototypeOf(v);
    return p === Object.prototype || p === null;
}

// Arguments go to Resolve as the native objects (DeleteClips([item]), SetClipsLinked([a, b]), AppendToTimeline([{ mediaPoolItem }])).
function unwrap(v) {
    if (!v || typeof v !== 'object') return v;
    const n = toNative.get(v);
    if (n) return n;
    if (Array.isArray(v)) return v.map(unwrap);
    if (isPlain(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = unwrap(v[k]); return o; }
    return v;
}

// Results come back wrapped: API objects directly, and the ones inside lists / dicts (GetItemListInTrack, GetSelectedClips).
function wrapResult(v) {
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(wrapResult);
    if (isPlain(v)) {
        let changed = false; const o = {};
        for (const k of Object.keys(v)) { const w = wrapResult(v[k]); if (w !== v[k]) changed = true; o[k] = w; }
        return changed ? o : v;
    }
    if (typeof v.then === 'function') return v;
    return wrapResolve(v);
}

function wrapResolve(obj) {
    if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return obj;
    if (toNative.has(obj)) return obj;
    const have = toProxy.get(obj);
    if (have) return have;
    const cache = new Map();      // method name -> wrapper, so `typeof it.GetName === 'function'` stays cheap and stable
    const proxy = new Proxy(obj, {
        get(target, prop) {
            const v = target[prop];
            if (typeof v !== 'function' || typeof prop !== 'string' || prop === 'then') return v;
            let fn = cache.get(prop);
            if (fn) return fn;
            const name = 'resolve.' + prop;
            fn = function (...args) {
                const t0 = nowMs();
                const done = (val) => { record(name, nowMs() - t0); return wrapResult(val); };
                let r;
                try { r = Reflect.apply(v, target, unwrap(args)); }
                catch (e) { record(name, nowMs() - t0, { threw: true }); throw e; }
                if (r && typeof r.then === 'function') return r.then(done, (e) => { record(name, nowMs() - t0, { rejected: true }); throw e; });
                return done(r);
            };
            cache.set(prop, fn);
            return fn;
        }
    });
    toProxy.set(obj, proxy);
    toNative.set(proxy, obj);
    return proxy;
}

// ------------------------------------------------------------------ summary and the log file

function pruneRate(now) {
    const cut = now - RATE_WINDOW_MS;
    let i = 0;
    while (i < resolveTimes.length && resolveTimes[i] < cut) i++;
    if (i) resolveTimes = resolveTimes.slice(i);
}

function perfSummary(top) {
    const now = Date.now();
    pruneRate(now);
    const windowS = Math.max(1, Math.min(RATE_WINDOW_MS, now - (since || now)) / 1000);
    const entries = Array.from(stats.entries()).map(([name, s]) => ({
        name, n: s.n,
        totalMs: Math.round(s.totalMs), avgMs: Math.round(s.totalMs / s.n * 100) / 100,
        maxMs: Math.round(s.maxMs * 100) / 100, lastMs: Math.round(s.lastMs * 100) / 100
    })).sort((a, b) => b.totalMs - a.totalMs);
    return {
        enabled: on,
        settings: getPerf(),
        since: since ? new Date(since).toISOString() : null,
        uptimeS: since ? Math.round((now - since) / 1000) : 0,
        resolveCallsPerSec: Math.round(resolveTimes.length / windowS * 10) / 10,
        resolveCallsLastMinute: resolveTimes.length,
        log: LOG_FILE,
        entries: top > 0 ? entries.slice(0, top) : entries
    };
}

function perfReset() {
    stats.clear();
    resolveTimes = [];
    since = on ? Date.now() : 0;
}

function rotateIfNeeded() {
    if (logBytes < 0) {
        try { logBytes = fs.statSync(LOG_FILE).size; } catch (e) { logBytes = 0; }
    }
    if (logBytes > LOG_MAX_BYTES) {
        try { fs.renameSync(LOG_FILE, LOG_FILE + '.1'); } catch (e) { /* ignore */ }
        logBytes = 0;
    }
}

function flush() {
    flushTimer = null;
    if (!lines.length) return;
    const chunk = lines.join('\n') + '\n';
    lines = [];
    try {
        fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
        rotateIfNeeded();
        logBytes += chunk.length;
        fs.appendFile(LOG_FILE, chunk, () => { /* best effort */ });
    } catch (e) { /* ignore */ }
}

// Synchronous: for quitting, when there is no next tick to wait for.
function flushNow() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!lines.length) return;
    const chunk = lines.join('\n') + '\n';
    lines = [];
    try {
        fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
        rotateIfNeeded();
        logBytes += chunk.length;
        fs.appendFileSync(LOG_FILE, chunk);
    } catch (e) { /* ignore */ }
}

module.exports = {
    PERF_DEFAULTS, getPerf, setPerf, perfEnabled,
    record, span, timed, wrapResolve,
    perfSummary, perfReset, perfFlush: flushNow, PERF_LOG_FILE: LOG_FILE
};
