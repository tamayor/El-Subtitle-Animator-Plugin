// Frame range bar: the one two-head slider used for frame ranges inside a clip (css/frame-range.css).
// Used by the Effect presets' Transform Start / End and Spotlight In / Out (js/library/effect-list.js fxFrameRange) and
// the B-roll tab's animation In (js/library/broll-tab.js). Hollow left head = start, solid right head = end, the range
// between them (drag it to shift both), and the red Resolve playhead, which follows Resolve while the bar is on
// screen. Heads snap to the playhead. Keys: arrows 1 frame (Shift 5), Alt moves both, S / E pick a head, P = playhead,
// Home / End. Double-click: opts.dflt.
//
// opts:
//   last()              last frame index of the clip (the bar spans 0..last)
//   get()               the current { s, e }
//   change(s, e, final) while dragging (final false) and on release / key / double-click (final true)
//   read(s, e, last)    html for the read-out under the bar
//   playhead()          the playhead frame relative to the clip start, or null when it is not inside the clip
//   dflt(last)          { s, e } for double-click (default: the whole clip)
//   lane()              optional: { segs: [{ s, e, label, key, title }], editable } drawn as a word lane under the bar
//                       (the subtitle as one block, or one block per word), or null for none. Editable lanes: each
//                       word's strawberry left edge = its in, matcha right edge = its end; drag an edge, or the block
//                       to move both (snaps to the playhead); double-click the lane = laneReset()
//   laneEdit(i, s, e, final)  a word block was changed (final on release); laneReset()
//   title, onSlide(sliding)
// Returns { el, paint }: call paint() when get() or last() changed from outside.
const FRB_SNAP_PX = 10, FRB_HEAD_PX = 10;

