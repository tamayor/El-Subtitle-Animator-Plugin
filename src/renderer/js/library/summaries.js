// Rendering summaries and the Library preset config (renderConfigC / bindConfigC).

// ---------------------------------------------------------------- rendering
function renderUseSummary() {
    const m = state.use;
    const el = $('adjustSummary');
    if (el) {
        if (!m) { el.textContent = ''; }
        else {
            const f = (n) => sg(n) + 'f';
            el.textContent = 'text ' + f(m.textOffset) + ' · sound ' + f(m.sfxOffset) + (m.linked !== false ? ' · linked' : '') + (m.dirty ? ' · edited' : '');
        }
    }
    renderTdSummary(CTX.U);
}

function renderCreateSummary() {
    const a = libEntry(state.createId);
    const el = $('adjustSummaryC');
    if (el) {
        if (!a) { el.textContent = ''; }
        else {
            const f = (n) => sg(n) + 'f';
            el.textContent = 'text ' + f(a.textOffset) + ' · sound ' + f(a.sfxOffset) + (a.linked !== false ? ' · linked' : '');
        }
    }
    const fs = $('filesSummaryC');
    if (fs) {
        if (!a) { fs.textContent = ''; }
        else {
            const st = presetFileStatus(a);
            const n = st.sound === 'none' ? 1 : 2;
            fs.textContent = n + (n === 1 ? ' file' : ' files') + (st.template === 'mod' || st.sound === 'mod' ? ' · modified' : '');
        }
    }
    renderTdSummary(CTX.C);
    renderConfigSummaryC();
}

// How far a preset's files have drifted from the originals kept for it: 'orig', 'mod' (edited / trimmed / swapped), or 'none' (no sound).
function presetFileStatus(a) {
    if (!a) return { template: 'orig', sound: 'none' };
    const tmplMod = !!(a.adjusted || a.designDirty || (a.orig && (a.orig.file !== a.file || JSON.stringify(a.textDesign) !== JSON.stringify(a.orig.textDesign))));
    const cur = a.sfx || null;
    const orig = a.sfxOrig || null;
    let snd = 'orig';
    if (!cur && !orig) snd = 'none';
    else if (cur && orig && cur !== orig) snd = 'mod';
    return { template: tmplMod ? 'mod' : 'orig', sound: snd };
}

function renderConfigSummaryC() {
    const a = libEntry(state.createId);
    const sumEl = $('configSummaryC');
    if (!sumEl) return;
    if (!a) { sumEl.textContent = ''; return; }
    const st = presetFileStatus(a);
    const t = st.template === 'mod' ? 'template modified' : 'template original';
    const snd = st.sound === 'none' ? 'no sound' : (st.sound === 'mod' ? 'sound modified' : 'sound original');
    sumEl.textContent = t + ' · ' + snd;
}

function renderConfigC() {
    const a = libEntry(state.createId);
    if (!a) return;
    const st = presetFileStatus(a);

    const origSetting = $('cfgSettingOrigFile');
    if (origSetting) { origSetting.textContent = a.fileOrig || a.file || '—'; origSetting.title = origSetting.textContent; }
    const origAudio = $('cfgAudioOrigFile');
    if (origAudio) { origAudio.textContent = a.sfxOrig || 'None'; origAudio.title = origAudio.textContent; }

    // Revert only shows when there is something to revert; "Current" needs a sound to take.
    const revS = $('cfgSettingRevert');
    if (revS) revS.style.display = st.template === 'mod' ? '' : 'none';
    const revA = $('cfgAudioRevert');
    if (revA) revA.style.display = st.sound === 'mod' ? '' : 'none';
    const curA = $('cfgAudioFromCurrent');
    if (curA) curA.disabled = !a.sfx;

    renderConfigSummaryC();
}

