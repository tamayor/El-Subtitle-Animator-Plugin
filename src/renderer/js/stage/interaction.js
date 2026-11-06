// Stage interaction: hit-testing, dragging / rotating / scaling text, and play-button state.

// Pointer position in canvas pixels (the canvas fills its element box with matching aspect ratio).
function stagePoint(cv, clientX, clientY) {
    const rect = cv.getBoundingClientRect();
    return {
        px: (clientX - rect.left) * (cv.width / Math.max(1, rect.width)),
        py: (clientY - rect.top) * (cv.height / Math.max(1, rect.height))
    };
}

// Helper to determine the directional cursor based on handle angle relative to center
function angleCursor(rad) {
    let deg = ((rad * 180 / Math.PI) % 180 + 180) % 180;
    if (deg >= 22.5 && deg < 67.5) return 'nwse-resize';
    if (deg >= 67.5 && deg < 112.5) return 'ns-resize';
    if (deg >= 112.5 && deg < 157.5) return 'nesw-resize';
    return 'ew-resize';
}

function stageHitTest(cv, clientX, clientY) {
    const { px, py } = stagePoint(cv, clientX, clientY);
    const gz = cv._gizmo;
    if (!gz) return { mode: 'move', px, py };
    const hitR = 14 * (gz.k || 1);

    // 1. Rotation handle (circle atop stem)
    const dRot = Math.hypot(px - gz.rotHandle.x, py - gz.rotHandle.y);
    if (dRot <= hitR) return { mode: 'rotate', px, py };

    // 2. Corner handles (4 corners)
    let bestC = -1, bestCD = hitR;
    gz.rawCorners.forEach((c, i) => {
        const d = Math.hypot(px - c.x, py - c.y);
        if (d < bestCD) { bestCD = d; bestC = i; }
    });
    if (bestC !== -1) return { mode: 'scale', corner: bestC, px, py };

    // 3. Edge midpoint handles (0:Top, 1:Right, 2:Bottom, 3:Left)
    let bestE = -1, bestED = hitR;
    gz.rawEdges.forEach((ePt, i) => {
        const d = Math.hypot(px - ePt.x, py - ePt.y);
        if (d < bestED) { bestED = d; bestE = i; }
    });
    if (bestE !== -1) return { mode: 'scale-edge', edge: bestE, px, py };

    // 4. Center Anchor Point handle
    const dCenter = Math.hypot(px - gz.cx, py - gz.cy);
    if (dCenter <= hitR) return { mode: 'move', isCenter: true, px, py };

    // 5. Inside bounding box (with padding)
    const dx = px - gz.cx, dy = py - gz.cy;
    const cos = Math.cos(gz.rotRad), sin = Math.sin(gz.rotRad);
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const pad = 14 * (gz.k || 1);
    if (Math.abs(lx) <= gz.hw + pad && Math.abs(ly) <= gz.hh + pad) {
        return { mode: 'move', px, py };
    }

    return { mode: 'none', px, py };
}

let liveSyncBusy = false;
let liveSyncPending = null;
async function triggerLiveSync(m, S) {
    const tabKey = S || (state.tab === 'library' ? 'C' : 'U');
    if (!state.liveSyncEnabled || !state.liveSyncEnabled[tabKey]) return;
    // While Preview in Resolve runs, its own clip is the one that is updated; touching the selected / latest Text+ as well
    // would queue a second heavy update in Resolve and could change a subtitle that was already applied.
    if (state.livePrev || state.idle) return;
    if (!m) return;
    const a = libEntry(m.id) || m;
    const subTextVal = $('subText') ? $('subText').value : '';
    const payload = {
        id: m.id,
        posX: m.posX,
        posY: m.posY,
        scale: m.scale,
        rotation: m.rotation,
        sfxVolume: m.sfxVolume,
        textDesign: m.textDesign,
        text: subTextVal,
        boxList: (window.SABoxes && a) ? SABoxes.payload(m, a, subTextVal, tabKey === 'U') : []
    };
    if (liveSyncBusy) {
        liveSyncPending = payload;
        return;
    }
    liveSyncBusy = true;
    try {
        await window.sa.syncLiveTransform(payload);
    } catch (e) { /* ignore */ }
    liveSyncBusy = false;
    if (liveSyncPending) {
        const next = liveSyncPending;
        liveSyncPending = null;
        triggerLiveSync(next, tabKey);
    }
}

