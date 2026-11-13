// Effect Preset cards: Track Subject.

// ---- Track Subject (src/main/subject-track.js): the selected clip follows a subject in the footage under it.
// The card's options: what was tracked, Follow X / Y / Scale and Smoothing (re-keyed from the stored track at once,
// no tracking), and Re-track. Switching the card on (or Re-track) opens the Track sheet.
function fxTrackOptions(e, st, clip) {
    const p = fxParamsShown(e);
    const d = document.createElement('div');
    d.className = 'fx-opts fx-track-opts';
    const info = document.createElement('div'); info.className = 'fx-note';
    const t = clip && clip.track;
    info.textContent = st === 'none' ? 'Click to pick a subject in the footage under the selected clip'
        : (t && t.tracked ? 'Tracked ' + t.frames + ' frames' + (t.lost ? ' · lost on ' + t.lost : '') : 'Not tracked yet');
    d.appendChild(info);
    const send = (vals, now) => fxSendParams(e, st, vals, now);
    const checks = document.createElement('div'); checks.className = 'fx-opt-row fx-track-checks';
    for (const [k, label, tip] of [['FollowX', 'Follow X', 'Move left / right with the subject'], ['FollowY', 'Follow Y', 'Move up / down with the subject'], ['FollowScale', 'Scale', 'Grow / shrink as the subject comes closer or moves away'], ['FollowRot', 'Rotation', 'Turn with the subject as it tilts in the picture']]) {
        const l = document.createElement('label'); l.className = 'fx-check'; l.title = tip;
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = Number(p[k]) >= 0.5;
        cb.addEventListener('change', () => send({ [k]: cb.checked ? 1 : 0 }, true));
        l.append(cb, document.createTextNode(label));
        checks.appendChild(l);
    }
    // re-keys on release only: re-keying on every drag step while Resolve renders is what preceded a crash
    const row = sliderRow({
        label: 'Smoothing', min: 0, max: 100, value: p.Smooth, tip: 'Smooths out tracking jitter (0 = raw track). Double-click: default', onGrab: () => { fxUI.sliding = true; }, onRelease: () => { fxUI.sliding = false; },
        onChange: v => send({ Smooth: v }, true),
        onReset: () => { const v = e.track.defaults.Smooth; send({ Smooth: v }, true); return v; }
    }).el;
    // moved / trimmed since it was keyed: the panel never re-keys by itself (no writes from the background poll)
    if (t && t.tracked && t.stale && clip) {
        const up = document.createElement('button'); up.type = 'button'; up.className = 'btn small fx-track-btn';
        up.textContent = 'Update'; up.title = 'The clip moved or was trimmed since it was tracked: re-attach it from the stored track';
        info.textContent += ' · clip moved since';
        up.addEventListener('click', async () => {
            up.disabled = true;
            let r = null;
            try { r = await window.sa.trackSettings(clip.id, {}); } catch (err) { r = { error: String(err && err.message || err) }; }
            if (r && r.error) setStatus(r.error, 'bad'); else { setStatus('Re-attached ' + clip.name + '.', 'ok'); fxRefresh(true); }
            up.disabled = false;
        });
        d.appendChild(up);
    }
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small fx-track-btn';
    btn.textContent = st === 'none' ? 'Pick subject…' : 'Re-track…';
    btn.addEventListener('click', () => fxTrackOpen(e));
    d.append(checks, row, btn);
    for (const ev of ['click', 'mousedown', 'pointerdown']) d.addEventListener(ev, (x) => x.stopPropagation());
    return d;
}

const trackUI = { el: null, src: null, box: null, running: false };
function fxTrackClose() {
    if (trackUI.running) return;
    if (trackUI.el) trackUI.el.remove();
    trackUI.el = null; trackUI.src = null; trackUI.box = null;
}

