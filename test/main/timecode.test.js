const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../helpers/env');
const { makeTimeline, makeProject, makeResolve } = require('../helpers/fake-resolve');

const { tcToFrame, frameToTC, timelineMeta } = env.main('resolve');

const NDF_25 = { fps: 25, nominal: 25, df: false };
const DF_2997 = { fps: 29.97, nominal: 30, df: true };
const DF_5994 = { fps: 59.94, nominal: 60, df: true };

test('non-drop timecode converts both ways', () => {
    assert.equal(tcToFrame('01:00:00:00', NDF_25), 90000);
    assert.equal(tcToFrame('00:00:01:12', NDF_25), 37);
    assert.equal(frameToTC(90000, NDF_25), '01:00:00:00');
    assert.equal(frameToTC(37, NDF_25), '00:00:01:12');
});

test('drop-frame timecode skips two frame numbers a minute, except every tenth', () => {
    assert.equal(tcToFrame('00:01:00;02', DF_2997), 1800);
    assert.equal(frameToTC(1800, DF_2997), '00:01:00;02');
    assert.equal(frameToTC(1799, DF_2997), '00:00:59;29');
    assert.equal(tcToFrame('00:10:00;00', DF_2997), 17982);
    assert.equal(frameToTC(17982, DF_2997), '00:10:00;00');
    assert.equal(tcToFrame('01:00:00;00', DF_2997), 107892);
});

test('frame -> timecode -> frame is the identity', () => {
    for (const meta of [NDF_25, DF_2997, DF_5994]) {
        for (const f of [0, 1, 1799, 1800, 1801, 17981, 17982, 17983, 107892, 123456]) {
            assert.equal(tcToFrame(frameToTC(f, meta), meta), f, meta.fps + ' fps, frame ' + f);
        }
    }
});

test('frameToTC never goes below zero and rounds to a whole frame', () => {
    assert.equal(frameToTC(-5, NDF_25), '00:00:00:00');
    assert.equal(frameToTC(24.6, NDF_25), '00:00:01:00');
});

test('timelineMeta reads rate, drop-frame and size from the timeline', async () => {
    const tl = makeTimeline({ settings: { timelineFrameRate: '29.97', timelineDropFrameTimecode: '1', timelineResolutionWidth: '1080', timelineResolutionHeight: '1920' } });
    assert.deepEqual(await timelineMeta(tl, null), { fps: 29.97, nominal: 30, df: true, width: 1080, height: 1920 });
});

test('timelineMeta falls back to the project, then to 25 fps / 1920x1080, when Resolve answers nothing', async () => {
    const empty = { timelineFrameRate: '', timelineDropFrameTimecode: '', timelineResolutionWidth: '', timelineResolutionHeight: '' };
    const tl = makeTimeline({ settings: empty });
    const project = makeProject({ timeline: tl, settings: { timelineResolutionWidth: '3840', timelineResolutionHeight: '2160' } });
    assert.deepEqual(await timelineMeta(tl, project), { fps: 25, nominal: 25, df: false, width: 3840, height: 2160 });

    env.useResolve(makeResolve({ project: makeProject({ timeline: tl }) }));
    assert.deepEqual(await timelineMeta(tl, null), { fps: 25, nominal: 25, df: false, width: 1920, height: 1080 });
});
