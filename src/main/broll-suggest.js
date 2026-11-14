// B-roll suggestions (broll.js brollSuggest / the MCP suggest_broll), the pure part: which effect fits a subtitle and
// the props it gets from the words (numbers, money, quotes, steps...). No Resolve.

const SCORE = { 'stat-bar': 4, 'money-counter': 3, 'post-wall': 3, 'comment-drop': 3, 'stamp-verdict': 3, 'versus-split': 3,
    'year-timeline': 3, 'key-combo': 3, 'url-bar': 3, 'day-dial': 2, 'predict-keys': 2, 'voice-note': 2,
    'receipt-printer': 2, 'marker-highlight': 2, 'quote-card': 2, 'chapter-list': 1, 'live-cursor': 1, 'tag-stack': 1, 'sketch-words': 1,
    // 2026-11-13 set: kept under the older effect that reads the same words (stat-bar over ring-gauge, post-wall over
    // video-wall, quote-card over pull-quote), so a run of numbers alternates instead of one effect taking them all
    'mini-chart': 4.5, 'ring-gauge': 3.5, 'before-after-wipe': 3, 'news-ticker': 2.6, 'headline-wall': 2.6, 'lower-third': 2.5,
    'video-wall': 2.5, 'journal-note': 2, 'step-badge': 1.5, 'pull-quote': 1.5, 'phone-mockup': 1.5, 'viewfinder-zoom': 1.5,
    'editor-reveal': 1.5, 'doodle-callout': 1.2, 'ui-world': 1.2, 'doodle-icon': 1.1, 'sticker-pop': 1.1 };

// Spoken concept -> drawn icon (doodle-icon) / sticker (sticker-pop).
const DOODLE_FOR = [[/\b(idea|ideas|lightbulb)\b/i, 'lightbulb'], [/\b(house|home|mortgage|rent)\b/i, 'house'], [/\b(coin|cash|savings?)\b/i, 'coin'],
    [/\b(heart|love[ds]?)\b/i, 'heart'], [/\b(clock|deadline|hours?)\b/i, 'clock'], [/\b(brain|mindset|psychology)\b/i, 'brain'], [/\b(goal|target)s?\b/i, 'target']];
const STICKER_FOR = [[/\b(warning|be careful|watch out|red flag)\b/i, 'warning'], [/\b(on fire|viral|blew up)\b/i, 'fire'],
    [/\b(launch(ed|ing)?|skyrocket(ed)?|take off|took off)\b/i, 'rocket'], [/\b(trophy|we won|number one|first place)\b/i, 'trophy'], [/\b(hundred percent|100 percent|no cap)\b/i, 'hundred']];
const ORDINAL = { first: 1, firstly: 1, second: 2, secondly: 2, third: 3, thirdly: 3, fourth: 4, fifth: 5 };
const FRACTION = { half: 50, 'a third': 33, 'a quarter': 25, 'two thirds': 67, 'three quarters': 75 };
const wordNum = (s) => WORDNUM[String(s).toLowerCase()] || Number(s) || 0;
// Breaks a sentence into lines of about `n` characters, at most `max` of them.
function wrapLines(t, n, max) {
    const out = [''];
    for (const w of String(t).split(/\s+/).filter(Boolean)) {
        if (out[out.length - 1] && (out[out.length - 1] + ' ' + w).length > n) out.push(w); else out[out.length - 1] += (out[out.length - 1] ? ' ' : '') + w;
    }
    return out.slice(0, max).filter(Boolean);
}

const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function parseNumber(text) {
    const m = /(\$)?\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|b|million|billion|thousand|grand|%|percent)?\b/i.exec(text);
    if (!m) return null;
    let v = Number(m[2].replace(/,/g, ''));
    const unit = (m[3] || '').toLowerCase();
    let suffix = '', decimals = /\./.test(m[2]) ? Math.min(2, m[2].split('.')[1].length) : 0;
    if (unit === 'k' || unit === 'thousand' || unit === 'grand') { if (v < 1000) { suffix = 'K'; } }
    else if (unit === 'm' || unit === 'million') suffix = 'M';
    else if (unit === 'b' || unit === 'billion') suffix = 'B';
    else if (unit === '%' || unit === 'percent') suffix = '%';
    const money = !!m[1] || /\b(dollars?|bucks|grand|usd|revenue|salary|income|profit|made|earn)/i.test(text);
    return { value: v, prefix: money ? '$' : '', suffix, decimals, raw: m[0] };
}

