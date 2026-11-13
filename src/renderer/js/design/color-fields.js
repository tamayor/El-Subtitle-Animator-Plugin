// Colour boxes (macOS Colors panel / Windows Color dialog / web picker), double-click-to-reset and hex fields.

// Every colour box in the app opens the same picker: macOS's own Colors panel (your saved swatches, the magnifier, the
// sliders), live as you pick. Only if it cannot open at all is the web colour picker used.
let colorReopen = null, colorLastTarget = null;
let colorPanelBusy = false, colorPanelUntil = 0, colorPanelSince = 0, colorLiveTarget = null, colorLiveApplied = false, colorLiveTimer = 0, colorLiveLast = 0;
if (window.sa && window.sa.onColorLive) window.sa.onColorLive((hex) => {
    // the Colors panel changes the colour while you drag in it: the settings and the preview follow at once (no OK needed)
    const t = colorLiveTarget;
    if (!t || !colorPanelBusy || hex === t.value) return;
    clearTimeout(colorLiveTimer);
    const wait = Math.max(0, 150 - (Date.now() - colorLiveLast));
    colorLiveTimer = setTimeout(() => { if (t.value !== hex) { t.value = hex; colorLiveApplied = true; colorLiveLast = Date.now(); colorLiveTimer = 0; t.dispatchEvent(new Event('input', { bubbles: true })); } }, wait);
});
// The system picker takes a moment to appear: a spinner sits on the clicked box until it does (this window loses focus
// to the picker, a live colour arrives, or the pick ends), so the click is never left without an answer.
let colorSpinner = null, colorSpinnerTimer = 0;
function showColorLoading(t) {
    hideColorLoading();
    const r = t.getBoundingClientRect();
    const d = document.createElement('div');
    d.className = 'color-loading';
    d.style.left = r.left + 'px'; d.style.top = r.top + 'px';
    d.style.width = r.width + 'px'; d.style.height = r.height + 'px';
    d.appendChild(document.createElement('span'));
    document.body.appendChild(d);
    document.body.classList.add('color-opening');
    colorSpinner = d;
    window.addEventListener('blur', hideColorLoading, { once: true });
    colorSpinnerTimer = setTimeout(hideColorLoading, 10000);
}
function hideColorLoading() {
    clearTimeout(colorSpinnerTimer); colorSpinnerTimer = 0;
    window.removeEventListener('blur', hideColorLoading);
    document.body.classList.remove('color-opening');
    if (colorSpinner) { colorSpinner.remove(); colorSpinner = null; }
}
if (window.sa && window.sa.onColorLive) window.sa.onColorLive(() => hideColorLoading());

// Closing the Colors panel never depends on its own close button: clicking back into the app (after it has opened) or
// pressing Esc closes it, keeping the colour picked so far.
function closeColorPanel() {
    if (!colorPanelBusy || Date.now() - colorPanelSince < 600) return;
    try { window.sa.cancelColor(); } catch (err) { /* ignore */ }
}
window.addEventListener('focus', closeColorPanel);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeColorPanel(); }, true);

document.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'color' || !window.sa || !window.sa.pickColor) return;
    e.preventDefault();
    e.stopPropagation();
    // one panel only: further clicks (and the click a label passes on to its box) are ignored while it is open
    if (colorPanelBusy) {
        // the same box again closes the panel (the colour picked so far stays); another box closes it and opens it for
        // that box, so a click on a box always answers
        if (Date.now() - colorPanelSince > 700 || t !== colorLiveTarget) {
            if (t !== colorLiveTarget) colorReopen = t;
            try { window.sa.cancelColor(); } catch (err) { /* ignore */ }
        }
        return;
    }
    if (Date.now() < colorPanelUntil && t === colorLastTarget) return;
    colorPanelBusy = true;
    // While the picker is open, live colours only update the panel and the canvas; saving, the update of the clip in
    // Resolve and the Fusion re-render wait until it closes (doing them on every live step made everything glitch).
    state.colorPicking = true;
    colorPanelSince = Date.now();
    colorLiveTarget = t; colorLiveApplied = false;
    const dbg = (msg) => { try { window.sa.dlog('[color] ' + msg + ' (' + (Date.now() - colorPanelSince) + ' ms) id=' + (t.id || '?') + ' from=' + t.value); } catch (err) { /* ignore */ } };
    dbg('panel opening');
    showColorLoading(t);
    setStatus('Opening the colour picker…', '');
    const onColorBlur = () => setStatus(/^Win/i.test(navigator.platform || '')
        ? 'Pick a color in the Windows Color dialog and press OK.'
        : 'Pick a color in the macOS Colors panel: it applies as you pick. Click back into the app (or press Esc) when done.', '');
    window.addEventListener('blur', onColorBlur, { once: true });
    let r = null;
    try { r = await window.sa.pickColor(t.value); } catch (err) { r = null; }
    window.removeEventListener('blur', onColorBlur);
    state.colorPicking = false;
    hideColorLoading();
    colorPanelBusy = false;
    clearTimeout(colorLiveTimer); colorLiveTimer = 0;
    colorPanelUntil = Date.now() + 400;
    dbg('panel returned ' + JSON.stringify(r));
    colorLastTarget = t;
    await new Promise(res => setTimeout(res, 150));    // let the window settle before the change is applied
    const reopen = colorReopen; colorReopen = null;
    if (reopen && reopen.isConnected) setTimeout(() => { colorPanelUntil = 0; reopen.click(); }, 0);
    if (r && r.busy) return;
    setStatus('', '');
    if (r && r.ok && r.hex) {
        if (r.hex !== t.value) {
            t.value = r.hex;
            dbg('applying ' + r.hex);
            t.dispatchEvent(new Event('input', { bubbles: true }));
            dbg('input handled');
            setTimeout(() => { try { t.dispatchEvent(new Event('change', { bubbles: true })); } catch (err) { /* ignore */ } }, 60);      // boxes that listen for 'change' follow right after
        } else if (colorLiveApplied) {
            // the colour was already shown live: one full update now (save, Resolve, render) for the final colour
            t.dispatchEvent(new Event('input', { bubbles: true }));
            setTimeout(() => { try { t.dispatchEvent(new Event('change', { bubbles: true })); } catch (err) { /* ignore */ } }, 60);
        }
    } else if (r && r.cancelled && colorLiveApplied) {
        // closed without an answer after live colours were shown: keep what is on screen, fully applied
        t.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => { try { t.dispatchEvent(new Event('change', { bubbles: true })); } catch (err) { /* ignore */ } }, 60);
    } else if (!(r && r.ok)) {
        try { if (t.showPicker) t.showPicker(); } catch (err) { /* ignore */ }
    }
}, true);

