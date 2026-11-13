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

test('planTypingKeys: each word types in from when it starts to be said to when it is said', () => {
    const p = WF.planTypingKeys('So yeah, watch this', spoken, 60);
    assert.deepStrictEqual(p.frames, [2, 8, 30, 41]);
    assert.deepStrictEqual(p.ends, [6, 14, 40, 50]);
    const at = (f) => {                                  // linear between keys, held outside
        const k = p.keys;
        if (f <= k[0][0]) return k[0][1];
        for (let i = 1; i < k.length; i++) if (f <= k[i][0]) return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * (f - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
        return k[k.length - 1][1];
    };
    assert.strictEqual(at(1), 0);                          // nothing before the first word
    assert.ok(at(4) > 0 && at(4) < 0.1053);              // "So" typing in
    assert.strictEqual(at(6), 0.1053);                   // "So" done
    assert.strictEqual(at(20), Math.round(8 / 19 * 1e4) / 1e4);   // "So yeah," held through the pause
    assert.strictEqual(at(50), 1);
    assert.strictEqual(p.end, 50);
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

test('every word has its own adjustable out (step with room to pop, typing)', () => {
    // Justified Pop style: Step 8 > Pop 6, so each word's pop can land on its own out and then hold
    const stepInfo = { kind: 'anim', target: 'step', units: [{ text: 'At', own: 0 }, { text: 'SIC,', own: 8 }, { text: 'we', own: 16 }], pop: 6 };
    const edited = [{ s: 2, e: 5 }, { s: 12, e: 20 }, { s: 30, e: 33 }];
    const plan = WF.planFromWordSegs(stepInfo, edited, 60);
    const back = WF.wordSegsFromInfo({ ...stepInfo, fitted: true, keys: plan.keys }, [], 60);
    assert.deepStrictEqual(back.segs.map(g => [g.s, g.e]), [[2, 5], [12, 20], [30, 33]]);
    assert.ok(back.segs.every(g => !g.fixedEnd));
    assert.strictEqual(plan.end, 33);

    // Kinetic Cloud style: rows pop into the next one (Step 6 <= Pop 8): the out follows the next in
    const cloud = { ...stepInfo, units: stepInfo.units.map((u, k) => ({ ...u, own: k * 6 })), pop: 8 };
    const cb = WF.wordSegsFromInfo({ ...cloud, fitted: true, keys: WF.planFromWordSegs(cloud, edited, 60).keys }, [], 60);
    assert.deepStrictEqual(cb.segs.map(g => !!g.fixedEnd), [true, true, false]);

    // typing: out = fully typed
    const typInfo = { kind: 'typing', target: 'typing', text: 'At SIC, we believe' };
    const typSegs = [{ s: 0, e: 4 }, { s: 6, e: 14 }, { s: 20, e: 21 }, { s: 25, e: 37 }];
    const typPlan = WF.planFromWordSegs(typInfo, typSegs, 40);
    const typBack = WF.wordSegsFromInfo({ ...typInfo, fitted: true, frames: typPlan.frames, keys: typPlan.keys }, [], 40);
    assert.deepStrictEqual(typBack.segs.map(g => [g.s, g.e]), typSegs.map(g => [g.s, g.e]));
    assert.strictEqual(typPlan.end, 37);
});
