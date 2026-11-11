// Use tab · Text Style: the font / colour forced on the presets you add to the timeline yourself (Apply, Preview in
// Resolve). It is the manual twin of the TEXT STYLE rules Claude follows, with the same meaning:
//   NORMAL        every text layer (Text+ fill colour / MultiText layers)
//   EMPHASIS      the MultiText key-word layer; its colour goes on the box / pill behind the word (the word keeps the
//                 normal colour), presets without a box colour the word itself
//   HIGHLIGHT_BOX width / height / x / y (and auto-balance) of that box, run after the clip is placed
// Each row has an override share (0 % = the preset's own look, 100 % = always) and tags whose presets keep their own
// font and / or colour. Remembered per computer (localStorage). The Use tab preview renders with the override on, so
// what you see is what Apply places. Reuses the Prompt tab's editors (pbFontControls, pbColorControls, pbShareLabel).

const TEXT_STYLE_KEY = 'sa.textStyle';
const tsRowDefault = () => ({ font: '', style: '', color: '', share: 100, except: { tags: [], keep: 'both' } });
const textStyle = { normal: tsRowDefault(), emphasis: tsRowDefault(), highlight: { auto: false, width: 1, height: 1, x: 0, y: 0 } };
const tsShareCount = { normal: 0, emphasis: 0 };
const tsUI = { built: '', tagsKey: '' };

function tsNum(v, lo, hi, def) { const n = Number(v); return (v !== null && v !== '' && Number.isFinite(n)) ? Math.max(lo, Math.min(hi, n)) : def; }

function textStyleLoad() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(TEXT_STYLE_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') return;
    for (const k of ['normal', 'emphasis']) {
        const r = s[k];
        if (!r || typeof r !== 'object') continue;
        const d = textStyle[k];
        d.font = String(r.font || '').trim();
        d.style = d.font ? String(r.style || '').trim() : '';
        d.color = normHex(r.color) || '';
        d.share = tsNum(r.share, 0, 100, 100);
        const ex = (r.except && typeof r.except === 'object') ? r.except : {};
        d.except = {
            tags: Array.isArray(ex.tags) ? ex.tags.map(x => String(x).trim()).filter(Boolean).slice(0, 50) : [],
            keep: ['both', 'font', 'color'].includes(ex.keep) ? ex.keep : 'both'
        };
    }
    const h = (s.highlight && typeof s.highlight === 'object') ? s.highlight : {};
    textStyle.highlight = { auto: !!h.auto, width: tsNum(h.width, 0.2, 4, 1), height: tsNum(h.height, 0.2, 4, 1), x: tsNum(h.x, -2, 2, 0), y: tsNum(h.y, -2, 2, 0) };
}
function textStyleSave() {
    try { localStorage.setItem(TEXT_STYLE_KEY, JSON.stringify({ normal: textStyle.normal, emphasis: textStyle.emphasis, highlight: textStyle.highlight })); } catch (e) { /* optional */ }
}

