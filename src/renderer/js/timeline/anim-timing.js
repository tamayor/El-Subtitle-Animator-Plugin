// Use tab: the Animation timing bar. For the clip being worked on in Resolve (the selected video clip, else the top
// clip under the playhead) it shows its "Animation Frames" / "Typing Frames" slider as a bar from 0 to the clip's
// length, with the playhead and the preset's own timing marked. Dragging the handle near either one pulls it in like
// a magnet (an ease-in-out glide); the value goes to the clip as you drag (src/main/anim-timing.js).

const tmState = { info: null, shown: null, dragging: false, snap: null, sendTimer: null, sentAt: 0, glideTimer: null, busy: false };
const TM_SNAP_PX = 14;          // magnet radius
const TM_SEND_MS = 110;         // value updates to Resolve while dragging, at most this often

function tmFrac(frame) {
    const i = tmState.info;
    return i ? Math.max(0, Math.min(1, frame / i.length)) : 0;
}

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

// View: 'full' (the card), 'compact' (one thin row) or 'docked' (that row above the status message at the bottom).
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
// Moves the card into the footer (above the status message) or back to its place in the Use tab.
function applyTimingView() {
    const card = $('timingCard'), home = $('timingHome');
    const footer = document.querySelector('#footerUse .footer-inner'), status = $('status');
    if (!card || !home) return;
    const v = tmView();
    const docked = v === 'docked' && footer && status;
    if (docked && card.parentNode !== footer) footer.insertBefore(card, status);
    if (!docked && card.previousElementSibling !== home) home.after(card);
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
    const v = tmState.shown != null ? tmState.shown : i.value;
    const bar = $('timingBar');
    if (!tmState.dragging) bar.classList.add('glide');
    $('timingThumb').style.left = (tmFrac(v) * 100) + '%';
    $('timingFill').style.width = (tmFrac(v) * 100) + '%';
    $('timingNatural').style.left = (tmFrac(i.natural) * 100) + '%';
    const ph = $('timingPlayhead');
    ph.classList.toggle('hidden', i.playhead == null);
    if (i.playhead != null) {
        ph.style.left = (tmFrac(i.playhead) * 100) + '%';
        $('timingPlayheadLabel').textContent = String(i.playhead);
    }
    ph.classList.toggle('hot', tmState.snap === 'playhead');
    $('timingNatural').classList.toggle('hot', tmState.snap === 'natural');
    $('timingEnd').textContent = i.length + ' f';
    const what = i.kind === 'typing' ? 'Last word at' : 'Last effect ends at';
    $('timingValue').innerHTML = what + ' <b>' + v + '</b> f · ' + tmSecs(v) + (v === i.natural ? ' (preset timing)' : '');
    $('timingMeta').textContent = (i.name || 'Clip') + ' · ' + i.length + ' f';
    $('timingMini').innerHTML = '<b>' + v + '</b>/' + i.length + ' f' + (i.playhead != null ? ' · <span class="ph">▸ ' + i.playhead + '</span>' : '');
    $('timingMini').title = (i.name || 'Clip') + ': ' + what.toLowerCase() + ' ' + v + ' f (' + tmSecs(v) + ')' + (i.playhead != null ? ', playhead at ' + i.playhead : '');
    bar.setAttribute('aria-valuemax', String(i.length));
    bar.setAttribute('aria-valuenow', String(v));
    bar.setAttribute('aria-valuetext', v + ' frames');
    $('timingToPlayhead').disabled = i.playhead == null || i.playhead < 1;
    $('timingHint').textContent = i.playhead == null
        ? 'Move the playhead over this clip to snap the end to it.'
        : 'Drag the handle; it snaps to the playhead and to the preset timing. Arrow keys: 1 frame (Shift: 5).';
}

// The frame under the pointer, pulled to the playhead / preset timing when it is within the magnet radius.
function tmFrameAt(clientX) {
    const i = tmState.info;
    const r = $('timingBar').getBoundingClientRect();
    const px = Math.max(0, Math.min(r.width, clientX - r.left));
    let frame = Math.max(1, Math.min(i.length, Math.round(px / r.width * i.length)));
    let snap = null, best = TM_SNAP_PX + 1;
    for (const [name, f] of [['playhead', i.playhead], ['natural', i.natural]]) {
        if (f == null || f < 1) continue;
        const d = Math.abs(px - f / i.length * r.width);
        if (d <= TM_SNAP_PX && d < best) { best = d; snap = name; frame = f; }
    }
    return { frame, snap };
}

