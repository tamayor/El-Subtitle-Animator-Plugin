// Where macOS keeps the tools the installer starts, and the plugin's own engine folders.
// These mirror the plugin's lookups. When one changes there, change it here too:
//   src/main/names.js            HOME_DIR
//   src/main/media-analysis.js   ASR_VENV, BIN_DIRS
//   src/main/broll.js            findNode

const fs = require('fs');
const path = require('path');
const { HOME, HOME_FOLDER_NAME, OLD_HOME_FOLDER_NAME, exists, existingOr } = require('../shared/env');

// ~/.framelly: the speech engine and the MCP endpoint file (~/.el-subtitle-animator when an earlier version made it).
const HOME_DIR = existingOr(path.join(HOME, HOME_FOLDER_NAME), path.join(HOME, OLD_HOME_FOLDER_NAME));
const ASR_VENV = path.join(HOME_DIR, 'asr-venv');
const BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];

// ------------------------------------------------------------------ tools
// An app started from Finder has a bare PATH, so tools are looked up where their installers put them.
function nvmNodes() {
    const nvm = path.join(HOME, '.nvm', 'versions', 'node');
    try {
        return fs.readdirSync(nvm).filter(v => /^v\d+/.test(v))
            .sort((a, b) => {
                const x = a.slice(1).split('.').map(Number), y = b.slice(1).split('.').map(Number);
                return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]);
            })
            .filter(v => Number(v.slice(1).split('.')[0]) >= 18)
            .map(v => path.join(nvm, v, 'bin'));
    } catch (e) { return []; }
}

function toolDirs() {
    return [...BIN_DIRS.slice(0, 2), ...nvmNodes(), path.join(HOME, '.local', 'bin'), path.join(HOME, '.claude', 'local'),
        path.join(HOME, '.volta', 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
}

function findTool(name) {
    for (const d of toolDirs()) { const p = path.join(d, name); if (exists(p)) return p; }
    return null;
}

// The plugin's own lookups (they are narrower than findTool on purpose: the plugin must find the tool too).
function pluginBin(name) { return BIN_DIRS.map(d => path.join(d, name)).find(exists) || null; }
function systemPython() { return ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'].find(exists) || null; }
function pluginNode() {
    return [...nvmNodes().map(d => path.join(d, 'node')), '/opt/homebrew/bin/node', '/usr/local/bin/node', path.join(HOME, '.volta', 'bin', 'node')].find(exists) || null;
}

function toolEnv(extraDirs) {
    const dirs = [...(extraDirs || []), ...toolDirs()];
    return { ...process.env, PATH: [...new Set(dirs)].join(path.delimiter) };
}

module.exports = { HOME_DIR, ASR_VENV, findTool, pluginBin, systemPython, pluginNode, toolEnv };
