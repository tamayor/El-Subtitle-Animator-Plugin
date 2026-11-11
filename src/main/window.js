// The panel window: creation, remembered size / position, always-on-top and layout-mode resizing.

module.exports = {
    createWindow, fitWidth, setAutoCollapse, setLayoutMode, setOnTop
};

const fs = require('fs');
const { BrowserWindow, screen } = require('electron');

const state = require('./state');
const { DEBUG_ON, INDEX_HTML, PRELOAD_FILE, WIN_STATE_FILE } = require('./config');
const { libForUI, loadLib, saveLib } = require('./library');
const { quitPlugin } = require('./lifecycle');
const { dlog } = require('./log');
const { setAppIdle } = require('./poll');
const { isColorPanelOpen } = require('./color-picker');

function applyOnTop(flag) {
    if (!state.mainWindow) return;
    if (flag) {
        state.mainWindow.setAlwaysOnTop(true, 'floating');
        try { state.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch (e) { /* ignore */ }
    } else {
        state.mainWindow.setAlwaysOnTop(false);
        try { state.mainWindow.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true }); } catch (e) { /* ignore */ }
    }
}

function setOnTop(event, flag) {
    const lib = loadLib();
    lib.alwaysOnTop = !!flag;
    saveLib(lib);
    applyOnTop(lib.alwaysOnTop);
    return { lib: libForUI() };
}

let preSidebarBounds = null;

// Sizes the window so its content area is exactly `contentWidth` wide (kept on screen); the height is left alone.
// Called by the panel each time it opens, so the window always starts at the width its layout needs.
async function fitWidth(event, contentWidth, mode) {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return { ok: false };
    if (restoredFromState && firstFit) {
        // Launch with a remembered size: keep exactly that size.
        firstFit = false;
        const b0 = state.mainWindow.getBounds();
        if (mode === 'sidebar') preSidebarBounds = { x: b0.x, y: b0.y, width: 460, height: b0.height };
        return { ok: true, width: b0.width, restored: true };
    }
    firstFit = false;
    const bounds = state.mainWindow.getBounds();
    const [cw] = state.mainWindow.getContentSize();
    const frameExtra = Math.max(0, bounds.width - cw);
    const display = screen ? screen.getDisplayMatching(bounds) : null;
    const wa = display ? display.workArea : { x: 0, y: 0, width: 1920, height: 1080 };
    const minW = (state.mainWindow.getMinimumSize() || [380])[0] || 380;
    const w = Math.round(Math.max(minW, Math.min(wa.width - 20, Number(contentWidth) + frameExtra)));
    let x = bounds.x;
    if (x + w > wa.x + wa.width) x = Math.max(wa.x + 10, wa.x + wa.width - w);
    if (x < wa.x) x = wa.x + 10;
    state.mainWindow.setBounds({ x: Math.round(x), y: Math.round(bounds.y), width: w, height: Math.round(bounds.height) }, false);
    // Opening straight into the sidebar layout: remember the narrow width so leaving the sidebar restores it.
    if (mode === 'sidebar') preSidebarBounds = { x: Math.round(x), y: Math.round(bounds.y), width: 460, height: Math.round(bounds.height) };
    else preSidebarBounds = null;
    return { ok: true, width: w };
}

