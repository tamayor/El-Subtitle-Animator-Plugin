// Spotlight (src/main/spotlight.js): the default word and the word's size / height from the matte and the font.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../helpers/env');

const SP = env.main('spotlight');
const { EFFECTS, ORDER, _makers } = env.main('effect-presets');

test('the default word: a name mid-sentence beats a long filler word', () => {
    assert.equal(SP.pickWord('So I asked Claude about it yesterday'), 'Claude');
    assert.equal(SP.pickWord('this is really important'), 'important');
    assert.equal(SP.pickWord('we made $40,000 that month'), '$40,000');
    assert.equal(SP.pickWord(''), '');
});

// DM Serif Display Italic "CLAUDE", measured: width 1.1466, cap 0.2119 per unit of (Size x frame height)
const M = { width: 1.1466, cap: 0.2119, top: 0.0058 };

test('auto size fills the width; auto height hides `overlap` % of the capitals behind the head', () => {
    const s = Object.assign({}, SP.DEFAULTS, { word: 'CLAUDE' });
    const r = SP.layout(s, { headTop: 0.2 }, M, 1080, 1920);
    const wordW = M.width * r.size * 1920;
    assert.ok(Math.abs(wordW - 0.86 * 1080) < 1, 'fills 86% of the width');
    const cap = M.cap * r.size * 1920;
    const bottom = r.cy * 1920 + cap / 2;
    assert.ok(Math.abs(bottom - (0.2 * 1920 + SP.DEFAULTS.overlap / 100 * cap)) < 0.5, 'baseline overlap % of a capital below the head top');
    assert.equal(r.cx, 0.5);
});

test('the word never leaves the top of the frame, and given size / y win', () => {
    const r = SP.layout(Object.assign({}, SP.DEFAULTS), { headTop: 0.01 }, M, 1080, 1920);
    const cap = M.cap * r.size * 1920;
    assert.ok(r.cy * 1920 - cap / 2 >= 0.05 * 1920 - 1e-6);
    const g = SP.layout(Object.assign({}, SP.DEFAULTS, { size: 0.3, y: 0.4, x: 0.45 }), { headTop: 0.2 }, M, 1080, 1920);
    assert.deepEqual([g.size, g.cy, g.cx], [0.3, 0.4, 0.45]);
});

test('Spotlight is a card but never stacked onto a clip by place / fx_set, and its template has the tools the bridge keys', () => {
    const e = EFFECTS.find(x => x.id === 'Spotlight');
    assert.ok(e && e.spot && !e.hidden);
    assert.ok(!ORDER.includes('Spotlight'));
    const t = _makers.Spotlight();
    for (const n of ['SpotWord', 'SpotWordBlur', 'SpotXf', 'SpotGlowBlur', 'SpotGlowTint', 'SpotGlowM', 'SpotWordM', 'SpotDim', 'SpotVigBg', 'SpotOut']) assert.match(t, new RegExp('\\b' + n + ' = '));
    assert.match(t, /MainInput1 = InstanceInput \{\s*SourceOp = "SpotOut",\s*Source = "Foreground"/);
});
