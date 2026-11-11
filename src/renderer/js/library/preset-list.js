// The preset list: row menu, tags section, drag-to-reorder, view modes and renderAnimations.

async function toggleTagOn(id, tagId) {
    const a = libEntry(id);
    if (!a) return false;
    const mine = Array.isArray(a.tags) ? a.tags : [];
    const next = mine.includes(tagId) ? mine.filter(x => x !== tagId) : mine.concat(tagId);
    takeLib(await window.sa.updateAnimation(a.id, { tags: next }));
    return next.includes(tagId);
}

// The ⋯ menu on a library row: tick tags on/off, make a new tag, or delete the preset.
function openRowMenu(anchor, a) {
    openPop(anchor, 'pop-menu', (el) => {
        const head = document.createElement('div');
        head.className = 'pop-title'; head.textContent = 'Tags';
        el.appendChild(head);
        const mine = Array.isArray(a.tags) ? a.tags : [];
        if (!allTags().length) {
            const e = document.createElement('div');
            e.className = 'pop-empty'; e.textContent = 'No tags yet';
            el.appendChild(e);
        }
        for (const t of allTags()) {
            const it = document.createElement('button');
            it.className = 'pop-item' + (mine.includes(t.id) ? ' on' : '');
            const ck = document.createElement('span'); ck.className = 'pop-check'; ck.textContent = '✓';
            const d = tagMarkEl(t);
            const n = document.createElement('span'); n.className = 'pop-label'; n.textContent = t.name;
            it.append(ck, d, n);
            it.addEventListener('click', async () => { it.classList.toggle('on', await toggleTagOn(a.id, t.id)); });
            el.appendChild(it);
        }
        const nt = document.createElement('button');
        nt.className = 'pop-item';
        nt.innerHTML = '<span class="pop-check">+</span><span class="pop-label">New tag…</span>';
        nt.addEventListener('click', () => { closePop(); openNewTagPop(anchor, a.id); });
        el.appendChild(nt);
        const sep = document.createElement('div'); sep.className = 'pop-sep';
        el.appendChild(sep);
        const rev = document.createElement('button');
        rev.className = 'pop-item';
        rev.innerHTML = '<span class="pop-check">↺</span><span class="pop-label">Revert to original version</span>';
        rev.addEventListener('click', () => {
            closePop();
            openConfirmPop(anchor, {
                title: 'Revert to original version?',
                message: 'Restore "' + a.name + '" back to its original .settings file, text design, alignment, and sound? Any saved updates will be overwritten.',
                confirmText: 'Revert',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.revertAnimation(a.id);
                    if (takeLib(res)) {
                        setStatus('Reverted "' + a.name + '" to original version.', 'ok');
                    }
                }
            });
        });
        el.appendChild(rev);
        const del = document.createElement('button');
        del.className = 'pop-item danger';
        del.innerHTML = '<span class="pop-check">🗑</span><span class="pop-label">Delete preset</span>';
        del.addEventListener('click', async () => {
            closePop();
            if (!confirm('Delete "' + a.name + '" from your library?')) return;
            if (state.selectedId === a.id) state.selectedId = null;
            if (state.createId === a.id) state.createId = null;
            stopPreview();
            takeLib(await window.sa.removeAnimation(a.id));
        });
        el.appendChild(del);
    });
}

