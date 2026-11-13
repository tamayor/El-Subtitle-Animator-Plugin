// Use tab: "Clip controls", the preset add-ons of the clip being worked on (selected, else under the playhead) -
// Box Width / Height / X / Y, Highlight Color, Row Gap / Justify / X / Y, Text In Pill Colour, Kinetic settings...
// They are hidden in Resolve's Inspector and edited here (src/main/clip-controls.js reads which controls the clip's
// preset has; the card shows only those, and hides when the clip has none). Double-click a label to reset it.

const ccState = { itemId: null, sig: '', values: {}, touched: {}, sentAt: 0, busy: false, defs: {}, fh: 1920 };
const CC_SEND_MS = 110;     // while dragging, values go to Resolve at most this often
const CC_HOLD_MS = 1500;    // a control just changed here is not overwritten by an older read

// createEl (js/ui/dom.js) that also appends to `parent`.
function ccEl(tag, cls, parent, text) {
    const e = createEl(tag, cls || '', text);
    if (parent) parent.appendChild(e);
    return e;
}

function ccFmt(v, d) {
    if (d.integer) return String(Math.round(v));
    const span = Math.abs(d.max - d.min);
    return Number(v).toFixed(span >= 50 ? 1 : span >= 2 ? 2 : 3);
}

// Control values go to Resolve merged, at most every CC_SEND_MS while dragging (js/core/ipc-queue.js).
const ccSender = createThrottledSender(async (vals) => {
    if (!ccState.itemId || !Object.keys(vals).length) return;
    ccState.sentAt = Date.now();
    try {
        const r = await window.sa.setClipControls(ccState.itemId, vals);
        if (r && r.error) setStatus(r.error, 'bad');
    } catch (e) { setStatus('Could not set that control: ' + e.message, 'bad'); }
}, { ms: CC_SEND_MS });
function ccSet(id, v) {
    ccState.values[id] = v;
    ccState.touched[id] = Date.now();
    ccSender.push({ [id]: v });
}

