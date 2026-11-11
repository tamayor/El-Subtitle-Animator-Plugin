// Contract tests: what other code (the panel, the MCP script, Resolve) relies on by name.
//
//   - every main-process module loads without Electron or Resolve, and exports exactly the names recorded in
//     fixtures/main-exports.json (a refactor that moves code must keep them; adding or removing one on purpose means
//     running `npm run test:update-exports` and reviewing the diff);
//   - every IPC channel the panel calls (src/preload.js) has a handler (src/main/ipc.js), and the other way round;
//   - Resolve's entry points still point at each other: manifest.xml -> main.js -> src/main.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const env = require('../helpers/env');

const EXPORTS_FILE = path.join(__dirname, '..', 'fixtures', 'main-exports.json');
// index.js starts the app when required, and workflow-integration.js is Blackmagic's native addon.
const NOT_LOADED = new Set(['index.js', 'workflow-integration.js']);

function mainModules() {
    return fs.readdirSync(env.MAIN_DIR).filter(f => f.endsWith('.js') && !NOT_LOADED.has(f)).sort();
}
function exportsNow() {
    const out = {};
    for (const f of mainModules()) {
        const m = env.main(f);
        out[f] = Object.keys(m).sort().map(k => k + ':' + typeof m[k]);
    }
    return out;
}

test('every main-process module loads and keeps its exported names', () => {
    const now = exportsNow();
    if (process.env.UPDATE_EXPORTS === '1') {
        fs.writeFileSync(EXPORTS_FILE, JSON.stringify(now, null, 2) + '\n');
        return;
    }
    const recorded = JSON.parse(fs.readFileSync(EXPORTS_FILE, 'utf8'));
    for (const f of Object.keys(recorded)) {
        assert.ok(now[f], f + ' is gone (it is recorded in test/fixtures/main-exports.json)');
        const missing = recorded[f].filter(x => !now[f].includes(x));
        assert.deepEqual(missing, [], f + ' no longer exports these');
    }
    assert.deepEqual(now, recorded, 'exports changed: run `npm run test:update-exports` if that is intended');
});

test('every IPC channel the panel calls has a handler, and every handler is reachable', () => {
    const preload = fs.readFileSync(path.join(env.ROOT, 'src', 'preload.js'), 'utf8');
    const ipc = fs.readFileSync(path.join(env.MAIN_DIR, 'ipc.js'), 'utf8');
    const called = [...new Set([...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(m => m[1]))].sort();
    const handled = [...new Set([...ipc.matchAll(/^\s+'([a-zA-Z]+:[a-zA-Z]+)'\s*:/gm)].map(m => m[1]))].sort();
    assert.ok(called.length > 50, 'the preload API was read');
    assert.deepEqual(called.filter(c => !handled.includes(c)), [], 'called by the panel but not handled');
    assert.deepEqual(handled.filter(h => !called.includes(h)), [], 'handled but not offered to the panel');
});

test('Resolve\'s entry points are in place: manifest.xml -> main.js -> src/main', () => {
    const manifest = fs.readFileSync(path.join(env.ROOT, 'manifest.xml'), 'utf8');
    const config = env.main('config');
    assert.match(manifest, /<FilePath>main\.js<\/FilePath>/);
    assert.equal(/<Id>([^<]+)<\/Id>/.exec(manifest)[1], config.PLUGIN_ID);
    assert.match(fs.readFileSync(path.join(env.ROOT, 'main.js'), 'utf8'), /require\('\.\/src\/main'\)/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(env.ROOT, 'package.json'), 'utf8')).main, 'main.js');
    for (const file of [config.PRELOAD_FILE, config.INDEX_HTML, config.BRIDGE_SCRIPT, config.PACKAGE_JSON, config.MANIFEST_XML]) {
        assert.ok(fs.existsSync(file), file + ' exists');
    }
});

test('the panel page loads only scripts and stylesheets that exist', () => {
    const dir = path.join(env.ROOT, 'src', 'renderer');
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+\.(?:js|css))"/g)].map(m => m[1]);
    assert.ok(refs.length > 60, 'the page was read');
    assert.deepEqual(refs.filter(r => !fs.existsSync(path.join(dir, r))), []);
    assert.equal(new Set(refs).size, refs.length, 'nothing is loaded twice');
});

test('every bridge operation the main process calls exists in fusion_bridge.py', () => {
    const py = fs.readFileSync(env.main('config').BRIDGE_SCRIPT, 'utf8');
    const table = py.slice(py.indexOf('\nOPS = {'), py.indexOf('\nNO_RETRY'));
    const ops = new Set([...table.matchAll(/"([a-z_0-9]+)":\s*op_/g)].map(m => m[1]));
    assert.ok(ops.size >= 40, 'the OPS table was read');
    const called = new Set();
    for (const f of fs.readdirSync(env.MAIN_DIR).filter(n => n.endsWith('.js'))) {
        const src = fs.readFileSync(path.join(env.MAIN_DIR, f), 'utf8');
        for (const m of src.matchAll(/\bbridge(?:Call|Lane|Render)?\(\s*'([a-z_0-9]+)'/g)) called.add(m[1]);
    }
    assert.ok(called.size > 20, 'bridge calls were found');
    assert.deepEqual([...called].filter(op => !ops.has(op)), []);
});