// A caption that is not a <label>: a plain text span / div sitting next to its field(s) in the same row
// (Prompt tab Width / Height sliders, B-roll and Prompt range boxes). Returns the caption with the fields
// it names in ._captionFields, or null.
const RESET_FIELD = 'input[type=number], input[type=text], input[type=search], input[type=range], select';
function captionFor(t) {
    if (!t || t.children.length || !t.textContent.trim()) return null;
    const p = t.parentElement;
    if (!p || p === document.body) return null;
    const fields = [...p.children].filter(c => c.matches(RESET_FIELD));
    if (!fields.length || fields.length > 3) return null;
    t._captionFields = fields;
    return t;
}

let dblClickResetBound = false;
function bindDblClickReset() {
    if (dblClickResetBound) return;
    dblClickResetBound = true;
    document.addEventListener('dblclick', (e) => {
        // A control's own double-click (clip controls, sound layers) already reset it.
        const t = e.target;
        if (e.defaultPrevented || !t || !t.closest) return;
        // Do not trigger if user was double clicking inside an input box to select text
        if (t.closest('input, select, textarea, button, [contenteditable="true"]')) return;

        // Find if target is a label or inside a label
        const label = t.closest('label, .xform-lbl, .sh-lbl, .rv-lbl, .td-lbl') || captionFor(t);
        if (!label) return;

        const inputs = [];
        if (label._captionFields) inputs.push(...label._captionFields);
        const forId = label.getAttribute('for');
        if (forId) {
            const el = document.getElementById(forId);
            if (el) inputs.push(el);
        }
        label.querySelectorAll('input, select').forEach(inp => {
            if (!inputs.includes(inp)) inputs.push(inp);
        });

        const row = label.closest('.xform-grid-row, .ctl, .row, .sh-border-box, .sh-soft-row, .td-color-size, .rv-row, .td-line');
        if (row) {
            row.querySelectorAll('input, select').forEach(inp => {
                if (!inputs.includes(inp)) inputs.push(inp);
            });
        }

        if (!inputs.length) return;

        let handled = false;
        inputs.forEach(inp => {
            if (inp.disabled || inp.readOnly) return;
            const def = getDefaultValue(inp);
            if (def !== null && def !== undefined) {
                inp.value = def;
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                handled = true;
            }
        });

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
            try {
                if (window.getSelection) window.getSelection().removeAllRanges();
            } catch (err) { }
        }
    });
}

function attachHexFields() {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    for (const sw of document.querySelectorAll('input[type=color]')) {
        if (sw._hex || sw.classList.contains('rv-native-color') || sw.classList.contains('hidden') || (sw.closest && sw.closest('.rv-swatch-box'))) continue;
        const hex = document.createElement('input');
        hex.type = 'text';
        hex.className = 'hex-input';
        hex.maxLength = 7;
        hex.spellcheck = false;
        hex.placeholder = '#ffffff';
        hex.title = 'Hex color code (e.g. #1e3036)';
        hex.value = sw.value;
        sw._hex = hex;
        const row = document.createElement('div');
        row.className = 'color-field';
        sw.parentNode.insertBefore(row, sw);
        row.appendChild(sw);
        row.appendChild(hex);

        // Keep the text field current when code sets the swatch value (loading a preset, switching element).
        Object.defineProperty(sw, 'value', {
            configurable: true,
            get() { return desc.get.call(this); },
            set(v) {
                desc.set.call(this, v);
                if (document.activeElement !== hex) hex.value = desc.get.call(this);
                this.dispatchEvent(new Event('colorsync'));
            }
        });
        sw.addEventListener('input', () => { if (document.activeElement !== hex) hex.value = sw.value; });

        const apply = (final) => {
            const h = normHex(hex.value);
            hex.classList.toggle('bad', !h && hex.value.trim() !== '');
            if (!h) return;
            if (h !== sw.value) {
                desc.set.call(sw, h);
                sw.dispatchEvent(new Event('input', { bubbles: true }));
                sw.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (final) hex.value = h;
        };
        hex.addEventListener('click', (e) => e.preventDefault()); // don't open the swatch picker via the label
        hex.addEventListener('input', () => apply(false));
        hex.addEventListener('change', () => apply(true));
        hex.addEventListener('blur', () => { apply(true); if (!normHex(hex.value)) { hex.value = sw.value; hex.classList.remove('bad'); } });
        hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(true); hex.blur(); } });
        hex.addEventListener('paste', () => setTimeout(() => apply(true), 0));
    }
}
