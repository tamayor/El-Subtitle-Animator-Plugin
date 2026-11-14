// Collage B-roll, the pure part (src/main/collage-plan.js): segments, captions / SRT, render suffixes, the starting plan
// from subtitles, picture sizes and credits.csv.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../helpers/env');

const P = env.main('collage-plan');

const beat = (id, a, e, visual, extra) => ({ id, frames: [a, e], visual, assets: [], overlays: [], ...(extra || {}) });

test('back-to-back B-roll beats make one clip; a talking-head beat ends it, and one with a title gets its own', () => {
    const segs = P.segmentsOf([
        beat('b01', 0, 23, 'talking-head'),
        beat('b03', 67, 158, 'photo'),
        beat('b02', 23, 67, 'medallion'),          // out of order: sorted by start
        beat('b04', 158, 200, 'talking-head', { overlays: [{ type: 'title', text: 'Episode 93' }] }),
        beat('b05', 200, 260, 'stack'),
        beat('b06', 300, 360, 'photo')            // a gap: a new clip
    ]);
    assert.deepEqual(segs, [
        { role: 'broll', from: 23, to: 158, beats: ['b02', 'b03'] },
        { role: 'title', from: 158, to: 200, beats: ['b04'] },
        { role: 'broll', from: 200, to: 260, beats: ['b05'] },
        { role: 'broll', from: 300, to: 360, beats: ['b06'] }
    ]);
    assert.deepEqual(P.segmentsOf([beat('b01', 0, 30, 'talking-head')]), []);
});

test('captions break after punctuation, at a pause, at 3 words or 18 characters; the SRT follows them', () => {
    const w = (t, s, e) => ({ w: t, start: s, end: e });
    const words = [w('Look', 0, 6), w('at', 6, 9), w('this', 9, 15), w('suit.', 15, 24), w('It', 40, 44), w('isn\'t', 44, 50), w('waterproof.', 50, 60)];
    const chunks = P.captionChunks(words);
    assert.deepEqual(chunks.map(c => c.words.map(x => x.w).join(' ')), ['Look at this', 'suit.', 'It isn\'t', 'waterproof.']);
    assert.equal(chunks[1].end, 34, 'a chunk ends 10 frames after its last word when the next starts later');
    assert.equal(chunks[0].end, 15, 'or where the next chunk starts');
    const srt = P.srtOf(words, 30);
    assert.match(srt, /^1\n00:00:00,000 --> 00:00:00,500\nLook at this\n/);
    assert.equal(srt.split('\n\n').length, 4);
});

test('a new render set never reuses a file name already in render/', () => {
    assert.equal(P.nextSuffix([]), '');
    assert.equal(P.nextSuffix(['plan.json', 'captions.srt']), '');
    assert.equal(P.nextSuffix(['broll-00023-00585.mov', 'captions.mov']), '-v2');
    assert.equal(P.nextSuffix(['broll-00023-00585-v4.mov', 'broll-00620-00968-v2.mov', 'broll-x.mov.part.mov']), '-v5');
    assert.equal(P.clipFile('broll', 23, 585, '-v5'), 'broll-00023-00585-v5.mov');
    assert.equal(P.clipFile('captions', 0, 968, ''), 'captions.mov');
});

test('a starting plan: one talking-head beat per subtitle, short pauses held, frames from the timeline start', () => {
    const subs = [
        { index: 2, text: 'It isn\'t  waterproof.', start: 108023, end: 108060 },
        { index: 1, text: 'Look at this suit.', start: 108000, end: 108020 },
        { index: 3, text: 'Later.', start: 108200, end: 108230 }
    ];
    const beats = P.beatsFromSubtitles(subs, 108000, 45);
    assert.deepEqual(beats.map(b => [b.id, b.frames, b.line, b.visual]), [
        ['b01', [0, 23], 'Look at this suit.', 'talking-head'],
        ['b02', [23, 60], 'It isn\'t waterproof.', 'talking-head'],
        ['b03', [200, 230], 'Later.', 'talking-head']
    ]);
    const words = P.wordsFromSubtitles([{ text: 'ab c', start: 100, end: 106 }], 100);
    assert.deepEqual(words, [{ w: 'ab', start: 0, end: 3.6 }, { w: 'c', start: 3.6, end: 6 }]);
});

test('pictures a beat still needs', () => {
    assert.deepEqual(P.pictureNeed(beat('b1', 0, 1, 'stack', { assets: ['a.jpg'] })), { need: 2, have: 1, missing: 1 });
    assert.equal(P.pictureNeed(beat('b1', 0, 1, 'medallion')).missing, 0);
    assert.equal(P.pictureNeed(beat('b1', 0, 1, 'talking-head')).need, 0);
});

