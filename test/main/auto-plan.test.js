// Planning a placement for the automation tools (src/main/auto-plan.js): tags, MultiText split, boxes, sizes, layout.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../helpers/env');

const P = env.main('auto-plan');

const lib = { tags: [{ id: 't1', name: 'Danger', emoji: '❗❌⚠️' }, { id: 't2', name: 'money', emoji: '💰' }] };

test('tags match by id, name, the panel label, the whole emoji string or one of its emoji', () => {
    const t = lib.tags[0];
    for (const k of ['t1', 'danger', '❗❌⚠️ Danger', '❗❌⚠️', '❌', '⚠']) assert.ok(P.tagMatches(t, k), k);
    assert.ok(!P.tagMatches(t, '💰'));
    assert.ok(!P.tagMatches(t, '  '));
    assert.deepEqual(P.resolveTags(lib, ['💰', '❌', 'nope']), { ids: ['t2', 't1'], unknown: ['nope'] });
});

test('a preset passes the allowed tags: any (default) or all', () => {
    const a = { tags: ['t1'] };
    assert.ok(P.passes(a, [], 'any'), 'no tags = everything');
    assert.ok(P.passes(a, ['t1', 't2'], 'any'));
    assert.ok(!P.passes(a, ['t1', 't2'], 'all'));
    assert.ok(!P.passes({}, ['t1'], 'any'));
});

test('MultiText: the default split, and a part without a layer folded into a neighbour', () => {
    assert.deepEqual(P.defaultSplit('so this is it', 'last'), { upper: 'so this is', emphasis: 'it', lower: '' });
    assert.deepEqual(P.defaultSplit('so this is it', 'first'), { upper: '', emphasis: 'so', lower: 'this is it' });
    assert.deepEqual(P.defaultSplit('one two three', 'center'), { upper: 'one', emphasis: 'two', lower: 'three' });
    const nodes = [
        { kind: 'multitext', layer: 1, layerName: 'Upper', cy: 0.6 },
        { kind: 'multitext', layer: 2, layerName: 'Emphasis', cy: 0.5 }
    ];
    assert.deepEqual(P.mtTexts(nodes, { upper: 'so this', emphasis: 'IS', lower: 'it' }), { 1: 'so this it', 2: 'IS' }, 'no lower layer: lower joins upper');
});

test('sizing multiplies Size, caps it at maxSize and sets Line Spacing', () => {
    assert.deepEqual(P.sizedDesign({ size: 0.08 }, { textSize: 1.5 }), { design: { size: 0.12 }, capped: false });
    assert.deepEqual(P.sizedDesign({ size: 0.08 }, { textSize: 2, maxSize: 0.1, lineSpacing: 0.9 }), { design: { size: 0.1, lineSpacing: 0.9 }, capped: true });
    assert.deepEqual(P.sizedDesign(null, null), { design: {}, capped: false });
});

test('boxes: the first Text+ takes the subtitle, others their own mode; a forced font goes on the extra Text+ nodes', () => {
    const nodes = [
        { id: 'A', kind: 'textplus', tool: 'Template', primary: true },
        { id: 'B', kind: 'textplus', tool: 'Text2', design: { size: 0.05, font: 'Old' } }
    ];
    const a = { boxes: { B: { mode: 'l2' } } };
    const out = P.boxListFor(a, nodes, 'line one\nline two', null, { font: { font: 'Poppins', style: 'Bold' } }, { textSize: 2 });
    assert.equal(out[0].text, 'line one\nline two');
    assert.equal(out[0].design, null, 'the primary uses the preset text design');
    assert.equal(out[1].text, 'line two');
    assert.deepEqual([out[1].design.font, out[1].design.style, out[1].design.size], ['Poppins', 'Bold', 0.1]);
    assert.deepEqual(P.boxListFor(a, [{ id: 'N', kind: 'textplus', nested: true }], 'x'), [], 'nested nodes: nothing to set');
});

test('a layout only applies to timelines of its own shape; line estimates for the fit', () => {
    const layout = { aspect: 9 / 16 };
    assert.equal(P.layoutFor(layout, { width: 1080, height: 1920 }), layout);
    assert.equal(P.layoutFor(layout, { width: 1920, height: 1080 }), null);
    assert.deepEqual(P.estimateLines([], false, 'a\nb', null, { size: 0.08 }, 2, 0.1), [{ text: 'a', size: 0.1 }, { text: 'b', size: 0.1 }]);
    assert.equal(P.estimateLines([], false, 'a', null, {}, 1, 0), null, 'size unknown');
    const mt = [
        { kind: 'multitext', layer: 1, layerName: 'Upper', cy: 0.6, size: 0.05 },
        { kind: 'multitext', layer: 2, layerName: 'Emphasis', cy: 0.5, size: 0.1 }
    ];
    assert.deepEqual(P.estimateLines(mt, true, '', { upper: 'top', emphasis: 'BIG' }, null, 1, 0.05),
        [{ text: 'top', size: 0.025 }, { text: 'BIG', size: 0.05 }], 'top to bottom, scaled so the biggest fits maxSize');
});