function bindConfigC() {
    // 1. .settings operations
    const revertSettingBtn = $('cfgSettingRevert');
    if (revertSettingBtn) {
        revertSettingBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a) return;
            openConfirmPop(revertSettingBtn, {
                title: 'Revert .settings to original?',
                message: 'Reset "' + a.name + '" back to original baseline template? Current edits will be discarded.',
                confirmText: 'Revert to original',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.revertAnimation(a.id);
                    if (takeLib(res)) {
                        a.adjusted = false;
                        a.designDirty = false;
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Reverted "' + a.name + '" to original version', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const fromTlSettingBtn = $('cfgSettingFromTimeline');
    if (fromTlSettingBtn) {
        fromTlSettingBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a) return;
            openConfirmPop(fromTlSettingBtn, {
                title: 'Overwrite original from timeline?',
                message: 'Export selected Text+ clip on Resolve timeline and overwrite original .settings baseline for "' + a.name + '"?',
                confirmText: 'Overwrite original',
                danger: true,
                onConfirm: async () => {
                    setCreateStatus('Exporting clip from Resolve timeline…');
                    const res = await window.sa.overwriteSettingFromTimeline(a.id);
                    if (takeLib(res)) {
                        a.adjusted = false;
                        a.designDirty = false;
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Overwrote original .settings from timeline for "' + a.name + '"', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const fromCurSettingBtn = $('cfgSettingFromCurrent');
    if (fromCurSettingBtn) {
        fromCurSettingBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a) return;
            openConfirmPop(fromCurSettingBtn, {
                title: 'Save current settings as original?',
                message: 'Make current settings and design the permanent original baseline for "' + a.name + '"?',
                confirmText: 'Overwrite original',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.overwriteSettingFromCurrent(a.id);
                    if (takeLib(res)) {
                        a.adjusted = false;
                        a.designDirty = false;
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Overwrote original with current settings for "' + a.name + '"', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const settingDrop = $('cfgSettingDrop');
    const settingPick = $('cfgSettingPick');

    const handleSettingFile = (filePath) => {
        const a = libEntry(state.createId);
        if (!a || !filePath) return;
        const bName = baseName(filePath);
        openConfirmPop(settingDrop || settingPick, {
            title: 'Overwrite original .settings?',
            message: 'Overwrite original .settings baseline with "' + bName + '" for "' + a.name + '"?',
            confirmText: 'Overwrite original',
            danger: true,
            onConfirm: async () => {
                setCreateStatus('Updating .settings from file…');
                const res = await window.sa.overwriteSettingFromFile(a.id, filePath);
                if (takeLib(res)) {
                    a.adjusted = false;
                    a.designDirty = false;
                    renderCreate();
                    renderAnimations();
                    setCreateStatus('Overwrote original .settings with "' + bName + '"', 'ok');
                } else if (res && res.error) {
                    setCreateStatus(res.error, 'bad');
                }
            }
        });
    };

    if (settingDrop) dropZone(settingDrop, handleSettingFile);
    if (settingPick) {
        settingPick.addEventListener('click', async (e) => {
            e.stopPropagation();
            const p = await window.sa.pickFileOrFolder('setting');
            if (p) handleSettingFile(p);
        });
    }

    // 2. Audio operations
    const audioPlayBtn = $('cfgAudioPlay');
    if (audioPlayBtn) {
        audioPlayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            const p = a && currentSfxPath(a);
            if (p) play(p);
            else setCreateStatus('No audio attached', 'bad');
        });
    }

    const audioRemoveBtn = $('cfgAudioRemove');
    if (audioRemoveBtn) {
        audioRemoveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a || !a.sfx) return;
            openConfirmPop(audioRemoveBtn, {
                title: 'Detach audio effect?',
                message: 'Remove attached audio from preset "' + a.name + '"?',
                confirmText: 'Remove audio',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.setAnimationSfx(a.id, null);
                    if (takeLib(res)) {
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Removed audio from "' + a.name + '"', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const audioRevertBtn = $('cfgAudioRevert');
    if (audioRevertBtn) {
        audioRevertBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a || !a.sfxOrig) return;
            openConfirmPop(audioRevertBtn, {
                title: 'Revert audio to original sound?',
                message: 'Discard trimmed audio adjustments and revert to original sound "' + a.sfxOrig + '"?',
                confirmText: 'Revert audio',
                danger: false,
                onConfirm: async () => {
                    const res = await window.sa.revertAudio(a.id);
                    if (takeLib(res)) {
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Reverted audio to original sound for "' + a.name + '"', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const audioFromTlBtn = $('cfgAudioFromTimeline');
    if (audioFromTlBtn) {
        audioFromTlBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a) return;
            openConfirmPop(audioFromTlBtn, {
                title: 'Overwrite original audio from timeline?',
                message: 'Use the audio clip selected on Resolve timeline as the new original sound for "' + a.name + '"?',
                confirmText: 'Overwrite original',
                danger: true,
                onConfirm: async () => {
                    setCreateStatus('Reading selected audio from timeline…');
                    const res = await window.sa.overwriteAudioFromTimeline(a.id);
                    if (takeLib(res)) {
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Overwrote original audio from timeline for "' + a.name + '"', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const audioFromCurBtn = $('cfgAudioFromCurrent');
    if (audioFromCurBtn) {
        audioFromCurBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = libEntry(state.createId);
            if (!a || !a.sfx) return;
            openConfirmPop(audioFromCurBtn, {
                title: 'Save current audio as original?',
                message: 'Make current audio ("' + a.sfx + '") the permanent original sound for "' + a.name + '"?',
                confirmText: 'Overwrite original',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.overwriteAudioFromCurrent(a.id);
                    if (takeLib(res)) {
                        renderCreate();
                        renderAnimations();
                        setCreateStatus('Overwrote original audio with current audio for "' + a.name + '"', 'ok');
                    } else if (res && res.error) {
                        setCreateStatus(res.error, 'bad');
                    }
                }
            });
        });
    }

    const audioDrop = $('cfgAudioDrop');
    const audioPick = $('cfgAudioPick');
    const handleAudioFile = (filePath) => {
        const a = libEntry(state.createId);
        if (!a || !filePath) return;
        const bName = baseName(filePath);
        openConfirmPop(audioDrop || audioPick, {
            title: 'Overwrite original audio?',
            message: 'Overwrite original sound with "' + bName + '" for "' + a.name + '"?',
            confirmText: 'Overwrite original',
            danger: true,
            onConfirm: async () => {
                setCreateStatus('Updating audio from file…');
                const res = await window.sa.overwriteAudioFromFile(a.id, filePath);
                if (takeLib(res)) {
                    renderCreate();
                    renderAnimations();
                    setCreateStatus('Overwrote original audio with "' + bName + '"', 'ok');
                } else if (res && res.error) {
                    setCreateStatus(res.error, 'bad');
                }
            }
        });
    };

    if (audioDrop) dropZone(audioDrop, handleAudioFile);
    if (audioPick) {
        audioPick.addEventListener('click', async (e) => {
            e.stopPropagation();
            const p = await window.sa.pickFileOrFolder('sfx');
            if (p) handleAudioFile(p);
        });
    }

    // Dropdown from SFX Originals
    const audioOrigBtn = $('cfgAudioOrigBtn');
    const audioOrigDrop = $('cfgAudioOrigDropdown');
    if (audioOrigBtn && audioOrigDrop) {
        const closeOrigDropdown = () => { audioOrigDrop.classList.add('hidden'); };
        audioOrigBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = audioOrigDrop.classList.contains('hidden');
            if (!isHidden) { closeOrigDropdown(); return; }
            audioOrigDrop.innerHTML = '';
            const originals = (state.lib && state.lib.sfxOriginals) || [];
            if (!originals.length) {
                const empty = document.createElement('div');
                empty.className = 'hint';
                empty.style.padding = '6px 10px';
                empty.textContent = 'No stored original sounds. Add some in the SFX Originals accordion below!';
                audioOrigDrop.appendChild(empty);
            } else {
                for (const item of originals) {
                    const dItem = document.createElement('div');
                    dItem.className = 'sfx-orig-dropdown-item';

                    const pBtn = document.createElement('button');
                    pBtn.type = 'button';
                    pBtn.className = 'ghost sm-btn';
                    pBtn.textContent = '▶';
                    pBtn.title = 'Preview sound';
                    pBtn.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        play(item.path);
                    });

                    const label = document.createElement('span');
                    label.className = 'sfx-orig-dropdown-name grow';
                    label.textContent = item.file;
                    label.title = item.file;

                    const delOrigBtn = document.createElement('button');
                    delOrigBtn.type = 'button';
                    delOrigBtn.className = 'ghost sm-btn sfx-del-btn';
                    delOrigBtn.textContent = '🗑';
                    delOrigBtn.title = 'Delete original sound';
                    delOrigBtn.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        openConfirmPop(delOrigBtn, {
                            title: 'Delete original sound?',
                            message: 'Permanently delete "' + item.file + '" from originals library? Presets already using it will retain their audio.',
                            confirmText: 'Delete',
                            danger: true,
                            onConfirm: async () => {
                                const res = await window.sa.removeSfxOriginal(item.file);
                                if (takeLib(res)) {
                                    setCreateStatus('Deleted "' + item.file + '" from originals library.', 'ok');
                                }
                            }
                        });
                    });

                    dItem.appendChild(pBtn);
                    dItem.appendChild(label);
                    dItem.appendChild(delOrigBtn);
                    dItem.addEventListener('click', async (ev) => {
                        if (ev.target.closest('.sfx-del-btn') || ev.target.closest('button')) return;
                        closeOrigDropdown();
                        handleAudioFile(item.path);
                    });
                    audioOrigDrop.appendChild(dItem);
                }
            }
            audioOrigDrop.classList.remove('hidden');
        });
        document.addEventListener('click', (e) => {
            if (!audioOrigDrop.contains(e.target) && e.target !== audioOrigBtn) {
                closeOrigDropdown();
            }
        });
    }
}

function renderTdSummary(ctx) {
    const S = ctx.s;
    const el = $('tdSummary' + S);
    if (!el) return;
    const m = ctx.model();
    if (!m) { el.textContent = ''; return; }
    const td = editTD(m, S) || (libEntry(m.id) && libEntry(m.id).textDesign);
    if (!td) { el.textContent = ''; return; }
    const font = td.font || 'Poppins';
    const style = td.style === '' ? '' : (td.style || 'Bold');
    const size = (Number(td.size) || 0.12).toFixed(3);
    const who = (window.SABoxes && SABoxes.targetLabel) ? SABoxes.targetLabel(S) : '';
    el.textContent = (who ? who + ' · ' : '') + font + ' ' + style + ' · ' + size + (m.designDirty ? ' · edited' : '');
}

function soundOf(a) {
    return a.useSfx === false ? null : (a.sfxPath || (state.lib.defaultSfx && state.lib.defaultSfx.path));
}
