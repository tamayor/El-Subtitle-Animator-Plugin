// Cut tab > Measure: the results drawn over the range's waveform, the way Resolve shows silence before a ripple delete:
// pauses shaded on the sound, shots as blocks (light B-roll in yellow) with a line at every cut, beats as ticks, words
// under the waveform, black / static frames in a red lane. Every kind measured stays on the picture until the range
// changes. A click moves Resolve's playhead there (it snaps to a pause edge, cut or beat close by).
// Data: ctUI.results (js/library/cut-tools.js), all in timeline frames; the waveform comes from cuttools:wave.
// Shares the canvas helpers and the .cut-wave look with js/library/cut-wave.js.

const CTV = { H: 124, RULER: 13, SHOT0: 16, SHOT1: 28, W0: 32, W1: 92, WORDS: 106, REND: 112, MIN_S: 2 };
const CTV_COL = { pause: '#e5604f', bright: '#e8c86a', beat: '#b9a2f0', bad: '#f07b8e', frozen: '#8fb2d6' };
const ctv = { range: null, view: null, wave: null, waveKey: '', waveBusy: '', playF: null, gotoAt: 0, silDb: null };      // silDb: the Silence below slider (null = auto)

// Remove Silence settings (frames, as in Resolve), and the threshold (null = auto)
function ctvNum(id, d) { const v = Number($(id).value); return Number.isFinite(v) ? v : d; }
function ctvSet() { return { pre: ctvNum('ctPre', 2), post: ctvNum('ctPost', 4), min: Math.max(1, ctvNum('ctMinStrip', 6)) }; }
function ctvMinPause() { return ctvSet().min / ((ctv.range && ctv.range.fps) || 25); }      // seconds, for the list
const ctvDb = (v) => v / 255 * 84 - 90;                 // waveform byte -> dBFS (cuttools:wave)
const CTV_CLICK = 0.06;                                  // sound this short inside a silence (a click, a lip smack) does not end it

// The threshold (peak dBFS, like Resolve's): what the slider says, or Auto: 16 dB under the voice's peaks (their 90th
// percentile in the waveform), kept between -50 and -24 dB; before the waveform is in, the measurement's own level.
function ctvSilence(r) {
    if (ctv.silDb !== null && ctv.silDb !== undefined) return ctv.silDb;
    if (ctv.wave && Number.isFinite(ctv.wave.autoDb)) return ctv.wave.autoDb;
    const t = ((r && r.clips) || []).map(c => c.thresholdDb).filter(Number.isFinite).sort((a, b) => a - b);
    return t.length ? t[Math.floor(t.length / 2)] : -46;
}

// The pauses that would be stripped, the way Resolve's Remove Silence works: sound under the threshold is silence
// (clicks up to 60 ms inside it are bridged), Post tail frames stay after the words and Pre head frames before the next
// ones, every edge on a whole frame, and only what strips at least Minimum to strip frames counts.
// [{ start, end, frames, tc }] in timeline frames; the list, the markers and Delete marked pauses all use these.
let ctvPausesCache = null;
function ctvPauses(r) {
    if (!r) return [];
    const w = ctv.wave, fps = r.fps || (ctv.range && ctv.range.fps) || 25, S = ctvSet();
    const thrKey = (ctv.silDb === null || ctv.silDb === undefined) ? 'auto' : ctv.silDb;
    if (ctvPausesCache && ctvPausesCache.r === r && ctvPausesCache.w === w && ctvPausesCache.fps === fps
        && ctvPausesCache.thrKey === thrKey && ctvPausesCache.pre === S.pre && ctvPausesCache.post === S.post
        && ctvPausesCache.min === S.min) {
        return ctvPausesCache.out;
    }
    const runs = [];
    if (!w || w.music || w.from !== r.from || w.to !== r.to) {
        for (const p of r.pauses || []) runs.push([p.start, p.end]);          // no waveform yet: the measurement's pauses
    } else {
        const thr = ctvSilence(r), step = (w.to - w.from) / w.n, click = Math.max(1, Math.round(CTV_CLICK * fps / step));
        const quiet = new Uint8Array(w.n);
        for (let i = 0; i < w.n; i++) quiet[i] = ctvDb(w.u[i]) < thr ? 1 : 0;
        for (let i = 0; i < w.n;) {               // bridge clicks: a short loud run with silence on both sides
            if (quiet[i]) { i++; continue; }
            let j = i;
            while (j < w.n && !quiet[j]) j++;
            if (i > 0 && j < w.n && j - i <= click) quiet.fill(1, i, j);
            i = j;
        }
        for (let i = 0; i < w.n;) {
            if (!quiet[i]) { i++; continue; }
            let j = i;
            while (j < w.n && quiet[j]) j++;
            runs.push([w.from + i * step, w.from + j * step]);
            i = j;
        }
    }
    const out = [];
    for (const [a, b] of runs) {
        const s = Math.ceil(a - 1e-6) + S.post, e = Math.floor(b + 1e-6) - S.pre;
        if (e - s >= S.min) out.push({ start: s, end: e, frames: e - s, tc: ctvTc(s, fps, true) });
    }
    ctvPausesCache = { r, w, fps, thrKey, pre: S.pre, post: S.post, min: S.min, out };
    return out;
}

