// Prompt tab builder: the value editor of each kind of row (chips, audio, highlight box, range, font, colour, style).

function pbEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function pbSelect(cls, options, value, placeholder) {
    const sel = pbEl('select', cls);
    if (placeholder) { const o = pbEl('option', '', placeholder); o.value = ''; sel.appendChild(o); }
    const opts = options.slice();
    if (value && !opts.includes(value)) opts.unshift(value);
    for (const v of opts) { const o = pbEl('option', '', v); o.value = v; sel.appendChild(o); }
    sel.value = value || '';
    return sel;
}

// An edit that only changes text: write the prompt back, no re-render (keeps focus and caret).
function pbChanged() {
    if (!pb.doc) return;
    pb.full = serializeJobPrompt(pb.doc);
    pbSave();
}

// An edit that adds or removes something: write back and redraw the builder.
function pbRebuild() {
    pbChanged();
    renderPromptBuilder(true);
}

let pbSaveTimer = null;
function pbSave() {
    clearTimeout(pbSaveTimer);
    pbSaveTimer = setTimeout(() => { saveJobPrompt(pb.full); refreshPromptFlags(); }, 300);
}

function pbChipsEditor(row, kind) {
    const wrap = pbEl('div', 'pb-chips');
    const { items, extra } = pbSplitList(row.value);
    const names = pbPresetNames(), tags = pbTagNames();
    const known = kind === 'tags' ? tags : names.concat(tags);
    const write = (list, ex) => { row.value = pbJoinList(list, ex); };
    items.forEach((name, i) => {
        const chip = pbEl('span', 'pb-chip' + (known.includes(name) ? '' : ' missing'));
        chip.title = known.includes(name) ? (tags.includes(name) ? 'Tag' : 'Preset') : 'Not in your library';
        chip.appendChild(pbEl('span', '', name));
        const x = pbEl('button', 'pb-chip-x', '×');
        x.title = 'Remove';
        x.addEventListener('click', () => { const l = items.slice(); l.splice(i, 1); write(l, extra); pbRebuild(); });
        chip.appendChild(x);
        wrap.appendChild(chip);
    });
    const sel = pbEl('select', 'pb-chip-add');
    const ph = pbEl('option', '', kind === 'tags' ? '+ tag…' : '+ preset…'); ph.value = ''; sel.appendChild(ph);
    const group = (label, list) => {
        const free = list.filter(n => !items.includes(n));
        if (!free.length) return;
        const g = document.createElement('optgroup'); g.label = label;
        for (const n of free) { const o = pbEl('option', '', n); o.value = n; g.appendChild(o); }
        sel.appendChild(g);
    };
    if (kind !== 'tags') group('Presets', names);
    group('Tags', tags);
    if (sel.options.length === 1) { ph.textContent = 'library is empty'; sel.disabled = true; }
    sel.addEventListener('change', () => { if (sel.value) { write(items.concat(sel.value), extra); pbRebuild(); } });
    wrap.appendChild(sel);
    const ex = pbEl('input', 'pb-chip-extra');
    ex.type = 'text'; ex.value = extra; ex.placeholder = 'note, e.g. (vary them)';
    ex.addEventListener('input', () => { write(items, ex.value.trim()); pbChanged(); });
    wrap.appendChild(ex);
    return wrap;
}

// AUDIO_TRACK: [Any free track | Same as clip track | Own range] and, for its own range, A[from] to A[to].
function pbAudioEditor(row) {
    const a = pbParseAudio(row.value) || { mode: 'any', from: null, to: null };
    const wrap = pbEl('div', 'pb-range pb-audio');
    const sel = pbEl('select', 'pb-val');
    for (const [v, label] of [['any', 'Any free track'], ['same', 'Same as clip track'], ['own', 'Own range']]) { const o = pbEl('option', '', label); o.value = v; sel.appendChild(o); }
    sel.value = a.mode;
    wrap.appendChild(sel);
    const write = (final) => { row.value = pbJoinAudio(a); pbChanged(); if (final) pbPushToPlacement(row); };
    sel.addEventListener('change', () => {
        a.mode = sel.value;
        if (a.mode === 'own' && !a.from) a.from = 2;
        write(true); pbRebuild();
    });
    if (a.mode === 'own') {
        const box = (val, ph, title) => {
            wrap.appendChild(pbEl('span', 'pb-range-pre', 'A'));
            const i = pbEl('input', 'pb-range-in');
            i.type = 'number'; i.min = '1'; i.step = '1'; i.placeholder = ph; i.title = title;
            i.value = val == null ? '' : String(val);
            wrap.appendChild(i);
            return i;
        };
        const f = box(a.from, '1', 'From');
        wrap.appendChild(pbEl('span', 'pb-range-to', 'to'));
        const t = box(a.to, '∞', 'To (empty = no limit)');
        const read = (final) => {
            let from = Math.max(1, Math.round(Number(f.value)) || 1);
            let to = t.value === '' ? null : Math.round(Number(t.value));
            if (to != null && (!Number.isFinite(to) || to < from)) to = final ? from : null;
            if (final) { f.value = String(from); t.value = to == null ? '' : String(to); }
            a.from = from; a.to = to; write(final);
        };
        for (const i of [f, t]) { i.addEventListener('input', () => read(false)); i.addEventListener('change', () => read(true)); }
    }
    return wrap;
}