test('picture sizes come from PNG, JPEG and WebP headers', () => {
    const png = Buffer.alloc(40); Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png, 0); png.writeUInt32BE(383, 16); png.writeUInt32BE(920, 20);
    assert.deepEqual(P.imageSize(png), { w: 383, h: 920 });
    // SOI, an APP0 segment, then SOF0 (height 1301, width 1920)
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0x15, 0x07, 0x80, 0x03, ...new Array(20).fill(0)]);
    assert.deepEqual(P.imageSize(jpg), { w: 1920, h: 1301 });
    const webp = Buffer.alloc(40); webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUIntLE(1599, 24, 3); webp.writeUIntLE(899, 27, 3);
    assert.deepEqual(P.imageSize(webp), { w: 1600, h: 900 });
    assert.equal(P.imageSize(Buffer.from('not a picture, not a picture, not')), null);
});

test('credits.csv: quoted cells round-trip, a picked picture gets a row, a shared one gains the beat', () => {
    const csv = 'beat_id,asset,title,creator,date,license,license_url,source_page,original_size,attribution\n' +
        'b03,b03-01.jpg,"A surfer, jumping",Brocken Inaglory,2008,CC BY-SA 3.0,,https://x,1929x2082,"say ""hi"""\n';
    const rows = P.parseCsv(csv);
    assert.equal(rows.length, 2);
    assert.equal(rows[1][2], 'A surfer, jumping');
    assert.equal(rows[1][9], 'say "hi"');
    assert.equal(rows.map(P.csvLine).join('\n') + '\n', csv);

    const added = P.parseCsv(P.withCredit(csv, 'b05', 'b05-02.jpg', { title: 'File:Snow surf.jpg', creator: 'Ann', license: 'CC0', page: 'https://y', width: 2000, height: 1500 }));
    assert.equal(added.length, 3);
    assert.deepEqual(added[2].slice(0, 6), ['b05', 'b05-02.jpg', 'Snow surf.jpg', 'Ann', '', 'CC0']);
    assert.equal(added[2][8], '2000x1500');
    assert.equal(added[2][9], 'Snow surf.jpg by Ann, CC0, via Wikimedia Commons');

    const shared = P.parseCsv(P.withCredit(csv, 'b07', 'b03-01.jpg', {}));
    assert.equal(shared.length, 2);
    assert.equal(shared[1][0], 'b03;b07');

    assert.equal(P.parseCsv(P.withoutCredit(csv, 'b03-01.jpg')).length, 1);
    assert.equal(P.parseCsv(P.withCredit('', 'b01', 'b01-01.jpg', null))[0][0], 'beat_id');
});

test('folder and asset names', () => {
    assert.equal(P.safeName('Ep 2: cut/v3'), 'Ep 2- cut-v3');
    assert.equal(P.safeName(''), 'timeline');
    assert.equal(P.candidateAsset('b03', '01.JPG'), 'b03-01.jpg');
    assert.equal(P.candidateAsset('suit', '04.jpg'), 'suit-04.jpg');
});

test('a beat keeps its pictures and its clip; each visual uses its own kind', () => {
    const b = beat('b1', 0, 60, 'photo', { assets: ['b1-01.jpg', 'b1-02.mp4'] });
    assert.deepEqual(P.assetsFor(b), ['b1-01.jpg']);
    assert.deepEqual(P.assetsFor({ ...b, visual: 'clip' }), ['b1-02.mp4']);
    assert.equal(P.pictureNeed({ ...b, visual: 'clip', assets: ['b1-01.jpg'] }).missing, 1, 'a picture is not a clip');
    assert.equal(P.isVideoName('x.MOV'), true);
});

test('a clip start stays inside the clip, and clip sizes come from clips.json', () => {
    assert.equal(P.clampClipStart(5, 13.32, 90, 30), 5);
    assert.equal(P.clampClipStart(99, 13.32, 90, 30), 9.8, '13.32 s - 3 s beat - 0.5 s');
    assert.equal(P.clampClipStart(-2, 10, 30, 30), 0);
    assert.equal(P.clampClipStart(4.26, 0, 30, 30), 4.3, 'unknown length: only rounded');
    const png = Buffer.alloc(40); Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png, 0); png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20);
    const meta = P.assetMetaOf([beat('b1', 0, 1, 'clip', { assets: ['a.mp4', 'p.png', 'gone.jpg'] })], (n) => (n === 'p.png' ? png : null), { 'a.mp4': { w: 1920, h: 1080 } });
    assert.deepEqual(meta, { 'a.mp4': { w: 1920, h: 1080 }, 'p.png': { w: 800, h: 600 } });
});

