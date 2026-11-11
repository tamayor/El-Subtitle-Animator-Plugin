// Static configuration: plugin id, on-disk locations of the library and app files, debug switches.
// Constants and path helpers only - this module must not require any other project module.

const path = require('path');
const fs = require('fs');
const os = require('os');

const PLUGIN_ID = 'com.el.subtitleanimator';
const INITIAL_PPID = process.ppid;

// ------------------------------------------------------------------ app files (inside the plugin folder)
const APP_ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(APP_ROOT, 'src');
const PRELOAD_FILE = path.join(SRC_DIR, 'preload.js');
const INDEX_HTML = path.join(SRC_DIR, 'renderer', 'index.html');
const BRIDGE_SCRIPT = path.join(SRC_DIR, 'python', 'fusion_bridge.py');
const PACKAGE_JSON = path.join(APP_ROOT, 'package.json');
const MANIFEST_XML = path.join(APP_ROOT, 'manifest.xml');
const WORKFLOW_INTEGRATION_NODE = path.join(APP_ROOT, 'WorkflowIntegration.node');

// ------------------------------------------------------------------ library on disk
// Both folders live side by side in one main folder, wherever the user keeps it:
//   El Subtitle Animator Plugin Main/
//     El Subtitle Animator Plugin/   the code (this repo, with the installer)
//     El Subtitle Animator/          the user data (presets, sounds, previews, fonts)
// The installed copy runs from Resolve's plugin folder, so the installer records the main folder in
// data-location.json. Running straight from the repo, the data folder is the code folder's sibling.
const DATA_FOLDER_NAME = 'El Subtitle Animator';
const LOCATION_FILE = path.join(APP_ROOT, 'data-location.json');

function readLocation() {
    try {
        const loc = JSON.parse(fs.readFileSync(LOCATION_FILE, 'utf8'));
        if (loc && typeof loc.dataDir === 'string' && loc.dataDir) return loc;
    } catch { /* not installed by the installer: running from the repo */ }
    return { dataDir: path.join(APP_ROOT, '..', DATA_FOLDER_NAME), codeDir: APP_ROOT };
}
const LOCATION = readLocation();

const DATA_DIR = LOCATION.dataDir;
// Layout of the data folder:
//   library.json (+ .bak)
//   presets/current/   the presets in use (edited)           presets/original/  their preserved originals
//   sounds/current/    edited (trimmed / adjusted) sounds    sounds/original/   original sounds (SFX Originals Library)
//   fonts/  previews/
//   _app/              files the app writes for itself (caches, drafts, helper scripts, window and clip state)
const ANIM_DIR = path.join(DATA_DIR, 'presets', 'current');
const ANIM_ORIG_DIR = path.join(DATA_DIR, 'presets', 'original');
const SFX_DIR = path.join(DATA_DIR, 'sounds', 'current');
const SFX_ORIG_DIR = path.join(DATA_DIR, 'sounds', 'original');
const PREV_DIR = path.join(DATA_DIR, 'previews');
const FONTS_DIR = path.join(DATA_DIR, 'fonts');
const LIB_FILE = path.join(DATA_DIR, 'library.json');
const APP_DATA_DIR = path.join(DATA_DIR, '_app');
const SFX_CACHE_DIR = path.join(APP_DATA_DIR, 'sfx-cache');           // trimmed sounds for the live Preview in Resolve
const DRAFT_DIR = path.join(APP_DATA_DIR, 'draft');                   // comps read from the timeline for the Create tab
const CLIP_REG = path.join(APP_DATA_DIR, 'temp-clips.json');          // temporary preview clips still on a timeline
const WIN_STATE_FILE = path.join(APP_DATA_DIR, 'window-state.json');  // the window opens the way it was closed

// Older versions kept everything at the top of the data folder. Moved once, on first use; names inside library.json
// are file names only, so nothing in it changes.
const LEGACY_LAYOUT = [
    ['animations', ANIM_DIR], ['animations_orig', ANIM_ORIG_DIR],
    ['sfx', SFX_DIR], ['sfx_orig', SFX_ORIG_DIR],
    ['sfx-cache', SFX_CACHE_DIR], ['draft', DRAFT_DIR],
    ['temp-clips.json', CLIP_REG], ['window-state.json', WIN_STATE_FILE]
];
function moveInto(src, dst) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (!fs.existsSync(dst)) { fs.renameSync(src, dst); return; }
    if (!fs.statSync(src).isDirectory() || !fs.statSync(dst).isDirectory()) return;      // both exist: keep the new one
    for (const n of fs.readdirSync(src)) {
        if (!fs.existsSync(path.join(dst, n))) fs.renameSync(path.join(src, n), path.join(dst, n));
    }
    try { fs.rmdirSync(src); } catch (e) { /* not empty (name clash): left for the user to look at */ }
}
let layoutMigrated = false;
function migrateLayout() {
    if (layoutMigrated) return;
    layoutMigrated = true;
    for (const [oldName, dst] of LEGACY_LAYOUT) {
        try { moveInto(path.join(DATA_DIR, oldName), dst); } catch (e) { /* ignore */ }
    }
    // helper scripts are rewritten on demand: move them out of sight
    try {
        for (const n of fs.readdirSync(DATA_DIR)) {
            if (n === 'color-helper.js' || /^pick-color-[a-f0-9]+\.scpt$/.test(n)) {
                try { moveInto(path.join(DATA_DIR, n), path.join(APP_DATA_DIR, n)); } catch (e) { /* ignore */ }
            }
        }
    } catch (e) { /* ignore */ }
}

