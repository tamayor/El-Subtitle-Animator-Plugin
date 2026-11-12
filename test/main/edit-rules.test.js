// The editing rules for automated placements (src/main/edit-rules.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const env = require('../helpers/env');

const R = env.main('edit-rules');

test('the rules file lives in the data folder', () => {
    assert.equal(R.RULES_FILE, path.join(env.DATA_DIR, 'edit-rules.json'));
});

test('cleaning the defaults changes nothing, and cleaning is repeatable', () => {
    const d = R.defaultRules();
    assert.deepEqual(R.cleanRules(d), d);
    const messy = { allowedTags: [' 🔥 ', '', 'money'], tagMatch: 'all', color: 'FFF', track: { mode: 'fixed', fixed: 1 }, text: { maxSize: 5 } };
    assert.deepEqual(R.cleanRules(R.cleanRules(messy)), R.cleanRules(messy));
});

test('cleanRules turns anything it is given into a valid set of rules', () => {
    for (const junk of [null, undefined, 'x', 42, []]) assert.deepEqual(R.cleanRules(junk), R.defaultRules());
    const r = R.cleanRules({
        allowedTags: [' 🔥 ', '', 'money'], tagMatch: 'all', font: { font: ' Poppins ', style: '' }, color: 'FFF',
        emphasis: { color: '#FF0000' }, styleShare: { normal: 250, emphasis: 'x' },
        styleExcept: { normal: { tags: ['money'], keep: 'colour' }, emphasis: { tags: [] } },
        track: { mode: 'sideways', fixed: 1, from: 5, to: 3 },
        position: { defaultZone: 'nowhere', safeTop: 0.9, avoidFaces: false },
        multitext: { emphasis: 'middle', uppercaseEmphasis: 1 },
        text: { maxSize: 5, lineSpacing: '' }, sound: false, notes: 'x'.repeat(5000)
    });
    assert.deepEqual(r.allowedTags, ['🔥', 'money']);
    assert.equal(r.tagMatch, 'all');
    assert.deepEqual(r.font, { font: 'Poppins', style: null });
    assert.equal(r.color, '#ffffff');
    assert.deepEqual(r.emphasis, { font: null, style: null, color: '#ff0000' });
    assert.deepEqual(r.styleShare, { normal: 100, emphasis: 100 });
    assert.deepEqual(r.styleExcept, { normal: { tags: ['money'], keep: 'color' }, emphasis: null });
    assert.deepEqual(r.track, { mode: 'top', fixed: 2, from: 5, to: 5 }, 'V1 is never a caption layer; the range never ends below its start');
    assert.equal(r.position.defaultZone, null);
    assert.equal(r.position.safeTop, 0.5);
    assert.equal(r.position.avoidFaces, false);
    assert.deepEqual(r.multitext, { emphasis: 'auto', uppercaseEmphasis: true });
    assert.deepEqual(r.text, { maxSize: 1, lineSpacing: null });
    assert.equal(r.sound, false);
    assert.equal(r.notes.length, 4000);
});

test('rules are saved and read back from edit-rules.json, and a broken file gives the defaults', () => {
    const saved = R.saveRules({ color: '#123456', notes: 'keep it calm' });
    assert.equal(saved.color, '#123456');
    assert.equal(JSON.parse(fs.readFileSync(R.RULES_FILE, 'utf8')).notes, 'keep it calm');
    assert.deepEqual(R.loadRules(), saved);
    fs.writeFileSync(R.RULES_FILE, '{ not json');
    assert.deepEqual(R.loadRules(), R.defaultRules());
    fs.rmSync(R.RULES_FILE);
    assert.deepEqual(R.loadRules(), R.defaultRules());
});