// Word lane: a row of word blocks (.fxr-lane) aligned to 0..last(), with optional edge/block dragging and a playhead
// line. Used by frameRangeBar below and by the Use tab's Animation timing card (js/timeline/anim-timing.js).
// opts: { last, playhead, lane, laneEdit, laneReset, onDrag(dragging) }
function wordLane(opts) {
    const lane = document.createElement('div'); lane.className = 'fxr-lane hidden';
    const lanePh = document.createElement('div'); lanePh.className = 'fxr-ph fxr-lane-ph hidden';
    let laneKey = '', laneSegs = [], laneEditable = false, laneDrag = null;
    const lastOf = () => Math.max(1, Math.round(Number(opts.last()) || 1));
    const at = () => { const v = opts.playhead ? opts.playhead() : null; return Number.isFinite(v) ? Math.round(v) : null; };
    const pct = (f, L) => (Math.max(0, Math.min(1, f / L)) * 100) + '%';

    const paint = () => {
        const L = lastOf();
        const a = at();
        const showPh = a !== null && a >= 0 && a <= L;
        lanePh.classList.toggle('hidden', !showPh);
        if (showPh) lanePh.style.left = pct(a, L);

        if (!laneDrag) {
            const d = opts.lane ? opts.lane() : null;
            laneSegs = d && Array.isArray(d.segs) ? d.segs.map(g => ({ ...g })) : [];
            laneEditable = !!(d && d.editable && opts.laneEdit);
        }
        const segs = laneSegs;
        const key = L + '|' + laneEditable + '|' + JSON.stringify(segs);
        if (key === laneKey) return;
        laneKey = key;
        lane.textContent = '';
        lane.classList.toggle('hidden', !segs.length);
        lane.classList.toggle('editable', laneEditable);
        segs.forEach((g, i) => {
            const s = Math.max(0, Math.min(L, Math.round(g.s))), e = Math.max(s, Math.min(L, Math.round(g.e)));
            const x = document.createElement('div');
            x.className = 'fxr-seg' + (i === 0 ? ' first' : '') + (i === segs.length - 1 ? ' last' : '') + (g.key ? ' key' : '') +
                (g.locked ? ' locked' : '') + (laneDrag && laneDrag.i === i ? ' on' : '');
            x.dataset.i = String(i);
            x.style.left = pct(s, L); x.style.width = ((e - s) / L * 100) + '%';
            x.textContent = g.label || '';
            x.title = g.build ? ('“' + (g.label || '') + '” · the build starts ' + s + ' f → lands ' + e + ' f · drag the edges or the block')
                : laneEditable && !g.locked ? ('“' + (g.label || '') + '” · in ' + s + ' f → end ' + e + ' f · drag the edges or the word')
                : (g.title || ('“' + (g.label || '') + '” · ' + s + '–' + e + ' f'));
            lane.appendChild(x);
        });
        lane.appendChild(lanePh);
    };

    // editing a word block: left edge = in, right edge = end, middle = move both (snaps to the playhead)
    lane.addEventListener('pointerdown', (x) => {
        if (x.button !== 0 || !laneEditable) return;
        const el = x.target.closest('.fxr-seg');
        if (!el) return;
        x.stopPropagation(); x.preventDefault();
        const i = Number(el.dataset.i), g = laneSegs[i];
        if (!g || g.locked) return;
        const rc = el.getBoundingClientRect(), b = lane.getBoundingClientRect(), L = lastOf();
        const edge = Math.min(6, rc.width / 3);
        const part = x.clientX - rc.left <= edge ? 's' : rc.right - x.clientX <= edge ? 'e' : 'm';
        const f0 = Math.round((x.clientX - b.left) / Math.max(1, b.width) * L);
        laneDrag = { i, part, f0, s0: Math.round(g.s), e0: Math.round(g.e) };
        lane.setPointerCapture(x.pointerId);
        lane.classList.add('dragging');
        if (opts.onDrag) opts.onDrag(true);
        laneKey = '';
        paint();
    });
    lane.addEventListener('pointermove', (x) => {
        if (!laneDrag) return;
        const b = lane.getBoundingClientRect(), L = lastOf(), d = laneDrag, g = laneSegs[d.i];
        let f = Math.round((x.clientX - b.left) / Math.max(1, b.width) * L);
        const a = at(), near = (q) => a !== null && Math.abs((q - a) / L * b.width) <= FRB_SNAP_PX;
        let s = d.s0, e = d.e0;
        if (d.part === 's') { if (near(f)) f = a; s = Math.max(0, Math.min(d.e0 - 1, f)); }
        else if (d.part === 'e') { if (near(f)) f = a; e = Math.max(d.s0 + 1, Math.min(L, f)); }
        else {
            const len = d.e0 - d.s0;
            s = d.s0 + (f - d.f0);
            if (near(s)) s = a; else if (near(s + len)) s = a - len;
            s = Math.max(0, Math.min(L - len, s)); e = s + len;
        }
        if (s === g.s && e === g.e) return;
        g.s = s; g.e = e;
        laneKey = '';
        paint();
        opts.laneEdit(d.i, s, e, false);
    });
    const laneEnd = (x) => {
        if (!laneDrag) return;
        try { lane.releasePointerCapture(x.pointerId); } catch (err) { /* ignore */ }
        const d = laneDrag, g = laneSegs[d.i];
        laneDrag = null;
        lane.classList.remove('dragging');
        if (opts.onDrag) opts.onDrag(false);
        laneKey = '';
        if (g && (g.s !== d.s0 || g.e !== d.e0)) opts.laneEdit(d.i, g.s, g.e, true);
        paint();
    };
    lane.addEventListener('pointerup', laneEnd);
    lane.addEventListener('pointercancel', laneEnd);
    lane.addEventListener('dblclick', () => { if (laneEditable && opts.laneReset) { opts.laneReset(); laneKey = ''; paint(); } });

    return { el: lane, paint, dragging: () => !!laneDrag };
}

