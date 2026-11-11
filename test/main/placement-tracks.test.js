// Where a caption and its sounds land on the timeline (src/main/placement.js pickTrack and friends).
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../helpers/env');
const { makeTimeline, makeItem } = require('../helpers/fake-resolve');

const P = env.main('placement');
const { isTitleClipName } = env.main('title-templates');
const { takeSnapshot } = env.main('timeline-snapshot');

const clip = (start, end, extra) => Object.assign({ name: 'clip', start, end }, extra || {});
function timeline(video, audio) { return makeTimeline({ tracks: { video, audio: audio || [] } }); }

// Every pick is checked twice: read straight from Resolve, and from a snapshot. Both must agree.
async function pick(build, kind, wanted, s, e, firstAuto, placeIn) {
    const direct = { notes: [] }, snapped = { notes: [] };
    const tlA = build();
    direct.track = await P.pickTrack(tlA, kind, wanted, s, e, firstAuto, direct.notes, placeIn);
    direct.tracks = tlA.tracks[kind].length;
    const tlB = build();
    const snap = await takeSnapshot(tlB, {});
    snapped.track = await P.pickTrack(tlB, kind, wanted, s, e, firstAuto, snapped.notes, placeIn, snap);
    snapped.tracks = tlB.tracks[kind].length;
    assert.deepEqual(snapped, direct, 'snapshot and direct reads agree');
    return direct;
}

test('video: the caption goes one layer above the highest clip at that moment', async () => {
    const r = await pick(() => timeline([[clip(0, 500)], [clip(0, 100)], [clip(200, 300)], []]), 'video', 0, 20, 60, 2);
    assert.equal(r.track, 3);
    assert.deepEqual(r.notes, []);
});

test('video: a new track is added when the top one is taken', async () => {
    const r = await pick(() => timeline([[clip(0, 500)], [clip(0, 100)]]), 'video', 0, 20, 60, 2);
    assert.equal(r.track, 3);
    assert.equal(r.tracks, 3);
    assert.match(r.notes[0], /placed on top, added V3/);
});

test('video: V1 is never used, even when asked for', async () => {
    const r = await pick(() => timeline([[clip(0, 500)], []]), 'video', 1, 20, 60, 2);
    assert.equal(r.track, 2);
    assert.match(r.notes[0], /V1 is never used/);
});

test('video: a requested layer is used when free, otherwise the pick falls back with a note', async () => {
    const build = () => timeline([[clip(0, 500)], [], [clip(0, 100)], []]);
    assert.equal((await pick(build, 'video', 2, 20, 60, 2)).track, 2);
    const busy = await pick(build, 'video', 3, 20, 60, 2);
    assert.equal(busy.track, 4);
    assert.match(busy.notes[0], /V3 is busy there/);
});

test('video: a locked or disabled track is stepped over, and a disabled clip only counts when asked', async () => {
    const build = () => timeline([[clip(0, 500)], [clip(0, 100)], { locked: true, items: [] }, { enabled: false, items: [] }, []]);
    assert.equal((await pick(build, 'video', 0, 20, 60, 2)).track, 5);
    const off = () => timeline([[clip(0, 500)], [clip(0, 100, { enabled: false })], []]);
    assert.equal((await pick(off, 'video', 0, 20, 60, 2)).track, 2);
    assert.equal((await pick(off, 'video', 0, 20, 60, 2, { disabledClip: true })).track, 3);
});

test('video: "first empty layer" takes a gap lower down', async () => {
    const build = () => timeline([[clip(0, 500)], [], [clip(0, 100)], []]);
    assert.equal((await pick(build, 'video', 0, 20, 60, 2)).track, 4);
    assert.equal((await pick(build, 'video', 0, 20, 60, 2, { firstEmpty: true })).track, 2);
});

test('video: a track range is filled from its first layer and overflows above it', async () => {
    const free = () => timeline([[clip(0, 500)], [], [], [], []]);
    assert.equal((await pick(free, 'video', 0, 20, 60, 2, { rangeFrom: 3, rangeTo: 4 })).track, 3);
    const full = () => timeline([[clip(0, 500)], [], [clip(0, 100)], [clip(0, 100)], []]);
    const over = await pick(full, 'video', 0, 20, 60, 2, { rangeFrom: 3, rangeTo: 4 });
    assert.equal(over.track, 5);
    assert.match(over.notes[0], /above the range/);
    const high = await pick(() => timeline([[clip(0, 500)], []]), 'video', 0, 20, 60, 2, { rangeFrom: 'V4' });
    assert.equal(high.track, 4);
    assert.equal(high.tracks, 4, 'the tracks up to the range are added');
});

test('audio: the lowest free track, a new one when all are busy, or the placement\'s own range', async () => {
    const build = () => timeline([[clip(0, 500)]], [[clip(0, 500)], [clip(0, 30)], []]);
    assert.equal((await pick(build, 'audio', 0, 20, 60, 1)).track, 3);
    assert.equal((await pick(build, 'audio', 0, 40, 60, 1)).track, 2);
    const added = await pick(() => timeline([[clip(0, 500)]], [[clip(0, 500)]]), 'audio', 0, 20, 60, 1);
    assert.equal(added.track, 2);
    assert.match(added.notes.join(' | '), /A1 busy \| no free A track, added A2/);
    assert.equal((await pick(build, 'audio', 0, 40, 60, 1, { audioMode: 'own', audioFrom: 3 })).track, 3);
    assert.equal((await pick(build, 'audio', 0, 40, 60, 1, { audioMode: 'same', rangeFrom: 3, rangeTo: 5 })).track, 3);
});

test('fitDuration trims to the wanted length and reports a clip that cannot grow', async () => {
    const it = makeItem({ start: 0, end: 100, rightOffset: 20 });
    assert.equal(await P.fitDuration(it, 60), true);
    assert.equal(it.end - it.start, 60);
    assert.equal(await P.fitDuration(it, 120), true, 'grows back while frames are still trimmed off');
    assert.equal(await P.fitDuration(it, 500), false, 'not past its full length');
    assert.equal(it.rightOffset, 0);
    assert.equal(await P.fitDuration(it, 0), false);
    const refuses = makeItem({ start: 0, end: 100, rightOffset: 20 });
    refuses.SetRightOffset = () => { throw new Error('SetRightOffset: Invalid offset'); };
    assert.equal(await P.fitDuration(refuses, 60), false);
});

test('the cut guard reads the same keys with and without a snapshot, and only warns when a boundary moved', async () => {
    const build = () => timeline([[clip(0, 100), { name: 'Text+ Pop', start: 100, end: 150 }], [clip(0, 50)]], [[clip(0, 100)]]);
    const direct = await P.cutSnapshot(build());
    const tl = build();
    assert.deepEqual(await P.cutSnapshot(tl, await takeSnapshot(tl, {})), direct);
    assert.deepEqual(direct, ['v1:0-100', 'a1:0-100']);
    assert.equal(P.cutCheck('test', direct, direct.slice()), null);
    assert.equal(P.cutCheck('test', direct, direct.concat('a2:10-40')), null, 'an added sound is expected');
    assert.match(P.cutCheck('test', direct, ['v1:0-60', 'v1:60-100', 'a1:0-100']), /1 boundaries moved/);
    assert.equal(P.cutCheck('test', null, direct), null);
});

test('title clips are recognised by name', () => {
    assert.equal(isTitleClipName('Text+ Pop In'), true);
    assert.equal(isTitleClipName('MultiText Glass Pill'), true);
    assert.equal(isTitleClipName('A001.mov'), false);
    assert.equal(isTitleClipName(null), false);
});