test('highlight box and row requests are null when nothing would change', () => {
    assert.equal(R.highlightReq({ auto: false }), null);
    assert.equal(R.highlightReq({ auto: false, width: 1, height: 1, x: 0, y: 0 }), null);
    assert.equal(R.highlightReq(null).auto, true);   // balanced, tight box by default
    assert.deepEqual(R.highlightReq({ auto: false, width: 9, y: -0.1 }), { auto: false, width: 4, height: 1, x: 0, y: -0.1 });
    assert.deepEqual(R.cleanHighlight({ auto: 1, width: '', height: null }), { auto: true, width: 1, height: 1, x: 0, y: 0 });
    assert.deepEqual(R.rowsReq(null, null), { gap: 0 });   // rows touching by default
    assert.deepEqual(R.cleanRows({ gap: '2', justify: 'LEFT' }), { gap: 2, justify: 'left' });
    assert.deepEqual(R.cleanRows({ gap: 99, justify: 'diagonal' }), { gap: 6, justify: null });
});

test('a placement\'s own row settings beat the rules', () => {
    assert.deepEqual(R.rowsReq({ gap: 1, justify: 'center' }, { gap: 0.5, link: 0, upper: { x: 9, y: 'no' }, lower: {} }),
        { gap: 0.5, justify: 'center', link: false, upper: { x: 2 } });
});

test('takeShare gives the override to the asked share of clips, spread evenly', () => {
    assert.equal(R.takeShare('normal', 100), true);
    assert.equal(R.takeShare('normal', 0), false);
    assert.equal(R.takeShare('normal', undefined), true);
    const peeked = R.takeShare('emphasis', 50, true);
    assert.equal(R.takeShare('emphasis', 50, true), peeked, 'peeking does not count the clip');
    const half = Array.from({ length: 20 }, () => R.takeShare('emphasis', 50));
    assert.equal(half.filter(Boolean).length, 10);
    assert.ok(!half.some((v, i) => i > 0 && v === half[i - 1]), 'every other clip');
    const fifth = Array.from({ length: 20 }, () => R.takeShare('normal', 20));
    assert.equal(fifth.filter(Boolean).length, 4);
});

test('withFillColor makes shading element 1 a solid fill without touching the design it was given', () => {
    const design = { size: 0.1, elements: [{ index: 2, color: '#000000' }, { index: 1, type: 2, color: '#ff0000', color2: '#00ff00' }] };
    const out = R.withFillColor(design, '#ffffff');
    assert.deepEqual(out.elements[1], { index: 1, type: 0, color: '#ffffff', color2: '#00ff00', enabled: true, modified: true });
    assert.equal(design.elements[1].color, '#ff0000');
    assert.equal(R.withFillColor(design, null), design);
    assert.deepEqual(R.withFillColor(null, '#fff').elements, [{ index: 1, color: '#fff', type: 0, enabled: true, modified: true }]);
});

test('withGradientFill only recolours a fill that is a gradient', () => {
    const gradient = { elements: [{ index: 1, type: 2, color: '#ff0000', color2: '#00ff00', stop1: 0.2, stop2: 0.8 }] };
    const solid = { elements: [{ index: 1, type: 0, color: '#ff0000' }] };
    const g = { enabled: true, top: null, bottom: '#0000ff', topStop: 0.9, bottomStop: 0.5 };
    assert.equal(R.withGradientFill(solid, g, '#ffffff'), null);
    assert.equal(R.withGradientFill(gradient, Object.assign({}, g, { enabled: false }), '#ffffff'), null);
    const el = R.withGradientFill(gradient, g, '#ffffff').elements[0];
    assert.equal(el.color, '#ffffff', 'an unset top takes the text style colour');
    assert.equal(el.color2, '#0000ff');
    assert.deepEqual([el.stop1, el.stop2], [0.9, 0.9], 'the bottom stop never sits above the top stop');
    assert.equal(gradient.elements[0].color, '#ff0000');
});

test('named zones are positions down the frame', () => {
    assert.deepEqual(Object.keys(R.ZONES), ['top', 'upper', 'center', 'lower', 'bottom']);
    assert.ok(Object.values(R.ZONES).every((v, i, a) => v > 0 && v < 1 && (i === 0 || v > a[i - 1])));
});
