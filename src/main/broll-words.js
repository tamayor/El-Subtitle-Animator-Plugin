// B-roll "Sync to words" (broll.js), the pure part: matching an effect's key word or number in the transcription and
// timing each shown item on its spoken words. No Resolve, no files. Tested in test/main/broll-words.test.js.

function mergeSplitNumbers(words) {
    const out = [];
    for (const w of words) {
        const p = out[out.length - 1], t = String(w.w || '');
        const joins = p && (/^[,.]\d/.test(t) || (/^[$€£¥]$/.test(String(p.w)) && /^\d/.test(t)) || (/\d[,.]$/.test(String(p.w)) && /^\d/.test(t)));
        if (joins) { p.w = String(p.w) + t; p.end = w.end; } else out.push({ ...w });
    }
    return out;
}

const normWord = (w) => String(w || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

const firstWordOf = (t) => String(t || '').trim().split(/\s+/)[0] || '';

const lastWordOf = (t) => String(t || '').trim().split(/\s+/).pop() || '';

// The word each effect shows off; null = the subtitle's last word.
const KEY_WORD = {
    'comment-drop': p => p.keyword,
    'money-counter': p => String(Math.round(Math.abs(Number(p.value) || 0))),
    'post-wall': p => String(Math.round(Number(p.count) || 0)),
    'day-dial': p => p.word,
    'predict-keys': p => lastWordOf(p.text),
    'sketch-words': p => p.word,
    'voice-note': p => firstWordOf(p.caption),
    'tag-stack': p => firstWordOf((p.tags || []).slice(-1)[0]),
    'chapter-list': p => firstWordOf((p.items || [])[Math.max(0, (Number(p.active) || 1) - 1)]),
    'live-cursor': () => null,
    'receipt-printer': () => null,
    'versus-split': p => firstWordOf(p.right),
    'stat-bar': p => String(Math.round(Number(p.percent) || 0)),
    'marker-highlight': p => p.focusWord,
    'quote-card': p => firstWordOf(p.body),
    'stamp-verdict': p => p.verdict,
    'year-timeline': p => String(Math.round(Number(p.year) || 0)),
    'key-combo': p => (p.keys || []).slice(-1)[0] || null,
    'url-bar': p => firstWordOf(p.url)
};

// Does a spoken / written word match the key? Numbers compare by digits ("$174,953" = "174953", "13K" = "13").
function wordMatches(word, key) {
    const k = normWord(key), w = normWord(word);
    if (!k || !w) return false;
    if (/^\d+$/.test(k)) { const d = String(word).replace(/[^0-9]/g, ''); return d.length > 0 && (d === k || (k.length >= 3 && d.startsWith(k.slice(0, 3)) && Math.abs(d.length - k.length) <= 1)); }
    return w === k || (k.length >= 3 && (w.startsWith(k) || k.startsWith(w) && w.length >= 3));
}

const NUM_WORDS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
};

const NUM_SCALE = { hundred: 100, thousand: 1000, grand: 1000, k: 1000, million: 1000000, m: 1000000, billion: 1000000000, b: 1000000000 };

function parseNumberTokens(tokens) {
    let total = 0, cur = 0, any = false;
    for (const raw of tokens) {
        const w = normWord(raw);
        if (!w || w === 'and') continue;
        if (/^\d+$/.test(w)) { cur += Number(w); any = true; continue; }
        if (w in NUM_WORDS) { cur += NUM_WORDS[w]; any = true; continue; }
        if (w in NUM_SCALE) {
            const s = NUM_SCALE[w];
            if (s === 100) { cur = (cur || 1) * 100; }
            else { total += (cur || 1) * s; cur = 0; }
            any = true;
            continue;
        }
        return null;
    }
    return any ? total + cur : null;
}

// Finds the spoken word (or multi-word spoken number like "sixteen hundred" -> 1600) in `list`.
function findWordHit(list, key) {
    if (!key || !Array.isArray(list) || !list.length) return null;
    const direct = list.find(w => wordMatches(w.w, key));
    if (direct) return direct;
    const k = normWord(key);
    if (!/^\d+$/.test(k)) return null;
    const target = Number(k);
    for (let i = 0; i < list.length; i++) {
        if (parseNumberTokens([list[i].w]) === null) continue;
        let bestEnd = i;
        for (let j = i; j < Math.min(list.length, i + 6); j++) {
            const val = parseNumberTokens(list.slice(i, j + 1).map(x => x.w));
            if (val === null) break;
            bestEnd = j;
            if (val === target) {
                return { start: list[i].start, end: list[bestEnd].end, w: list.slice(i, bestEnd + 1).map(x => x.w).join(' ') };
            }
        }
    }
    return null;
}

// Word by word: effects that show several words / items get each one on the frame it is spoken (props._times, clip
// frames). The split must match the Remotion side (wordCount / tags.slice(0, 14) in broll/src).
const WORD_UNITS = {
    'predict-keys': p => String(p.text || '').split(/\s+/).filter(Boolean),
    'quote-card': p => String(p.body || '').split(/\s+/).filter(Boolean),
    'marker-highlight': p => String(p.phrase || '').split(/\s+/).filter(Boolean),
    'tag-stack': p => (p.tags || []).slice(0, 14).map(String).filter(Boolean)
};

