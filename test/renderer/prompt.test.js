// The Prompt tab's text format (src/renderer/js/library/prompt/parser.js, prompt/migrations.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JS_DIR, loadPanelScripts } = require('../helpers/renderer');

const plain = (v) => JSON.parse(JSON.stringify(v));
const P = loadPanelScripts(['core/color.js', 'library/prompt/parser.js', 'library/prompt/migrations.js']);

// The built-in job prompt, as the panel builds it (prompt/default.js DEFAULT_JOB_PROMPT, which uses HIGHLIGHT_NOTE).
function builtInPrompt() {
    const src = fs.readFileSync(path.join(JS_DIR, 'library', 'prompt', 'default.js'), 'utf8');
    const a = src.indexOf('const DEFAULT_JOB_PROMPT = `');
    const b = src.indexOf('`;', a);
    assert.ok(a >= 0 && b > a, 'DEFAULT_JOB_PROMPT found in prompt/default.js');
    return vm.runInContext('(' + src.slice(a + 'const DEFAULT_JOB_PROMPT = '.length, b + 1) + ')', P);
}

test('the built-in prompt parses into sections, and Builder <-> Text round-trips without changing it again', () => {
    const text = builtInPrompt();
    const doc = P.parseJobPrompt(text);
    assert.ok(doc, 'has a SETTINGS block');
    assert.ok(doc.sections.length >= 3, 'several sections');
    for (const s of doc.sections) assert.ok(s.title && Array.isArray(s.rows));
    const once = P.serializeJobPrompt(doc);
    const twice = P.serializeJobPrompt(P.parseJobPrompt(once));
    assert.equal(twice, once, 'serialize(parse(x)) is stable');
    assert.ok(once.includes(doc.post.trim().slice(0, 40)), 'the text after SETTINGS is kept');
});

test('rows: key, separator, value, notes and if-conditions', () => {
    const text = [
        '# Job', '## SETTINGS', 'TEXT STYLE', '  COLOR:     #ffffff', '    a note line', '    if money → #ffd400',
        '  BOX → on', 'PRESETS', '  Drop Pump: emphasis', '', '## RULES', 'rest'
    ].join('\n');
    const doc = P.parseJobPrompt(text);
    assert.deepEqual(plain(doc.sections.map(s => s.title)), ['TEXT STYLE', 'PRESETS']);
    const [color, box] = doc.sections[0].rows;
    assert.deepEqual(plain(color), { key: 'COLOR', sep: ':', value: '#ffffff', note: 'a note line', conds: [{ if: 'money', then: '#ffd400' }] });
    assert.deepEqual(plain(box), { key: 'BOX', sep: '→', value: 'on', note: '', conds: [] });
    assert.equal(doc.pre, '# Job\n## SETTINGS');
    assert.equal(doc.post, '## RULES\nrest');
    assert.equal(P.parseJobPrompt('no settings here'), null);
});

test('track ranges and the audio track', () => {
    assert.deepEqual(plain(P.pbParseRange('V3–V6')), { from: 3, to: 6 });
    assert.deepEqual(plain(P.pbParseRange('3 to 2')), { from: 3, to: 3 }, 'a To below From becomes From');
    assert.deepEqual(plain(P.pbParseRange('V2–∞')), { from: 2, to: null });
    assert.deepEqual(plain(P.pbParseRange('V4')), { from: 4, to: 4 });
    assert.equal(P.pbParseRange('4–5 or so'), null);
    assert.deepEqual(plain(P.pbParseTrackRange('V1–V3')), { from: 2, to: 3 }, 'clip tracks start at V2');
    assert.equal(P.pbJoinRange('V', 3, null), 'V3–∞');
    assert.deepEqual(plain(P.pbParseAudio('any free track')), { mode: 'any', from: null, to: null });
    assert.deepEqual(plain(P.pbParseAudio('same as clip track')), { mode: 'same', from: null, to: null });
    assert.deepEqual(plain(P.pbParseAudio('A2–A4')), { mode: 'own', from: 2, to: 4 });
    for (const t of ['any free track', 'same as clip track', 'A2–A4', 'A3–∞']) assert.equal(P.pbJoinAudio(P.pbParseAudio(t)), t);
});

