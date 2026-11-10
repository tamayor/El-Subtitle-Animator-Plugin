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
1. Call get_rules first and follow them. The user's "notes" are their own editing rules. If the user states rules for this video (allowed emoji tags, font, text colour, emphasis font/colour, layer, placement, max text size, line spacing, highlight box auto-balance / width / height / x / y), save them with set_rules before placing anything. When the font/colour override should only apply to some presets, pass keepPresetStyle: true on place for the others.
2. list_presets returns only presets allowed by the rules' tags. Never use a preset outside that list.
3. list_subtitles, then plan. Read the subtitles as sentences, not as Resolve's cuts: a cut often falls mid-thought ("If this is the bar then it's" / "fine, but the bar is this."). Group the words by thought ("If this is the bar then" / "it's fine, but the bar is this."; "So yeah, watch this" / "shit man. Come on." -> "So yeah," / "watch this shit man." / "Come on."): never leave a word stranded from the phrase it belongs to. For such a run call regroup with the subtitle numbers and your phrases, then place each phrase with its text, subtitle, startFrame and endFrame. Plan which subtitles get an animation (not necessarily all of them; vary presets and avoid repeating the same one back to back), which preset fits each line (one-word / one-line / multi-line / money / emphasis presets by name and tag), and for MultiText presets which word(s) to emphasize (pass parts {upper, emphasis, lower} that together spell the subtitle).
4. Layout: if the user gives a safe-zone reference image, call set_layout with its path (look at the image yourself and pass the labels you read as guideNames top to bottom / zoneNames). A layout only applies to timelines of the same shape as its image (a 9:16 social safe zone is ignored on a 16:9 timeline; get_layout says appliesToThisTimeline). When it applies, place keeps every clip inside its safe area and off its zones (shrinking textSize if needed), and the user can say e.g. "centre the subtitle on the captions line" (guide: "captions") or "in the captions area" (guide: "captions", align: "below").
5. When rules.position.avoidFaces is true, call get_frame for the subtitle and look at it. Choose x/y (0..1, top-left origin = where the text's centre goes) so the text sits on empty space and never over a face, eyes or mouth, and stays inside the safe area. Check get_tracks if layer placement matters.
6. Call place for each subtitle (once placed, its subtitle clip is disabled so it does not show under the animation; remove_placed re-enables it). Long lines: pass text with a "\\n" line break, and if the text would run off the frame pass textSize (e.g. 0.66) rather than scale. After the first few, call get_frame (at: "end", when all words are in) to check the result, and use remove_placed to fix mistakes.
7. Report what you placed, where, and any warnings.
Keeping Resolve responsive: send place / place_stack / get_frame / remove_placed calls ONE AT A TIME (wait for each result; never several in one batch). Never read or change a placed clip's Fusion composition with a Resolve script (GetFusionCompByIndex, GetToolList, GetInput, SetInput): a script read of a follower-driven text freezes Resolve for good. The sizes and fonts actually applied are in place's "inspector" result and in inspect_placed; enabled subtitles are in list_subtitles (enabled / activeOnly).
Show the user your plan before placing more than about 10 clips.

Chopping an .srt file (no Resolve needed): read_srt returns the blocks and the chopping rules. Follow those rules, then call chop_srt with your corrected phrases. It cuts any phrase over the words/characters limits (SUBTITLE TRIMMING in the Prompt tab), works out the in-between timestamps and writes the new .srt.`;

// Words and characters per block. Both limits apply together. Defaults come from the SUBTITLE TRIMMING section of
// the Prompt tab's job prompt (<library>/job-prompt.md, found through the panel's endpoint file), else these.
const TRIM_DEFAULTS = { minWords: 1, maxWords: 3, minChars: 1, maxChars: 20 };

function jobPromptTrimming() {
    try {
        const ep = JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf8'));
        if (!ep.dataDir) return {};
        const text = fs.readFileSync(path.join(ep.dataDir, 'job-prompt.md'), 'utf8');
        const range = (key) => {
            const m = new RegExp('^\\s*' + key + ':\\s*(\\d+)\\s*(?:(?:–|-|—|to)\\s*(\\d+|∞)?)?', 'mi').exec(text);
            if (!m) return null;
            const single = !/(–|-|—|to)/.test(m[0].slice(m[0].indexOf(':')));
            return { min: +m[1], max: single ? +m[1] : (m[2] && m[2] !== '∞' ? +m[2] : Infinity) };
        };
        const w = range('WORDS_PER_BLOCK'), c = range('CHARS_PER_BLOCK'), out = {};
        if (w) { out.minWords = w.min; out.maxWords = w.max; }
        if (c) { out.minChars = c.min; out.maxChars = c.max; }
        return out;
    } catch (e) { return {}; }
}

function trimLimits(args) {
    const lim = Object.assign({}, TRIM_DEFAULTS, jobPromptTrimming());
    for (const k of Object.keys(TRIM_DEFAULTS)) if (Number.isFinite(args && args[k])) lim[k] = args[k];
    lim.maxWords = Math.max(lim.maxWords, lim.minWords, 1);
    lim.maxChars = Math.max(lim.maxChars, lim.minChars, 1);
    return lim;
}

const fmtRange = (a, b) => a + '–' + (Number.isFinite(b) ? b : '∞');

function chopRules(lim) {
    return `CHOPPING SUBTITLES PROPERLY. Fix the spelling and wording of the .srt by these strict rules. The output stays in .srt format.

1. Transcription correction: fix ASR/transcription errors, misspellings, and technical and company names. Do NOT rewrite the speaker's thought structure, grammar or phrasing style. Keep their exact thoughts intact.
2. Contextual flow and grouping: chop or group the text by natural sentence flow, punctuation and spoken context. Keep related phrases together. Never split them awkwardly.
3. Length (SUBTITLE TRIMMING, both limits apply together):
   - Words per block: ${fmtRange(lim.minWords, lim.maxWords)}.
   - Characters per block (spaces included): ${fmtRange(lim.minChars, lim.maxChars)}.
   - A block that breaks either limit is cut smaller to meet both, e.g. 3 words that run past ${lim.maxChars} characters become 2 + 1 (or 1 + 2, whichever keeps the phrase together). A very long word keeps the line short rather than sharing it.
4. Currency: always put a currency symbol (e.g. $) before a number that means money ("13K dollars" -> "$13K").
5. Natural pauses: put breaks at natural spoken pauses, always within the single-line format.
6. Single line: exactly ONE line per block. No line breaks inside a block.
7. Highlight and key emphasis: a phrase, core metric or critical point that needs emphasis goes alone in its own block.
8. Artificial median timing cuts: split longer phrases into new, separate blocks with median timestamps between them. Example: "that they are spending about $13K per month" -> "that they are" / "spending about" / "$13K per month". (chop_srt works out the median timestamps.)
9. Semantic grouping and fillers:
   - Keep concepts together: never split a core metric, money value or time frame across two blocks ("$1K per month" stays in one block). When one runs past the limits, list its phrase number in the group's keep so chop_srt leaves it whole.
   - Isolate fillers: short fillers, rhetorical questions or transition words ("right?", "okay?", "yep") go alone in their own block, for a natural, dramatic pause.
   - Keeping a complete thought or related phrase together matters more than the minimum word count.
10. Prepositions and modifiers: keep prepositions and articles with the noun they introduce ("a surplus of" stays in one block).`;
}

const PROMPTS = [
    {
        name: 'chop_subtitles',
        description: 'Fix and chop an .srt subtitle file by the chopping rules (max 3 words, one line, money with $, fillers on their own, median timing cuts).',
        arguments: [
            { name: 'path', description: 'Path of the .srt file to chop', required: true },
            { name: 'outPath', description: 'Where to write the result (default: next to it, named "<name> chopped.srt")', required: false },
            { name: 'limits', description: 'Override the SUBTITLE TRIMMING limits, e.g. "words 1-2, chars 1-16"', required: false }
        ]
    }
];

function chopPromptText(args) {
    const p = (args && args.path) || '<ask the user for the .srt path>';
    const out = args && args.outPath ? ' Write it to ' + args.outPath + '.' : '';
    const lim = args && args.limits ? ' Use these limits (pass them to read_srt and chop_srt as minWords / maxWords / minChars / maxChars): ' + args.limits + '.' : '';
    return 'Chop the subtitle file ' + p + '.' + out + lim + '\n\n' +
        'Call read_srt with the path, read the whole transcript as sentences, then call chop_srt with every block covered once, in order. ' +
        'Each group lists its source block numbers and the corrected phrases that replace them. Fix any warnings it returns, then call it again. ' +
        'Finally, report the output path, the number of blocks before and after, the limits used, and the corrections you made (names, spellings, $).\n\n' +
        'read_srt returns the full rules with the SUBTITLE TRIMMING limits from the Prompt tab filled in.';
}

const S = (props, required) => ({ type: 'object', properties: props || {}, required: required || [], additionalProperties: false });
const subtitleArg = { type: 'integer', description: 'Subtitle number (index from list_subtitles, starting at 1)' };

const TOOLS = [
    { name: 'status', description: 'Connection check: current timeline, size, fps, subtitle count and the active editing rules. Pass refresh: true to re-read the subtitles from Resolve (otherwise the panel\'s cached list is used). Includes a perf summary when performance measuring is on.', inputSchema: S({ refresh: { type: 'boolean' } }) },
    {
        name: 'perf',
        description: 'Performance measuring of the panel: enable / disable it, reset the counters, and read the summary (per-stage timings, Resolve API calls per second, Fusion helper timings). Measurements go to _debug/perf-log.jsonl in the code folder. settings: promiseApi "off" | "probe" | "on" (Resolve\'s promise-based API), renderProcess (second Fusion helper for renders), sampleRenderer (the panel reports its own poll round trips and long tasks).',
        inputSchema: S({
            enable: { type: 'boolean' },
            reset: { type: 'boolean' },
            top: { type: 'integer', description: 'How many entries to list (default 40, 0 = all)' },
            settings: { type: 'object', properties: { promiseApi: { type: 'string', enum: ['off', 'probe', 'on'] }, renderProcess: { type: 'boolean' }, sampleRenderer: { type: 'boolean' } }, additionalProperties: false }
        })
    },
    {
        name: 'verify_placed',
        description: 'Blank-render check: renders each clip placed this session (or the given ids) at two frames and reports how many came out blank. Use after placing to judge the Fusion wake settings.',
        inputSchema: S({ itemIds: { type: 'array', items: { type: 'string' } } })
    },
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
            gradient: {
                type: 'object',
                properties: { enabled: { type: 'boolean' }, top: { type: ['string', 'null'] }, bottom: { type: ['string', 'null'] }, topStop: { type: ['number', 'null'], minimum: 0, maximum: 1 }, bottomStop: { type: ['number', 'null'], minimum: 0, maximum: 1 } },
                description: 'Presets whose text fill is a gradient (Money Pop Up, $123,456 and any other gradient text). enabled = place recolours that gradient on every such preset, even ones that keep their own colour (styleExcept, keepPresetStyle); the font exception still holds. top / bottom = hex; top null = the text style colour (color / kindStyle), bottom null = same as top (a plain fill in that colour). topStop / bottomStop = stop positions 0..1 (null = the preset\'s, e.g. 0.29 / 1). Without it, a forced color makes a gradient fill solid only on presets the overrides reach. From the prompt\'s TEXT STYLE GRADIENT row; no script after placing needed.'
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
            highlight: { type: 'object', properties: { auto: { type: 'boolean' }, width: { type: 'number', minimum: 0.2, maximum: 4 }, height: { type: 'number', minimum: 0.2, maximum: 4 }, x: { type: 'number', minimum: -2, maximum: 2 }, y: { type: 'number', minimum: -2, maximum: 2 } }, description: 'The box / pill behind the highlighted word (Highlight Select, Glass Pill, Pill Soft/Outline/Solid, Soft Marker, Underline Draw). auto = even padding on every side of the word (the box is measured and centred on the word; pills get extra side room for their round ends). width / height = multipliers on the preset\'s box (1 = as is; with auto, on top of the balanced box). x / y = added to the box Offset, Inspector units (+ = right / up, 0.01 is a small nudge). From the prompt\'s HIGHLIGHT_BOX row.' },
            rows: { type: 'object', properties: { gap: { type: ['number', 'null'], minimum: -3, maximum: 6 }, justify: { type: ['string', 'null'], enum: ['manual', 'center', 'left', 'right', null] } }, description: 'MultiText presets (Highlight Select, Glass Pill, Pill Soft/Outline/Solid, Soft Marker, Underline Draw): the Inspector Row controls. gap = space between the upper / emphasis / lower rows in text lines (0 = the rows touch, the preset default is about 0.54; the same gap above and below the emphasis, whatever each row\'s size or line count). justify = manual (each row centred, the per-row X sliders apply) / center / left / right (the rows\' edges line up). null = the preset\'s own.' },
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
    { name: 'list_subtitles', description: 'The timeline\'s subtitles: index, text, frames, timecode, word count, clip colour (the colour the user set on the subtitle clip in Resolve, if any), and whether one was already placed this session. clipColors counts the colours used. Pass color (e.g. "Orange") to list only subtitles with that clip colour, or "any" for every coloured one. Pass refresh: true to re-read the subtitles from Resolve right now (otherwise the panel\'s list, refreshed every few seconds, is used).', inputSchema: S({ from: { type: 'integer' }, to: { type: 'integer' }, refresh: { type: 'boolean' }, activeOnly: { type: 'boolean', description: 'Only subtitles whose clip is still enabled (a placed animation disables its subtitle). Each row also carries enabled; use this instead of a Resolve script.' }, color: { type: 'string', description: 'Only subtitles whose clip colour is this Resolve colour name (Orange, Apricot, Yellow, Lime, Olive, Green, Teal, Navy, Blue, Purple, Violet, Pink, Tan, Beige, Brown, Chocolate), or "any" for all coloured ones' } }) },
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
            highlight: { type: 'object', properties: { auto: { type: 'boolean' }, width: { type: 'number', minimum: 0.2, maximum: 4 }, height: { type: 'number', minimum: 0.2, maximum: 4 }, x: { type: 'number', minimum: -2, maximum: 2 }, y: { type: 'number', minimum: -2, maximum: 2 } }, description: 'The box / pill behind the highlighted word (Highlight Select, Glass Pill, Pill Soft/Outline/Solid, Soft Marker, Underline Draw). auto = even padding on every side of the word (the box is measured and centred on the word; pills get extra side room for their round ends). width / height = multipliers on the preset\'s box (1 = as is; with auto, on top of the balanced box). x / y = added to the box Offset, Inspector units (+ = right / up, 0.01 is a small nudge). Only for this call; fields not given come from the rules.' },
            rows: { type: 'object', properties: { gap: { type: 'number', minimum: -3, maximum: 6 }, justify: { type: 'string', enum: ['manual', 'center', 'left', 'right'] }, link: { type: 'boolean' }, equalize: { type: 'boolean', description: 'Equalize Gaps (default on): the gap above and below the emphasis stay equal, measured from the lowest glyph of one row to the tallest glyph of the next; emphasis y then moves all three rows and upper / lower y open or close both gaps' }, distance: { type: 'object', properties: { on: { type: 'boolean' }, upperEmphasis: { type: 'number' }, emphasisLower: { type: 'number' } }, description: 'Inspector Gap Mode. on = Pixels: the two gaps are set in pixels of the frame height, ink to ink (upperEmphasis = Gap Above Emphasis, emphasisLower = Gap Below Emphasis); gap and upper / lower y then stop changing them. off = Lines: gap sets them, and the pixel fields follow the gaps on screen' }, all: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, upper: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, emphasis: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, lower: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } } }, description: 'MultiText presets: this clip\'s Row controls over the rules\' rows. gap (text lines between the rows), justify (manual / center / left / right; center / left / right override the per-row x), link (the per-row x / y move every row), all / upper / emphasis / lower {x, y} nudges in Inspector units (+ = right / up).' },
            effects: { type: 'array', items: { anyOf: [{ type: 'string', enum: ['Transform', 'Glitch', 'Wiggle', 'StopMotion'] }, { type: 'object', properties: { id: { type: 'string', enum: ['Transform', 'Glitch', 'Wiggle', 'StopMotion'] }, strength: { type: 'number', minimum: 0, maximum: 100 }, params: { type: 'object', description: 'Transform only: { ZoomPct (100 = none, default 115), MoveX / MoveY (% of frame, + = right / up), Ease (0 Linear, 1-3 In/Out/InOut Quad, 4-6 Quart, 7-9 Expo, 10-12 Back; default 3), Reverse 0/1, InF / OutF = start / end clip frame (defaults 0 = first frame / 0 = last frame) }' } }, required: ['id'] }] }, description: 'Effect presets put on the placed clip as Resolve effects (they stack: transform -> glitch -> wiggle -> stop motion; Transform = an eased zoom / move over the clip). A name, or { id, strength } with strength 0..100 (0 = none, default 25 = light but visible, 100 = strongest; for StopMotion, strength = its Frame Repeat 1..10, default 2: it is the last effect, so it holds the glitch / wiggle with the picture; zoomed or panned clips get the ResolveFX Stop Motion instead). Wiggle + StopMotion = the hand-drawn boil the old Wiggle presets had (e.g. LONG = Word by Word Typing (ML) + Wiggle + StopMotion). Leave out for none.' },
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
            effects: { type: 'array', items: { anyOf: [{ type: 'string', enum: ['Transform', 'Glitch', 'Wiggle', 'StopMotion'] }, { type: 'object', properties: { id: { type: 'string', enum: ['Transform', 'Glitch', 'Wiggle', 'StopMotion'] }, strength: { type: 'number', minimum: 0, maximum: 100 }, params: { type: 'object', description: 'Transform only: { ZoomPct (100 = none, default 115), MoveX / MoveY (% of frame, + = right / up), Ease (0 Linear, 1-3 In/Out/InOut Quad, 4-6 Quart, 7-9 Expo, 10-12 Back; default 3), Reverse 0/1, InF / OutF = start / end clip frame (defaults 0 = first frame / 0 = last frame) }' } }, required: ['id'] }] }, description: 'Effect presets put on the placed clip as Resolve effects (they stack: transform -> glitch -> wiggle -> stop motion; Transform = an eased zoom / move over the clip). A name, or { id, strength } with strength 0..100 (0 = none, default 25 = light but visible, 100 = strongest; for StopMotion, strength = its Frame Repeat 1..10, default 2: it is the last effect, so it holds the glitch / wiggle with the picture; zoomed or panned clips get the ResolveFX Stop Motion instead). Wiggle + StopMotion = the hand-drawn boil the old Wiggle presets had (e.g. LONG = Word by Word Typing (ML) + Wiggle + StopMotion). Leave out for none.' },
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
    {
        name: 'adjust_highlights',
        description: 'Re-apply the highlight box values (rules.highlight, or the given highlight) to highlight clips already on the current timeline: every MultiText highlight clip, or only itemIds / clips starting between fromFrame and toFrame. save: true also stores the values in the rules. Use when the user changes the highlight box size / position after placing.',
        inputSchema: S({
            highlight: { type: 'object', properties: { auto: { type: 'boolean' }, width: { type: 'number', minimum: 0.2, maximum: 4 }, height: { type: 'number', minimum: 0.2, maximum: 4 }, x: { type: 'number', minimum: -2, maximum: 2 }, y: { type: 'number', minimum: -2, maximum: 2 } }, description: 'The box / pill behind the highlighted word (Highlight Select, Glass Pill, Pill Soft/Outline/Solid, Soft Marker, Underline Draw). auto = even padding on every side of the word (the box is measured and centred on the word; pills get extra side room for their round ends). width / height = multipliers on the preset\'s box (1 = as is; with auto, on top of the balanced box). x / y = added to the box Offset, Inspector units (+ = right / up, 0.01 is a small nudge). Fields not given come from the rules.' },
            itemIds: { type: 'array', items: { type: 'string' } },
            fromFrame: { type: 'integer' },
            toFrame: { type: 'integer' },
            save: { type: 'boolean' }
        })
    },
    {
        name: 'adjust_rows',
        description: 'Set the MultiText Row controls (gap between the upper / emphasis / lower rows, justify, link, per-row x / y) on MultiText clips already on the current timeline: every clip with the controls, or only itemIds / clips starting between fromFrame and toFrame. Without rows, the rules\' rows are applied. save: true also stores gap / justify in the rules. The same controls are in the clip\'s Inspector (Row Spacing: Gap Mode Lines / Pixels, Gap (lines), Equal Gaps, Gap Above / Below Emphasis (px); Row Position: All / Upper / Emphasis / Lower Y and X, Justify). The result distancePx gives the two gaps.',
        inputSchema: S({
            rows: { type: 'object', properties: { gap: { type: 'number', minimum: -3, maximum: 6 }, justify: { type: 'string', enum: ['manual', 'center', 'left', 'right'] }, link: { type: 'boolean' }, equalize: { type: 'boolean', description: 'Equalize Gaps (default on): the gap above and below the emphasis stay equal, measured from the lowest glyph of one row to the tallest glyph of the next; emphasis y then moves all three rows and upper / lower y open or close both gaps' }, distance: { type: 'object', properties: { on: { type: 'boolean' }, upperEmphasis: { type: 'number' }, emphasisLower: { type: 'number' } }, description: 'Inspector Gap Mode. on = Pixels: the two gaps are set in pixels of the frame height, ink to ink (upperEmphasis = Gap Above Emphasis, emphasisLower = Gap Below Emphasis); gap and upper / lower y then stop changing them. off = Lines: gap sets them, and the pixel fields follow the gaps on screen' }, all: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, upper: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, emphasis: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, lower: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } } } },
            itemIds: { type: 'array', items: { type: 'string' } },
            fromFrame: { type: 'integer' },
            toFrame: { type: 'integer' },
            save: { type: 'boolean' }
        })
    },
    { name: 'list_placed', description: 'Clips placed through this tool during the current panel session.', inputSchema: S() },
    {
        name: 'inspect_placed',
        description: 'The real Inspector values (Size, Font, Style, LineSpacing per Text+ / MultiText layer) of clips placed this session: all of them, or the given itemIds / subtitle numbers. place already returns the same values as "inspector". ALWAYS use this for a size / font read-back: never read a placed clip\'s Fusion comp with a Resolve script (GetFusionCompByIndex / GetToolList / GetInput), which can freeze Resolve.',
        inputSchema: S({ itemIds: { type: 'array', items: { type: 'string' } }, subtitles: { type: 'array', items: { type: 'integer' } } })
    },
    { name: 'remove_placed', description: 'Remove a clip placed through this tool (and its sound) from the timeline.', inputSchema: S({ itemId: { type: 'string' } }, ['itemId']) },
    {
        name: 'repair_inspector',
        description: 'Fix clips whose Edit-page Inspector is empty. A clip named just "Text+" or "MultiText" that holds a preset got it by a comp import (the old fallback), and Resolve shows no controls for it. Each such clip on the current timeline is replaced by the same preset inserted as a Resolve title template, at the same place and length, with its texts, positions, sizes, timing sliders, colours and clip transform copied over, so the Inspector shows its controls again. A link to a sound clip is not kept. Use dryRun first to see what would be rebuilt.',
        inputSchema: S({
            dryRun: { type: 'boolean', description: 'true = only list the clips that would be rebuilt' },
            itemIds: { type: 'array', items: { type: 'string' }, description: 'Only these clips (any name); default: every plain "Text+" / "MultiText" clip that holds a preset' }
        })
    },
    {
        name: 'read_srt',
        description: 'Read an .srt subtitle file: its blocks (number, start, end, text, word count), the SUBTITLE TRIMMING limits (words and characters per block) and the chopping rules to follow before calling chop_srt. Runs locally; Resolve and the panel are not needed.',
        inputSchema: S({
            path: { type: 'string', description: 'Path of the .srt file' },
            minWords: { type: 'integer', minimum: 1, description: 'Fewest words per block (default: SUBTITLE TRIMMING in the Prompt tab, else 1)' },
            maxWords: { type: 'integer', minimum: 1, description: 'Most words per block (default: SUBTITLE TRIMMING, else 3)' },
            minChars: { type: 'integer', minimum: 1, description: 'Fewest characters per block, spaces included (default: SUBTITLE TRIMMING, else 1)' },
            maxChars: { type: 'integer', minimum: 1, description: 'Most characters per block, spaces included (default: SUBTITLE TRIMMING, else 20)' }
        }, ['path'])
    },
    {
        name: 'chop_srt',
        description: 'Write a chopped .srt file. groups covers every source block once, in order. Each group gives its source block numbers (one, or several in a row when a thought runs across Resolve\'s cuts) and the corrected phrases that replace them, one phrase per new block. Each phrase gets a median timestamp: the group\'s time is shared out by where its words fall in the source speech. Words and characters per block both apply (SUBTITLE TRIMMING limits): a phrase that breaks either is cut automatically into the fewest pieces that meet both, at the most natural word breaks (after punctuation, never after an article or preposition, never inside a money value or time frame). Returns the new blocks, what was auto-cut, and rule warnings (too short to read, below the minimums, money without $). Runs locally.',
        inputSchema: S({
            path: { type: 'string', description: 'The source .srt (the one read with read_srt)' },
            outPath: { type: 'string', description: 'Where to write the result. Default: "<name> chopped.srt" next to the source. Never the source itself unless overwrite is true.' },
            overwrite: { type: 'boolean', description: 'true = allow outPath to be the source file' },
            groups: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        blocks: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Consecutive source block numbers' },
                        phrases: { type: 'array', items: { type: 'string' }, description: 'Corrected text, one single-line phrase per new block, in order' },
                        keep: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Phrase numbers in this group (1 = first) to leave whole even past the limits, e.g. a metric like "$1.5K per month"' }
                    },
                    required: ['blocks', 'phrases'],
                    additionalProperties: false
                }
            },
            minWords: { type: 'integer', minimum: 1, description: 'Fewest words per block (default: SUBTITLE TRIMMING in the Prompt tab, else 1)' },
            maxWords: { type: 'integer', minimum: 1, description: 'Most words per block (default: SUBTITLE TRIMMING, else 3)' },
            minChars: { type: 'integer', minimum: 1, description: 'Fewest characters per block, spaces included (default: SUBTITLE TRIMMING, else 1)' },
            maxChars: { type: 'integer', minimum: 1, description: 'Most characters per block, spaces included (default: SUBTITLE TRIMMING, else 20)' }
        }, ['path', 'groups'])
    }
];

const LOCAL_TOOLS = { read_srt: readSrtTool, chop_srt: chopSrtTool };

// ------------------------------------------------------------------ .srt chopping (local, no panel needed)

function srtTimeToMs(t) {
    const m = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(t);
    if (!m) throw new Error('Bad .srt timestamp: ' + t);
    return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4].padEnd(3, '0');
}

function msToSrtTime(ms) {
    ms = Math.max(0, Math.round(ms));
    const p = (n, w) => String(n).padStart(w, '0');
    return p(Math.floor(ms / 3600000), 2) + ':' + p(Math.floor(ms / 60000) % 60, 2) + ':' + p(Math.floor(ms / 1000) % 60, 2) + ',' + p(ms % 1000, 3);
}

function parseSrt(src) {
    const blocks = [];
    for (const chunk of src.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
        const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean);
        const ti = lines.findIndex(l => l.includes('-->'));
        if (ti < 0) continue;
        const [a, b] = lines[ti].split('-->');
        const text = lines.slice(ti + 1).join(' ').replace(/\s+/g, ' ').trim();
        blocks.push({ n: blocks.length + 1, startMs: srtTimeToMs(a), endMs: srtTimeToMs(b), text });
    }
    if (!blocks.length) throw new Error('No subtitle blocks found. Is this an .srt file?');
    return blocks;
}

const wordsOf = s => s.split(/\s+/).filter(Boolean);
const weightOf = w => Math.max(1, w.replace(/[^\p{L}\p{N}$%]/gu, '').length);

function readSrtTool(args) {
    const file = path.resolve(args.path);
    const blocks = parseSrt(fs.readFileSync(file, 'utf8'));
    const lim = trimLimits(args);
    return {
        path: file,
        blockCount: blocks.length,
        limits: limitsOut(lim),
        blocks: blocks.map(b => ({ n: b.n, start: msToSrtTime(b.startMs), end: msToSrtTime(b.endMs), words: wordsOf(b.text).length, text: b.text })),
        chopRules: chopRules(lim)
    };
}

const limitsOut = lim => ({ words: fmtRange(lim.minWords, lim.maxWords), chars: fmtRange(lim.minChars, lim.maxChars) });

// Words a block should not end on: articles, prepositions, possessives and joiners belong with what follows.
const NO_END = new Set(('a an the of to in on at by for from with about into onto over under per than as and or but so ' +
    'my your our their his her its this these those that which who if because').split(' '));
// Words that finish a number before them ("$13K per month", "5 years", "20 percent").
const UNIT_AFTER = /^(per|a|an|each|every|k|m|b|thousand|million|billion|grand|percent|%|dollars?|bucks|months?|years?|weeks?|days?|hours?|minutes?|seconds?)\b/i;
const bare = w => w.toLowerCase().replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, '');

// Cuts a phrase that breaks maxWords or maxChars into the fewest pieces that meet both, choosing the most natural
// breaks. A single word longer than maxChars stays on its own.
function splitToLimits(phrase, lim) {
    const ws = wordsOf(phrase);
    const fits = (i, j) => (j - i) <= lim.maxWords && (ws.slice(i, j).join(' ').length <= lim.maxChars || j - i === 1);
    if (fits(0, ws.length)) return [phrase];
    const breakCost = (k) => { // cost of a break between ws[k-1] and ws[k]
        const prev = ws[k - 1], next = ws[k];
        let c = 0;
        if (/[,.;:!?…]$/.test(prev)) c -= 4;
        if (NO_END.has(bare(prev))) c += 6;
        if (/[\d$]/.test(prev) && UNIT_AFTER.test(bare(next))) c += 20;
        if (/[\d$]/.test(next) && /^(\$|about|over|under|around|nearly|almost)$/.test(bare(prev))) c += 10;
        return c;
    };
    const pieceCost = (i, j) => {
        const len = ws.slice(i, j).join(' ').length;
        let c = 0;
        if (j - i < lim.minWords) c += 8;
        if (len < lim.minChars) c += 8;
        return c;
    };
    // best[j] = [pieces, cost, prevIndex] for ws[0..j), fewest pieces first, then lowest cost, then most even.
    const best = [[0, 0, -1, 0]];
    for (let j = 1; j <= ws.length; j++) {
        let b = null;
        for (let i = Math.max(0, j - lim.maxWords); i < j; i++) {
            if (!best[i] || !fits(i, j)) continue;
            const len = ws.slice(i, j).join(' ').length;
            const cand = [best[i][0] + 1, best[i][1] + pieceCost(i, j) + (i > 0 ? breakCost(i) : 0), i, best[i][3] + len * len];
            if (!b || cand[0] < b[0] || (cand[0] === b[0] && (cand[1] < b[1] || (cand[1] === b[1] && cand[3] < b[3])))) b = cand;
        }
        best[j] = b;
    }
    const out = [];
    for (let j = ws.length; j > 0; j = best[j][2]) out.unshift(ws.slice(best[j][2], j).join(' '));
    return out;
}

// Times each source word inside its own block by its length, then places every cut between phrases at the source
// word boundary nearest to the same share of the group's letters. Spelling fixes and "$13K" for "13K dollars"
// shift the share only slightly, so cuts still land on the right words.
function timeGroup(srcBlocks, phrases) {
    const words = [];
    for (const b of srcBlocks) {
        const ws = wordsOf(b.text);
        const total = ws.reduce((s, w) => s + weightOf(w), 0) || 1;
        let t = b.startMs;
        for (const w of ws) {
            const d = (b.endMs - b.startMs) * weightOf(w) / total;
            words.push({ t0: t, t1: t + d, w: weightOf(w) });
            t += d;
        }
    }
    const first = srcBlocks[0].startMs, last = srcBlocks[srcBlocks.length - 1].endMs;
    if (!words.length) words.push({ t0: first, t1: last, w: 1 });
    const srcTotal = words.reduce((s, w) => s + w.w, 0);
    const phraseW = phrases.map(p => wordsOf(p).reduce((s, w) => s + weightOf(w), 0) || 1);
    const phraseTotal = phraseW.reduce((s, w) => s + w, 0);

    // Boundary k sits after source word k-1 (k = 1..words.length-1). Pick the nearest one per cut, kept increasing.
    const cum = [0];
    for (const w of words) cum.push(cum[cum.length - 1] + w.w);
    const cuts = [];
    let acc = 0, minK = 1;
    for (let i = 0; i < phrases.length - 1; i++) {
        acc += phraseW[i];
        const target = acc / phraseTotal * srcTotal;
        let best = minK, bestD = Infinity;
        for (let k = minK; k < words.length; k++) {
            const d = Math.abs(cum[k] - target);
            if (d < bestD) { best = k; bestD = d; }
        }
        // Not enough source words for this many phrases: share the time out by letters instead.
        cuts.push(best < words.length && best >= minK ? { end: words[best - 1].t1, start: words[best].t0 } : null);
        minK = best + 1;
    }
    const out = [];
    let acc2 = 0;
    for (let i = 0; i < phrases.length; i++) {
        const fallbackAt = f => first + (last - first) * f;
        const s = i === 0 ? first : (cuts[i - 1] ? cuts[i - 1].start : fallbackAt(acc2 / phraseTotal));
        acc2 += phraseW[i];
        const e = i === phrases.length - 1 ? last : (cuts[i] ? cuts[i].end : fallbackAt(acc2 / phraseTotal));
        out.push({ startMs: s, endMs: Math.max(e, s + 1) });
    }
    return out;
}

function chopSrtTool(args) {
    const src = path.resolve(args.path);
    const blocks = parseSrt(fs.readFileSync(src, 'utf8'));
    const groups = args.groups || [];
    if (!groups.length) throw new Error('groups is empty.');

    let next = 1;
    for (const [gi, g] of groups.entries()) {
        const where = 'Group ' + (gi + 1);
        if (!g.blocks.length || !g.phrases.length) throw new Error(where + ' needs blocks and phrases.');
        g.blocks.forEach((n, i) => {
            if (n !== next + i) throw new Error(where + ': expected block ' + (next + i) + ', got ' + n + '. Cover every block once, in order.');
        });
        next += g.blocks.length;
    }
    if (next - 1 !== blocks.length) throw new Error('Groups cover blocks 1-' + (next - 1) + ' but the file has ' + blocks.length + '.');

    const lim = trimLimits(args);
    const out = [], warnings = [], autoCut = [];
    for (const g of groups) {
        const keep = new Set(g.keep || []);
        const phrases = [];
        g.phrases.map(p => p.replace(/\s+/g, ' ').trim()).forEach((p, pi) => {
            if (!p) return;
            const pieces = keep.has(pi + 1) ? [p] : splitToLimits(p, lim);
            if (pieces.length > 1) autoCut.push('"' + p + '" -> ' + pieces.map(x => '"' + x + '"').join(' / '));
            phrases.push(...pieces);
        });
        const times = timeGroup(g.blocks.map(n => blocks[n - 1]), phrases);
        phrases.forEach((text, i) => {
            const n = out.length + 1;
            const wc = wordsOf(text).length;
            const dur = times[i].endMs - times[i].startMs;
            if (wc > lim.maxWords || text.length > lim.maxChars) {
                warnings.push('Block ' + n + ' "' + text + '" is over the limits (' + wc + ' words, ' + text.length + ' characters; max ' + lim.maxWords + ' / ' + lim.maxChars + ')' + (wc === 1 ? ': one long word.' : ', kept whole on purpose.'));
            }
            if (wc < lim.minWords || text.length < lim.minChars) {
                warnings.push('Block ' + n + ' "' + text + '" is under the minimum (' + wc + ' words, ' + text.length + ' characters; min ' + lim.minWords + ' / ' + lim.minChars + '). Fine for a filler, otherwise merge it.');
            }
            if (dur < 250) warnings.push('Block ' + n + ' "' + text + '" is only ' + Math.round(dur) + ' ms on screen. Merge it with a neighbour.');
            if (/\b\d[\d,.]*\s*(k|m|b|thousand|million|billion|grand)?\s*(dollars?|bucks|usd)\b/i.test(text) && !/\$/.test(text)) {
                warnings.push('Block ' + n + ' "' + text + '" looks like money without a $.');
            }
            out.push({ n, startMs: times[i].startMs, endMs: times[i].endMs, text });
        });
    }

    const dest = args.outPath ? path.resolve(args.outPath) : path.join(path.dirname(src), path.basename(src, path.extname(src)) + ' chopped.srt');
    if (dest === src && !args.overwrite) throw new Error('outPath is the source file. Pass overwrite: true to replace it, or choose another path.');
    fs.writeFileSync(dest, out.map(b => b.n + '\n' + msToSrtTime(b.startMs) + ' --> ' + msToSrtTime(b.endMs) + '\n' + b.text + '\n').join('\n'));

    return {
        written: dest,
        sourceBlocks: blocks.length,
        blocks: out.length,
        limits: limitsOut(lim),
        autoCut,
        warnings,
        result: out.map(b => ({ n: b.n, start: msToSrtTime(b.startMs), end: msToSrtTime(b.endMs), text: b.text }))
    };
}

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
                    capabilities: { tools: {}, prompts: {} },
                    serverInfo: SERVER_INFO,
                    instructions: INSTRUCTIONS
                });
            case 'ping': return reply(id, {});
            case 'tools/list': return reply(id, { tools: TOOLS });
            case 'prompts/list': return reply(id, { prompts: PROMPTS });
            case 'prompts/get': {
                if (!params || params.name !== 'chop_subtitles') return fail(id, -32602, 'Unknown prompt ' + (params && params.name));
                return reply(id, {
                    description: PROMPTS[0].description,
                    messages: [{ role: 'user', content: { type: 'text', text: chopPromptText(params.arguments) } }]
                });
            }
            case 'tools/call': {
                const name = params && params.name;
                if (!TOOLS.some(t => t.name === name)) return fail(id, -32602, 'Unknown tool ' + name);
                try {
                    const args = (params && params.arguments) || {};
                    const result = LOCAL_TOOLS[name] ? LOCAL_TOOLS[name](args) : await callPlugin(name, args);
                    return reply(id, { content: toContent(result) });
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
