// B-roll tab: wiring (where it goes, the In / Out range bar, Land on the word, initBrollTab, brollTabShown).

// ------------------------------------------------------------------ wiring

// Only the fields this "Where" uses: the detected subtitle (under the playhead), the number (Subtitle number…),
// Seconds (At the playhead, or the length while editing a clip), Extend by (subtitle / marks ranges). Track always.
// (Where stays while editing: it is used by Place as new.)
function brWhereChanged() {
    const w = $('brWhere').value, editing = !!brUI.editing;
    $('brDetWrap').classList.toggle('hidden', w !== 'sub');
    $('brSubWrap').classList.toggle('hidden', w !== 'num');
    $('brSecWrap').classList.toggle('hidden', !(w === 'playhead' || editing));
    $('brEnterWrap').classList.remove('hidden');
    brSyncRangeBar();
    $('brExtWrap').classList.toggle('hidden', w === 'playhead');
    store.set('brWhere', w);
    brShowDetected();
}

// "Subtitle under the playhead": the panel's own poll (state.live) already knows it, so this follows the playhead
// without asking Resolve again.
function brShowDetected() {
    const L = state.live, s = L && L.ok ? L.subtitle : null;
    const key = s ? s.index + '|' + s.text : (L && L.ok ? 'none' : 'off');
    if (brUI.lastSubKey !== key) {
        brUI.lastSubKey = key;
        brUI.detected = s ? { index: s.index, text: s.text, start: s.start, end: s.end } : null;
        // word timings set by hand belong to one subtitle: a new one starts from its own speech
        if (!brUI.editing && brUI.values && brUI.values._manual) {
            if (!brUI.values._times) { brUI.values.settle = 0; brUI.values.delay = 0; }
            delete brUI.values._times; delete brUI.values._ends; delete brUI.values._manual; brLandNoteText();
        }
        if (!brUI.editing && $('brSec')) {
            const fps = (L && L.fps) || 30;
            $('brSec').placeholder = (s && s.end > s.start) ? ((s.end - s.start) / fps).toFixed(1) : "effect's";
        }
        if (s && $('brFromSub') && $('brFromSub').checked && state.tab === 'broll') brFillFromSub();
        brSyncRangeBar();
    }
    const box = $('brDetected');
    if (!box || $('brDetWrap').classList.contains('hidden')) return;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    box.classList.toggle('none', !s);
    if (s) {
        const t = String(s.text || '').replace(/\s+/g, ' ').trim();
        box.append(createEl('b', { text: '#' + s.index }), t);
        box.title = '#' + s.index + ': ' + t;
    } else {
        box.textContent = L && L.ok ? 'No subtitle here: the next one after the playhead' : 'Not connected to Resolve';
        box.title = '';
    }
}

// The clip length in frames (last frame index): the placed clip while editing, else Seconds, else the subtitle under
// the playhead (+ Extend by), else the effect's own length.
function brRangeLen() {
    const rec = brUI.editing;
    if (rec && Number(rec.frames) > 2) return Number(rec.frames) - 1;
    const fps = (state.live && state.live.fps) || 30;
    let f = brSecVal() * fps;
    const d = brUI.detected, w = $('brWhere') && $('brWhere').value;
    if (!(f > 0) && w === 'sub' && d && d.end > d.start) f = (d.end - d.start) + (Number($('brExtend') && $('brExtend').value) || 0) * fps;
    if (!(f > 0)) { const e = brUI.effects.find(x => x.id === brUI.sel); f = ((e && e.seconds) || 2.5) * fps; }
    return Math.max(3, Math.round(f) - 1);
}

// The animation In window: left head = where it starts (delay), right head = where it has landed (delay + enter).
function brInWindow(L) {
    const s0 = Math.max(0, Math.min(L - 1, Math.round(Number(brUI.values.delay ?? 0))));
    const len = Math.max(1, Math.min(L - s0, Math.round(Number(brUI.values.enter ?? 10))));
    return { s: s0, e: s0 + len };   // the frame range bar's { s, e }
}