// ---- MultiText row links ----------------------------------------------------------------------------------------
// Upper Y <-> Gap Above Emphasis and Lower Y <-> Gap Below Emphasis are one thing seen two ways: moving the upper row
// up by dy opens the gap above by dy x frame height px (the lower row up closes the gap below). Editing either side
// updates the other. Equal Gaps keeps both gaps the same value; Lock Gaps (panel only) moves them together by the same
// amount even when they differ; Lock X moves Upper / Emphasis / Lower X together. A linked edit puts the clip in
// Gap Mode Pixels (seeded from the gaps as rendered, so nothing jumps): there the two px gaps place the rows exactly.
const CC_LOCK_KEYS = { gaps: 'sa.ccLockGaps', x: 'sa.ccLockX' };
function ccLock(k) { return store.get(CC_LOCK_KEYS[k]) === '1'; }
function ccSetLock(k, on) { store.set(CC_LOCK_KEYS[k], on ? '1' : '0'); }
const CC_ROW_IDS = ['UpperY', 'LowerY', 'RowsSetUE', 'RowsSetEL'];
const CC_X_IDS = ['UpperX', 'EmphasisX', 'LowerX'];
function ccHas(ids) { return ids.every(id => ccState.defs[id]); }
function ccVal(id, dflt) { const v = Number(ccState.values[id]); return Number.isFinite(v) ? v : dflt; }
function ccClamp(id, v) {
    const d = ccState.defs[id];
    return d && d.kind === 'slider' ? Math.max(d.minAllowed, Math.min(d.maxAllowed, d.integer ? Math.round(v) : v)) : v;
}
function ccPixels() { return !ccState.defs.RowsDistOn || ccVal('RowsDistOn', 0) >= 0.5; }
// the two gaps in px as rendered: Pixels mode = the sliders, Lines mode = the read-outs
function ccGaps() {
    if (ccPixels()) return [ccVal('RowsSetUE', 40), ccVal('RowsSetEL', 40)];
    return [ccVal('RowsGapUE', ccVal('RowsSetUE', 40)), ccVal('RowsGapEL', ccVal('RowsSetEL', 40))];
}
// shows a value in its control without sending it
function ccShow(id, v) {
    const row = $('clipCtlBody').querySelector('.cc-row[data-id="' + id + '"]');
    const d = ccState.defs[id];
    if (!row || !d) return;
    if (d.kind === 'slider') {
        const rng = row.querySelector('.cc-range'), num = row.querySelector('.cc-num');
        if (v < Number(rng.min)) rng.min = v;
        if (v > Number(rng.max)) rng.max = v;
        if (!row.matches(':active')) rng.value = v;
        if (document.activeElement !== num) num.value = ccFmt(v, d);
    } else if (d.kind === 'check') {
        row.querySelector('.cc-check:not([data-lock])').checked = v >= 0.5;
    } else if (d.kind === 'combo') {
        row.querySelector('.cc-select').value = Math.round(v);
    }
}
function ccPut(id, v) { v = ccClamp(id, v); ccShow(id, v); ccSet(id, v); }
// Lines -> Pixels with the gaps as they are rendered now
function ccToPixels() {
    if (ccPixels()) return;
    const [ue, el] = ccGaps();
    ccPut('RowsDistOn', 1);
    ccPut('RowsSetUE', ue);
    ccPut('RowsSetEL', el);
}
// one row-link edit: id changed to v (already shown in its own control); the maths is clip-controls/row-links.js
function ccRowEdit(id, v) {
    ccToPixels();
    const [ue, el] = ccGaps();
    const r = rowLinkEdit(id, v, {
        ue, el, uy: ccVal('UpperY', 0), ly: ccVal('LowerY', 0), fh: ccState.fh || 1920,
        equal: !!ccState.defs.RowsEqualize && ccVal('RowsEqualize', 0) >= 0.5, lock: ccLock('gaps')
    });
    ccPut('RowsSetUE', r.ue);
    ccPut('RowsSetEL', r.el);
    ccPut('UpperY', r.uy);
    ccPut('LowerY', r.ly);
}
// Equal Gaps ticked: both gaps become their mean, Upper / Lower Y follow
function ccEqualize() {
    if (!ccHas(CC_ROW_IDS)) return;
    ccToPixels();
    const [ue, el] = ccGaps();
    const r = rowLinkEqualize({ ue, el, uy: ccVal('UpperY', 0), ly: ccVal('LowerY', 0), fh: ccState.fh || 1920 });
    ccPut('UpperY', r.uy);
    ccPut('LowerY', r.ly);
    ccPut('RowsSetUE', r.ue);
    ccPut('RowsSetEL', r.el);
}
// every slider edit goes through here: row links, Lock X, else the value alone
function ccChange(id, v) {
    if (ccHas(CC_ROW_IDS) && CC_ROW_IDS.includes(id)) { ccRowEdit(id, v); return; }
    if (ccLock('x') && ccHas(CC_X_IDS) && CC_X_IDS.includes(id)) {
        const d = v - ccVal(id, 0);
        ccSet(id, v);
        for (const o of CC_X_IDS) if (o !== id) ccPut(o, ccVal(o, 0) + d);
        return;
    }
    ccSet(id, v);
}
function ccLockBox(parent, key, label, tip, onToggle) {
    const cb = ccEl('input', 'cc-check', parent);
    cb.type = 'checkbox';
    cb.checked = ccLock(key);
    cb.dataset.lock = key;
    const lab = ccEl('label', 'cc-label', parent, label);
    lab.title = tip;
    const set = (on) => { cb.checked = on; ccSetLock(key, on); if (onToggle) onToggle(on); };
    cb.addEventListener('change', () => set(cb.checked));
    lab.addEventListener('click', () => set(!cb.checked));
    return cb;
}

