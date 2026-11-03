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
    const target = { U: null, C: null };       // which Text+ the Text Design panel edits (node id), per stage

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
    // The first Text+ uses the preset's Text Design (m.textDesign); every other Text+ has its own (box.design).
    function primaryId(a) {
        const nodes = nodesOf(a);
        const p = nodes.find(n => n.primary) || nodes.find(n => n.kind === 'textplus' && !n.nested);
        return p ? p.id : null;
    }
    function ownsDesign(a, n) { return !!n && n.kind === 'textplus' && !n.nested && n.id !== primaryId(a); }

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
                size: (n.kind === 'textplus' && !near(b.scale, 1)) ? Math.round(n.size * b.scale * 10000) / 10000 : null,
                design: (ownsDesign(a, n) && b.design) ? b.design : null
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
        const isFrame = frameIdx !== null && frameIdx !== undefined && frameIdx >= 0;
        const fr = SAThumbs.keyedFrame(a, isFrame ? frameIdx : performance.now(), isFrame);
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
        el.title = 'Click to edit this Text+ in Text Design. Drag to move all the text together.';

        // All Text+ sit in one container: dragging any box moves the whole group (the stage transform).
        // A box only picks which Text+ the Text Design panel edits; its own placement is in Text Design > Layout.
        el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            sel[S] = n.id;
            setTarget(S, n.id);
            const cv = q('stage' + S);
            if (cv) {
                try {
                    cv.dispatchEvent(new PointerEvent('pointerdown', {
                        bubbles: true, cancelable: true, button: 0, buttons: 1,
                        clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: true
                    }));
                } catch (err) { /* ignore */ }
            }
        });
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
            host.appendChild(mk('div', 'hint', 'Drag on the viewer to move all the text together. Each Text+ has its own Text Design (font, colour, shading, and its own position under Layout).'));
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

        // Text Design for this Text+ (numbered and named like the box), instead of X / Y / Size here.
        const nums = mk('div', 'bx-nums');
        if (n.kind === 'textplus') {
            const db = mk('button', 'bx-design', '');
            db.type = 'button';
            db.append(mk('span', 'bx-dnum', String(i + 1)), mk('span', 'bx-dlbl', 'Text Design · ' + nodeName(n)));
            db.title = 'Edit the font, colour, shading and layout of ' + nodeName(n);
            db.addEventListener('click', (e) => {
                e.stopPropagation();
                setTarget(S, n.id);
                if (S === 'U' && typeof setTdOpen === 'function') setTdOpen(true);
                if (S === 'C' && typeof setCreateTdOpen === 'function') setCreateTdOpen(true);
                const w = q('tdWrap' + S);
                if (w && w.scrollIntoView) w.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });
            nums.appendChild(db);
        } else {
            nums.appendChild(mk('span', 'hint', 'Template: its design is set inside the template'));
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

    function nodeName(n) { return String(n.label || n.id).replace(/^(Text\+|Template) · /, ''); }

    // ------------------------------------------------------------ Text Design target (one design per Text+)
    function designNodes(a) { return nodesOf(a).filter(n => n.kind === 'textplus' && !n.nested); }
    function targetNode(S) {
        const { a } = modelFor(S);
        const list = designNodes(a);
        if (!list.length) return null;
        return list.find(n => n.id === target[S]) || list.find(n => n.id === primaryId(a)) || list[0];
    }
    function setTarget(S, id) {
        if (target[S] === id) { highlightRow(S); redrawStages(); return; }
        target[S] = id;
        sel[S] = id;
        highlightRow(S);
        const ctx = CTX[S];
        if (ctx && typeof fillTextDesign === 'function') fillTextDesign(ctx);
        redrawStages();
    }
    // The design the Text Design panel edits right now, or null for the preset's own (first Text+) design.
    function designFor(S, m) {
        const { a } = modelFor(S);
        if (!m || !a) return null;
        const n = targetNode(S);
        if (!n || !ownsDesign(a, n)) return null;
        const nodes = nodesOf(a);
        const b = entry(m, a, n, nodes.indexOf(n));
        if (!b.design || typeof b.design !== 'object' || !Array.isArray(b.design.elements)) {
            const src = n.design || (libEntry(m.id) && libEntry(m.id).textDesign) || m.textDesign;
            b.design = (typeof cloneTextDesign === 'function') ? cloneTextDesign(src) : JSON.parse(JSON.stringify(src || {}));
        }
        return b.design;
    }
    // Numbered target buttons at the top of the Text Design panel, named after each detected Text+.
    function renderTarget(S) {
        const host = q('tdTarget' + S);
        if (!host) return;
        const { a } = modelFor(S);
        const list = designNodes(a);
        if (list.length < 2) { host.textContent = ''; host.classList.add('hidden'); host.dataset.key = ''; return; }
        host.classList.remove('hidden');
        const all = nodesOf(a);
        const cur = targetNode(S);
        const key = a.id + '|' + list.map(n => n.id).join(',');
        if (host.dataset.key !== key) {
            host.dataset.key = key;
            host.textContent = '';
            host.appendChild(mk('span', 'td-target-lbl', 'Text+'));
            list.forEach((n) => {
                const i = all.indexOf(n);
                const btn = mk('button', 'td-target-btn');
                btn.type = 'button';
                btn.dataset.id = n.id;
                btn.style.setProperty('--bx', COLORS[i % COLORS.length]);
                btn.append(mk('span', 'bx-chip', String(i + 1)), mk('span', 'td-target-name', nodeName(n)));
                btn.title = 'Edit the Text Design of ' + nodeName(n);
                btn.addEventListener('click', () => setTarget(S, n.id));
                host.appendChild(btn);
            });
        }
        host.querySelectorAll('.td-target-btn').forEach(bt => bt.classList.toggle('on', !!cur && bt.dataset.id === cur.id));
    }
    function targetLabel(S) {
        const { a } = modelFor(S);
        if (designNodes(a).length < 2) return '';
        const n = targetNode(S);
        return n ? (nodesOf(a).indexOf(n) + 1) + ' · ' + nodeName(n) : '';
    }

    // Layout "Center" in Text Design is the position of the Text+ being edited there.
    function primaryCenter(S) {
        const { m, a } = modelFor(S);
        const nodes = nodesOf(a);
        if (!m || !nodes.length || nodes[0].nested) return null;
        const n = targetNode(S) || nodes[0];
        const b = entry(m, a, n, nodes.indexOf(n));
        return { cx: b.cx, cy: b.cy, movable: !!n.centerInput };
    }
    function setPrimaryCenter(S, cx, cy) {
        const { m, a } = modelFor(S);
        const nodes = nodesOf(a);
        if (!m || !nodes.length || nodes[0].nested) return false;
        const n = targetNode(S) || nodes[0];
        if (!n.centerInput) return false;
        const b = entry(m, a, n, nodes.indexOf(n));
        if (typeof cx === 'number' && !isNaN(cx)) b.cx = Math.round(cx * 10000) / 10000;
        if (typeof cy === 'number' && !isNaN(cy)) b.cy = Math.round(cy * 10000) / 10000;
        if (nodes.length > 1) {
            if (S === 'U') m.designRev = (m.designRev || 0) + 1;
            else if (typeof designRev !== 'undefined' && designRev.set) designRev.set(m.id, (designRev.get(m.id) || 0) + 1);
        }
        changed(S);
        return true;
    }

    // Anything besides the plain subtitle that a render has to show (custom / kept text, positions, own designs).
    function renderKey(m, a, sub) {
        const nodes = nodesOf(a);
        if (!m || nodes.length < 2 || nodes[0].nested) return '';
        const list = payload(m, a, sub, true);
        const parts = list.map(x => [x.id, x.text === null ? '\u0001' : x.text, x.cx, x.cy, x.size,
            x.design ? ((typeof designKeyOf === 'function') ? designKeyOf(x.design) : JSON.stringify(x.design)) : ''].join('\u0002'));
        return parts.join('\u0003');
    }
    function hasOverrides(m, a, sub) {
        const nodes = nodesOf(a);
        if (!m || nodes.length < 2 || nodes[0].nested) return false;
        return payload(m, a, sub, true).some((x, i) => (typeof x.text === 'string' && x.text.trim() && x.text !== sub)
            || x.cx !== null || x.size !== null || !!x.design);
    }

    window.SABoxes = { active, payload, cloneBoxes, draw, paint, hideLayer, render, liveSummary, nodesOf, primaryCenter, setPrimaryCenter,
        designFor, renderTarget, targetLabel, setTarget, renderKey, hasOverrides };
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
                    i._bg = a.preview.bg || 'black';
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
            const b = (typeof keyedBounds === 'function' ? keyedBounds(im) : keyedImage(im)._bounds);   // where the text pixels are
            if (!b || isDefaultBounds(b)) continue;
            any = true;
            minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
        }
        if (imgs.length > 1) {
            const lastIm = imgs[imgs.length - 1];
            const b = (typeof keyedBounds === 'function' ? keyedBounds(lastIm) : keyedImage(lastIm)._bounds);
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
        // The card shows the same render as the viewer: your subtitle (and, for the selected preset, your Use tab
        // changes) once it has been rendered, the preset's own sample render until then.
        const view = (typeof cardView === 'function') ? cardView(a) : a;
        const imgs = frames(view);
        // Real Fusion frames always win: they are the preset's own nodes and keyframes, never re-animated here.
        if (!framesReady(imgs) || geometry(view, imgs).blank) {
            drawSynthetic(cv, a, t, sub);
            return;
        }
        const g = geometry(view, imgs);
        const idx = frameIndex(view, imgs, t);
        const c = cv.getContext('2d');
        // Dark text is rendered on white (see previewBackground in main.js), so its card is white too.
        c.fillStyle = imgs[idx]._bg === 'white' ? '#ffffff' : '#000';
        c.fillRect(0, 0, cv.width, cv.height);
        const scale = Math.min((cv.width - 14) / g.rw, (cv.height - 10) / g.rh, 3);
        const dw = g.rw * scale, dh = g.rh * scale;
        c.imageSmoothingQuality = 'high';
        c.drawImage(imgs[idx], g.x0, g.y0, g.rw, g.rh, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
    }

    function frameIndex(a, imgs, t) {
        const total = imgs ? imgs.length : 0;
        if (total <= 1) return 0;
        const fps = (typeof fpsNow === 'function' ? fpsNow() : 25) || 25;
        // 1x real-time playback: calculate the real timeline frame over the 3-second window
        const elapsedMs = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS;
        const f = Math.floor((elapsedMs / 1000) * fps);
        // Cut at first 3 seconds: do not compress. If animation is longer, cut after 3s; if shorter, hold last frame.
        return Math.min(total - 1, f);
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
        const elapsedMs = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS;
        return Math.floor((elapsedMs / 1000) * fps);
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
        const presetName = String((a && a.name) || (curModel && curModel.name) || '').toLowerCase();
        const isSlideDown = presetName.includes('slide down') || (spec && spec.follower && Number(spec.follower.slideY) > 0.005);
        const isSlideIn = presetName.includes('slide in') || (spec && spec.follower && Number(spec.follower.slideY) < -0.005);
        const isSlide = isSlideDown || isSlideIn;
        const isTyping = presetName.includes('typing') || presetName.includes('typewriter');
        const hasFollower = !!(spec && spec.follower) || isSlide || isTyping;

        const baseSize = Number(td.size) || 0.12;
        let s = (spec && spec.sizeKeys) ? ev(spec.sizeKeys, q, baseSize) / baseSize : 1;
        if (!hasFollower && (!spec || !spec.sizeKeys) && typeof introPop === 'function') {
            s *= introPop(f);
        }
        const op = (spec && spec.opacityKeys) ? clampN(ev(spec.opacityKeys, q, 1), 0, 1) : clampN(f / 4, 0, 1);
        let rot = (spec && spec.angleKeys) ? (ev(spec.angleKeys, q, 0) * Math.PI) / 180 : 0;
        let jx = 0, jy = 0;
        const hasWiggle = !!(spec && (spec.displace || spec.perturb)) || !!td.wiggle || presetName.includes('wiggle');
        if (hasWiggle) {
            jx = Math.sin(step * 1.7 + 0.5) * px * 0.025;
            jy = Math.cos(step * 2.1 + 0.3) * px * 0.025;
            rot += Math.sin(step * 1.3) * 0.005;
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

        let totalWords = 0;
        const lineWordInfo = lines.map(line => {
            const toks = String(line).split(/(\s+)/);
            return toks.map(tok => {
                const isWord = !!tok.trim();
                const wIdx = isWord ? totalWords++ : -1;
                return { tok, isWord, wIdx };
            });
        });

        const rawDelay = Number(spec && spec.follower && spec.follower.delay) || 0.5;
        const wordDelay = isTyping ? 4 : Math.max(4, Math.min(12, Math.round(rawDelay <= 2 ? rawDelay * 10 : rawDelay)));

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
        const startY = -((lines.length - 1) / 2) * curLineH;

        const drawSyntheticLine = (li, ox, oy, isStroke) => {
            const line = lines[li];
            const ly = startY + li * curLineH + oy;
            const fullW = c.measureText(line).width;
            let curX = ox - fullW * 0.5;
            const lineToks = lineWordInfo[li] || [];

            if (!hasFollower) {
                if (isStroke) c.strokeText(line, ox, ly);
                else c.fillText(line, ox, ly);
                return;
            }

            lineToks.forEach(({ tok, isWord, wIdx }) => {
                const tw = c.measureText(tok).width;
                if (!isWord) {
                    curX += tw;
                    return;
                }
                const wordStart = wIdx * wordDelay;
                const wordAge = f - wordStart;

                if (wordAge >= 0) {
                    let easeOut = 1;
                    if (spec && spec.follower && spec.follower.pathSpline) {
                        easeOut = clampN(ev(spec.follower.pathSpline, wordAge, 1), 0, 1);
                    } else {
                        const animDur = isSlide ? 16 : 4;
                        const progress = clampN(wordAge / animDur, 0, 1);
                        easeOut = 1 - Math.pow(1 - progress, 3);
                    }

                    let dySlide = 0;
                    let dxSlide = 0;
                    if (spec && spec.follower && Math.abs(spec.follower.slideY) > 0.001) {
                        const targetDy = clampN(-spec.follower.slideY * H * 0.8, -px * 1.1, px * 1.1);
                        dySlide = (1 - easeOut) * targetDy;
                    } else if (isSlideDown) {
                        dySlide = -(1 - easeOut) * (px * 0.75);
                    } else if (isSlideIn) {
                        dySlide = (1 - easeOut) * (px * 0.85);
                    }

                    if (spec && spec.follower && Math.abs(spec.follower.slideX) > 0.001) {
                        const targetDx = clampN(spec.follower.slideX * W * 0.8, -px * 1.2, px * 1.2);
                        dxSlide = (1 - easeOut) * targetDx;
                    }

                    let wordAlpha = 1;
                    if (spec && spec.follower && spec.follower.opacityKeys) {
                        wordAlpha = clampN(ev(spec.follower.opacityKeys, wordAge, 1), 0, 1);
                    } else {
                        wordAlpha = clampN(wordAge / (isSlide ? 6 : 2), 0, 1);
                    }

                    let wordScale = 1;
                    if (spec && spec.follower && spec.follower.sizeKeys) {
                        wordScale = clampN(ev(spec.follower.sizeKeys, wordAge, 1), 0.7, 1.3);
                    } else if (isTyping) {
                        wordScale = wordAge < 4 ? 0.93 + 0.07 * easeOut : 1.0;
                    } else if (isSlide) {
                        wordScale = wordAge < 16 ? 0.97 + 0.03 * easeOut : 1.0;
                    }

                    let wordRot = 0;
                    if (spec && spec.follower && spec.follower.rotKeys) {
                        wordRot = (ev(spec.follower.rotKeys, wordAge, 0) * Math.PI) / 180;
                    }

                    let glitchDx = 0;
                    if (isSlideIn && wordAge < 8) {
                        glitchDx = (Math.sin(wordAge * 12.3) > 0.4 ? 2 : -1) * (1 - wordAge / 8);
                    }

                    c.save();
                    c.translate(curX + tw * 0.5 + dxSlide + glitchDx, ly + dySlide);
                    if (wordRot) c.rotate(wordRot);
                    if (wordScale !== 1) c.scale(wordScale, wordScale);
                    if (wordAlpha < 1) c.globalAlpha = (c.globalAlpha || 1) * wordAlpha;

                    if (isStroke) c.strokeText(tok, 0, 0);
                    else c.fillText(tok, 0, 0);
                    c.restore();
                }
                curX += tw;
            });
        };

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
                const maxW = Math.max(12, maxFullLineW);
                const angleRad = ((Number(el.mappingAngle) || 0) * Math.PI) / 180;
                const hw = (maxW / 2) * (Number(el.mappingSize) || 1);
                const dx = Math.cos(angleRad) * hw;
                const dy = Math.sin(angleRad) * hw;
                const gr = c.createLinearGradient(-dx, -dy, dx, dy);
                gr.addColorStop(0, el.color || '#ffffff');
                gr.addColorStop(1, el.color2 || '#f07b8e');
                col = gr;
            }
            const shape = Number(el.shape) || 0;
            if (shape === 2 || shape === 3) {
                const maxW = Math.max(12, maxFullLineW);
                const bw = maxW + px * (0.48 + (Number(el.extendH) || 0) * 2.8);
                const bh = (numLines * curLineH) + px * (0.28 + (Number(el.extendV) || 0) * 2.2);
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
                lines.forEach((_, li) => drawSyntheticLine(li, ox, oy, true));
            } else {
                c.fillStyle = col;
                lines.forEach((_, li) => drawSyntheticLine(li, ox, oy, false));
            }
            c.restore();
        }
        if (!drew) {
            c.globalAlpha = op;
            c.fillStyle = '#ffffff';
            lines.forEach((_, li) => drawSyntheticLine(li, 0, 0, false));
        }
        c.restore();
    }

    // The frame to show at time t (keyed so the black background is transparent over the video).
    // isFrame: t is a timeline frame number; otherwise t is a clock time in ms. (Telling them apart by "is it a whole
    // number" was wrong: the clock often lands on whole milliseconds, which made the preview jump to its last frame.)
    function keyedFrame(a, t, isFrame) {
        const imgs = frames(a);
        if (!framesReady(imgs)) return null;
        if (geometry(a, imgs).blank) return null;
        const total = imgs ? imgs.length : 0;
        if (total <= 0) return null;
        let idx = 0;
        if (isFrame === true) {
            // Timeline frame number: play at 1x real speed, hold final frame if reached
            idx = Math.min(total - 1, t);
        } else {
            // Millisecond timestamp: play at 1x real speed, cut at 3 seconds
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
                    if (hasRealFrames(a)) {
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
            // Card previews are the preset's default look, so they always use its sample text.
            void liveSub;
            try { res = await window.sa.makePreview(id, null); } catch (e) { res = { error: String(e && e.message || e) }; }
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
        if (busy.has(a.id)) wrap.appendChild(renderOverlay(true));
        if (!hasFrames && !busy.has(a.id) && (failed.has(a.id) || a.missing)) {
            const e = document.createElement('div');
            e.className = 'thumb-badge';
            {
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
        // The card's default look always shows "Sample text": previews captured from a timeline clip (or older
        // renders made with a subtitle) still show that clip's own words, so they are rendered again once.
        if (a.preview.text !== '') return true;
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
    // Each preset is tried automatically once per state of its preview; a render that comes back empty is not
    // retried over and over (that was an endless render loop) - its card offers Retry instead.
    const autoTried = new Map();
    setInterval(() => {
        if (busy.size || batch || state.busy || !state.live || !state.live.ok) return;
        const sig = (a) => a.preview ? String(a.preview.stamp || 0) : 'none';
        const next = state.lib.animations.find(a => needsPreview(a) && !failed.has(a.id) && autoTried.get(a.id) !== sig(a));
        if (!next) return;
        autoTried.set(next.id, sig(next));
        render(next.id).then(() => {
            const a = libEntry(next.id);
            if (a) autoTried.set(a.id, sig(a));
            if (a && needsPreview(a)) failed.set(a.id, 'The render came back empty. Press Retry to render it again.');
        });
    }, 2500);

    // A "Rendering…" layer over a preview while Fusion renders it.
    function renderOverlay(small) {
        const o = document.createElement('div');
        o.className = 'render-ov' + (small ? ' small' : '');
        o.innerHTML = '<span class="render-spin"></span><span class="render-lbl">Rendering…</span>';
        return o;
    }
    function syncOverlays() {
        document.querySelectorAll('canvas.thumb').forEach((cv) => {
            const wrap = cv.parentElement;
            if (!wrap) return;
            const cur = wrap.querySelector('.render-ov');
            const on = busy.has(cv.dataset.id);
            if (on && !cur) wrap.appendChild(renderOverlay(true));
            else if (!on && cur) cur.remove();
        });
        if (typeof redrawStages === 'function') redrawStages();
    }
    function markBusy(id, on) {
        if (on) busy.add(id); else busy.delete(id);
        syncOverlays();
    }
    function isBusy(id) { return busy.has(id); }

    function drawAll(t) {
        const ts = (t !== undefined) ? t : performance.now();
        document.querySelectorAll('canvas.thumb').forEach(cv => draw(cv, ts));
    }

    window.SAThumbs = { thumb, syncHeader, render, bounds, keyedFrame, isBlank, hasRealFrames, drawAll, wrapToLines, markBusy, isBusy, renderOverlay };
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
