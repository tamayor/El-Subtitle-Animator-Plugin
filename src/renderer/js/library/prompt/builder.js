// Prompt tab builder: rows and sections, drag to reorder, the + menu, renderPromptBuilder.

// ---------------------------------------------------------------- drag to reorder keys
// The handle at the left of a row drags that row (with its note and conditions) to another place, in the same
// section or another one. The row is only draggable while the handle is held, so text in its inputs stays selectable.
let pbDrag = null;   // { si, ri } of the row being dragged

function pbDragHandle(rowEl, si, ri) {
    const h = pbEl('span', 'pb-handle', '⋮⋮');
    h.title = 'Drag to move this key';
    h.addEventListener('mousedown', () => { rowEl.draggable = true; });
    h.addEventListener('mouseup', () => { rowEl.draggable = false; });
    rowEl.addEventListener('dragstart', (e) => {
        if (!rowEl.draggable) return;
        pbDrag = { si, ri };
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', ''); } catch (err) { /* ignore */ }
        requestAnimationFrame(() => rowEl.classList.add('pb-dragging'));
    });
    rowEl.addEventListener('dragend', () => {
        rowEl.draggable = false; pbDrag = null;
        rowEl.classList.remove('pb-dragging');
        pbClearDropMarks();
    });
    return h;
}

function pbClearDropMarks() {
    document.querySelectorAll('#promptBuilder .pb-drop-before, #promptBuilder .pb-drop-after')
        .forEach(x => x.classList.remove('pb-drop-before', 'pb-drop-after'));
}

// Where a drop at clientY lands: { si, ri } = insert before row ri of section si (ri may equal rows.length).
function pbDropTarget(e) {
    const secEl = e.target.closest && e.target.closest('#promptBuilder .pb-sec');
    if (!secEl) return null;
    const secs = [...document.querySelectorAll('#promptBuilder .pb-sec')];
    const si = secs.indexOf(secEl);
    const rows = [...secEl.querySelectorAll(':scope > .pb-row')];
    let ri = rows.length;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { ri = i; break; }
    }
    return { si, ri, rows };
}

function initPromptBuilderDrag() {
    const host = $('promptBuilder');
    if (!host) return;
    host.addEventListener('dragover', (e) => {
        if (!pbDrag) return;
        const t = pbDropTarget(e);
        if (!t) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        pbClearDropMarks();
        if (t.ri < t.rows.length) t.rows[t.ri].classList.add('pb-drop-before');
        else if (t.rows.length) t.rows[t.rows.length - 1].classList.add('pb-drop-after');
        else t.rows = null;
    });
    host.addEventListener('dragleave', (e) => { if (!host.contains(e.relatedTarget)) pbClearDropMarks(); });
    host.addEventListener('drop', (e) => {
        if (!pbDrag || !pb.doc) return;
        const t = pbDropTarget(e);
        pbClearDropMarks();
        if (!t) return;
        e.preventDefault();
        const from = pb.doc.sections[pbDrag.si], to = pb.doc.sections[t.si];
        if (!from || !to) return;
        let ri = t.ri;
        if (pbDrag.si === t.si && pbDrag.ri < ri) ri--;   // removing the row first shifts the ones after it
        if (pbDrag.si === t.si && ri === pbDrag.ri) return;
        const [row] = from.rows.splice(pbDrag.ri, 1);
        to.rows.splice(ri, 0, row);
        pbDrag = null;
        pbRebuild();
        const moved = document.querySelectorAll('#promptBuilder .pb-sec')[t.si];
        pbFlash(moved && moved.querySelectorAll(':scope > .pb-row')[ri]);
    });
}

function pbFocusLast(si, ri, sel) {
    const sec = document.querySelectorAll('#promptBuilder .pb-sec')[si];
    const row = sec && sec.querySelectorAll('.pb-row')[ri];
    const all = row ? row.querySelectorAll(sel) : [];
    if (all.length) all[all.length - 1].focus();
}

