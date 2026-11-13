// Cut tab: the analysed clip's real waveform with the cuts drawn on it (replaces the sample diagram of step 2 once
// there is an analysis). Data: the plan's clips from src/main/auto-cut.js summary(pl, true) (wave, speech, gaps, words);
// the cuts come from js/library/cut-plan.js, so they follow the pause settings at once.
//   click a shaded part   keep it (a pause / head / tail gets a "keep" of your own; a retake / stutter line is unticked)
//   click a kept part     cut that piece; drag = cut exactly that range (Option-drag = keep that range)
//   double-click          listen to the cut around that spot (Option = the original, uncut)
//   − / Fit / +, pinch    zoom; two-finger swipe or the overview bar scrolls
// State lives on cutUI (js/library/cut-tab.js): plan, keep (unticked lines), manual { clip id: { keep, cut } }, sel.

const CW = { H: 122, OVER_H: 20, AFTER_H: 24, RULER: 13, W0: 16, W1: 84, WORDS: 98, STRIP: 108, MIN_VIEW: 2 };
const CW_COL = { pause: '#e5604f', head: '#e5604f', tail: '#e5604f', silence: '#e5604f', retake: '#f0a0c8', outtake: '#f0a0c8',
    stutter: '#e8c86a', filler: '#b9a2f0', noword: '#d9925a', manual: '#8fb2d6', mkeep: '#8ccf8e' };
const CW_NAME = { pause: 'Pause', head: 'Silence before the first word', tail: 'Silence after the last word', silence: 'No speech',
    retake: 'Retake', outtake: 'Outtake', stutter: 'Stutter', filler: 'Filler', noword: 'Sound without words', manual: 'Your cut', mkeep: 'Kept by you' };
const cwUI = { drag: null, hoverT: null, audio: null, play: null, raf: 0, ro: null };

function cwClip() { const p = cutUI.plan; return p && p.clips ? p.clips[cutUI.sel] : null; }
function cwWaveClips() { const p = cutUI.plan; return p && p.clips ? p.clips.filter(c => c.wave) : []; }
function cwManual(c) { return cutUI.manual[c.id] || (cutUI.manual[c.id] = { keep: [], cut: [] }); }
function cwActiveDrops(c) { return (cutUI.plan.drops || []).filter(d => d.src === c.id && !cutUI.keep.has(d.id)); }
function cwBytes(c) {
    if (!c._w) { const s = atob(c.wave); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); c._w = u; }
    return c._w;
}
function cwFmt(s, fine) {
    s = Math.max(0, s);
    const m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (fine ? (r < 10 ? '0' : '') + r.toFixed(1) : String(Math.floor(r)).padStart(2, '0'));
}

// ---------------------------------------------------------------- the live cut

// Works every clip's cut out again (pause settings, unticked lines, your own edits) and redraws. Cheap: no analysis.
function cutLive() {
    const p = cutUI.plan;
    if (!p) return;
    let before = 0, after = 0, pauses = 0, nowords = 0, live = false;
    for (const c of p.clips || []) {
        before += c.before;
        if (c.wave) {
            c.live = cutPlanClip(c, cutUI.prefs, cwActiveDrops(c), cutUI.manual[c.id]);
            after += c.live.after; live = true;
            pauses += c.live.cuts.filter(x => x.kind === 'pause').length;
            nowords += c.live.cuts.filter(x => x.kind === 'noword').length;
        } else after += c.after;
    }
    if (live) {
        const act = (p.drops || []).filter(d => !cutUI.keep.has(d.id));
        const n = k => act.filter(d => d.kind === k).length;
        const parts = [pauses + ' pauses shortened'];
        if (nowords) parts.push(nowords + ' sounds without words');
        for (const k of ['retake', 'outtake', 'stutter', 'filler']) if (n(k)) parts.push(n(k) + ' ' + k + 's');
        const mine = Object.values(cutUI.manual).reduce((t, m) => t + m.cut.length + m.keep.length, 0);
        if (mine) parts.push(mine + ' of your own edits');
        $('cutHeadline').textContent = cutFmt(before) + ' → ' + cutFmt(after) + ' (−' + cutFmt(before - after) + '): ' + parts.join(', ');
    }
    cutClipRows();
    $('cutWave').classList.toggle('hidden', !live);
    $('cutViz').classList.toggle('hidden', live);
    if (live) cwDraw();
}

