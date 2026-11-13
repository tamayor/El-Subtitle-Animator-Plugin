// Colour conversions shared by the whole panel. Fusion and Resolve speak in 0..1 RGB channels, colour inputs in
// "#rrggbb": convert here, never with a private copy in a feature file.
//
//   normHex(' F0A ')          '#ff00aa'   (3- or 6-digit hex, with or without '#'), else null
//   hexToRgb('#ff8000')       [1, 0.502, 0] channels 0..1, or null for a bad value; hexToRgb(hex, 3) rounds to 3 decimals
//   rgbToHex(1, 0.5, 0)       '#ff8000'   channels 0..1, clamped; also takes one [r, g, b] array
//   hexToRgb01(hex)           { r, g, b } 0..1 (white for a bad value): the Text Design form's shape
//   rgb01ToHex(r, g, b)       same as rgbToHex
//   cssVar('--cut-pause', '#e5604f')   a design token (css/tokens.css) for canvas drawing; the fallback when unset

function normHex(v) {
    let s = String(v || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map(c => c + c).join('');
    return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : null;
}

function hexToRgb(hex, digits) {
    const h = normHex(hex);
    if (!h) return null;
    const f = Number.isInteger(digits) ? Math.pow(10, digits) : 0;
    return [1, 3, 5].map((i) => {
        const v = parseInt(h.slice(i, i + 2), 16) / 255;
        return f ? Math.round(v * f) / f : v;
    });
}

function rgbToHex(r, g, b) {
    if (Array.isArray(r)) [r, g, b] = r;
    const ch = (x) => Math.max(0, Math.min(255, Math.round((Number(x) || 0) * 255))).toString(16).padStart(2, '0');
    return '#' + ch(r) + ch(g) + ch(b);
}

function hexToRgb01(hex) {
    const [r, g, b] = hexToRgb(hex) || [1, 1, 1];
    return { r, g, b };
}

function rgb01ToHex(r, g, b) {
    return rgbToHex(r, g, b);
}

function cssVar(name, fallback) {
    let v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { v = ''; }
    return v || (fallback === undefined ? '' : fallback);
}
