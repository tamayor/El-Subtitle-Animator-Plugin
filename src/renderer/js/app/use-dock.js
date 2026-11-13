// Use tab: the upper dock. The cog button in the dock bar opens / closes Preset Set Up, Text Style and Placement under
// the bar (click, not hover); the open state is remembered. Start / Remove keep their ids (live-preview.js drives them).
(function () {
    let open = false;

    function show(on) {
        open = !!on;
        const body = document.getElementById('useDockBodyU');
        if (body) body.classList.toggle('hidden', !open);
        const cog = document.getElementById('useDockCog');
        if (cog) {
            cog.classList.toggle('on', open);
            cog.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        store.set('sa.useDockOpen', open ? '1' : '0');
    }
    function init() {
        const dock = document.getElementById('useDockU');
        if (!dock) return;
        let saved = false;
        saved = store.get('sa.useDockOpen') === '1';
        show(saved);
        syncTip();
        const cog = document.getElementById('useDockCog');
        if (cog) cog.addEventListener('click', (e) => { e.stopPropagation(); show(!open); });
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
    window.setUseDockOpen = show;
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
