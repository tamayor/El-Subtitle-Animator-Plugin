// Install El Subtitle Animator: a small window with a checklist and an Install button.
// The app sits in the main folder, beside "El Subtitle Animator Plugin" (the code) and "El Subtitle Animator" (the
// data). While developing it runs from installer/ with `npm start`.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const E = require('./shared/env');
const P = require('./shared/platform');          // mac/platform.js or windows/platform.js
const C = require('./shared/items');
const R = require('./shared/run');

let win = null;
let codeDir = null;
let running = false;

const PREFS = () => path.join(app.getPath('userData'), 'installer.json');

function locateCode() {
    const starts = [];
    const saved = E.readJson(PREFS(), {}).codeDir;
    if (app.isPackaged) starts.push(P.appFolder(app));
    else starts.push(path.join(__dirname, '..'));
    if (saved) starts.push(saved);
    return E.findCodeDir(starts);
}

function context() { return { ...E.locations(codeDir), paths: P.resolvePaths() }; }

async function state() {
    const paths = P.resolvePaths();
    const base = { platform: process.platform, groups: C.GROUPS, resolveInstalled: E.exists(paths.app), resolveRunning: await P.resolveRunning(), canRestart: process.platform === 'darwin', running };
    if (!codeDir) return { ...base, found: false, items: [] };
    const ctx = context();
    return { ...base, found: true, mainDir: ctx.mainDir, codeDir: ctx.codeDir, dataDir: ctx.dataDir, items: await C.scan(ctx) };
}

function send(msg) { if (win && !win.isDestroyed()) win.webContents.send('progress', msg); }

async function install(ids) {
    if (running || !codeDir) return { ok: false };
    running = true;
    R.reset();
    const ctx = context();
    const results = [];
    // In the list's order, whatever order the boxes were ticked in.
    for (const item of C.ITEMS.filter(i => ids.includes(i.id))) {
        if (R.isStopped()) { send({ id: item.id, phase: 'skipped' }); continue; }
        send({ id: item.id, phase: 'start' });
        try {
            await item.install(ctx, (text) => send({ id: item.id, phase: 'log', text }));
            const after = await item.detect(ctx);
            if (after.state !== 'ok') throw new Error(after.note || 'It did not install');
            send({ id: item.id, phase: 'done', note: after.note });
            results.push({ id: item.id, ok: true });
        } catch (e) {
            const error = R.isStopped() ? 'Stopped' : String(e && e.message || e);
            send({ id: item.id, phase: 'error', text: error });
            results.push({ id: item.id, ok: false, error });
        }
    }
    running = false;
    return { ok: results.every(r => r.ok), stopped: R.isStopped(), results };
}

async function openResolve() {
    const { app: resolveApp } = P.resolvePaths();
    if (!E.exists(resolveApp)) return { ok: false, error: 'DaVinci Resolve was not found at ' + resolveApp };
    const error = await shell.openPath(resolveApp);
    return error ? { ok: false, error } : { ok: true };
}

// Asks Resolve to quit (it offers to save an open project itself), waits for it to close, then opens it again.
async function restartResolve() {
    const quit = await P.quitResolve();
    return quit.ok ? openResolve() : quit;
}

const LINKS = new Set(['https://brew.sh', 'https://nodejs.org', 'https://www.python.org/downloads/', 'https://claude.com/claude-code']);

function createWindow() {
    win = new BrowserWindow({
        width: 620, height: 820, minWidth: 520, minHeight: 560,
        title: 'Install El Subtitle Animator',
        backgroundColor: '#17181b',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, 'ui', 'index.html'));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
    codeDir = locateCode();
    ipcMain.handle('state', () => state());
    ipcMain.handle('install', (e, ids) => install(Array.isArray(ids) ? ids.map(String) : []));
    ipcMain.handle('stop', () => { R.stop(); return true; });
    ipcMain.handle('chooseFolder', async () => {
        const r = await dialog.showOpenDialog(win, {
            title: 'Choose the El Subtitle Animator main folder', properties: ['openDirectory'],
            message: 'Choose the folder that holds "El Subtitle Animator Plugin".',
        });
        if (r.canceled || !r.filePaths[0]) return { ok: false };
        const found = E.findCodeDir([r.filePaths[0]]);
        if (!found) return { ok: false, error: 'That folder does not hold "El Subtitle Animator Plugin".' };
        codeDir = found;
        try { fs.mkdirSync(path.dirname(PREFS()), { recursive: true }); fs.writeFileSync(PREFS(), JSON.stringify({ codeDir })); } catch (err) { /* asked again next time */ }
        return { ok: true };
    });
    ipcMain.handle('openResolve', () => openResolve());
    ipcMain.handle('restartResolve', () => restartResolve());
    ipcMain.handle('showFolder', () => { if (codeDir) shell.openPath(path.dirname(codeDir)); return true; });
    ipcMain.handle('openLink', (e, url) => { if (LINKS.has(url)) shell.openExternal(url); return true; });
    createWindow();
});

app.on('window-all-closed', () => { R.stop(); app.quit(); });
