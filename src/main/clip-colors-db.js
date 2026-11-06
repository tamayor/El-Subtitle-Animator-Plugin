// Subtitle clip colours from the saved project database.
// Resolve's scripting API returns "" from GetClipColor() for subtitle items (it works for video items), but the colour
// IS saved: each timeline item can own a BtLockableBlob row whose last byte is the clip colour code. This reads a
// disk-database project's Project.db (read-only, with macOS's /usr/bin/sqlite3) and returns
// Map("<subtitle track>:<start frame>" -> colour name). It only sees what Resolve last SAVED.
// Item -> track: Sm2TiItem_Sm2TiTrack. Track -> timeline: Sm2SequenceContainer_Sm2TiTrack -> Sm2SequenceContainer
// -> Sm2Sequence -> Sm2Timeline. Codes were confirmed against GetClipColor() on video items.

module.exports = { subtitleColorsFromDb };

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { dlog } = require('./log');

// All 16 of Resolve's clip colours, read back from a calibration timeline coloured in menu order (Orange, Apricot,
// Yellow, Lime, Olive, Green, Teal, Navy, Blue, Purple, Violet, Pink, Tan, Beige, Brown, Chocolate) and cross-checked
// against GetClipColor() on video clips. A code outside this table is reported as "Unknown 0x..", never guessed.
const COLOR_CODES = {
    0x02: 'Green', 0x04: 'Teal', 0x06: 'Blue', 0x08: 'Purple', 0x0A: 'Pink', 0x0C: 'Tan', 0x0E: 'Brown',
    0x10: 'Apricot', 0x12: 'Beige', 0x14: 'Chocolate', 0x16: 'Lime', 0x18: 'Navy', 0x1A: 'Olive',
    0x1C: 'Orange', 0x1E: 'Violet', 0x20: 'Yellow'
};
const SQLITE = '/usr/bin/sqlite3';
const ROOT = path.join(os.homedir(), 'Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve',
    'Resolve Project Library', 'Resolve Projects', 'Users');

const cache = { key: '', mtime: 0, map: null };

// Newest Project.db in a folder named after the project (projects can sit in sub-folders of Projects/).
function findProjectDb(projectName) {
    let best = null;
    const walk = (dir, depth) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const sub = path.join(dir, e.name);
            if (e.name === projectName) {
                const db = path.join(sub, 'Project.db');
                try {
                    const m = fs.statSync(db).mtimeMs;
                    if (!best || m > best.mtime) best = { file: db, mtime: m };
                } catch (err) { /* not a project folder */ }
            }
            if (depth < 6) walk(sub, depth + 1);
        }
    };
    walk(ROOT, 0);
    return best;
}

function sqlite(file, sql) {
    return new Promise((resolve, reject) => {
        execFile(SQLITE, ['-readonly', '-separator', '|', file, sql], { timeout: 15000, maxBuffer: 16 * 1024 * 1024 },
            (err, out) => err ? reject(err) : resolve(String(out || '')));
    });
}

// Map "<track>:<start>" -> colour name ('' never stored), or null when the database can't be read.
async function subtitleColorsFromDb(projectName, timelineName) {
    if (process.platform !== 'darwin' || !projectName || !timelineName || !fs.existsSync(SQLITE)) return null;
    const db = findProjectDb(projectName);
    if (!db) return null;
    const key = db.file + '\n' + timelineName;
    if (cache.key === key && cache.mtime === db.mtime) return cache.map;
    const q = String(timelineName).replace(/'/g, "''");
    const sql = "select ct.DbIndex + 1, i.Start, substr(hex(b.FieldsBlob), -2) " +
        'from Sm2TiItem i ' +
        'join Sm2TiItem_Sm2TiTrack it on it.DbAssociate = i.Sm2TiItem_id ' +
        'join Sm2SequenceContainer_Sm2TiTrack ct on ct.DbAssociate = it.DbOwner ' +
        'join Sm2SequenceContainer c on c.Sm2SequenceContainer_id = ct.DbOwner ' +
        'join Sm2Sequence s on s.Sm2Sequence_id = c.Sm2Sequence_id ' +
        'join Sm2Timeline t on t.Sm2Timeline_id = s.Sm2Timeline_id ' +
        'join BtLockableBlob b on b.BlobOwner = i.Sm2TiItem_id ' +
        "where ct.DbPropertyName = 'SubtitleTrackVec' and t.Name = '" + q + "';";
    let out;
    try { out = await sqlite(db.file, sql); } catch (e) {
        dlog('clip colours: could not read ' + db.file + ': ' + (e && e.message || e));
        return null;
    }
    const map = new Map();
    for (const line of out.split('\n')) {
        const [track, start, hex] = line.trim().split('|');
        if (!hex) continue;
        const code = parseInt(hex, 16);
        map.set(Number(track) + ':' + Number(start), COLOR_CODES[code] || ('Unknown 0x' + hex.toUpperCase()));
    }
    Object.assign(cache, { key, mtime: db.mtime, map });
    return map;
}