function bindStage(ctx) {
    const S = ctx.s;
    const cv = $('stage' + S);
    if (!cv) return;
    cv.addEventListener('pointerenter', () => { state.stageHover = S; redrawStages(); });
    cv.addEventListener('pointerleave', () => {
        if (state.stageHover === S) {
            state.stageHover = null;
            state.stageHoverHit = null;
            cv.style.cursor = 'default';
            redrawStages();
        }
    });
    cv.addEventListener('pointermove', (e) => {
        if (state.stageDrag) return;
        const hit = stageHitTest(cv, e.clientX, e.clientY);
        const gz = cv._gizmo;
        if (!gz || hit.mode === 'none') {
            cv.style.cursor = 'default';
        } else if (hit.mode === 'rotate') {
            cv.style.cursor = 'crosshair';
        } else if (hit.mode === 'scale') {
            const c = gz.rawCorners[hit.corner];
            cv.style.cursor = angleCursor(Math.atan2(c.y - gz.cy, c.x - gz.cx));
        } else if (hit.mode === 'scale-edge') {
            const ed = gz.rawEdges[hit.edge];
            cv.style.cursor = angleCursor(Math.atan2(ed.y - gz.cy, ed.x - gz.cx));
        } else if (hit.mode === 'move') {
            cv.style.cursor = 'grab';
        }

        const prev = state.stageHoverHit;
        const next = hit.mode === 'none' ? null : {
            S,
            mode: hit.mode,
            corner: hit.corner,
            edge: hit.edge,
            isCenter: hit.isCenter
        };
        if (JSON.stringify(prev) !== JSON.stringify(next)) {
            state.stageHoverHit = next;
            redrawStages();
        }
    });
    cv.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const m = ctx.model();
        if (!m) return;
        const hit = stageHitTest(cv, e.clientX, e.clientY);
        if (hit.mode === 'none') return;
        e.preventDefault();
        stopPreview();
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        const gz = cv._gizmo || { cx: cv.width / 2, cy: cv.height / 2, k: 1 };
        let ux = 0, uy = 0, dist0 = 100;
        if (hit.mode === 'scale') {
            const cIdx = hit.corner !== undefined ? hit.corner : 0;
            const rawC = (gz.rawCorners && gz.rawCorners[cIdx]) || { x: gz.cx + 50, y: gz.cy + 50 };
            const vx0 = rawC.x - gz.cx, vy0 = rawC.y - gz.cy;
            dist0 = Math.max(12, Math.hypot(vx0, vy0));
            ux = vx0 / dist0;
            uy = vy0 / dist0;
        } else if (hit.mode === 'scale-edge') {
            const eIdx = hit.edge !== undefined ? hit.edge : 0;
            const rawE = (gz.rawEdges && gz.rawEdges[eIdx]) || { x: gz.cx, y: gz.cy - 50 };
            const vx0 = rawE.x - gz.cx, vy0 = rawE.y - gz.cy;
            dist0 = Math.max(12, Math.hypot(vx0, vy0));
            ux = vx0 / dist0;
            uy = vy0 / dist0;
        }
        let initPosX = Number(m.posX) || 0;
        let initPosY = Number(m.posY) || 0;
        const tlW = (state.liveBg && state.liveBg.width) || 1920;
        const tlH = (state.liveBg && state.liveBg.height) || 1080;
        if (Math.abs(initPosX) <= 1.0 && Math.abs(initPosY) <= 1.0 && (initPosX !== 0 || initPosY !== 0)) {
            initPosX = Math.round(initPosX * tlW * 10) / 10;
            initPosY = Math.round(-initPosY * tlH * 10) / 10;
        }
        state.stageDrag = {
            S, ctx, mode: hit.mode, corner: hit.corner, edge: hit.edge, isCenter: hit.isCenter,
            x0: e.clientX, y0: e.clientY,
            px0: hit.px, py0: hit.py,
            cx: gz.cx, cy: gz.cy,
            ux, uy, dist0,
            startAng: Math.atan2(hit.py - gz.cy, hit.px - gz.cx),
            posX0: initPosX,
            posY0: initPosY,
            scale0: Number(m.scale) || 1,
            rot0: Number(m.rotation) || 0
        };
        if (hit.mode === 'move') cv.style.cursor = 'grabbing';
        redrawStages();
    });
    const resizeBtn = $('stageResizeBtn' + S);
    const sizeResetBtn = $('stageSizeReset' + S);
    const resizeBar = $('stageResize' + S);
    if (resizeBtn) {
        resizeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!state.stageResizeMode) state.stageResizeMode = { U: false, C: false };
            state.stageResizeMode[S] = !state.stageResizeMode[S];
            redrawStages();
        });
    }
    if (sizeResetBtn) {
        sizeResetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (state.stageSize) delete state.stageSize[S];
            if (state.stageHeight) delete state.stageHeight[S];
            if (state.stageResizeMode) state.stageResizeMode[S] = false;
            redrawStages();
        });
    }
    if (resizeBar) {
        resizeBar.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            try { resizeBar.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            const startY = e.clientY;
            const cvRect = cv.getBoundingClientRect();
            const startH = cvRect.height || 240;
            const onMove = (ev) => {
                const dy = ev.clientY - startY;
                const nextH = clamp(Math.round(startH + dy), 120, 1400);
                if (!state.stageHeight) state.stageHeight = {};
                state.stageHeight[S] = nextH;
                redrawStages();
            };
            const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
        resizeBar.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (state.stageHeight) delete state.stageHeight[S];
            if (state.stageSize) delete state.stageSize[S];
            redrawStages();
        });
    }

    const zoomToggleBtn = $('zoomToggle' + S);
    if (zoomToggleBtn) {
        zoomToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (!state.zoomEnabled) state.zoomEnabled = { U: false, C: false };
            state.zoomEnabled[S] = !state.zoomEnabled[S];
            const m = ctx.model();
            syncXformUI(S, m && m.posX, m && m.posY, m && m.scale, m && m.rotation);
            redrawStages();
        });
    }

    const liveSyncToggleBtn = $('liveSyncToggle' + S);
    if (liveSyncToggleBtn) {
        liveSyncToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (!state.liveSyncEnabled) state.liveSyncEnabled = { U: false, C: false };
            state.liveSyncEnabled[S] = !state.liveSyncEnabled[S];
            const m = ctx.model();
            syncXformUI(S, m && m.posX, m && m.posY, m && m.scale, m && m.rotation);
            if (state.liveSyncEnabled[S] && m) triggerLiveSync(m);
        });
    }

    cv.addEventListener('wheel', (e) => {
        if (!state.zoomEnabled || !state.zoomEnabled[S]) {
            // Disabled by default: allow normal page scrolling without intercepting wheel events
            return;
        }
        e.preventDefault();
        stopPreview();
        if (!state.stageZoom) state.stageZoom = { U: 1.0, C: 1.0 };
        const cur = state.stageZoom[S] || 1.0;
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        state.stageZoom[S] = Number(clamp(cur + delta, 0.5, 3.5).toFixed(2));
        const m = ctx.model();
        syncXformUI(S, m && m.posX, m && m.posY, m && m.scale, m && m.rotation);
        redrawStages();
    }, { passive: false });
    cv.addEventListener('dblclick', () => resetStagePos(ctx));
    const resetBtn = $('resetPos' + S);
    if (resetBtn) resetBtn.addEventListener('click', () => resetStagePos(ctx));

    const pxEl = $('posX' + S);
    const numPxEl = $('numPosX' + S);
    const pyEl = $('posY' + S);
    const numPyEl = $('numPosY' + S);
    const scEl = $('scale' + S);
    const numScEl = $('numScale' + S);
    const rotEl = $('rot' + S);
    const numRotEl = $('numRot' + S);

    if (pxEl) {
        pxEl.addEventListener('input', () => {
            const m = ctx.model(); if (!m) return;
            m.posX = Number(pxEl.value);
            if (numPxEl && document.activeElement !== numPxEl) numPxEl.value = m.posX.toFixed(3);
            const a = libEntry(m.id); if (a) a.posX = m.posX;
            ctx.changed(m);
            redrawStages();
            triggerLiveSync(m);
        });
    }
    if (numPxEl) {
        const updatePx = () => {
            const m = ctx.model(); if (!m) return;
            const v = Number(numPxEl.value);
            if (!isNaN(v)) {
                m.posX = v;
                if (pxEl && document.activeElement !== pxEl) pxEl.value = v;
                const a = libEntry(m.id); if (a) a.posX = m.posX;
                ctx.changed(m);
                redrawStages();
                triggerLiveSync(m);
            }
        };
        numPxEl.addEventListener('input', updatePx);
        numPxEl.addEventListener('change', updatePx);
    }

    if (pyEl) {
        pyEl.addEventListener('input', () => {
            const m = ctx.model(); if (!m) return;
            m.posY = Number(pyEl.value);
            if (numPyEl && document.activeElement !== numPyEl) numPyEl.value = m.posY.toFixed(3);
            const a = libEntry(m.id); if (a) a.posY = m.posY;
            ctx.changed(m);
            redrawStages();
            triggerLiveSync(m);
        });
    }
    if (numPyEl) {
        const updatePy = () => {
            const m = ctx.model(); if (!m) return;
            const v = Number(numPyEl.value);
            if (!isNaN(v)) {
                m.posY = v;
                if (pyEl && document.activeElement !== pyEl) pyEl.value = v;
                const a = libEntry(m.id); if (a) a.posY = m.posY;
                ctx.changed(m);
                redrawStages();
                triggerLiveSync(m);
            }
        };
        numPyEl.addEventListener('input', updatePy);
        numPyEl.addEventListener('change', updatePy);
    }

    if (scEl) {
        scEl.addEventListener('input', () => {
            const m = ctx.model(); if (!m) return;
            m.scale = Number(scEl.value);
            if (numScEl && document.activeElement !== numScEl) numScEl.value = m.scale.toFixed(3);
            const a = libEntry(m.id); if (a) a.scale = m.scale;
            ctx.changed(m);
            redrawStages();
            triggerLiveSync(m);
        });
    }
    if (numScEl) {
        const updateSc = () => {
            const m = ctx.model(); if (!m) return;
            const v = Number(numScEl.value);
            if (!isNaN(v) && v > 0) {
                m.scale = v;
                if (scEl && document.activeElement !== scEl) scEl.value = v;
                const a = libEntry(m.id); if (a) a.scale = m.scale;
                ctx.changed(m);
                redrawStages();
                triggerLiveSync(m);
            }
        };
        numScEl.addEventListener('input', updateSc);
        numScEl.addEventListener('change', updateSc);
    }

    if (rotEl) {
        rotEl.addEventListener('input', () => {
            const m = ctx.model(); if (!m) return;
            m.rotation = Number(rotEl.value);
            if (numRotEl && document.activeElement !== numRotEl) numRotEl.value = m.rotation.toFixed(3);
            const a = libEntry(m.id); if (a) a.rotation = m.rotation;
            ctx.changed(m);
            redrawStages();
            triggerLiveSync(m);
        });
    }
    if (numRotEl) {
        const updateRot = () => {
            const m = ctx.model(); if (!m) return;
            const v = Number(numRotEl.value);
            if (!isNaN(v)) {
                m.rotation = v;
                if (rotEl && document.activeElement !== rotEl) rotEl.value = v;
                const a = libEntry(m.id); if (a) a.rotation = m.rotation;
                ctx.changed(m);
                redrawStages();
                triggerLiveSync(m);
            }
        };
        numRotEl.addEventListener('input', updateRot);
        numRotEl.addEventListener('change', updateRot);
    }
}

