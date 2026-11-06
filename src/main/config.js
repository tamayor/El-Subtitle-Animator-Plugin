// Static configuration: plugin id, on-disk locations of the library and app files, debug switches.
// Pure constants only - this module must not require any other project module.

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
const DATA_DIR = path.join(os.homedir(), 'Documents', 'Subtitle Animator');
const ANIM_DIR = path.join(DATA_DIR, 'animations');
const ANIM_ORIG_DIR = path.join(DATA_DIR, 'animations_orig');
const SFX_DIR = path.join(DATA_DIR, 'sfx');
const PREV_DIR = path.join(DATA_DIR, 'previews');
const FONTS_DIR = path.join(DATA_DIR, 'fonts');
const LIB_FILE = path.join(DATA_DIR, 'library.json');
const CLIP_REG = path.join(DATA_DIR, 'temp-clips.json');            // temporary preview clips still on a timeline
const WIN_STATE_FILE = path.join(DATA_DIR, 'window-state.json');    // the window opens the way it was closed

function ensureDirs() {
    for (const d of [DATA_DIR, ANIM_DIR, ANIM_ORIG_DIR, SFX_DIR, PREV_DIR, FONTS_DIR]) fs.mkdirSync(d, { recursive: true });
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
// Enabled with SA_DEBUG=1. One line per event in _debug/preview-log.txt: in the project folder in Documents when it
// exists (easy to find and share), otherwise next to the plugin.
const DEBUG_ON = process.env.SA_DEBUG === '1';
const DEV_DEBUG_DIR = path.join(os.homedir(), 'Documents', 'Subtitle Animator Plugin', '_debug');
const DEBUG_LOG = fs.existsSync(path.dirname(DEV_DEBUG_DIR))
    ? path.join(DEV_DEBUG_DIR, 'preview-log.txt')
    : path.join(APP_ROOT, '_debug', 'preview-log.txt');

module.exports = {
    PLUGIN_ID, INITIAL_PPID,
    APP_ROOT, PRELOAD_FILE, INDEX_HTML, BRIDGE_SCRIPT, PACKAGE_JSON, MANIFEST_XML, WORKFLOW_INTEGRATION_NODE,
    DATA_DIR, ANIM_DIR, ANIM_ORIG_DIR, SFX_DIR, PREV_DIR, FONTS_DIR, LIB_FILE, CLIP_REG, WIN_STATE_FILE, ensureDirs,
    SAMPLE_TEXTS, CANCEL_FLAG, PREV_CACHE_DIR, PREV_CACHE_MAX,
    DEBUG_ON, DEBUG_LOG
};
