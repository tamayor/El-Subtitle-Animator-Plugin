// B-roll suggestions (src/main/broll.js): subtitles -> effect + props, read from the words. The registry is the real
// broll/effects.json, so a trigger that stops matching shows up here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const env = require('../helpers/env');

const { brollSuggestFromTexts, findWordHit } = env.main('broll');
const REG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'broll', 'effects.json'), 'utf8'));
const FPS = 25;
const sub = (index, text, sec) => ({ index, text, start: Math.round(sec * FPS), end: Math.round((sec + 2) * FPS) });

test('every effect has a unique id and typed fields with defaults', () => {
    const ids = new Set();
    for (const e of REG.effects) {
        assert.ok(!ids.has(e.id), 'duplicate id ' + e.id); ids.add(e.id);
        for (const f of [...REG.common, ...e.fields]) {
            assert.ok(['text', 'number', 'color', 'bool', 'list', 'select', 'image'].includes(f.type), e.id + '.' + f.key + ' type');
            assert.ok('default' in f, e.id + '.' + f.key + ' default');
            if (f.type === 'select') assert.ok(Array.isArray(f.options) && f.options.includes(f.default), e.id + '.' + f.key + ' options hold the default');
        }
        assert.ok(e.group, e.id + ' group');
        for (const t of e.triggers || []) assert.doesNotThrow(() => new RegExp(t, 'i'), e.id + ' trigger ' + t);
    }
});

test('money, comments, days and posts get the right effect and props', () => {
    const out = brollSuggestFromTexts([
        sub(1, 'I made $174,953 last year', 0),
        sub(2, 'Comment EDIT and I will send it', 6),
        sub(3, 'I do this every day', 12),
        sub(4, 'I uploaded 1,403 videos', 18)
    ], { max: 10, minGap: 1 }, REG, FPS);
    const by = Object.fromEntries(out.map(s => [s.subtitle, s]));
    assert.equal(by[1].effect, 'money-counter');
    assert.equal(by[1].props.value, 174953);
    assert.equal(by[1].props.prefix, '$');
    assert.equal(by[2].effect, 'comment-drop');
    assert.equal(by[2].props.keyword, 'EDIT');
    assert.equal(by[3].effect, 'day-dial');
    assert.equal(by[3].props.word, 'day');
    assert.equal(by[4].effect, 'post-wall');
    assert.equal(by[4].props.count, 1403);
});

test('suggestions keep the gap, the cap and time order', () => {
    const subs = [];
    for (let i = 0; i < 12; i++) subs.push(sub(i + 1, 'We hit $' + (i + 1) + '0K in sales', i));
    const out = brollSuggestFromTexts(subs, { max: 3, minGap: 4 }, REG, FPS);
    assert.ok(out.length <= 3);
    for (let i = 1; i < out.length; i++) assert.ok(out[i].start - out[i - 1].start >= 4 * FPS);
    assert.deepEqual(out.map(s => s.start), [...out.map(s => s.start)].sort((a, b) => a - b));
});

test('a line with nothing to show gets nothing', () => {
    assert.equal(brollSuggestFromTexts([sub(1, 'and that is why I think so', 0)], {}, REG, FPS).length, 0);
});

test('new auto-generated effects match and extract props from subtitles', () => {
    const out = brollSuggestFromTexts([
        sub(1, 'Use DaVinci Resolve instead of Premiere', 0),
        sub(2, '73% of viewers drop off early', 6),
        sub(3, 'The secret is pacing', 12),
        sub(4, 'That is a total myth about hashtags', 18),
        sub(5, 'Everything changed in 2020', 24),
        sub(6, 'Press Command K to open it', 30),
        sub(7, 'Go to remotion.dev right now', 36),
        sub(8, 'Remember this: "Simplicity beats complexity"', 42),
        sub(9, 'Literally focus on storytelling', 48)
    ], { max: 20, minGap: 1 }, REG, FPS);
    const by = Object.fromEntries(out.map(s => [s.subtitle, s]));
    assert.equal(by[1].effect, 'versus-split');
    assert.equal(by[1].props.left, 'Premiere');
    assert.equal(by[1].props.right, 'Use DaVinci Resolve');
    assert.equal(by[1].props.strikeLeft, true);
    assert.equal(by[2].effect, 'stat-bar');
    assert.equal(by[2].props.percent, 73);
    assert.equal(by[3].effect, 'marker-highlight');
    assert.equal(by[3].props.redact, true);
    assert.equal(by[4].effect, 'stamp-verdict');
    assert.equal(by[4].props.verdict, 'MYTH');
    assert.equal(by[4].props.isTrue, false);
    assert.equal(by[5].effect, 'year-timeline');
    assert.equal(by[5].props.year, 2020);
    assert.equal(by[6].effect, 'key-combo');
    assert.deepEqual(by[6].props.keys, ['⌘', 'K']);
    assert.equal(by[7].effect, 'url-bar');
    assert.equal(by[7].props.url, 'remotion.dev');
    assert.equal(by[8].effect, 'quote-card');
    assert.equal(by[8].props.body, 'Simplicity beats complexity');
    assert.equal(by[9].effect, 'sketch-words');
    assert.equal(by[9].props.word, 'storytelling');
});