// Library tab: the Tags accordion (rename / recolor / delete; + makes a new one) and the editor's tag picker.
function renderTags() {
    const tags = allTags();
    const counts = {};
    for (const a of state.lib.animations) for (const id of (a.tags || [])) counts[id] = (counts[id] || 0) + 1;
    $('tagsSummary').textContent = tags.length ? String(tags.length) : 'none yet';
    const dots = $('tagsDots');
    dots.textContent = '';
    for (const t of tags.slice(0, 12)) {
        const d = tagMarkEl(t); d.title = t.name;
        dots.appendChild(d);
    }

    const list = $('tagList');
    const editing = list.contains(document.activeElement);   // don't wipe a rename in progress
    if (!editing) list.textContent = '';
    if (!editing && !tags.length) {
        const e = document.createElement('div');
        e.className = 'empty-tags';
        e.textContent = 'No tags yet. Click + to make one.';
        list.appendChild(e);
    }
    for (const t of (editing ? [] : tags)) {
        const row = document.createElement('div');
        row.className = 'tag-row';
        row.dataset.tagId = t.id;

        // Drag handle & order buttons
        const handle = document.createElement('span');
        handle.className = 'tag-handle';
        handle.textContent = '⋮⋮';
        handle.title = 'Drag to reorder tag sequence';
        handle.addEventListener('mousedown', (e) => startTagDrag(e, row, list));

        // Quick up / down arrows for accessible reordering
        const orderWrap = document.createElement('span');
        orderWrap.className = 'tag-order-btns';
        const upBtn = document.createElement('button');
        upBtn.className = 'ghost tag-arrow';
        upBtn.textContent = '▲';
        upBtn.title = 'Move earlier';
        upBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const current = allTags().slice();
            const idx = current.findIndex(x => x.id === t.id);
            if (idx > 0) {
                const temp = current[idx - 1];
                current[idx - 1] = current[idx];
                current[idx] = temp;
                saveTagList(current);
            }
        });
        const dnBtn = document.createElement('button');
        dnBtn.className = 'ghost tag-arrow';
        dnBtn.textContent = '▼';
        dnBtn.title = 'Move later';
        dnBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const current = allTags().slice();
            const idx = current.findIndex(x => x.id === t.id);
            if (idx >= 0 && idx < current.length - 1) {
                const temp = current[idx + 1];
                current[idx + 1] = current[idx];
                current[idx] = temp;
                saveTagList(current);
            }
        });
        orderWrap.append(upBtn, dnBtn);

        const col = document.createElement('label');
        col.className = 'tag-color'; col.style.background = t.color; col.title = 'Change color';
        const ci = document.createElement('input');
        ci.type = 'color'; ci.value = t.color;
        ci.addEventListener('input', () => { col.style.background = ci.value; });
        ci.addEventListener('change', () => saveTagList(allTags().map(x => x.id === t.id ? Object.assign({}, x, { color: ci.value }) : x)));
        col.appendChild(ci);
        // emoji (up to EMOJI_MAX): the button opens the picker; none = the colour dot is shown
        const em = document.createElement('button');
        em.type = 'button'; em.className = 'tag-emoji-btn' + (t.emoji ? '' : ' empty');
        em.textContent = t.emoji || '☺';
        em.title = 'Emoji for this tag (up to ' + EMOJI_MAX + '). None = the colour dot is shown.';
        em.addEventListener('click', (e) => { e.stopPropagation(); openTagEmojiPop(em, t); });
        const nm = document.createElement('input');
        nm.type = 'text'; nm.className = 'tag-name'; nm.value = t.name; nm.maxLength = 40; nm.title = 'Rename';
        nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') nm.blur(); if (e.key === 'Escape') { nm.value = t.name; nm.blur(); } });
        nm.addEventListener('change', () => {
            const v = nm.value.trim();
            if (!v) { nm.value = t.name; return; }
            if (v !== t.name) saveTagList(allTags().map(x => x.id === t.id ? Object.assign({}, x, { name: v }) : x));
        });
        const cnt = document.createElement('span');
        cnt.className = 'tag-count'; cnt.textContent = counts[t.id] || ''; cnt.title = (counts[t.id] || 0) + ' preset(s)';
        const x = document.createElement('button');
        x.className = 'ghost'; x.textContent = '×'; x.title = 'Delete tag';
        x.addEventListener('click', () => { deleteTagWithConfirm(t); });
        row.append(handle, orderWrap, col, em, nm, cnt, x);
        list.appendChild(row);
    }

    // the open preset's tags, with a + to make a new one on the spot
    const pick = $('animTags');
    const a = libEntry(state.createId);
    if (pick && a) {
        pick.textContent = '';
        const mine = Array.isArray(a.tags) ? a.tags : [];
        for (const t of tags) {
            pick.appendChild(tagChip(t, mine.includes(t.id), () => toggleTagOn(a.id, t.id)));
        }
        const plus = document.createElement('button');
        plus.className = 'tag-chip tag-chip-plus';
        plus.textContent = '+';
        plus.title = 'New tag';
        plus.addEventListener('click', (e) => { e.stopPropagation(); openNewTagPop(plus, a.id); });
        pick.appendChild(plus);
    }
}