// ---------------------------------------------------------------- what applies to a preset
const tsRowSet = (r) => !!(r.font || r.color);
// The HIGHLIGHT_BOX row was removed from the Use tab drawer (2026-11-12): saved box values no longer apply here.
// The Prompt tab's HIGHLIGHT_BOX row (Claude's placements) is unaffected.
function tsHighlightSet() { return false; }
// Part of the Use tab render key: the preview re-renders when a row that can show in it changes (the highlight box
// is applied on the timeline only, so it is left out).
function textStylePreviewKey() {
    const N = textStyle.normal, E = textStyle.emphasis;
    const on = (r) => tsRowSet(r) && r.share > 0;
    return (on(N) || on(E)) ? JSON.stringify([N, E]) : '';
}
function tsIsMultiText(a) {
    return !!(a && window.SABoxes && SABoxes.nodesOf(a).some(n => n.kind === 'multitext'));
}
// 'both' | 'font' | 'color' when the preset carries one of the row's except tags (it keeps that much of its own look).
function tsExceptFor(a, ex) {
    if (!a || !ex || !ex.tags || !ex.tags.length) return null;
    const names = ex.tags.map(x => String(x).trim().toLowerCase());
    const mine = (typeof tagsOf === 'function') ? tagsOf(a) : [];
    const hit = mine.some(t => names.includes(tagLabel(t).toLowerCase()) || names.includes(String(t.name || '').trim().toLowerCase()));
    return hit ? ex.keep : null;
}
// `pct` % of the clips get the override, spread evenly over the clips placed this session (as automation does).
// consume = false only looks (previews), so the next placed clip still gets the same answer.
function tsTakeShare(which, pct, consume) {
    const p = tsNum(pct, 0, 100, 100);
    if (p >= 100) return true;
    if (p <= 0) return false;
    const n = tsShareCount[which];
    if (consume) tsShareCount[which] = n + 1;
    return Math.floor((n + 1) * p / 100) > Math.floor(n * p / 100);
}
// The look forced on this preset: { font: { font, style } | null, color, emphasis: { font, style, color, keepFont,
// keepColor } | null, isMT }, or null when it keeps its own design.
function textStyleLook(a, consume) {
    if (!a) return null;
    const isMT = tsIsMultiText(a);
    const N = textStyle.normal, E = textStyle.emphasis;
    const exN = tsExceptFor(a, N.except), exE = tsExceptFor(a, E.except);
    const useN = exN !== 'both' && tsRowSet(N) && tsTakeShare('normal', N.share, consume);
    const useE = isMT && exE !== 'both' && tsRowSet(E) && tsTakeShare('emphasis', E.share, consume);
    const font = (useN && exN !== 'font' && N.font) ? { font: N.font, style: N.style || null } : null;
    const color = (useN && exN !== 'color' && N.color) ? N.color : null;
    let em = useE ? { font: E.font || null, style: E.font ? (E.style || null) : null, color: E.color || null } : null;
    if (isMT && exE) {
        em = Object.assign({}, em || {});
        if (exE !== 'color') { em.font = null; em.style = null; em.keepFont = true; }
        if (exE !== 'font') { em.color = null; em.keepColor = true; }
    }
    if (em && !em.font && !em.color && !em.keepFont && !em.keepColor) em = null;
    return (font || color || em) ? { font, color, emphasis: em, isMT } : null;
}
// A text design with the forced font and (Text+ only) fill colour: shading element 1, made solid. A gradient fill is
// left as it is; its stops are recoloured per clip from Clip controls (js/timeline/clip-controls.js).
function tsDesignWith(td, font, color) {
    const out = cloneTextDesign(td);
    if (font && font.font) {
        out.font = font.font;
        if (font.style) out.style = font.style;
        else if (typeof fontStylesOf === 'function' && typeof pickStyle === 'function') {
            const known = fontStylesOf(out.font);
            if (known && known.length) out.style = pickStyle(known, out.style);
        }
    }
    if (color) {
        const els = Array.isArray(out.elements) ? out.elements : (out.elements = []);
        let el = els.find(e => Number(e.index) === 1);
        if (!el) { el = { index: 1 }; els.unshift(el); }
        // a gradient fill stays a gradient: its stops are edited per clip in Clip controls
        if (Number(el.type) !== 2) Object.assign(el, { color, type: 0, enabled: true, modified: true });
    }
    return out;
}
function textStyleDesign(td, look) {
    if (!look || (!look.font && !look.color)) return td;
    return tsDesignWith(td, look.font, look.isMT ? null : look.color);
}
// The text boxes with the look on them: MultiText layers get font / style / color (/ bgColor on the emphasis layer),
// every Text+ after the first gets its own design with the font and fill colour (the first uses textDesign).
function textStyleBoxList(list, a, look, baseDesign) {
    if (!look || !Array.isArray(list) || !a || !window.SABoxes) return list;
    const nodes = SABoxes.nodesOf(a);
    const emLayer = (look.isMT && SABoxes.mtRoles) ? SABoxes.mtRoles(a).emphasis : null;
    const primary = nodes.find(n => n.primary) || nodes.find(n => n.kind === 'textplus' && !n.nested) || null;
    return list.map(b => {
        const n = b && nodes.find(x => x.id === b.id);
        if (!n) return b;
        const out = Object.assign({}, b);
        if (n.kind === 'multitext') {
            const em = (look.emphasis && n.layer === emLayer) ? look.emphasis : null;
            const f = (em && em.font) ? { font: em.font, style: em.style } : ((em && em.keepFont) ? null : look.font);
            if (f) { out.font = f.font; out.style = f.style || null; }
            const c = ((em && em.keepColor) ? null : look.color) || null;
            if (c) out.color = c;
            if (em && em.color) out.bgColor = em.color;
        } else if (n.kind === 'textplus' && !n.nested && primary && n.id !== primary.id && (look.font || look.color)) {
            out.design = tsDesignWith(out.design || n.design || baseDesign || null, look.font, look.color);
        }
        return out;
    });
}
// The highlight_box args for a MultiText preset, or null when every value is at its default.
function textStyleHighlight(a) {
    if (!tsIsMultiText(a) || !tsHighlightSet()) return null;
    return Object.assign({}, textStyle.highlight);
}
// Puts the Text Style onto an apply / preview request (textDesign, boxList, highlight). consume: this clip is placed.
function textStyleApplyReq(req, a, consume) {
    if (!req || !a) return req;
    const look = textStyleLook(a, consume);
    if (look) {
        const base = req.textDesign || a.textDesign || null;
        req.textDesign = textStyleDesign(base, look);
        req.boxList = textStyleBoxList(req.boxList, a, look, base);
    }
    const hl = textStyleHighlight(a);
    if (hl) req.highlight = hl;
    return req;
}

