// Panel bootstrap: global error logging, the DOM shortcut $, the shared `state` object and tab switching.

window.addEventListener('error', (e) => {
    console.error('WINDOW ERROR:', e.message, e.filename, e.lineno, e.colno, e.error);
    if (window.sa && window.sa.dlog) window.sa.dlog('WINDOW ERROR:', e.message, e.filename, e.lineno, e.colno);
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('UNHANDLED REJECTION:', e.reason);
    if (window.sa && window.sa.dlog) window.sa.dlog('UNHANDLED REJECTION:', String(e.reason && e.reason.stack || e.reason));
});

const $ = (id) => document.getElementById(id);

const state = {
    lib: { animations: [], defaultSfx: null, alwaysOnTop: true },
    selectedId: null,      // the item picked in the Use tab
    createId: null,        // the item opened in the Create tab
    use: null,             // working copy of the picked item's alignment (edits here are for one use only)
    adjustOpen: false,     // is the alignment panel in the Use tab expanded
    placeOpen: false,      // is the placement panel in the Use tab expanded
    styleOpen: false,      // is the Text Style panel (manual font / colour override) in the Use tab expanded
    useViewMode: 'list',   // preset viewing mode: 'list', 'grid', or 'gallery'
    autoRender: true,      // Use tab: render the selected preset with the subtitle in Resolve after every change (off = Render button)
    presetSearch: '',      // search query for filtering text presets
    tdOpen: false,         // is the text design panel in the Use tab expanded
    createAdjustOpen: true,// is the alignment panel in the Create tab expanded
    createFilesOpen: true, // is the Files section of the Library preset card expanded
    scrub: { U: { on: false, f: null }, C: { on: false, f: null } },   // frame-by-frame scrubbing of the alignment timeline (f = timeline frame of the pink playhead)
    createTdOpen: false,   // is the text design panel in the Create tab expanded
    sfxOrigOpen: false,    // is the SFX originals library accordion expanded
    live: null,            // last poll result
    shownKey: null,        // which subtitle the text box is currently showing
    busy: false,
    audio: null,
    drag: null,            // active drag on an alignment timeline
    stageDrag: null,       // active drag on a preview stage (positioning text)
    stageHover: null,      // 'U' or 'C' when hovering a preview stage
    zoomEnabled: { U: false, C: false }, // zoom preview disabled by default; toggled via button
    liveSyncEnabled: { U: true, C: true }, // real-time live sync to DaVinci Resolve timeline clip
    liveBg: { key: '', img: null, busy: false, pending: null, width: 1920, height: 1080 },
    preview: null,         // running preview
    waves: new Map(),      // sound path -> { peaks, seconds }
    tab: 'apply',
    draft: { animPath: null, fromSelection: false, sfxPath: null }   // what the Create tab is building
};

function setTab(t) {
    stopPreview();
    state.tab = t;
    $('tabApply').classList.toggle('hidden', t !== 'apply');
    $('tabLibrary').classList.toggle('hidden', t !== 'library');
    $('tabCreate').classList.toggle('hidden', t !== 'create');
    $('tabPrompt').classList.toggle('hidden', t !== 'prompt');
    $('tabBtnApply').classList.toggle('on', t === 'apply');
    $('tabBtnLibrary').classList.toggle('on', t === 'library');
    $('tabBtnCreate').classList.toggle('on', t === 'create');
    $('tabBtnPrompt').classList.toggle('on', t === 'prompt');
    document.body.className = 'tab-' + t;
    renderTimelines();
    redrawStages();
}

function baseName(p) { return String(p || '').split('/').pop(); }