test('lists, highlight box and font names', () => {
    assert.deepEqual(plain(P.pbSplitList('A · B · C  (vary them)')), { items: ['A', 'B', 'C'], extra: '(vary them)' });
    assert.deepEqual(plain(P.pbSplitList('Pop · lower words')), { items: ['Pop'], extra: 'lower words' });
    assert.equal(P.pbJoinList(['A', 'B'], '(x)'), 'A · B  (x)');
    const h = P.pbParseHighlight('auto · width 1.20 · height 0.90 · x 0.010 · y -0.020');
    assert.deepEqual(plain(h), { auto: true, width: 1.2, height: 0.9, x: 0.01, y: -0.02 });
    assert.equal(P.pbJoinHighlight(h), 'auto · width 1.20 · height 0.90 · x 0.010 · y -0.020');
    assert.equal(P.pbParseHighlight('bigger please'), null);
    assert.deepEqual(plain(P.pbSplitFont('Larken Black', ['Larken', 'Poppins'])), { family: 'Larken', style: 'Black' });
    assert.deepEqual(plain(P.pbSplitFont('Open Sans SemiBold', [])), { family: 'Open Sans', style: 'SemiBold' });
    assert.deepEqual(plain(P.pbSplitFont("keep each preset's font")), { family: "keep each preset's font", style: '' });
});

test('text style: pairs, override share and exceptions survive a round trip', () => {
    const v = 'Poppins Bold, #ffffff · Larken Black, yellow (MultiText) · override 60% · except money, danger (keep colour)';
    const st = P.pbParseStyle(v);
    assert.deepEqual(plain(st.pairs), [
        { font: 'Poppins Bold', color: '#ffffff', on: 'both' },
        { font: 'Larken Black', color: '#ffd400', on: 'multitext' }
    ]);
    assert.equal(st.share, 60);
    assert.deepEqual(plain(st.except), { tags: ['money', 'danger'], keep: 'color' });
    const joined = P.pbJoinStyle(st.pairs, st.share, st.except);
    assert.equal(joined, 'Poppins Bold, #ffffff · Larken Black, #ffd400 (MultiText) · override 60% · except money, danger (keep colour)');
    assert.deepEqual(plain(P.pbParseStyle(joined)), plain(P.pbParseStyle(joined)), 'stable');
    assert.equal(P.pbParseStyle('Poppins — forced on DEFAULT presets only').extra, 'forced on DEFAULT presets only');
});

test('migrations add their section / row once and leave everything else as it was', () => {
    const old = ['# Job', '## SETTINGS', 'TEXT STYLE', '  EMPHASIS:  Larken Black', '    note', '', '## RULES', 'r'].join('\n');
    const t1 = P.withTrimmingSection(old);
    assert.ok(/^SUBTITLE TRIMMING$/m.test(t1));
    assert.ok(t1.indexOf('SUBTITLE TRIMMING') < t1.indexOf('## RULES'), 'inside SETTINGS');
    assert.equal(P.withTrimmingSection(t1), t1, 'only once');
    const t2 = P.withHighlightRow(old);
    const lines = t2.split('\n');
    assert.equal(lines[lines.findIndex(l => /EMPHASIS/.test(l)) + 2].trim().slice(0, 14), 'HIGHLIGHT_BOX:', 'under EMPHASIS and its note');
    assert.equal(P.withHighlightRow(t2), t2, 'only once');
    assert.equal(P.withTrimmingSection('no settings'), 'no settings');
    assert.equal(t2.replace(/\n\s+HIGHLIGHT_BOX:.*\n.*\n/, '\n'), old, 'nothing else changed');
});