// ---- Gradient fills
// A preset whose text fill is a gradient (Money Pop Up, $123,456...) gets one colour picker per stop. The stops come
// from the preset file (src/main/clip-controls.js gradientsOf), since the placed Text+ is never read; what you pick is
// written to the clip (bridge gradient_set) and remembered here per clip, so the pickers show it next time.
const CC_GRAD_KEY = 'sa.ccGradients';
const ccGrad = { timer: null, pending: null };
function ccGradStore() { return store.getJSON(CC_GRAD_KEY, {}) || {}; }
function ccGradKey(itemId, g) { return itemId + '|' + g.tool + '|' + g.index; }
function ccGradSaved(itemId, g) {
    const v = ccGradStore()[ccGradKey(itemId, g)];
    return (Array.isArray(v) && v.length === g.stops.length) ? v : null;
}
function ccGradRemember(itemId, g, colors) {
    const all = ccGradStore();
    const k = ccGradKey(itemId, g);
    delete all[k];
    all[k] = colors;
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - 300))) delete all[old];
    store.set(CC_GRAD_KEY, JSON.stringify(all));
}
function ccGradSend(itemId, g, colors) {
    ccGrad.pending = { itemId, g, colors: colors.slice() };
    clearTimeout(ccGrad.timer);
    ccGrad.timer = setTimeout(async () => {
        const p = ccGrad.pending;
        ccGrad.pending = null;
        if (!p) return;
        ccState.sentAt = Date.now();
        try {
            const stops = p.g.stops.map((st, k) => [st[0], p.colors[k], st[2]]);
            const r = await window.sa.setClipGradient(p.itemId, p.g.tool, p.g.index, stops);
            if (r && r.error) setStatus(r.error, 'bad');
            else ccGradRemember(p.itemId, p.g, p.colors);
        } catch (e) { setStatus('Could not set the gradient: ' + e.message, 'bad'); }
    }, CC_SEND_MS);
}
function ccGradBuild(body, info) {
    const grads = info.gradient || [];
    grads.forEach((g) => {
        ccEl('div', 'cc-head', body, grads.length > 1 ? 'Gradient · ' + g.tool + ' ' + g.index : 'Gradient');
        const colors = ccGradSaved(info.itemId, g) || g.stops.map(st => st[1]);
        const bar = ccEl('div', 'cc-grad-bar', body);
        const paint = () => {
            const ang = Number.isFinite(g.angle) ? (90 - g.angle) : 180;   // Fusion 0 deg = left to right, CSS 90deg
            bar.style.background = 'linear-gradient(' + ang + 'deg, ' + g.stops.map((st, k) => colors[k] + ' ' + (st[0] * 100).toFixed(1) + '%').join(', ') + ')';
        };
        paint();
        bar.title = 'The gradient as it is set on this clip' + (Number.isFinite(g.angle) ? ' (angle ' + g.angle + '°)' : '');
        g.stops.forEach((st, k) => {
            const row = ccEl('div', 'cc-row cc-color', body);
            const name = g.stops.length === 2 ? (k === 0 ? 'Start' : 'End') : 'Stop ' + (k + 1);
            const lab = ccEl('label', 'cc-label', row, name + ' · ' + Math.round(st[0] * 100) + '%');
            lab.title = 'Gradient colour at ' + Math.round(st[0] * 100) + '% (preset: ' + st[1] + ')\nDouble-click to reset';
            const col = ccEl('input', 'cc-color', row);
            col.type = 'color';
            col.value = colors[k];
            col.addEventListener('input', () => { colors[k] = col.value; paint(); ccGradSend(info.itemId, g, colors); });
            lab.addEventListener('dblclick', () => { colors[k] = st[1]; col.value = st[1]; paint(); ccGradSend(info.itemId, g, colors); });
        });
    });
}

