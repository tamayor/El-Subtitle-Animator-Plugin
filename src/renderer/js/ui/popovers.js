// Small floating popovers: menus, confirm and new-tag popovers.

// ---------------------------------------------------------------- small floating popovers (menus, new tag)
let popEl = null;
function closePop() {
    if (!popEl) return;
    popEl.remove();
    popEl = null;
    document.removeEventListener('mousedown', popOutside, true);
    document.removeEventListener('keydown', popKey, true);
    window.removeEventListener('resize', closePop);
}
function popOutside(e) { if (popEl && !popEl.contains(e.target) && !(popEl._anchor && popEl._anchor.contains(e.target))) closePop(); }
function popKey(e) { if (e.key === 'Escape') closePop(); }

// Opens a popover under `anchor`; build(el) fills it. Clicking the same anchor again closes it.
function openPop(anchor, cls, build) {
    const again = popEl && popEl._anchor === anchor && popEl._cls === cls;
    closePop();
    if (again) return null;
    const el = document.createElement('div');
    el.className = 'pop ' + cls;
    el._anchor = anchor; el._cls = cls;
    build(el);
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = Math.min(r.right - w, window.innerWidth - w - 8);
    if (left < 8) left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8 && r.top - h - 4 > 8) top = r.top - h - 4;
    el.style.left = left + window.scrollX + 'px';
    el.style.top = top + window.scrollY + 'px';
    popEl = el;
    document.addEventListener('mousedown', popOutside, true);
    document.addEventListener('keydown', popKey, true);
    window.addEventListener('resize', closePop);
    return el;
}

// A "more" (⋯) menu whose items are the buttons inside `source` (a hidden holder in the page). Each button keeps its
// own id, label, title and click handler; picking an item clicks it. Buttons with .hidden are left out, disabled ones
// are shown disabled, and .danger is carried over.
function bindProxyMenu(btn, source) {
    if (!btn || !source) return;
    btn.setAttribute('aria-haspopup', 'menu');
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPop(btn, 'pop-menu', (pop) => {
            pop.setAttribute('role', 'menu');
            const srcs = [...source.querySelectorAll('button')].filter(b => !b.classList.contains('hidden'));
            for (const src of srcs) {
                const item = createEl('button', { class: 'pop-item' + (src.classList.contains('danger') ? ' danger' : ''), type: 'button', role: 'menuitem', title: src.title || '' },
                    [createEl('span', 'pop-label', src.textContent.trim())]);
                item.disabled = src.disabled;
                item.addEventListener('click', () => { closePop(); src.click(); });
                pop.appendChild(item);
            }
            if (!srcs.length) pop.appendChild(createEl('div', 'pop-empty', 'Nothing to do here'));
        });
    });
}

function openConfirmPop(anchor, opts) {
    const { title = 'Confirm', message = '', confirmText = 'Delete', danger = true, onConfirm } = opts || {};
    return openPop(anchor, 'pop-confirm', (el) => {
        const t = document.createElement('div');
        t.className = 'pop-confirm-title';
        t.textContent = title;
        el.appendChild(t);

        if (message) {
            const m = document.createElement('div');
            m.className = 'pop-confirm-msg';
            m.textContent = message;
            el.appendChild(m);
        }

        const actions = document.createElement('div');
        actions.className = 'pop-confirm-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'ghost sm-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closePop();
        });

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = (danger ? 'danger sm-btn' : 'ghost sm-btn');
        okBtn.textContent = confirmText;
        okBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            closePop();
            if (typeof onConfirm === 'function') await onConfirm();
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(okBtn);
        el.appendChild(actions);
    });
}