function ctvSliderText() {
    const S = ctvSet(), fps = (ctv.range && ctv.range.fps) || 25;
    $('ctPreV').textContent = S.pre + ' fr';
    $('ctPostV').textContent = S.post + ' fr';
    $('ctMinStripV').textContent = S.min + ' fr (' + (S.min / fps).toFixed(2) + ' s)';
    const r = ctUI.results && ctUI.results.pauses;
    const thr = ctvSilence(r);
    const auto = ctv.silDb === null || ctv.silDb === undefined;
    $('ctSilDbV').textContent = thr.toFixed(1) + ' dB' + (auto ? ' (auto)' : '');
    if (auto) $('ctSilDb').value = String(Math.round(thr * 2) / 2);
    $('ctSilAuto').classList.toggle('hidden', auto);
}
function ctvTc(f, fps, frames) {
    const n = Math.round(fps) || 25, F = Math.round(Math.max(0, f)), s = Math.floor(F / n);
    const p = (x) => String(x).padStart(2, '0');
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60) + (frames ? ':' + p(F % n) : '');
}

// The range of the picture: the measurement just run (a render check: the clips it checked).
function ctvSetRange(kind, r) {
    let from = r.from, to = r.to, fps = r.fps;
    if (kind === 'render') {
        const cs = (r.clips || []).filter(c => !c.error);
        if (!cs.length) return;
        from = Math.min(...cs.map(c => c.from)); to = Math.max(...cs.map(c => c.to));
        fps = (ctv.range && ctv.range.fps) || 25;
    }
    if (!(to > from)) return;
    const same = ctv.range && ctv.range.from === from && ctv.range.to === to;
    ctv.range = { from, to, fps };
    if (!same) { ctv.view = { a: from, d: to - from }; ctv.playF = null; ctv.wave = null; ctv.waveKey = ''; }
}

// Fetches the range's waveform (the music's for beats, else the dialogue's). fresh: after a measurement, always read it
// again: the same range of another timeline, or of this one after an edit, is another sound.
async function ctvLoadWave(kind, fresh) {
    if (!window.sa.cutToolsWave || !ctv.range) return;
    const args = Object.assign({}, ctArgs(), kind === 'render' ? { startFrame: ctv.range.from, endFrame: ctv.range.to } : {}, { music: kind === 'beats' });
    const key = JSON.stringify(args);
    if ((!fresh && key === ctv.waveKey) || key === ctv.waveBusy) return;
    if (fresh && ctv.wave && ctv.wave.music !== !!args.music) { ctv.wave = null; ctv.waveKey = ''; }
    ctv.waveBusy = key;
    let w = null;
    try { w = await window.sa.cutToolsWave(args); } catch (e) { w = null; }
    if (ctv.waveBusy !== key) return;
    ctv.waveBusy = '';
    if (!w || w.error || !w.wave) { ctv.waveKey = key; ctvDraw(); return; }       // not asked again for this range
    const s = atob(w.wave), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    const sorted = Array.from(u).filter(x => x > 0).sort((a, b) => a - b);
    const peakDb = sorted.length ? ctvDb(sorted[Math.floor(sorted.length * 0.995)]) : -6;       // the loud parts fill the height
    const p90 = sorted.length ? ctvDb(sorted[Math.floor(sorted.length * 0.9)]) : -20;
    const autoDb = Math.round(Math.max(-50, Math.min(-24, p90 - 16)) * 2) / 2;          // about -30 dB for a normal voice level
    ctv.wave = { from: w.from, to: w.to, n: w.n, u, track: w.track, music: !!args.music, peakDb, autoDb };
    ctv.waveKey = key;
    if (ctv.range && w.fps) ctv.range.fps = w.fps;
    if (ctUI.kind === 'pauses' && ctUI.result) ctShow('pauses', ctUI.result); else ctvDraw();      // pauses now come from the waveform
}

