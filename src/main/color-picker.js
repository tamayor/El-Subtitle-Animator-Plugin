// Native colour picker: macOS's Colors panel (osascript / a warm JXA helper) that streams the live colour back to the
// panel, or Windows' own Color dialog (PowerShell + System.Windows.Forms.ColorDialog, with your custom colours).

module.exports = {
    cancelNativeColor, isColorPanelOpen, pickNativeColor, prepareColorScript, startJxaHelper, stopJxaHelper
};

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const state = require('./state');
const { APP_DATA_DIR, ensureDirs } = require('./config');

// Minimized or hidden window: no real-time work (the panel stops polling and rendering), so nothing disturbs Resolve while you work.
// macOS's own Colors panel (with the swatches you saved in it) instead of the web colour picker.
let colorPanelOpen = false, colorChild = null;
function isColorPanelOpen() { return colorPanelOpen; }
function cancelNativeColor() { try { if (colorChild) colorChild.kill('SIGTERM'); } catch (e) { /* ignore */ } try { if (colorViaHelper) { stopJxaHelper(); setTimeout(startJxaHelper, 300); } } catch (e) { /* ignore */ } return true; }
let colorViaHelper = false;
// The Colors panel script is compiled once (osacompile) and warmed up when the app starts, so a click only has to run it:
// no compiling and no cold start of the AppleScript runtime on the click.
const COLOR_SCRIPT_LINES = [
    'on run argv',
    'if (count of argv) < 3 then return "warm"',
    'tell current application to activate',
    'set c to choose color default color {(item 1 of argv as integer), (item 2 of argv as integer), (item 3 of argv as integer)}',
    'return (item 1 of c as text) & "," & (item 2 of c as text) & "," & (item 3 of c as text)',
    'end run'
];
let colorScriptPath = null, colorScriptPromise = null;
function prepareColorScript() {
    if (colorScriptPromise) return colorScriptPromise;
    colorScriptPromise = new Promise((resolve) => {
        if (process.platform !== 'darwin') return resolve(null);
        try {
            ensureDirs();
            const h = require('crypto').createHash('sha1').update(COLOR_SCRIPT_LINES.join('\n')).digest('hex').slice(0, 8);
            const file = path.join(APP_DATA_DIR, 'pick-color-' + h + '.scpt');
            const warm = () => execFile('/usr/bin/osascript', [file], { timeout: 20000 }, () => { colorScriptPath = file; resolve(file); });
            if (fs.existsSync(file)) return warm();
            const args = ['-o', file]; for (const l of COLOR_SCRIPT_LINES) args.push('-e', l);
            execFile('/usr/bin/osacompile', args, { timeout: 20000 }, (err) => { if (err) return resolve(null); warm(); });
        } catch (e) { resolve(null); }
    });
    return colorScriptPromise;
}

