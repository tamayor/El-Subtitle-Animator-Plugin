// The placement drawer below Alignment (track / lock options, remembered per computer).

// ---- Placement drawer below Alignment (all unchecked by default; remembered per computer)
const PLACE_IDS = { locked: 'placeLocked', disabledTrack: 'placeDisabledTrack', disabledClip: 'placeDisabledClip', firstEmpty: 'placeFirstEmpty', loopOn: 'placeLoopOn' };
function placeOptions() {
    const o = {};
    for (const k in PLACE_IDS) { const e = $(PLACE_IDS[k]); o[k] = !!(e && e.checked); }
    return o;
}
function setPlaceOpen(wanted) {
    state.placeOpen = !!wanted;
    const body = $('placeBodyU'), wrap = $('placeWrapU'), toggle = $('placeToggleU');
    if (body) body.classList.toggle('hidden', !state.placeOpen);
    if (wrap) wrap.classList.toggle('open', state.placeOpen);
    if (toggle) {
        toggle.setAttribute('aria-expanded', state.placeOpen ? 'true' : 'false');
        const chev = toggle.querySelector('.chev');
        if (chev) chev.textContent = state.placeOpen ? '▾' : '▸';
    }
}
function bindPlacementMenu() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('sa.place') || '{}') || {}; } catch (e) { saved = {}; }
    for (const k in PLACE_IDS) {
        const e = $(PLACE_IDS[k]); if (!e) continue;
        e.checked = !!saved[k];
        e.addEventListener('change', () => {
            try { localStorage.setItem('sa.place', JSON.stringify(placeOptions())); } catch (err) { /* optional */ }
            syncPlaceUI();
        });
    }
    const syncPlaceUI = () => {
        const n = Object.values(placeOptions()).filter(Boolean).length;
        const summary = $('placeSummaryU');
        if (summary) summary.textContent = n ? (n + ' option' + (n > 1 ? 's' : '') + ' active') : 'Default (top layer)';
        if ($('placeBtn')) $('placeBtn').textContent = 'Placement' + (n ? ' (' + n + ')' : '') + ' ▴';
    };
    if ($('placeToggleU')) {
        $('placeToggleU').addEventListener('click', (e) => {
            e.stopPropagation();
            setPlaceOpen(!state.placeOpen);
        });
    }
    const btn = $('placeBtn'), menu = $('placeMenu');
    if (btn && menu) {
        const setOpen = (open) => { menu.classList.toggle('hidden', !open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
        btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.classList.contains('hidden')); });
        document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== btn) setOpen(false); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    }
    syncPlaceUI();
}
