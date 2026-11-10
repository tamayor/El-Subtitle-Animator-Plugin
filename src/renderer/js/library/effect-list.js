// Use tab: Effect Preset (below Text Preset). Glitch / Wiggle / Stop Motion are Resolve Fusion effects put on any clip
// (a video, a title, a placed text preset) - src/main/effect-presets.js + bridge ops fx_get / fx_set. Click an effect to
// switch it on or off for the clips selected on the timeline (or the top clip under the playhead). Several on one clip
// stack as one look (glitch -> wiggle -> stop motion). Search and the tag filter work like the Text Preset list.

const fxUI = { effects: [], search: '', clips: [], busy: false, timer: null, sig: '', sliding: false, sendTimer: null, open: {}, paramTimer: null, pending: {} };

// Strength (0..100) used when an effect is added; once on, the slider shows and sets the clip's own value.
function fxNextStrength(e) {
    try { const v = Number(localStorage.getItem('fxStrength.' + e.id)); if (localStorage.getItem('fxStrength.' + e.id) !== null && Number.isFinite(v)) return v; } catch (err) { /* no storage */ }
    return Number.isFinite(Number(e.defaultStrength)) ? Number(e.defaultStrength) : 25;
}
function fxRememberStrength(e, v) { try { localStorage.setItem('fxStrength.' + e.id, String(v)); } catch (err) { /* no storage */ } }
// the strength shown: the first target clip that has the effect, else the one used when adding
function fxStrengthShown(e) {
    for (const c of fxUI.clips) {
        const v = c.strength && c.strength[e.id];
        if (c.effects && c.effects[e.id] && Number.isFinite(Number(v))) return Number(v);
    }
    return fxNextStrength(e);
}
// ---- Glitch options (Entry > Blink at start, Colour A / B, Opacity)
const FX_PARAM_IDS = ['BlinkIn', 'ColorARed', 'ColorAGreen', 'ColorABlue', 'ColorBRed', 'ColorBGreen', 'ColorBBlue', 'Opacity'];
function fxDefaultParams(e) {
    const g = e.glitch || { colorA: [1, 0, 0], colorB: [0, 1, 1], opacity: 85 };
    return { BlinkIn: 1, ColorARed: g.colorA[0], ColorAGreen: g.colorA[1], ColorABlue: g.colorA[2], ColorBRed: g.colorB[0], ColorBGreen: g.colorB[1], ColorBBlue: g.colorB[2], Opacity: g.opacity };
}
// the settings used when the effect is added (remembered per viewer)
function fxNextParams(e) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('fxParams.' + e.id) || 'null'); } catch (err) { saved = null; }
    return Object.assign(fxDefaultParams(e), saved && typeof saved === 'object' ? saved : {});
}
function fxRememberParams(e, p) { try { localStorage.setItem('fxParams.' + e.id, JSON.stringify(p)); } catch (err) { /* no storage */ } }
// shown: the first target clip that has the effect, else the ones used when adding
function fxParamsShown(e) {
    for (const c of fxUI.clips) {
        const p = c.params && c.params[e.id];
        if (c.effects && c.effects[e.id] && p) {
            const out = fxNextParams(e);
            for (const k of FX_PARAM_IDS) if (Number.isFinite(Number(p[k])) && p[k] !== null) out[k] = Number(p[k]);
            return out;
        }
    }
    return fxNextParams(e);
}
const fxHex = (r, g, b) => '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round((Number(x) || 0) * 255))).toString(16).padStart(2, '0')).join('');
const fxRgb = (hex) => [1, 3, 5].map(i => parseInt(String(hex).slice(i, i + 2), 16) / 255);

// changes go to the selected clips that have the effect (debounced), and are remembered for the next add
function fxSendParams(e, st, values, now) {
    fxRememberParams(e, Object.assign(fxNextParams(e), values));
    if (st === 'none') return;
    clearTimeout(fxUI.paramTimer);
    const go = async () => {
        let r = null;
        try { r = await window.sa.fxParam(e.id, values); } catch (err) { r = { error: String(err && err.message || err) }; }
        if (r && r.error) setStatus(r.error, 'bad');
        else if (r && Array.isArray(r.clips)) { fxUI.clips = r.clips; fxUI.sig = JSON.stringify(r.clips); }
    };
    if (now) go(); else fxUI.paramTimer = setTimeout(go, 150);
}