test('a credit names where the picture came from', () => {
    const rows = P.parseCsv(P.withCredit('', 'b1', 'b1-01.mp4', { title: 'Pexels video 42', creator: 'Ann', license: 'Pexels License', source: 'Pexels' }));
    assert.equal(rows[1][9], 'Pexels video 42 by Ann, Pexels License, via Pexels');
});

test('sound cues: whoosh as a card comes in, hit on titles, pops for stack cards, clicks for labels; never crowded', () => {
    const cues = P.sfxCuesOf([
        beat('b01', 0, 23, 'talking-head'),
        beat('b02', 23, 67, 'photo', { assets: ['a.jpg'], overlays: [{ type: 'date', text: '1873' }, { type: 'label', text: 'X' }] }),
        beat('b03', 67, 158, 'stack', { assets: ['a.jpg', 'b.jpg', 'c.jpg'] }),
        beat('b04', 158, 200, 'talking-head', { overlays: [{ type: 'title', text: 'Ep 93' }] }),
        beat('b05', 200, 260, 'title', { overlays: [{ type: 'title', text: 'Chasing', at: 4 }] })
    ], { fps: 30 });
    // b02 comes after the speaker, so its whoosh leads by 3 frames; its date clicks at +8; the stack's cards follow
    // straight on (no lead) and pop 9 frames apart; titles hit at their own `at`
    const kinds = cues.map(c => c.kind + '@' + c.frame);
    assert.deepEqual(kinds, ['whoosh@20', 'click@31', 'whoosh@67', 'pop@76', 'pop@85', 'hit@168', 'hit@204']);
    // the label at +12 (frame 35) was 4 frames after the date: the date's click stays
    assert.equal(cues.find(c => c.frame === 20).len, 11, 'a sound ends before the next one');
    assert.equal(cues.find(c => c.frame === 85).len, 14, 'and at its own cap');
    assert.equal(cues.find(c => c.frame === 204).len, 40);
});

test('lineKeywords finds years, names (not a sentence\'s first word) and content words', () => {
    const k = P.lineKeywords('a 2009 Supreme Court ruling called Penera versus COMELEC.');
    assert.deepEqual(k.years, ['2009']);
    assert.deepEqual(k.names, ['Supreme Court', 'Penera', 'COMELEC']);
    assert.ok(k.words.includes('ruling') && !k.words.includes('called'));
    assert.deepEqual(P.lineKeywords('Put up "Happy Fiesta," "Merry Christmas" or').names, ['Happy Fiesta', 'Merry Christmas']);
    assert.deepEqual(P.lineKeywords('Look at this tarpaulin.').names, []);
});

test('beatIdea: a year gives a date tag, a name a label, two names a stack, an action a clip only with a stock site', () => {
    assert.deepEqual(P.beatIdea('In 1953 the first wetsuit was sold').overlays, [{ type: 'date', text: '1953' }]);
    const named = P.beatIdea('he met Jacques Cousteau there');
    assert.equal(named.visual, 'photo');
    assert.deepEqual(named.queries, ['Jacques Cousteau']);
    assert.deepEqual(named.overlays, [{ type: 'label', text: 'JACQUES COUSTEAU' }]);
    assert.equal(P.beatIdea('Put up "Happy Fiesta," "Merry Christmas" or').visual, 'stack');
    assert.equal(P.beatIdea('people surfing in cold water').visual, 'photo');
    assert.equal(P.beatIdea('people surfing in cold water', { video: true }).visual, 'clip');
    assert.equal(P.beatIdea('so yeah it is what it is').score, 0);
    assert.ok(!P.beatIdea('This is 2028,').queries.some(q => /undefined/.test(q)));
});

test('autoPlanBeats joins subtitle pieces into thoughts, keeps the first beat and hand-set beats, caps coverage', () => {
    const t = (id, a, e, line, extra) => ({ ...beat(id, a, e, 'talking-head'), line, ...(extra || {}) });
    const beats = [
        t('b01', 0, 60, 'Look at this tarpaulin.'),
        t('b02', 60, 90, 'In 1953 the'),
        t('b03', 90, 150, 'first wetsuit was sold in California.'),
        t('b04', 150, 240, 'and it changed everything for surfers.'),
        beat('b05', 240, 300, 'photo', { line: 'hand made', queries: ['mine'] }),
        t('b06', 300, 390, 'Jacques Cousteau tested neoprene suits.')
    ];
    const r = P.autoPlanBeats(beats, { fps: 30, coverage: 0.5 });
    assert.deepEqual(r.beats.map(b => b.id), ['b01', 'b02', 'b04', 'b05', 'b06']);
    const b02 = r.beats.find(b => b.id === 'b02');
    assert.deepEqual(b02.frames, [60, 150]);
    assert.equal(b02.line, 'In 1953 the first wetsuit was sold in California.');
    assert.ok(!r.planned.includes('b01'));
    assert.deepEqual(r.beats.find(b => b.id === 'b05').queries, ['mine']);
    const covered = r.planned.reduce((n, id) => { const b = r.beats.find(x => x.id === id); return n + b.frames[1] - b.frames[0]; }, 0);
    assert.ok(covered <= 0.5 * (390 - 60));
    assert.ok(r.planned.includes('b02'));
});