// ---------------------------------------------------------------- the drawer
function setTextStyleOpen(wanted) {
    state.styleOpen = !!wanted;
    const body = $('styleBodyU'), wrap = $('styleWrapU'), toggle = $('styleToggleU');
    if (body) body.classList.toggle('hidden', !state.styleOpen);
    if (wrap) wrap.classList.toggle('open', state.styleOpen);
    if (toggle) {
        toggle.setAttribute('aria-expanded', state.styleOpen ? 'true' : 'false');
        const chev = toggle.querySelector('.chev');
        if (chev) chev.textContent = state.styleOpen ? '▾' : '▸';
    }
}
function tsSummary() {
    const row = (r) => [[r.font, r.style].filter(Boolean).join(' '), r.color].filter(Boolean).join(' ') + (r.share < 100 ? ' ' + r.share + '%' : '');
    const parts = [];
    if (tsRowSet(textStyle.normal)) parts.push(row(textStyle.normal));
    if (tsRowSet(textStyle.emphasis)) parts.push('emphasis ' + row(textStyle.emphasis));
    if (tsHighlightSet()) {
        const h = textStyle.highlight, b = [];
        if (h.auto) b.push('auto');
        if (h.width !== 1) b.push('w ' + h.width.toFixed(2));
        if (h.height !== 1) b.push('h ' + h.height.toFixed(2));
        if (h.x !== 0) b.push('x ' + h.x.toFixed(3));
        if (h.y !== 0) b.push('y ' + h.y.toFixed(3));
        parts.push('box ' + b.join(' '));
    }
    return parts.length ? parts.join(' · ') : 'Preset default';
}
// A change: remember it, refresh the summary and the previews (Use tab render, timeline preview when one runs).
function tsChanged(final) {
    textStyleSave();
    const sum = $('styleSummaryU');
    if (sum) sum.textContent = tsSummary();
    if (typeof redrawStages === 'function') redrawStages();
    if (final && state.use && state.livePrev && typeof triggerLiveSync === 'function') {
        try { triggerLiveSync(state.use, 'U'); } catch (e) { /* only while a timeline preview runs */ }
    }
}
// "Except tags [chips] [+ tag…] [keep font & colour ▾]": presets with one of these tags keep their own look.
function tsExceptEl(ex) {
    const box = pbEl('div', 'pb-style-except');
    box.appendChild(pbEl('span', 'pb-share-end', 'Except tags'));
    const tags = pbTagNames();
    ex.tags.forEach((name, i) => {
        const chip = pbEl('span', 'pb-chip' + (tags.includes(name) ? '' : ' missing'));
        chip.title = tags.includes(name) ? 'Presets with this tag keep their own look' : 'No tag with this name in your library';
        chip.appendChild(pbEl('span', '', name));
        const x = pbEl('button', 'pb-chip-x', '×');
        x.title = 'Remove';
        x.addEventListener('click', () => { ex.tags.splice(i, 1); tsChanged(true); renderTextStyleU(true); });
        chip.appendChild(x);
        box.appendChild(chip);
    });
    const sel = pbEl('select', 'pb-chip-add');
    const ph = pbEl('option', '', '+ tag…'); ph.value = ''; sel.appendChild(ph);
    for (const n of tags.filter(n => !ex.tags.includes(n))) { const o = pbEl('option', '', n); o.value = n; sel.appendChild(o); }
    if (sel.options.length === 1) { ph.textContent = tags.length ? 'all tags added' : 'no tags yet'; sel.disabled = true; }
    sel.title = 'Presets with this tag keep their own look';
    sel.addEventListener('change', () => { if (sel.value) { ex.tags.push(sel.value); tsChanged(true); renderTextStyleU(true); } });
    box.appendChild(sel);
    if (ex.tags.length) {
        const keep = pbEl('select', 'pb-except-keep');
        keep.title = 'What the tagged presets keep of their own look; the rest of the override still applies to them';
        for (const [v, label] of PB_EXCEPT_KEEP) { const o = pbEl('option', '', label); o.value = v; keep.appendChild(o); }
        keep.value = ex.keep;
        keep.addEventListener('change', () => { ex.keep = keep.value; tsChanged(true); });
        box.appendChild(keep);
    }
    return box;
}
// NORMAL / EMPHASIS: [font][style] over [colour][hex][clear], the override share and the except tags.
function tsRowEl(which, label, hint) {
    const r = textStyle[which];
    const row = pbEl('div', 'pb-row ts-row');
    const main = pbEl('div', 'pb-row-main');
    const key = pbEl('span', 'ts-key', label);
    key.title = hint;
    const ed = pbEl('div', 'pb-style');
    const pair = pbEl('div', 'pb-style-pair');
    const fontLine = pbEl('div', 'pb-style-line');
    const colLine = pbEl('div', 'pb-style-line');
    fontLine.append(...pbFontControls([r.font, r.style].filter(Boolean).join(' '), (t, final) => {
        const s = pbSplitFont(t);
        r.font = String(s.family || '').trim();
        r.style = r.font ? String(s.style || '').trim() : '';
        tsChanged(final);
    }));
    colLine.append(...pbColorControls(r.color, (t, final) => {
        const h = normHex(t);
        if (h || !String(t || '').trim()) { r.color = h || ''; tsChanged(final); }
    }));
    const clr = pbEl('button', 'pb-mini pb-del', '×');
    clr.title = 'No override: every preset keeps its own font and colour here';
    clr.addEventListener('click', () => { r.font = ''; r.style = ''; r.color = ''; tsChanged(true); renderTextStyleU(true); });
    colLine.appendChild(clr);
    pair.append(fontLine, colLine);
    ed.appendChild(pair);
    const sl = pbEl('div', 'pb-style-share');
    const rng = pbEl('input', 'pb-share-range');
    rng.type = 'range'; rng.min = '0'; rng.max = '100'; rng.step = '5'; rng.value = String(r.share);
    rng.title = 'Share of the clips you add that get this font and colour; the rest keep the preset\'s default';
    const lab = pbEl('span', 'pb-share-label', pbShareLabel(r.share));
    rng.addEventListener('input', () => { r.share = Number(rng.value); lab.textContent = pbShareLabel(r.share); tsChanged(false); });
    rng.addEventListener('change', () => tsChanged(true));
    sl.append(pbEl('span', 'pb-share-end', 'Default'), rng, pbEl('span', 'pb-share-end', 'Override'), lab);
    ed.appendChild(sl);
    ed.appendChild(tsExceptEl(r.except));
    main.append(key, ed);
    row.appendChild(main);
    return row;
}
// Builds the drawer (once, and again when its tags or a chip / clear button change) and refreshes the summary.
function renderTextStyleU(force) {
    const host = $('styleBodyU');
    if (!host) return;
    const tagsKey = pbTagNames().join('\u0000');
    if (force || !tsUI.built || tsUI.tagsKey !== tagsKey) {
        if (host.contains(document.activeElement) && !force) { /* typing in it: keep the inputs */ } else {
            host.textContent = '';
            host.appendChild(tsRowEl('normal', 'NORMAL', 'Font and fill colour forced on every text layer of the presets you add. Empty = each preset keeps its own.'));
            host.appendChild(tsRowEl('emphasis', 'EMPHASIS', 'Font and colour of the MultiText key-word layer. The colour goes on the box / pill behind the word (the word keeps the normal colour); presets without a box colour the word itself.'));
            const hint = pbEl('div', 'hint ts-hint', 'Used when you add a preset yourself (Apply / Preview in Resolve). The preview above shows the result. Claude\'s placements follow the Prompt tab\'s TEXT STYLE instead.');
            host.appendChild(hint);
            tsUI.built = 'yes';
            tsUI.tagsKey = tagsKey;
        }
    }
    const sum = $('styleSummaryU');
    if (sum) sum.textContent = tsSummary();
}
function bindTextStyle() {
    textStyleLoad();
    const t = $('styleToggleU');
    if (t) t.addEventListener('click', (e) => { e.stopPropagation(); if (typeof stopPreview === 'function') stopPreview(); setTextStyleOpen(!state.styleOpen); });
    setTextStyleOpen(false);
    renderTextStyleU(true);
}
