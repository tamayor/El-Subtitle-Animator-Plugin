// Reading and rewriting Fusion .setting files (src/main/fusion-setting.js), on small hand-written presets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const env = require('../helpers/env');

const F = env.main('fusion-setting');
const FIXTURES = path.join(__dirname, '..', 'fixtures');
const TEXT_PLUS = path.join(FIXTURES, 'text-plus.setting');
const MULTITEXT = path.join(FIXTURES, 'multitext.setting');

test('detectNodes finds a top-level Text+ with its text, position and size', () => {
    assert.deepEqual(F.detectNodes(TEXT_PLUS), [{
        id: 'Template', kind: 'textplus', tool: 'Template', input: 'StyledText', centerInput: 'Center', canMove: true,
        label: 'Text+ · Template', defaultText: 'Hello "world"\nline {two}', cx: 0.5, cy: 0.25, size: 0.12
    }]);
});

test('detectNodes lists one node per MultiText layer, with defaults for a layer that only has a switch', () => {
    const nodes = F.detectNodes(MULTITEXT);
    assert.deepEqual(nodes.map(n => [n.id, n.kind, n.layerName, n.defaultText, n.cx, n.cy, n.size]), [
        ['Template/Text1', 'multitext', 'Upper', 'the quick', 0.5, 0.6, 0.06],
        ['Template/Text2', 'multitext', 'Emphasis', 'BROWN FOX', 0.5, 0.5, 0.11],
        ['Template/Text3', 'multitext', 'Text 3', 'Text 3', 0.5, 0.5, 0.08]
    ]);
    assert.equal(nodes[1].input, 'Text2.StyledText');
});

test('detectNodes answers an empty list for a missing file or no file', () => {
    assert.deepEqual(F.detectNodes(path.join(FIXTURES, 'nope.setting')), []);
    assert.deepEqual(F.detectNodes(''), []);
});

test('presetText reads a file once per version and derived() keeps what was worked out from it', () => {
    const file = path.join(env.DATA_DIR, 'cache-test.setting');
    fs.writeFileSync(file, 'one');
    const a = F.presetText(file);
    assert.equal(a.text, 'one');
    assert.equal(F.presetText(file), a, 'same version: the same cache entry');
    let made = 0;
    const make = (raw) => { made++; return raw.length; };
    assert.equal(F.derived(file, 'len', make), 3);
    assert.equal(F.derived(file, 'len', make), 3);
    assert.equal(made, 1);
    fs.writeFileSync(file, 'longer text');
    assert.equal(F.derived(file, 'len', make), 11, 'a changed file is read again');
    assert.equal(F.presetText(path.join(env.DATA_DIR, 'gone.setting')), null);
    assert.equal(F.derived(path.join(env.DATA_DIR, 'gone.setting'), 'len', (raw) => raw), null);
});

test('blockEnd finds the closing brace and skips braces inside strings', () => {
    const s = 'A = { B = "x } y", C = { 1 } } tail';
    assert.equal(s[F.blockEnd(s, s.indexOf('{'))], '}');
    assert.equal(s.slice(F.blockEnd(s, s.indexOf('{')) + 1), ' tail');
});

test('expandAllTools opens and shows every tool in the Inspector, and changes nothing the second time', () => {
    const raw = fs.readFileSync(TEXT_PLUS, 'utf8');
    const out = F.expandAllTools(raw);
    assert.match(out, /Template = TextPlus \{\s*CtrlWZoom = true,/);
    assert.match(out, /Glow1 = SoftGlow \{ CtrlWZoom = true,\s*CtrlWShown = true,/);
    assert.ok(!/CtrlWZoom = false|CtrlWShown = false/.test(out));
    assert.ok(out.includes('StyledText = Input { Value = "Hello \\"world\\"\\nline {two}", }'), 'text with braces is left alone');
    assert.equal(F.expandAllTools(out), out);
});

test('copyPreset stores the preset expanded and leaves the source file untouched', () => {
    const before = fs.readFileSync(TEXT_PLUS, 'utf8');
    const dst = path.join(env.DATA_DIR, 'copied.setting');
    assert.equal(F.copyPreset(TEXT_PLUS, dst), dst);
    assert.equal(fs.readFileSync(TEXT_PLUS, 'utf8'), before);
    const stored = fs.readFileSync(dst, 'utf8');
    assert.ok(!/CtrlWZoom = false|CtrlWShown = false/.test(stored));
    assert.equal(F.detectNodes(dst)[0].defaultText, 'Hello "world"\nline {two}');
    assert.equal(F.expandToolsInFile(dst), dst);
    assert.equal(fs.readFileSync(dst, 'utf8'), stored, 'saving again changes nothing');
});

test('parseTextStyle reads font, style and size and lets a saved design override them on a copy', () => {
    const style = F.parseTextStyle(TEXT_PLUS, null);
    assert.equal(style.font, 'Poppins');
    assert.equal(style.style, 'ExtraBold');
    assert.equal(style.size, 0.12);
    const custom = F.parseTextStyle(TEXT_PLUS, { font: 'Inter' });
    assert.equal(custom.font, 'Inter');
    assert.equal(F.parseTextStyle(TEXT_PLUS, null).font, 'Poppins', 'the cached file parse is not changed by a merge');
});
