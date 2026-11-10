// Use tab: the Animation timing bar. For the clip being worked on in Resolve (the selected video clip, else the top
// clip under the playhead) it shows the clip's timing as ranges on a bar from 0 to the clip's length: one lane per range
// (one for a Text+ preset, one per text for a MultiText preset like "Highlight Select"). Each range has two heads, where
// the animation starts and where it ends: pulling them closer makes it faster, dragging the range between them moves it.
// Heads snap like a magnet (an ease-in-out glide) to the playhead, the preset's own timing and the other lanes' heads.
// The values go to the clip as you drag (src/main/anim-timing.js).

const tmState = {
    info: null, dragging: null, active: { lane: 0, part: 'e' }, sendTimer: null, sentAt: 0, glideTimer: null, busy: false,
    builtFor: ''
};
const TM_SNAP_PX = 12;          // magnet radius
const TM_HEAD_PX = 11;          // grab radius of a head
const TM_SEND_MS = 110;         // value updates to Resolve while dragging, at most this often

function tmFrac(frame) {
    const i = tmState.info;
    return i ? Math.max(0, Math.min(1, frame / i.length)) : 0;
}
function tmPct(frame) { return (tmFrac(frame) * 100) + '%'; }

function tmGlide() {
    const bar = $('timingBar');
    if (!bar) return;
    bar.classList.add('glide');
    clearTimeout(tmState.glideTimer);
    tmState.glideTimer = setTimeout(() => { if (tmState.dragging) bar.classList.remove('glide'); }, 220);
}

function tmSecs(f) {
    const fps = (tmState.info && tmState.info.fps) || 25;
    return (f / fps).toFixed(2) + ' s';
}

// View: 'full' (the card), 'compact' (thin rows) or 'docked' (those rows above the status message at the bottom).
function tmView() {
    if (!tmState.view) {
        let v = 'full';
        try { v = localStorage.getItem('sa.timingView') || 'full'; } catch (e) { v = 'full'; }
        tmState.view = (v === 'compact' || v === 'docked') ? v : 'full';
    }
    return tmState.view;
}
function setTimingView(v) {
    tmState.view = (v === 'compact' || v === 'docked') ? v : 'full';
    try { localStorage.setItem('sa.timingView', tmState.view); } catch (e) { /* ignore */ }
    applyTimingView();
    renderTiming();
}
// Moves the card into the bottom dock (above the status message) or back to its place in the Use tab.
function applyTimingView() {
    const card = $('timingCard'), home = $('timingHome');
    if (!card || !home) return;
    const v = tmView();
    const docked = v === 'docked' && !!$('dockScroll');
    dockPut(card, docked, home);
    card.classList.toggle('compact', v !== 'full');
    card.classList.toggle('docked', !!docked);
    document.body.classList.toggle('tm-docked', !!docked && !card.classList.contains('hidden'));
    const cb = $('timingCompactBtn');
    if (cb) {
        cb.setAttribute('aria-pressed', String(v !== 'full'));
        cb.title = v === 'full' ? 'Ultra compact' : 'Full size';
        cb.setAttribute('aria-label', cb.title);
    }
}

// ------------------------------------------------------------------ lanes

function tmEl(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
}
// (Re)builds one lane per range when the clip or its ranges change shape.
function tmBuildLanes() {
    const i = tmState.info, bar = $('timingBar');
    const shape = i.itemId + '|' + i.ranges.map(r => r.key + ':' + (r.label || '') + ':' + r.hasStart).join(',');
    if (tmState.builtFor === shape && bar.querySelector('.tm-lane')) return;
    tmState.builtFor = shape;
    bar.querySelectorAll('.tm-lane').forEach(e => e.remove());
    const labelled = i.ranges.some(r => r.label);
    bar.classList.toggle('labelled', labelled);
    i.ranges.forEach((r, n) => {
        const lane = tmEl('div', 'tm-lane', bar);
        lane.dataset.lane = String(n);
        if (labelled) tmEl('span', 'tm-lane-label', lane).textContent = r.label || ('Text ' + (n + 1));
        const area = tmEl('div', 'tm-area', lane);
        tmEl('div', 'tm-track', area);
        const def = tmEl('div', 'tm-default', area);
        def.title = 'The preset\'s own timing';
        tmEl('div', 'tm-range', area);
        const ph = tmEl('div', 'tm-mark tm-playhead hidden', area);
        if (n === 0) tmEl('span', 'tm-ph-label', ph);
        const s = tmEl('div', 'tm-knob tm-start' + (r.hasStart ? '' : ' hidden'), area);
        s.title = 'Start: drag to change where the animation starts';
        const e = tmEl('div', 'tm-knob tm-end', area);
        e.title = 'End: drag to change where the animation ends';
    });
    if (tmState.active.lane >= i.ranges.length) tmState.active = { lane: 0, part: 'e' };
}

