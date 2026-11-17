// Builds the installer app and puts it in the main folder, beside the code and data folders.
//   npm run build                 for this computer
//   npm run build -- win32 x64    for Windows: one "Install El Subtitle Animator.exe"

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const MAIN = path.resolve(HERE, '..', '..');
const NAME = 'Install El Subtitle Animator';
const APP_ID = 'com.el.subtitleanimator.installer';

(async () => {
    const { packager } = require('@electron/packager');
    const platform = process.argv[2] || process.platform;
    const arch = process.argv[3] || process.arch;
    const [dir] = await packager({
        dir: HERE, out: path.join(HERE, 'dist'), overwrite: true, platform, arch,
        name: NAME, executableName: NAME, appBundleId: APP_ID, asar: true, prune: true,
        win32metadata: { CompanyName: 'El Subtitle Animator', FileDescription: NAME, ProductName: NAME },
        icon: platform === 'win32' ? path.join(HERE, 'windows', 'icon.ico') : path.join(HERE, 'mac', 'icon.icns'),
        ignore: [/^\/dist($|\/)/, /^\/icon($|\/)/, /^\/build\.js$/, /^\/package-lock\.json$/],
    });
    if (platform === 'win32') {
        // One .exe for the main folder: it unpacks the app folder (kept in dist/) to a temporary place and starts it.
        const builder = require('electron-builder');
        const out = path.join(HERE, 'dist', 'windows-portable');
        fs.rmSync(out, { recursive: true, force: true });
        const [exe] = await builder.build({
            targets: builder.Platform.WINDOWS.createTarget('portable', arch === 'arm64' ? builder.Arch.arm64 : builder.Arch.x64),
            prepackaged: dir, projectDir: HERE,
            config: {
                appId: APP_ID, productName: NAME, directories: { output: out },
                toolsets: { nsis: '1.2.1' },          // this NSIS bundle also runs on Apple silicon Macs
                win: { signAndEditExecutable: false, icon: path.join(HERE, 'windows', 'icon.ico') },
                portable: { artifactName: NAME + '.exe' },
            },
        });
        const dest = path.join(MAIN, NAME + '.exe');
        fs.copyFileSync(exe, dest);
        console.log('Built ' + dest);
        return;
    }
    if (platform !== 'darwin') { console.log('Built ' + dir); return; }
    const built = path.join(dir, NAME + '.app');
    const dest = path.join(MAIN, NAME + ' (Mac).app');
    fs.rmSync(dest, { recursive: true, force: true });
    execFileSync('/usr/bin/ditto', [built, dest]);          // keeps the app's signature and links
    console.log('Built ' + dest);
})().catch((e) => { console.error(e); process.exit(1); });
