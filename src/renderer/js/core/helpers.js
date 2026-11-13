// Small shared helpers: library lookups, file URLs, audio playback, debounce, drop zones.

// ---------------------------------------------------------------- helpers
// setStatus lives in js/ui/status.js.

function libEntry(id) { return state.lib.animations.find(a => a.id === id) || null; }
function selected() { return libEntry(state.selectedId); }
function fpsNow() { return (state.live && state.live.fps) || 25; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
const sg = (n) => (n > 0 ? '+' : '') + n;

function fileUrl(p) {
    return 'file://' + p.split('/').map(encodeURIComponent).join('/');
}

function play(p, volumeDb) {
    if (!p) return;
    try {
        if (state.audio) { state.audio.pause(); }
        state.audio = new Audio(fileUrl(p));
        if (volumeDb !== undefined && volumeDb !== null) {
            const gain = Math.pow(10, Number(volumeDb) / 20);
            state.audio.volume = clamp(gain, 0, 1);
        }
        const pr = state.audio.play();
        if (pr && pr.catch) pr.catch(() => setStatus('Could not play that sound', 'bad'));
    } catch (e) { setStatus('Could not play that sound', 'bad'); }
}

function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function takeLib(res) {
    if (res && res.error) { setStatus(res.error, 'bad'); return false; }
    if (res && res.lib) { state.lib = res.lib; syncUse(false); renderAll(); return true; }
    return false;
}

// Make a region accept dropped files. handler(path) gets each file's real path.
function dropZone(el, handler) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); });
    el.addEventListener('dragleave', (e) => { e.stopPropagation(); el.classList.remove('over'); });
    el.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.remove('over');
        for (const f of Array.from(e.dataTransfer.files)) {
            const p = window.sa.pathForFile(f);
            if (p) await handler(p);
        }
    });
}
