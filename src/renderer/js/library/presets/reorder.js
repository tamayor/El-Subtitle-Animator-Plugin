// The preset list: drag to reorder tags and presets.

// Tags grid: drag a tag by its handle. The tile follows the pointer and the other tiles reflow live
// around its slot (animated); the new order is saved on release.
function startTagDrag(e, rowEl, list) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const tiles = () => Array.from(list.querySelectorAll(':scope > .tag-row'));
    const startX = e.clientX, startY = e.clientY;
    let px = startX, py = startY;
    const start = rowEl.getBoundingClientRect();
    rowEl.classList.add('dragging');
    document.body.classList.add('tag-dragging');
    // FLIP: move the dragged tile in the DOM, then slide every other tile from its old spot to its new one
    const reflow = (mutate) => {
        const before = new Map(tiles().filter(r => r !== rowEl).map(r => [r, r.getBoundingClientRect()]));
        mutate();
        for (const [r, b] of before) {
            const n = r.getBoundingClientRect();
            const dx = b.left - n.left, dy = b.top - n.top;
            if (!dx && !dy) continue;
            r.style.transition = 'none';
            r.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
            r.getBoundingClientRect();
            r.style.transition = 'transform 0.16s ease';
            r.style.transform = '';
        }
    };
    const origin = { x: start.left, y: start.top };   // where the tile sat when the pointer went down
    const place = () => {
        const r = rowEl.getBoundingClientRect();
        const base = { x: r.left - parseFloat(rowEl.dataset.dx || 0), y: r.top - parseFloat(rowEl.dataset.dy || 0) };
        const dx = (origin.x + px - startX) - base.x, dy = (origin.y + py - startY) - base.y;
        rowEl.dataset.dx = dx; rowEl.dataset.dy = dy;
        rowEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    };
    const move = (ev) => {
        px = ev.clientX; py = ev.clientY;
        // the tile under the pointer (by its resting box) takes the dragged tile before or after it
        for (const r of tiles()) {
            if (r === rowEl) continue;
            const b = r.getBoundingClientRect();
            if (px < b.left || px > b.right || py < b.top || py > b.bottom) continue;
            const after = px > b.left + b.width / 2;
            if (after ? r.nextElementSibling !== rowEl : r.previousElementSibling !== rowEl) {
                reflow(() => (after ? r.after(rowEl) : r.before(rowEl)));
            }
            break;
        }
        place();
    };
    const up = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        rowEl.classList.remove('dragging');
        rowEl.style.transform = '';
        delete rowEl.dataset.dx; delete rowEl.dataset.dy;
        document.body.classList.remove('tag-dragging');
        const ids = tiles().map(r => r.dataset.tagId);
        const current = allTags().slice();
        if (ids.join('|') === current.map(x => x.id).join('|')) return;
        const byId = new Map(current.map(x => [x.id, x]));
        saveTagList(ids.map(id => byId.get(id)).filter(Boolean));
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
}

// Library: drag a preset by its handle to a new place in the list; the order is saved and used everywhere.
function startLibDrag(e, rowEl, a, list) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const scroller = (() => {
        for (let el = list.parentElement; el; el = el.parentElement) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
        }
        return document.scrollingElement;
    })();
    const startY = e.clientY, startScroll = scroller.scrollTop;
    let lastY = startY, target = null, timer = 0;
    const rows = () => Array.from(list.querySelectorAll(':scope > .libitem')).filter(r => r !== rowEl);
    const line = document.createElement('div');
    line.className = 'lib-drop-line';
    rowEl.classList.add('dragging');
    document.body.classList.add('lib-dragging');
    const update = () => {
        rowEl.style.transform = 'translateY(' + (lastY - startY + scroller.scrollTop - startScroll) + 'px)';
        const others = rows();
        target = null;
        for (const r of others) {
            const b = r.getBoundingClientRect();
            if (lastY < b.top + b.height / 2) { target = r; break; }
        }
        if (target) target.before(line);
        else if (others.length) others[others.length - 1].after(line);
    };
    const tick = () => {
        const sb = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
        let d = 0;
        if (lastY < sb.top + 36) d = -10; else if (lastY > sb.bottom - 36) d = 10;
        if (d) { scroller.scrollTop += d; update(); }
    };
    const move = (ev) => { lastY = ev.clientY; update(); };
    const up = async () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        clearInterval(timer);
        const ids = rows().map(r => r.dataset.id);
        const at = target ? ids.indexOf(target.dataset.id) : ids.length;
        ids.splice(at < 0 ? ids.length : at, 0, a.id);
        line.remove();
        rowEl.classList.remove('dragging');
        rowEl.style.transform = '';
        document.body.classList.remove('lib-dragging');
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener('click', swallow, true);
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);
        // The shown rows (maybe filtered by tag) take the slots those presets already had in the full list.
        const full = state.lib.animations.map(x => x.id);
        const shownSet = new Set(Array.from(list.querySelectorAll(':scope > .libitem')).map(r => r.dataset.id));
        const queue = ids.slice();
        const next = full.map(id => shownSet.has(id) ? queue.shift() : id);
        if (next.join('|') === full.join('|')) return;
        const byId = new Map(state.lib.animations.map(x => [x.id, x]));
        state.lib.animations = next.map(id => byId.get(id)).filter(Boolean);
        renderAll();
        takeLib(await window.sa.reorderAnimations(next));
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
    timer = setInterval(tick, 30);
    update();
}