function frameRangeBar(opts) {
    const box = document.createElement('div'); box.className = 'fxr';
    const bar = document.createElement('div'); bar.className = 'fxr-bar'; bar.tabIndex = 0;
    bar.title = opts.title || 'Drag a head to set the start or end, drag between them to shift both. Snaps to the playhead (P). Double-click: default';
    const mk = (cls) => { const x = document.createElement('div'); x.className = cls; bar.appendChild(x); return x; };
    mk('fxr-track');
    const range = mk('fxr-range');
    const ph = mk('fxr-ph hidden');
    const phLab = document.createElement('span'); ph.appendChild(phLab);
    const hs = mk('fxr-knob fxr-start'), he = mk('fxr-knob fxr-end');
    const read = document.createElement('div'); read.className = 'fxr-read';
    const wl = wordLane({
        last: opts.last,
        playhead: opts.playhead,
        lane: opts.lane,
        laneEdit: opts.laneEdit,
        laneReset: opts.laneReset,
    });
    box.append(bar, wl.el, read);

    let active = 'e', drag = null, r = { s: 0, e: 1 };
    const lastOf = () => Math.max(1, Math.round(Number(opts.last()) || 1));
    const at = () => { const v = opts.playhead ? opts.playhead() : null; return Number.isFinite(v) ? Math.round(v) : null; };
    const pull = () => {
        const L = lastOf(), g = opts.get() || {};
        const s = Math.max(0, Math.min(L - 1, Math.round(Number(g.s)) || 0));
        r = { s, e: Math.max(s + 1, Math.min(L, Math.round(Number(g.e)) || L)) };
    };
    const pct = (f, L) => (Math.max(0, Math.min(1, f / L)) * 100) + '%';
    const paintPh = (L) => {
        const a = at();
        const show = a !== null && a >= 0 && a <= L;
        ph.classList.toggle('hidden', !show);
        if (show) { ph.style.left = pct(a, L); phLab.textContent = a + ' f'; }
    };
    const draw = () => {
        const L = lastOf();
        range.style.left = pct(r.s, L); range.style.width = ((r.e - r.s) / L * 100) + '%';
        hs.style.left = pct(r.s, L); he.style.left = pct(r.e, L);
        hs.classList.toggle('on', !!drag && active !== 'e'); he.classList.toggle('on', !!drag && active !== 's');
        paintPh(L);
        wl.paint();
        read.innerHTML = opts.read ? opts.read(r.s, r.e, L) : 'Start <b>' + r.s + '</b> · End <b>' + r.e + '</b> <span class="fxr-len">/ ' + (L + 1) + ' f</span>';
    };
    const paint = () => { if (!drag) pull(); draw(); };
    const glide = () => { bar.classList.add('glide'); clearTimeout(bar._g); bar._g = setTimeout(() => bar.classList.remove('glide'), 220); };
    const apply = (part, v) => {
        const L = lastOf();
        v = Math.round(v);
        if (part === 'm') { const d = r.e - r.s; r.s = Math.max(0, Math.min(L - d, v)); r.e = r.s + d; }
        else if (part === 's') r.s = Math.max(0, Math.min(r.e - 1, v));
        else r.e = Math.max(r.s + 1, Math.min(L, v));
    };
    const emit = (final) => opts.change(r.s, r.e, final);
    const frameAt = (x, part, grab) => {
        const b = bar.getBoundingClientRect(), L = lastOf();
        const px = Math.max(0, Math.min(b.width, x - b.left));
        let f = Math.round(px / Math.max(1, b.width) * L) - (part === 'm' ? grab : 0);
        const a = at();
        let snap = false;
        if (a !== null) {
            const toPx = (q) => q / L * b.width;
            const edges = part === 'm' ? [[0, f], [r.e - r.s, f + r.e - r.s]] : [[0, f]];
            let best = FRB_SNAP_PX + 1;
            for (const [off, q] of edges) { const d = Math.abs(toPx(q) - toPx(a)); if (d <= FRB_SNAP_PX && d < best) { best = d; f = a - off; snap = true; } }
        }
        return { f, snap };
    };

    for (const ev of ['click', 'mousedown']) bar.addEventListener(ev, (x) => x.stopPropagation());
    bar.addEventListener('pointerdown', (x) => {
        if (x.button !== 0) return;
        x.stopPropagation();
        pull();
        bar.setPointerCapture(x.pointerId); bar.focus();
        const b = bar.getBoundingClientRect(), L = lastOf(), px = x.clientX - b.left, toPx = (q) => q / L * b.width;
        const dS = Math.abs(px - toPx(r.s)), dE = Math.abs(px - toPx(r.e));
        let part;
        if (Math.min(dS, dE) <= FRB_HEAD_PX) part = dS < dE || (dS === dE && px < toPx(r.s)) ? 's' : 'e';
        else if (px > toPx(r.s) && px < toPx(r.e)) part = 'm';
        else part = dS < dE ? 's' : 'e';
        drag = { part, grab: part === 'm' ? Math.round(px / Math.max(1, b.width) * L) - r.s : 0, snap: false };
        active = part;
        bar.classList.add('dragging');
        if (opts.onSlide) opts.onSlide(true);
        if (part !== 'm') { const q = frameAt(x.clientX, part, 0); drag.snap = q.snap; apply(part, q.f); glide(); emit(false); }
        draw();
    });
    bar.addEventListener('pointermove', (x) => {
        if (!drag) return;
        const q = frameAt(x.clientX, drag.part, drag.grab);
        if (q.snap !== drag.snap) glide();
        drag.snap = q.snap;
        ph.classList.toggle('hot', q.snap);
        const before = r.s + ':' + r.e;
        apply(drag.part, q.f);
        if (r.s + ':' + r.e !== before) { draw(); emit(false); }
    });
    const end = (x) => {
        if (!drag) return;
        try { bar.releasePointerCapture(x.pointerId); } catch (err) { /* ignore */ }
        drag = null;
        if (opts.onSlide) opts.onSlide(false);
        bar.classList.remove('dragging'); ph.classList.remove('hot');
        glide(); draw(); emit(true);
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('dblclick', () => {
        const L = lastOf(), q = opts.dflt ? opts.dflt(L) : { s: 0, e: L };
        r = { s: q.s, e: q.e }; apply('s', q.s); apply('e', q.e);
        glide(); draw(); emit(true);
    });
    bar.addEventListener('keydown', (x) => {
        pull();
        const L = lastOf(), step = x.shiftKey ? 5 : 1;
        let part = x.altKey ? 'm' : (active === 's' ? 's' : 'e');
        const base = part === 'e' ? r.e : r.s;
        let v = null;
        if (x.key === 'ArrowLeft') v = base - step;
        else if (x.key === 'ArrowRight') v = base + step;
        else if (x.key === 'Home') v = 0;
        else if (x.key === 'End') v = part === 'm' ? L - (r.e - r.s) : L;
        else if (x.key === 's' || x.key === 'S') { active = 's'; draw(); return; }
        else if (x.key === 'e' || x.key === 'E') { active = 'e'; draw(); return; }
        else if (x.key === 'p' || x.key === 'P') { v = at(); if (part === 'm') part = 's'; }
        if (v === null || v === undefined) return;
        x.preventDefault(); x.stopPropagation();
        apply(part, v); glide(); draw(); emit(true);
    });

    // The playhead follows Resolve while the bar is on screen (and the bar follows outside changes to get / last).
    const tick = () => {
        if (!box.isConnected && box._mounted) return;
        if (box.isConnected) box._mounted = true;
        const visible = box.offsetParent !== null;
        if (visible && !drag && !wl.dragging()) paint();
        setTimeout(tick, visible ? 150 : 400);
    };
    paint();
    setTimeout(tick, 150);
    return { el: box, paint };
}