// Auto-balance switch, Width / Height / X / Y sliders (double-click resets one) and "Apply to placed", which
// re-applies the values to every highlight clip on the current timeline and saves them in the rules.
const PB_HL_SLIDERS = [
    { k: 'width', label: 'Width', min: 0.5, max: 2, step: 0.01, dp: 2, def: 1, title: 'Box width, × the preset\'s (with auto: × the balanced box)' },
    { k: 'height', label: 'Height', min: 0.5, max: 2, step: 0.01, dp: 2, def: 1, title: 'Box height, × the preset\'s (with auto: the padding grows / shrinks and the width follows)' },
    { k: 'x', label: 'X', min: -0.3, max: 0.3, step: 0.002, dp: 3, def: 0, title: 'Move the box right (+) / left (−), Inspector Offset units' },
    { k: 'y', label: 'Y', min: -0.3, max: 0.3, step: 0.002, dp: 3, def: 0, title: 'Move the box up (+) / down (−), Inspector Offset units' }
];
function pbHighlightEditor(row) {
    const h = pbParseHighlight(row.value) || Object.assign({}, PB_HL_DEFAULT);
    const wrap = pbEl('div', 'pb-hl');
    const write = () => { row.value = pbJoinHighlight(h); pbChanged(); };
    const top = pbEl('div', 'pb-hl-top');
    const lab = pbEl('label', 'pb-hl-auto');
    const cb = pbEl('input');
    cb.type = 'checkbox'; cb.checked = !!h.auto;
    cb.addEventListener('change', () => { h.auto = cb.checked; write(); });
    lab.title = 'Measure each placed box and the word, then even out the space around the word (pills get extra side room for their round ends). Pills and Glass Pill are measured; Highlight Select / Soft Marker / Underline Draw only take the sliders.';
    lab.append(cb, pbEl('span', '', 'Auto-balance spacing'));
    const apply = pbEl('button', 'pb-mini pb-hl-apply', 'Apply to placed');
    apply.title = 'Re-apply these values to every highlight clip on the current timeline (and save them in the rules)';
    apply.addEventListener('click', async () => {
        if (!window.sa || !window.sa.adjustHighlights) { setPromptStatus('Restart the panel to use Apply to placed.', 'bad'); return; }
        apply.disabled = true;
        setPromptStatus('Adjusting highlight boxes…', '');
        try {
            const r = await window.sa.adjustHighlights({ highlight: Object.assign({}, h), save: true });
            if (!r || r.ok === false) throw new Error((r && r.error) || 'failed');
            const res = r.result || r;
            const notes = [];
            for (const c of res.results || []) for (const x of (c.highlights || [])) if (x.error || x.note) notes.push(x.error || x.note);
            if (res.results) for (const c of res.results) if (c.error) notes.push(c.error);
            setPromptStatus(res.clips ? 'Adjusted ' + res.clips + ' highlight clip' + (res.clips === 1 ? '' : 's') + '.' + (notes.length ? ' ' + [...new Set(notes)].join(' · ') : '') : 'No highlight clips on this timeline.', notes.length ? 'bad' : 'ok');
        } catch (e) {
            setPromptStatus('Highlight boxes not adjusted: ' + (e.message || e), 'bad');
        } finally { apply.disabled = false; }
    });
    top.append(lab, apply);
    wrap.appendChild(top);
    for (const sp of PB_HL_SLIDERS) {
        const line = pbEl('div', 'pb-hl-line');
        line.title = sp.title;
        const r = pbEl('input', 'pb-hl-slider');
        r.type = 'range'; r.min = String(sp.min); r.max = String(sp.max); r.step = String(sp.step);
        r.value = String(h[sp.k]);
        const n = pbEl('input', 'pb-hl-num');
        n.type = 'number'; n.step = String(sp.step); n.value = Number(h[sp.k]).toFixed(sp.dp);
        r.dataset.default = n.dataset.default = String(sp.def);
        const set = (v, from) => {
            v = Number(v);
            if (!Number.isFinite(v)) return;
            h[sp.k] = v;
            if (from !== r) r.value = String(v);
            if (from !== n) n.value = v.toFixed(sp.dp);
            write();
        };
        r.addEventListener('input', () => set(r.value, r));
        r.addEventListener('dblclick', () => set(sp.def, null));
        n.addEventListener('change', () => set(n.value, n));
        line.append(pbEl('span', 'pb-hl-lab', sp.label), r, n);
        wrap.appendChild(line);
    }
    return wrap;
}

