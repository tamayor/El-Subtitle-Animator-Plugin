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
    // Resolve's own ResolveFX Stop Motion (OFX on the clip, not a Fusion template): a Fusion TimeStretcher in an effect gets
    // held frames WITHOUT the clip's Edit sizing (Zoom / Pan / Tilt), so punched-in clips jumped between zoomed and raw.
    // Scripts cannot set OFX parameters, so its Frame Repeat is set in Resolve's Inspector (no Strength slider here).
    { id: 'StopMotion', name: 'Stop Motion', tags: ['stop motion', 'choppy', 'frames'], tip: 'DaVinci Resolve\'s Stop Motion: frames are held for a choppy, hand-made look. Glitch and Wiggle on the same clip hold for the same Frame Repeat (set the same number in Resolve\'s Inspector > Effects > Stop Motion)', ofx: 'Resolve FX/Resolve FX Temporal/Stop Motion', repeat: true }
];
const ORDER = EFFECTS.map(e => e.id);
const DEFAULT_STRENGTH = 25;
const HOLD_DEFAULT = 2;      // Stop Motion Frame Repeat our glitch / wiggle hold for (FX_HOLD_DEFAULT in fusion_bridge.py)
// the tool inside each effect that holds its Strength (keep in step with FX_STRENGTH_TOOL in src/python/fusion_bridge.py)
const STRENGTH_TOOL = { Glitch: 'GlitchOut', Wiggle: 'WiggleDisplace' };

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

// a 0..1 hash of the current glitch block (GlitchOut.Blk frames: 2, or Stop Motion's hold), seeded by k (simple
// expressions have no random)
function hash(k) { const v = 'sin(floor((time-comp.RenderStart)/GlitchOut.Blk)*12.9898+' + k + ')*43758.5453'; return '(' + v + '-floor(' + v + '))'; }

// Hold (frames, 1..10): the effect's own clock steps by this many frames. 1 = moves every frame. The bridge sets it to
// Stop Motion's Frame Repeat while Stop Motion is on the clip (fx_sync_hold), so wiggle / glitch hold with the picture.
// Hidden in Resolve's Inspector (the panel's Stop Motion slider sets it).
const holdCtl = () => 'Hold = { LINKS_Name = "Hold", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Integer = true, ' +
    'INP_Default = 1, INP_MinAllowed = 1, INP_MaxAllowed = 10, IC_Visible = false, ICS_ControlPage = "Controls", }';

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
        ['WiggleDisplace', 'Speed', 'Speed', 0.3]
    ], [
        tool('WiggleNoise', 'FastNoise', [
            'UseFrameFormatSettings = Input { Value = 0, }', 'Width = Input { Value = 270, }', 'Height = Input { Value = 480, }',      // a quarter-size map: the displacement is smooth anyway, and full size cost ~8 ms a frame
            'Detail = Input { Value = 1.31, }', 'Contrast = Input { Value = 0.026, }', 'XScale = Input { Value = 20, }',
            // the seethe phase follows the stepped clock (Hold) instead of SeetheRate's every-frame motion
            'Type = Input { Value = 1, }', 'SeetheRate = Input { Value = 0, }',
            expr('Seethe', 0, 'WiggleDisplace.Speed*floor((time-comp.RenderStart)/WiggleDisplace.Hold)*WiggleDisplace.Hold')
        ], 0, -60),
        tool('WiggleDisplace', 'Displace', [
            inp('Foreground', 'WiggleNoise'), 'Offset = Input { Value = -0.5, }', 'Strength = Input { Value = ' + DEFAULT_STRENGTH + ', }',
            expr('RefractionStrength', 1.25, 'WiggleDisplace.Strength/20'), 'LightChannel = Input { Value = 5, }',
            'Speed = Input { Value = 0.3, }', 'Hold = Input { Value = 1, }'
        ], 110, 0, '\t\t\t\t\tUserControls = ordered() { ' + numCtl('Strength', 'Strength', DEFAULT_STRENGTH, 0, 100, true) + ', ' +
            'Speed = { LINKS_Name = "Speed", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Default = 0.3, INP_MinScale = 0, INP_MaxScale = 2, ICS_ControlPage = "Controls", }, ' +
            holdCtl() + ', },\n')
    ]);
}

