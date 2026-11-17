// macOS: where Resolve keeps things, how the panel gets into its system folder, and how Resolve is quit.
// RESOLVE_APP mirrors src/main/config.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../shared/env');
const { run, quiet, tail } = require('../shared/run');

// The plugin runs inside Resolve's own Electron, whose userData folder is named "Electron".
function resolvePaths() {
    const root = '/Library/Application Support/Blackmagic Design/DaVinci Resolve';
    return {
        dest: path.join(root, 'Workflow Integration Plugins', E.PLUGIN_ID),
        oldDest: path.join(root, 'Workflow Integration Plugins', E.OLD_PLUGIN_ID),
        sampleNode: path.join(root, 'Developer', 'Workflow Integrations', 'Examples', 'SamplePlugin', 'WorkflowIntegration.node'),
        app: '/Applications/DaVinci Resolve/DaVinci Resolve.app',
        userData: path.join(E.HOME, 'Library', 'Application Support', 'Electron'),
    };
}

// <main>/Install El Subtitle Animator.app/Contents/Resources/app.asar
function appFolder(app) { return path.dirname(path.resolve(app.getAppPath(), '..', '..', '..')); }

async function resolveRunning() { return (await quiet('/usr/bin/pgrep', ['-x', 'Resolve'])).code === 0; }

// Resolve offers to save an open project itself, so this waits for it to close.
async function quitResolve() {
    await quiet('/usr/bin/osascript', ['-e', 'tell application "DaVinci Resolve" to quit']);
    for (let i = 0; i < 90 && await resolveRunning(); i++) await new Promise(r => setTimeout(r, 1000));
    if (await resolveRunning()) return { ok: false, error: 'DaVinci Resolve is still open. Quit it (it may be asking to save), then open it again.' };
    return { ok: true };
}

function shQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

async function placePlugin(stage, paths, log) {
    const { dest, oldDest } = paths;
    let direct = E.exists(dest) && !E.exists(oldDest);
    if (direct) { try { fs.accessSync(dest, fs.constants.W_OK); } catch (e) { direct = false; } }
    if (direct) return require('../shared/plugin').replaceContents(stage, dest);

    // Resolve reads plugins from a system folder: macOS asks for the password once. Afterwards the folder belongs
    // to the user, so later installs do not ask again.
    log('Asking for your Mac password (Resolve reads plugins from a system folder)');
    const script = stage + '.sh';
    fs.writeFileSync(script, [
        'set -e',
        '/bin/rm -rf ' + shQuote(oldDest),
        '/bin/mkdir -p ' + shQuote(dest),
        '/usr/bin/rsync -a --delete ' + shQuote(stage + '/') + ' ' + shQuote(dest + '/'),
        '/usr/sbin/chown -R ' + shQuote(os.userInfo().username) + ' ' + shQuote(dest),
    ].join('\n') + '\n', { mode: 0o700 });
    try {
        const r = await run('/usr/bin/osascript', [
            '-e', 'on run argv',
            '-e', 'do shell script "/bin/bash " & quoted form of (item 1 of argv) with prompt "El Subtitle Animator installs its panel into DaVinci Resolve\'s plugin folder." with administrator privileges',
            '-e', 'end run', script]);
        if (r.code !== 0) throw new Error(/-128|User cancel/i.test(r.err) ? 'The password window was cancelled' : 'Could not copy the plugin: ' + tail(r));
    } finally { fs.rmSync(script, { force: true }); }
}

module.exports = { resolvePaths, appFolder, resolveRunning, quitResolve, placePlugin, ITEMS: require('./items').ITEMS };