function ccBuild(info) {
    const body = $('clipCtlBody');
    body.textContent = '';
    ccGradBuild(body, info);
    ccState.defs = {};
    for (const d of info.controls) if (d.kind !== 'header') ccState.defs[d.id] = d;
    const rowLinks = ccHas(CC_ROW_IDS);
    for (const d of info.controls) {
        if (d.kind === 'header') { ccEl('div', 'cc-head', body, d.label); continue; }
        const row = ccEl('div', 'cc-row cc-' + d.kind, body);
        row.dataset.id = d.id;
        if (d.tip) row.title = d.tip;
        const lab = ccEl('label', 'cc-label', row, d.label);
        lab.title = (d.tip ? d.tip + '\n' : '') + 'Double-click to reset';
        if (d.kind === 'slider') {
            const rng = ccEl('input', 'cc-range', row);
            rng.type = 'range';
            rng.min = d.min; rng.max = d.max;
            rng.step = d.integer ? 1 : (d.max - d.min) / 400;
            const num = ccEl('input', 'cc-num', row);
            num.type = 'number';
            num.step = d.integer ? 1 : (d.max - d.min) / 100;
            const clamp = v => Math.max(d.minAllowed, Math.min(d.maxAllowed, d.integer ? Math.round(v) : v));
            rng.addEventListener('input', () => { const v = clamp(Number(rng.value)); num.value = ccFmt(v, d); ccChange(d.id, v); });
            num.addEventListener('change', () => {
                const v = clamp(Number(num.value));
                if (!Number.isFinite(v)) return;
                num.value = ccFmt(v, d);
                if (v < Number(rng.min)) rng.min = v;
                if (v > Number(rng.max)) rng.max = v;
                rng.value = v;
                ccChange(d.id, v);
            });
            lab.addEventListener('dblclick', () => { rng.value = d.def; num.value = ccFmt(d.def, d); ccChange(d.id, d.def); });
            if (d.id === 'RowsX' && ccHas(CC_X_IDS)) {
                const lr = ccEl('div', 'cc-row cc-check', body);
                ccLockBox(lr, 'x', 'Lock X', 'Upper / Emphasis / Lower X move together by the same amount (each keeps its offset)');
            }
        } else if (d.kind === 'check') {
            const cb = ccEl('input', 'cc-check', row);
            cb.type = 'checkbox';
            row.insertBefore(cb, lab);
            if (d.id === 'RowsEqualize' && rowLinks) {
                // Equal Gaps (on the clip) and Lock Gaps (panel only) side by side; one at a time
                row.classList.add('cc-pair');
                const eq = (on) => {
                    cb.checked = on;
                    ccSet(d.id, on ? 1 : 0);
                    if (on) { ccEqualize(); if (lockCb.checked) { lockCb.checked = false; ccSetLock('gaps', false); } }
                };
                const lockCb = ccLockBox(row, 'gaps', 'Lock Gaps',
                    'Gap Above / Below Emphasis move together by the same amount, even when they differ (Upper / Lower Y follow)',
                    (on) => { if (on && cb.checked) { cb.checked = false; ccSet(d.id, 0); } });
                if (lockCb.checked && ccVal(d.id, 0) >= 0.5) { lockCb.checked = false; ccSetLock('gaps', false); }
                lab.title = 'Both gaps the same: ticking sets them to their average and moves Upper / Lower Y to match\nDouble-click to reset';
                lab.addEventListener('click', () => eq(!cb.checked));
                cb.addEventListener('change', () => eq(cb.checked));
                lab.addEventListener('dblclick', (e) => { e.preventDefault(); eq(d.def >= 0.5); });
                continue;
            }
            lab.addEventListener('click', () => { cb.checked = !cb.checked; ccSet(d.id, cb.checked ? 1 : 0); });
            cb.addEventListener('change', () => ccSet(d.id, cb.checked ? 1 : 0));
            lab.addEventListener('dblclick', (e) => { e.preventDefault(); cb.checked = d.def >= 0.5; ccSet(d.id, d.def); });
        } else if (d.kind === 'combo') {
            const sel = ccEl('select', 'cc-select', row);
            d.options.forEach((o, i) => { const op = ccEl('option', null, sel, o); op.value = i; });
            sel.addEventListener('change', () => ccSet(d.id, Number(sel.value)));
            lab.addEventListener('dblclick', () => { sel.value = d.def; ccSet(d.id, d.def); });
        } else if (d.kind === 'color') {
            const col = ccEl('input', 'cc-color', row);
            col.type = 'color';
            const put = (rgb) => d.ids.forEach((id, k) => { if (id) ccSet(id, rgb[k]); });
            col.addEventListener('input', () => { const rgb = hexToRgb(col.value, 3); if (rgb) put(rgb); });
            lab.addEventListener('dblclick', () => { col.value = rgbToHex(d.defs); put(d.defs); });
        }
    }
}