// What Build gets: the pieces of every clip that has a waveform (frames) and its pause cuts (for the pause markers).
function cutLivePieces() {
    const out = {};
    for (const c of cwWaveClips()) {
        if (c.live) out[c.id] = { keeps: c.live.frames, cuts: c.live.cuts.filter(x => x.kind === 'pause').map(x => ({ a: x.a, dur: x.dur })) };
    }
    return Object.keys(out).length ? out : null;
}

// Everything that can be shaded on clip c: the pause rules' cuts, the taken-out lines, your own cuts and keeps.
function cwRegions(c) {
    const out = [];
    for (const x of (c.live ? c.live.cuts : [])) out.push({ a: x.a, b: x.b, kind: x.kind, dur: x.dur, sentence: x.sentence });
    for (const d of (cutUI.plan.drops || [])) if (d.src === c.id) out.push({ a: Math.max(0, d.a), b: Math.min(c.dur, d.b), kind: d.kind, id: d.id, off: cutUI.keep.has(d.id), text: d.text });
    const m = cutUI.manual[c.id];
    if (m) {
        m.cut.forEach((r, i) => out.push({ a: r[0], b: r[1], kind: 'manual', i }));
        m.keep.forEach((r, i) => out.push({ a: r[0], b: r[1], kind: 'mkeep', off: true, i }));
    }
    return out;
}

function cwRegionAt(c, t) {
    const rs = cwRegions(c).filter(r => t >= r.a && t < r.b);
    const rank = r => r.kind === 'manual' ? 0 : r.kind === 'mkeep' ? 1 : r.id ? (r.off ? 3 : 2) : 4;
    rs.sort((x, y) => rank(x) - rank(y) || (x.b - x.a) - (y.b - y.a));
    return rs[0] || null;
}
function cwKeptAt(c, t) { return c.live ? c.live.keeps.find(k => t >= k[0] && t < k[1]) : null; }

// ---------------------------------------------------------------- drawing

function cwView(c) {
    if (!c.view) c.view = { a: 0, d: c.dur };
    c.view.d = Math.min(c.dur, Math.max(Math.min(CW.MIN_VIEW, c.dur), c.view.d));
    c.view.a = Math.min(Math.max(0, c.view.a), c.dur - c.view.d);
    return c.view;
}

function cwCanvas(id, h) {
    const cv = $(id);
    const w = Math.floor(cv.clientWidth), dpr = window.devicePixelRatio || 1;
    if (w < 40) return null;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w };
}

// The loudest bucket of [t0, t1) as 0..1
function cwLevel(c, t0, t1) {
    const u = cwBytes(c), dt = c.waveDt || 0.01;
    let i = Math.max(0, Math.floor(t0 / dt)), m = 0;
    const j = Math.min(u.length, Math.max(i + 1, Math.ceil(t1 / dt)));
    for (; i < j; i++) if (u[i] > m) m = u[i];
    return m / 255;
}

// Waveform columns of the clip's [a, a + d) over the canvas width; kept parts green, removed parts in `gone`.
function cwColumns(g, c, a, d, w, mid, half, kept, gone) {
    const keeps = c.live ? c.live.keeps : [[0, c.dur]];
    let k = 0;
    for (let x = 0; x < w; x++) {
        const t0 = a + d * x / w, t1 = a + d * (x + 1) / w, tc = (t0 + t1) / 2;
        while (k < keeps.length && keeps[k][1] <= tc) k++;
        const on = k < keeps.length && keeps[k][0] <= tc;
        const h = Math.max(0.5, cwLevel(c, t0, t1) * half);
        g.fillStyle = on ? kept : gone;
        g.fillRect(x, mid - h, 1, h * 2);
    }
}

