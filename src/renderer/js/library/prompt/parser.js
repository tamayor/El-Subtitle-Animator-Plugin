// The Prompt tab's text format, without any DOM: parsing the SETTINGS block of a job prompt into sections of key
// rows and writing it back, and the value formats rows use (track ranges, audio track, lists, highlight box, font,
// text style). Loaded before the builder (prompt/*.js) and text-style.js; tested in test/renderer/prompt.test.js.
// A parse that cannot read a value returns null, so the builder keeps that row as plain text instead of losing words.

// AUDIO_TRACK: "any free track" | "same as clip track" | "A2–A4" / "A3–∞" -> { mode: any | same | own, from, to }
function pbParseAudio(v) {
    const t = String(v || '').trim();
    if (!t || /^any/i.test(t)) return { mode: 'any', from: null, to: null };
    if (/same|clip|video/i.test(t)) return { mode: 'same', from: null, to: null };
    const r = pbParseRange(t.replace(/^own\s*/i, ''), 1);
    return r ? { mode: 'own', from: r.from, to: r.to } : null;
}

function pbJoinAudio(a) {
    if (!a || a.mode === 'same') return a ? 'same as clip track' : 'any free track';
    if (a.mode === 'own' && (a.from || a.to)) return pbJoinRange('A', a.from || 1, a.to || null);
    return 'any free track';
}

// "V3–V6", "3-6", "V3 to V6", "V2–∞", "V4" -> { from, to } (to null = no limit), or null when it can't be read.
// Numbers below `min` are raised to it; a To below From becomes From.
function pbParseRange(v, min) {
    const lo = min == null ? 0 : min;
    const m = String(v || '').match(/^\s*[A-Za-z]?\s*(\d+(?:\.\d+)?)\s*(?:(?:–|-|—|to)\s*(?:[A-Za-z]?\s*(\d+(?:\.\d+)?)|∞)?)?\s*$/i);
    if (!m) return null;
    const from = Math.max(lo, Number(m[1]));
    const single = !/(–|-|—|to)/i.test(v);
    const to = single ? from : (m[2] ? Math.max(from, Number(m[2])) : null);
    return { from, to };
}

function pbParseTrackRange(v) { return pbParseRange(v, 2); }

// { from, to } back to text: "V3–V6", "V3–∞", "4–5".
function pbJoinRange(prefix, from, to) {
    return (prefix || '') + from + '–' + (to != null ? (prefix || '') + to : '∞');
}

function parsePromptRow(t) {
    const ci = t.indexOf(':'), ai = t.indexOf(' → ');
    if (ai >= 0 && (ci < 0 || ai < ci)) return { key: t.slice(0, ai).trim(), sep: '→', value: t.slice(ai + 3).trim(), note: '', conds: [] };
    if (ci >= 0) return { key: t.slice(0, ci).trim(), sep: ':', value: t.slice(ci + 1).trim(), note: '', conds: [] };
    return { key: t.trim(), sep: ':', value: '', note: '', conds: [] };
}