test('autoPicks takes pictures in order, skips ones other beats use, 3 for a stack, the video for a clip', () => {
    const c = (file, title, video) => ({ file, title, video: video ? { duration: 9 } : undefined });
    const cands = [c('01.jpg', 'File:A.jpg'), c('02.jpg', 'File:B.jpg'), c('03.jpg', 'File:C.jpg'), c('04.jpg', 'File:D.jpg'), c('05.mp4', 'File:V.webm', true)];
    assert.deepEqual(P.autoPicks(cands, 'photo', ['A.jpg']), ['02.jpg']);
    assert.deepEqual(P.autoPicks(cands, 'stack', []), ['01.jpg', '02.jpg', '03.jpg']);
    assert.deepEqual(P.autoPicks(cands, 'clip', []), ['05.mp4']);
    assert.deepEqual(P.autoPicks([c('01.jpg', 'A.jpg')], 'photo', ['A.jpg']), ['01.jpg']);   // only one: reuse it
    assert.deepEqual(P.autoPicks([], 'photo', []), []);
});

test('evidencePlan highlights the said words, suggests blurs for names, hashtags and faces, keeps generic words', () => {
    const w = (text, x, y) => ({ text, box: [x, y, 0.1, 0.05] });
    const line = (words) => ({ text: words.map(x => x.text).join(' '), box: [words[0].box[0], words[0].box[1], words.length * 0.11, 0.05], words });
    const scan = {
        lines: [
            line([w('#RSGCares', 0.5, 0.05)]),
            line([w('HAPPY', 0.1, 0.2), w('FIESTA', 0.21, 0.2)]),
            line([w('BARANGAY', 0.1, 0.3)]),
            line([w('CULUBASA!', 0.1, 0.4)]),
            line([w('APRIL', 0.1, 0.5), w('5,', 0.21, 0.5), w('2026', 0.32, 0.5)]),
            line([w('MAYOR', 0.1, 0.6), w('RUDING', 0.21, 0.6), w('GONZALES', 0.32, 0.6)]),
            line([w('VOTE', 0.1, 0.7), w('FOR', 0.21, 0.7), w('ME', 0.32, 0.7)])
        ],
        faces: [[0.7, 0.4, 0.1, 0.1]]
    };
    const common = new Set(['happy', 'mayor', 'april', 'vote']);
    const r = P.evidencePlan(scan, { line: 'It says "Happy Fiesta." Not vote for me', common });
    assert.deepEqual(r.found.said, ['HAPPY FIESTA', 'VOTE FOR ME']);
    assert.deepEqual(r.found.blurred, ['#RSGCares', 'CULUBASA!', 'MAYOR RUDING GONZALES']);
    assert.equal(r.blurs.length, 4);                       // three lines and the face
    assert.ok(r.zoom && r.zoom[2] >= 0.25 && r.zoom[3] >= 0.25);
    const kept = P.evidencePlan(scan, { line: 'Happy Fiesta', common, keep: ['culubasa'] });
    assert.ok(!kept.found.blurred.includes('CULUBASA!'));
    assert.deepEqual(P.evidencePlan({ lines: [], faces: [] }, { line: 'x' }), { highlights: [], blurs: [], zoom: null, found: { said: [], blurred: [] } });
});

test('zoomFor goes to the biggest highlight and its neighbours, not every banner on a street photo', () => {
    const z = P.zoomFor([[0.05, 0.05, 0.2, 0.05], [0.5, 0.2, 0.4, 0.1], [0.5, 0.31, 0.3, 0.08]]);
    assert.ok(z[0] >= 0.4 && z[1] >= 0.1 && z[1] < 0.2, String(z));
    assert.equal(P.zoomFor([]), null);
});

test('renderBeats: a document is blurred where found only while Blur is on; drawn boxes always', () => {
    const d = (on) => ({ id: 'b1', visual: 'document', blurOn: on, blurAuto: [[0, 0, 0.1, 0.1]], blurBoxes: [[0.5, 0.5, 0.1, 0.1]] });
    assert.equal(P.renderBeats([d(false)])[0].blurs.length, 1);
    assert.equal(P.renderBeats([d(true)])[0].blurs.length, 2);
    assert.equal(P.renderBeats([{ id: 'b2', visual: 'photo' }])[0].blurs, undefined);
});