function cwDraw() {
    const c = cwClip();
    if (!c || !c.wave || !c.live || $('cutWave').classList.contains('hidden')) return;
    const css = getComputedStyle(document.documentElement);
    const col = n => css.getPropertyValue(n).trim();
    const bg = col('--card-inner') || '#121614', dim = col('--dim') || '#8c9c90', text = col('--text') || '#eff5f0',
        line = col('--line') || '#28312b', matcha = col('--matcha') || '#8ccf8e', playhead = col('--playhead') || '#ff4d3d';
    const v = cwView(c);
    const zoomed = v.d < c.dur - 0.01;

    // head
    $('cwName').textContent = c.name;
    $('cwTime').textContent = cutFmt(c.before) + ' → ' + cutFmt(c.live.after);
    const m = cutUI.manual[c.id];
    $('cwReset').classList.toggle('hidden', !(m && (m.cut.length || m.keep.length)));
    $('cwOver').classList.toggle('hidden', !zoomed);
    $('cwPlay').classList.toggle('hidden', !cwUI.play);

    // main
    const M = cwCanvas('cwMain', CW.H);
    if (!M) return;
    const g = M.g, w = M.w;
    const X = t => (t - v.a) / v.d * w;
    const mid = (CW.W0 + CW.W1) / 2, half = (CW.W1 - CW.W0) / 2;
    const regions = cwRegions(c).filter(r => r.b > v.a && r.a < v.a + v.d);
    // shading: what goes, by cause; kept parts are cleared again so only what really goes stays shaded
    for (const r of regions) {
        if (r.off) continue;
        g.globalAlpha = 0.28; g.fillStyle = CW_COL[r.kind] || dim;
        g.fillRect(X(r.a), CW.W0 - 2, Math.max(1, X(r.b) - X(r.a)), CW.WORDS - CW.W0 + 8);
    }
    g.globalAlpha = 1; g.fillStyle = bg;
    for (const k of c.live.keeps) if (k[1] > v.a && k[0] < v.a + v.d) g.fillRect(X(k[0]), CW.W0 - 2, X(k[1]) - X(k[0]), CW.WORDS - CW.W0 + 8);
    cwColumns(g, c, v.a, v.d, w, mid, half, matcha, 'rgba(140,156,144,0.5)');
    // kept on purpose (an unticked line, a part you keep): dashed outline
    g.lineWidth = 1; g.setLineDash([3, 3]);
    for (const r of regions) {
        if (!r.off) continue;
        g.strokeStyle = CW_COL[r.kind] || dim; g.globalAlpha = 0.8;
        g.strokeRect(Math.round(X(r.a)) + 0.5, CW.W0 - 1.5, Math.max(2, Math.round(X(r.b) - X(r.a)) - 1), CW.W1 - CW.W0 + 3);
    }
    g.setLineDash([]); g.globalAlpha = 1;
    // labels: the seconds each shaded part takes out
    g.font = '600 9.5px -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif'; g.textBaseline = 'top';
    let lastR = -1e9;
    for (const r of regions.slice().sort((x, y) => x.a - y.a)) {
        if (r.off || r.kind === 'mkeep') continue;
        const x0 = Math.max(0, X(r.a)), x1 = Math.min(w, X(r.b));
        const secs = (r.b - r.a);
        const label = (r.id || r.kind === 'manual' ? (r.kind === 'manual' ? 'CUT' : r.kind.toUpperCase()) + ' ' : '') + '−' + (secs < 10 ? secs.toFixed(2) : secs.toFixed(1)) + ' s';
        const tw = g.measureText(label).width;
        if (x1 - x0 < tw + 6 || x0 + 3 < lastR) continue;
        g.fillStyle = CW_COL[r.kind] || dim;
        g.fillText(label, x0 + 3, CW.W0);
        lastR = x0 + 3 + tw + 4;
    }
    // words
    g.font = '10px -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif';
    let right = -1e9, ki = 0;
    const keeps = c.live.keeps;
    for (const wd of c.words || []) {
        if (wd[1] < v.a) continue;
        if (wd[0] > v.a + v.d) break;
        const x = X(wd[0]);
        if (x < right + 5) continue;
        const tw = g.measureText(wd[2]).width;
        while (ki < keeps.length && keeps[ki][1] <= wd[0]) ki++;
        const on = ki < keeps.length && keeps[ki][0] <= (wd[0] + wd[1]) / 2;
        g.fillStyle = on ? text : dim; g.globalAlpha = on ? 0.92 : 0.6;
        g.fillText(wd[2], x, CW.WORDS - 10);
        right = x + tw;
    }
    g.globalAlpha = 1;
    // kept strip
    g.fillStyle = line; g.fillRect(0, CW.STRIP, w, 5);
    g.fillStyle = matcha;
    for (const k of keeps) if (k[1] > v.a && k[0] < v.a + v.d) g.fillRect(X(k[0]), CW.STRIP, Math.max(1, X(k[1]) - X(k[0])), 5);
    // ruler
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
    const step = steps.find(s => s / v.d * w >= 64) || 1800;
    g.fillStyle = dim; g.font = '9px -apple-system, "SF Pro Text", sans-serif';
    for (let t = Math.ceil(v.a / step) * step; t < v.a + v.d; t += step) {
        const x = Math.round(X(t)) + 0.5;
        g.globalAlpha = 0.35; g.fillRect(x, 0, 1, CW.RULER - 3); g.globalAlpha = 0.9;
        g.fillText(cwFmt(t, step < 1), x + 3, 0);
    }
    g.globalAlpha = 1;
    // a range being dragged, the playhead
    if (cwUI.drag && cwUI.drag.sel) {
        const a = Math.min(cwUI.drag.t0, cwUI.drag.t1), b = Math.max(cwUI.drag.t0, cwUI.drag.t1);
        g.fillStyle = cwUI.drag.keep ? CW_COL.mkeep : CW_COL.manual; g.globalAlpha = 0.3;
        g.fillRect(X(a), CW.W0 - 2, X(b) - X(a), CW.STRIP - CW.W0 + 7); g.globalAlpha = 1;
    }
    if (cwUI.play && cwUI.play.id === c.id && cwUI.play.t !== null) { g.fillStyle = playhead; g.fillRect(Math.round(X(cwUI.play.t)) - 1, CW.W0 - 4, 2, CW.STRIP - CW.W0 + 11); }

    // overview: the whole clip, with the part in view
    if (zoomed) {
        const O = cwCanvas('cwOver', CW.OVER_H);
        if (O) {
            cwColumns(O.g, c, 0, c.dur, O.w, CW.OVER_H / 2, CW.OVER_H / 2 - 2, matcha, 'rgba(229,96,79,0.75)');
            O.g.fillStyle = 'rgba(255,255,255,0.12)'; O.g.strokeStyle = text; O.g.lineWidth = 1;
            const x0 = v.a / c.dur * O.w, ww = Math.max(4, v.d / c.dur * O.w);
            O.g.fillRect(x0, 0, ww, CW.OVER_H); O.g.strokeRect(x0 + 0.5, 0.5, ww - 1, CW.OVER_H - 1);
        }
    }

    // after: the kept pieces back to back
    const A = cwCanvas('cwAfter', CW.AFTER_H);
    if (A) {
        const total = c.live.after || 1, aw = Math.max(8, Math.round(A.w * Math.min(1, total / c.dur)));
        let ki2 = 0, acc = 0;
        A.g.fillStyle = matcha;
        for (let x = 0; x < aw && keeps.length; x++) {
            const t0 = total * x / aw, t1 = total * (x + 1) / aw;
            while (ki2 < keeps.length - 1 && acc + (keeps[ki2][1] - keeps[ki2][0]) <= t0) { acc += keeps[ki2][1] - keeps[ki2][0]; ki2++; }
            const s0 = keeps[ki2][0] + (t0 - acc);
            const h = Math.max(0.5, cwLevel(c, s0, s0 + (t1 - t0)) * (CW.AFTER_H / 2 - 2));
            A.g.fillRect(x, CW.AFTER_H / 2 - h, 1, h * 2);
        }
        A.g.fillStyle = bg; acc = 0;                                  // a notch at every join
        for (let i = 0; i < keeps.length - 1; i++) { acc += keeps[i][1] - keeps[i][0]; A.g.fillRect(Math.round(acc / total * aw), 0, 1, CW.AFTER_H); }
    }
    $('cwAfterT').textContent = cwFmt(c.live.after, c.live.after < 60);
}