// A persistent helper (JXA) keeps AppleScript's runtime and the (hidden) Colors panel loaded, so the panel opens at once.
// If it is not ready or does not answer quickly, the per-click script below is used as before.
const JXA_HELPER = [
    "ObjC.import('Foundation'); ObjC.import('AppKit');",
    "var app = Application.currentApplication(); app.includeStandardAdditions = true;",
    "var sin = $.NSFileHandle.fileHandleWithStandardInput, sout = $.NSFileHandle.fileHandleWithStandardOutput;",
    "function say(t) { sout.writeData($(t + '\\n').dataUsingEncoding($.NSUTF8StringEncoding)); }",
    // Preload AppKit and the Colors panel (hidden) before saying READY: the window-server connection and the panel's
    // own loading (~250 ms) happen here, in the background, instead of after your click.
    "try { var NSApp0 = $.NSApplication.sharedApplication; NSApp0.setActivationPolicy(1);",
    "  var p0 = $.NSColorPanel.sharedColorPanel; p0.setShowsAlpha(false); p0.setMode(1); p0.setContentSize($.NSMakeSize(264, 372)); p0.center; } catch (e) { }",
    "say('READY');",
    "while (true) {",
    "  var d = sin.availableData; if (d.length == 0) break;",
    "  var txt = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(d, $.NSUTF8StringEncoding)) || '';",
    "  var lines = txt.split('\\n');",
    "  for (var i = 0; i < lines.length; i++) {",
    "    var ln = lines[i].trim(); if (ln.indexOf('SHOW') !== 0) continue;",
    "    var a = ln.split(' ').slice(1).map(function (x) { return parseInt(x, 10); });",
    "    try {",
    "      var NSApp = $.NSApplication.sharedApplication; NSApp.setActivationPolicy(1);",
    "      var panel = $.NSColorPanel.sharedColorPanel; panel.setShowsAlpha(false);",
    "      panel.setColor($.NSColor.colorWithSRGBRedGreenBlueAlpha(a[0] / 65535, a[1] / 65535, a[2] / 65535, 1));",
    "      panel.setMode(1); panel.setContentSize($.NSMakeSize(264, 372)); panel.center;",
    "      panel.makeKeyAndOrderFront(null); NSApp.activateIgnoringOtherApps(true); say('SHOWN');",
    "      var last = '', cur = '';",
    "      while (panel.isVisible) {",
    "        var ev = NSApp.nextEventMatchingMaskUntilDateInModeDequeue(4294967295, $.NSDate.dateWithTimeIntervalSinceNow(0.06), $.NSDefaultRunLoopMode, true);",
    "        if (ev) NSApp.sendEvent(ev);",
    "        var c = panel.color.colorUsingColorSpace($.NSColorSpace.sRGBColorSpace);",
    "        cur = [c.redComponent, c.greenComponent, c.blueComponent].map(function (x) { return Math.round(x * 65535); }).join(',');",
    "        if (cur !== last) { last = cur; say('LIVE ' + cur); }",
    "      }",
    "      say('COLOR ' + (cur || a.join(',')));",
    "    } catch (e) { say('ERR ' + e); }",
    "  }",
    "}"
].join('\n');
let jxa = null, jxaReady = false, jxaWait = null, jxaBuf = '';
function jxaLine(line) {
    line = line.trim(); if (!line) return;
    if (line === 'READY') { jxaReady = true; return; }
    if (jxaWait) jxaWait(line);
}
function startJxaHelper() {
    if (process.platform !== 'darwin' || jxa) return;
    try {
        ensureDirs();
        const file = path.join(APP_DATA_DIR, 'color-helper.js');
        fs.writeFileSync(file, JXA_HELPER);
        jxaReady = false; jxaBuf = '';
        const ch = require('child_process').spawn('/usr/bin/osascript', ['-l', 'JavaScript', file], { stdio: ['pipe', 'pipe', 'ignore'] });
        jxa = ch;
        ch.stdout.on('data', (b) => { jxaBuf += b.toString(); let i; while ((i = jxaBuf.indexOf('\n')) >= 0) { const l = jxaBuf.slice(0, i); jxaBuf = jxaBuf.slice(i + 1); jxaLine(l); } });
        const gone = () => { if (jxa === ch) { jxa = null; jxaReady = false; if (jxaWait) { const w = jxaWait; w('CANCEL'); } } };
        ch.on('exit', gone); ch.on('error', gone);
        ch.stdin.on('error', () => { });
    } catch (e) { jxa = null; }
}
function stopJxaHelper() { try { if (jxa) jxa.kill('SIGTERM'); } catch (e) { /* ignore */ } jxa = null; jxaReady = false; }
// resolves null when the helper cannot be used (caller falls back), otherwise {hex} / {cancelled}
function pickViaHelper(c, onLive) {
    return new Promise((resolve) => {
        if (!jxa) startJxaHelper();
        const t0 = Date.now();
        const go = () => {
            if (!jxa) return resolve(null);
            if (!jxaReady) { if (Date.now() - t0 > 6000) { stopJxaHelper(); return resolve(null); } return setTimeout(go, 50); }
            let shown = false, done = false;
            const fin = (v) => { if (done) return; done = true; clearTimeout(st); jxaWait = null; resolve(v); };
            const st = setTimeout(() => { if (!shown) { stopJxaHelper(); fin(null); } }, 4000);
            jxaWait = (line) => {
                if (line === 'SHOWN') { shown = true; clearTimeout(st); return; }
                if (line === 'CANCEL') return fin({ cancelled: true, shown });
                if (line.indexOf('ERR') === 0) { if (!shown) { stopJxaHelper(); return fin(null); } return fin({ cancelled: true, shown }); }
                if (line.indexOf('LIVE ') === 0) { try { onLive && onLive(line.slice(5)); } catch (e) { /* ignore */ } return; }
                if (line.indexOf('COLOR ') === 0) return fin({ rgb: line.slice(6) });
            };
            try { jxa.stdin.write('SHOW ' + c.join(' ') + '\n'); } catch (e) { stopJxaHelper(); fin(null); }
        };
        go();
    });
}
function pickNativeColor(event, hex) {
    return new Promise((resolve) => {
        if (process.platform === 'win32') return pickWindowsColor(hex, resolve);
        if (process.platform !== 'darwin') return resolve({ ok: false, unsupported: true });
        if (colorPanelOpen) return resolve({ ok: true, busy: true });      // one Colors panel at a time
        colorPanelOpen = true;
        const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
        const v = m ? m[1] : 'ffffff';
        const c = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) * 257);
        const finishH = (r) => {
            colorPanelOpen = false; colorViaHelper = false;
            try { if (state.mainWindow && !state.mainWindow.isDestroyed()) { state.mainWindow.show(); state.mainWindow.focus(); } } catch (e) { /* ignore */ }
            if (r.cancelled) return resolve({ ok: true, cancelled: true });
            const p = String(r.rgb || '').split(',').map(x => Math.max(0, Math.min(255, Math.round(parseInt(x, 10) / 257))));
            if (p.length !== 3 || p.some(x => !Number.isFinite(x))) return resolve({ ok: false, error: 'Unexpected colour answer' });
            resolve({ ok: true, hex: '#' + p.map(x => x.toString(16).padStart(2, '0')).join('') });
        };
        colorViaHelper = true;
        pickViaHelper(c, (rgb) => { try { const q = rgb.split(',').map(x => Math.max(0, Math.min(255, Math.round(parseInt(x, 10) / 257)))); if (q.length === 3 && state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.webContents.send('color:live', '#' + q.map(x => x.toString(16).padStart(2, '0')).join('')); } catch (e) { /* ignore */ } }).then((r) => {
            if (r) return finishH(r);
            colorViaHelper = false;
            runOsaFallback();
        });
        const runOsaFallback = () => {
        const script = [
            'tell current application to activate',
            'set c to choose color default color {' + c.join(', ') + '}',
            'return (item 1 of c as text) & "," & (item 2 of c as text) & "," & (item 3 of c as text)'
        ].join('\n');
        // the precompiled script when it is ready, otherwise the same thing inline
        const osaArgs = colorScriptPath ? [colorScriptPath, String(c[0]), String(c[1]), String(c[2])] : ['-e', script];
        colorChild = execFile('/usr/bin/osascript', osaArgs, { timeout: 15 * 60 * 1000 }, (err, out) => {
            colorPanelOpen = false;
            colorChild = null;
            try { if (state.mainWindow && !state.mainWindow.isDestroyed()) { state.mainWindow.show(); state.mainWindow.focus(); } } catch (e) { /* ignore */ }      // the panel closed: the app is in front again
            if (err) {
                if (err.killed || err.signal || /-128|User canceled/i.test(String(err.message || err))) return resolve({ ok: true, cancelled: true });
                return resolve({ ok: false, error: String(err.message || err).split('\n')[0] });
            }
            const p = String(out || '').trim().split(',').map(x => Math.max(0, Math.min(255, Math.round(parseInt(x, 10) / 257))));
            if (p.length !== 3 || p.some(x => !Number.isFinite(x))) return resolve({ ok: false, error: 'Unexpected colour answer' });
            resolve({ ok: true, hex: '#' + p.map(x => x.toString(16).padStart(2, '0')).join('') });
        });
        };
    });
}

