// Use tab: the action bar. It shows the selected preset, Customize and the timeline preview Start / Remove (those keep
// their ids: live-preview.js drives them). Customize opens a drawer under the bar with the selected clip's Animation
// timing and Clip controls. It opens by itself when you select a placed clip in Resolve (or pick a MultiText preset,
// whose Upper / Emphasize / Lower split lives here) and closes again afterwards; a clip that is only under the playhead
// does not open it, so it stays still during playback. Opening or closing it by hand is remembered (open = stays open).
// (Preset Set Up, Text Style and Placement are in the Settings sheet, js/ui/settings-sheet.js.)
(function () {
    const AUTO_CLOSE_MS = 800;      // clicking from one clip to the next does not close it in between
    let open = false;
    let auto = false;               // opened by itself: closes by itself too
    let wantKey = '';               // what asked for it at the last check: the selected clip's id and / or 'mt'; '' = nothing
    let closeTimer = 0;

    function show(on, save) {
        open = !!on;
        const body = document.getElementById('useDockBodyU');
        if (body) body.classList.toggle('hidden', !open);
        const btn = document.getElementById('useCustomizeBtn');
        if (btn) {
            btn.classList.toggle('on', open);
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        if (save) store.set('sa.useCustomizeOpen', open ? '1' : '0');
    }
    // The button shows a dot while the drawer has something in it (a clip's timing or controls) and it is closed.
    function syncHas() {
        const body = document.getElementById('useDockBodyU'), btn = document.getElementById('useCustomizeBtn');
        if (!body || !btn) return;
        const has = [...body.children].some(c => c.tagName === 'SECTION' && !c.classList.contains('hidden'));
        btn.classList.toggle('has', has);
        body.classList.toggle('empty', !has);
        // by itself only for a clip selected in Resolve (the cards carry data-selected) or the MultiText split
        const shown = (el) => !!el && !el.classList.contains('hidden');
        const mt = document.getElementById('mtHostU');
        const ids = [...body.children].filter(c => c.tagName === 'SECTION' && shown(c) && c.dataset.selected).map(c => c.dataset.selected);
        if (shown(mt) && body.contains(mt) && shown(mt.closest('section'))) ids.push('mt');
        const key = [...new Set(ids)].join(',');
        if (key === wantKey) return;
        wantKey = key;
        clearTimeout(closeTimer);
        if (key) {                  // a clip was selected, or another one: open (again, if it was closed by hand for the last one)
            if (!open) { auto = true; show(true, false); }
        } else if (auto) {
            closeTimer = setTimeout(() => { if (!wantKey && auto) { auto = false; show(false, false); } }, AUTO_CLOSE_MS);
        }
    }
    function init() {
        const dock = document.getElementById('useDockU');
        if (!dock) return;
        show(store.get('sa.useCustomizeOpen') === '1', false);
        syncTip();
        const btn = document.getElementById('useCustomizeBtn');
        if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); auto = false; clearTimeout(closeTimer); show(!open, true); });
        const body = document.getElementById('useDockBodyU');
        if (body) {
            // cards come and go (no clip selected, docked at the bottom): only their own class / presence matters
            new MutationObserver(syncHas).observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-selected'] });
            syncHas();
        }
    }
    // The Timeline Preview status line is hidden; its text (live-preview.js keeps it current) is the Start/Remove buttons' tooltip area.
    function syncTip() {
        const bar = document.getElementById('stageLiveU'), txt = bar && bar.querySelector('.stage-live-txt');
        const btns = bar && bar.querySelector('.stage-live-btns');
        if (!txt || !btns) return;
        const put = () => {
            const b = txt.querySelector('b'), sp = txt.querySelector('span');
            btns.title = [b && b.textContent, sp && sp.textContent].filter(Boolean).join('\n');
        };
        put();
        new MutationObserver(put).observe(txt, { childList: true, subtree: true, characterData: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

// Use tab: the subtitle text box redraws the stages; Reset goes back to the preset's saved defaults (called by initApp).
function initUseTab() {
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
}
