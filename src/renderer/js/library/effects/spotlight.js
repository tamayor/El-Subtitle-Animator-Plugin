// Effect Preset cards: Spotlight (a big word behind the speaker).

// ---- Spotlight (src/main/spotlight.js): a big word behind the speaker. Switching the card on makes one at the playhead
// (the moment = In / Out marks, else the subtitle there); selecting a Spotlight cut-out clip shows its settings, which
// re-key it at once (no matting again); switching off removes the selected Spotlight.
const spotUI = { info: null, ready: null, running: false, timer: null, pending: {} };
function spotNext() {
    let saved = null;
    saved = store.getJSON('spot.next', null) || null;
    const d = (spotUI.info && spotUI.info.defaults) || {};
    const o = Object.assign({}, d, saved && typeof saved === 'object' ? saved : {});
    delete o.word; delete o.y;          // per moment: the word comes from the subtitle, the height from the head
    return o;
}
function spotRemember(vals) {
    const keep = Object.assign({}, spotNext(), vals);
    delete keep.word; delete keep.y;
    store.set('spot.next', JSON.stringify(keep));
}
async function spotEnsureInfo() {
    if (!spotUI.info) { try { spotUI.info = await window.sa.spotInfo(); } catch (err) { spotUI.info = { anims: [], defaults: {} }; } }
    if (spotUI.ready === null) { try { spotUI.ready = !!(await window.sa.spotEngine()).ready; } catch (err) { spotUI.ready = false; } }
}
// one overall % for a make / re-cut: reading frames 0-25%, masking 25-95%, placing 95-99%
function spotPercent(p) {
    if (!p) return null;
    const f = (a, b) => (p.total ? Math.max(0, Math.min(1, p.done / p.total)) : 0) * (b - a) + a;
    if (p.phase === 'frames') return Math.round(f(0, 25));
    if (p.phase === 'matte') return Math.round(f(25, 95));
    if (p.phase === 'place') return 97;
    return null;
}
function spotProgressText(p) {
    if (!p) return '';
    if (p.phase === 'install') return p.text || 'Installing…';
    const pc = spotPercent(p);
    if (p.phase === 'frames') return pc + '% · reading frames ' + p.done + ' / ' + p.total;
    if (p.phase === 'matte') return pc + '% · masking the speaker ' + p.done + ' / ' + p.total;
    if (p.phase === 'place') return pc + '% · placing…';
    return '';
}
function spotShowProgress(p) {
    const pc = spotPercent(p);
    if (pc === null) return;
    spotUI.pct = pc; spotUI.pctText = spotProgressText(p);
    for (const b of document.querySelectorAll('.fx-spot-run')) b.textContent = 'Masking ' + pc + '%';
    for (const bar of document.querySelectorAll('.fx-spot-bar > i')) bar.style.width = pc + '%';
    for (const t of document.querySelectorAll('.fx-spot-bar-text')) t.textContent = spotUI.pctText;
}
if (window.sa && window.sa.onSpotProgress) window.sa.onSpotProgress((p) => { spotShowProgress(p); const t = spotProgressText(p); if (t) setStatus('Spotlight: ' + t, 'busy'); });