// Tags grid: drag a tag by its handle. The tile follows the pointer and the other tiles reflow live
// around its slot (animated); the new order is saved on release.
function startTagDrag(e, rowEl, list) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const tiles = () => Array.from(list.querySelectorAll(':scope > .tag-row'));
    const startX = e.clientX, startY = e.clientY;
    let px = startX, py = startY;
    const start = rowEl.getBoundingClientRect();
    rowEl.classList.add('dragging');
    document.body.classList.add('tag-dragging');
    // FLIP: move the dragged tile in the DOM, then slide every other tile from its old spot to its new one
    const reflow = (mutate) => {
        const before = new Map(tiles().filter(r => r !== rowEl).map(r => [r, r.getBoundingClientRect()]));
        mutate();
        for (const [r, b] of before) {
            const n = r.getBoundingClientRect();
            const dx = b.left - n.left, dy = b.top - n.top;
            if (!dx && !dy) continue;
            r.style.transition = 'none';
            r.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
            r.getBoundingClientRect();
            r.style.transition = 'transform 0.16s ease';
            r.style.transform = '';
        }
    };
    const origin = { x: start.left, y: start.top };   // where the tile sat when the pointer went down
    const place = () => {
        const r = rowEl.getBoundingClientRect();
        const base = { x: r.left - parseFloat(rowEl.dataset.dx || 0), y: r.top - parseFloat(rowEl.dataset.dy || 0) };
        const dx = (origin.x + px - startX) - base.x, dy = (origin.y + py - startY) - base.y;
        rowEl.dataset.dx = dx; rowEl.dataset.dy = dy;
        rowEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    };
    const move = (ev) => {
        px = ev.clientX; py = ev.clientY;
        // the tile under the pointer (by its resting box) takes the dragged tile before or after it
        for (const r of tiles()) {
            if (r === rowEl) continue;
            const b = r.getBoundingClientRect();
            if (px < b.left || px > b.right || py < b.top || py > b.bottom) continue;
            const after = px > b.left + b.width / 2;
            if (after ? r.nextElementSibling !== rowEl : r.previousElementSibling !== rowEl) {
                reflow(() => (after ? r.after(rowEl) : r.before(rowEl)));
            }
            break;
        }
        place();
    };
    const up = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        rowEl.classList.remove('dragging');
        rowEl.style.transform = '';
        delete rowEl.dataset.dx; delete rowEl.dataset.dy;
        document.body.classList.remove('tag-dragging');
        const ids = tiles().map(r => r.dataset.tagId);
        const current = allTags().slice();
        if (ids.join('|') === current.map(x => x.id).join('|')) return;
        const byId = new Map(current.map(x => [x.id, x]));
        saveTagList(ids.map(id => byId.get(id)).filter(Boolean));
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
}

// Library: drag a preset by its handle to a new place in the list; the order is saved and used everywhere.
function startLibDrag(e, rowEl, a, list) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const scroller = (() => {
        for (let el = list.parentElement; el; el = el.parentElement) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
        }
        return document.scrollingElement;
    })();
    const startY = e.clientY, startScroll = scroller.scrollTop;
    let lastY = startY, target = null, timer = 0;
    const rows = () => Array.from(list.querySelectorAll(':scope > .libitem')).filter(r => r !== rowEl);
    const line = document.createElement('div');
    line.className = 'lib-drop-line';
    rowEl.classList.add('dragging');
    document.body.classList.add('lib-dragging');
    const update = () => {
        rowEl.style.transform = 'translateY(' + (lastY - startY + scroller.scrollTop - startScroll) + 'px)';
        const others = rows();
        target = null;
        for (const r of others) {
            const b = r.getBoundingClientRect();
            if (lastY < b.top + b.height / 2) { target = r; break; }
        }
        if (target) target.before(line);
        else if (others.length) others[others.length - 1].after(line);
    };
    const tick = () => {
        const sb = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
        let d = 0;
        if (lastY < sb.top + 36) d = -10; else if (lastY > sb.bottom - 36) d = 10;
        if (d) { scroller.scrollTop += d; update(); }
    };
    const move = (ev) => { lastY = ev.clientY; update(); };
    const up = async () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        clearInterval(timer);
        const ids = rows().map(r => r.dataset.id);
        const at = target ? ids.indexOf(target.dataset.id) : ids.length;
        ids.splice(at < 0 ? ids.length : at, 0, a.id);
        line.remove();
        rowEl.classList.remove('dragging');
        rowEl.style.transform = '';
        document.body.classList.remove('lib-dragging');
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener('click', swallow, true);
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);
        // The shown rows (maybe filtered by tag) take the slots those presets already had in the full list.
        const full = state.lib.animations.map(x => x.id);
        const shownSet = new Set(Array.from(list.querySelectorAll(':scope > .libitem')).map(r => r.dataset.id));
        const queue = ids.slice();
        const next = full.map(id => shownSet.has(id) ? queue.shift() : id);
        if (next.join('|') === full.join('|')) return;
        const byId = new Map(state.lib.animations.map(x => [x.id, x]));
        state.lib.animations = next.map(id => byId.get(id)).filter(Boolean);
        renderAll();
        takeLib(await window.sa.reorderAnimations(next));
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
    timer = setInterval(tick, 30);
    update();
}

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
    try { localStorage.setItem('sa.presetView', state.useViewMode); } catch (e) { /* ignore */ }
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
        try { m = localStorage.getItem('sa.useOrder') || 'default'; } catch (e) { m = 'default'; }
        state.useOrderMode = m === 'custom' ? 'custom' : 'default';
    }
    return state.useOrderMode;
}
function setUseOrderMode(mode) {
    state.useOrderMode = mode === 'custom' ? 'custom' : 'default';
    try { localStorage.setItem('sa.useOrder', state.useOrderMode); } catch (e) { /* ignore */ }
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
    try { localStorage.setItem('sa.useOrder', 'custom'); } catch (e) { /* ignore */ }
    renderAnimations();
    takeLib(await window.sa.setUseOrder(ids));
    if (wasDefault) setStatus('Switched to Custom order. Pick Default order to see the original sequence again.', 'ok');
}

