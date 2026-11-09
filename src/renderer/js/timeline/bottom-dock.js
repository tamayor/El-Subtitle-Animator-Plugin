// Use tab: the bottom dock. Animation timing and Clip controls can be docked above the status message; both share one
// scrollable area whose height is set by dragging its top edge (saved as sa.dockHeight; double-click = default).
// The page gets bottom padding equal to the footer so nothing in the Use tab hides under the dock.

const DOCK_MIN = 56, DOCK_DEF = 260;

function dockStoredHeight() {
    let h = 0;
    try { h = Number(localStorage.getItem('sa.dockHeight')); } catch (e) { h = 0; }
    return h > 0 ? h : DOCK_DEF;
}
function dockMaxHeight() { return Math.max(DOCK_MIN, window.innerHeight - 150); }
function setDockHeight(h, save) {
    const scroll = $('dockScroll');
    if (!scroll) return;
    h = Math.round(Math.max(DOCK_MIN, Math.min(dockMaxHeight(), h)));
    scroll.style.maxHeight = h + 'px';
    if (save) { try { localStorage.setItem('sa.dockHeight', String(h)); } catch (e) { /* ignore */ } }
}

// Puts a card in the dock (timing on top, clip controls under it) or back after its home placeholder.
function dockPut(card, on, home) {
    const scroll = $('dockScroll');
    if (on && scroll) {
        if (card.parentNode !== scroll) {
            if (card.id === 'timingCard') scroll.prepend(card);
            else scroll.append(card);
        }
    } else if (home && card.previousElementSibling !== home) home.after(card);
    dockRefresh();
}

// The dock always shows its bar (Real-time render); the resize grip and scroll area only while it holds a visible card.
function dockRefresh() {
    const dock = $('bottomDock'), scroll = $('dockScroll');
    if (!dock || !scroll) return;
    const shown = [...scroll.children].some(c => !c.classList.contains('hidden'));
    dock.classList.remove('hidden');
    dock.classList.toggle('empty', !shown);
    document.body.classList.toggle('dock-on', shown);
    dockPad();
}
function dockPad() {
    const f = $('footerUse');
    if (f) document.body.style.setProperty('--footer-h', f.offsetHeight + 'px');
}

function initBottomDock() {
    const dock = $('bottomDock'), scroll = $('dockScroll'), grip = $('dockGrip');
    if (!dock || !scroll || !grip) return;
    setDockHeight(dockStoredHeight(), false);
    const rt = $('dockRealtime');
    if (rt) {
        rt.addEventListener('change', () => { if (typeof setAutoRender === 'function') setAutoRender(rt.checked); });
        if (typeof syncAutoRenderUI === 'function') syncAutoRenderUI();
    }

    // a card inside hides/shows (no clip, other clip...): show or hide the whole dock
    new MutationObserver(dockRefresh).observe(scroll, { childList: true, subtree: false, attributes: true, attributeFilter: ['class'] });
    for (const c of scroll.children) new MutationObserver(dockRefresh).observe(c, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(muts => {
        for (const m of muts) for (const n of m.addedNodes) {
            if (n.nodeType === 1 && !n._dockWatched) {
                n._dockWatched = true;
                new MutationObserver(dockRefresh).observe(n, { attributes: true, attributeFilter: ['class'] });
            }
        }
    }).observe(scroll, { childList: true });
    if (window.ResizeObserver && $('footerUse')) new ResizeObserver(dockPad).observe($('footerUse'));

    // drag the top edge: up = taller
    let drag = null;
    grip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        drag = { y: e.clientY, h: scroll.getBoundingClientRect().height };
        dock.classList.add('resizing');
    });
    grip.addEventListener('pointermove', (e) => {
        if (!drag) return;
        setDockHeight(drag.h + (drag.y - e.clientY), false);
    });
    const end = () => {
        if (!drag) return;
        drag = null;
        dock.classList.remove('resizing');
        setDockHeight(parseFloat(scroll.style.maxHeight) || DOCK_DEF, true);
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('dblclick', () => setDockHeight(DOCK_DEF, true));
    grip.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 60 : 20;
        const cur = scroll.getBoundingClientRect().height;
        if (e.key === 'ArrowUp') { setDockHeight(cur + step, true); e.preventDefault(); }
        if (e.key === 'ArrowDown') { setDockHeight(cur - step, true); e.preventDefault(); }
    });
    window.addEventListener('resize', () => setDockHeight(dockStoredHeight(), false));
    dockRefresh();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initBottomDock);
else initBottomDock();
