// Create tab: ScratchPad / SelfServe sub-tabs.
//   ScratchPad  the boilerplates (Text+ / MultiText): put one on the timeline, animate it (js/library/boilerplates.js)
//   SelfServe   select the clip in your own timeline (or drop a file) and save it with a name and a sound
// Only toggles which section shows; both stay in the DOM (same pattern as js/library/presets-tabs.js).

const CREATE_TABS = ['scratch', 'selfserve'];

function showCreateTab(ct) {
    const wrap = document.getElementById('createWrap');
    if (!wrap || !CREATE_TABS.includes(ct)) return;
    wrap.dataset.ct = ct;
    wrap.querySelectorAll('.presets-tab[data-ct]').forEach((b) => {
        const on = b.dataset.ct === ct;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    try { localStorage.setItem('createTab', ct); } catch (e) { /* ignore */ }
}

(function () {
    const wrap = document.getElementById('createWrap');
    if (!wrap) return;
    wrap.querySelectorAll('.presets-tab[data-ct]').forEach((b) => b.addEventListener('click', () => showCreateTab(b.dataset.ct)));
    let saved = null;
    try { saved = localStorage.getItem('createTab'); } catch (e) { /* ignore */ }
    if (CREATE_TABS.includes(saved)) showCreateTab(saved);
})();
