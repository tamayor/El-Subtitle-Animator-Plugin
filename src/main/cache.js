// Every main-process file cache in one place: preset files, library.json, edit-rules.json and the like.
//
// A file cache keeps a file's text by its version (size + modification time), so an unchanged file costs one stat and
// a changed one is read again on its own: no TTL, nothing to remember to invalidate after an outside edit. Values
// worked out from the text are kept with that version:
//
//   const presets = fileCache('presets', { max: 200 });
//   presets.text(file)                     the file's text, or null when it cannot be read
//   presets.value(file, 'nodes', make)     make(text) once per file version (make(null) when the file is missing)
//   presets.prime(file, text, values)      after writing the file yourself: the next read is a hit, not a re-read
//   presets.invalidate(file) / clear()     drop one file / all of them
//
// Values are shared between callers: hand out a copy (structuredClone) when a caller may change what it gets.
// Hits, misses and evictions per cache are counted always (a few integer adds) and show up in the perf summary
// (MCP `perf`, Fusion popover > Performance) as `caches`.
//
// A memo cache keeps values that are not files (what Resolve or the Python helper said last), by key, with their age:
//
//   const timing = memoCache('timing', { max: 200 });
//   timing.fresh(key, 1500)     { at, value } when younger than 1.5 s (a hit), else undefined (a miss)
//   timing.entry(key)           { at, value } at any age (e.g. the last reading while Resolve is busy), not counted
//   timing.set(key, value) / delete(key) / clear()
//
// Never cache here: the automation auth token, the live playhead or selection, drag/scrub state, the applying /
// live-session locks. They change without the file changing, or are not files.

module.exports = { cacheStats, clearCaches, fileCache, invalidateCache, memoCache };

const fs = require('fs');

const PERF = require('./perf');

const caches = new Map();          // name -> cache

function fileCache(name, opts) {
    if (caches.has(name)) return caches.get(name);
    const max = Math.max(1, Number(opts && opts.max) || 100);
    const files = new Map();       // path -> { key, text, values: Map }  (Map order = least recently used first)
    const stats = { hits: 0, misses: 0, evictions: 0 };

    function versionOf(file) {
        try { const st = fs.statSync(file); return st.size + ':' + st.mtimeMs; } catch (e) { return null; }
    }
    function remember(file, entry) {
        files.delete(file);
        files.set(file, entry);
        while (files.size > max) { files.delete(files.keys().next().value); stats.evictions++; }
        return entry;
    }
    // The cached entry for the file's current version, read from disk when it changed; null when it cannot be read.
    function entry(file) {
        if (!file) return null;
        const key = versionOf(file);
        if (key === null) { files.delete(file); return null; }
        const have = files.get(file);
        if (have && have.key === key) {
            stats.hits++;
            files.delete(file); files.set(file, have);            // most recently used last
            return have;
        }
        stats.misses++;
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch (e) { files.delete(file); return null; }
        return remember(file, { key, text, values: new Map() });
    }

    const cache = {
        name,
        entry,
        text(file) { const e = entry(file); return e ? e.text : null; },
        value(file, valueName, make) {
            const e = entry(file);
            if (!e) return make(null);
            if (!e.values.has(valueName)) e.values.set(valueName, make(e.text));
            return e.values.get(valueName);
        },
        // values: { name: value } already worked out from `text` (e.g. the object that was just serialised).
        prime(file, text, values) {
            const key = versionOf(file);
            if (key === null) { files.delete(file); return; }
            const e = remember(file, { key, text: String(text), values: new Map() });
            for (const k of Object.keys(values || {})) e.values.set(k, values[k]);
        },
        invalidate(file) { if (file === undefined) files.clear(); else files.delete(file); },
        clear() { files.clear(); },
        stats() { return Object.assign({ size: files.size, max }, stats); }
    };
    caches.set(name, cache);
    return cache;
}

function memoCache(name, opts) {
    if (caches.has(name)) return caches.get(name);
    const max = Math.max(1, Number(opts && opts.max) || 100);
    const map = new Map();          // key -> { at, value }  (Map order = least recently set first)
    const stats = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };
    const cache = {
        name,
        entry(key) { return map.get(key); },
        fresh(key, maxAgeMs) {
            const e = map.get(key);
            if (e && Date.now() - e.at < maxAgeMs) { stats.hits++; return e; }
            stats.misses++;
            return undefined;
        },
        set(key, value) {
            map.delete(key);
            map.set(key, { at: Date.now(), value });
            while (map.size > max) { map.delete(map.keys().next().value); stats.evictions++; }
        },
        delete(key) { if (map.delete(key)) stats.invalidations++; },
        invalidate(key) { if (key === undefined) map.clear(); else cache.delete(key); },
        clear() { map.clear(); },
        stats() { return Object.assign({ size: map.size, max }, stats); }
    };
    caches.set(name, cache);
    return cache;
}

// Drops one file (or every file) from the named cache; unknown names are ignored.
function invalidateCache(name, file) {
    const c = caches.get(name);
    if (c) c.invalidate(file);
}

function clearCaches() {
    for (const c of caches.values()) c.clear();
}

function cacheStats() {
    const out = {};
    for (const [name, c] of caches) out[name] = c.stats();
    return out;
}

PERF.addSummarySource('caches', cacheStats);
