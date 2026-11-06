// Sound-effect files: the originals library, saving trimmed / attached clips, and reading audio for the panel.

module.exports = {
    addSfxOriginal, copySfx, listSfxOriginals, readSfx, removeSfxOriginal, saveAttachedClip, saveSfxClip
};

const path = require('path');
const fs = require('fs');

const { DATA_DIR, SFX_DIR, ensureDirs } = require('./config');
const { libForUI, loadLib, saveLib, uniqueName } = require('./library');

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
    const files = fs.readdirSync(SFX_DIR);
    const out = [];
    for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if (!['.mp3', '.wav', '.m4a', '.aif', '.aiff', '.flac', '.ogg'].includes(ext)) continue;
        if (/-\d{8}[-_]\d{6}\.wav$/i.test(f) || /\(trim [a-f0-9]+\)\.wav$/i.test(f)) continue;
        const full = path.join(SFX_DIR, f);
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
    const p = path.join(SFX_DIR, name);
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

// Stores the trimmed/adjusted audio attached to a preset (.setting) inside sfx/.
// Based on the preserved original audio; overwrites previous attached trimmed audio on every alignment manipulation.
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
        if (oldSfx && oldSfx !== newFileName && oldSfx !== a.sfxOrig && (!orig || oldSfx !== orig)) {
            const oldPath = path.join(SFX_DIR, oldSfx);
            if (fs.existsSync(oldPath)) {
                try { fs.rmSync(oldPath, { force: true }); } catch (e) { /* ignore */ }
            }
        }
        if (!a.sfxOrig && orig) {
            a.sfxOrig = orig;
        }
        a.sfx = newFileName;
        saveLib(lib);
        return { ok: true, sfx: a.sfx, sfxPath: newPath, sfxOrig: a.sfxOrig, sfxOrigPath: a.sfxOrig ? path.join(SFX_DIR, a.sfxOrig) : null, path: newPath, lib: libForUI() };
    }
    return { ok: true, path: newPath, file: newFileName };
}

// A trimmed copy of a sound effect (made in the panel, with its fade-out already applied) is stored here; the
// name carries a hash of its content, so the same trim is only imported into Resolve once.
function saveSfxClip(event, name, bytes) {
    const dir = path.join(DATA_DIR, 'sfx-cache');
    fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(bytes);
    const h = require('crypto').createHash('sha1').update(buf).digest('hex').slice(0, 8);
    const base = String(name || 'sound').replace(/\.[^.]+$/, '').replace(/[^\w.\- ]+/g, '_').slice(0, 60);
    const file = path.join(dir, base + ' (trim ' + h + ').wav');
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
    try {
        const all = fs.readdirSync(dir).map(n => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((x, y) => y.t - x.t);
        for (const o of all.slice(80)) fs.rmSync(path.join(dir, o.n), { force: true });
    } catch (e) { /* ignore */ }
    return { path: file };
}

function copySfx(p) {
    if (!p) return null;
    const ext = path.extname(p).toLowerCase();
    if (!['.wav', '.mp3', '.aif', '.aiff', '.m4a', '.flac', '.ogg'].includes(ext)) throw new Error('Drop an audio file (wav, mp3, aif, m4a, flac)');
    ensureDirs();
    const resolved = path.resolve(String(p));
    // If file is already inside sfx dir, do not copy again
    if (resolved.startsWith(SFX_DIR + path.sep)) {
        return path.relative(SFX_DIR, resolved);
    }
    const base = path.basename(p);
    const existing = path.join(SFX_DIR, base);
    if (fs.existsSync(existing)) {
        try {
            const statSrc = fs.statSync(resolved);
            const statDst = fs.statSync(existing);
            if (statSrc.size === statDst.size) {
                return base;
            }
        } catch (e) { /* ignore */ }
    }
    // Check if an existing file has identical content
    try {
        const buf = fs.readFileSync(resolved);
        const h = require('crypto').createHash('sha1').update(buf).digest('hex');
        for (const f of fs.readdirSync(SFX_DIR)) {
            const fp = path.join(SFX_DIR, f);
            if (fs.statSync(fp).isFile()) {
                const fbuf = fs.readFileSync(fp);
                if (fbuf.length === buf.length && require('crypto').createHash('sha1').update(fbuf).digest('hex') === h) {
                    return f;
                }
            }
        }
    } catch (e) { /* ignore */ }
    const file = uniqueName(SFX_DIR, path.basename(p));
    fs.copyFileSync(p, path.join(SFX_DIR, file));
    return file;
}

// The panel draws the waveform itself; it gets bytes of library or dropped sound files.
function readSfx(event, p) {
    const full = path.resolve(String(p));
    if (!fs.existsSync(full)) throw new Error('Sound file not found: ' + full);
    return fs.readFileSync(full);
}