async function fxSpotToggle(e) {
    await spotEnsureInfo();
    const clip = fxUI.clips.find(x => x.effects && x.effects[e.id]);
    if (clip) { await spotRemoveClip(clip); return; }
    await spotMake(e, {});
}
async function spotMake(e, extra) {
    if (spotUI.running) return;
    await spotEnsureInfo();
    if (!spotUI.ready) {
        setStatus('Spotlight needs its matting engine (about 60 MB, once): press Install on the Spotlight card.', 'bad');
        fxShow(e.id, true); renderEffects();
        return;
    }
    spotUI.running = true; spotUI.pct = null; spotUI.pctText = ''; renderEffects();
    let r = null;
    // the bridge reads the playhead itself
    try { r = await window.sa.spotRun({ settings: Object.assign(spotNext(), extra || {}) }); } catch (err) { r = { error: String(err && err.message || err) }; }
    spotUI.running = false;
    if (r && r.needInstall) { spotUI.ready = false; setStatus('Install the matting engine first (Spotlight card).', 'bad'); }
    else if (!r || r.error || r.busy) setStatus(r && r.busy ? 'Busy placing - try again in a moment.' : ((r && r.error) || 'Could not make the spotlight'), 'bad');
    else if (r.cancelled) setStatus('Spotlight cancelled.', 'ok');
    else {
        const w = r.settings && r.settings.word ? '"' + String(r.settings.word).toUpperCase() + '"' : 'no word';
        const moved = (r.moved || []).length ? ' · lifted ' + r.moved.length + ' caption' + (r.moved.length === 1 ? '' : 's') + ' above it' : '';
        const msg = 'Spotlight ' + w + ' on V' + r.track + ' (' + (r.range[1] - r.range[0] + 1) + ' frames, from the ' + r.why + ')' + moved + '. Select the cut-out clip to change it.';
        if (r.warning) setStatus(r.warning + ' ' + msg, 'bad'); else setStatus(msg, 'ok');
    }
    await fxRefresh(true);
    renderEffects();
}
async function spotRecutClip(e, clip) {
    if (spotUI.running) return;
    const matte = Object.assign({}, clip.spot || {}, spotUI.edge || {});
    spotUI.running = true; spotUI.pct = null; spotUI.pctText = ''; renderEffects();
    setStatus('Spotlight: cutting the speaker out again…', 'busy');
    let r = null;
    try { r = await window.sa.spotRecut(clip.id, matte); } catch (err) { r = { error: String(err && err.message || err) }; }
    spotUI.running = false;
    if (!r || r.error || r.busy) setStatus(r && r.busy ? 'Busy - try again in a moment.' : ((r && r.error) || 'Could not re-cut the spotlight'), 'bad');
    else if (r.cancelled) setStatus('Re-cut cancelled; the old cut-out is kept.', 'ok');
    else { spotUI.edge = {}; setStatus((r.warning ? r.warning + ' ' : '') + 'Spotlight re-cut on V' + r.track + '. Select the new cut-out clip to keep adjusting.', r.warning ? 'bad' : 'ok'); }
    await fxRefresh(true);
    renderEffects();
}
async function spotRemoveClip(clip) {
    if (spotUI.pending[clip.id]) return;
    spotUI.pending[clip.id] = true;
    let r = null;
    try { r = await window.sa.spotRemove(clip.id); } catch (err) { r = { error: String(err && err.message || err) }; }
    delete spotUI.pending[clip.id];
    if (!r || r.error) setStatus((r && r.error) || 'Could not remove it', 'bad');
    else setStatus('Spotlight removed' + (r.restored ? ' (' + r.restored + ' caption' + (r.restored === 1 ? '' : 's') + ' put back)' : '') + '.', 'ok');
    await fxRefresh(true);
}
// a change on a placed spotlight: re-keyed after 350 ms of quiet (sliders send on release only)
function spotSend(clip, vals, now) {
    spotRemember(vals);
    if (!clip) return;
    if (spotUI.clipId && spotUI.clipId !== clip.id) spotUI.queued = null;
    spotUI.clipId = clip.id;
    clip.spot = Object.assign({}, clip.spot || {}, vals);
    spotUI.queued = Object.assign(spotUI.queued || {}, vals);
    clearTimeout(spotUI.timer);
    // one re-key at a time: values that arrive while Resolve is busy wait, and only the latest of them goes next
    // (live slider drags then update as fast as Resolve can re-key, never piling up)
    const go = async () => {
        if (spotUI.inflight) return;
        const v = spotUI.queued; spotUI.queued = null;
        const targetId = spotUI.clipId || clip.id;
        if (!v) return;
        spotUI.inflight = true;
        let r = null;
        try { r = await window.sa.spotSet(targetId, v, !!v._addEffect); } catch (err) { r = { error: String(err && err.message || err) }; }
        spotUI.inflight = false;
        if (!r || r.error || r.busy) { if (!(r && r.busy && spotUI.queued)) setStatus(r && r.busy ? 'Busy - try again in a moment.' : ((r && r.error) || 'Could not change the spotlight'), 'bad'); }
        else if (r.settings && r.settings.fontWarning) setStatus(r.settings.fontWarning, 'bad');
        if (spotUI.queued) go();
    };
    if (now) go(); else spotUI.timer = setTimeout(go, 350);
}

