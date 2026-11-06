// Panel actions: preparing the sound, applying to the timeline, saving, panel width.

// ---------------------------------------------------------------- actions
// The sound that goes on the timeline: { sfxPath, sfxCut }. The ORIGINAL file goes into Resolve whole and is cut there
// by the settings ({ trimIn, len, fade } in frames, worked out here like the alignment timeline shows them), so no new
// audio file is made and the clip can be extended on the timeline afterwards. Only an older preset whose sound exists
// solely as an already-cut clip (no original kept) still gets a rendered WAV, placed as it is.
const EDITED_SFX_RE = /-\d{8}[-_]\d{6}\.wav$|\(trim [a-f0-9]+\)\.wav$/i;
const sfxSecondsCache = new Map();
async function sfxSeconds(p) {
    const w = state.waves.get(p);
    if (w && w.seconds) return w.seconds;
    if (sfxSecondsCache.has(p)) return sfxSecondsCache.get(p);
    const w2 = await loadWave(p);
    if (w2 && w2.seconds) return w2.seconds;
    // its waveform is still loading elsewhere: decode it once just for its length
    const bytes = await window.sa.readSfx(p);
    if (!(bytes instanceof Uint8Array)) return null;
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    let secs = null;
    try { secs = (await ac.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).duration; } finally { ac.close(); }
    if (secs) sfxSecondsCache.set(p, secs);
    return secs;
}
async function buildFadedSfx(m, span) {
    const p = origSfxPath(m) || currentSfxPath(m);
    if (!p || m.useSfx === false) return null;
    const hasOrig = !!(m.sfxOrigPath || m.sfxOrig);
    if (hasOrig || !EDITED_SFX_RE.test(baseName(p))) {
        const secs = await sfxSeconds(p);
        let g;
        waveSecOverride = secs;
        if (span) spanOverride = span;
        try { g = geometry(m); } finally { waveSecOverride = null; spanOverride = null; }
        return { sfxPath: p, sfxCut: { trimIn: g.sfxTrimIn, len: g.sfxFrames, fade: g.fadeFrames } };
    }
    return legacyRenderedSfx(m, span, p);
}
async function legacyRenderedSfx(m, span, p) {
    const rendered = await renderTrimmedWav(m, span);
    if (!rendered || !rendered.data) return null;
    const res = await window.sa.saveSfxClip(baseName(p), rendered.data);
    return (res && res.path) ? { sfxPath: res.path, sfxCut: null } : null;
}

async function create() {
    if (state.livePrev) {       // a Preview in Resolve is running: this button does what the Apply button does
        if (state.livePrev.removed) previewAgain(); else endLivePreview(true);
        return;
    }
    const a = selected();
    const m = state.use;
    const L = state.live;
    if (!a || !m || !L || !L.ok) return;
    const s = L.subtitle;
    const text = String(($('subText') && $('subText').value.trim()) || (s && s.text) || (a && a.sample) || 'Sample text').trim();
    const start = s ? s.start : L.frame;
    const end = s ? s.end : L.frame + Math.round((L.fps || 25) * 3);
    state.busy = true;
    if ($('create')) $('create').disabled = true;
    setStatus('Creating…');
    let sfxClip = null;
    try { sfxClip = await buildFadedSfx(m); } catch (e) { sfxClip = null; }      // falls back to the original sound
    const res = await window.sa.apply({
        animationId: a.id, text, start, end,
        sfxPath: (sfxClip && sfxClip.sfxPath) || undefined, sfxCut: (sfxClip && sfxClip.sfxCut) || undefined,
        textOffset: m.textOffset, sfxOffset: m.sfxOffset, sfxVolume: m.sfxVolume, tail: m.tail,
        textTrack: m.textTrack, sfxTrack: m.sfxTrack, useSfx: m.useSfx !== false, place: placeOptions(),
        linked: m.linked !== false,
        posX: Number(m.posX) || 0, posY: Number(m.posY) || 0,
        scale: Number(m.scale) || 1, rotation: Number(m.rotation) || 0,
        textDesign: m.textDesign || a.textDesign || null,
        sfxLayers: Array.isArray(m.sfxLayers) ? m.sfxLayers : undefined,
        boxList: window.SABoxes ? SABoxes.payload(m, a, text) : []
    });
    state.busy = false;
    if (res && res.ok) {
        const parts = ['Placed on V' + res.videoTrack, res.frames + ' frames'];
        if (res.audioTrack) parts.push('sound on A' + res.audioTrack + (res.linked ? ' (linked)' : ''));
        if (res.trackNotes && res.trackNotes.length) parts.push('(' + res.trackNotes.join(', ') + ')');
        if (window.SABoxes && res.liveNodes && res.liveNodes.length) parts.push(SABoxes.liveSummary(res.liveNodes));
        state.liveBg.key = '';
        refreshLiveBg();
        setStatus(parts.join(' · ') + (res.warnings.length ? ' · ' + res.warnings.join(' ') : ''), res.warnings.length ? '' : 'ok');
        // a preview may have been captured while placing it
        try { const r = await window.sa.getLib(); if (r && r.lib) { state.lib = r.lib; syncUse(false); renderAll(); } } catch (e) { /* ignore */ }
        parkAfterPlace();
    } else {
        setStatus((res && res.error) || 'Something went wrong', 'bad');
    }
    renderLive();
}

