// "Fit to words" (the Use tab's Animation timing card): times a placed clip's text reveal to the spoken words.
// Pure planning here; anim-timing.js fitClipToWords reads the clip and the word timings and applies the plan.
//
//   anim, letter-by-letter (one Follower: natural = A + Delay x (letters - 1); letter c starts at Delay x c of the
//         text's own time): one key per word on the clip's AnimTime remap, clip frame the word is said -> text time
//         its first letter starts. Linear between the keys, so each word's letters come in at the speed it is said
//         (a quick word fast, a slow one slow); the last word's letters spread over its spoken length, then the text
//         plays at normal speed (fusion_bridge.op_word_fit_set).
//   anim, rows / words that pop one after another (Kinetic Cloud / Lines rows, Justified Pop words; unit k pops at
//         (k - 1) x Step of its own time): one key per unit, the clip frame its first word is said -> its own time.
//         The bridge re-keys the rows through the curve (fusion_bridge.remap_tt).
//   anim, other (whole-text animations): the range starts on the first word and ends on the last one.
//   typing (Word by Word Typing): the share of the text shown steps up on each spoken word (nothing before the first).
//   segments (MultiText rows, e.g. "Highlight Select"): each row from the start of its first word to the end of its
//         last word.
//
// Words: [{ w, start, end }] in frames from the clip's start (fractions allowed).

module.exports = { textWords, alignWords, planAnimKeys, planStepKeys, planTypingKeys, planLinear, planRows, speedRange };

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

// The text's words with the index of their first character, counted like the preset's AnimNatural expression does
// (line breaks are not characters of the stagger, spaces are; one character per code point).
function textWords(text) {
    const out = [];
    let i = 0, prevSpace = true, cur = null;
    for (const ch of Array.from(String(text || ''))) {
        if (ch === '\r' || ch === '\n') { prevSpace = true; cur = null; continue; }
        const sp = /\s/.test(ch);
        if (!sp && prevSpace) { cur = { w: '', at: i }; out.push(cur); }
        if (!sp && cur) cur.w += ch;
        if (sp) cur = null;
        prevSpace = sp;
        i++;
    }
    return { words: out, letters: i };
}

// Gives each text word a spoken time { start, end, matched }. Words are matched in order by their letters (a word
// may be up to 3 spoken words ahead: fillers, a word the subtitle left out); the rest are spread between the matched
// ones. With nothing matched the text words are spread over the spoken ones in order.
function alignWords(tWords, spoken) {
    const sp = (spoken || []).filter(x => Number.isFinite(x.start)).slice().sort((a, b) => a.start - b.start);
    const n = tWords.length;
    if (!n || !sp.length) return null;
    const at = new Array(n).fill(-1);
    let p = 0;
    for (let j = 0; j < n; j++) {
        const t = norm(tWords[j].w || tWords[j]);
        if (!t) continue;
        for (let q = p; q < Math.min(sp.length, p + 4); q++) {
            const s = norm(sp[q].w);
            if (s && (s === t || (t.length > 3 && (s.startsWith(t) || t.startsWith(s))))) { at[j] = q; p = q + 1; break; }
        }
    }
    const matched = at.filter(q => q >= 0).length;
    // text word j -> a (fractional) spoken index
    const pos = new Array(n);
    if (!matched) for (let j = 0; j < n; j++) pos[j] = n === 1 ? 0 : j * (sp.length - 1) / (n - 1);
    else {
        for (let j = 0; j < n; j++) {
            if (at[j] >= 0) { pos[j] = at[j]; continue; }
            let a = j - 1; while (a >= 0 && at[a] < 0) a--;
            let b = j + 1; while (b < n && at[b] < 0) b++;
            const pa = a >= 0 ? at[a] : -1, pb = b < n ? at[b] : sp.length;
            const ja = a >= 0 ? a : -1, jb = b < n ? b : n;
            pos[j] = Math.max(0, Math.min(sp.length - 1, pa + (pb - pa) * (j - ja) / (jb - ja)));
        }
    }
    const timeAt = (x) => {
        const k = Math.floor(x), f = x - k;
        if (k >= sp.length - 1) return sp[sp.length - 1].start;
        return sp[k].start + (sp[k + 1].start - sp[k].start) * f;
    };
    return {
        matched,
        times: pos.map((x, j) => {
            const whole = Number.isInteger(x) && at[j] >= 0;
            const start = timeAt(x);
            const nextStart = j + 1 < n ? timeAt(pos[j + 1]) : null;
            const end = whole ? sp[x].end : (nextStart !== null ? nextStart : sp[Math.min(sp.length - 1, Math.ceil(x))].end);
            return { start, end: Math.max(start, end), matched: at[j] >= 0 };
        })
    };
}

