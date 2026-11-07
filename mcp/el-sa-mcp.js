#!/usr/bin/env node
// El Subtitle Animator MCP server (stdio, no dependencies).
// Lets Claude Code animate a Resolve timeline's subtitles with your presets, through the open plugin panel.
//
// Register once:
//   claude mcp add el-subtitle-animator -- node "/path/to/El Subtitle Animator Plugin/mcp/el-sa-mcp.js"
// The plugin panel must be open in Resolve: it writes its local address and token to
// ~/.el-subtitle-animator/mcp-endpoint.json when it starts (see src/main/automation.js).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ENDPOINT_FILE = path.join(os.homedir(), '.el-subtitle-animator', 'mcp-endpoint.json');
const SERVER_INFO = { name: 'el-subtitle-animator', version: '1.0.0' };

const INSTRUCTIONS = `El Subtitle Animator turns a DaVinci Resolve timeline's subtitles into animated Text+/MultiText clips (with sound effects) from the user's preset library.

Workflow for editing a video:
1. Call get_rules first and follow them. The user's "notes" are their own editing rules. If the user states rules for this video (allowed emoji tags, font, text colour, emphasis font/colour, layer, placement, max text size, line spacing), save them with set_rules before placing anything. When the font/colour override should only apply to some presets, pass keepPresetStyle: true on place for the others.
2. list_presets returns only presets allowed by the rules' tags. Never use a preset outside that list.
3. list_subtitles, then plan. Read the subtitles as sentences, not as Resolve's cuts: a cut often falls mid-thought ("If this is the bar then it's" / "fine, but the bar is this."). Group the words by thought ("If this is the bar then" / "it's fine, but the bar is this."; "So yeah, watch this" / "shit man. Come on." -> "So yeah," / "watch this shit man." / "Come on."): never leave a word stranded from the phrase it belongs to. For such a run call regroup with the subtitle numbers and your phrases, then place each phrase with its text, subtitle, startFrame and endFrame. Plan which subtitles get an animation (not necessarily all of them; vary presets and avoid repeating the same one back to back), which preset fits each line (one-word / one-line / multi-line / money / emphasis presets by name and tag), and for MultiText presets which word(s) to emphasize (pass parts {upper, emphasis, lower} that together spell the subtitle).
4. Layout: if the user gives a safe-zone reference image, call set_layout with its path (look at the image yourself and pass the labels you read as guideNames top to bottom / zoneNames). A layout only applies to timelines of the same shape as its image (a 9:16 social safe zone is ignored on a 16:9 timeline; get_layout says appliesToThisTimeline). When it applies, place keeps every clip inside its safe area and off its zones (shrinking textSize if needed), and the user can say e.g. "centre the subtitle on the captions line" (guide: "captions") or "in the captions area" (guide: "captions", align: "below").
5. When rules.position.avoidFaces is true, call get_frame for the subtitle and look at it. Choose x/y (0..1, top-left origin = where the text's centre goes) so the text sits on empty space and never over a face, eyes or mouth, and stays inside the safe area. Check get_tracks if layer placement matters.
6. Call place for each subtitle (once placed, its subtitle clip is disabled so it does not show under the animation; remove_placed re-enables it). Long lines: pass text with a "\\n" line break, and if the text would run off the frame pass textSize (e.g. 0.66) rather than scale. After the first few, call get_frame (at: "end", when all words are in) to check the result, and use remove_placed to fix mistakes.
7. Report what you placed, where, and any warnings.
Show the user your plan before placing more than about 10 clips.`;

const S = (props, required) => ({ type: 'object', properties: props || {}, required: required || [], additionalProperties: false });
const subtitleArg = { type: 'integer', description: 'Subtitle number (index from list_subtitles, starting at 1)' };

