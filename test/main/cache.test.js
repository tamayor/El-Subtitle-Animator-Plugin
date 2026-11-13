// The shared file caches (src/main/cache.js) and the modules that read through them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const env = require('../helpers/env');

const C = env.main('cache');
const PERF = env.main('perf');

let n = 0;
function tmpFile(text) {
    const f = path.join(env.DATA_DIR, 'cache-test-' + (n++) + '.txt');
    fs.writeFileSync(f, text);
    return f;
}
// A new version of the file: other content and a later modification time, so the size+mtime key always changes.
function rewrite(f, text) {
    fs.writeFileSync(f, text);
    const t = new Date(Date.now() + 5000 * (++n));
    fs.utimesSync(f, t, t);
}

test('an unchanged file is read once; values are worked out once per version', () => {
    const c = C.fileCache('t-basic');
    const f = tmpFile('one');
    let made = 0;
    const make = (s) => { made++; return s.toUpperCase(); };
    assert.equal(c.text(f), 'one');
    assert.equal(c.value(f, 'up', make), 'ONE');
    assert.equal(c.value(f, 'up', make), 'ONE');
    assert.equal(made, 1);
    const st = c.stats();
    assert.equal(st.misses, 1);
    assert.equal(st.hits, 2);
});

test('a changed file is read again and its values worked out again', () => {
    const c = C.fileCache('t-change');
    const f = tmpFile('old');
    assert.equal(c.value(f, 'v', s => s + '!'), 'old!');
    rewrite(f, 'newer');
    assert.equal(c.text(f), 'newer');
    assert.equal(c.value(f, 'v', s => s + '!'), 'newer!');
    assert.equal(c.stats().misses, 2);
});

test('a missing file gives null text and make(null)', () => {
    const c = C.fileCache('t-missing');
    const f = path.join(env.DATA_DIR, 'nope-' + Date.now());
    assert.equal(c.text(f), null);
    assert.equal(c.entry(f), null);
    assert.equal(c.value(f, 'v', s => s === null ? 'none' : 'some'), 'none');
});

test('prime after a write: the next read is a hit with the values handed in', () => {
    const c = C.fileCache('t-prime');
    const f = tmpFile('a');
    c.text(f);
    rewrite(f, '{"x":1}');
    c.prime(f, '{"x":1}', { parsed: { x: 1 } });
    let made = 0;
    assert.deepEqual(c.value(f, 'parsed', () => { made++; return null; }), { x: 1 });
    assert.equal(made, 0);
    assert.equal(c.stats().misses, 1);
});

test('the least recently used file is dropped past max, and invalidate drops one file', () => {
    const c = C.fileCache('t-lru', { max: 2 });
    const a = tmpFile('a'), b = tmpFile('b'), d = tmpFile('d');
    c.text(a); c.text(b);
    c.text(a);                // a is now the most recently used
    c.text(d);                // b goes
    assert.equal(c.stats().evictions, 1);
    assert.equal(c.stats().size, 2);
    const before = c.stats().misses;
    c.text(a);
    assert.equal(c.stats().misses, before, 'a was kept');
    c.text(b);
    assert.equal(c.stats().misses, before + 1, 'b was read again');
    C.invalidateCache('t-lru', a);
    c.text(a);
    assert.equal(c.stats().misses, before + 2);
});

test('the same name gives the same cache; its counters are in the perf summary', () => {
    assert.equal(C.fileCache('t-basic'), C.fileCache('t-basic'));
    const s = PERF.perfSummary(1);
    assert.ok(s.caches && s.caches['t-basic'], 'perf summary lists the caches');
    assert.equal(typeof s.caches['t-basic'].hits, 'number');
});

test('loadRules follows edits to edit-rules.json, from saveRules and from outside', () => {
    const R = env.main('edit-rules');
    const saved = R.saveRules(Object.assign(R.defaultRules(), { notes: 'first' }));
    assert.equal(saved.notes, 'first');
    assert.equal(R.loadRules().notes, 'first');
    const r = R.loadRules(); r.notes = 'changed by a caller';
    assert.equal(R.loadRules().notes, 'first', 'callers get their own copy');
    const onDisk = JSON.parse(fs.readFileSync(R.RULES_FILE, 'utf8'));
    onDisk.notes = 'edited outside';
    rewrite(R.RULES_FILE, JSON.stringify(onDisk));
    assert.equal(R.loadRules().notes, 'edited outside');
    rewrite(R.RULES_FILE, '{ not json');
    assert.deepEqual(R.loadRules(), R.defaultRules());
    fs.rmSync(R.RULES_FILE, { force: true });
});

test('loadLib hands every caller its own copy and sees saveLib at once', () => {
    const L = env.main('library');
    const lib = L.loadLib();
    lib.defaultSfx = 'cache-test.wav';
    L.saveLib(lib);
    const a = L.loadLib(), b = L.loadLib();
    assert.equal(a.defaultSfx, 'cache-test.wav');
    a.defaultSfx = 'changed';
    assert.equal(b.defaultSfx, 'cache-test.wav');
    assert.equal(L.loadLib().defaultSfx, 'cache-test.wav');
});

test('memo cache: fresh within the age (hit), the last value at any age, delete / LRU counted', (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    const m = C.memoCache('t-memo', { max: 2 });
    m.set('a', 1);
    assert.equal(m.fresh('a', 1000).value, 1);
    t.mock.timers.tick(2000);
    assert.equal(m.fresh('a', 1000), undefined, 'too old');
    assert.equal(m.entry('a').value, 1, 'still there for "Resolve busy: use the last reading"');
    m.set('b', 2); m.set('c', 3);
    assert.equal(m.entry('a'), undefined, 'least recently set dropped past max');
    m.delete('b'); m.delete('nope');
    assert.deepEqual(m.stats(), { size: 1, max: 2, hits: 1, misses: 1, evictions: 1, invalidations: 1 });
    assert.equal(C.memoCache('t-memo'), m);
    assert.ok(PERF.perfSummary(1).caches['t-memo']);
});