function brSyncRangeBar() { if (brUI.range) brUI.range.paint(); }

// The playhead relative to the clip start: the placed clip while editing, else the subtitle it will go on ("Subtitle
// under the playhead"). "At the playhead" starts the clip at the playhead itself, so it is always frame 0.
function brPlayheadIn() {
    const L = state.live, rec = brUI.editing, d = brUI.detected, w = $('brWhere') && $('brWhere').value;
    if (!L || !L.ok || !Number.isFinite(Number(L.frame))) return null;
    const start = rec ? Number(rec.start) : w === 'sub' && d ? Number(d.start) : w === 'playhead' ? Number(L.frame) : NaN;
    if (!Number.isFinite(start)) return null;
    const rel = Math.round(Number(L.frame)) - Math.round(start);
    return rel >= 0 && rel <= brRangeLen() ? rel : null;
}

// The Place section's animation In bar (js/components/frame-range.js).
function brInitRangeBar() {
    const mount = $('brRangeMount');
    if (!mount) return;
    const dflt = () => { const e = brUI.effects.find(x => x.id === brUI.sel), d = (e && e.defaults) || {}; return { s: d.delay ?? 0, e: (d.delay ?? 0) + (d.enter ?? 10) }; };
    brUI.range = frameRangeBar({
        title: 'Animation In: left head = where it starts, right head = where it has landed (the gap is its length). Drag between them to move it. Snaps to the red Resolve playhead (P). Double-click: default',
        last: brRangeLen,
        get: () => brInWindow(brRangeLen()),
        change: (s, e, final) => {
            brUI.values.delay = s;
            brUI.values.enter = e - s;
            brUI.values.fitIn = true;                                   // the build lands on the right head
            if (Number(brUI.values.settle) > 0) brUI.values.settle = 0;   // the bar now decides where the In lands
            if (final) brFieldEdited(true);
        },
        read: (s, e, L) => 'In <b>' + s + '</b> f → <b>' + e + '</b> f · length <b>' + (e - s) + '</b> f <span class="fxr-len">/ ' + (L + 1) + ' f</span>',
        playhead: brPlayheadIn,
        lane: brLane,
        laneEdit: brLaneEdit,
        laneReset: brLaneReset,
        dflt
    });
    const note = createEl('div', { id: 'brLandNote', class: 'br-land-note hidden', text: 'Land on the spoken word sets the animation: each word comes in as it is spoken. Untick it to time the In here.' });
    mount.replaceWith(brUI.range.el, note);
    brLandSync();
}

// The word lane under the In bar: the subtitle as one block; with Land on the spoken word, one block per word as it
// will be timed (from the main process: the transcription if there is one, else estimated), the key word marked.
function brLane() {
    const L = brRangeLen(), rec = brUI.editing, w = $('brWhere') && $('brWhere').value, d = brUI.detected;
    const sub = rec ? rec.subtitle : (w === 'sub' && d ? d : null);
    if (!sub) return null;
    if (!($('brLand') && $('brLand').checked)) {
        const t = String(sub.text || '').replace(/\s+/g, ' ').trim();
        return t ? { segs: [{ s: 0, e: L, label: t, title: '#' + sub.index + ' “' + t + '” · 0–' + L + ' f' }] } : null;
    }
    const q = rec ? { id: rec.id } : { subtitle: sub.index };
    const key = JSON.stringify([brUI.sel, q, brUI.values]);
    if (key !== brUI.laneKey && !brUI.laneBusy && brUI.sel) {
        brUI.laneBusy = true;
        setTimeout(async () => {
            let r = null;
            try { r = await window.sa.brollWordLane({ effect: brUI.sel, props: brUI.values, ...q }); } catch (e) { r = null; }
            brUI.laneKey = key;
            brUI.laneData = r && !r.error && Array.isArray(r.segs) ? r : null;
            brUI.laneBusy = false;
            brSyncRangeBar();
        }, 250);
    }
    const r = brUI.laneData;
    if (!r || !r.segs.length) return null;
    const est = r.source === 'estimate' ? ' (estimated: no transcription yet)' : '';
    return { editable: !!r.editable, segs: r.segs.map(g => ({ ...g, title: '“' + g.label + '” · ' + g.s + '–' + g.e + ' f' + (g.key ? ' · lands here' : '') + est })) };
}

