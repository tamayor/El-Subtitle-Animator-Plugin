// The preset list: variation stacks (several presets shown as one stacked card).

// ---------------------------------------------------------------- variation stacks
// Which variant sits on top of each stack (remembered per viewer).
function variantFronts() {
    if (!state.variantFront) {
        state.variantFront = store.getJSON('sa.variantFront', {}) || {};
    }
    return state.variantFront;
}
function setVariantFront(g, id) {
    variantFronts()[g] = id;
    store.set('sa.variantFront', JSON.stringify(state.variantFront));
}

const LAYERS_SVG = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M8 1.8 14.5 5 8 8.2 1.5 5z"/><path d="M1.5 8 8 11.2 14.5 8"/><path d="M1.5 11 8 14.2 14.5 11"/></svg>';

// opts: axis 'x' (default) or 'y' for the swipe that flips variants; onPick(a) replaces the click; onFlip(a) after a flip.
function variantStackCard(members, g, opts) {
    opts = opts || {};
    const axis = opts.axis === 'y' ? 'y' : 'x';
    let idx = members.findIndex(m => m.id === state.selectedId);
    if (idx < 0) idx = Math.max(0, members.findIndex(m => m.id === variantFronts()[g]));
    const c = document.createElement('div');
    c.className = 'card var-stack' + (members.length > 2 ? ' var-3' : '');
    c.title = (axis === 'y' ? 'Swipe up / down' : 'Swipe sideways') + ' (or use the arrows) to see the other variations';

    const prev = document.createElement('button');
    prev.type = 'button'; prev.className = 'var-nav var-prev'; prev.title = 'Previous variation';
    prev.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 2 4 8 10 14"></polyline></svg>';
    const next = document.createElement('button');
    next.type = 'button'; next.className = 'var-nav var-next'; next.title = 'Next variation';
    next.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 2 12 8 6 14"></polyline></svg>';
    const badge = document.createElement('span');
    badge.className = 'var-badge';
    const dots = document.createElement('span');
    dots.className = 'var-dots';
    const dotEls = members.map((m, i) => {
        const d = document.createElement('i');
        d.title = m.name;
        d.addEventListener('click', (e) => { e.stopPropagation(); show(i, i > idx ? 1 : -1); });
        dots.appendChild(d);
        return d;
    });

    const paint = (dir) => {
        const a = members[idx];
        c.dataset.id = a.id;
        c.textContent = '';
        fillPresetCard(c, a);
        c.classList.toggle('sel', members.some(m => m.id === state.selectedId));
        const wrap = c.querySelector('.thumb-wrap') || c;
        badge.innerHTML = LAYERS_SVG + '<b>' + (idx + 1) + '/' + members.length + '</b>';
        badge.title = members.length + ' variations: ' + members.map(m => m.name).join(', ');
        dotEls.forEach((d, i) => d.classList.toggle('on', i === idx));
        wrap.append(badge, dots, prev, next);
        if (dir) {
            wrap.classList.remove('var-in-l', 'var-in-r');
            void wrap.offsetWidth;
            wrap.classList.add(dir > 0 ? 'var-in-r' : 'var-in-l');
        }
    };

    const show = (i, dir) => {
        const n = members.length;
        i = ((i % n) + n) % n;
        if (i === idx) return;
        idx = i;
        const a = members[idx];
        setVariantFront(g, a.id);
        const wasSel = members.some(m => m.id === state.selectedId);
        if (wasSel) {
            // The stack is the selected card: the selection follows the variant on top (like the Gallery view).
            stopPreview();
            state.selectedId = a.id;
            syncUse(true);
            renderSettings();
            renderUseSummary();
            refreshLiveBar();
            if (state.livePrev && !state.busy) switchLivePreset(a);
        }
        paint(dir);
        if (opts.onFlip) opts.onFlip(a);
    };

    prev.addEventListener('click', (e) => { e.stopPropagation(); show(idx - 1, -1); });
    next.addEventListener('click', (e) => { e.stopPropagation(); show(idx + 1, 1); });

    // Two-finger trackpad swipe: one step per gesture.
    let acc = 0, locked = false, quiet = 0;
    c.addEventListener('wheel', (e) => {
        const along = axis === 'y' ? e.deltaY : e.deltaX, across = axis === 'y' ? e.deltaX : e.deltaY;
        if (Math.abs(along) <= Math.abs(across)) return;
        e.preventDefault();
        clearTimeout(quiet);
        quiet = setTimeout(() => { acc = 0; locked = false; }, 180);
        if (locked) return;
        acc += along;
        if (Math.abs(acc) > 30) { locked = true; show(idx + (acc > 0 ? 1 : -1), acc > 0 ? 1 : -1); acc = 0; }
    }, { passive: false });

    c.addEventListener('click', () => (opts.onPick || pickPresetCard)(members[idx]));
    wireCardStacking(c, () => members[idx], members);
    paint(0);
    return c;
}

