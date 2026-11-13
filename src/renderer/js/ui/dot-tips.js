// Instant name tooltip for the numbered gallery dots (Text presets, Effects, B-roll).
// The native title tooltip waits about a second; this one shows on hover with no delay.
(function () {
    let tip = null;
    let cur = null;
    function show(dot) {
        const text = dot.dataset.tip;
        if (!text) return;
        if (!tip) {
            tip = document.createElement('div');
            tip.className = 'dot-tip';
            document.body.appendChild(tip);
        }
        cur = dot;
        tip.textContent = text;
        tip.style.display = 'block';
        const r = dot.getBoundingClientRect();
        const w = tip.offsetWidth, h = tip.offsetHeight;
        const left = Math.max(4, Math.min(window.innerWidth - w - 4, r.left + r.width / 2 - w / 2));
        const top = r.top - h - 6 >= 4 ? r.top - h - 6 : r.bottom + 6;
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
    }
    function hide() { cur = null; if (tip) tip.style.display = 'none'; }
    document.addEventListener('mouseover', (e) => {
        const dot = e.target.closest && e.target.closest('.gallery-dot');
        if (dot) { if (dot !== cur) show(dot); } else if (cur) hide();
    });
    document.addEventListener('mouseleave', hide);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('mousedown', () => { if (cur) { const d = cur; requestAnimationFrame(() => { if (d.isConnected && d.matches(':hover')) show(d); else hide(); }); } });
})();
