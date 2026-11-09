// Keeps --fill (how far along the slider is, in %) on every range input, for the filled line in css/sliders.css.
// Covers the user dragging (input events), code setting .value (the setter is wrapped: no event fires then),
// and sliders added later or whose min / max / value attributes change.

function sliderFill(el) {
    if (!el || el.type !== 'range') return;
    const min = Number(el.min) || 0, max = el.max === '' ? 100 : Number(el.max), v = Number(el.value);
    const pct = max > min ? Math.max(0, Math.min(100, (v - min) / (max - min) * 100)) : 0;
    el.style.setProperty('--fill', pct.toFixed(2) + '%');
}

(function initSliderFill() {
    const proto = HTMLInputElement.prototype;
    for (const prop of ['value', 'valueAsNumber']) {
        const d = Object.getOwnPropertyDescriptor(proto, prop);
        if (!d || !d.set) continue;
        Object.defineProperty(proto, prop, {
            configurable: true,
            enumerable: d.enumerable,
            get: d.get,
            set(v) { d.set.call(this, v); if (this.type === 'range') sliderFill(this); },
        });
    }
    const onEv = e => { if (e.target && e.target.type === 'range') sliderFill(e.target); };
    document.addEventListener('input', onEv, true);
    document.addEventListener('change', onEv, true);

    const sweep = root => {
        if (root.nodeType !== 1) return;
        if (root.matches('input[type=range]')) sliderFill(root);
        root.querySelectorAll('input[type=range]').forEach(sliderFill);
    };
    const start = () => {
        sweep(document.body);
        new MutationObserver(muts => {
            for (const m of muts) {
                if (m.type === 'attributes') sliderFill(m.target);
                else m.addedNodes.forEach(sweep);
            }
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['min', 'max', 'value'] });
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
})();