// A word block was dragged in the lane: every word's in / end go into the clip's props (_times / _ends) and are kept
// (_manual) until Sync to words or a double-click on the lane re-times them from the speech.
function brLaneEdit(i, s, e, final) {
    const r = brUI.laneData;
    if (!r || !r.segs[i]) return;
    r.segs[i] = { ...r.segs[i], s, e };
    if (r.segs[i].build) {
        // one key word: strawberry = where the build starts (the In's start), matcha = where it lands
        brUI.values.delay = s;
        brUI.values.settle = e;
    } else {
        const units = r.segs.filter(g => Number.isInteger(g.unit)).sort((a, b) => a.unit - b.unit);   // the shown words, in order
        brUI.values._times = units.map(g => g.s);
        brUI.values._ends = units.map(g => g.e);
    }
    brUI.values._manual = true;
    brUI.laneKey = JSON.stringify([brUI.sel, brUI.editing ? { id: brUI.editing.id } : { subtitle: (brUI.detected || {}).index }, brUI.values]);
    brLandNoteText();
    if (final) brFieldEdited(true);
}

function brLaneReset() {
    if (brUI.values._manual && !brUI.values._times) { brUI.values.settle = 0; brUI.values.delay = 0; }   // the key word build
    delete brUI.values._times; delete brUI.values._ends; delete brUI.values._manual;
    brUI.laneKey = null;
    brLandNoteText();
    brFieldEdited(true);
}

function brLandNoteText() {
    const n = $('brLandNote');
    if (n) n.textContent = brUI.values && brUI.values._manual
        ? 'Word timings set by hand: strawberry = a word\'s in, matcha = its end. Double-click the words to re-time them from the speech.'
        : 'Land on the spoken word sets the animation: each word comes in as it is spoken. Drag a word\'s strawberry in or matcha end to adjust it.';
}

// Land on the spoken word decides the timing (word by word, or the build landing on the key word), so the In bar is
// muted under it, with a note.
function brLandSync() {
    const on = !!($('brLand') && $('brLand').checked);
    if (brUI.range) {
        brUI.range.el.classList.toggle('fxr-off', on);
        const bar = brUI.range.el.querySelector('.fxr-bar');
        if (bar) bar.tabIndex = on ? -1 : 0;
        brUI.range.el.title = on ? 'Set by Land on the spoken word' : '';
    }
    const n = $('brLandNote'); if (n) n.classList.toggle('hidden', !on);
    brLandNoteText();
    brUI.laneKey = null;
    if (brUI.range) brUI.range.paint();
}

