// Effect Preset cards (Use tab): shared state, remembered strength / params, and the senders to Resolve.
// The other files in js/library/effects/ build each effect's options and the card list.

// Use tab: Effect Preset (below Text Preset). Glitch / Wiggle / Stop Motion are Resolve Fusion effects put on any clip
// (a video, a title, a placed text preset) - src/main/effect-presets.js + bridge ops fx_get / fx_set. Click an effect to
// switch it on or off for the clips selected on the timeline (or the top clip under the playhead). Several on one clip
// stack as one look (glitch -> wiggle -> stop motion). Search and the tag filter work like the Text Preset list.

const fxUI = { effects: [], search: '', clips: [], busy: false, timer: null, sig: '', sliding: false, open: {}, show: {}, pending: {} };

// Strength (0..100) used when an effect is added; once on, the slider shows and sets the clip's own value.
function fxNextStrength(e) {
    const saved = store.get('fxStrength.' + e.id);
    if (saved !== null && Number.isFinite(Number(saved))) return Number(saved);
    return Number.isFinite(Number(e.defaultStrength)) ? Number(e.defaultStrength) : 25;
}
function fxRememberStrength(e, v) { store.set('fxStrength.' + e.id, String(v)); }
// the strength shown: the first target clip that has the effect, else the one used when adding
function fxStrengthShown(e) {
    for (const c of fxUI.clips) {
        const v = c.strength && c.strength[e.id];
        if (c.effects && c.effects[e.id] && Number.isFinite(Number(v))) return Number(v);
    }
    return fxNextStrength(e);
}
// ---- Glitch options (Entry > Blink at start, Duration, Colour A / B, Opacity)
const FX_PARAM_IDS = ['BlinkIn', 'ColorARed', 'ColorAGreen', 'ColorABlue', 'ColorBRed', 'ColorBGreen', 'ColorBBlue', 'Opacity', 'Dur'];
function fxDefaultParams(e) {
    if (e.transform) return Object.assign({}, e.transform.defaults);
    if (e.track) return Object.assign({}, e.track.defaults);
    const g = e.glitch || { colorA: [1, 0, 0], colorB: [0, 1, 1], opacity: 85, duration: 0 };
    return { BlinkIn: 1, ColorARed: g.colorA[0], ColorAGreen: g.colorA[1], ColorABlue: g.colorA[2], ColorBRed: g.colorB[0], ColorBGreen: g.colorB[1], ColorBBlue: g.colorB[2], Opacity: g.opacity, Dur: g.duration || 0, Sfx: 1 };
}
// the settings used when the effect is added (remembered per viewer)
function fxNextParams(e) {
    let saved = null;
    saved = store.getJSON('fxParams.' + e.id, null) || null;
    return Object.assign(fxDefaultParams(e), saved && typeof saved === 'object' ? saved : {});
}
function fxRememberParams(e, p) { store.set('fxParams.' + e.id, JSON.stringify(p)); }
// shown: the first target clip that has the effect, else the ones used when adding
function fxParamsShown(e) {
    for (const c of fxUI.clips) {
        const p = c.params && c.params[e.id];
        if (c.effects && c.effects[e.id] && p) {
            const out = fxNextParams(e);
            for (const k of (e.transform ? Object.keys(e.transform.defaults) : (e.track ? Object.keys(e.track.defaults) : FX_PARAM_IDS))) if (Number.isFinite(Number(p[k])) && p[k] !== null) out[k] = Number(p[k]);
            return out;
        }
    }
    return fxNextParams(e);
}

// changes go to the selected clips that have the effect (debounced per effect), and are remembered for the next add
const fxParamSenders = new Map();       // effect id -> sender (js/core/ipc-queue.js)
function fxSendParams(e, st, values, now) {
    fxRememberParams(e, Object.assign(fxNextParams(e), values));
    if (fxStateOf(e.id) === 'none') return;      // the live state (cards are updated in place, not rebuilt)
    let sender = fxParamSenders.get(e.id);
    if (!sender) {
        sender = createThrottledSender(async (batch) => {
            let r = null;
            try { r = await window.sa.fxParam(e.id, batch); } catch (err) { r = { error: String(err && err.message || err) }; }
            fxTakeClips(r);
        }, { ms: 150, mode: 'debounce' });
        fxParamSenders.set(e.id, sender);
    }
    sender.push(values, now);
}
// What a param / strength send hands back: the clips that have the effect now, or an error.
function fxTakeClips(r) {
    if (r && r.error) setStatus(r.error, 'bad');
    else if (r && Array.isArray(r.clips)) { fxUI.clips = r.clips; fxUI.sig = JSON.stringify(r.clips); }
}
