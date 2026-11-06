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

// "New tag" popover: pick a color, type a name. assignTo = preset id that gets the new tag right away.
function openNewTagPop(anchor, assignTo) {
    let color = tagUI.color;
    openPop(anchor, 'pop-newtag', (el) => {
        const title = document.createElement('div');
        title.className = 'pop-title'; title.textContent = 'New tag';
        const sw = document.createElement('div');
        sw.className = 'tag-swatches';
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
            if (await saveTagList(allTags().concat({ id, name, color })) && assignTo) {
                const a = libEntry(assignTo);
                if (a) takeLib(await window.sa.updateAnimation(a.id, { tags: (a.tags || []).concat(id) }));
            }
        };
        add.addEventListener('click', go);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        const row = document.createElement('div');
        row.className = 'tag-new-row';
        row.append(inp, add);
        el.append(title, sw, row);
        setTimeout(() => inp.focus(), 0);
    });
}
