'use strict';
// names.js: the plugin's names on disk, and the ones it had as "El Subtitle Animator". New things get the current
// name; what an earlier version made is found (or, for the plugin's own template folders, renamed once).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const env = require('../helpers/env');

const N = env.main('names');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elsa-names-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp */ } });

test('the earlier name of a folder or bin', () => {
    assert.equal(N.oldName('Framelly SFX'), 'El Subtitle Animator SFX');
    assert.equal(N.oldName('Framelly'), 'El Subtitle Animator');
    assert.equal(N.oldName('Framelly2'), 'Framelly2');
    assert.ok(N.sameName('El Subtitle Animator MatchCut', 'Framelly MatchCut'));
    assert.ok(N.sameName('Framelly MatchCut', 'Framelly MatchCut'));
    assert.ok(!N.sameName('Framelly SFX', 'Framelly MatchCut'));
});

test('existingOr: the old folder only when it is the one there', () => {
    const cur = path.join(tmp, 'a', 'new'), old = path.join(tmp, 'a', 'old');
    assert.equal(N.existingOr(cur, old), cur);          // neither: the current name
    fs.mkdirSync(old, { recursive: true });
    assert.equal(N.existingOr(cur, old), old);
    fs.mkdirSync(cur);
    assert.equal(N.existingOr(cur, old), cur);          // both: the current name
});

test('adoptOldDir renames the old folder once and never overwrites', () => {
    const cur = path.join(tmp, 'b', 'Framelly'), old = path.join(tmp, 'b', 'Subtitle Animator');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'x.setting'), 'x');
    assert.equal(N.adoptOldDir(cur, old), cur);
    assert.ok(!fs.existsSync(old));
    assert.equal(fs.readFileSync(path.join(cur, 'x.setting'), 'utf8'), 'x');
    fs.mkdirSync(old);
    fs.writeFileSync(path.join(old, 'y.setting'), 'y');
    N.adoptOldDir(cur, old);
    assert.ok(fs.existsSync(path.join(old, 'y.setting')) && !fs.existsSync(path.join(cur, 'y.setting')));
});

test('the installer uses the same names', () => {
    const E = require('../../installer/shared/env');
    const config = env.main('config');
    assert.equal(E.PLUGIN_ID, config.PLUGIN_ID);
    assert.equal(E.DATA_FOLDER_NAME, N.APP_NAME);
    assert.equal(E.OLD_DATA_FOLDER_NAME, N.OLD_APP_NAME);
    assert.equal(E.CODE_FOLDER_NAME, N.CODE_FOLDER_NAME);
    assert.equal(E.OLD_CODE_FOLDER_NAME, N.OLD_CODE_FOLDER_NAME);
    assert.equal(path.basename(N.existingOr(path.join(tmp, E.HOME_FOLDER_NAME), path.join(tmp, E.OLD_HOME_FOLDER_NAME))), '.framelly');
    assert.ok(E.OLD_PLUGIN_IDS.includes('com.el.subtitleanimator') && !E.OLD_PLUGIN_IDS.includes(E.PLUGIN_ID));
});

test('the installer finds a code folder and a data folder that still have the earlier names', () => {
    const E = require('../../installer/shared/env');
    const main = path.join(tmp, 'main');
    const code = path.join(main, E.OLD_CODE_FOLDER_NAME);
    fs.mkdirSync(path.join(code, 'src', 'main'), { recursive: true });
    fs.writeFileSync(path.join(code, 'manifest.xml'), '<Id>' + E.PLUGIN_ID + '</Id>');
    fs.writeFileSync(path.join(code, 'main.js'), '');
    assert.equal(E.findCodeDir([main]), code);
    assert.equal(E.locations(code).dataDir, path.join(main, E.DATA_FOLDER_NAME));           // none yet: the current name
    fs.mkdirSync(path.join(main, E.OLD_DATA_FOLDER_NAME));
    assert.equal(E.locations(code).dataDir, path.join(main, E.OLD_DATA_FOLDER_NAME));
});