function initBrollTab() {
    brUI.tabs = bindTabGroup($('brWrap'), {
        key: 'br', values: BR_TABS, buttons: '.presets-tab[data-br]', storageKey: 'brTab', restoreFires: true,
        onChange: (t) => { if (t === 'placed') brLoadPlaced(); else if (t === 'collage') colLoad(); }
    });
    initCollage();
    rememberDetails($('brMoreBox'), 'sa.brMoreOpen');   // Placement & timing
    brInitSearch();
    $('brPlace').addEventListener('click', () => brPlace(false));
    $('brPlaceNew').addEventListener('click', () => brPlace(true));
    $('brStopEdit').addEventListener('click', () => brEdit(null));
    $('brCancel').addEventListener('click', () => window.sa.brollCancel());
    $('brFromSub').checked = store.get('brFromSub') === '1';
    $('brFromSub').addEventListener('change', () => {
        store.set('brFromSub', $('brFromSub').checked ? '1' : '0');
        if ($('brFromSub').checked) brFillFromSub();
    });
    $('brClearEdits').addEventListener('click', brClearEdits);
    $('brReset').addEventListener('click', () => { const e = brUI.effects.find(x => x.id === brUI.sel); if (e) { brUI.values = { ...e.defaults }; brPick(e.id, e.defaults); } });
    $('brAt').addEventListener('input', brMoment);
    $('brSec').addEventListener('input', () => { brSyncRangeBar(); brFieldEdited(); });
    $('brExtend').addEventListener('input', brSyncRangeBar);
    brInitRangeBar();
    { const v = store.get('brView'); if (v === 'panel' || v === 'timeline') $('brView').value = v; }
    $('brView').addEventListener('change', () => {
        store.set('brView', brView());
        brButtons();
        if (brView() === 'panel') { if ($('brBg').value === 'frame') brLoadFrame(); brPreviewSoon(true); }
    });
    brButtons();
    $('brBg').addEventListener('change', () => { store.set('brBg', $('brBg').value); if ($('brBg').value === 'frame') brLoadFrame(); else brApplyBg(); });
    $('brWhere').addEventListener('change', brWhereChanged);
    $('brSuggest').addEventListener('click', brSuggest);
    $('brPlaceTicked').addEventListener('click', brPlaceTicked);
    $('brRefresh').addEventListener('click', brLoadPlaced);
    $('brSyncAll').addEventListener('click', () => brSync({ all: true }));
    $('brFinalizeAll').addEventListener('click', () => brFinalize({ all: true }));
    $('brDraft').checked = store.get('brDraft') === '1';
    $('brDraft').addEventListener('change', () => { store.set('brDraft', $('brDraft').checked ? '1' : '0'); });
    $('brLand').checked = store.get('brLand') === '1';
    $('brLand').addEventListener('change', () => { store.set('brLand', $('brLand').checked ? '1' : '0'); brLandSync(); });
    brLandSync();
    $('brOpenFolder').addEventListener('click', () => window.sa.brollOpen({}));
    { const bg = store.get('brBg'); if (bg) $('brBg').value = bg; }
    { const w = store.get('brWhere'); if (w && $('brWhere').querySelector('option[value="' + w + '"]')) $('brWhere').value = w; }
    brWhereChanged();
    setInterval(() => { if (state.tab === 'broll') brShowDetected(); }, 300);
    window.sa.onBrollProgress((d) => {
        if (!d) return;
        if (d.phase === 'render') { $('brBar').style.width = Math.round((d.p || 0) * 100) + '%'; brStatus(d.text + (d.p ? ' ' + Math.round(d.p * 100) + '%' : ''), ''); }
        else if (d.phase === 'place') brStatus(d.text, '');
        else if (d.phase === 'done') { brStatus(d.text, 'ok'); $('brBar').style.width = '0'; if (d.placed && brUI.ready) brLoadPlaced(); }
        else if (d.phase === 'error') brStatus(d.text, 'bad');
    });
    const brViewBtn = $('brViewModeBtn');
    if (brViewBtn) {
        brSyncViewModeBtn();
        brViewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPop(brViewBtn, 'pop-menu pop-viewmode', (el) => {
                for (const m of VIEW_MODES) {
                    const it = document.createElement('button');
                    it.className = 'pop-item' + (brViewMode() === m.id ? ' on' : '');
                    const ck = document.createElement('span'); ck.className = 'pop-check'; ck.textContent = '✓';
                    const ic = document.createElement('span'); ic.className = 'vm-ico'; ic.innerHTML = m.svg;
                    const lb = document.createElement('span'); lb.className = 'pop-label'; lb.textContent = m.label;
                    it.append(ck, ic, lb);
                    it.addEventListener('click', () => { closePop(); setBrViewMode(m.id); });
                    el.appendChild(it);
                }
            });
        });
    }
}

// The tab was opened: effects once, the playhead frame and the placed list every time (and the Collage pane when it is
// the one showing).
async function brollTabShown() {
    if (!brUI.ready) { brUI.ready = await brLoadEffects(); }
    if (brView() === 'panel') { if ($('brBg').value === 'frame') brLoadFrame(); else brApplyBg(); }
    brLoadPlaced();
    if (brUI.tabs && brUI.tabs.value === 'collage') colLoad();
}
