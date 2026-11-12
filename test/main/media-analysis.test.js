const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../helpers/env');

const M = env.main('media-analysis');
const L = env.main('line-break');
const LAYOUT = env.main('layout');

// An envelope of 10 ms levels: speech at -20 dBFS with two pauses at -60.
function envelope(spans, n) {
    const db = new Float32Array(n).fill(-20);
    for (const [a, b] of spans) for (let i = a; i < b; i++) db[i] = -60;
    return { hop: 0.01, start: 10, db };
}

test('pausesFromEnvelope: threshold follows the speech level, pauses in file seconds', () => {
    const p = M.pausesFromEnvelope(envelope([[100, 140], [300, 305]], 500));
    assert.equal(p.speechDb, -20);
    assert.equal(p.thresholdDb, -42, '22 dB under the speech level');
    assert.equal(p.pauses.length, 1, 'a 50 ms dip is not a pause (min 150 ms)');
    assert.deepEqual([p.pauses[0].start, p.pauses[0].end], [11, 11.4]);
    assert.equal(p.quiet, false);
});

test('snapCuts: into a pause, onto a near pause, onto a word gap, or left alone', () => {
    const pauses = [{ start: 2, end: 2.4, mid: 2.2 }];
    const words = [{ start: 4, end: 4.5 }, { start: 4.7, end: 5 }];
    const [a, b, c, d] = M.snapCuts([2.1, 2.5, 4.55, 8], pauses, words, 0.35);
    assert.deepEqual(a, { from: 2.1, to: 2.2, by: 'pause' });
    assert.deepEqual(b, { from: 2.5, to: 2.2, by: 'pause' });
    assert.deepEqual(c, { from: 4.55, to: 4.6, by: 'word' });
    assert.deepEqual(d, { from: 8, to: 8, by: null });
});

test('beatGrid finds 120 BPM in a synthetic kick pattern and none in noise', () => {
    const n = 1200, db = new Float32Array(n).fill(-70), low = new Float32Array(n).fill(-70);
    for (let i = 0; i < n; i += 50) for (let k = 0; k < 8; k++) { db[i + k] = -10 - k * 4; low[i + k] = -8 - k * 4; }
    const g = M.beatGrid({ hop: 0.01, start: 0, db, low, high: null });
    assert.equal(g.tempoBpm, 120);
    assert.ok(g.confidence > 0.5);
    assert.ok(g.beats.filter(b => b.supported).length >= 20);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const noise = new Float32Array(n).map(() => -40 + rnd() * 20);
    assert.equal(M.beatGrid({ hop: 0.01, start: 0, db: noise, low: null, high: null }).tempoBpm, null, 'no invented tempo');
});

test('sourceMapper handles a 24 fps source on a 25 fps timeline', () => {
    const m = M.sourceMapper({ tlStart: 100, tlEnd: 200, srcStartFrame: 48, srcEndFrame: 148, srcFps: 24 });
    assert.equal(m.toFile(100), 2);
    assert.equal(m.toFrame(2), 100);
    assert.equal(Math.round(m.toFrame(m.toFile(150)) * 1000) / 1000, 150);
});

test('pickSegments: dialogue = lowest audio track, music = highest audio-only track', () => {
    const seg = (kind, track, audioOnly) => ({ kind, track, audioOnly, tlStart: 0, tlEnd: 100, name: kind + track });
    const media = { from: 0, to: 100, segments: [seg('audio', 1, false), seg('audio', 2, true), seg('audio', 3, true), seg('video', 1, false)] };
    assert.deepEqual(M.pickSegments('pauses', media).map(s => s.track), [1]);
    assert.deepEqual(M.pickSegments('beats', media).map(s => s.track), [3]);
    assert.deepEqual(M.pickSegments('beats', media, { audioTrack: 2 }).map(s => s.track), [2]);
    assert.deepEqual(M.pickSegments('cuts', media).map(s => s.kind), ['video']);
});

test('shotsFromCuts flags light B-roll', () => {
    const shots = M.shotsFromCuts(0, 10, [4], [{ t: 1, y: 120 }, { t: 5, y: 220 }, { t: 6, y: 210 }]);
    assert.equal(shots.length, 2);
    assert.equal(shots[1].bright, true);
    assert.equal(shots[0].bright, false);
});

test('renderFlags: black tail, static clip, static entrance', () => {
    const tail = M.renderFlags({ black: [{ start: 1.92, end: 2.08 }], frozen: [] }, 25, 50);
    assert.equal(tail[0].kind, 'black');
    assert.match(tail[0].note, /end of the clip/);
    assert.equal(M.renderFlags({ black: [], frozen: [{ start: 0, end: null }] }, 25, 50)[0].kind, 'static');
    assert.equal(M.renderFlags({ black: [], frozen: [{ start: 0, end: 0.6 }] }, 25, 50)[0].kind, 'staticStart');
    assert.equal(M.renderFlags({ black: [], frozen: [{ start: 1, end: 1.6 }] }, 25, 50)[0].kind, 'frozen');
});

test('breakLines: phrase-aware, number + unit kept, no hanging article', () => {
    assert.deepEqual(L.breakLines('that they are spending about $13K per month', { maxLines: 2 }).lines, ['that they are spending', 'about $13K per month']);
    assert.deepEqual(L.breakLines('I went to the store with a friend of mine', { maxLines: 2 }).lines, ['I went to the store', 'with a friend of mine']);
    assert.deepEqual(L.breakLines('So yeah, watch this shit man', { maxLines: 2 }).lines, ['So yeah,', 'watch this shit man']);
    assert.equal(L.breakLines('already\nbroken', {}).text, 'already\nbroken');
    for (const l of L.breakLines('the best way to save for a house', { lines: 3 }).lines) assert.ok(!/ (a|the|to|for)$/.test(l), 'ends on ' + l);
});

test('platform layouts keep captions centred', () => {
    for (const name of ['tiktok', 'reels', 'shorts', 'ig', 'youtube-shorts']) {
        const l = LAYOUT.platformLayout(name);
        assert.ok(l, name);
        const [x0, x1] = l.bands[0].spans[0];
        assert.equal(Math.round((x0 + x1) * 500), 500, name + ' spans are symmetric');
        const fit = LAYOUT.fitBox(l, 0.5, 0.9, 0.5, 0.08, {});
        assert.equal(fit.cx, 0.5);
        assert.ok(fit.cy + 0.04 <= l.bands[0].y1, name + ': moved up out of the app\'s bottom UI');
    }
    assert.equal(LAYOUT.platformLayout('vimeo'), null);
});