function pbFlash(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// The first Resolve clip colour no role in this section uses yet (upper case, as the rules write it).
function pbFreeColour(section) {
    const used = section.rows.map(r => r.key.trim().toLowerCase());
    const c = PB_CLIP_COLOURS.find(x => !used.includes(x[0].toLowerCase()));
    return (c ? c[0] : 'Orange').toUpperCase();
}

function pbSectionEl(section, si) {
    const el = pbEl('div', 'pb-sec');
    const head = pbEl('div', 'pb-sec-head');
    const title = pbEl('input', 'pb-sec-title');
    title.type = 'text'; title.value = section.title; title.spellcheck = false;
    title.addEventListener('input', () => { section.title = title.value; pbChanged(); });
    title.addEventListener('change', () => pbRebuild());   // PRESETS / COLOUR titles change the row editors
    const del = pbEl('button', 'pb-mini pb-del', '×');
    del.title = 'Remove this section';
    del.addEventListener('click', () => {
        if (section.rows.length && !confirm('Remove the section "' + section.title + '" and its ' + section.rows.length + ' keys?')) return;
        pb.doc.sections.splice(si, 1); pbRebuild();
    });
    head.append(title, del);
    el.appendChild(head);
    section.rows.forEach((r, ri) => el.appendChild(pbRowEl(section, r, si, ri)));
    const add = pbEl('button', 'pb-add-key', '+ Add key');
    add.addEventListener('click', () => {
        const colour = /COLOU?R/i.test(section.title);
        section.rows.push({ key: colour ? pbFreeColour(section) : 'NEW_KEY', sep: colour ? '→' : ':', value: '', note: '', conds: [] });
        pbRebuild();
        const sec = document.querySelectorAll('#promptBuilder .pb-sec')[si];
        const keys = sec ? sec.querySelectorAll('.pb-key') : [];
        const last = keys[keys.length - 1]; if (last) { last.focus(); last.select(); }
    });
    el.appendChild(add);
    return el;
}

// Shared suggestion lists for key / colour / "then" inputs.
function pbDatalists() {
    const host = $('pbLists');
    if (!host) return;
    host.innerHTML = '';
    const mk = (id, vals) => {
        const dl = document.createElement('datalist'); dl.id = id;
        for (const v of vals) { const o = document.createElement('option'); o.value = v; dl.appendChild(o); }
        host.appendChild(dl);
    };
    mk('pbKeyList', Object.keys(PB_CATALOG).filter(k => /^[A-Z_]+$/.test(k)));
    mk('pbColourList', PB_COLOURS);
    const roles = [];
    if (pb.doc) for (const s of pb.doc.sections) if (/^PRESETS\b/i.test(s.title)) for (const r of s.rows) roles.push(r.key);
    mk('pbThenList', roles.concat(pbPresetNames(), pbTagNames()));
}

// value: "group.item" of the entry to add; anything else (the Add button's click event) = the combobox's active entry
function pbAddFromMenu(value) {
    const v = typeof value === 'string' ? value : pbAddActive;
    if (!v) { const s = $('pbAddSearch'); if (s) s.focus(); return; }
    const [gi, ii] = String(v).split('.').map(Number);
    const g = PB_MCP_PARAMS[gi], it = g && g.items[ii];
    if (!it || !pb.doc) return;
    const secs = pb.doc.sections;
    if (it.newSection) {
        secs.push({ title: 'NEW SECTION', rows: [] });
        pbRebuild();
        const t = document.querySelectorAll('#promptBuilder .pb-sec-title');
        const last = t[t.length - 1]; if (last) { last.focus(); last.select(); }
        return;
    }
    let si = -1;
    if (it.section) {
        const word = it.section.split(/\s+\(/)[0].toUpperCase();
        si = secs.findIndex(s => s.title.toUpperCase().split(/\s+\(/)[0] === word || (word === 'COLOUR ROLES' && /COLOU?R/i.test(s.title)));
        if (si < 0) { secs.push({ title: it.section, rows: [] }); si = secs.length - 1; }
    } else {
        if (!secs.length) secs.push({ title: 'GENERAL', rows: [] });
        si = secs.length - 1;
    }
    const sec = secs[si];
    // A key that is already there is shown instead of added twice (colour roles and custom keys can repeat).
    const repeatable = it.sep === '→' || !it.section;
    const at = sec.rows.findIndex(r => r.key === it.key);
    if (at >= 0 && !repeatable) {
        renderPromptBuilder(true);
        pbFlash(document.querySelectorAll('#promptBuilder .pb-sec')[si].querySelectorAll('.pb-row')[at]);
        setPromptStatus(it.key + ' is already in ' + sec.title + '.', 'ok');
        return;
    }
    let key = it.key;
    if (repeatable && it.sep !== '→') { let n = 2; while (sec.rows.some(r => r.key === key)) key = it.key + '_' + n++; }
    if (it.sep === '→') key = pbFreeColour(sec);
    const fromPanel = pbPlacementValue(key);
    // a key with `after` goes right below that key when it is there (AUDIO_TRACK below CLIP_TRACK)
    let pos = sec.rows.length;
    if (it.after) {
        const ai = sec.rows.findIndex(r => r.key.trim() === it.after || (it.after === 'CLIP_TRACK' && r.key.trim() === 'TRACK_RANGE'));
        if (ai >= 0) pos = ai + 1;
    }
    sec.rows.splice(pos, 0, { key, sep: it.sep || ':', value: fromPanel != null ? fromPanel : (it.value || ''), note: '', conds: [] });
    pbRebuild();
    const rows = document.querySelectorAll('#promptBuilder .pb-sec')[si].querySelectorAll('.pb-row');
    const row = rows[pos];
    pbFlash(row);
    const f = row && row.querySelector('.pb-val, .pb-chip-add, .pb-key');
    if (f) f.focus();
}

// The "Add from MCP" combobox: a search box with the matching entries in a list that opens below it. Every word
// typed must appear in the entry's label, key, MCP call, section or hint (any order, case-insensitive).
// Click or Enter adds an entry; ↑ / ↓ move through the list; Esc closes it (a second Esc clears the search).
let pbAddActive = '';
function pbFillAddMenu() {
    const search = $('pbAddSearch'), list = $('pbAddList');
    if (!search || !list || list.dataset.ready) return;
    list.dataset.ready = '1';
    const itemOf = (v) => { const [gi, ii] = String(v).split('.').map(Number); return PB_MCP_PARAMS[gi] && PB_MCP_PARAMS[gi].items[ii]; };
    const hint = () => {
        const it = pbAddActive ? itemOf(pbAddActive) : null;
        $('pbAddHint').textContent = it ? (it.section ? '→ ' + it.section + (it.key && it.sep !== '→' ? ' / ' + it.key : '') + '. ' : '') + (it.hint || '') : '';
    };
    const opts = () => [...list.querySelectorAll('.pb-combo-opt')];
    const setActive = (v, scroll) => {
        pbAddActive = v || '';
        for (const o of opts()) {
            const on = o.dataset.value === pbAddActive;
            o.classList.toggle('active', on);
            o.setAttribute('aria-selected', on ? 'true' : 'false');
            if (on && scroll) o.scrollIntoView({ block: 'nearest' });
        }
        hint();
    };
    const open = (on) => {
        list.classList.toggle('hidden', !on);
        search.setAttribute('aria-expanded', on ? 'true' : 'false');
    };
    const fill = () => {
        const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
        list.innerHTML = '';
        PB_MCP_PARAMS.forEach((g, gi) => {
            const hits = [];
            g.items.forEach((it, ii) => {
                const hay = [it.label, it.key, g.tool, it.section, it.hint].filter(Boolean).join(' ').toLowerCase();
                if (!words.some(w => !hay.includes(w))) hits.push([it, ii]);
            });
            if (!hits.length) return;
            list.appendChild(pbEl('div', 'pb-combo-group', g.tool === 'custom' ? 'Custom' : g.tool));
            for (const [it, ii] of hits) {
                const o = pbEl('div', 'pb-combo-opt', it.label);
                o.dataset.value = gi + '.' + ii;
                o.setAttribute('role', 'option');
                if (it.key) o.appendChild(pbEl('span', 'pb-combo-key', it.key));
                list.appendChild(o);
            }
        });
        const all = opts();
        if (!all.length) list.appendChild(pbEl('div', 'pb-combo-empty', 'No match for "' + search.value.trim() + '"'));
        setActive(all.some(o => o.dataset.value === pbAddActive) ? pbAddActive : (all[0] ? all[0].dataset.value : ''), true);
    };
    const add = (v) => { open(false); search.value = ''; pbAddFromMenu(v); fill(); };

    search.addEventListener('focus', () => { fill(); open(true); });
    search.addEventListener('click', () => open(true));
    search.addEventListener('input', () => { fill(); open(true); });
    search.addEventListener('blur', () => open(false));
    search.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (list.classList.contains('hidden')) { open(true); return; }
            const all = opts(), i = all.findIndex(o => o.dataset.value === pbAddActive);
            const next = all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
            if (next) setActive(next.dataset.value, true);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (pbAddActive) add(pbAddActive);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (!list.classList.contains('hidden')) open(false);
            else if (search.value) { search.value = ''; fill(); }
        }
    });
    // mousedown, not click: keeps the focus in the search box so blur doesn't close the list first
    list.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const o = e.target.closest('.pb-combo-opt');
        if (o) add(o.dataset.value);
    });
    list.addEventListener('mousemove', (e) => {
        const o = e.target.closest('.pb-combo-opt');
        if (o && o.dataset.value !== pbAddActive) setActive(o.dataset.value, false);
    });
    fill();
}

