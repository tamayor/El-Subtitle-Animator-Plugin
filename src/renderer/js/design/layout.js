// Text / Shading Elements / Layout tabs and the Text+ Layout tab.

// ---- Text / Shading Elements / Layout tabs of the Text & Shading Design panel
const tdTabSel = { U: 'text', C: 'text' };
function applyTdTab(S) {
    const tabs = $('tdTabs' + S);
    const panel = tabs ? tabs.closest('.td-panel') : null;
    if (!panel) return;
    const want = tdTabSel[S] || 'text';
    panel.querySelectorAll('.td-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === want));
    panel.querySelectorAll('.td-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== want));
}
document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.td-tab');
    if (!b || !b.parentElement || !b.parentElement.id) return;
    const S = b.parentElement.id.slice(-1);
    tdTabSel[S] = b.dataset.tab;
    applyTdTab(S);
});

// ---- Text+ Layout tab (Type, Center, Center Z, Pivot, Pivot Z, Size, Perspective)
const LAYOUT_FIELDS = [
    // [key, slider id, number id, Fusion input, decimals]
    ['centerZ', 'lyCz', 'lyCzN', 'CenterZ', 2],
    ['pivotZ', 'lyPz', 'lyPzN', 'PivotZ', 2],
    ['size', 'lySize', 'lySizeN', 'LayoutSize', 2],
    ['perspective', 'lyPersp', 'lyPerspN', 'Perspective', 2]
];
const ANIMATED_TIP = 'Animated in this preset: its keyframes are kept, so this value cannot be overridden here';
function layoutOf(td) {
    if (!td.layout || typeof td.layout !== 'object') td.layout = { type: 0, centerZ: 0, pivotX: 0.5, pivotY: 0.5, pivotZ: 0, size: 1, perspective: 1, animated: [] };
    return td.layout;
}
function lockField(el, locked) {
    if (!el) return;
    el.disabled = !!locked;
    if (locked) el.title = ANIMATED_TIP; else if (el.title === ANIMATED_TIP) el.title = '';
}
function setNum(el, v, dec) {
    if (!el || document.activeElement === el) return;
    el.value = Number(v).toFixed(dec);
}
function fillLayout(S, td) {
    const L = layoutOf(td);
    const anim = new Set(Array.isArray(L.animated) ? L.animated : []);
    const ty = $('lyType' + S);
    if (ty && document.activeElement !== ty) ty.value = String(Math.round(Number(L.type) || 0));
    lockField(ty, anim.has('LayoutType'));
    const pc = window.SABoxes ? SABoxes.primaryCenter(S) : null;
    setNum($('lyCx' + S), pc ? pc.cx : 0.5, 3);
    setNum($('lyCy' + S), pc ? pc.cy : 0.5, 3);
    const cLocked = !pc || !pc.movable || anim.has('Center');
    lockField($('lyCx' + S), cLocked);
    lockField($('lyCy' + S), cLocked);
    setNum($('lyPx' + S), L.pivotX, 3);
    setNum($('lyPy' + S), L.pivotY, 3);
    lockField($('lyPx' + S), anim.has('Pivot'));
    lockField($('lyPy' + S), anim.has('Pivot'));
    for (const [key, sid, nid, input, dec] of LAYOUT_FIELDS) {
        const v = Number(L[key]);
        const sl = $(sid + S);
        if (sl && document.activeElement !== sl) sl.value = v;
        setNum($(nid + S), v, dec);
        lockField(sl, anim.has(input));
        lockField($(nid + S), anim.has(input));
    }
}
function bindLayout(ctx, commit) {
    const S = ctx.s;
    const L = () => { const m = ctx.model(); const td = editTD(m, S); return td ? layoutOf(td) : null; };
    const ty = $('lyType' + S);
    if (ty) ty.addEventListener('change', () => { const l = L(); if (!l) return; l.type = Number(ty.value) || 0; commit(); });
    for (const [key, sid, nid, , dec] of LAYOUT_FIELDS) {
        const sl = $(sid + S), nm = $(nid + S);
        if (sl) sl.addEventListener('input', () => {
            const l = L(); if (!l) return;
            l[key] = Number(sl.value);
            if (nm) nm.value = l[key].toFixed(dec);
            commit();
        });
        if (nm) nm.addEventListener('change', () => {
            const l = L(); if (!l) return;
            const v = Number(nm.value);
            if (isNaN(v)) { nm.value = Number(l[key]).toFixed(dec); return; }
            l[key] = v;
            if (sl) sl.value = v;
            commit();
        });
    }
    for (const [axis, id] of [['pivotX', 'lyPx'], ['pivotY', 'lyPy']]) {
        const el = $(id + S);
        if (el) el.addEventListener('change', () => {
            const l = L(); if (!l) return;
            const v = Number(el.value);
            if (isNaN(v)) { el.value = Number(l[axis]).toFixed(3); return; }
            l[axis] = v;
            commit();
        });
    }
    for (const id of ['lyCx', 'lyCy']) {
        const el = $(id + S);
        if (el) el.addEventListener('change', () => {
            const cx = Number($('lyCx' + S).value), cy = Number($('lyCy' + S).value);
            if (isNaN(cx) || isNaN(cy) || !window.SABoxes) return;
            SABoxes.setPrimaryCenter(S, cx, cy);
        });
    }
}