const TOOLS = [
    { name: 'status', description: 'Connection check: current timeline, size, fps, subtitle count and the active editing rules.', inputSchema: S() },
    { name: 'get_rules', description: 'The editing rules every placement follows (allowed emoji tags, forced font and text colour, MultiText emphasis font/colour, video layer policy, safe area, MultiText emphasis, sound, free-text notes).', inputSchema: S() },
    {
        name: 'set_rules',
        description: 'Change the editing rules (saved to edit-rules.json in the user\'s library folder; only the given fields change). Use when the user says e.g. "only use 🔥 and 💰 presets", "use only Poppins ExtraBold", "make the text white", "emphasis in Larken Black yellow", "keep text on V4", "never cover faces".',
        inputSchema: S({
            allowedTags: { type: 'array', items: { type: 'string' }, description: 'Emoji, tag names or ids. Empty array = all presets allowed.' },
            tagMatch: { type: 'string', enum: ['any', 'all'], description: 'any: preset has at least one of the tags; all: every tag' },
            font: { type: ['object', 'null'], properties: { font: { type: 'string' }, style: { type: 'string' } }, description: 'Force this font on every clip, e.g. {"font":"Poppins","style":"ExtraBold"}. null = keep each preset\'s font.' },
            color: { type: ['string', 'null'], description: 'Force this text fill colour on every clip, as hex, e.g. "#ffffff" (shading element 1, made solid; outlines and shadows keep the preset\'s). MultiText: every layer unless emphasis.color is set. null = keep each preset\'s colour.' },
            styleShare: {
                type: 'object',
                properties: { normal: { type: 'number', minimum: 0, maximum: 100 }, emphasis: { type: 'number', minimum: 0, maximum: 100 } },
                description: 'Percent of the clips that get the overrides; the rest keep the preset\'s default look, spread evenly (50 = every other clip, 20 = one in five). normal = font/color/kindStyle, emphasis = the MultiText emphasis. Default 100. From the prompt\'s "override N%".'
            },
            styleExcept: {
                type: 'object',
                properties: {
                    normal: { type: ['object', 'null'], properties: { tags: { type: 'array', items: { type: 'string' } }, keep: { type: 'string', enum: ['both', 'font', 'color'] } } },
                    emphasis: { type: ['object', 'null'], properties: { tags: { type: 'array', items: { type: 'string' } }, keep: { type: 'string', enum: ['both', 'font', 'color'] } } }
                },
                description: 'Presets with one of these tags skip the overrides. keep: both = their own font and colour, font = their own font (the colour override still applies), color = their own colour (the font override still applies). normal = font/color/kindStyle, emphasis = the MultiText emphasis. null = no exception. From the prompt\'s "except TAG, TAG (keep font & colour | keep font | keep colour)". place enforces it on its own, no keepPresetStyle needed.'
            },
            kindStyle: {
                type: 'object',
                properties: { textplus: { type: ['object', 'null'], properties: { font: { type: ['string', 'null'] }, style: { type: ['string', 'null'] }, color: { type: ['string', 'null'] } } }, multitext: { type: ['object', 'null'], properties: { font: { type: ['string', 'null'] }, style: { type: ['string', 'null'] }, color: { type: ['string', 'null'] } } } },
                description: 'A font/colour pair for one kind of preset only, beating font/color there: textplus = presets with plain Text+ nodes, multitext = MultiText presets. E.g. {"multitext":{"font":"Montserrat","style":"Black","color":"#ffffff"}}. null for a kind = use font/color.'
            },
            emphasis: {
                type: ['object', 'null'],
                properties: { font: { type: ['string', 'null'] }, style: { type: ['string', 'null'] }, color: { type: ['string', 'null'] } },
                description: 'MultiText presets only: font/style and fill colour for the emphasis layer (the key word), beating font/color there, e.g. {"font":"Larken","style":"Black","color":"#ffd400"}. Omitted fields follow font/color. null = the emphasis layer gets the same overrides as the rest.'
            },
            track: { type: 'object', properties: { mode: { type: 'string', enum: ['top', 'first-empty', 'fixed'] }, fixed: { type: 'integer', minimum: 2 }, from: { type: ['integer', 'null'], minimum: 2 }, to: { type: ['integer', 'null'], minimum: 2 } }, description: 'Video layer: top = above everything at that time, first-empty = lowest free layer above V1, fixed = always V<fixed>. from/to = keep it between V<from> and V<to> (to null = no limit): starts at V<from> and moves up past locked, disabled or busy tracks; past the range only when it is full. from and to null = use the panel\'s Placement range.' },
            position: {
                type: 'object',
                properties: {
                    defaultZone: { type: ['string', 'null'], enum: ['top', 'upper', 'center', 'lower', 'bottom', null] },
                    safeTop: { type: 'number' }, safeBottom: { type: 'number' }, safeLeft: { type: 'number' }, safeRight: { type: 'number' },
                    avoidFaces: { type: 'boolean' }
                }
            },
            multitext: { type: 'object', properties: { emphasis: { type: 'string', enum: ['auto', 'last', 'first', 'center'] }, uppercaseEmphasis: { type: 'boolean' } } },
            text: {
                type: 'object',
                properties: {
                    maxSize: { type: ['number', 'null'], description: 'Largest text Size allowed, as the Inspector shows it (e.g. 0.08). MultiText: the biggest layer, and the whole group shrinks with it. null = no cap' },
                    lineSpacing: { type: ['number', 'null'], description: 'Line Spacing, as the Inspector shows it (1 = normal). MultiText: each layer\'s, and the gaps between layers grow/shrink by the same ratio. null = the preset\'s' }
                },
                description: 'Text size and spacing for every placed clip. Use when the user says e.g. "max text size 0.08", "line spacing 1.2"'
            },
            sound: { type: 'boolean', description: 'Place the presets\' sound effects' },
            notes: { type: 'string', description: 'Free-text editing rules to remember (style, pacing, what to emphasize...)' }
        })
    },
    { name: 'get_layout', description: 'The safe-zone layout read from the user\'s reference image: named guide lines (y or x, 0..1), zones to keep text off (e.g. "head"), the safe area as bands of x spans, and the region below each guide.', inputSchema: S() },
    {
        name: 'set_layout',
        description: 'Read a safe-zone reference image (PNG, ideally the timeline\'s size, e.g. 1080x1920): transparent or white = safe area, black = off-limits, dark lines (solid or dashed) across the safe area = guides, dark boxes = zones (e.g. a head box) text must not cover. Saved in the rules, so every place call fits text inside it. Without image: rename the current layout\'s guides/zones. image: "default" restores the built-in social-media 9:16 safe zone (the default; guides eye, captions, graphics; zone head). image: null clears it.',
        inputSchema: S({
            image: { type: ['string', 'null'], description: 'Path of the PNG, "default" for the built-in social 9:16 safe zone, or null to clear' },
            guideNames: { type: 'array', items: { type: 'string' }, description: 'Names for the horizontal guides, top to bottom (read the labels on the image), e.g. ["eye","captions","graphics"]' },
            verticalNames: { type: 'array', items: { type: 'string' }, description: 'Names for the vertical guides, left to right' },
            zoneNames: { type: 'array', items: { type: 'string' }, description: 'Names for the zones, top to bottom, e.g. ["head"]' },
            fit: {
                type: 'object',
                properties: {
                    enabled: { type: 'boolean', description: 'Keep placed text inside the safe area (default true)' },
                    avoidZones: { type: 'boolean', description: 'Move text off the zones (default true)' },
                    widthFactor: { type: 'number', description: 'Average glyph width per em for the text-size estimate (default 0.6; raise it if text still overflows, lower it if text is shrunk too much)' },
                    pad: { type: 'number', description: 'Margin kept from the safe edges, 0..0.1 of the frame (default 0.01)' }
                }
            }
        })
    },
    { name: 'reset_rules', description: 'Reset the editing rules to the defaults.', inputSchema: S() },
    { name: 'list_tags', description: 'The preset tags with their emoji, name and how many presets have each.', inputSchema: S() },
    {
        name: 'list_presets',
        description: 'Presets with their tags, MultiText flag, text layers, font and sound. Without arguments: only presets allowed by the rules.',
        inputSchema: S({
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by these emoji / tag names instead of the rules' },
            match: { type: 'string', enum: ['any', 'all'] },
            all: { type: 'boolean', description: 'List every preset, ignoring the rules' }
        })
    },
    { name: 'list_subtitles', description: 'The timeline\'s subtitles: index, text, frames, timecode, word count, clip colour (the colour the user set on the subtitle clip in Resolve, if any), and whether one was already placed this session. clipColors counts the colours used. Pass color (e.g. "Orange") to list only subtitles with that clip colour, or "any" for every coloured one.', inputSchema: S({ from: { type: 'integer' }, to: { type: 'integer' }, color: { type: 'string', description: 'Only subtitles whose clip colour is this Resolve colour name (Orange, Apricot, Yellow, Lime, Olive, Green, Teal, Navy, Blue, Purple, Violet, Pink, Tan, Beige, Brown, Chocolate), or "any" for all coloured ones' } }) },
    {
        name: 'get_frame',
        description: 'Image of the composited timeline frame at a subtitle (middle by default) or at a frame. Use it to find faces and empty space before choosing x/y, and to check a placed clip.',
        inputSchema: S({ subtitle: subtitleArg, frame: { type: 'integer' }, at: { type: 'string', enum: ['start', 'middle', 'end'] }, maxSize: { type: 'integer', description: 'Longest side in pixels (256-1280, default 768)' }, overlay: { type: 'boolean', description: 'Draw the layout (safe area, guides, zones) over the frame. Default true when a layout is set' } })
    },
    { name: 'get_tracks', description: 'Video layers (top first) with name, locked/enabled, and the clips on each during a subtitle or frame range.', inputSchema: S({ subtitle: subtitleArg, start: { type: 'integer' }, end: { type: 'integer' } }) },
    {
        name: 'place',
        description: 'Animate one subtitle with one preset. The rules are enforced (allowed tags, font and colour overrides, layer, safe area). x/y = where the text\'s centre goes (0..1, 0,0 = top-left); omit them to keep the preset\'s own position or use zone.',
        inputSchema: S({
            subtitle: subtitleArg,
            presetId: { type: 'string', description: 'Preset id (or exact name) from list_presets' },
            x: { type: 'number', minimum: 0, maximum: 1 },
            y: { type: 'number', minimum: 0, maximum: 1 },
            zone: { type: 'string', enum: ['top', 'upper', 'center', 'lower', 'bottom'] },
            guide: { type: 'string', description: 'Layout guide name (horizontal line, see get_layout). Sets y: centred on the line, or in the area below/above it with align' },
            align: { type: 'string', enum: ['on', 'below', 'above'], description: 'on: text centred on the guide (default); below/above: centred in the area between this guide and the next one (or the safe edge), and kept between the two lines (shrunk to fit if needed)' },
            guideX: { type: 'string', description: 'Vertical layout guide name: sets x' },
            fit: { type: 'boolean', description: 'false = do not fit this clip into the layout' },
            shrink: { type: 'boolean', description: 'false = never reduce textSize to fit the layout (only move it)' },
            scale: { type: 'number', minimum: 0.1, maximum: 5, description: 'Edit-page zoom of the whole clip. To make long text fit, use textSize instead' },
            textSize: { type: 'number', minimum: 0.2, maximum: 3, description: 'Multiplier on the preset\'s own text size (0.66 = two thirds). Text+: the font size. MultiText: every layer\'s font size, layout box and the gaps between layers scale together around the group\'s centre. Use it when the text runs off the frame or is too big. The rules\' text.maxSize still caps the result' },
            maxSize: { type: 'number', minimum: 0.01, maximum: 1, description: 'This clip only: Size cap (overrides the rules\' text.maxSize)' },
            lineSpacing: { type: 'number', minimum: 0.3, maximum: 3, description: 'This clip only: Line Spacing (overrides the rules\' text.lineSpacing)' },
            text: { type: 'string', description: 'Override the text (default: the subtitle\'s text)' },
            parts: { type: 'object', properties: { upper: { type: 'string' }, emphasis: { type: 'string' }, lower: { type: 'string' } }, description: 'MultiText presets: how the subtitle splits into the upper line, the emphasized word(s) and the lower line' },
            track: { type: 'integer', minimum: 2, description: 'Force a video layer for this clip (overrides the rules)' },
            trackRange: { type: 'object', properties: { from: { type: ['integer', 'null'], minimum: 2 }, to: { type: ['integer', 'null'], minimum: 2 } }, additionalProperties: false, description: 'Only when the user\'s prompt names tracks: keep the clip between V<from> and V<to> (to null = no limit), starting at V<from> and moving up past locked, disabled or busy tracks, past the range only when it is full. Overrides the rules\' range and the panel\'s Placement range for this call.' },
            audioTrack: { type: 'object', properties: { mode: { type: 'string', enum: ['any', 'same', 'own'] }, from: { type: ['integer', 'null'], minimum: 1 }, to: { type: ['integer', 'null'], minimum: 1 } }, additionalProperties: false, description: 'Only when the user\'s prompt sets AUDIO_TRACK: where the sound effects go. any = the lowest free audio track, same = the same numbers as the clip track range (V3-V5 -> A3-A5), own = A<from> to A<to> (to null = no limit). Overrides the panel\'s Placement "Audio track" for this call.' },
            startFrame: { type: 'integer', minimum: 0, description: 'A phrase regrouped by thought (from regroup): the clip starts here instead of at the subtitle\'s start' },
            endFrame: { type: 'integer', minimum: 1, description: 'A phrase regrouped by thought (from regroup): the clip and its sound end here instead of at the subtitle\'s end' },
            holdUntil: { type: 'integer', minimum: 1, description: 'Keep this clip on screen until the END of that later subtitle (stacked consecutive captions). Only the text clip is extended; the sound effect keeps this subtitle\'s own length' },
            sound: { type: 'boolean', description: 'false = no sound effect for this clip' },
            keepPresetStyle: { type: 'boolean', description: 'true = ignore the rules\' font, color and emphasis overrides for this call and keep the preset\'s own font and colours (e.g. when the prompt forces the font on default presets only)' },
            keepSubtitle: { type: 'boolean', description: 'true = leave the subtitle clip enabled. By default the subtitle clip(s) under the placed words are disabled once the animation is on the timeline (remove_placed turns them back on).' },
            dryRun: { type: 'boolean', description: 'Only show what would be placed' }
        }, ['subtitle', 'presetId'])
    },
    {
        name: 'measure_text',
        description: 'The REAL rendered geometry of text lines: renders them as one temporary clip (same preset, textSize and Line Spacing) over the subtitle\'s end frame, measures each line\'s glyph top/bottom/centre (0..1 of the frame height) and the pitch between lines, then removes the clip. Use it instead of estimating text heights or gaps.',
        inputSchema: S({
            subtitle: subtitleArg,
            presetId: { type: 'string', description: 'Preset id (or exact name) from list_presets' },
            lines: { type: 'array', items: { type: 'string' }, description: 'The lines, one string each (or pass text with "\\n")' },
            text: { type: 'string' },
            textSize: { type: 'number', minimum: 0.2, maximum: 3 },
            lineSpacing: { type: 'number', minimum: 0.3, maximum: 3, description: 'Line Spacing of the block (1 = normal)' },
            maxSize: { type: 'number', minimum: 0.01, maximum: 1 },
            x: { type: 'number', minimum: 0, maximum: 1 },
            y: { type: 'number', minimum: 0, maximum: 1, description: 'Centre of the block (default 0.5)' },
            keepPresetStyle: { type: 'boolean', description: 'Measure with the preset\'s own font (match the place call)' }
        }, ['subtitle', 'presetId'])
    },
    {
        name: 'place_stack',
        description: 'Place a group of consecutive subtitles as a stack (one clip per subtitle, every clip but the last held until the group\'s last subtitle ends, sound keeps each subtitle\'s own length). The lines are spaced exactly like one Text+ block at lineSpacing, measured from the real rendered text, and the group is centred on y. After placing, the clips are measured again and corrected to the pixel. The panel\'s Placement settings choose the layer unless the user\'s prompt names tracks (then pass trackRange).',
        inputSchema: S({
            trackRange: { type: 'object', properties: { from: { type: ['integer', 'null'], minimum: 2 }, to: { type: ['integer', 'null'], minimum: 2 } }, additionalProperties: false, description: 'Only when the user\'s prompt names tracks: keep the clip between V<from> and V<to> (to null = no limit), starting at V<from> and moving up past locked, disabled or busy tracks, past the range only when it is full. Overrides the rules\' range and the panel\'s Placement range for this call.' },
            audioTrack: { type: 'object', properties: { mode: { type: 'string', enum: ['any', 'same', 'own'] }, from: { type: ['integer', 'null'], minimum: 1 }, to: { type: ['integer', 'null'], minimum: 1 } }, additionalProperties: false, description: 'Only when the user\'s prompt sets AUDIO_TRACK: where the sound effects go. any = the lowest free audio track, same = the same numbers as the clip track range (V3-V5 -> A3-A5), own = A<from> to A<to> (to null = no limit). Overrides the panel\'s Placement "Audio track" for this call.' },
            subtitles: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'The group\'s subtitle numbers in order' },
            presetId: { type: 'string', description: 'Preset id (or exact name) from list_presets, used for every line' },
            texts: { type: 'array', items: { type: 'string' }, description: 'Optional text override per subtitle (same length as subtitles)' },
            textSize: { type: 'number', minimum: 0.2, maximum: 3, description: 'Same multiplier for every line' },
            lineSpacing: { type: 'number', minimum: 0.3, maximum: 3, description: 'The gap between the stacked lines, as a Line Spacing value (1 = like a normal multi-line caption)' },
            maxSize: { type: 'number', minimum: 0.01, maximum: 1 },
            x: { type: 'number', minimum: 0, maximum: 1, description: 'Centre of every line (default 0.5)' },
            y: { type: 'number', minimum: 0, maximum: 1, description: 'Centre of the whole group, e.g. the middle of the captions band' },
            sound: { type: 'boolean', description: 'false = no sound effects' },
            keepPresetStyle: { type: 'boolean', description: 'true = ignore the rules\' font, color and emphasis overrides for every line and keep the preset\'s own font and colours (e.g. when the prompt forces the font on default presets only)' },
        }, ['subtitles', 'presetId'])
    },
    {
        name: 'regroup',
        description: 'Re-split consecutive subtitles into phrases by thought, when Resolve\'s cuts break a thought apart (e.g. subtitles "If this is the bar then it\'s" + "fine, but the bar is this." -> phrases "If this is the bar then" + "it\'s fine, but the bar is this."). The phrases must spell the subtitles\' words in order (punctuation may differ). Each word is timed inside its own subtitle by its length; returns each phrase\'s startFrame / endFrame and anchor subtitle, ready for place.',
        inputSchema: S({
            subtitles: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Consecutive subtitle numbers' },
            phrases: { type: 'array', items: { type: 'string' }, description: 'The text as it should read, one phrase per clip, in order' }
        }, ['subtitles', 'phrases'])
    },
    { name: 'list_placed', description: 'Clips placed through this tool during the current panel session.', inputSchema: S() },
    { name: 'remove_placed', description: 'Remove a clip placed through this tool (and its sound) from the timeline.', inputSchema: S({ itemId: { type: 'string' } }, ['itemId']) }
];

