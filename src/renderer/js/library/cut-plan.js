// Cut tab: the pause rules, in the panel. The analysis (src/python/auto_cut.py) sends, for every clip, where the speech is
// and what it found in each gap; from that the cuts are worked out here, so a change of Shorten over / Leave / Head /
// Tail shows on the waveform at once, without a new analysis. Keep in step with plan_keeps, subtract and snap in
// auto_cut.py (test/main/cut-plan.test.js runs both on the same clip).
//
// A clip `c`: { dur, fps, speech: [[a, b]], gapf: [[inWord, sentenceEnd, firstClick, lastClick]] } (seconds from the
// clip's start; gapf[i] is the gap between speech[i] and speech[i + 1]).
// Pure functions, no DOM: also loaded by the tests through module.exports.
/* global module */

// Kept ranges and the pause / head / tail cuts for the pause settings `p`.
function cutPlanKeeps(c, p) {
    const sp = c.speech || [], dur = c.dur;
    if (!sp.length) return { keeps: [], cuts: [{ a: 0, b: dur, kind: 'silence', dur }] };
    const keeps = [], cuts = [];
    let cur = Math.max(0, sp[0][0] - p.headLead);
    if (cur > 0.05) cuts.push({ a: 0, b: cur, kind: 'head', dur: sp[0][0] });
    for (let i = 0; i + 1 < sp.length; i++) {
        const b0 = sp[i][1], a1 = sp[i + 1][0], gap = a1 - b0;
        const f = (c.gapf && c.gapf[i]) || [0, 0, -1, -1];
        if (gap <= p.maxPause || f[0]) continue;
        const keep = f[1] ? p.sentenceKeep : p.pauseKeep;
        if (gap <= keep + 0.04) continue;
        let tEnd = b0 + keep * 0.6, tStart = a1 - keep * 0.4;
        if (f[2] >= 0) {                         // stop short of a click
            tEnd = Math.min(tEnd, Math.max(f[2] - 0.01, b0 + 0.04));
            tStart = Math.max(tStart, Math.min(f[3] + 0.02, a1 - 0.04), a1 - 0.12);
        }
        if (tStart - tEnd < 0.02) continue;
        keeps.push([cur, tEnd]);
        cuts.push({ a: tEnd, b: tStart, kind: 'pause', dur: gap, sentence: !!f[1] });
        cur = tStart;
    }
    const end = Math.min(dur, sp[sp.length - 1][1] + p.tailKeep);
    keeps.push([cur, end]);
    if (dur - end > 0.05) cuts.push({ a: end, b: dur, kind: 'tail', dur: dur - sp[sp.length - 1][1] });
    return { keeps, cuts };
}

// keeps minus the ranges [[a, b]]
function cutPlanSubtract(keeps, ranges) {
    let out = keeps;
    for (const [da, db] of ranges) {
        const nxt = [];
        for (const [s, e] of out) {
            if (db <= s || da >= e) { nxt.push([s, e]); continue; }
            if (da > s) nxt.push([s, da]);
            if (db < e) nxt.push([db, e]);
        }
        out = nxt;
    }
    return out;
}

// keeps plus the ranges [[a, b]], sorted and joined
function cutPlanUnion(keeps, ranges) {
    const all = keeps.concat(ranges).filter(r => r[1] > r[0]).map(r => [r[0], r[1]]).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const r of all) {
        if (out.length && r[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], r[1]);
        else out.push(r);
    }
    return out;
}

// Edges on the media's frame grid (frames, end exclusive); tiny pieces dropped, touching pieces joined.
function cutPlanSnap(keeps, fps, dur, minPiece) {
    const out = [];
    const min = Math.max(2, Math.round((minPiece === undefined ? 0.2 : minPiece) * fps));
    for (const [a, b] of keeps) {
        const fa = Math.ceil(Math.max(0, a) * fps - 1e-6);
        const fb = Math.floor(Math.min(dur, b) * fps + 1e-6);
        if (fb - fa < min) continue;
        if (out.length && fa - out[out.length - 1][1] <= 1) out[out.length - 1][1] = Math.max(out[out.length - 1][1], fb);
        else out.push([fa, fb]);
    }
    return out;
}

// Kept pieces with no word left in them (words of taken-out lines do not count): murmurs, breaths, off-mic talk and
// the slivers beside a taken-out line. words = [[a, b, text]]. Returns { stay, gone }. Same rule as drop_wordless in
// auto_cut.py.
function cutPlanWordless(keeps, words, drops) {
    const live = words.filter(w => /[\p{L}\p{N}]/u.test(w[2]) && !drops.some(d => d.a <= (w[0] + w[1]) / 2 && (w[0] + w[1]) / 2 <= d.b));
    const stay = [], gone = [];
    let wi = 0;
    for (const k of keeps) {
        while (wi < live.length && live[wi][1] <= k[0]) wi++;
        let has = false;
        for (let j = wi; j < live.length && live[j][0] < k[1]; j++) {
            const w = live[j];
            if (Math.min(k[1], w[1]) - Math.max(k[0], w[0]) >= Math.min(0.05, (w[1] - w[0]) / 2)) {
                has = true;
                break;
            }
        }
        (has ? stay : gone).push(k);
    }
    return { stay, gone };
}

// The whole cut of one clip: pause rules, minus the taken-out lines `drops` ([{ a, b }], clip seconds, only the active
// ones), minus the pieces without words (when Resolve's transcription is the word source), minus the user's own cuts, plus the parts the user keeps. `manual` = { keep: [[a, b]], cut: [[a, b]] }.
// Returns { frames: [[fa, fb]], keeps: [[a, b]] (the frames, in seconds), cuts (pause / head / tail), after (seconds) }.
function cutPlanClip(c, p, drops, manual) {
    const pl = cutPlanKeeps(c, p);
    let k = cutPlanSubtract(pl.keeps, (drops || []).map(d => [d.a, d.b]));
    if (p.wordless && p.textSource === 'transcription' && c.words && c.words.length) {
        const w = cutPlanWordless(k, c.words, drops || []);
        k = w.stay;
        for (const g of w.gone) pl.cuts.push({ a: g[0], b: g[1], kind: 'noword', dur: g[1] - g[0] });
    }
    if (manual && manual.cut && manual.cut.length) k = cutPlanSubtract(k, manual.cut);
    if (manual && manual.keep && manual.keep.length) k = cutPlanUnion(k, manual.keep.map(r => [Math.max(0, r[0]), Math.min(c.dur, r[1])]));
    const frames = cutPlanSnap(k, c.fps, c.dur);
    const keeps = frames.map(([a, b]) => [a / c.fps, b / c.fps]);
    return { frames, keeps, cuts: pl.cuts, after: keeps.reduce((t, [a, b]) => t + b - a, 0) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { cutPlanKeeps, cutPlanSubtract, cutPlanUnion, cutPlanSnap, cutPlanClip, cutPlanWordless };
