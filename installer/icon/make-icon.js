// Draws icon.svg into icon.png (1024 px), ../windows/icon.ico and ../mac/icon.icns. Run after changing icon.svg:  npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
    const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
    const page = '<body style="margin:0;background:transparent;overflow:hidden">' + svg.replace('<svg ', '<svg width="1024" height="1024" style="display:block" ') + '</body>';
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
    await new Promise(r => setTimeout(r, 300));
    const image = (await win.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: 'best' });
    const png = path.join(__dirname, 'icon.png');
    fs.writeFileSync(png, image.toPNG());
    // icon.ico: a small header, then one PNG per size (Windows reads PNG entries).
    const pngs = [16, 24, 32, 48, 64, 128, 256].map(s => ({ s, data: image.resize({ width: s, height: s, quality: 'best' }).toPNG() }));
    const head = Buffer.alloc(6 + 16 * pngs.length);
    head.writeUInt16LE(1, 2);
    head.writeUInt16LE(pngs.length, 4);
    let at = head.length;
    pngs.forEach((p, i) => {
        const o = 6 + 16 * i;
        head.writeUInt8(p.s === 256 ? 0 : p.s, o);
        head.writeUInt8(p.s === 256 ? 0 : p.s, o + 1);
        head.writeUInt16LE(1, o + 4);
        head.writeUInt16LE(32, o + 6);
        head.writeUInt32LE(p.data.length, o + 8);
        head.writeUInt32LE(at, o + 12);
        at += p.data.length;
    });
    fs.writeFileSync(path.join(__dirname, '..', 'windows', 'icon.ico'), Buffer.concat([head, ...pngs.map(p => p.data)]));
    if (process.platform === 'darwin') {
        const set = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'elsa-icon-')), 'icon.iconset');
        fs.mkdirSync(set);
        for (const s of [16, 32, 128, 256, 512]) {
            execFileSync('/usr/bin/sips', ['-z', String(s), String(s), png, '--out', path.join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
            execFileSync('/usr/bin/sips', ['-z', String(s * 2), String(s * 2), png, '--out', path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
        }
        execFileSync('/usr/bin/iconutil', ['-c', 'icns', set, '-o', path.join(__dirname, '..', 'mac', 'icon.icns')]);
        fs.rmSync(path.dirname(set), { recursive: true, force: true });
    }
    console.log('Wrote icon.png, windows/icon.ico' + (process.platform === 'darwin' ? ' and mac/icon.icns' : ''));
    app.exit(0);
});
