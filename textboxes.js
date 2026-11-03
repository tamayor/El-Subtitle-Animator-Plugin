// Text boxes: detects the Text+ / template nodes of a preset, lets you give each its own text and place it
// individually over the real timeline frame, and edits a preset's attached Fusion file and sound.
// Runs after renderer.js and uses its globals (state, CTX, libEntry, selected, takeLib, dropZone, play, ...).
(function () {
    'use strict';

    const COLORS = ['#f07b8e', '#8ccf8e', '#7fb8ff', '#f0c36b', '#c79bff', '#6fe0d0'];
    const MODES = [
        ['sub', 'Subtitle'],
        ['l1', 'Subtitle - line 1'],
        ['l2', 'Subtitle - line 2'],
        ['l3', 'Subtitle - line 3'],
        ['custom', 'Custom text'],
        ['keep', "Keep preset's text"]
    ];
    const geo = { U: null, C: null };          // last drawn geometry, used to turn drags into positions
    const sel = { U: null, C: null };          // selected box id per stage
    const lastKey = { U: '', C: '' };
    const keep = { value: true };              // keep text and positions when swapping the Fusion file
    const msgs = { U: '', C: '' };

    const q = (id) => document.getElementById(id);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const nodesOf = (a) => (a && Array.isArray(a.nodes)) ? a.nodes : [];
    const near = (a, b) => Math.abs(a - b) < 1e-4;

    function modelFor(S) {
        const m = CTX[S].model();
        const a = S === 'U' ? selected() : libEntry(state.createId);
        return { m, a };
    }

    // Settings for one node, created with the preset's own values the first time it is needed.
    function entry(m, a, node, i) {
        if (!m.boxes || typeof m.boxes !== 'object') m.boxes = {};
        let b = m.boxes[node.id];
        if (!b) {
            b = m.boxes[node.id] = { mode: i === 0 ? 'sub' : 'keep', text: '', cx: node.cx, cy: node.cy, scale: 1 };
        }
        if (typeof b.cx !== 'number') b.cx = node.cx;
        if (typeof b.cy !== 'number') b.cy = node.cy;
        if (typeof b.scale !== 'number' || b.scale <= 0) b.scale = 1;
        if (!b.mode) b.mode = i === 0 ? 'sub' : 'keep';
        return b;
    }

    function subtitleText() {
        const el = q('subText');
        const v = el ? el.value.trim() : '';
        return v || (state.live && state.live.subtitle && state.live.subtitle.text) || '';
    }

    function resolveText(b, sub) {
        const lines = String(sub || '').split(/\r?\n/);
        switch (b.mode) {
            case 'sub': return sub;
            case 'l1': return lines[0] || '';
            case 'l2': return lines[1] || '';
            case 'l3': return lines[2] || '';
            case 'custom': return b.text || '';
            default: return null;     // keep what the preset already says
        }
    }

    // What gets sent to Fusion, one item per detected node.
    function payload(m, a, sub, withText) {
        const nodes = nodesOf(a);
        if (!nodes.length || nodes[0].nested) return [];
        return nodes.map((n, i) => {
            const b = entry(m, a, n, i);
            const moved = !near(b.cx, n.cx) || !near(b.cy, n.cy);
            return {
                id: n.id, kind: n.kind, tool: n.tool, input: n.input, centerInput: n.centerInput, label: n.label,
                text: withText === false ? null : resolveText(b, sub),
                cx: (moved && n.centerInput) ? b.cx : null,
                cy: (moved && n.centerInput) ? b.cy : null,
                size: (n.kind === 'textplus' && !near(b.scale, 1)) ? Math.round(n.size * b.scale * 10000) / 10000 : null
            };
        });
    }

    function cloneBoxes(a) {
        try { return JSON.parse(JSON.stringify((a && a.boxes) || {})); } catch (e) { return {}; }
    }

    function active(a) { const n = nodesOf(a); return n.length > 0 && !n[0].nested; }

    function changed(S) {
        const { m } = modelFor(S);
        if (!m) return;
        CTX[S].changed(m);
        redrawStages();
    }

    // ------------------------------------------------------------ overlay on the stage
    function layerFor(S) {
        const box = q('stageBox' + S);
        if (!box) return null;
        let el = q('boxLayer' + S);
        if (!el) {
            el = document.createElement('div');
            el.id = 'boxLayer' + S;
            el.className = 'bx-layer';
            box.appendChild(el);
        }
        return el;
    }

    function hideLayer(S) {
        const el = q('boxLayer' + S);
        if (el) el.textContent = '';
        geo[S] = null;
    }

    // Called from drawStage once the real frame is on the canvas.
    function draw(S, a, m, cv, vp, g, painted) {
        const layer = layerFor(S);
        if (!layer || !m) return;
        const nodes = nodesOf(a);
        const box = q('stageBox' + S);
        const cr = cv.getBoundingClientRect();
        const br = box.getBoundingClientRect();
        const f = cr.width / Math.max(1, cv.width);
        const zoom = g.zoom || 1;
        const rot = (g.rot * Math.PI) / 180, cos = Math.cos(rot), sin = Math.sin(rot);
        const dxg = (g.posX / g.tlW) * vp.vw;
        const dyg = -(g.posY / g.tlH) * vp.vh;
        const sub = subtitleText();
        // When the real animation is drawn on the stage, size each box to where the text actually is.
        const nb = (painted && nodes.length === 1 && window.SAThumbs) ? SAThumbs.bounds(a) : null;
        geo[S] = { f, vp, zoom, scale: g.scale, rot, cw: cv.width };

        const key = nodes.map(n => n.id).join('|');
        if (layer.dataset.key !== key) {
            layer.textContent = '';
            layer.dataset.key = key;
            nodes.forEach((n, i) => layer.appendChild(makeBox(S, n, i)));
        }
        nodes.forEach((n, i) => {
            const el = layer.children[i];
            if (!el) return;
            const b = entry(m, a, n, i);
            let rx = (b.cx - 0.5) * vp.vw * g.scale;
            let ry = -(b.cy - 0.5) * vp.vh * g.scale;
            if (nb) {
                rx = (((nb.x0 + nb.x1) / 2 - 0.5) + (b.cx - n.cx)) * vp.vw * g.scale;
                ry = (((nb.y0 + nb.y1) / 2 - 0.5) - (b.cy - n.cy)) * vp.vh * g.scale;
            }
            let X = vp.vx + vp.vw * 0.5 + dxg + (rx * cos - ry * sin);
            let Y = vp.vy + vp.vh * 0.5 + dyg + (rx * sin + ry * cos);
            X = cv.width * 0.5 + (X - cv.width * 0.5) * zoom;
            Y = cv.height * 0.5 + (Y - cv.height * 0.5) * zoom;
            const txt = resolveText(b, sub);
            const shown = txt === null ? (n.defaultText || '') : txt;
            const lines = String(shown || ' ').split(/\r?\n/);
            const longest = Math.max(2, ...lines.map(l => l.length));
            const fs = n.size * b.scale * g.scale * vp.vh * zoom * f;
            let w = clamp(longest * fs * 0.55 + 14, 56, cr.width * 0.98);
            let h = clamp(lines.length * fs * 1.15 + 10, 26, cr.height * 0.98);
            if (nb) {
                w = clamp((nb.x1 - nb.x0) * vp.vw * g.scale * zoom * f + 16, 40, cr.width * 0.98);
                h = clamp((nb.y1 - nb.y0) * vp.vh * g.scale * zoom * f + 12, 22, cr.height * 0.98);
            }
            el.style.left = ((cr.left - br.left) + X * f) + 'px';
            el.style.top = ((cr.top - br.top) + Y * f) + 'px';
            el.style.width = w + 'px';
            el.style.height = h + 'px';
            el.style.transform = 'translate(-50%,-50%) rotate(' + g.rot + 'deg)';
            el.classList.toggle('sel', sel[S] === n.id);
            el.classList.toggle('fixed', !n.centerInput);
            const t = el.querySelector('.bx-txt');
            const showTxt = painted ? '' : shown;     // the animation itself is the text
            if (t.textContent !== showTxt) t.textContent = showTxt;
            el.classList.toggle('live', !!painted);
        });
    }

    // Draws the preset's real rendered animation (captured from Fusion) over the video frame, looping every 3 s at real 25 or 30 fps.
    function paint(g, a, m, vp, gx, frameIdx) {
        if (!window.SAThumbs) return false;
        if (m && m.designDirty) return false;
        const tVal = (frameIdx !== null && frameIdx !== undefined && frameIdx >= 0) ? frameIdx : performance.now();
        const fr = SAThumbs.keyedFrame(a, tVal);
        if (!fr) return false;
        const nodes = nodesOf(a);
        let ox = 0, oy = 0;
        if (nodes.length === 1 && m) {
            const b = entry(m, a, nodes[0], 0);
            ox = b.cx - nodes[0].cx;
            oy = -(b.cy - nodes[0].cy);
        }
        g.save();
        g.beginPath();
        g.rect(vp.vx, vp.vy, vp.vw, vp.vh);
        g.clip();
        g.translate(vp.vx + vp.vw / 2 + (gx.posX / gx.tlW) * vp.vw, vp.vy + vp.vh / 2 - (gx.posY / gx.tlH) * vp.vh);
        if (gx.rot) g.rotate((gx.rot * Math.PI) / 180);
        if (gx.scale !== 1) g.scale(gx.scale, gx.scale);
        // Clip strictly to transform box boundary
        g.beginPath();
        g.rect(-vp.vw / 2, -vp.vh / 2, vp.vw, vp.vh);
        g.clip();
        g.drawImage(fr, -vp.vw / 2 + ox * vp.vw, -vp.vh / 2 + oy * vp.vh, vp.vw, vp.vh);
        g.restore();
        return true;
    }

    function makeBox(S, n, i) {
        const col = COLORS[i % COLORS.length];
        const el = document.createElement('div');
        el.className = 'bx-box';
        el.style.setProperty('--bx', col);
        el.dataset.id = n.id;
        const tag = document.createElement('span');
        tag.className = 'bx-tag';
        tag.textContent = (i + 1) + ' · ' + n.label.replace(/^(Text\+|Template) · /, '');
        const t = document.createElement('div');
        t.className = 'bx-txt';
        el.append(tag, t);
        el.title = n.centerInput ? 'Drag to place this text on its own. Scroll to resize.' : 'This template does not publish a position, so it cannot be moved on its own.';

        el.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            sel[S] = n.id;
            const { m, a } = modelFor(S);
            if (!m) return;
            const b = entry(m, a, n, i);
            if (n.centerInput) {
                el.setPointerCapture(e.pointerId);
                el._drag = { x0: e.clientX, y0: e.clientY, cx0: b.cx, cy0: b.cy };
            }
            highlightRow(S);
            redrawStages();
        });
        el.addEventListener('pointermove', (e) => {
            const d = el._drag, G = geo[S];
            if (!d || !G) return;
            const { m, a } = modelFor(S);
            if (!m) return;
            const b = entry(m, a, n, i);
            // screen pixels -> canvas pixels -> undo zoom, rotation and scale -> 0..1 frame units
            const px = (e.clientX - d.x0) / G.f / G.zoom, py = (e.clientY - d.y0) / G.f / G.zoom;
            const cos = Math.cos(-G.rot), sin = Math.sin(-G.rot);
            const ux = (px * cos - py * sin) / G.scale, uy = (px * sin + py * cos) / G.scale;
            let cx = d.cx0 + ux / G.vp.vw, cy = d.cy0 - uy / G.vp.vh;
            if (!e.shiftKey) {
                if (Math.abs(cx - 0.5) < 0.012) cx = 0.5;
                if (Math.abs(cy - 0.5) < 0.012) cy = 0.5;
            }
            b.cx = Math.round(cx * 10000) / 10000;
            b.cy = Math.round(cy * 10000) / 10000;
            syncRow(S, n.id);
            redrawStages();
        });
        const end = () => {
            if (!el._drag) return;
            el._drag = null;
            changed(S);
        };
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            const { m, a } = modelFor(S);
            if (!m) return;
            const b = entry(m, a, n, i);
            b.scale = clamp(Math.round(b.scale * (e.deltaY < 0 ? 1.05 : 1 / 1.05) * 1000) / 1000, 0.1, 5);
            syncRow(S, n.id);
            changed(S);
        }, { passive: false });
        return el;
    }

    // ------------------------------------------------------------ panel: one row per text box
    function highlightRow(S) {
        const host = q('boxes' + S);
        if (!host) return;
        host.querySelectorAll('.bx-row').forEach(r => r.classList.toggle('sel', r.dataset.id === sel[S]));
    }

    function syncRow(S, id) {
        const row = q('boxes' + S) && q('boxes' + S).querySelector('.bx-row[data-id="' + CSS.escape(id) + '"]');
        if (!row) return;
        const { m } = modelFor(S);
        const b = m && m.boxes && m.boxes[id];
        if (!b) return;
        const set = (cls, v) => { const i = row.querySelector(cls); if (i && document.activeElement !== i) i.value = v; };
        set('.bx-x', b.cx.toFixed(3));
        set('.bx-y', b.cy.toFixed(3));
        set('.bx-s', b.scale.toFixed(2));
    }

    function mk(tag, cls, text) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text !== undefined) el.textContent = text;
        return el;
    }

    function numField(label, cls, value, step, on) {
        const w = mk('label', 'bx-num');
        w.append(mk('span', '', label));
        const i = document.createElement('input');
        i.type = 'number';
        i.className = cls;
        i.step = step;
        i.value = value;
        i.addEventListener('input', () => { const v = Number(i.value); if (!isNaN(v)) on(v); });
        w.appendChild(i);
        return w;
    }

    function countLine(nodes) {
        const tp = nodes.filter(n => n.kind === 'textplus').length;
        const tpl = nodes.filter(n => n.kind === 'template').length;
        const parts = [];
        if (tp) parts.push(tp + ' Text+');
        if (tpl) parts.push(tpl + (tpl === 1 ? ' template' : ' templates'));
        return parts.join(' · ') || 'none found';
    }

    function renderBoxes(S) {
        const host = q('boxes' + S);
        if (!host) return;
        const { m, a } = modelFor(S);
        if (!a || !m) { host.textContent = ''; return; }
        const nodes = nodesOf(a);
        if (nodes.length < 2) { host.textContent = ''; lastKey[S] = ''; return; }   // one text: nothing to choose
        const key = a.id + '|' + nodes.map(n => n.id).join(',');
        if (key === lastKey[S] && host.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') return;
        lastKey[S] = key;
        host.textContent = '';

        const head = mk('div', 'bx-head');
        head.append(mk('span', 'label', 'Text boxes'), mk('span', 'bx-count', countLine(nodes)));
        const scan = mk('button', 'ghost bx-scan', 'Read from clip');
        scan.title = 'Read the Text+ and templates of the clip selected on your timeline, as Fusion really has them';
        scan.addEventListener('click', () => readClip(S));
        head.appendChild(scan);
        host.appendChild(head);

        if (!nodes.length) {
            host.appendChild(mk('div', 'hint', 'No Text+ or template was found in this preset’s file. The subtitle goes into the first Text+ in the comp.'));
        } else if (nodes[0].nested) {
            host.appendChild(mk('div', 'hint', 'The Text+ here sit inside a group that does not publish a text input, so they cannot be set one by one. The subtitle goes into the first Text+.'));
        }
        if (active(a)) {
            nodes.forEach((n, i) => host.appendChild(buildRow(S, m, a, n, i)));
            host.appendChild(mk('div', 'hint', 'Drag a box on the viewer to place that text on its own. Scroll over a box to resize it.'));
        }
        const live = mk('div', 'bx-live' + (msgs[S] ? '' : ' hidden'));
        live.id = 'bxLive' + S;
        live.textContent = msgs[S];
        host.appendChild(live);
        highlightRow(S);
    }

    function buildRow(S, m, a, n, i) {
        const b = entry(m, a, n, i);
        const row = mk('div', 'bx-row');
        row.dataset.id = n.id;
        row.style.setProperty('--bx', COLORS[i % COLORS.length]);
        row.addEventListener('pointerdown', () => { sel[S] = n.id; highlightRow(S); redrawStages(); });

        const top = mk('div', 'bx-top');
        top.append(mk('span', 'bx-chip', String(i + 1)), mk('span', 'bx-name', n.label), mk('span', 'bx-kind', n.kind === 'template' ? 'template' : 'Text+'));
        const reset = mk('button', 'ghost bx-reset', 'Reset');
        reset.title = 'Put this box back where the preset has it';
        reset.addEventListener('click', () => {
            b.cx = n.cx; b.cy = n.cy; b.scale = 1;
            syncRow(S, n.id);
            changed(S);
        });
        top.appendChild(reset);
        row.appendChild(top);

        const modeRow = mk('div', 'bx-mode');
        const select = document.createElement('select');
        for (const [v, label] of MODES) {
            const o = document.createElement('option');
            o.value = v; o.textContent = label;
            select.appendChild(o);
        }
        select.value = b.mode;
        modeRow.appendChild(select);
        row.appendChild(modeRow);

        const custom = document.createElement('textarea');
        custom.rows = 2;
        custom.className = 'bx-custom' + (b.mode === 'custom' ? '' : ' hidden');
        custom.placeholder = 'Text for ' + n.label;
        custom.value = b.text || '';
        custom.addEventListener('input', () => { b.text = custom.value; changed(S); });
        select.addEventListener('change', () => {
            b.mode = select.value;
            custom.classList.toggle('hidden', b.mode !== 'custom');
            if (b.mode === 'custom') custom.focus();
            changed(S);
        });
        row.appendChild(custom);

        const nums = mk('div', 'bx-nums');
        if (n.centerInput) {
            nums.append(
                numField('X', 'bx-x', b.cx.toFixed(3), '0.01', (v) => { b.cx = v; changed(S); }),
                numField('Y', 'bx-y', b.cy.toFixed(3), '0.01', (v) => { b.cy = v; changed(S); })
            );
        } else {
            nums.appendChild(mk('span', 'hint', 'Position is fixed by the template'));
        }
        if (n.kind === 'textplus') {
            nums.appendChild(numField('Size ×', 'bx-s', b.scale.toFixed(2), '0.05', (v) => { if (v > 0) { b.scale = clamp(v, 0.1, 5); changed(S); } }));
        }
        row.appendChild(nums);
        return row;
    }

    async function readClip(S) {
        const { m, a } = modelFor(S);
        const res = await window.sa.scanClip();
        if (!res || res.error) { msgs[S] = (res && res.error) || 'Could not read the clip'; lastKey[S] = ''; renderBoxes(S); return; }
        const live = res.nodes || [];
        const nodes = nodesOf(a);
        const lines = ['Fusion clip "' + res.clipName + '": ' + countLine(live)];
        if (nodes.length && live.length !== nodes.length) lines.push('The preset file lists ' + countLine(nodes) + ' - they differ.');
        live.forEach(n => {
            const t = (n.text || '').replace(/\s+/g, ' ').slice(0, 40);
            lines.push('• ' + n.label + (t ? ' - "' + t + '"' : '') + (n.pt ? '  @ ' + n.pt[0].toFixed(2) + ', ' + n.pt[1].toFixed(2) : ''));
        });
        // Pull each box's real position and size from Fusion.
        nodes.forEach((n, i) => {
            const ln = live.find(x => x.id === n.id);
            if (!ln || !m) return;
            const b = entry(m, a, n, i);
            if (ln.pt && n.centerInput) { b.cx = Math.round(ln.pt[0] * 10000) / 10000; b.cy = Math.round(ln.pt[1] * 10000) / 10000; }
            if (n.kind === 'textplus' && typeof ln.size === 'number' && n.size > 0) b.scale = clamp(Math.round(ln.size / n.size * 1000) / 1000, 0.1, 5);
        });
        msgs[S] = lines.join('\n');
        lastKey[S] = '';
        if (m) CTX[S].changed(m);
        state.liveBg.key = '';
        refreshLiveBg();
        renderBoxes(S);
        redrawStages();
    }

    // ------------------------------------------------------------ panel: the preset's attached files
    function renderFiles(S) {
        const host = q('files' + S);
        if (!host) return;
        const a = libEntry(state.createId);
        if (!a) { host.textContent = ''; return; }
        if (host.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && host.dataset.id === a.id) return;
        host.dataset.id = a.id;
        host.textContent = '';
        host.classList.add('bx-files');

        const head = mk('div', 'bx-head');
        head.append(mk('span', 'label', 'Preset files'));
        host.appendChild(head);

        const msg = mk('div', 'bx-live' + (msgs.files ? '' : ' hidden'));
        msg.textContent = msgs.files || '';

        const afterLib = (res, okText) => {
            if (res && res.error) { msgs.files = res.error; }
            else if (res && res.lib) {
                msgs.files = okText(res);
                state.lib = res.lib;
                lastKey.U = lastKey.C = '';
                syncUse(true);
                renderAll();
                return;
            }
            msg.textContent = msgs.files; msg.classList.remove('hidden');
        };

        // Fusion file
        const fRow = mk('div', 'bx-file');
        fRow.append(mk('span', 'bx-ftag', 'Fusion'), mk('span', 'bx-fname grow', a.file + (a.missing ? ' (missing)' : '')));
        const fBtn = mk('button', '', 'Replace…');
        const doFile = async (p) => afterLib(await window.sa.replaceAnimationFile(a.id, p, keep.value), (r) => {
            const na = r.lib.animations.find(x => x.id === a.id);
            const cnt = na ? nodesOf(na).length : 0;
            return 'Fusion file replaced — ' + countLine(nodesOf(na)) + ' found.' + (r.kept ? ' Text and positions kept.' : (cnt && r.oldCount && r.oldCount !== r.newCount ? ' The box count changed (' + r.oldCount + ' → ' + r.newCount + '), so text and positions were reset.' : ''));
        });
        fBtn.addEventListener('click', async () => { const p = await window.sa.pickFile('comp'); if (p && !p.error) doFile(p); });
        fRow.appendChild(fBtn);
        host.appendChild(fRow);

        const kl = mk('label', 'check bx-keep');
        const kc = document.createElement('input');
        kc.type = 'checkbox'; kc.checked = keep.value;
        kc.addEventListener('change', () => { keep.value = kc.checked; });
        kl.append(kc, document.createTextNode(' Keep text & positions when swapping (same number of boxes)'));
        host.appendChild(kl);

        // Sound
        const sRow = mk('div', 'bx-file');
        const label = a.useSfx === false ? 'No sound' : (a.sfx ? a.sfx : (state.lib.defaultSfx ? 'Default sound' : 'No sound set'));
        const pl = mk('button', 'ghost', '▶');
        pl.title = 'Hear the sound';
        pl.addEventListener('click', () => { const p = soundOf(a); if (p) play(p); });
        sRow.append(mk('span', 'bx-ftag', 'Sound'), pl, mk('span', 'bx-fname grow', label));
        const sBtn = mk('button', '', 'Replace…');
        const doSfx = async (p) => {
            if (a.useSfx === false) await window.sa.updateAnimation(a.id, { useSfx: true });
            afterLib(await window.sa.setAnimationSfx(a.id, p), () => 'Sound changed.');
        };
        sBtn.addEventListener('click', async () => { const p = await window.sa.pickFile('sfx'); if (p && !p.error) doSfx(p); });
        const sDef = mk('button', 'ghost', 'Default');
        sDef.title = 'Use the default sound effect';
        sDef.addEventListener('click', async () => {
            await window.sa.updateAnimation(a.id, { useSfx: true });
            afterLib(await window.sa.setAnimationSfx(a.id, null), () => 'Using the default sound.');
        });
        const sOff = mk('button', 'ghost', 'None');
        sOff.title = 'Add this text without any sound';
        sOff.addEventListener('click', async () => afterLib(await window.sa.updateAnimation(a.id, { useSfx: false }), () => 'No sound for this preset.'));
        sRow.append(sBtn, sDef, sOff);
        host.appendChild(sRow);
        host.appendChild(mk('div', 'hint', 'You can also drop a .comp / .setting or a sound file here.'));
        host.appendChild(msg);

        if (!host._dz) {
            host._dz = true;
            dropZone(host, async (p) => {
                const cur = libEntry(state.createId);
                if (!cur) return;
                const ext = String(p).split('.').pop().toLowerCase();
                const res = (ext === 'comp' || ext === 'setting')
                    ? await window.sa.replaceAnimationFile(cur.id, p, keep.value)
                    : await window.sa.setAnimationSfx(cur.id, p);
                if (res && res.error) { msgs.files = res.error; renderFiles('C'); return; }
                msgs.files = (ext === 'comp' || ext === 'setting') ? 'Fusion file replaced.' : 'Sound changed.';
                if (res && res.lib) { state.lib = res.lib; lastKey.U = lastKey.C = ''; syncUse(true); renderAll(); }
            });
        }
    }

    function render(S) {
        renderBoxes(S);
        if (S === 'C') renderFiles('C');
    }

    function liveSummary(nodes) {
        if (!nodes || !nodes.length) return '';
        return 'Fusion has ' + countLine(nodes);
    }

    window.SABoxes = { active, payload, cloneBoxes, draw, paint, hideLayer, render, liveSummary, nodesOf };
})();