// Puts the read values into the controls, except ones the user changed here a moment ago.
function ccFill(info) {
    const now = Date.now();
    const fresh = id => !(ccState.touched[id] && now - ccState.touched[id] < CC_HOLD_MS);
    if (info.frameHeight > 0) ccState.fh = info.frameHeight;
    for (const [id, v] of Object.entries(info.values || {})) if (v != null && fresh(id)) ccState.values[id] = v;
    // Lines mode: the gap fields show the gaps as rendered (the read-outs), so Upper / Lower Y visibly change them
    const shown = Object.assign({}, info.values);
    if (ccHas(CC_ROW_IDS) && !ccPixels()) {
        if (info.values.RowsGapUE != null) shown.RowsSetUE = info.values.RowsGapUE;
        if (info.values.RowsGapEL != null) shown.RowsSetEL = info.values.RowsGapEL;
    }
    for (const d of info.controls) {
        if (d.kind === 'header') continue;
        const row = $('clipCtlBody').querySelector('.cc-row[data-id="' + d.id + '"]');
        if (!row) continue;
        if (d.kind === 'color') {
            if (!d.ids.every(id => !id || fresh(id))) continue;
            const rgb = d.ids.map((id, k) => (id && info.values[id] != null) ? info.values[id] : d.defs[k]);
            const col = row.querySelector('.cc-color');
            if (document.activeElement !== col) col.value = rgbToHex(rgb);
            continue;
        }
        if (!fresh(d.id)) continue;
        const v = shown[d.id];
        if (v == null) { row.classList.add('cc-missing'); continue; }
        row.classList.remove('cc-missing');
        if (d.kind === 'slider') {
            const rng = row.querySelector('.cc-range'), num = row.querySelector('.cc-num');
            if (v < Number(rng.min)) rng.min = v;
            if (v > Number(rng.max)) rng.max = v;
            if (!row.matches(':active')) rng.value = v;
            if (document.activeElement !== num) num.value = ccFmt(v, d);
        } else if (d.kind === 'check') {
            row.querySelector('.cc-check:not([data-lock])').checked = v >= 0.5;
        } else if (d.kind === 'combo') {
            const sel = row.querySelector('.cc-select');
            if (document.activeElement !== sel) sel.value = Math.round(v);
        }
    }
}

// The card shows when the clip has add-ons or the MultiText split (Upper / Emphasize / Lower, from text-boxes.js) is up.
function ccSyncCard() {
    const card = $('clipCtlCard');
    if (!card) return;
    const mt = $('mtHostU');
    const mtOn = !!mt && !mt.classList.contains('hidden');
    const ctl = !!ccState.itemId;
    card.classList.toggle('hidden', !mtOn && !ctl);
    card.classList.toggle('cc-no-ctl', !ctl);
}