// ---------------------------------------------------------------- emoji picker (multi-select, up to EMOJI_MAX per tag)
const EMOJI_SETS = [
    ['Popular', '🔥 💥 ⚡ ✨ 💯 ⭐ 🚀 🎯 ❤️ 👀 😂 😱 🤯 😎 🙌 👏 💪 🤝 👉 ✅ ❌ ⚠️ ❗ ❓'],
    ['Money', '💰 💵 💸 🤑 💎 🏆 📈 📉 💳 🏦 🪙 🧾 📊 🛒 🏷️ 💼'],
    ['Mood', '😀 😁 😅 🥹 😍 🤔 😤 😡 😭 😴 🥳 🤩 😬 🙃 😇 🤫'],
    ['Text & media', '🔤 🅰️ 📝 💬 🗯️ 💭 📢 📣 🔊 🎵 🎬 🎞️ 🎥 📺 🖼️ 🎨'],
    ['Layout', '⬆️ ⬇️ ⬅️ ➡️ ↕️ ↔️ 🔝 🔽 1️⃣ 2️⃣ 3️⃣ 🔢 📏 📐 🧱 🗂️'],
    ['Colour', '🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜'],
    ['Things', '🧠 💡 🔑 🔒 ⏰ ⏳ 📅 📍 🌍 🏠 🚗 ✈️ 🍔 ☕ 🎁 🧩']
].map(([name, s]) => [name, s.split(' ')]);
const EMOJI_RECENT_KEY = 'sa.emoji.recent';
function emojiRecent() { const r = store.getJSON(EMOJI_RECENT_KEY, []); return Array.isArray(r) ? r.slice(0, 16) : []; }
function emojiRemember(e) { store.set(EMOJI_RECENT_KEY, JSON.stringify([e].concat(emojiRecent().filter(x => x !== e)).slice(0, 16))); }

// Fills `el` with the picker. Clicking an emoji toggles it; onChange gets the new emoji string ('' = none).
function buildEmojiPicker(el, initial, onChange) {
    let sel = emojiList(initial);
    const wrap = document.createElement('div');
    wrap.className = 'emoji-picker';

    const head = document.createElement('div');
    head.className = 'emoji-sel';
    const grids = [];
    const set = (list) => {
        sel = list.slice(0, EMOJI_MAX);
        paintHead();
        for (const b of grids) b.classList.toggle('on', sel.includes(b.dataset.e));
        onChange(sel.join(''));
    };
    const toggle = (e) => {
        if (sel.includes(e)) set(sel.filter(x => x !== e));
        else if (sel.length < EMOJI_MAX) { emojiRemember(e); set(sel.concat(e)); }
        else set(sel.slice(1).concat(e));      // full: the oldest one makes room
    };
    function paintHead() {
        head.textContent = '';
        const lbl = document.createElement('span');
        lbl.className = 'emoji-sel-label';
        lbl.textContent = sel.length ? '' : 'No emoji (colour dot)';
        head.appendChild(lbl);
        for (const e of sel) {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'emoji-sel-item'; b.textContent = e; b.title = 'Remove';
            b.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(e); });
            head.appendChild(b);
        }
        const n = document.createElement('span');
        n.className = 'emoji-sel-count';
        n.textContent = sel.length + '/' + EMOJI_MAX;
        head.appendChild(n);
        if (sel.length) {
            const clr = document.createElement('button');
            clr.type = 'button'; clr.className = 'ghost emoji-clear'; clr.textContent = 'Clear';
            clr.addEventListener('click', (ev) => { ev.stopPropagation(); set([]); });
            head.appendChild(clr);
        }
    }
    paintHead();

    // type / paste, or the macOS Character Viewer (it types into this field)
    const row = document.createElement('div');
    row.className = 'emoji-input-row';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.placeholder = 'Type or paste emoji'; inp.autocomplete = 'off';
    inp.addEventListener('input', () => {
        const got = emojiList(inp.value);
        if (!got.length) return;
        inp.value = '';
        let next = sel.slice();
        for (const e of got) if (!next.includes(e)) { emojiRemember(e); next = next.concat(e); }
        set(next.slice(-EMOJI_MAX));
    });
    inp.addEventListener('keydown', (e) => e.stopPropagation());
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'ghost emoji-more'; more.textContent = 'All emoji…';
    more.title = 'Open the macOS emoji picker (Ctrl+Cmd+Space)';
    more.addEventListener('click', (ev) => {
        ev.stopPropagation();
        inp.focus();
        if (window.sa && window.sa.showEmojiPanel) window.sa.showEmojiPanel();
    });
    row.append(inp, more);

    const body = document.createElement('div');
    body.className = 'emoji-body';
    const recent = emojiRecent();
    const sections = (recent.length ? [['Recent', recent]] : []).concat(EMOJI_SETS);
    for (const [name, list] of sections) {
        const h = document.createElement('div');
        h.className = 'emoji-cat';
        h.textContent = name;
        const g = document.createElement('div');
        g.className = 'emoji-grid';
        for (const e of list) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'emoji-cell' + (sel.includes(e) ? ' on' : '');
            b.dataset.e = e; b.textContent = e;
            b.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(e); });
            grids.push(b);
            g.appendChild(b);
        }
        body.append(h, g);
    }
    wrap.append(head, row, body);
    el.appendChild(wrap);
    return wrap;
}

