// The preset list: the tags section (chips, filter, tag drag-to-reorder).

// Library tab: the Tags accordion (rename / recolor / delete; + makes a new one) and the editor's tag picker.
function renderTags() {
    const tags = allTags();
    const counts = {};
    for (const a of state.lib.animations) for (const id of (a.tags || [])) counts[id] = (counts[id] || 0) + 1;
    $('tagsSummary').textContent = tags.length ? String(tags.length) : 'none yet';
    const dots = $('tagsDots');
    dots.textContent = '';
    for (const t of tags.slice(0, 12)) {
        const d = tagMarkEl(t); d.title = t.name;
        dots.appendChild(d);
    }

    const list = $('tagList');
    const editing = list.contains(document.activeElement);   // don't wipe a rename in progress
    if (!editing) list.textContent = '';
    if (!editing && !tags.length) {
        const e = document.createElement('div');
        e.className = 'empty-tags';
        e.textContent = 'No tags yet. Click + to make one.';
        list.appendChild(e);
    }
    for (const t of (editing ? [] : tags)) {
        const row = document.createElement('div');
        row.className = 'tag-row';
        row.dataset.tagId = t.id;

        // Drag handle & order buttons
        const handle = document.createElement('span');
        handle.className = 'tag-handle';
        handle.textContent = '⋮⋮';
        handle.title = 'Drag to reorder tag sequence';
        handle.addEventListener('mousedown', (e) => startTagDrag(e, row, list));

        // Quick up / down arrows for accessible reordering
        const orderWrap = document.createElement('span');
        orderWrap.className = 'tag-order-btns';
        const upBtn = document.createElement('button');
        upBtn.className = 'ghost tag-arrow';
        upBtn.textContent = '▲';
        upBtn.title = 'Move earlier';
        upBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const current = allTags().slice();
            const idx = current.findIndex(x => x.id === t.id);
            if (idx > 0) {
                const temp = current[idx - 1];
                current[idx - 1] = current[idx];
                current[idx] = temp;
                saveTagList(current);
            }
        });
        const dnBtn = document.createElement('button');
        dnBtn.className = 'ghost tag-arrow';
        dnBtn.textContent = '▼';
        dnBtn.title = 'Move later';
        dnBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const current = allTags().slice();
            const idx = current.findIndex(x => x.id === t.id);
            if (idx >= 0 && idx < current.length - 1) {
                const temp = current[idx + 1];
                current[idx + 1] = current[idx];
                current[idx] = temp;
                saveTagList(current);
            }
        });
        orderWrap.append(upBtn, dnBtn);

        const col = document.createElement('label');
        col.className = 'tag-color'; col.style.background = t.color; col.title = 'Change color';
        const ci = document.createElement('input');
        ci.type = 'color'; ci.value = t.color;
        ci.addEventListener('input', () => { col.style.background = ci.value; });
        ci.addEventListener('change', () => saveTagList(allTags().map(x => x.id === t.id ? Object.assign({}, x, { color: ci.value }) : x)));
        col.appendChild(ci);
        // emoji (up to EMOJI_MAX): the button opens the picker; none = the colour dot is shown
        const em = document.createElement('button');
        em.type = 'button'; em.className = 'tag-emoji-btn' + (t.emoji ? '' : ' empty');
        em.textContent = t.emoji || '☺';
        em.title = 'Emoji for this tag (up to ' + EMOJI_MAX + '). None = the colour dot is shown.';
        em.addEventListener('click', (e) => { e.stopPropagation(); openTagEmojiPop(em, t); });
        const nm = document.createElement('input');
        nm.type = 'text'; nm.className = 'tag-name'; nm.value = t.name; nm.maxLength = 40; nm.title = 'Rename';
        nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') nm.blur(); if (e.key === 'Escape') { nm.value = t.name; nm.blur(); } });
        nm.addEventListener('change', () => {
            const v = nm.value.trim();
            if (!v) { nm.value = t.name; return; }
            if (v !== t.name) saveTagList(allTags().map(x => x.id === t.id ? Object.assign({}, x, { name: v }) : x));
        });
        const cnt = document.createElement('span');
        cnt.className = 'tag-count'; cnt.textContent = counts[t.id] || ''; cnt.title = (counts[t.id] || 0) + ' preset(s)';
        const x = document.createElement('button');
        x.className = 'ghost'; x.textContent = '×'; x.title = 'Delete tag';
        x.addEventListener('click', () => { deleteTagWithConfirm(t); });
        row.append(handle, orderWrap, col, em, nm, cnt, x);
        list.appendChild(row);
    }

    // the open preset's tags, with a + to make a new one on the spot
    const pick = $('animTags');
    const a = libEntry(state.createId);
    if (pick && a) {
        pick.textContent = '';
        const mine = Array.isArray(a.tags) ? a.tags : [];
        for (const t of tags) {
            pick.appendChild(tagChip(t, mine.includes(t.id), () => toggleTagOn(a.id, t.id)));
        }
        const plus = document.createElement('button');
        plus.className = 'tag-chip tag-chip-plus';
        plus.textContent = '+';
        plus.title = 'New tag';
        plus.addEventListener('click', (e) => { e.stopPropagation(); openNewTagPop(plus, a.id); });
        pick.appendChild(plus);
    }
}
