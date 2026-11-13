// initApp: binds every control and starts polling (called from boot.js). Each feature wires its own controls in an
// init*() of its own file; this only runs them in order (later steps rely on the library being loaded first).

async function initApp() {
    try {
        initWindowEvents();
        mountBlocks();
        initVersion();
        initInspectorLayoutModes();
        bindAdjust(CTX.U);
        bindAdjust(CTX.C);

        takeLib(await window.sa.getLib());
        if (state.lib.animations.length) { state.selectedId = state.lib.animations[0].id; syncUse(true); }
        renderAll();
        fitWindowToContent();

        initPanelToggles();       // library/settings.js: the Use / Create section toggles
        bindTextStyle();          // Use tab · Text Style: the manual font / colour override
        initUseTab();             // app/use-dock.js: subtitle text, Reset
        initCreateEditor();       // library/create-tab.js: name, preview frames, revert
        initMainTabs();           // the tab bar and each tab's own init
        initCreateDraft();        // library/create-tab.js: default sound, new preset draft, Save
        initSfxOriginals();       // library/settings.js: the SFX Originals library
        initHeader();             // pin, folders, re-read subtitles
        bindLibTools();
        initBoilerplates();
        initTagsSection();        // library/tags.js
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

// Window-wide: no file opens where a drop zone misses, stage drags, redraw on resize.
function initWindowEvents() {
    for (const ev of ['dragover', 'drop']) window.addEventListener(ev, (e) => e.preventDefault());
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('resize', () => {
        renderTimelines();
        redrawStages();
    });
}

// The main tab bar (Use / Library / Create via the Text menu, Prompt, Cut, B-roll) and the tabs that wire themselves.
function initMainTabs() {
    $('tabBtnApply').addEventListener('click', () => setTab('apply'));
    $('tabBtnLibrary').addEventListener('click', () => setTab('library'));
    $('tabBtnCreate').addEventListener('click', () => setTab('create'));
    $('tabBtnPrompt').addEventListener('click', () => setTab('prompt'));
    $('tabBtnText').addEventListener('click', (e) => {
        e.stopPropagation();
        // From another main tab, Text lands on Use (the default) and opens the menu.
        if (state.tab !== 'apply' && state.tab !== 'library' && state.tab !== 'create') setTab('apply');
        toggleTextMenu();
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#tabTextMenu')) closeTextMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTextMenu(); });
    window.addEventListener('resize', closeTextMenu);
    initPromptTab();
    $('tabBtnCut').addEventListener('click', () => { setTab('cut'); cutTabShown(); cutToolsShown(); });
    initCutTab();
    initCutTools();
    $('tabBtnBroll').addEventListener('click', () => { setTab('broll'); brollTabShown(); });
    initBrollTab();
}

// Header buttons: pin on top, open folders, re-read the subtitles.
function initHeader() {
    $('pin').addEventListener('click', async () => takeLib(await window.sa.setOnTop(state.lib.alwaysOnTop === false)));
    $('openFolder').addEventListener('click', () => window.sa.openFolder());
    if ($('openFontsFolder')) $('openFontsFolder').addEventListener('click', () => window.sa.openFontsFolder());
    $('rescan').addEventListener('click', async () => { state.live = await window.sa.poll(true); renderLive(); setStatus('Subtitles re-read.', 'ok'); });
}
