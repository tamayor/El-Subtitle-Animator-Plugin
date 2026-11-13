// Text boxes, the pure part (src/renderer/js/components/text-boxes/split.js): box text and the MultiText split.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPanelScripts } = require('../helpers/renderer');

const plain = (v) => JSON.parse(JSON.stringify(v));
const T = loadPanelScripts(['components/text-boxes/split.js']);

test('a box shows the subtitle, one of its lines, custom text, or keeps the preset text', () => {
    const sub = 'first line\nsecond line';
    assert.equal(T.tbResolveText({ mode: 'sub' }, sub), sub);
    assert.equal(T.tbResolveText({ mode: 'l2' }, sub), 'second line');
    assert.equal(T.tbResolveText({ mode: 'l3' }, sub), '');
    assert.equal(T.tbResolveText({ mode: 'custom', text: 'Hi' }, sub), 'Hi');
    assert.equal(T.tbResolveText({ mode: 'keep' }, sub), null);
});

test('roles come from layer names first, then size and height', () => {
    assert.deepEqual(plain(T.tbAutoRoles([
        { layer: 1, layerName: 'Top line', cy: 0.6 }, { layer: 2, layerName: 'Keyword', cy: 0.5 }, { layer: 3, layerName: 'Bottom', cy: 0.4 }
    ])), { upper: 1, emphasis: 2, lower: 3 });
    assert.deepEqual(plain(T.tbAutoRoles([
        { layer: 1, size: 0.05, cy: 0.6 }, { layer: 2, size: 0.12, cy: 0.5 }, { layer: 3, size: 0.05, cy: 0.4 }
    ])), { upper: 1, emphasis: 2, lower: 3 }, 'unnamed: biggest = emphasis, higher = upper');
    assert.deepEqual(plain(T.tbAutoRoles([{ layer: 4, size: 0.1, cy: 0.5 }])), { upper: null, emphasis: 4, lower: null });
});

test('the emphasis range follows the anchor, for any subtitle length', () => {
    assert.deepEqual(plain(T.tbEmphasisRange(5, { anchor: 'first', count: 2 })), [0, 2]);
    assert.deepEqual(plain(T.tbEmphasisRange(5, { anchor: 'center', count: 1 })), [2, 3]);
    assert.deepEqual(plain(T.tbEmphasisRange(5, { anchor: 'last', count: 2 })), [3, 5]);
    assert.deepEqual(plain(T.tbEmphasisRange(5, { anchor: 'index', start: 9, count: 3 })), [4, 5], 'clamped to the words there are');
    assert.deepEqual(plain(T.tbEmphasisRange(2, { anchor: 'first', count: 7 })), [0, 2]);
});

test('a chosen range is remembered as an anchor that carries over', () => {
    const c = { anchor: 'center', count: 1 };
    T.tbSetRange(6, 4, 6, c); assert.equal(c.anchor, 'last'); assert.equal(c.count, 2);
    T.tbSetRange(6, 0, 1, c); assert.equal(c.anchor, 'first');
    T.tbSetRange(5, 2, 3, c); assert.equal(c.anchor, 'center');
    T.tbSetRange(6, 1, 3, c); assert.deepEqual([c.anchor, c.start, c.count], ['index', 1, 2]);
    assert.deepEqual(plain(T.tbEmphasisRange(6, c)), [1, 3], 'round trip');
});

test('split: upper / emphasis / lower spell the subtitle; a role without a layer is folded into a neighbour', () => {
    const p = T.tbSplit('so this is\nthe big one', { anchor: 'index', start: 3, count: 2 });
    assert.deepEqual([p.upper, p.emphasis, p.lower], ['so this is', 'the big', 'one']);
    assert.deepEqual(plain(p.roles), ['upper', 'upper', 'upper', 'emphasis', 'emphasis', 'lower']);
    assert.deepEqual(plain(T.tbSplit('', { anchor: 'first', count: 1 })), { upper: '', emphasis: '', lower: '', words: [], roles: [] });
    const parts = { upper: 'so this is', emphasis: 'the big', lower: 'one' };
    assert.deepEqual(plain(T.tbFold({ upper: 1, emphasis: 2, lower: null }, parts)), { upper: 'so this is one', emphasis: 'the big', lower: '' });
    assert.deepEqual(plain(T.tbFold({ upper: null, emphasis: 2, lower: null }, parts)), { upper: '', emphasis: 'so this is the big one', lower: '' });
});