function fxGlitchOptions(e, st) {
    const p = fxParamsShown(e);
    const d = document.createElement('details');
    d.className = 'fx-opts';
    d.open = !!fxUI.open[e.id];
    d.addEventListener('toggle', () => { fxUI.open[e.id] = d.open; });
    const sum = document.createElement('summary');
    sum.textContent = 'Options';
    d.appendChild(sum);
    const hold = (el) => {
        for (const ev of ['click', 'mousedown', 'pointerdown']) el.addEventListener(ev, (x) => x.stopPropagation());
        el.addEventListener('focus', () => { fxUI.sliding = true; });
        el.addEventListener('blur', () => { fxUI.sliding = false; });
    };
    // Entry
    const entry = document.createElement('div'); entry.className = 'fx-opt-head'; entry.textContent = 'Entry';
    const bl = document.createElement('label'); bl.className = 'fx-opt-row fx-check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = Number(p.BlinkIn) >= 0.5;
    hold(cb);
    cb.addEventListener('change', () => fxSendParams(e, st, { BlinkIn: cb.checked ? 1 : 0 }, true));
    bl.append(cb, document.createTextNode('Blink at start'));
    bl.title = 'The first frames flicker on and off with a glitch burst';
    // Colours
    const look = document.createElement('div'); look.className = 'fx-opt-head'; look.textContent = 'Glitch colour';
    const colRow = document.createElement('div'); colRow.className = 'fx-opt-row';
    const colour = (label, key, title) => {
        const w = document.createElement('label'); w.className = 'fx-color'; w.title = title;
        const ci = document.createElement('input'); ci.type = 'color';
        ci.value = fxHex(p[key + 'Red'], p[key + 'Green'], p[key + 'Blue']);
        hold(ci);
        const send = (now) => { const [r, g, b] = fxRgb(ci.value); fxSendParams(e, st, { [key + 'Red']: r, [key + 'Green']: g, [key + 'Blue']: b }, now); };
        ci.addEventListener('input', () => send(false));
        ci.addEventListener('change', () => { fxUI.sliding = false; send(true); });
        w.append(ci, document.createTextNode(label));
        return w;
    };
    colRow.append(colour('Right', 'ColorA', 'Colour of the copy shifted to the right'), colour('Left', 'ColorB', 'Colour of the copy shifted to the left'));
    // Opacity
    const op = document.createElement('label'); op.className = 'fx-strength';
    const cap = document.createElement('span'); cap.className = 'fx-strength-cap'; cap.textContent = 'Opacity';
    const rng = document.createElement('input'); rng.type = 'range'; rng.min = '0'; rng.max = '100'; rng.step = '1'; rng.value = String(p.Opacity);
    const val = document.createElement('span'); val.className = 'fx-strength-val'; val.textContent = Math.round(p.Opacity) + '%';
    hold(rng);
    rng.addEventListener('pointerdown', () => { fxUI.sliding = true; });
    for (const ev of ['pointerup', 'pointercancel']) rng.addEventListener(ev, () => { fxUI.sliding = false; });
    rng.addEventListener('input', () => { val.textContent = rng.value + '%'; fxSendParams(e, st, { Opacity: Number(rng.value) }, false); });
    rng.addEventListener('change', () => fxSendParams(e, st, { Opacity: Number(rng.value) }, true));
    op.title = 'How strong the coloured fringes are';
    op.append(cap, rng, val);
    d.append(entry, bl, look, colRow, op);
    for (const ev of ['click', 'mousedown', 'pointerdown']) d.addEventListener(ev, (x) => x.stopPropagation());
    return d;
}

function fxStrengthLabel(v) { return v <= 0 ? 'Off' : String(Math.round(v)); }

function fxTagsOf(e) {
    const t = (state.lib && state.lib.effectTags) || {};
    return Array.isArray(t[e.id]) ? t[e.id] : [];
}

// "Glitch" on all of the target clips / some of them / none
function fxStateOf(id) {
    const n = fxUI.clips.length;
    if (!n) return 'none';
    const on = fxUI.clips.filter(c => c.effects && c.effects[id]).length;
    return on === n ? 'on' : (on ? 'some' : 'none');
}

