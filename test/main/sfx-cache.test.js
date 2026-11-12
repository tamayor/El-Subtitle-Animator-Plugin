'use strict';
// The trim cache (_app/sfx-cache) is cleared at start-up and every six hours by index.js, and on every trim save.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const env = require('../helpers/env');

const { SFX_CACHE_DIR } = env.main('config');
const { pruneSfxCache } = env.main('sfx');

function put(name, ageDays) {
    const file = path.join(SFX_CACHE_DIR, name);
    fs.writeFileSync(file, 'x');
    const t = new Date(Date.now() - ageDays * 86400000);
    fs.utimesSync(file, t, t);
    return file;
}

test('pruneSfxCache is exported for the start-up clean-up in index.js', () => {
    assert.equal(typeof pruneSfxCache, 'function');
});

test('pruneSfxCache removes clips older than a day and keeps recent ones', () => {
    assert.ok(SFX_CACHE_DIR.startsWith(env.DATA_DIR), 'the cache must be inside the temporary data folder');
    fs.rmSync(SFX_CACHE_DIR, { recursive: true, force: true });
    assert.equal(pruneSfxCache(), 0, 'a missing folder is not an error');
    fs.mkdirSync(SFX_CACHE_DIR, { recursive: true });
    const fresh = put('fresh (trim aaaaaaaa).wav', 0);
    const old = put('old (trim bbbbbbbb).wav', 2);
    assert.equal(pruneSfxCache(), 1);
    assert.ok(fs.existsSync(fresh));
    assert.ok(!fs.existsSync(old));
});

test('pruneSfxCache keeps only the 80 newest clips', () => {
    fs.rmSync(SFX_CACHE_DIR, { recursive: true, force: true });
    fs.mkdirSync(SFX_CACHE_DIR, { recursive: true });
    for (let i = 0; i < 85; i++) put('clip ' + String(i).padStart(2, '0') + '.wav', i / 100000);
    assert.equal(pruneSfxCache(), 5);
    const left = fs.readdirSync(SFX_CACHE_DIR).sort();
    assert.equal(left.length, 80);
    assert.equal(left[0], 'clip 00.wav');
    assert.equal(left[79], 'clip 79.wav');
});
