// B-roll vibes (broll-vibe.js): the MCP `vibe` argument -> the props the renderer reads. No Resolve.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { vibeArgs, applyVibe, vibeList, cleanTokens, MOTIONS } = require('../../src/main/broll-vibe');

const VIBES = JSON.parse(fs.readFileSync(path.join(__dirname, '../../broll/vibes.json'), 'utf8')).vibes;
const MATCHA = '#8ccf8e';

test('vibes.json: the default comes first and every starter has the same shape', () => {
    assert.strictEqual(VIBES[0].id, 'classic');
    const keys = (o) => Object.keys(o).filter(k => k !== 'preferDark' && k !== 'hardShadow').sort().join();
    for (const v of VIBES) {
        assert.strictEqual(keys(v), keys(VIBES[0]), v.id);
        assert.strictEqual(keys(v.font), keys(VIBES[0].font), v.id + ' font');
        assert.strictEqual(keys(v.motion), keys(VIBES[0].motion), v.id + ' motion');
        assert.match(v.accent, /^#[0-9a-f]{6}$/i);
        assert.match(v.light.ink, /^#[0-9a-f]{6}$/i);
        assert.match(v.dark.ink, /^#[0-9a-f]{6}$/i);
    }
});

test('vibeArgs: a starter id, any spelling of it, and none', () => {
    assert.strictEqual(vibeArgs(undefined, VIBES), null);
    assert.deepStrictEqual(vibeArgs('clean-glass', VIBES), { vibe: 'clean-glass', _vibe: null });
    assert.deepStrictEqual(vibeArgs('Bold Pop', VIBES), { vibe: 'bold-pop', _vibe: null });
    assert.throws(() => vibeArgs('neon', VIBES), /No B-roll vibe "neon"/);
});

test('vibeArgs: an object starts from a base and takes shortcuts and tokens', () => {
    const r = vibeArgs({ base: 'editorial', accent: '#ff0066', card: '#101820', ink: '#fefefe', font: 'mono', displayFont: 'serif',
        corners: 5, motion: 'bouncy', light: { track: 'rgba(0,0,0,.2)', nope: 1 }, junk: true }, VIBES);
    assert.strictEqual(r.vibe, 'editorial');
    assert.strictEqual(r._vibe.accent, '#ff0066');
    assert.strictEqual(r._vibe.light.bg, '#101820');
    assert.strictEqual(r._vibe.light.ink, '#fefefe');
    assert.strictEqual(r._vibe.light.track, 'rgba(0,0,0,.2)');
    assert.ok(!('nope' in r._vibe.light) && !('junk' in r._vibe));
    assert.strictEqual(r._vibe.font.body, 'mono');
    assert.strictEqual(r._vibe.font.display, 'serif');
    assert.strictEqual(r._vibe.radius, 2);
    assert.deepStrictEqual(r._vibe.motion, MOTIONS.bouncy);
    assert.strictEqual(vibeArgs({ accent: '#ff0066' }, VIBES).vibe, 'classic');
    assert.deepStrictEqual(vibeArgs({ base: 'sketch', motion: { rise: 80 } }, VIBES)._vibe, { motion: { rise: 80 } });
});

test('cleanTokens: drops values that could load a file or break out of a style', () => {
    assert.strictEqual(cleanTokens({ shadow: 'url(http://x/y.png)' }, VIBES[0]), null);
    assert.strictEqual(cleanTokens({ light: { bg: 'red; background: blue' } }, VIBES[0]), null);
    assert.deepStrictEqual(cleanTokens({ radius: '1.5', borderWidth: 'x', light: { bg: '#fff' } }, VIBES[0]), { radius: 1.5, light: { bg: '#fff' } });
});

test('applyVibe: the look travels with the props and the default accent gives way to the vibe\'s', () => {
    const out = applyVibe({ accent: MATCHA, x: 0.5 }, { vibe: 'bold-pop' }, VIBES, MATCHA);
    assert.deepStrictEqual(out, { accent: '#ffd400', x: 0.5, vibe: 'bold-pop' });
    // an accent the caller chose stays
    assert.strictEqual(applyVibe({ accent: '#123456' }, { vibe: 'bold-pop' }, VIBES, MATCHA).accent, '#123456');
    // a custom accent in the tokens wins over the starter's
    assert.strictEqual(applyVibe({ accent: MATCHA }, { vibe: 'bold-pop', _vibe: { accent: '#00ff00' } }, VIBES, MATCHA).accent, '#00ff00');
    // no vibe, the default, or an unknown one: nothing is added and a stale one is removed
    assert.deepStrictEqual(applyVibe({ accent: MATCHA, vibe: 'x', _vibe: {} }, {}, VIBES, MATCHA), { accent: MATCHA });
    assert.deepStrictEqual(applyVibe({ accent: MATCHA }, { vibe: 'classic' }, VIBES, MATCHA), { accent: MATCHA });
    assert.deepStrictEqual(applyVibe({ accent: MATCHA }, { vibe: 'nope' }, VIBES, MATCHA), { accent: MATCHA });
    // changing to a plain starter clears the tokens of the one before (_vibe: null from vibeArgs)
    assert.ok(!('_vibe' in applyVibe({}, { vibe: 'sketch', _vibe: null }, VIBES, MATCHA)));
    // classic with changes is still a vibe
    assert.strictEqual(applyVibe({ accent: MATCHA }, { vibe: 'classic', _vibe: { radius: 0 } }, VIBES, MATCHA).vibe, 'classic');
});

test('vibeList: every starter, with what can be changed', () => {
    const l = vibeList(VIBES);
    assert.deepStrictEqual(l.starters.map(s => s.id), VIBES.map(v => v.id));
    assert.ok(l.changes.motion.includes('bouncy'));
});