function renderEffects() {
    const grid = $('fxGrid');
    if (!grid || fxUI.sliding) return;      // never rebuild under a slider being dragged
    renderTagFilter('fx', 'fxFilter');
    const q = fxUI.search.trim().toLowerCase();
    const shown = fxUI.effects.filter(e => {
        if (!passesTagFilter({ tags: fxTagsOf(e) }, 'fx')) return false;
        if (q && !(e.name.toLowerCase().includes(q) || (e.tags || []).some(t => t.includes(q)))) return false;
        return true;
    });
    const n = fxUI.effects.length;
    $('fxCount').textContent = n ? (shown.length !== n ? shown.length + ' of ' + n : n + ' effects') : '';
    const target = $('fxTarget');
    if (target) {
        const names = fxUI.clips.map(c => c.name || 'clip');
        target.textContent = names.length
            ? 'Applies to: ' + (names.length > 3 ? names.slice(0, 3).join(', ') + ' +' + (names.length - 3) : names.join(', '))
            : 'Select a clip on the timeline (video, title or text preset)';
    }
    grid.textContent = '';
    if (!shown.length) {
        const d = document.createElement('div');
        d.className = 'empty';
        d.textContent = n ? (q ? 'No effect presets matching "' + fxUI.search.trim() + '".' : 'No effect presets have the selected tags.') : 'Loading effects…';
        grid.appendChild(d);
        return;
    }
    for (const e of shown) {
        const st = fxStateOf(e.id);
        const c = document.createElement('div');
        c.className = 'card fx-card' + (st === 'on' ? ' fx-on' : (st === 'some' ? ' fx-some' : '')) + (fxUI.pending[e.id] ? ' fx-pending' : '');
        c.dataset.id = e.id;
        c.title = e.tip + (st === 'on' ? '\nClick to remove it from the selected clip(s)' : '\nClick to add it to the selected clip(s)');
        const sw = document.createElement('span');
        sw.className = 'fx-switch';
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', st === 'on' ? 'true' : (st === 'some' ? 'mixed' : 'false'));
        const nm = document.createElement('div');
        nm.className = 'nm'; nm.textContent = e.name;
        const sub = document.createElement('div');
        sub.className = 'sub'; sub.textContent = st === 'on' ? 'On' : (st === 'some' ? 'Some' : '');
        c.append(sw, nm, sub);
        if (e.noStrength) {
            const note = document.createElement('div');
            note.className = 'fx-note';
            note.textContent = 'DaVinci\'s Stop Motion: set Frame Repeat in Resolve\'s Inspector → Effects';
            c.appendChild(note);
        }
        // Strength: 0 = no effect, default = a light, visible look
        const row = document.createElement('label');
        if (e.noStrength) row.style.display = 'none';
        row.className = 'fx-strength';
        row.title = 'Strength: 0 = no effect, ' + (e.defaultStrength || 25) + ' = default (light), 100 = strongest' +
            (st === 'none' ? '\nUsed when you add it' : '');
        const cap = document.createElement('span'); cap.className = 'fx-strength-cap'; cap.textContent = 'Strength';
        const rng = document.createElement('input');
        rng.type = 'range'; rng.min = '0'; rng.max = '100'; rng.step = '1';
        const val = document.createElement('span'); val.className = 'fx-strength-val';
        const v0 = fxStrengthShown(e);
        rng.value = String(v0); val.textContent = fxStrengthLabel(v0);
        for (const ev of ['click', 'mousedown', 'pointerdown']) row.addEventListener(ev, (x) => x.stopPropagation());
        rng.addEventListener('pointerdown', () => { fxUI.sliding = true; });
        for (const ev of ['pointerup', 'pointercancel', 'blur']) rng.addEventListener(ev, () => { fxUI.sliding = false; });
        rng.addEventListener('input', () => {
            const v = Number(rng.value);
            val.textContent = fxStrengthLabel(v);
            fxRememberStrength(e, v);
            if (st !== 'none') fxSendStrength(e, v);
        });
        rng.addEventListener('change', () => { fxUI.sliding = false; if (st !== 'none') fxSendStrength(e, Number(rng.value), true); });
        rng.addEventListener('dblclick', () => {
            const d = Number(e.defaultStrength) || 25;
            rng.value = String(d); val.textContent = fxStrengthLabel(d); fxRememberStrength(e, d);
            if (st !== 'none') fxSendStrength(e, d, true);
        });
        row.append(cap, rng, val);
        c.appendChild(row);
        if (e.glitch) c.appendChild(fxGlitchOptions(e, st));
        const dots = tagDotsEl({ tags: fxTagsOf(e) });
        if (dots) c.appendChild(dots);
        c.addEventListener('click', () => fxToggle(e));
        c.addEventListener('contextmenu', (ev) => { ev.preventDefault(); fxTagMenu(c, e); });
        grid.appendChild(c);
    }
}