// ---------------------------------------------------------------- clicks, drags, zoom

function cwTimeAt(c, e) {
    const r = $('cwMain').getBoundingClientRect(), v = cwView(c);
    return Math.min(c.dur, Math.max(0, v.a + (e.clientX - r.left) / Math.max(1, r.width) * v.d));
}

function cwTip(c, t) {
    const r = cwRegionAt(c, t);
    const secs = x => (x.b - x.a).toFixed(2) + ' s';
    if (!r) return cwKeptAt(c, t) ? 'Kept. Click to cut this piece, drag to cut a range. Double-click to listen.' : 'Double-click to listen.';
    if (r.kind === 'manual') return 'Your cut (' + secs(r) + '). Click to put it back.';
    if (r.kind === 'mkeep') return 'Kept by you (' + secs(r) + '). Click to let the cut take it again.';
    if (r.id) return CW_NAME[r.kind] + (r.off ? ', kept' : ', taken out') + ' (' + secs(r) + '): “' + r.text + '”. Click to ' + (r.off ? 'take it out' : 'keep it') + '.';
    if (r.kind === 'pause') return 'Pause of ' + r.dur.toFixed(2) + ' s' + (r.sentence ? ' after a sentence' : '') + ': ' + secs(r) + ' removed. Click to keep the whole pause.';
    if (r.kind === 'noword') return 'Sound without words (' + secs(r) + '): the transcription heard no words here (murmur, breath, off-mic talk, or what is left beside a taken-out line). Click to keep it.';
    return CW_NAME[r.kind] + ': ' + secs(r) + ' removed. Click to keep it.';
}