function fxSpotOptions(e, st, clip) {
    const d = document.createElement('div');
    d.className = 'fx-opts fx-spot-opts';
    for (const ev of ['click', 'mousedown', 'pointerdown']) d.addEventListener(ev, (x) => x.stopPropagation());
    if (!spotUI.info || spotUI.ready === null) { spotEnsureInfo().then(() => { const c = document.querySelector('#fxGrid .fx-card[data-id="' + e.id + '"]'); if (c) { c._fx.optsSig = null; fxFillCard(c, e); } }); d.textContent = 'Loading…'; return d; }
    const note = (t) => { const x = document.createElement('div'); x.className = 'fx-note'; x.textContent = t; d.appendChild(x); return x; };
    if (!spotUI.ready) {
        note('Spotlight cuts the speaker out of the footage with Robust Video Matting (free, runs on this Mac). It installs once into the app\'s own folder: about 60 MB, needs internet.');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small fx-track-btn'; b.textContent = 'Install matting engine';
        b.addEventListener('click', async () => {
            b.disabled = true; spotUI.running = true;
            let r = null;
            try { r = await window.sa.spotInstall(); } catch (err) { r = { error: String(err && err.message || err) }; }
            spotUI.running = false;
            if (r && r.ready) { spotUI.ready = true; setStatus('Matting engine ready.', 'ok'); } else { b.disabled = false; setStatus((r && r.error) || 'Install failed', 'bad'); }
            renderEffects();
        });
        d.appendChild(b);
        return d;
    }
    const placed = st === 'on' && clip;
    const p = placed ? Object.assign(spotNext(), clip.spot || {}) : spotNext();
    const send = (vals, now) => { if (placed) spotSend(clip, vals, now); else spotRemember(vals); };
    note(placed ? 'Selected spotlight: changes re-key it straight away.'
        : (spotUI.running ? 'Making the spotlight…' : 'Switch on (or Make) to put one at the playhead: the moment is the In / Out marks, else the subtitle there. The word comes from the subtitle unless you type one.'));
    note('Tip: works best on a tight shot (head and shoulders filling the frame). On a wide shot, zoom in on the speaker first (Edit Zoom 130-150%), then make the spotlight. Up to 20 s per spotlight; longer selections are cut to 20 s.').classList.add('fx-spot-tip');
    const row = (label, el, tip) => { const r = document.createElement('label'); r.className = 'fx-strength'; if (tip) r.title = tip; const c = document.createElement('span'); c.className = 'fx-strength-cap'; c.textContent = label; r.append(c, el); d.appendChild(r); return r; };
    const text = (k, ph, w) => { const i = document.createElement('input'); i.type = 'text'; i.value = p[k] || ''; i.placeholder = ph || ''; i.style.flex = '1'; i.style.minWidth = '0'; if (w) i.style.maxWidth = w; i.addEventListener('change', () => send({ [k]: i.value.trim() }, true)); return i; };
    const check = (k, label, tip) => { const l = document.createElement('label'); l.className = 'fx-check'; if (tip) l.title = tip; const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = p[k] !== false; cb.addEventListener('change', () => send({ [k]: cb.checked }, true)); l.append(cb, document.createTextNode(label)); return l; };
    const slider = (k, label, min, max, fmt, tip, step, onSend) => {
        const v0 = Number(p[k]);
        const s = sliderRow({
            label, min, max, step: step || 1, value: Number.isFinite(v0) ? v0 : min, format: fmt, tip, onGrab: () => { fxUI.sliding = true; }, onRelease: () => { fxUI.sliding = false; },
            // a placed spotlight follows the slider live while it is dragged (edge sliders wait for Re-cut)
            onInput: v => { if (placed && !onSend) spotSend(clip, { [k]: v }, true); },
            onChange: v => (onSend || send)({ [k]: v }, true)
        });
        d.appendChild(s.el);
        return { r: s.el, rng: s.range, val: s.val };
    };
    const colour = (k, label) => { const i = document.createElement('input'); i.type = 'color'; const c = Array.isArray(p[k]) ? p[k] : [1, 1, 1]; i.value = rgbToHex(c[0], c[1], c[2]); i.addEventListener('change', () => send({ [k]: (hexToRgb(i.value) || [1, 1, 1]) }, true)); const l = document.createElement('label'); l.className = 'fx-check'; l.append(i, document.createTextNode(label)); return l; };

    // word
    const wr = document.createElement('div'); wr.className = 'fx-opt-row';
    wr.append(check('wordOn', 'Word', 'Off = spotlight only (dimmed room, no word)'), text('word', placed ? '' : 'auto (from the subtitle)'), check('caps', 'CAPS'));
    d.appendChild(wr);
    const fr = document.createElement('div'); fr.className = 'fx-opt-row';
    fr.append(text('font', 'Font', '58%'), text('style', 'Style', '38%'));
    d.appendChild(fr);
    const cr = document.createElement('div'); cr.className = 'fx-opt-row';
    cr.append(colour('color', 'Text'), colour('glowColor', 'Glow'));
    d.appendChild(cr);
    // animation
    const sel = document.createElement('select');
    for (const a of (spotUI.info.anims || [])) { const o = document.createElement('option'); o.value = a.id; o.textContent = a.name; o.title = a.tip; if (a.id === p.anim) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => send({ anim: sel.value }, true));
    row('Entry', sel, 'How the word comes in (it fades out at the end)');
    // In / Out on one bar: left head = where the entry ends, right head = where the fade out starts
    const last = placed && Number(clip.frames) > 1 ? Number(clip.frames) - 1 : 50;
    const d0 = (spotUI.info && spotUI.info.defaults) || { inF: 12, outF: 8 };
    const io = fxFrameRange(e, st, p, placed ? clip : null, last, {
        title: 'Left head: where the entry ends (In). Right head: where the fade out starts (Out). Drag between them to shift both. Double-click: default',
        init: (L) => ({ s: Math.max(1, Math.round(Number(p.inF)) || d0.inF), e: L - Math.max(0, Math.round(Number(p.outF)) || 0) }),
        dflt: (L) => ({ s: d0.inF, e: L - d0.outF }),
        send: (s0, e0, L) => send({ inF: Math.max(1, s0), outF: L - e0 }, true),
        read: (s0, e0, L) => 'In <b>' + Math.max(1, s0) + '</b> f · Out <b>' + (L - e0 ? (L - e0) + '</b> f' : 'cut</b>') +
            (placed ? ' <span class="fxr-len">/ ' + (L + 1) + ' f</span>' : ' <span class="fxr-len">(preview on 2 s)</span>')
    });
    const ior = document.createElement('div'); ior.className = 'fx-opt-row'; ior.appendChild(io);
    d.appendChild(ior);
    slider('glow', 'Glow', 0, 100);
    slider('dim', 'Dim room', 0, 100, null, 'How much darker the room gets around the speaker');
    slider('vig', 'Vignette', 0, 100, null, 'Extra darkening towards the edges');
    // placement: auto (fit + from the head) or by hand
    const size = slider('size', 'Size', 0, 0.6, (v) => v > 0 ? v.toFixed(3) : 'Auto', 'Text+ size. Auto = fills the Width below', 0.005);
    slider('width', 'Width %', 40, 100, null, 'Auto size: how much of the frame width the word fills');
    const ypos = slider('y', 'Height', 0, 1, (v) => (v * 100).toFixed(0) + '%', 'Where the middle of the word sits (0% = top). Double-click: auto (from the head)', 0.005);
    if (p.y === null || p.y === undefined) { ypos.rng.value = String(placed && Number.isFinite(Number(clip.spot && clip.spot.cy)) ? clip.spot.cy : 0.2); ypos.val.textContent = 'Auto'; }
    ypos.rng.addEventListener('dblclick', () => { ypos.val.textContent = 'Auto'; send({ y: null }, true); });
    size.rng.addEventListener('dblclick', () => { size.rng.value = '0'; size.val.textContent = 'Auto'; send({ size: 0 }, true); });
    slider('overlap', 'Behind head', 0, 70, (v) => v + '%', 'Auto height: how much of the letters the head covers');
    slider('x', 'Left / right', 0, 1, (v) => (v * 100).toFixed(0) + '%', 'Horizontal centre of the word (50% = centred)', 0.005);
    // cut-out edge: changes the matte itself, so a placed spotlight needs Re-cut (the old one stays until the new is ready)
    const eh = document.createElement('div'); eh.className = 'fx-note fx-spot-edge-head';
    eh.textContent = placed ? 'Cut-out edge — move the sliders, then press Re-cut' : 'Cut-out edge (for the next spotlight)';
    d.appendChild(eh);
    spotUI.edge = placed && spotUI.edgeFor === clip.id ? (spotUI.edge || {}) : {};
    spotUI.edgeFor = placed ? clip.id : null;
    const edgeSend = (vals) => { spotRemember(vals); if (placed) { Object.assign(spotUI.edge, vals); if (rc) rc.classList.add('fx-spot-dirty'); } };
    const ep = Object.assign({}, p, spotUI.edge);
    const es = (k, label, min, max, fmt, tip) => { const o = slider(k, label, min, max, fmt, tip, 1, edgeSend); const v = Number(ep[k]); if (Number.isFinite(v)) { o.rng.value = String(v); o.val.textContent = fmt ? fmt(v) : String(v); } return o; };
    es('edgeTight', 'Edge tightness', 0, 40, null, 'Higher = trims the soft haze around hair and shoulders (wall or glow showing through). Lower = keeps more fine hair');
    es('edgeSoft', 'Edge softness', 0, 40, (v) => (v / 10).toFixed(1) + ' px', 'Blur on the edge. 0 = crisp, 1-2 px = softer blend');
    es('wisps', 'Hair wisps', 2, 60, (v) => v + ' px', 'How far soft hair and edges may reach out from the solid body. Lower removes grey clouds stuck to the shoulders');
    es('islands', 'Remove stray bits', 0, 90, (v) => v + '%', 'Drops separate pieces smaller than this % of the person (wall signs, desk bits). Higher removes more');
    let rc = null;
    const br = document.createElement('div'); br.className = 'fx-opt-row';
    const mk = document.createElement('button'); mk.type = 'button'; mk.className = 'btn small fx-track-btn';
    mk.textContent = spotUI.running ? (spotUI.pct !== undefined && spotUI.pct !== null ? 'Masking ' + spotUI.pct + '%' : 'Starting…') : (placed ? 'Make another at playhead' : 'Make at playhead');
    if (spotUI.running) mk.classList.add('fx-spot-run');
    mk.disabled = spotUI.running;
    mk.addEventListener('click', () => spotMake(e, {}));
    br.appendChild(mk);
    if (spotUI.running) {
        const pr = document.createElement('div'); pr.className = 'fx-spot-progress';
        const bar = document.createElement('div'); bar.className = 'fx-spot-bar'; const fill = document.createElement('i'); fill.style.width = (spotUI.pct || 0) + '%'; bar.appendChild(fill);
        const tx = document.createElement('div'); tx.className = 'fx-note fx-spot-bar-text'; tx.textContent = spotUI.pctText || 'Starting…';
        pr.append(bar, tx); d.appendChild(pr);
        const cx = document.createElement('button'); cx.type = 'button'; cx.className = 'btn small fx-track-btn'; cx.textContent = 'Cancel';
        cx.addEventListener('click', () => window.sa.spotCancel());
        br.appendChild(cx);
    }
    if (placed) {
        const up = document.createElement('button'); up.type = 'button'; up.className = 'btn small fx-track-btn'; up.textContent = 'Update';
        up.title = 'Re-key the spotlight (also adds the effect to a cut-out made before Resolve was restarted)';
        up.addEventListener('click', () => spotSend(clip, { _addEffect: 1 }, true));
        rc = document.createElement('button'); rc.type = 'button'; rc.className = 'btn small fx-track-btn'; rc.textContent = 'Re-cut';
        rc.title = 'Cut the speaker out again with the edge sliders above (same moment, same word and look)';
        if (Object.keys(spotUI.edge || {}).length) rc.classList.add('fx-spot-dirty');
        rc.disabled = spotUI.running;
        rc.addEventListener('click', () => spotRecutClip(e, clip));
        br.appendChild(rc);
        const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'btn small fx-track-btn'; rm.textContent = 'Remove';
        rm.addEventListener('click', () => spotRemoveClip(clip));
        br.append(up, rm);
    }
    d.appendChild(br);
    return d;
}
