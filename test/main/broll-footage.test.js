// B-roll effects that read the footage (src/main/broll-footage.js), the pure parts: which effect needs what, the
// loudness -> 0..1 samples, timeline frame -> envelope reading, which clip is the picture under a frame.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const env = require('../helpers/env');

const { needsFor, samplesFromDb, frameLevels, pickFootage, thumbMoments, smoothTrack, trackBox, backdropArgs, keepNewest, NEEDS } = env.main('broll-footage');
const REG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'broll', 'effects.json'), 'utf8'));

test('every effect that reads the footage is in effects.json, and its switches are real fields', () => {
    const ids = new Set(REG.effects.map(e => e.id));
    for (const id of Object.keys(NEEDS)) assert.ok(ids.has(id), id + ' is not an effect');
    const keys = (id) => REG.effects.find(e => e.id === id).fields.map(f => f.key);
    for (const [id, key] of [['cutout-pop', 'source'], ['cutout-pop', 'removeBg'], ['doodle-boil', 'follow'], ['video-wall', 'realClips'],
        ['viewfinder-zoom', 'pushIn'], ['editor-reveal', 'footage'], ['audio-pulse', 'audioTrack'], ['cutout-puppet', 'audioTrack'],
        ['vertigo-dolly', 'move'], ['green-screen-stage', 'image'], ['sticky-text', 'follow'], ['before-after-wipe', 'look']]) {
        assert.ok(keys(id).includes(key), id + '.' + key);
    }
});

test('needsFor follows the props', () => {
    assert.equal(needsFor('stat-bar', {}), null);
    assert.deepEqual(needsFor('audio-pulse', {}), { samples: true });
    assert.equal(needsFor('cutout-puppet', { talk: false }), null);
    assert.equal(needsFor('cutout-pop', { source: 'file', image: '/a.png' }), null);
    assert.deepEqual(needsFor('cutout-pop', { source: 'file', image: '/a.png', removeBg: true }), { photo: true });
    assert.deepEqual(needsFor('cutout-pop', { source: 'speaker' }), { still: true });
    assert.equal(needsFor('doodle-boil', { follow: false }), null);
    assert.equal(needsFor('viewfinder-zoom', { pushIn: false }), null);
    assert.ok(needsFor('frame-break-card', {}).seq && needsFor('frame-break-card', {}).full);
});

test('the four lifted limits ask for the right footage', () => {
    // Vertigo: the room is the clean plate unless the speaker is the one that grows
    assert.deepEqual(needsFor('vertigo-dolly', {}), { seq: true, plate: true });
    assert.deepEqual(needsFor('vertigo-dolly', { move: 'Speaker grows' }), { seq: true, full: true });
    // Green screen: a video backdrop is read as frames, a picture is not
    assert.deepEqual(needsFor('green-screen-stage', { image: '/m/beach.MOV' }), { seq: true, video: true });
    assert.deepEqual(needsFor('green-screen-stage', { image: '/m/beach.jpg' }), { seq: true });
    // Sticky text follows the shot unless switched off; Before + after reads frames unless it is the plain tint
    assert.deepEqual(needsFor('sticky-text', {}), { track: true, soft: true });
    assert.equal(needsFor('sticky-text', { follow: false }), null);
    assert.deepEqual(needsFor('before-after-wipe', {}), { full: true, soft: true });
    assert.equal(needsFor('before-after-wipe', { look: 'Tint' }), null);
    const reg = (id) => REG.effects.find(e => e.id === id);
    assert.ok(reg('green-screen-stage').fields.find(f => f.key === 'image').video, 'the backdrop picker takes videos');
    assert.deepEqual(reg('before-after-wipe').fields.find(f => f.key === 'look').options, ['Flat (log)', 'Washed out', 'Black & white', 'Tint']);
});

test('trackBox: a square patch round the label, kept inside the picture', () => {
    const [x, y, w, h] = trackBox(0.5, 0.6, 1080, 1920);
    assert.ok(Math.abs(w * 1080 - h * 1920) < 2, 'square in pixels');
    assert.ok(Math.abs(x + w / 2 - 0.5) < 1e-3 && Math.abs(y + h / 2 - 0.6) < 1e-3, 'centred on the label');
    const edge = trackBox(0.01, 0.99, 1920, 1080);
    assert.equal(edge[0], 0);
    assert.ok(edge[1] + edge[3] <= 1 + 1e-9);
    const zero = trackBox(0, 0, 1920, 1080);
    assert.equal(zero[0], 0); assert.equal(zero[1], 0);
});

test('smoothTrack: a 3-frame mean, ends kept in place', () => {
    assert.deepEqual(smoothTrack([[0, 0], [0.3, 0.3], [0.6, 0]]), [[0.1, 0.1], [0.3, 0.1], [0.5, 0.1]]);
    assert.deepEqual(smoothTrack([[0.4, 0.2]]), [[0.4, 0.2]]);
});

