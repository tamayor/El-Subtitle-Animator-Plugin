// Sound layers, the pure part (src/renderer/js/components/sound-layers/geometry.js): where an extra sound plays.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPanelScripts } = require('../helpers/renderer');

const S = loadPanelScripts(['components/sound-layers/geometry.js']);
const g = { fps: 25, textS: 10, textE: 60 };          // text clip from frame 10 to 60
const wave2s = { seconds: 2 };                         // a 2 s sound = 50 frames

test('a fixed sound at the text start plays its trimmed length, with a 1 s fade', () => {
    const q = S.slGeometry({ align: 'start', offset: 5, trimIn: 10, len: 0, lenMode: 'fixed' }, g, [], wave2s, '/a.wav');
    assert.equal(q.full, 50);
    assert.equal(q.start, 15);
    assert.equal(q.len, 40, 'the rest of the sound after the trim');
    assert.equal(q.end, 55);
    assert.equal(q.fade, 25);
    assert.equal(q.auto, false);
    assert.equal(q.path, '/a.wav');
});

test("a 'clip' sound ends with the text; 'end' / 'after' anchors count from the text end", () => {
    const clip = S.slGeometry({ align: 'start', offset: 0, lenMode: 'clip' }, g, [], { seconds: 10 }, null);
    assert.deepEqual([clip.start, clip.len, clip.auto], [10, 50, true]);
    const end = S.slGeometry({ align: 'end', offset: 0, len: 20, lenMode: 'fixed' }, g, [], wave2s, null);
    assert.deepEqual([end.start, end.end], [40, 60], 'ends where the text ends');
    const after = S.slGeometry({ align: 'after', offset: 3, len: 10, lenMode: 'fixed' }, g, [], wave2s, null);
    assert.equal(after.start, 63);
    assert.equal(S.slLenModeOf({ len: 12 }), 'fixed', 'older sounds with a set length are fixed');
    assert.equal(S.slLenModeOf({}), 'clip');
});

test("a row sound ('seg') counts from its row's start; while the wave loads 0.5 s is assumed", () => {
    const segs = [{ n: 1, start: 0 }, { n: 2, start: 8 }];
    const q = S.slGeometry({ align: 'seg', seg: 2, offset: 1, lenMode: 'fixed' }, g, segs, null, null);
    assert.equal(q.base, 18);
    assert.equal(q.start, 19);
    assert.equal(q.full, 13, '0.5 s at 25 fps');
});

test('dragging writes the new place back as an offset that reproduces it', () => {
    for (const align of ['start', 'end', 'after']) {
        const l = { align, offset: 0, trimIn: 0, len: 20, lenMode: 'fixed' };
        const q = Object.assign(S.slGeometry(l, g, [], wave2s, null), { align });
        S.slApply(l, 30, 20, 4, q, false);
        const again = S.slGeometry(l, g, [], wave2s, null);
        assert.equal(again.start, 30, align + ': same start');
        assert.equal(l.trimIn, 4);
    }
    const l = { align: 'start', offset: 0, lenMode: 'clip' };
    S.slApply(l, 5000, 10, 0, Object.assign(S.slGeometry(l, g, [], wave2s, null), { align: 'start' }), true);
    assert.equal(l.offset, 900, 'offset clamped to ±900');
    assert.deepEqual([l.len, l.lenMode], [10, 'fixed'], 'a given length makes it fixed');
});