const ANY_ORDER = new Set(['tag-stack']);   // shown items that need not follow the speech order

// Each shown unit's spoken frame (relative to the clip start): matched in order to the transcription with a few words
// of look-ahead (spoken numbers too, "sixteen hundred" = 1,600); unmatched units fall between their neighbours; when
// nothing matches, they are spread over the speech word for word.
function unitTimes(units, words, anyOrder) {
    const t = new Array(units.length).fill(null);
    const used = new Set();
    let cur = 0;
    const take = (i, k, endAt) => {
        t[i] = words[k].start; used.add(k);
        if (endAt !== undefined) for (let j = k + 1; j < words.length && words[j].start < endAt - 0.01; j++) used.add(j);
    };
    units.forEach((u, i) => {
        const key = firstWordOf(u);
        for (let k = cur; k < Math.min(words.length, cur + 5); k++) {
            if (!used.has(k) && wordMatches(words[k].w, key)) { take(i, k); cur = k + 1; return; }
        }
        const hit = findWordHit(words.slice(cur, cur + 8), key);
        if (hit) { const k = words.findIndex(w => w.start === hit.start); take(i, k, hit.end); const j = words.findIndex(w => w.start >= hit.end - 0.01); cur = j < 0 ? words.length : Math.max(cur + 1, j); return; }
        if (anyOrder) {
            // items that are not in reading order (tags): the first unused spoken match anywhere
            const k = words.findIndex((w, x) => !used.has(x) && wordMatches(w.w, key));
            if (k >= 0) { take(i, k); return; }
            const h = findWordHit(words.filter((_, x) => !used.has(x)), key);
            if (h) { const k2 = words.findIndex(w => w.start === h.start); if (k2 >= 0) { take(i, k2, h.end); return; } }
        }
    });
    if (t.every(v => v === null)) units.forEach((_, i) => { t[i] = words[Math.min(words.length - 1, Math.round(i * (words.length - 1) / Math.max(1, units.length - 1)))].start; });
    for (let i = 0; i < t.length; i++) {
        if (t[i] !== null) continue;
        let j = i; while (j < t.length && t[j] === null) j++;
        const a = i > 0 ? t[i - 1] : Math.max(0, (j < t.length ? t[j] : 0) - (j - i) * 4);
        const b = j < t.length ? t[j] : a + (j - i + 1) * 4;
        for (let k = i; k < j; k++) t[k] = a + (b - a) * (k - i + 1) / (j - i + 1);
        i = j - 1;
    }
    if (!anyOrder) for (let i = 1; i < t.length; i++) if (t[i] < t[i - 1]) t[i] = t[i - 1];   // reading order
    const out = t.map(v => Math.max(0, Math.round(v)));
    out.used = used;   // the spoken words that are shown words (the word lane leaves them out of the locked row)
    return out;
}

// Each word's [in, end] from its spoken frame: in = when it starts coming in, end = when it is fully in. Typed words
// take ~2.5 frames a letter (done before the next word), tags drop 6 frames and land on the word, text fades in 4.
function wordSpans(effect, units, spoken, dur) {
    const ins = [], ends = [];
    units.forEach((u, i) => {
        const t = spoken[i], next = i + 1 < spoken.length ? spoken[i + 1] : dur;
        let a = t, b;
        if (effect === 'tag-stack') { a = Math.max(0, t - 6); b = Math.max(a + 1, t); }
        else if (effect === 'predict-keys') b = t + Math.max(1, Math.min(Math.round(String(u).length * 2.5), next - t - 1));
        else if (effect === 'marker-highlight') b = t + 10;
        else b = t + 4;
        ins.push(Math.max(0, Math.min(dur - 2, Math.round(a))));
        ends.push(Math.max(ins[i] + 1, Math.min(dur - 1, Math.round(b))));
    });
    return { ins, ends };
}

// One key word's build block in clip frames: from = where the build starts (KEY_LEAD frames before the word),
// land = the middle of the word. null without a key word in the speech.
const KEY_LEAD = 10;

function keyBlock(words, key, dur) {
    let hit = key ? findWordHit(words, key) : null;
    if (!hit && words.length) hit = words[words.length - 1];
    if (!hit) return null;
    const land = Math.max(4, Math.min(dur - 2, Math.round((hit.start + (hit.end ?? hit.start)) / 2)));
    return { hit, from: Math.max(0, Math.min(land - 4, Math.round(hit.start) - KEY_LEAD)), land, word: hit.w };
}

// At the end: the export list names consts, which must exist when it runs.
module.exports = {
    ANY_ORDER, KEY_LEAD, KEY_WORD, WORD_UNITS, findWordHit, firstWordOf, keyBlock, lastWordOf, mergeSplitNumbers, normWord, parseNumberTokens,
    unitTimes, wordMatches, wordSpans
};