function ctvView() {
    const R = ctv.range, v = ctv.view, full = R.to - R.from;
    v.d = Math.min(full, Math.max(Math.min(CTV.MIN_S * R.fps, full), v.d));
    v.a = Math.min(Math.max(R.from, v.a), R.to - v.d);
    return v;
}

// Height of the waveform over frames [f0, f1): the loudest 10 ms, as linear amplitude (like Resolve's waveform)
// against the sound's loud parts; zoomed in past one value per pixel, the values are joined smoothly.
function ctvAmp(v) { const w = ctv.wave; return Math.min(1, Math.pow(10, (ctvDb(v) - w.peakDb) / 20)); }
function ctvLevel(f0, f1) {
    const w = ctv.wave;
    if (!w) return 0;
    const k = (f) => (f - w.from) / (w.to - w.from) * w.n - 0.5;
    const x0 = k(f0), x1 = k(f1);
    if (x1 - x0 < 1) {                                  // between two values: interpolate
        const c = (x0 + x1) / 2, i = Math.max(0, Math.min(w.n - 1, Math.floor(c))), t = Math.max(0, Math.min(1, c - i));
        const a = ctvAmp(w.u[i]), b = ctvAmp(w.u[Math.min(w.n - 1, i + 1)]);
        return a + (b - a) * t;
    }
    let i = Math.max(0, Math.floor(x0 + 0.5)), m = 0;
    const j = Math.min(w.n, Math.max(i + 1, Math.ceil(x1 + 0.5)));
    for (; i < j; i++) if (w.u[i] > m) m = w.u[i];
    return ctvAmp(m);
}

// Everything that can be pointed at, in timeline frames: { a, b, kind, tip, snap: [frames] }
function ctvItems() {
    const R = ctv.range, out = [], res = ctUI.results || {};
    const sec = (fr) => fr / R.fps;
    if (res.render) {
        for (const c of res.render.clips || []) for (const f of c.flags || []) {
            out.push({ a: c.from + f.from, b: c.from + f.from + Math.max(1, f.frames), kind: f.kind === 'frozen' ? 'frozen' : 'bad', tip: f.note, snap: [c.from + f.from] });
        }
    }
    if (res.pauses) {
        for (const p of ctvPauses(res.pauses)) {
            const s = sec(p.end - p.start);
            out.push({ a: p.start, b: p.end, kind: 'pause', long: true, secs: s, tip: 'Pause, ' + s.toFixed(2) + ' s', snap: [p.start, p.end] });
        }
    }
    if (res.beats) for (const b of res.beats.beats || []) out.push({ a: b.frame, b: b.frame, kind: 'beat', on: b.supported, tip: b.supported ? 'Beat' : 'Beat (grid only, no hit)', snap: [b.frame] });
    if (res.cuts) {
        for (const s of res.cuts.shots || []) {
            out.push({ a: s.start, b: s.end, kind: 'shot', bright: s.bright, luma: s.meanLuma,
                tip: 'Shot, ' + sec(s.end - s.start).toFixed(1) + ' s' + (s.meanLuma !== null ? ', brightness ' + s.meanLuma : '') + (s.bright ? ': light B-roll, white text will not read' : ''), snap: [s.start] });
        }
    }
    if (res.words) for (const w of res.words.words || []) out.push({ a: w.start, b: Math.max(w.end, w.start + 1), kind: 'word', w: w.w, tip: '“' + w.w + '”', snap: [] });
    return out;
}

