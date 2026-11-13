// Animation timing bar, the pure part (src/renderer/js/timeline/anim-timing/math.js): range edits and snapping.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPanelScripts } = require('../helpers/renderer');

const M = loadPanelScripts(['timeline/anim-timing/math.js']);
const plain = (v) => JSON.parse(JSON.stringify(v));

test('a range edit stays inside the clip and keeps at least one frame', () => {
    const r = { start: 10, end: 30 };
    M.tmApply(r, 's', 40, 100); assert.deepEqual(plain(r), { start: 29, end: 30 });
    M.tmApply(r, 'e', 500, 100); assert.deepEqual(plain(r), { start: 29, end: 100 });
    M.tmApply(r, 'm', 90, 100); assert.deepEqual(plain(r), { start: 29, end: 100 }, 'a move keeps the length and stops at the end');
    const q = { start: 10, end: 20 };
    M.tmApply(q, 'm', -5.4, 100); assert.deepEqual(plain(q), { start: 0, end: 10 });
});

test('the pointer snaps to the playhead, its own default and other lanes within the magnet radius', () => {
    const info = { length: 100, playhead: 50, ranges: [
        { start: 10, end: 30, defStart: 12, defEnd: 30, hasStart: true },
        { start: 40, end: 70, defStart: 40, defEnd: 70, hasStart: true }
    ] };
    // 1000 px wide: 10 px per frame, magnet 12 px = 1 frame
    assert.deepEqual(plain(M.tmSnapFrame(495, 1000, info, 0, 'e', 0, 12)), { frame: 50, snap: 'playhead' });
    assert.deepEqual(plain(M.tmSnapFrame(125, 1000, info, 0, 's', 0, 12)), { frame: 12, snap: 'default' });
    assert.deepEqual(plain(M.tmSnapFrame(405, 1000, info, 0, 'e', 0, 12)), { frame: 40, snap: 'lane' });
    assert.deepEqual(plain(M.tmSnapFrame(250, 1000, info, 0, 'e', 0, 12)), { frame: 25, snap: null }, 'nothing near');
});

test('a move snaps by its end too', () => {
    const info = { length: 100, playhead: null, ranges: [
        { start: 10, end: 30, defStart: 10, defEnd: 30, hasStart: true },
        { start: 60, end: 80, defStart: 60, defEnd: 80, hasStart: false }
    ] };
    // grabbed 5 frames into the range: pointer at frame 46 = start 41, end 61 (60 is lane 2's start, but it has no start head)
    const r = M.tmSnapFrame(460, 1000, info, 0, 'm', 5, 12);
    assert.deepEqual(plain(r), { frame: 41, snap: null }, "lane 2 has no start head, so 60 is no magnet");
    const r2 = M.tmSnapFrame(645, 1000, info, 0, 'm', 5, 12);
    assert.deepEqual(plain(r2), { frame: 60, snap: 'lane' }, 'end 80 lands on lane 2 end 80');
});
