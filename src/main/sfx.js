// Sound-effect files: the originals library, saving trimmed / attached clips, and reading audio for the panel.
// Like presets/current + presets/original, sounds live in two folders:
//   sounds/original/  the preserved originals (the SFX Originals Library; a preset's `sfxOrig`)    = SFX_ORIG_DIR
//   sounds/current/   the edited (trimmed / adjusted) clips attached to presets (a preset's `sfx`) = SFX_DIR
// A preset whose sound was never edited has `sfx === sfxOrig`, which lives in sounds/original/. Always turn a stored
// sound name into a path with sfxFilePath().

module.exports = {
    addSfxOriginal, copySfx, isEditedSfxName, listSfxOriginals, migrateSfxOriginals, presetSfxName, readSfx, removeSfxOriginal,
    saveAttachedClip, saveSfxClip, sfxFilePath, useOriginalSfx
};

const path = require('path');
const fs = require('fs');

const { SFX_CACHE_DIR, SFX_DIR, SFX_ORIG_DIR, ensureDirs } = require('./config');
const { libForUI, loadLib, saveLib, uniqueName } = require('./library');

const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.aif', '.aiff', '.flac', '.ogg'];

// Edited clips are written by saveAttachedClip as "<stem>-YYYYMMDD-HHMMSS.wav".
function isEditedSfxName(name) {
    return /-\d{8}[-_]\d{6}\.wav$/i.test(String(name || '')) || /\(trim [a-f0-9]+\)\.wav$/i.test(String(name || ''));
}

// The full path of a stored sound name: edited clips are in sounds/current/, originals in sounds/original/.
function sfxFilePath(name) {
    if (!name) return null;
    if (path.isAbsolute(name)) return name;
    const inOrig = path.join(SFX_ORIG_DIR, name);
    const inSfx = path.join(SFX_DIR, name);
    if (isEditedSfxName(name)) return fs.existsSync(inSfx) || !fs.existsSync(inOrig) ? inSfx : inOrig;
    return fs.existsSync(inOrig) || !fs.existsSync(inSfx) ? inOrig : inSfx;
}

// One-time move of originals that older versions kept next to the edited clips.
function migrateSfxOriginals() {
    ensureDirs();
    let files = [];
    try { files = fs.readdirSync(SFX_DIR); } catch (e) { return; }
    for (const f of files) {
        if (!AUDIO_EXTS.includes(path.extname(f).toLowerCase()) || isEditedSfxName(f)) continue;
        const src = path.join(SFX_DIR, f);
        const dst = path.join(SFX_ORIG_DIR, f);
        try {
            if (!fs.statSync(src).isFile()) continue;
            if (fs.existsSync(dst)) {
                if (fs.statSync(dst).size === fs.statSync(src).size) fs.rmSync(src, { force: true });
                continue;      // a different file with the same name is already an original: leave this one where it is
            }
            fs.renameSync(src, dst);
        } catch (e) { /* ignore */ }
    }
}

function formatAudioDateTime(d = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function cleanAudioStem(name) {
    const base = path.basename(String(name || 'audio'));
    const ext = path.extname(base);
    let stem = base.slice(0, base.length - ext.length);
    stem = stem.replace(/-\d{8}[-_]\d{6}$/, '');
    stem = stem.replace(/(\s+\d+)+$/, '');
    return stem.replace(/[^\w.\- ]+/g, '_').trim().slice(0, 50) || 'audio';
}

function listSfxOriginals() {
    ensureDirs();
    const files = fs.readdirSync(SFX_ORIG_DIR);
    const out = [];
    for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if (!AUDIO_EXTS.includes(ext)) continue;
        const full = path.join(SFX_ORIG_DIR, f);
        try {
            const stat = fs.statSync(full);
            out.push({
                file: f,
                name: path.basename(f, ext),
                ext: ext.slice(1).toUpperCase(),
                size: stat.size,
                path: full,
                mtime: stat.mtimeMs
            });
        } catch (e) { /* ignore */ }
    }
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    return out;
}

function addSfxOriginal(event, p) {
    if (!p) return { error: 'Pick an audio file first' };
    try {
        const file = copySfx(p);
        return { ok: true, file, lib: libForUI() };
    } catch (e) {
        return { error: e.message };
    }
}

