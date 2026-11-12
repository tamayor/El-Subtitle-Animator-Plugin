// The Create tab's boilerplate presets (src/boilerplates/, src/main/boilerplates.js, tools/gen-boilerplates.py).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const env = require('../helpers/env');

const B = env.main('boilerplates');
const T = env.main('title-templates');

test('both boilerplates are listed and their files exist', () => {
    const list = B.boilerplateList();
    assert.deepEqual(list.map(b => b.id), ['text', 'multitext']);
    for (const b of list) assert.ok(fs.existsSync(b.path), b.path);
});

test('the boilerplate titles are the ones title-templates keeps when it prunes', () => {
    const list = B.boilerplateList();
    assert.deepEqual(list.map(b => b.title).sort(), [...T.BOILERPLATE_TITLES].sort());
    for (const b of list) assert.ok(T.isTitleClipName(b.title), b.title + ' must look like a title clip name');
});

test('each boilerplate is the kind it says it is', () => {
    for (const b of B.boilerplateList()) assert.equal(T.titleKindFor(b.path), b.kind, b.title);
});

test('the Text+ boilerplate keeps the preset structure with a plain fade-in', () => {
    const s = fs.readFileSync(B.boilerplateList()[0].path, 'utf8');
    for (const tool of ['Template = TextPlus', 'AnimTime = TimeStretcher', 'Follower1 = StyledTextFollower', 'Follower1Opacity1 = BezierSpline', 'MediaOut1 = Saver']) {
        assert.ok(s.includes(tool), tool);
    }
    assert.ok(s.includes('AnimFrames') && s.includes('AnimNatural'), 'the Animation Frames retiming is in');
    assert.ok(!/WordSize/.test(s), 'the Cascade word-size animation is gone');
    assert.match(s, /Boilerplate text/);
});

test('the MultiText boilerplate keeps rows, timing ranges, row and box controls', () => {
    const s = fs.readFileSync(B.boilerplateList()[1].path, 'utf8');
    for (const part of ['Template = MultiText', 'UpperFollower', 'EmphasisFollower', 'LowerFollower', 'Highlight = TextPlus', 'Seg1Start', 'Seg3End', 'RowGap', 'HighlightWidth']) {
        assert.ok(s.includes(part), part);
    }
});

test('detectSegments reads a keyframed MultiText row into its Seg range and leaves other rows alone', () => {
    const { detectSegments } = env.main('retime');
    const file = B.boilerplateList()[1].path;
    let s = fs.readFileSync(file, 'utf8');
    assert.equal(detectSegments(s), s, 'no keyframes: unchanged');
    const spline = '\t\tEmphasisFollowerOpacity1 = BezierSpline {\n\t\t\tKeyFrames = {\n\t\t\t\t[5] = { 0 },\n\t\t\t\t[21] = { 1 }\n\t\t\t}\n\t\t},\n';
    const at = s.indexOf('\t\tEmphasisFollower = StyledTextFollower {');
    s = s.slice(0, at) + spline + s.slice(at);
    s = s.replace(/(EmphasisFollower = StyledTextFollower \{[\s\S]*?)Opacity1 = Input \{[^\n]*\n/, '$1Opacity1 = Input { SourceOp = "EmphasisFollowerOpacity1", Source = "Value", },\n');
    const out = detectSegments(s);
    assert.match(out, /Seg2Start = Input \{ Value = 5, \}/);
    assert.match(out, /Seg2End = Input \{ Value = 21, \}/);
    assert.match(out, /Seg1Start = Input \{ Value = 0, \}/);
    assert.match(out, /Seg3End = Input \{ Value = 44, \}/);
});
