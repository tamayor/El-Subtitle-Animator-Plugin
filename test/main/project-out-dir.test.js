'use strict';
// sfx-import.projectOutDir: every render the app or MCP makes (B-roll, MatchCut, Spotlight, Collage) goes beside the
// project's own files - the main folder from _app/project-roots.json, else the footage folder - never quietly into
// the app's data folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const env = require('../helpers/env');

const { APP_DATA_DIR, DATA_DIR } = env.main('config');
const { projectOutDir, isOwnDir } = env.main('sfx-import');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elsa-outdir-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp */ } });
const ROOTS = path.join(APP_DATA_DIR, 'project-roots.json');
function setRoots(r) { fs.mkdirSync(APP_DATA_DIR, { recursive: true }); fs.writeFileSync(ROOTS, JSON.stringify(r)); }

const clip = (p) => ({ GetClipProperty: async () => p, GetMediaPoolItem: async () => clip(p) });
// timelineClips: files on the timeline; poolClips: files in the Media Pool root bin
function project(name, timelineClips, poolClips) {
    const tl = {
        GetUniqueId: async () => 'tl-' + name,
        GetTrackCount: async (k) => (k === 'video' ? 1 : 0),
        GetItemListInTrack: async () => timelineClips.map(clip),
    };
    const root = { GetClipList: async () => poolClips.map(clip), GetSubFolderList: async () => [] };
    return {
        GetName: async () => name,
        GetCurrentTimeline: async () => tl,
        GetMediaPool: async () => ({ GetRootFolder: async () => root }),
    };
}

test('the project main folder wins', async () => {
    const root = path.join(tmp, 'main');
    fs.mkdirSync(root);
    setRoots({ 'My Show': root });
    const r = await projectOutDir(project('my show', [], []), 'El Subtitle Animator B-roll');
    assert.deepEqual(r, { dir: path.join(root, 'El Subtitle Animator B-roll'), fallback: false });
    assert.ok(fs.existsSync(r.dir));
});

test('a main folder on an unmounted drive throws instead of writing elsewhere', async () => {
    setRoots({ 'Gone': path.join(tmp, 'not-mounted') });
    await assert.rejects(projectOutDir(project('Gone', [], []), 'El Subtitle Animator B-roll'), /not there/);
});

test('no main folder: the footage folder; own renders are not footage', async () => {
    setRoots({});
    const foot = path.join(tmp, 'footage');
    fs.mkdirSync(foot);
    const own = path.join(foot, 'El Subtitle Animator B-roll');
    const r = await projectOutDir(project('A', [path.join(foot, 'a.mov'), path.join(own, 'x.mov'), path.join(own, 'y.mov')], []), 'El Subtitle Animator MatchCut');
    assert.deepEqual(r, { dir: path.join(foot, 'El Subtitle Animator MatchCut'), fallback: false });
});

test('empty timeline: the Media Pool footage folder', async () => {
    setRoots({});
    const foot = path.join(tmp, 'pool');
    fs.mkdirSync(foot);
    const r = await projectOutDir(project('B', [], [path.join(foot, 'a.mov'), path.join(foot, 'b.mov')]), 'El Subtitle Animator Spotlight');
    assert.equal(r.dir, path.join(foot, 'El Subtitle Animator Spotlight'));
    assert.equal(r.fallback, false);
});

test('no media at all: the app data folder, flagged', async () => {
    setRoots({});
    const r = await projectOutDir(project('C', [], []), 'El Subtitle Animator B-roll');
    assert.deepEqual(r, { dir: path.join(DATA_DIR, 'El Subtitle Animator B-roll'), fallback: true });
});

test('isOwnDir', () => {
    assert.ok(isOwnDir('/x/El Subtitle Animator SFX'));
    assert.ok(isOwnDir('/x/El Subtitle Animator Spotlight/abc'));
    assert.ok(isOwnDir(path.join(DATA_DIR, 'sounds')));
    assert.ok(!isOwnDir('/x/footage/Cam A'));
});