// { pre, sections, post } or null when the text has no "## SETTINGS" heading.
function parseJobPrompt(text) {
    const lines = String(text).split('\n');
    const si = lines.findIndex(l => /^##\s+SETTINGS\b/i.test(l));
    if (si < 0) return null;
    let ei = lines.findIndex((l, i) => i > si && /^##\s/.test(l));
    if (ei < 0) ei = lines.length;
    const sections = [];
    let cur = null, row = null;
    for (const line of lines.slice(si + 1, ei)) {
        if (!line.trim()) continue;
        const ind = line.match(/^ */)[0].length;
        if (ind === 0) { cur = { title: line.trim(), rows: [] }; sections.push(cur); row = null; continue; }
        if (!cur) { cur = { title: 'GENERAL', rows: [] }; sections.push(cur); }
        if (ind >= 4 && row) {
            const t = line.trim(), m = t.match(/^if\s+(.*?)\s+→\s*(.*)$/i);
            if (m) row.conds.push({ if: m[1], then: m[2] });
            else row.note = row.note ? row.note + '\n' + t : t;
            continue;
        }
        row = parsePromptRow(line.trim());
        cur.rows.push(row);
    }
    return { pre: lines.slice(0, si + 1).join('\n'), sections, post: lines.slice(ei).join('\n') };
}

function serializeJobPrompt(doc) {
    const out = [doc.pre, ''];
    for (const s of doc.sections) {
        out.push(s.title.trim() || 'SECTION');
        // Values line up in one column per section (at most 19 characters in, longer keys get one space).
        const w = Math.min(19, Math.max(8, ...s.rows.filter(r => r.sep === ':').map(r => r.key.length + 4)));
        for (const r of s.rows) {
            const key = r.key.trim() || 'KEY';
            let line;
            if (r.sep === '→') line = '  ' + key + ' → ' + r.value;
            else { const head = '  ' + key + ':'; line = r.value ? (head.length >= w ? head + ' ' : head.padEnd(w)) + r.value : head; }
            out.push(line.replace(/\s+$/, ''));
            const pad = ' '.repeat(Math.max(4, r.sep === '→' ? 4 : w));
            for (const n of String(r.note || '').split('\n')) if (n.trim()) out.push(pad + n.trim());
            for (const c of r.conds) if (c.if.trim() || c.then.trim()) out.push(pad + 'if ' + c.if.trim() + ' → ' + c.then.trim());
        }
        out.push('');
    }
    return out.join('\n') + (doc.post ? doc.post : '');
}

// "A · B · C  (vary them)" -> { items: [A, B, C], extra: "(vary them)" }. Lower-case phrases are kept as text.
function pbSplitList(v) {
    let extra = '';
    let s = String(v || '');
    const m = s.match(/\s{2,}(\(.*\))\s*$/);
    if (m) { extra = m[1]; s = s.slice(0, m.index); }
    const items = [];
    const rest = [];
    for (const p of s.split(' · ').map(x => x.trim()).filter(Boolean)) {
        if (/^[a-z]/.test(p)) rest.push(p); else items.push(p);
    }
    if (rest.length) extra = (rest.join(' · ') + (extra ? '  ' + extra : '')).trim();
    return { items, extra };
}

function pbJoinList(items, extra) {
    const a = items.join(' · ');
    return a && extra ? a + '  ' + extra : (a || extra || '');
}

// HIGHLIGHT_BOX: "auto · width 1.00 · height 1.00 · x 0.000 · y 0.000" ("manual" instead of auto) <-> object.
// null when the text is not in that shape (the row then stays a plain text box).
const PB_HL_DEFAULT = { auto: false, width: 1, height: 1, x: 0, y: 0 };
function pbParseHighlight(v) {
    const t = String(v || '').trim().toLowerCase();
    if (!t) return Object.assign({}, PB_HL_DEFAULT);
    const out = Object.assign({}, PB_HL_DEFAULT);
    let known = 0;
    for (const part of t.split('·').map(x => x.trim()).filter(Boolean)) {
        if (part === 'auto' || part === 'auto-balance' || part === 'balanced') { out.auto = true; known++; continue; }
        if (part === 'manual' || part === 'off') { out.auto = false; known++; continue; }
        const m = part.match(/^(width|height|x|y)\s+(-?\d*\.?\d+)$/);
        if (!m) return null;
        out[m[1]] = Number(m[2]);
        known++;
    }
    return known ? out : null;
}
function pbJoinHighlight(h) {
    return (h.auto ? 'auto' : 'manual') + ' · width ' + Number(h.width).toFixed(2) + ' · height ' + Number(h.height).toFixed(2) +
        ' · x ' + Number(h.x).toFixed(3) + ' · y ' + Number(h.y).toFixed(3);
}

// "Larken Black" -> { family: 'Larken', style: 'Black' }: the longest installed family the text starts with, else a
// trailing weight word is the style. Text that names no font ("keep each preset's font") stays whole in the family box.
function pbSplitFont(v, fonts) {
    const t = String(v || '').trim();
    const lo = t.toLowerCase();
    let fam = null;
    for (const f of (fonts || [])) {
        const fl = f.toLowerCase();
        if ((lo === fl || lo.startsWith(fl + ' ')) && (!fam || f.length > fam.length)) fam = f;
    }
    if (fam) return { family: fam, style: t.slice(fam.length).trim() };
    const m = /^(.+?)\s+((?:extra|ultra|semi|demi)?\s?(?:thin|hairline|light|regular|book|medium|bold|heavy|black|italic|oblique)(?:\s+italic)?)$/i.exec(t);
    return m ? { family: m[1], style: m[2] } : { family: t, style: '' };
}

// Colour names a prompt may already use, so the colour box shows them.
const PB_COLOUR_NAMES = {
    white: '#ffffff', black: '#000000', yellow: '#ffd400', gold: '#f5c542', orange: '#ff8a00', red: '#ff3b30',
    pink: '#ff4fa3', purple: '#8e5cf7', violet: '#8e5cf7', blue: '#2f7bff', teal: '#1fb5a8', cyan: '#00d1ff',
    green: '#34c759', grey: '#8e8e93', gray: '#8e8e93'
};
function pbTextColourHex(v) { return normHex(v) || PB_COLOUR_NAMES[String(v || '').trim().toLowerCase()] || null; }

// Text-style rows (NORMAL, EMPHASIS): one or more font + colour pairs, each for Text+, MultiText or both:
// "Poppins Bold, #ffffff · Larken Black, #ffd400 (MultiText)". Anything else the line said (e.g. "— forced on DEFAULT
// presets only") moves into the row's note, so the value stays just the pairs.
const PB_STYLE_ON = [['both', 'Text+ & MultiText'], ['textplus', 'Text+'], ['multitext', 'MultiText']];
function pbParseStyle(v) {
    const t = String(v || '');
    const di = t.search(/\s[—–-]\s/);
    const head = di >= 0 ? t.slice(0, di) : t;
    const extra = [];
    if (di >= 0) extra.push(t.slice(di).replace(/^\s[—–-]\s/, '').trim());
    const pairs = [];
    let share = 100;
    const except = { tags: [], keep: 'both' };
    for (let chunk of head.split(/\s·\s|;/)) {
        chunk = chunk.trim();
        if (!chunk) continue;
        const sm = /^override\s+(\d{1,3})\s*%/i.exec(chunk);
        if (sm) { share = Math.max(0, Math.min(100, parseInt(sm[1], 10))); continue; }
        const em = /^except\s+(.*?)\s*(?:\(\s*keep\s+([^)]*)\))?\s*$/i.exec(chunk);
        if (em) {
            except.tags = em[1].split(',').map(x => x.trim()).filter(Boolean);
            const k = String(em[2] || '').toLowerCase();
            except.keep = /font/.test(k) && /colou?r/.test(k) ? 'both' : (/font/.test(k) ? 'font' : (/colou?r/.test(k) ? 'color' : 'both'));
            continue;
        }
        let on = 'both';
        const m = /\(([^)]*)\)\s*$/.exec(chunk);
        if (m) {
            const w = m[1].toLowerCase().replace(/\s+/g, '');
            const hit = /text\+.*multi|multi.*text\+|both|all/.test(w) ? 'both' : (/multi/.test(w) ? 'multitext' : (/text\+|textplus/.test(w) ? 'textplus' : null));
            if (hit) { on = hit; chunk = chunk.slice(0, m.index).trim(); }
        }
        const parts = chunk.split(',').map(x => x.trim());
        const pair = { font: parts.shift() || '', color: '', on };
        for (const p of parts) {
            const h = pbTextColourHex(p);
            if (!pair.color && h) pair.color = h;
            else if (p) extra.push(p);
        }
        pairs.push(pair);
    }
    if (!pairs.length) pairs.push({ font: '', color: '', on: 'both' });
    return { pairs, share, except, extra: extra.filter(Boolean).join(' — ') };
}
const PB_EXCEPT_KEEP = [['both', 'keep font & colour'], ['font', 'keep font'], ['color', 'keep colour']];
function pbJoinStyle(pairs, share, except) {
    const s = pairs.map(p => {
        const head = [p.font, p.color].filter(Boolean).join(', ');
        const on = (PB_STYLE_ON.find(o => o[0] === p.on) || PB_STYLE_ON[0]);
        return head && p.on !== 'both' ? head + ' (' + on[1] + ')' : head;
    }).filter(Boolean);
    if (share !== undefined && share !== null && share < 100) s.push('override ' + share + '%');
    if (except && except.tags && except.tags.length) {
        s.push('except ' + except.tags.join(', ') + ' (' + (PB_EXCEPT_KEEP.find(k => k[0] === except.keep) || PB_EXCEPT_KEEP[0])[1] + ')');
    }
    return s.join(' · ');
}