// ------------------------------------------------------------------ talking to the plugin

async function callPlugin(tool, args) {
    let ep;
    try { ep = JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf8')); } catch (e) {
        throw new Error('El Subtitle Animator is not running. Open DaVinci Resolve and the panel (Workspace > Workflow Integrations > El Subtitle Animator).');
    }
    let res;
    try {
        res = await fetch('http://127.0.0.1:' + ep.port + '/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-sa-token': ep.token },
            body: JSON.stringify({ tool, args: args || {} }),
            signal: AbortSignal.timeout(180000)
        });
    } catch (e) {
        throw new Error('Could not reach the El Subtitle Animator panel. Is it open in Resolve? (' + (e && e.message || e) + ')');
    }
    const body = await res.json().catch(() => null);
    if (!body) throw new Error('The panel sent an unreadable answer (HTTP ' + res.status + ').');
    if (!body.ok) throw new Error(body.error || 'Failed');
    return body.result;
}

function toContent(result) {
    // Only a real frame (get_frame: base64 data + mime) is sent as an image. Other results can have an `image` field
    // that is not picture data (get_layout's "1080x1920" size), which MCP clients reject as invalid base64.
    if (result && typeof result.image === 'string' && result.mime) {
        return [{ type: 'image', data: result.image, mimeType: result.mime }, { type: 'text', text: result.note || '' }];
    }
    return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
}

