// Filling the Text Design panel from a model (gradient stops, editTD, fillTextDesign).

function syncGradientStopUI(S, curEl, stopIdx) {
    if (!curEl) return;
    const s0 = $('shStop0' + S), s1 = $('shStop1' + S);
    if (s0) s0.classList.toggle('sel', stopIdx === 0);
    if (s1) s1.classList.toggle('sel', stopIdx === 1);

    const offsetEl = $('shStopOffset' + S);
    if (offsetEl) offsetEl.value = stopIdx === 0 ? '0.0' : '1.0';

    const lbl = $('shStopLbl' + S);
    if (lbl) lbl.textContent = stopIdx === 0 ? 'Start Color' : 'End Color';

    const col = stopIdx === 0 ? (curEl.color || '#ffffff') : (curEl.color2 || '#f07b8e');
    const rgb = hexToRgb01(col);
    const op = clamp(Number(curEl.opacity ?? 1), 0, 1);

    const setVal = (slId, numId, val, dec) => {
        const sl = $(slId + S), nm = $(numId + S);
        if (sl && document.activeElement !== sl) sl.value = val;
        if (nm && document.activeElement !== nm) nm.value = Number(val).toFixed(dec);
    };

    setVal('shGradR', 'shGradRN', rgb.r, 2);
    setVal('shGradG', 'shGradGN', rgb.g, 2);
    setVal('shGradB', 'shGradBN', rgb.b, 2);
    setVal('shGradA', 'shGradAN', op, 2);

    if ($('shGradSwatchFill' + S)) $('shGradSwatchFill' + S).style.backgroundColor = col;
    if ($('shGradColorInput' + S)) $('shGradColorInput' + S).value = col;
    const hexEl = $('shGradHex' + S);
    if (hexEl && document.activeElement !== hexEl) hexEl.value = col;
}

// The design the Text Design panel edits: the preset's own (first Text+), or the Text+ picked at the top of the
// panel / in the text boxes (each detected Text+ has its own, numbered and named after it).
function editTD(m, S) {
    if (!m) return null;
    if (!m.textDesign) m.textDesign = cloneTextDesign(libEntry(m.id) && libEntry(m.id).textDesign);
    const own = (window.SABoxes && SABoxes.designFor) ? SABoxes.designFor(S, m) : null;
    return own || m.textDesign;
}

