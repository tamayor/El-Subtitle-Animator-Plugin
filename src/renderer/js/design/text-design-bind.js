// Binding the Text Design panel controls (bindTextDesign).

function bindTextDesign(ctx) {
    const S = ctx.s;
    if (!$('tdFont' + S)) return;
    const commit = () => {
        const m = ctx.model();
        if (!m) return;
        if (S === 'U') m.designRev = (m.designRev || 0) + 1;
        else designRev.set(m.id, (designRev.get(m.id) || 0) + 1);
        m.designDirty = true;
        m.adjusted = true;
        m.dirty = true;
        if (S === 'U' && state.use) {
            state.use.dirty = true;
            state.use.adjusted = true;
            state.use.designDirty = true;
        }
        if (S === 'C') state.createAdjusted = true;

        // Create tab edits the preset's default design; the Use tab is a one-time override and saves nothing.
        const a = S === 'C' ? libEntry(m.id) : null;
        if (a) {
            a.textDesign = cloneTextDesign(m.textDesign);
            a.designDirty = true;
            a.adjusted = true;
        }

        fillTextDesign(ctx);
        renderUseSummary();
        if (S === 'C') renderCreateSummary();
        redrawStages();

        if (window.SAThumbs && typeof SAThumbs.drawAll === 'function') {
            SAThumbs.drawAll(performance.now());
        }

        // While the colour picker is open only the panel follows; the final colour saves and goes to Resolve on close.
        if (state.colorPicking) return;

        if (S === 'C') saveField(m.id, { textDesign: m.textDesign, boxes: m.boxes || {} });

        if (typeof triggerLiveSync === 'function') {
            triggerLiveSync(m, S);
        }
    };
    const curEl = () => {
        const m = ctx.model();
        if (!m) return null;
        const td = editTD(m, S);
        const idx = clamp(Number(td.selectedElement) || 1, 1, 8);
        return td.elements[idx - 1];
    };

    bindFontPicker($('tdFont' + S));
    const applyFont = (typedOnly) => {
        const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
        let v = $('tdFont' + S).value.trim();
        const known = state.fonts.find(f => f.toLowerCase() === v.toLowerCase());
        if (typedOnly && !known) return;                     // half-typed names wait for Enter / a pick
        if (known) v = known;
        td.font = v || 'Poppins';
        { const ns = fillStyleSelect(S, td.font, td.style); if (typeof ns === 'string') td.style = ns; }     // never a style the new font does not have
        commit();
    };
    $('tdFont' + S).addEventListener('input', (e) => applyFont(!!(e && e.inputType)));
    $('tdFont' + S).addEventListener('change', () => applyFont(false));
    $('tdStyle' + S).addEventListener('change', () => {
        const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
        td.style = $('tdStyle' + S).value;
        commit();
    });
    $('tdColor' + S).addEventListener('input', () => {
        const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
        const c = $('tdColor' + S).value;
        td.elements[0].color = c;
        td.elements[0].modified = true;
        commit();
    });
    $('tdSize' + S).addEventListener('input', () => {
        const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
        td.size = Number($('tdSize' + S).value);
        if ($('vTdSize' + S)) $('vTdSize' + S).textContent = td.size.toFixed(3);
        commit();
    });
    $('tdTrack' + S).addEventListener('input', () => {
        const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
        td.tracking = Number($('tdTrack' + S).value);
        if ($('vTdTrack' + S)) $('vTdTrack' + S).textContent = td.tracking.toFixed(2);
        commit();
    });
    $('tdLine' + S).addEventListener('input', () => {
        const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
        td.lineSpacing = Number($('tdLine' + S).value);
        if ($('vTdLine' + S)) $('vTdLine' + S).textContent = td.lineSpacing.toFixed(2);
        commit();
    });

    {
        const slider = (id, key, valId) => $(id + S).addEventListener('input', () => {
            const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
            td[key] = Number($(id + S).value);
            if (valId && $(valId + S)) $(valId + S).textContent = td[key].toFixed(2);
            commit();
            if (!valId) for (const b of document.querySelectorAll('#td' + (key === 'vAnchor' ? 'V' : 'H') + 'AncBtns' + S + ' .td-ibtn')) b.classList.toggle('on', Math.abs(td[key] - Number(b.dataset.val)) < 0.005);
        });
        slider('tdVAnc', 'vAnchor'); slider('tdHAnc', 'hAnchor');
        slider('tdVJust', 'vJustify', 'vTdVJust'); slider('tdHJust', 'hJustify', 'vTdHJust');
        for (const b of document.querySelectorAll('#tdVAncBtns' + S + ' .td-ibtn, #tdHAncBtns' + S + ' .td-ibtn')) {
            b.addEventListener('click', () => {
                const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
                td[b.dataset.anchor === 'v' ? 'vAnchor' : 'hAnchor'] = Number(b.dataset.val);
                commit();
                fillTextDesign(ctx);
            });
        }
        $('tdDir' + S).addEventListener('change', () => {
            const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
            td.direction = Number($('tdDir' + S).value); commit();
        });
        $('tdLDir' + S).addEventListener('change', () => {
            const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
            td.lineDirection = Number($('tdLDir' + S).value); commit();
        });
        for (const [id, key] of [['tdStrike', 'strikeout'], ['tdUnder', 'underline']]) {
            $(id + S).addEventListener('click', () => {
                const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
                td[key] = td[key] ? 0 : 1;
                $(id + S).classList.toggle('on', !!td[key]);
                commit();
            });
        }
    }

    bindLayout(ctx, commit);

    for (const btn of $('shSel' + S).querySelectorAll('.sh-tab')) {
        btn.addEventListener('click', () => {
            const m = ctx.model(); const td = editTD(m, S); if (!m || !td) return;
            td.selectedElement = Number(btn.dataset.idx) || 1;
            fillTextDesign(ctx);
        });
    }

    $('shName' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.name = $('shName' + S).value;
        el.modified = true;
        commit();
    });
    $('shEnabled' + S).addEventListener('change', () => {
        const el = curEl(); if (!el) return;
        el.enabled = $('shEnabled' + S).checked;
        el.modified = true;
        commit();
    });

    for (const b of $('shShape' + S).querySelectorAll('.sh-shape')) {
        b.addEventListener('click', () => {
            const el = curEl(); if (!el) return;
            el.shape = Number(b.dataset.shape) || 0;
            el.enabled = true;
            el.modified = true;
            commit();
        });
    }

    const typeBox = $('shType' + S);
    if (typeBox) {
        for (const b of typeBox.querySelectorAll('.rv-seg-btn, .sh-type')) {
            b.addEventListener('click', () => {
                const el = curEl(); if (!el) return;
                el.type = Number(b.dataset.type) === 2 ? 2 : 0;
                el.enabled = true;
                el.modified = true;
                fillTextDesign(ctx);
                commit();
            });
        }
    }

    // --- Solid Color & Opacity RGBA controls
    const updateSolidRgb = () => {
        const el = curEl(); if (!el) return;
        const r = clamp(Number($('shR' + S).value), 0, 1);
        const g = clamp(Number($('shG' + S).value), 0, 1);
        const b = clamp(Number($('shB' + S).value), 0, 1);
        const hex = rgb01ToHex(r, g, b);
        el.color = hex;
        if ($('shColor' + S)) $('shColor' + S).value = hex;
        if ($('shSwatchFill' + S)) $('shSwatchFill' + S).style.backgroundColor = hex;
        const hexEl = $('shHex' + S);
        if (hexEl && document.activeElement !== hexEl) hexEl.value = hex;
        el.modified = true;
        commit();
    };

    if ($('shR' + S)) {
        $('shR' + S).addEventListener('input', () => {
            if ($('shRN' + S)) $('shRN' + S).value = Number($('shR' + S).value).toFixed(2);
            updateSolidRgb();
        });
    }
    if ($('shRN' + S)) {
        $('shRN' + S).addEventListener('input', () => {
            const v = clamp(Number($('shRN' + S).value) || 0, 0, 1);
            if ($('shR' + S)) $('shR' + S).value = v;
            updateSolidRgb();
        });
    }

    if ($('shG' + S)) {
        $('shG' + S).addEventListener('input', () => {
            if ($('shGN' + S)) $('shGN' + S).value = Number($('shG' + S).value).toFixed(2);
            updateSolidRgb();
        });
    }
    if ($('shGN' + S)) {
        $('shGN' + S).addEventListener('input', () => {
            const v = clamp(Number($('shGN' + S).value) || 0, 0, 1);
            if ($('shG' + S)) $('shG' + S).value = v;
            updateSolidRgb();
        });
    }

    if ($('shB' + S)) {
        $('shB' + S).addEventListener('input', () => {
            if ($('shBN' + S)) $('shBN' + S).value = Number($('shB' + S).value).toFixed(2);
            updateSolidRgb();
        });
    }
    if ($('shBN' + S)) {
        $('shBN' + S).addEventListener('input', () => {
            const v = clamp(Number($('shBN' + S).value) || 0, 0, 1);
            if ($('shB' + S)) $('shB' + S).value = v;
            updateSolidRgb();
        });
    }

    if ($('shHex' + S)) {
        const hexEl = $('shHex' + S);
        const applyHex = () => {
            const el = curEl(); if (!el) return;
            const norm = normHex(hexEl.value);
            hexEl.classList.toggle('bad', !norm && hexEl.value.trim() !== '');
            if (!norm) return;
            el.color = norm;
            const rgb = hexToRgb01(norm);
            if ($('shR' + S)) $('shR' + S).value = rgb.r;
            if ($('shRN' + S)) $('shRN' + S).value = rgb.r.toFixed(2);
            if ($('shG' + S)) $('shG' + S).value = rgb.g;
            if ($('shGN' + S)) $('shGN' + S).value = rgb.g.toFixed(2);
            if ($('shB' + S)) $('shB' + S).value = rgb.b;
            if ($('shBN' + S)) $('shBN' + S).value = rgb.b.toFixed(2);
            if ($('shSwatchFill' + S)) $('shSwatchFill' + S).style.backgroundColor = norm;
            if ($('shColor' + S)) $('shColor' + S).value = norm;
            el.modified = true;
            commit();
        };
        hexEl.addEventListener('input', applyHex);
        hexEl.addEventListener('blur', () => {
            const el = curEl();
            const norm = normHex(hexEl.value);
            if (norm) hexEl.value = norm;
            else if (el) { hexEl.value = el.color || '#ffffff'; hexEl.classList.remove('bad'); }
        });
    }

    const updateSolidOpacity = (v) => {
        const el = curEl(); if (!el) return;
        el.opacity = clamp(Number(v), 0, 1);
        el.modified = true;
        commit();
    };

    if ($('shOpacity' + S)) {
        $('shOpacity' + S).addEventListener('input', () => {
            const v = Number($('shOpacity' + S).value);
            if ($('vShOpacity' + S)) $('vShOpacity' + S).value = v.toFixed(2);
            updateSolidOpacity(v);
        });
    }
    if ($('vShOpacity' + S)) {
        $('vShOpacity' + S).addEventListener('input', () => {
            const v = clamp(Number($('vShOpacity' + S).value) || 0, 0, 1);
            if ($('shOpacity' + S)) $('shOpacity' + S).value = v;
            updateSolidOpacity(v);
        });
    }

    if ($('shColor' + S)) {
        $('shColor' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            el.color = $('shColor' + S).value;
            const rgb = hexToRgb01(el.color);
            if ($('shR' + S)) $('shR' + S).value = rgb.r;
            if ($('shRN' + S)) $('shRN' + S).value = rgb.r.toFixed(2);
            if ($('shG' + S)) $('shG' + S).value = rgb.g;
            if ($('shGN' + S)) $('shGN' + S).value = rgb.g.toFixed(2);
            if ($('shB' + S)) $('shB' + S).value = rgb.b;
            if ($('shBN' + S)) $('shBN' + S).value = rgb.b.toFixed(2);
            if ($('shSwatchFill' + S)) $('shSwatchFill' + S).style.backgroundColor = el.color;
            const hexEl = $('shHex' + S);
            if (hexEl && document.activeElement !== hexEl) hexEl.value = el.color;
            el.modified = true;
            commit();
        });
    }

    if ($('shDropBtn' + S)) {
        $('shDropBtn' + S).addEventListener('click', async () => {
            if (window.EyeDropper) {
                try {
                    const ed = new EyeDropper();
                    const res = await ed.open();
                    if (res && res.sRGBHex) {
                        const colEl = $('shColor' + S);
                        if (colEl) {
                            colEl.value = res.sRGBHex;
                            colEl.dispatchEvent(new Event('input'));
                        }
                    }
                } catch (e) { }
            } else {
                const colEl = $('shColor' + S);
                if (colEl) colEl.click();
            }
        });
    }

    if ($('shColorToggle' + S)) {
        $('shColorToggle' + S).addEventListener('click', () => {
            const toggle = $('shColorToggle' + S);
            toggle.classList.toggle('open');
            const sliders = $('shSolidSliders' + S);
            if (sliders) sliders.classList.toggle('hidden', !toggle.classList.contains('open'));
        });
    }

    // --- Gradient controls
    let activeGradStop = 0;
    if ($('shStop0' + S)) {
        $('shStop0' + S).addEventListener('click', () => {
            activeGradStop = 0;
            if (typeBox) typeBox._activeStop = 0;
            const el = curEl(); if (el) syncGradientStopUI(S, el, 0);
        });
    }
    if ($('shStop1' + S)) {
        $('shStop1' + S).addEventListener('click', () => {
            activeGradStop = 1;
            if (typeBox) typeBox._activeStop = 1;
            const el = curEl(); if (el) syncGradientStopUI(S, el, 1);
        });
    }

    const updateGradRgb = () => {
        const el = curEl(); if (!el) return;
        const r = clamp(Number($('shGradR' + S).value), 0, 1);
        const g = clamp(Number($('shGradG' + S).value), 0, 1);
        const b = clamp(Number($('shGradB' + S).value), 0, 1);
        const hex = rgb01ToHex(r, g, b);
        if (activeGradStop === 0) {
            el.color = hex;
            if ($('shColor' + S)) $('shColor' + S).value = hex;
        } else {
            el.color2 = hex;
            if ($('shColor2' + S)) $('shColor2' + S).value = hex;
        }
        if ($('shGradSwatchFill' + S)) $('shGradSwatchFill' + S).style.backgroundColor = hex;
        if ($('shGradColorInput' + S)) $('shGradColorInput' + S).value = hex;
        const hexEl = $('shGradHex' + S);
        if (hexEl && document.activeElement !== hexEl) hexEl.value = hex;
        if ($('shGradBar' + S)) $('shGradBar' + S).style.background = `linear-gradient(to right, ${el.color || '#ffffff'}, ${el.color2 || '#f07b8e'})`;
        el.modified = true;
        commit();
    };

    if ($('shGradR' + S)) {
        $('shGradR' + S).addEventListener('input', () => {
            if ($('shGradRN' + S)) $('shGradRN' + S).value = Number($('shGradR' + S).value).toFixed(2);
            updateGradRgb();
        });
    }
    if ($('shGradRN' + S)) {
        $('shGradRN' + S).addEventListener('input', () => {
            const v = clamp(Number($('shGradRN' + S).value) || 0, 0, 1);
            if ($('shGradR' + S)) $('shGradR' + S).value = v;
            updateGradRgb();
        });
    }

    if ($('shGradG' + S)) {
        $('shGradG' + S).addEventListener('input', () => {
            if ($('shGradGN' + S)) $('shGradGN' + S).value = Number($('shGradG' + S).value).toFixed(2);
            updateGradRgb();
        });
    }
    if ($('shGradGN' + S)) {
        $('shGradGN' + S).addEventListener('input', () => {
            const v = clamp(Number($('shGradGN' + S).value) || 0, 0, 1);
            if ($('shGradG' + S)) $('shGradG' + S).value = v;
            updateGradRgb();
        });
    }

    if ($('shGradB' + S)) {
        $('shGradB' + S).addEventListener('input', () => {
            if ($('shGradBN' + S)) $('shGradBN' + S).value = Number($('shGradB' + S).value).toFixed(2);
            updateGradRgb();
        });
    }
    if ($('shGradBN' + S)) {
        $('shGradBN' + S).addEventListener('input', () => {
            const v = clamp(Number($('shGradBN' + S).value) || 0, 0, 1);
            if ($('shGradB' + S)) $('shGradB' + S).value = v;
            updateGradRgb();
        });
    }

    if ($('shGradHex' + S)) {
        const hexEl = $('shGradHex' + S);
        const applyGradHex = () => {
            const el = curEl(); if (!el) return;
            const norm = normHex(hexEl.value);
            hexEl.classList.toggle('bad', !norm && hexEl.value.trim() !== '');
            if (!norm) return;
            if (activeGradStop === 0) {
                el.color = norm;
                if ($('shColor' + S)) $('shColor' + S).value = norm;
            } else {
                el.color2 = norm;
                if ($('shColor2' + S)) $('shColor2' + S).value = norm;
            }
            syncGradientStopUI(S, el, activeGradStop);
            if ($('shGradBar' + S)) $('shGradBar' + S).style.background = `linear-gradient(to right, ${el.color || '#ffffff'}, ${el.color2 || '#f07b8e'})`;
            el.modified = true;
            commit();
        };
        hexEl.addEventListener('input', applyGradHex);
        hexEl.addEventListener('blur', () => {
            const el = curEl();
            const norm = normHex(hexEl.value);
            if (norm) hexEl.value = norm;
            else if (el) {
                const cur = activeGradStop === 0 ? el.color : el.color2;
                hexEl.value = cur || '#ffffff';
                hexEl.classList.remove('bad');
            }
        });
    }

    if ($('shGradA' + S)) {
        $('shGradA' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = clamp(Number($('shGradA' + S).value), 0, 1);
            if ($('shGradAN' + S)) $('shGradAN' + S).value = v.toFixed(2);
            el.opacity = v;
            el.modified = true;
            commit();
        });
    }
    if ($('shGradAN' + S)) {
        $('shGradAN' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = clamp(Number($('shGradAN' + S).value) || 0, 0, 1);
            if ($('shGradA' + S)) $('shGradA' + S).value = v;
            el.opacity = v;
            el.modified = true;
            commit();
        });
    }

    if ($('shGradColorInput' + S)) {
        $('shGradColorInput' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const hex = $('shGradColorInput' + S).value;
            if (activeGradStop === 0) {
                el.color = hex;
                if ($('shColor' + S)) $('shColor' + S).value = hex;
            } else {
                el.color2 = hex;
                if ($('shColor2' + S)) $('shColor2' + S).value = hex;
            }
            syncGradientStopUI(S, el, activeGradStop);
            if ($('shGradBar' + S)) $('shGradBar' + S).style.background = `linear-gradient(to right, ${el.color || '#ffffff'}, ${el.color2 || '#f07b8e'})`;
            el.modified = true;
            commit();
        });
    }

    if ($('shGradDropBtn' + S)) {
        $('shGradDropBtn' + S).addEventListener('click', async () => {
            if (window.EyeDropper) {
                try {
                    const ed = new EyeDropper();
                    const res = await ed.open();
                    if (res && res.sRGBHex) {
                        const inEl = $('shGradColorInput' + S);
                        if (inEl) {
                            inEl.value = res.sRGBHex;
                            inEl.dispatchEvent(new Event('input'));
                        }
                    }
                } catch (e) { }
            } else {
                const inEl = $('shGradColorInput' + S);
                if (inEl) inEl.click();
            }
        });
    }

    if ($('shGradColorToggle' + S)) {
        $('shGradColorToggle' + S).addEventListener('click', () => {
            const toggle = $('shGradColorToggle' + S);
            toggle.classList.toggle('open');
            const sliders = $('shGradSliders' + S);
            if (sliders) sliders.classList.toggle('hidden', !toggle.classList.contains('open'));
        });
    }

    // Mapping Angle
    if ($('shMapAngle' + S)) {
        $('shMapAngle' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = Number($('shMapAngle' + S).value);
            if ($('shMapAngleN' + S)) $('shMapAngleN' + S).value = v.toFixed(1);
            el.mappingAngle = v;
            el.modified = true;
            commit();
        });
    }
    if ($('shMapAngleN' + S)) {
        $('shMapAngleN' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = clamp(Number($('shMapAngleN' + S).value) || 0, -180, 180);
            if ($('shMapAngle' + S)) $('shMapAngle' + S).value = v;
            el.mappingAngle = v;
            el.modified = true;
            commit();
        });
    }

    // Mapping Size
    if ($('shMapSize' + S)) {
        $('shMapSize' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = Number($('shMapSize' + S).value);
            if ($('shMapSizeN' + S)) $('shMapSizeN' + S).value = v.toFixed(2);
            el.mappingSize = v;
            el.modified = true;
            commit();
        });
    }
    if ($('shMapSizeN' + S)) {
        $('shMapSizeN' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = clamp(Number($('shMapSizeN' + S).value) || 0.1, 0.1, 10);
            if ($('shMapSize' + S)) $('shMapSize' + S).value = v;
            el.mappingSize = v;
            el.modified = true;
            commit();
        });
    }

    // Mapping Aspect
    if ($('shMapAspect' + S)) {
        $('shMapAspect' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = Number($('shMapAspect' + S).value);
            if ($('shMapAspectN' + S)) $('shMapAspectN' + S).value = v.toFixed(2);
            el.mappingAspect = v;
            el.modified = true;
            commit();
        });
    }
    if ($('shMapAspectN' + S)) {
        $('shMapAspectN' + S).addEventListener('input', () => {
            const el = curEl(); if (!el) return;
            const v = clamp(Number($('shMapAspectN' + S).value) || 0.1, 0.1, 10);
            if ($('shMapAspect' + S)) $('shMapAspect' + S).value = v;
            el.mappingAspect = v;
            el.modified = true;
            commit();
        });
    }

    // Mapping Level
    if ($('shMapLevel' + S)) {
        $('shMapLevel' + S).addEventListener('change', () => {
            const el = curEl(); if (!el) return;
            el.mappingLevel = Number($('shMapLevel' + S).value);
            el.modified = true;
            commit();
        });
    }
    $('shThickness' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.thickness = Number($('shThickness' + S).value);
        if ($('vShThickness' + S)) $('vShThickness' + S).textContent = el.thickness.toFixed(3);
        el.modified = true;
        commit();
    });
    $('shLevel' + S).addEventListener('change', () => {
        const el = curEl(); if (!el) return;
        el.level = Number($('shLevel' + S).value);
        el.modified = true;
        commit();
    });
    $('shExtendH' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.extendH = Number($('shExtendH' + S).value);
        if ($('vShExtendH' + S)) $('vShExtendH' + S).textContent = el.extendH.toFixed(3);
        el.modified = true;
        commit();
    });
    $('shExtendV' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.extendV = Number($('shExtendV' + S).value);
        if ($('vShExtendV' + S)) $('vShExtendV' + S).textContent = el.extendV.toFixed(3);
        el.modified = true;
        commit();
    });
    $('shRound' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.round = Number($('shRound' + S).value);
        if ($('vShRound' + S)) $('vShRound' + S).textContent = el.round.toFixed(3);
        el.modified = true;
        commit();
    });
    $('shSoftness' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.softness = clamp(Number($('shSoftness' + S).value) || 0, 0, 30);
        el.modified = true;
        commit();
    });
    $('shOffsetX' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.offsetX = clamp(Number($('shOffsetX' + S).value) || 0, -1, 1);
        el.modified = true;
        commit();
    });
    $('shOffsetY' + S).addEventListener('input', () => {
        const el = curEl(); if (!el) return;
        el.offsetY = clamp(Number($('shOffsetY' + S).value) || 0, -1, 1);
        el.modified = true;
        commit();
    });
}