function tmIsDefault(r) { return r.start === r.defStart && r.end === r.defEnd; }

function tmRangeText(r) {
    return (r.hasStart ? r.start + '–' : '') + r.end;
}

function renderTiming() {
    const card = $('timingCard');
    if (!card) return;
    const i = tmState.info;
    if (!i) { card.classList.add('hidden'); document.body.classList.remove('tm-docked'); return; }
    card.classList.remove('hidden');
    document.body.classList.toggle('tm-docked', tmView() === 'docked');
    const bare = !!i.noSlider;
    for (const id of ['timingBar', 'timingToPlayhead', 'timingReset']) $(id).classList.toggle('hidden', bare);
    card.querySelector('.tm-scale').classList.toggle('hidden', bare);
    if (bare) {
        $('timingMeta').textContent = i.name || 'Clip';
        $('timingValue').textContent = '';
        $('timingMini').textContent = 'No timing slider';
        $('timingHint').textContent = 'This clip\'s preset has no timing slider yet. Presets get it when they are saved into the library again.';
        return;
    }
    tmBuildLanes();
    const bar = $('timingBar');
    if (!tmState.dragging) bar.classList.add('glide');
    const lanes = bar.querySelectorAll('.tm-lane');
    const dragLane = tmState.dragging ? tmState.dragging.lane : -1;
    i.ranges.forEach((r, n) => {
        const lane = lanes[n];
        if (!lane) return;
        const range = lane.querySelector('.tm-range');
        range.style.left = tmPct(r.start);
        range.style.width = (Math.max(0, tmFrac(r.end) - tmFrac(r.start)) * 100) + '%';
        range.classList.toggle('movable', r.hasStart);
        const def = lane.querySelector('.tm-default');
        def.style.left = tmPct(r.defStart);
        def.style.width = (Math.max(0, tmFrac(r.defEnd) - tmFrac(r.defStart)) * 100) + '%';
        lane.querySelector('.tm-start').style.left = tmPct(r.start);
        lane.querySelector('.tm-end').style.left = tmPct(r.end);
        const act = tmState.active.lane === n;
        lane.classList.toggle('active', act);
        lane.querySelector('.tm-start').classList.toggle('on', act && tmState.active.part !== 'e');
        lane.querySelector('.tm-end').classList.toggle('on', act && tmState.active.part !== 's');
        lane.classList.toggle('dragging', dragLane === n);
        const snap = dragLane === n && tmState.dragging.snap;
        const ph = lane.querySelector('.tm-playhead');
        ph.classList.toggle('hidden', i.playhead == null);
        if (i.playhead != null) {
            ph.style.left = tmPct(i.playhead);
            const lab = ph.querySelector('.tm-ph-label');
            if (lab) lab.textContent = String(i.playhead);
        }
        ph.classList.toggle('hot', snap === 'playhead');
        def.classList.toggle('hot', snap === 'default');
    });
    $('timingEnd').textContent = i.length + ' f';

    // readouts
    const one = i.ranges.length === 1 ? i.ranges[0] : null;
    let full, mini, title;
    if (one) {
        const dur = one.end - one.start;
        const what = i.kind === 'typing' ? 'Last word at' : (one.hasStart ? 'Ends at' : 'Last effect ends at');
        full = (one.hasStart ? 'Starts at <b>' + one.start + '</b> · ' + what.toLowerCase() : what) + ' <b>' + one.end + '</b> f · ' +
            tmSecs(dur) + (tmIsDefault(one) ? ' (preset timing)' : '');
        mini = '<b>' + tmRangeText(one) + '</b>/' + i.length + ' f';
        title = (i.name || 'Clip') + ': ' + (one.hasStart ? 'frames ' + one.start + ' to ' + one.end : 'ends at ' + one.end) + ' (' + tmSecs(dur) + ')';
    } else {
        full = i.ranges.map(r => tmEsc(r.label || '') + ' <b>' + tmRangeText(r) + '</b>').join(' · ') + ' f' +
            (i.ranges.every(tmIsDefault) ? ' (preset timing)' : '');
        mini = i.ranges.map(r => '<b>' + tmRangeText(r) + '</b>').join(' · ');
        title = (i.name || 'Clip') + ': ' + i.ranges.map(r => (r.label || '') + ' ' + tmRangeText(r)).join(', ') + ' f';
    }
    $('timingValue').innerHTML = full;
    $('timingMeta').textContent = (i.name || 'Clip') + ' · ' + i.length + ' f';
    $('timingMini').innerHTML = mini + (i.playhead != null ? ' · <span class="ph">▸ ' + i.playhead + '</span>' : '');
    $('timingMini').title = title + (i.playhead != null ? ', playhead at ' + i.playhead : '');
    $('timingToPlayhead').disabled = i.playhead == null;
    const r = i.ranges[tmState.active.lane] || i.ranges[0];
    $('timingToPlayhead').title = 'Put the ' + (tmState.active.part === 's' && r.hasStart ? 'start' : 'end') +
        (r.label ? ' of ' + r.label : '') + ' at the playhead (P)';
    $('timingHint').textContent = i.playhead == null
        ? 'Drag a head to change where the animation starts or ends; drag between them to move it. Move the playhead over this clip to snap to it.'
        : 'Heads snap to the playhead, the preset timing (dashed) and each other. Arrow keys: 1 frame (Shift: 5), Alt: move the whole range' +
          (i.ranges.length > 1 ? ', Up / Down: the other text.' : '.');
}

