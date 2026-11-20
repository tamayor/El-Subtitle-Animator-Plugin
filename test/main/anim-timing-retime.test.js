// MCP set_timing, the pure part (src/main/anim-timing.js retimeRanges): where a clip's reveal ranges go.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../helpers/env');

const T = env.main('anim-timing');

test('one range ends one second before the cut (holdEnd 25 on a 60-frame clip -> end 35)', () => {
    const got = T.retimeRanges([{ key: 'anim', start: 0, end: 20 }], 60, { end: 35 });
    assert.deepEqual(got, [{ key: 'anim', start: 0, end: 35 }]);
});

test('a short clip keeps at least minReveal frames of reveal and never runs past the clip', () => {
    assert.deepEqual(T.retimeRanges([{ key: 'anim', start: 0, end: 20 }], 30, { end: 5, minReveal: 10 }), [{ key: 'anim', start: 0, end: 10 }]);
    assert.deepEqual(T.retimeRanges([{ key: 'anim', start: 0, end: 20 }], 8, { end: 5, minReveal: 10 }), [{ key: 'anim', start: 0, end: 8 }]);
});

test('MultiText rows keep their order and proportions, scaled into start..end', () => {
    const got = T.retimeRanges([{ key: '3', start: 0, end: 10 }, { key: '1', start: 10, end: 30 }], 80, { end: 60 });
    assert.deepEqual(got, [{ key: '3', start: 0, end: 20 }, { key: '1', start: 20, end: 60 }]);
});

test('a given start moves the reveal; no ranges -> nothing to set', () => {
    assert.deepEqual(T.retimeRanges([{ key: 'typing', start: 0, end: 10 }], 50, { start: 5, end: 25 }), [{ key: 'typing', start: 5, end: 25 }]);
    assert.deepEqual(T.retimeRanges([], 50, { end: 25 }), []);
});

test('earlyWords: every word lead frames early, and squeezed so the last is in holdEnd frames before the cut', () => {
    const w = [{ w: 'a', start: 0, end: 10 }, { w: 'b', start: 10, end: 40 }];
    assert.deepEqual(T.earlyWords(w, 60, {}), w, 'no options = as spoken');
    assert.deepEqual(T.earlyWords(w, 60, { lead: 4 }).map(x => [x.start, x.end]), [[0, 6], [6, 36]]);
    // last word ends at 40, must be in by 60 - 25 = 35 -> times x 35/40
    const got = T.earlyWords(w, 60, { holdEnd: 25 }).map(x => [x.start, x.end]);
    assert.deepEqual(got, [[0, 8.75], [8.75, 35]]);
    assert.deepEqual(T.earlyWords(w, 80, { holdEnd: 25 }).map(x => x.end), [10, 40], 'already early enough: untouched');
});