// Glitch: the whole picture jumps sideways in bursts, with two tinted copies (Colour A to the right, Colour B to the left)
// blended in with Lighten, so the colours show as fringes on edges - on text and on a video alike, without washing the
// picture. Strength scales how far / how often it jumps (25 = about 1 in 6 two-frame blocks, 50+ = 1 in 3); 0 = none.
// Opacity = how strong the coloured fringes are. Entry > Blink at Start (BlinkIn, on by default): the first
// BLINK_FRAMES frames flicker on / off with a forced burst. Simple expressions only (Lua ones cost ~25 ms a frame).
const BLINK_FRAMES = 8;
const GLITCH_DEFAULTS = { colorA: [1, 0, 0], colorB: [0, 1, 1], opacity: 85 };
function glitch() {
    const S = 'GlitchOut.Strength';
    const rel = '(time-comp.RenderStart)';
    const blink = 'iif(GlitchOut.BlinkIn>0.5,1,0)*iif(' + S + '>0,1,0)*iif(' + rel + '<' + BLINK_FRAMES + ',1,0)*iif(' + rel + '>=0,1,0)';
    const burst = 'max(GlitchOut.Blink, iif(' + hash(1) + '>1-0.35*min(1,' + S + '/50),1,0))';
    const amt = 'iif(GlitchOut.Blink>0.5, max(' + S + '/50,0.6), ' + S + '/50)';
    const show = 'iif(GlitchOut.Blink>0.5, iif(' + rel + '==0,0,iif(' + rel + '==2,0,iif(' + rel + '==4,0,1))), 1)';
    const jitter = 'Point(0.5+GlitchOut.Burst*(' + hash(2) + '-0.5)*0.08*GlitchOut.Amt, 0.5+GlitchOut.Burst*iif(' + hash(1) + '>0.9,(' + hash(3) + '-0.5)*0.02,0)*GlitchOut.Amt)';
    const split = (sign) => 'Point(0.5' + sign + '(0.004+0.012*GlitchOut.Burst)*GlitchOut.Amt, 0.5)';
    const hidden = (id) => id + ' = { LINKS_Name = "' + id + '", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", IC_Visible = false, INP_Passive = true, INP_External = false, ICS_ControlPage = "Controls", }';
    const color = (id, label, group, rgb) => ['Red', 'Green', 'Blue'].map((c, k) =>
        id + c + ' = { ' + (k === 0 ? 'LINKS_Name = "' + label + '", ' : '') + 'LINKID_DataType = "Number", INPID_InputControl = "ColorControl", ' +
        'IC_ControlGroup = ' + group + ', IC_ControlID = ' + k + ', INP_Default = ' + rgb[k] + ', INP_MinScale = 0, INP_MaxScale = 1, ICS_ControlPage = "Controls", }').join(', ');
    const D = GLITCH_DEFAULTS;
    const user = '\t\t\t\t\tUserControls = ordered() { ' + numCtl('Strength', 'Strength', DEFAULT_STRENGTH, 0, 100, true) + ', ' +
        'BlinkIn = { LINKS_Name = "Blink at Start", LINKID_DataType = "Number", INPID_InputControl = "CheckboxControl", INP_Integer = true, INP_Default = 1, ICS_ControlPage = "Controls", INPS_StatusText = "Entry: the first frames flicker on and off with a glitch burst", }, ' +
        color('ColorA', 'Colour A', 1, D.colorA) + ', ' + color('ColorB', 'Colour B', 2, D.colorB) + ', ' +
        numCtl('Opacity', 'Opacity', D.opacity, 0, 100, true) + ', ' +
        hidden('Blink') + ', ' + hidden('Burst') + ', ' + hidden('Amt') + ', ' + hidden('Show') + ', ' + hidden('Blk') + ', ' + holdCtl() + ', },\n';
    const tint = (name, src, id, x, y) => tool(name, 'ColorGain', [inp('Input', src),
        expr('GainRed', 1, 'GlitchOut.' + id + 'Red'), expr('GainGreen', 1, 'GlitchOut.' + id + 'Green'), expr('GainBlue', 1, 'GlitchOut.' + id + 'Blue')], x, y);
    const ghost = (name, bg, fg, sign, x, extra) => tool(name, 'Merge', [inp('Background', bg), inp('Foreground', fg),
        expr('Center', '{ 0.5, 0.5 }', split(sign)), 'ApplyMode = Input { Value = FuID { "Lighten" }, }',
        expr('Blend', D.opacity / 100, 'GlitchOut.Opacity/100'), 'PerformDepthMerge = Input { Value = 0, }'].concat(extra || []), x, 0, name === 'GlitchOut' ? user : '');
    return group('ELSAGlitch', ['GlitchJitter', 'Input'], 'GlitchOut', [
        ['GlitchOut', 'Strength', 'Strength', DEFAULT_STRENGTH],
        ['GlitchOut', 'BlinkIn', 'Blink at Start', 1],
        ['GlitchOut', 'ColorARed', 'Colour A', D.colorA[0]], ['GlitchOut', 'ColorAGreen', 'Colour A Green', D.colorA[1]], ['GlitchOut', 'ColorABlue', 'Colour A Blue', D.colorA[2]],
        ['GlitchOut', 'ColorBRed', 'Colour B', D.colorB[0]], ['GlitchOut', 'ColorBGreen', 'Colour B Green', D.colorB[1]], ['GlitchOut', 'ColorBBlue', 'Colour B Blue', D.colorB[2]],
        ['GlitchOut', 'Opacity', 'Opacity', D.opacity]
    ], [
        tool('GlitchJitter', 'Transform', [expr('Center', '{ 0.5, 0.5 }', jitter), expr('Size', 1, 'GlitchOut.Show')], 0, 0),
        tint('GlitchTintA', 'GlitchJitter', 'ColorA', 110, -50),
        tint('GlitchTintB', 'GlitchJitter', 'ColorB', 110, 50),
        ghost('GlitchGhostA', 'GlitchJitter', 'GlitchTintA', '+', 220),
        ghost('GlitchOut', 'GlitchGhostA', 'GlitchTintB', '-', 330, [
            'Strength = Input { Value = ' + DEFAULT_STRENGTH + ', }', 'BlinkIn = Input { Value = 1, }',
            'ColorARed = Input { Value = ' + D.colorA[0] + ', }', 'ColorAGreen = Input { Value = ' + D.colorA[1] + ', }', 'ColorABlue = Input { Value = ' + D.colorA[2] + ', }',
            'ColorBRed = Input { Value = ' + D.colorB[0] + ', }', 'ColorBGreen = Input { Value = ' + D.colorB[1] + ', }', 'ColorBBlue = Input { Value = ' + D.colorB[2] + ', }',
            'Opacity = Input { Value = ' + D.opacity + ', }', 'Hold = Input { Value = 1, }',
            expr('Blk', 2, 'iif(GlitchOut.Hold>1,GlitchOut.Hold,2)'),
            expr('Blink', 0, blink), expr('Burst', 0, burst), expr('Amt', 0.5, amt), expr('Show', 1, show)
        ])
    ]);
}