// Two number boxes in one row: [prefix][from] to [prefix][to]; an empty To means no limit (∞).
function pbRangeEditor(row) {
    const spec = pbKeySpec(row.key) || {};
    const min = spec.min == null ? 0 : spec.min;
    const r = pbParseRange(row.value, min) || { from: min || 1, to: null };
    const wrap = pbEl('div', 'pb-range');
    const box = (val, ph, title) => {
        if (spec.prefix) wrap.appendChild(pbEl('span', 'pb-range-pre', spec.prefix));
        const i = pbEl('input', 'pb-range-in');
        i.type = 'number'; i.min = String(min); i.step = '1'; i.placeholder = ph; i.title = title;
        i.value = val == null ? '' : String(val);
        wrap.appendChild(i);
        return i;
    };
    const a = box(r.from, String(min || 1), 'From');
    wrap.appendChild(pbEl('span', 'pb-range-to', 'to'));
    const b = box(r.to, '∞', 'To (empty = no limit)');
    const write = (final) => {
        let from = Number(a.value), to = b.value === '' ? null : Number(b.value);
        if (!Number.isFinite(from) || a.value === '') from = min || 1;
        from = Math.max(min, from);
        if (to != null && (!Number.isFinite(to) || to < from)) to = final ? from : null;
        if (final) { a.value = String(from); b.value = to == null ? '' : String(to); }
        row.value = pbJoinRange(spec.prefix, from, to);
        pbChanged();
        if (final) pbPushToPlacement(row);
    };
    for (const i of [a, b]) {
        i.addEventListener('input', () => write(false));
        i.addEventListener('change', () => write(true));
    }
    return wrap;
}

// Font controls: the installed-font picker (as in Text Design) + the styles that font really has. Only the name is
// written into the prompt; nothing is copied or installed. onChange(text, final).
function pbFontControls(value, onChange) {
    const cur = pbSplitFont(value, state.fonts);
    const fam = pbEl('input', 'pb-val pb-font-fam');
    fam.type = 'text'; fam.value = cur.family; fam.placeholder = 'font'; fam.spellcheck = false;
    fam.title = 'Click to pick an installed font, or type to filter';
    const sty = pbEl('select', 'pb-font-style');
    sty.title = 'Style';
    let style = cur.style;
    const fill = () => {
        const known = typeof fontStylesOf === 'function' ? fontStylesOf(fam.value.trim()) : null;
        const opts = (known && known.length) ? known.slice() : (typeof STYLE_OPTIONS !== 'undefined' ? STYLE_OPTIONS.slice() : []);
        if (known && known.length && style && !known.some(x => x.toLowerCase() === style.toLowerCase())) style = pickStyle(known, style);
        sty.textContent = '';
        const none = pbEl('option', '', '—'); none.value = ''; sty.appendChild(none);
        if (style && !opts.some(x => x.toLowerCase() === style.toLowerCase())) opts.unshift(style);
        for (const o of opts) { const e = pbEl('option', '', o); e.value = o; sty.appendChild(e); }
        sty.value = (opts.find(x => x.toLowerCase() === String(style).toLowerCase())) || '';
    };
    const text = () => [fam.value.trim(), style].filter(Boolean).join(' ');
    fill();
    fam.addEventListener('input', () => { fill(); onChange(text(), false); });
    fam.addEventListener('change', () => onChange(text(), true));
    sty.addEventListener('change', () => { style = sty.value; onChange(text(), true); });
    if (typeof bindFontPicker === 'function') bindFontPicker(fam);
    return [fam, sty];
}

