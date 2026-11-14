// B-roll vibes, the pure part: the look an MCP call gives a placement. The effects keep their own (classic) look; a
// vibe is passed per call (place_broll / adjust_broll / broll_preview `vibe`) and kept with the placed clip, never
// built into an effect or remembered as a panel value. The drawing is broll/src/lib/vibe.tsx; the starting looks are
// broll/vibes.json. No Resolve, no files (the caller hands in vibes.json's list).
//
// A `vibe` argument is a starter's id ("clean-glass"), or an object: { base: "<starter id>", ...changes } where the
// changes are the shortcuts below and / or the full tokens of vibes.json (light / dark / font / motion ...).
//   accent, danger   "#rrggbb"
//   card, ink, border, dim   the light surface's colours (cardDark / inkDark / borderDark / dimDark: the dark one's)
//   dark             true = the dark surface on every card
//   corners          0..2, multiplier on each effect's own corner radius (0 = square)
//   outline          card border width in px (at the 1080 design size)
//   font             one face for everything: sans | serif | serifItalic | mono | hand
//   displayFont, bodyFont, labelFont, numFont, quoteFont, connectorFont   one role's face
//   weight           the headline weight, 100..900
//   motion           "soft" | "snappy" | "bouncy" | "calm" | "steps", or { damping, stiffness, mass, rise, pop, tilt, stagger, steps }

