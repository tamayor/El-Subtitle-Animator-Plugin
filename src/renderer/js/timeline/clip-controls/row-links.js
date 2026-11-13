// MultiText row links (Clip controls, js/timeline/clip-controls.js), the pure part. Upper Y <-> Gap Above Emphasis and
// Lower Y <-> Gap Below Emphasis are one thing seen two ways: moving the upper row up by dy opens the gap above by
// dy x frame height px (the lower row up closes the gap below). Tested in test/renderer/row-links.test.js.
//
// s: { ue, el } the two gaps in px (Pixels mode), { uy, ly } Upper / Lower Y, fh frame height px,
//    equal: Equal Gaps on (both gaps stay one value), lock: Lock Gaps on (both move by the same amount).
// Returns the new { ue, el, uy, ly }.

// One edit: control `id` ('UpperY' | 'LowerY' | 'RowsSetUE' | 'RowsSetEL') set to v.
function rowLinkEdit(id, v, s) {
    const { fh, equal, lock } = s;
    let { ue, el, uy, ly } = s;
    const ue0 = ue, el0 = el;
    if (id === 'UpperY') { const d = (v - uy) * fh; uy = v; ue += d; if (equal) el = ue; else if (lock) el += d; }
    else if (id === 'LowerY') { const d = (ly - v) * fh; ly = v; el += d; if (equal) ue = el; else if (lock) ue += d; }
    else if (id === 'RowsSetUE') { const d = v - ue; ue = v; uy += d / fh; if (equal) el = ue; else if (lock) el += d; }
    else if (id === 'RowsSetEL') { const d = v - el; el = v; ly -= d / fh; if (equal) ue = el; else if (lock) ue += d; }
    // the partner row follows its gap
    if (id === 'UpperY' || id === 'RowsSetUE') ly -= (el - el0) / fh;
    else uy += (ue - ue0) / fh;
    return { ue, el, uy, ly };
}

// Equal Gaps ticked: both gaps become their mean, Upper / Lower Y follow.
function rowLinkEqualize(s) {
    const t = (s.ue + s.el) / 2;
    return { ue: t, el: t, uy: s.uy + (t - s.ue) / s.fh, ly: s.ly - (t - s.el) / s.fh };
}
