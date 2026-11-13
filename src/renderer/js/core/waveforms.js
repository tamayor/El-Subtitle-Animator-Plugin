// Sound waveforms: decoding peaks and drawing them.

// ---------------------------------------------------------------- waveforms
// Peaks are computed once per sound; the bar on the timeline just draws them.
const waveInflight = new Map();
let sharedAudioCtx = null;
function getAudioCtx() {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
        sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return sharedAudioCtx;
}
async function loadWave(p) {
    if (!p) return null;
    if (state.waves.has(p)) {
        const cached = state.waves.get(p);
        if (cached) return cached;
    }
    if (waveInflight.has(p)) return waveInflight.get(p);
    state.waves.set(p, null);                       // mark as loading
    const task = (async () => {
        try {
            const bytes = await window.sa.readSfx(p);
            if (!(bytes instanceof Uint8Array)) throw new Error('unreadable');
            const ctx = getAudioCtx();
            const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
            const channels = [];
            for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
            const len = buf.length;
            const N = 240, step = Math.max(1, Math.floor(len / N));
            const peaks = new Float32Array(N);
            let maxPeak = 0;
            for (let i = 0; i < N; i++) {
                let m = 0;
                const end = Math.min(len, (i + 1) * step);
                for (const ch of channels) {
                    for (let j = i * step; j < end; j++) {
                        const a = Math.abs(ch[j]);
                        if (a > m) m = a;
                    }
                }
                peaks[i] = m;
                if (m > maxPeak) maxPeak = m;
            }
            // Normalize and boost quieter sections so the waveform fills the bar height clearly.
            if (maxPeak > 0) {
                for (let i = 0; i < N; i++) {
                    peaks[i] = Math.pow(peaks[i] / maxPeak, 0.6);
                }
            }
            const w = { peaks, seconds: buf.duration };
            state.waves.set(p, w);
            renderTimelines();
            return w;
        } catch (e) {
            state.waves.set(p, { peaks: new Float32Array(0), seconds: 0.5 });
            return null;
        } finally {
            waveInflight.delete(p);
        }
    })();
    waveInflight.set(p, task);
    return task;
}

// A stored sound name -> its file. Originals are in sounds/original/, edited (trimmed / adjusted) clips in sounds/current/.
function sfxPathFor(name) {
    if (!name || !state.lib) return null;
    const o = (state.lib.sfxOriginals || []).find(x => x.file === name);
    if (o) return o.path;
    const edited = /-\d{8}[-_]\d{6}\.wav$/i.test(name) || /\(trim [a-f0-9]+\)\.wav$/i.test(name);
    const dir = edited ? state.lib.sfxDir : state.lib.sfxOrigDir;
    if (dir) return dir + '/' + name;
    return state.lib.dataDir ? state.lib.dataDir + (edited ? '/sounds/current/' : '/sounds/original/') + name : null;
}

function origSfxPath(a) {
    if (!a || a.useSfx === false) return null;
    if (a.sfxOrigPath) return a.sfxOrigPath;
    if (a.sfxOrig) return sfxPathFor(a.sfxOrig);
    return currentSfxPath(a);
}

function currentSfxPath(a) {
    if (!a || a.useSfx === false) return null;
    if (a.sfxPath) return a.sfxPath;
    if (a.sfx) return sfxPathFor(a.sfx);
    return state.lib && state.lib.defaultSfx ? state.lib.defaultSfx.path : null;
}

// shape: { from, frac } = the part of the sound that is shown (the rest is trimmed away),
// { fade } = fraction of the shown width that fades out at the end (drawn like Resolve: a ramp and a shaded corner).
function drawWave(canvas, wave, volumeDb, shape) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round((canvas.clientWidth || 100) * dpr));
    const h = Math.max(1, Math.round((canvas.clientHeight || 40) * dpr));
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (!wave || !wave.peaks.length) return;
    g.fillStyle = '#9be29d';
    const n = wave.peaks.length;
    const from = shape && shape.from > 0 ? Math.min(1, shape.from) : 0;
    const frac = shape && shape.frac > 0 ? Math.min(1 - from, shape.frac) : 1 - from;
    const fade = shape && shape.fade > 0 ? Math.min(1, shape.fade) : 0;
    const db = (volumeDb !== undefined && volumeDb !== null) ? Number(volumeDb) : 0;
    const linearGain = Math.pow(10, db / 20);
    // Baseline scale at 0 dB is 0.68 of height; scaled by volume gain, capped at full height (1.0)
    const ampScale = Math.max(0.04, Math.min(1.0, 0.68 * linearGain));
    const fadeX = w * (1 - fade);
    for (let x = 0; x < w; x++) {
        const v = wave.peaks[Math.min(n - 1, Math.floor((from + x / w * frac) * n))];
        const mult = (fade > 0 && x > fadeX) ? Math.max(0, (w - x) / (w * fade)) : 1;
        const bar = Math.max(2 * dpr, v * h * ampScale) * mult;
        if (bar < 1) continue;
        g.fillRect(x, (h - bar) / 2, 1, bar);
    }
    if (fade > 0) {
        g.fillStyle = 'rgba(0, 0, 0, 0.32)';
        g.beginPath(); g.moveTo(fadeX, 0); g.lineTo(w, 0); g.lineTo(w, h); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        g.lineWidth = Math.max(1, dpr);
        g.beginPath(); g.moveTo(fadeX, 0); g.lineTo(w, h); g.stroke();
    }
}