function ccRender(info) {
    const card = $('clipCtlCard');
    if (!card) return;
    const hasGrad = !!(info && !info.none && info.gradient && info.gradient.length);
    if (!info || info.none || ((!info.controls || !info.controls.length) && !hasGrad)) {
        ccState.itemId = null;
        ccState.sig = '';
        $('clipCtlBody').textContent = '';
        $('clipCtlMeta').textContent = (info && !info.none && info.name) ? info.name.replace(/^(MultiText|Text\+)\s+/, '') + (info.selected ? '' : ' (playhead)') : '';
        ccSyncCard();
        return;
    }
    ccState.itemId = info.itemId;
    ccSyncCard();
    const sig = info.itemId + '|' + (info.controls || []).map(d => d.id).join(',') + '|' + JSON.stringify(info.gradient || []);
    if (sig !== ccState.sig) {
        if (ccState.sig.split('|')[0] !== String(info.itemId)) { ccState.touched = {}; ccSender.cancel(); }
        ccState.sig = sig;
        ccState.itemId = info.itemId;
        ccBuild(info);
    }
    $('clipCtlMeta').textContent = (info.name || 'Clip').replace(/^(MultiText|Text\+)\s+/, '') + (info.selected ? '' : ' (playhead)');
    ccFill(info);
}

// 700 ms while the clip or its values change, 1500 ms once nothing has changed for 3 s (each read is a Resolve pass
// plus a bridge call); nothing while the Use tab is away or the window hidden.
const ccPace = { sig: '', changedAt: 0 };
async function ccTick() {
    const onUse = document.body.classList.contains('tab-apply');
    const active = document.activeElement && $('clipCtlCard') && $('clipCtlCard').contains(document.activeElement);
    let delay = 700;
    if (!state.idle && onUse && !ccState.busy && !state.busy && !document.hidden) {
        ccState.busy = true;
        try {
            const r = await window.sa.clipControls();
            if (r && r.ok) {
                // keep the card while the user is in it, even if the selection blinks
                if (!(active && (r.none || (r.itemId && r.itemId !== ccState.itemId)) && Date.now() - ccState.sentAt < 3000)) {
                    try { if (window.SABoxes && SABoxes.setClip) SABoxes.setClip(r); } catch (e) { /* the splitter is a convenience */ }
                    ccRender(r);
                }
                const sig = r.none ? 'none' : (r.itemId + '|' + JSON.stringify(r.values || null));
                if (sig !== ccPace.sig) { ccPace.sig = sig; ccPace.changedAt = Date.now(); }
                if (!active && Date.now() - ccPace.changedAt > 3000) delay = 1500;
            }
        } catch (e) { /* not connected: try again */ }
        ccState.busy = false;
    }
    setTimeout(ccTick, delay);
}

// View, like Animation timing: 'full' (the card), 'compact' (dense rows, two columns when wide) or 'docked'
// (compact, in the bottom dock above the status message - js/timeline/bottom-dock.js).
function ccView() {
    if (!ccState.view) {
        let v = 'full';
        v = store.get('sa.clipCtlView') || 'full';
        ccState.view = (v === 'compact' || v === 'docked') ? v : 'full';
    }
    return ccState.view;
}
function setClipCtlView(v) {
    ccState.view = (v === 'compact' || v === 'docked') ? v : 'full';
    store.set('sa.clipCtlView', ccState.view);
    applyClipCtlView();
}
function applyClipCtlView() {
    const card = $('clipCtlCard'), home = $('clipCtlHome');
    if (!card || !home) return;
    const v = ccView();
    const docked = v === 'docked' && !!$('dockScroll');
    dockPut(card, docked, home);
    card.classList.toggle('compact', v !== 'full');
    card.classList.toggle('docked', docked);
    const cb = $('clipCtlCompactBtn');
    if (cb) {
        cb.setAttribute('aria-pressed', String(v !== 'full'));
        cb.title = v === 'full' ? 'Ultra compact' : 'Full size';
        cb.setAttribute('aria-label', cb.title);
    }
}

function initClipControls() {
    if (!$('clipCtlCard')) return;
    $('clipCtlCompactBtn').addEventListener('click', () => setClipCtlView(ccView() === 'full' ? 'compact' : 'full'));
    $('clipCtlDockBtn').addEventListener('click', () => setClipCtlView('docked'));
    $('clipCtlUndockBtn').addEventListener('click', () => setClipCtlView('compact'));
    applyClipCtlView();
    ccTick();
}