function removeSfxOriginal(event, name) {
    if (!name) return { error: 'No file specified' };
    const p = path.join(SFX_ORIG_DIR, path.basename(name));
    if (fs.existsSync(p)) {
        try { fs.rmSync(p, { force: true }); } catch (e) { return { error: e.message }; }
    }
    const lib = loadLib();
    let changed = false;
    for (const a of lib.animations) {
        if (a.sfxOrig === name) {
            a.sfxOrig = null;
            changed = true;
        }
        if (a.sfx === name) {
            a.sfx = null;
            changed = true;
        }
    }
    if (lib.defaultSfx === name) {
        lib.defaultSfx = null;
        changed = true;
    }
    if (changed) saveLib(lib);
    return { ok: true, lib: libForUI() };
}

// (Older approach, no longer called by the panel: see useOriginalSfx.)
// Stores the trimmed/adjusted audio attached to a preset (.setting) inside sounds/current/.
// Based on the preserved original audio in sounds/original/; replaces the previous edited clip on every alignment change.
function saveAttachedClip(event, animId, bytes, origName) {
    ensureDirs();
    const lib = loadLib();
    const a = animId ? lib.animations.find(x => x.id === animId) : null;
    let orig = (a && a.sfxOrig) ? a.sfxOrig : (origName || (a && a.sfx) || null);
    if (orig) orig = path.basename(orig);

    const stem = cleanAudioStem(orig || (a && a.name) || 'audio');
    const newFileName = `${stem}-${formatAudioDateTime()}.wav`;
    const newPath = path.join(SFX_DIR, newFileName);
    const buf = Buffer.from(bytes);
    fs.writeFileSync(newPath, buf);

    if (a) {
        // If the preset has an existing attached audio that is not the original, delete it to prevent bloat
        const oldSfx = a.sfx;
        if (oldSfx && oldSfx !== newFileName && oldSfx !== a.sfxOrig && (!orig || oldSfx !== orig) && isEditedSfxName(oldSfx)) {
            const oldPath = path.join(SFX_DIR, oldSfx);
            const otherUses = lib.animations.some(o => o.id !== a.id && (o.sfx === oldSfx || o.sfxOrig === oldSfx));
            if (!otherUses && fs.existsSync(oldPath)) {
                try { fs.rmSync(oldPath, { force: true }); } catch (e) { /* ignore */ }
            }
        }
        if (!a.sfxOrig && orig) {
            a.sfxOrig = orig;
        }
        a.sfx = newFileName;
        saveLib(lib);
        return { ok: true, sfx: a.sfx, sfxPath: newPath, sfxOrig: a.sfxOrig, sfxOrigPath: sfxFilePath(a.sfxOrig), path: newPath, lib: libForUI() };
    }
    return { ok: true, path: newPath, file: newFileName };
}

// The sound file a preset is placed with. A preset still pointing at an edited clip from an older version (a rendered
// WAV with a timestamp in its name) is placed from its ORIGINAL file when that still exists, so the preset's cut
// settings (Follow the clip / Fixed length, trim, fade) apply: the cutter leaves edited clips whole, which put the
// full sound on the timeline no matter how short the subtitle was.
function presetSfxName(anim) {
    if (!anim) return null;
    const cur = anim.sfx || null;
    if (cur && isEditedSfxName(cur) && anim.sfxOrig) {
        const p = sfxFilePath(anim.sfxOrig);
        if (p && fs.existsSync(p)) return anim.sfxOrig;
    }
    return cur;
}

// A preset's sound is now its ORIGINAL file plus the cut settings (sfxTrimIn / sfxLen / sfxFade / sfxVolume): nothing is
// rendered, and Resolve cuts the original when it is placed. A preset still pointing at an edited clip from an older
// version is switched back to its original here, and that clip is deleted when no other preset uses it.
function useOriginalSfx(event, animId) {
    const lib = loadLib();
    const a = animId ? lib.animations.find(x => x.id === animId) : null;
    if (!a) return { error: 'Preset not found' };
    let changed = false;
    if (!a.sfxOrig && a.sfx && !isEditedSfxName(a.sfx)) { a.sfxOrig = a.sfx; changed = true; }
    const origPath = a.sfxOrig ? sfxFilePath(a.sfxOrig) : null;
    if (origPath && fs.existsSync(origPath) && a.sfx !== a.sfxOrig) {
        const old = a.sfx;
        a.sfx = a.sfxOrig;
        changed = true;
        if (old && isEditedSfxName(old) && !lib.animations.some(o => o.id !== a.id && (o.sfx === old || o.sfxOrig === old))) {
            try { fs.rmSync(path.join(SFX_DIR, path.basename(old)), { force: true }); } catch (e) { /* ignore */ }
        }
    }
    if (changed) saveLib(lib);
    return {
        ok: true, changed, sfx: a.sfx, sfxPath: sfxFilePath(a.sfx), sfxOrig: a.sfxOrig, sfxOrigPath: sfxFilePath(a.sfxOrig),
        lib: changed ? libForUI() : undefined
    };
}

