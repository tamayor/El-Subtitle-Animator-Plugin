const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../helpers/env');

const { regroup, wordKey } = env.main('regroup');

const SUBS = [
    { index: 1, text: 'If this is the bar then it\'s', start: 0, end: 70 },
    { index: 2, text: 'fine, but the bar is this.', start: 70, end: 130 }
];

test('wordKey compares words without case or punctuation', () => {
    assert.equal(wordKey('Fine,'), 'fine');
    assert.equal(wordKey('it\'s'), 'its');
    assert.equal(wordKey('…'), '');
});

test('regroup re-splits a mid-thought cut and keeps the phrases back to back', () => {
    const out = regroup(SUBS, ['If this is the bar then', 'it\'s fine, but the bar is this.']);
    assert.equal(out.length, 2);
    assert.equal(out[0].startFrame, 0);
    assert.equal(out[1].endFrame, 130);
    assert.equal(out[0].endFrame, out[1].startFrame);
    assert.ok(out[0].endFrame > 0 && out[0].endFrame < 70, 'the first phrase ends inside subtitle 1');
    assert.deepEqual(out[0].subtitles, [1]);
    assert.deepEqual(out[1].subtitles, [1, 2]);
    for (const p of out) assert.equal(p.frames, p.endFrame - p.startFrame);
});

test('regroup keeps the subtitles\' own times when the phrases are the subtitles', () => {
    const out = regroup(SUBS, SUBS.map(s => s.text));
    assert.deepEqual(out.map(p => [p.startFrame, p.endFrame]), [[0, 70], [70, 130]]);
});

test('regroup refuses phrases that do not spell the subtitles', () => {
    assert.throws(() => regroup(SUBS, ['If this is a bar then']), /does not follow the subtitles/);
    assert.throws(() => regroup(SUBS, ['If this is the bar then']), /leave out the subtitles' last words/);
    assert.throws(() => regroup([], ['x']), /Give the subtitles/);
    assert.throws(() => regroup(SUBS, []), /Give the phrases/);
    assert.throws(() => regroup(SUBS, ['...']), /Phrase 1 is empty/);
});

test('regroup moves a cut onto a measured pause', () => {
    const subs = [{ index: 1, text: 'If this is the bar then it\'s', start: 0, end: 50 }, { index: 2, text: 'fine, but the bar is this.', start: 50, end: 100 }];
    const plain = regroup(subs, ['If this is the bar then', 'it\'s fine, but the bar is this.']);
    const cut = plain[0].endFrame;
    const snapped = regroup(subs, ['If this is the bar then', 'it\'s fine, but the bar is this.'], { pauses: [{ start: cut - 6, end: cut - 2, mid: cut - 4 }] });
    assert.equal(snapped[0].endFrame, cut - 4, 'the cut sits in the pause');
    assert.equal(snapped[1].startFrame, cut - 4);
    assert.equal(snapped[0].snapped, 'pause');
    const far = regroup(subs, ['If this is the bar then', 'it\'s fine, but the bar is this.'], { pauses: [{ start: 2, end: 4, mid: 3 }] });
    assert.equal(far[0].endFrame, cut, 'a pause too far away is ignored');
});
