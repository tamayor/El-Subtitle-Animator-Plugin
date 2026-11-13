// B-roll suggestions (broll.js brollSuggest / the MCP suggest_broll), the pure part: which effect fits a subtitle and
// the props it gets from the words (numbers, money, quotes, steps...). No Resolve.

const SCORE = { 'stat-bar': 4, 'money-counter': 3, 'post-wall': 3, 'comment-drop': 3, 'stamp-verdict': 3, 'versus-split': 3,
    'year-timeline': 3, 'key-combo': 3, 'url-bar': 3, 'day-dial': 2, 'predict-keys': 2, 'voice-note': 2,
    'receipt-printer': 2, 'marker-highlight': 2, 'quote-card': 2, 'chapter-list': 1, 'live-cursor': 1, 'tag-stack': 1, 'sketch-words': 1 };

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
