// Sound levels and per-copy variation for placed sound effects.
//
// Peak window: every sound the plugin places peaks between PEAK_LO and PEAK_HI dBFS on the timeline (the user's rule:
// "all sound peaks around -15 to -20 dB"). The real peak of the part of the file that is used (trim in + length) is
// measured once with ffmpeg (volumedetect max_volume) and cached; the clip's volume is then the preset's volume pulled
// into the window: volume + peak is kept inside [PEAK_LO, PEAK_HI]. Without ffmpeg the preset's volume is used as is.
//
// Variation: repeated copies of one sound (one per row / per word) each get a small random pitch shift and a slight
// volume change, so a run of taps or keystrokes does not sound like a loop. Never the same pitch twice in a row.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { APP_DATA_DIR } = require('./config');

const PEAK_LO = -20, PEAK_HI = -15;
const VARY_CENTS = 45;          // pitch: up to +/- this many cents (100 = one semitone)
const VARY_DB = 1.0;            // volume: up to +/- this many dB (still kept inside the peak window)

const CACHE_FILE = path.join(APP_DATA_DIR, 'sfx-peaks.json');
let cache = null, cacheTimer = null;
function readCache() {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {}; } catch (e) { cache = {}; }
    return cache;
}
function writeCacheSoon() {
    if (cacheTimer) return;
    cacheTimer = setTimeout(() => {
        cacheTimer = null;
        try { fs.mkdirSync(APP_DATA_DIR, { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch (e) { /* the cache is a convenience */ }
    }, 200);
    if (cacheTimer.unref) cacheTimer.unref();
}

let ffmpegPath;
function findFfmpeg() {
    if (ffmpegPath !== undefined) return ffmpegPath;
    ffmpegPath = null;
    for (const p of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) {
        try { if (fs.existsSync(p)) { ffmpegPath = p; break; } } catch (e) { /* next */ }
    }
    return ffmpegPath;
}

// The peak (dBFS, e.g. -3.2) of file from startSec for durSec seconds (durSec <= 0 = to the end); null when unknown.
function measurePeak(file, startSec, durSec) {
    return new Promise((resolve) => {
        const ff = findFfmpeg();
        if (!ff || !file || !fs.existsSync(file)) return resolve(null);
        const args = ['-hide_banner', '-nostats'];
        if (startSec > 0) args.push('-ss', String(startSec));
        args.push('-i', file);
        if (durSec > 0) args.push('-t', String(durSec));
        args.push('-af', 'volumedetect', '-vn', '-f', 'null', '-');
        execFile(ff, args, { timeout: 8000 }, (err, stdout, stderr) => {
            const m = /max_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(String(stderr || ''));
            if (!m || m[1] === '-inf') return resolve(null);
            const v = Number(m[1]);
            resolve(Number.isFinite(v) ? v : null);
        });
    });
}

// trimIn / len in frames (len <= 0 = the rest of the file).
async function peakOf(file, trimIn, len, fps) {
    if (!file) return null;
    let st;
    try { st = fs.statSync(file); } catch (e) { return null; }
    const f = Math.max(1, Number(fps) || 25);
    const a = Math.max(0, Math.round(Number(trimIn) || 0)), n = Math.max(0, Math.round(Number(len) || 0));
    const key = file + '|' + st.size + '|' + Math.round(st.mtimeMs) + '|' + a + '|' + n + '|' + Math.round(f * 100);
    const c = readCache();
    if (Object.prototype.hasOwnProperty.call(c, key)) return c[key];
    const v = await measurePeak(file, a / f, n / f);
    c[key] = v;
    const keys = Object.keys(c);
    if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete c[k];
    writeCacheSoon();
    return v;
}

function clampToWindow(vol, peak) {
    const v = Number(vol) || 0;
    if (peak === null || peak === undefined || !Number.isFinite(peak)) return v;
    const lo = PEAK_LO - peak, hi = PEAK_HI - peak;
    return Math.round(Math.max(lo, Math.min(hi, v)) * 10) / 10;
}

// The clip volume (dB) that puts this cut's real peak inside the window, starting from the preset's volume.
async function levelVolume(file, vol, trimIn, len, fps) {
    try { return clampToWindow(vol, await peakOf(file, trimIn, len, fps)); } catch (e) { return Number(vol) || 0; }
}

// A variation maker for one run of copies: next() -> { cents, db } (db = change to add before the window clamp).
function variations() {
    let last = null;
    return {
        next() {
            let cents = 0;
            for (let i = 0; i < 6; i++) {
                cents = Math.round((Math.random() * 2 - 1) * VARY_CENTS);
                if (last === null || Math.abs(cents - last) >= VARY_CENTS / 3) break;
            }
            last = cents;
            return { cents, db: Math.round((Math.random() * 2 - 1) * VARY_DB * 10) / 10 };
        }
    };
}

// Sets the clip's volume and (optional) pitch; each property separately, so a Resolve that does not take the pitch
// keeps the volume.
async function applyLevel(it, vol, cents) {
    try { await it.SetProperties({ AudioVolumeEnabled: true, AudioVolume: vol }); } catch (e) { /* volume is a convenience */ }
    if (cents) {
        try { await it.SetProperties({ AudioPitchEnabled: true, AudioPitchSemiTones: 0, AudioPitchCents: cents }); } catch (e) { /* pitch is a convenience */ }
    }
}

module.exports = { PEAK_LO, PEAK_HI, VARY_CENTS, VARY_DB, peakOf, levelVolume, clampToWindow, variations, applyLevel, measurePeak };