function cwClick(c, t) {
    const m = cwManual(c);
    const r = cwRegionAt(c, t);
    if (r && r.kind === 'manual') m.cut.splice(r.i, 1);
    else if (r && r.kind === 'mkeep') m.keep.splice(r.i, 1);
    else if (r && r.id) { if (r.off) cutUI.keep.delete(r.id); else cutUI.keep.add(r.id); cutDropRows(); }
    else if (r && !cwKeptAt(c, t)) m.keep.push([r.a, r.b]);
    else {
        const k = cwKeptAt(c, t);
        if (!k) return;
        m.cut.push([k[0], k[1]]);
    }
    cwStop();
    cutLive();
}

function cwZoom(c, f, at) {
    const v = cwView(c);
    const t = at === undefined ? v.a + v.d / 2 : at;
    const d = Math.min(c.dur, Math.max(Math.min(CW.MIN_VIEW, c.dur), v.d * f));
    v.a = t - (t - v.a) * (d / v.d); v.d = d;
    cwDraw();
}

// Shows the clip with id `id` (and, with `t`, that moment in the middle of the view).
function cutWaveGoto(id, t) {
    const i = (cutUI.plan.clips || []).findIndex(c => c.id === id && c.wave);
    if (i < 0) return;
    cutUI.sel = i;
    const c = cwClip(), v = cwView(c);
    if (t !== undefined) {
        if (v.d >= c.dur - 0.01 && c.dur > 40) v.d = 30;
        v.a = t - v.d / 2;
    }
    cwStop();
    cutClipRows();
    cwDraw();
    $('cutWave').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function cutWaveInit() {
    const cv = $('cwMain');
    if (!cv) return;
    cv.addEventListener('pointerdown', (e) => {
        const c = cwClip();
        if (!c || e.button !== 0) return;
        cv.setPointerCapture(e.pointerId);
        cwUI.drag = { x: e.clientX, t0: cwTimeAt(c, e), t1: cwTimeAt(c, e), sel: false, keep: e.altKey };
    });
    cv.addEventListener('pointermove', (e) => {
        const c = cwClip();
        if (!c) return;
        const t = cwTimeAt(c, e);
        if (cwUI.drag) {
            if (Math.abs(e.clientX - cwUI.drag.x) > 4) cwUI.drag.sel = true;
            cwUI.drag.t1 = t; cwUI.drag.keep = e.altKey;
            if (cwUI.drag.sel) cwDraw();
            return;
        }
        const tip = cwTip(c, t);
        if (cv.title !== tip) cv.title = tip;
    });
    const up = (e) => {
        const c = cwClip(), d = cwUI.drag;
        cwUI.drag = null;
        if (!c || !d) return;
        if (e.type === 'pointercancel') { cwDraw(); return; }
        if (!d.sel) { cwClick(c, d.t0); return; }
        const a = Math.min(d.t0, d.t1), b = Math.max(d.t0, d.t1);
        if (b - a >= 0.04) { const m = cwManual(c); (d.keep ? m.keep : m.cut).push([a, b]); }
        cwStop();
        cutLive();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', (e) => { const c = cwClip(); if (c) cwListen(c, cwTimeAt(c, e), e.altKey); });
    cv.addEventListener('wheel', (e) => {
        const c = cwClip();
        if (!c) return;
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); cwZoom(c, Math.exp(e.deltaY * 0.01), cwTimeAt(c, e)); }
        else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            const v = cwView(c);
            if (v.d >= c.dur - 0.01) return;
            e.preventDefault();
            v.a += e.deltaX / Math.max(1, cv.clientWidth) * v.d;
            cwDraw();
        }
    }, { passive: false });

    const ov = $('cwOver');
    let ovDrag = false;
    const ovGo = (e) => {
        const c = cwClip();
        if (!c) return;
        const r = ov.getBoundingClientRect(), v = cwView(c);
        v.a = (e.clientX - r.left) / Math.max(1, r.width) * c.dur - v.d / 2;
        cwDraw();
    };
    ov.addEventListener('pointerdown', (e) => { ovDrag = true; ov.setPointerCapture(e.pointerId); ovGo(e); });
    ov.addEventListener('pointermove', (e) => { if (ovDrag) ovGo(e); });
    ov.addEventListener('pointerup', () => { ovDrag = false; });
    ov.addEventListener('pointercancel', () => { ovDrag = false; });

    $('cwIn').addEventListener('click', () => { const c = cwClip(); if (c) cwZoom(c, 1 / 1.8); });
    $('cwOut').addEventListener('click', () => { const c = cwClip(); if (c) cwZoom(c, 1.8); });
    $('cwFit').addEventListener('click', () => { const c = cwClip(); if (c) { c.view = { a: 0, d: c.dur }; cwDraw(); } });
    $('cwReset').addEventListener('click', () => { const c = cwClip(); if (c) { delete cutUI.manual[c.id]; cwStop(); cutLive(); } });
    $('cwPlay').addEventListener('click', cwStop);
    $('cwPick').addEventListener('change', () => cutWaveGoto($('cwPick').value));
    if (window.ResizeObserver) { cwUI.ro = new ResizeObserver(() => cwDraw()); cwUI.ro.observe($('cutWave')); }
}

