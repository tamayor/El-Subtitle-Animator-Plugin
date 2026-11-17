// What the installer sets up on macOS besides the panel: saved paths, Claude Code, tools and engines.
// Each item has detect() and install(); see shared/items.js for what detect() returns.
// The engines mirror what the panel installs on first use. Their source of truth is named beside each item.

const fs = require('fs');
const path = require('path');
const E = { ...require('../shared/env'), ...require('./tools') };
const { run, quiet, tail } = require('../shared/run');

const SKILLS = ['elsa-prompt', 'elsa-prompt-auto'];
const SKILL_TEMPLATES = path.join(__dirname, '..', 'shared', 'skills');
// src/main/spotlight.js
const MATTE_MODEL = {
    file: 'rvm_mobilenetv3_fp32.onnx', bytes: 14975696,
    url: 'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx',
};
// src/main/media-analysis.js ASR_ENGINES
const ASR_MODULES = ['mlx_whisper', 'faster_whisper', 'whisper'];
// src/main/match-cut.js PYTHONS
const PILLOW_PYTHONS = [
    '/opt/anaconda3/bin/python3', path.join(E.HOME, 'anaconda3/bin/python3'), path.join(E.HOME, 'miniconda3/bin/python3'),
    '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/Library/Frameworks/Python.framework/Versions/Current/bin/python3', '/usr/bin/python3',
];
const PIP = ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off'];

function fail(message) { throw new Error(message); }
async function must(r, what) { const res = await r; if (res.code !== 0) fail(what + ': ' + tail(res)); return res; }
const pipLine = (log) => (line) => { if (/^(Collecting|Downloading|Installing|Successfully|Requirement already)\b/.test(line)) log(line.slice(0, 140)); };

// Does this Python have all of these modules? (find_spec: nothing is imported, so it is quick.)
async function hasModules(py, mods) {
    if (!py || !E.exists(py)) return false;
    const code = 'import importlib.util as u,sys; sys.exit(0 if all(u.find_spec(m) for m in sys.argv[1:]) else 1)';
    return (await quiet(py, ['-c', code, ...mods])).code === 0;
}

function venvPython(dir) { return path.join(dir, 'bin', 'python3'); }
async function makeVenv(dir, log) {
    if (E.exists(venvPython(dir))) return;
    const py = E.systemPython();
    if (!py) fail('Python 3 was not found. Install it from python.org or with Homebrew (brew install python).');
    log('Creating a Python environment in ' + dir);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await must(run(py, ['-m', 'venv', dir]), 'Could not create the Python environment');
}
function needsPython() { return E.systemPython() ? null : { state: 'blocked', note: 'Needs Python 3 (python.org or Homebrew)' }; }

// ------------------------------------------------------------------ saved paths after the main folder moved
// The library keeps a few full paths (the safe-zone reference image, rendered B-roll files). After the main folder
// moves they point to the old place. An old place is a path that ends in /El Subtitle Animator/..., is not this
// main folder, and is no longer on disk.
function pathFiles(ctx) {
    const out = [];
    for (const dir of [ctx.dataDir, path.join(ctx.dataDir, '_app')]) {
        let names = [];
        try { names = fs.readdirSync(dir); } catch (e) { continue; }
        for (const n of names) {
            if (!/\.json$/i.test(n)) continue;
            const file = path.join(dir, n);
            try { const st = fs.statSync(file); if (st.isFile() && st.size < 20 * 1024 * 1024) out.push(file); } catch (e) { /* skip */ }
        }
    }
    return out;
}
function stalePrefixes(text, ctx) {
    const found = new Set();
    const re = new RegExp('"(/[^"\\\\\\n]+?)/' + E.DATA_FOLDER_NAME + '(?=[/"])', 'g');
    let m;
    while ((m = re.exec(text))) if (m[1] !== ctx.mainDir && !E.exists(m[1])) found.add(m[1]);
    return [...found];
}
function scanPaths(ctx) {
    const hits = [];
    for (const file of pathFiles(ctx)) {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
        const prefixes = stalePrefixes(text, ctx);
        if (prefixes.length) hits.push({ file, text, prefixes });
    }
    return hits;
}
function detectPaths(ctx) {
    const hits = scanPaths(ctx);
    if (!hits.length) return { state: 'ok', note: 'Nothing points to an old folder' };
    return { state: 'update', note: hits.length + (hits.length === 1 ? ' file points' : ' files point') + ' to ' + hits[0].prefixes[0] };
}
function installPaths(ctx, log) {
    for (const h of scanPaths(ctx)) {
        let text = h.text;
        for (const p of h.prefixes) text = text.split('"' + p + '/').join('"' + ctx.mainDir + '/');
        if (path.dirname(h.file) === ctx.dataDir) fs.copyFileSync(h.file, h.file + '.before-move');     // the user's own files keep a copy
        const tmp = h.file + '.tmp';
        fs.writeFileSync(tmp, text, 'utf8');
        fs.renameSync(tmp, h.file);
        log('Updated ' + path.relative(ctx.mainDir, h.file));
    }
}

