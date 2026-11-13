// Use tab: the bottom dock. Animation timing and Clip controls can be docked above the status message; both share one
// scrollable area whose height is set by dragging its top edge (saved as sa.dockRestHeight; double-click = default).
// The page gets bottom padding equal to the footer so nothing in the Use tab hides under the dock.

const DOCK_MIN = 56, DOCK_DEF = 110;
const DOCK_HOVER_FRAC = 0.5;          // hovering the dock opens it to half the window height
const DOCK_OPEN_DELAY = 120, DOCK_CLOSE_DELAY = 300;   // ms, so brushing past the edge does not flicker

function dockStoredHeight() {
    let h = 0;
    try { h = Number(localStorage.getItem('sa.dockRestHeight')); } catch (e) { h = 0; }
    return h > 0 ? h : DOCK_DEF;
}
// compact mode (small windows): the dock never takes more than 35% of the window
function dockMaxHeight() {
    const compact = document.body.classList.contains('compact');
    return Math.max(DOCK_MIN, compact ? Math.round(window.innerHeight * 0.35) : window.innerHeight - 150);
}

// compact mode: the dock folds to its bar (saved as sa.dockFolded)
function setDockFolded(folded, save) {
    const dock = $('bottomDock'), btn = $('dockFold');
    if (!dock) return;
    dock.classList.toggle('folded', !!folded);
    if (btn) {
        btn.textContent = (folded ? '▸' : '▾') + ' Timing & clip';
        btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
        btn.title = folded ? 'Show the timing bar and clip controls' : 'Fold the dock to this bar';
    }
    if (save) { try { localStorage.setItem('sa.dockFolded', folded ? '1' : '0'); } catch (e) { /* ignore */ } }
    dockPad();
}
function setDockHeight(h, save) {
    const scroll = $('dockScroll');
    if (!scroll) return;
    h = Math.round(Math.max(DOCK_MIN, Math.min(dockMaxHeight(), h)));
    scroll.style.maxHeight = h + 'px';
    if (save) { try { localStorage.setItem('sa.dockRestHeight', String(h)); } catch (e) { /* ignore */ } }
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
    const dock = $('bottomDock');
    if (dock && dock.classList.contains('expanded')) return;   // hover growth floats over the page; keep the resting padding
    const f = $('footerUse');
    if (f) document.body.style.setProperty('--footer-h', f.offsetHeight + 'px');
}

function initBottomDock() {
    const dock = $('bottomDock'), scroll = $('dockScroll'), grip = $('dockGrip');
    if (!dock || !scroll || !grip) return;
    setDockHeight(dockStoredHeight(), false);
    let folded = false;
    try { folded = localStorage.getItem('sa.dockFolded') === '1'; } catch (e) { folded = false; }
    setDockFolded(folded, false);
    const fold = $('dockFold');
    if (fold) fold.addEventListener('click', () => setDockFolded(!dock.classList.contains('folded'), true));
    const rt = $('dockRealtime');
    if (rt) {
        rt.addEventListener('change', () => { if (typeof setAutoRender === 'function') setAutoRender(rt.checked); });
        if (typeof syncAutoRenderUI === 'function') syncAutoRenderUI();
    }

    // a card inside hides/shows (no clip, other clip...): show or hide the whole dock
    new MutationObserver(dockRefresh).observe(scroll, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
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
    initDockHover(dock, scroll);
    dockRefresh();
}

// Hover: the dock grows to half the window height and shrinks back to its resting height (the grip sets that) when the
// mouse leaves. It stays open while a field inside has focus or a drag that started inside is still held.
function initDockHover(dock, scroll) {
    let timer = 0, inside = false, held = false;
    const restH = () => parseFloat(scroll.style.maxHeight) || DOCK_DEF;
    const expand = (on) => {
        if (dock.classList.contains('resizing') || dock.classList.contains('folded') || dock.classList.contains('empty')) on = false;
        if (on === dock.classList.contains('expanded')) return;
        if (on) {
            const h = Math.max(restH(), Math.round(window.innerHeight * DOCK_HOVER_FRAC));
            dock.style.setProperty('--dock-open-h', h + 'px');
            dockPad();                  // lock the page padding at the resting height first
        }
        dock.classList.toggle('expanded', on);
    };
    const editing = () => {
        const el = document.activeElement;
        return !!(el && dock.contains(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
            && el.type !== 'checkbox' && el.type !== 'range');
    };
    const later = (on, ms) => { clearTimeout(timer); timer = setTimeout(() => expand(on), ms); };
    const maybeClose = () => { if (!inside && !held && !editing()) later(false, DOCK_CLOSE_DELAY); };
    dock.addEventListener('mouseenter', () => { inside = true; later(true, DOCK_OPEN_DELAY); });
    dock.addEventListener('mouseleave', () => { inside = false; maybeClose(); });
    dock.addEventListener('pointerdown', (e) => { if (!e.target.closest('#dockGrip')) held = true; });
    window.addEventListener('pointerup', () => { if (held) { held = false; maybeClose(); } });
    dock.addEventListener('focusout', () => setTimeout(maybeClose, 0));
    dock.addEventListener('transitionend', (e) => { if (e.target === scroll && !dock.classList.contains('expanded')) dockPad(); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initBottomDock);
else initBottomDock();
