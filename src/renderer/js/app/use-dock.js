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
        try { localStorage.setItem('sa.useDockOpen', open ? '1' : '0'); } catch (e) { /* ignore */ }
    }
    function init() {
        const dock = document.getElementById('useDockU');
        if (!dock) return;
        let saved = false;
        try { saved = localStorage.getItem('sa.useDockOpen') === '1'; } catch (e) { saved = false; }
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