async function setLayoutMode(event, mode) {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return { ok: false };
    const bounds = state.mainWindow.getBounds();
    const currentScreen = screen ? screen.getDisplayMatching(bounds) : null;
    const workArea = currentScreen ? currentScreen.workArea : { x: 0, y: 0, width: 1920, height: 1080 };

    if (mode === 'sidebar') {
        if (!preSidebarBounds) {
            preSidebarBounds = { ...bounds };
        }
        const targetW = Math.min(workArea.width - 20, Math.max(1160, bounds.width + 440));
        let newX = bounds.x;
        if (newX + targetW > workArea.x + workArea.width) {
            newX = Math.max(workArea.x + 10, workArea.x + workArea.width - targetW);
        }
        state.mainWindow.setBounds({
            x: Math.round(newX),
            y: Math.round(bounds.y),
            width: Math.round(targetW),
            height: Math.round(bounds.height)
        }, true);
        return { ok: true, mode: 'sidebar', width: targetW };
    } else {
        if (preSidebarBounds && bounds.width > 700) {
            const restoreW = Math.min(bounds.width, Math.max(460, preSidebarBounds.width));
            let newX = bounds.x;
            if (newX + restoreW > workArea.x + workArea.width) {
                newX = Math.max(workArea.x + 10, workArea.x + workArea.width - restoreW);
            }
            state.mainWindow.setBounds({
                x: Math.round(newX),
                y: Math.round(bounds.y),
                width: Math.round(restoreW),
                height: Math.round(bounds.height)
            }, true);
            preSidebarBounds = null;
            return { ok: true, mode, width: restoreW };
        } else if (bounds.width > 800) {
            const restoreW = 460;
            state.mainWindow.setBounds({
                x: Math.round(bounds.x),
                y: Math.round(bounds.y),
                width: Math.round(restoreW),
                height: Math.round(bounds.height)
            }, true);
            return { ok: true, mode, width: restoreW };
        }
        return { ok: true, mode, width: bounds.width };
    }
}

// ---------------------------------------------------------------- auto-collapse
// Switched on from the panel (header button). When the panel loses focus it shrinks to its header bar (COLLAPSED_H of
// content); hovering the bar opens it to its full size again, and if you then move away without clicking into it, it
// shrinks again. Clicking into it (focus) keeps it open. It stays open while the cursor is over it, while the Colors panel
// is open (that is another app, so the panel loses focus) and while minimised / full screen.
const COLLAPSED_H = 40, MIN_W = 340, MIN_H = 480;
const COLLAPSE_DELAY = 250, HOVER_DWELL = 150, LEAVE_GRACE = 600, POLL_MS = 120;
const ac = { enabled: false, collapsed: false, fullH: 0, poll: null, since: 0, blurTimer: null, resizeTimer: null };

function acWin() { const w = state.mainWindow; return w && !w.isDestroyed() ? w : null; }
function cursorInside(w) {
    const p = screen.getCursorScreenPoint(), b = w.getBounds();
    return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}
function acStayOpen(w) {
    return w.isFocused() || w.isMinimized() || w.isFullScreen() || isColorPanelOpen() || cursorInside(w);
}

// Window height animation: the window is resized frame by frame (setBounds at ~60 fps) along an easing curve.
// Expanding uses ease-out-back (a little overshoot past the full height, then it settles = the bounce); collapsing uses
// ease-in-back (a small lift first, then it snaps up to the bar). The top edge stays put; the bottom never leaves the screen.
const EXPAND_MS = 420, COLLAPSE_MS = 300, FRAME_MS = 1000 / 60;
const easeOutBack = (t, k = 1.35) => 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
const easeInBack = (t, k = 1.2) => (k + 1) * t * t * t - k * t * t;
let anim = null;
function stopAnim() { if (anim) { clearInterval(anim.timer); anim = null; } }
function animateHeight(w, to, ms, ease, done) {
    stopAnim();
    const b0 = w.getBounds();
    const wa = screen.getDisplayMatching(b0).workArea;
    const from = b0.height, t0 = Date.now();
    const maxH = wa.y + wa.height - b0.y;             // never past the bottom of the screen (also the overshoot)
    const a = { timer: null };
    const step = () => {
        const w2 = acWin();
        if (!w2 || anim !== a) { clearInterval(a.timer); return; }
        const t = Math.min(1, (Date.now() - t0) / ms);
        const h = Math.round(Math.max(1, Math.min(maxH, from + (to - from) * ease(t))));
        const c = w2.getBounds();
        if (c.height !== h) w2.setBounds({ x: c.x, y: c.y, width: c.width, height: h }, false);
        if (t >= 1) { clearInterval(a.timer); anim = null; if (done) done(); }
    };
    anim = a;
    a.timer = setInterval(step, FRAME_MS);
    step();
}

