// Presets as Resolve title templates.
//
// Every preset is written to Resolve's Titles folder as a Fusion title template and inserted by name, so the placed
// clip is a real Resolve title whose Edit-page Inspector works (see "Presets are inserted as Resolve title templates"
// in README.md). This module names, writes, renames and prunes those template files and answers questions about a
// preset that are read from its file: Text+ or MultiText, its output tool, its row controls, its typing length.

module.exports = {
    inspectorSafeComp, installAllTemplates, isTitleClipName, presetHasRowControls, presetOutputFor, presetTitleFor, presetTitleNames,
    pruneTemplates, startupTemplates, syncTemplates, tailFor, templateAgeMs, titleKindFor, titlesDir, typingFramesFor
};

const path = require('path');
const fs = require('fs');
const os = require('os');

const state = require('./state');
const { ANIM_DIR } = require('./config');
const { blockEnd, derived, detectNodes, expandAllTools, presetText } = require('./fusion-setting');
const { dlog } = require('./log');
const { upgradeRetiming } = require('./retime');
const { hideAddons } = require('./addon-controls');
const PERF = require('./perf');

// Which title a preset needs: a preset built on a MultiText tool is created as a MultiText clip, everything else as Text+.
// Resolve's Edit-page Inspector stays EMPTY for a Fusion title whose comp contains an OFX node (e.g. the ResolveFX Stop Motion).
// Stop Motion is swapped for a native TimeStretcher whose SourceTime steps in blocks of N frames (floor(time/N)*N), so
// every Nth frame is held: the same stepped look, and the Inspector keeps working. (A TimeSpeed with a fmod Delay was
// used before; it evaluates but Resolve renders every frame anyway, so the wiggle played smooth.)
// Every tool is also saved as expanded and shown in the Inspector (see expandAllTools), so the settings show straight
// away when the clip is selected.
// The preset file on disk is never changed; the adjusted copy is written to a temp folder and imported instead.