// Drag a card onto another card to stack them as variations; right-click for the stack menu.
let stackDrag = null;
function wireCardStacking(c, front, members) {
    const cur = () => (typeof front === 'function' ? front() : front);
    c.draggable = true;
    c.addEventListener('dragstart', (e) => {
        stackDrag = members.slice();
        c.classList.add('var-dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', cur().id); } catch (err) { /* ignore */ }
    });
    const clear = () => c.classList.remove('over', 'drop-before', 'drop-after');
    // Where the drop lands: the outer edges of a card move the dragged card there; the middle stacks it.
    const zone = (e) => {
        const r = c.getBoundingClientRect();
        const vertical = state.useViewMode === 'list';
        const f = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
        return f < 0.28 ? 'before' : (f > 0.72 ? 'after' : 'stack');
    };
    const sameCard = () => !stackDrag || stackDrag.some(m => members.some(x => x.id === m.id));
    c.addEventListener('dragend', () => {
        stackDrag = null;
        c.classList.remove('var-dragging');
        document.querySelectorAll('#animGrid .card').forEach(x => x.classList.remove('over', 'drop-before', 'drop-after'));
    });
    c.addEventListener('dragover', (e) => {
        if (sameCard()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const z = zone(e);
        c.classList.toggle('over', z === 'stack');
        c.classList.toggle('drop-before', z === 'before');
        c.classList.toggle('drop-after', z === 'after');
    });
    c.addEventListener('dragleave', (e) => { if (!c.contains(e.relatedTarget)) clear(); });
    c.addEventListener('drop', (e) => {
        e.preventDefault();
        clear();
        if (sameCard()) { stackDrag = null; return; }
        const dragged = stackDrag, z = zone(e);
        stackDrag = null;
        if (z === 'stack') stackAsVariations(cur(), dragged);
        else moveInUseOrder(dragged, members, z === 'after');
    });
    c.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openVariantMenu(c, cur(), members);
    });
}

function newVariantGroupId() { return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Put `presets` into target's stack (making one if target isn't stacked yet).
async function stackAsVariations(target, presets) {
    const g = target.variantGroup || newVariantGroupId();
    let res = null;
    if (target.variantGroup !== g) res = await window.sa.updateAnimation(target.id, { variantGroup: g });
    // a whole stack dropped on a card brings every preset of that group, even ones hidden by the filter
    const ids = new Set(presets.map(p => p.id));
    for (const p of presets) if (p.variantGroup) for (const x of state.lib.animations) if (x.variantGroup === p.variantGroup) ids.add(x.id);
    for (const id of ids) if (id !== target.id) res = await window.sa.updateAnimation(id, { variantGroup: g });
    setVariantFront(g, target.id);
    if (res) takeLib(res);
    setStatus('Stacked ' + ids.size + ' preset' + (ids.size === 1 ? '' : 's') + ' with "' + target.name + '" as variations.', 'ok');
}

async function unstackVariation(a, all) {
    const g = a.variantGroup;
    if (!g) return;
    const group = state.lib.animations.filter(x => x.variantGroup === g);
    // the last one left on its own isn't a stack any more
    const clear = all || group.length <= 2 ? group : [a];
    let res = null;
    for (const x of clear) res = await window.sa.updateAnimation(x.id, { variantGroup: null });
    if (res) takeLib(res);
    setStatus(all ? 'Unstacked the variations.' : 'Took "' + a.name + '" out of its stack.', 'ok');
}

function openVariantMenu(anchor, a, members) {
    openPop(anchor, 'pop-menu', (el) => {
        const item = (icon, label, fn, cls) => {
            const it = document.createElement('button');
            it.className = 'pop-item' + (cls ? ' ' + cls : '');
            const ck = document.createElement('span'); ck.className = 'pop-check'; ck.textContent = icon;
            const n = document.createElement('span'); n.className = 'pop-label'; n.textContent = label;
            it.append(ck, n);
            it.addEventListener('click', () => { closePop(); fn(); });
            el.appendChild(it);
        };
        const head = document.createElement('div');
        head.className = 'pop-title'; head.textContent = 'Variations';
        el.appendChild(head);
        if (a.variantGroup) {
            item('\u2197', 'Remove "' + a.name + '" from stack', () => unstackVariation(a, false));
            item('\u2715', 'Unstack all ' + members.length, () => unstackVariation(a, true));
        }
        const head2 = document.createElement('div');
        head2.className = 'pop-title'; head2.textContent = a.variantGroup ? 'Add to this stack' : 'Stack as variation of\u2026';
        el.appendChild(head2);
        const seen = new Set();
        const others = state.lib.animations.filter(x => {
            if (members.includes(x) || (a.variantGroup && x.variantGroup === a.variantGroup)) return false;
            if (x.variantGroup) { if (seen.has(x.variantGroup)) return false; seen.add(x.variantGroup); }
            return true;
        });
        const scroll = document.createElement('div');
        scroll.className = 'pop-scroll';
        el.appendChild(scroll);
        for (const x of others) {
            const n = x.variantGroup ? state.lib.animations.filter(y => y.variantGroup === x.variantGroup).length : 0;
            const it = document.createElement('button');
            it.className = 'pop-item';
            const ck = document.createElement('span'); ck.className = 'pop-check'; ck.textContent = n ? '\u29C9' : '';
            const lb = document.createElement('span'); lb.className = 'pop-label';
            lb.textContent = x.name + (n ? '  (' + n + ')' : '');
            it.append(ck, lb);
            // Add-to-this-stack brings x (and its stack) here; otherwise this card joins x's stack.
            it.addEventListener('click', () => { closePop(); if (a.variantGroup) stackAsVariations(a, [x]); else stackAsVariations(x, members); });
            scroll.appendChild(it);
        }
        if (!others.length) {
            const e = document.createElement('div');
            e.className = 'pop-empty'; e.textContent = 'No other presets';
            el.appendChild(e);
        }
        const tip = document.createElement('div');
        tip.className = 'pop-empty';
        tip.textContent = 'Tip: drop a card on the middle of another to stack it, on its edge to move it.';
        el.appendChild(tip);
    });
}