function setPresetCompact(on) {
    state.presetCompact = !!on;
    try { localStorage.setItem('sa.presetCompact', on ? '1' : '0'); } catch (e) { /* ignore */ }
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
    try { compact = localStorage.getItem('sa.presetCompact') === '1'; } catch (e) { compact = false; }
    setPresetCompact(compact);
    const compactBtn = $('presetCompactBtn');
    if (compactBtn) compactBtn.addEventListener('click', () => setPresetCompact(!state.presetCompact));
    const ordSel = $('orderModeSelect');
    if (ordSel) ordSel.addEventListener('change', () => setUseOrderMode(ordSel.value));
    syncOrderButtons();
    let saved = 'list';
    try { saved = localStorage.getItem('sa.presetView') || 'list'; } catch (e) { saved = 'list'; }
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

// renderAll (every library payload, after most actions) rebuilds the whole preset grid. This builds it only when
// something it shows has changed: the presets' listed fields, the view mode, search, tag filter, order, selection and
// variant fronts. Anything that calls renderAnimations() directly still rebuilds unconditionally.
let animGridSig = '';
function animGridSignature() {
    const lib = state.lib || {};
    const anims = (lib.animations || []).map(a => [a.id, a.name, a.updatedAt, a.missing ? 1 : 0, a.preview ? (a.preview.stamp || 0) + ':' + (a.preview.count || 0) : '-',
        (a.tags || []).join(','), a.sfx || '', a.isMultiText ? 1 : 0, a.variantGroup || '', a.useSfx === false ? 0 : 1, a.sample || '']);
    let filter = '';
    try { filter = JSON.stringify(typeof tagUI !== 'undefined' && tagUI.filter ? tagUI.filter.use : null); } catch (e) { filter = '?'; }
    return JSON.stringify([state.useViewMode, state.presetSearch || '', filter, state.selectedId, useOrderMode(), lib.useOrder || null,
        state.variantFront || null, anims]);
}
function renderAnimationsIfChanged() {
    const sig = animGridSignature();
    if (sig === animGridSig && $('animGrid') && $('animGrid').childElementCount) return false;
    renderAnimations();
    return true;
}

// Use tab: the text + sound effects that are already made. Click one to pick it.
function renderAnimations() {
    const grid = $('animGrid');
    if (!grid) return;
    animGridSig = animGridSignature();
    grid.textContent = '';
    const mode = state.useViewMode;
    grid.className = 'grid ' + (mode === 'grid' ? 'view-grid' : (mode === 'gallery' ? 'view-gallery' : 'view-list'));
    const n = state.lib.animations.length;
    $('libCount').textContent = n ? n + ' saved' : '';
    if (window.SAThumbs) SAThumbs.syncHeader();
    renderTagFilter('use', 'useFilter');
    if (!n) {
        const d = document.createElement('div');
        d.className = 'empty';
        d.textContent = 'Nothing here yet. Open the Create tab to make your first text + sound effect.';
        grid.appendChild(d);
        return;
    }

    const query = (state.presetSearch || '').trim().toLowerCase();
    syncOrderButtons();
    const shown = orderedForUse().filter(a => {
        if (!passesTagFilter(a, 'use')) return false;
        if (query && !a.name.toLowerCase().includes(query)) return false;
        return true;
    });

    if (n && !shown.length) {
        const d = document.createElement('div');
        d.className = 'empty';
        d.textContent = query
            ? 'No presets matching "' + state.presetSearch.trim() + '".'
            : 'No presets have the selected tags.';
        grid.appendChild(d);
        return;
    }
    if (n && shown.length !== n) $('libCount').textContent = shown.length + ' of ' + n;

    if (mode === 'gallery') {
        const container = document.createElement('div');
        container.className = 'gallery-container';

        const stage = document.createElement('div');
        stage.className = 'gallery-viewport-row';

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'gallery-arrow gallery-prev';
        prevBtn.title = 'Previous preset';
        prevBtn.setAttribute('aria-label', 'Previous preset');
        prevBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 2 4 8 10 14"></polyline></svg>';

        const track = document.createElement('div');
        track.className = 'gallery-track';
        track.setAttribute('tabindex', '0');
        track.setAttribute('role', 'region');
        track.setAttribute('aria-label', 'Preset gallery carousel');

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'gallery-arrow gallery-next';
        nextBtn.title = 'Next preset';
        nextBtn.setAttribute('aria-label', 'Next preset');
        nextBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 2 12 8 6 14"></polyline></svg>';

        stage.append(prevBtn, track, nextBtn);

        const footer = document.createElement('div');
        footer.className = 'gallery-indicator-bar';

        const namePill = document.createElement('div');
        namePill.className = 'gallery-name-pill';
        const nameText = document.createElement('span');
        nameText.className = 'gallery-active-title';
        namePill.appendChild(nameText);

        const dotsScroll = document.createElement('div');
        dotsScroll.className = 'gallery-dots-scroll';
        const dotsWrap = document.createElement('div');
        dotsWrap.className = 'gallery-dots';
        dotsScroll.appendChild(dotsWrap);

        footer.append(namePill, dotsScroll);
        container.append(stage, footer);
        grid.appendChild(container);

        const cardEls = [];
        const dotEls = [];
        const items = variantItems(shown);
        // the preset on top of item i (a stack shows one variant at a time)
        const frontOf = (i) => items[i] && (items[i].find(m => cardEls[i] && m.id === cardEls[i].dataset.id) || items[i][0]);

        let activeIdx = items.findIndex(it => it.some(a => a.id === state.selectedId));
        if (activeIdx < 0) {
            activeIdx = 0;
            state.selectedId = items[0][0].id;
            syncUse(true);
        }

        const updateIndicator = (idx) => {
            const cur = frontOf(idx);
            if (!cur) return;
            nameText.textContent = cur.name + (items[idx].length > 1 ? '  \u00b7  ' + (items[idx].indexOf(cur) + 1) + '/' + items[idx].length + ' variations' : '');
            namePill.title = cur.name;
            dotEls.forEach((dot, i) => {
                const isActive = (i === idx);
                dot.classList.toggle('active', isActive);
                dot.setAttribute('aria-selected', isActive ? 'true' : 'false');
                if (isActive) {
                    dot.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
            });
            prevBtn.disabled = (idx <= 0);
            nextBtn.disabled = (idx >= items.length - 1);
        };

        const selectPreset = (idx, scrollTrack = true) => {
            if (idx < 0 || idx >= items.length) return;
            activeIdx = idx;
            const a = frontOf(idx);
            state.selectedId = a.id;
            syncUse(true);
            cardEls.forEach((c, i) => c.classList.toggle('sel', i === idx));
            updateIndicator(idx);
            if (scrollTrack && cardEls[idx]) {
                cardEls[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
            // The SELECTED panel (title, MultiText split, alignment, preview) follows the gallery right away, like List / Grid do.
            // (renderAll would rebuild the carousel under the finger, so only the settings are redrawn.)
            renderSettings();
            renderUseSummary();
            refreshLiveBar();
            if (state.livePrev && !state.busy) switchLivePreset(a);
        };

        items.forEach((members, idx) => {
            const a = members[0];
            let c;
            if (members.length > 1) {
                // Stacked variations: swipe up / down on the card flips variants; sideways still moves the gallery.
                c = variantStackCard(members, members[0].variantGroup, {
                    axis: 'y',
                    onPick: () => { stopPreview(); selectPreset(idx, true); },
                    onFlip: () => { if (idx === activeIdx) updateIndicator(idx); }
                });
            } else {
                c = presetCardEl(a);
                c.addEventListener('click', () => {
                    stopPreview();
                    selectPreset(idx, true);
                });
                wireCardStacking(c, a, members);
            }
            c.classList.toggle('sel', idx === activeIdx);
            track.appendChild(c);
            cardEls.push(c);

            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'gallery-dot' + (idx === activeIdx ? ' active' : '');
            dot.textContent = String(idx + 1);
            dot.title = (idx + 1) + '. ' + members.map(m => m.name).join(' / ');
            dot.classList.toggle('stacked', members.length > 1);
            dot.setAttribute('aria-label', dot.title);
            dot.addEventListener('click', (e) => {
                e.stopPropagation();
                stopPreview();
                selectPreset(idx, true);
            });
            dotsWrap.appendChild(dot);
            dotEls.push(dot);
        });

        updateIndicator(activeIdx);
        requestAnimationFrame(() => {
            if (cardEls[activeIdx]) {
                cardEls[activeIdx].scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
            }
        });

        prevBtn.addEventListener('click', () => {
            stopPreview();
            if (activeIdx > 0) selectPreset(activeIdx - 1, true);
        });
        nextBtn.addEventListener('click', () => {
            stopPreview();
            if (activeIdx < items.length - 1) selectPreset(activeIdx + 1, true);
        });

        track.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                stopPreview();
                if (activeIdx > 0) selectPreset(activeIdx - 1, true);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                stopPreview();
                if (activeIdx < items.length - 1) selectPreset(activeIdx + 1, true);
            }
        });

        track.addEventListener('wheel', (e) => {
            if (e.defaultPrevented) return;       // a stack card used it to flip variants
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                e.preventDefault();
                track.scrollLeft += e.deltaY;
            }
        }, { passive: false });

        const getCenteredIdx = () => {
            if (!cardEls.length) return 0;
            const tRect = track.getBoundingClientRect();
            const center = tRect.left + tRect.width / 2;
            let bestIdx = 0;
            let minDist = Infinity;
            for (let i = 0; i < cardEls.length; i++) {
                const r = cardEls[i].getBoundingClientRect();
                const cCenter = r.left + r.width / 2;
                const dist = Math.abs(cCenter - center);
                if (dist < minDist) {
                    minDist = dist;
                    bestIdx = i;
                }
            }
            return bestIdx;
        };

        let isScrolling = null;
        track.addEventListener('scroll', () => {
            const cIdx = getCenteredIdx();
            if (cIdx !== activeIdx && cIdx >= 0 && cIdx < items.length) {
                activeIdx = cIdx;
                updateIndicator(cIdx);
            }
            clearTimeout(isScrolling);
            isScrolling = setTimeout(() => {
                const finalIdx = getCenteredIdx();
                selectPreset(finalIdx, false);
            }, 60);
        }, { passive: true });
        track.addEventListener('scrollend', () => { clearTimeout(isScrolling); selectPreset(getCenteredIdx(), false); });

        return;
    }

    // List / Grid: presets that share a variantGroup show as ONE stacked card you can swipe through.
    for (const members of variantItems(shown)) {
        if (members.length > 1) { grid.appendChild(variantStackCard(members, members[0].variantGroup)); continue; }
        const a = members[0];
        const c = presetCardEl(a);
        c.addEventListener('click', () => pickPresetCard(a));
        wireCardStacking(c, a, [a]);
        grid.appendChild(c);
    }
}

