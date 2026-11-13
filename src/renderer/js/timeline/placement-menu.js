// Placement (Settings sheet > Placement; track / lock options, remembered per computer).

// ---- Placement options (all off by default; remembered per computer). loopOn is shown under App > Resolve.
const PLACE_IDS = { locked: 'placeLocked', disabledTrack: 'placeDisabledTrack', disabledClip: 'placeDisabledClip', firstEmpty: 'placeFirstEmpty', loopOn: 'placeLoopOn' };
// Clip track range: "Clip track V<from> to V<to>" (to empty = no upper limit). null = not set.
const PLACE_RANGE_IDS = { rangeFrom: 'placeRangeFrom', rangeTo: 'placeRangeTo' };
// Audio tracks for the sound effects: 'any' (lowest free) | 'same' (as the video range) | 'own' (A<from> to A<to>)
const PLACE_AUDIO_RANGE_IDS = { audioFrom: 'placeAudioFrom', audioTo: 'placeAudioTo' };
function placeRangeVal(id, min) {
    const e = $(id); if (!e) return null;
    const n = Math.round(Number(e.value));
    return (e.value !== '' && Number.isFinite(n) && n >= (min || 2)) ? n : null;
}
function placeOptions() {
    const o = {};
    for (const k in PLACE_IDS) { const e = $(PLACE_IDS[k]); o[k] = !!(e && e.checked); }
    for (const k in PLACE_RANGE_IDS) o[k] = placeRangeVal(PLACE_RANGE_IDS[k]);
    if (o.rangeFrom && o.rangeTo && o.rangeTo < o.rangeFrom) o.rangeTo = o.rangeFrom;
    const am = $('placeAudioMode');
    o.audioMode = am && (am.value === 'same' || am.value === 'own') ? am.value : 'any';
    for (const k in PLACE_AUDIO_RANGE_IDS) o[k] = placeRangeVal(PLACE_AUDIO_RANGE_IDS[k], 1);
    if (o.audioFrom && o.audioTo && o.audioTo < o.audioFrom) o.audioTo = o.audioFrom;
    return o;
}
function placeRangeActive(o) { return !!(o.rangeFrom || o.rangeTo); }
// The main process keeps a copy, so placements made through Claude (MCP) follow the same settings.
function pushPlaceOptions() {
    try { if (window.sa && window.sa.setPlaceOptions) window.sa.setPlaceOptions(placeOptions()).catch(() => { }); } catch (e) { /* optional */ }
}
function bindPlacementMenu() {
    let saved = {};
    saved = store.getJSON('sa.place', {}) || {};
    const save = () => {
        store.set('sa.place', JSON.stringify(placeOptions()));
        pushPlaceOptions();
        syncPlaceUI();
        promptPlacementChanged();   // Prompt tab keys that default from Placement follow it
    };
    for (const k in PLACE_IDS) {
        const e = $(PLACE_IDS[k]); if (!e) continue;
        e.checked = !!saved[k];
        e.addEventListener('change', save);
    }
    for (const k in PLACE_RANGE_IDS) {
        const e = $(PLACE_RANGE_IDS[k]); if (!e) continue;
        e.value = saved[k] ? String(saved[k]) : '';
        e.addEventListener('change', () => {
            const v = placeRangeVal(PLACE_RANGE_IDS[k]);
            e.value = v ? String(v) : '';
            const o = placeOptions();      // keep To >= From in the fields too
            if (o.rangeTo && $(PLACE_RANGE_IDS.rangeTo)) $(PLACE_RANGE_IDS.rangeTo).value = String(o.rangeTo);
            save();
        });
    }
    const am = $('placeAudioMode');
    if (am) {
        am.value = (saved.audioMode === 'same' || saved.audioMode === 'own') ? saved.audioMode : 'any';
        am.addEventListener('change', save);
    }
    for (const k in PLACE_AUDIO_RANGE_IDS) {
        const e = $(PLACE_AUDIO_RANGE_IDS[k]); if (!e) continue;
        e.value = saved[k] ? String(saved[k]) : '';
        e.addEventListener('change', () => {
            const v = placeRangeVal(PLACE_AUDIO_RANGE_IDS[k], 1);
            e.value = v ? String(v) : '';
            const o = placeOptions();
            if (o.audioTo && $(PLACE_AUDIO_RANGE_IDS.audioTo)) $(PLACE_AUDIO_RANGE_IDS.audioTo).value = String(o.audioTo);
            save();
        });
    }
    const syncPlaceUI = () => {
        const o = placeOptions();
        const range = placeRangeActive(o);
        const own = $('placeAudioOwn');
        if (own) own.classList.toggle('hidden', o.audioMode !== 'own');
        // loopOn is saved with these but is shown under App > Resolve: it is not a Placement option
        const n = Object.keys(PLACE_IDS).filter(k => k !== 'loopOn' && o[k]).length + (range ? 1 : 0) + (o.audioMode !== 'any' ? 1 : 0);
        const summary = $('placeSummaryU');
        const rangeTxt = range ? 'V' + (o.rangeFrom || 2) + '–' + (o.rangeTo ? 'V' + o.rangeTo : '∞') : '';
        if (summary) {
            summary.textContent = range
                ? rangeTxt + (n > 1 ? ' · ' + (n - 1) + ' more option' + (n > 2 ? 's' : '') : '')
                : (n ? (n + ' option' + (n > 1 ? 's' : '') + ' active') : 'Default (top layer)');
        }
        if ($('placeBtn')) $('placeBtn').textContent = 'Placement' + (n ? ' (' + n + ')' : '') + ' ▴';
    };
    const btn = $('placeBtn'), menu = $('placeMenu');
    if (btn && menu) {
        const setOpen = (open) => { menu.classList.toggle('hidden', !open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
        btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.classList.contains('hidden')); });
        document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== btn) setOpen(false); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    }
    syncPlaceUI();
    pushPlaceOptions();
    promptPlacementChanged();
}
