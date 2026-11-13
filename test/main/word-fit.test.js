'use strict';
const test = require('node:test');
const assert = require('node:assert');
const WF = require('../../src/main/word-fit');

const spoken = [
    { w: 'So', start: 2, end: 6 },
    { w: 'yeah,', start: 8, end: 14 },
    { w: 'watch', start: 30, end: 40 },      // a pause before it
    { w: 'this', start: 41, end: 50 }
];

test('textWords counts spaces, not line breaks', () => {
    const t = WF.textWords('So yeah,\nwatch this');
    assert.deepStrictEqual(t.words.map(w => [w.w, w.at]), [['So', 0], ['yeah,', 3], ['watch', 8], ['this', 14]]);
    assert.strictEqual(t.letters, 18);
});

test('alignWords matches in order and spreads the unmatched', () => {
    const tw = WF.textWords('So yeah watch THIS now').words;
    const al = WF.alignWords(tw, spoken);
    assert.strictEqual(al.matched, 4);
    assert.deepStrictEqual(al.times.slice(0, 4).map(t => t.start), [2, 8, 30, 41]);
    assert.ok(al.times[4].start >= 41);
});

test('planAnimKeys: each word starts its first letter when it is said', () => {
    const term = { a: 16, delay: 0.5, text: 'So yeah, watch this' };
    const p = WF.planAnimKeys(term, spoken, 100);
    const at = (f) => { const k = p.keys.find(x => x[0] === f); return k && k[1]; };
    assert.strictEqual(at(2), 0);            // "So" letter 0
    assert.strictEqual(at(8), 1.5);          // "yeah," letter 3
    assert.strictEqual(at(30), 4.5);         // "watch" letter 9
    assert.strictEqual(at(41), 7.5);         // "this" letter 15
    // the last letter (18) lands over the last word, then normal speed to the clip end
    const last = p.keys[p.keys.length - 1];
    assert.strictEqual(last[0], 100);
    for (let i = 1; i < p.keys.length; i++) assert.ok(p.keys[i][0] > p.keys[i - 1][0] && p.keys[i][1] >= p.keys[i - 1][1]);
    const sp = WF.speedRange(p.keys);
    assert.ok(sp.slowest < sp.fastest);      // the pause before "watch" plays slower than "So yeah"
});

test('planRows times each row from its words', () => {
    const p = WF.planRows([{ key: '1', text: 'So yeah,' }, { key: '2', text: 'watch this' }], spoken, 60);
    assert.deepStrictEqual(p.ranges, [{ key: '1', start: 2, end: 14 }, { key: '2', start: 30, end: 50 }]);
});

test('planLinear: typing ends where the last word is said', () => {
    assert.deepStrictEqual(WF.planLinear('typing', spoken, 60), { start: 2, end: 41 });
    assert.deepStrictEqual(WF.planLinear('anim', spoken, 60), { start: 2, end: 50 });
});

test('planStepKeys: each Justified Pop word / Kinetic row pops on its first spoken word', () => {
    const units = [{ text: 'So', own: 0 }, { text: 'yeah,', own: 6 }, { text: 'watch this', own: 12 }];
    const p = WF.planStepKeys(units, spoken, 80, 6);
    assert.deepStrictEqual(p.keys.slice(0, 3), [[2, 0], [8, 6], [30, 12]]);
    assert.deepStrictEqual(p.keys[3], [80, 62]);           // normal speed after the last row
    assert.strictEqual(p.start, 2);
    assert.strictEqual(p.end, 36);
});

test('planTypingKeys: the text grows one word at a time as it is said', () => {
    const p = WF.planTypingKeys('So yeah, watch this', spoken, 60);
    assert.deepStrictEqual(p.frames, [2, 8, 30, 41]);
    const at = (f) => { let v = 0; for (const k of p.keys) if (k[0] <= f) v = k[1]; return v; };
    assert.strictEqual(at(1), 0);                          // nothing before the first word
    assert.strictEqual(at(3), 0.1053);                   // "So"
    assert.strictEqual(at(10), Math.round(8 / 19 * 1e4) / 1e4);   // "So yeah,"
    assert.strictEqual(at(45), 1);
});

test('wordSegsFromInfo and planFromWordSegs round-trip animtime, step, and typing', () => {
    // animtime
    const animInfo = { kind: 'anim', target: 'animtime', terms: [{ a: 16, delay: 0.5, text: 'So yeah, watch this' }] };
    const animInit = WF.wordSegsFromInfo(animInfo, spoken, 100);
    assert.strictEqual(animInit.editable, true);
    assert.deepStrictEqual(animInit.segs.map(g => g.label), ['So', 'yeah,', 'watch', 'this']);
    assert.deepStrictEqual(animInit.segs.map(g => g.s), [2, 8, 30, 41]);
    const editedAnim = animInit.segs.map((g, idx) => idx === 1 ? { ...g, s: 10, e: 16 } : g);
    const animPlan = WF.planFromWordSegs(animInfo, editedAnim, 100);
    const animBack = WF.wordSegsFromInfo({ ...animInfo, fitted: true, keys: animPlan.keys }, [], 100);
    assert.deepStrictEqual(animBack.segs.map(g => g.s), [2, 10, 30, 41]);

    // step
    const stepInfo = { kind: 'anim', target: 'step', units: [{ text: 'So', own: 0 }, { text: 'yeah,', own: 6 }, { text: 'watch this', own: 12 }], pop: 6 };
    const stepInit = WF.wordSegsFromInfo(stepInfo, spoken, 80);
    assert.strictEqual(stepInit.editable, true);
    assert.deepStrictEqual(stepInit.segs.map(g => g.s), [2, 8, 30]);
    const stepPlan = WF.planFromWordSegs(stepInfo, [{ s: 4, e: 12 }, { s: 12, e: 25 }, { s: 25, e: 31 }], 80);
    const stepBack = WF.wordSegsFromInfo({ ...stepInfo, fitted: true, keys: stepPlan.keys }, [], 80);
    assert.deepStrictEqual(stepBack.segs.map(g => g.s), [4, 12, 25]);

    // typing
    const typInfo = { kind: 'typing', target: 'typing', text: 'So yeah, watch this' };
    const typInit = WF.wordSegsFromInfo(typInfo, spoken, 60);
    assert.strictEqual(typInit.editable, true);
    assert.deepStrictEqual(typInit.segs.map(g => g.s), [2, 8, 30, 41]);
    const typPlan = WF.planFromWordSegs(typInfo, [{ s: 3, e: 9 }, { s: 9, e: 28 }, { s: 28, e: 40 }, { s: 40, e: 46 }], 60);
    const typBack = WF.wordSegsFromInfo({ ...typInfo, fitted: true, frames: typPlan.frames }, [], 60);
    assert.deepStrictEqual(typBack.segs.map(g => g.s), [3, 9, 28, 40]);
});
