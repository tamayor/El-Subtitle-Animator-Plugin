// Use tab: "Clip controls", the preset add-ons of the clip being worked on (selected, else under the playhead) -
// Box Width / Height / X / Y, Highlight Color, Row Gap / Justify / X / Y, Text In Pill Colour, Kinetic settings...
// They are hidden in Resolve's Inspector and edited here (src/main/clip-controls.js reads which controls the clip's
// preset has; the card shows only those, and hides when the clip has none). Double-click a label to reset it.

const ccState = { itemId: null, sig: '', values: {}, touched: {}, pending: {}, timer: null, sentAt: 0, busy: false, defs: {}, fh: 1920 };
const CC_SEND_MS = 110;     // while dragging, values go to Resolve at most this often
const CC_HOLD_MS = 1500;    // a control just changed here is not overwritten by an older read

function ccEl(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
}

function ccHex(rgb) {
    return '#' + rgb.map(v => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 255).toString(16).padStart(2, '0')).join('');
}
function ccRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    return m ? [1, 2, 3].map(k => Math.round(parseInt(m[k], 16) / 255 * 1000) / 1000) : null;
}
function ccFmt(v, d) {
    if (d.integer) return String(Math.round(v));
    const span = Math.abs(d.max - d.min);
    return Number(v).toFixed(span >= 50 ? 1 : span >= 2 ? 2 : 3);
}

function ccSend() {
    clearTimeout(ccState.timer);
    const wait = Math.max(0, CC_SEND_MS - (Date.now() - ccState.sentAt));
    ccState.timer = setTimeout(async () => {
        const vals = ccState.pending;
        ccState.pending = {};
        if (!ccState.itemId || !Object.keys(vals).length) return;
        ccState.sentAt = Date.now();
        try {
            const r = await window.sa.setClipControls(ccState.itemId, vals);
            if (r && r.error) setStatus(r.error, 'bad');
        } catch (e) { setStatus('Could not set that control: ' + e.message, 'bad'); }
    }, wait);
}
function ccSet(id, v) {
    ccState.values[id] = v;
    ccState.touched[id] = Date.now();
    ccState.pending[id] = v;
    ccSend();
}

// ---- MultiText row links ----------------------------------------------------------------------------------------
// Upper Y <-> Gap Above Emphasis and Lower Y <-> Gap Below Emphasis are one thing seen two ways: moving the upper row
// up by dy opens the gap above by dy x frame height px (the lower row up closes the gap below). Editing either side
// updates the other. Equal Gaps keeps both gaps the same value; Lock Gaps (panel only) moves them together by the same
// amount even when they differ; Lock X moves Upper / Emphasis / Lower X together. A linked edit puts the clip in
// Gap Mode Pixels (seeded from the gaps as rendered, so nothing jumps): there the two px gaps place the rows exactly.
const CC_LOCK_KEYS = { gaps: 'sa.ccLockGaps', x: 'sa.ccLockX' };
function ccLock(k) { try { return localStorage.getItem(CC_LOCK_KEYS[k]) === '1'; } catch (e) { return false; } }
function ccSetLock(k, on) { try { localStorage.setItem(CC_LOCK_KEYS[k], on ? '1' : '0'); } catch (e) { /* ignore */ } }
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
// one row-link edit: id changed to v (already shown in its own control)
function ccRowEdit(id, v) {
    const fh = ccState.fh || 1920;
    ccToPixels();
    let [ue, el] = ccGaps();
    let uy = ccVal('UpperY', 0), ly = ccVal('LowerY', 0);
    const equal = ccState.defs.RowsEqualize && ccVal('RowsEqualize', 0) >= 0.5;
    const lock = ccLock('gaps');
    if (id === 'UpperY') { const d = (v - uy) * fh; uy = v; ue += d; if (equal) el = ue; else if (lock) el += d; }
    else if (id === 'LowerY') { const d = (ly - v) * fh; ly = v; el += d; if (equal) ue = el; else if (lock) ue += d; }
    else if (id === 'RowsSetUE') { const d = v - ue; ue = v; uy += d / fh; if (equal) el = ue; else if (lock) el += d; }
    else if (id === 'RowsSetEL') { const d = v - el; el = v; ly -= d / fh; if (equal) ue = el; else if (lock) ue += d; }
    const [ue0, el0] = ccGaps();
    // the partner row follows its gap
    if (id === 'UpperY' || id === 'RowsSetUE') ly -= (el - el0) / fh;
    else uy += (ue - ue0) / fh;
    ccPut('RowsSetUE', ue);
    ccPut('RowsSetEL', el);
    ccPut('UpperY', uy);
    ccPut('LowerY', ly);
}
// Equal Gaps ticked: both gaps become their mean, Upper / Lower Y follow
function ccEqualize() {
    if (!ccHas(CC_ROW_IDS)) return;
    ccToPixels();
    const fh = ccState.fh || 1920;
    const [ue, el] = ccGaps();
    const t = (ue + el) / 2;
    ccPut('UpperY', ccVal('UpperY', 0) + (t - ue) / fh);
    ccPut('LowerY', ccVal('LowerY', 0) - (t - el) / fh);
    ccPut('RowsSetUE', t);
    ccPut('RowsSetEL', t);
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

function ccBuild(info) {
    const body = $('clipCtlBody');
    body.textContent = '';
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
            col.addEventListener('input', () => { const rgb = ccRgb(col.value); if (rgb) put(rgb); });
            lab.addEventListener('dblclick', () => { col.value = ccHex(d.defs); put(d.defs); });
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
            if (document.activeElement !== col) col.value = ccHex(rgb);
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

function ccRender(info) {
    const card = $('clipCtlCard');
    if (!card) return;
    if (!info || info.none || !info.controls || !info.controls.length) {
        card.classList.add('hidden');
        ccState.itemId = null;
        ccState.sig = '';
        return;
    }
    card.classList.remove('hidden');
    const sig = info.itemId + '|' + info.controls.map(d => d.id).join(',');
    if (sig !== ccState.sig) {
        if (ccState.itemId !== info.itemId) { ccState.touched = {}; ccState.pending = {}; }
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
                if (!(active && (r.none || (r.itemId && r.itemId !== ccState.itemId)) && Date.now() - ccState.sentAt < 3000)) ccRender(r);
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
        try { v = localStorage.getItem('sa.clipCtlView') || 'full'; } catch (e) { v = 'full'; }
        ccState.view = (v === 'compact' || v === 'docked') ? v : 'full';
    }
    return ccState.view;
}
function setClipCtlView(v) {
    ccState.view = (v === 'compact' || v === 'docked') ? v : 'full';
    try { localStorage.setItem('sa.clipCtlView', ccState.view); } catch (e) { /* ignore */ }
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
