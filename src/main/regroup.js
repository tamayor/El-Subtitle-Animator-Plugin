// Regrouping consecutive subtitles into phrases by thought.
// Resolve's subtitle cuts often fall mid-thought ("If this is the bar then it's" / "fine, but the bar is this.").
// Given the subtitles and the phrases they should read as ("If this is the bar then" / "it's fine, but the bar is
// this."), this times every phrase from its words: each word gets a share of its own subtitle's duration in
// proportion to its length, so a phrase starts at its first word and ends at its last one.
// Pure functions (no Resolve calls), so they can be tested on their own.

module.exports = { regroup, wordKey };

// A word as compared between subtitles and phrases: lower case, letters and digits only.
function wordKey(w) { return String(w).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }

function splitWords(text) { return String(text || '').split(/\s+/).filter(Boolean); }

// subs: [{ index, text, start, end }] in timeline order (consecutive). phrases: [string].
// Returns [{ text, subtitle, subtitles, startFrame, endFrame, frames }] or throws when the phrases don't spell the subtitles.
function regroup(subs, phrases) {
    if (!Array.isArray(subs) || !subs.length) throw new Error('Give the subtitles to regroup');
    if (!Array.isArray(phrases) || !phrases.length) throw new Error('Give the phrases the subtitles should read as');

    // every word of the subtitles, timed inside its own subtitle
    const timed = [];
    for (const s of subs) {
        const words = splitWords(s.text);
        const weights = words.map(w => wordKey(w).length + 1);
        const total = weights.reduce((a, b) => a + b, 0) || 1;
        let acc = 0;
        words.forEach((w, i) => {
            const a = s.start + (s.end - s.start) * acc / total;
            acc += weights[i];
            const b = s.start + (s.end - s.start) * acc / total;
            timed.push({ word: w, key: wordKey(w), subtitle: s.index, start: a, end: b });
        });
    }
    const real = timed.filter(t => t.key);      // stray punctuation ("-", "…") carries no word

    const out = [];
    let k = 0;
    phrases.forEach((p, pi) => {
        const keys = splitWords(p).map(wordKey).filter(Boolean);
        if (!keys.length) throw new Error('Phrase ' + (pi + 1) + ' is empty');
        const got = real.slice(k, k + keys.length);
        const bad = keys.findIndex((w, i) => !got[i] || got[i].key !== w);
        if (bad >= 0) {
            const want = got[bad] ? '"' + got[bad].word + '" (subtitle ' + got[bad].subtitle + ')' : 'the end of the subtitles';
            throw new Error('Phrase ' + (pi + 1) + ' ("' + p + '") does not follow the subtitles: word ' + (bad + 1) + ' is "' + splitWords(p).filter(w => wordKey(w))[bad] + '" but the subtitles have ' + want + '. The phrases must spell the subtitles\' words in order, none left out.');
        }
        const first = got[0], last = got[got.length - 1];
        const span = [...new Set(got.map(g => g.subtitle))];
        out.push({ text: String(p).trim(), subtitle: first.subtitle, subtitles: span, startFrame: first.start, endFrame: last.end });
        k += keys.length;
    });
    if (k < real.length) {
        throw new Error('The phrases leave out the subtitles\' last words: "' + real.slice(k).map(t => t.word).join(' ') + '"');
    }

    // whole frames, back to back: each phrase ends where the next begins (unless a gap between subtitles lies there)
    out.forEach((p, i) => {
        p.startFrame = Math.round(p.startFrame);
        p.endFrame = Math.round(p.endFrame);
        if (i > 0 && out[i - 1].endFrame > p.startFrame) out[i - 1].endFrame = p.startFrame;
    });
    out.forEach(p => { p.frames = p.endFrame - p.startFrame; });
    return out;
}
