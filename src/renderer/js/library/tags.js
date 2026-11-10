// Tags (Finder-style: name + colour) and the tag filter.

// ---------------------------------------------------------------- tags (Finder-style: name + color)
const TAG_COLORS = ['#ff453a', '#ff9f0a', '#ffd60a', '#32d74b', '#0a84ff', '#bf5af2', '#8e8e93'];
const tagUI = { open: false, color: TAG_COLORS[4], filter: { use: [], lib: [], fx: [] } };

function allTags() { return Array.isArray(state.lib.tags) ? state.lib.tags : []; }
function tagById(id) { return allTags().find(t => t.id === id) || null; }
function tagsOf(a) { return (Array.isArray(a.tags) ? a.tags : []).map(tagById).filter(Boolean); }

// A preset passes the filter when it has any of the picked tags (no picks = show everything).
function passesTagFilter(a, key) {
    const f = tagUI.filter[key];
    if (!f.length) return true;
    const mine = Array.isArray(a.tags) ? a.tags : [];
    return f.some(id => mine.includes(id));
}

// A tag can carry up to EMOJI_MAX emoji, stored together as one string ("🔥💰").
const EMOJI_MAX = 4;
function emojiList(s) {
    s = String(s || '').replace(/\s+/g, '');
    if (!s) return [];
    let parts;
    try { parts = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), x => x.segment); } catch (e) { parts = Array.from(s); }
    return Array.from(new Set(parts)).slice(0, EMOJI_MAX);
}
// What was typed, pasted or picked, cut to at most EMOJI_MAX distinct emoji ('' clears it).
function cleanEmoji(s) { return emojiList(s).join(''); }

// A tag's mark: its emoji when it has one, otherwise its colour dot. Always has class tag-dot.
function tagMarkEl(t) {
    const d = document.createElement('span');
    if (t.emoji) {
        d.className = 'tag-dot tag-emoji';
        d.textContent = t.emoji;
    } else {
        d.className = 'tag-dot';
        d.style.background = t.color;
    }
    return d;
}

function tagLabel(t) { return (t.emoji ? t.emoji + ' ' : '') + t.name; }

function tagDotsEl(a) {
    const tags = tagsOf(a);
    if (!tags.length) return null;
    const w = document.createElement('span');
    w.className = 'tag-dots';
    w.title = tags.map(tagLabel).join(', ');
    for (const t of tags.slice(0, 5)) w.appendChild(tagMarkEl(t));
    return w;
}

// Library row: the preset's tags as small labelled pills (emoji or colour dot + name).
function libTagsEl(a) {
    const tags = tagsOf(a);
    if (!tags.length) return null;
    const w = document.createElement('div');
    w.className = 'lib-tags';
    for (const t of tags) {
        const p = document.createElement('i');
        p.className = 'lib-tag';
        p.style.setProperty('--chip', t.color);
        const n = document.createElement('i');
        n.className = 'lib-tag-name';
        n.textContent = t.name;
        p.append(tagMarkEl(t), n);
        w.appendChild(p);
    }
    return w;
}

function tagChip(t, on, onClick) {
    const b = document.createElement('button');
    b.className = 'tag-chip' + (on ? ' on' : '');
    b.style.setProperty('--chip', t.color);
    const d = tagMarkEl(t);
    const n = document.createElement('span');
    n.textContent = t.name;
    b.append(d, n);
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
}

