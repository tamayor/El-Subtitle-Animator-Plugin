// Effect presets: Stop Motion, Wiggle and Glitch as Resolve Fusion *effects* (Edit/Effects/Subtitle Animator/*.setting),
// so they go on any timeline clip - a video, a plain title or a placed text preset - with TimelineItem.AddEffect.
// Each effect is its own comp on the clip (not the title's comp), so a title's Inspector is never touched.
// Several on one clip stack as one look; they are kept in ORDER (glitch, then wiggle, then stop motion holds it all).
// Only native Fusion tools: an OFX node inside would empty the Inspector.

const fs = require('fs');
const path = require('path');
const os = require('os');

const CATEGORY = 'Subtitle Animator';
// id -> what the panel shows; order = the stacking order on a clip (first is applied first)
const EFFECTS = [
    { id: 'Glitch', name: 'Glitch', tags: ['glitch', 'rgb', 'jitter'], tip: 'The picture jumps sideways in bursts with a red / cyan split' },
    { id: 'Wiggle', name: 'Wiggle', tags: ['wiggle', 'boil', 'hand-drawn'], tip: 'Letters and edges boil and wobble (pairs well with Stop Motion)' },
    { id: 'StopMotion', name: 'Stop Motion', tags: ['stop motion', 'choppy', 'frames'], tip: 'Every frame is held a few times for a choppy, hand-made look' }
];
const ORDER = EFFECTS.map(e => e.id);
const DEFAULT_STRENGTH = 25;
// the tool inside each effect that holds its Strength (keep in step with FX_STRENGTH_TOOL in src/python/fusion_bridge.py)
const STRENGTH_TOOL = { Glitch: 'GlitchOut', Wiggle: 'WiggleDisplace', StopMotion: 'StopMotionTime' };

function effectsDir() {
    const tail = ['Fusion', 'Templates', 'Edit', 'Effects', CATEGORY];
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve', ...tail);
    if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Blackmagic Design', 'DaVinci Resolve', 'Support', ...tail);
    return path.join(os.homedir(), '.local', 'share', 'DaVinciResolve', ...tail);
}
// The template's file name (and the name Resolve lists it under)
function fileName(id) { return 'ELSA ' + EFFECTS.find(e => e.id === id).name + '.setting'; }

// ---------------------------------------------------------------- template text
const inp = (name, op, out) => name + ' = Input { SourceOp = "' + op + '", Source = "' + (out || 'Output') + '", }';
const expr = (name, value, e) => name + ' = Input { Value = ' + value + ', Expression = "' + e + '", }';
function tool(name, type, inputs, x, y, extra) {
    return '\t\t\t\t' + name + ' = ' + type + ' {\n' + (extra || '') + '\t\t\t\t\tInputs = {\n' +
        inputs.map(i => '\t\t\t\t\t\t' + i + ',\n').join('') +
        '\t\t\t\t\t},\n\t\t\t\t\tViewInfo = OperatorInfo { Pos = { ' + x + ', ' + y + ' } },\n\t\t\t\t}';
}
// a published control: [inputName, innerTool, innerInput, label, default]
function group(name, mainIn, mainOut, published, tools) {
    const pub = published.map((p, i) =>
        '\t\t\t\tInput' + (i + 1) + ' = InstanceInput {\n\t\t\t\t\tSourceOp = "' + p[1] + '",\n\t\t\t\t\tSource = "' + p[2] + '",\n' +
        '\t\t\t\t\tName = "' + p[3] + '",\n\t\t\t\t\tDefault = ' + p[4] + ',\n\t\t\t\t},\n').join('');
    return '{\n\tTools = ordered() {\n\t\t' + name + ' = GroupOperator {\n\t\t\tInputs = ordered() {\n' + pub +
        '\t\t\t\tMainInput1 = InstanceInput {\n\t\t\t\t\tSourceOp = "' + mainIn[0] + '",\n\t\t\t\t\tSource = "' + mainIn[1] + '",\n\t\t\t\t},\n' +
        '\t\t\t},\n\t\t\tOutputs = {\n\t\t\t\tMainOutput1 = InstanceOutput {\n\t\t\t\t\tSourceOp = "' + mainOut + '",\n\t\t\t\t\tSource = "Output",\n\t\t\t\t}\n\t\t\t},\n' +
        '\t\t\tViewInfo = GroupInfo { Pos = { 0, 0 } },\n\t\t\tTools = ordered() {\n' + tools.join(',\n') + '\n\t\t\t},\n\t\t}\n\t},\n' +
        '\tActiveTool = "' + name + '"\n}\n';
}
const numCtl = (id, label, def, min, max, integer) =>
    id + ' = { LINKS_Name = "' + label + '", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", ' +
    (integer ? 'INP_Integer = true, ' : '') + 'INP_Default = ' + def + ', INP_MinAllowed = 0, INP_MaxAllowed = 100, ' +
    'INP_MinScale = ' + min + ', INP_MaxScale = ' + max + ', ICS_ControlPage = "Controls", }';

