// Colour boxes (macOS Colors panel / web picker), double-click-to-reset and hex fields.

// Every colour box opens macOS's own Colors panel (your saved swatches, the magnifier, the sliders). Hold Option to get the
// web colour picker instead. If the system panel cannot open, the web picker is used.
let colorPanelBusy = false, colorPanelUntil = 0, colorPanelSince = 0, colorLiveTarget = null, colorLiveApplied = false, colorLiveTimer = 0, colorLiveLast = 0;
if (window.sa && window.sa.onColorLive) window.sa.onColorLive((hex) => {
    // the Colors panel changes the colour while you drag in it: the settings and the preview follow at once (no OK needed)
    const t = colorLiveTarget;
    if (!t || !colorPanelBusy || hex === t.value) return;
    clearTimeout(colorLiveTimer);
    const wait = Math.max(0, 150 - (Date.now() - colorLiveLast));
    colorLiveTimer = setTimeout(() => { if (t.value !== hex) { t.value = hex; colorLiveApplied = true; colorLiveLast = Date.now(); colorLiveTimer = 0; t.dispatchEvent(new Event('input', { bubbles: true })); } }, wait);
});
document.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'color' || e.altKey || !window.sa || !window.sa.pickColor) return;
    e.preventDefault();
    e.stopPropagation();
    // one panel only: further clicks (and the click a label passes on to its box) are ignored while it is open
    if (colorPanelBusy) {
        // a panel that has been open a while (maybe hidden behind another window) is closed by clicking the box again
        if (Date.now() - colorPanelSince > 1500) { try { window.sa.cancelColor(); } catch (err) { /* ignore */ } }
        return;
    }
    if (Date.now() < colorPanelUntil) return;
    colorPanelBusy = true;
    colorPanelSince = Date.now();
    colorLiveTarget = t; colorLiveApplied = false;
    const dbg = (msg) => { try { window.sa.dlog('[color] ' + msg + ' (' + (Date.now() - colorPanelSince) + ' ms) id=' + (t.id || '?') + ' from=' + t.value); } catch (err) { /* ignore */ } };
    dbg('panel opening');
    setStatus('Pick a color in the macOS Colors panel: it applies as you pick. Close the panel (or click the color box again) when done.', '');
    let r = null;
    try { r = await window.sa.pickColor(t.value); } catch (err) { r = null; }
    colorPanelBusy = false;
    clearTimeout(colorLiveTimer); colorLiveTimer = 0;
    colorPanelUntil = Date.now() + 400;
    dbg('panel returned ' + JSON.stringify(r));
    await new Promise(res => setTimeout(res, 150));    // let the window settle before the change is applied
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
            setTimeout(() => { try { t.dispatchEvent(new Event('change', { bubbles: true })); } catch (err) { /* ignore */ } }, 60);
        }
    } else if (!(r && r.ok)) {
        try { if (t.showPicker) t.showPicker(); } catch (err) { /* ignore */ }
    }
}, true);

let dblClickResetBound = false;
function bindDblClickReset() {
    if (dblClickResetBound) return;
    dblClickResetBound = true;
    document.addEventListener('dblclick', (e) => {
        // Find if target is a label or inside a label
        const label = e.target.closest('label, .xform-lbl, .sh-lbl, .rv-lbl, .td-lbl');
        if (!label) return;

        // Do not trigger if user was double clicking inside an input box to select text
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

        const inputs = [];
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