function resetStagePos(ctx) {
    const m = ctx.model();
    if (!m) return;
    m.posX = 0; m.posY = 0; m.scale = 1; m.rotation = 0;
    if (state.stageZoom) state.stageZoom[ctx.s] = 1.0;
    if (state.zoomEnabled) state.zoomEnabled[ctx.s] = false;
    const a = libEntry(m.id);
    if (a) { a.posX = 0; a.posY = 0; a.scale = 1; a.rotation = 0; }
    ctx.changed(m);
    syncXformUI(ctx.s, 0, 0, 1, 0);
    redrawStages();
    triggerLiveSync(m);
}

function onStageDragMove(e) {
    const d = state.stageDrag;
    if (!d) return;
    const m = d.ctx.model();
    const cv = $('stage' + d.S);
    if (!m || !cv) return;
    const rect = cv.getBoundingClientRect();
    const zoom = cv._zoom || 1.0;
    const { px, py } = stagePoint(cv, e.clientX, e.clientY);

    if (d.mode === 'rotate') {
        const curAng = Math.atan2(py - d.cy, px - d.cx);
        let deg = d.rot0 + ((curAng - d.startAng) * 180) / Math.PI;
        while (deg > 180) deg -= 360;
        while (deg < -180) deg += 360;
        if (!e.shiftKey) {
            for (const snap of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
                if (Math.abs(deg - snap) <= 3.0) { deg = snap; break; }
            }
        }
        m.rotation = Number(deg.toFixed(3));
    } else if (d.mode === 'scale' || d.mode === 'scale-edge') {
        const curDist = (px - d.cx) * d.ux + (py - d.cy) * d.uy;
        const ratio = Math.max(0.05, curDist / Math.max(8, d.dist0));
        const sc = clamp(d.scale0 * ratio, 0.05, 5.0);
        m.scale = Number(sc.toFixed(3));
    } else if (d.mode === 'move') {
        const tlW = (state.liveBg && state.liveBg.width) || 1920;
        const tlH = (state.liveBg && state.liveBg.height) || 1080;
        const vp = cv._viewport || { vx: 0, vy: 0, vw: cv.width, vh: cv.height };
        const cssVw = Math.max(40, rect.width * (vp.vw / cv.width)) * zoom;
        const cssVh = Math.max(40, rect.height * (vp.vh / cv.height)) * zoom;
        let nx = d.posX0 + ((e.clientX - d.x0) / cssVw) * tlW;
        let ny = d.posY0 - ((e.clientY - d.y0) / cssVh) * tlH; // negative Tilt is down on screen in Resolve
        if (!e.shiftKey) {
            if (Math.abs(nx) < 4) nx = 0;
            if (Math.abs(ny) < 4) ny = 0;
        }
        m.posX = Number(nx.toFixed(1));
        m.posY = Number(ny.toFixed(1));
    }
    const a = libEntry(m.id);
    if (a) {
        a.posX = m.posX;
        a.posY = m.posY;
        a.scale = m.scale;
        a.rotation = m.rotation;
    }
    syncXformUI(d.S, m.posX, m.posY, m.scale, m.rotation);
    drawStage(d.S, a || m, null);
    triggerLiveSync(m);
}