function tmEsc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ------------------------------------------------------------------ editing

// Puts one range's part ('s' start, 'e' end, 'm' move with the start at v) at frame v, within the clip.
function tmApply(r, part, v, len) {
    v = Math.round(v);
    if (part === 'm') {
        const d = r.end - r.start;
        r.start = Math.max(0, Math.min(len - d, v));
        r.end = r.start + d;
    } else if (part === 's') {
        r.start = Math.max(0, Math.min(r.end - 1, v));
    } else {
        r.end = Math.max(r.start + 1, Math.min(len, v));
    }
}

// The frame for pointer x on a lane, pulled to the nearest magnet within TM_SNAP_PX: the playhead, the preset's own
// start / end on this lane, and the heads of the other lanes. For a move, the range's start or end may snap.
function tmFrameAt(clientX, laneIdx, part, grab) {
    const i = tmState.info;
    const area = $('timingBar').querySelectorAll('.tm-lane')[laneIdx].querySelector('.tm-area');
    const rect = area.getBoundingClientRect();
    const px = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const toPx = (f) => f / i.length * rect.width;
    const r = i.ranges[laneIdx];
    let frame = Math.round(px / rect.width * i.length) - (part === 'm' ? grab : 0);
    const marks = [];
    if (i.playhead != null) marks.push(['playhead', i.playhead]);
    marks.push(['default', part === 's' || part === 'm' ? r.defStart : r.defEnd]);
    if (part === 'm') marks.push(['default', r.defEnd]);
    i.ranges.forEach((o, n) => { if (n !== laneIdx) { if (o.hasStart) marks.push(['lane', o.start]); marks.push(['lane', o.end]); } });
    let snap = null, best = TM_SNAP_PX + 1;
    // a move snaps by its start or its end
    const edges = part === 'm' ? [[0, frame], [r.end - r.start, frame + (r.end - r.start)]] : [[0, frame]];
    for (const [off, at] of edges) {
        for (const [name, f] of marks) {
            const d = Math.abs(toPx(at) - toPx(f));
            if (d <= TM_SNAP_PX && d < best) { best = d; snap = name; frame = f - off; }
        }
    }
    return { frame, snap };
}