// Colour controls: a colour box (macOS Colors panel / Windows Color dialog, like the Text Design swatches) + the hex
// code. Free text that is not a colour ("same as COLOR", "white") is kept as typed. onChange(text, final).
function pbColorControls(value, onChange) {
    const sw = pbEl('input', 'pb-color-sw');
    sw.type = 'color';
    sw.value = pbTextColourHex(value) || '#ffffff';
    sw.title = 'Pick a colour';
    const hex = pbEl('input', 'pb-val pb-color-hex');
    hex.type = 'text'; hex.value = value; hex.placeholder = '#ffffff'; hex.spellcheck = false;
    sw._hex = hex;        // attachHexFields() leaves this box alone: it has its own hex field
    sw.addEventListener('input', () => { hex.value = sw.value; onChange(sw.value, false); });
    sw.addEventListener('change', () => onChange(sw.value, true));
    hex.addEventListener('input', () => { const h = pbTextColourHex(hex.value); if (h) sw.value = h; onChange(hex.value, false); });
    hex.addEventListener('change', () => {
        const h = normHex(hex.value);
        if (h) hex.value = h;
        onChange(hex.value, true);
    });
    return [sw, hex];
}

function pbRowWriter(row) {
    return (text, final) => { row.value = text; pbChanged(); if (final) pbPushToPlacement(row); };
}

function pbFontEditor(row) {
    const wrap = pbEl('div', 'pb-font');
    wrap.append(...pbFontControls(row.value, pbRowWriter(row)));
    return wrap;
}

function pbColorEditor(row) {
    const wrap = pbEl('div', 'pb-color');
    wrap.append(...pbColorControls(row.value, pbRowWriter(row)));
    return wrap;
}

// The slider's words: 0% = every clip keeps the preset's default look, 100% = every clip gets the override.
function pbShareLabel(n) {
    if (n <= 0) return 'Preset default';
    if (n >= 100) return 'Always override';
    if (n === 50) return 'Balanced · 50%';
    return 'Override ' + n + '% · default ' + (100 - n) + '%';
}

function pbStyleEditor(row) {
    const st = pbParseStyle(row.value);
    const tidy = pbJoinStyle(st.pairs, st.share, st.except);
    if (tidy !== String(row.value || '').trim()) {
        if (st.extra) row.note = row.note ? row.note + '\n' + st.extra : st.extra;
        row.value = tidy;
        setTimeout(pbChanged, 0);
    }
    const write = (final) => { row.value = pbJoinStyle(st.pairs, st.share, st.except); pbChanged(); if (final) pbPushToPlacement(row); };
    const wrap = pbEl('div', 'pb-style');
    st.pairs.forEach((pair, i) => {
        const box = pbEl('div', 'pb-style-pair');
        const fontLine = pbEl('div', 'pb-style-line');
        const line = pbEl('div', 'pb-style-line');
        const on = pbEl('select', 'pb-style-on');
        on.title = 'Which presets this font and colour are for';
        for (const [v, label] of PB_STYLE_ON) { const o = pbEl('option', '', label); o.value = v; on.appendChild(o); }
        on.value = pair.on;
        on.addEventListener('change', () => { pair.on = on.value; write(true); });
        const add = pbEl('button', 'pb-mini pb-style-add', '+');
        add.title = 'Add another font + colour pair (e.g. one for Text+, one for MultiText)';
        add.addEventListener('click', () => {
            const used = st.pairs.map(p => p.on);
            const next = ['textplus', 'multitext'].find(x => !used.includes(x)) || 'both';
            st.pairs.splice(i + 1, 0, { font: pair.font, color: pair.color, on: next });
            if (pair.on === 'both' && next !== 'both') pair.on = next === 'multitext' ? 'textplus' : 'multitext';
            write(true); pbRebuild();
        });
        fontLine.append(...pbFontControls(pair.font, (t, f) => { pair.font = t; write(f); }));
        line.append(
            ...pbColorControls(pair.color, (t, f) => { const h = normHex(t); if (h || !t.trim()) { pair.color = h || ''; write(f); } }),
            on, add
        );
        if (st.pairs.length > 1) {
            const del = pbEl('button', 'pb-mini pb-del', '×');
            del.title = 'Remove this pair';
            del.addEventListener('click', () => { st.pairs.splice(i, 1); write(true); pbRebuild(); });
            line.appendChild(del);
        }
        box.append(fontLine, line);
        wrap.appendChild(box);
    });
    // How many of the clips get this override: left = the preset's default look, right = always the override.
    const sl = pbEl('div', 'pb-style-share');
    const cap = pbEl('span', 'pb-share-end', 'Default');
    const rng = pbEl('input', 'pb-share-range');
    rng.type = 'range'; rng.min = '0'; rng.max = '100'; rng.step = '5'; rng.value = String(st.share);
    rng.title = 'Share of the clips that get this font and colour; the rest keep the preset\'s default';
    const cap2 = pbEl('span', 'pb-share-end', 'Override');
    const lab = pbEl('span', 'pb-share-label', pbShareLabel(st.share));
    rng.addEventListener('input', () => { st.share = Number(rng.value); lab.textContent = pbShareLabel(st.share); write(false); });
    rng.addEventListener('change', () => write(true));
    sl.append(cap, rng, cap2, lab);
    wrap.appendChild(sl);
    wrap.appendChild(pbStyleExceptEl(st.except, write));
    return wrap;
}