// Draw the builder from pb.doc. keep = keep the parsed doc (it is already current); otherwise re-parse pb.full.
function renderPromptBuilder(keep) {
    const host = $('promptBuilder');
    if (!host) return;
    if (!keep || !pb.doc) pb.doc = parseJobPrompt(pb.full);
    pbDatalists();
    host.innerHTML = '';
    if (!pb.doc) {
        const e = pbEl('div', 'pb-empty', 'This prompt has no "## SETTINGS" section. ');
        const b = pbEl('button', 'ghost', 'Add one');
        b.addEventListener('click', () => {
            pb.full = '## SETTINGS  (edit here; the rules below refer to these names)\n\nJOB\n  TIMELINE:        "<timeline name>"\n\n' + pb.full;
            saveJobPrompt(pb.full); applyPromptMode();
        });
        e.appendChild(b);
        host.appendChild(e);
        return;
    }
    pb.doc.sections.forEach((s, si) => host.appendChild(pbSectionEl(s, si)));
    const ta = $('promptText');
    if (ta && pb.mode === 'builder' && document.activeElement !== ta) { ta.value = pb.doc.post; renderPromptHilite(); }
}

// The library changed (presets added, renamed, tagged): redraw the chips unless the user is typing in the builder.
function refreshPromptPresets() {
    const host = $('promptBuilder');
    if (!host || pb.mode !== 'builder' || !pb.doc) return;
    if (host.contains(document.activeElement)) { pbDatalists(); return; }
    renderPromptBuilder(true);
}