function ofxNames(txt) { const r = [], re = /ofx\.com\.blackmagicdesign\.resolvefx\.(\w+)\s*\{/g; let m; while ((m = re.exec(txt))) r.push(m[1]); return r; }

// The adjusted text of a preset (expanded tools, Stop Motion made native), worked out once per file version.
function safeCompText(compPath) {
    const c = presetText(compPath);
    if (!c) return null;
    const r = derived(compPath, 'safe', (orig) => ({ orig, text: stopMotionToNative(expandAllTools(orig)), ofx: ofxNames(orig).filter(n => n !== 'StopMotion') }));
    state.ofxLeft.set(compPath, r.ofx);
    return r;
}
function inspectorSafeComp(compPath) {
    try {
        const r = safeCompText(compPath);
        if (!r) return compPath;
        return r.text === r.orig ? compPath : writeSafeComp(compPath, r.text);
    } catch (e) { return compPath; }
}

// The stop-motion stand-in: a TimeStretcher whose SourceTime steps in blocks of n frames. inp = [SourceOp, Source] or null.
function stopMotionTool(name, n, inp, view) {
    return name + ' = TimeStretcher {\n\t\t\tInputs = {\n' +
        '\t\t\t\tSourceTime = Input { Value = 0, Expression = "floor(time/' + n + ')*' + n + '", },\n' +
        '\t\t\t\tInterpolateBetweenFrames = Input { Value = 0, },\n' +
        (inp ? '\t\t\t\tInput = Input { SourceOp = "' + inp[0] + '", Source = "' + inp[1] + '", },\n' : '') +
        '\t\t\t},\n' + (view ? '\t\t\t' + view + ',\n' : '') + '\t\t}';
}
// Replaces every tool block matched by `re` (group 1 = tool name) with what make(name, block) returns (null = keep).
function replaceTools(s, re, make) {
    let m, out = '', last = 0;
    re.lastIndex = 0;
    while ((m = re.exec(s))) {
        const open = m.index + m[0].length - 1;
        const close = blockEnd(s, open);
        const rep = make(m[1], s.slice(m.index, close + 1));
        if (rep !== null) { out += s.slice(last, m.index) + rep; last = close + 1; }
        re.lastIndex = close + 1;
    }
    return last ? out + s.slice(last) : s;
}
// ResolveFX Stop Motion (OFX, empties the Inspector) and the older TimeSpeed stand-in (Delay = math.fmod(time, n), which
// Resolve renders unheld, so the wiggle played smooth) both become the TimeStretcher stand-in. A Stop Motion that is
// not connected to anything is converted too, so no OFX node is left behind.
function stopMotionToNative(s) {
    const viewOf = (b) => { const v = /ViewInfo\s*=\s*OperatorInfo\s*\{\s*Pos\s*=\s*\{[^}]*\}\s*\}/.exec(b); return v ? v[0] : null; };
    s = replaceTools(s, /([A-Za-z_]\w*)\s*=\s*ofx\.com\.blackmagicdesign\.resolvefx\.StopMotion\s*\{/g, (name, b) => {
        const src = /Source\s*=\s*Input\s*\{\s*SourceOp\s*=\s*"([^"]+)"\s*,\s*Source\s*=\s*"([^"]+)"/.exec(b);
        const rep = /frameRepeat\s*=\s*Input\s*\{\s*Value\s*=\s*([\d.]+)/.exec(b);
        return stopMotionTool(name, Math.max(1, Math.round(rep ? parseFloat(rep[1]) : 2)), src ? [src[1], src[2]] : null, viewOf(b));
    });
    s = replaceTools(s, /([A-Za-z_]\w*)\s*=\s*TimeSpeed\s*\{/g, (name, b) => {
        const fm = /Delay\s*=\s*Input\s*\{[^{}]*Expression\s*=\s*"math\.fmod\(time,\s*(\d+)\)"/.exec(b);
        if (!fm) return null;      // a TimeSpeed of the preset's own
        const src = /\bInput\s*=\s*Input\s*\{\s*SourceOp\s*=\s*"([^"]+)"\s*,\s*Source\s*=\s*"([^"]+)"/.exec(b);
        return stopMotionTool(name, Math.max(1, parseInt(fm[1], 10)), src ? [src[1], src[2]] : null, viewOf(b));
    });
    return s;
}

function writeSafeComp(compPath, out) {
    try {
        const dir = path.join(os.tmpdir(), 'sa-safe-comps');
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, require('crypto').createHash('md5').update(compPath).digest('hex').slice(0, 10) + '-' + path.basename(compPath));
        fs.writeFileSync(f, out);
        return f;
    } catch (e) { return compPath; }
}

// The frames a clip runs past its caption ("Ends" in the Alignment timeline). A MultiText clip never runs past the
// caption: its tail is cut to 0 (a negative one, ending early, is kept).
function tailFor(req, anim) {
    const t = Number(req && req.tail) || 0;
    if (t > 0 && anim && anim.file && titleKindFor(path.join(ANIM_DIR, anim.file)) === 'multitext') return 0;
    return t;
}
function titleKindFor(compPath) {
    try { return detectNodes(compPath).some(n => n.kind === 'multitext') ? 'multitext' : 'text'; } catch (e) { return 'text'; }
}
// ------------------------------------------------------------------ presets as Resolve title templates
// Resolve's Edit-page Inspector only shows a Fusion title's controls for a title Resolve built itself. Once the clip's
// comp is replaced (ImportFusionComp, even with the clip's own exported comp), the Inspector shows only a folded
// "Text+" header. So each preset is installed as a Fusion title template (Edit/Titles/Subtitle Animator/<name>.setting)
// and inserted by name with InsertFusionTitleIntoTimeline: the clip is then a real Resolve title with working controls.
// Resolve picks up a new or rewritten template file straight away. The name starts with "Text+" / "MultiText", so
// isTitleClipName and cutSnapshot still recognise the clip.
function titlesDir() {
    const tail = ['Fusion', 'Templates', 'Edit', 'Titles', 'Subtitle Animator'];
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve', ...tail);
    if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Blackmagic Design', 'DaVinci Resolve', 'Support', ...tail);
    return path.join(os.homedir(), '.local', 'share', 'DaVinciResolve', ...tail);
}
// A title template is a .setting ({ Tools = ordered() { ... } }); a .comp preset is cut down to its tool list.
function asSetting(s) {
    if (!/^\s*Composition\s*\{/.test(s)) return s;
    const m = /\n\s*Tools\s*=\s*(?:ordered\(\)\s*)?\{/.exec(s);      // the first Tools list is the comp's own (group ones come later)
    if (!m) return null;
    const open = m.index + m[0].length - 1;
    return '{\n\tTools = ordered() ' + s.slice(open, blockEnd(s, open) + 1) + '\n}\n';
}
// Tool types that are modifiers / splines / annotations, not image tools: never a preset's final output.
const NOT_OUTPUT = /^(BezierSpline|CubicSpline|LUTBezier|PolyPath|XYPath|Path|StyledTextFollower|Follower|PerturbNumber|PerturbPoint|Calculation|Expression|CoordinateTransform|Shake|KeyStretcher|Probe|Offset|PublishNumber|PublishPoint|PublishText|PublishPolyLine|PublishImage|Note|Underlay|MediaOut|Saver)$/;
// A preset without a MediaOut (e.g. nodes copied out of the Fusion page, or a macro) gets one, connected to its final
// tool: Resolve adds an UNCONNECTED MediaOut when it inserts such a template (a black clip), and the MediaOut here is
// what presetOutputFor / set_output use to connect it. The final tool is the one image tool nothing else reads from
// (the ActiveTool when there are several). Left as it is when that cannot be told.
function withOutput(s) {
    if (/\b[A-Za-z_]\w*\s*=\s*(?:MediaOut|Saver)\s*\{/.test(s)) return s;
    const m = /\bTools\s*=\s*(?:ordered\(\)\s*)?\{/.exec(s);
    if (!m) return s;
    const listOpen = m.index + m[0].length - 1, listClose = blockEnd(s, listOpen);
    const tools = [];      // the list's direct children: Name = Type {
    const toolRe = /([A-Za-z_]\w*)\s*=\s*([A-Za-z_][\w.]*)\s*\{/y;
    for (let k = listOpen + 1; k < listClose; k++) {
        if (!/[A-Za-z_]/.test(s[k]) || /\w/.test(s[k - 1])) continue;
        toolRe.lastIndex = k;
        const t = toolRe.exec(s);
        if (!t) continue;
        tools.push({ name: t[1], type: t[2] });
        k = blockEnd(s, k + t[0].length - 1);
    }
    const used = new Set();
    for (const r of s.matchAll(/SourceOp\s*=\s*"([^"]+)"/g)) used.add(r[1]);
    const ends = tools.filter(t => !used.has(t.name) && !NOT_OUTPUT.test(t.type));
    const act = /\bActiveTool\s*=\s*"([^"]+)"/.exec(s);
    const end = ends.length === 1 ? ends[0] : ends.find(t => act && t.name === act[1]);
    if (!end || /^(MacroOperator|GroupOperator)$/.test(end.type)) return s;      // Resolve wires a macro title itself
    const mo = '\t\tMediaOut1 = MediaOut {\n\t\t\tInputs = {\n\t\t\t\tIndex = Input { Value = "0", },\n' +
        '\t\t\t\tInput = Input { SourceOp = "' + end.name + '", Source = "Output", },\n\t\t\t},\n\t\t}';
    const before = s.slice(0, listClose).replace(/\s*$/, '');
    return before + (before.endsWith(',') || before.endsWith('{') ? '\n' : ',\n') + mo + '\n\t' + s.slice(listClose);
}
// The template name for a preset: "Text+ <name>" / "MultiText <name>", from the preset's name in the panel (the file
// name when it has none), so Resolve's Titles list matches the plugin's preset list.
function cleanTitle(s) {
    return String(s || '').replace(/[^\w ()&+,.'-]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim();
}
function presetTitleName(compPath, presetName) {
    const base = cleanTitle(presetName) || cleanTitle(path.basename(compPath).replace(/\.(setting|comp)$/i, '')) || 'Preset';
    return (titleKindFor(compPath) === 'multitext' ? 'MultiText ' : 'Text+ ') + base;
}
// Template names of every preset whose file exists, by preset id. Two presets with the same name get " 2", " 3", ...
// in library order (compared without case: the macOS file system ignores it). animations: library.json entries.
// Remembered for the same list of (id, name, file, file version): called per apply, per Clip-controls read and per
// template sync, and it used to read every preset file each time.
const titleNamesMemo = { key: '', map: null };
function presetTitleNames(animations) {
    const sp = PERF.span('place.presetTitleNames');
    const parts = [];
    for (const a of animations || []) {
        if (!a || !a.file) continue;
        const c = presetText(path.join(ANIM_DIR, a.file));
        parts.push(a.id + '\u0001' + a.name + '\u0001' + a.file + '\u0001' + (c ? c.key : '-'));
    }
    const key = parts.join('\u0002');
    if (titleNamesMemo.map && titleNamesMemo.key === key) { sp.end({ cached: true }); return new Map(titleNamesMemo.map); }
    const out = new Map(), used = new Set();
    for (const a of animations || []) {
        try {
            const f = path.join(ANIM_DIR, a.file);
            if (!a.file || !presetText(f)) continue;
            const base = presetTitleName(f, a.name);
            let name = base, n = 2;
            while (used.has(name.toLowerCase())) name = base + ' ' + n++;
            used.add(name.toLowerCase());
            out.set(a.id, name);
        } catch (e) { /* skip */ }
    }
    titleNamesMemo.key = key; titleNamesMemo.map = new Map(out);
    sp.end({ cached: false, n: out.size });
    return out;
}
// Deletes the templates of presets that are gone (removed, file replaced) from the plugin's own template folder, so
// they do not stay in Resolve's Titles list. animations: every preset in the library. Only *.setting files in that
// folder are touched. Clips already made from a deleted template keep working (the project holds their comp).
function pruneTemplates(animations) {
    const removed = [];
    try {
        const dir = titlesDir();
        if (!fs.existsSync(dir)) return removed;
        const keep = new Set([...presetTitleNames(animations).values()].map(n => (n + '.setting').toLowerCase()));
        for (const f of fs.readdirSync(dir)) {
            if (!/\.setting$/i.test(f) || keep.has(f.toLowerCase())) continue;
            try { fs.unlinkSync(path.join(dir, f)); removed.push(f); } catch (e) { /* in use or gone */ }
        }
        if (removed.length) dlog('TEMPLATES-PRUNED', removed);
    } catch (e) { dlog('TEMPLATES-PRUNE-FAIL', String(e && e.message || e)); }
    return removed;
}
// Keeps Resolve's Titles list in step with the library after presets are renamed, removed or replaced.
// before: presetTitleNames() taken before the change. A template whose preset got a new name is renamed (Resolve
// shows the new name straight away); templates of presets that are gone are deleted.
function syncTemplates(animations, before) {
    try {
        const dir = titlesDir();
        const after = presetTitleNames(animations);
        const moves = [];
        for (const [id, oldName] of (before || new Map())) {
            const newName = after.get(id);
            if (newName && newName !== oldName && fs.existsSync(path.join(dir, oldName + '.setting'))) moves.push([oldName, newName]);
        }
        // Two steps through a temporary name, so swapped or case-only renames never overwrite each other.
        const tmp = moves.map(([o], i) => {
            const t = path.join(dir, '.sa-rename-' + i + '-' + Date.now() + '.tmp');
            try { fs.renameSync(path.join(dir, o + '.setting'), t); return t; } catch (e) { return null; }
        });
        moves.forEach(([o, n], i) => {
            if (!tmp[i]) return;
            try { fs.renameSync(tmp[i], path.join(dir, n + '.setting')); } catch (e) { try { fs.unlinkSync(tmp[i]); } catch (e2) { /* gone */ } }
            if (state.presetTpl) state.presetTpl.delete(o);      // its cached Media Pool title belongs to the old name
            dlog('TEMPLATE-RENAMED', o, '->', n);
        });
    } catch (e) { dlog('TEMPLATES-SYNC-FAIL', String(e && e.message || e)); }
    const removed = pruneTemplates(animations);
    installAllTemplates(animations);
    return removed;
}
// Writes the title template of every preset whose file exists (presetTitleFor), so each one is installed - and scanned
// by Resolve - long before its first use. Written only on first use, a template could still be unknown to Resolve at
// that moment; the clip then fell back to a plain title with an empty Inspector. Returns the names written or refreshed.
function installAllTemplates(animations) {
    const done = [];
    try {
        const names = presetTitleNames(animations);
        for (const a of animations || []) {
            const name = names.get(a.id);
            if (!name) continue;
            const f = path.join(ANIM_DIR, a.file);
            const file = path.join(titlesDir(), name + '.setting');
            const had = fs.existsSync(file);
            let before = null;
            try { before = had ? fs.statSync(file).mtimeMs : null; } catch (e) { /* ignore */ }
            if (presetTitleFor(f, name)) {
                let after = null;
                try { after = fs.statSync(file).mtimeMs; } catch (e) { /* ignore */ }
                if (!had || after !== before) done.push(name);
            }
        }
        if (done.length) dlog('TEMPLATES-INSTALLED', done);
    } catch (e) { dlog('TEMPLATES-INSTALL-FAIL', String(e && e.message || e)); }
    return done;
}
// At start-up: templates made by older versions are named after the preset's file; they are renamed to the preset's
// name (instead of deleted and rebuilt on the next apply), and templates of presets that are gone are deleted.
function startupTemplates(animations) {
    const before = new Map();
    for (const a of animations || []) {
        try { const f = path.join(ANIM_DIR, a.file); if (a.file && fs.existsSync(f)) before.set(a.id, presetTitleName(f)); } catch (e) { /* skip */ }
    }
    const want = new Set([...presetTitleNames(animations).values()]);
    for (const [id, n] of before) if (want.has(n)) before.delete(id);      // already right, or another preset's name
    return syncTemplates(animations, before);
}

// Installs (or refreshes) the template for a preset and returns its name, or null when it could not be written.
// name: the preset's template name from presetTitleNames (the file name is used without it).
// The template body is worked out once per preset file version (derived cache). Whether the installed file already
// holds it is remembered by that file's size + mtime from the last write or compare, so an apply costs one stat here;
// a template file changed or deleted by anything else is noticed by the stat and rewritten.
const installedTpl = new Map();      // template file -> { key: size:mtime of the file holding `body`, bodyLen }
function templateBody(compPath) {
    const safe = safeCompText(compPath);
    if (!safe) return null;
    return derived(compPath, 'templateBody', () => {
        // presets retimed before the Animation Start slider existed get it here (src/main/retime.js)
        const raw = asSetting(upgradeRetiming(safe.text));
        if (!raw) return null;
        // the preset's add-ons are edited from the panel's Clip controls, not Resolve's Inspector (addon-controls.js)
        return hideAddons(withOutput(raw));
    });
}
function presetTitleFor(compPath, name) {
    const sp = PERF.span('place.presetTitleFor');
    try {
        name = name || presetTitleName(compPath);
        const body = templateBody(compPath);
        if (!body) return null;
        const dir = titlesDir();
        const file = path.join(dir, name + '.setting');
        let st = null;
        try { st = fs.statSync(file); } catch (e) { st = null; }
        const known = installedTpl.get(file);
        if (st && known && known.key === st.size + ':' + st.mtimeMs && known.body === body) return name;
        let cur = null;
        if (st) { try { cur = fs.readFileSync(file, 'utf8'); } catch (e) { cur = null; } }
        if (cur !== body) {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(file, body);
            try { st = fs.statSync(file); } catch (e) { st = null; }
        }
        if (st) installedTpl.set(file, { key: st.size + ':' + st.mtimeMs, body });
        return name;
    } catch (e) {
        dlog('PRESET-TITLE-FAIL', String(e && e.message || e));
        return null;
    } finally { sp.end(); }
}
function isTitleClipName(n) { return /^(Text\+|MultiText)/.test(String(n || '')); }
// How long ago the template file was (re)written; Infinity when it does not exist.
function templateAgeMs(title) {
    try { return Date.now() - fs.statSync(path.join(titlesDir(), title + '.setting')).mtimeMs; } catch (e) { return Infinity; }
}
// The tool that feeds a preset's output (its MediaOut's SourceOp in the title template), e.g. "StopMotion1" for a
// wiggle preset. Resolve connects an inserted title's MediaOut to "Template" regardless, so apply reconnects it to
// this one (bridge op set_output). Null when the template cannot be read or has no MediaOut.
// Word-by-word typing presets have a "Typing Frames" slider (0 = follow the clip length). Placement sets it from the
// clip's length so the typing takes the clip minus 1 second (at least 10 frames, never past the last frame); extending
// the clip afterwards then leaves the typing as it is, and the user can change it in the Inspector.
function typingFramesFor(len, fps) {
    const n = Math.round(Number(len) || 0);
    if (n < 2) return 1;
    return Math.max(1, Math.min(n - 1, Math.max(10, n - Math.round(Number(fps) || 25))));
}
function presetOutputFor(title) {
    const file = path.join(titlesDir(), title + '.setting');
    if (!presetText(file)) return null;
    return derived(file, 'output', (s) => presetOutputOf(s));
}
// Row controls (Row Gap / Justify, add-multitext-row-controls.py) on the preset's Template: only those clips get the
// multitext_rows bridge pass after placing.
function presetHasRowControls(title) {
    const file = path.join(titlesDir(), title + '.setting');
    if (!presetText(file)) return false;
    return derived(file, 'rowControls', (s) => /\bRowGap\s*=\s*Input\b/.test(s || ''));
}
function presetOutputOf(s) {
    try {
        const re = /([A-Za-z_]\w*)\s*=\s*(?:MediaOut|Saver)\s*\{/g;
        let m;
        while ((m = re.exec(s))) {
            const open = m.index + m[0].length - 1;
            const b = s.slice(open, blockEnd(s, open) + 1);
            const src = /\bInput\s*=\s*Input\s*\{\s*SourceOp\s*=\s*"([^"]+)"\s*,\s*Source\s*=\s*"([^"]+)"/.exec(b);
            if (!src) continue;
            // a macro / group output: Resolve wires a macro title correctly itself, and its outputs are not "Output"
            if (new RegExp('\\b' + src[1] + '\\s*=\\s*(?:MacroOperator|GroupOperator)\\s*\\{').test(s)) return null;
            return { source: src[1], output: src[2] };
        }
    } catch (e) { /* no template */ }
    return null;
}