// The shown presets as display items: each stack (same variantGroup) becomes one item, at its first member's place.
function variantItems(shown) {
    const out = [], emitted = new Set();
    for (const a of shown) {
        const g = a.variantGroup;
        if (g && emitted.has(g)) continue;
        if (g) emitted.add(g);
        out.push(g ? shown.filter(x => x.variantGroup === g) : [a]);
    }
    return out;
}

// One preset card's contents (thumb, name, sound note, tag dots).
function fillPresetCard(c, a) {
    c.classList.toggle('missing', !!a.missing);
    const nm = document.createElement('div');
    nm.className = 'nm'; nm.textContent = a.name;
    const sub = document.createElement('div');
    sub.className = 'sub';
    const hasSound = a.useSfx !== false && (a.sfx || state.lib.defaultSfx);
    sub.textContent = hasSound ? '\u266a' : '';
    sub.title = a.useSfx === false ? 'No sound' : (a.sfx ? a.sfx : (state.lib.defaultSfx ? 'Default sound' : 'No sound set'));
    if (window.SAThumbs) c.appendChild(SAThumbs.thumb(a));
    c.append(nm, sub);
    const dots = tagDotsEl(a);
    if (dots) c.appendChild(dots);
}

function presetCardEl(a) {
    const c = document.createElement('div');
    c.className = 'card' + (a.id === state.selectedId ? ' sel' : '');
    c.dataset.id = a.id;
    fillPresetCard(c, a);
    return c;
}