function ctvDraw() {
    const R = ctv.range;
    if (!R || $('ctResult').classList.contains('hidden')) return;
    const M = cwCanvas('ctvMain', CTV.H);
    if (!M) return;
    const css = getComputedStyle(document.documentElement);
    const col = n => css.getPropertyValue(n).trim();
    const bg = col('--card-inner') || '#121614', dim = col('--dim') || '#8c9c90', text = col('--text') || '#eff5f0', line = col('--line') || '#28312b', matcha = col('--matcha') || '#8ccf8e';
    const g = M.g, w = M.w, v = ctvView();
    const X = f => (f - v.a) / v.d * w;
    const items = ctvItems().filter(i => i.b >= v.a && i.a <= v.a + v.d);
    const zoomed = v.d < (R.to - R.from) - 0.5;
    $('ctvOver').classList.remove('hidden');          // the whole range, always: Resolve's playhead shows there too
    $('ctvName').textContent = ctv.wave ? (ctv.wave.music ? 'Music ' : 'Sound ') + (ctv.wave.track || '') : (ctv.waveBusy ? 'Reading the sound…' : '');
    $('ctMinWrap').classList.toggle('hidden', !(ctUI.results && ctUI.results.pauses));
    if (ctUI.results && ctUI.results.pauses) ctvSliderText();
    const mid = (CTV.W0 + CTV.W1) / 2, half = (CTV.W1 - CTV.W0) / 2;
    const font = (s) => { g.font = s + ' -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif'; };
    g.textBaseline = 'top';

    // shots: a block per shot, lighter = brighter picture; light B-roll in yellow
    for (const s of items.filter(i => i.kind === 'shot')) {
        const x0 = X(s.a), x1 = X(s.b);
        g.fillStyle = s.bright ? CTV_COL.bright : text;
        g.globalAlpha = s.bright ? 0.85 : 0.08 + 0.3 * Math.min(1, (s.luma === null ? 90 : s.luma) / 255);
        g.fillRect(x0 + 0.5, CTV.SHOT0, Math.max(1, x1 - x0 - 1), CTV.SHOT1 - CTV.SHOT0);
        if (s.bright) { g.globalAlpha = 0.14; g.fillRect(x0, CTV.W0 - 2, x1 - x0, CTV.W1 - CTV.W0 + 4); }
    }
    g.globalAlpha = 1;
    // waveform: a filled shape, mirrored around the middle (like Resolve's)
    const pauses = items.filter(i => i.kind === 'pause');
    if (ctv.wave) {
        const hs = new Float32Array(w + 1);
        for (let x = 0; x <= w; x++) hs[x] = Math.max(0.6, ctvLevel(v.a + v.d * x / w, v.a + v.d * (x + 1) / w) * half);
        g.beginPath(); g.moveTo(0, mid - hs[0]);
        for (let x = 1; x <= w; x++) g.lineTo(x, mid - hs[x]);
        for (let x = w; x >= 0; x--) g.lineTo(x, mid + hs[x]);
        g.closePath(); g.fillStyle = matcha; g.globalAlpha = 0.95; g.fill(); g.globalAlpha = 1;
        g.fillStyle = 'rgba(17,34,19,0.35)'; g.fillRect(0, mid, w, 1);          // the centre line
    } else { g.fillStyle = line; g.fillRect(0, mid, w, 1); }
    // what would be stripped: dimmed over the whole lane with a dashed red outline (like Resolve's Remove Silence)
    for (const p of pauses) {
        const x0 = Math.round(X(p.a)), x1 = Math.round(X(p.b)), ww = Math.max(1, x1 - x0);
        g.fillStyle = 'rgba(12,14,13,0.62)'; g.fillRect(x0, CTV.W0 - 3, ww, CTV.W1 - CTV.W0 + 6);
        g.fillStyle = CTV_COL.pause; g.globalAlpha = 0.16; g.fillRect(x0, CTV.W0 - 3, ww, CTV.W1 - CTV.W0 + 6); g.globalAlpha = 1;
        if (ww >= 3) {
            g.save(); g.setLineDash([3, 2]); g.strokeStyle = CTV_COL.pause; g.lineWidth = 1;
            g.strokeRect(x0 + 0.5, CTV.W0 - 2.5, ww - 1, CTV.W1 - CTV.W0 + 5); g.restore();
        } else { g.fillStyle = CTV_COL.pause; g.fillRect(x0, CTV.W0 - 3, 1, CTV.W1 - CTV.W0 + 6); }
    }
    // pause lengths
    font('600 9.5px');
    let lastR = -1e9;
    for (const p of pauses) {
        if (!p.long) continue;
        const x0 = Math.max(0, X(p.a)), x1 = Math.min(w, X(p.b)), label = p.secs.toFixed(2) + ' s', tw = g.measureText(label).width;
        if (x1 - x0 < tw + 6 || x0 + 3 < lastR) continue;
        g.fillStyle = CTV_COL.pause; g.fillText(label, x0 + 3, CTV.W0);
        lastR = x0 + 3 + tw + 4;
    }
    // beats
    // beats: full lines when there is room between them, else short ticks along the top of the sound
    const beats = items.filter(i => i.kind === 'beat');
    const roomy = beats.length < 2 || (X(beats[beats.length - 1].a) - X(beats[0].a)) / (beats.length - 1) >= 14;
    for (const b of beats) {
        g.fillStyle = CTV_COL.beat; g.globalAlpha = b.on ? 0.9 : 0.35;
        if (roomy) g.fillRect(Math.round(X(b.a)), b.on ? CTV.W0 - 2 : mid - 8, 1, b.on ? CTV.W1 - CTV.W0 + 4 : 16);
        else g.fillRect(Math.round(X(b.a)), CTV.W0 - 2, 1, b.on ? 7 : 3);
    }
    g.globalAlpha = 1;
    // cuts: a line through the picture at every shot change
    if (ctUI.results && ctUI.results.cuts) {
        g.fillStyle = text;
        for (const c of ctUI.results.cuts.cuts || []) if (c.frame >= v.a && c.frame <= v.a + v.d) { g.globalAlpha = 0.75; g.fillRect(Math.round(X(c.frame)), CTV.SHOT0 - 2, 1, CTV.W1 - CTV.SHOT0 + 4); }
        g.globalAlpha = 1;
    }
    // words
    font('10px');
    let right = -1e9;
    for (const wd of items.filter(i => i.kind === 'word')) {
        const x = X(wd.a);
        if (x < right + 5) continue;
        const tw = g.measureText(wd.w).width;
        if (ctv.playF !== null && ctv.playF >= wd.a - 0.5 && ctv.playF < wd.b + 0.5) {      // the word being said
            g.globalAlpha = 1; g.fillStyle = matcha; g.fillRect(x - 2, CTV.WORDS - 11, tw + 4, 13);
            g.fillStyle = '#112213'; g.fillText(wd.w, x, CTV.WORDS - 10);
        } else { g.fillStyle = text; g.globalAlpha = 0.9; g.fillText(wd.w, x, CTV.WORDS - 10); }
        right = x + tw;
    }
    g.globalAlpha = 1;
    // render check: black / static in red, frozen in blue
    for (const r of items.filter(i => i.kind === 'bad' || i.kind === 'frozen')) {
        g.fillStyle = CTV_COL[r.kind]; g.fillRect(X(r.a), CTV.REND, Math.max(2, X(r.b) - X(r.a)), 6);
    }
    // ruler (timecode, to the second)
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3600];
    const step = (steps.find(s => s * R.fps / v.d * w >= 72) || 7200) * R.fps;
    font('9px'); g.fillStyle = dim;
    for (let f = Math.ceil(v.a / step) * step; f < v.a + v.d; f += step) {
        const x = Math.round(X(f)) + 0.5;
        g.globalAlpha = 0.35; g.fillRect(x, 0, 1, CTV.RULER - 3); g.globalAlpha = 0.9;
        g.fillText(ctvTc(f, R.fps, step < R.fps), x + 3, 0);
    }
    g.globalAlpha = 1;
    // Resolve's playhead: a red line with a head, as on the timeline
    if (ctv.playF !== null && ctv.playF >= v.a && ctv.playF <= v.a + v.d) {
        const x = Math.round(X(ctv.playF));
        g.fillStyle = '#ff4d3d';
        g.fillRect(x - 1, 0, 2, CTV.H);
        g.beginPath(); g.moveTo(x - 6, 0); g.lineTo(x + 6, 0); g.lineTo(x + 6, 6); g.lineTo(x, 12); g.lineTo(x - 6, 6); g.closePath(); g.fill();
    }

    {
        const O = cwCanvas('ctvOver', 20);
        if (O) {
            const full = R.to - R.from;
            O.g.fillStyle = matcha;
            for (let x = 0; x < O.w; x++) { const h = Math.max(0.5, ctvLevel(R.from + full * x / O.w, R.from + full * (x + 1) / O.w) * 8); O.g.fillRect(x, 10 - h, 1, h * 2); }
            O.g.fillStyle = 'rgba(255,255,255,0.12)'; O.g.strokeStyle = text; O.g.lineWidth = 1;
            const x0 = (v.a - R.from) / full * O.w, ww = Math.max(4, v.d / full * O.w);
            if (zoomed) { O.g.fillRect(x0, 0, ww, 20); O.g.strokeRect(x0 + 0.5, 0.5, ww - 1, 19); }
            if (ctv.playF !== null && ctv.playF >= R.from && ctv.playF <= R.to) { O.g.fillStyle = '#ff4d3d'; O.g.fillRect(Math.round((ctv.playF - R.from) / full * O.w) - 1, 0, 2, 20); }
        }
    }
    void bg;
}