// A trimmed copy of a sound effect (made in the panel, with its fade-out already applied) is stored here; the
// name carries a hash of its content, so the same trim is only imported into Resolve once.
function saveSfxClip(event, name, bytes) {
    const dir = SFX_CACHE_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(bytes);
    const h = require('crypto').createHash('sha1').update(buf).digest('hex').slice(0, 8);
    const base = String(name || 'sound').replace(/\.[^.]+$/, '').replace(/[^\w.\- ]+/g, '_').slice(0, 60);
    const file = path.join(dir, base + ' (trim ' + h + ').wav');
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
    else { try { const now = new Date(); fs.utimesSync(file, now, now); } catch (e) { /* ignore */ } } // reused: keep it fresh
    pruneSfxCache();
    return { path: file };
}

// The trim cache only feeds the live Preview in Resolve, which is taken off the timeline again when it ends (sounds
// that are applied are kept in sounds/current/ via saveAttachedClip). So it is cleared freely: clips not used for
// SFX_CACHE_MAX_AGE_DAYS go, and only the newest SFX_CACHE_MAX_FILES are kept. Reuse refreshes a clip's mtime.
const SFX_CACHE_MAX_AGE_DAYS = 1;
const SFX_CACHE_MAX_FILES = 80;
function pruneSfxCache() {
    const dir = SFX_CACHE_DIR;
    let removed = 0;
    try {
        if (!fs.existsSync(dir)) return 0;
        const cutoff = Date.now() - SFX_CACHE_MAX_AGE_DAYS * 86400000;
        const all = fs.readdirSync(dir)
            .map(n => { try { const s = fs.statSync(path.join(dir, n)); return s.isFile() ? { n, t: s.mtimeMs } : null; } catch (e) { return null; } })
            .filter(Boolean)
            .sort((x, y) => y.t - x.t);
        all.forEach((o, i) => {
            if (i >= SFX_CACHE_MAX_FILES || o.t < cutoff) {
                try { fs.rmSync(path.join(dir, o.n), { force: true }); removed++; } catch (e) { /* ignore */ }
            }
        });
    } catch (e) { /* ignore */ }
    return removed;
}

// Copies a dropped / picked sound into the originals library (sounds/original/) and returns its stored name.
// A sound already in sounds/original/ or sounds/current/ is used where it is.
function copySfx(p) {
    if (!p) return null;
    const ext = path.extname(p).toLowerCase();
    if (!AUDIO_EXTS.includes(ext)) throw new Error('Drop an audio file (wav, mp3, aif, m4a, flac)');
    ensureDirs();
    const resolved = path.resolve(String(p));
    if (resolved.startsWith(SFX_ORIG_DIR + path.sep)) return path.relative(SFX_ORIG_DIR, resolved);
    if (resolved.startsWith(SFX_DIR + path.sep)) return path.relative(SFX_DIR, resolved);
    const base = path.basename(p);
    const existing = path.join(SFX_ORIG_DIR, base);
    if (fs.existsSync(existing)) {
        try {
            if (fs.statSync(resolved).size === fs.statSync(existing).size) return base;
        } catch (e) { /* ignore */ }
    }
    // Reuse an original with identical content
    try {
        const crypto = require('crypto');
        const buf = fs.readFileSync(resolved);
        const h = crypto.createHash('sha1').update(buf).digest('hex');
        for (const f of fs.readdirSync(SFX_ORIG_DIR)) {
            const fp = path.join(SFX_ORIG_DIR, f);
            const st = fs.statSync(fp);
            if (st.isFile() && st.size === buf.length && crypto.createHash('sha1').update(fs.readFileSync(fp)).digest('hex') === h) return f;
        }
    } catch (e) { /* ignore */ }
    const file = uniqueName(SFX_ORIG_DIR, path.basename(p));
    fs.copyFileSync(p, path.join(SFX_ORIG_DIR, file));
    return file;
}

// The panel draws the waveform itself; it gets bytes of library or dropped sound files.
function readSfx(event, p) {
    const full = path.resolve(String(p));
    if (!fs.existsSync(full)) throw new Error('Sound file not found: ' + full);
    return fs.readFileSync(full);
}
