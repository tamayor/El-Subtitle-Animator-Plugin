// The Update / Create / Revert save bar.

// A save that Resolve never answers is given up after 25 s so the buttons never stay dead.
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error((what || 'Save') + ' timed out')), ms || 25000))]);

// The Update / Create / Revert bar. Bound on its own (not inside bindTextDesign, which stops early when the Text Design panel
// is not on the page), so these buttons always work in the Library and Use tabs.
function bindSaveBar(ctx) {
    const S = ctx.s;
    if (!$('tdSaveBar' + S)) return;
    const notifyMsg = (msg, kind) => {
        setStatus(msg, kind);
        if (S === 'C') setCreateStatus(msg, kind);
    };
    const varIn = $('tdVarName' + S);
    if (varIn) {
        varIn.addEventListener('input', () => {
            const m = ctx.model();
            if (m) syncVarButtons(S, m);
        });
    }

    // The Update / Create / Revert bar closes the moment a button is clicked (the save finishes in the background).
    // If the save fails, the editor opens again with the error so nothing is lost.
    const closeBarNow = (name, what) => { closeEditorAfterSave(S); finishSave(S, name, what); };
    const reopenOnFail = (id, msg) => {
        const m2 = libEntry(id) || ctx.model();
        if (S === 'C') { state.createId = id; state.createAdjusted = true; if (m2) m2.adjusted = true; renderCreate(); }
        else if (typeof setAdjustOpen === 'function') setAdjustOpen(true);
        if (m2) syncVarButtons(S, m2);
        document.querySelectorAll('.saved-toast').forEach(x => x.remove());
        notifyMsg(msg || 'Could not save.', 'bad');
    };

    const btnSaveVar = $('tdSaveVar' + S);
    if (btnSaveVar) {
        btnSaveVar.addEventListener('click', async () => {
            { const t = Date.now(); if (t - (btnSaveVar._t || 0) < 600) return; btnSaveVar._t = t; }      // only swallows a double click
            const m = ctx.model();
            if (!m) return;
            const mid = m.id;
            const customName = ($('tdVarName' + S) && $('tdVarName' + S).value.trim()) || nextVersionNameUI(m.name);
            const origSfx = m.sfxOrig || (libEntry(m.id) && libEntry(m.id).sfxOrig) || m.sfx || null;
            try {
                closeBarNow(customName, 'Creating…');
                notifyMsg('Creating "' + customName + '"…');
                const res = await withTimeout(window.sa.saveVariant({
                    sourceId: m.id,
                    boxes: m.boxes || {},
                    name: customName,
                    useSfx: m.useSfx !== false,
                    linked: m.linked !== false,
                    sfxOrig: origSfx,
                    sfx: m.sfx !== undefined ? m.sfx : null,
                    sfxPath: m.sfxPath || null,
                    textOffset: m.textOffset,
                    sfxOffset: m.sfxOffset,
                    sfxVolume: m.sfxVolume,
                    tail: m.tail,
                    textTrack: m.textTrack,
                    sfxTrack: m.sfxTrack,
                    posX: Number(m.posX) || 0,
                    posY: Number(m.posY) || 0,
                    scale: Number(m.scale) || 1,
                    rotation: Number(m.rotation) || 0,
                    textDesign: m.textDesign,
                    sfxLayers: Array.isArray(m.sfxLayers) ? m.sfxLayers : undefined
                }), 25000);
                if (res && res.error) { reopenOnFail(mid, res.error); return; }
                if (!res || !res.lib) { reopenOnFail(mid, 'Could not create "' + customName + '".'); return; }
                m.designDirty = false;
                m.adjusted = false;
                m.dirty = false;
                state.createAdjusted = false;
                state.lib = res.lib;
                state.selectedId = res.createdId;
                const newM = libEntry(res.createdId);
                if (newM && newM.useSfx !== false && (newM.sfx || newM.sfxOrig)) {
                    await syncAttachedSfx(newM);
                }
                syncUse(true);
                renderAll();
                finishSave(S, res.createdName, 'Saved');
                notifyMsg('Created new preset "' + res.createdName + '".', 'ok');
            } catch (e) {
                reopenOnFail(mid, 'Create failed: ' + (e && e.message || e));
            }
        });
    }

    const btnUpd = $('tdUpdateLatest' + S);
    if (btnUpd) {
        btnUpd.addEventListener('click', async () => {
            { const t = Date.now(); if (t - (btnUpd._t || 0) < 600) return; btnUpd._t = t; }      // only swallows a double click
            const m = ctx.model();
            if (!m) return;
            const mid = m.id;
            const saveName = (S === 'C' && $('animName') && $('animName').value.trim()) ? $('animName').value.trim() : m.name;
            const subTextVal = $('subText') ? $('subText').value : '';
            try {
                closeBarNow(saveName, 'Saving…');
                notifyMsg('Updating "' + saveName + '"…');
                if (m.useSfx !== false && (m.sfx || m.sfxOrig)) {
                    await syncAttachedSfx(m);
                }
                const res = await withTimeout(window.sa.updateLatest({
                    animationId: m.id,
                    name: saveName,
                    text: subTextVal,
                    updateText: S === 'U',
                    boxes: m.boxes || {},
                    boxList: window.SABoxes ? SABoxes.payload(m, libEntry(m.id) || m, subTextVal, S === 'U') : [],
                    useSfx: m.useSfx !== false,
                    linked: m.linked !== false,
                    sfxOrig: m.sfxOrig || (libEntry(m.id) && libEntry(m.id).sfxOrig) || m.sfx || null,
                    sfx: m.sfx !== undefined ? m.sfx : null,
                    sfxPath: m.sfxPath || null,
                    textOffset: m.textOffset,
                    sfxOffset: m.sfxOffset,
                    sfxVolume: m.sfxVolume,
                    tail: m.tail,
                    textTrack: m.textTrack,
                    sfxTrack: m.sfxTrack,
                    posX: Number(m.posX) || 0,
                    posY: Number(m.posY) || 0,
                    scale: Number(m.scale) || 1,
                    rotation: Number(m.rotation) || 0,
                    textDesign: m.textDesign,
                    sfxLayers: Array.isArray(m.sfxLayers) ? m.sfxLayers : undefined
                }), 25000);
                if (res && res.error) { reopenOnFail(mid, res.error); return; }
                if (!res || !res.lib) { reopenOnFail(mid, 'Could not update "' + saveName + '".'); return; }
                m.designDirty = false;
                m.adjusted = false;
                m.dirty = false;
                state.createAdjusted = false;
                state.lib = res.lib;
                syncUse(true);
                renderAll();
                finishSave(S, res.animName || saveName, 'Saved');
                refreshLiveBg();
                notifyMsg(
                    res.updatedClip
                        ? 'Updated "' + res.animName + '" and latest Text+ clip on timeline.'
                        : 'Updated "' + res.animName + '".',
                    'ok'
                );
            } catch (e) {
                reopenOnFail(mid, 'Update failed: ' + (e && e.message || e));
            }
        });
    }

    const btnRevertOrig = $('tdRevertOrig' + S);
    if (btnRevertOrig) {
        btnRevertOrig.addEventListener('click', (e) => {
            e.stopPropagation();
            const m = ctx.model();
            if (!m) return;
            const targetId = m.id || (S === 'C' ? state.createId : state.selectedId);
            const a = libEntry(targetId);
            if (!a) return;
            openConfirmPop(btnRevertOrig, {
                title: 'Revert to original version?',
                message: 'Restore "' + a.name + '" back to its original .settings file, text design, alignment, and sound? Any saved updates will be overwritten.',
                confirmText: 'Revert',
                danger: true,
                onConfirm: async () => {
                    closeBarNow(a.name, 'Reverting…');
                    try {
                        const res = await withTimeout(window.sa.revertAnimation(a.id), 25000, 'Revert');
                        if (res && res.lib) {
                            a.adjusted = false; a.dirty = false; a.designDirty = false;
                            state.lib = res.lib; syncUse(true); renderAll();
                            finishSave(S, a.name, 'Reverted');
                            setStatus('Reverted "' + a.name + '" to original version.', 'ok');
                        } else reopenOnFail(a.id, (res && res.error) || 'Could not revert "' + a.name + '".');
                    } catch (e) {
                        reopenOnFail(a.id, 'Revert failed: ' + (e && e.message || e));
                    }
                }
            });
        });
    }
}