function pickPresetCard(a) {
    stopPreview();
    state.selectedId = a.id;
    syncUse(true);
    renderAll();
    refreshLiveBar();
    if (state.livePrev && !state.busy) switchLivePreset(a);
}

// ---------------------------------------------------------------- variation stacks
// Which variant sits on top of each stack (remembered per viewer).
function variantFronts() {
    if (!state.variantFront) {
        try { state.variantFront = JSON.parse(localStorage.getItem('sa.variantFront') || '{}') || {}; } catch (e) { state.variantFront = {}; }
    }
    return state.variantFront;
}
function setVariantFront(g, id) {
    variantFronts()[g] = id;
    try { localStorage.setItem('sa.variantFront', JSON.stringify(state.variantFront)); } catch (e) { /* ignore */ }
}

const LAYERS_SVG = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M8 1.8 14.5 5 8 8.2 1.5 5z"/><path d="M1.5 8 8 11.2 14.5 8"/><path d="M1.5 11 8 14.2 14.5 11"/></svg>';

// opts: axis 'x' (default) or 'y' for the swipe that flips variants; onPick(a) replaces the click; onFlip(a) after a flip.
function variantStackCard(members, g, opts) {
    opts = opts || {};
    const axis = opts.axis === 'y' ? 'y' : 'x';
    let idx = members.findIndex(m => m.id === state.selectedId);
    if (idx < 0) idx = Math.max(0, members.findIndex(m => m.id === variantFronts()[g]));
    const c = document.createElement('div');
    c.className = 'card var-stack' + (members.length > 2 ? ' var-3' : '');
    c.title = (axis === 'y' ? 'Swipe up / down' : 'Swipe sideways') + ' (or use the arrows) to see the other variations';

    const prev = document.createElement('button');
    prev.type = 'button'; prev.className = 'var-nav var-prev'; prev.title = 'Previous variation';
    prev.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 2 4 8 10 14"></polyline></svg>';
    const next = document.createElement('button');
    next.type = 'button'; next.className = 'var-nav var-next'; next.title = 'Next variation';
    next.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 2 12 8 6 14"></polyline></svg>';
    const badge = document.createElement('span');
    badge.className = 'var-badge';
    const dots = document.createElement('span');
    dots.className = 'var-dots';
    const dotEls = members.map((m, i) => {
        const d = document.createElement('i');
        d.title = m.name;
        d.addEventListener('click', (e) => { e.stopPropagation(); show(i, i > idx ? 1 : -1); });
        dots.appendChild(d);
        return d;
    });

    const paint = (dir) => {
        const a = members[idx];
        c.dataset.id = a.id;
        c.textContent = '';
        fillPresetCard(c, a);
        c.classList.toggle('sel', members.some(m => m.id === state.selectedId));
        const wrap = c.querySelector('.thumb-wrap') || c;
        badge.innerHTML = LAYERS_SVG + '<b>' + (idx + 1) + '/' + members.length + '</b>';
        badge.title = members.length + ' variations: ' + members.map(m => m.name).join(', ');
        dotEls.forEach((d, i) => d.classList.toggle('on', i === idx));
        wrap.append(badge, dots, prev, next);
        if (dir) {
            wrap.classList.remove('var-in-l', 'var-in-r');
            void wrap.offsetWidth;
            wrap.classList.add(dir > 0 ? 'var-in-r' : 'var-in-l');
        }
    };

    const show = (i, dir) => {
        const n = members.length;
        i = ((i % n) + n) % n;
        if (i === idx) return;
        idx = i;
        const a = members[idx];
        setVariantFront(g, a.id);
        const wasSel = members.some(m => m.id === state.selectedId);
        if (wasSel) {
            // The stack is the selected card: the selection follows the variant on top (like the Gallery view).
            stopPreview();
            state.selectedId = a.id;
            syncUse(true);
            renderSettings();
            renderUseSummary();
            refreshLiveBar();
            if (state.livePrev && !state.busy) switchLivePreset(a);
        }
        paint(dir);
        if (opts.onFlip) opts.onFlip(a);
    };

    prev.addEventListener('click', (e) => { e.stopPropagation(); show(idx - 1, -1); });
    next.addEventListener('click', (e) => { e.stopPropagation(); show(idx + 1, 1); });

    // Two-finger trackpad swipe: one step per gesture.
    let acc = 0, locked = false, quiet = 0;
    c.addEventListener('wheel', (e) => {
        const along = axis === 'y' ? e.deltaY : e.deltaX, across = axis === 'y' ? e.deltaX : e.deltaY;
        if (Math.abs(along) <= Math.abs(across)) return;
        e.preventDefault();
        clearTimeout(quiet);
        quiet = setTimeout(() => { acc = 0; locked = false; }, 180);
        if (locked) return;
        acc += along;
        if (Math.abs(acc) > 30) { locked = true; show(idx + (acc > 0 ? 1 : -1), acc > 0 ? 1 : -1); acc = 0; }
    }, { passive: false });

    c.addEventListener('click', () => (opts.onPick || pickPresetCard)(members[idx]));
    wireCardStacking(c, () => members[idx], members);
    paint(0);
    return c;
}

