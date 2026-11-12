// Effect presets: Stop Motion, Wiggle and Glitch as Resolve Fusion *effects* (Edit/Effects/Subtitle Animator/*.setting),
// so they go on any timeline clip - a video, a plain title or a placed text preset - with TimelineItem.AddEffect.
// Each effect is its own comp on the clip (not the title's comp), so a title's Inspector is never touched.
// Several on one clip stack as one look; they are kept in ORDER (glitch, then wiggle, then stop motion holds it all).
// Only native Fusion tools: an OFX node inside would empty the Inspector.

const fs = require('fs');
const path = require('path');

const { resolveUserDir } = require('./config');

const CATEGORY = 'Subtitle Animator';
// id -> what the panel shows; order = the stacking order on a clip (first is applied first)
const EFFECTS = [
    { id: 'Transform', name: 'Transform', tags: ['transform', 'zoom', 'move', 'push in', 'pan'], tip: 'Zooms and moves the picture over the clip, with an easing curve (on top of the clip\'s own Edit transform). Inside Fusion, so Stop Motion holds it too', transform: true },
    // Track Subject: the clip follows a subject in the footage under it. The panel tracks the subject (subject-track.js)
    // and keys XfTrack's Center / Pivot / Size from it (bridge fx_bake_track); the template itself does nothing.
    { id: 'Track', name: 'Track Subject', tags: ['track', 'follow', 'attach', 'subject', 'motion'], tip: 'Attaches the clip to a subject in the footage under it: draw a box around the subject and the clip moves (and optionally scales) with it', track: true },
    { id: 'Glitch', name: 'Glitch', tags: ['glitch', 'rgb', 'jitter'], tip: 'The picture jumps sideways in bursts with a red / cyan split' },
    { id: 'Wiggle', name: 'Wiggle', tags: ['wiggle', 'boil', 'hand-drawn'], tip: 'Letters and edges boil and wobble (pairs well with Stop Motion)' },
    // A Fusion effect (ELSA Stop Motion, a TimeStretcher last before the output), so it holds the glitch / wiggle with the
    // picture. Clips with Edit sizing (Zoom / Pan / Tilt) get Resolve's own OFX Stop Motion instead (`ofx`): in a Fusion
    // effect their held frames come back without that sizing. Scripts cannot set the OFX's Frame Repeat.
    { id: 'StopMotion', name: 'Stop Motion', tags: ['stop motion', 'choppy', 'frames'], tip: 'DaVinci Resolve\'s Stop Motion: frames are held for a choppy, hand-made look, glitch / wiggle included. Zoomed or panned clips get DaVinci\'s own Stop Motion (set the same Frame Repeat in Resolve\'s Inspector > Effects)', ofx: 'Resolve FX/Resolve FX Temporal/Stop Motion', repeat: true },
    // Glass: the frosted half of the "Glass Blur (ML)" text preset. Not in the panel's list (hidden): the bridge adds it
    // to the footage clip(s) under a Glass Blur caption and fills it from the caption (fusion_bridge.glass_sync).
    { id: 'Glass', name: 'Glass', tags: [], tip: 'Frosted glass behind a Glass Blur caption', hidden: true }
];
const ORDER = EFFECTS.filter(e => !e.hidden).map(e => e.id);
const DEFAULT_STRENGTH = 25;
const HOLD_DEFAULT = 2;      // Stop Motion Frame Repeat our glitch / wiggle hold for (FX_HOLD_DEFAULT in fusion_bridge.py)
// the tool inside each effect that holds its Strength (keep in step with FX_STRENGTH_TOOL in src/python/fusion_bridge.py)
const STRENGTH_TOOL = { Glitch: 'GlitchOut', Wiggle: 'WiggleDisplace' };
// the tool holding each effect's other settings (fx_param; FX_PARAM_TOOL in fusion_bridge.py)