// a 0..1 hash of the current 2-frame block, seeded by k (simple expressions have no random)
function hash(k) { const v = 'sin(floor(time/2)*12.9898+' + k + ')*43758.5453'; return '(' + v + '-floor(' + v + '))'; }

// Every effect has one Strength slider, 0..100: 0 = no effect, DEFAULT_STRENGTH = a light, clearly visible look.
// It is a user control on the effect's main tool (STRENGTH_TOOL) and is published in Resolve's Inspector; the panel
// sets it through the bridge (fx_strength).
const strengthCtl = () => '\t\t\t\t\tUserControls = ordered() { ' + numCtl('Strength', 'Strength', DEFAULT_STRENGTH, 0, 100, true) + ', },\n';

// Stop Motion: Strength 0 = every frame (off), 25 = each picture held 2 frames, 100 = held 6 frames.
function stopMotion() {
    const N = '(1+floor(StopMotionTime.Strength/20+0.5))';
    return group('ELSAStopMotion', ['StopMotionTime', 'Input'], 'StopMotionTime', [['StopMotionTime', 'Strength', 'Strength', DEFAULT_STRENGTH]], [
        tool('StopMotionTime', 'TimeStretcher', [
            'Strength = Input { Value = ' + DEFAULT_STRENGTH + ', }',
            expr('SourceTime', 0, 'floor(time/' + N + ')*' + N),
            'InterpolateBetweenFrames = Input { Value = 0, }'
        ], 0, 0, strengthCtl())
    ]);
}

// Wiggle: a continuous boil - the noise moves at a steady Seethe Rate every frame (a PerturbNumber on Seethe, as the old
// Wiggle presets had, wanders and stalls, so the wiggle kept pausing). Strength 25 = displacement 1.25, 100 = 5.
function wiggle() {
    return group('ELSAWiggle', ['WiggleDisplace', 'Input'], 'WiggleDisplace', [
        ['WiggleDisplace', 'Strength', 'Strength', DEFAULT_STRENGTH],
        ['WiggleNoise', 'XScale', 'Size', 20],
        ['WiggleNoise', 'SeetheRate', 'Speed', 0.3]
    ], [
        tool('WiggleNoise', 'FastNoise', [
            'UseFrameFormatSettings = Input { Value = 1, }', 'Width = Input { Value = 1920, }', 'Height = Input { Value = 1080, }',
            'Detail = Input { Value = 1.31, }', 'Contrast = Input { Value = 0.026, }', 'XScale = Input { Value = 20, }',
            'Type = Input { Value = 1, }', 'SeetheRate = Input { Value = 0.3, }'
        ], 0, -60),
        tool('WiggleDisplace', 'Displace', [
            inp('Foreground', 'WiggleNoise'), 'Offset = Input { Value = -0.5, }', 'Strength = Input { Value = ' + DEFAULT_STRENGTH + ', }',
            expr('RefractionStrength', 1.25, 'WiggleDisplace.Strength/20'), 'LightChannel = Input { Value = 5, }'
        ], 110, 0, strengthCtl())
    ]);
}

// Glitch: Strength scales both how far it jumps / splits and how often it bursts (25 = about 1 in 6 two-frame blocks,
// 50 and up = 1 in 3). 0 = nothing.
function glitch() {
    const A = '(GlitchOut.Strength/50)';
    const BURST = 'iif(' + hash(1) + '>1-0.35*min(1,GlitchOut.Strength/50),1,0)';
    const SPLIT = '(0.004+0.012*' + BURST + ')*' + A;
    return group('ELSAGlitch', ['GlitchJitter', 'Input'], 'GlitchOut', [['GlitchOut', 'Strength', 'Strength', DEFAULT_STRENGTH]], [
        tool('GlitchJitter', 'Transform', [
            expr('Center', '{ 0.5, 0.5 }', 'Point(0.5+' + BURST + '*(' + hash(2) + '-0.5)*0.08*' + A + ', 0.5+iif(' + hash(1) + '>0.9,(' + hash(3) + '-0.5)*0.02,0)*' + A + ')')
        ], 0, 0),
        tool('GlitchRedShift', 'Transform', [inp('Input', 'GlitchJitter'), expr('Center', '{ 0.5, 0.5 }', 'Point(0.5+' + SPLIT + ', 0.5)')], 110, -50),
        tool('GlitchRed', 'ColorGain', [inp('Input', 'GlitchRedShift'), 'GainGreen = Input { Value = 0, }', 'GainBlue = Input { Value = 0, }'], 220, -50),
        tool('GlitchCyanShift', 'Transform', [inp('Input', 'GlitchJitter'), expr('Center', '{ 0.5, 0.5 }', 'Point(0.5-' + SPLIT + ', 0.5)')], 110, 50),
        tool('GlitchCyan', 'ColorGain', [inp('Input', 'GlitchCyanShift'), 'GainRed = Input { Value = 0, }'], 220, 50),
        tool('GlitchSplit', 'Merge', [inp('Background', 'GlitchRed'), inp('Foreground', 'GlitchCyan'), 'ApplyMode = Input { Value = FuID { "Screen" }, }', 'PerformDepthMerge = Input { Value = 0, }'], 330, 0),
        tool('GlitchOut', 'Merge', [inp('Background', 'GlitchSplit'), inp('Foreground', 'GlitchJitter'), 'Strength = Input { Value = ' + DEFAULT_STRENGTH + ', }', 'PerformDepthMerge = Input { Value = 0, }'], 440, 0, strengthCtl())
    ]);
}