// The dropdown filter button above a list; clicking opens dropdown to toggle tags.
function renderTagFilter(key, boxId) {
    const box = $(boxId);
    if (!box) return;
    const tags = allTags();
    const f = tagUI.filter[key] = tagUI.filter[key].filter(id => tagById(id));
    box.textContent = '';
    if (!tags.length) return;

    const btn = document.createElement('button');
    btn.className = 'tag-filter-btn' + (f.length ? ' active' : '');

    // Label & count
    let label = 'Filter tags';
    if (f.length === 0) {
        label = 'All Tags';
    } else if (f.length === 1) {
        const t = tagById(f[0]);
        label = t ? tagLabel(t) : '1 Tag';
    } else {
        label = f.length + ' Tags';
    }

    // Dot indicators inside dropdown button
    if (f.length > 0) {
        const dotsWrap = document.createElement('span');
        dotsWrap.className = 'tag-dots';
        for (const tid of f.slice(0, 4)) {
            const t = tagById(tid);
            if (t) dotsWrap.appendChild(tagMarkEl(t));
        }
        btn.appendChild(dotsWrap);
    } else {
        const icon = document.createElement('span');
        icon.className = 'tag-filter-icon';
        icon.textContent = '🏷️';
        btn.appendChild(icon);
    }

    const txt = document.createElement('span');
    txt.className = 'tag-filter-label';
    txt.textContent = label;
    btn.appendChild(txt);

    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '▾';
    btn.appendChild(chev);

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPop(btn, 'pop-menu pop-tagfilter', (el) => {
            const head = document.createElement('div');
            head.className = 'pop-title';
            head.textContent = 'Filter by Tags';
            el.appendChild(head);

            // 'All' option
            const allItem = document.createElement('button');
            allItem.className = 'pop-item' + (f.length === 0 ? ' on' : '');
            const allCk = document.createElement('span');
            allCk.className = 'pop-check';
            allCk.textContent = '✓';
            const allLbl = document.createElement('span');
            allLbl.className = 'pop-label';
            allLbl.textContent = 'All (Show All)';
            allItem.append(allCk, allLbl);
            allItem.addEventListener('click', () => {
                tagUI.filter[key] = [];
                closePop();
                renderAll();
            });
            el.appendChild(allItem);

            const sep = document.createElement('div');
            sep.className = 'pop-sep';
            el.appendChild(sep);

            for (const t of tags) {
                const isSelected = f.includes(t.id);
                const it = document.createElement('button');
                it.className = 'pop-item' + (isSelected ? ' on' : '');
                const ck = document.createElement('span');
                ck.className = 'pop-check';
                ck.textContent = '✓';
                const d = tagMarkEl(t);
                const n = document.createElement('span');
                n.className = 'pop-label';
                n.textContent = t.name;
                const rm = document.createElement('span');
                rm.className = 'pop-rm'; rm.textContent = '×'; rm.title = 'Delete tag'; rm.setAttribute('role', 'button');
                rm.addEventListener('mousedown', (ev) => ev.stopPropagation());
                rm.addEventListener('click', (ev) => { ev.stopPropagation(); closePop(); deleteTagWithConfirm(t); });
                it.append(ck, d, n, rm);
                it.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const cur = tagUI.filter[key];
                    tagUI.filter[key] = cur.includes(t.id) ? cur.filter(x => x !== t.id) : cur.concat(t.id);
                    it.classList.toggle('on', tagUI.filter[key].includes(t.id));
                    allItem.classList.toggle('on', tagUI.filter[key].length === 0);
                    renderAll();
                });
                el.appendChild(it);
            }
        });
    });

    box.appendChild(btn);

    // If active filters, show an instant clear '×' chip
    if (f.length > 0) {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'ghost tag-filter-clear';
        clearBtn.textContent = 'Reset filter';
        clearBtn.addEventListener('click', () => {
            tagUI.filter[key] = [];
            renderAll();
        });
        box.appendChild(clearBtn);
    }
}

// In-panel confirmation dialog (resolves true when the confirm button is pressed).
function confirmDialog(opts) {
    return new Promise((resolve) => {
        const ov = document.createElement('div');
        ov.className = 'sa-dlg-ov';
        const box = document.createElement('div');
        box.className = 'sa-dlg';
        box.setAttribute('role', 'alertdialog');
        const h = document.createElement('div'); h.className = 'sa-dlg-title'; h.textContent = opts.title || 'Are you sure?';
        const m = document.createElement('div'); m.className = 'sa-dlg-msg'; m.textContent = opts.message || '';
        const row = document.createElement('div'); row.className = 'sa-dlg-btns';
        const no = document.createElement('button'); no.className = 'ghost'; no.textContent = opts.cancelLabel || 'Cancel';
        const yes = document.createElement('button'); yes.className = 'sa-dlg-danger'; yes.textContent = opts.confirmLabel || 'Delete';
        row.append(no, yes);
        box.append(h, m, row);
        ov.appendChild(box);
        const done = (v) => { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); done(false); }
            else if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); done(true); }
        };
        document.addEventListener('keydown', onKey, true);
        no.addEventListener('click', () => done(false));
        yes.addEventListener('click', () => done(true));
        ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(false); });
        document.body.appendChild(ov);
        no.focus();
    });
}

function tagUseCount(id) { return state.lib.animations.filter(a => (a.tags || []).includes(id)).length; }

// Asks first, then removes the tag from the list (and from every preset that has it).
async function deleteTagWithConfirm(t) {
    const n = tagUseCount(t.id);
    const ok = await confirmDialog({
        title: 'Delete tag "' + t.name + '"?',
        message: n ? ('It will be removed from ' + n + ' preset' + (n === 1 ? '' : 's') + '. The presets themselves are not deleted.')
            : 'No presets use this tag. This cannot be undone.',
        confirmLabel: 'Delete tag'
    });
    if (!ok) return false;
    tagUI.filter.use = tagUI.filter.use.filter(id => id !== t.id);
    tagUI.filter.lib = tagUI.filter.lib.filter(id => id !== t.id);
    await saveTagList(allTags().filter(y => y.id !== t.id));
    return true;
}

async function saveTagList(tags) {
    return takeLib(await window.sa.saveTags(tags));
}

function setTagsOpen(open) {
    tagUI.open = !!open;
    $('tagsBody').classList.toggle('hidden', !open);
    $('tagsWrap').classList.toggle('open', !!open);
    $('tagsToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    const chev = $('tagsToggle').querySelector('.chev');
    if (chev) chev.textContent = open ? '▾' : '▸';
}
