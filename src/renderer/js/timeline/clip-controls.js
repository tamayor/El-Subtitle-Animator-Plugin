// Use tab: "Clip controls", the preset add-ons of the clip being worked on (selected, else under the playhead) -
// Box Width / Height / X / Y, Highlight Color, Row Gap / Justify / X / Y, Text In Pill Colour, Kinetic settings...
// They are hidden in Resolve's Inspector and edited here (src/main/clip-controls.js reads which controls the clip's
// preset has; the card shows only those, and hides when the clip has none). Double-click a label to reset it.

const ccState = { itemId: null, sig: '', values: {}, touched: {}, pending: {}, timer: null, sentAt: 0, busy: false };
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

function ccBuild(info) {
    const body = $('clipCtlBody');
    body.textContent = '';
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
            rng.addEventListener('input', () => { const v = clamp(Number(rng.value)); num.value = ccFmt(v, d); ccSet(d.id, v); });
            num.addEventListener('change', () => {
                const v = clamp(Number(num.value));
                if (!Number.isFinite(v)) return;
                num.value = ccFmt(v, d);
                if (v < Number(rng.min)) rng.min = v;
                if (v > Number(rng.max)) rng.max = v;
                rng.value = v;
                ccSet(d.id, v);
            });
            lab.addEventListener('dblclick', () => { rng.value = d.def; num.value = ccFmt(d.def, d); ccSet(d.id, d.def); });
        } else if (d.kind === 'check') {
            const cb = ccEl('input', 'cc-check', row);
            cb.type = 'checkbox';
            row.insertBefore(cb, lab);
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
        const v = info.values[d.id];
        if (v == null) { row.classList.add('cc-missing'); continue; }
        row.classList.remove('cc-missing');
        if (d.kind === 'slider') {
            const rng = row.querySelector('.cc-range'), num = row.querySelector('.cc-num');
            if (v < Number(rng.min)) rng.min = v;
            if (v > Number(rng.max)) rng.max = v;
            if (!row.matches(':active')) rng.value = v;
            if (document.activeElement !== num) num.value = ccFmt(v, d);
        } else if (d.kind === 'check') {
            row.querySelector('.cc-check').checked = v >= 0.5;
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

async function ccTick() {
    const onUse = document.body.classList.contains('tab-apply');
    const active = document.activeElement && $('clipCtlCard') && $('clipCtlCard').contains(document.activeElement);
    if (!state.idle && onUse && !ccState.busy && !state.busy && !document.hidden) {
        ccState.busy = true;
        try {
            const r = await window.sa.clipControls();
            if (r && r.ok) {
                // keep the card while the user is in it, even if the selection blinks
                if (!(active && (r.none || (r.itemId && r.itemId !== ccState.itemId)) && Date.now() - ccState.sentAt < 3000)) ccRender(r);
            }
        } catch (e) { /* not connected: try again */ }
        ccState.busy = false;
    }
    setTimeout(ccTick, 700);
}

function initClipControls() {
    if (!$('clipCtlCard')) return;
    ccTick();
}