// ---------------------------------------------------------------- preset cards: a looping 3-second preview
(function () {
    'use strict';
    const LOOP_MS = 3000;
    const busy = new Set();            // preset ids being rendered right now
    const failed = new Map();          // preset id -> why its preview could not be rendered
    let batch = null;                  // { done, total } while "Make previews" runs
    const geoCache = new Map();

    const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const isDefaultBounds = (b) => b && Math.abs(b.x - 0.2) < 1e-6 && Math.abs(b.y - 0.4) < 1e-6 && Math.abs(b.w - 0.6) < 1e-6 && Math.abs(b.h - 0.2) < 1e-6;

    // Preview frames loaded directly from file URLs (or through previewFrames cache), avoiding heavy base64 IPC.
    const dataCache = new Map();
    function frames(a) {
        if (!a || !a.preview) return null;
        if (typeof previewFrames === 'function') {
            const list = previewFrames(a);
            if (list && list.length) return list;
        }
        const key = a.id + ':' + (a.preview.stamp || 0) + ':' + a.preview.count;
        let e = dataCache.get(key);
        if (!e) {
            e = { imgs: null };
            dataCache.set(key, e);
            if (a.previewFiles && a.previewFiles.length) {
                e.imgs = a.previewFiles.map((p) => {
                    const i = new Image();
                    i.src = (typeof fileUrl === 'function' ? fileUrl(p) : ('file://' + p)) + '?v=' + (a.preview.stamp || 0);
                    return i;
                });
            } else if (window.sa && window.sa.previewData) {
                window.sa.previewData(a.id).then((r) => {
                    if (r && r.frames && r.frames.length) e.imgs = r.frames.map((b64) => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; return i; });
                }).catch(() => { dataCache.delete(key); });
            }
        }
        return e.imgs;
    }

    function framesReady(imgs) { return imgs && imgs.length && imgs.every(i => i.complete && i.naturalWidth); }

    // Scan captured frames (sampled across the animation for speed) to compute the text bounding box.
    function geometry(a, imgs) {
        const key = a.id + ':' + (a.preview && a.preview.stamp) + ':' + imgs.length;
        let g = geoCache.get(key);
        if (g) return g;
        let minX = 1, minY = 1, maxX = 0, maxY = 0, any = false;
        const step = Math.max(1, Math.floor(imgs.length / 12));
        for (let i = 0; i < imgs.length; i += step) {
            const im = imgs[i];
            const b = keyedImage(im)._bounds;          // finds where the text pixels are in this frame
            if (!b || isDefaultBounds(b)) continue;
            any = true;
            minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
        }
        if (imgs.length > 1) {
            const lastIm = imgs[imgs.length - 1];
            const b = keyedImage(lastIm)._bounds;
            if (b && !isDefaultBounds(b)) {
                any = true;
                minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
            }
        }
        if (!any) { minX = 0.25; minY = 0.42; maxX = 0.75; maxY = 0.58; }
        const W = imgs[0].naturalWidth, H = imgs[0].naturalHeight;
        const bw = (maxX - minX) * W, bh = (maxY - minY) * H;
        const px = Math.max(3, bw * 0.05), py = Math.max(3, bh * 0.1);
        const x0 = clampN(minX * W - px, 0, W - 4), y0 = clampN(minY * H - py, 0, H - 4);
        const x1 = clampN(maxX * W + px, x0 + 4, W), y1 = clampN(maxY * H + py, y0 + 4, H);
        g = { x0, y0, rw: x1 - x0, rh: y1 - y0, nb: { x0: minX, y0: minY, x1: maxX, y1: maxY }, blank: !any };
        geoCache.set(key, g);
        return g;
    }

    function activeSubtitleText() {
        const el = document.getElementById('subText');
        const v = el ? el.value.trim() : '';
        return v || (typeof state !== 'undefined' && state.live && state.live.subtitle && state.live.subtitle.text && state.live.subtitle.text.trim()) || '';
    }

    function draw(cv, t) {
        const a = libEntry(cv.dataset.id);
        if (!a) return;
        const sub = activeSubtitleText();
        const imgs = frames(a);
        if (sub || !framesReady(imgs) || geometry(a, imgs).blank) {
            drawSynthetic(cv, a, t, sub);
            return;
        }
        const g = geometry(a, imgs);
        const idx = frameIndex(a, imgs, t);
        const c = cv.getContext('2d');
        c.fillStyle = '#000';
        c.fillRect(0, 0, cv.width, cv.height);
        const scale = Math.min((cv.width - 14) / g.rw, (cv.height - 10) / g.rh, 3);
        const dw = g.rw * scale, dh = g.rh * scale;
        c.imageSmoothingQuality = 'high';
        c.drawImage(imgs[idx], g.x0, g.y0, g.rw, g.rh, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
    }

    function frameIndex(a, imgs, t) {
        const total = imgs ? imgs.length : 0;
        if (total <= 1) return 0;
        const progress = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS / LOOP_MS;
        const idx = Math.floor(progress * total);
        return Math.min(total - 1, Math.max(0, idx));
    }

    // Normalized text bounds over the whole animation, or null while the frames are not loaded.
    function bounds(a) {
        const imgs = frames(a);
        return (framesReady(imgs) && !geometry(a, imgs).blank) ? geometry(a, imgs).nb : null;
    }

    // True when the captured frames loaded but hold no visible text (an empty render).
    function isBlank(a) {
        const imgs = frames(a);
        return !!(framesReady(imgs) && geometry(a, imgs).blank);
    }

    function hasRealFrames(a) {
        const imgs = frames(a);
        return !!(framesReady(imgs) && !geometry(a, imgs).blank);
    }

    // Frame of the built-in animation loop at time t (timeline frames).
    function autoFrame(t) {
        const fps = (typeof fpsNow === 'function') ? fpsNow() : 25;
        return Math.floor(((t % LOOP_MS) / 1000) * fps);
    }

    function wrapToLines(text) {
        if (!text) return [];
        return String(text).split(/\r?\n/).filter(Boolean);
    }

    // Draws the preset's text design with a built-in animation (pop-in, keys from the Fusion file, wiggle),
    // used until real Fusion frames exist or when the capture came back empty, or for live subtitle rendering.
    function drawSynthetic(cv, a, t, customSub) {
        const c = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.filter = 'none';
        c.fillStyle = '#000';
        c.fillRect(0, 0, W, H);
        const curModel = (typeof state !== 'undefined' && state.tab === 'apply' && state.selectedId === a.id && state.use)
            ? state.use
            : (typeof state !== 'undefined' && state.tab === 'library' && state.createId === a.id && libEntry(state.createId))
                ? libEntry(state.createId)
                : a;
        const rawTd = (curModel && curModel.textDesign) || (a && a.textDesign) || {};
        const td = (typeof cloneTextDesign === 'function') ? cloneTextDesign(rawTd) : rawTd;
        const spec = td.animSpec || null;
        const f = autoFrame(t);
        const rep = Math.max(1, Number(spec && spec.frameRepeat) || (td.wiggle ? 4 : 1));
        const q = Math.floor(f / rep) * rep, step = Math.floor(f / rep);
        const ev = (typeof evalSpline === 'function') ? evalSpline : (k, x, d) => d;
        const baseSize = Number(td.size) || 0.12;
        let s = (spec && spec.sizeKeys) ? ev(spec.sizeKeys, q, baseSize) / baseSize : ((typeof introPop === 'function') ? introPop(f) : 1);
        const op = (spec && spec.opacityKeys) ? clampN(ev(spec.opacityKeys, q, 1), 0, 1) : clampN(f / 4, 0, 1);
        let rot = (spec && spec.angleKeys) ? (ev(spec.angleKeys, q, 0) * Math.PI) / 180 : 0;
        let jx = 0, jy = 0;
        const pt = (spec && spec.perturb) || (td.wiggle ? { xScale: 0.022, yScale: 0.022 } : null);
        if (pt) {
            jx = Math.sin(step * 2.3 + 0.7) * W * (Number(pt.xScale) || 0.022) * 0.5;
            jy = Math.cos(step * 2.9 + 0.4) * H * (Number(pt.yScale) || 0.022) * 0.5;
            rot += Math.sin(step * 1.9) * 0.03;
        }
        const st = String(td.style || 'Bold').toLowerCase();
        let weight = '700';
        if (/black|heavy/.test(st)) weight = '900';
        else if (/extrabold|ultrabold/.test(st)) weight = '800';
        else if (/semibold|demi/.test(st)) weight = '600';
        else if (/medium/.test(st)) weight = '500';
        else if (/light|thin/.test(st)) weight = '300';
        else if (/regular|normal/.test(st)) weight = '400';
        const italic = /italic|oblique/.test(st) ? 'italic ' : '';

        const subText = (customSub !== undefined && customSub !== null && String(customSub).trim() !== '')
            ? String(customSub).trim()
            : activeSubtitleText();
        const rawText = subText || 'Sample text';
        const lines = wrapToLines(rawText);
        if (!lines.length) { c.restore(); return; }

        const allWords = [];
        lines.forEach((line, li) => {
            const ws = line.split(/\s+/).filter(Boolean);
            ws.forEach(w => allWords.push({ word: w, lineIdx: li }));
        });

        let renderLines = lines;
        if (spec && spec.follower && allWords.length > 1) {
            const maxAnimFrames = Math.floor(autoFrame(LOOP_MS) * 0.55);
            const baseDelay = Math.max(1, Math.min(5, Math.floor(maxAnimFrames / allWords.length)));
            const delay = Math.max(1, Math.min(baseDelay, Math.max(1, Math.round(Number(spec.follower.delay || 1) * 3))));
            const count = Math.min(allWords.length, Math.max(1, Math.floor(f / delay)));
            const lineBuckets = lines.map(() => []);
            for (let i = 0; i < count; i++) {
                const item = allWords[i];
                lineBuckets[item.lineIdx].push(item.word);
            }
            renderLines = lineBuckets.map(b => b.join(' '));
        }

        const numLines = lines.length;
        let px = Math.round(H * (numLines > 1 ? 0.22 : 0.28));
        const setFont = () => { c.font = italic + weight + ' ' + px + 'px "' + (td.font || 'Poppins') + '", -apple-system, sans-serif'; };
        setFont();
        const maxFullLineW = Math.max(...lines.map(l => c.measureText(l).width));
        const fitW = (W * 0.82) / Math.max(1, maxFullLineW);
        if (fitW < 1) { px = Math.max(10, Math.floor(px * fitW)); setFont(); }
        const lineSpacing = clampN(Number(td.lineSpacing) || 1, 0.6, 2.0);
        const curLineH = px * lineSpacing * 1.18;
        const totalFullH = curLineH * numLines;
        if (totalFullH > H * 0.82) {
            px = Math.max(10, Math.floor(px * ((H * 0.82) / totalFullH)));
            setFont();
        }

        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const startY = -((renderLines.length - 1) / 2) * curLineH;

        c.save();
        c.translate(W / 2 + jx, H / 2 + jy);
        if (rot) c.rotate(rot);
        if (s !== 1) c.scale(s, s);
        const els = Array.isArray(td.elements) ? td.elements : [];
        let drew = false;
        for (let i = Math.min(8, els.length); i >= 1; i--) {
            const el = els[i - 1];
            if (!el || !el.enabled || el.alpha === 0) continue;
            const o = clampN(Number(el.opacity ?? 1) * op, 0, 1);
            if (o <= 0.005) continue;
            drew = true;
            c.save();
            c.globalAlpha = o;
            const ox = (Number(el.offsetX) || 0) * px * 0.85, oy = -(Number(el.offsetY) || 0) * px * 0.85;
            const soft = Number(el.softness) || 0;
            if (soft > 0) c.filter = 'blur(' + Math.min(8, soft * px * 0.06).toFixed(1) + 'px)';
            let col = el.color || '#ffffff';
            if (Number(el.type) === 2) {
                const activeWidths = renderLines.map(l => l ? c.measureText(l).width : 0);
                const maxW = Math.max(12, ...activeWidths);
                const gr = c.createLinearGradient(-maxW / 2, 0, maxW / 2, 0);
                gr.addColorStop(0, el.color || '#ffffff');
                gr.addColorStop(1, el.color2 || '#f07b8e');
                col = gr;
            }
            const shape = Number(el.shape) || 0;
            if (shape === 2 || shape === 3) {
                const activeWidths = renderLines.map(l => l ? c.measureText(l).width : 0);
                const maxW = Math.max(12, ...activeWidths);
                const activeLineCount = renderLines.filter(Boolean).length || 1;
                const bw = maxW + px * (0.48 + (Number(el.extendH) || 0) * 2.8);
                const bh = (activeLineCount * curLineH) + px * (0.28 + (Number(el.extendV) || 0) * 2.2);
                const r = clampN(Number(el.round) || 0, 0, 1) * Math.min(bw, bh) * 0.5;
                c.beginPath();
                if (typeof c.roundRect === 'function') c.roundRect(-bw / 2 + ox, -bh / 2 + oy, bw, bh, r);
                else c.rect(-bw / 2 + ox, -bh / 2 + oy, bw, bh);
                if (shape === 2) { c.fillStyle = col; c.fill(); }
                else { c.strokeStyle = col; c.lineWidth = Math.max(1, (Number(el.thickness) || 0.02) * px * 4); c.stroke(); }
            } else if (shape === 1) {
                c.strokeStyle = col;
                c.lineJoin = 'round';
                c.lineWidth = Math.max(1, (Number(el.thickness) || 0.02) * px * 5);
                renderLines.forEach((l, li) => {
                    if (l) c.strokeText(l, ox, startY + li * curLineH + oy);
                });
            } else {
                c.fillStyle = col;
                renderLines.forEach((l, li) => {
                    if (l) c.fillText(l, ox, startY + li * curLineH + oy);
                });
            }
            c.restore();
        }
        if (!drew) {
            c.globalAlpha = op;
            c.fillStyle = '#ffffff';
            renderLines.forEach((l, li) => {
                if (l) c.fillText(l, 0, startY + li * curLineH);
            });
        }
        c.restore();
    }

    // The frame to show at time t (keyed so the black background is transparent over the video).
    function keyedFrame(a, t) {
        const imgs = frames(a);
        if (!framesReady(imgs)) return null;
        if (geometry(a, imgs).blank) return null;
        const total = imgs ? imgs.length : 0;
        if (total <= 0) return null;
        let idx = 0;
        if (typeof t === 'number' && Number.isInteger(t) && t >= 0) {
            const fps = (typeof fpsNow === 'function' ? fpsNow() : 25) || 25;
            const spanFrames = Math.max(1, Math.round((LOOP_MS / 1000) * fps));
            const progress = (t % spanFrames) / spanFrames;
            idx = Math.min(total - 1, Math.max(0, Math.floor(progress * total)));
        } else {
            idx = frameIndex(a, imgs, t);
        }
        return keyedImage(imgs[idx]);
    }

    let last = 0, lastStage = 0;
    function loop(ts) {
        // Always schedule the next frame first, so one drawing error can never freeze the previews.
        requestAnimationFrame(loop);
        try { tick(ts); } catch (e) { console.error('preview loop:', e); }
    }
    function tick(ts) {
        if (!document.hidden) {
            const curFps = (typeof fpsNow === 'function' ? fpsNow() : 25) || 25;
            const targetFps = (curFps >= 28 && curFps <= 32) ? 30 : (curFps >= 23 && curFps <= 26 ? 25 : curFps);
            const interval = 1000 / Math.max(20, Math.min(60, targetFps));

            if (state.tab === 'apply' && ts - last >= interval - 2) {
                last = ts;
                document.querySelectorAll('canvas.thumb').forEach(cv => draw(cv, ts));
            }
            // Keep the viewer's animation playing at real 25/30 fps while nobody is dragging.
            if ((state.tab === 'apply' || state.tab === 'library') && ts - lastStage >= interval - 2 && !state.drag && !state.stageDrag && !state.preview) {
                lastStage = ts;
                const a = state.tab === 'apply' ? selected() : libEntry(state.createId);
                if (a) {
                    const curM = (state.tab === 'apply' && state.use) ? state.use : a;
                    const isDirty = !!((curM && curM.designDirty) || (a && a.designDirty));
                    const sub = activeSubtitleText();
                    if (!sub && hasRealFrames(a) && !isDirty) {
                        redrawStages();
                    } else if (typeof drawStage === 'function') {
                        drawStage(state.tab === 'apply' ? 'U' : 'C', a, autoFrame(ts));
                    }
                }
            }
        }
    }

    async function render(ids) {
        const list = Array.isArray(ids) ? ids : [ids];
        batch = list.length > 1 ? { done: 0, total: list.length } : null;
        const liveSub = activeSubtitleText();
        for (const id of list) {
            busy.add(id);
            renderAnimations();
            setStatus('Rendering preview ' + (batch ? (batch.done + 1) + ' of ' + batch.total + ' ' : '') + 'in Resolve…');
            let res;
            try { res = await window.sa.makePreview(id, liveSub); } catch (e) { res = { error: String(e && e.message || e) }; }
            busy.delete(id);
            if (batch) batch.done++;
            if (res && res.error) {
                if (!/busy/i.test(res.error)) failed.set(id, res.error);
                setStatus(res.error, 'bad'); batch = null; renderAnimations(); return;
            }
            failed.delete(id);
            if (res && res.lib) { state.lib = res.lib; syncUse(false); }
        }
        batch = null;
        setStatus('Preview ready.', 'ok');
        renderAll();
    }

    function thumb(a) {
        const wrap = document.createElement('div');
        wrap.className = 'thumb-wrap';
        const hasFrames = a.preview && a.previewFiles && a.previewFiles.length;
        // Always a live canvas: real Fusion frames when they exist, the built-in animation until then.
        const cv = document.createElement('canvas');
        cv.className = 'thumb';
        cv.width = 208; cv.height = 116;
        cv.dataset.id = a.id;
        wrap.appendChild(cv);
        if (!hasFrames && (busy.has(a.id) || failed.has(a.id) || a.missing)) {
            const e = document.createElement('div');
            e.className = 'thumb-badge';
            if (busy.has(a.id)) {
                e.textContent = 'Rendering…';
            } else {
                const b = document.createElement('button');
                b.className = 'ghost';
                b.textContent = a.missing ? 'File missing' : (failed.has(a.id) ? 'Retry' : 'Rendering\u2026');
                b.title = failed.get(a.id) || '';
                b.disabled = !!a.missing || !failed.has(a.id);
                b.addEventListener('click', (ev) => { ev.stopPropagation(); failed.delete(a.id); render(a.id); });
                e.appendChild(b);
            }
            wrap.appendChild(e);
        }
        return wrap;
    }

    function needsPreview(a) {
        if (!a || a.missing) return false;
        if (!a.preview || !a.previewFiles || !a.previewFiles.length) return true;
        if (isBlank(a)) return true;
        return false;
    }

    function syncHeader() {
        const btn = document.getElementById('makePrevAll');
        if (!btn) return;
        const missing = state.lib.animations.filter(needsPreview);
        btn.classList.toggle('hidden', !missing.length && !batch);
        btn.disabled = !!busy.size;
        btn.textContent = batch ? 'Rendering ' + Math.min(batch.done + 1, batch.total) + '/' + batch.total + '…' : 'Make previews';
        if (!btn._bound) {
            btn._bound = true;
            btn.addEventListener('click', () => {
                const ids = state.lib.animations.filter(needsPreview).map(a => a.id);
                if (ids.length) { ids.forEach(i => failed.delete(i)); render(ids); }
            });
        }
    }

    // Presets without a preview are rendered one at a time as soon as Resolve is connected.
    setInterval(() => {
        if (busy.size || batch || state.busy || !state.live || !state.live.ok) return;
        const next = state.lib.animations.find(a => needsPreview(a) && !failed.has(a.id));
        if (next) render(next.id);
    }, 2500);

    function drawAll(t) {
        const ts = (t !== undefined) ? t : performance.now();
        document.querySelectorAll('canvas.thumb').forEach(cv => draw(cv, ts));
    }

    window.SAThumbs = { thumb, syncHeader, render, bounds, keyedFrame, isBlank, hasRealFrames, drawAll, wrapToLines };
    requestAnimationFrame(loop);
})();

// Use tab: keep the Transform sliders out of the way until you ask for them.
window.addEventListener('DOMContentLoaded', () => {
    const sec = document.querySelector('#previewU .xform-section');
    const title = sec && sec.querySelector('.xform-title');
    if (!sec || !title) return;
    sec.classList.add('xf-collapsed');
    title.classList.add('xf-toggle');
    title.textContent = 'Transform';
    title.addEventListener('click', () => sec.classList.toggle('xf-collapsed'));
});