// ------------------------------------------------------------------ Claude Code
function mcpScript(ctx) { return path.join(ctx.codeDir, 'mcp', 'el-sa-mcp.js'); }
// Every registration of the server in ~/.claude.json: the user-wide one and one per project folder.
function mcpEntries() {
    const cfg = E.readJson(path.join(E.HOME, '.claude.json'), {}) || {};
    const list = [];
    const add = (scope, project, servers) => {
        const s = servers && servers[E.MCP_NAME];
        if (s) list.push({ scope, project, script: (Array.isArray(s.args) ? s.args : []).find(a => /el-sa-mcp\.js$/.test(a)) || '' });
    };
    add('user', null, cfg.mcpServers);
    for (const [dir, p] of Object.entries(cfg.projects || {})) add('local', dir, p && p.mcpServers);
    return list;
}
function detectMcp(ctx) {
    if (!E.findTool('claude')) return { state: 'blocked', note: 'Claude Code is not installed (optional: claude.com/claude-code)' };
    if (!E.pluginNode() && !E.findTool('node')) return { state: 'blocked', note: 'Needs Node.js 18 or newer (nodejs.org)' };
    const entries = mcpEntries();
    if (!entries.length) return { state: 'missing', note: 'Not connected' };
    const stale = entries.filter(e => e.script !== mcpScript(ctx));
    if (stale.length) return { state: 'update', note: 'Points to ' + (path.dirname(path.dirname(stale[0].script)) || 'another folder') };
    return { state: 'ok', note: 'Connected' };
}
async function installMcp(ctx, log) {
    const claude = E.findTool('claude');
    const env = E.toolEnv();
    const want = mcpScript(ctx);
    for (const e of mcpEntries().filter(x => x.script !== want)) {
        if (e.scope === 'local' && !E.exists(e.project)) { log('Skipped an old entry of a folder that is gone: ' + e.project); continue; }
        log('Removing the old entry (' + (e.project || 'all projects') + ')');
        await run(claude, ['mcp', 'remove', E.MCP_NAME, '-s', e.scope], { env, cwd: e.project || E.HOME });
    }
    if (!mcpEntries().some(e => e.scope === 'user' && e.script === want)) {
        await must(run(claude, ['mcp', 'add', '-s', 'user', E.MCP_NAME, '--', 'node', want], { env, cwd: E.HOME }, log), 'Could not register the MCP server');
    }
    log('Claude Code starts the server from ' + want);
}

