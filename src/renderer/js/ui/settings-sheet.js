// The Settings sheet (header gear): Style | Placement | App. Its controls keep their own ids and are wired by their
// features (design/, timeline/placement-menu.js, ui/fusion-fixes.js, ui/compact.js); this file only opens, closes and
// switches panes.
//
//   initSettingsSheet({ onShow: () => { ...redraw what was measured while the sheet was hidden... },
//                       escapeBlocked: () => true while Escape should close something else first })
//   openSettingsSheet('placement')   // optional pane: 'style' | 'placement' | 'app'
//   closeSettingsSheet()
//   settingsSheetPane()              // the pane on screen, or null while the sheet is closed

let settingsSheetTabs = null;
let settingsSheetOnShow = null;

function settingsSheetOpen() {
    const sheet = document.getElementById('settingsSheet');
    return !!sheet && !sheet.classList.contains('hidden');
}

function settingsSheetPane() {
    return settingsSheetOpen() && settingsSheetTabs ? settingsSheetTabs.value : null;
}

function openSettingsSheet(pane) {
    const sheet = document.getElementById('settingsSheet'), back = document.getElementById('settingsBackdrop');
    const btn = document.getElementById('settingsBtn');
    if (!sheet) return;
    if (typeof closePop === 'function') closePop();
    // under the header, whatever its height (one row; shorter in compact mode)
    const header = document.querySelector('header');
    if (header) sheet.style.setProperty('--sheet-top', Math.round(header.getBoundingClientRect().bottom + 4) + 'px');
    sheet.classList.remove('hidden');
    if (back) back.classList.remove('hidden');
    if (btn) { btn.classList.add('on'); btn.setAttribute('aria-expanded', 'true'); }
    if (pane && settingsSheetTabs) settingsSheetTabs.show(pane);
    if (typeof settingsSheetOnShow === 'function') settingsSheetOnShow();
}

function closeSettingsSheet() {
    const sheet = document.getElementById('settingsSheet'), back = document.getElementById('settingsBackdrop');
    const btn = document.getElementById('settingsBtn');
    if (!sheet || sheet.classList.contains('hidden')) return;
    if (typeof closePop === 'function') closePop();
    sheet.classList.add('hidden');
    if (back) back.classList.add('hidden');
    if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-expanded', 'false'); }
}

function initSettingsSheet(opts) {
    const sheet = document.getElementById('settingsSheet');
    if (!sheet) return;
    settingsSheetOnShow = opts && opts.onShow;
    settingsSheetTabs = bindTabGroup(sheet, {
        key: 'st',
        values: ['style', 'placement', 'app'],
        buttons: '.sheet-head [data-st]',
        storageKey: 'sa.settingsPane',
        panes: { root: sheet, selector: '.sheet-pane' },
        onChange: () => { if (typeof settingsSheetOnShow === 'function') settingsSheetOnShow(); }
    });
    const btn = document.getElementById('settingsBtn');
    if (btn) btn.addEventListener('click', () => { if (settingsSheetOpen()) closeSettingsSheet(); else openSettingsSheet(); });
    const close = document.getElementById('settingsClose');
    if (close) close.addEventListener('click', closeSettingsSheet);
    const back = document.getElementById('settingsBackdrop');
    if (back) back.addEventListener('mousedown', closeSettingsSheet);
    // Escape closes the sheet, unless something opened from it is still up (a popover, or what opts.escapeBlocked
    // reports): that closes first. This listener is on window in the capture phase, so it runs before the popover's
    // own Escape handler removes the popover.
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !settingsSheetOpen()) return;
        if (document.querySelector('.pop')) return;
        if (opts && typeof opts.escapeBlocked === 'function' && opts.escapeBlocked()) return;
        closeSettingsSheet();
    }, true);
}
