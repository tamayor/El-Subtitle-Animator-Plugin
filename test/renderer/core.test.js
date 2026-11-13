// The panel's shared core helpers (src/renderer/js/core): colour conversion, storage, throttled sends.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPanelScripts, fakeLocalStorage } = require('../helpers/renderer');

// vm-context arrays have another Array prototype: compare as plain JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('color: hex <-> 0..1 RGB, as Fusion and colour inputs need it', () => {
    const c = loadPanelScripts(['core/color.js']);
    assert.equal(c.normHex(' F0A '), '#ff00aa');
    assert.equal(c.normHex('#12345'), null);
    assert.deepEqual(plain(c.hexToRgb('#ff0000')), [1, 0, 0]);
    assert.deepEqual(plain(c.hexToRgb('#808080', 3)), [0.502, 0.502, 0.502]);
    assert.equal(c.hexToRgb('nope'), null);
    assert.equal(c.rgbToHex(1, 0.5, 0), '#ff8000');
    assert.equal(c.rgbToHex([2, -1, 0.5]), '#ff0080', 'clamped, array form');
    assert.equal(c.rgbToHex([1, 0, 0, 1]), '#ff0000', 'an alpha channel is not part of the hex');
    assert.equal(c.rgbToHex('x', null, undefined), '#000000');
    assert.deepEqual(plain(c.hexToRgb01('nope')), { r: 1, g: 1, b: 1 });
    assert.equal(c.rgb01ToHex(0, 0, 1), '#0000ff');
    for (const h of ['#000000', '#ffffff', '#8ccf8e', '#f07b8e']) assert.equal(c.rgbToHex(c.hexToRgb(h)), h, 'round trip ' + h);
});

test('storage: strings, JSON and flags with fallbacks', () => {
    const ls = fakeLocalStorage();
    const { store } = loadPanelScripts(['core/storage.js'], { localStorage: ls });
    assert.equal(store.get('a'), null);
    assert.equal(store.get('a', 'dflt'), 'dflt');
    assert.equal(store.set('a', 5), true);
    assert.equal(store.get('a'), '5');
    store.setJSON('j', { x: [1, 2] });
    assert.deepEqual(plain(store.getJSON('j')), { x: [1, 2] });
    ls.setItem('bad', '{oops');
    assert.deepEqual(plain(store.getJSON('bad', [])), []);
    assert.equal(store.flag('f'), false);
    assert.equal(store.flag('f', true), true);
    store.setFlag('f', true);
    assert.equal(ls.getItem('f'), '1');
    assert.equal(store.flag('f'), true);
    store.remove('f');
    assert.equal(store.get('f'), null);
});

test('storage: blocked localStorage never throws, reads give the fallback', () => {
    const { store } = loadPanelScripts(['core/storage.js'], { localStorage: fakeLocalStorage(true) });
    assert.equal(store.get('a', 'x'), 'x');
    assert.equal(store.set('a', 'b'), false);
    assert.deepEqual(plain(store.getJSON('a', {})), {});
    assert.equal(store.flag('a', true), true);
    assert.equal(store.remove('a'), false);
});

test('throttled sender: changes are merged and sent at most every ms', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const ctx = loadPanelScripts(['core/ipc-queue.js'], { setTimeout, clearTimeout, Date });
    const sent = [];
    const s = ctx.createThrottledSender((v) => { sent.push(plain(v)); }, { ms: 100 });
    s.push({ a: 1 });
    s.push({ b: 2 });
    assert.equal(s.waiting, true);
    t.mock.timers.tick(0);
    assert.deepEqual(sent, [{ a: 1, b: 2 }], 'first send goes out at once (nothing sent for >= ms)');
    s.push({ a: 3 });
    t.mock.timers.tick(50);
    assert.equal(sent.length, 1, 'the next waits for the rest of the interval');
    s.push({ c: 4 });
    t.mock.timers.tick(50);
    assert.deepEqual(sent[1], { a: 3, c: 4 });
    s.push({ z: 1 });
    s.cancel();
    t.mock.timers.tick(500);
    assert.equal(sent.length, 2, 'cancel drops what was waiting');
    s.push({ n: 1 }, true);
    assert.deepEqual(sent[2], { n: 1 }, 'now = send at once');
    assert.equal(s.sentAt, Date.now());
});

test('debounced sender: sends ms after the last change; scalars are replaced, flush sends now', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const ctx = loadPanelScripts(['core/ipc-queue.js'], { setTimeout, clearTimeout, Date });
    const sent = [];
    const s = ctx.createThrottledSender((v) => { sent.push(v); return 'r' + v; }, { ms: 150, mode: 'debounce' });
    s.push(10); t.mock.timers.tick(100);
    s.push(20); t.mock.timers.tick(100);
    assert.deepEqual(sent, []);
    t.mock.timers.tick(50);
    assert.deepEqual(sent, [20]);
    s.push(30);
    assert.equal(s.flush(), 'r30', 'flush returns what send returned');
    assert.equal(s.flush(), undefined, 'nothing waiting');
    assert.deepEqual(sent, [20, 30]);
});
