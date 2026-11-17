// Windows: where Resolve keeps things and how the panel gets into its plugin folder.
// Only the panel is installed here: the plugin's Claude Code connection, tools and engines use macOS tools.

const fs = require('fs');
const path = require('path');
const E = require('../shared/env');
const { quiet } = require('../shared/run');

function resolvePaths() {
    const root = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Blackmagic Design', 'DaVinci Resolve', 'Support');
    return {
        dest: path.join(root, 'Workflow Integration Plugins', E.PLUGIN_ID),
        oldDest: path.join(root, 'Workflow Integration Plugins', E.OLD_PLUGIN_ID),
        sampleNode: path.join(root, 'Developer', 'Workflow Integrations', 'Examples', 'SamplePlugin', 'WorkflowIntegration.node'),
        app: path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Blackmagic Design', 'DaVinci Resolve', 'Resolve.exe'),
        userData: path.join(process.env.APPDATA || path.join(E.HOME, 'AppData', 'Roaming'), 'Electron'),
    };
}

// <main>\Install El Subtitle Animator.exe unpacks itself to a temporary folder and runs from there; it passes the
// folder it was started from in PORTABLE_EXECUTABLE_DIR. The unpacked app folder (dist/) is looked up from itself.
function appFolder() { return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath); }

async function resolveRunning() {
    return /Resolve\.exe/i.test((await quiet('tasklist', ['/FI', 'IMAGENAME eq Resolve.exe', '/NH'])).out);
}

async function quitResolve() { return { ok: false, error: 'Quit DaVinci Resolve yourself, then open it again.' }; }

async function placePlugin(stage, paths) {
    const { dest, oldDest } = paths;
    try {
        fs.mkdirSync(dest, { recursive: true });
        fs.rmSync(oldDest, { recursive: true, force: true });
        require('../shared/plugin').replaceContents(stage, dest);
    } catch (e) {
        if (!/EPERM|EACCES/.test(String(e && e.code))) throw e;
        throw new Error('Windows did not allow writing to ' + dest + '. Close this installer, right-click it and choose "Run as administrator".');
    }
}

module.exports = { resolvePaths, appFolder, resolveRunning, quitResolve, placePlugin, ITEMS: [] };