function onStageDragEnd() {
    const d = state.stageDrag;
    state.stageDrag = null;
    if (d) {
        const cv = $('stage' + d.S);
        if (cv) cv.style.cursor = 'default';
        const m = d.ctx.model();
        if (m) d.ctx.changed(m);
        redrawStages();
    }
}

// Alignment header: play once (click again to pause / resume), loop with the sound until clicked again, and scrub.
function syncPlayUI() {
    for (const S of ['U', 'C']) {
        const pb = $('alnPlay' + S), mb = $('alnMode' + S), sb = $('alnScrub' + S);
        const pv = state.preview && state.preview.ctx && state.preview.ctx.s === S ? state.preview : null;
        const playing = !!pv && !pv.paused;
        if (pb) {
            pb.innerHTML = playing ? ICONS.pause : ICONS.play;
            pb.classList.toggle('on', !!pv && !pv.loop);
            pb.title = playing ? 'Pause' : (pv && !pv.loop ? 'Resume' : 'Play once with its sound');
        }
        if (mb) {
            mb.innerHTML = ICONS.loop;
            mb.classList.toggle('on', !!pv && pv.loop);
            mb.title = pv && pv.loop ? 'Stop looping' : 'Loop the animation with its sound';
        }
        if (sb) {
            const on = state.scrub[S].on;
            sb.innerHTML = ICONS.scrub;
            sb.classList.toggle('on', on);
            sb.title = on ? 'Scrubbing is on: drag the pink playhead or press the arrow keys. Click to turn off' : 'Scrub the preview frame by frame to line the sound up with the text';
        }
    }
}
