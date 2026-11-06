// Drag-to-adjust number fields (like Resolve).

// ---------------------------------------------------------------- drag-to-adjust number fields (like Resolve)
// Press and drag left/right anywhere on a number field to change it. Shift = 10x faster, Option/Alt = 10x finer.
// A click without dragging puts the cursor in the field for typing.
(function () {
    let drag = null;
    const decimalsOf = (n) => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
    // The value read-out next to a slider (e.g. "Size 0.104") drives that slider: vTdSizeU -> tdSizeU.
    function sliderForVal(span) {
        if (!span || !span.id || span.id[0] !== 'v') return null;
        const id = span.id.charAt(1).toLowerCase() + span.id.slice(2);
        const el = document.getElementById(id);
        return (el && el.matches('input[type=range]')) ? el : null;
    }
    function fieldFrom(target) {
        if (!target || !target.closest) return null;
        if (target.matches && target.matches('input[type=number]')) return target;
        const cell = target.closest('.xform-num-cell');
        if (cell) return cell.querySelector('input[type=number]');
        // The value read-out, or the label holding it ("Size 0.140"), drives that slider.
        const val = target.closest('.val') || (target.closest('label') && target.closest('label').querySelector('.val[id]'));
        return val ? sliderForVal(val) : null;
    }
    document.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const inp = fieldFrom(e.target);
        if (!inp || inp.disabled || inp.readOnly || document.activeElement === inp) return;
        e.preventDefault();
        const step = Number(inp.step) > 0 ? Number(inp.step) : 1;
        const min = inp.min !== '' ? Number(inp.min) : -Infinity;
        const max = inp.max !== '' ? Number(inp.max) : Infinity;
        let perPx = step;
        if (isFinite(min) && isFinite(max) && max > min) perPx = Math.max(inp.type === 'range' ? step / 4 : step, (max - min) / 400);
        drag = { inp, x0: e.clientX, v0: Number(inp.value) || 0, step, min, max, perPx, dec: decimalsOf(inp.step || '1'), moved: false, id: e.pointerId };
        try { (e.target).setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }, true);
    document.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x0;
        if (!drag.moved && Math.abs(dx) < 3) return;
        if (!drag.moved) { drag.moved = true; document.body.classList.add('num-scrubbing'); }
        const mult = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
        let v = drag.v0 + dx * drag.perPx * mult;
        v = Math.round(v / drag.step) * drag.step;
        v = Math.max(drag.min, Math.min(drag.max, v));
        const txt = v.toFixed(Math.max(drag.dec, e.altKey ? drag.dec + 1 : 0));
        if (drag.inp.value === txt) return;
        drag.inp.value = txt;
        drag.inp.dispatchEvent(new Event('input', { bubbles: true }));
        drag.inp.dispatchEvent(new Event('change', { bubbles: true }));
    }, true);
    const end = (e) => {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        const d = drag;
        drag = null;
        document.body.classList.remove('num-scrubbing');
        if (!d.moved && d.inp.type === 'number') { d.inp.focus(); try { d.inp.select(); } catch (err) { /* ignore */ } }
    };
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
})();