// Click: the card flips straight away (optimistic) and the change goes to Resolve on the fast lane; if Resolve refuses,
// the card flips back. Each effect has its own pending flag, so other cards stay clickable meanwhile.
async function fxToggle(e) {
    if (fxUI.pending[e.id]) return;
    if (!fxUI.clips.length) await fxRefresh(true);
    if (!fxUI.clips.length) { setStatus('Select a clip on the timeline first.', 'bad'); return; }
    const want = fxStateOf(e.id) !== 'on';
    const before = fxUI.clips;
    fxUI.clips = before.map(c => Object.assign({}, c, { effects: Object.assign({}, c.effects || {}, { [e.id]: want }) }));
    if (!want) for (const c of fxUI.clips) delete c.effects[e.id];
    fxUI.pending[e.id] = true;
    renderEffects();
    let r = null;
    try { r = await window.sa.fxSet(e.id, want, want && !e.noStrength ? fxNextStrength(e) : null, want && e.glitch ? fxNextParams(e) : null); } catch (err) { r = { error: String(err && err.message || err) }; }
    delete fxUI.pending[e.id];
    if (!r || r.busy || r.error) {
        fxUI.clips = before;
        setStatus(r && r.busy ? 'Busy placing - try again in a moment.' : ((r && r.error) || 'Could not change the effect'), 'bad');
    } else {
        if (Array.isArray(r.clips)) { fxUI.clips = r.clips; fxUI.sig = JSON.stringify(r.clips); }
        const n = fxUI.clips.length;
        if (r.failed && r.failed.length) setStatus(e.name + ' could not be changed on ' + r.failed.join(', '), 'bad');
        else setStatus(e.name + (r.on ? ' added to ' : ' removed from ') + n + ' clip' + (n === 1 ? '' : 's') + '.', 'ok');
    }
    renderEffects();
}

// Live strength while dragging (at most every 120 ms), and once more on release.
function fxSendStrength(e, v, now) {
    clearTimeout(fxUI.sendTimer);
    const go = async () => {
        let r = null;
        try { r = await window.sa.fxStrength(e.id, v); } catch (err) { r = { error: String(err && err.message || err) }; }
        if (r && r.error) setStatus(r.error, 'bad');
        else if (r && Array.isArray(r.clips)) { fxUI.clips = r.clips; fxUI.sig = JSON.stringify(r.clips); }
    };
    if (now) go(); else fxUI.sendTimer = setTimeout(go, 120);
}

// right-click: the same tags as the text presets
function fxTagMenu(anchor, e) {
    openPop(anchor, 'pop-menu', (el) => {
        const head = document.createElement('div');
        head.className = 'pop-title'; head.textContent = 'Tags';
        el.appendChild(head);
        if (!allTags().length) {
            const x = document.createElement('div');
            x.className = 'pop-empty'; x.textContent = 'No tags yet (make them on the Library tab)';
            el.appendChild(x);
        }
        for (const t of allTags()) {
            const it = document.createElement('button');
            it.className = 'pop-item' + (fxTagsOf(e).includes(t.id) ? ' on' : '');
            const ck = document.createElement('span'); ck.className = 'pop-check'; ck.textContent = '✓';
            const n = document.createElement('span'); n.className = 'pop-label'; n.textContent = t.name;
            it.append(ck, tagMarkEl(t), n);
            it.addEventListener('click', async () => {
                const mine = fxTagsOf(e);
                const next = mine.includes(t.id) ? mine.filter(x => x !== t.id) : mine.concat(t.id);
                takeLib(await window.sa.fxSetTags(e.id, next));
                it.classList.toggle('on', next.includes(t.id));
            });
            el.appendChild(it);
        }
    });
}

// The effects on the selected clips, read while the Use tab is showing and the panel is not busy.
async function fxRefresh(force) {
    if (state.busy || (!force && Object.keys(fxUI.pending).length)) return;
    let r = null;
    try { r = await window.sa.fxGet(); } catch (e) { r = null; }
    if (!r || r.busy || r.error || !Array.isArray(r.clips)) return;
    if (!force && Object.keys(fxUI.pending).length) return;      // a toggle started meanwhile: its own answer wins
    const sig = JSON.stringify(r.clips);
    if (sig === fxUI.sig) return;
    fxUI.sig = sig;
    fxUI.clips = r.clips;
    renderEffects();
}
function fxPoll() {
    clearTimeout(fxUI.timer);
    fxUI.timer = setTimeout(async () => {
        if (!document.hidden && state.tab === 'apply' && document.hasFocus()) await fxRefresh();
        fxPoll();
    }, 700);
}

async function initEffects() {
    try { const r = await window.sa.fxList(); fxUI.effects = (r && r.effects) || []; } catch (e) { fxUI.effects = []; }
    const input = $('fxSearch'), clear = $('fxSearchClear');
    if (input) {
        input.addEventListener('input', () => { fxUI.search = input.value; if (clear) clear.classList.toggle('hidden', !fxUI.search); renderEffects(); });
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { input.value = ''; fxUI.search = ''; if (clear) clear.classList.add('hidden'); renderEffects(); } });
    }
    if (clear) clear.addEventListener('click', () => { if (input) { input.value = ''; input.focus(); } fxUI.search = ''; clear.classList.add('hidden'); renderEffects(); });
    window.addEventListener('focus', () => { if (state.tab === 'apply') fxRefresh(); });
    renderEffects();
    fxPoll();
}