// ---------------------------------------------------------------- listen

// The kept sound around t, as the cut will play it: up to 2.5 s before and after, joins included.
function cwListenRanges(c, t) {
    const keeps = c.live.keeps, before = [], after = [];
    let rem = 2.5;
    for (let i = keeps.length - 1; i >= 0 && rem > 0.01; i--) {
        const k = keeps[i];
        if (k[0] >= t) continue;
        const b = Math.min(k[1], t), a = Math.max(k[0], b - rem);
        before.unshift([a, b]); rem -= b - a;
    }
    rem = 2.5;
    for (let i = 0; i < keeps.length && rem > 0.01; i++) {
        const k = keeps[i];
        if (k[1] <= t) continue;
        const a = Math.max(k[0], t), b = Math.min(k[1], a + rem);
        after.push([a, b]); rem -= b - a;
    }
    const out = [];
    for (const r of before.concat(after)) {
        if (out.length && Math.abs(out[out.length - 1][1] - r[0]) < 1e-6) out[out.length - 1][1] = r[1];
        else out.push([r[0], r[1]]);
    }
    return out;
}

function cwStop() {
    const p = cwUI.play;
    cwUI.play = null;
    cancelAnimationFrame(cwUI.raf);
    if (p && p.node) { try { p.node.onended = null; p.node.stop(); } catch (e) { /* already ended */ } }
    if ($('cwPlay')) $('cwPlay').classList.add('hidden');
    if (p) cwDraw();
}

