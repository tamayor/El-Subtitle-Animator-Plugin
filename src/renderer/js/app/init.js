// initApp: binds every control and starts polling (called from boot.js).

async function initApp() {
    try {
        // Stop the window from opening a file that misses a drop zone.
    for (const ev of ['dragover', 'drop']) window.addEventListener(ev, (e) => e.preventDefault());
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('resize', () => {
        renderTimelines();
        redrawStages();
    });

    mountBlocks();
    initVersion();
    initInspectorLayoutModes();
    bindAdjust(CTX.U);
    bindAdjust(CTX.C);

    takeLib(await window.sa.getLib());
    if (state.lib.animations.length) { state.selectedId = state.lib.animations[0].id; syncUse(true); }
    renderAll();
    fitWindowToContent();

    $('adjustToggle').addEventListener('click', () => { stopPreview(); setAdjustOpen(!state.adjustOpen); });
    bindTextStyle();      // Use tab · Text Style: the manual font / colour override
    if ($('tdToggleU')) $('tdToggleU').addEventListener('click', () => { stopPreview(); setTdOpen(!state.tdOpen); });
    if ($('adjustToggleC')) $('adjustToggleC').addEventListener('click', () => { stopPreview(); setCreateAdjustOpen(!state.createAdjustOpen); });
    if ($('filesToggleC')) $('filesToggleC').addEventListener('click', () => { setCreateFilesOpen(!state.createFilesOpen); });
    if ($('tdToggleC')) $('tdToggleC').addEventListener('click', () => { stopPreview(); setCreateTdOpen(!state.createTdOpen); });
    if ($('configToggleC')) $('configToggleC').addEventListener('click', () => { stopPreview(); setCreateConfigOpen(!state.createConfigOpen); });
    if ($('sfxOrigAccordionToggle')) $('sfxOrigAccordionToggle').addEventListener('click', () => {
        setSfxOrigAccordionOpen(!state.sfxOrigOpen);
    });
    const subTextEl = $('subText');
    if (subTextEl) subTextEl.addEventListener('input', () => redrawStages());
    const resetUEl = $('resetU');
    if (resetUEl) {
        resetUEl.addEventListener('click', () => {
            stopPreview();
            syncUse(true);                      // a fresh one-time copy of the preset's saved defaults
            if (state.use) {
                state.use.dirty = false;
                state.use.adjusted = false;
                state.use.designDirty = false;
                state.use.designRev = 0;
                state.use.renderReq = null;
                state.use._viewCache = null;
                state.use.tempPreview = null;
            }
            const a = selected();
            if (a) { a.adjusted = false; a.designDirty = false; }
            // Redraw everything that shows the one-time values: boxes, alignment, sound, text design, preview and the Update bar.
            renderSettings();
            try { if (typeof fillTextDesign === 'function' && $('tdFont' + CTX.U.s)) fillTextDesign(CTX.U); } catch (e) { /* the panel may not be on the page */ }
            if (state.use) syncVarButtons('U', state.use);
            renderTimelines();
            redrawStages();
            try { if (state.use && typeof triggerLiveSync === 'function') triggerLiveSync(state.use, 'U'); } catch (e) { /* only while a timeline preview runs */ }
        });
    }
    const animNameEl = $('animName');
    if (animNameEl) {
        animNameEl.addEventListener('input', () => {
            const a = libEntry(state.createId); if (!a) return;
            const name = animNameEl.value.trim();
            if (!name) return;
            a.name = name;
            saveField(a.id, { name });
            if ($('editTitle')) $('editTitle').textContent = name;
            renderAnimations(); renderTimeline(CTX.C);
            const b = document.querySelector('#libList .libitem.sel b'); if (b) b.textContent = name;
        });
    }
    const prevCapCEl = $('prevCapC');
    if (prevCapCEl) {
        prevCapCEl.addEventListener('click', async () => {
            if (!state.createId) return;
            setCreateStatus('Taking preview frames…');
            const res = await window.sa.capturePreview(state.createId);
            if (takeLib(res)) setCreateStatus('Preview updated.', 'ok'); else if (res && res.error) setCreateStatus(res.error, 'bad');
        });
    }

    $('tabBtnApply').addEventListener('click', () => setTab('apply'));
    $('tabBtnLibrary').addEventListener('click', () => setTab('library'));
    $('tabBtnCreate').addEventListener('click', () => setTab('create'));
    $('tabBtnPrompt').addEventListener('click', () => setTab('prompt'));
    initPromptTab();
    $('tabBtnCut').addEventListener('click', () => { setTab('cut'); cutTabShown(); cutToolsShown(); });
    initCutTab();
    initCutTools();

    $('defPlay').addEventListener('click', () => play(state.lib.defaultSfx && state.lib.defaultSfx.path));
    $('defClear').addEventListener('click', async () => takeLib(await window.sa.setDefaultSfx(null)));
    dropZone($('defSfx'), async (p) => { if (takeLib(await window.sa.setDefaultSfx(p))) setCreateStatus('Default sound set', 'ok'); });

    if ($('sfxOrigDrop')) {
        dropZone($('sfxOrigDrop'), async (p) => {
            const res = await window.sa.addSfxOriginal(p);
            if (takeLib(res)) {
                setStatus('Added "' + baseName(p) + '" to originals library.', 'ok');
            }
        });
    }
    const sfxOrigPick = $('sfxOrigPick');
    const sfxOrigFileIn = $('sfxOrigFileInput');
    if (sfxOrigPick && sfxOrigFileIn) {
        sfxOrigPick.addEventListener('click', (e) => {
            e.stopPropagation();
            sfxOrigFileIn.click();
        });
        sfxOrigFileIn.addEventListener('change', async () => {
            if (sfxOrigFileIn.files && sfxOrigFileIn.files.length) {
                for (const f of sfxOrigFileIn.files) {
                    const p = window.sa.pathForFile(f);
                    if (p) {
                        const res = await window.sa.addSfxOriginal(p);
                        takeLib(res);
                    }
                }
                setStatus('Original sounds added.', 'ok');
            }
            sfxOrigFileIn.value = '';
        });
    }
    if ($('sfxOrigDrop') && sfxOrigFileIn) {
        $('sfxOrigDrop').addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            sfxOrigFileIn.click();
        });
    }

    const browse = (el, kind, handler) => {
        const go = async (e) => {
            if (e.target.closest('button')) return;
            const p = await window.sa.pickFile(kind);
            if (p && typeof p === 'string') await handler(p);
        };
        el.addEventListener('click', go);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
    };
    browse($('defSfx'), 'sfx', async (p) => { if (takeLib(await window.sa.setDefaultSfx(p))) setCreateStatus('Default sound set', 'ok'); });
    browse($('newSfx'), 'sfx', async (p) => { state.draft.sfxPath = p; setCreateStatus(''); renderCreate(); });
    browse($('animDrop'), 'anim', async (p) => {
        state.draft.animPath = p; state.draft.fromSelection = false; clearTimelineDraft();
        if (!$('newName').value.trim()) $('newName').value = baseName(p).replace(/\.[^.]+$/, '');
        setCreateStatus('');
        renderCreate();
    });
    dropZone($('animDrop'), async (p) => {
        const ext = p.toLowerCase().split('.').pop();
        if (!['comp', 'setting'].includes(ext)) { setCreateStatus('Drop a Fusion .comp or .setting file', 'bad'); return; }
        state.draft.animPath = p; state.draft.fromSelection = false; clearTimelineDraft();
        if (!$('newName').value.trim()) $('newName').value = baseName(p).replace(/\.[^.]+$/, '');
        setCreateStatus('');
        renderCreate();
    });
    $('useSelected').addEventListener('click', () => { takeFromTimeline(); });
    dropZone($('newSfx'), async (p) => { state.draft.sfxPath = p; setCreateStatus(''); renderCreate(); });
    $('newSfxClear').addEventListener('click', () => { state.draft.sfxPath = null; renderCreate(); });
    $('newSfxPlay').addEventListener('click', () => play(state.draft.sfxPath));
    $('saveCombo').addEventListener('click', async () => {
        const d = state.draft;
        setCreateStatus('Saving…');
        const res = await window.sa.createCombo({
            name: $('newName').value, animPath: d.animPath, fromSelection: d.fromSelection, sfxPath: d.sfxPath, clipProps: d.clipProps || null
        });
        if (res && res.error) { setCreateStatus(res.error, 'bad'); return; }
        if (takeLib(res)) {
            state.selectedId = res.createdId;
            state.createId = res.createdId;
            syncUse(true);
            state.draft = { animPath: null, fromSelection: false, sfxPath: null };
            draftPrevHide();
            $('newName').value = '';
            renderAll();
            setCreateStatus('Saved. Set its default alignment below; it is now in the Use tab.', 'ok');
        }
    });

    $('pin').addEventListener('click', async () => takeLib(await window.sa.setOnTop(state.lib.alwaysOnTop === false)));
    $('openFolder').addEventListener('click', () => window.sa.openFolder());
    if ($('openFontsFolder')) $('openFontsFolder').addEventListener('click', () => window.sa.openFontsFolder());
    const revertOrigEditor = $('revertOrigEditor');
    if (revertOrigEditor) {
        revertOrigEditor.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a) return;
            openConfirmPop(revertOrigEditor, {
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
    }
    bindLibTools();
    initBoilerplates();
    $('tagsToggle').addEventListener('click', () => setTagsOpen(!tagUI.open));
    $('tagsPlus').addEventListener('click', (e) => { e.stopPropagation(); openNewTagPop($('tagsPlus'), null); });
    setTagsOpen(false);
    $('rescan').addEventListener('click', async () => { state.live = await window.sa.poll(true); renderLive(); setStatus('Subtitles re-read.', 'ok'); });
    bindPlacementMenu();
    bindLivePreview();
    initPresetViewMode();
    initEffects();
    renderAnimations();       // the saved view (List / Grid / Gallery) was only read just now: draw the list in it
    if ($('create')) $('create').addEventListener('click', create);

    tick();
    initAnimTiming();
    initClipControls();
    } catch (err) {
        console.error('Fatal initialization error:', err);
        if (window.sa && window.sa.dlog) window.sa.dlog('FATAL INIT ERROR:', String(err && err.stack || err));
    }
}