function ensureDirs() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    migrateLayout();
    for (const d of [ANIM_DIR, ANIM_ORIG_DIR, SFX_DIR, SFX_ORIG_DIR, PREV_DIR, FONTS_DIR, APP_DATA_DIR]) fs.mkdirSync(d, { recursive: true });
}

// ------------------------------------------------------------------ DaVinci Resolve and system tools
// Where Resolve and macOS keep the things this plugin starts or writes to. One place, so a different install location
// (or another platform) is one edit.
const RESOLVE_APP = '/Applications/DaVinci Resolve/DaVinci Resolve.app';
const RESOLVE_PYTHON = RESOLVE_APP + '/Contents/Resources/ResolvePython/ResolvePython';      // the Python Resolve ships
const RESOLVE_SCRIPT_LIB = RESOLVE_APP + '/Contents/Libraries/Fusion/fusionscript.so';
const RESOLVE_SCRIPT_API = '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting';
const OSASCRIPT = '/usr/bin/osascript';
const OSACOMPILE = '/usr/bin/osacompile';

// A folder inside the user's own Resolve support folder, where Resolve reads Fusion templates from:
// resolveUserDir('Fusion', 'Templates', 'Edit', 'Titles').
function resolveUserDir(...parts) {
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve', ...parts);
    if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Blackmagic Design', 'DaVinci Resolve', 'Support', ...parts);
    return path.join(os.homedir(), '.local', 'share', 'DaVinciResolve', ...parts);
}

// ------------------------------------------------------------------ previews
// Renders use this sample text when there is no subtitle (one line per Text+ node).
const SAMPLE_TEXTS = ['Sample text', 'Second line', 'Third line', 'Fourth line'];
// A running capture stops when this file appears.
const CANCEL_FLAG = path.join(os.tmpdir(), 'sa-preview-cancel-' + process.pid);
// A finished one-time preview (Use tab / subtitle cards) is kept on disk by what it was rendered from, so going back
// to a text, design or size that was already rendered shows instantly instead of rendering again.
const PREV_CACHE_DIR = path.join(PREV_DIR, '_cache');
const PREV_CACHE_MAX = 24;

// ------------------------------------------------------------------ diagnostics
// Enabled with SA_DEBUG=1. One line per event in _debug/preview-log.txt: in the code folder the plugin was installed
// from when it still exists (easy to find and share), otherwise next to the plugin.
const DEBUG_ON = process.env.SA_DEBUG === '1';
const DEV_DEBUG_DIR = path.join(LOCATION.codeDir || APP_ROOT, '_debug');
const DEBUG_LOG = fs.existsSync(path.dirname(DEV_DEBUG_DIR))
    ? path.join(DEV_DEBUG_DIR, 'preview-log.txt')
    : path.join(APP_ROOT, '_debug', 'preview-log.txt');

module.exports = {
    PLUGIN_ID, INITIAL_PPID,
    APP_ROOT, PRELOAD_FILE, INDEX_HTML, BRIDGE_SCRIPT, PACKAGE_JSON, MANIFEST_XML, WORKFLOW_INTEGRATION_NODE,
    DATA_DIR, ANIM_DIR, ANIM_ORIG_DIR, SFX_DIR, SFX_ORIG_DIR, PREV_DIR, FONTS_DIR, LIB_FILE,
    APP_DATA_DIR, SFX_CACHE_DIR, DRAFT_DIR, CLIP_REG, WIN_STATE_FILE, ensureDirs,
    RESOLVE_PYTHON, RESOLVE_SCRIPT_LIB, RESOLVE_SCRIPT_API, OSASCRIPT, OSACOMPILE, resolveUserDir,
    SAMPLE_TEXTS, CANCEL_FLAG, PREV_CACHE_DIR, PREV_CACHE_MAX,
    DEBUG_ON, DEBUG_LOG
};
