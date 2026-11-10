// Use tab settings, accordions, SFX originals, and renderAll.

// Use tab: the picked item, its preview and the collapsible alignment.
function renderSettings() {
    const a = selected();
    $('settings').classList.add('hidden');   // the Use-tab settings box is empty now (its controls live in the sticky header): never show it
    if ($('useDockU')) $('useDockU').classList.toggle('hidden', !a);   // the sticky nav bar needs a selected preset
    if ($('useDockName')) $('useDockName').textContent = a ? a.name : '';
    if (!a) return;
    syncUse(false);
    if ($('useTitle')) $('useTitle').textContent = a.name;
    fillAdjust(CTX.U);
    if (window.SABoxes) SABoxes.render('U');
    if (!state.preview) drawStage('U', a, null);
    setAdjustOpen(state.adjustOpen);
    setTdOpen(state.tdOpen);
    renderUseSummary();
    renderTextStyleU(false);
}

function setAdjustOpen(wanted) {
    state.adjustOpen = wanted;
    const open = !!wanted;
    if ($('adjustBodyU')) $('adjustBodyU').classList.toggle('hidden', !open);
    if ($('adjustWrapU')) $('adjustWrapU').classList.toggle('open', !!open);
    if ($('adjustToggle')) {
        $('adjustToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = $('adjustToggle').querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
    }
    if (open) renderTimeline(CTX.U);
}

function setTdOpen(open) {
    state.tdOpen = open;
    if ($('tdBodyU')) $('tdBodyU').classList.toggle('hidden', !open);
    if ($('tdWrapU')) $('tdWrapU').classList.toggle('open', !!open);
    if ($('tdToggleU')) {
        $('tdToggleU').setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = $('tdToggleU').querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
    }
    redrawStages();
}

function setCreateAdjustOpen(open) {
    state.createAdjustOpen = open;
    if ($('adjustBodyC')) $('adjustBodyC').classList.toggle('hidden', !open);
    if ($('adjustWrapC')) $('adjustWrapC').classList.toggle('open', !!open);
    if ($('adjustToggleC')) {
        $('adjustToggleC').setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = $('adjustToggleC').querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
    }
    if (open) renderTimeline(CTX.C);
}

function setCreateFilesOpen(open) {
    state.createFilesOpen = open;
    if ($('filesBodyC')) $('filesBodyC').classList.toggle('hidden', !open);
    if ($('filesWrapC')) $('filesWrapC').classList.toggle('open', !!open);
    if ($('filesToggleC')) {
        $('filesToggleC').setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = $('filesToggleC').querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
    }
}

function setCreateTdOpen(open) {
    state.createTdOpen = open;
    if ($('tdBodyC')) $('tdBodyC').classList.toggle('hidden', !open);
    if ($('tdWrapC')) $('tdWrapC').classList.toggle('open', !!open);
    if ($('tdToggleC')) {
        $('tdToggleC').setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = $('tdToggleC').querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
    }
    redrawStages();
}

function setCreateConfigOpen(open) {
    state.createConfigOpen = open;
    if ($('configBodyC')) $('configBodyC').classList.toggle('hidden', !open);
    if ($('configWrapC')) $('configWrapC').classList.toggle('open', !!open);
    if ($('configToggleC')) {
        $('configToggleC').setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = $('configToggleC').querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
    }
    if (open) renderConfigC();
}

function setSfxOrigAccordionOpen(open) {
    state.sfxOrigOpen = open;
    const body = $('sfxOrigAccordionBody');
    const wrap = $('sfxOrigAccordionWrap');
    const toggle = $('sfxOrigAccordionToggle');
    if (body) body.classList.toggle('hidden', !open);
    if (wrap) wrap.classList.toggle('open', !!open);
    if (toggle) {
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = toggle.querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
    }
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(i ? 1 : 0) + ' ' + sizes[i];
}

async function attachOriginalSfx(item) {
    if (!item || !item.path) return;
    if (state.tab === 'create' && state.createId) {
        const ca = libEntry(state.createId);
        if (ca) {
            const res = await window.sa.setAnimationSfx(ca.id, item.path);
            if (takeLib(res)) {
                const updated = libEntry(ca.id);
                if (updated) {
                    updated.adjusted = true;
                    await syncAttachedSfx(updated);
                }
                fillAdjust(CTX.C);
                renderAnimations();
                renderCreateSummary();
                setStatus('Sound "' + item.file + '" attached to "' + ca.name + '".', 'ok');
            }
            return;
        }
    }
    if (state.use) {
        const m = state.use;
        m.sfxOrigPath = item.path;
        m.sfxOrig = item.file;
        m.sfxPath = item.path;
        m.sfx = item.file;
        m.dirty = true;
        m.adjusted = true;
        m.useSfx = true;
        if ($('useSfxU')) $('useSfxU').checked = true;
        await syncAttachedSfx(m);
        fillAdjust(CTX.U);
        renderUseSummary();
        renderAnimations();
        syncVarButtons('U', m);
        setStatus('Sound "' + item.file + '" attached to active preset.', 'ok');
    } else if (state.selectedId) {
        const a = libEntry(state.selectedId);
        if (a) {
            const res = await window.sa.setAnimationSfx(a.id, item.path);
            if (takeLib(res)) {
                syncUse(true);
                fillAdjust(CTX.U);
                renderAnimations();
                renderUseSummary();
                setStatus('Sound "' + item.file + '" attached to "' + a.name + '".', 'ok');
            }
        }
    }
}

function renderSfxOriginals() {
    const listEl = $('sfxOrigList');
    const countEl = $('sfxOrigCount');
    const originals = (state.lib && state.lib.sfxOriginals) || [];
    if (countEl) countEl.textContent = originals.length ? '(' + originals.length + ')' : '(0)';
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!originals.length) {
        const empty = document.createElement('div');
        empty.className = 'hint';
        empty.style.padding = '8px 12px';
        empty.textContent = 'No stored original sounds yet. Drop sounds above or browse to store them.';
        listEl.appendChild(empty);
        return;
    }
    const currentOrig = (state.use && (state.use.sfxOrig || state.use.sfx)) ||
        (selected() && (selected().sfxOrig || selected().sfx));
    for (const item of originals) {
        const row = document.createElement('div');
        row.className = 'sfx-orig-item' + (currentOrig === item.file ? ' attached' : '');

        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'ghost sm-btn';
        playBtn.title = 'Preview sound';
        playBtn.textContent = '▶';
        playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            play(item.path);
        });

        const info = document.createElement('div');
        info.className = 'sfx-orig-info grow';
        const name = document.createElement('div');
        name.className = 'sfx-orig-name';
        name.textContent = item.file;
        name.title = item.file;
        const meta = document.createElement('div');
        meta.className = 'hint sm';
        meta.textContent = (item.ext ? item.ext + ' · ' : '') + formatBytes(item.size);
        info.appendChild(name);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'sfx-orig-actions';

        const attachBtn = document.createElement('button');
        attachBtn.type = 'button';
        attachBtn.className = 'ghost sm-btn';
        attachBtn.title = 'Attach this sound to active preset';
        attachBtn.textContent = currentOrig === item.file ? 'Attached' : 'Attach';
        attachBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            attachOriginalSfx(item);
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'ghost sm-btn sfx-orig-del';
        delBtn.title = 'Delete original sound';
        delBtn.textContent = '🗑';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openConfirmPop(delBtn, {
                title: 'Delete original sound?',
                message: 'Permanently delete "' + item.file + '" from your originals library? Presets already using it will retain their audio.',
                confirmText: 'Delete',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.removeSfxOriginal(item.file);
                    if (takeLib(res)) {
                        setStatus('Deleted "' + item.file + '" from originals library.', 'ok');
                    }
                }
            });
        });

        actions.appendChild(attachBtn);
        actions.appendChild(delBtn);

        row.appendChild(playBtn);
        row.appendChild(info);
        row.appendChild(actions);
        listEl.appendChild(row);
    }
}

