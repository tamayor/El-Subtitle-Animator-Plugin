// "Animation Frames" retiming, added to every preset when it is saved into the library (see expandToolsInFile).
//
// A Follower's timing is hard to read: the last letter lands at <per-letter animation> + <delay> x (letters - 1).
// So a hidden time-remap (TimeStretcher "AnimTime") goes right after the text node, and the text node gets two inputs:
//   AnimNatural  (hidden)   the frame the animation ends at with the preset's own timing, for the text it holds now
//   AnimFrames   (slider)   the frame the last effect should end at; the whole text animation (Follower letters, delay,
//                           the text node's own keyframes) is scaled to land there and plays at normal speed after it.
//                           0 = the preset's own timing. Placement fills it in with AnimNatural (fusion_bridge.init_retime).
// Effects after the text (wiggle, glitch, stop motion) keep their own speed.

module.exports = { addRetiming, retimeTerms };

const SPLINES = /^(BezierSpline|CubicSpline|LUTBezier|PolyPath|XYPath|Path)$/;

function blockEndAt(s, open) {
    let d = 0;
    for (let j = open; j < s.length; j++) {
        if (s[j] === '{') d++;
        else if (s[j] === '}' && --d === 0) return j;
    }
    return -1;
}
// Top-level tools of the comp / setting: name -> { type, open (index of its "{"), depth (tabs) }
function toolMap(s) {
    const out = new Map();
    const re = /\n(\t*)([A-Za-z_]\w*) = ([\w.]+) \{/g;
    let m;
    while ((m = re.exec(s))) if (!out.has(m[2])) out.set(m[2], { type: m[3], open: m.index + m[0].length - 1, depth: m[1].length });
    return out;
}
const blockOf = (s, t) => s.slice(t.open, blockEndAt(s, t.open) + 1);
// keyframe times of a spline (or a path and its Displacement spline)
function keyTimes(s, T, op, seen = new Set()) {
    const t = T.get(op);
    if (!t || seen.has(op) || !SPLINES.test(t.type)) return [];
    seen.add(op);
    const b = blockOf(s, t);
    const ks = [...b.matchAll(/\[(-?[\d.]+)\] = \{/g)].map(m => parseFloat(m[1]));
    const d = /Displacement = Input \{\s*SourceOp = "(\w+)"/.exec(b);
    return d ? ks.concat(keyTimes(s, T, d[1], seen)) : ks;
}
const fmt = (x) => String(Math.round(x * 1000) / 1000);

// The text node the retiming hangs off: "Template" (Resolve's own name), else the only Text+ / MultiText.
function textNode(T) {
    const t = T.get('Template');
    if (t && /^(TextPlus|MultiText)$/.test(t.type)) return 'Template';
    const all = [...T].filter(([, v]) => /^(TextPlus|MultiText)$/.test(v.type));
    return all.length === 1 ? all[0][0] : null;
}

// Lua terms whose max is the natural end frame, e.g. ["16 + 0.5 * math.max(0, n(Follower1.Text.Value) - 1)"].
function retimeTerms(s, T, name) {
    const terms = [];
    const own = blockOf(s, T.get(name));
    const base = [...own.matchAll(/(\w+) = Input \{\s*SourceOp = "(\w+)"/g)].flatMap(m => keyTimes(s, T, m[2]));
    if (base.length) terms.push(fmt(Math.max(...base)));
    for (const [fname, t] of T) {
        if (t.type !== 'StyledTextFollower') continue;
        const b = blockOf(s, t);
        const ks = [...b.matchAll(/(\w+) = Input \{\s*SourceOp = "(\w+)"/g)].flatMap(m => keyTimes(s, T, m[2]));
        if (!ks.length) continue;
        const dm = /\bDelay = Input \{ Value = ([\d.]+)/.exec(b);
        const d = dm ? parseFloat(dm[1]) : 0;
        const a = Math.max(...ks);
        terms.push(d ? fmt(a) + ' + ' + fmt(d) + ' * math.max(0, n(' + fname + '.Text.Value) - 1)' : fmt(a));
    }
    return terms;
}

const luaLit = (e) => e.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

// Returns the comp text with the retiming added, or the text unchanged when it does not apply (already retimed,
// a word-by-word typing preset with its own Typing Frames, no text node, nothing animated, text inside a group).
function addRetiming(s) {
    try {
        if (/\bAnimTime = TimeStretcher\b/.test(s) || /\bTypingFrames = Input\b/.test(s)) return s;
        let T = toolMap(s);
        const name = textNode(T);
        if (!name) return s;
        const depth = T.get(name).depth;
        if ([...T.values()].some(v => /^(GroupOperator|MacroOperator)$/.test(v.type) && v.depth < depth)) return s;
        const terms = retimeTerms(s, T, name);
        if (!terms.length) return s;

        // 1. everything that read the text node now reads the retimed copy
        const refRe = new RegExp('SourceOp = "' + name + '",(\\s*)Source = "Output"', 'g');
        if (!refRe.test(s)) return s;
        s = s.replace(refRe, 'SourceOp = "AnimTime",$1Source = "Output"');

        // 2. the slider and the natural length on the text node
        T = toolMap(s);
        const tn = T.get(name);
        const end = blockEndAt(s, tn.open);
        let tb = s.slice(tn.open, end + 1);
        const natural = ': local function n(s) s = tostring(s or ""):gsub("[\\128-\\191]", ""):gsub("[\\r\\n]", ""); return #s end\n' +
            'return math.max(1, ' + terms.join(', ') + ')';
        tb = tb.replace('Inputs = {', 'Inputs = {\n\t\t\t\tAnimFrames = Input { Value = 0, },\n' +
            '\t\t\t\tAnimNatural = Input { Value = 1, Expression = "' + luaLit(natural) + '", },', );
        const uc = 'AnimFrames = { LINKS_Name = "Animation Frames", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", ' +
            'INP_Integer = true, INP_Default = 0, INP_MinAllowed = 0, INP_MaxAllowed = 100000, INP_MinScale = 0, INP_MaxScale = 120, ' +
            'ICS_ControlPage = "Text", INP_External = false, ' +
            'INPS_StatusText = "Frame where the last effect ends (0 = the preset\'s own timing)", }, ' +
            'AnimNatural = { LINKS_Name = "Natural Frames", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", ' +
            'IC_Visible = false, INP_Passive = true, INP_External = false, ICS_ControlPage = "Text", }, ';
        if (tb.includes('UserControls = ordered() {')) {
            tb = tb.replace('UserControls = ordered() {', 'UserControls = ordered() { ' + uc);
        } else {
            const vi = tb.lastIndexOf('\n\t\t\tViewInfo');
            if (vi >= 0) tb = tb.slice(0, vi) + '\n\t\t\tUserControls = ordered() { ' + uc + '},' + tb.slice(vi);
            else {
                const close = tb.lastIndexOf('}');
                tb = tb.slice(0, close).replace(/,?\s*$/, '') + ',\n\t\t\tUserControls = ordered() { ' + uc + '}\n\t\t' + tb.slice(close);
            }
        }

        // 3. the time-remap right after the text node
        const remap = ': local T = math.floor(tonumber(' + name + '.AnimFrames) or 0)\n' +
            'if T <= 0 then return time end\n' +
            'local N = tonumber(' + name + '.AnimNatural) or T\n' +
            'local rel = time - comp.RenderStart\n' +
            'if rel < T then return comp.RenderStart + rel * N / T end\n' +
            'return comp.RenderStart + N + rel - T';
        const tool = '\n\t\tAnimTime = TimeStretcher {\n\t\t\tInputs = {\n' +
            '\t\t\t\tSourceTime = Input { Value = 0, Expression = "' + luaLit(remap) + '", },\n' +
            '\t\t\t\tInterpolateBetweenFrames = Input { Value = 0, },\n' +
            '\t\t\t\tInput = Input { SourceOp = "' + name + '", Source = "Output", },\n' +
            '\t\t\t},\n\t\t},';
        let after = s.slice(end + 1);
        if (after.startsWith(',')) after = after.slice(1);
        return s.slice(0, tn.open) + tb + ',' + tool + after;
    } catch (e) {
        return s;
    }
}
