// The preset list: renderAnimations and the preset cards.

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
            dot.dataset.tip = (idx + 1) + '. ' + members.map(m => m.name).join(' / ');
            dot.classList.toggle('stacked', members.length > 1);
            dot.setAttribute('aria-label', dot.dataset.tip);
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