async function fxTrackOpen(e) {
    fxTrackClose();
    if (!fxUI.clips.length) await fxRefresh(true);
    if (!fxUI.clips.length) { setStatus('Select the clip to attach on the timeline first.', 'bad'); return; }
    const wrap = document.createElement('div'); wrap.className = 'trk-backdrop';
    const sh = document.createElement('div'); sh.className = 'trk-sheet';
    wrap.appendChild(sh);
    wrap.addEventListener('pointerdown', (x) => { if (x.target === wrap) fxTrackClose(); });
    document.body.appendChild(wrap);
    trackUI.el = wrap;
    const head = document.createElement('div'); head.className = 'trk-head';
    const title = document.createElement('div'); title.className = 'trk-title'; title.textContent = 'Track Subject';
    const x = document.createElement('button'); x.type = 'button'; x.className = 'trk-x'; x.textContent = '×'; x.title = 'Close';
    x.addEventListener('click', fxTrackClose);
    head.append(title, x);
    const body = document.createElement('div'); body.className = 'trk-body';
    const msg = document.createElement('div'); msg.className = 'trk-msg';
    sh.append(head, body, msg);
    const say = (t, kind) => { msg.textContent = t || ''; msg.className = 'trk-msg' + (kind ? ' ' + kind : ''); };

    // tracking engine (OpenCV) - installed once, with the user's go-ahead
    let eng = null;
    try { eng = await window.sa.trackEngine(); } catch (err) { eng = null; }
    if (!eng || !eng.ready) {
        body.textContent = '';
        const p = document.createElement('p'); p.className = 'trk-p';
        p.textContent = 'Tracking uses OpenCV, which is installed once into the app\'s own folder (about ' + ((eng && eng.sizeMB) || 190) + ' MB, needs internet).';
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn primary'; b.textContent = 'Install tracking engine';
        b.disabled = !(eng && eng.canInstall);
        if (eng && !eng.canInstall) say('Python 3 was not found on this Mac (install it from python.org or Homebrew).', 'bad');
        b.addEventListener('click', async () => {
            b.disabled = true; trackUI.running = true;
            let r = null;
            try { r = await window.sa.trackInstall(); } catch (err) { r = { error: String(err && err.message || err) }; }
            trackUI.running = false;
            if (r && r.ready) { fxTrackClose(); fxTrackOpen(e); } else { b.disabled = false; say((r && r.error) || 'Install failed', 'bad'); }
        });
        body.append(p, b);
        return;
    }

    say('Loading the footage…');
    const frame = typeof tmState !== 'undefined' ? tmState.frame : null;
    let src = null;
    try { src = await window.sa.trackSource(frame); } catch (err) { src = { error: String(err && err.message || err) }; }
    if (!trackUI.el || trackUI.el !== wrap) return;
    if (!src || src.error || src.busy) { say(src && src.busy ? 'Busy placing - try again in a moment.' : ((src && src.error) || 'Could not read the footage'), 'bad'); return; }
    trackUI.src = src;
    say('');
    const info = document.createElement('div'); info.className = 'trk-info';
    const n = src.range[1] - src.range[0] + 1;
    info.textContent = 'Attach: ' + src.target.name + '  ·  to footage: ' + src.subject.name + '  ·  ' + n + ' frames';
    const stage = document.createElement('div'); stage.className = 'trk-stage';
    stage.style.aspectRatio = src.width + ' / ' + src.height;
    stage.style.width = 'min(100%, calc(56vh * ' + (src.width / src.height).toFixed(4) + '))';
    const img = document.createElement('img'); img.src = 'data:image/jpeg;base64,' + src.data; img.draggable = false;
    const box = document.createElement('div'); box.className = 'trk-box hidden';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'trk-path'); svg.setAttribute('viewBox', '0 0 1 1'); svg.setAttribute('preserveAspectRatio', 'none');
    stage.append(img, svg, box);
    const hint = document.createElement('div'); hint.className = 'trk-hint'; hint.textContent = 'Drag a box around the subject (a face, a product, a person).';
    // box: 0..1 of the picture, top-left origin
    // after a track: the tracked frames play back here with the tracked box on each (pv), until a new box is drawn
    const pv = { on: false, r: null, i: 0, timer: null };
    const player = document.createElement('div'); player.className = 'trk-player hidden';
    const play = document.createElement('button'); play.type = 'button'; play.className = 'trk-play'; play.textContent = '▶';
    const scrub = document.createElement('input'); scrub.type = 'range'; scrub.min = '0'; scrub.step = '1'; scrub.value = '0';
    const pvLab = document.createElement('span'); pvLab.className = 'trk-pvlab';
    player.append(play, scrub, pvLab);
    const showFrame = (i) => {
        const fr = pv.r.preview[i];
        if (!fr) return;
        pv.i = i; scrub.value = String(i);
        img.src = 'data:image/jpeg;base64,' + fr.data;
        const b = pv.r.track[fr.f];
        box.classList.toggle('hidden', !b);
        if (b) {
            Object.assign(box.style, { left: (b[0] - b[2] / 2) * 100 + '%', top: (b[1] - b[3] / 2) * 100 + '%', width: b[2] * 100 + '%', height: b[3] * 100 + '%' });
            box.classList.toggle('lost', !b[4]);
            box.style.transform = 'rotate(' + (Number(b[5]) || 0) + 'deg)';
        }
        pvLab.textContent = (fr.f - src.range[0]) + ' / ' + (src.range[1] - src.range[0]) + (b && !b[4] ? '  lost' : '');
    };
    const stop = () => { clearInterval(pv.timer); pv.timer = null; play.textContent = '▶'; };
    const start = () => {
        if (!pv.on) return;
        stop(); play.textContent = '❚❚';
        const fps = Math.max(1, (Number(src.fps) || 25) / (pv.r.step || 1));
        pv.timer = setInterval(() => {
            if (!trackUI.el || trackUI.el !== wrap) { stop(); return; }
            showFrame((pv.i + 1) % pv.r.preview.length);
        }, 1000 / fps);
    };
    play.addEventListener('click', () => { if (pv.timer) stop(); else start(); });
    scrub.addEventListener('input', () => { stop(); showFrame(Number(scrub.value)); });
    const enterPreview = (r) => {
        if (!r.preview || !r.preview.length) return;
        pv.on = true; pv.r = r;
        scrub.max = String(r.preview.length - 1);
        player.classList.remove('hidden');
        stage.classList.add('previewing');
        hint.textContent = 'Playing the tracked frames: the box should stay on the subject. Drag on the picture to draw a new box and track again.';
        showFrame(0); start();
    };
    const exitPreview = () => {
        stop(); pv.on = false;
        player.classList.add('hidden');
        stage.classList.remove('previewing');
        box.classList.remove('lost'); box.style.transform = '';
        img.src = 'data:image/jpeg;base64,' + src.data;
        hint.textContent = 'Drag a box around the subject (a face, a product, a person).';
        go.textContent = 'Track'; go.classList.remove('trk-done');
        svg.textContent = '';
    };
    const paintBox = () => {
        const b = trackUI.box;
        box.classList.toggle('hidden', !b);
        if (b) Object.assign(box.style, { left: b[0] * 100 + '%', top: b[1] * 100 + '%', width: b[2] * 100 + '%', height: b[3] * 100 + '%' });
        go.disabled = !b || trackUI.running;
        if (!pv.on && !go.classList.contains('trk-done')) go.textContent = b ? 'Track' : 'Draw a box around the subject first';
    };
    let drag = null;
    const at = (ev) => { const r = stage.getBoundingClientRect(); return [Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))]; };
    stage.addEventListener('pointerdown', (ev) => {
        if (trackUI.running || ev.button !== 0) return;
        if (pv.on) exitPreview();
        stage.setPointerCapture(ev.pointerId);
        const p = at(ev), b = trackUI.box;
        // inside the current box: move it; else draw a new one
        if (b && p[0] > b[0] && p[0] < b[0] + b[2] && p[1] > b[1] && p[1] < b[1] + b[3]) drag = { move: true, p0: p, b0: b.slice() };
        else drag = { move: false, p0: p };
        svg.textContent = '';
    });
    stage.addEventListener('pointermove', (ev) => {
        if (!drag) return;
        const p = at(ev);
        if (drag.move) {
            const b = drag.b0;
            trackUI.box = [Math.max(0, Math.min(1 - b[2], b[0] + p[0] - drag.p0[0])), Math.max(0, Math.min(1 - b[3], b[1] + p[1] - drag.p0[1])), b[2], b[3]];
        } else {
            const x0 = Math.min(p[0], drag.p0[0]), y0 = Math.min(p[1], drag.p0[1]);
            trackUI.box = [x0, y0, Math.abs(p[0] - drag.p0[0]), Math.abs(p[1] - drag.p0[1])];
        }
        paintBox();
    });
    const endDrag = () => { if (!drag) return; drag = null; if (trackUI.box && (trackUI.box[2] < 0.01 || trackUI.box[3] < 0.01)) trackUI.box = null; paintBox(); };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    // Follow X / Y / Scale + Smoothing used for this track (and remembered for the next one)
    const p = fxParamsShown(e);
    const opts = document.createElement('div'); opts.className = 'trk-opts';
    const vals = { FollowX: Number(p.FollowX) >= 0.5 ? 1 : 0, FollowY: Number(p.FollowY) >= 0.5 ? 1 : 0, FollowScale: Number(p.FollowScale) >= 0.5 ? 1 : 0, FollowRot: Number(p.FollowRot) >= 0.5 ? 1 : 0, Smooth: Number(p.Smooth) };
    for (const [k, label] of [['FollowX', 'Follow X'], ['FollowY', 'Follow Y'], ['FollowScale', 'Scale'], ['FollowRot', 'Rotation']]) {
        const l = document.createElement('label'); l.className = 'fx-check';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = vals[k] === 1;
        cb.addEventListener('change', () => { vals[k] = cb.checked ? 1 : 0; fxRememberParams(e, Object.assign(fxNextParams(e), vals)); });
        l.append(cb, document.createTextNode(label));
        opts.appendChild(l);
    }
    opts.appendChild(sliderRow({
        label: 'Smoothing', min: 0, max: 100, step: null, value: vals.Smooth, cls: { row: 'fx-strength trk-smooth' },
        onInput: v => { vals.Smooth = v; fxRememberParams(e, Object.assign(fxNextParams(e), vals)); }
    }).el);
    if (/Text\+|MultiText|Title/i.test(src.target.name || '')) {
        const note = document.createElement('div'); note.className = 'trk-note';
        note.textContent = 'Captions normally stay horizontally centred - untick Follow X to keep this one centred.';
        opts.appendChild(note);
    }
    for (const w of src.warnings || []) { const note = document.createElement('div'); note.className = 'trk-note'; note.textContent = w; opts.appendChild(note); }

    const bar = document.createElement('div'); bar.className = 'trk-progress hidden';
    const fill = document.createElement('div'); bar.appendChild(fill);
    const foot = document.createElement('div'); foot.className = 'trk-foot';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = 'Close';
    const go = document.createElement('button'); go.type = 'button'; go.className = 'btn primary'; go.textContent = 'Track';
    foot.append(cancel, go);
    body.textContent = '';
    body.append(info, stage, player, hint, opts, bar, foot);
    // re-track: start from where the last track found the subject on this frame (or the box drawn last time)
    const prev = src.previous || {};
    if (Array.isArray(prev.trackedBox)) trackUI.box = prev.trackedBox.slice();
    else if (Array.isArray(prev.box) && prev.anchor === src.anchor) trackUI.box = prev.box.slice();
    if (trackUI.box) hint.textContent = 'The box is where the last track found the subject. Drag it to move it, or drag outside it to draw a new one, then Track.';
    paintBox();

    const PH = { frames: 'Reading footage frames', track: 'Tracking', bake: 'Attaching the clip' };
    window.sa.onTrackProgress && !fxTrackOpen._hooked && (fxTrackOpen._hooked = true, window.sa.onTrackProgress((d) => {
        const el = trackUI.el && trackUI.el.querySelector('.trk-progress > div');
        const m = trackUI.el && trackUI.el.querySelector('.trk-msg');
        if (!el || !m) return;
        if (d.phase === 'install') { m.textContent = d.text || ''; return; }
        const frac = d.total ? d.done / d.total : 1;
        const base = d.phase === 'frames' ? 0 : (d.phase === 'track' ? 0.4 : 0.95);
        const span = d.phase === 'frames' ? 0.4 : (d.phase === 'track' ? 0.55 : 0.05);
        el.style.width = Math.round((base + span * frac) * 100) + '%';
        m.textContent = (PH[d.phase] || '') + (d.total ? ' ' + d.done + ' / ' + d.total : '') + '…';
        m.className = 'trk-msg';
    }));

    cancel.addEventListener('click', async () => {
        if (trackUI.running) { await window.sa.trackCancel(); return; }
        fxTrackClose();
    });
    go.addEventListener('click', async () => {
        if (!trackUI.box || trackUI.running) return;
        trackUI.running = true; go.disabled = true; go.textContent = 'Tracking…'; cancel.textContent = 'Stop';
        bar.classList.remove('hidden'); fill.style.width = '0%';
        fxRememberParams(e, Object.assign(fxNextParams(e), vals));
        let r = null;
        try {
            r = await window.sa.trackRun({ target: src.target.id, subject: src.subject.id, range: src.range, anchor: src.anchor, box: trackUI.box, values: vals });
        } catch (err) { r = { error: String(err && err.message || err) }; }
        trackUI.running = false; cancel.textContent = 'Close'; paintBox();
        if (!r || r.error || r.busy) { bar.classList.add('hidden'); say(r && r.busy ? 'Busy placing - try again in a moment.' : ((r && r.error) || 'Tracking failed'), 'bad'); return; }
        if (r.cancelled) { bar.classList.add('hidden'); say('Stopped.'); return; }
        if (r.needInstall) { fxTrackClose(); fxTrackOpen(e); return; }
        fill.style.width = '100%';
        // the tracked path over the picture (lost frames in red)
        svg.textContent = '';
        const pts = Object.keys(r.track || {}).map(Number).sort((a, b) => a - b).map(f => r.track[f]);
        for (let i = 1; i < pts.length; i++) {
            const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            ln.setAttribute('x1', pts[i - 1][0]); ln.setAttribute('y1', pts[i - 1][1]); ln.setAttribute('x2', pts[i][0]); ln.setAttribute('y2', pts[i][1]);
            ln.setAttribute('class', pts[i][4] ? 'ok' : 'lost');
            svg.appendChild(ln);
        }
        if (Array.isArray(r.clips)) {
            const byId = new Map(r.clips.map(c => [c.id, c]));
            fxUI.clips = fxUI.clips.map(c => byId.get(c.id) || c);
            fxUI.sig = JSON.stringify(fxUI.clips);
            renderEffects();
        }
        say('Attached: ' + r.frames + ' frames tracked' + (r.lost ? ', subject lost on ' + r.lost + ' (the clip holds still there)' : '') + '.', r.lost ? '' : 'ok');
        go.textContent = r.lost ? 'Tracked (lost on ' + r.lost + ')' : 'Tracked Successfully ✓';
        go.classList.add('trk-done'); go.disabled = true;
        bar.classList.add('hidden');
        enterPreview(r);
        setStatus(src.target.name + ' now follows the subject.', 'ok');
    });
}
