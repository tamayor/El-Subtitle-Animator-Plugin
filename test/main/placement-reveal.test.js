const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../helpers/env');

test('revealLen: a "Follow the reveal" sound lasts until the last word is in, plus its tail', () => {
    const P = env.main('placement');
    assert.equal(P.revealLen({ tail: 5 }, [0, 3, 6, 9], 40, -1, { fps: 25 }), 15);       // last word at 9, +5, starts 1 early
    assert.equal(P.revealLen({}, [0, 2], 40, 0, { fps: 25 }), 7);                         // default tail 5
    // no word frames: the typing length of a clip that long (40 frames at 25 fps -> 15)
    assert.equal(P.revealLen({ tail: 0 }, null, 40, 0, { fps: 25 }), 15);
});

test('pickTrimIn: each placement takes the next start point with room for the sound', () => {
    const P = env.main('placement');
    const l = { file: 'typing-test.mp3', trimStarts: [[3, 34], [7, 10], [50, 49]] };
    assert.equal(P.pickTrimIn(l, 12), 3);
    assert.equal(P.pickTrimIn(l, 12), 50);           // [7, 10] has no room for 12 frames
    assert.equal(P.pickTrimIn(l, 12), 3);            // and round again
    assert.equal(P.pickTrimIn(l, 60), 50);           // nothing long enough: the roomiest
    assert.equal(P.pickTrimIn({ file: 'x', trimIn: 9 }, 12), 9);
});