function ctvFrameAt(e) {
    const r = $('ctvMain').getBoundingClientRect(), v = ctvView();
    return v.a + (e.clientX - r.left) / Math.max(1, r.width) * v.d;
}

// What is under frame f (the lane under the pointer first), and the frame a click goes to (snapped within 5 px).
function ctvPick(f, y) {
    const v = ctvView(), px = v.d / Math.max(1, $('ctvMain').clientWidth);
    const items = ctvItems();
    const lane = y < CTV.SHOT1 + 2 ? ['shot'] : y > CTV.REND - 3 ? ['bad', 'frozen'] : y > CTV.W1 ? ['word'] : ['pause', 'beat'];
    const hit = (i) => i.kind === 'beat' ? Math.abs(i.a - f) <= 3 * px : (f >= i.a && f < i.b && (i.kind !== 'pause' || i.long));
    const item = items.find(i => lane.includes(i.kind) && hit(i)) || items.find(i => i.kind !== 'shot' && i.kind !== 'word' && hit(i)) || items.find(hit) || null;
    let go = f, best = 5 * px;
    for (const i of items) for (const s of i.snap) if (Math.abs(s - f) < best && (i.kind !== 'pause' || i.long)) { best = Math.abs(s - f); go = s; }
    return { item, go: Math.round(go) };
}