const clampTo = (v, len) => Math.max(0, Math.min(len, v));
const r2 = (v) => Math.round(v * 100) / 100;

// Letter-by-letter presets -> { keys: [[clip frame, text frame], ...], start, end, matched, words } or null.
// term: { a (one letter's animation), delay, text }. length: the clip's frames.
function planAnimKeys(term, spoken, length, opts) {
    const o = opts || {};
    const { words: tw, letters } = textWords(term && term.text);
    const D = Number(term && term.delay) || 0;
    if (!tw.length || letters < 2 || !(D > 0)) return null;
    const al = alignWords(tw, spoken);
    if (!al) return null;
    const lead = Number(o.lead) || 0;          // frames the reveal starts before the word (0 = on the word)
    const minStep = 0.25;                       // clip frames between two keys at the least
    const keys = [];
    for (let j = 0; j < tw.length; j++) {
        let f = clampTo(al.times[j].start - lead, length);
        const v = D * tw[j].at;
        if (keys.length) {
            const last = keys[keys.length - 1];
            if (v <= last[1]) continue;
            if (f < last[0] + minStep) f = last[0] + minStep;
        }
        keys.push([f, v]);
    }
    // the last word's letters over its spoken length, then normal speed
    const lastT = al.times[tw.length - 1];
    const lastV = D * (letters - 1);
    const prev = keys[keys.length - 1];
    if (lastV > prev[1]) {
        const say = Math.max(1, lastT.end - lastT.start);
        keys.push([Math.min(length, Math.max(prev[0] + minStep, prev[0] + say)), lastV]);
    }
    const tail = keys[keys.length - 1];
    if (tail[0] < length) keys.push([length, tail[1] + (length - tail[0])]);
    if (keys.length < 2) return null;
    const out = keys.map(k => [r2(k[0]), r2(k[1])]);
    const natural = (Number(term.a) || 0) + lastV;
    const endAt = Math.round(Math.min(length, tail[0] + (Number(term.a) || 0)));
    return { keys: out, start: Math.round(out[0][0]), end: Math.max(Math.round(out[0][0]) + 1, endAt), natural,
        matched: al.matched, words: tw.length };
}

// One range on the first .. last spoken word (typing: the end is where the last word APPEARS).
function planLinear(kind, spoken, length) {
    const sp = (spoken || []).slice().sort((a, b) => a.start - b.start);
    if (!sp.length) return null;
    const start = Math.round(clampTo(sp[0].start, length - 1));
    const last = sp[sp.length - 1];
    const endF = kind === 'typing' ? last.start : last.end;
    return { start, end: Math.max(start + 1, Math.round(clampTo(endF, length))) };
}

// MultiText rows: rows [{ key, text }] in reading order -> [{ key, start, end }]
function planRows(rows, spoken, length) {
    const all = [], owner = [];
    rows.forEach((r, k) => { for (const w of textWords(r.text).words) { all.push(w); owner.push(k); } });
    const al = alignWords(all, spoken);
    if (!al) return null;
    const out = [];
    rows.forEach((r, k) => {
        const idx = owner.map((o, j) => o === k ? j : -1).filter(j => j >= 0);
        if (!idx.length) return;
        const start = Math.round(clampTo(al.times[idx[0]].start, length - 1));
        const end = Math.round(clampTo(al.times[idx[idx.length - 1]].end, length));
        out.push({ key: r.key, start, end: Math.max(start + 1, end) });
    });
    return { ranges: out, matched: al.matched, words: all.length };
}

