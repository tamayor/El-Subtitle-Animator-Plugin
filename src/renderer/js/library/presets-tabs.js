// Presets section: Text / Effects sub-tabs. Only toggles which section shows; both stay in the DOM.
(function () {
    const wrap = document.getElementById('presetsWrap');
    if (!wrap) return;
    const tabs = wrap.querySelectorAll('.presets-tab');
    function show(pt) {
        wrap.dataset.pt = pt;
        tabs.forEach((b) => {
            const on = b.dataset.pt === pt;
            b.classList.toggle('on', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        try { localStorage.setItem('presetsTab', pt); } catch (e) { /* ignore */ }
    }
    tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.pt)));
    let saved = null;
    try { saved = localStorage.getItem('presetsTab'); } catch (e) { /* ignore */ }
    if (saved === 'fx' || saved === 'text') show(saved);
})();
