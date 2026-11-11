// Text boxes: detects the Text+ / template nodes of a preset, lets you give each its own text and place it
// individually over the real timeline frame, and edits a preset's attached Fusion file and sound.
// Runs after the panel scripts (src/renderer/js/**) and uses their globals (state, CTX, libEntry, selected, takeLib, dropZone, play, ...).
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

    function mk(tag, cls, text) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text !== undefined) el.textContent = text;
        return el;
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
    const mt = { cfg: mtDefault(), over: null, active: 'emphasis', lastSub: null, lastKey: '', clip: null };
    try { const raw = localStorage.getItem(MT_KEY); if (raw) mt.cfg = Object.assign(mtDefault(), JSON.parse(raw)); } catch (e) { /* ignore */ }
    if (!mt.cfg.caps || typeof mt.cfg.caps !== 'object') mt.cfg.caps = { upper: false, emphasis: !!mt.cfg.upper, lower: false };
    function mtSave() { try { localStorage.setItem(MT_KEY, JSON.stringify(mt.cfg)); } catch (e) { /* ignore */ } }

    const realMtNodes = (a) => nodesOf(a).filter(n => n.kind === 'multitext');
    // Justified Pop (tools/gen-justified-pop.py) is one Text+ whose expressions split "upper *emphasis* lower" into rows.
    // It gets the same Upper / Emphasize / Lower splitter: three stand-in layers here, one starred text sent to its Text+.
    const isRowTpl = (a) => !!a && (a.id === 'jp7justpop01' || /^Justified Pop\b/i.test(String(a.name || '')))
        && nodesOf(a).some(n => n.kind === 'textplus' && !n.nested);
    const ROW_TPL_NODES = [
        { layer: 1, layerName: 'Upper', cx: 0.5, cy: 0.6, size: 0.05 },
        { layer: 2, layerName: 'Emphasis', cx: 0.5, cy: 0.5, size: 0.08 },
        { layer: 3, layerName: 'Lower', cx: 0.5, cy: 0.4, size: 0.05 }];
    const mtNodes = (a) => isRowTpl(a) ? ROW_TPL_NODES : realMtNodes(a);
    const isMT = (a) => !!a && (a.isMultiText === true || mtNodes(a).length > 0);      // isMultiText is flagged by the backend with the preset list
    function rowTplText(a, sub) {
        const p = mtParts(sub).parts;
        const e = p.emphasis.trim();
        if (!e) return [p.upper, p.lower].filter(Boolean).join(' ');
        return [p.upper.trim(), '*' + e + '*', p.lower.trim()].filter(Boolean).join(' ');
    }

    // Clip mode: the clip in Clip controls (selected, else under the playhead) is a MultiText preset. The splitter then
    // shows THAT clip's words (read from its rows) and writes the new split back to its rows; otherwise it splits the
    // subtitle for the preset selected in the library, as before. A running Resolve preview keeps the preset mode
    // (its clip follows the panel by itself).
    const mtA = () => mt.clip ? mt.clip.a : modelFor('U').a;
    const mtSub = () => mt.clip ? (mt.clip.text || '') : subtitleText();
    let mtClipTimer = 0;
    function mtPushClip() {
        const c = mt.clip;
        if (!c || c.text === null || c.error) return;
        clearTimeout(mtClipTimer);
        mtClipTimer = setTimeout(async () => {
            if (mt.clip !== c) return;
            const roles = mtRoles(c.a);
            const parts = mtFold(roles, mtParts(c.text).parts);
            const texts = {};
            for (const [k] of MT_ROLES) if (roles[k] !== null) texts[roles[k]] = parts[k];
            try {
                const r = await window.sa.setClipRows(c.itemId, texts, c.frames);
                if (r && r.error && typeof setStatus === 'function') setStatus('Could not set the text: ' + r.error, 'bad');
                else if (r && r.busy) mtPushClip();
            } catch (e) { if (typeof setStatus === 'function') setStatus('Could not set the text: ' + e.message, 'bad'); }
        }, 250);
    }
    async function mtLoadClip(c) {
        let r = null, err = '';
        try { r = await window.sa.clipRows(c.itemId); } catch (e) { r = null; err = e.message; }
        if (mt.clip !== c) return;
        // busy (a placement is running): try again shortly. Any other failure stays shown until another clip is picked,
        // so the card never blinks (a blinking splitter moved the controls under the pointer and swallowed clicks).
        if (r && r.busy) { setTimeout(() => { if (mt.clip === c) mtLoadClip(c); }, 1000); return; }
        if (!r || !Array.isArray(r.rows)) {
            c.text = ''; c.error = (r && r.error) || err || 'no answer';
            try { window.sa.dlog('[mt-clip] read failed: ' + c.error); } catch (e) { /* ignore */ }
            mt.lastSub = null; renderMT('U');
            return;
        }
        const roles = mtRoles(c.a);
        const byRow = {};
        for (const x of r.rows) byRow[x.n] = String(x.text || '');
        const part = (k) => roles[k] !== null ? mtWords(byRow[roles[k]]) : [];
        const u = part('upper'), e = part('emphasis'), l = part('lower');
        c.text = u.concat(e, l).join(' ');
        const N = u.length + e.length + l.length;
        mt.over = null;
        if (N && e.length) mtSetRange(N, u.length, u.length + e.length);
        // ALL CAPS follows the clip: a part written all in capitals keeps its AA on
        for (const [k, w] of [['upper', u], ['emphasis', e], ['lower', l]]) {
            const t = w.join(' ');
            if (/\p{L}/u.test(t)) mt.cfg.caps[k] = t === t.toUpperCase();
        }
        mt.lastSub = null; mt.lastKey = '';
        renderMT('U');
    }
    // Called by Clip controls (js/timeline/clip-controls.js) with each read of the clip.
    function mtSetClip(info) {
        let a = null;
        const live = typeof state !== 'undefined' && state.livePrev;
        if (!live && info && !info.none && info.itemId && info.presetId && typeof libEntry === 'function') a = libEntry(info.presetId);
        if (!a || !isMT(a) || isRowTpl(a)) {      // clip mode reads MultiText rows; Justified Pop has none
            if (mt.clip) { mt.clip = null; mt.over = null; mt.lastKey = ''; mt.lastSub = null; renderMT('U'); }
            return;
        }
        if (mt.clip && mt.clip.itemId === String(info.itemId) && mt.clip.a.id === a.id) {
            if (info.frames > 0) mt.clip.frames = info.frames;
            return;
        }
        const c = { itemId: String(info.itemId), presetId: info.presetId, frames: info.frames || null, a, text: null };
        mt.clip = c; mt.over = null; mt.lastKey = ''; mt.lastSub = null;
        renderMT('U');
        mtLoadClip(c);
    }

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
        return mtFold(r, mtParts(sub).parts)[role];
    }
    // A role with no layer: fold its text into a neighbouring layer instead of losing it.
    function mtFold(r, parts) {
        const t = Object.assign({}, parts);
        const join = (x, y) => [x, y].filter(Boolean).join(' ');
        if (r.upper === null && t.upper) { if (r.lower !== null) t.lower = join(t.upper, t.lower); else if (r.emphasis !== null) t.emphasis = join(t.upper, t.emphasis); t.upper = ''; }
        if (r.lower === null && t.lower) { if (r.upper !== null) t.upper = join(t.upper, t.lower); else if (r.emphasis !== null) t.emphasis = join(t.emphasis, t.lower); t.lower = ''; }
        return t;
    }
    // Upper / lower parts only show in the panel when the preset has a layer for them.
    const mtShown = (r, role) => role === 'emphasis' || r[role] !== null;
    const textFor = (a, n, b, sub) => n.kind === 'multitext' ? mtText(a, n, sub)
        : (isRowTpl(a) && n.kind === 'textplus' && !n.nested && n.id === primaryId(a)) ? rowTplText(a, sub) : resolveText(b, sub);

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
    function mtChanged() {
        mtSave(); mt.lastSub = null;
        const h = q('mtHostU'); const a = mtA();
        if (h && a) mtRefresh(h, a);
        if (mt.clip) { mtPushClip(); return; }
        changed('U'); mtPreviewSoon();
    }

    function renderMT(S) {
        if (S !== 'U') return;
        const host = mtHost();
        if (!host) return;
        const a = mtA();
        const sync = () => { try { if (typeof ccSyncCard === 'function') ccSyncCard(); } catch (e) { /* ignore */ } };
        if (!a || !isMT(a)) { host.classList.add('hidden'); host.textContent = ''; mt.lastKey = ''; sync(); return; }
        host.classList.remove('hidden');
        sync();
        const key = [a.id, mt.clip ? mt.clip.itemId : '', mtNodes(a).map(n => n.layer).join(','), mt.active].join('|');
        if (key !== mt.lastKey) { mt.lastKey = key; mt.lastSub = null; mtBuild(host, a); }
        mtRefresh(host, a);
    }

    function mtBuild(host, a) {
        host.textContent = '';
        const roles = mtRoles(a);
        // the three inputs, colour coded
        if (!mtShown(roles, mt.active)) mt.active = 'emphasis';
        const ins = mk('div', 'mt-ins');
        for (const [role, label, col] of MT_ROLES) {
            if (!mtShown(roles, role)) continue;
            const ta = document.createElement('textarea');
            ta.rows = 1; ta.className = 'mt-in'; ta.dataset.role = role;
            ta.style.setProperty('--mt', col);
            ta.placeholder = label;
            const n = mtNodes(a).find(x => x.layer === roles[role]);
            ta.title = label + (n ? ' · ' + n.layerName : ' · no layer');
            ta.addEventListener('input', () => {
                if (mt.cfg.caps[role]) { const p = ta.selectionStart; ta.value = ta.value.toUpperCase(); try { ta.setSelectionRange(p, p); } catch (e) { /* ignore */ } }
                const sub = mtSub();
                if (!mt.over || mt.over.sub !== sub) mt.over = { sub };
                mt.over[role] = ta.value;
                // the hidden part's words are folded into this input: typing here replaces them too
                for (const [k] of MT_ROLES) if (!mtShown(roles, k)) mt.over[k] = '';
                mtSave();
                if (mt.clip) mtPushClip(); else { changed('U'); mtPreviewSoon(); }
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
        for (const [role, , col] of MT_ROLES) {
            if (!mtShown(roles, role)) continue;
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
        const sub = mtSub();
        const sig = sub + '\u0001' + JSON.stringify(mt.over) + '\u0001' + JSON.stringify(mt.cfg);
        if (sig === mt.lastSub) return;
        mt.lastSub = sig;
        if (mt.over && mt.over.sub !== sub) mt.over = null;
        if (!mt.clip) mtPreviewSoon();    // the subtitle (or the split) changed: refresh the preview
        // the Alignment timeline greys out the sound lanes of rows left without text (they get no sound)
        setTimeout(() => { try { if (typeof CTX !== 'undefined' && CTX.U) renderTimeline(CTX.U); } catch (e) { /* ignore */ } }, 0);
        const roles = mtRoles(a);
        const { split } = mtParts(sub);
        const parts = mtFold(roles, mtParts(sub).parts);
        // words of a hidden part are coloured as the part they fold into
        const fold = { upper: roles.upper !== null ? 'upper' : (roles.lower !== null ? 'lower' : 'emphasis'),
            lower: roles.lower !== null ? 'lower' : (roles.upper !== null ? 'upper' : 'emphasis'), emphasis: 'emphasis' };
        split.roles = split.roles.map(x => fold[x] || x);
        const chips = host.querySelector('#mtChips');
        if (chips) {
            chips.textContent = '';
            if (!split.words.length) chips.appendChild(mk('span', 'mt-empty', mt.clip ? (mt.clip.text === null ? 'Reading the clip…' : (mt.clip.error ? 'Could not read this clip’s text. Close and reopen the plugin window.' : 'This clip has no text')) : 'Select a subtitle to split it'));
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
    setInterval(() => { try { const h = q('mtHostU'); if (h && !h.classList.contains('hidden')) mtRefresh(h, mtA()); } catch (e) { /* ignore */ } }, 300);

    window.SABoxes = { renderMT, setClip: mtSetClip, active, payload, cloneBoxes, draw, paint, hideLayer, render, liveSummary, nodesOf, primaryCenter, setPrimaryCenter,
        designFor, renderTarget, targetLabel, setTarget, renderKey, hasOverrides,
        mtRoles: (a) => autoRoles(realMtNodes(a)),      // which MultiText layer is upper / emphasis / lower (Use tab Text Style)
        // Use tab: the MultiText layers (= row numbers) that will get no text for the current subtitle
        mtEmptyRows: (a) => (isMT(a) && !isRowTpl(a)) ? mtNodes(a).filter(n => mtText(a, n, subtitleText()) === '').map(n => Number(n.layer)) : [] };
})();