// Windows: the system Color dialog (the one with "Define Custom Colors"), kept in front of the panel by a hidden
// top-most owner window. It is modal, so the colour is applied when you press OK (no live preview while picking).
function pickWindowsColor(hex, resolve) {
    if (colorPanelOpen) return resolve({ ok: true, busy: true });
    colorPanelOpen = true;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    const v = m ? m[1] : 'ffffff';
    const [r, g, b] = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16));
    const ps = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$o = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0; StartPosition = "CenterScreen" }',
        '$o.Show(); $o.Activate()',
        '$d = New-Object System.Windows.Forms.ColorDialog -Property @{ FullOpen = $true; AnyColor = $true }',
        '$d.Color = [System.Drawing.Color]::FromArgb(' + r + ', ' + g + ', ' + b + ')',
        'if ($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK) { "" + $d.Color.R + "," + $d.Color.G + "," + $d.Color.B } else { "cancel" }',
        '$o.Close()'
    ].join('; ');
    colorChild = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        { timeout: 15 * 60 * 1000, windowsHide: true }, (err, out) => {
            colorPanelOpen = false;
            colorChild = null;
            try { if (state.mainWindow && !state.mainWindow.isDestroyed()) { state.mainWindow.show(); state.mainWindow.focus(); } } catch (e) { /* ignore */ }
            if (err) return resolve(err.killed || err.signal ? { ok: true, cancelled: true } : { ok: false, error: String(err.message || err).split('\n')[0] });
            const t = String(out || '').trim();
            if (/cancel/i.test(t)) return resolve({ ok: true, cancelled: true });
            const p = t.split(',').map(x => Math.max(0, Math.min(255, parseInt(x, 10))));
            if (p.length !== 3 || p.some(x => !Number.isFinite(x))) return resolve({ ok: false, error: 'Unexpected colour answer' });
            resolve({ ok: true, hex: '#' + p.map(x => x.toString(16).padStart(2, '0')).join('') });
        });
}
