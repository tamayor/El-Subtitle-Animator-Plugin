const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../helpers/env');
const { makeItem } = require('../helpers/fake-resolve');

const S = env.main('sfx-level');
const L = env.main('resolve-load');

test('clampToWindow pulls a sound\'s peak into the -20..-15 dBFS window', () => {
    assert.equal(S.PEAK_LO, -20);
    assert.equal(S.PEAK_HI, -15);
    assert.equal(S.clampToWindow(0, -3), -12, 'too loud: turned down to peak at -15');
    assert.equal(S.clampToWindow(0, -30), 10, 'too quiet: turned up to peak at -20');
    assert.equal(S.clampToWindow(-14.5, -3), -14.5, 'already inside: left alone');
    assert.equal(S.clampToWindow(-6, null), -6, 'no measurement: the preset volume as is');
    assert.equal(S.clampToWindow('x', NaN), 0);
    assert.equal(S.clampToWindow(0, -50), 0, 'near silence: never turned up (it would only raise the noise)');
    assert.equal(S.clampToWindow(0, -44), 18, 'quiet but real: turned up at most 18 dB');
    assert.equal(S.clampToWindow(-3, -60), -3, 'near silence keeps the preset volume');
});

test('variations stay inside their limits and never repeat a pitch back to back', () => {
    const v = S.variations();
    let last = null;
    for (let i = 0; i < 200; i++) {
        const { cents, db } = v.next();
        assert.ok(Math.abs(cents) <= S.VARY_CENTS && Number.isInteger(cents));
        assert.ok(Math.abs(db) <= S.VARY_DB);
        if (last !== null) assert.notEqual(cents, last);
        last = cents;
    }
});

test('applyLevel sets volume and pitch separately and swallows a property Resolve refuses', async () => {
    const it = makeItem({ start: 0, end: 10 });
    await S.applyLevel(it, -12, 30);
    assert.deepEqual(it.properties, { AudioVolumeEnabled: true, AudioVolume: -12, AudioPitchEnabled: true, AudioPitchSemiTones: 0, AudioPitchCents: 30 });
    const plain = makeItem({ start: 0, end: 10 });
    await S.applyLevel(plain, -8, 0);
    assert.deepEqual(plain.properties, { AudioVolumeEnabled: true, AudioVolume: -8 });
    const refuses = makeItem({ start: 0, end: 10 });
    refuses.SetProperties = () => { throw new Error('unsupported'); };
    await S.applyLevel(refuses, -8, 30);
});

test('Resolve counts as busy after slow answers and recovers on one fast answer', () => {
    L.noteResolveLatency(0.5, 1);
    assert.equal(L.resolveBusy(), false);
    for (let i = 0; i < 4; i++) L.noteResolveLatency(160, 4);      // 40 ms per call
    assert.equal(L.resolveBusy(), true);
    L.noteResolveLatency(Infinity, 1);
    assert.equal(L.resolveBusy(), true, 'a reading that is not a number is ignored');
    assert.equal(L.probeDue(), true);
    assert.equal(L.probeDue(), false, 'at most one probe every few seconds');
    L.noteResolveLatency(2, 1);
    assert.equal(L.resolveBusy(), false);
});