const MAKERS = { StopMotion: stopMotion, Wiggle: wiggle, Glitch: glitch };

// Writes (or refreshes) the effect templates Resolve lists under Effects > Subtitle Animator.
function installEffects() {
    const dir = effectsDir();
    fs.mkdirSync(dir, { recursive: true });
    const out = [];
    // the old Fusion Stop Motion template (zoom jump on punched-in clips) is no longer offered
    try { fs.rmSync(path.join(dir, 'ELSA Stop Motion.setting'), { force: true }); } catch (err) { /* ignore */ }
    for (const e of EFFECTS) {
        if (e.ofx) continue;      // a built-in Resolve effect: nothing to install
        const file = path.join(dir, fileName(e.id));
        const body = MAKERS[e.id]();
        let cur = null;
        try { cur = fs.readFileSync(file, 'utf8'); } catch (err) { cur = null; }
        if (cur !== body) fs.writeFileSync(file, body);
        out.push(file);
    }
    return out;
}

function effectsForUI() { return EFFECTS.map(e => ({ id: e.id, name: e.name, tags: e.tags, tip: e.tip, file: fileName(e.id), defaultStrength: e.repeat ? HOLD_DEFAULT : (e.ofx ? null : DEFAULT_STRENGTH), noStrength: !!e.ofx && !e.repeat, repeat: !!e.repeat, glitch: e.id === 'Glitch' ? GLITCH_DEFAULTS : undefined })); }

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
    if (state.applying || require('./resolve-load').resolveBusy()) return { busy: true };
    ensureInstalled();
    return await require('./fusion-bridge').bridgeCall('fx_get', {}, 5000);
}
// Adds (on = true), removes (false) or flips (null) one effect preset on the selected clips.
async function fxSet(event, effectId, on, strength, params, hold) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    if (!EFFECTS.some(e => e.id === effectId)) return { error: 'Unknown effect' };
    ensureInstalled();
    return await require('./fusion-bridge').bridgeCall('fx_set', { effect: effectId, on: on === true || on === false ? on : null, strength: Number.isFinite(Number(strength)) && strength !== null ? Math.max(0, Math.min(100, Number(strength))) : null, params: cleanParams(params), hold: Number.isFinite(Number(hold)) && hold !== null ? Math.max(1, Math.min(10, Math.round(Number(hold)))) : null }, 15000);
}

// Sets one effect's Strength (0..100) on the selected clips that have it.
async function fxStrength(event, effectId, value) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    if (!EFFECTS.some(e => e.id === effectId)) return { error: 'Unknown effect' };
    const v = Math.max(effectId === 'StopMotion' ? 1 : 0, Math.min(effectId === 'StopMotion' ? 10 : 100, Math.round(Number(value))));
    if (!Number.isFinite(v)) return { error: 'Bad strength' };
    return await require('./fusion-bridge').bridgeCall('fx_strength', { effect: effectId, value: v }, 8000);
}

function cleanParams(v) {
    const out = {};
    for (const [k, x] of Object.entries(v && typeof v === 'object' ? v : {})) if (/^[A-Za-z]\w*$/.test(k) && Number.isFinite(Number(x))) out[k] = Number(x);
    return out;
}
// Sets other settings of one effect (Glitch: BlinkIn, ColorA* / ColorB*, Opacity) on the selected clips that have it.
async function fxParam(event, effectId, values) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    if (!EFFECTS.some(e => e.id === effectId)) return { error: 'Unknown effect' };
    return await require('./fusion-bridge').bridgeCall('fx_param', { effect: effectId, values: cleanParams(values) }, 8000);
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

module.exports = { EFFECTS, ORDER, CATEGORY, effectsDir, fileName, installEffects, effectsForUI, fxList, fxGet, fxSet, fxSetTags, fxStrength, fxParam, STRENGTH_TOOL, DEFAULT_STRENGTH, _makers: MAKERS };
