// Compact mode: a denser panel for small windows (css/compact.css does the styling).
// It switches on by itself when the window is narrower than COMPACT_W or shorter than COMPACT_H.
// localStorage 'sa.compact' = 'on' | 'off' forces it either way ('auto' or unset = by window size).
// In compact mode the tabs move into the header row, so header + tabs take one line instead of three.

const COMPACT_W = 520, COMPACT_H = 700;

function compactPref() {
    try { return localStorage.getItem('sa.compact') || 'auto'; } catch (e) { return 'auto'; }
}

function isCompact() { return document.body.classList.contains('compact'); }

function applyCompact() {
    const pref = compactPref();
    const collapsed = document.body.classList.contains('win-collapsed');   // collapsed bar = the compact one-row header
    const on = collapsed || pref === 'on' || (pref !== 'off' && (window.innerWidth < COMPACT_W || window.innerHeight < COMPACT_H));
    const was = isCompact();
    document.body.classList.toggle('compact', on);
    // tabs: inside the header row when compact, under the header otherwise
    const header = document.querySelector('header'), nav = document.querySelector('nav.tabs');
    if (header && nav) {
        if (on && nav.parentNode !== header) header.insertBefore(nav, header.querySelector('.header-bar'));
        else if (!on && nav.parentNode === header) header.after(nav);
    }
    if (was !== on) {
        if (typeof dockRefresh === 'function') dockRefresh();
        if (typeof setDockHeight === 'function' && typeof dockStoredHeight === 'function') setDockHeight(dockStoredHeight(), false);
    }
}

function setCompactPref(v) {
    try { localStorage.setItem('sa.compact', v); } catch (e) { /* ignore */ }
    applyCompact();
}

// Auto-collapse (src/main/window.js does the window side): out of focus, the window shrinks to the header bar; hovering
// it opens it again. The header button switches it on/off (saved as sa.autoCollapse, on by default).
function autoCollapseOn() {
    try { return localStorage.getItem('sa.autoCollapse') !== '0'; } catch (e) { return true; }
}
function syncAutoCollapse(on) {
    const btn = $('autoCollapse');
    if (btn) {
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.title = on
            ? 'Auto-collapse is on: when you click away from the panel it shrinks to this bar; hover it to open it again (click to turn off)'
            : 'Auto-collapse is off: click so the panel shrinks to this bar when you click away from it';
    }
    if (window.sa && window.sa.setAutoCollapse) window.sa.setAutoCollapse(on);
}
function initAutoCollapse() {
    if (window.sa && window.sa.onCollapsed) {
        window.sa.onCollapsed((v) => {
            document.body.classList.toggle('win-collapsed', v);
            applyCompact();
        });
    }
    const btn = $('autoCollapse');
    if (btn) {
        btn.addEventListener('click', () => {
            const on = !autoCollapseOn();
            try { localStorage.setItem('sa.autoCollapse', on ? '1' : '0'); } catch (e) { /* ignore */ }
            syncAutoCollapse(on);
        });
    }
    syncAutoCollapse(autoCollapseOn());
}

let compactRaf = 0;
window.addEventListener('resize', () => {
    cancelAnimationFrame(compactRaf);
    compactRaf = requestAnimationFrame(applyCompact);
});
function initCompact() { applyCompact(); initAutoCollapse(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCompact);
else initCompact();