// The speed the fitted keys play the text at, slowest .. fastest (1 = the preset's own speed)
function speedRange(keys) {
    let lo = Infinity, hi = 0;
    for (let i = 1; i < keys.length - 1; i++) {
        const df = keys[i][0] - keys[i - 1][0];
        if (df <= 0) continue;
        const s = (keys[i][1] - keys[i - 1][1]) / df;
        lo = Math.min(lo, s); hi = Math.max(hi, s);
    }
    return Number.isFinite(lo) ? { slowest: r2(lo), fastest: r2(hi) } : null;
}

// Units that pop one after another: units [{ text, own }] -> { keys, start, end, matched, words } or null.
// tail: own frames one unit's pop lasts (so the end head sits where the last one has landed).
function planStepKeys(units, spoken, length, tail) {
    const all = [], owner = [];
    units.forEach((u, k) => { for (const w of textWords(u.text).words) { all.push(w); owner.push(k); } });
    const al = alignWords(all, spoken);
    if (!al) return null;
    const keys = [];
    units.forEach((u, k) => {
        const j = owner.indexOf(k);
        if (j < 0) return;
        let f = clampTo(al.times[j].start, length);
        const v = Number(u.own) || 0;
        if (keys.length) {
            const last = keys[keys.length - 1];
            if (v <= last[1]) return;
            if (f < last[0] + 0.25) f = last[0] + 0.25;
        }
        keys.push([f, v]);
    });
    if (!keys.length) return null;
    const lastK = keys[keys.length - 1];
    if (lastK[0] < length) keys.push([length, lastK[1] + (length - lastK[0])]);
    if (keys.length < 2) return null;
    const out = keys.map(k => [r2(k[0]), r2(k[1])]);
    const start = Math.round(out[0][0]);
    return { keys: out, start, end: Math.max(start + 1, Math.round(Math.min(length, lastK[0] + (Number(tail) || 0)))),
        matched: al.matched, words: all.length, units: units.length };
}

// Word by Word Typing: the End input (share of the text shown) as steps on the spoken words. The same counting as
// the preset's End expression: characters are code points (line breaks included), words are runs of non-space.
// -> { keys: [[clip frame, End]], frames (each word's frame), start, end, matched, words } or null
function planTypingKeys(text, spoken, length) {
    const chars = Array.from(String(text || ''));
    const ends = [];
    let inword = false;
    chars.forEach((ch, i) => {
        if (/\s/.test(ch)) { inword = false; return; }
        if (!inword) ends.push(i + 1); else ends[ends.length - 1] = i + 1;
        inword = true;
    });
    const n = ends.length;
    if (n < 1 || !chars.length) return null;
    const al = alignWords(textWords(text).words, spoken);
    if (!al || al.times.length !== n) return null;
    const val = (k) => (k >= n - 1 ? 1 : ends[k] / chars.length);
    const frames = [];
    for (let k = 0; k < n; k++) {
        let f = clampTo(al.times[k].start, length - 1);
        if (frames.length && f < frames[frames.length - 1] + 1) f = frames[frames.length - 1] + 1;
        frames.push(Math.min(length, f));
    }
    const keys = [];
    if (frames[0] > 0.5) keys.push([0, 0], [frames[0] - 0.05, 0]);
    keys.push([frames[0], val(0)]);
    for (let k = 1; k < n; k++) keys.push([frames[k] - 0.05, val(k - 1)], [frames[k], val(k)]);
    if (keys[keys.length - 1][0] < length) keys.push([length, 1]);
    return { keys: keys.map(k => [r2(k[0]), Math.round(k[1] * 10000) / 10000]), frames: frames.map(Math.round),
        start: Math.round(frames[0]), end: Math.max(Math.round(frames[0]) + 1, Math.round(frames[n - 1])), matched: al.matched, words: n };
}