function skillFile(name) { return path.join(E.HOME, '.claude', 'skills', name, 'SKILL.md'); }
function jobPrompt(ctx) { return path.join(ctx.dataDir, 'job-prompt.md'); }
function detectSkills(ctx) {
    if (!E.findTool('claude') && !E.exists(path.join(E.HOME, '.claude'))) return { state: 'blocked', note: 'Claude Code is not installed (optional)' };
    let missing = 0, stale = 0;
    for (const name of SKILLS) {
        let text;
        try { text = fs.readFileSync(skillFile(name), 'utf8'); } catch (e) { missing++; continue; }
        if (!text.includes('`' + jobPrompt(ctx) + '`')) stale++;
    }
    if (missing === SKILLS.length) return { state: 'missing', note: 'Not installed' };
    if (missing || stale) return { state: 'update', note: stale ? 'They read the prompt from another folder' : 'One command is missing' };
    return { state: 'ok', note: 'Installed' };
}
function installSkills(ctx, log) {
    for (const name of SKILLS) {
        const file = skillFile(name);
        let text;
        // A skill that is already there keeps the user's edits: only the path to job-prompt.md changes.
        try { text = fs.readFileSync(file, 'utf8').replace(/`[^`\n]*[/\\]job-prompt\.md`/g, () => '`' + jobPrompt(ctx) + '`'); }
        catch (e) { text = fs.readFileSync(path.join(SKILL_TEMPLATES, name, 'SKILL.md'), 'utf8').split('{{JOB_PROMPT}}').join(jobPrompt(ctx)); }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text, 'utf8');
        log('/' + name + ' reads ' + jobPrompt(ctx));
    }
}

// ------------------------------------------------------------------ Homebrew tools
function brewItem(id, bin, title, detail, size) {
    return {
        id, group: 'tools', title, detail, size,
        detect() {
            const at = E.pluginBin(bin);
            if (at) return { state: 'ok', note: 'Installed (' + at + ')' };
            return E.findTool('brew') ? { state: 'missing', note: 'Not installed' } : { state: 'blocked', note: 'Needs Homebrew first (brew.sh)' };
        },
        async install(ctx, log) {
            const brew = E.findTool('brew');
            if (!brew) fail('Homebrew was not found. Install it from brew.sh, then run the installer again.');
            await must(run(brew, ['install', bin], { env: { ...E.toolEnv(), HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1' } }, (l) => log(l.slice(0, 140))), 'brew install ' + bin + ' failed');
            if (!E.pluginBin(bin)) fail(bin + ' was installed, but not in a folder the plugin looks in (/opt/homebrew/bin, /usr/local/bin)');
        },
    };
}

// ------------------------------------------------------------------ Python engines
function trackerVenv(ctx) { return path.join(ctx.paths.userData, 'tracker-venv'); }

async function detectWhisper() {
    for (const py of [venvPython(E.ASR_VENV), ...['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].map(d => path.join(d, 'python3'))]) {
        for (const m of ASR_MODULES) if (await hasModules(py, [m])) return { state: 'ok', note: 'Installed (' + m.replace('_', '-') + ')' };
    }
    return needsPython() || { state: 'missing', note: 'Not installed' };
}
async function installWhisper(ctx, log) {
    const pkg = process.arch === 'arm64' ? 'mlx-whisper' : 'faster-whisper';
    await makeVenv(E.ASR_VENV, log);
    const py = venvPython(E.ASR_VENV);
    await must(run(py, [...PIP, '--upgrade', 'pip'], {}, pipLine(log)), 'Could not update pip');
    log('Installing ' + pkg + ' (a few minutes)');
    await must(run(py, [...PIP, pkg], {}, pipLine(log)), 'Could not install ' + pkg);
    log('The speech model (about 1.6 GB) downloads the first time words are transcribed.');
}

async function detectTracker(ctx) {
    if (await hasModules(venvPython(trackerVenv(ctx)), ['cv2', 'numpy'])) return { state: 'ok', note: 'Installed' };
    return needsPython() || { state: 'missing', note: 'Not installed' };
}
async function installTracker(ctx, log) {
    await makeVenv(trackerVenv(ctx), log);
    log('Downloading OpenCV');
    await must(run(venvPython(trackerVenv(ctx)), [...PIP, 'opencv-contrib-python-headless', 'numpy'], {}, pipLine(log)), 'Could not install OpenCV');
}

function matteModel(ctx) { return path.join(ctx.paths.userData, 'models', MATTE_MODEL.file); }
function matteModelReady(ctx) { try { return fs.statSync(matteModel(ctx)).size === MATTE_MODEL.bytes; } catch (e) { return false; } }
async function detectMatte(ctx) {
    const engine = await hasModules(venvPython(trackerVenv(ctx)), ['onnxruntime', 'PIL', 'cv2', 'numpy']);
    if (engine && matteModelReady(ctx)) return { state: 'ok', note: 'Installed' };
    return needsPython() || { state: 'missing', note: engine ? 'The matting model is missing' : 'Not installed' };
}
async function installMatte(ctx, log) {
    await makeVenv(trackerVenv(ctx), log);
    await must(run(venvPython(trackerVenv(ctx)), [...PIP, 'opencv-contrib-python-headless', 'numpy', 'onnxruntime', 'pillow'], {}, pipLine(log)), 'Could not install the matting engine');
    if (matteModelReady(ctx)) return;
    log('Downloading the matting model (15 MB)');
    const file = matteModel(ctx), part = file + '.part';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await must(run('/usr/bin/curl', ['-fL', '--retry', '2', '-sS', '-o', part, MATTE_MODEL.url]), 'Could not download the matting model');
    if (fs.statSync(part).size !== MATTE_MODEL.bytes) { fs.rmSync(part, { force: true }); fail('The matting model download is incomplete. Try again.'); }
    fs.renameSync(part, file);
}

// src/main/auto-cut.js numpyPython
function cutPythons(ctx) {
    return [venvPython(path.join(ctx.paths.userData, 'cut-venv')), venvPython(trackerVenv(ctx)), '/opt/anaconda3/bin/python3',
        path.join(E.HOME, 'anaconda3/bin/python3'), path.join(E.HOME, 'miniconda3/bin/python3'), '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'];
}
async function detectCut(ctx) {
    for (const py of cutPythons(ctx)) if (await hasModules(py, ['numpy'])) return { state: 'ok', note: 'Installed' };
    return needsPython() || { state: 'missing', note: 'Not installed' };
}
async function installCut(ctx, log) {
    const dir = path.join(ctx.paths.userData, 'cut-venv');
    await makeVenv(dir, log);
    await must(run(venvPython(dir), [...PIP, 'numpy'], {}, pipLine(log)), 'Could not install numpy');
}

async function detectPillow() {
    for (const py of PILLOW_PYTHONS) if (await hasModules(py, ['PIL'])) return { state: 'ok', note: 'Installed (' + py + ')' };
    return needsPython() || { state: 'missing', note: 'Not installed' };
}
async function installPillow(ctx, log) {
    // Homebrew's Python does not take pip installs: its Pillow comes from Homebrew. Other Pythons take a user install.
    const brew = E.findTool('brew');
    if (brew && E.exists('/opt/homebrew/bin/python3')) {
        await must(run(brew, ['install', 'pillow'], { env: { ...E.toolEnv(), HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1' } }, (l) => log(l.slice(0, 140))), 'brew install pillow failed');
    } else {
        const py = E.systemPython();
        if (!py) fail('Python 3 was not found.');
        await must(run(py, [...PIP, '--user', 'pillow'], {}, pipLine(log)), 'Could not install Pillow');
    }
    if ((await detectPillow()).state !== 'ok') fail('Pillow was installed, but not for a Python the plugin uses');
}

// ------------------------------------------------------------------ B-roll (Remotion), beside the code
function brollDir(ctx) { return path.join(ctx.codeDir, 'broll'); }
function brollChrome(ctx) { return path.join(brollDir(ctx), '.chrome', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'); }
function needsBrollChrome() { return process.arch === 'arm64'; }      // broll/setup-chrome.mjs
function detectBroll(ctx) {
    if (!E.exists(path.join(brollDir(ctx), 'render.mjs'))) return { state: 'blocked', note: 'This copy has no broll folder' };
    if (!E.pluginNode()) return { state: 'blocked', note: 'Needs Node.js 18 or newer (nodejs.org)' };
    const packages = E.exists(path.join(brollDir(ctx), 'node_modules', 'remotion'));
    const chrome = !needsBrollChrome() || E.exists(brollChrome(ctx));
    if (packages && chrome) return { state: 'ok', note: 'Installed' };
    return { state: 'missing', note: packages ? 'Its Chrome is missing' : 'Not installed' };
}
async function installBroll(ctx, log) {
    const node = E.pluginNode();
    const env = E.toolEnv([path.dirname(node)]);
    const npm = path.join(path.dirname(node), 'npm');
    if (!E.exists(npm)) fail('npm was not found beside ' + node);
    log('Installing the Remotion packages (a few minutes)');
    await must(run(npm, ['install', '--no-audit', '--no-fund'], { cwd: brollDir(ctx), env }, (l) => log(l.slice(0, 140))), 'npm install failed');
    await must(run(node, ['setup-chrome.mjs'], { cwd: brollDir(ctx), env }, (l) => { if (!/^\s*\d+\s|%/.test(l)) log(l.slice(0, 140)); }), 'Could not set up Chrome for rendering');
}

// ------------------------------------------------------------------ the list, in install order (after the panel)
const ITEMS = [
    { id: 'paths', group: 'resolve', title: 'Saved paths in your library',
        detail: 'After the main folder moves: points the safe-zone image and rendered B-roll files to the new place.',
        detect: detectPaths, install: installPaths },

    { id: 'mcp', group: 'claude', title: 'MCP server',
        detail: 'Lets Claude Code place captions on a timeline through the open panel.',
        detect: detectMcp, install: installMcp },
    { id: 'skills', group: 'claude', title: '/elsa-prompt and /elsa-prompt-auto commands',
        detail: 'Run the Prompt tab\'s job prompt from Claude Code.',
        detect: detectSkills, install: installSkills },

    brewItem('ffmpeg', 'ffmpeg', 'ffmpeg', 'Sound levels, speech pauses, render checks, Auto Cut and video backdrops.', '80 MB'),
    brewItem('tesseract', 'tesseract', 'tesseract', 'Reads text in images for Article Text Match Cut.', '35 MB'),

    { id: 'whisper', group: 'engines', title: 'Whisper speech engine', size: '500 MB + 1.6 GB model on first use',
        detail: 'Word timings from the dialogue, on this computer. mlx-whisper on Apple silicon, faster-whisper on Intel.',
        detect: detectWhisper, install: installWhisper },
    { id: 'tracker', group: 'engines', title: 'Track Subject engine (OpenCV)', size: '190 MB',
        detail: 'Follows a subject for the Track Subject effect.',
        detect: detectTracker, install: installTracker },
    { id: 'matte', group: 'engines', title: 'Subject cut-out engine (ONNX)', size: '120 MB',
        detail: 'Cuts the subject out of the footage for Spotlight and B-roll. Shares the Track Subject environment.',
        detect: detectMatte, install: installMatte },
    { id: 'cut', group: 'engines', title: 'Auto Cut engine (numpy)', size: '40 MB',
        detail: 'Finds pauses and retakes. The Track Subject engine also covers this.',
        detect: detectCut, install: installCut },
    { id: 'pillow', group: 'engines', title: 'Pillow', size: '15 MB',
        detail: 'Draws the frames of Article Text Match Cut.',
        detect: detectPillow, install: installPillow },
    { id: 'broll', group: 'engines', title: 'B-roll renderer (Remotion)', size: '700 MB',
        detail: 'Renders the B-roll tab\'s motion graphics. Installed inside the code folder.',
        detect: detectBroll, install: installBroll },
];

module.exports = { ITEMS };
