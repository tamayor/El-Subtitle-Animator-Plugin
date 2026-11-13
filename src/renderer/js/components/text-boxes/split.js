// Text boxes (js/components/text-boxes.js), the pure part: which text a box shows, and how a subtitle is split into
// the Upper / Emphasis / Lower rows of a MultiText preset. No DOM, no panel state: the MultiText settings (`cfg`:
// anchor, count, start) are passed in. Tested in test/renderer/text-boxes.test.js.

// The text of a Text+ box for its mode, or null to keep what the preset already says.
function tbResolveText(b, sub) {
    const lines = String(sub || '').split(/\r?\n/);
    switch (b.mode) {
        case 'sub': return sub;
        case 'l1': return lines[0] || '';
        case 'l2': return lines[1] || '';
        case 'l3': return lines[2] || '';
        case 'custom': return b.text || '';
        default: return null;
    }
}

// Which layer plays which role: guessed from layer names / default texts, then size (emphasis) and height (upper / lower).
// list: [{ layer, layerName, defaultText, size, cy }] -> { upper, emphasis, lower } layer numbers (null = none).
function tbAutoRoles(list) {
    const r = { upper: null, emphasis: null, lower: null };
    const used = new Set();
    const take = (role, re) => {
        if (r[role] !== null) return;
        const n = list.find(x => !used.has(x.layer) && re.test((x.layerName || '') + ' ' + (x.defaultText || '')));
        if (n) { r[role] = n.layer; used.add(n.layer); }
    };
    take('emphasis', /emphas|highlight|keyword|hero|\bmain\b|\bbig\b/i);
    take('upper', /upper|\btop\b|above/i);
    take('lower', /lower|bottom|below|under/i);
    const pick = (role, best) => {
        if (r[role] !== null) return;
        const p = list.filter(x => !used.has(x.layer));
        if (!p.length) return;
        const n = p.reduce((m, x) => best(x, m) ? x : m);
        r[role] = n.layer; used.add(n.layer);
    };
    pick('emphasis', (x, m) => (x.size || 0) > (m.size || 0) + 1e-6);
    pick('upper', (x, m) => x.cy > m.cy + 1e-6);
    pick('lower', (x, m) => x.cy < m.cy - 1e-6);
    return r;
}

function tbWords(s) {
    return String(s || '').replace(/\r?\n/g, ' ').split(/\s+/).filter(Boolean);
}

// The emphasized words as [start, end) indices for a subtitle of N words.
function tbEmphasisRange(N, cfg) {
    const c = cfg;
    const k = Math.max(1, Math.min(N, Math.round(Number(c.count)) || 1));
    if (c.anchor === 'first') return [0, k];
    if (c.anchor === 'center') { const s = Math.floor((N - k) / 2); return [s, s + k]; }
    if (c.anchor === 'index') { const s = Math.min(Math.max(0, Math.round(Number(c.start)) || 0), N - 1); return [s, Math.min(N, s + k)]; }
    return [N - k, N];
}

// Remember a chosen range [s, e) of N words in `cfg` in a way that carries over to other subtitles (changes cfg).
function tbSetRange(N, s, e, cfg) {
    const c = cfg;
    c.count = Math.max(1, e - s);
    if (e >= N) c.anchor = 'last';
    else if (s <= 0) c.anchor = 'first';
    else if (s === Math.floor((N - c.count) / 2)) c.anchor = 'center';
    else { c.anchor = 'index'; c.start = s; }
}

// The three parts for a subtitle, plus which role each word got (for the coloured chips).
function tbSplit(sub, cfg) {
    const w = tbWords(sub), N = w.length;
    const out = { upper: '', emphasis: '', lower: '', words: w, roles: [] };
    if (!N) return out;
    const [s, e] = tbEmphasisRange(N, cfg);
    out.upper = w.slice(0, s).join(' ');
    out.emphasis = w.slice(s, e).join(' ');
    out.lower = w.slice(e).join(' ');
    out.roles = w.map((_, i) => i < s ? 'upper' : (i < e ? 'emphasis' : 'lower'));
    return out;
}

// A role with no layer (r[role] === null): fold its text into a neighbouring layer instead of losing it.
function tbFold(r, parts) {
    const t = Object.assign({}, parts);
    const join = (x, y) => [x, y].filter(Boolean).join(' ');
    if (r.upper === null && t.upper) { if (r.lower !== null) t.lower = join(t.upper, t.lower); else if (r.emphasis !== null) t.emphasis = join(t.upper, t.emphasis); t.upper = ''; }
    if (r.lower === null && t.lower) { if (r.upper !== null) t.upper = join(t.upper, t.lower); else if (r.emphasis !== null) t.emphasis = join(t.emphasis, t.lower); t.lower = ''; }
    return t;
}
