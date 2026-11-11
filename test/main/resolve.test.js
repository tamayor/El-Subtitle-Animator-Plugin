// The Resolve wrapper (src/main/resolve.js) against the fake API: connection, subtitles, item lookups.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../helpers/env');
const { makeTimeline, makeProject, makeResolve } = require('../helpers/fake-resolve');

const R = env.main('resolve');

function subtitleTimeline() {
    return makeTimeline({ name: 'Edit', tracks: {
        video: [[{ name: 'A001.mov', start: 0, end: 300, id: 'v-a' }], [{ name: 'Text+ Pop', start: 50, end: 90, id: 'v-b' }]],
        subtitle: [
            [{ name: 'second line', start: 60, end: 120 }, { name: 'first line', start: 0, end: 60 }],
            { enabled: false, items: [{ name: 'translated', start: 0, end: 60 }] }
        ]
    } });
}
function connect(tl) {
    const resolve = makeResolve({ project: makeProject({ timeline: tl }) });
    env.useResolve(resolve);
    return resolve;
}

test('getProject connects once and reuses the project manager', async () => {
    const tl = subtitleTimeline();
    const resolve = connect(tl);
    const before = env.calls.Initialize;
    assert.equal(await R.getProject(), resolve.project);
    assert.equal(await R.getProject(), resolve.project);
    assert.equal(env.calls.Initialize - before, 1);
    assert.equal(resolve.calls.GetProjectManager, 1);
    assert.equal(env.workflowIntegration.pluginId, 'com.el.subtitleanimator');
    assert.equal(env.state.hasSeenResolve, true);
});

test('getProject reports a Resolve that cannot be reached', async () => {
    env.useResolve(null);
    await assert.rejects(R.getProject(), /Could not connect to DaVinci Resolve/);
});

test('listSubtitles answers with an error (never throws) when no project or timeline is open', async () => {
    env.useResolve(makeResolve({ project: null }));
    assert.deepEqual(await R.listSubtitles(null, true), { ok: false, error: 'Open a project in Resolve' });
    env.useResolve(makeResolve({ project: makeProject({ timeline: null }) }));
    assert.deepEqual(await R.listSubtitles(null, true), { ok: false, error: 'Open a timeline in Resolve' });
});

test('getSubtitles returns every track in timeline order, numbered, without API handles', async () => {
    const tl = subtitleTimeline();
    connect(tl);
    const list = await R.getSubtitles(tl, true);
    assert.deepEqual(list.map(s => [s.index, s.text, s.start, s.end, s.duration, s.track, s.enabled]), [
        [1, 'first line', 0, 60, 60, 1, true],
        [2, 'translated', 0, 60, 60, 2, false],      // its whole track is off
        [3, 'second line', 60, 120, 60, 1, true]
    ]);
    assert.ok(list.every(s => !('it' in s)), 'handles stay out of the list sent to the panel');
    assert.equal(env.state.subCache.items.length, 3);
    assert.equal(env.state.subCache.version, 1);
});

test('getSubtitles serves the list just read without asking Resolve again', async () => {
    const tl = subtitleTimeline();
    connect(tl);
    const first = await R.getSubtitles(tl, true);
    const calls = tl.calls.GetItemListInTrack;
    assert.equal(await R.getSubtitles(tl, false), first);
    assert.equal(tl.calls.GetItemListInTrack, calls);
});

test('the subtitle version only moves on when something the panel shows changed', async () => {
    const tl = subtitleTimeline();
    connect(tl);
    await R.getSubtitles(tl, true);
    await R.getSubtitles(tl, true);
    assert.equal(env.state.subCache.version, 1);
    tl.tracks.subtitle[0].items[0].name = 'second line, edited';
    await R.getSubtitles(tl, true);
    assert.equal(env.state.subCache.version, 2);
});

test('setSubtitlesEnabled switches the subtitles mostly inside the range and patches the cached list', async () => {
    const tl = subtitleTimeline();
    connect(tl);
    await R.getSubtitles(tl, true);
    const changed = await R.setSubtitlesEnabled(tl, { start: 20, end: 125, track: 1 }, false);      // covers 2/3 of "first line" and all of "second line"
    assert.deepEqual(changed.map(c => c.text).sort(), ['first line', 'second line']);
    assert.equal(tl.tracks.subtitle[1].items[0].enabled, true, 'range.track keeps other subtitle tracks out of it');
    assert.deepEqual(tl.tracks.subtitle[0].items.map(i => i.enabled), [false, false]);
    assert.deepEqual(env.state.subCache.list.filter(s => s.track === 1).map(s => s.enabled), [false, false]);
    assert.equal(env.state.subCache.version, 2);

    const back = await R.setSubtitlesEnabled(tl, { start: 0, end: 25, track: 1 }, true);   // under half of "first line": untouched
    assert.deepEqual(back, []);
});

test('setSubtitlesEnabled walks the timeline when there is no current list, and ignores empty ranges', async () => {
    const tl = subtitleTimeline();
    connect(tl);
    assert.deepEqual(await R.setSubtitlesEnabled(tl, { start: 10, end: 10 }, false), []);
    assert.deepEqual(await R.setSubtitlesEnabled(null, { start: 0, end: 10 }, false), []);
    const changed = await R.setSubtitlesEnabled(tl, { start: 60, end: 120 }, false);
    assert.deepEqual(changed, [{ track: 1, start: 60, end: 120, text: 'second line' }]);
});

test('findItemsByIds finds several clips in one pass and stops once it has them all', async () => {
    const tl = subtitleTimeline();
    const found = await R.findItemsByIds(tl, ['v-b', 'gone'], 'video');
    assert.deepEqual([...found.keys()], ['v-b']);
    assert.equal(found.get('v-b').name, 'Text+ Pop');
    assert.equal((await R.findItemsByIds(tl, [], 'video')).size, 0);
    assert.equal((await R.findItemsByIds(null, ['v-a'], 'video')).size, 0);
    tl.calls.GetItemListInTrack = 0;
    await R.findItemsByIds(tl, ['v-a'], 'video');
    assert.equal(tl.calls.GetItemListInTrack, 1, 'V2 is not read once the id was found on V1');
});

test('currentTimeline shares a recent answer and reports no timeline as null', async () => {
    const tl = subtitleTimeline();
    const resolve = connect(tl);
    const a = await R.currentTimeline(5000);
    assert.equal(a.tl, tl);
    assert.equal(a.tlName, 'Edit');
    const calls = resolve.project.calls.GetCurrentTimeline;
    await R.currentTimeline(5000);
    assert.equal(resolve.project.calls.GetCurrentTimeline, calls);
    env.useResolve(makeResolve({ project: makeProject({ timeline: null }) }));
    assert.equal((await R.currentTimeline(5000)).tl, null);
});