async function cwListen(c, t, original) {
    cwStop();
    if (!window.sa.cutListen) return;
    const ranges = original ? [[Math.max(0, t - 2.5), Math.min(c.dur, t + 2.5)]] : cwListenRanges(c, t);
    if (!ranges.length) return;
    const mine = cwUI.play = { id: c.id, t: null, node: null };
    $('cwPlay').classList.remove('hidden');
    let r;
    try { r = await window.sa.cutListen({ id: c.id, ranges }); } catch (e) { r = { error: String(e && e.message || e) }; }
    if (cwUI.play !== mine) return;                         // stopped or replaced while it loaded
    if (!r || r.error || !r.pcm) { cwStop(); cutStatus((r && r.error) || 'Could not play that', 'bad'); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!cwUI.audio) cwUI.audio = new AC();
    const ctx = cwUI.audio;
    try { await ctx.resume(); } catch (e) { /* plays when it can */ }
    const bytes = r.pcm instanceof Uint8Array ? r.pcm : new Uint8Array(r.pcm);
    const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.byteLength & ~1)));
    const buf = ctx.createBuffer(1, Math.max(1, pcm.length), r.sr);
    const ch = buf.getChannelData(0);
    const fade = Math.round(r.sr * 0.004);
    const segs = [];
    let off = 0;
    r.lens.forEach((n, i) => {
        for (let k = 0; k < n; k++) {
            const edge = Math.min(k, n - 1 - k);
            ch[off + k] = pcm[off + k] / 32768 * (edge < fade ? edge / fade : 1);
        }
        segs.push({ a: ranges[i][0], off: off / r.sr, len: n / r.sr });
        off += n;
    });
    const node = ctx.createBufferSource();
    node.buffer = buf; node.connect(ctx.destination);
    mine.node = node;
    const t0 = ctx.currentTime + 0.03;
    node.onended = () => { if (cwUI.play === mine) cwStop(); };
    node.start(t0);
    const tick = () => {
        if (cwUI.play !== mine) return;
        const now = ctx.currentTime - t0;
        const s = segs.filter(x => now >= x.off).pop();
        mine.t = s ? s.a + Math.min(s.len, now - s.off) : null;
        cwDraw();
        cwUI.raf = requestAnimationFrame(tick);
    };
    tick();
}