const MAKERS = { StopMotion: stopMotion, Wiggle: wiggle, Glitch: glitch };

// Writes (or refreshes) the effect templates Resolve lists under Effects > Subtitle Animator.
function installEffects() {
    const dir = effectsDir();
    fs.mkdirSync(dir, { recursive: true });
    const out = [];
    for (const e of EFFECTS) {
        const file = path.join(dir, fileName(e.id));
        const body = MAKERS[e.id]();
        let cur = null;
        try { cur = fs.readFileSync(file, 'utf8'); } catch (err) { cur = null; }
        if (cur !== body) fs.writeFileSync(file, body);
        out.push(file);
    }
    return out;
}

function effectsForUI() { return EFFECTS.map(e => ({ id: e.id, name: e.name, tags: e.tags, tip: e.tip, file: fileName(e.id), defaultStrength: DEFAULT_STRENGTH })); }

// ---------------------------------------------------------------- panel (IPC fx:*)
let installed = false;
function ensureInstalled() {
    if (installed) return;
    try { installEffects(); installed = true; } catch (e) { /* Resolve's template folder not writable: list them anyway */ }
}
function fxList() { ensureInstalled(); return { effects: effectsForUI() }; }
// The effect presets on the selected clips (or the clip under the playhead): { clips: [{ id, name, effects }] }
async function fxGet() {
    const state = require('./state');
    if (state.applying) return { busy: true };
    ensureInstalled();
    return await require('./fusion-bridge').bridgeCall('fx_get', {}, 5000);
}
// Adds (on = true), removes (false) or flips (null) one effect preset on the selected clips.
async function fxSet(event, effectId, on, strength) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    if (!EFFECTS.some(e => e.id === effectId)) return { error: 'Unknown effect' };
    ensureInstalled();
    return await require('./fusion-bridge').bridgeCall('fx_set', { effect: effectId, on: on === true || on === false ? on : null, strength: Number.isFinite(Number(strength)) && strength !== null ? Math.max(0, Math.min(100, Number(strength))) : null }, 15000);
}

// Sets one effect's Strength (0..100) on the selected clips that have it.
async function fxStrength(event, effectId, value) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    if (!EFFECTS.some(e => e.id === effectId)) return { error: 'Unknown effect' };
    const v = Math.max(0, Math.min(100, Math.round(Number(value))));
    if (!Number.isFinite(v)) return { error: 'Bad strength' };
    return await require('./fusion-bridge').bridgeCall('fx_strength', { effect: effectId, value: v }, 8000);
}

// The user's tags on an effect preset (the same tags as text presets), kept in library.json effectTags.
function fxSetTags(event, effectId, tags) {
    if (!EFFECTS.some(e => e.id === effectId)) return { error: 'Unknown effect' };
    const { loadLib, saveLib, libForUI } = require('./library');
    const lib = loadLib();
    const known = new Set((lib.tags || []).map(t => t.id));
    lib.effectTags = Object.assign({}, lib.effectTags || {});
    lib.effectTags[effectId] = Array.from(new Set(Array.isArray(tags) ? tags : [])).filter(id => known.has(id));
    saveLib(lib);
    return { lib: libForUI() };
}

module.exports = { EFFECTS, ORDER, CATEGORY, effectsDir, fileName, installEffects, effectsForUI, fxList, fxGet, fxSet, fxSetTags, fxStrength, STRENGTH_TOOL, DEFAULT_STRENGTH, _makers: MAKERS };
