// Use tab: Effect Preset (below Text Preset). Glitch / Wiggle / Stop Motion are Resolve Fusion effects put on any clip
// (a video, a title, a placed text preset) - src/main/effect-presets.js + bridge ops fx_get / fx_set. Click an effect to
// switch it on or off for the clips selected on the timeline (or the top clip under the playhead). Several on one clip
// stack as one look (glitch -> wiggle -> stop motion). Search and the tag filter work like the Text Preset list.

const fxUI = { effects: [], search: '', clips: [], busy: false, timer: null, sig: '', sliding: false, sendTimer: null };

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
        c.className = 'card fx-card' + (st === 'on' ? ' fx-on' : (st === 'some' ? ' fx-some' : '')) + (fxUI.busy ? ' fx-busy' : '');
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
        // Strength: 0 = no effect, default = a light, visible look
        const row = document.createElement('label');
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
        const dots = tagDotsEl({ tags: fxTagsOf(e) });
        if (dots) c.appendChild(dots);
        c.addEventListener('click', () => fxToggle(e));
        c.addEventListener('contextmenu', (ev) => { ev.preventDefault(); fxTagMenu(c, e); });
        grid.appendChild(c);
    }
}

async function fxToggle(e) {
    if (fxUI.busy) return;
    if (!fxUI.clips.length) await fxRefresh();
    if (!fxUI.clips.length) { setStatus('Select a clip on the timeline first.', 'bad'); return; }
    const want = fxStateOf(e.id) !== 'on';
    fxUI.busy = true;
    renderEffects();
    let r = null;
    try { r = await window.sa.fxSet(e.id, want, want ? fxNextStrength(e) : null); } catch (err) { r = { error: String(err && err.message || err) }; }
    fxUI.busy = false;
    if (r && r.busy) setStatus('Busy placing - try again in a moment.', 'bad');
    else if (!r || r.error) setStatus((r && r.error) || 'Could not change the effect', 'bad');
    else {
        if (Array.isArray(r.clips)) fxUI.clips = r.clips;
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
async function fxRefresh() {
    if (fxUI.busy || state.busy) return;
    let r = null;
    try { r = await window.sa.fxGet(); } catch (e) { r = null; }
    if (!r || r.busy || r.error || !Array.isArray(r.clips)) return;
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
    }, 1500);
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