async function tmSend(wake) {
    const i = tmState.info;
    if (!i || !i.ranges) return;
    tmState.sentAt = Date.now();
    const ranges = i.ranges.map(r => ({ key: r.key, start: r.start, end: r.end }));
    try {
        const res = await window.sa.setClipTiming(i.itemId, ranges, wake);
        if (res && res.error) setStatus(res.error, 'bad');
        else if (res && res.sounds) {
            // the Upper / Emphasis / Lower sounds of this clip followed their row's start
            const q = res.sounds;
            if (q.error || q.failed) setStatus('Could not move ' + (q.failed || 'the') + ' row sound' + (q.failed === 1 ? '' : 's') + ' with the timing' + (q.error ? ': ' + q.error : ' (another clip may be in the way on that audio track).'), 'bad');
            else if (q.rows) setStatus('Re-spaced ' + q.rows + ' per-row sound' + (q.rows === 1 ? '' : 's') + ' to the new animation timing.', 'ok');
            else if (q.moved) setStatus('Moved ' + q.moved + ' row sound' + (q.moved === 1 ? '' : 's') + ' with the animation start.', 'ok');
        }
    } catch (e) { setStatus('Could not set the timing: ' + e.message, 'bad'); }
}
function tmQueue() {
    clearTimeout(tmState.sendTimer);
    const wait = Math.max(0, TM_SEND_MS - (Date.now() - tmState.sentAt));
    tmState.sendTimer = setTimeout(() => tmSend(false), wait);
}
// A change made outright (button, key, release): glide there and send it with a refresh of the clip's effects.
function tmCommit() {
    clearTimeout(tmState.sendTimer);
    tmGlide();
    renderTiming();
    tmSend(true);
}

// Which part of which lane a pointer press takes: a head near the pointer, else the range between the heads (move),
// else the nearest head, which jumps to the pointer.
function tmPick(e) {
    const i = tmState.info;
    const lanes = [...$('timingBar').querySelectorAll('.tm-lane')];
    let laneIdx = lanes.findIndex(l => { const b = l.getBoundingClientRect(); return e.clientY >= b.top && e.clientY <= b.bottom; });
    if (laneIdx < 0) {
        laneIdx = 0;
        let best = Infinity;
        lanes.forEach((l, n) => { const b = l.getBoundingClientRect(); const d = Math.abs(e.clientY - (b.top + b.bottom) / 2); if (d < best) { best = d; laneIdx = n; } });
    }
    const r = i.ranges[laneIdx];
    const rect = lanes[laneIdx].querySelector('.tm-area').getBoundingClientRect();
    const px = e.clientX - rect.left;
    const toPx = (f) => f / i.length * rect.width;
    const dS = r.hasStart ? Math.abs(px - toPx(r.start)) : Infinity;
    const dE = Math.abs(px - toPx(r.end));
    let part;
    if (Math.min(dS, dE) <= TM_HEAD_PX) {
        // both heads under the pointer (a very short range): the side the pointer is on
        part = dS < dE || (dS === dE && px < toPx(r.start)) ? 's' : 'e';
    } else if (r.hasStart && px > toPx(r.start) && px < toPx(r.end)) {
        part = 'm';
    } else {
        part = dS < dE ? 's' : 'e';
    }
    const grab = part === 'm' ? Math.round(px / rect.width * i.length) - r.start : 0;
    return { lane: laneIdx, part, grab };
}