// Moves Resolve's playhead (and the red line here) to a timeline frame; centre = bring it into view when zoomed.
async function ctvGoto(frame, centre) {
    if (!ctv.range) return;
    ctv.playF = frame; ctv.gotoAt = Date.now();
    if (typeof ctWordsFollow === 'function') { ctWords.userAt = 0; ctWordsFollow(frame); }
    if (centre) { const v = ctvView(); if (frame < v.a || frame > v.a + v.d) v.a = frame - v.d / 2; }
    ctvDraw();
    if (!window.sa.cutToolsGoto) return;
    try { const r = await window.sa.cutToolsGoto({ frame }); if (r && r.error) ctStatus(r.error, 'bad'); } catch (e) { ctStatus(String(e && e.message || e), 'bad'); }
}

function ctvZoom(f, at) {
    const R = ctv.range;
    if (!R) return;
    const v = ctvView(), t = at === undefined ? v.a + v.d / 2 : at;
    const d = Math.min(R.to - R.from, Math.max(Math.min(CTV.MIN_S * R.fps, R.to - R.from), v.d * f));
    v.a = t - (t - v.a) * (d / v.d); v.d = d;
    ctvDraw();
}

function ctvInit() {
    const cv = $('ctvMain');
    if (!cv) return;
    cv.addEventListener('pointermove', (e) => {
        if (!ctv.range) return;
        const f = ctvFrameAt(e), p = ctvPick(f, e.clientY - cv.getBoundingClientRect().top);
        const tip = (p.item ? p.item.tip + ' · ' : '') + ctvTc(p.go, ctv.range.fps) + ' · click to move the playhead here';
        if (cv.title !== tip) cv.title = tip;
    });
    cv.addEventListener('click', (e) => { if (ctv.range) ctvGoto(ctvPick(ctvFrameAt(e), e.clientY - cv.getBoundingClientRect().top).go, false); });
    cv.addEventListener('wheel', (e) => {
        if (!ctv.range) return;
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); ctvZoom(Math.exp(e.deltaY * 0.01), ctvFrameAt(e)); }
        else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            const v = ctvView();
            if (v.d >= ctv.range.to - ctv.range.from - 0.5) return;
            e.preventDefault();
            v.a += e.deltaX / Math.max(1, cv.clientWidth) * v.d;
            ctvDraw();
        }
    }, { passive: false });
    const ov = $('ctvOver');
    let drag = false;
    const go = (e) => {
        const R = ctv.range;
        if (!R) return;
        const r = ov.getBoundingClientRect(), v = ctvView();
        v.a = R.from + (e.clientX - r.left) / Math.max(1, r.width) * (R.to - R.from) - v.d / 2;
        ctvDraw();
    };
    ov.addEventListener('pointerdown', (e) => { drag = true; ov.setPointerCapture(e.pointerId); go(e); });
    ov.addEventListener('pointermove', (e) => { if (drag) go(e); });
    ov.addEventListener('pointerup', () => { drag = false; });
    ov.addEventListener('pointercancel', () => { drag = false; });
    const again = () => { ctvSliderText(); if (ctUI.kind === 'pauses' && ctUI.result) { ctShow('pauses', ctUI.result); ctMarkFollow(); } else ctvDraw(); };
    $('ctSilDb').addEventListener('input', () => { ctv.silDb = Number($('ctSilDb').value); again(); });
    $('ctSilAuto').addEventListener('click', () => { ctv.silDb = null; again(); });
    for (const id of ['ctPre', 'ctPost', 'ctMinStrip']) $(id).addEventListener('input', again);
    $('ctvIn').addEventListener('click', () => ctvZoom(1 / 1.8));
    $('ctvOut').addEventListener('click', () => ctvZoom(1.8));
    $('ctvFit').addEventListener('click', () => { if (ctv.range) { ctv.view = { a: ctv.range.from, d: ctv.range.to - ctv.range.from }; ctvDraw(); } });
    if (window.ResizeObserver) new ResizeObserver(() => ctvDraw()).observe($('ctView'));
    // Follows Resolve's playhead: every 120 ms while it moves (playback; the words need it), every 500 ms when it stands.
    let movedAt = 0;
    const tick = async () => {
        let wait = 500;
        try {
            if (!ctv.range || document.hidden || $('tabCut').classList.contains('hidden') || $('ctResult').classList.contains('hidden') || $('ctvMain').clientWidth < 40) return;
            if (Date.now() - ctv.gotoAt < 700) return;               // a click here just moved it
            let f = null;
            if (window.sa.cutToolsPlayhead) { try { const r = await window.sa.cutToolsPlayhead(); if (r && Number.isFinite(r.frame)) f = r.frame; } catch (e) { /* next tick */ } }
            else if (typeof state !== 'undefined' && state.live && Number.isFinite(state.live.frame)) f = state.live.frame;
            if (f !== null && f !== ctv.playF && Date.now() - ctv.gotoAt >= 700) {
                movedAt = Date.now();
                ctv.playF = f;
                const v = ctv.view;          // playing past the right edge of a zoomed view: the view turns the page
                if (v && v.d < ctv.range.to - ctv.range.from - 0.5 && (f > v.a + v.d || f < v.a)) v.a = f - v.d * 0.1;
                ctvDraw();
                if (typeof ctWordsFollow === 'function') ctWordsFollow(f);
            }
        } finally {
            if (Date.now() - movedAt < 1500) wait = 120;
            setTimeout(tick, wait);
        }
    };
    setTimeout(tick, 500);
}
