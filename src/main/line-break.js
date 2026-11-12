// Phrase-aware line breaks for multi-line captions (rules after kajisho5/ffmpeg-skill's caption wrapper, MIT):
// - a break after punctuation is the good break;
// - an article, preposition, possessive or joiner belongs to the phrase that FOLLOWS it, so it opens the next line
//   and is never left hanging at the end of one;
// - a number stays with its unit or money word ("$13K per month", "5 years"), and "about $5K" stays together;
// - lines come out balanced, and a last line of one short word (a widow) is avoided.
// Pure functions (no Resolve, no files), shared by the MCP script (chop_srt, break_lines) and the panel.

module.exports = { breakLines, breakCost, wordsOf, bareWord };

// Words a line should not end on: they introduce what follows.
const NO_END = new Set(('a an the of to in on at by for from with about into onto over under per than as and or but so ' +
    'nor my your our their his her its this these those that which who whose if because when while where until via ' +
    "i'm i'll i'd we're you're they're it's there's is are was were be").split(' '));
// Words that finish a number before them ("$13K per month", "5 years", "20 percent").
const UNIT_AFTER = /^(per|a|an|each|every|k|m|b|bn|thousand|million|billion|grand|percent|%|dollars?|bucks|usd|eur|pounds?|months?|years?|weeks?|days?|hours?|minutes?|seconds?|x|times)$/i;
const NUMBER_BEFORE = /^(about|over|under|around|nearly|almost|only|just|up|than|\$)$/i;

function wordsOf(s) { return String(s || '').split(/\s+/).filter(Boolean); }
function bareWord(w) { return String(w).toLowerCase().replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%']+$/gu, ''); }

// The cost of a break between words prev and next (negative = a good place to break).
function breakCost(prev, next) {
    let c = 0;
    if (/[,.;:!?…—–]$/.test(prev)) c -= /[.!?…]$/.test(prev) ? 6 : 4;
    if (NO_END.has(bareWord(prev))) c += 14;
    if (/[\d$]/.test(prev) && UNIT_AFTER.test(bareWord(next))) c += 20;
    if (/[\d$]/.test(next) && NUMBER_BEFORE.test(bareWord(prev))) c += 10;
    if (/^[-–—]$/.test(next)) c += 4;
    return c;
}

// Breaks text into lines. opts: { lines: exact count, or maxLines (default 2) with maxChars (a soft width: lines
// past it cost more) }. Text that already holds "\n" is returned as it is. Returns { text, lines, cost }.
function breakLines(text, opts) {
    const o = opts || {};
    const raw = String(text || '').trim();
    if (raw.includes('\n')) return { text: raw, lines: raw.split('\n'), cost: 0, kept: true };
    const ws = wordsOf(raw);
    if (ws.length < 2) return { text: raw, lines: [raw], cost: 0 };
    const full = ws.join(' ').length;
    const maxChars = o.maxChars > 0 ? o.maxChars : null;
    let counts;
    if (o.lines > 0) counts = [Math.min(o.lines, ws.length)];
    else {
        const maxLines = Math.min(ws.length, o.maxLines > 0 ? o.maxLines : 2);
        const need = maxChars ? Math.min(maxLines, Math.max(1, Math.ceil(full / maxChars))) : maxLines;
        counts = [];
        for (let n = need; n <= maxLines; n++) counts.push(n);
    }
    let best = null;
    for (const n of counts) {
        const r = bestSplit(ws, n, maxChars);
        if (r && (!best || r.cost < best.cost)) best = r;
        if (best && maxChars && best.lines.every(l => l.length <= maxChars)) break;     // fewest lines that fit
    }
    return { text: best.lines.join('\n'), lines: best.lines, cost: Math.round(best.cost * 10) / 10 };
}

// The best split of words into exactly n lines (dynamic programming over break positions).
function bestSplit(ws, n, maxChars) {
    if (n <= 1) return { lines: [ws.join(' ')], cost: 0 };
    const len = (i, j) => ws.slice(i, j).join(' ').length;
    const target = ws.join(' ').length / n;
    const lineCost = (i, j, last) => {
        const l = len(i, j);
        let c = Math.pow((l - target) / Math.max(4, target), 2) * 10;
        if (maxChars && l > maxChars) c += 12 + (l - maxChars) * 2;
        if (last && j - i === 1 && l <= 4) c += 12;       // a widow: one short word alone on the last line
        if (!last && j - i === 1 && NO_END.has(bareWord(ws[i]))) c += 8;
        return c;
    };
    const W = ws.length;
    // dp[k][j]: best cost of the first j words in k lines
    const dp = [], from = [];
    for (let k = 0; k <= n; k++) { dp.push(new Array(W + 1).fill(Infinity)); from.push(new Array(W + 1).fill(-1)); }
    dp[0][0] = 0;
    for (let k = 1; k <= n; k++) {
        for (let j = k; j <= W - (n - k); j++) {
            for (let i = k - 1; i < j; i++) {
                if (!Number.isFinite(dp[k - 1][i])) continue;
                const c = dp[k - 1][i] + lineCost(i, j, k === n) + (i > 0 ? breakCost(ws[i - 1], ws[i]) : 0);
                if (c < dp[k][j]) { dp[k][j] = c; from[k][j] = i; }
            }
        }
    }
    if (!Number.isFinite(dp[n][W])) return null;
    const lines = [];
    for (let k = n, j = W; k > 0; k--) { const i = from[k][j]; lines.unshift(ws.slice(i, j).join(' ')); j = i; }
    return { lines, cost: dp[n][W] };
}
