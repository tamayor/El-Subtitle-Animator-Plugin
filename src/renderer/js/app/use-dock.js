// Use tab: the upper dock. The Settings button shows / hides Preset Set Up, Text Style and Placement under the dock bar;
// the open state is remembered per viewer. Start / Remove keep their ids (live-preview.js drives them).
(function () {
    const KEY = 'sa.useDockOpen';
    function setDockOpen(open) {
        const body = document.getElementById('useDockBodyU'), btn = document.getElementById('useDockToggleU');
        if (!body || !btn) return;
        body.classList.toggle('hidden', !open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        const chev = btn.querySelector('.chev');
        if (chev) chev.textContent = open ? '▾' : '▸';
        try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (e) { }
    }
    function init() {
        const btn = document.getElementById('useDockToggleU');
        if (!btn) return;
        let open = false;
        try { open = localStorage.getItem(KEY) === '1'; } catch (e) { }
        setDockOpen(open);
        btn.addEventListener('click', () => setDockOpen(btn.getAttribute('aria-expanded') !== 'true'));
    }
    window.setUseDockOpen = setDockOpen;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
