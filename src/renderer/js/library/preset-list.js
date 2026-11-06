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
            const d = document.createElement('span'); d.className = 'tag-dot'; d.style.background = t.color;
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
        const d = document.createElement('span');
        d.className = 'tag-dot'; d.style.background = t.color; d.title = t.name;
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
        handle.draggable = true;

        handle.addEventListener('dragstart', (e) => {
            row.classList.add('dragging');
            e.dataTransfer.setData('text/plain', t.id);
            e.dataTransfer.effectAllowed = 'move';
        });
        handle.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            document.querySelectorAll('#tagList .tag-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
        });

        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = row.getBoundingClientRect();
            const relY = e.clientY - rect.top;
            if (relY < rect.height / 2) {
                row.classList.add('drag-over-top');
                row.classList.remove('drag-over-bottom');
            } else {
                row.classList.add('drag-over-bottom');
                row.classList.remove('drag-over-top');
            }
        });
        row.addEventListener('dragleave', () => {
            row.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('drag-over-top', 'drag-over-bottom');
            const draggedId = e.dataTransfer.getData('text/plain');
            if (!draggedId || draggedId === t.id) return;
            const current = allTags().slice();
            const fromIdx = current.findIndex(x => x.id === draggedId);
            const toIdx = current.findIndex(x => x.id === t.id);
            if (fromIdx < 0 || toIdx < 0) return;
            const rect = row.getBoundingClientRect();
            const relY = e.clientY - rect.top;
            const [item] = current.splice(fromIdx, 1);
            let targetIdx = current.findIndex(x => x.id === t.id);
            if (relY >= rect.height / 2) targetIdx++;
            current.splice(targetIdx, 0, item);
            saveTagList(current);
        });

        // Quick up / down arrows for accessible reordering
        const orderWrap = document.createElement('span');
        orderWrap.className = 'tag-order-btns';
        const upBtn = document.createElement('button');
        upBtn.className = 'ghost tag-arrow';
        upBtn.textContent = '▲';
        upBtn.title = 'Move up';
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
        dnBtn.title = 'Move down';
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
        row.append(handle, orderWrap, col, nm, cnt, x);
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

function setPresetViewMode(mode) {
    state.useViewMode = (mode === 'grid' || mode === 'gallery') ? mode : 'list';
    try { localStorage.setItem('sa.presetView', state.useViewMode); } catch (e) { /* ignore */ }
    const grid = $('animGrid');
    if (grid) {
        grid.classList.toggle('view-grid', state.useViewMode === 'grid');
        grid.classList.toggle('view-list', state.useViewMode === 'list');
        grid.classList.toggle('view-gallery', state.useViewMode === 'gallery');
    }
    const listBtn = $('viewListBtn'), gridBtn = $('viewGridBtn'), galleryBtn = $('viewGalleryBtn');
    if (listBtn) listBtn.classList.toggle('on', state.useViewMode === 'list');
    if (gridBtn) gridBtn.classList.toggle('on', state.useViewMode === 'grid');
    if (galleryBtn) galleryBtn.classList.toggle('on', state.useViewMode === 'gallery');
    renderAnimations();
}

function initPresetViewMode() {
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
    const listBtn = $('viewListBtn'), gridBtn = $('viewGridBtn'), galleryBtn = $('viewGalleryBtn');
    if (listBtn) {
        listBtn.classList.toggle('on', state.useViewMode === 'list');
        listBtn.addEventListener('click', () => setPresetViewMode('list'));
    }
    if (gridBtn) {
        gridBtn.classList.toggle('on', state.useViewMode === 'grid');
        gridBtn.addEventListener('click', () => setPresetViewMode('grid'));
    }
    if (galleryBtn) {
        galleryBtn.classList.toggle('on', state.useViewMode === 'gallery');
        galleryBtn.addEventListener('click', () => setPresetViewMode('gallery'));
    }

    const searchInput = $('presetSearch');
    const searchClear = $('presetSearchClear');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.presetSearch = e.target.value;
            if (searchClear) searchClear.classList.toggle('hidden', !state.presetSearch);
            // Typing in the search picks the first match straight away (the panel below follows it).
            const q = state.presetSearch.trim().toLowerCase();
            const first = q ? state.lib.animations.find(a => passesTagFilter(a, 'use') && a.name.toLowerCase().includes(q)) : null;
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

// Use tab: the text + sound effects that are already made. Click one to pick it.
function renderAnimations() {
    const grid = $('animGrid');
    if (!grid) return;
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
    const shown = state.lib.animations.filter(a => {
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

        let activeIdx = shown.findIndex(a => a.id === state.selectedId);
        if (activeIdx < 0) {
            activeIdx = 0;
            state.selectedId = shown[0].id;
            syncUse(true);
        }

        const updateIndicator = (idx) => {
            const cur = shown[idx];
            if (!cur) return;
            nameText.textContent = cur.name;
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
            nextBtn.disabled = (idx >= shown.length - 1);
        };

        const selectPreset = (idx, scrollTrack = true) => {
            if (idx < 0 || idx >= shown.length) return;
            activeIdx = idx;
            const a = shown[idx];
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

        shown.forEach((a, idx) => {
            const c = document.createElement('div');
            c.className = 'card' + (idx === activeIdx ? ' sel' : '') + (a.missing ? ' missing' : '');
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

            c.addEventListener('click', () => {
                stopPreview();
                selectPreset(idx, true);
            });
            track.appendChild(c);
            cardEls.push(c);

            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'gallery-dot' + (idx === activeIdx ? ' active' : '');
            dot.title = a.name;
            dot.setAttribute('aria-label', a.name);
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
            if (activeIdx < shown.length - 1) selectPreset(activeIdx + 1, true);
        });

        track.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                stopPreview();
                if (activeIdx > 0) selectPreset(activeIdx - 1, true);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                stopPreview();
                if (activeIdx < shown.length - 1) selectPreset(activeIdx + 1, true);
            }
        });

        track.addEventListener('wheel', (e) => {
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
            if (cIdx !== activeIdx && cIdx >= 0 && cIdx < shown.length) {
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

    for (const a of shown) {
        const c = document.createElement('div');
        c.className = 'card' + (a.id === state.selectedId ? ' sel' : '') + (a.missing ? ' missing' : '');
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
        c.addEventListener('click', () => {
            stopPreview();
            state.selectedId = a.id;
            syncUse(true);
            renderAll();
            refreshLiveBar();
            if (state.livePrev && !state.busy) switchLivePreset(a);
        });
        grid.appendChild(c);
    }
}
