const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../helpers/env');
const { makeTimeline } = require('../helpers/fake-resolve');

const { takeSnapshot, snapTrack, snapAdd, snapAddTrack, snapCutKeys } = env.main('timeline-snapshot');

function timeline() {
    return makeTimeline({ tracks: {
        video: [
            [{ name: 'A001.mov', start: 0, end: 100 }, { name: 'A002.mov', start: 100, end: 250 }],
            { locked: true, items: [{ name: 'Text+ Pop', start: 10, end: 40, enabled: false }] }
        ],
        audio: [[{ name: 'A001.mov', start: 0, end: 100 }], { enabled: false, items: [] }]
    } });
}

test('takeSnapshot reads every track once, with lock and on/off state', async () => {
    const tl = timeline();
    const snap = await takeSnapshot(tl, { withIds: true });
    assert.deepEqual(Object.keys(snap.tracks), ['video', 'audio']);
    assert.equal(snap.tracks.video.length, 2);
    assert.deepEqual(snap.tracks.video[0].items.map(x => [x.name, x.start, x.end]), [['A001.mov', 0, 100], ['A002.mov', 100, 250]]);
    assert.equal(snapTrack(snap, 'video', 2).locked, true);
    assert.equal(snapTrack(snap, 'video', 2).items[0].enabled, false, 'on/off is read from V2 up');
    assert.equal(snapTrack(snap, 'video', 2).items[0].name, '', 'names are only read on V1');
    assert.equal(snapTrack(snap, 'audio', 2).enabled, false);
    assert.ok(snap.tracks.video[0].items.every(x => typeof x.id === 'string' && x.id));
    assert.equal(tl.calls.GetItemListInTrack, 4, 'one list call per track');
    assert.equal(snapTrack(snap, 'video', 9), null);
    assert.equal(snapTrack(null, 'video', 1), null);
});

test('takeSnapshot survives a track Resolve answers null for and a clip that throws', async () => {
    const tl = timeline();
    tl.tracks.video[0].items[1].GetStart = () => { throw new Error('stale handle'); };
    const realList = tl.GetItemListInTrack;
    tl.GetItemListInTrack = (kind, t) => (kind === 'audio' ? null : realList(kind, t));
    const snap = await takeSnapshot(tl, { kinds: ['video', 'audio'] });
    assert.equal(snap.tracks.video[0].items.length, 1, 'the unreadable clip is left out');
    assert.deepEqual(snap.tracks.audio.map(t => t.items.length), [0, 0]);
});

test('snapAdd makes later picks see a clip placed during the same placement', async () => {
    const snap = await takeSnapshot(timeline(), {});
    snapAdd(snap, 'video', 3, { start: 5, end: 30, id: 'new' });
    assert.deepEqual(snap.tracks.video.map(t => t.t), [1, 2, 3]);
    assert.deepEqual(snapTrack(snap, 'video', 3).items, [{ it: null, name: '', start: 5, end: 30, enabled: true, id: 'new' }]);
    snapAddTrack(snap, 'subtitle', 1);
    assert.equal(snapTrack(snap, 'subtitle', 1).items.length, 0);
    snapAdd(null, 'video', 1, { start: 0, end: 1 });      // no snapshot: nothing to do, must not throw
});

test('snapCutKeys lists V1 and audio boundaries and leaves the plugin\'s own titles out', async () => {
    const tl = timeline();
    tl.tracks.video[0].items[1].name = 'Text+ Pop';
    const snap = await takeSnapshot(tl, {});
    assert.deepEqual(snapCutKeys(snap), ['v1:0-100', 'a1:0-100']);
});