async function initVersion() {
    const el = $('appVersion');
    if (!el) return;

    let currentVersion = '1.0.0';

    if (window.sa && window.sa.getVersion) {
        try {
            const res = await window.sa.getVersion();
            if (res && res.version) {
                currentVersion = res.version;
                el.textContent = currentVersion.startsWith('v') ? currentVersion : `v${currentVersion}`;
            }
        } catch (e) {
            console.warn('Could not load version:', e);
        }
    }

    el.addEventListener('click', () => {
        if (el.querySelector('input')) return;

        const currentText = el.textContent.trim().replace(/^v/i, '');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'version-input';
        input.value = currentText;
        input.title = 'Press Enter to save, Esc to cancel';

        let finished = false;
        const finish = async (save) => {
            if (finished) return;
            finished = true;
            const val = input.value.trim();
            if (save && val) {
                const cleaned = val.replace(/^v/i, '').trim();
                if (cleaned) {
                    if (window.sa && window.sa.setVersion) {
                        try {
                            const res = await window.sa.setVersion(cleaned);
                            if (res && res.version) {
                                currentVersion = res.version;
                            } else if (res && res.error) {
                                console.error('Failed to set version:', res.error);
                            } else {
                                currentVersion = cleaned;
                            }
                        } catch (e) {
                            console.error('Error calling setVersion:', e);
                            currentVersion = cleaned;
                        }
                    } else {
                        currentVersion = cleaned;
                    }
                }
            }
            el.textContent = currentVersion.startsWith('v') ? currentVersion : `v${currentVersion}`;
            el.classList.remove('editing');
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                input.value = currentText;
                input.blur();
            }
        });

        input.addEventListener('blur', () => finish(true));

        el.textContent = '';
        el.classList.add('editing');
        el.appendChild(input);
        input.focus();
        input.select();
    });
}

function initInspectorLayoutModes() {
    let savedMode = 'default';
    try {
        savedMode = localStorage.getItem('sa_inspector_layout_mode') || 'default';
    } catch (e) { }
    applyLayoutMode(savedMode, false);

    document.addEventListener('click', async (e) => {
        const modeBtn = e.target.closest('.layout-mode-btn');
        if (modeBtn) {
            e.preventDefault();
            e.stopPropagation();
            const mode = modeBtn.dataset.mode;
            if (mode) await applyLayoutMode(mode, true);
            return;
        }

        const expandBtn = e.target.closest('.collapse-expand-bar');
        if (expandBtn) {
            e.preventDefault();
            e.stopPropagation();
            await applyLayoutMode('default', true);
            return;
        }
    });
}

// On every launch: size the window to the width its content needs for the saved layout (collapse / default use the
// single-column panel, sidebar the two-column one), then widen it if anything still overflows sideways.
const PANEL_WIDTH = { collapse: 460, default: 460, sidebar: 1160 };
async function fitWindowToContent() {
    if (!window.sa || typeof window.sa.fitWidth !== 'function') return;
    const mode = state.inspectorLayoutMode || 'default';
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* ignore */ }
    try {
        const fit = await window.sa.fitWidth(PANEL_WIDTH[mode] || 460, mode);
        if (fit && fit.restored) {
            // The window was reopened at the size it was closed with: keep it. A sidebar layout cannot work in a narrow window.
            if (mode === 'sidebar' && fit.width < 700) await applyLayoutMode('default', false);
            return;
        }
        await wait(180);
        const de = document.documentElement;
        const overflow = Math.ceil(de.scrollWidth - de.clientWidth);
        if (overflow > 1) await window.sa.fitWidth(window.innerWidth + overflow, mode);
    } catch (e) { console.warn('Could not fit the window width:', e); }
    renderTimelines();
    redrawStages();
}

async function applyLayoutMode(mode, triggerResize) {
    state.inspectorLayoutMode = mode;
    try { localStorage.setItem('sa_inspector_layout_mode', mode); } catch (e) { }

    // Update buttons in both tabs
    document.querySelectorAll('.layout-mode-btn').forEach(b => {
        b.classList.toggle('on', b.dataset.mode === mode);
    });

    // Update inspector grids
    ['U', 'C'].forEach(S => {
        const grid = $('inspectorGrid' + S);
        if (grid) {
            grid.classList.remove('layout-collapse', 'layout-default', 'layout-sidebar');
            grid.classList.add('layout-' + mode);
        }
    });

    // Update body classes for viewport styling
    document.body.classList.toggle('inspector-sidebar', mode === 'sidebar');
    document.body.classList.toggle('inspector-collapse', mode === 'collapse');

    // Expand or restore electron window viewport
    if (triggerResize && window.sa && typeof window.sa.setLayoutMode === 'function') {
        try {
            await window.sa.setLayoutMode(mode);
        } catch (err) {
            console.warn('Failed to resize window for layout mode:', err);
        }
    }

    setTimeout(() => {
        renderTimelines();
        redrawStages();
    }, 120);
}
