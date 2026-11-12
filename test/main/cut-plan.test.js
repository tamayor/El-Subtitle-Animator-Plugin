// The panel's pause rules (src/renderer/js/library/cut-plan.js) must cut like the analysis (src/python/auto_cut.py):
// both are run on the same made-up clip, with several pause settings. Skipped when no Python with numpy is around.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('../../src/renderer/js/library/cut-plan.js');

const PY = `
import json, sys
sys.path.insert(0, sys.argv[1])
import auto_cut as ac
np = ac.np
req = json.loads(sys.stdin.read())
db = np.full(int(req["dur"] * 100), -70.0, np.float32)
for a, b in req["speech"]:
    db[int(a * 100):int(b * 100)] = -25.0
for t in req["clicks"]:
    db[int(t * 100):int(t * 100) + 3] = -25.0
out = []
for s in req["settings"]:
    p = dict(ac.DEFAULTS); p.update(s)
    pl = ac.plan_keeps(db, p, req["words"], req["dur"])
    keeps = ac.subtract(pl["keeps"], req["drops"])
    out.append({"frames": ac.snap(keeps, req["fps"], req["dur"], p["minPiece"]), "speech": pl["speech"], "gapf": pl["gapf"],
                "cuts": [[c["kind"], c["a"], c["b"]] for c in pl["cuts"]]})
print(json.dumps(out))
`;

const REQ = {
    dur: 30, fps: 25,
    speech: [[1.2, 3.0], [3.3, 5.0], [6.4, 8.0], [9.5, 12.0], [12.6, 14.0], [17.0, 19.5], [21.0, 26.0]],
    clicks: [15.5, 20.2],
    words: [{ a: 1.2, b: 3.0, w: 'One two.' }, { a: 3.3, b: 5.0, w: 'three' }, { a: 6.4, b: 8.0, w: 'four.' }, { a: 9.5, b: 14.0, w: 'stretched' },
        { a: 17.0, b: 19.5, w: 'five!' }, { a: 21.0, b: 26.0, w: 'six' }],
    drops: [{ a: 6.3, b: 8.2 }],
    settings: [
        { maxPause: 0.26, pauseKeep: 0.18, sentenceKeep: 0.25, headLead: 0.10, tailKeep: 0.18 },
        { maxPause: 0.50, pauseKeep: 0.30, sentenceKeep: 0.45, headLead: 0.15, tailKeep: 0.30 },
        { maxPause: 1.00, pauseKeep: 0.50, sentenceKeep: 0.70, headLead: 0.25, tailKeep: 0.45 },
        { maxPause: 1.45, pauseKeep: 1.20, sentenceKeep: 0.04, headLead: 0, tailKeep: 3 }
    ]
};

function python() {
    for (const py of ['python3', '/opt/anaconda3/bin/python3', '/opt/homebrew/bin/python3', '/usr/bin/python3']) {
        const r = spawnSync(py, ['-c', 'import numpy'], { timeout: 20000 });
        if (r.status === 0) return py;
    }
    return null;
}

test('the panel cuts pauses exactly like auto_cut.py', (t) => {
    const py = python();
    if (!py) { t.skip('no Python with numpy'); return; }
    const r = spawnSync(py, ['-B', '-c', PY, path.join(__dirname, '../../src/python')], { input: JSON.stringify(REQ), timeout: 60000 });
    assert.strictEqual(r.status, 0, String(r.stderr));
    const want = JSON.parse(String(r.stdout));
    REQ.settings.forEach((s, i) => {
        const c = { dur: REQ.dur, fps: REQ.fps, speech: want[i].speech, gapf: want[i].gapf };
        const got = P.cutPlanClip(c, s, REQ.drops, null);
        assert.deepStrictEqual(got.frames, want[i].frames, 'pieces, settings ' + i);
        assert.deepStrictEqual(got.cuts.map(x => [x.kind, Math.round(x.a * 1000) / 1000, Math.round(x.b * 1000) / 1000]), want[i].cuts, 'cuts, settings ' + i);
    });
    assert.ok(want[1].frames.length > 2, 'the clip is really cut');
});

test('your own cuts and keeps', () => {
    const c = { dur: 10, fps: 25, speech: [[1, 3], [5, 8]], gapf: [[0, 0, -1, -1]] };
    const p = { maxPause: 0.5, pauseKeep: 0.3, sentenceKeep: 0.45, headLead: 0.1, tailKeep: 0.2 };
    assert.deepStrictEqual(P.cutPlanClip(c, p, [], null).frames, [[23, 79], [122, 205]]);
    // keeping the pause joins the two pieces; cutting 6-7 s splits the second
    assert.deepStrictEqual(P.cutPlanClip(c, p, [], { keep: [[3.18, 4.88]], cut: [] }).frames, [[23, 205]]);
    assert.deepStrictEqual(P.cutPlanClip(c, p, [], { keep: [], cut: [[6, 7]] }).frames, [[23, 79], [122, 150], [175, 205]]);
    assert.deepStrictEqual(P.cutPlanUnion([[0, 1], [3, 4]], [[0.5, 3.2]]), [[0, 4]]);
});

test('pieces without words go (same case as test_auto_cut.py)', () => {
    const words = [[1.0, 2.0, 'Hello'], [5.0, 5.4, 'Yeah.'], [8.0, 9.0, 'there']];
    const r = P.cutPlanWordless([[0.9, 2.2], [3.0, 3.4], [4.6, 4.95], [5.48, 5.8], [7.9, 9.2]], words, [{ a: 4.95, b: 5.48 }]);
    assert.deepStrictEqual(r.stay, [[0.9, 2.2], [7.9, 9.2]]);
    assert.deepStrictEqual(r.gone, [[3.0, 3.4], [4.6, 4.95], [5.48, 5.8]]);
});
