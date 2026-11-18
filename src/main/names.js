// The plugin's names on disk and in Resolve.
//
// The plugin was called "El Subtitle Animator" before it became "Framelly". Anything made from now on gets the
// current name. A folder, bin or template an earlier version already made keeps working: it is used as it is (a
// project's files stay online, the speech engine is not downloaded again) or, for the plugin's own template folders,
// renamed once.
//
// Node only and no other project module: config.js and mcp/framelly-mcp.js both load this. installer/shared/env.js
// mirrors the names.

const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_NAME = 'Framelly';
const OLD_APP_NAME = 'El Subtitle Animator';
// The Media Pool bin for sounds and the category of the title and effect templates. Earlier: "Subtitle Animator".
const CATEGORY = APP_NAME;
const OLD_CATEGORY = 'Subtitle Animator';
// The code folder beside the data folder (the data folder itself is named APP_NAME).
const CODE_FOLDER_NAME = APP_NAME + ' Plugin';
const OLD_CODE_FOLDER_NAME = OLD_APP_NAME + ' Plugin';

function exists(p) { try { return fs.existsSync(p); } catch (e) { return false; } }

// `dir`, unless only the folder an earlier version made is there.
function existingOr(dir, oldDir) { return !exists(dir) && exists(oldDir) ? oldDir : dir; }

// "Framelly SFX" -> "El Subtitle Animator SFX": what an earlier version called the same folder or bin.
function oldName(name) {
    const s = String(name);
    if (s === APP_NAME) return OLD_APP_NAME;
    return s.startsWith(APP_NAME + ' ') ? OLD_APP_NAME + s.slice(APP_NAME.length) : s;
}
// Is `name` this folder or bin, under its current or its earlier name?
function sameName(name, want) { return name === want || name === oldName(want); }
// The plugin's output folder `name` inside `base`: the earlier one when the project already has it.
function outDirIn(base, name) { return existingOr(path.join(base, name), path.join(base, oldName(name))); }
// A folder the plugin made for its own files ("Framelly SFX", "El Subtitle Animator B-roll", ...).
function isOwnName(part) { return String(part).startsWith(APP_NAME + ' ') || String(part).startsWith(OLD_APP_NAME + ' '); }

// Renames a folder only the plugin writes to (its templates in Resolve's support folder) to its current name, so
// Resolve lists one category. Left alone when the new one is already there.
function adoptOldDir(dir, oldDir) {
    try { if (!exists(dir) && exists(oldDir)) fs.renameSync(oldDir, dir); } catch (e) { /* the old one stays; the new one is made beside it */ }
    return dir;
}

// ~/.framelly: the speech engine, word timings and the MCP endpoint file.
const HOME_DIR = existingOr(path.join(os.homedir(), '.framelly'), path.join(os.homedir(), '.el-subtitle-animator'));

module.exports = {
    APP_NAME, OLD_APP_NAME, CATEGORY, OLD_CATEGORY, CODE_FOLDER_NAME, OLD_CODE_FOLDER_NAME, HOME_DIR,
    existingOr, oldName, sameName, outDirIn, isOwnName, adoptOldDir,
};
