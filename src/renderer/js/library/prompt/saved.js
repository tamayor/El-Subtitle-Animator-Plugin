// Prompt tab: saved prompts, the prompt inbox, and input tips.

// ---------------------------------------------------------------- saved prompts
// Prompts the user saved under a title, stored exactly as they were. The dropdown lists "Default" first (the
// prompt Reset restores), then each saved title. Picking one loads its text as the current prompt.
const SAVED_PROMPTS_KEY = 'sa.savedPrompts';
const SAVED_DEFAULT_VALUE = '__default__';
// The saved prompt last opened (or saved), so the dropdown shows it again when the panel reopens.
const SAVED_PROMPT_LAST_KEY = 'sa.savedPromptLast';

function rememberSavedPrompt(title) {
    if (title) store.set(SAVED_PROMPT_LAST_KEY, title); else store.remove(SAVED_PROMPT_LAST_KEY);
}

function lastSavedPrompt() {
    return store.get(SAVED_PROMPT_LAST_KEY);
}

function loadSavedPrompts() {
    const a = store.getJSON(SAVED_PROMPTS_KEY, []);
    return Array.isArray(a) ? a.filter(p => p && typeof p.title === 'string' && typeof p.text === 'string') : [];
}

function storeSavedPrompts(list) {
    return store.setJSON(SAVED_PROMPTS_KEY, list);
}

// Fill the dropdown; select = the title to show selected (or the Default entry).
function renderSavedPrompts(select) {
    const sel = $('promptSavedSel');
    if (!sel) return;
    sel.innerHTML = '';
    const def = document.createElement('option');
    def.value = SAVED_DEFAULT_VALUE;
    def.textContent = 'Default';
    sel.appendChild(def);
    loadSavedPrompts().forEach(p => {
        const o = document.createElement('option');
        o.value = p.title; o.textContent = p.title;
        sel.appendChild(o);
    });
    sel.value = select && [...sel.options].some(o => o.value === select) ? select : SAVED_DEFAULT_VALUE;
    $('promptSavedDelete').disabled = sel.value === SAVED_DEFAULT_VALUE;
}

function initSavedPrompts() {
    const sel = $('promptSavedSel'), title = $('promptSavedTitle');
    if (!sel || !title) return;
    renderSavedPrompts(lastSavedPrompt());
    const toggle = $('promptSavedToggle'), edit = $('promptSavedEdit');
    if (toggle && edit) {
        toggle.addEventListener('click', () => {
            const open = edit.classList.toggle('hidden') === false;
            toggle.classList.toggle('on', open);
            toggle.setAttribute('aria-expanded', String(open));
            if (open) title.focus();
        });
    }
    sel.addEventListener('change', () => {
        clearTimeout(pbSaveTimer);
        $('promptSavedDelete').disabled = sel.value === SAVED_DEFAULT_VALUE;
        rememberSavedPrompt(sel.value === SAVED_DEFAULT_VALUE ? null : sel.value);
        if (sel.value === SAVED_DEFAULT_VALUE) {
            title.value = '';
            setJobPromptText(effectiveJobPromptDefault());
            setPromptStatus('Loaded the default prompt.', 'ok');
            return;
        }
        const p = loadSavedPrompts().find(x => x.title === sel.value);
        if (!p) return;
        title.value = p.title;
        setJobPromptText(p.text);
        setPromptStatus('Loaded "' + p.title + '".', 'ok');
    });
    const save = () => {
        clearTimeout(pbSaveTimer);
        const t = title.value.trim();
        if (!t) { setPromptStatus('Type a title first.', 'bad'); title.focus(); return; }
        if (t.toLowerCase() === 'default') { setPromptStatus('"Default" is taken; use Save as default for that.', 'bad'); return; }
        const list = loadSavedPrompts();
        const i = list.findIndex(x => x.title === t);
        if (i >= 0) list[i].text = pb.full; else list.push({ title: t, text: pb.full });
        if (!storeSavedPrompts(list)) { setPromptStatus('Could not save the prompt.', 'bad'); return; }
        saveJobPrompt(pb.full);
        rememberSavedPrompt(t);
        renderSavedPrompts(t);
        title.value = '';
        setPromptStatus((i >= 0 ? 'Updated "' : 'Saved "') + t + '".', 'ok');
        showToast(t, i >= 0 ? 'Updated' : 'Saved');
    };
    $('promptSavedSave').addEventListener('click', save);
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    $('promptSavedDelete').addEventListener('click', () => {
        const t = sel.value;
        if (t === SAVED_DEFAULT_VALUE) return;
        storeSavedPrompts(loadSavedPrompts().filter(x => x.title !== t));
        if (lastSavedPrompt() === t) rememberSavedPrompt(null);
        title.value = '';
        renderSavedPrompts(null);
        setPromptStatus('Deleted "' + t + '". The current prompt is unchanged.', 'ok');
        showToast(t, 'Deleted');
    });
    takePromptInbox();
    window.addEventListener('focus', () => takePromptInbox());
}