// "Except presets tagged [chips] [keep font & colour | keep font | keep colour]": those presets skip this override.
function pbStyleExceptEl(ex, write) {
    const box = pbEl('div', 'pb-style-except');
    box.appendChild(pbEl('span', 'pb-share-end', 'Except tags'));
    const tags = pbTagNames();
    ex.tags.forEach((name, i) => {
        const chip = pbEl('span', 'pb-chip' + (tags.includes(name) ? '' : ' missing'));
        chip.title = tags.includes(name) ? 'Presets with this tag skip the override' : 'No tag with this name in your library';
        chip.appendChild(pbEl('span', '', name));
        const x = pbEl('button', 'pb-chip-x', '×');
        x.title = 'Remove';
        x.addEventListener('click', () => { ex.tags.splice(i, 1); write(true); pbRebuild(); });
        chip.appendChild(x);
        box.appendChild(chip);
    });
    const sel = pbEl('select', 'pb-chip-add');
    const ph = pbEl('option', '', '+ tag…'); ph.value = ''; sel.appendChild(ph);
    for (const n of tags.filter(n => !ex.tags.includes(n))) { const o = pbEl('option', '', n); o.value = n; sel.appendChild(o); }
    if (sel.options.length === 1) { ph.textContent = tags.length ? 'all tags added' : 'no tags yet'; sel.disabled = true; }
    sel.title = 'Presets with this tag skip the override';
    sel.addEventListener('change', () => { if (sel.value) { ex.tags.push(sel.value); write(true); pbRebuild(); } });
    box.appendChild(sel);
    if (ex.tags.length) {
        const keep = pbEl('select', 'pb-except-keep');
        keep.title = 'What the tagged presets keep of their own look; the rest of the override still applies to them';
        for (const [v, label] of PB_EXCEPT_KEEP) { const o = pbEl('option', '', label); o.value = v; keep.appendChild(o); }
        keep.value = ex.keep;
        keep.addEventListener('change', () => { ex.keep = keep.value; write(true); });
        box.appendChild(keep);
    }
    return box;
}

function pbValueEditor(row, kind) {
    if (kind === 'preset' || kind === 'tags') return pbChipsEditor(row, kind);
    if (kind === 'range') return pbRangeEditor(row);
    if (kind === 'audio') return pbAudioEditor(row);
    if (kind === 'highlight') return pbHighlightEditor(row);
    if (kind === 'font') return pbFontEditor(row);
    if (kind === 'color') return pbColorEditor(row);
    if (kind === 'style') return pbStyleEditor(row);
    if (kind === 'enum') {
        const sel = pbSelect('pb-val', (pbKeySpec(row.key) || {}).options || [], row.value);
        sel.addEventListener('change', () => { row.value = sel.value; pbChanged(); pbPushToPlacement(row); });
        return sel;
    }
    const inp = pbEl('input', 'pb-val');
    inp.type = 'text'; inp.value = row.value; inp.placeholder = 'value';
    inp.addEventListener('input', () => { row.value = inp.value; pbChanged(); });
    inp.addEventListener('change', () => pbPushToPlacement(row));
    return inp;
}