test('backdropArgs: frames at the timeline rate and size, looped, from frame 0', () => {
    const a = backdropArgs('/v.mp4', '/o/b%05d.jpg', { fps: 25, width: 1080, height: 1920 }, 50);
    assert.deepEqual(a.slice(a.indexOf('-stream_loop'), a.indexOf('-stream_loop') + 2), ['-stream_loop', '-1']);
    assert.equal(a[a.indexOf('-vf') + 1], 'fps=25,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920');
    assert.equal(a[a.indexOf('-frames:v') + 1], '50');
    assert.equal(a[a.indexOf('-start_number') + 1], '0');
    const one = backdropArgs('/v.mp4', '/o/b%05d.jpg', { fps: 25, width: 1080, height: 1920 }, 50, 12);
    assert.match(one[one.indexOf('-vf') + 1], /select='gte\(n,12\)'$/);
    assert.equal(one[one.indexOf('-frames:v') + 1], '1');
});

test('samplesFromDb: speech reaches 1, room tone stays near 0, a fall is eased', () => {
    const db = [-62, -60, -24, -20, -22, -61, -62, -63, -21, NaN];
    const s = samplesFromDb(db);
    assert.equal(s.length, db.length);
    assert.ok(s[3] > 0.9, 'loud syllable ' + s[3]);
    assert.ok(s[0] < 0.05 && s[1] < 0.05, 'room tone ' + s[0]);
    assert.ok(s[5] > 0.3 && s[5] < s[4], 'release ' + s[5]);        // one frame after the syllable: still part open
    assert.ok(s[7] < s[6] && s[6] < s[5]);
    assert.ok(s.every(v => v >= 0 && v <= 1));
    assert.deepEqual(samplesFromDb([NaN, NaN]), [0, 0]);
});

test('frameLevels reads each timeline frame from the right place in the file, speed changes included', () => {
    // envelope: 10 ms hops from second 2.0 of the file; loud only between 2.40 s and 2.48 s
    const env2 = { hop: 0.01, start: 2, db: Float32Array.from({ length: 200 }, (_, i) => (i >= 40 && i < 48 ? -20 : -60)) };
    const fps = 25, tlStart = 1000, srcStart = 50;                       // timeline frame 1000 = file frame 50 = 2.0 s
    const toFile = (f) => (srcStart + (f - tlStart)) / fps;
    const out = frameLevels(new Array(20).fill(NaN), env2, toFile, tlStart, tlStart, tlStart + 20);
    assert.equal(out[10], -20);          // 2.40 .. 2.44 s
    assert.equal(out[11], -20);
    assert.equal(out[9], -60);
    assert.equal(out[12], -60);
    // twice the speed: two file frames per timeline frame
    const fast = frameLevels(new Array(10).fill(NaN), env2, (f) => (srcStart + (f - tlStart) * 2) / fps, tlStart, tlStart, tlStart + 10);
    assert.equal(fast[5], -20);
    assert.equal(fast[4], -60);
    // frames outside the clip's own range are left alone
    const part = frameLevels(new Array(20).fill(NaN), env2, toFile, tlStart, tlStart + 15, tlStart + 20);
    assert.ok(Number.isNaN(part[10]));
});

test('pickFootage: the topmost footage under the frame, never the plugin\'s own overlays', () => {
    const segs = [
        { kind: 'video', track: 1, file: '/footage/C0061.mp4', tlStart: 0, tlEnd: 500, itemId: 'a' },
        { kind: 'video', track: 2, file: '/footage/cutaway.mov', tlStart: 100, tlEnd: 200, itemId: 'b' },
        { kind: 'video', track: 3, file: '/footage/El Subtitle Animator B-roll/stat-bar-ab12cd.mov', tlStart: 120, tlEnd: 180, itemId: 'c' },
        { kind: 'audio', track: 1, file: '/footage/C0061.mp4', tlStart: 0, tlEnd: 500, itemId: 'd' }
    ];
    assert.equal(pickFootage(segs, 150).itemId, 'b');
    assert.equal(pickFootage(segs, 300).itemId, 'a');
    assert.equal(pickFootage(segs, 600), null);
});

test('thumbMoments spreads over the clips in proportion to their length', () => {
    const map = (s) => ({ toFile: (f) => (f - s.tlStart) / 25 });
    const m = thumbMoments([
        { kind: 'video', track: 1, file: '/a.mp4', tlStart: 0, tlEnd: 750 },
        { kind: 'video', track: 1, file: '/b.mp4', tlStart: 750, tlEnd: 1000 }
    ], 8, map);
    assert.equal(m.length, 8);
    assert.equal(m.filter(x => x.file === '/a.mp4').length, 6);
    assert.ok(m.every(x => x.t >= 0));
    assert.deepEqual(thumbMoments([], 8, map), []);
});

test('keepNewest: the cache keeps the newest folders up to a count and a size, the newest always', () => {
    const d = (n, gb) => ({ n, bytes: gb * 1e9 });
    assert.deepEqual(keepNewest([d('a', 1), d('b', 1), d('c', 1), d('e', 1), d('f', 1)], 16, 4e9), ['a', 'b', 'c', 'e']);
    assert.deepEqual(keepNewest([d('a', 6), d('b', 0.1)], 16, 4e9), ['a']);
    assert.deepEqual(keepNewest([d('a', 0), d('b', 0), d('c', 0)], 2, 4e9), ['a', 'b']);
});
