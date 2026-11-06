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
    const fades = {};

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
                text: withText === false ? null : textFor(a, n, b, sub),
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
        const pImgs = (typeof previewImages === 'function') ? previewImages(a) : null;
        const im0 = pImgs && pImgs[0];
        const fr0 = (im0 && im0.complete && im0.naturalWidth) ? im0 : (window.SAThumbs ? SAThumbs.keyedFrame(a, 0, true) : null);
        const imgW = (fr0 && (fr0.naturalWidth || fr0.width)) || 0;
        const imgH = (fr0 && (fr0.naturalHeight || fr0.height)) || 0;
        let drawW = vp.vw;
        let drawH = vp.vh;
        if (imgW > 0 && imgH > 0) {
            const imgAr = imgW / imgH;
            const vpAr = vp.vw / vp.vh;
            if (Math.abs(imgAr - vpAr) > 0.005) {
                if (imgAr < vpAr) {
                    drawH = vp.vh;
                    drawW = vp.vh * imgAr;
                } else {
                    drawW = vp.vw;
                    drawH = vp.vw / imgAr;
                }
            }
        }
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
                rx = (((nb.x0 + nb.x1) / 2 - 0.5) * drawW + (b.cx - n.cx) * vp.vw) * g.scale;
                ry = (-((nb.y0 + nb.y1) / 2 - 0.5) * drawH - (b.cy - n.cy) * vp.vh) * g.scale;
            }
            let X = vp.vx + vp.vw * 0.5 + dxg + (rx * cos - ry * sin);
            let Y = vp.vy + vp.vh * 0.5 + dyg + (rx * sin + ry * cos);
            X = cv.width * 0.5 + (X - cv.width * 0.5) * zoom;
            Y = cv.height * 0.5 + (Y - cv.height * 0.5) * zoom;
            const txt = textFor(a, n, b, sub);
            const shown = txt === null ? (n.defaultText || '') : txt;
            const lines = String(shown || ' ').split(/\r?\n/);
            const longest = Math.max(2, ...lines.map(l => l.length));
            const fs = n.size * b.scale * g.scale * vp.vh * zoom * f;
            let w = clamp(longest * fs * 0.55 + 14, 56, cr.width * 0.98);
            let h = clamp(lines.length * fs * 1.15 + 10, 26, cr.height * 0.98);
            if (nb) {
                w = clamp((nb.x1 - nb.x0) * drawW * g.scale * zoom * f + 16, 40, cr.width * 0.98);
                h = clamp((nb.y1 - nb.y0) * drawH * g.scale * zoom * f + 12, 22, cr.height * 0.98);
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
        const imgW = (fr && (fr.width || fr.naturalWidth)) || 0;
        const imgH = (fr && (fr.height || fr.naturalHeight)) || 0;
        let drawW = vp.vw;
        let drawH = vp.vh;
        if (imgW > 0 && imgH > 0) {
            const imgAr = imgW / imgH;
            const vpAr = vp.vw / vp.vh;
            if (Math.abs(imgAr - vpAr) > 0.005) {
                if (imgAr < vpAr) {
                    drawH = vp.vh;
                    drawW = vp.vh * imgAr;
                } else {
                    drawW = vp.vw;
                    drawH = vp.vw / imgAr;
                }
            }
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
        // A new render fades in over the old one (about 0.2 s) instead of cutting.
        const sid = (g.canvas && g.canvas.id) || 'stage';
        const stamp = a.preview ? (a.id + ':' + a.preview.stamp) : '';
        let f = fades[sid];
        if (!f) f = fades[sid] = { stamp, last: null, prev: null, t0: 0, lastW: drawW, lastH: drawH };
        if (f.stamp !== stamp) {
            f.prev = f.last;
            f.prevW = f.lastW;
            f.prevH = f.lastH;
            f.t0 = performance.now();
            f.stamp = stamp;
        }
        const dx = -drawW / 2 + ox * vp.vw, dy = -drawH / 2 + oy * vp.vh;
        const k = f.prev ? Math.min(1, (performance.now() - f.t0) / 200) : 1;
        if (k < 1 && f.prev) {
            const pW = f.prevW || drawW;
            const pH = f.prevH || drawH;
            const pDx = -pW / 2 + ox * vp.vw;
            const pDy = -pH / 2 + oy * vp.vh;
            try { g.globalAlpha = 1 - k; g.drawImage(f.prev, pDx, pDy, pW, pH); } catch (e) { f.prev = null; }
            g.globalAlpha = k;
        } else f.prev = null;
        g.drawImage(fr, dx, dy, drawW, drawH);
        g.globalAlpha = 1;
        f.last = fr;
        f.lastW = drawW;
        f.lastH = drawH;
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
        // Hovering a box still shows the group's handles and cursors (the canvas under it does the hit-testing).
        el.addEventListener('pointermove', (e) => {
            if (state.stageDrag) return;
            const cv = q('stage' + S);
            if (!cv) return;
            try { cv.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: e.pointerType })); } catch (err) { /* ignore */ }
            el.style.cursor = (cv.style.cursor && cv.style.cursor !== 'default') ? cv.style.cursor : 'grab';
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
        const mtl = nodes.filter(n => n.kind === 'multitext').length;
        const parts = [];
        if (mtl) parts.push('MultiText · ' + mtl + (mtl === 1 ? ' layer' : ' layers'));
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
        if (nodes.length < 2 || nodes.some(n => n.kind === 'multitext')) { host.textContent = ''; lastKey[S] = ''; return; }   // one text (or a MultiText, which has its own panel): nothing to choose
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
    // One grouped list: the Fusion template and the sound, each with its state (original / modified) and a Replace button.
    function renderFiles(S) {
        const host = q('files' + S);
        if (!host) return;
        const a = libEntry(state.createId);
        if (!a) { host.textContent = ''; return; }
        if (host.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && host.dataset.id === a.id) return;
        host.dataset.id = a.id;
        host.textContent = '';
        host.classList.add('pc-files');
        const st = typeof presetFileStatus === 'function' ? presetFileStatus(a) : { template: 'orig', sound: 'orig' };

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
        const pill = (kind) => {
            const p = mk('span', 'cfg-status-pill pc-pill ' + (kind === 'mod' ? 'mod' : 'orig'), kind === 'mod' ? 'Modified' : 'Original');
            p.title = kind === 'mod' ? 'Changed since the original. See "Originals" below to revert.' : 'Matches the original';
            return p;
        };

        const list = mk('div', 'pc-list');

        // Fusion template
        const fRow = mk('div', 'pc-row');
        fRow.appendChild(mk('span', 'pc-ico', '⚙'));
        const ft = mk('div', 'pc-text');
        const fv = mk('div', 'pc-val' + (a.missing ? ' bad' : ''), a.file + (a.missing ? ' (missing)' : ''));
        fv.title = a.file;
        const fcap = mk('div', 'pc-capline');
        fcap.append(mk('span', 'pc-cap', 'Text template'), pill(st.template));
        ft.append(fcap, fv);
        fRow.appendChild(ft);
        const doFile = async (p) => afterLib(await window.sa.replaceAnimationFile(a.id, p, keep.value), (r) => {
            const na = r.lib.animations.find(x => x.id === a.id);
            const cnt = na ? nodesOf(na).length : 0;
            return 'Fusion file replaced — ' + countLine(nodesOf(na)) + ' found.' + (r.kept ? ' Text and positions kept.' : (cnt && r.oldCount && r.oldCount !== r.newCount ? ' The box count changed (' + r.oldCount + ' → ' + r.newCount + '), so text and positions were reset.' : ''));
        });
        const fMore = mk('button', 'ghost pc-more pc-acts', '⋯');
        fMore.type = 'button'; fMore.title = 'Replace the template…';
        fMore.addEventListener('click', (e) => {
            e.stopPropagation();
            openPop(fMore, 'pop-menu', (el) => {
                const rep = mk('button', 'pop-item'); rep.type = 'button';
                rep.append(mk('span', 'pop-check', '⇄'), mk('span', 'pop-label', 'Replace…'));
                rep.addEventListener('click', async () => { closePop(); const p = await window.sa.pickFile('comp'); if (p && !p.error) doFile(p); });
                el.appendChild(rep);
                el.appendChild(mk('div', 'pop-sep'));
                const kp = mk('button', 'pop-item'); kp.type = 'button';
                kp.title = 'Only when the new file has the same number of text boxes';
                const ck = mk('span', 'pop-check', keep.value ? '✓' : '');
                kp.append(ck, mk('span', 'pop-label', 'Keep text & positions when swapping'));
                kp.addEventListener('click', () => { keep.value = !keep.value; ck.textContent = keep.value ? '✓' : ''; });
                el.appendChild(kp);
            });
        });
        fRow.appendChild(fMore);
        list.appendChild(fRow);

        // Sound
        const sRow = mk('div', 'pc-row');
        const sound = a.useSfx === false ? 'No sound' : (a.sfx ? a.sfx : (state.lib.defaultSfx ? 'Default sound' : 'No sound set'));
        const pl = mk('button', 'pc-ico pc-play', '▶');
        pl.type = 'button'; pl.title = 'Hear the sound';
        pl.addEventListener('click', () => { const p = soundOf(a); if (p) play(p); });
        const stx = mk('div', 'pc-text');
        const sv = mk('div', 'pc-val', sound);
        sv.title = sound;
        const scap = mk('div', 'pc-capline');
        scap.appendChild(mk('span', 'pc-cap', 'Sound effect'));
        if (st.sound !== 'none') scap.appendChild(pill(st.sound));
        stx.append(scap, sv);
        sRow.append(pl, stx);
        if (window.SASounds) {
            const acts = mk('span', 'pc-acts');
            acts.appendChild(SASounds.moreButton(CTX.C, 'main'));
            sRow.appendChild(acts);
        }
        list.appendChild(sRow);

        host.appendChild(list);
        host.appendChild(mk('div', 'hint pc-foot', 'Tip: drop a .comp, .setting or sound file here to swap it.'));
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
        renderMT(S);
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
        if (!m || (nodes.length < 2 && !isMT(a)) || nodes[0].nested) return '';
        const list = payload(m, a, sub, true);
        const parts = list.map(x => [x.id, x.text === null ? '\u0001' : x.text, x.cx, x.cy, x.size,
            x.design ? ((typeof designKeyOf === 'function') ? designKeyOf(x.design) : JSON.stringify(x.design)) : ''].join('\u0002'));
        return parts.join('\u0003');
    }
    function hasOverrides(m, a, sub) {
        const nodes = nodesOf(a);
        if (!m || (nodes.length < 2 && !isMT(a)) || nodes[0].nested) return false;
        return payload(m, a, sub, true).some((x, i) => (typeof x.text === 'string' && x.text.trim() && x.text !== sub)
            || x.cx !== null || x.size !== null || !!x.design);
    }

    // ------------------------------------------------------------ MultiText: split the subtitle into upper / emphasis / lower
    // A MultiText tool has several text layers. The panel is just three colour-coded inputs (upper, emphasis, lower) that fill
    // themselves from the current subtitle. The words below them pick the emphasis: with Emphasize active, click a word, click
    // a neighbouring word to widen it, or click any other word to start over there. Upper / Lower let you move the cut points
    // from either side instead. Emphasis on the first word leaves Upper empty, on the last word leaves Lower empty.
    // Where the emphasis sits (last words / first words / a fixed position) is remembered for the next subtitles.
    const MT_KEY = 'sa.mt.v3';
    const MT_ROLES = [['upper', 'Upper subtitle', '#7fb8ff'], ['emphasis', 'Emphasize', '#f0c36b'], ['lower', 'Lower subtitle', '#8ccf8e']];
    const mtDefault = () => ({ anchor: 'center', count: 1, start: 0, upper: false, caps: { upper: false, emphasis: false, lower: false } });
    const mt = { cfg: mtDefault(), over: null, active: 'emphasis', lastSub: null, lastKey: '' };
    try { const raw = localStorage.getItem(MT_KEY); if (raw) mt.cfg = Object.assign(mtDefault(), JSON.parse(raw)); } catch (e) { /* ignore */ }
    if (!mt.cfg.caps || typeof mt.cfg.caps !== 'object') mt.cfg.caps = { upper: false, emphasis: !!mt.cfg.upper, lower: false };
    function mtSave() { try { localStorage.setItem(MT_KEY, JSON.stringify(mt.cfg)); } catch (e) { /* ignore */ } }

    const mtNodes = (a) => nodesOf(a).filter(n => n.kind === 'multitext');
    const isMT = (a) => !!a && (a.isMultiText === true || mtNodes(a).length > 0);      // isMultiText is flagged by the backend with the preset list

    // Which layer plays which role: guessed from layer names / default texts, then size (emphasis) and height (upper / lower).
    function autoRoles(list) {
        const r = { upper: null, emphasis: null, lower: null };
        const used = new Set();
        const take = (role, re) => {
            if (r[role] !== null) return;
            const n = list.find(x => !used.has(x.layer) && re.test((x.layerName || '') + ' ' + (x.defaultText || '')));
            if (n) { r[role] = n.layer; used.add(n.layer); }
        };
        take('emphasis', /emphas|highlight|keyword|hero|\bmain\b|\bbig\b/i);
        take('upper', /upper|\btop\b|above/i);
        take('lower', /lower|bottom|below|under/i);
        const pick = (role, best) => {
            if (r[role] !== null) return;
            const p = list.filter(x => !used.has(x.layer));
            if (!p.length) return;
            const n = p.reduce((m, x) => best(x, m) ? x : m);
            r[role] = n.layer; used.add(n.layer);
        };
        pick('emphasis', (x, m) => (x.size || 0) > (m.size || 0) + 1e-6);
        pick('upper', (x, m) => x.cy > m.cy + 1e-6);
        pick('lower', (x, m) => x.cy < m.cy - 1e-6);
        return r;
    }
    const mtRoles = (a) => autoRoles(mtNodes(a));

    const mtWords = (s) => String(s || '').replace(/\r?\n/g, ' ').split(/\s+/).filter(Boolean);

    // The emphasized words as [start, end) indices for a subtitle of N words.
    function mtRange(N) {
        const c = mt.cfg;
        const k = Math.max(1, Math.min(N, Math.round(Number(c.count)) || 1));
        if (c.anchor === 'first') return [0, k];
        if (c.anchor === 'center') { const s = Math.floor((N - k) / 2); return [s, s + k]; }
        if (c.anchor === 'index') { const s = Math.min(Math.max(0, Math.round(Number(c.start)) || 0), N - 1); return [s, Math.min(N, s + k)]; }
        return [N - k, N];
    }
    // Remember a chosen range in a way that carries over to other subtitles.
    function mtSetRange(N, s, e) {
        const c = mt.cfg;
        c.count = Math.max(1, e - s);
        if (e >= N) c.anchor = 'last';
        else if (s <= 0) c.anchor = 'first';
        else if (s === Math.floor((N - c.count) / 2)) c.anchor = 'center';
        else { c.anchor = 'index'; c.start = s; }
        mt.over = null;
    }
    // A click on word i (of N), for the active role.
    function mtPick(i, N, shift) {
        const [s, e0] = mtRange(N), e = e0 - 1;
        if (mt.active === 'upper') {            // upper = words 0..i
            const ns = Math.min(i + 1, N - 1);
            mtSetRange(N, ns, Math.max(e, ns) + 1);
        } else if (mt.active === 'lower') {     // lower = words i..end
            const ne = Math.max(i - 1, 0);
            mtSetRange(N, Math.min(s, ne), ne + 1);
        } else if (i === s - 1) mtSetRange(N, i, e + 1);          // next to the emphasis on the left: widen
        else if (i === e + 1) mtSetRange(N, s, i + 1);            // next to it on the right: widen
        else mtSetRange(N, i, i + 1);                             // anywhere else: start again at this word
    }

    // The three parts for a subtitle, plus which role each word got (for the coloured chips).
    function mtSplit(sub) {
        const w = mtWords(sub), N = w.length;
        const out = { upper: '', emphasis: '', lower: '', words: w, roles: [] };
        if (!N) return out;
        const [s, e] = mtRange(N);
        out.upper = w.slice(0, s).join(' ');
        out.emphasis = w.slice(s, e).join(' ');
        out.lower = w.slice(e).join(' ');
        out.roles = w.map((_, i) => i < s ? 'upper' : (i < e ? 'emphasis' : 'lower'));
        return out;
    }

    // Split plus the case option, and any text you typed over a part (only valid for that same subtitle).
    function mtParts(sub) {
        const p = mtSplit(sub);
        const out = { upper: p.upper, emphasis: p.emphasis, lower: p.lower };
        if (mt.over && mt.over.sub === String(sub || '')) {
            for (const [k] of MT_ROLES) if (typeof mt.over[k] === 'string') out[k] = mt.over[k];
        }
        for (const [k] of MT_ROLES) if (mt.cfg.caps[k]) out[k] = out[k].toUpperCase();      // the AA button of that input
        return { parts: out, split: p };
    }

    // The text for one MultiText layer, or null to leave the preset's own text.
    function mtText(a, n, sub) {
        const r = mtRoles(a);
        const role = MT_ROLES.map(x => x[0]).find(k => r[k] === n.layer);
        if (!role) return null;
        const t = Object.assign({}, mtParts(sub).parts);
        // A role with no layer: fold its text into a neighbouring layer instead of losing it.
        const join = (x, y) => [x, y].filter(Boolean).join(' ');
        if (r.upper === null && t.upper) { if (r.lower !== null) t.lower = join(t.upper, t.lower); else if (r.emphasis !== null) t.emphasis = join(t.upper, t.emphasis); t.upper = ''; }
        if (r.lower === null && t.lower) { if (r.upper !== null) t.upper = join(t.upper, t.lower); else if (r.emphasis !== null) t.emphasis = join(t.emphasis, t.lower); t.lower = ''; }
        return t[role];
    }
    const textFor = (a, n, b, sub) => n.kind === 'multitext' ? mtText(a, n, sub) : resolveText(b, sub);

    // ---- the panel
    function mtHost() {
        let h = q('mtHostU');
        if (h) return h;
        const live = q('boxesU') || q('stageLiveU');
        if (!live || !live.parentNode) return null;
        h = document.createElement('div');
        h.id = 'mtHostU';
        h.className = 'mt-panel hidden';
        live.parentNode.insertBefore(h, live);
        return h;
    }
    // Live preview: after any change the selected preset is re-rendered with the split text once you pause for 300 ms. The
    // Use tab render is keyed by the text, so an unchanged split never renders twice. While a Resolve timeline preview
    // runs, that clip follows the panel by itself.
    let mtPreviewTimer = 0;
    function mtPreviewSoon() {
        clearTimeout(mtPreviewTimer);
        mtPreviewTimer = setTimeout(() => {
            try {
                if (typeof state === 'undefined' || state.tab !== 'apply' || state.livePrev || state.preview) return;
                const a = selected();
                if (a && isMT(a) && typeof ensureUsePreview === 'function') ensureUsePreview(a);
            } catch (e) { /* the preview is a convenience */ }
        }, 300);
    }
    function mtChanged() { mtSave(); mt.lastSub = null; const h = q('mtHostU'); const { a } = modelFor('U'); if (h && a) mtRefresh(h, a); changed('U'); mtPreviewSoon(); }

    function renderMT(S) {
        if (S !== 'U') return;
        const host = mtHost();
        if (!host) return;
        const { a } = modelFor('U');
        if (!a || !isMT(a)) { host.classList.add('hidden'); host.textContent = ''; mt.lastKey = ''; return; }
        host.classList.remove('hidden');
        const key = [a.id, mtNodes(a).map(n => n.layer).join(','), mt.active].join('|');
        if (key !== mt.lastKey) { mt.lastKey = key; mt.lastSub = null; mtBuild(host, a); }
        mtRefresh(host, a);
    }

    function mtBuild(host, a) {
        host.textContent = '';
        const roles = mtRoles(a);
        // the three inputs, colour coded
        const ins = mk('div', 'mt-ins');
        for (const [role, label, col] of MT_ROLES) {
            const ta = document.createElement('textarea');
            ta.rows = 1; ta.className = 'mt-in'; ta.dataset.role = role;
            ta.style.setProperty('--mt', col);
            ta.placeholder = label;
            const n = mtNodes(a).find(x => x.layer === roles[role]);
            ta.title = label + (n ? ' · ' + n.layerName : ' · no layer');
            ta.addEventListener('input', () => {
                if (mt.cfg.caps[role]) { const p = ta.selectionStart; ta.value = ta.value.toUpperCase(); try { ta.setSelectionRange(p, p); } catch (e) { /* ignore */ } }
                const sub = subtitleText();
                if (!mt.over || mt.over.sub !== sub) mt.over = { sub };
                mt.over[role] = ta.value;
                mtSave(); changed('U'); mtPreviewSoon();
            });
            const wrap = mk('div', 'mt-inwrap');
            wrap.style.setProperty('--mt', col);
            const cap = mk('button', 'mt-cap' + (mt.cfg.caps[role] ? ' on' : ''), 'AA');
            cap.type = 'button';
            cap.title = 'ALL CAPS for the ' + label.toLowerCase();
            cap.addEventListener('click', () => {
                mt.cfg.caps[role] = !mt.cfg.caps[role];
                cap.classList.toggle('on', mt.cfg.caps[role]);
                mtChanged();
            });
            wrap.append(ta, cap);
            ins.appendChild(wrap);
        }
        host.appendChild(ins);

        // the word breakdown: a click puts that word into whichever part is active below
        const chips = mk('div', 'mt-chips');
        chips.id = 'mtChips';
        host.appendChild(chips);

        // which part a click on a word sets
        const bar = mk('div', 'mt-roles');
        for (const [role, label, col] of MT_ROLES) {
            const b = mk('button', 'mt-rbtn' + (mt.active === role ? ' on' : ''), role === 'emphasis' ? 'Emphasize' : (role === 'upper' ? 'Upper' : 'Lower'));
            b.type = 'button';
            b.style.setProperty('--mt', col);
            b.title = role === 'emphasis'
                ? 'Click a word to emphasize it, a neighbouring word to widen it, any other word to start again'
                : (role === 'upper' ? 'Click the last word of the upper subtitle' : 'Click the first word of the lower subtitle');
            b.addEventListener('click', () => { mt.active = role; });
            bar.appendChild(b);
        }
        host.appendChild(bar);
    }

    function mtRefresh(host, a) {
        const sub = subtitleText();
        const sig = sub + '\u0001' + JSON.stringify(mt.over) + '\u0001' + JSON.stringify(mt.cfg);
        if (sig === mt.lastSub) return;
        mt.lastSub = sig;
        if (mt.over && mt.over.sub !== sub) mt.over = null;
        mtPreviewSoon();                  // the subtitle (or the split) changed: refresh the preview
        const { parts, split } = mtParts(sub);
        const chips = host.querySelector('#mtChips');
        if (chips) {
            chips.textContent = '';
            if (!split.words.length) chips.appendChild(mk('span', 'mt-empty', 'Select a subtitle to split it'));
            const N = split.words.length;
            split.words.forEach((w, i) => {
                const ch = mk('button', 'mt-chip' + (split.roles[i] ? ' r-' + split.roles[i] : ''), w);
                ch.type = 'button';
                ch.title = 'Puts this word into the part that is active below (Upper, Emphasize or Lower)';
                ch.addEventListener('click', () => { mtPick(i, N); mtChanged(); });
                chips.appendChild(ch);
            });
        }
        host.querySelectorAll('.mt-in').forEach(ta => {
            const role = ta.dataset.role;
            ta.classList.toggle('edited', !!(mt.over && typeof mt.over[role] === 'string'));
            if (document.activeElement !== ta) ta.value = parts[role];
        });
    }
    // The role buttons only change a setting: keep their highlight in step without rebuilding the panel.
    document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('#mtHostU .mt-rbtn');
        if (!b) return;
        document.querySelectorAll('#mtHostU .mt-rbtn').forEach(x => x.classList.toggle('on', x === b));
    });
    // Follow the subtitle as the playhead moves between captions.
    setInterval(() => { try { const h = q('mtHostU'); if (h && !h.classList.contains('hidden')) mtRefresh(h, modelFor('U').a); } catch (e) { /* ignore */ } }, 300);

    window.SABoxes = { renderMT, active, payload, cloneBoxes, draw, paint, hideLayer, render, liveSummary, nodesOf, primaryCenter, setPrimaryCenter,
        designFor, renderTarget, targetLabel, setTarget, renderKey, hasOverrides };
})();

