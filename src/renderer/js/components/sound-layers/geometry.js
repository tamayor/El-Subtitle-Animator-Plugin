// Sound layers (js/components/sound-layers.js), the pure part: where an extra sound sits and how long it plays, in
// frames relative to the subtitle start, and writing a dragged position back as an offset. No DOM, no panel state:
// the waveform (for the sound's full length) is passed in. Tested in test/renderer/sound-layers.test.js.
//
// A layer l: { align: 'start' | 'end' | 'after' | 'seg', seg, offset, trimIn, len, lenMode: 'clip' | 'fixed', fade }
// g: { fps, textS, textE } (the text clip, frames); segs: the preset's rows [{ n, start }].

function slNum(v, d) { const n = Number(v); return isNaN(n) ? d : n; }
function slClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Frame the sound's offset counts from: the text start, or its row's start.
function slBaseOf(l, textS, segs) {
    if (l.align !== 'seg') return textS;
    const sg = (segs || []).find(x => x.n === Number(l.seg));
    return textS + (sg ? sg.start : 0);
}

// 'clip' = follows the text clip's duration when placed (default), 'fixed' = the set length (len 0 = the rest of the
// sound). Older sounds with a set length are fixed.
function slLenModeOf(l) {
    return (l.lenMode === 'fixed' || l.lenMode === 'clip') ? l.lenMode : (slNum(l.len, 0) > 0 ? 'fixed' : 'clip');
}

// Length of a 'clip' sound: from its start to the text end ('start' anchor), else the text's own duration.
function slClipLen(l, off, textS, textE, max, base) {
    return slClamp(Math.round(l.align === 'end' || l.align === 'after' ? textE - textS : textE - ((base === undefined ? textS : base) + off)), 1, Math.max(1, max));
}

function slOffsetFor(align, start, len, textS, textE, base) {
    return align === 'end' ? start + len - textE : (align === 'after' ? start - textE : start - (base === undefined ? textS : base));
}

// The sound's geometry: wave = { seconds } (null while loading: 0.5 s is assumed), path = its file (passed through).
function slGeometry(l, g, segs, wave, path) {
    const w = wave || null;
    const full = Math.max(2, Math.round(((w && w.seconds) || 0.5) * g.fps));
    const tin = slClamp(Math.round(slNum(l.trimIn, 0)), 0, Math.max(0, full - 2));
    const cap = Math.round(slNum(l.len, 0));
    const mode = slLenModeOf(l);
    const off = Math.round(slNum(l.offset, 0));
    const base = slBaseOf(l, g.textS, segs);
    let len = full - tin;
    if (mode === 'clip') len = slClipLen(l, off, g.textS, g.textE, full - tin, base);
    else if (cap > 0) len = Math.min(len, cap);
    len = Math.max(1, len);
    const start = l.align === 'end' ? g.textE - len + off : (l.align === 'after' ? g.textE + off : base + off);
    // fade-out at its end (1 s unless changed), kept in both length modes
    const fade = slClamp((l.fade === null || l.fade === undefined) ? Math.round(g.fps) : Math.round(slNum(l.fade, 0)), 0, len);
    return { full, tin, len, fade, fps: g.fps, start, end: start + len, wave: w, path, auto: mode === 'clip', mode, textS: g.textS, textE: g.textE, base };
}

// Writes a new start / length / trim back into l as an offset from its anchor (changes l). q: the slGeometry it was
// dragged from, plus its align.
function slApply(l, start, len, tin, q, lenGiven) {
    l.trimIn = tin;
    if (lenGiven) { l.len = len; l.lenMode = 'fixed'; }
    const useLen = slLenModeOf(l) === 'clip' ? slClipLen(l, 0, q.textS, q.textE, q.full - tin, q.base) : ((slNum(l.len, 0) > 0) ? l.len : (q.full - tin));
    l.offset = slClamp(Math.round(slOffsetFor(q.align === 'end' || q.align === 'after' ? q.align : 'start', start, useLen, q.textS, q.textE, q.base)), -900, 900);
}
