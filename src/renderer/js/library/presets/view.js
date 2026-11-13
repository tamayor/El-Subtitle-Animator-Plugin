// The preset list: view modes (list / grid / gallery), Use-tab order, compact cards.

// View mode dropdown (icon button + menu) in the Text Preset header.
const VIEW_MODES = [
    { id: 'list', label: 'List', svg: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><line x1="2.5" y1="4" x2="13.5" y2="4"/><line x1="2.5" y1="8" x2="13.5" y2="8"/><line x1="2.5" y1="12" x2="13.5" y2="12"/></svg>' },
    { id: 'grid', label: 'Grid', svg: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>' },
    { id: 'gallery', label: 'Gallery', svg: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="8" height="10" rx="1.2"/><path d="M1.5 5v6M14.5 5v6" stroke-linecap="round"/></svg>' },
];
function syncViewModeBtn() {
    const m = VIEW_MODES.find(v => v.id === state.useViewMode) || VIEW_MODES[0];
    const ico = $('viewModeIco');
    if (ico) ico.innerHTML = m.svg;
    const btn = $('viewModeBtn');
    if (btn) btn.title = 'View: ' + m.label + ' (click to show the presets as List, Grid or Gallery)';
}

function setPresetViewMode(mode) {
    state.useViewMode = (mode === 'grid' || mode === 'gallery') ? mode : 'list';
    store.set('sa.presetView', state.useViewMode);
    const grid = $('animGrid');
    if (grid) {
        grid.classList.toggle('view-grid', state.useViewMode === 'grid');
        grid.classList.toggle('view-list', state.useViewMode === 'list');
        grid.classList.toggle('view-gallery', state.useViewMode === 'gallery');
    }
    syncViewModeBtn();
    applyPresetCompact();
    renderAnimations();
}

// ---------------------------------------------------------------- Use tab order: Default (original sequence) or Custom
function useOrderMode() {
    if (!state.useOrderMode) {
        let m = 'default';
        m = store.get('sa.useOrder') || 'default';
        state.useOrderMode = m === 'custom' ? 'custom' : 'default';
    }
    return state.useOrderMode;
}
function setUseOrderMode(mode) {
    state.useOrderMode = mode === 'custom' ? 'custom' : 'default';
    store.set('sa.useOrder', state.useOrderMode);
    renderAnimations();
}
function syncOrderButtons() {
    const m = useOrderMode();
    if ($('orderModeSelect')) $('orderModeSelect').value = m;
}

// Every preset in the order the Use tab shows them. Custom: the saved useOrder, presets not in it yet go at the end.
function orderedForUse() {
    const all = state.lib.animations;
    if (useOrderMode() !== 'custom') return all;
    const order = Array.isArray(state.lib.useOrder) ? state.lib.useOrder : [];
    const at = new Map(order.map((id, i) => [id, i]));
    return all.map((a, i) => ({ a, k: at.has(a.id) ? at.get(a.id) : order.length + i })).sort((x, y) => x.k - y.k).map(x => x.a);
}

// Move the dragged card (a preset or a whole stack) before / after the target card in the Custom order.
async function moveInUseOrder(dragged, target, after) {
    const wasDefault = useOrderMode() !== 'custom';
    const items = variantItems(orderedForUse());          // stacks move as one, so their presets stay together
    const dIds = new Set(dragged.map(m => m.id)), tIds = new Set(target.map(m => m.id));
    const moving = items.filter(it => it.some(m => dIds.has(m.id)));
    const rest = items.filter(it => !it.some(m => dIds.has(m.id)));
    let at = rest.findIndex(it => it.some(m => tIds.has(m.id)));
    if (at < 0) return;
    if (after) at++;
    rest.splice(at, 0, ...moving);
    const ids = [].concat(...rest).map(a => a.id);
    state.lib.useOrder = ids;
    state.useOrderMode = 'custom';
    store.set('sa.useOrder', 'custom');
    renderAnimations();
    takeLib(await window.sa.setUseOrder(ids));
    if (wasDefault) setStatus('Switched to Custom order. Pick Default order to see the original sequence again.', 'ok');
}

function setPresetCompact(on) {
    state.presetCompact = !!on;
    store.set('sa.presetCompact', on ? '1' : '0');
    applyPresetCompact();
}

// Compact does not apply to Gallery view (one card at a time): there it is off and the button is disabled.
// The saved choice is kept, so going back to List / Grid turns it on again.
function applyPresetCompact() {
    const gallery = state.useViewMode === 'gallery';
    const active = !!state.presetCompact && !gallery;
    const sec = $('presetSection');
    if (sec) sec.classList.toggle('preset-compact', active);
    const btn = $('presetCompactBtn');
    if (btn) {
        btn.disabled = gallery;
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.title = gallery
            ? 'Compact is not available in Gallery view'
            : 'Compact: limit this section to 80% of the panel height and scroll the presets inside it, so the sections below stay visible';
    }
    if (active) {
        // keep the selected preset in view inside the shortened list
        const sel = document.querySelector('#animGrid .sel');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
    }
}

function initPresetViewMode() {
    let compact = false;
    compact = store.get('sa.presetCompact') === '1';
    setPresetCompact(compact);
    const compactBtn = $('presetCompactBtn');
    if (compactBtn) compactBtn.addEventListener('click', () => setPresetCompact(!state.presetCompact));
    const ordSel = $('orderModeSelect');
    if (ordSel) ordSel.addEventListener('change', () => setUseOrderMode(ordSel.value));
    syncOrderButtons();
    let saved = 'list';
    saved = store.get('sa.presetView') || 'list';
    if (saved !== 'grid' && saved !== 'gallery' && saved !== 'list') saved = 'list';
    state.useViewMode = saved;
    const grid = $('animGrid');
    if (grid) {
        grid.classList.toggle('view-grid', state.useViewMode === 'grid');
        grid.classList.toggle('view-list', state.useViewMode === 'list');
        grid.classList.toggle('view-gallery', state.useViewMode === 'gallery');
    }
    applyPresetCompact();   // view mode is known now (Gallery turns Compact off)
    const viewBtn = $('viewModeBtn');
    if (viewBtn) {
        syncViewModeBtn();
        viewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPop(viewBtn, 'pop-menu pop-viewmode', (el) => {
                for (const m of VIEW_MODES) {
                    const it = document.createElement('button');
                    it.className = 'pop-item' + (state.useViewMode === m.id ? ' on' : '');
                    const ck = document.createElement('span');
                    ck.className = 'pop-check';
                    ck.textContent = '✓';
                    const ic = document.createElement('span');
                    ic.className = 'vm-ico';
                    ic.innerHTML = m.svg;
                    const lb = document.createElement('span');
                    lb.className = 'pop-label';
                    lb.textContent = m.label;
                    it.append(ck, ic, lb);
                    it.addEventListener('click', () => { closePop(); setPresetViewMode(m.id); });
                    el.appendChild(it);
                }
            });
        });
    }

    const searchInput = $('presetSearch');
    const searchClear = $('presetSearchClear');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.presetSearch = e.target.value;
            if (searchClear) searchClear.classList.toggle('hidden', !state.presetSearch);
            // Typing in the search picks the first match straight away (the panel below follows it).
            const q = state.presetSearch.trim().toLowerCase();
            const first = q ? orderedForUse().find(a => passesTagFilter(a, 'use') && a.name.toLowerCase().includes(q)) : null;
            if (first && first.id !== state.selectedId) {
                stopPreview();
                state.selectedId = first.id;
                syncUse(true);
                renderAll();
                refreshLiveBar();
                if (state.livePrev && !state.busy) switchLivePreset(first);
            } else renderAnimations();
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                searchInput.value = '';
                state.presetSearch = '';
                if (searchClear) searchClear.classList.add('hidden');
                renderAnimations();
            }
        });
    }
    if (searchClear) {
        searchClear.addEventListener('click', () => {
            if (searchInput) {
                searchInput.value = '';
                searchInput.focus();
            }
            state.presetSearch = '';
            searchClear.classList.add('hidden');
            renderAnimations();
        });
    }
}