// ================================================================================================================
// 🔒 PROTECTED — PRESET CARD PREVIEW (FINALIZED & VERIFIED ACCURATE). AI AGENTS / ASSISTANTS: DO NOT MODIFY. 🔒
//
// This section (from here to the matching "END PROTECTED" marker below) plays the real Resolve/Fusion frames of each
// preset on its gallery card. It is correct as it stands: frames are shown 1:1 at the speed they were captured at.
//   - Do NOT re-time, re-scale, compress, re-order, "optimise" or refactor frames(), prepare(), geometry(), draw()
//     or frameIndex().
//   - draw() and frameIndex() are the stable version from commit 122295f (restored at the user's request): frames
//     play 1x at the timeline fps over a 3-second window, and cards show cardView() (the subtitle render once in).
//   - Do NOT make drawSynthetic() win over real Fusion frames.
//   - The alignment-timeline scrub viewer draws through SAPreview (below), which reuses these exact functions.
// If a card ever looks wrong, tell the user and ask before touching anything here. The user must explicitly approve
// any change to this block. Unrelated edits elsewhere in this file are fine.
// ================================================================================================================
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
        // least-recently-used: a hit moves to the back, so frames in use (every card, the scrub viewer) are never evicted
        if (e) { dataCache.delete(key); dataCache.set(key, e); }
        if (!e) {
            e = { imgs: null };
            dataCache.set(key, e);
            trimCache(key);
            if (a.previewFiles && a.previewFiles.length) {
                // Held frames (Stop Motion, still tails) point at the frame they hold: each distinct picture is
                // loaded and keyed once, however many frames show it.
                const map = (Array.isArray(a.preview.map) && a.preview.map.length === a.previewFiles.length) ? a.preview.map : null;
                const whites = (a.preview.matte && Array.isArray(a.previewWhite) && a.previewWhite.length === a.previewFiles.length) ? a.previewWhite : null;
                const url = (p) => (typeof fileUrl === 'function' ? fileUrl(p) : ('file://' + p)) + '?v=' + (a.preview.stamp || 0);
                const byIdx = new Map();
                e.imgs = a.previewFiles.map((p, i) => {
                    const k = map ? map[i] : i;
                    if (byIdx.has(k)) return byIdx.get(k);
                    const im = new Image();
                    im._bg = whites ? 'black' : (a.preview.bg || 'black');
                    im.src = url(a.previewFiles[k] || p);
                    if (whites) { const wi = new Image(); wi.src = url(whites[i]); im._white = wi; }
                    byIdx.set(k, im);
                    return im;
                });
                e.imgs._cardBg = a.preview.bg || 'black';
                prepare(e.imgs, Array.from(byIdx.values()));
            } else if (window.sa && window.sa.previewData) {
                window.sa.previewData(a.id).then((r) => {
                    if (r && r.frames && r.frames.length) {
                        const list = r.frames.map((b64) => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; return i; });
                        prepare(list, list);
                        e.imgs = list;
                    }
                }).catch(() => { dataCache.delete(key); });
            }
        }
        return e.imgs;
    }

    // Keeps the last few renders in memory; older ones release their keyed images.
    function trimCache(keep) {
        // Room for every preset's card plus the subtitle renders: a smaller cache made the cards and the scrub viewer
        // evict each other on every redraw, so frames were loaded again and again ("Loading frames…").
        const nLib = (typeof state !== 'undefined' && state.lib && state.lib.animations) ? state.lib.animations.length : 0;
        const MAX = Math.max(24, nLib + 8);
        if (dataCache.size <= MAX) return;
        for (const [k, v] of dataCache) {
            if (dataCache.size <= MAX) break;
            if (k === keep) continue;
            dataCache.delete(k);
            if (v && v.imgs) for (const im of (v.imgs._unique || v.imgs)) { try { if (im._keyed && im._keyed.close) im._keyed.close(); } catch (e) { /* ignore */ } im._keyed = null; }
        }
    }

    // Loads every distinct frame, keys it on a worker, and only then marks the set ready, so a new render replaces
    // the old one in a single step (the old one keeps playing until then).
    function prepare(list, unique) {
        list._unique = unique;
        list._ready = false;
        const loaded = (im) => (im.decode ? im.decode() : new Promise((res, rej) => { im.onload = res; im.onerror = rej; })).catch(() => null);
        Promise.all(unique.map(im => Promise.all([loaded(im), im._white ? loaded(im._white) : null]))).then(async () => {
            const useWorkers = typeof SAKey !== 'undefined' && SAKey.available();
            if (useWorkers) {
                await Promise.all(unique.map(async (im) => {
                    if (!im.naturalWidth) return;
                    const white = (im._white && im._white.naturalWidth) ? im._white : null;
                    const r = await SAKey.key(im, white, im._bg);
                    if (r) { r.bitmap._bounds = r.bounds; im._keyed = r.bitmap; im._kbounds = r.bounds; }
                }));
            }
            list._ready = true;
            if (typeof redrawStages === 'function') redrawStages();
        });
    }

    function framesReady(imgs) {
        if (!imgs || !imgs.length) return false;
        if (imgs._ready === false) return false;
        return (imgs._unique || imgs).every(i => i.complete && i.naturalWidth);
    }

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
        const idx = holdIndex(view, imgs, frameIndex(view, imgs, t));
        const c = cv.getContext('2d');
        // Dark text is rendered on white (see previewBackground in main.js), so its card is white too.
        c.fillStyle = (imgs._cardBg || imgs[idx]._bg) === 'white' ? '#ffffff' : '#000';
        c.fillRect(0, 0, cv.width, cv.height);
        const scale = Math.min((cv.width - 14) / g.rw, (cv.height - 10) / g.rh, 3);
        const dw = g.rw * scale, dh = g.rh * scale;
        c.imageSmoothingQuality = 'high';
        const src = imgs[idx]._keyed || imgs[idx];
        c.drawImage(src, g.x0, g.y0, g.rw, g.rh, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
    }

    // Restored from the stable version (commit 122295f) at the user's request.
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

    // ===== END PROTECTED: preset card preview playback (frames / prepare / geometry / draw / frameIndex) =====

    // The 3-second capture keeps running after the text clip ends, so its last frames can be empty (black).
    // Frames after the last one that shows text hold that frame instead: the subtitle stays on screen.
    // Found once per render (scanning back from the end on a small copy) and cached.
    const holdCache = new Map();
    function lastContentFrame(imgs) {
        const W = imgs[0].naturalWidth || 1, H = imgs[0].naturalHeight || 1;
        const w = 96, h = Math.max(1, Math.round(w * H / W));
        const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
        const g = oc.getContext('2d', { willReadFrequently: true });
        for (let i = imgs.length - 1; i >= 0; i--) {
            const im = imgs[i];
            if (!im || !im.naturalWidth) continue;
            const onWhite = im._bg === 'white';
            g.fillStyle = onWhite ? '#fff' : '#000'; g.fillRect(0, 0, w, h);
            try { g.drawImage(im, 0, 0, w, h); } catch (e) { return -1; }
            let d;
            try { d = g.getImageData(0, 0, w, h).data; } catch (e) { return -1; }
            for (let p = 0; p < d.length; p += 4) {
                const hit = onWhite ? (d[p] < 231 || d[p + 1] < 231 || d[p + 2] < 231) : (d[p] > 24 || d[p + 1] > 24 || d[p + 2] > 24);
                if (hit) return i;
            }
        }
        return -1;
    }
    function holdIndex(view, imgs, idx) {
        if (!imgs || imgs.length < 2) return idx;
        const key = (view && view.id) + ':' + (view && view.preview && view.preview.stamp) + ':' + imgs.length;
        let last = holdCache.get(key);
        if (last === undefined) {
            last = lastContentFrame(imgs);
            holdCache.set(key, last);
            if (holdCache.size > 96) holdCache.delete(holdCache.keys().next().value);
        }
        return (last >= 0 && idx > last) ? last : idx;
    }

    // ============================================================================================================
    // SAPreview — the preset-card preview as one reusable component.
    // It draws a preset's real Resolve frames with exactly the card's look (the same frames() cache, the same text
    // crop from geometry(), the same background and the same fit), at any canvas size: at the card's own size
    // (208 x 116) the result is identical to draw() above, bigger canvases are the same picture scaled up.
    // It only READS the protected helpers above; it never changes how the cards play.
    //   loop  mode: plays the capture on repeat with the cards' 3-second timing (frameIndex / LOOP_MS)
    //   scrub mode: shows the one captured frame the caller asks for (the alignment timeline playhead)
    // ============================================================================================================
    const CARD_W = 208, CARD_H = 116;

    // 'none' (no frames yet) | 'loading' | 'broken' (a file can't be read) | 'blank' (render holds no text) | 'ready'
    function pvStatus(view) {
        if (!view || !view.preview || !view.previewFiles || !view.previewFiles.length) return 'none';
        const imgs = frames(view);
        if (!imgs || !imgs.length) return 'loading';
        if ((imgs._unique || imgs).some(i => i.complete && !i.naturalWidth)) return 'broken';
        if (!framesReady(imgs)) return 'loading';
        return geometry(view, imgs).blank ? 'blank' : 'ready';
    }
    function pvCount(view) { const imgs = view && frames(view); return imgs ? imgs.length : 0; }
    // Which captured frame the cards show at clock time ms (holds the last frame until the 3 s loop restarts).
    function pvLoopIndex(view, ms) { const imgs = frames(view); return imgs ? frameIndex(view, imgs, ms) : 0; }

    // Paints captured frame idx of view onto cv. Returns true when a real frame was drawn.
    function pvPaint(cv, view, idx) {
        if (pvStatus(view) !== 'ready') return false;
        const imgs = frames(view);
        const i = holdIndex(view, imgs, clampN(Math.floor(idx) || 0, 0, imgs.length - 1));
        const g = geometry(view, imgs);
        const c = cv.getContext('2d');
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.filter = 'none';
        c.fillStyle = (imgs._cardBg || imgs[i]._bg) === 'white' ? '#ffffff' : '#000';
        c.fillRect(0, 0, cv.width, cv.height);
        const k = cv.width / CARD_W;                       // margins and zoom cap scale with the canvas, as on a card
        const scale = Math.min((cv.width - 14 * k) / g.rw, (cv.height - 10 * k) / g.rh, 3 * k);
        const dw = g.rw * scale, dh = g.rh * scale;
        c.imageSmoothingQuality = 'high';
        const src = imgs[i]._keyed || imgs[i];
        try { c.drawImage(src, g.x0, g.y0, g.rw, g.rh, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh); } catch (e) { return false; }
        return true;
    }
    // The built-in animation the cards fall back to while there are no real frames.
    function pvPaintOwn(cv, a, ms) { drawSynthetic(cv, a, ms, '', true); }

    // Gives the canvas the card's shape at its on-screen width (Retina included). Returns true when it was resized.
    function pvFit(cv, maxCss) {
        const dpr = window.devicePixelRatio || 1;
        const cssW = Math.min(cv.clientWidth || CARD_W, maxCss || 1e9);
        const W = Math.max(CARD_W, Math.round(cssW * dpr)), H = Math.round(W * CARD_H / CARD_W);
        if (!cv._pvStyled) { cv.style.aspectRatio = CARD_W + ' / ' + CARD_H; cv._pvStyled = true; }
        if (cv.width === W && cv.height === H) return false;
        cv.width = W; cv.height = H;
        return true;
    }

    // A preview player bound to one canvas.
    //   const p = SAPreview.create(canvas, { view: () => preset, synthetic: true });
    //   p.play()          loop the 3 seconds (onFrame(idx) is called for every new frame shown)
    //   p.show(idx)       scrub: show captured frame idx
    //   p.stop()
    function pvCreate(cv, opts) {
        const o = Object.assign({ view: null, synthetic: false, onFrame: null }, opts || {});
        let raf = 0, t0 = 0, lastIdx = -1;
        const viewOf = () => (typeof o.view === 'function' ? o.view() : o.view);
        const api = {
            canvas: cv,
            status: () => pvStatus(viewOf()),
            count: () => pvCount(viewOf()),
            fit: (maxCss) => pvFit(cv, maxCss),
            show(idx) {
                const v = viewOf();
                if (pvPaint(cv, v, idx)) return true;
                if (o.synthetic && v) pvPaintOwn(cv, v, 0);
                return false;
            },
            play(onFrame) {
                api.stop();
                if (onFrame) o.onFrame = onFrame;
                t0 = performance.now(); lastIdx = -1;
                const tick = (now) => {
                    raf = requestAnimationFrame(tick);
                    const v = viewOf();
                    if (pvStatus(v) !== 'ready') {
                        t0 = now;                          // start from the first frame once the render is in
                        if (o.synthetic && v) pvPaintOwn(cv, v, now);
                        return;
                    }
                    const i = pvLoopIndex(v, now - t0);
                    if (i === lastIdx) return;
                    lastIdx = i;
                    pvPaint(cv, v, i);
                    if (o.onFrame) { try { o.onFrame(i, v); } catch (e) { /* ignore */ } }
                };
                raf = requestAnimationFrame(tick);
                return api;
            },
            stop() { if (raf) cancelAnimationFrame(raf); raf = 0; return api; },
            playing: () => !!raf
        };
        return api;
    }
    window.SAPreview = { create: pvCreate, paint: pvPaint, paintOwn: pvPaintOwn, status: pvStatus, count: pvCount, loopIndex: pvLoopIndex, fit: pvFit, LOOP_MS, CARD_W, CARD_H };

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
    function drawSynthetic(cv, a, t, customSub, ownSample) {
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
        const _css = (typeof saStyleToCss === 'function') ? saStyleToCss(td.style === '' ? 'Regular' : (td.style || 'Bold')) : { weight: '700', italic: false };
        const weight = _css.weight;
        const italic = _css.italic ? 'italic ' : '';

        const subText = (customSub !== undefined && customSub !== null && String(customSub).trim() !== '')
            ? String(customSub).trim()
            : (ownSample ? '' : activeSubtitleText());
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

        if (hasWiggle) {
            jx = Math.sin(step * 1.7 + 0.5) * px * 0.025;
            jy = Math.cos(step * 2.1 + 0.3) * px * 0.025;
            rot += Math.sin(step * 1.3) * 0.005;
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

    // Only presets shown by the current tag filter are rendered automatically.
    function inFilter(a) {
        try { return typeof passesTagFilter !== 'function' || passesTagFilter(a, state.tab === 'library' ? 'lib' : 'use'); } catch (e) { return true; }
    }

    function needsPreview(a) {
        if (!a || a.missing) return false;
        if (!a.preview || !a.previewFiles || !a.previewFiles.length) return true;
        if (isBlank(a)) return true;
        // The card's default look always shows "Sample text": previews captured from a timeline clip (or older
        // renders made with a subtitle) still show that clip's own words, so they are rendered again once.
        if (a.preview.text !== '') return true;
        // MultiText cards show "Sample Text 1, 2, 3...": older renders of them are made again once.
        if ((a.nodes || []).some(n => n.kind === 'multitext') && a.preview.sample !== 'mt-n') return true;
        return false;
    }

    function syncHeader() {
        const btn = document.getElementById('makePrevAll');
        if (!btn) return;
        const missing = state.lib.animations.filter(x => needsPreview(x) && inFilter(x));
        btn.classList.toggle('hidden', !missing.length && !batch);
        btn.disabled = !!busy.size;
        btn.textContent = batch ? 'Rendering ' + Math.min(batch.done + 1, batch.total) + '/' + batch.total + '…' : 'Make previews';
        if (!btn._bound) {
            btn._bound = true;
            btn.addEventListener('click', () => {
                const ids = state.lib.animations.filter(x => needsPreview(x) && inFilter(x)).map(a => a.id);
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
        const wantId = state.tab === 'library' ? state.createId : state.selectedId;
        const next = state.lib.animations.find(a => a.id === wantId && needsPreview(a) && inFilter(a) && !failed.has(a.id) && autoTried.get(a.id) !== sig(a));
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

    // True once this view's frames are loaded and keyed (starts loading them if needed).
    function ready(a) { return !!(a && a.preview && framesReady(frames(a))); }
    // drawOwn: draws a preset's own animation in the app (no Resolve frames, no timeline) at clock time t in ms.
    const drawOwn = (cv, a, t) => drawSynthetic(cv, a, t, '', true);
    window.SAThumbs = { drawOwn, thumb, syncHeader, render, bounds, keyedFrame, isBlank, hasRealFrames, drawAll, wrapToLines, markBusy, isBusy, renderOverlay, ready };
    requestAnimationFrame(loop);
})();