function collapseWin() {
    const w = acWin();
    if (!w || !ac.enabled || ac.collapsed) return;
    const b = w.getBounds();
    const frame = Math.max(0, b.height - w.getContentSize()[1]);
    ac.collapsed = true;
    if (!anim) ac.fullH = b.height;                    // (mid-expand: keep the full height it was heading to)
    w.webContents.send('win:collapsed', 'collapsing');  // the panel fades its content out and pins the header bar
    clearTimeout(ac.resizeTimer);
    ac.resizeTimer = setTimeout(() => {
        const w2 = acWin();
        if (!w2 || !ac.collapsed) return;
        w2.setMinimumSize(MIN_W, 1);
        animateHeight(w2, COLLAPSED_H + frame, COLLAPSE_MS, easeInBack, () => {
            const w3 = acWin();
            if (w3 && ac.collapsed) w3.webContents.send('win:collapsed', 'collapsed');   // the bar lands (small bounce)
        });
    }, 90);
    acStartPoll();
}

function expandWin() {
    const w = acWin();
    clearTimeout(ac.resizeTimer);
    if (!w || !ac.collapsed) return;
    ac.collapsed = false;
    const c = w.getBounds();
    const wa = screen.getDisplayMatching(c).workArea;
    const h = Math.min(ac.fullH || 860, wa.height);
    const y = Math.max(wa.y, Math.min(c.y, wa.y + wa.height - h));   // room for the full height below the top edge
    if (y !== c.y) w.setBounds({ x: c.x, y, width: c.width, height: c.height }, false);
    const frame = Math.max(0, c.height - w.getContentSize()[1]);
    w.webContents.send('win:collapsed', 'expanding', { width: w.getContentSize()[0], height: h - frame });
    animateHeight(w, h, EXPAND_MS, easeOutBack, () => {
        const w2 = acWin();
        if (!w2 || ac.collapsed) return;
        w2.setMinimumSize(MIN_W, MIN_H);
        w2.webContents.send('win:collapsed', 'expanded');
    });
}

function acStopPoll() { clearInterval(ac.poll); ac.poll = null; }
function acStartPoll() {
    if (ac.poll) return;
    ac.since = Date.now();
    let last = null;
    ac.poll = setInterval(() => {
        const w = acWin();
        if (!w || !ac.enabled) { acStopPoll(); return; }
        if (w.isFocused()) { expandWin(); acStopPoll(); return; }
        const inside = cursorInside(w);
        if (inside !== last) { last = inside; ac.since = Date.now(); }
        const held = Date.now() - ac.since;
        if (ac.collapsed) {
            if (inside && held >= HOVER_DWELL) expandWin();                       // hover: open
        } else if (!inside && held >= LEAVE_GRACE && !isColorPanelOpen()) {
            collapseWin();                                                        // opened by hover, left without a click
        }
    }, POLL_MS);
}

function acOnBlur() {
    if (!ac.enabled) return;
    clearTimeout(ac.blurTimer);
    ac.blurTimer = setTimeout(() => {
        const w = acWin();
        if (!w || w.isFocused()) return;
        if (acStayOpen(w)) acStartPoll();     // still under the cursor / Colors panel: collapse once it is left
        else collapseWin();
    }, COLLAPSE_DELAY);
}
function acOnFocus() {
    clearTimeout(ac.blurTimer);
    acStopPoll();
    expandWin();
}

function setAutoCollapse(event, on) {
    ac.enabled = !!on;
    const w = acWin();
    if (!ac.enabled) { clearTimeout(ac.blurTimer); acStopPoll(); expandWin(); }
    else if (w && !w.isFocused()) acOnBlur();
    return { ok: true, enabled: ac.enabled, collapsed: ac.collapsed };
}