async function tmSend(v, wake) {
    const i = tmState.info;
    if (!i) return;
    tmState.sentAt = Date.now();
    try {
        const r = await window.sa.setClipTiming(i.itemId, v, wake);
        if (r && r.error) setStatus(r.error, 'bad');
        else if (tmState.info && tmState.info.itemId === i.itemId && !tmState.dragging) tmState.info.value = v;
    } catch (e) { setStatus('Could not set the timing: ' + e.message, 'bad'); }
}
function tmQueue(v) {
    clearTimeout(tmState.sendTimer);
    const wait = Math.max(0, TM_SEND_MS - (Date.now() - tmState.sentAt));
    tmState.sendTimer = setTimeout(() => tmSend(v, false), wait);
}
// A value set outright (button, key, release): glide there and send it with a refresh of the clip's effects.
function tmSet(v) {
    const i = tmState.info;
    if (!i || i.noSlider) return;
    v = Math.max(1, Math.min(i.length, Math.round(v)));
    clearTimeout(tmState.sendTimer);
    tmState.shown = null;
    i.value = v;
    tmGlide();
    renderTiming();
    tmSend(v, true);
}

function initAnimTiming() {
    const bar = $('timingBar');
    if (!bar) return;
    bar.addEventListener('pointerdown', (e) => {
        if (!tmState.info || tmState.info.noSlider || e.button !== 0) return;
        bar.setPointerCapture(e.pointerId);
        bar.focus();
        tmState.dragging = true;
        bar.classList.add('dragging');
        const p = tmFrameAt(e.clientX);
        tmState.snap = p.snap;
        tmState.shown = p.frame;
        tmGlide();                                   // the first jump to the pointer glides too
        renderTiming();
        tmQueue(p.frame);
    });
    bar.addEventListener('pointermove', (e) => {
        if (!tmState.dragging) return;
        const p = tmFrameAt(e.clientX);
        if (p.snap !== tmState.snap) tmGlide();      // entering / leaving a magnet eases in and out
        tmState.snap = p.snap;
        if (p.frame === tmState.shown) return;
        tmState.shown = p.frame;
        renderTiming();
        tmQueue(p.frame);
    });
    const end = (e) => {
        if (!tmState.dragging) return;
        try { bar.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        tmState.dragging = false;
        bar.classList.remove('dragging');
        const v = tmState.shown;
        tmState.snap = null;
        if (v != null) tmSet(v);
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('keydown', (e) => {
        const i = tmState.info;
        if (!i || i.noSlider) return;
        const step = e.shiftKey ? 5 : 1;
        let v = null;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = i.value - step;
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = i.value + step;
        else if (e.key === 'Home') v = 1;
        else if (e.key === 'End') v = i.length;
        else if ((e.key === 'p' || e.key === 'P') && i.playhead != null) v = i.playhead;
        if (v == null) return;
        e.preventDefault();
        tmSet(v);
    });
    $('timingToPlayhead').addEventListener('click', () => { if (tmState.info && tmState.info.playhead != null) tmSet(tmState.info.playhead); });
    $('timingReset').addEventListener('click', () => { if (tmState.info) tmSet(tmState.info.natural); });
    $('timingCompactBtn').addEventListener('click', () => setTimingView(tmView() === 'full' ? 'compact' : 'full'));
    $('timingDockBtn').addEventListener('click', () => setTimingView('docked'));
    $('timingUndockBtn').addEventListener('click', () => setTimingView('compact'));
    applyTimingView();
    tmTick();
}

// Follows Resolve: which clip, its length and slider, and the playhead.
async function tmTick() {
    const onUse = document.body.classList.contains('tab-apply');
    if (!state.idle && onUse && !tmState.dragging && !tmState.busy && !state.busy) {
        tmState.busy = true;
        try {
            const r = await window.sa.clipTiming({});
            if (!tmState.dragging && r && r.ok) {
                if (r.none) tmState.info = null;
                else if (r.noSlider) tmState.info = { noSlider: true, itemId: r.itemId, name: r.name };
                else {
                    const same = tmState.info && tmState.info.itemId === r.itemId;
                    // a value just sent wins over an older read
                    if (same && Date.now() - tmState.sentAt < 1600) r.value = tmState.info.value;
                    tmState.info = r;
                }
                renderTiming();
            }
        } catch (e) { /* not connected: try again */ }
        tmState.busy = false;
    }
    setTimeout(tmTick, 300);
}