function pbRowEl(section, row, si, ri) {
    const kind = pbRowKind(row, section);
    const el = pbEl('div', 'pb-row');
    el.dataset.key = row.key;
    const main = pbEl('div', 'pb-row-main');
    let key;
    if (/COLOU?R/i.test(section.title) && row.sep === '→') key = pbColourKey(section, row);
    else {
        key = pbEl('input', 'pb-key');
        key.type = 'text'; key.value = row.key; key.spellcheck = false;
        key.setAttribute('list', 'pbKeyList');
        key.addEventListener('input', () => { row.key = key.value; pbChanged(); });
        // A key that switches the editor kind (e.g. typed TAG_MATCH) redraws when you leave it.
        key.addEventListener('change', () => { if (pbRowKind(row, section) !== kind) pbRebuild(); });
    }
    const sep = pbEl('button', 'pb-sep', row.sep);
    sep.title = 'Switch between "KEY: value" and "KEY → value"';
    sep.addEventListener('click', () => { row.sep = row.sep === ':' ? '→' : ':'; pbRebuild(); });
    const acts = pbEl('div', 'pb-acts');
    const ifb = pbEl('button', 'pb-mini', '+ if');
    ifb.title = 'Add a condition: if … → …';
    ifb.addEventListener('click', () => { row.conds.push({ if: '', then: '' }); pbRebuild(); pbFocusLast(si, ri, '.pb-cond-if'); });
    const nb = pbEl('button', 'pb-mini' + (row.note ? ' on' : ''), 'note');
    nb.title = 'Add a special note under this key';
    nb.addEventListener('click', () => {
        row._noteOpen = true; renderPromptBuilder(true); pbFocusLast(si, ri, '.pb-note');
    });
    const del = pbEl('button', 'pb-mini pb-del', '×');
    del.title = 'Remove this key';
    del.addEventListener('click', () => { section.rows.splice(ri, 1); pbRebuild(); });
    if (PB_PLACEMENT[row.key.trim()]) {
        const pl = pbEl('span', 'pb-link', '⇄ Placement');
        pl.title = 'Linked with the Placement settings (Use tab): change either one and the other follows';
        acts.appendChild(pl);
    }
    acts.append(ifb, nb, del);
    main.append(pbDragHandle(el, si, ri), key, sep, pbValueEditor(row, kind), acts);
    el.appendChild(main);

    if (row.note || row._noteOpen) {
        const n = pbEl('textarea', 'pb-note');
        n.rows = Math.max(1, String(row.note || '').split('\n').length);
        n.value = row.note || ''; n.placeholder = 'Special note for this key (one or more lines)';
        n.addEventListener('input', () => { row.note = n.value; n.rows = Math.max(1, n.value.split('\n').length); pbChanged(); });
        n.addEventListener('blur', () => { if (!n.value.trim()) { row._noteOpen = false; row.note = ''; pbRebuild(); } });
        el.appendChild(n);
    }
    row.conds.forEach((c, ci) => {
        const ce = pbEl('div', 'pb-cond');
        ce.appendChild(pbEl('span', 'pb-cond-word', 'if'));
        const a = pbEl('input', 'pb-cond-if');
        a.type = 'text'; a.value = c.if; a.placeholder = 'condition, e.g. the line mentions money';
        a.addEventListener('input', () => { c.if = a.value; pbChanged(); });
        ce.appendChild(a);
        ce.appendChild(pbEl('span', 'pb-cond-word', '→'));
        const b = pbEl('input', 'pb-cond-then');
        b.type = 'text'; b.value = c.then; b.placeholder = 'then (value, preset or action)';
        b.setAttribute('list', 'pbThenList');
        b.addEventListener('input', () => { c.then = b.value; pbChanged(); });
        ce.appendChild(b);
        const x = pbEl('button', 'pb-mini pb-del', '×');
        x.title = 'Remove this condition';
        x.addEventListener('click', () => { row.conds.splice(ci, 1); pbRebuild(); });
        ce.appendChild(x);
        el.appendChild(ce);
    });
    return el;
}