let rendererCrashes = [];
let restoredFromState = false;
let firstFit = true;
function loadWinState() {
    try {
        const st = JSON.parse(fs.readFileSync(WIN_STATE_FILE, 'utf8'));
        const ok = ['x', 'y', 'width', 'height'].every(k => Number.isFinite(st[k]));
        if (!ok || st.width < MIN_W || st.height < MIN_H) return null;
        const disp = screen.getAllDisplays().find(d => {
            const w = d.workArea;
            const ox = Math.min(st.x + st.width, w.x + w.width) - Math.max(st.x, w.x);
            const oy = Math.min(st.y + st.height, w.y + w.height) - Math.max(st.y, w.y);
            return ox >= 120 && oy >= 120;
        });
        if (!disp) return { width: Math.round(st.width), height: Math.round(st.height) };   // its screen is gone: keep the size, let the system place it
        const w = disp.workArea;
        const width = Math.min(Math.round(st.width), w.width), height = Math.min(Math.round(st.height), w.height);
        const x = Math.min(Math.max(Math.round(st.x), w.x), w.x + w.width - width);
        const y = Math.min(Math.max(Math.round(st.y), w.y), w.y + w.height - height);
        return { x, y, width, height };
    } catch (e) { return null; }
}
let winSaveTimer = null;
function saveWinState() {
    try {
        if (!state.mainWindow || state.mainWindow.isDestroyed() || state.mainWindow.isMinimized() || state.mainWindow.isFullScreen()) return;
        const b = state.mainWindow.getNormalBounds ? state.mainWindow.getNormalBounds() : state.mainWindow.getBounds();
        if ((ac.collapsed || anim) && ac.fullH) b.height = ac.fullH;     // collapsed / animating: remember the full height
        const tmp = WIN_STATE_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }));
        fs.renameSync(tmp, WIN_STATE_FILE);
    } catch (e) { /* ignore */ }
}
function scheduleSaveWinState() { clearTimeout(winSaveTimer); winSaveTimer = setTimeout(saveWinState, 400); }

function createWindow() {
    const saved = loadWinState();
    restoredFromState = !!saved;
    state.mainWindow = new BrowserWindow(Object.assign({
        width: 460,
        height: 860 }, saved || {}, {
        minWidth: MIN_W,
        minHeight: MIN_H,
        title: 'El Subtitle Animator',
        backgroundColor: '#131614',
        webPreferences: { preload: PRELOAD_FILE }
    }));
    state.mainWindow.setMenu(null);
    state.mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        const msg = (typeof event === 'object' && event.message !== undefined) ? event.message : message;
        const src = (typeof event === 'object' && event.sourceId !== undefined) ? event.sourceId : sourceId;
        const ln = (typeof event === 'object' && event.lineNumber !== undefined) ? event.lineNumber : line;
        const lvl = (typeof event === 'object' && event.level !== undefined) ? event.level : level;
        if (DEBUG_ON || lvl === 'error' || lvl === 'warning' || lvl >= 2) console.log('[RENDERER]', msg, src + ':' + ln);
        dlog('[renderer console]', msg, src + ':' + ln);
    });
    state.mainWindow.webContents.on('render-process-gone', (event, details) => {
        dlog('[render-process-gone]', details);
        const now = Date.now();
        rendererCrashes = rendererCrashes.filter(t => now - t < 60000);
        rendererCrashes.push(now);
        if (details.reason !== 'clean-exit' && details.reason !== 'killed' && rendererCrashes.length <= 5) {
            console.error('Renderer process gone, reloading page:', details);
            setTimeout(() => {
                if (state.mainWindow && !state.mainWindow.isDestroyed()) {
                    state.mainWindow.loadFile(INDEX_HTML);
                }
            }, 1000);
        }
    });
    state.mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        dlog('[did-fail-load]', errorCode, errorDescription, validatedURL);
    });
    // Dropping a file must never navigate the window away from the panel.
    state.mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
    state.mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    state.mainWindow.on('close', () => { clearTimeout(winSaveTimer); saveWinState(); quitPlugin(); });
    state.mainWindow.on('resize', scheduleSaveWinState);
    state.mainWindow.on('move', scheduleSaveWinState);
    state.mainWindow.on('minimize', () => setAppIdle(true));
    state.mainWindow.on('hide', () => setAppIdle(true));
    state.mainWindow.on('restore', () => { state.parkArmed = false; setAppIdle(false); });
    state.mainWindow.on('blur', () => { if (state.parkArmed) setAppIdle(true, 'parked'); acOnBlur(); });
    state.mainWindow.on('focus', () => { state.parkArmed = false; if (state.appIdle && !state.mainWindow.isMinimized()) setAppIdle(false); acOnFocus(); });
    state.mainWindow.on('closed', () => { stopAnim(); acStopPoll(); clearTimeout(ac.blurTimer); clearTimeout(ac.resizeTimer); });
    state.mainWindow.on('show', () => setAppIdle(state.mainWindow.isMinimized()));
    applyOnTop(loadLib().alwaysOnTop !== false);   // stays above Resolve by default
    state.mainWindow.loadFile(INDEX_HTML);
}