function effectsDir() {
    return resolveUserDir('Fusion', 'Templates', 'Edit', 'Effects', CATEGORY);
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
// a published control (shown in Resolve's Inspector): [innerTool, innerInput, label, default, controlGroup?] (one
// controlGroup number per colour, so its Red / Green / Blue show as one colour control)
function group(name, mainIn, mainOut, published, tools) {
    const pub = published.map((p, i) =>
        '\t\t\t\tInput' + (i + 1) + ' = InstanceInput {\n\t\t\t\t\tSourceOp = "' + p[0] + '",\n\t\t\t\t\tSource = "' + p[1] + '",\n' +
        '\t\t\t\t\tName = "' + p[2] + '",\n' + (p[4] ? '\t\t\t\t\tControlGroup = ' + p[4] + ',\n' : '') + '\t\t\t\t\tDefault = ' + p[3] + ',\n\t\t\t\t},\n').join('');
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

// Glitch / Wiggle have one Strength slider, 0..100: 0 = no effect, DEFAULT_STRENGTH = a light, clearly visible look.
// It is a user control on the effect's main tool (STRENGTH_TOOL) and is published in Resolve's Inspector; the panel
// sets it through the bridge (fx_strength).

// Stop Motion: a TimeStretcher, the clip's LAST Fusion effect (right before its output), so the held frames carry the
// glitch / wiggle with them. Hold = Frame Repeat (1..10, default HOLD_DEFAULT): each picture is held that many frames,
// counted from the clip's start (the same clock as Glitch / Wiggle's Hold).
function stopMotion() {
    const H = 'StopMotionTime.Hold';
    const ctl = '\t\t\t\t\tUserControls = ordered() { Hold = { LINKS_Name = "Frame Repeat", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", ' +
        'INP_Integer = true, INP_Default = ' + HOLD_DEFAULT + ', INP_MinAllowed = 1, INP_MaxAllowed = 10, INP_MinScale = 1, INP_MaxScale = 10, ICS_ControlPage = "Controls", }, },\n';
    return group('ELSAStopMotion', ['StopMotionTime', 'Input'], 'StopMotionTime', [['StopMotionTime', 'Hold', 'Frame Repeat', HOLD_DEFAULT]], [
        tool('StopMotionTime', 'TimeStretcher', [
            'Hold = Input { Value = ' + HOLD_DEFAULT + ', }',
            expr('SourceTime', 0, 'comp.RenderStart+floor((time-comp.RenderStart)/' + H + ')*' + H),
            'InterpolateBetweenFrames = Input { Value = 0, }'
        ], 0, 0, ctl)
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
// Duration (Dur, frames from the clip's start; 0 = the whole clip): after it the glitch stops (no jumps, no fringes).
const GLITCH_DEFAULTS = { colorA: [1, 0, 0], colorB: [0, 1, 1], opacity: 85, duration: 0 };
function glitch() {
    const S = 'GlitchOut.Strength';
    const rel = '(time-comp.RenderStart)';
    const on = 'iif(GlitchOut.Dur>0.5,iif(' + rel + '<GlitchOut.Dur,1,0),1)';
    const blink = '(' + on + ')*iif(GlitchOut.BlinkIn>0.5,1,0)*iif(' + S + '>0,1,0)*iif(' + rel + '<' + BLINK_FRAMES + ',1,0)*iif(' + rel + '>=0,1,0)';
    const burst = '(' + on + ')*max(GlitchOut.Blink, iif(' + hash(1) + '>1-0.35*min(1,' + S + '/50),1,0))';
    const amt = '(' + on + ')*iif(GlitchOut.Blink>0.5, max(' + S + '/50,0.6), ' + S + '/50)';
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
        'Dur = { LINKS_Name = "Duration", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Integer = true, INP_Default = ' + D.duration + ', INP_MinScale = 0, INP_MaxScale = 120, INP_MinAllowed = 0, INP_MaxAllowed = 100000, ICS_ControlPage = "Controls", INPS_StatusText = "Frames the glitch lasts from the clip start (0 = the whole clip)", }, ' +
        hidden('Blink') + ', ' + hidden('Burst') + ', ' + hidden('Amt') + ', ' + hidden('Show') + ', ' + hidden('Blk') + ', ' + holdCtl() + ', },\n';
    const tint = (name, src, id, x, y) => tool(name, 'ColorGain', [inp('Input', src),
        expr('GainRed', 1, 'GlitchOut.' + id + 'Red'), expr('GainGreen', 1, 'GlitchOut.' + id + 'Green'), expr('GainBlue', 1, 'GlitchOut.' + id + 'Blue')], x, y);
    const ghost = (name, bg, fg, sign, x, extra) => tool(name, 'Merge', [inp('Background', bg), inp('Foreground', fg),
        expr('Center', '{ 0.5, 0.5 }', split(sign)), 'ApplyMode = Input { Value = FuID { "Lighten" }, }',
        expr('Blend', D.opacity / 100, 'GlitchOut.Opacity/100'), 'PerformDepthMerge = Input { Value = 0, }'].concat(extra || []), x, 0, name === 'GlitchOut' ? user : '');
    return group('ELSAGlitch', ['GlitchJitter', 'Input'], 'GlitchOut', [
        ['GlitchOut', 'Strength', 'Strength', DEFAULT_STRENGTH],
        ['GlitchOut', 'BlinkIn', 'Blink at Start', 1],
        ['GlitchOut', 'ColorARed', 'Colour A', D.colorA[0], 1], ['GlitchOut', 'ColorAGreen', 'Colour A Green', D.colorA[1], 1], ['GlitchOut', 'ColorABlue', 'Colour A Blue', D.colorA[2], 1],
        ['GlitchOut', 'ColorBRed', 'Colour B', D.colorB[0], 2], ['GlitchOut', 'ColorBGreen', 'Colour B Green', D.colorB[1], 2], ['GlitchOut', 'ColorBBlue', 'Colour B Blue', D.colorB[2], 2],
        ['GlitchOut', 'Opacity', 'Opacity', D.opacity],
        ['GlitchOut', 'Dur', 'Duration', D.duration]
    ], [
        tool('GlitchJitter', 'Transform', [expr('Center', '{ 0.5, 0.5 }', jitter), expr('Size', 1, 'GlitchOut.Show')], 0, 0),
        tint('GlitchTintA', 'GlitchJitter', 'ColorA', 110, -50),
        tint('GlitchTintB', 'GlitchJitter', 'ColorB', 110, 50),
        ghost('GlitchGhostA', 'GlitchJitter', 'GlitchTintA', '+', 220),
        ghost('GlitchOut', 'GlitchGhostA', 'GlitchTintB', '-', 330, [
            'Strength = Input { Value = ' + DEFAULT_STRENGTH + ', }', 'BlinkIn = Input { Value = 1, }',
            'ColorARed = Input { Value = ' + D.colorA[0] + ', }', 'ColorAGreen = Input { Value = ' + D.colorA[1] + ', }', 'ColorABlue = Input { Value = ' + D.colorA[2] + ', }',
            'ColorBRed = Input { Value = ' + D.colorB[0] + ', }', 'ColorBGreen = Input { Value = ' + D.colorB[1] + ', }', 'ColorBBlue = Input { Value = ' + D.colorB[2] + ', }',
            'Opacity = Input { Value = ' + D.opacity + ', }', 'Dur = Input { Value = ' + D.duration + ', }', 'Hold = Input { Value = 1, }',
            expr('Blk', 2, 'iif(GlitchOut.Hold>1,GlitchOut.Hold,2)'),
            expr('Blink', 0, blink), expr('Burst', 0, burst), expr('Amt', 0.5, amt), expr('Show', 1, show)
        ])
    ]);
}

// Transform: zoom / move between the Start and End frames (clip frames, 0 = its first; End 0 = its last), from neutral to
// the values (Reverse: from the values back to neutral), shaped by an easing curve. Before Start it rests at the
// beginning, after End it holds the end. Values in percent: Zoom 100 = no zoom; Left / Right and Up / Down are
// percent of the frame (+ = right / up). The first effect in the stack, so glitch / wiggle / stop motion act on it.
// Simple expressions only: Prog = 0..1 progress (on the Hold clock, so Stop Motion's beat applies), E = eased.
const EASES = ['Linear', 'Ease In Quad', 'Ease Out Quad', 'Ease In Out Quad', 'Ease In Quart', 'Ease Out Quart', 'Ease In Out Quart',
    'Ease In Expo', 'Ease Out Expo', 'Ease In Out Expo', 'Ease In Back', 'Ease Out Back', 'Ease In Out Back'];
const TRANSFORM_DEFAULTS = { ZoomPct: 115, MoveX: 0, MoveY: 0, Ease: 3, Reverse: 0, InF: 0, OutF: 0 };
function easeExpr(u) {
    const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1;
    const f = [
        u,
        u + '^2',
        '1-(1-' + u + ')^2',
        'iif(' + u + '<0.5, 2*' + u + '^2, 1-(2-2*' + u + ')^2/2)',
        u + '^4',
        '1-(1-' + u + ')^4',
        'iif(' + u + '<0.5, 8*' + u + '^4, 1-(2-2*' + u + ')^4/2)',
        'iif(' + u + '<=0, 0, 2^(10*' + u + '-10))',
        'iif(' + u + '>=1, 1, 1-2^(-10*' + u + '))',
        'iif(' + u + '<=0, 0, iif(' + u + '>=1, 1, iif(' + u + '<0.5, 2^(20*' + u + '-10)/2, (2-2^(10-20*' + u + '))/2)))',
        c3 + '*' + u + '^3-' + c1 + '*' + u + '^2',
        '1+' + c3 + '*(' + u + '-1)^3+' + c1 + '*(' + u + '-1)^2',
        'iif(' + u + '<0.5, (2*' + u + ')^2*(' + (c2 + 1) + '*2*' + u + '-' + c2 + ')/2, ((2*' + u + '-2)^2*(' + (c2 + 1) + '*(2*' + u + '-2)+' + c2 + ')+2)/2)'
    ];
    let e = f[f.length - 1];
    for (let i = f.length - 2; i >= 0; i--) e = 'iif(T.Ease<' + (i + 0.5) + ', ' + f[i] + ', ' + e + ')';
    return e;
}
function transform() {
    const D = TRANSFORM_DEFAULTS, T = 'XfMove';
    const out = 'iif(T.OutF>0, T.OutF, comp.RenderEnd-comp.RenderStart)';
    const t = 'floor((time-comp.RenderStart)/T.Hold)*T.Hold';
    const prog = 'min(1, max(0, (' + t + '-T.InF)/max(1, ' + out + '-T.InF)))';
    const u = 'iif(T.Reverse>0.5, 1-T.Prog, T.Prog)';
    const ex = (x) => x.replace(/\bT\./g, T + '.');
    const hidden = (id) => id + ' = { LINKS_Name = "' + id + '", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", IC_Visible = false, INP_Passive = true, INP_External = false, ICS_ControlPage = "Controls", }';
    const pct = (id, label, def, min, max, lo, hi) => id + ' = { LINKS_Name = "' + label + '", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Default = ' + def +
        ', INP_MinScale = ' + min + ', INP_MaxScale = ' + max + ', INP_MinAllowed = ' + lo + ', INP_MaxAllowed = ' + hi + ', ICS_ControlPage = "Controls", }';
    const user = '\t\t\t\t\tUserControls = ordered() { ' +
        pct('ZoomPct', 'Zoom %', D.ZoomPct, 50, 200, 1, 1000) + ', ' +
        pct('MoveX', 'Left / Right %', D.MoveX, -50, 50, -200, 200) + ', ' +
        pct('MoveY', 'Up / Down %', D.MoveY, -50, 50, -200, 200) + ', ' +
        'Ease = { LINKS_Name = "Ease", LINKID_DataType = "Number", INPID_InputControl = "ComboControl", INP_Integer = true, INP_Default = ' + D.Ease + ', ' +
        EASES.map(n => '{ CCS_AddString = "' + n + '", }').join(', ') + ', ICS_ControlPage = "Controls", }, ' +
        'Reverse = { LINKS_Name = "Reverse", LINKID_DataType = "Number", INPID_InputControl = "CheckboxControl", INP_Integer = true, INP_Default = 0, ICS_ControlPage = "Controls", INPS_StatusText = "Start at the values and end neutral", }, ' +
        'InF = { LINKS_Name = "Start Frame", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Integer = true, INP_Default = 0, INP_MinScale = 0, INP_MaxScale = 120, INP_MinAllowed = 0, INP_MaxAllowed = 100000, ICS_ControlPage = "Controls", INPS_StatusText = "Clip frame the move starts on (0 = the first)", }, ' +
        'OutF = { LINKS_Name = "End Frame", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Integer = true, INP_Default = 0, INP_MinScale = 0, INP_MaxScale = 120, INP_MinAllowed = 0, INP_MaxAllowed = 100000, ICS_ControlPage = "Controls", INPS_StatusText = "Clip frame the move ends on (0 = the last)", }, ' +
        holdCtl() + ', ' + hidden('Prog') + ', ' + hidden('E') + ', },\n';
    return group('ELSATransform', [T, 'Input'], T, [
        [T, 'ZoomPct', 'Zoom %', D.ZoomPct], [T, 'MoveX', 'Left / Right %', D.MoveX], [T, 'MoveY', 'Up / Down %', D.MoveY],
        [T, 'Ease', 'Ease', D.Ease], [T, 'Reverse', 'Reverse', D.Reverse], [T, 'InF', 'Start Frame', D.InF], [T, 'OutF', 'End Frame (0 = last)', D.OutF]
    ], [
        tool(T, 'Transform', [
            'ZoomPct = Input { Value = ' + D.ZoomPct + ', }', 'MoveX = Input { Value = ' + D.MoveX + ', }', 'MoveY = Input { Value = ' + D.MoveY + ', }',
            'Ease = Input { Value = ' + D.Ease + ', }', 'Reverse = Input { Value = ' + D.Reverse + ', }', 'InF = Input { Value = ' + D.InF + ', }', 'OutF = Input { Value = ' + D.OutF + ', }',
            'Hold = Input { Value = 1, }',
            expr('Prog', 0, ex(prog)),
            expr('E', 0, ex(easeExpr(u))),
            expr('Size', 1, ex('1+(T.ZoomPct/100-1)*T.E')),
            expr('Center', '{ 0.5, 0.5 }', ex('Point(0.5+T.MoveX/100*T.E, 0.5+T.MoveY/100*T.E)'))
        ], 0, 0, user)
    ]);
}

// Track Subject: one Transform (XfTrack) whose Center / Pivot / Size the bridge keys from the tracked subject
// (fx_bake_track). Follow X / Y / Scale and Smoothing are hidden inputs the panel sets; the raw track is kept on the
// tool (SetData), so changing them re-keys without tracking again.
const TRACK_DEFAULTS = { FollowX: 1, FollowY: 1, FollowScale: 0, FollowRot: 0, Smooth: 20 };
function track() {
    const T = 'XfTrack', D = TRACK_DEFAULTS;
    const hid = (id, def) => id + ' = { LINKS_Name = "' + id + '", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Default = ' + def + ', IC_Visible = false, ICS_ControlPage = "Controls", }';
    const user = '\t\t\t\t\tUserControls = ordered() { ' + Object.keys(D).map(k => hid(k, D[k])).join(', ') + ', },\n';
    return group('ELSATrack', [T, 'Input'], T, [], [
        tool(T, 'Transform', Object.keys(D).map(k => k + ' = Input { Value = ' + D[k] + ', }'), 0, 0, user)
    ]);
}

// Glass: macOS-style frosted glass on the footage behind a Glass Blur caption's emphasis pill.
// GlassShape redraws the caption's pill (a Text+ with the emphasis word, its element 1 drawn as the rounded box) with
// the caption's own values, which the bridge copies in (glass_sync): text, font, size, row centre, Box Width / Height /
// X / Y and the Emphasis timing. GlassXf applies the caption clip's Edit Pan / Tilt / Zoom / Rotation (effects work in
// timeline space). That pill is the mask for: Displace (lens bend at the edges, its map = the pill blurred) ->
// Gaussian Blur (frost) -> Brightness / Saturation (vibrancy). Outside the caption's frames the mask is empty and the
// blur sizes are 0, so the clip passes through. Simple expressions only (Lua ones cost ~25 ms a frame in effects).
// Lead = frames from this clip's first frame to the caption's first frame; S2 / Dur = the pill's grow-in (as the
// caption's Highlight: starts 3 frames after Emphasis Start, over Dur frames); Len = the caption's length.
const GLASS_DEFAULTS = { Frost: 22, Bend: 0.1, Vib: 1.3, Bright: 0.05 };
function glass() {
    const G = 'GlassShape';
    const rel = '(time-comp.RenderStart-' + G + '.Lead)';
    const hid = (id, def) => id + ' = { LINKS_Name = "' + id + '", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Default = ' + def + ', IC_Visible = false, ICS_ControlPage = "Controls", }';
    const D = GLASS_DEFAULTS;
    const ctl = { Lead: 0, S2: 10, Dur: 8, Len: 0, BoxW: 1, BoxH: 1, Frost: D.Frost, Bend: D.Bend, Vib: D.Vib, Bright: D.Bright, U: 0, On: 0 };
    const user = '\t\t\t\t\tUserControls = ordered() { ' + Object.keys(ctl).map(k => hid(k, ctl[k])).join(', ') + ', },\n';
    const grow = (box) => '(0.88+0.12*(1-(1-' + G + '.U)^4))*' + G + '.' + box;
    const mask = ['EffectMask = Input { SourceOp = "GlassXf", Source = "Output", }'];
    return group('ELSAGlass', ['GlassDisplace', 'Input'], 'GlassOut', [], [
        tool(G, 'TextPlus', Object.keys(ctl).filter(k => k !== 'U' && k !== 'On').map(k => k + ' = Input { Value = ' + ctl[k] + ', }').concat([
            expr('U', 0, 'min(1, max(0, (' + rel + '-' + G + '.S2-3)/max(1,' + G + '.Dur)))'),
            expr('On', 0, 'iif(' + rel + '>=0, 1, 0)*iif(' + rel + '<' + G + '.Len, 1, 0)'),
            'UseFrameFormatSettings = Input { Value = 1, }',
            'StyledText = Input { Value = "", }', 'Font = Input { Value = "Poppins", }', 'Style = Input { Value = "Bold", }',
            'Size = Input { Value = 0.115, }', 'Center = Input { Value = { 0.5, 0.47 }, }',
            'CharacterSpacing = Input { Value = 1, }', 'LineSpacing = Input { Value = 1, }',
            'HorizontalLeftCenterRight = Input { Value = 0, }', 'HorizontalJustificationCenter = Input { Value = 0, }',
            'ElementShape1 = Input { Value = 2, }', 'Level1 = Input { Value = 1, }',
            'ExtendHorizontal1 = Input { Value = 0.2, }', 'ExtendVertical1 = Input { Value = 0, }', 'Round1 = Input { Value = 0.5, }',
            'Offset1 = Input { Value = { 0, 0 }, }',
            expr('SizeX1', 1, grow('BoxW')), expr('SizeY1', 1, grow('BoxH')),
            expr('Opacity1', 0, 'min(1, ' + G + '.U*1.6)*' + G + '.On'),
            'Red1 = Input { Value = 1, }', 'Green1 = Input { Value = 1, }', 'Blue1 = Input { Value = 1, }'
        ]), 0, -120, user),
        tool('GlassXf', 'Transform', [inp('Input', G), 'Center = Input { Value = { 0.5, 0.5 }, }', 'Size = Input { Value = 1, }', 'Angle = Input { Value = 0, }'], 0, -60),
        // float from here on: blurring the 8-bit Text+ mask stepped the lens normals into streaks
        tool('GlassF', 'ChangeDepth', [inp('Input', 'GlassXf'), 'Depth = Input { Value = 4, }'], 110, -120),
        // the lens: the pill's soft edge as a height map -> normals -> XY Displace (bends only at the rim; Fusion's
        // Radial Displace swirls instead)
        tool('GlassInner', 'Blur', [inp('Input', 'GlassF'), expr('XBlurSize', 60, '60*' + G + '.On')], 220, -120),
        tool('GlassNormal', 'CreateBumpMap', [inp('Input', 'GlassInner'), 'SourceChannel = Input { Value = FuID { "Alpha" }, }',
            'HeightScale = Input { Value = 100, }', 'TextureDepth = Input { Value = 4, }'], 330, -120),
        // the frost covers the core only, so the rim stays clear enough to show the bend
        tool('GlassCore', 'ErodeDilate', [inp('Input', 'GlassF'), 'XAmount = Input { Value = -0.006, }'], 220, -60),
        tool('GlassCoreSoft', 'Blur', [inp('Input', 'GlassCore'), 'XBlurSize = Input { Value = 12, }'], 330, -60),
        tool('GlassDisplace', 'Displace', [inp('Foreground', 'GlassNormal'), 'Type = Input { Value = 1, }',
            'XChannel = Input { Value = 0, }', 'YChannel = Input { Value = 1, }',
            'XOffset = Input { Value = -0.5, }', 'YOffset = Input { Value = -0.5, }',
            expr('XRefraction', 0, G + '.Bend*' + G + '.On'), expr('YRefraction', 0, G + '.Bend*' + G + '.On')].concat(mask), 110, 0),
        tool('GlassBlur', 'Blur', [inp('Input', 'GlassDisplace'), expr('XBlurSize', D.Frost, G + '.Frost*' + G + '.On'),
            'EffectMask = Input { SourceOp = "GlassCoreSoft", Source = "Output", }'], 220, 0),
        tool('GlassOut', 'BrightnessContrast', [inp('Input', 'GlassBlur'), expr('Brightness', 0, G + '.Bright*' + G + '.On'),
            expr('Saturation', 1, '1+(' + G + '.Vib-1)*' + G + '.On')].concat(mask), 330, 0)
    ]);
}

const MAKERS = { Transform: transform, Track: track, StopMotion: stopMotion, Wiggle: wiggle, Glitch: glitch, Glass: glass };

// Writes (or refreshes) the effect templates Resolve lists under Effects > Subtitle Animator.
function installEffects() {
    const dir = effectsDir();
    fs.mkdirSync(dir, { recursive: true });
    const out = [];
    for (const e of EFFECTS) {
        if (!MAKERS[e.id]) continue;      // a built-in Resolve effect: nothing to install
        const file = path.join(dir, fileName(e.id));
        const body = MAKERS[e.id]();
        let cur = null;
        try { cur = fs.readFileSync(file, 'utf8'); } catch (err) { cur = null; }
        if (cur !== body) fs.writeFileSync(file, body);
        out.push(file);
    }
    return out;
}

function effectsForUI() { return EFFECTS.filter(e => !e.hidden).map(e => ({ id: e.id, name: e.name, tags: e.tags, tip: e.tip, file: fileName(e.id), defaultStrength: e.repeat ? HOLD_DEFAULT : (e.ofx ? null : DEFAULT_STRENGTH), noStrength: (!!e.ofx && !e.repeat) || !!e.transform || !!e.track, repeat: !!e.repeat, glitch: e.id === 'Glitch' ? GLITCH_DEFAULTS : undefined, transform: e.transform ? { defaults: TRANSFORM_DEFAULTS, eases: EASES } : undefined, track: e.track ? { defaults: TRACK_DEFAULTS } : undefined })); }

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
    const r = await require('./fusion-bridge').bridgeCall('fx_get', {}, 5000);
    // the clip of a running Resolve preview is a temporary text preset: flagged so the panel refuses effects on it
    const live = state.liveSession && state.liveSession.itemId ? String(state.liveSession.itemId) : null;
    if (live && r && Array.isArray(r.clips)) for (const c of r.clips) if (String(c.id) === live) c.temp = true;
    return r;
}
// Adds (on = true), removes (false) or flips (null) one effect preset on the selected clips.
async function fxSet(event, effectId, on, strength, params, hold) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    if (!EFFECTS.some(e => e.id === effectId)) return { error: 'Unknown effect' };
    ensureInstalled();
    const before = EFFECT_SFX_DEFAULTS[effectId] ? await fxClipsWith(effectId) : null;
    const r = await require('./fusion-bridge').bridgeCall('fx_set', { effect: effectId, on: on === true || on === false ? on : null, strength: Number.isFinite(Number(strength)) && strength !== null ? Math.max(0, Math.min(100, Number(strength))) : null, params: cleanParams(params), hold: Number.isFinite(Number(hold)) && hold !== null ? Math.max(1, Math.min(10, Math.round(Number(hold)))) : null }, 15000);
    if (before && r && Array.isArray(r.clips)) {
        try { r.sounds = await syncEffectSfx(effectId, r.clips, before, params); } catch (e) { r.sounds = { error: e.message }; }
    }
    return r;
}

// ------------------------------------------------------------------ an effect's own sound (Glitch)
// Turning Glitch on for a clip also puts a glitch sound on the timeline at the clip's start (its "Blink at Start"
// burst) and lasting as long as the clip (the glitch's length), linked to the clip; turning it off removes it again. The sound is library.json effectSfx.Glitch
// ({ file, volume, len (frames), enabled }), else EFFECT_SFX_DEFAULTS; its level follows the peak window
// (sfx-level.js). _app/effect-sounds.json = { <effect>: { <clip id>: [sound clip ids] } }.
const EFFECT_SFX_DEFAULTS = {
    // heard only while the picture glitches: cuts of a 20 s texture (tools/trim-sfx.py glitch_bed), one per burst
    Glitch: { file: 'kave_msri-glitch-bed-312910b.wav', volume: -6, follow: 'bursts', bedSeconds: 20 }
};
function effectSfxSpec(effectId) {
    let lib = null;
    try { lib = require('./library').loadLib(); } catch (e) { lib = null; }
    const own = lib && lib.effectSfx && lib.effectSfx[effectId];
    const spec = Object.assign({}, EFFECT_SFX_DEFAULTS[effectId] || {}, own || {});
    return spec.enabled === false || !spec.file ? null : spec;
}
const FX_SFX_FILE = () => path.join(require('./config').APP_DATA_DIR, 'effect-sounds.json');
function fxSfxRead() { try { return JSON.parse(fs.readFileSync(FX_SFX_FILE(), 'utf8')) || {}; } catch (e) { return {}; } }
function fxSfxWrite(o) { try { fs.mkdirSync(path.dirname(FX_SFX_FILE()), { recursive: true }); fs.writeFileSync(FX_SFX_FILE(), JSON.stringify(o)); } catch (e) { /* ignore */ } }
// ids of the selected clips that already have the effect (so only newly glitched clips get a sound)
async function fxClipsWith(effectId) {
    try {
        const g = await require('./fusion-bridge').bridgeCall('fx_get', {}, 5000);
        return new Set(((g && g.clips) || []).filter(c => c.effects && c.effects[effectId]).map(c => String(c.id)));
    } catch (e) { return new Set(); }
}
async function syncEffectSfx(effectId, clips, before, params) {
    const state = require('./state');
    const { getProject, timelineMeta } = require('./resolve');
    const P = require('./placement');
    const project = await getProject();
    const tl = project && await project.GetCurrentTimeline();
    if (!tl) return null;
    const reg = fxSfxRead();
    const mine = reg[effectId] = reg[effectId] || {};
    const added = clips.filter(c => c.effects && c.effects[effectId] && !before.has(String(c.id)));
    const removed = clips.filter(c => !(c.effects && c.effects[effectId]) && mine[String(c.id)]);
    let placed = 0, deleted = 0;
    const warnings = [], ids = [];
    state.applying = true;
    try {
        for (const c of removed) {
            const ids = mine[String(c.id)] || [];
            const left = ids.length ? await P.deleteExtraSfx(tl, ids) : [];
            deleted += ids.length - left.length;
            if (left.length) mine[String(c.id)] = left; else delete mine[String(c.id)];
        }
        const spec = added.length ? effectSfxSpec(effectId) : null;
        if (spec) {
            const meta = await timelineMeta(tl, project);
            for (const c of added) {
                const got = await placeEffectSounds(tl, project, meta, effectId, String(c.id), spec, warnings);
                if (got.length) { mine[String(c.id)] = (mine[String(c.id)] || []).concat(got); placed += got.length; ids.push(...got); }
            }
        }
    } finally {
        state.applying = false;
        fxSfxWrite(reg);
    }
    return { placed, deleted, warnings, ids };
}

// The sound clips for one clip's effect -> their ids. Glitch (follow 'bursts'): one cut of the glitch texture for each
// run of frames where the picture really glitches (bridge glitch_bursts reads the effect's own Burst value per frame:
// Blink at Start, Strength, Hold and Duration included), so the sound is heard exactly while the glitch shows. Each
// cut starts at a different place in the texture with a slight pitch change, so no two bursts sound the same.
// Other effects: one sound from the clip start, 'clip' = as long as the clip, or a number of frames.
async function placeEffectSounds(tl, project, meta, effectId, clipId, spec, warnings) {
    const P = require('./placement');
    const item = await P.findItemById(tl, clipId);
    if (!item) return [];
    const start = Number(await item.GetStart()), end = Number(await item.GetEnd());
    // the effect's sound goes on the audio track of the text preset's own sound (its linked audio), so a caption's
    // sounds stay on one layer; where that track is busy at those frames, the lowest free track is used instead
    const track = await presetAudioTrack(item);
    const base = { file: spec.file, enabled: true, volume: Number(spec.volume) || 0, align: 'start', link: true, track };
    const out = [];
    if ((spec.follow || (effectId === 'Glitch' ? 'bursts' : '')) === 'bursts') {
        let runs = [];
        try { runs = ((await require('./fusion-bridge').bridgeCall('glitch_bursts', { item: clipId }, 15000)) || {}).runs || []; }
        catch (e) { warnings.push('Glitch timing could not be read: ' + e.message); return []; }
        const vary = require('./sfx-level').variations();
        const fps = Math.round((meta && meta.fps) || 30);
        const room = Math.max(1, Math.round((Number(spec.bedSeconds) || 20) * fps) - fps);
        for (let i = 0; i < runs.length; i++) {
            const [a, b] = runs[i];
            const len = Math.max(1, b - a);
            const layer = Object.assign({}, base, { id: 'fx' + effectId + i, offset: a, lenMode: 'fixed', len,
                trimIn: i === 0 && a === 0 ? 0 : (i * 37 + 13) % Math.max(1, room - len), fade: Math.min(2, Math.floor(len / 2)) });
            const got = await P.placeExtraSfx(tl, project, meta, [layer], start, end, [], item, clipId, warnings, null, false, null, null);
            for (const x of got) {
                const v = vary.next();
                if (i > 0 && v.cents) { try { await x.it.SetProperties({ AudioPitchEnabled: true, AudioPitchSemiTones: 0, AudioPitchCents: v.cents }); } catch (e) { /* pitch is a convenience */ } }
                out.push(x.id);
            }
        }
        return out;
    }
    const layer = Object.assign({}, base, { id: 'fx' + effectId, offset: 0, trimIn: Number(spec.trimIn) || 0,
        len: spec.len === 'clip' ? 0 : Math.max(1, Math.round(Number(spec.len) || 0)), lenMode: spec.len === 'clip' ? 'clip' : 'fixed', fade: spec.fade });
    const got = await P.placeExtraSfx(tl, project, meta, [layer], start, end, [], item, clipId, warnings, null, false, null, null);
    return got.map(x => x.id);
}
// The audio track of the clip's own sound: its linked audio clips (the lowest track among them), else 0 (auto).
// The effect's own earlier sounds are skipped, so a re-sync does not follow itself onto another track.
async function presetAudioTrack(item) {
    const reg = fxSfxRead();
    const ours = new Set(Object.values(reg).flatMap(m => Object.values(m || {}).flat()).map(String));
    let best = 0;
    try {
        let linked = (await item.GetLinkedItems()) || [];
        if (!Array.isArray(linked)) linked = Object.values(linked);
        for (const x of linked) {
            try {
                if (ours.has(String(await x.GetUniqueId()))) continue;
                const ti = await x.GetTrackTypeAndIndex();
                const kind = ti && (Array.isArray(ti) ? ti[0] : ti[1]), n = ti && Number(Array.isArray(ti) ? ti[1] : ti[2]);
                if (kind === 'audio' && n > 0 && (!best || n < best)) best = n;
            } catch (e) { /* next */ }
        }
    } catch (e) { best = 0; }
    return best;
}
// A setting that moves the bursts changed (Strength, Blink at Start, Duration, Hold): the selected glitched clips'
// sounds are placed again from the new burst timing.
async function resyncEffectSfx(effectId) {
    if (!EFFECT_SFX_DEFAULTS[effectId]) return null;
    const state = require('./state');
    const { getProject, timelineMeta } = require('./resolve');
    const P = require('./placement');
    const spec = effectSfxSpec(effectId);
    const reg = fxSfxRead();
    const mine = reg[effectId] = reg[effectId] || {};
    const sel = Array.from(await fxClipsWith(effectId)).filter(id => mine[id]);
    if (!spec || !sel.length) return null;
    const project = await getProject();
    const tl = project && await project.GetCurrentTimeline();
    if (!tl) return null;
    const warnings = [];
    let placed = 0;
    state.applying = true;
    try {
        const meta = await timelineMeta(tl, project);
        for (const id of sel) {
            const left = await P.deleteExtraSfx(tl, mine[id] || []);
            const got = await placeEffectSounds(tl, project, meta, effectId, id, spec, warnings);
            mine[id] = left.concat(got);
            placed += got.length;
        }
    } finally {
        state.applying = false;
        fxSfxWrite(reg);
    }
    return { placed, clips: sel.length, warnings };
}

// Sets one effect's Strength (0..100) on the selected clips that have it.
async function fxStrength(event, effectId, value) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    if (!EFFECTS.some(e => e.id === effectId)) return { error: 'Unknown effect' };
    const v = Math.max(effectId === 'StopMotion' ? 1 : 0, Math.min(effectId === 'StopMotion' ? 10 : 100, Math.round(Number(value))));
    if (!Number.isFinite(v)) return { error: 'Bad strength' };
    const r = await require('./fusion-bridge').bridgeCall('fx_strength', { effect: effectId, value: v }, 8000);
    if (r && EFFECT_SFX_DEFAULTS[effectId]) { try { r.sounds = await resyncEffectSfx(effectId); } catch (e) { r.sounds = { error: e.message }; } }
    return r;
}

function cleanParams(v) {
    const out = {};
    for (const [k, x] of Object.entries(v && typeof v === 'object' ? v : {})) if (/^[A-Za-z]\w*$/.test(k) && Number.isFinite(Number(x))) out[k] = Number(x);
    return out;
}
// Sets other settings of one effect (Glitch: BlinkIn, ColorA* / ColorB*, Opacity, Dur) on the selected clips that have it.
async function fxParam(event, effectId, values) {
    const state = require('./state');
    if (state.applying) return { busy: true };
    if (!EFFECTS.some(e => e.id === effectId)) return { error: 'Unknown effect' };
    const r = await require('./fusion-bridge').bridgeCall('fx_param', { effect: effectId, values: cleanParams(values) }, 8000);
    if (r && EFFECT_SFX_DEFAULTS[effectId]) { try { r.sounds = await resyncEffectSfx(effectId); } catch (e) { r.sounds = { error: e.message }; } }
    return r;
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

module.exports = { EFFECTS, ORDER, CATEGORY, effectsDir, fileName, installEffects, effectsForUI, fxList, fxGet, fxSet, fxSetTags, syncEffectSfx, resyncEffectSfx, fxStrength, fxParam, STRENGTH_TOOL, DEFAULT_STRENGTH, _makers: MAKERS };
