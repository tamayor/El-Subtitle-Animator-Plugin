#!/usr/bin/env node
// Puts Chrome for Testing 154 (headless shell) into broll/.chrome for render.mjs.
// Why: the Chrome that Remotion 4.0.538 downloads (157) never draws a frame on this Mac (its GPU process hangs at
// start-up), so every render times out at "Waiting for root component to load". 154 renders fine.
// Copies Puppeteer's cached copy when there is one, else downloads it. Run: node setup-chrome.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '154.0.8037.57';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEST = path.join(HERE, '.chrome');
const EXE = path.join(DEST, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
if (fs.existsSync(EXE)) { console.log('Already set up:', EXE); process.exit(0); }
if (process.platform !== 'darwin' || process.arch !== 'arm64') { console.log('Only needed on Apple silicon Macs; Remotion\'s own Chrome is used here.'); process.exit(0); }
fs.mkdirSync(DEST, { recursive: true });
const cached = path.join(os.homedir(), '.cache/puppeteer/chrome-headless-shell', 'mac_arm-' + VERSION, 'chrome-headless-shell-mac-arm64');
if (fs.existsSync(cached)) {
    execFileSync('ditto', [cached, path.join(DEST, 'chrome-headless-shell-mac-arm64')]);
} else {
    const zip = path.join(DEST, 'chrome.zip');
    const url = `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/mac-arm64/chrome-headless-shell-mac-arm64.zip`;
    console.log('Downloading', url);
    execFileSync('curl', ['-fL', '--retry', '2', '-o', zip, url], { stdio: 'inherit' });
    execFileSync('ditto', ['-x', '-k', zip, DEST]);
    fs.rmSync(zip, { force: true });
}
console.log(fs.existsSync(EXE) ? 'Ready: ' + EXE : 'Could not set up Chrome in ' + DEST);
