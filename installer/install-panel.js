#!/usr/bin/env node
// Installs the panel into DaVinci Resolve from Terminal, without opening the installer app:
//   npm run install-panel          (in the code folder)
// The same step as the app's "El Subtitle Animator panel" item. For the rest (Claude Code, tools, engines) open the app.

const path = require('path');
const E = require('./shared/env');
const P = require('./shared/platform');
const PLUGIN = require('./shared/plugin');

(async () => {
    const codeDir = E.findCodeDir([path.join(__dirname, '..')]);
    if (!codeDir) throw new Error('The plugin\'s code folder was not found above ' + __dirname);
    const ctx = { ...E.locations(codeDir), paths: P.resolvePaths() };
    await PLUGIN.ITEM.install(ctx, (text) => console.log(text));
    const after = await PLUGIN.ITEM.detect(ctx);
    if (after.state !== 'ok') throw new Error(after.note);
    console.log('Quit DaVinci Resolve completely and reopen it, then choose:\n  Workspace > Workflow Integrations > El Subtitle Animator');
})().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