// Drag a card onto another card to stack them as variations; right-click for the stack menu.
let stackDrag = null;
function wireCardStacking(c, front, members) {
    const cur = () => (typeof front === 'function' ? front() : front);
    c.draggable = true;
    c.addEventListener('dragstart', (e) => {
        stackDrag = members.slice();
        c.classList.add('var-dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', cur().id); } catch (err) { /* ignore */ }
    });
    const clear = () => c.classList.remove('over', 'drop-before', 'drop-after');
    // Where the drop lands: the outer edges of a card move the dragged card there; the middle stacks it.
    const zone = (e) => {
        const r = c.getBoundingClientRect();
        const vertical = state.useViewMode === 'list';
        const f = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
        return f < 0.28 ? 'before' : (f > 0.72 ? 'after' : 'stack');
    };
    const sameCard = () => !stackDrag || stackDrag.some(m => members.some(x => x.id === m.id));
    c.addEventListener('dragend', () => {
        stackDrag = null;
        c.classList.remove('var-dragging');
        document.querySelectorAll('#animGrid .card').forEach(x => x.classList.remove('over', 'drop-before', 'drop-after'));
    });
    c.addEventListener('dragover', (e) => {
        if (sameCard()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const z = zone(e);
        c.classList.toggle('over', z === 'stack');
        c.classList.toggle('drop-before', z === 'before');
        c.classList.toggle('drop-after', z === 'after');
    });
    c.addEventListener('dragleave', (e) => { if (!c.contains(e.relatedTarget)) clear(); });
    c.addEventListener('drop', (e) => {
        e.preventDefault();
        clear();
        if (sameCard()) { stackDrag = null; return; }
        const dragged = stackDrag, z = zone(e);
        stackDrag = null;
        if (z === 'stack') stackAsVariations(cur(), dragged);
        else moveInUseOrder(dragged, members, z === 'after');
    });
    c.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openVariantMenu(c, cur(), members);
    });
}