function fillTextDesign(ctx) {
    const S = ctx.s;
    if (!$('tdFont' + S)) return;
    const m = ctx.model();
    if (!m) return;
    if (!m.textDesign) {
        const a = libEntry(m.id);
        m.textDesign = cloneTextDesign(a && a.textDesign);
    }
    syncVarButtons(S, m);
    if (window.SABoxes && SABoxes.renderTarget) SABoxes.renderTarget(S);
    const td = editTD(m, S);
    const fEl = $('tdFont' + S);
    if (fEl && document.activeElement !== fEl) fEl.value = td.font || 'Poppins';
    { const ns = fillStyleSelect(S, td.font || 'Poppins', td.style); if (typeof ns === 'string') td.style = ns; }
    const el1 = td.elements[0];
    const c1El = $('tdColor' + S);
    if (c1El && el1) c1El.value = el1.color || '#ffffff';

    const sz = Number(td.size) || 0.12;
    const szEl = $('tdSize' + S);
    if (szEl && document.activeElement !== szEl) szEl.value = sz;
    if ($('vTdSize' + S)) $('vTdSize' + S).textContent = sz.toFixed(3);

    const trk = Number(td.tracking ?? 1);
    const trkEl = $('tdTrack' + S);
    if (trkEl && document.activeElement !== trkEl) trkEl.value = trk;
    if ($('vTdTrack' + S)) $('vTdTrack' + S).textContent = trk.toFixed(2);

    const lsp = Number(td.lineSpacing ?? 1);
    const lspEl = $('tdLine' + S);
    if (lspEl && document.activeElement !== lspEl) lspEl.value = lsp;
    if ($('vTdLine' + S)) $('vTdLine' + S).textContent = lsp.toFixed(2);

    {
        const setR = (id, v, valId) => { const e = $(id + S); if (e && document.activeElement !== e) e.value = v; if (valId && $(valId + S)) $(valId + S).textContent = Number(v).toFixed(2); };
        setR('tdVAnc', td.vAnchor ?? 0); setR('tdVJust', td.vJustify ?? 0, 'vTdVJust');
        setR('tdHAnc', td.hAnchor ?? 0); setR('tdHJust', td.hJustify ?? 0, 'vTdHJust');
        if ($('tdDir' + S)) $('tdDir' + S).value = String(Math.round(td.direction ?? 0));
        if ($('tdLDir' + S)) $('tdLDir' + S).value = String(Math.round(td.lineDirection ?? 0));
        if ($('tdStrike' + S)) $('tdStrike' + S).classList.toggle('on', !!td.strikeout);
        if ($('tdUnder' + S)) $('tdUnder' + S).classList.toggle('on', !!td.underline);
        for (const b of document.querySelectorAll('#tdVAncBtns' + S + ' .td-ibtn, #tdHAncBtns' + S + ' .td-ibtn')) {
            const cur = b.dataset.anchor === 'v' ? Number(td.vAnchor ?? 0) : Number(td.hAnchor ?? 0);
            b.classList.toggle('on', Math.abs(cur - Number(b.dataset.val)) < 0.005);
        }
    }

    fillLayout(S, td);
    applyTdTab(S);

    const selIdx = clamp(Number(td.selectedElement) || 1, 1, 8);
    td.selectedElement = selIdx;
    const curEl = td.elements[selIdx - 1];

    const tabsBox = $('shSel' + S);
    if (tabsBox) {
        for (const btn of tabsBox.querySelectorAll('.sh-tab')) {
            const idx = Number(btn.dataset.idx);
            const eObj = td.elements[idx - 1];
            btn.classList.toggle('on', idx === selIdx);
            btn.classList.toggle('enabled', !!(eObj && eObj.enabled));
        }
    }

    if (!curEl) return;
    const nmEl = $('shName' + S);
    if (nmEl && document.activeElement !== nmEl) nmEl.value = curEl.name || ('Element ' + selIdx);
    const enEl = $('shEnabled' + S);
    if (enEl) enEl.checked = !!curEl.enabled;

    const propsBox = $('shProps' + S);
    if (propsBox) propsBox.classList.toggle('disabled-props', !curEl.enabled);

    const shapeBox = $('shShape' + S);
    const shVal = Number(curEl.shape) || 0;
    if (shapeBox) {
        for (const b of shapeBox.querySelectorAll('.sh-shape')) {
            b.classList.toggle('on', Number(b.dataset.shape) === shVal);
        }
    }

    const typeBox = $('shType' + S);
    const typeVal = Number(curEl.type) === 2 ? 2 : 0;
    curEl.type = typeVal;
    if (typeBox) {
        for (const b of typeBox.querySelectorAll('.rv-seg-btn, .sh-type')) {
            b.classList.toggle('on', Number(b.dataset.type) === typeVal);
        }
    }
    const isGradient = typeVal === 2;
    if ($('shSolidWrap' + S)) $('shSolidWrap' + S).classList.toggle('hidden', isGradient);
    if ($('shGradWrap' + S)) $('shGradWrap' + S).classList.toggle('hidden', !isGradient);

    const c1 = curEl.color || '#ffffff';
    const c2 = curEl.color2 || '#f07b8e';
    const op = clamp(Number(curEl.opacity ?? 1), 0, 1);

    // Sync Solid inputs
    const rgb1 = hexToRgb01(c1);
    const setVal = (slId, numId, val, dec) => {
        const sl = $(slId + S), nm = $(numId + S);
        if (sl && document.activeElement !== sl) sl.value = val;
        if (nm && document.activeElement !== nm) nm.value = Number(val).toFixed(dec);
    };

    setVal('shR', 'shRN', rgb1.r, 2);
    setVal('shG', 'shGN', rgb1.g, 2);
    setVal('shB', 'shBN', rgb1.b, 2);
    setVal('shOpacity', 'vShOpacity', op, 2);

    if ($('shColor' + S)) $('shColor' + S).value = c1;
    if ($('shSwatchFill' + S)) $('shSwatchFill' + S).style.backgroundColor = c1;
    const hexEl = $('shHex' + S);
    if (hexEl && document.activeElement !== hexEl) hexEl.value = c1;

    // Sync Gradient inputs
    if ($('shColor2' + S)) $('shColor2' + S).value = c2;
    if ($('shGradBar' + S)) $('shGradBar' + S).style.background = `linear-gradient(to right, ${c1}, ${c2})`;

    const activeStop = typeBox ? (typeBox._activeStop ?? 0) : 0;
    syncGradientStopUI(S, curEl, activeStop);

    // Sync mapping inputs
    const mAngle = Number(curEl.mappingAngle ?? 0);
    const mSize = Number(curEl.mappingSize ?? 1);
    const mAspect = Number(curEl.mappingAspect ?? 1);
    const mLevel = Number(curEl.mappingLevel ?? 3);

    setVal('shMapAngle', 'shMapAngleN', mAngle, 1);
    setVal('shMapSize', 'shMapSizeN', mSize, 2);
    setVal('shMapAspect', 'shMapAspectN', mAspect, 2);
    const mlEl = $('shMapLevel' + S);
    if (mlEl) mlEl.value = String(mLevel);

    const th = Number(curEl.thickness ?? 0.02);
    const thEl = $('shThickness' + S);
    if (thEl && document.activeElement !== thEl) thEl.value = th;
    if ($('vShThickness' + S)) $('vShThickness' + S).textContent = th.toFixed(3);
    if ($('shThickWrap' + S)) $('shThickWrap' + S).classList.toggle('hidden', !(shVal === 1 || shVal === 3));

    const isBorder = (shVal === 2 || shVal === 3);
    if ($('shBorderWrap' + S)) $('shBorderWrap' + S).classList.toggle('hidden', !isBorder);

    const lvEl = $('shLevel' + S);
    if (lvEl) lvEl.value = String(curEl.level ?? 0);

    const eh = Number(curEl.extendH ?? 0);
    const ehEl = $('shExtendH' + S);
    if (ehEl && document.activeElement !== ehEl) ehEl.value = eh;
    if ($('vShExtendH' + S)) $('vShExtendH' + S).textContent = eh.toFixed(3);

    const ev = Number(curEl.extendV ?? 0);
    const evEl = $('shExtendV' + S);
    if (evEl && document.activeElement !== evEl) evEl.value = ev;
    if ($('vShExtendV' + S)) $('vShExtendV' + S).textContent = ev.toFixed(3);

    const rd = Number(curEl.round ?? 0);
    const rdEl = $('shRound' + S);
    if (rdEl && document.activeElement !== rdEl) rdEl.value = rd;
    if ($('vShRound' + S)) $('vShRound' + S).textContent = rd.toFixed(3);

    const sfEl = $('shSoftness' + S);
    if (sfEl && document.activeElement !== sfEl) sfEl.value = Number(curEl.softness ?? 0);
    const oxEl = $('shOffsetX' + S);
    if (oxEl && document.activeElement !== oxEl) oxEl.value = Number(curEl.offsetX ?? 0);
    const oyEl = $('shOffsetY' + S);
    if (oyEl && document.activeElement !== oyEl) oyEl.value = Number(curEl.offsetY ?? 0);
    renderTdSummary(ctx);
}
