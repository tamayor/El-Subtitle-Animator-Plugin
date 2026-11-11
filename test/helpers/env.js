// Test environment for the main-process modules: they run without Electron, without DaVinci Resolve and without the
// user's data folder.
//
//   - `electron` is replaced by a stub (the modules only need it to load; no window is ever created);
//   - `src/main/workflow-integration.js` (Blackmagic's native addon) is replaced by a fake whose Resolve object is set
//     per test with useResolve() (see fake-resolve.js);
//   - `data-location.json` is answered with a temporary folder, so config.js points every data path there and nothing
//     is read from or written to the real "El Subtitle Animator" folder.
//
// Require this file first in every test: `const env = require('../helpers/env');`

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..', '..');
const MAIN_DIR = path.join(ROOT, 'src', 'main');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'elsa-test-data-'));
process.on('exit', () => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* temp folder */ } });

// ------------------------------------------------------------------ electron
// Any property is a callable stub that returns another stub, so `app.whenReady().then(...)`, `ipcMain.handle(...)`,
// `new BrowserWindow()` and the like all load. Tests never drive Electron itself.
function stub(name) {
    const fn = function () { return stub(name + '()'); };
    return new Proxy(fn, {
        get(target, key) {
            if (key === 'then') return undefined;                 // not a promise
            if (key === Symbol.toPrimitive) return () => name;
            if (key === 'getPath') return () => DATA_DIR;
            if (!(key in target)) target[key] = stub(name + '.' + String(key));
            return target[key];
        },
        construct() { return stub('new ' + name); }
    });
}
const electron = stub('electron');

// ------------------------------------------------------------------ Blackmagic's Workflow Integration addon
let resolveObj = null;
const calls = { Initialize: 0, GetResolve: 0, CleanUp: 0 };
const workflowIntegration = {
    Initialize(pluginId) { calls.Initialize++; workflowIntegration.pluginId = pluginId; return resolveObj !== null; },
    GetResolve() { calls.GetResolve++; return resolveObj; },
    CleanUp() { calls.CleanUp++; return true; },
    RegisterCallback() { return true; },
    DeregisterCallback() { return true; }
};

const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
    if (request === 'electron' || request.startsWith('electron/')) return electron;
    if (parent && parent.filename && path.dirname(parent.filename) === MAIN_DIR && request === './workflow-integration') return workflowIntegration;
    return realLoad.call(this, request, parent, ...rest);
};

// ------------------------------------------------------------------ data folder
// config.js reads data-location.json once, when it is first required: answer that one read with the temp folder.
const realRead = fs.readFileSync;
fs.readFileSync = function (file, ...rest) {
    if (typeof file === 'string' && path.basename(file) === 'data-location.json' && path.dirname(file) === ROOT) {
        return JSON.stringify({ mainDir: DATA_DIR, dataDir: DATA_DIR, codeDir: DATA_DIR });
    }
    return realRead.call(this, file, ...rest);
};
const config = require(path.join(MAIN_DIR, 'config'));
if (config.DATA_DIR !== DATA_DIR) throw new Error('Test set-up: config.js did not take the temporary data folder (' + config.DATA_DIR + ')');
config.ensureDirs();

const state = require(path.join(MAIN_DIR, 'state'));

// Connects the main-process modules to a fake Resolve (fake-resolve.js makeResolve) and forgets every cached handle.
function useResolve(fake) {
    resolveObj = fake;
    state.resolveObj = null;
    state.subCache = { key: '', at: 0, list: [] };
    state.lastSelection = null;
}

module.exports = {
    ROOT, MAIN_DIR, DATA_DIR, state, calls, workflowIntegration, useResolve,
    main: (name) => require(path.join(MAIN_DIR, name))
};