function renderDefaultSfx() {
    const d = state.lib.defaultSfx;
    $('defName').textContent = d ? d.file : 'Drop a sound file here';
    $('defPlay').disabled = !d;
    $('defClear').style.visibility = d ? 'visible' : 'hidden';
    $('defPlay').style.visibility = d ? 'visible' : 'hidden';
    $('defSfx').classList.toggle('chosen', !!d);
}

function renderPin() {
    const on = state.lib.alwaysOnTop !== false;
    const btn = $('pin');
    if (!btn) return;
    btn.classList.toggle('on', on);
    btn.title = on
        ? 'Pinned above DaVinci Resolve (click to unpin)'
        : 'Pin panel above DaVinci Resolve';
}

function renderLive() {
    const L = state.live;
    const conn = $('conn');
    if (!L || !L.ok) {
        conn.textContent = L && L.reason ? L.reason : 'Not connected';
        conn.className = 'pill off';
        $('subMeta').textContent = '–';
        if ($('create')) $('create').disabled = true;
        return;
    }
    conn.textContent = L.timeline;
    conn.className = 'pill on';
    const s = L.subtitle;
    const key = s ? s.start + ':' + s.end + ':' + s.text : 'none:' + L.timeline;
    const changed = key !== state.shownKey;
    if (changed) {                           // the subtitle changed: show the new text
        state.shownKey = key;
        $('subText').value = s ? s.text : '';
        redrawStages();
    }
    $('subMeta').textContent = s
        ? '#' + s.index + ' of ' + L.count + ' · ' + (L.source === 'selection' ? 'selected' : 'at playhead')
        : (L.count ? 'no subtitle at the playhead' : 'this timeline has no subtitles');
    $('subHint').textContent = s ? '' : 'You can still type text here and it will be placed at the playhead for 3 seconds.';
    if ($('create')) $('create').disabled = state.busy || !selected();
    if (changed || state.lastFrame !== L.frame) {
        state.lastFrame = L.frame;
        if (!state.drag && !state.preview) renderTimelines();
        refreshLiveBg();
    } else if (!state.liveBg.img) {
        refreshLiveBg();
    }
}

function renderAll() {
    renderAnimationsIfChanged();
    renderEffects();
    renderSettings();
    renderDefaultSfx();
    renderSfxOriginals();
    renderCreate();
    renderTags();
    renderPin();
    renderLive();
    refreshPromptPresets();
}
