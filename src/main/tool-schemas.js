// The automation tools: names, descriptions and argument schemas (JSON Schema), shared by the MCP script
// (mcp/el-sa-mcp.js lists them to the client) and the plugin's HTTP server (automation.js checks each call with
// checkToolArgs before running it). Add or change a tool's arguments here, once.

module.exports = { TOOLS: null, checkToolArgs, toolSchema };

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
        inputSchema: S({ itemIds: { type: 'array', items: { type: 'string' } }, content: { type: 'boolean', description: 'Also run check_render on the same clips (black / frozen frames in the real composite)' }, step: { type: 'integer', minimum: 1 } })
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
            image: { type: ['string', 'null'], description: 'Path of the PNG, "default" for the built-in social 9:16 safe zone, "tiktok" / "reels" / "shorts" for that app\'s own UI zones (top / bottom / right column covered; equal side margins so captions stay centred; guides eye, captions, graphics, bottom), or null to clear' },
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
            phrases: { type: 'array', items: { type: 'string' }, description: 'The text as it should read, one phrase per clip, in order' },
            snap: { type: 'boolean', description: 'Default true: each cut between two phrases moves onto the real speech pause next to it (measured with ffmpeg on the dialogue), or onto a word gap when transcribe_words has timed this audio. false = the estimate only.' },
            audioTrack: { type: 'integer', minimum: 1, description: 'Audio track of the dialogue (default: the lowest track with sound there)' }
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
            maxChars: { type: 'integer', minimum: 1, description: 'Most characters per block, spaces included (default: SUBTITLE TRIMMING, else 20)' },
            media: { type: 'string', description: 'The recording the .srt belongs to (video or audio). Given, every new cut between two phrases is moved onto the real speech pause next to it (measured with ffmpeg), or onto the gap between two words when transcribe_words has timed this file, instead of the estimated median.' },
            mediaOffset: { type: 'number', description: 'Seconds to add to the .srt times to get the media time (default 0: the .srt starts with the file)' },
            maxShift: { type: 'number', description: 'Furthest a cut may move onto a pause, seconds (default 0.35)' }
        }, ['path', 'groups'])
    },
    {
        name: 'find_pauses',
        description: 'Speech pauses measured with ffmpeg (the level every 10 ms; threshold 22 dB under the speech level, so it follows the mic). On the timeline: the dialogue clips under the range (audioTrack, else the lowest audio track with sound), answered in timeline frames with timecodes. Use it to put cuts between phrases on real pauses (regroup does this by itself), to see where a speaker breathes, or to find dead air. Runs in the MCP process; Resolve is only asked which files are where.',
        inputSchema: S({ subtitles: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Analyse these subtitles\' span (first start to last end)' },
            startFrame: { type: 'integer', description: 'First timeline frame (default: the timeline start)' },
            endFrame: { type: 'integer', description: 'Last timeline frame (default: the timeline end)' },
            path: { type: 'string', description: 'Analyse this media file instead of the timeline (times in seconds then)' },
            start: { type: 'number', description: 'With path: seconds into the file to start (default 0)' },
            duration: { type: 'number', description: 'With path: seconds to analyse (default: to the end)' },
            audioTrack: { type: 'integer', minimum: 1 },
            minPause: { type: 'number', description: 'Shortest pause, seconds (default 0.15)' },
            noiseDb: { type: 'number', description: 'Fixed threshold in dBFS instead of the automatic one' } })
    },
    {
        name: 'find_cuts',
        description: 'Shot changes and how bright each shot is. On the timeline: every footage clip on every video track in the range: the edit points between clips plus the shot changes inside a clip (ffmpeg scdet), merged per frame; shots lists each stretch between cuts with meanLuma (0-255) and bright: true for light B-roll (cream / white cutaways where white text disappears: use the accent colour and the empty top space, and split a caption that crosses a cut at the cut frame) and dark: true. Takes about 1 s per 20 s of 4K footage.',
        inputSchema: S({ subtitles: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Analyse these subtitles\' span (first start to last end)' },
            startFrame: { type: 'integer', description: 'First timeline frame (default: the timeline start)' },
            endFrame: { type: 'integer', description: 'Last timeline frame (default: the timeline end)' },
            path: { type: 'string', description: 'Analyse this media file instead of the timeline (times in seconds then)' },
            start: { type: 'number', description: 'With path: seconds into the file to start (default 0)' },
            duration: { type: 'number', description: 'With path: seconds to analyse (default: to the end)' },
            threshold: { type: 'number', description: 'scdet threshold 0-100 (default 10; lower finds softer cuts)' } })
    },
    {
        name: 'find_beats',
        description: 'The beat grid of the music (onset envelope in three bands, tempo by autocorrelation, phase by comb, each beat moved onto a measured hit when there is one: supported). On the timeline: the music clips (audioTrack, else the highest audio track holding audio-only files). Speech, ambience or free-time music has no steady pulse: tempoBpm null, nothing invented. Use it to land animation in-points, pops and sound hits on the beat.',
        inputSchema: S({ subtitles: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Analyse these subtitles\' span (first start to last end)' },
            startFrame: { type: 'integer', description: 'First timeline frame (default: the timeline start)' },
            endFrame: { type: 'integer', description: 'Last timeline frame (default: the timeline end)' },
            path: { type: 'string', description: 'Analyse this media file instead of the timeline (times in seconds then)' },
            start: { type: 'number', description: 'With path: seconds into the file to start (default 0)' },
            duration: { type: 'number', description: 'With path: seconds to analyse (default: to the end)' },
            audioTrack: { type: 'integer', minimum: 1 },
            minBpm: { type: 'number', description: 'Default 60' },
            maxBpm: { type: 'number', description: 'Default 200' } })
    },
    {
        name: 'transcribe_words',
        description: 'Word timings from a local speech engine (mlx-whisper, faster-whisper or openai-whisper; the audio never leaves the machine). On the timeline: the dialogue under the range, in timeline frames. Results are cached, and regroup / chop_srt use cached timings by themselves to cut between words. Without an engine it says how to install one; install: true sets up mlx-whisper in ~/.el-subtitle-animator/asr-venv (ask the user first: it downloads about 1.6 GB of model weights on first use). A long range takes minutes.',
        inputSchema: S({ subtitles: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Analyse these subtitles\' span (first start to last end)' },
            startFrame: { type: 'integer', description: 'First timeline frame (default: the timeline start)' },
            endFrame: { type: 'integer', description: 'Last timeline frame (default: the timeline end)' },
            path: { type: 'string', description: 'Analyse this media file instead of the timeline (times in seconds then)' },
            start: { type: 'number', description: 'With path: seconds into the file to start (default 0)' },
            duration: { type: 'number', description: 'With path: seconds to analyse (default: to the end)' },
            audioTrack: { type: 'integer', minimum: 1 },
            engine: { type: 'string', enum: ['mlx-whisper', 'faster-whisper', 'whisper'] },
            model: { type: 'string', description: 'Engine model (default: large-v3-turbo / turbo)' },
            language: { type: 'string', description: 'e.g. "en", "zh" (default: detected)' },
            install: { type: 'boolean', description: 'Install the engine first (only when the user agreed)' },
            status: { type: 'boolean', description: 'Only report which engines are installed' } })
    },
    {
        name: 'check_render',
        description: 'Render check of placed clips: Resolve\'s composited frames of each clip (and 3 frames after it) are exported and measured with ffmpeg blackdetect / freezedetect. flags: black (black frames, e.g. the black tail of a short Pop / Drop / Glitch clip), static (nothing moves for the whole clip: the animation did not render), staticStart (the entrance did not play), frozen (a hold or a stalled render). ok: false when black / static / staticStart. Give itemIds (from place), or subtitles / startFrame-endFrame (at most 2 minutes). About 0.1 s per frame; step = every nth frame (default: up to 90 per clip).',
        inputSchema: S({ itemIds: { type: 'array', items: { type: 'string' } }, subtitles: { type: 'array', items: { type: 'integer', minimum: 1 } }, startFrame: { type: 'integer' }, endFrame: { type: 'integer' }, step: { type: 'integer', minimum: 1 } })
    },
    {
        name: 'break_lines',
        description: 'Phrase-aware line breaks for a multi-line caption: breaks after punctuation, never leaves an article / preposition / joiner hanging at a line end (it opens the next line), keeps a number with its unit ("$13K per month"), balances the lines and avoids a one-word last line. Returns text with "\\n" ready for place. Runs locally.',
        inputSchema: S({ text: { type: 'string' }, lines: { type: 'integer', minimum: 1, maximum: 6, description: 'Exactly this many lines' }, maxLines: { type: 'integer', minimum: 1, maximum: 6, description: 'At most (default 2)' }, maxChars: { type: 'integer', minimum: 4, description: 'Soft line width in characters: the fewest lines that fit are used' } }, ['text'])
    },
    {
        name: 'spotlight',
        description: 'Spotlight: a big glowing word BEHIND the speaker with the room dimmed (the speaker is cut out of the footage automatically with Robust Video Matting and placed over the word as a PNG-sequence clip on the track above the footage; captions that would end up under it are lifted above it). Make one for a subtitle (or startFrame / endFrame), change a placed one (itemId + settings) or remove it (itemId + remove: true). The word defaults to the subtitle\'s strongest word (a name / number / longest non-filler word); pass word to choose it, wordOn: false for no word. Size and height are automatic (the word fills `width` % of the frame and the head covers `overlap` % of the capitals) unless size / y are given. Takes ~0.15 s per frame. Use it for big topic words, names and reveals, sparingly (one per section).',
        inputSchema: S({
            subtitle: subtitleArg,
            startFrame: { type: 'integer', description: 'First timeline frame (instead of subtitle)' },
            endFrame: { type: 'integer', description: 'Last timeline frame, inclusive (with startFrame)' },
            itemId: { type: 'string', description: 'A placed spotlight\'s cut-out clip id (from an earlier result) to change or remove' },
            remove: { type: 'boolean' },
            word: { type: 'string' },
            wordOn: { type: 'boolean', description: 'false = spotlight only, no word' },
            caps: { type: 'boolean', description: 'Capitals (default true)' },
            font: { type: 'string', description: 'Default "DM Serif Display"' },
            style: { type: 'string', description: 'Default "Italic"' },
            color: { type: 'array', items: { type: 'number' }, description: 'Text colour [r, g, b] 0..1 (default white)' },
            glowColor: { type: 'array', items: { type: 'number' }, description: 'Glow colour [r, g, b] 0..1 (default pink [1, 0.3, 0.75])' },
            glow: { type: 'number', minimum: 0, maximum: 100, description: 'Default 70' },
            dim: { type: 'number', minimum: 0, maximum: 100, description: 'How much darker the room gets (default 55)' },
            vig: { type: 'number', minimum: 0, maximum: 100, description: 'Edge vignette (default 50)' },
            anim: { type: 'string', enum: ['zoom', 'rise', 'fade', 'pop', 'blur', 'flicker', 'spread', 'none'], description: 'Entry: zoom (default, settles from 130%), rise (from behind the head), fade, pop, blur, flicker (neon), spread (letters close in), none' },
            inF: { type: 'integer', minimum: 1, maximum: 60, description: 'Entry length in frames (default 12)' },
            outF: { type: 'integer', minimum: 0, maximum: 60, description: 'Fade-out frames at the end (default 8, 0 = cut)' },
            size: { type: 'number', minimum: 0, maximum: 0.6, description: 'Text+ size; 0 = auto (fit width)' },
            width: { type: 'number', minimum: 30, maximum: 100, description: 'Auto size: % of the frame width (default 86)' },
            x: { type: 'number', minimum: 0, maximum: 1, description: 'Horizontal centre (default 0.5)' },
            y: { type: ['number', 'null'], minimum: 0, maximum: 1, description: 'Vertical centre of the capitals, 0 = top; null = auto from the head' },
            overlap: { type: 'number', minimum: 0, maximum: 80, description: 'Auto height: % of the capitals hidden behind the head (default 45)' }
        }, [])
    },
    {
        name: 'auto_cut',
        description: 'Rough cut of a talking-head timeline (the panel\'s Cut tab). Every clip on the source video track is listened to: pauses longer than maxPause are shortened to pauseKeep, silence at clip heads/tails trimmed, and retakes (an earlier attempt of a line said again), stutters ("I think I think") and optionally fillers are found in Resolve\'s own transcription (textSource "transcription", transcribed first if needed) or the subtitle track. Without build it only analyses and returns the plan (before/after length, each drop with its id and text). With build: true it makes a NEW timeline "<source> (cut)" from the kept pieces (video + its audio, transforms copied, voice levelled to lufs, markers at every retake/stutter/filler); the source timeline is never edited. Pass ignore: [drop ids] to keep drops the user wants. Omitted options use the Cut tab\'s last values.',
        inputSchema: S({
            track: { type: 'integer', minimum: 1, description: 'Source video track (default 1)' },
            style: { type: 'string', enum: ['tight', 'natural', 'gentle', 'custom'], description: 'Pause style: tight (reels: pauses > 0.26 s -> 0.18 s), natural (interviews, default: > 0.5 s -> 0.3 s), gentle (> 1 s -> 0.5 s), custom (use the numbers)' },
            maxPause: { type: 'number', description: 'custom: shorten pauses longer than this (s)' },
            pauseKeep: { type: 'number', description: 'custom: what is left of a shortened pause (s)' },
            sentenceKeep: { type: 'number', description: 'custom: left after a sentence end (s)' },
            headLead: { type: 'number', description: 'custom: kept before a clip\'s first word (s)' },
            tailKeep: { type: 'number', description: 'custom: kept after a clip\'s last word (s)' },
            retakes: { type: 'boolean', description: 'Drop earlier attempts of a line said again, and the talk up to the kept attempt' },
            outtakes: { type: 'boolean', description: 'Drop between-take talk ("Wait, sorry.", "Okay, I go again.")' },
            stutters: { type: 'boolean' }, fillers: { type: 'boolean' },
            script: { type: 'string', description: 'The script text: keep only the last complete take of each sentence, drop everything else (best for scripted reads). Empty string = off' },
            textSource: { type: 'string', enum: ['transcription', 'subtitles', 'none'], description: 'Where the words come from' },
            transcribe: { type: 'boolean', description: 'Let Resolve transcribe clips with no transcription' },
            level: { type: 'boolean', description: 'Level the voice to `lufs` on the cut timeline' },
            lufs: { type: 'number', description: 'Target loudness (default -16)' },
            markers: { type: 'boolean', description: 'Marker at every retake / stutter / filler cut' },
            markPauses: { type: 'number', description: 'Also mark pauses at least this long (s); 0 = off' },
            subtitles: { type: 'boolean', description: 'Create subtitles from the cut audio (Resolve speech to text)' },
            open: { type: 'boolean', description: 'Leave the cut timeline open (default true)' },
            name: { type: 'string', description: 'Name of the new timeline (default "<source> (cut)")' },
            ignore: { type: 'array', items: { type: 'string' }, description: 'Drop ids (from the analysis) to keep in the cut' },
            build: { type: 'boolean', description: 'Make the cut timeline (default false: analyse only)' },
            reanalyse: { type: 'boolean', description: 'With build: analyse again first (default true)' },
            status: { type: 'boolean', description: 'Only read the progress' },
            cancel: { type: 'boolean', description: 'Stop the running analysis / build' }
        })
    },
    {
        name: 'list_broll',
        description: 'B-roll overlays (the panel\'s B-roll tab): motion graphics rendered with Remotion at the timeline\'s size and frame rate (ProRes 4444 with alpha) and placed on a free video track above the footage. Returns every effect with its fields (key, type, default, range) and the common fields x / y (0..1 centre of the graphic), scale, accent, enter / exit (frames), plus `vibes`: the looks a call can give its B-roll (place_broll / adjust_broll / broll_preview `vibe`). With placed: true, returns the B-roll clips placed on the open timeline (id, effect, props, start, frames, onTimeline) instead.',
        inputSchema: S({ placed: { type: 'boolean', description: 'List the placed B-roll clips instead of the effects' }, all: { type: 'boolean', description: 'With placed: every timeline' } })
    },
    {
        name: 'broll_preview',
        description: 'Render one still of a B-roll effect (no change to Resolve) and return the PNG path: look at it before placing. `at` is the moment (0..1 of the clip, default 0.62).',
        inputSchema: S({
            effect: { type: 'string', description: 'Effect id from list_broll (e.g. comment-drop)' },
            props: { type: 'object', description: 'Field values; omitted fields use the defaults' },
            vibe: { type: ['string', 'object'], description: 'The look, for this call only (effects keep their own look without one). A starter id from list_broll `vibes` (clean-glass, bold-pop, editorial, dark-tech, sketch), or { base: "<starter>", ...changes } to fit the video: accent, card, ink, border, dark, corners (0..2), outline, font (sans | serif | serifItalic | mono | hand), displayFont / bodyFont / labelFont / numFont, weight, motion (soft | snappy | bouncy | calm | steps). Use the same vibe on every placement of a video' },
            seconds: { type: 'number', description: 'Clip length the still is taken from (default: the effect\'s)' },
            at: { type: 'number', description: 'Moment 0..1 (default 0.62)' }
        }, ['effect'])
    },
    {
        name: 'place_broll',
        description: 'Render a B-roll effect and place it on the open timeline: over a subtitle\'s range (subtitle), the timeline\'s Mark In -> Mark Out (marks: true), between startFrame / endFrame, or at the playhead for `seconds`. Clips shorter than 1.2 s are held to 1.2 s. The file goes to "<footage folder>/El Subtitle Animator B-roll/" and a Media Pool bin of that name. Returns the record id used by adjust_broll / remove_broll. Pass `items` (a list of these objects, e.g. from suggest_broll) to place several one after another. Keep B-roll off the faces and away from the captions (check get_frame).',
        inputSchema: S({
            effect: { type: 'string', description: 'Effect id from list_broll' },
            props: { type: 'object', description: 'Field values (see list_broll); omitted fields use the last values used, then the defaults' },
            vibe: { type: ['string', 'object'], description: 'The look, kept with the placed clip (effects keep their own look without one). A starter id from list_broll `vibes` (clean-glass, bold-pop, editorial, dark-tech, sketch), or { base: "<starter>", ...changes } to fit the video: accent, card, ink, border, dark, corners (0..2), outline, font (sans | serif | serifItalic | mono | hand), displayFont / bodyFont / labelFont / numFont, weight, motion (soft | snappy | bouncy | calm | steps). Use the same vibe on every placement of a video' },
            subtitle: { type: 'integer', description: 'Subtitle number: the clip covers its range' },
            marks: { type: 'boolean', description: 'Cover the timeline\'s Mark In -> Mark Out range (I / O in Resolve), up to 60 s' },
            startFrame: { type: 'integer', description: 'Timeline frame to start at (default: the subtitle start or the playhead)' },
            endFrame: { type: 'integer', description: 'Timeline frame to end at' },
            seconds: { type: 'number', description: 'Length when there is no endFrame (default: the effect\'s)' },
            track: { type: 'integer', description: 'Video track (default: the lowest free one from V2)' },
            usePrefs: { type: 'boolean', description: 'Start from the last values used for this effect (default true)' },
            place: { type: 'boolean', description: 'false = render the file only' },
            extend: { type: 'number', description: 'Make the clip this many seconds longer than the subtitle / marks / landing (default 0)' },
            landOnWord: { type: 'boolean', description: 'Time it so the animation lands exactly as the key word is spoken (the comment keyword, the number, the drawn word...): the clip may start up to 1.6 s earlier' },
            draft: { type: 'boolean', description: 'Draft: render at half size (quicker) to check in Resolve\'s viewer; the clip is set to Fit and coloured orange. finalize_broll re-renders it at full size in place before export' },
            items: { type: 'array', items: { type: 'object' }, description: 'Several placements, each with the fields above' },
            wait: { type: 'number', description: 'With items: seconds to wait before returning (default 150)' }
        })
    },
    {
        name: 'adjust_broll',
        description: 'Change a placed B-roll clip: merges `props` into its saved values, re-renders and swaps the media under the clip (it keeps its place and track). A new length (seconds / frames) or another effect replaces it with a new clip at the same start. Use this for "make it bigger", "change the number", "move it left" (x/y), "slower" (longer), "different colour".',
        inputSchema: S({
            id: { type: 'string', description: 'Record id from place_broll / list_broll { placed: true }' },
            all: { type: 'boolean', description: 'Instead of id: every B-roll on the open timeline (to restyle a whole video with `vibe`, or change one field everywhere)' },
            props: { type: 'object', description: 'Fields to change' },
            vibe: { type: ['string', 'object'], description: 'The look, replacing the one the clip has; "classic" gives it back the effect\'s own look (effects keep their own look without one). A starter id from list_broll `vibes` (clean-glass, bold-pop, editorial, dark-tech, sketch), or { base: "<starter>", ...changes } to fit the video: accent, card, ink, border, dark, corners (0..2), outline, font (sans | serif | serifItalic | mono | hand), displayFont / bodyFont / labelFont / numFont, weight, motion (soft | snappy | bouncy | calm | steps). Use the same vibe on every placement of a video' },
            effect: { type: 'string', description: 'Switch to another effect' },
            seconds: { type: 'number', description: 'New length' },
            frames: { type: 'integer', description: 'New length in frames' },
            extend: { type: 'number', description: 'Add this many seconds to its current length' },
            draft: { type: 'boolean', description: 'true = re-render as a half-size draft, false = full size (finalize); left out, it stays as it is' }
        })
    },
    {
        name: 'finalize_broll',
        description: 'Re-render draft (half-size) B-roll at full size and swap the media under each clip (same place, track and timing; the orange draft colour is cleared). One id, or all: true for every draft on the open timeline. Do this before export; list_broll { placed: true } shows draft: true on drafts.',
        inputSchema: S({ id: { type: 'string', description: 'Record id' }, all: { type: 'boolean', description: 'Every draft on this timeline' } })
    },
    {
        name: 'remove_broll',
        description: 'Delete a placed B-roll clip from the timeline and forget it.',
        inputSchema: S({ id: { type: 'string', description: 'Record id' } }, ['id'])
    },
    {
        name: 'sync_broll',
        description: 'Sync to words: re-time placed B-roll so each animation lands (finishes building) exactly as its key word is spoken: the comment keyword, the number, the dial word, the typed / drawn word. Uses the word transcription when there is one (else estimates from the word\'s place in the subtitle) and may start the clip up to 1.6 s earlier. One id, or all: true for every B-roll on the open timeline.',
        inputSchema: S({ id: { type: 'string', description: 'Record id' }, all: { type: 'boolean', description: 'Every placed B-roll on this timeline' } })
    },
    {
        name: 'suggest_broll',
        description: 'Read the subtitles and suggest which ones get which B-roll effect, with props filled from the words (numbers -> Money counter / Post wall, "comment X" -> Comment drop, days / hours -> Day dial, typing / searching -> Predict keys, "she told me" -> Voice note, "step two" -> Step badge, "9 out of 10" / "half of" -> Ring gauge, "from 10k in Jan to 45k in Mar" -> Mini chart, "my name is ..." / "according to ..." -> Lower third, "breaking" -> News ticker, "note to self" -> Journal note, idea / home / goal -> Doodle icon, "look at this" -> Doodle callout). Effects without words to read (cutout-pop, paper-frame, ransom-text, sticky-text, audio-pulse, cutout-puppet, doodle-boil, zoom-through-cut) are never suggested: place them by hand with props. Effects of the group "Speaker & footage" (paper-cut, depth-scatter, orbit-carousel, frame-break-card, vertigo-dolly, green-screen-stage) and the options cutout-pop { source: "speaker" }, doodle-boil { follow }, viewfinder-zoom { pushIn }, editor-reveal { footage } read the footage under the clip and cut the speaker out with the Spotlight engine (up to 20 s, frames-only effects up to 30 s; about 0.15 s a frame the first time); audio-pulse and cutout-puppet move with the dialogue under the clip. place_broll / adjust_broll return `notes` when something could not be read (no sound, engine not installed) and what was used in its place. Places nothing: refine the props (and drop weak picks), then call place_broll { items }. Skips subtitles that already have B-roll.',
        inputSchema: S({
            max: { type: 'integer', description: 'At most this many (default 8)' },
            minGap: { type: 'number', description: 'Seconds between two B-roll clips (default 4)' },
            effects: { type: 'array', items: { type: 'string' }, description: 'Only these effect ids' },
            from: { type: 'integer', description: 'First subtitle number' },
            to: { type: 'integer', description: 'Last subtitle number' },
            marks: { type: 'boolean', description: 'Only subtitles between the timeline\'s Mark In and Mark Out' },
            skipPlaced: { type: 'boolean', description: 'Skip subtitles that already have B-roll (default true)' }
        })
    },
    {
        name: 'match_cut',
        description: 'News-article match cut: news articles that use `word` are screenshotted, lined up so the word stays at the same size in the same spot, rendered at the timeline\'s size and frame rate, and placed at the playhead (top free video layer, clicks on a free audio track). Saved in "<footage folder>/El Subtitle Animator MatchCut/<word>/" next to "El Subtitle Animator SFX". Same as the panel\'s "Article Text Match Cut" effect card; omitted options use the panel\'s last values. Takes 1-4 minutes: returns { running } after `wait` seconds, then call again with status: true. Big paywalled sites (Reuters, WSJ, NYT, Bloomberg) are skipped because they block automated browsers.',
        inputSchema: S({
            word: { type: 'string', description: 'Word or short phrase to lock in place' },
            count: { type: 'integer', minimum: 2, maximum: 40, description: 'Articles to cut between (default 12)' },
            startFrames: { type: 'number', description: 'Frames per article at the start (default 6)' },
            endFrames: { type: 'number', description: 'Frames per article near the end (default 2)' },
            hold: { type: 'number', description: 'Seconds the last article holds (default 1.2)' },
            highlight: { type: 'boolean', description: 'Marker behind the word' },
            highlightColor: { type: 'string', description: 'Marker colour #rrggbb (default matcha #8ccf8e)' },
            sfx: { type: 'boolean', description: 'Click on every cut' },
            place: { type: 'boolean', description: 'Place at the playhead (default true); false = render the MP4 only' },
            wait: { type: 'number', description: 'Seconds to wait for the result (default 150)' },
            status: { type: 'boolean', description: 'Only read the running / last run' },
            cancel: { type: 'boolean', description: 'Stop the running match cut' }
        })
    }
];