function newVariantGroupId() { return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Put `presets` into target's stack (making one if target isn't stacked yet).
async function stackAsVariations(target, presets) {
    const g = target.variantGroup || newVariantGroupId();
    let res = null;
    if (target.variantGroup !== g) res = await window.sa.updateAnimation(target.id, { variantGroup: g });
    // a whole stack dropped on a card brings every preset of that group, even ones hidden by the filter
    const ids = new Set(presets.map(p => p.id));
    for (const p of presets) if (p.variantGroup) for (const x of state.lib.animations) if (x.variantGroup === p.variantGroup) ids.add(x.id);
    for (const id of ids) if (id !== target.id) res = await window.sa.updateAnimation(id, { variantGroup: g });
    setVariantFront(g, target.id);
    if (res) takeLib(res);
    setStatus('Stacked ' + ids.size + ' preset' + (ids.size === 1 ? '' : 's') + ' with "' + target.name + '" as variations.', 'ok');
}

async function unstackVariation(a, all) {
    const g = a.variantGroup;
    if (!g) return;
    const group = state.lib.animations.filter(x => x.variantGroup === g);
    // the last one left on its own isn't a stack any more
    const clear = all || group.length <= 2 ? group : [a];
    let res = null;
    for (const x of clear) res = await window.sa.updateAnimation(x.id, { variantGroup: null });
    if (res) takeLib(res);
    setStatus(all ? 'Unstacked the variations.' : 'Took "' + a.name + '" out of its stack.', 'ok');
}

function openVariantMenu(anchor, a, members) {
    openPop(anchor, 'pop-menu', (el) => {
        const item = (icon, label, fn, cls) => {
            const it = document.createElement('button');
            it.className = 'pop-item' + (cls ? ' ' + cls : '');
            const ck = document.createElement('span'); ck.className = 'pop-check'; ck.textContent = icon;
            const n = document.createElement('span'); n.className = 'pop-label'; n.textContent = label;
            it.append(ck, n);
            it.addEventListener('click', () => { closePop(); fn(); });
            el.appendChild(it);
        };
        const head = document.createElement('div');
        head.className = 'pop-title'; head.textContent = 'Variations';
        el.appendChild(head);
        if (a.variantGroup) {
            item('\u2197', 'Remove "' + a.name + '" from stack', () => unstackVariation(a, false));
            item('\u2715', 'Unstack all ' + members.length, () => unstackVariation(a, true));
        }
        const head2 = document.createElement('div');
        head2.className = 'pop-title'; head2.textContent = a.variantGroup ? 'Add to this stack' : 'Stack as variation of\u2026';
        el.appendChild(head2);
        const seen = new Set();
        const others = state.lib.animations.filter(x => {
            if (members.includes(x) || (a.variantGroup && x.variantGroup === a.variantGroup)) return false;
            if (x.variantGroup) { if (seen.has(x.variantGroup)) return false; seen.add(x.variantGroup); }
            return true;
        });
        const scroll = document.createElement('div');
        scroll.className = 'pop-scroll';
        el.appendChild(scroll);
        for (const x of others) {
            const n = x.variantGroup ? state.lib.animations.filter(y => y.variantGroup === x.variantGroup).length : 0;
            const it = document.createElement('button');
            it.className = 'pop-item';
            const ck = document.createElement('span'); ck.className = 'pop-check'; ck.textContent = n ? '\u29C9' : '';
            const lb = document.createElement('span'); lb.className = 'pop-label';
            lb.textContent = x.name + (n ? '  (' + n + ')' : '');
            it.append(ck, lb);
            // Add-to-this-stack brings x (and its stack) here; otherwise this card joins x's stack.
            it.addEventListener('click', () => { closePop(); if (a.variantGroup) stackAsVariations(a, [x]); else stackAsVariations(x, members); });
            scroll.appendChild(it);
        }
        if (!others.length) {
            const e = document.createElement('div');
            e.className = 'pop-empty'; e.textContent = 'No other presets';
            el.appendChild(e);
        }
        const tip = document.createElement('div');
        tip.className = 'pop-empty';
        tip.textContent = 'Tip: drop a card on the middle of another to stack it, on its edge to move it.';
        el.appendChild(tip);
    });
}

