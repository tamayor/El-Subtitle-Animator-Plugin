// Prompt tab: one-time upgrades of saved prompts, and initPromptTab.

// Once per panel: prompts saved before SUBTITLE TRIMMING existed (the current prompt, the user's default and every
// saved prompt) get the section added at the end of their SETTINGS block. Only that text is inserted; the rest of
// each prompt stays exactly as it was.
const TRIMMING_MIGRATED_KEY = 'sa.migrated.subtitleTrimming';

function migrateTrimmingSection() {
    try {
        if (store.get(TRIMMING_MIGRATED_KEY)) return;
        for (const key of [JOB_PROMPT_KEY, JOB_PROMPT_DEFAULT_KEY]) {
            const t = store.get(key);
            if (t && t.trim()) store.set(key, withTrimmingSection(t));
        }
        const saved = loadSavedPrompts();
        if (saved.length) storeSavedPrompts(saved.map(p => Object.assign({}, p, { text: withTrimmingSection(p.text) })));
        store.set(TRIMMING_MIGRATED_KEY, '1');
    } catch (e) { /* ignore */ }
}

// Once per panel: prompts saved before HIGHLIGHT_BOX existed get the row under EMPHASIS in TEXT STYLE, with
// auto-balance on (the user asked for balanced spacing around highlights in their prompts by default).
const HIGHLIGHT_MIGRATED_KEY = 'sa.migrated.highlightBox';
function migrateHighlightRow() {
    try {
        if (store.get(HIGHLIGHT_MIGRATED_KEY)) return;
        for (const key of [JOB_PROMPT_KEY, JOB_PROMPT_DEFAULT_KEY]) {
            const t = store.get(key);
            if (t && t.trim()) store.set(key, withHighlightRow(t));
        }
        const saved = loadSavedPrompts();
        if (saved.length) storeSavedPrompts(saved.map(p => Object.assign({}, p, { text: withHighlightRow(p.text) })));
        store.set(HIGHLIGHT_MIGRATED_KEY, '1');
    } catch (e) { /* ignore */ }
}

function initPromptTab() {
    const ta = $('promptText');
    if (!ta) return;
    migrateTrimmingSection();
    migrateHighlightRow();
    initPromptInputTips($('tabPrompt'));
    initPromptBuilderDrag();
    initSavedPrompts();
    pb.full = loadJobPrompt();
    mirrorJobPromptToFile(pb.full);
    if (store.get(JOB_PROMPT_MODE_KEY) === 'text') pb.mode = 'text';
    pbFillAddMenu();
    $('pbAddBtn').addEventListener('click', pbAddFromMenu);
    const setMode = (m) => {
        pb.mode = m;
        store.set(JOB_PROMPT_MODE_KEY, m);
        applyPromptMode();
    };
    $('promptModeBuilder').addEventListener('click', () => setMode('builder'));
    $('promptModeText').addEventListener('click', () => setMode('text'));
    applyPromptMode();

    ta.addEventListener('input', () => {
        renderPromptHilite();
        if (pb.mode === 'builder' && pb.doc) { pb.doc.post = ta.value; pb.full = serializeJobPrompt(pb.doc); } else pb.full = ta.value;
        pbSave();
    });
    ta.addEventListener('scroll', () => { const pre = $('promptHilite'); if (pre) { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; } });
    $('promptCopy').addEventListener('click', copyJobPrompt);
    bindProxyMenu($('promptMore'), $('promptMoreItems'));   // ⋯ next to the saved-prompt picker: Save as default, Reset, Restore built-in
    $('promptSaveDefault').addEventListener('click', () => {
        clearTimeout(pbSaveTimer);
        saveJobPromptDefault(pb.full);
        saveJobPrompt(pb.full);
        refreshPromptFlags();
        setPromptStatus(userJobPromptDefault() ? 'Saved as your default.' : 'Same as the built-in prompt, so that is the default.', 'ok');
    });
    $('promptReset').addEventListener('click', () => {
        clearTimeout(pbSaveTimer);
        setJobPromptText(effectiveJobPromptDefault());
        setPromptStatus(userJobPromptDefault() ? 'Back to your default.' : 'Back to the built-in prompt.', 'ok');
    });
    $('promptBuiltIn').addEventListener('click', () => {
        clearTimeout(pbSaveTimer);
        saveJobPromptDefault(null);
        setJobPromptText(DEFAULT_JOB_PROMPT);
        setPromptStatus('Built-in prompt restored; your saved default was removed.', 'ok');
    });
}