module.exports.TOOLS = TOOLS;
const BY_NAME = new Map(TOOLS.map(t => [t.name, t]));

function toolSchema(name) {
    const t = BY_NAME.get(name);
    return t ? t.inputSchema : null;
}

// A call's arguments against its schema: required ones present, known ones of the right type (integer / number /
// boolean / string / array / object, enum, minimum / maximum). Unknown arguments are let through, as before (some
// callers send extras the tools ignore). Returns an error message, or null when the call is fine or has no schema.
function checkToolArgs(name, args) {
    const sch = toolSchema(name);
    if (!sch) return null;
    if (args === null || typeof args !== 'object' || Array.isArray(args)) return name + ': the arguments must be an object';
    for (const k of sch.required || []) {
        if (args[k] === undefined || args[k] === null) return name + ': ' + k + ' is required';
    }
    for (const [k, spec] of Object.entries(sch.properties || {})) {
        const v = args[k];
        if (v === undefined || v === null || !spec) continue;
        const bad = typeMismatch(v, spec);
        if (bad) return name + ': ' + k + ' ' + bad;
    }
    return null;
}

function typeMismatch(v, spec) {
    const types = [].concat(spec.type || []);
    if (types.length) {
        // numbers and booleans sent as text ("3", "true"), and numbers where text is expected (ids, frames), are accepted:
        // the tools convert them, and clients do send them
        const num = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
        const ok = types.some(t =>
            (t === 'integer' && Number.isInteger(num)) || (t === 'number' && Number.isFinite(num)) ||
            (t === 'string' && (typeof v === 'string' || Number.isFinite(v))) || (t === 'boolean' && (typeof v === 'boolean' || v === 'true' || v === 'false')) ||
            (t === 'array' && Array.isArray(v)) || (t === 'object' && typeof v === 'object' && !Array.isArray(v)) || t === 'null');
        if (!ok) return 'must be ' + types.join(' or ') + ' (got ' + (Array.isArray(v) ? 'array' : typeof v) + ')';
    }
    if (Array.isArray(spec.enum) && !spec.enum.includes(v)) return 'must be one of ' + spec.enum.join(', ');
    if (typeof v === 'number' || (typeof v === 'string' && types.some(t => t === 'number' || t === 'integer'))) {
        const n = Number(v);
        if (typeof spec.minimum === 'number' && n < spec.minimum) return 'must be at least ' + spec.minimum;
        if (typeof spec.maximum === 'number' && n > spec.maximum) return 'must be at most ' + spec.maximum;
    }
    return null;
}