// Prompts handed over through <library>/prompt-inbox.json (e.g. Claude Code updating the "Tommy" prompt): each is
// saved under its title (replacing a saved prompt of that title), and the one marked load becomes the current prompt.
let inboxBusy = false;
async function takePromptInbox() {
    if (inboxBusy || !window.sa || !window.sa.takePromptInbox) return;
    inboxBusy = true;
    try {
        const got = await window.sa.takePromptInbox();
        if (!Array.isArray(got) || !got.length) return;
        const list = loadSavedPrompts();
        let loaded = null;
        for (const p of got) {
            if (p.title.toLowerCase() === 'default') continue;
            const i = list.findIndex(x => x.title === p.title);
            if (i >= 0) list[i].text = p.text; else list.push({ title: p.title, text: p.text });
            if (p.load) loaded = p;
        }
        if (!storeSavedPrompts(list)) { setPromptStatus('Could not save the prompt from the inbox.', 'bad'); return; }
        if (loaded) {
            clearTimeout(pbSaveTimer);
            rememberSavedPrompt(loaded.title);
            setJobPromptText(loaded.text);
        }
        renderSavedPrompts(loaded ? loaded.title : lastSavedPrompt());
        const names = got.map(p => p.title).join(', ');
        setPromptStatus('Updated "' + names + '" from the prompt inbox.', 'ok');
        showToast(names, 'Updated');
    } catch (e) { /* ignore */ } finally { inboxBusy = false; }
}

// Hovering a one-line input whose text is cut off shows the whole value in a tooltip, wrapped to the input's width.
function initPromptInputTips(root) {
    const tip = document.createElement('div');
    tip.className = 'pr-input-tip hidden';
    document.body.appendChild(tip);
    let cur = null;
    const isTextInput = (el) => el && el.tagName === 'INPUT' && (!el.type || el.type === 'text' || el.type === 'search');
    const hide = () => { cur = null; tip.classList.add('hidden'); };
    const show = (el) => {
        cur = el;
        if (!el.value || el.scrollWidth <= el.clientWidth + 1) { tip.classList.add('hidden'); return; }
        const r = el.getBoundingClientRect();
        tip.textContent = el.value;
        tip.style.width = Math.max(r.width, 120) + 'px';
        tip.style.left = Math.min(r.left, window.innerWidth - Math.max(r.width, 120) - 4) + 'px';
        tip.style.top = '0px';
        tip.classList.remove('hidden');
        const h = tip.offsetHeight;
        // Below the input, or above it when there is no room underneath.
        tip.style.top = (r.bottom + 4 + h > window.innerHeight ? Math.max(4, r.top - 4 - h) : r.bottom + 4) + 'px';
    };
    root.addEventListener('mouseover', (e) => { if (isTextInput(e.target)) show(e.target); });
    root.addEventListener('mouseout', (e) => { if (e.target === cur && !cur.contains(e.relatedTarget)) hide(); });
    root.addEventListener('input', (e) => { if (e.target === cur) show(cur); });
    root.addEventListener('scroll', hide, true);
    root.addEventListener('mousedown', (e) => { if (e.target !== cur) hide(); });
}
