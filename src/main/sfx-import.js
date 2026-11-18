// Sound files in the Media Pool: importing a sound once per project, and keeping the project's own copy of it next to
// the footage.

module.exports = { importSfx, relinkToProjectCopy, timelineSfxDir, projectRootDir, projectOutDir, isOwnDir };

const path = require('path');
const fs = require('fs');

const { APP_DATA_DIR, DATA_DIR, RESOLVE_BATCH } = require('./config');
const { CATEGORY, OLD_CATEGORY, isOwnName, outDirIn, sameName } = require('./names');
const { dlog } = require('./log');
const PERF = require('./perf');

// ------------------------------------------------------------------ sounds copied next to the footage
// When a subtitle is APPLIED (not while previewing), its sounds are copied into
// "<footage folder>/Framelly SFX/" and imported from there, so the project keeps its own copy beside its
// media (it stays online when moved or archived with the footage, and does not depend on the plugin's library).
// The footage folder is chosen once per timeline - the folder most of the timeline's own clips come from (titles,
// generators and the plugin's sounds skipped) - and saved in _app/timeline-sfx-dirs.json, so every later apply on that
// timeline reuses the same location. With no footage on the timeline yet, or when the folder cannot be written, the
// sound is imported from the library as before (and nothing is saved, so the next apply tries again).
const PROJECT_SFX_DIR = 'Framelly SFX';
const TL_SFX_DIRS_FILE = path.join(APP_DATA_DIR, 'timeline-sfx-dirs.json');
function readTlSfxDirs() { try { return JSON.parse(fs.readFileSync(TL_SFX_DIRS_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
// The plugin's own output folders ("Framelly SFX / B-roll / MatchCut / Spotlight / Collage" and anything
// under them, or under the app's data folder) are never taken for the footage folder. That includes the ones an
// earlier version named "El Subtitle Animator ..." (names.js).
function isOwnDir(dir) {
    if (dir === DATA_DIR || dir.startsWith(DATA_DIR + path.sep)) return true;
    return String(dir).split(path.sep).some(isOwnName);
}
const isOwnSound = isOwnDir;
async function scanFootageDir(tl) {
    const counts = new Map(), seen = new Set();
    for (const kind of ['video', 'audio']) {
        const n = (await tl.GetTrackCount(kind)) || 0;
        for (let t = 1; t <= n; t++) {
            for (const it of ((await tl.GetItemListInTrack(kind, t)) || [])) {
                let p = '';
                try { const m = await it.GetMediaPoolItem(); p = m ? String(await m.GetClipProperty('File Path') || '') : ''; } catch (e) { /* title / generator */ }
                if (!p || seen.has(p)) continue;
                seen.add(p);
                const dir = path.dirname(p);
                if (!isOwnSound(dir)) counts.set(dir, (counts.get(dir) || 0) + 1);
            }
        }
    }
    let dir = null, best = 0;
    for (const [d, c] of counts) if (c > best) { dir = d; best = c; }
    return dir;
}
// A Resolve project's main folder (_app/project-roots.json: { "<project name>": "<folder>" }, name matched without case).
// When one is set, everything the plugin renders or copies for that project goes there instead of the footage folder:
// sound copies, Collage projects (<root>/<timeline>/), MatchCut runs, Spotlight cut-outs. A set root whose drive is
// not mounted gives { missing } so callers can stop instead of quietly writing somewhere else.
const PROJECT_ROOTS_FILE = path.join(APP_DATA_DIR, 'project-roots.json');
function projectRootOf(name) {
    let roots = {};
    try { roots = JSON.parse(fs.readFileSync(PROJECT_ROOTS_FILE, 'utf8')) || {}; } catch (e) { return null; }
    const key = Object.keys(roots).find((k) => k.toLowerCase() === String(name).toLowerCase());
    return key && roots[key] ? String(roots[key]) : null;
}
async function projectRootDir(project) {
    if (!project) return null;
    const root = projectRootOf(await project.GetName());
    if (!root) return null;
    return fs.existsSync(root) ? { dir: root } : { missing: root };
}
// The project's main folder when set; else the timeline's saved footage folder, or (first apply) the scanned one,
// saved for next time.
async function timelineSfxDir(project) {
    const root = await projectRootDir(project);
    if (root) return root.dir || null;
    const tl = await project.GetCurrentTimeline();
    if (!tl) return null;
    const key = String(await project.GetName()) + '::' + String(await tl.GetUniqueId());
    const saved = readTlSfxDirs();
    if (saved[key] && fs.existsSync(saved[key])) return saved[key];
    const dir = await scanFootageDir(tl);
    if (!dir || !fs.existsSync(dir)) return null;
    saved[key] = dir;
    try { fs.mkdirSync(APP_DATA_DIR, { recursive: true }); fs.writeFileSync(TL_SFX_DIRS_FILE, JSON.stringify(saved, null, 2)); } catch (e) { /* reused this session only */ }
    dlog('TIMELINE-SFX-DIR', key, dir);
    return dir;
}
// No footage on the timeline yet: the folder most of the Media Pool's clips come from (bins walked breadth first, at
// most 400 clips read, the plugin's own folders skipped).
async function mediaPoolFootageDir(project) {
    try {
        const mp = await project.GetMediaPool();
        const queue = [await mp.GetRootFolder()];
        const counts = new Map();
        let read = 0;
        while (queue.length && read < 400) {
            const f = queue.shift();
            if (!f) continue;
            for (const c of ((await f.GetClipList()) || [])) {
                if (++read > 400) break;
                let p = '';
                try { p = String(await c.GetClipProperty('File Path') || ''); } catch (e) { /* timeline / compound clip */ }
                if (!p) continue;
                const dir = path.dirname(p);
                if (!isOwnDir(dir)) counts.set(dir, (counts.get(dir) || 0) + 1);
            }
            for (const sub of ((await f.GetSubFolderList()) || [])) queue.push(sub);
        }
        let dir = null, best = 0;
        for (const [d, c] of counts) if (c > best && fs.existsSync(d)) { dir = d; best = c; }
        return dir;
    } catch (e) { return null; }
}
// Where the plugin's renders for this project go (B-roll, MatchCut, Spotlight, Collage; app and MCP alike), always
// beside the project's own files:
//   1. "<project main folder>/<sub>" (_app/project-roots.json). Its drive not mounted = an error, never a quiet
//      fallback to somewhere else.
//   2. "<footage folder>/<sub>": the timeline's footage folder (timelineSfxDir), or with no footage on the timeline
//      yet, the Media Pool's.
//   3. Only a project with no media files at all (or a footage folder that cannot be written) uses the app's data
//      folder; { fallback: true } then says so, so the caller can warn.
// A project that already has the folder under the plugin's earlier name keeps using that one (names.outDirIn).
async function projectOutDir(project, sub) {
    const root = await projectRootDir(project);
    if (root && root.missing) throw new Error('The project folder ' + root.missing + ' is not there. Is its drive connected?');
    if (root) {
        const dir = outDirIn(root.dir, sub);
        fs.mkdirSync(dir, { recursive: true });
        return { dir, fallback: false };
    }
    const footage = (project && (await timelineSfxDir(project))) || (project && (await mediaPoolFootageDir(project)));
    if (footage) {
        const dir = outDirIn(footage, sub);
        try { fs.mkdirSync(dir, { recursive: true }); return { dir, fallback: false }; } catch (e) { dlog('PROJECT-OUT-DIR-FAIL', dir, String(e && e.message || e)); }
    }
    const dir = outDirIn(DATA_DIR, sub);
    fs.mkdirSync(dir, { recursive: true });
    dlog('PROJECT-OUT-DIR-FALLBACK', sub, dir);
    return { dir, fallback: true };
}
// Two files with the same size are compared by content once; the answer is kept by both files' size + mtime.
const sameFileCache = new Map();
function sameFile(a, b) {
    try {
        const sa = fs.statSync(a), sb = fs.statSync(b);
        if (sa.size !== sb.size) return false;
        const key = a + '|' + sa.mtimeMs + '|' + b + '|' + sb.mtimeMs + '|' + sa.size;
        if (sameFileCache.has(key)) return sameFileCache.get(key);
        const same = fs.readFileSync(a).equals(fs.readFileSync(b));
        sameFileCache.set(key, same);
        if (sameFileCache.size > 500) sameFileCache.delete(sameFileCache.keys().next().value);
        return same;
    } catch (e) { return false; }
}
// The path to import: the timeline's copy of sfxPath (made when missing), or sfxPath itself when no copy can be made.
// Remembered per (footage folder, sound file version), so a sound placed again costs one stat.
const sfxCopyCache = new Map();
async function projectSfxCopy(project, sfxPath) {
    try {
        if (sameName(path.basename(path.dirname(sfxPath)), PROJECT_SFX_DIR)) return sfxPath;      // already a timeline copy
        const dir = await timelineSfxDir(project);
        if (!dir) return sfxPath;
        let st = null;
        try { st = fs.statSync(sfxPath); } catch (e) { st = null; }
        const ck = st ? dir + '|' + sfxPath + '|' + st.size + '|' + st.mtimeMs : null;
        if (ck && sfxCopyCache.has(ck) && fs.existsSync(sfxCopyCache.get(ck))) return sfxCopyCache.get(ck);
        const outDir = outDirIn(dir, PROJECT_SFX_DIR);
        fs.mkdirSync(outDir, { recursive: true });
        let dst = path.join(outDir, path.basename(sfxPath));
        if (fs.existsSync(dst) && !sameFile(sfxPath, dst)) {
            // another sound under the same name (e.g. a re-edited cut): keep both, tag this one by its content
            const tag = require('crypto').createHash('sha1').update(fs.readFileSync(sfxPath)).digest('hex').slice(0, 8);
            const ext = path.extname(sfxPath);
            dst = path.join(outDir, path.basename(sfxPath, ext) + ' ' + tag + ext);
        }
        if (!fs.existsSync(dst)) fs.copyFileSync(sfxPath, dst);
        if (ck) { sfxCopyCache.set(ck, dst); if (sfxCopyCache.size > 500) sfxCopyCache.delete(sfxCopyCache.keys().next().value); }
        return dst;
    } catch (e) {
        dlog('PROJECT-SFX-COPY-FAIL', String(e && e.message || e));
        return sfxPath;
    }
}
// A kept preview's sound was placed from the library: its Media Pool clip is pointed at the timeline's copy instead.
async function relinkToProjectCopy(project, sfxItem) {
    try {
        const mpi = await sfxItem.GetMediaPoolItem();
        const cur = mpi ? String(await mpi.GetClipProperty('File Path') || '') : '';
        if (!cur || !fs.existsSync(cur) || sameName(path.basename(path.dirname(cur)), PROJECT_SFX_DIR)) return;
        const copy = await projectSfxCopy(project, cur);
        if (copy !== cur) await mpi.ReplaceClip(copy);
    } catch (e) { dlog('PROJECT-SFX-RELINK-FAIL', String(e && e.message || e)); }
}

// projectCopy: true when the subtitle is being applied (see projectSfxCopy); previews import from the library.
// The "Framelly" bin's clips by file path (the bin an earlier version named "Subtitle Animator" is reused), read once per project and kept while the bin's clip count is
// unchanged (one GetClipList per import instead of a name + path read of every clip, in a bin that only grows).
// Within one placement the bin is listed once (SFX_BIN_FRESH_MS): a Kinetic preset imports three or four sounds in a row.
const SFX_BIN_FRESH_MS = 5000;
const sfxBin = { key: '', folder: null, count: -1, byPath: new Map(), listedAt: 0, verified: new Map() };
async function importSfx(project, sfxPath, projectCopy) {
    const sp = PERF.span('place.importSfx');
    try { return await importSfxInner(project, sfxPath, projectCopy); }
    finally { sp.end(); }
}
async function importSfxInner(project, sfxPath, projectCopy) {
    if (projectCopy) sfxPath = await projectSfxCopy(project, sfxPath);
    const mp = await project.GetMediaPool();
    let target = null;
    let pkey = '';
    try { pkey = String(await project.GetName()); } catch (e) { pkey = ''; }
    try {
        if (sfxBin.key === pkey && sfxBin.folder) {
            target = sfxBin.folder;
            try { await target.GetName(); } catch (e) { target = null; }      // a stale handle (project reopened)
        }
        if (!target) {
            const root = await mp.GetRootFolder();
            const subs = (await root.GetSubFolderList()) || [];
            const names = await Promise.all(subs.map(f => Promise.resolve(f.GetName()).catch(() => '')));
            target = subs[names.indexOf(CATEGORY)] || subs[names.indexOf(OLD_CATEGORY)] || null;
            if (!target) target = await mp.AddSubFolder(root, CATEGORY);
            sfxBin.key = pkey; sfxBin.folder = target; sfxBin.count = -1; sfxBin.byPath = new Map(); sfxBin.listedAt = 0; sfxBin.verified = new Map();
        }
    } catch (e) { /* ignore */ }
    const wantPath = path.resolve(sfxPath);
    // A clip is reused only when it is THIS file: matching the name alone picked up stale clips imported from an older
    // data folder (e.g. ~/Documents/Subtitle Animator/sfx/applepay.mp3), which are offline once that folder is gone.
    const refresh = async () => {
        if (sfxBin.byPath.size && sfxBin.count >= 0 && Date.now() - sfxBin.listedAt < SFX_BIN_FRESH_MS) return;
        const clips = (await target.GetClipList()) || [];
        const arr = Array.isArray(clips) ? clips : Object.values(clips);
        sfxBin.listedAt = Date.now();
        if (arr.length === sfxBin.count && sfxBin.byPath.size) return;
        sfxBin.verified = new Map();
        const byPath = new Map();
        for (let i = 0; i < arr.length; i += RESOLVE_BATCH) {
            const part = arr.slice(i, i + RESOLVE_BATCH);
            const paths = await Promise.all(part.map(c => Promise.resolve(c.GetClipProperty('File Path')).then(p => path.resolve(String(p || ''))).catch(() => '')));
            for (let k = 0; k < part.length; k++) if (paths[k] && !byPath.has(paths[k])) byPath.set(paths[k], part[k]);
        }
        sfxBin.count = arr.length; sfxBin.byPath = byPath;
    };
    const stillSame = async (c) => {
        if (Date.now() - (sfxBin.verified.get(wantPath) || 0) < SFX_BIN_FRESH_MS) return true;
        try {
            const same = path.resolve(String(await c.GetClipProperty('File Path') || '')) === wantPath;
            if (same) sfxBin.verified.set(wantPath, Date.now());
            return same;
        } catch (e) { return false; }
    };
    const findSame = async () => {
        if (!target) return null;
        try { await refresh(); } catch (e) { return null; }
        const hit = sfxBin.byPath.get(wantPath) || null;
        if (!hit) return null;
        if (await stillSame(hit)) return hit;
        // the clip was replaced by hand (same count, another clip): read the bin again
        sfxBin.count = -1; sfxBin.listedAt = 0;
        try { await refresh(); } catch (e) { return null; }
        const again = sfxBin.byPath.get(wantPath) || null;
        return (again && await stillSame(again)) ? again : null;
    };
    const hit = await findSame();
    if (hit) return { mp, item: hit };
    // the import lands in the current folder: switched to the bin and back only when it is not the bin already
    // (two calls of about 30 ms each; a preset with several sounds imports them in a row)
    const keep = await mp.GetCurrentFolder();
    let switched = false;
    if (target && !(await sameFolder(keep, target))) { try { switched = !!(await mp.SetCurrentFolder(target)); } catch (e) { switched = false; } }
    let items = await mp.ImportMedia([sfxPath]);
    if (items && items.length && sfxBin.count >= 0 && sfxBin.byPath.size) {
        // the new clip is known: it joins the map (one more in the bin) instead of a re-listing on the next sound
        sfxBin.byPath.set(wantPath, items[0]); sfxBin.count += 1; sfxBin.verified.set(wantPath, Date.now());
    } else { sfxBin.count = -1; sfxBin.listedAt = 0; }      // the bin changed: read again next time
    if ((!items || !items.length) && target) {
        sfxBin.count = -1; sfxBin.listedAt = 0;
        const again = await findSame();
        if (again) items = [again];
    }
    if (switched) { try { if (keep) await mp.SetCurrentFolder(keep); } catch (e) { /* ignore */ } }
    return { mp, item: items && items[0] };
}

// Are these two Media Pool folders the same one? By unique id where the API has it, else by name (false when in doubt).
async function sameFolder(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    try {
        if (typeof a.GetUniqueId === 'function' && typeof b.GetUniqueId === 'function') {
            const [ia, ib] = await Promise.all([a.GetUniqueId(), b.GetUniqueId()]);
            if (ia && ib) return String(ia) === String(ib);
        }
        const [na, nb] = await Promise.all([a.GetName(), b.GetName()]);
        return !!na && String(na) === String(nb);
    } catch (e) { return false; }
}