// A tag row's emoji button: opens the picker and saves each change straight away.
function openTagEmojiPop(anchor, t) {
    openPop(anchor, 'pop-emoji', (el) => {
        const title = document.createElement('div');
        title.className = 'pop-title';
        title.textContent = 'Emoji for "' + t.name + '"';
        el.appendChild(title);
        let timer = 0;
        buildEmojiPicker(el, t.emoji, (v) => {
            anchor.textContent = v || '☺';
            anchor.classList.toggle('empty', !v);
            clearTimeout(timer);
            timer = setTimeout(() => saveTagList(allTags().map(x => x.id === t.id ? Object.assign({}, x, { emoji: v }) : x)), 250);
        });
    });
}

// "New tag" popover: pick a color, type a name. assignTo = preset id that gets the new tag right away.
function openNewTagPop(anchor, assignTo) {
    let color = tagUI.color;
    openPop(anchor, 'pop-newtag', (el) => {
        const title = document.createElement('div');
        title.className = 'pop-title'; title.textContent = 'New tag';
        const sw = document.createElement('div');
        sw.className = 'tag-swatches';
        // optional emoji: the button opens the picker inside this popover
        let emoji = '';
        let picker = null;
        const em = document.createElement('button');
        em.type = 'button'; em.className = 'tag-emoji-btn empty'; em.textContent = '☺';
        em.title = 'Add emoji (up to ' + EMOJI_MAX + ')';
        em.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (picker) { picker.remove(); picker = null; return; }
            picker = buildEmojiPicker(el, emoji, (v) => {
                emoji = v;
                em.textContent = v || '☺';
                em.classList.toggle('empty', !v);
            });
        });
        const inp = document.createElement('input');
        inp.type = 'text'; inp.placeholder = 'Tag name'; inp.maxLength = 40; inp.autocomplete = 'off';
        const add = document.createElement('button');
        add.className = 'tag-add'; add.textContent = 'Add';
        const paint = () => {
            sw.textContent = '';
            for (const c of TAG_COLORS) {
                const s = document.createElement('button');
                s.className = 'tag-swatch' + (color === c ? ' on' : '');
                s.style.background = c; s.title = c;
                s.addEventListener('click', () => { color = c; paint(); inp.focus(); });
                sw.appendChild(s);
            }
            const custom = document.createElement('label');
            custom.className = 'tag-swatch custom' + (TAG_COLORS.includes(color) ? '' : ' on');
            custom.title = 'Custom color';
            const ci = document.createElement('input');
            ci.type = 'color'; ci.value = color;
            ci.addEventListener('change', () => { color = ci.value.toLowerCase(); paint(); });
            custom.appendChild(ci);
            sw.appendChild(custom);
            add.style.setProperty('--chip', color);
        };
        paint();
        const go = async () => {
            const name = inp.value.trim();
            if (!name) { inp.focus(); return; }
            if (allTags().some(t => t.name.toLowerCase() === name.toLowerCase())) {
                inp.setCustomValidity('A tag named "' + name + '" already exists.');
                inp.reportValidity();
                inp.addEventListener('input', () => inp.setCustomValidity(''), { once: true });
                return;
            }
            tagUI.color = color;
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            closePop();
            if (await saveTagList(allTags().concat({ id, name, color, emoji: cleanEmoji(emoji) })) && assignTo) {
                const a = libEntry(assignTo);
                if (a) takeLib(await window.sa.updateAnimation(a.id, { tags: (a.tags || []).concat(id) }));
            }
        };
        add.addEventListener('click', go);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        const row = document.createElement('div');
        row.className = 'tag-new-row';
        row.append(em, inp, add);
        el.append(title, sw, row);
        setTimeout(() => inp.focus(), 0);
    });
}