function initAnimTiming() {
    const bar = $('timingBar');
    if (!bar) return;
    bar.addEventListener('pointerdown', (e) => {
        const i = tmState.info;
        if (!i || i.noSlider || !i.ranges || e.button !== 0) return;
        bar.setPointerCapture(e.pointerId);
        bar.focus();
        const p = tmPick(e);
        tmState.dragging = { lane: p.lane, part: p.part, grab: p.grab, snap: null };
        tmState.active = { lane: p.lane, part: p.part };
        bar.classList.add('dragging');
        if (p.part !== 'm') {
            const f = tmFrameAt(e.clientX, p.lane, p.part, 0);
            tmState.dragging.snap = f.snap;
            tmApply(i.ranges[p.lane], p.part, f.frame, i.length);
            tmGlide();                                   // the first jump to the pointer glides too
        }
        renderTiming();
        tmQueue();
    });
    bar.addEventListener('pointermove', (e) => {
        const d = tmState.dragging, i = tmState.info;
        if (!d || !i) return;
        const f = tmFrameAt(e.clientX, d.lane, d.part, d.grab);
        if (f.snap !== d.snap) tmGlide();                // entering / leaving a magnet eases in and out
        d.snap = f.snap;
        const r = i.ranges[d.lane];
        const before = r.start + ':' + r.end;
        tmApply(r, d.part, f.frame, i.length);
        if (r.start + ':' + r.end === before) { renderTiming(); return; }
        renderTiming();
        tmQueue();
    });
    const end = (e) => {
        if (!tmState.dragging) return;
        try { bar.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        tmState.dragging = null;
        bar.classList.remove('dragging');
        tmCommit();
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('keydown', (e) => {
        const i = tmState.info;
        if (!i || i.noSlider || !i.ranges) return;
        const a = tmState.active;
        const r = i.ranges[a.lane];
        if (!r) return;
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && i.ranges.length > 1) {
            e.preventDefault();
            a.lane = (a.lane + (e.key === 'ArrowDown' ? 1 : i.ranges.length - 1)) % i.ranges.length;
            renderTiming();
            return;
        }
        const step = e.shiftKey ? 5 : 1;
        let part = e.altKey && r.hasStart ? 'm' : (a.part === 's' && r.hasStart ? 's' : 'e');
        let v = null;
        const base = part === 'e' ? r.end : r.start;
        if (e.key === 'ArrowLeft') v = base - step;
        else if (e.key === 'ArrowRight') v = base + step;
        else if (e.key === 'Home') v = 0;
        else if (e.key === 'End') v = part === 'm' ? i.length - (r.end - r.start) : i.length;
        else if ((e.key === 's' || e.key === 'S') && r.hasStart) { a.part = 's'; renderTiming(); return; }
        else if (e.key === 'e' || e.key === 'E') { a.part = 'e'; renderTiming(); return; }
        else if ((e.key === 'p' || e.key === 'P') && i.playhead != null) { v = i.playhead; if (part === 'm') part = 's'; }
        if (v == null) return;
        e.preventDefault();
        tmApply(r, part, v, i.length);
        tmCommit();
    });
    $('timingToPlayhead').addEventListener('click', () => {
        const i = tmState.info;
        if (!i || !i.ranges || i.playhead == null) return;
        const r = i.ranges[tmState.active.lane] || i.ranges[0];
        tmApply(r, tmState.active.part === 's' && r.hasStart ? 's' : 'e', i.playhead, i.length);
        tmCommit();
    });
    $('timingReset').addEventListener('click', () => {
        const i = tmState.info;
        if (!i || !i.ranges) return;
        for (const r of i.ranges) {
            r.start = r.hasStart ? Math.min(r.defStart, i.length - 1) : 0;
            r.end = Math.max(r.start + 1, Math.min(r.defEnd, i.length));
        }
        tmCommit();
    });
    $('timingCompactBtn').addEventListener('click', () => setTimingView(tmView() === 'full' ? 'compact' : 'full'));
    $('timingDockBtn').addEventListener('click', () => setTimingView('docked'));
    $('timingUndockBtn').addEventListener('click', () => setTimingView('compact'));
    applyTimingView();
    tmTick();
}

// Follows Resolve: which clip, its length and ranges, and the playhead.
// Only while the Use tab shows and the window is visible; 300 ms while the playhead or the clip changes, 1500 ms once
// nothing has changed for 3 s (each read is a few Resolve calls and, for a new clip, a bridge call).
const tmPace = { sig: '', changedAt: 0 };
async function tmTick() {
    const onUse = document.body.classList.contains('tab-apply');
    let delay = 300;
    if (!state.idle && onUse && !document.hidden && !tmState.dragging && !tmState.busy && !state.busy) {
        tmState.busy = true;
        try {
            const r = await window.sa.clipTiming({});
            if (!tmState.dragging && r && r.ok) {
                if (r.none) tmState.info = null;
                else if (r.noSlider) tmState.info = { noSlider: true, itemId: r.itemId, name: r.name };
                else {
                    const same = tmState.info && tmState.info.itemId === r.itemId && tmState.info.ranges &&
                        tmState.info.ranges.length === (r.ranges || []).length;
                    // values just sent win over an older read
                    if (same && Date.now() - tmState.sentAt < 1600) r.ranges = tmState.info.ranges;
                    if (!same) tmState.active = { lane: 0, part: 'e' };
                    tmState.info = r;
                }
                renderTiming();
                const sig = r.none ? 'none' : (r.itemId + '|' + r.frame + '|' + JSON.stringify(r.ranges || null));
                if (sig !== tmPace.sig) { tmPace.sig = sig; tmPace.changedAt = Date.now(); }
                if (Date.now() - tmPace.changedAt > 3000) delay = 1500;
            }
        } catch (e) { /* not connected: try again */ }
        tmState.busy = false;
    } else if (!onUse || document.hidden) delay = 700;
    setTimeout(tmTick, delay);
}
