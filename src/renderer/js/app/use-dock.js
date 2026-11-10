// Use tab: the upper dock. Hovering the dock shows Preset Set Up, Text Style and Placement under the dock bar and moving the
// mouse out hides them again (no button). Start / Remove keep their ids (live-preview.js drives them).
(function () {
    const CLOSE_DELAY = 250;   // ms after the mouse leaves, so brushing past the edge does not flicker
    let hovering = false, closeTimer = 0;

    function show(open) {
        const body = document.getElementById('useDockBodyU');
        if (body) body.classList.toggle('hidden', !open);
    }
    // A text field inside the panel keeps it open while you type, even if the mouse drifts off.
    function editingInside() {
        const body = document.getElementById('useDockBodyU'), el = document.activeElement;
        return !!(body && el && body.contains(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
    }
    function scheduleClose() {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => { if (!hovering && !editingInside()) show(false); }, CLOSE_DELAY);
    }
    function init() {
        const dock = document.getElementById('useDockU');
        if (!dock) return;
        try { localStorage.removeItem('sa.useDockOpen'); } catch (e) { }   // old click-to-open state
        show(false);
        syncTip();
        dock.addEventListener('mouseenter', () => { hovering = true; clearTimeout(closeTimer); show(true); });
        dock.addEventListener('mouseleave', () => { hovering = false; scheduleClose(); });
        // Leaving a text field after the mouse already left closes the panel then.
        dock.addEventListener('focusout', () => { if (!hovering) scheduleClose(); });
    }
    // The Timeline Preview status line is hidden; its text (live-preview.js keeps it current) is the bar's tooltip.
    function syncTip() {
        const bar = document.getElementById('stageLiveU'), txt = bar && bar.querySelector('.stage-live-txt');
        if (!txt) return;
        const put = () => {
            const b = txt.querySelector('b'), sp = txt.querySelector('span');
            bar.title = [b && b.textContent, sp && sp.textContent].filter(Boolean).join('\n');
        };
        put();
        new MutationObserver(put).observe(txt, { childList: true, subtree: true, characterData: true });
    }
    window.setUseDockOpen = show;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