const FACES = ['sans', 'serif', 'serifItalic', 'mono', 'hand'];
const ROLES = ['display', 'body', 'label', 'num', 'connector', 'quote'];
const MOTIONS = {
    soft: { damping: 20, stiffness: 110, mass: 1, rise: 26, pop: 0.94, tilt: 0, stagger: 5, steps: 0 },
    snappy: { damping: 18, stiffness: 260, mass: 0.7, rise: 30, pop: 0.9, tilt: 0, stagger: 3, steps: 0 },
    bouncy: { damping: 9, stiffness: 220, mass: 0.8, rise: 44, pop: 0.6, tilt: -4, stagger: 3, steps: 0 },
    calm: { damping: 30, stiffness: 70, mass: 1.1, rise: 14, pop: 1, tilt: 0, stagger: 8, steps: 0 },
    steps: { damping: 26, stiffness: 320, mass: 0.6, rise: 18, pop: 1, tilt: 0, stagger: 2, steps: 4 }
};
const HEX = /^#[0-9a-f]{6}$/i;
// a CSS value from a caller: short, and nothing that loads a file or closes the declaration
const cssOk = (s) => typeof s === 'string' && s.length <= 240 && !/url\s*\(|[;{}<>\\]|expression\s*\(|@import/i.test(s);

// Keeps only what has the shape of a vibe: `over` is laid over `shape` (a starter from vibes.json), a key that is not
// in it or a value of another type is dropped. Returns null when nothing is left.
function cleanTokens(over, shape) {
    if (!over || typeof over !== 'object' || Array.isArray(over) || !shape) return null;
    const out = {};
    for (const k of Object.keys(over)) {
        if (k === 'id' || k === 'name' || k === 'about' || !(k in shape) && !(k === 'preferDark' || k === 'hardShadow')) continue;
        const v = over[k], want = k in shape ? shape[k] : (k === 'preferDark' ? false : '');
        if (want && typeof want === 'object') { const sub = cleanTokens(v, want); if (sub) out[k] = sub; continue; }
        if (typeof want === 'number') { const n = Number(v); if (typeof v !== 'boolean' && v !== '' && v !== null && Number.isFinite(n)) out[k] = n; continue; }
        if (typeof want === 'boolean') { out[k] = v === true || v === 'true'; continue; }
        if (cssOk(v)) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
}

// The shortcuts of a `vibe` object, as tokens.
function shortcuts(o) {
    const t = {};
    const put = (path, v) => { let at = t; for (let i = 0; i < path.length - 1; i++) at = at[path[i]] = at[path[i]] || {}; at[path[path.length - 1]] = v; };
    const colour = (v) => (typeof v === 'string' && (HEX.test(v) || cssOk(v)) ? v : null);
    if (HEX.test(String(o.accent || ''))) t.accent = o.accent;
    if (HEX.test(String(o.danger || ''))) t.danger = o.danger;
    for (const [key, path] of [['card', ['light', 'bg']], ['ink', ['light', 'ink']], ['border', ['light', 'border']], ['dim', ['light', 'dim']],
        ['cardDark', ['dark', 'bg']], ['inkDark', ['dark', 'ink']], ['borderDark', ['dark', 'border']], ['dimDark', ['dark', 'dim']]]) {
        const c = colour(o[key]);
        // readable() and the highlight row need a hex ink: any other form is dropped
        if (c && (!/ink/i.test(key) || HEX.test(c))) put(path, c);
    }
    if (o.dark === true || o.dark === false) t.preferDark = o.dark;
    if (Number.isFinite(Number(o.corners)) && o.corners !== null && o.corners !== '') t.radius = Math.max(0, Math.min(2, Number(o.corners)));
    if (Number.isFinite(Number(o.outline)) && o.outline !== null && o.outline !== '') t.borderWidth = Math.max(0, Math.min(12, Number(o.outline)));
    if (FACES.includes(o.font)) for (const r of ROLES) put(['font', r], o.font);
    for (const r of ROLES) if (FACES.includes(o[r + 'Font'])) put(['font', r], o[r + 'Font']);
    if (Number.isFinite(Number(o.weight)) && o.weight) put(['font', 'displayWeight'], Math.max(100, Math.min(900, Math.round(Number(o.weight)))));
    if (typeof o.motion === 'string' && MOTIONS[o.motion]) t.motion = { ...MOTIONS[o.motion] };
    return t;
}

function merge(a, b) {
    const out = { ...a };
    for (const k of Object.keys(b || {})) out[k] = out[k] && typeof out[k] === 'object' && b[k] && typeof b[k] === 'object' ? merge(out[k], b[k]) : b[k];
    return out;
}

// An MCP `vibe` argument -> the two props the renderer reads: { vibe: "<starter id>", _vibe: tokens | null }.
// null when there is no vibe argument. Throws on a starter that does not exist (so a typo is not silently Classic).
function vibeArgs(v, vibes) {
    if (v === undefined || v === null || v === '') return null;
    const ids = vibes.map(x => x.id);
    if (typeof v === 'string') {
        const id = v.trim().toLowerCase().replace(/\s+/g, '-');
        if (!ids.includes(id)) throw new Error('No B-roll vibe "' + v + '". Vibes: ' + ids.join(', ') + ' (or an object { base, accent, card, ink, font, corners, motion ... })');
        return { vibe: id, _vibe: null };
    }
    if (typeof v !== 'object' || Array.isArray(v)) throw new Error('vibe is a starter id or an object { base, ...changes }');
    const base = v.base === undefined || v.base === null || v.base === '' ? ids[0] : String(v.base).trim().toLowerCase().replace(/\s+/g, '-');
    if (!ids.includes(base)) throw new Error('No B-roll vibe "' + v.base + '" to start from. Vibes: ' + ids.join(', '));
    const shape = vibes[0];
    const tokens = merge(cleanTokens(v, shape) || {}, shortcuts(v));
    if (v.motion && typeof v.motion === 'object') { const m = cleanTokens({ motion: v.motion }, shape); if (m) tokens.motion = merge(tokens.motion || {}, m.motion); }
    return { vibe: base, _vibe: Object.keys(tokens).length ? tokens : null };
}

// mergedProps' last step: `out` gets the look carried by `p` (a placed clip's saved props, or a call's). The accent
// field always holds a colour (the panel shows it), so with a vibe that is not the default the registry's default
// accent gives way to the vibe's own.
function applyVibe(out, p, vibes, defaultAccent) {
    delete out.vibe; delete out._vibe;
    const id = typeof p.vibe === 'string' ? p.vibe : '';
    const base = vibes.find(x => x.id === id);
    if (!base || (base === vibes[0] && !(p._vibe && typeof p._vibe === 'object'))) return out;
    out.vibe = base.id;
    const tokens = cleanTokens(p._vibe, vibes[0]);
    if (tokens) out._vibe = tokens;
    const own = (tokens && tokens.accent) || base.accent;
    if (HEX.test(String(own || '')) && (!out.accent || String(out.accent).toLowerCase() === String(defaultAccent || '').toLowerCase())) out.accent = own;
    return out;
}

// list_broll: the starters and how to change them.
function vibeList(vibes) {
    return {
        note: 'A look for the whole video, passed per call (place_broll / adjust_broll / broll_preview `vibe`), not a setting of the effects: '
            + 'without one an effect keeps its own look. Pass a starter id, or { base, ...changes } to make the look fit the video. '
            + 'Pick one look per video and pass it on every placement; adjust_broll { all: true, vibe } restyles what is placed.',
        starters: vibes.map(v => ({ id: v.id, name: v.name, about: v.about, accent: v.accent, dark: !!v.preferDark })),
        changes: {
            accent: '#rrggbb', danger: '#rrggbb', card: 'card colour (any CSS colour)', ink: '#rrggbb text', border: 'CSS colour', dim: 'CSS colour of small text',
            cardDark: 'the dark surface\'s card', inkDark: '#rrggbb', dark: 'true = dark cards everywhere',
            corners: '0..2 (0 square, 1 as drawn, 2 very round)', outline: 'border px', font: FACES.join(' | ') + ' for everything',
            'displayFont / bodyFont / labelFont / numFont / quoteFont / connectorFont': 'one role\'s face', weight: 'headline weight 100..900',
            motion: Object.keys(MOTIONS).join(' | ') + ', or { damping, stiffness, mass, rise, pop, tilt, stagger, steps }',
            tokens: 'any key of a starter in broll/vibes.json (light / dark { bg, border, ink, dim, track, sheen }, shadow, hardShadow, bare, font, motion)'
        }
    };
}

module.exports = { vibeArgs, applyVibe, vibeList, cleanTokens, MOTIONS, FACES };
