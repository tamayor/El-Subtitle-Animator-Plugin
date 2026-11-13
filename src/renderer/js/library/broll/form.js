// B-roll tab: the effect cards and the fields of the picked effect.

// ------------------------------------------------------------------ effects and fields

async function brLoadEffects() {
    const r = await window.sa.brollEffects();
    if (!r || r.error) { brSetup(r && r.error ? r.error : 'Could not read the B-roll effects'); return false; }
    brUI.effects = r.effects; brUI.common = r.common;
    const miss = [];
    if (!r.ready.node) miss.push('Node.js 18+ (nodejs.org, or brew install node)');
    if (!r.ready.project) miss.push('the renderer packages: in Terminal, cd "' + r.ready.dir + '" && npm install');
    brSetup(miss.length ? 'B-roll needs ' + miss.join(' and ') + '.' : '');
    brRenderEffects();
    brRenderAllow();
    let last = null;
    last = store.get('brEffect');
    brPick(brUI.effects.find(e => e.id === last) ? last : (brUI.effects[0] && brUI.effects[0].id), null);
    return true;
}

function brSetup(msg) {
    const el = $('brSetup');
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
}

function brViewMode() {
    if (!brUI.viewMode) {
        let m = 'grid';
        m = store.get('brViewMode') || 'grid';
        brUI.viewMode = (m === 'list' || m === 'gallery') ? m : 'grid';
    }
    return brUI.viewMode;
}
function brSyncViewModeBtn() {
    const mode = brViewMode();
    const m = VIEW_MODES.find(v => v.id === mode) || VIEW_MODES[1];
    const ico = $('brViewModeIco');
    if (ico) ico.innerHTML = m.svg;
    const btn = $('brViewModeBtn');
    if (btn) btn.title = 'View: ' + m.label + ' (click to show the effects as List, Grid or Gallery)';
}
function setBrViewMode(mode) {
    brUI.viewMode = (mode === 'list' || mode === 'gallery') ? mode : 'grid';
    store.set('brViewMode', brUI.viewMode);
    brSyncViewModeBtn();
    brRenderEffects();
}

function brEffectCard(e, missing) {
    const img = createEl('img', { class: 'br-effect-img', alt: e.name, src: e.thumb || undefined });
    if (!e.thumb) missing.push({ e, img });
    const info = createEl('div', { class: 'br-effect-info' }, [
        createEl('span', { class: 'br-effect-name', text: e.name }),
        createEl('span', { class: 'br-effect-desc', text: e.description })
    ]);
    return createEl('button', { type: 'button', class: 'br-effect' + (brUI.sel === e.id ? ' on' : ''), 'data-id': e.id, title: e.description,
        onclick: () => brPick(e.id, null) }, [
        createEl('div', { class: 'br-effect-thumb' }, [img]),
        info
    ]);
}