// ------------------------------------------------------------------ MCP over stdio (newline-delimited JSON-RPC)

function write(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { write({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { write({ jsonrpc: '2.0', id, error: { code, message } }); }

async function onMessage(msg) {
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;
    try {
        switch (method) {
            case 'initialize':
                return reply(id, {
                    protocolVersion: (params && params.protocolVersion) || '2025-06-18',
                    capabilities: { tools: {} },
                    serverInfo: SERVER_INFO,
                    instructions: INSTRUCTIONS
                });
            case 'ping': return reply(id, {});
            case 'tools/list': return reply(id, { tools: TOOLS });
            case 'tools/call': {
                const name = params && params.name;
                if (!TOOLS.some(t => t.name === name)) return fail(id, -32602, 'Unknown tool ' + name);
                try {
                    return reply(id, { content: toContent(await callPlugin(name, (params && params.arguments) || {})) });
                } catch (e) {
                    return reply(id, { content: [{ type: 'text', text: String(e && e.message || e) }], isError: true });
                }
            }
            default:
                if (isRequest) return fail(id, -32601, 'Method not found: ' + method);
        }
    } catch (e) {
        if (isRequest) fail(id, -32603, String(e && e.message || e));
    }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (e) { fail(null, -32700, 'Parse error'); continue; }
        if (Array.isArray(msg)) msg.forEach(onMessage); else onMessage(msg);
    }
});
process.stdin.on('end', () => process.exit(0));