function propsFor(effect, text) {
    const t = String(text || '').trim();
    const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trim() + '…' : s);
    switch (effect) {
    case 'money-counter': {
        const n = parseNumber(t);
        if (!n) return null;
        const rest = t.replace(n.raw, ' ').replace(/\b(dollars?|bucks|percent)\b/ig, '').replace(/\s+/g, ' ').trim();
        return { prefix: n.prefix, value: n.value, suffix: n.suffix, decimals: n.decimals, label: short(rest.replace(/^[,.\s]+|[,.\s]+$/g, ''), 28) };
    }
    case 'post-wall': {
        const m = /(\d[\d,]*)\s*(posts?|videos?|reels?|uploads?|days?)/i.exec(t);
        if (!m) return null;
        return { count: Number(m[1].replace(/,/g, '')), unit: m[2].toLowerCase() };
    }
    case 'comment-drop': {
        const m = /\bcomment(?:ing)?\s+(?:the word\s+)?["“']?([A-Za-z0-9#]+)/i.exec(t);
        const kw = m ? m[1].toUpperCase() : 'YES';
        return { keyword: kw, comment: '{keyword} to get access' };
    }
    case 'day-dial': {
        const m = /\b(every ?day|daily|each day|days?|hours?|weeks?|morning|routine)\b/i.exec(t);
        const w = m ? m[1].toLowerCase().replace(/^every ?/, '').replace(/s$/, '').replace('daily', 'day').replace('each ', '') : 'day';
        return { word: w || 'day', title: m ? m[1].toLowerCase() : 'day' };
    }
    case 'predict-keys': return { text: short(t.replace(/[.!?]+$/, ''), 30) };
    case 'voice-note': return { caption: short(t.replace(/[.!?]+$/, ''), 30) };
    case 'receipt-printer': {
        // the sentence, one line per clause (at most 5), printed word by word
        const parts = t.replace(/[.!?]+$/, '').split(/\s*[,;:\u2014]\s*|\s+-\s+|\.\s+/).map(s => s.trim()).filter(Boolean).slice(0, 5);
        return { lines: parts.length ? parts.map(s => short(s, 40)) : [short(t, 40)], byWord: true, header: 'Receipt', subheader: '', mark: parts.length > 1 ? parts.length : 0 };
    }
    case 'chapter-list': {
        const m = /\b(?:number|step|tip|part|chapter)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i.exec(t);
        const n = m ? (WORDNUM[m[1].toLowerCase()] || Number(m[1])) : 1;
        return { active: n };
    }
    case 'sketch-words': {
        const words = t.replace(/[^\p{L}\p{N}'\s-]/gu, ' ').split(/\s+/).filter(Boolean);
        const STOP = /^(the|a|an|and|or|but|so|to|of|in|on|at|for|is|it|its|this|that|i|you|we|they|he|she|my|your|be|was|are|with|just|like|if|then|literally|word|one|focus)$/i;
        const pick = words.filter(w => !STOP.test(w)).sort((a, b) => b.length - a.length)[0] || words[0];
        return pick ? { word: short(pick, 18), note: '' } : null;
    }
    case 'versus-split': {
        const m = /\s+\b(?:vs\.?|versus|instead of|rather than|better than|compared to)\b\s+/i.exec(t);
        if (m) {
            const a = short(t.slice(0, m.index).replace(/^[,.\s]+|[,.\s]+$/g, ''), 26);
            const b = short(t.slice(m.index + m[0].length).replace(/[.!?]+$/, ''), 26);
            const swap = /instead of|rather than|better than/i.test(m[0]);
            if (a && b) return { left: swap ? b : a, right: swap ? a : b, strikeLeft: swap };
        }
        const stopStart = /\bstop doing\s+(.+?)\s+(?:and\s+)?start\s+(?:doing\s+)?(.+)/i.exec(t);
        if (stopStart) return { left: short(stopStart[1], 26), right: short(stopStart[2].replace(/[.!?]+$/, ''), 26), strikeLeft: true };
        return null;
    }
    case 'stat-bar': {
        const ratio = /\b(\d+)\s+out of\s+(\d+)\b/i.exec(t);
        if (ratio) {
            const num = Number(ratio[1]), den = Math.max(1, Number(ratio[2]));
            const rest = t.replace(ratio[0], ' ').replace(/\s+/g, ' ').trim();
            return { percent: Math.min(100, Math.round(num / den * 100)), valueText: `${num}/${den}`,
                label: short(rest.replace(/^[,.\s]+|[,.\s]+$/g, ''), 28) || 'Total', down: /\b(dropped|fell|down|lost|failed)\b/i.test(t) };
        }
        const pct = /\b(\d{1,3}(?:\.\d+)?)\s*(?:%|\bpercent\b)/i.exec(t);
        if (!pct) return null;
        const p = Math.min(100, Math.max(0, Number(pct[1])));
        const rest = t.replace(pct[0], ' ').replace(/\s+/g, ' ').trim();
        return { percent: p, valueText: `${Math.round(p)}%`, label: short(rest.replace(/^[,.\s]+|[,.\s]+$/g, ''), 28) || 'Share',
            down: /\b(dropped|fell|down|decreased|lost|less)\b/i.test(t) };
    }
    case 'marker-highlight': {
        const clean = short(t.replace(/[.!?]+$/, ''), 48);
        const words = clean.replace(/[^\p{L}\p{N}'\s-]/gu, ' ').split(/\s+/).filter(Boolean);
        const STOP = /^(the|a|an|and|or|but|so|to|of|in|on|at|for|is|it|its|this|that|i|you|we|they|he|she|my|your|be|was|are|with|just|like|if|then|about|talks|nobody)$/i;
        const focus = words.filter(w => !STOP.test(w)).sort((a, b) => b.length - a.length)[0] || words[words.length - 1] || '';
        return { phrase: clean, focusWord: focus, redact: /\b(secret|hidden|banned)\b/i.test(t) };
    }
    case 'quote-card': {
        const q = /["“]([^"”]{6,})["”]/.exec(t);
        const isAlert = /\b(warning|reminder|just announced)\b/i.exec(t);
        if (isAlert) return { title: isAlert[1].toUpperCase(), body: short(t.replace(/[.!?]+$/, ''), 60), author: '', alert: true };
        return { title: /\brule of thumb\b/i.test(t) ? 'Rule of thumb' : 'Remember', body: short((q ? q[1] : t).replace(/[.!?]+$/, ''), 64), author: '', alert: false };
    }
    case 'stamp-verdict': {
        const isTrue = /\b(fact check|actually works)\b/i.test(t);
        const claim = short(t.replace(/\b(that'?s a |this is a )?(myth|total lie|a lie|completely wrong|fact check)[:,\s-]*/ig, '').replace(/[.!?]+$/, ''), 56);
        return { claim: claim || short(t, 56), verdict: isTrue ? 'FACT' : 'MYTH', isTrue };
    }
    case 'year-timeline': {
        const ym = /\b(19\d{2}|20\d{2})\b/.exec(t);
        let year = ym ? Number(ym[1]) : 0;
        let raw = ym ? ym[0] : '';
        if (!year) {
            const ago = /\b(\d+)\s+years?\s+ago\b/i.exec(t);
            if (ago) { year = new Date().getFullYear() - Number(ago[1]); raw = ago[0]; }
        }
        if (!year) return null;
        const cap = t.replace(raw, ' ').replace(/\b(back in|in|since|by|from|until)\b/ig, ' ').replace(/\s+/g, ' ').trim();
        return { year, caption: short(cap.replace(/^[,.\s]+|[,.\s]+$/g, ''), 36) };
    }
    case 'key-combo': {
        const keys = [];
        if (/\b(command|cmd)\b/i.test(t)) keys.push('⌘');
        if (/\b(control|ctrl)\b/i.test(t)) keys.push('Ctrl');
        if (/\b(option|alt)\b/i.test(t)) keys.push('⌥');
        if (/\bshift\b/i.test(t)) keys.push('Shift');
        const special = /\b(enter|return|space|tab|escape|esc)\b/i.exec(t);
        if (special) {
            const s = special[1].toLowerCase();
            keys.push(s === 'enter' || s === 'return' ? '↵' : s === 'escape' || s === 'esc' ? 'Esc' : s[0].toUpperCase() + s.slice(1));
        } else {
            const k = /\b(?:command|cmd|ctrl|control|shift|option|alt|press|hit|hold)\s*\+?\s*([a-z0-9])\b/i.exec(t);
            if (k) keys.push(k[1].toUpperCase());
        }
        if (!keys.length) return null;
        return { keys, label: short(t.replace(/[.!?]+$/, ''), 28) };
    }
    case 'url-bar': {
        const dom = /\b([a-z0-9-]+\.(?:com|io|ai|org|app|dev|co|net))\b/i.exec(t);
        return { url: dom ? dom[1].toLowerCase() : 'link in bio', cta: dom ? 'Visit' : 'Open' };
    }
    case 'ring-gauge': {
        const ratio = /\b(\d+)\s+out of\s+(\d+)\b/i.exec(t);
        const pct = /\b(\d{1,3}(?:\.\d+)?)\s*(?:%|\bpercent\b)/i.exec(t);
        const frac = /\b(half|a third|a quarter|two thirds|three quarters) of\b/i.exec(t);
        const hit = ratio || pct || frac;
        if (!hit) return null;
        const p = ratio ? Math.round(Number(ratio[1]) / Math.max(1, Number(ratio[2])) * 100) : pct ? Number(pct[1]) : FRACTION[frac[1].toLowerCase()];
        const rest = t.replace(ratio || pct ? hit[0] : frac[1], ' ').replace(/\s+/g, ' ').replace(/^[,.\s]+|[,.\s]+$/g, '').replace(/[.!?]+$/, '');
        return { percent: Math.min(100, Math.max(0, p)), valueText: ratio ? `${ratio[1]}/${ratio[2]}` : `${Math.round(p)}%`, label: short(rest, 26) };
    }
    case 'mini-chart': {
        // every number in the line is a point; "from 10k in Jan to 45k in Mar" names them by the word after "in"
        const re = /(\$)?(\d[\d,]*(?:\.\d+)?)\s?(k|m|b|%|x)?\b(?:\s+(?:in|by|on|during)\s+([A-Za-z]{3,9}))?/gi;
        const pts = []; let m, suffix = '', prefix = '';
        while ((m = re.exec(t)) && pts.length < 8) {
            const v = Number(m[2].replace(/,/g, ''));
            if (!Number.isFinite(v) || (v >= 1900 && v <= 2100 && !m[3] && !m[1])) continue;      // a year is a label, not a value
            if (m[3] && !suffix) suffix = m[3].toLowerCase() === '%' || m[3].toLowerCase() === 'x' ? m[3].toLowerCase() : m[3].toUpperCase();
            if (m[1]) prefix = '$';
            pts.push({ label: m[4] ? m[4][0].toUpperCase() + m[4].slice(1, 3).toLowerCase() : '', v });
        }
        const grew = /\b(doubled|tripled|grew\s+(\d+)\s?x)\b/i.exec(t);
        if (pts.length < 2 && grew) { const k = grew[2] ? Number(grew[2]) : /tripled/i.test(grew[1]) ? 3 : 2; return { mode: 'bar', title: short(t.replace(/[.!?]+$/, ''), 30), points: ['Before | 1', 'After | ' + k], prefix: '', suffix: 'x' }; }
        if (pts.length < 2) return null;
        return { mode: pts.length > 3 || /\b(over time|trend|line)\b/i.test(t) ? 'line' : 'bar', title: '', prefix, suffix,
            points: pts.map((q, i) => (q.label || (pts.length === 2 ? ['Before', 'After'][i] : String(i + 1))) + ' | ' + q.v) };
    }
    case 'sticker-pop': { const h = STICKER_FOR.find(([re]) => re.test(t)); return h ? { icon: h[1], emoji: '', label: '' } : null; }
    case 'doodle-icon': { const h = DOODLE_FOR.find(([re]) => re.test(t)); return h ? { icon: h[1], label: '' } : null; }
    case 'step-badge': {
        const lab = /\b(step|tip|part|rule|lesson|reason|mistake)\s+(?:number\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i.exec(t);
        const rest = (m) => short(t.slice(m.index + m[0].length).replace(/^[\s,:.\-]+/, '').replace(/[.!?]+$/, ''), 30);
        if (lab) return { mode: 'step', number: wordNum(lab[2]) || 1, total: 0, word: lab[1][0].toUpperCase() + lab[1].slice(1).toLowerCase(), text: '' };
        const num = /\bnumber\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i.exec(t);
        if (num) return { mode: 'countdown', number: wordNum(num[1]) || 1, text: rest(num) };
        const ord = /\b(first(?:ly)?|second(?:ly)?|third(?:ly)?|fourth|fifth)\b[,:]/i.exec(t);
        if (ord) return { mode: 'countdown', number: ORDINAL[ord[1].toLowerCase()], text: rest(ord) };
        const many = /\b(two|three|four|five|six|seven|\d)\s+(things|ways|steps|tips|reasons|rules|mistakes|lessons)\b/i.exec(t);
        if (many) return { mode: 'countdown', number: wordNum(many[1]) || 3, text: many[2].toLowerCase() + ' ' + rest(many) };
        return null;
    }
    case 'lower-third': {
        // names are read with their capitals (the trigger itself is case-blind)
        const who = /\b(?:[Mm]y name is|[Jj]oining (?:us|me)(?: today)?(?: is)?|[Pp]lease welcome|I'?m|I am)\s+((?:Dr\.? )?[A-Z][a-z]+(?: [A-Z][a-z'-]+){0,2})\b/.exec(t);
        if (who && !/^(So|Not|Just|Going|Really|Here|Still|Very|Also|The|A|An|In|On|At)$/.test(who[1].split(' ')[0])) {
            const role = /,\s*(?:the |a |an )?([^,.]{3,40})/.exec(t.slice(who.index + who[0].length));
            return { variant: 'speaker', name: who[1], role: role ? short(role[1].trim().replace(/^and\s+/i, ''), 34) : '' };
        }
        const kw = /\b(?:according to|(?:study|report|survey|research|data) (?:by|from|out of))\s+/i.exec(t);
        const src = kw ? /^((?:the |a )?[A-Z][\w&.'-]*(?: (?:of |for |and )?[A-Z][\w&.'-]*){0,4})/.exec(t.slice(kw.index + kw[0].length)) : null;
        const year = /\b(19\d{2}|20\d{2})\b/.exec(t);
        if (src) return { variant: 'source', source: src[1].replace(/^(the|a) /i, '') + (year ? ', ' + year[1] : '') };
        if (/\b(researchers|scientists|a study) (found|say|show(ed|s)?)\b/i.test(t)) return { variant: 'source', source: 'Research' + (year ? ', ' + year[1] : '') };
        return null;
    }
    case 'news-ticker': {
        const body = t.replace(/\b(breaking( news)?|(huge|big|massive|crazy) news)\b[:,\s-]*/ig, '').replace(/[.!?]+$/, '').trim();
        return { badge: /\bjust (announced|dropped|released|launched)\b/i.test(t) && !/breaking/i.test(t) ? 'Just in' : 'Breaking', headline: short(body || t, 44), ticker: [short(body || t, 60)] };
    }
    case 'pull-quote': {
        const q = /["“]([^"”]{6,})["”]/.exec(t);
        const body = (q ? q[1] : t.replace(/^.*?\b(remember this|never forget|write this down|here(?:'?s| is) the thing|the truth is)\b[:,\s-]*/i, '')).replace(/[.!?]+$/, '').trim();
        return body.length >= 6 ? { quote: short(body, 110), author: '' } : null;
    }
    case 'doodle-callout': return { shape: 'circle', label: '' };
    case 'journal-note': {
        const title = /\bnote to self\b/i.test(t) ? 'Note to self' : /\blessons?\b/i.test(t) ? 'Lesson learned' : 'Journal';
        const body = t.replace(/^.*?\b(note to self|dear diary|lessons? i(?:'ve| have)? learned(?: is| was)?(?: that)?)\b[:,\s-]*/i, '').replace(/[.!?]+$/, '').trim() || t;
        return { mode: 'page', title, lines: wrapLines(body, 24, 5) };
    }
    case 'headline-wall': {
        const body = short(t.replace(/[.!?]+$/, ''), 40);
        return { headlines: [body, 'Everyone is talking about it', 'What happens next?', 'Experts weigh in'], notes: [] };
    }
    case 'phone-mockup': { const dom = /\b([a-z0-9-]+\.(?:com|io|ai|org|app|dev|co|net))\b/i.exec(t); return { url: dom ? dom[1].toLowerCase() : 'article', title: short(t.replace(/[.!?]+$/, ''), 48), lines: [] }; }
    case 'viewfinder-zoom': return {};
    case 'ui-world': { const ask = /\b(?:ask(?:ed)?|told|tell|prompt(?:ed)?)\s+(?:it|ai|claude|chatgpt)\s+to\s+(.{3,40})/i.exec(t); return ask ? { prompt: short(ask[1].replace(/[.!?]+$/, ''), 36) } : {}; }
    case 'before-after-wipe': return {};
    case 'editor-reveal': return {};
    case 'video-wall': {
        const m = /(\d[\d,]*)\s+(videos|reels|shorts|clips|tiktoks)\b/i.exec(t);
        return m ? { count: Number(m[1].replace(/,/g, '')), label: m[2].toLowerCase() } : null;
    }
    default: return {};
    }
}

// Which subtitles would carry which effect. Not placed: the result goes to the tab (ticks) or to Claude, who can
// change any props and pass the list to place_broll { items }.
function brollSuggestFromTexts(subs, o, reg, fps) {
    o = o || {};
    const max = Math.max(1, Math.min(40, Number(o.max) || 8));
    const gapF = Math.round((Number.isFinite(Number(o.minGap)) ? Number(o.minGap) : 4) * fps);
    const allow = Array.isArray(o.effects) && o.effects.length ? new Set(o.effects) : null;
    const res = reg.effects.filter(e => !allow || allow.has(e.id)).map(e => ({ e, re: (e.triggers || []).map(t => new RegExp(t, 'i')) })).filter(x => x.re.length);
    const cands = [];
    for (const s of subs) {
        const text = String(s.text || '');
        for (const { e, re } of res) {
            const hit = re.find(r => r.test(text));
            if (!hit) continue;
            const props = propsFor(e.id, text);
            if (!props) continue;
            const m = hit.exec(text);
            cands.push({ subtitle: s.index, text, start: s.start, end: s.end, effect: e.id, name: e.name, props,
                why: 'matched "' + (m ? m[0] : '') + '"', score: (SCORE[e.id] || 1) + (text.length < 60 ? 0.2 : 0) });
        }
    }
    cands.sort((a, b) => b.score - a.score || a.start - b.start);
    const picked = [];
    const usedSub = new Set();
    for (const c of cands) {
        if (picked.length >= max) break;
        if (usedSub.has(c.subtitle)) continue;
        if (picked.some(p => Math.abs(p.start - c.start) < gapF)) continue;
        if (picked.length && picked[picked.length - 1].effect === c.effect && picked.filter(p => p.effect === c.effect).length >= 2) continue;
        picked.push(c); usedSub.add(c.subtitle);
    }
    picked.sort((a, b) => a.start - b.start);
    return picked.map(({ score, ...c }) => c);
}

// At the end: the export list names consts, which must exist when it runs.
module.exports = { brollSuggestFromTexts, parseNumber, propsFor };