function brSyncGallery() {
    const box = $('brEffects');
    if (!box || brViewMode() !== 'gallery') return;
    const cards = [...box.querySelectorAll('.br-effect')];
    const dots = [...box.querySelectorAll('.gallery-dot')];
    const idx = cards.findIndex(c => c.dataset.id === brUI.sel);
    const cur = brUI.effects[idx];
    const nameText = box.querySelector('.gallery-active-title');
    if (nameText && cur) {
        nameText.textContent = cur.name;
        if (nameText.parentElement) nameText.parentElement.title = cur.name;
    }
    dots.forEach((d, i) => {
        const on = i === idx;
        d.classList.toggle('active', on);
        d.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) d.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
    const prev = box.querySelector('.gallery-prev'), next = box.querySelector('.gallery-next');
    if (prev) prev.disabled = idx <= 0;
    if (next) next.disabled = idx < 0 || idx >= cards.length - 1;
    if (idx >= 0 && cards[idx]) cards[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

function brRenderEffects() {
    const box = $('brEffects');
    if (!box) return;
    const mode = brViewMode();
    box.className = 'br-effects view-' + mode;
    box.textContent = '';
    const missing = [];
    if (mode === 'gallery' && brUI.effects.length) {
        const container = createEl('div', { class: 'gallery-container' });
        const stage = createEl('div', { class: 'gallery-viewport-row' });
        const prevBtn = createEl('button', { type: 'button', class: 'gallery-arrow gallery-prev', title: 'Previous effect', 'aria-label': 'Previous effect' });
        prevBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 2 4 8 10 14"></polyline></svg>';
        const track = createEl('div', { class: 'gallery-track', tabindex: '0', role: 'region', 'aria-label': 'Effect gallery carousel' });
        const nextBtn = createEl('button', { type: 'button', class: 'gallery-arrow gallery-next', title: 'Next effect', 'aria-label': 'Next effect' });
        nextBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 2 12 8 6 14"></polyline></svg>';
        stage.append(prevBtn, track, nextBtn);

        const footer = createEl('div', { class: 'gallery-indicator-bar' });
        const namePill = createEl('div', { class: 'gallery-name-pill' }, [createEl('span', { class: 'gallery-active-title' })]);
        const dotsWrap = createEl('div', { class: 'gallery-dots' });
        const dotsScroll = createEl('div', { class: 'gallery-dots-scroll' }, [dotsWrap]);
        footer.append(namePill, dotsScroll);
        container.append(stage, footer);
        box.append(container);

        brUI.effects.forEach((e, idx) => {
            track.append(brEffectCard(e, missing));
            const dot = createEl('button', { type: 'button', class: 'gallery-dot' + (brUI.sel === e.id ? ' active' : ''),
                text: String(idx + 1), 'data-tip': (idx + 1) + '. ' + e.name, 'aria-label': (idx + 1) + '. ' + e.name,
                onclick: (ev) => { ev.stopPropagation(); brPick(e.id, null); } });
            dotsWrap.append(dot);
        });
        const step = (delta) => {
            const idx = brUI.effects.findIndex(e => e.id === brUI.sel);
            const next = Math.max(0, Math.min(brUI.effects.length - 1, (idx < 0 ? 0 : idx) + delta));
            if (brUI.effects[next]) brPick(brUI.effects[next].id, null);
        };
        prevBtn.addEventListener('click', () => step(-1));
        nextBtn.addEventListener('click', () => step(1));
        track.addEventListener('keydown', (ev) => {
            if (ev.key === 'ArrowLeft') { ev.preventDefault(); step(-1); }
            else if (ev.key === 'ArrowRight') { ev.preventDefault(); step(1); }
        });
        track.addEventListener('wheel', (ev) => {
            if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { ev.preventDefault(); track.scrollLeft += ev.deltaY; }
        }, { passive: false });
        brSyncGallery();
    } else {
        for (const e of brUI.effects) box.append(brEffectCard(e, missing));
    }
    if (missing.length) {
        (async () => {
            for (const { e, img } of missing) {
                try {
                    const r = await window.sa.brollPreview({ effect: e.id, props: { ...e.defaults, x: 0.5, y: 0.5 }, width: 1280, height: 720, at: 0.65, maxDim: 360 });
                    if (r && r.dataUrl) { e.thumb = r.dataUrl; img.src = r.dataUrl; }
                } catch (err) { /* ignore */ }
            }
        })();
    }
}

// Selects an effect; values = a placed clip's props (editing) or the last values used, then the defaults.
function brPick(id, values) {
    const e = brUI.effects.find(x => x.id === id);
    if (!e) return;
    brUI.sel = id;
    store.set('brEffect', id);
    brUI.values = { ...e.defaults, ...(e.last || {}), ...(values || {}) };
    brUI.edited.clear(); brFillModeSync();
    $('brEffects').querySelectorAll('.br-effect').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    brSyncGallery();
    const prev = $('brPreview'), tip = $('brPreviewTip');
    if (prev) prev.title = e.description || '';
    if (tip) tip.textContent = e.description || '';
    brRenderFields($('brFields'), e.fields);
    brRenderFields($('brCommon'), brUI.common);
    brSyncRangeBar();
    const fm = $('brFromSubMsg'); if (fm) fm.classList.add('hidden');
    if (!values && $('brFromSub') && $('brFromSub').checked) { brFillFromSub(); return; }
    brPreviewSoon(true);
}

// In start / In length / Out / Lands at are set by the Place section's range bar, not as settings fields.
const BR_RANGE_KEYS = new Set(['enter', 'exit', 'delay', 'settle', 'fitIn']);

function brRenderFields(box, fields) {
    box.textContent = '';
    const checks = [];
    for (const f of fields) {
        if (BR_RANGE_KEYS.has(f.key)) continue;   // timing lives on the Place range bar
        const v = brUI.values[f.key];
        let input;
        // typing in an effect field marks it edited: Fill from subtitle leaves it alone until Clear edits
        const set = (val) => { brUI.values[f.key] = val; if (box.id === 'brFields') brMarkEdited(f.key); brPreviewSoon(); };
        if (f.type === 'bool') {
            input = createEl('input', { type: 'checkbox' });
            input.checked = !!v;
            input.addEventListener('change', () => set(input.checked));
            checks.push(createEl('label', { class: 'br-check', title: f.help }, [input, createEl('span', { text: f.label })]));
            continue;
        }
        if (f.type === 'number') {
            input = createEl('input', { type: 'number', step: f.step, min: f.min, max: f.max });
            input.value = v;
            input.addEventListener('input', () => { const n = Number(input.value); if (Number.isFinite(n)) set(n); });
        } else if (f.type === 'color') {
            // the panel's colour box: a click opens the macOS Colors panel (design/color-fields.js), live as you pick
            input = createEl('input', { type: 'color', 'data-key': f.key });
            input.value = v || '#ffffff';
            input.addEventListener('input', () => { brTrace('input ' + f.key + ' ' + input.value); set(input.value); });
            input.addEventListener('change', () => brTrace('change ' + f.key + ' ' + input.value));
            input.addEventListener('click', () => brTrace('click ' + f.key + ' from ' + input.value), true);
            box.append(createEl('label', { class: 'cut-f br-color', title: f.help }, [createEl('span', { text: f.label }), input]));
            continue;
        } else if (f.type === 'list') {
            input = createEl('textarea', { rows: Math.min(6, Math.max(2, (v || []).length)), placeholder: 'one per line' });
            input.value = (v || []).join('\n');
            input.addEventListener('input', () => set(input.value.split('\n').map(s => s.trim()).filter(Boolean)));
        } else {
            input = createEl('input', { type: 'text' });
            input.value = v === undefined ? '' : v;
            input.addEventListener('input', () => set(input.value));
        }
        box.append(createEl('label', { class: 'cut-f' + (f.type === 'list' ? ' br-wide' : ''), title: f.help }, [createEl('span', { text: f.label }), input]));
    }
    if (checks.length) box.append(createEl('div', { class: 'br-checks-row' }, checks));
    try { attachHexFields(); } catch (e) { /* the boxes still open the picker */ }
}

// "Fill from subtitle at playhead": the words of the subtitle there go into this effect's text fields (main/broll.js
// brollFromPlayhead, the same reading Auto uses); colours, header and layout keep their values.
// Fields typed in by hand (brUI.edited) are kept: the badge reads "edited" and Clear edits hands them back to auto.
let brFillSeq = 0;
function brMarkEdited(key) {
    if (brUI.edited.has(key)) return;
    brUI.edited.add(key); brFillModeSync();
}
function brFillModeSync() {
    const n = brUI.edited.size, badge = $('brFromSubMode'), btn = $('brClearEdits');
    if (badge) {
        badge.textContent = n ? 'edited' : 'auto';
        if (n) badge.dataset.edited = ''; else delete badge.dataset.edited;
        badge.title = n ? n + ' field' + (n > 1 ? 's' : '') + ' typed in by hand: Fill from subtitle keeps ' + (n > 1 ? 'them' : 'it') : '';
    }
    if (btn) btn.classList.toggle('hidden', !n);
}
function brClearEdits() {
    brUI.edited.clear(); brFillModeSync();
    if ($('brFromSub').checked) brFillFromSub();
}
async function brFillFromSub() {
    if (!brUI.sel) return;
    const seq = ++brFillSeq;
    const msg = $('brFromSubMsg');
    const r = await window.sa.brollFromPlayhead({ effect: brUI.sel });
    if (seq !== brFillSeq) return;
    msg.classList.remove('hidden');
    if (!r || r.error) { msg.textContent = (r && r.error) || 'No subtitle at the playhead'; msg.dataset.kind = ''; return; }
    const e = brUI.effects.find(x => x.id === brUI.sel);
    if (!e) return;
    const props = {}; let kept = 0;
    for (const [k, v] of Object.entries(r.props || {})) { if (brUI.edited.has(k)) kept++; else props[k] = v; }
    brUI.values = { ...brUI.values, ...props };
    brRenderFields($('brFields'), e.fields);
    msg.textContent = 'From #' + r.subtitle.index + ': “' + r.subtitle.text + '”' + (kept ? ' · kept ' + kept + ' edited field' + (kept > 1 ? 's' : '') : '');
    msg.dataset.kind = 'ok';
    // place it on that subtitle too, unless the user picked marks or the playhead
    if ($('brWhere').value === 'num') $('brSub').value = r.subtitle.index;
    brPreviewSoon(true);
    brLiveSoon();
}
