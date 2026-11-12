// B-roll suggestions (src/main/broll.js): subtitles -> effect + props, read from the words. The registry is the real
// broll/effects.json, so a trigger that stops matching shows up here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const env = require('../helpers/env');

const { brollSuggestFromTexts } = env.main('broll');
const REG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'broll', 'effects.json'), 'utf8'));
const FPS = 25;
const sub = (index, text, sec) => ({ index, text, start: Math.round(sec * FPS), end: Math.round((sec + 2) * FPS) });

test('every effect has a unique id and typed fields with defaults', () => {
    const ids = new Set();
    for (const e of REG.effects) {
        assert.ok(!ids.has(e.id), 'duplicate id ' + e.id); ids.add(e.id);
        for (const f of [...REG.common, ...e.fields]) {
            assert.ok(['text', 'number', 'color', 'bool', 'list', 'select'].includes(f.type), e.id + '.' + f.key + ' type');
            assert.ok('default' in f, e.id + '.' + f.key + ' default');
        }
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
