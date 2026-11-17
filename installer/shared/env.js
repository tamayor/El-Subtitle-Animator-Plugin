// What every platform shares: the plugin's names and how the installer finds its folders.
// These mirror src/main/config.js (PLUGIN_ID, DATA_FOLDER_NAME, data-location.json).

const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN_ID = 'com.el.subtitleanimator';
const OLD_PLUGIN_ID = 'com.wmseditors.subtitleanimator';
const CODE_FOLDER_NAME = 'El Subtitle Animator Plugin';
const DATA_FOLDER_NAME = 'El Subtitle Animator';
const MCP_NAME = 'el-subtitle-animator';
const HOME = os.homedir();

function exists(p) { try { return fs.existsSync(p); } catch (e) { return false; } }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }

// The code folder: it has the plugin's manifest.xml, main.js and src/.
function isCodeDir(dir) {
    try {
        return fs.readFileSync(path.join(dir, 'manifest.xml'), 'utf8').includes(PLUGIN_ID)
            && exists(path.join(dir, 'main.js')) && exists(path.join(dir, 'src', 'main'));
    } catch (e) { return false; }
}

// Looks for the code folder from a starting folder: the folder itself, its "El Subtitle Animator Plugin" child,
// then the same one level up, and so on. The installer app sits in the main folder, or in installer/ while developing.
function findCodeDir(starts) {
    for (const start of starts) {
        let dir = start;
        for (let i = 0; dir && i < 7; i++) {
            if (isCodeDir(dir)) return dir;
            const child = path.join(dir, CODE_FOLDER_NAME);
            if (isCodeDir(child)) return child;
            const up = path.dirname(dir);
            if (up === dir) break;
            dir = up;
        }
    }
    return null;
}

function locations(codeDir) {
    const mainDir = path.dirname(codeDir);
    return { codeDir, mainDir, dataDir: path.join(mainDir, DATA_FOLDER_NAME) };
}

module.exports = { PLUGIN_ID, OLD_PLUGIN_ID, CODE_FOLDER_NAME, DATA_FOLDER_NAME, MCP_NAME, HOME, exists, readJson, isCodeDir, findCodeDir, locations };