test('findWordHit matches spoken number words like sixteen hundred -> 1600 before clients', () => {
    const words = [
        { w: 'over', start: 0, end: 6 },
        { w: 'sixteen', start: 6, end: 16 },
        { w: 'hundred', start: 16, end: 26 },
        { w: 'clients', start: 26, end: 40 }
    ];
    const hit = findWordHit(words, '1600');
    assert.ok(hit);
    assert.equal(hit.w, 'sixteen hundred');
    assert.equal(hit.start, 6);
    assert.equal(hit.end, 26);
});

test('the 2026-11-13 effects match and extract props from subtitles', () => {
    const lines = [
        'Half of creators quit in year one',
        'We went from 10k in Jan to 45k in Mar',
        'Tip number 3 is the big one',
        'My name is Sarah Lim, founder of Studio North',
        'According to Bloomberg, most startups fail',
        'Breaking news: the algorithm changed',
        'Here is the thing: consistency beats talent',
        'Note to self, start before you feel ready',
        'I had this idea at midnight',
        'That reel went viral overnight',
        'Before and after the colour grade',
        'It was all over the news that week',
        'Look at this part of the frame'
    ];
    const out = brollSuggestFromTexts(lines.map((t, i) => sub(i + 1, t, i * 6)), { max: 30, minGap: 1 }, REG, FPS);
    const by = Object.fromEntries(out.map(s => [s.subtitle, s]));
    assert.equal(by[1].effect, 'ring-gauge'); assert.equal(by[1].props.percent, 50);
    assert.equal(by[2].effect, 'mini-chart'); assert.deepEqual(by[2].props.points, ['Jan | 10', 'Mar | 45']); assert.equal(by[2].props.suffix, 'K');
    assert.equal(by[3].effect, 'step-badge'); assert.equal(by[3].props.number, 3); assert.equal(by[3].props.word, 'Tip');
    assert.equal(by[4].effect, 'lower-third'); assert.equal(by[4].props.name, 'Sarah Lim'); assert.equal(by[4].props.role, 'founder of Studio North');
    assert.equal(by[5].effect, 'lower-third'); assert.equal(by[5].props.source, 'Bloomberg');
    assert.equal(by[6].effect, 'news-ticker'); assert.equal(by[6].props.headline, 'the algorithm changed');
    assert.equal(by[7].effect, 'pull-quote'); assert.equal(by[7].props.quote, 'consistency beats talent');
    assert.equal(by[8].effect, 'journal-note'); assert.deepEqual(by[8].props.lines, ['start before you feel', 'ready']);
    assert.equal(by[9].effect, 'doodle-icon'); assert.equal(by[9].props.icon, 'lightbulb');
    assert.equal(by[10].effect, 'sticker-pop'); assert.equal(by[10].props.icon, 'fire');
    assert.equal(by[11].effect, 'before-after-wipe');
    assert.equal(by[12].effect, 'headline-wall');
    assert.equal(by[13].effect, 'doodle-callout');
});

test('"I\'m" only makes a lower third when a name follows', () => {
    const out = brollSuggestFromTexts([sub(1, "I'm not sure that works", 0), sub(2, "and I'm going to show you", 6)], { max: 5, minGap: 1 }, REG, FPS);
    assert.equal(out.filter(s => s.effect === 'lower-third').length, 0);
});
