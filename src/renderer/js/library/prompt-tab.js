// Prompt tab: the job prompt for Claude (El Subtitle Animator MCP), editable in the panel with a Copy button.
// The SETTINGS block at the top of the prompt is what changes per video; the rules below it refer to those names.
// Builder mode shows SETTINGS as sections of key rows (each with its own input, "+ if" conditions and a note),
// preset keys pick from the library, and the bottom menu adds keys for the MCP call parameters. Text mode edits
// the whole prompt as plain text; both write the same text.
// Edits are kept in localStorage and mirrored to <library>/job-prompt.md (read by the /elsa-prompt command). "Save as default" stores the current text as the user's own
// default; Reset goes back to that (or to the built-in text when none is saved); "Restore built-in" drops it.

const JOB_PROMPT_KEY = 'sa.jobPrompt';
const JOB_PROMPT_DEFAULT_KEY = 'sa.jobPromptDefault';

// The note under HIGHLIGHT_BOX: what Claude does with the row.
const HIGHLIGHT_NOTE = 'the box / pill behind the key word → set_rules highlight { auto, width, height, x, y }';

const DEFAULT_JOB_PROMPT = `# El Subtitle Animator — job prompt

## SETTINGS  (edit here; the rules below refer to these names)

JOB
  TIMELINE:        "<timeline name>"
  SCOPE:           all coloured subtitles
                   (examples: first 5 coloured · first Orange, first Teal, first Violet group · indexes 1–60)
  PLAN_THRESHOLD:  10   → show me the plan before placing more clips than this

SIZE (Inspector values)
  SIZE_MIN:        0.135
  SIZE_MAX:        0.162
  LINE_SPACING:    0.7      (normal captions; on MultiText also the gap between upper / emphasis / lower)
  LINE_SPACING_LONG: 1.0    (long sentences / Teal)
  STACK_GAP:       1.0      (gap between stacked Violet lines, as a line-spacing value)
  MAX_LINES:       3
  WORDS_PER_LINE:  4–5
  LONG_SENTENCE:   6+ words

SUBTITLE TRIMMING
  WORDS_PER_BLOCK: 1–3
                   words per subtitle block when chopping an .srt (chop_srt minWords / maxWords)
  CHARS_PER_BLOCK: 1–20
                   characters per block, spaces included (chop_srt minChars / maxChars)
                   both limits apply together: a block over either is cut smaller (e.g. 2 + 1 words)

POSITION (vertical 9:16)
  X:               0.5 — centre of the frame, always
  OVERFLOW:        a small run past the safe-zone side edges is fine; never shift text off centre to avoid it
  BAND:            between the "captions" and "graphics" guides of the saved layout; Y = centre of the band
  TRACKS:          the panel's Placement settings decide the layer — never pass track, stacks included

COLOUR ROLES
  ORANGE → vibe presets (see PRESETS)
  TEAL   → long-sentence treatment, LINE_SPACING_LONG
  VIOLET → stacked group
  any other colour → leave untouched, mention it in the report

PRESETS
  DEFAULT:  Word by Word Type (ML) · Slide Down Typing Words (ML) · Slide Up Typing Words (ML)  (vary them)
  DANGER:   ❗❌⚠️ Danger
  MONEY:    🤑✨ Bright Money
  FUN:      Drop Pump (ML)
  LONG:     Word by Word Type with Wiggle (ML)
  HYPE:     the most energetic preset my rules allow

TEXT STYLE
  NORMAL:    Poppins Bold, #ffffff
             forced on DEFAULT presets only; DANGER / MONEY keep their own font
  EMPHASIS:  Larken Black, #ff8a00
             on MultiText, the single key word goes in the emphasis part
  HIGHLIGHT_BOX: auto · width 1.00 · height 1.00 · x 0.000 · y 0.000
             ${HIGHLIGHT_NOTE}
  SOUND:     on; every effect keeps its own subtitle's length

## BEFORE PLACING
1. Save the project in Resolve (Cmd+S). Subtitle colours are read from the saved project file, so unsaved
   colour changes are invisible.
2. status / get_layout: confirm the timeline shape and appliesToThisTimeline: true. If not, stop and tell me.
3. set_rules with SIZE_MAX, LINE_SPACING, the text style pairs and sound from SETTINGS, then get_rules to confirm
   they took. NORMAL: a pair for both → font + color; (Text+) → kindStyle.textplus; (MultiText) → kindStyle.multitext.
   EMPHASIS → emphasis (font, style, color). GRADIENT → gradient {enabled: true, top, bottom, topStop, bottomStop}
   ("text colour" / no top = top null; one colour = bottom null); place recolours gradient fills itself, even on
   DANGER / MONEY, so never edit the comp after placing. "override N%" → styleShare.normal / styleShare.emphasis (0 = preset
   default on every clip, 100 = always the override). "except TAG, TAG (keep font & colour | keep font | keep colour)"
   → styleExcept.normal / styleExcept.emphasis = { tags, keep: both | font | color }. CLIP_TRACK (V3–V5) → trackRange
   {from, to} on every place / place_stack; AUDIO_TRACK → audioTrack {mode: any | same | own, from, to}. Presets that keep their own font/colour (DANGER / MONEY): pass
   keepPresetStyle: true on place / place_stack.
4. list_subtitles with color "any". Check clipColors. If a colour in COLOUR ROLES is 0 or missing, stop and tell me.
   Never place on a subtitle without a clip colour, however good a fit it looks.

## RULES

Vibe (ORANGE)
  Judge each line with the subtitles just before and after it, not from one keyword.
  Risk, problem, warning, loss, mistake, fear          → DANGER
  Money, price, cost, revenue, profit, currency numbers → MONEY
  Playful, surprising, punchline, careful-fun emphasis  → FUN
  Calm, explanatory, neutral                            → DEFAULT
  Excited, hype, big claim                              → HYPE
  Never the same special preset on two consecutive coloured subtitles.

Long sentences (TEAL, or any subtitle with LONG_SENTENCE words)
  Preset LONG, always — it beats the vibe rules; still mention the vibe in the report.
  Two long sentences in a row both get LONG (the no-repeat rule doesn't apply to it).
  Split into lines of WORDS_PER_LINE at natural pauses (commas, and, but, so), MAX_LINES at most,
  never a single word on a line. Line spacing LINE_SPACING_LONG.
  MultiText: upper = opening, emphasis = key word or phrase (3 words max), lower = the rest; together the full text.
  If it can't reach SIZE_MIN within MAX_LINES, don't cut words and don't shrink below SIZE_MIN:
  tell me it's too long and suggest where to split the subtitle in two.

Stacks (VIOLET)
  A run of consecutive Violet subtitles is one group. Same preset for the whole group, from its overall vibe
  (no-repeat rule doesn't apply inside a group).
  Every subtitle except the last: holdUntil = the group's last subtitle. The last keeps its own length.
  Only the text is held; the sound keeps each subtitle's own length.
  Layout: one line per subtitle, X 0.5, group centred on the band, lines STACK_GAP apart at their size.
  Same size for every line in the group, within SIZE_MIN–SIZE_MAX. If the group can't fit the band at SIZE_MIN,
  tell me rather than leaving the band or shrinking below it.

Sizing (all clips)
  Every clip lands between SIZE_MIN and SIZE_MAX (on MultiText: the biggest layer; the group scales with it).
  Never accept a fit-shrink below SIZE_MIN: size up with textSize to the range. Never use scale.
  Lines over WORDS_PER_LINE get a line break. If a clip would be too small at SIZE_MIN, treat it as a long sentence.

Placement
  Vertical: X 0.5, Y at the band centre, fit false, explicit textSize. Never cover the head zone; if a face sits
  in the band, tell me in the report instead of moving the caption out of the band.
  Horizontal / other: ignore the layout; preset default position unless it covers a face — never covering faces wins.
  Check every clip with get_frame at the end of the subtitle (all words in): between the two cyan lines, off the
  red and the yellow head box, nothing cut off. Fix anything that fails before moving on.

## REPORT
  Orange: colour, vibe (one or two words), preset, why.
  Teal / long: word count, line split, final Inspector size.
  Violet: subtitles in the group, preset, track per line (as the panel chose), holdUntil, y per line.
  Then: anything that overflowed the safe edge, anything that couldn't reach SIZE_MIN, faces in the band,
  presets whose colours aren't white/orange, and any clip the fit moved or shrank.
`;

// The user's saved default, or null when they have none.
function userJobPromptDefault() {
    try { const s = localStorage.getItem(JOB_PROMPT_DEFAULT_KEY); if (s && s.trim()) return s; } catch (e) { /* ignore */ }
    return null;
}

// What Reset goes back to.
function effectiveJobPromptDefault() {
    return userJobPromptDefault() || DEFAULT_JOB_PROMPT;
}

function loadJobPrompt() {
    try { const s = localStorage.getItem(JOB_PROMPT_KEY); if (s && s.trim()) return s; } catch (e) { /* ignore */ }
    return effectiveJobPromptDefault();
}

function saveJobPrompt(text) {
    mirrorJobPromptToFile(text);
    try {
        if (text === effectiveJobPromptDefault()) localStorage.removeItem(JOB_PROMPT_KEY); else localStorage.setItem(JOB_PROMPT_KEY, text);
    } catch (e) { /* ignore */ }
}

// Also written to job-prompt.md in the library folder so Claude Code's /elsa-prompt command can read it.
function mirrorJobPromptToFile(text) {
    try { if (window.sa && window.sa.saveJobPromptFile) window.sa.saveJobPromptFile(String(text || '')); } catch (e) { /* ignore */ }
}

function saveJobPromptDefault(text) {
    try {
        if (text === null || text === DEFAULT_JOB_PROMPT) localStorage.removeItem(JOB_PROMPT_DEFAULT_KEY); else localStorage.setItem(JOB_PROMPT_DEFAULT_KEY, text);
    } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- settings builder
// The prompt text stays the single source of truth (it is what gets saved, copied and reset). The builder parses
// its "## SETTINGS" block into sections of KEY / value rows, and writes the block back after every edit:
//
//   SECTION TITLE                    a line with no indent
//     KEY:     value                 a row ("KEY → value" rows too, as in COLOUR ROLES)
//              note line             deeper-indented lines under a row are its note...
//              if <cond> → <then>    ...except "if ... → ..." lines, which are its conditions
//
// Everything after the SETTINGS block (BEFORE PLACING, RULES, REPORT) is edited as text below the builder.

const JOB_PROMPT_MODE_KEY = 'sa.jobPromptMode';
// Resolve's 16 clip colours, in the order of its Clip Color menu, with the swatch it draws (approximate).
const PB_CLIP_COLOURS = [
    ['Orange', '#eb6e01'], ['Apricot', '#ffa833'], ['Yellow', '#e2a906'], ['Lime', '#9fc615'], ['Olive', '#5f9909'],
    ['Green', '#448f65'], ['Teal', '#00ada5'], ['Navy', '#0e3f7a'], ['Blue', '#4a90d9'], ['Purple', '#9e58c3'],
    ['Violet', '#d04ddd'], ['Pink', '#f75baf'], ['Tan', '#b9af97'], ['Beige', '#c4a983'], ['Brown', '#99643a'],
    ['Chocolate', '#8c5a3f']
];
const PB_OTHER_COLOUR = 'any other colour';
const PB_COLOURS = PB_CLIP_COLOURS.map(c => c[0]).concat(PB_OTHER_COLOUR);

// "ORANGE" / "orange" -> its swatch, or null for "any other colour" and custom keys.
function pbColourHex(name) {
    const c = PB_CLIP_COLOURS.find(x => x[0].toLowerCase() === String(name || '').trim().toLowerCase());
    return c ? c[1] : null;
}

function pbColourDot(name) {
    const d = pbEl('span', 'pb-cdot');
    const hex = pbColourHex(name);
    if (hex) d.style.background = hex; else d.classList.add('none');
    return d;
}

// Colour-role key: a button with the colour's dot that opens every Resolve clip colour. Keys are written in upper
// case (ORANGE), like the rules refer to them; colours other roles already use are marked.
function pbColourKey(section, row) {
    const btn = pbEl('button', 'pb-ckey');
    const paint = () => {
        btn.innerHTML = '';
        btn.appendChild(pbColourDot(row.key));
        btn.appendChild(pbEl('span', 'pb-ckey-name', row.key || 'Pick a colour'));
        btn.appendChild(pbEl('span', 'pb-ckey-caret', '▾'));
    };
    paint();
    btn.title = 'Resolve clip colour this role applies to';
    btn.addEventListener('click', () => {
        openPop(btn, 'pop-menu pb-cpop', (el) => {
            const used = section.rows.filter(r => r !== row).map(r => r.key.trim().toLowerCase());
            const item = (name, upper) => {
                const it = pbEl('button', 'pop-item' + (row.key.trim().toLowerCase() === name.toLowerCase() ? ' on' : ''));
                it.appendChild(pbColourDot(name));
                it.appendChild(pbEl('span', 'pop-label', name));
                if (used.includes(name.toLowerCase())) it.appendChild(pbEl('span', 'pb-cused', 'in use'));
                it.addEventListener('click', () => { closePop(); row.key = upper ? name.toUpperCase() : name; paint(); pbChanged(); });
                el.appendChild(it);
            };
            el.appendChild(pbEl('div', 'pop-title', 'Resolve clip colours'));
            for (const [name] of PB_CLIP_COLOURS) item(name, true);
            el.appendChild(pbEl('div', 'pop-sep'));
            item(PB_OTHER_COLOUR, false);
        });
    });
    return btn;
}

// What the bottom "Add from MCP" menu offers, grouped by the MCP call the parameter feeds. Each entry lands as a row
// in `section` (made when missing). kind: text | enum | preset | tags. The prompt only describes these values;
// Claude passes them to the named call.
const PB_MCP_PARAMS = [
    { tool: 'set_rules', items: [
        { label: 'allowedTags: only presets with these tags', section: 'PRESETS', key: 'ALLOWED_TAGS', kind: 'tags', value: '', hint: 'Emoji, tag names or ids. Empty = all presets allowed.' },
        { label: 'tagMatch: any / all of the tags', section: 'PRESETS', key: 'TAG_MATCH', kind: 'enum', options: ['any', 'all'], value: 'any', hint: 'any: a preset needs at least one of the tags; all: every tag.' },
        { label: 'NORMAL: font + colour of the text', section: 'TEXT STYLE', key: 'NORMAL', kind: 'style', value: 'Poppins Bold, #ffffff', hint: 'Sets the rules\' font and color: the font and fill colour forced on the clips.' },
        { label: 'EMPHASIS: font + colour of the key word', section: 'TEXT STYLE', key: 'EMPHASIS', kind: 'style', value: 'Larken Black, #ffd400', hint: 'Sets the rules\' emphasis: the MultiText key-word layer\'s font and fill colour.' },
        { label: 'GRADIENT: recolour gradient fills', section: 'TEXT STYLE', key: 'GRADIENT', value: 'text colour (top 0.29) → #CF1D46 (bottom 1.0)', hint: 'Presets with a gradient text fill (Money Pop Up, $123,456) get this gradient instead of their own, even when they keep their own colour. "text colour" = the NORMAL colour; one colour = a plain fill. Claude passes it as set_rules gradient.' },
        { label: 'text.maxSize: largest text Size', section: 'SIZE (Inspector values)', key: 'SIZE_MAX', value: '0.162', hint: 'Largest Size, as the Inspector shows it.' },
        { label: 'text.lineSpacing: Line Spacing', section: 'SIZE (Inspector values)', key: 'LINE_SPACING', value: '0.7', hint: 'Line Spacing as the Inspector shows it (1 = normal).' },
        { label: 'track.mode: which video layer', section: 'POSITION (vertical 9:16)', key: 'TRACK_MODE', kind: 'enum', options: ['top', 'first-empty', 'fixed'], value: 'top', hint: 'Starts as the panel\'s Placement setting. top = above everything, first-empty = lowest free layer above V1, fixed = always one layer.' },
        { label: 'track.fixed: always this layer', section: 'POSITION (vertical 9:16)', key: 'TRACK_FIXED', value: 'V4', hint: 'Used with TRACK_MODE fixed.' },
        { label: 'Clip track: video layer range', section: 'POSITION (vertical 9:16)', key: 'CLIP_TRACK', kind: 'range', prefix: 'V', min: 2, value: 'V2–∞', hint: 'Linked with the panel\'s Placement "Clip track" range. Claude passes it as trackRange.' },
        { label: 'Audio track: sound effect tracks', section: 'POSITION (vertical 9:16)', key: 'AUDIO_TRACK', kind: 'audio', after: 'CLIP_TRACK', value: 'any free track', hint: 'Linked with the panel\'s Placement "Audio track": any free track, same as clip track, or A2–A4. Claude passes it as audioTrack.' },
        { label: 'position.defaultZone', section: 'POSITION (vertical 9:16)', key: 'DEFAULT_ZONE', kind: 'enum', options: ['top', 'upper', 'center', 'lower', 'bottom'], value: 'lower', hint: 'Where text goes when no x/y or guide is given.' },
        { label: 'position.avoidFaces', section: 'POSITION (vertical 9:16)', key: 'AVOID_FACES', kind: 'enum', options: ['yes', 'no'], value: 'yes', hint: 'Claude looks at each frame and keeps text off faces.' },
        { label: 'position.safeTop / Bottom / Left / Right', section: 'POSITION (vertical 9:16)', key: 'SAFE_MARGINS', value: 'top 0.1 · bottom 0.1 · left 0.05 · right 0.05', hint: 'Safe-area margins, 0..1 of the frame.' },
        { label: 'multitext.emphasis: which word', section: 'TEXT STYLE', key: 'EMPHASIS_PICK', kind: 'enum', options: ['auto', 'last', 'first', 'center'], value: 'auto', hint: 'Which word goes in the MultiText emphasis part when Claude does not choose.' },
        { label: 'multitext.uppercaseEmphasis', section: 'TEXT STYLE', key: 'UPPERCASE_EMPHASIS', kind: 'enum', options: ['yes', 'no'], value: 'no', hint: 'Upper-case the emphasised word(s).' },
        { label: 'highlight: box / pill size, position, auto-balance', section: 'TEXT STYLE', key: 'HIGHLIGHT_BOX', kind: 'highlight', value: 'auto · width 1.00 · height 1.00 · x 0.000 · y 0.000', hint: 'The box / pill behind the highlighted word. auto = even padding on every side; width / height multiply the box; x / y nudge it (Inspector Offset units). Claude passes it as set_rules highlight.' },
        { label: 'sound: place sound effects', section: 'TEXT STYLE', key: 'SOUND', kind: 'enum', options: ['on', 'off'], value: 'on', hint: 'Place the presets\' sound effects.' },
        { label: 'notes: free-text rule to remember', section: 'NOTES', key: 'NOTE', value: '', hint: 'Saved with the rules; Claude reads it on every job.' }
    ] },
    { tool: 'place', items: [
        { label: 'presetId: a new preset role', section: 'PRESETS', key: 'NEW_ROLE', kind: 'preset', value: '', hint: 'Pick presets (or tags) from your library for a role the rules can refer to.' },
        { label: 'x: horizontal centre', section: 'POSITION (vertical 9:16)', key: 'X', value: '0.5', hint: '0..1 of the frame width, where the text\'s centre goes.' },
        { label: 'y: vertical centre', section: 'POSITION (vertical 9:16)', key: 'Y', value: '0.7', hint: '0..1 of the frame height, 0 = top.' },
        { label: 'zone: preset area of the frame', section: 'POSITION (vertical 9:16)', key: 'ZONE', kind: 'enum', options: ['top', 'upper', 'center', 'lower', 'bottom'], value: 'lower', hint: 'Used when no x/y or guide is given.' },
        { label: 'guide: layout guide line', section: 'POSITION (vertical 9:16)', key: 'GUIDE', value: 'captions', hint: 'A guide name from the saved layout (get_layout).' },
        { label: 'align: on / below / above the guide', section: 'POSITION (vertical 9:16)', key: 'ALIGN', kind: 'enum', options: ['on', 'below', 'above'], value: 'below', hint: 'on = centred on the line; below/above = centred in the area next to it.' },
        { label: 'fit: fit into the layout', section: 'POSITION (vertical 9:16)', key: 'FIT', kind: 'enum', options: ['true', 'false'], value: 'false', hint: 'false = do not move or shrink the clip to fit the layout.' },
        { label: 'shrink: allow shrinking to fit', section: 'SIZE (Inspector values)', key: 'SHRINK', kind: 'enum', options: ['true', 'false'], value: 'false', hint: 'false = only move the clip, never reduce its size.' },
        { label: 'textSize: size multiplier', section: 'SIZE (Inspector values)', key: 'TEXT_SIZE', value: '1.0', hint: 'Multiplier on the preset\'s own size (0.66 = two thirds).' },
        { label: 'holdUntil: keep on screen until', section: 'STACKS', key: 'HOLD_UNTIL', value: 'the group\'s last subtitle', hint: 'Stacked captions: hold the text until a later subtitle ends.' },
        { label: 'keepPresetStyle: skip font/colour overrides', section: 'TEXT STYLE', key: 'KEEP_PRESET_STYLE', value: 'DANGER, MONEY', hint: 'Presets or roles that keep their own font and colours (Claude passes keepPresetStyle: true for them).' },
        { label: 'parts: MultiText split', section: 'TEXT STYLE', key: 'PARTS', value: 'upper = opening · emphasis = key word · lower = the rest', hint: 'How a subtitle splits into upper / emphasis / lower.' },
        { label: 'dryRun: only show the plan', section: 'JOB', key: 'DRY_RUN', kind: 'enum', options: ['no', 'yes'], value: 'no', hint: 'yes = Claude shows what it would place without placing.' }
    ] },
    { tool: 'place_stack', items: [
        { label: 'lineSpacing: gap between stacked lines', section: 'SIZE (Inspector values)', key: 'STACK_GAP', value: '1.0', hint: 'Gap between stacked lines, as a Line Spacing value.' },
        { label: 'y: centre of the stack', section: 'POSITION (vertical 9:16)', key: 'STACK_Y', value: 'band centre', hint: 'Where the middle of the whole group goes.' }
    ] },
    { tool: 'list_subtitles', items: [
        { label: 'color: a colour role', section: 'COLOUR ROLES', key: 'Orange', sep: '→', value: '', hint: 'What Claude does with subtitles of this clip colour.' },
        { label: 'from / to: subtitle range', section: 'JOB', key: 'SCOPE', value: 'indexes 1–60', hint: 'Which subtitles this job covers.' }
    ] },
    { tool: 'get_frame', items: [
        { label: 'at: which frame to check', section: 'JOB', key: 'CHECK_AT', kind: 'enum', options: ['end', 'middle', 'start'], value: 'end', hint: 'Frame Claude looks at to check each placed clip.' }
    ] },
    { tool: 'chop_srt', items: [
        { label: 'minWords / maxWords: words per block', section: 'SUBTITLE TRIMMING', key: 'WORDS_PER_BLOCK', kind: 'range', min: 1, value: '1–3', hint: 'Words per subtitle block when chopping an .srt. Works together with CHARS_PER_BLOCK.' },
        { label: 'minChars / maxChars: characters per block', section: 'SUBTITLE TRIMMING', key: 'CHARS_PER_BLOCK', kind: 'range', min: 1, value: '1–20', hint: 'Characters per block, spaces included. A block over this or WORDS_PER_BLOCK is cut smaller (e.g. 2 + 1 words).' }
    ] },
    { tool: 'custom', items: [
        { label: 'Text key', section: null, key: 'NEW_KEY', value: '', hint: 'A free key/value in the last section.' },
        { label: 'Preset list key', section: null, key: 'NEW_PRESETS', kind: 'preset', value: '', hint: 'A key whose value is picked from your preset library.' },
        { label: 'New section', newSection: true, hint: 'An empty section with its own Add key button.' }
    ] }
];

// Keys linked both ways with the panel's Placement drawer (Use tab): changing the drawer rewrites these rows, and
// editing a row (when you leave the box) sets the drawer, which also tells the MCP side.
const pbClipTrackOf = (o) => (o.rangeFrom || o.rangeTo) ? 'V' + (o.rangeFrom || 2) + '–' + (o.rangeTo ? 'V' + o.rangeTo : '∞') : 'V2–∞';
const PB_PLACEMENT = {
    CLIP_TRACK: pbClipTrackOf,
    TRACK_RANGE: pbClipTrackOf,
    AUDIO_TRACK: (o) => pbJoinAudio({ mode: o.audioMode, from: o.audioFrom, to: o.audioTo }),
    TRACK_MODE: (o) => (o.firstEmpty ? 'first-empty' : 'top')
};

// AUDIO_TRACK: "any free track" | "same as clip track" | "A2–A4" / "A3–∞" -> { mode: any | same | own, from, to }
function pbParseAudio(v) {
    const t = String(v || '').trim();
    if (!t || /^any/i.test(t)) return { mode: 'any', from: null, to: null };
    if (/same|clip|video/i.test(t)) return { mode: 'same', from: null, to: null };
    const r = pbParseRange(t.replace(/^own\s*/i, ''), 1);
    return r ? { mode: 'own', from: r.from, to: r.to } : null;
}
function pbJoinAudio(a) {
    if (!a || a.mode === 'same') return a ? 'same as clip track' : 'any free track';
    if (a.mode === 'own' && (a.from || a.to)) return pbJoinRange('A', a.from || 1, a.to || null);
    return 'any free track';
}

function pbPlacementValue(key) {
    const f = PB_PLACEMENT[key];
    if (!f || typeof placeOptions !== 'function') return null;
    try { return f(placeOptions()); } catch (e) { return null; }
}

// "V3–V6", "3-6", "V3 to V6", "V2–∞", "V4" -> { from, to } (to null = no limit), or null when it can't be read.
// Numbers below `min` are raised to it; a To below From becomes From.
function pbParseRange(v, min) {
    const lo = min == null ? 0 : min;
    const m = String(v || '').match(/^\s*[A-Za-z]?\s*(\d+(?:\.\d+)?)\s*(?:(?:–|-|—|to)\s*(?:[A-Za-z]?\s*(\d+(?:\.\d+)?)|∞)?)?\s*$/i);
    if (!m) return null;
    const from = Math.max(lo, Number(m[1]));
    const single = !/(–|-|—|to)/i.test(v);
    const to = single ? from : (m[2] ? Math.max(from, Number(m[2])) : null);
    return { from, to };
}

function pbParseTrackRange(v) { return pbParseRange(v, 2); }

// { from, to } back to text: "V3–V6", "V3–∞", "4–5".
function pbJoinRange(prefix, from, to) {
    return (prefix || '') + from + '–' + (to != null ? (prefix || '') + to : '∞');
}

function pbSetPlaceField(id, prop, val) {
    const e = $(id);
    if (!e || e[prop] === val) return false;
    e[prop] = val;
    e.dispatchEvent(new Event('change'));   // the drawer saves, tells the main process and calls back here
    return true;
}

// A linked row was edited: put it into the Placement drawer.
function pbPushToPlacement(row) {
    const key = row.key.trim();
    if (!PB_PLACEMENT[key]) return;
    pb.pushing = true;   // the drawer calls back on every field; sync once at the end instead
    try { pbPushFields(row, key); } finally { pb.pushing = false; }
    promptPlacementChanged();
}

function pbPushFields(row, key) {
    if (key === 'AUDIO_TRACK') {
        const a = pbParseAudio(row.value);
        if (!a) { setPromptStatus('AUDIO_TRACK: write any free track, same as clip track, or a range like A2–A4.', 'bad'); return; }
        if (a.mode === 'own') {
            pbSetPlaceField('placeAudioTo', 'value', a.to ? String(a.to) : '');
            pbSetPlaceField('placeAudioFrom', 'value', String(a.from));
            pbSetPlaceField('placeAudioTo', 'value', a.to ? String(a.to) : '');
        }
        pbSetPlaceField('placeAudioMode', 'value', a.mode);
        setPromptStatus('Placement: audio on ' + pbJoinAudio(a) + '.', 'ok');
    } else if (key === 'CLIP_TRACK' || key === 'TRACK_RANGE') {
        const r = pbParseTrackRange(row.value);
        if (!r) { setPromptStatus(key + ': write it like V3–V6 (or V3–∞) to update Placement.', 'bad'); return; }
        // To first when it grows, so the drawer's "To ≥ From" fix-up doesn't fight the new From.
        pbSetPlaceField('placeRangeTo', 'value', r.to ? String(r.to) : '');
        pbSetPlaceField('placeRangeFrom', 'value', String(r.from));
        pbSetPlaceField('placeRangeTo', 'value', r.to ? String(r.to) : '');
        setPromptStatus('Placement: between V' + r.from + ' and ' + (r.to ? 'V' + r.to : '∞') + '.', 'ok');
    } else if (key === 'TRACK_MODE') {
        if (row.value === 'fixed') return;   // the drawer has no fixed mode; TRACK_FIXED / TRACK_RANGE say which layer
        pbSetPlaceField('placeFirstEmpty', 'checked', row.value === 'first-empty');
        setPromptStatus('Placement: ' + (row.value === 'first-empty' ? 'first empty layer' : 'top layer') + '.', 'ok');
    }
}

// The Placement drawer changed (or was just set up): linked rows take its values.
function promptPlacementChanged() {
    if (pb.pushing) return;
    const doc = pb.doc || parseJobPrompt(pb.full);
    if (!doc) return;
    let changed = false;
    for (const s of doc.sections) for (const r of s.rows) {
        const k = r.key.trim();
        const v = pbPlacementValue(k);
        if (v == null || r.value === v) continue;
        if (k === 'TRACK_MODE' && r.value === 'fixed') continue;
        // Same range written another way ("V3-V6") is left as typed.
        if ((k === 'CLIP_TRACK' || k === 'TRACK_RANGE') && JSON.stringify(pbParseTrackRange(r.value)) === JSON.stringify(pbParseTrackRange(v))) continue;
        if (k === 'AUDIO_TRACK' && JSON.stringify(pbParseAudio(r.value)) === JSON.stringify(pbParseAudio(v))) continue;
        r.value = v; changed = true;
    }
    if (!changed) return;
    pb.doc = doc;
    pb.full = serializeJobPrompt(doc);
    saveJobPrompt(pb.full);
    refreshPromptFlags();
    if (pb.mode === 'builder') { if (!$('promptBuilder').contains(document.activeElement)) renderPromptBuilder(true); }
    else if (document.activeElement !== $('promptText')) { $('promptText').value = pb.full; renderPromptHilite(); }
}

const PB_CATALOG = {};
for (const g of PB_MCP_PARAMS) for (const it of g.items) if (it.key && !PB_CATALOG[it.key]) PB_CATALOG[it.key] = it;

const pb = { doc: null, mode: 'builder', full: '', pushing: false };

function parsePromptRow(t) {
    const ci = t.indexOf(':'), ai = t.indexOf(' → ');
    if (ai >= 0 && (ci < 0 || ai < ci)) return { key: t.slice(0, ai).trim(), sep: '→', value: t.slice(ai + 3).trim(), note: '', conds: [] };
    if (ci >= 0) return { key: t.slice(0, ci).trim(), sep: ':', value: t.slice(ci + 1).trim(), note: '', conds: [] };
    return { key: t.trim(), sep: ':', value: '', note: '', conds: [] };
}

// { pre, sections, post } or null when the text has no "## SETTINGS" heading.
function parseJobPrompt(text) {
    const lines = String(text).split('\n');
    const si = lines.findIndex(l => /^##\s+SETTINGS\b/i.test(l));
    if (si < 0) return null;
    let ei = lines.findIndex((l, i) => i > si && /^##\s/.test(l));
    if (ei < 0) ei = lines.length;
    const sections = [];
    let cur = null, row = null;
    for (const line of lines.slice(si + 1, ei)) {
        if (!line.trim()) continue;
        const ind = line.match(/^ */)[0].length;
        if (ind === 0) { cur = { title: line.trim(), rows: [] }; sections.push(cur); row = null; continue; }
        if (!cur) { cur = { title: 'GENERAL', rows: [] }; sections.push(cur); }
        if (ind >= 4 && row) {
            const t = line.trim(), m = t.match(/^if\s+(.*?)\s+→\s*(.*)$/i);
            if (m) row.conds.push({ if: m[1], then: m[2] });
            else row.note = row.note ? row.note + '\n' + t : t;
            continue;
        }
        row = parsePromptRow(line.trim());
        cur.rows.push(row);
    }
    return { pre: lines.slice(0, si + 1).join('\n'), sections, post: lines.slice(ei).join('\n') };
}

function serializeJobPrompt(doc) {
    const out = [doc.pre, ''];
    for (const s of doc.sections) {
        out.push(s.title.trim() || 'SECTION');
        // Values line up in one column per section (at most 19 characters in, longer keys get one space).
        const w = Math.min(19, Math.max(8, ...s.rows.filter(r => r.sep === ':').map(r => r.key.length + 4)));
        for (const r of s.rows) {
            const key = r.key.trim() || 'KEY';
            let line;
            if (r.sep === '→') line = '  ' + key + ' → ' + r.value;
            else { const head = '  ' + key + ':'; line = r.value ? (head.length >= w ? head + ' ' : head.padEnd(w)) + r.value : head; }
            out.push(line.replace(/\s+$/, ''));
            const pad = ' '.repeat(Math.max(4, r.sep === '→' ? 4 : w));
            for (const n of String(r.note || '').split('\n')) if (n.trim()) out.push(pad + n.trim());
            for (const c of r.conds) if (c.if.trim() || c.then.trim()) out.push(pad + 'if ' + c.if.trim() + ' → ' + c.then.trim());
        }
        out.push('');
    }
    return out.join('\n') + (doc.post ? doc.post : '');
}

// The kind of value editor a row gets.
// Keys of the built-in prompt that get a special editor without being MCP parameters.
const PB_KEY_KINDS = {
    WORDS_PER_LINE: { kind: 'range', min: 1 },
    TRACK_RANGE: PB_CATALOG.CLIP_TRACK          // the old name of CLIP_TRACK, still read in saved prompts
};

function pbKeySpec(key) { return PB_CATALOG[String(key).trim()] || PB_KEY_KINDS[String(key).trim()] || null; }

function pbRowKind(row, section) {
    const c = pbKeySpec(row.key);
    // A range row whose text can't be read as a range (e.g. "4–5 or so") stays a text box rather than losing words.
    if (c && c.kind === 'range' && String(row.value).trim() && !pbParseRange(row.value, c.min)) return 'text';
    if (c && c.kind === 'audio' && String(row.value).trim() && !pbParseAudio(row.value)) return 'text';
    if (c && c.kind === 'highlight' && String(row.value).trim() && !pbParseHighlight(row.value)) return 'text';
    if (c && c.kind) return c.kind;
    if (/^PRESETS\b/i.test(section.title) && row.sep === ':') return 'preset';
    return 'text';
}

// Library presets and tags, as the names a prompt uses ("Drop Pump (ML)", "❗❌⚠️ Danger").
function pbPresetNames() { return ((state.lib && state.lib.animations) || []).map(a => a.name); }
function pbTagNames() { return allTags().map(tagLabel); }

// "A · B · C  (vary them)" -> { items: [A, B, C], extra: "(vary them)" }. Lower-case phrases are kept as text.
function pbSplitList(v) {
    let extra = '';
    let s = String(v || '');
    const m = s.match(/\s{2,}(\(.*\))\s*$/);
    if (m) { extra = m[1]; s = s.slice(0, m.index); }
    const items = [];
    const rest = [];
    for (const p of s.split(' · ').map(x => x.trim()).filter(Boolean)) {
        if (/^[a-z]/.test(p)) rest.push(p); else items.push(p);
    }
    if (rest.length) extra = (rest.join(' · ') + (extra ? '  ' + extra : '')).trim();
    return { items, extra };
}

function pbJoinList(items, extra) {
    const a = items.join(' · ');
    return a && extra ? a + '  ' + extra : (a || extra || '');
}

function pbEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function pbSelect(cls, options, value, placeholder) {
    const sel = pbEl('select', cls);
    if (placeholder) { const o = pbEl('option', '', placeholder); o.value = ''; sel.appendChild(o); }
    const opts = options.slice();
    if (value && !opts.includes(value)) opts.unshift(value);
    for (const v of opts) { const o = pbEl('option', '', v); o.value = v; sel.appendChild(o); }
    sel.value = value || '';
    return sel;
}

// An edit that only changes text: write the prompt back, no re-render (keeps focus and caret).
function pbChanged() {
    if (!pb.doc) return;
    pb.full = serializeJobPrompt(pb.doc);
    pbSave();
}

// An edit that adds or removes something: write back and redraw the builder.
function pbRebuild() {
    pbChanged();
    renderPromptBuilder(true);
}

let pbSaveTimer = null;
function pbSave() {
    clearTimeout(pbSaveTimer);
    pbSaveTimer = setTimeout(() => { saveJobPrompt(pb.full); refreshPromptFlags(); }, 300);
}

function pbChipsEditor(row, kind) {
    const wrap = pbEl('div', 'pb-chips');
    const { items, extra } = pbSplitList(row.value);
    const names = pbPresetNames(), tags = pbTagNames();
    const known = kind === 'tags' ? tags : names.concat(tags);
    const write = (list, ex) => { row.value = pbJoinList(list, ex); };
    items.forEach((name, i) => {
        const chip = pbEl('span', 'pb-chip' + (known.includes(name) ? '' : ' missing'));
        chip.title = known.includes(name) ? (tags.includes(name) ? 'Tag' : 'Preset') : 'Not in your library';
        chip.appendChild(pbEl('span', '', name));
        const x = pbEl('button', 'pb-chip-x', '×');
        x.title = 'Remove';
        x.addEventListener('click', () => { const l = items.slice(); l.splice(i, 1); write(l, extra); pbRebuild(); });
        chip.appendChild(x);
        wrap.appendChild(chip);
    });
    const sel = pbEl('select', 'pb-chip-add');
    const ph = pbEl('option', '', kind === 'tags' ? '+ tag…' : '+ preset…'); ph.value = ''; sel.appendChild(ph);
    const group = (label, list) => {
        const free = list.filter(n => !items.includes(n));
        if (!free.length) return;
        const g = document.createElement('optgroup'); g.label = label;
        for (const n of free) { const o = pbEl('option', '', n); o.value = n; g.appendChild(o); }
        sel.appendChild(g);
    };
    if (kind !== 'tags') group('Presets', names);
    group('Tags', tags);
    if (sel.options.length === 1) { ph.textContent = 'library is empty'; sel.disabled = true; }
    sel.addEventListener('change', () => { if (sel.value) { write(items.concat(sel.value), extra); pbRebuild(); } });
    wrap.appendChild(sel);
    const ex = pbEl('input', 'pb-chip-extra');
    ex.type = 'text'; ex.value = extra; ex.placeholder = 'note, e.g. (vary them)';
    ex.addEventListener('input', () => { write(items, ex.value.trim()); pbChanged(); });
    wrap.appendChild(ex);
    return wrap;
}

// AUDIO_TRACK: [Any free track | Same as clip track | Own range] and, for its own range, A[from] to A[to].
function pbAudioEditor(row) {
    const a = pbParseAudio(row.value) || { mode: 'any', from: null, to: null };
    const wrap = pbEl('div', 'pb-range pb-audio');
    const sel = pbEl('select', 'pb-val');
    for (const [v, label] of [['any', 'Any free track'], ['same', 'Same as clip track'], ['own', 'Own range']]) { const o = pbEl('option', '', label); o.value = v; sel.appendChild(o); }
    sel.value = a.mode;
    wrap.appendChild(sel);
    const write = (final) => { row.value = pbJoinAudio(a); pbChanged(); if (final) pbPushToPlacement(row); };
    sel.addEventListener('change', () => {
        a.mode = sel.value;
        if (a.mode === 'own' && !a.from) a.from = 2;
        write(true); pbRebuild();
    });
    if (a.mode === 'own') {
        const box = (val, ph, title) => {
            wrap.appendChild(pbEl('span', 'pb-range-pre', 'A'));
            const i = pbEl('input', 'pb-range-in');
            i.type = 'number'; i.min = '1'; i.step = '1'; i.placeholder = ph; i.title = title;
            i.value = val == null ? '' : String(val);
            wrap.appendChild(i);
            return i;
        };
        const f = box(a.from, '1', 'From');
        wrap.appendChild(pbEl('span', 'pb-range-to', 'to'));
        const t = box(a.to, '∞', 'To (empty = no limit)');
        const read = (final) => {
            let from = Math.max(1, Math.round(Number(f.value)) || 1);
            let to = t.value === '' ? null : Math.round(Number(t.value));
            if (to != null && (!Number.isFinite(to) || to < from)) to = final ? from : null;
            if (final) { f.value = String(from); t.value = to == null ? '' : String(to); }
            a.from = from; a.to = to; write(final);
        };
        for (const i of [f, t]) { i.addEventListener('input', () => read(false)); i.addEventListener('change', () => read(true)); }
    }
    return wrap;
}

// Two number boxes in one row: [prefix][from] to [prefix][to]; an empty To means no limit (∞).
// HIGHLIGHT_BOX: "auto · width 1.00 · height 1.00 · x 0.000 · y 0.000" ("manual" instead of auto) <-> object.
// null when the text is not in that shape (the row then stays a plain text box).
const PB_HL_DEFAULT = { auto: false, width: 1, height: 1, x: 0, y: 0 };
function pbParseHighlight(v) {
    const t = String(v || '').trim().toLowerCase();
    if (!t) return Object.assign({}, PB_HL_DEFAULT);
    const out = Object.assign({}, PB_HL_DEFAULT);
    let known = 0;
    for (const part of t.split('·').map(x => x.trim()).filter(Boolean)) {
        if (part === 'auto' || part === 'auto-balance' || part === 'balanced') { out.auto = true; known++; continue; }
        if (part === 'manual' || part === 'off') { out.auto = false; known++; continue; }
        const m = part.match(/^(width|height|x|y)\s+(-?\d*\.?\d+)$/);
        if (!m) return null;
        out[m[1]] = Number(m[2]);
        known++;
    }
    return known ? out : null;
}
function pbJoinHighlight(h) {
    return (h.auto ? 'auto' : 'manual') + ' · width ' + Number(h.width).toFixed(2) + ' · height ' + Number(h.height).toFixed(2) +
        ' · x ' + Number(h.x).toFixed(3) + ' · y ' + Number(h.y).toFixed(3);
}

// Auto-balance switch, Width / Height / X / Y sliders (double-click resets one) and "Apply to placed", which
// re-applies the values to every highlight clip on the current timeline and saves them in the rules.
const PB_HL_SLIDERS = [
    { k: 'width', label: 'Width', min: 0.5, max: 2, step: 0.01, dp: 2, def: 1, title: 'Box width, × the preset\'s (with auto: × the balanced box)' },
    { k: 'height', label: 'Height', min: 0.5, max: 2, step: 0.01, dp: 2, def: 1, title: 'Box height, × the preset\'s (with auto: the padding grows / shrinks and the width follows)' },
    { k: 'x', label: 'X', min: -0.3, max: 0.3, step: 0.002, dp: 3, def: 0, title: 'Move the box right (+) / left (−), Inspector Offset units' },
    { k: 'y', label: 'Y', min: -0.3, max: 0.3, step: 0.002, dp: 3, def: 0, title: 'Move the box up (+) / down (−), Inspector Offset units' }
];
function pbHighlightEditor(row) {
    const h = pbParseHighlight(row.value) || Object.assign({}, PB_HL_DEFAULT);
    const wrap = pbEl('div', 'pb-hl');
    const write = () => { row.value = pbJoinHighlight(h); pbChanged(); };
    const top = pbEl('div', 'pb-hl-top');
    const lab = pbEl('label', 'pb-hl-auto');
    const cb = pbEl('input');
    cb.type = 'checkbox'; cb.checked = !!h.auto;
    cb.addEventListener('change', () => { h.auto = cb.checked; write(); });
    lab.title = 'Measure each placed box and the word, then even out the space around the word (pills get extra side room for their round ends). Pills and Glass Pill are measured; Highlight Select / Soft Marker / Underline Draw only take the sliders.';
    lab.append(cb, pbEl('span', '', 'Auto-balance spacing'));
    const apply = pbEl('button', 'pb-mini pb-hl-apply', 'Apply to placed');
    apply.title = 'Re-apply these values to every highlight clip on the current timeline (and save them in the rules)';
    apply.addEventListener('click', async () => {
        if (!window.sa || !window.sa.adjustHighlights) { setPromptStatus('Restart the panel to use Apply to placed.', 'bad'); return; }
        apply.disabled = true;
        setPromptStatus('Adjusting highlight boxes…', '');
        try {
            const r = await window.sa.adjustHighlights({ highlight: Object.assign({}, h), save: true });
            if (!r || r.ok === false) throw new Error((r && r.error) || 'failed');
            const res = r.result || r;
            const notes = [];
            for (const c of res.results || []) for (const x of (c.highlights || [])) if (x.error || x.note) notes.push(x.error || x.note);
            if (res.results) for (const c of res.results) if (c.error) notes.push(c.error);
            setPromptStatus(res.clips ? 'Adjusted ' + res.clips + ' highlight clip' + (res.clips === 1 ? '' : 's') + '.' + (notes.length ? ' ' + [...new Set(notes)].join(' · ') : '') : 'No highlight clips on this timeline.', notes.length ? 'bad' : 'ok');
        } catch (e) {
            setPromptStatus('Highlight boxes not adjusted: ' + (e.message || e), 'bad');
        } finally { apply.disabled = false; }
    });
    top.append(lab, apply);
    wrap.appendChild(top);
    for (const sp of PB_HL_SLIDERS) {
        const line = pbEl('div', 'pb-hl-line');
        line.title = sp.title;
        const r = pbEl('input', 'pb-hl-slider');
        r.type = 'range'; r.min = String(sp.min); r.max = String(sp.max); r.step = String(sp.step);
        r.value = String(h[sp.k]);
        const n = pbEl('input', 'pb-hl-num');
        n.type = 'number'; n.step = String(sp.step); n.value = Number(h[sp.k]).toFixed(sp.dp);
        const set = (v, from) => {
            v = Number(v);
            if (!Number.isFinite(v)) return;
            h[sp.k] = v;
            if (from !== r) r.value = String(v);
            if (from !== n) n.value = v.toFixed(sp.dp);
            write();
        };
        r.addEventListener('input', () => set(r.value, r));
        r.addEventListener('dblclick', () => set(sp.def, null));
        n.addEventListener('change', () => set(n.value, n));
        line.append(pbEl('span', 'pb-hl-lab', sp.label), r, n);
        wrap.appendChild(line);
    }
    return wrap;
}

function pbRangeEditor(row) {
    const spec = pbKeySpec(row.key) || {};
    const min = spec.min == null ? 0 : spec.min;
    const r = pbParseRange(row.value, min) || { from: min || 1, to: null };
    const wrap = pbEl('div', 'pb-range');
    const box = (val, ph, title) => {
        if (spec.prefix) wrap.appendChild(pbEl('span', 'pb-range-pre', spec.prefix));
        const i = pbEl('input', 'pb-range-in');
        i.type = 'number'; i.min = String(min); i.step = '1'; i.placeholder = ph; i.title = title;
        i.value = val == null ? '' : String(val);
        wrap.appendChild(i);
        return i;
    };
    const a = box(r.from, String(min || 1), 'From');
    wrap.appendChild(pbEl('span', 'pb-range-to', 'to'));
    const b = box(r.to, '∞', 'To (empty = no limit)');
    const write = (final) => {
        let from = Number(a.value), to = b.value === '' ? null : Number(b.value);
        if (!Number.isFinite(from) || a.value === '') from = min || 1;
        from = Math.max(min, from);
        if (to != null && (!Number.isFinite(to) || to < from)) to = final ? from : null;
        if (final) { a.value = String(from); b.value = to == null ? '' : String(to); }
        row.value = pbJoinRange(spec.prefix, from, to);
        pbChanged();
        if (final) pbPushToPlacement(row);
    };
    for (const i of [a, b]) {
        i.addEventListener('input', () => write(false));
        i.addEventListener('change', () => write(true));
    }
    return wrap;
}

// "Larken Black" -> { family: 'Larken', style: 'Black' }: the longest installed family the text starts with, else a
// trailing weight word is the style. Text that names no font ("keep each preset's font") stays whole in the family box.
function pbSplitFont(v) {
    const t = String(v || '').trim();
    const lo = t.toLowerCase();
    let fam = null;
    for (const f of (state.fonts || [])) {
        const fl = f.toLowerCase();
        if ((lo === fl || lo.startsWith(fl + ' ')) && (!fam || f.length > fam.length)) fam = f;
    }
    if (fam) return { family: fam, style: t.slice(fam.length).trim() };
    const m = /^(.+?)\s+((?:extra|ultra|semi|demi)?\s?(?:thin|hairline|light|regular|book|medium|bold|heavy|black|italic|oblique)(?:\s+italic)?)$/i.exec(t);
    return m ? { family: m[1], style: m[2] } : { family: t, style: '' };
}

// Font controls: the installed-font picker (as in Text Design) + the styles that font really has. Only the name is
// written into the prompt; nothing is copied or installed. onChange(text, final).
function pbFontControls(value, onChange) {
    const cur = pbSplitFont(value);
    const fam = pbEl('input', 'pb-val pb-font-fam');
    fam.type = 'text'; fam.value = cur.family; fam.placeholder = 'font'; fam.spellcheck = false;
    fam.title = 'Click to pick an installed font, or type to filter';
    const sty = pbEl('select', 'pb-font-style');
    sty.title = 'Style';
    let style = cur.style;
    const fill = () => {
        const known = typeof fontStylesOf === 'function' ? fontStylesOf(fam.value.trim()) : null;
        const opts = (known && known.length) ? known.slice() : (typeof STYLE_OPTIONS !== 'undefined' ? STYLE_OPTIONS.slice() : []);
        if (known && known.length && style && !known.some(x => x.toLowerCase() === style.toLowerCase())) style = pickStyle(known, style);
        sty.textContent = '';
        const none = pbEl('option', '', '—'); none.value = ''; sty.appendChild(none);
        if (style && !opts.some(x => x.toLowerCase() === style.toLowerCase())) opts.unshift(style);
        for (const o of opts) { const e = pbEl('option', '', o); e.value = o; sty.appendChild(e); }
        sty.value = (opts.find(x => x.toLowerCase() === String(style).toLowerCase())) || '';
    };
    const text = () => [fam.value.trim(), style].filter(Boolean).join(' ');
    fill();
    fam.addEventListener('input', () => { fill(); onChange(text(), false); });
    fam.addEventListener('change', () => onChange(text(), true));
    sty.addEventListener('change', () => { style = sty.value; onChange(text(), true); });
    if (typeof bindFontPicker === 'function') bindFontPicker(fam);
    return [fam, sty];
}

// Colour names a prompt may already use, so the colour box shows them.
const PB_COLOUR_NAMES = {
    white: '#ffffff', black: '#000000', yellow: '#ffd400', gold: '#f5c542', orange: '#ff8a00', red: '#ff3b30',
    pink: '#ff4fa3', purple: '#8e5cf7', violet: '#8e5cf7', blue: '#2f7bff', teal: '#1fb5a8', cyan: '#00d1ff',
    green: '#34c759', grey: '#8e8e93', gray: '#8e8e93'
};
function pbTextColourHex(v) { return normHex(v) || PB_COLOUR_NAMES[String(v || '').trim().toLowerCase()] || null; }

// Colour controls: a colour box (macOS Colors panel / Windows Color dialog, like the Text Design swatches) + the hex
// code. Free text that is not a colour ("same as COLOR", "white") is kept as typed. onChange(text, final).
function pbColorControls(value, onChange) {
    const sw = pbEl('input', 'pb-color-sw');
    sw.type = 'color';
    sw.value = pbTextColourHex(value) || '#ffffff';
    sw.title = 'Pick a colour';
    const hex = pbEl('input', 'pb-val pb-color-hex');
    hex.type = 'text'; hex.value = value; hex.placeholder = '#ffffff'; hex.spellcheck = false;
    sw._hex = hex;        // attachHexFields() leaves this box alone: it has its own hex field
    sw.addEventListener('input', () => { hex.value = sw.value; onChange(sw.value, false); });
    sw.addEventListener('change', () => onChange(sw.value, true));
    hex.addEventListener('input', () => { const h = pbTextColourHex(hex.value); if (h) sw.value = h; onChange(hex.value, false); });
    hex.addEventListener('change', () => {
        const h = normHex(hex.value);
        if (h) hex.value = h;
        onChange(hex.value, true);
    });
    return [sw, hex];
}

function pbRowWriter(row) {
    return (text, final) => { row.value = text; pbChanged(); if (final) pbPushToPlacement(row); };
}

function pbFontEditor(row) {
    const wrap = pbEl('div', 'pb-font');
    wrap.append(...pbFontControls(row.value, pbRowWriter(row)));
    return wrap;
}

function pbColorEditor(row) {
    const wrap = pbEl('div', 'pb-color');
    wrap.append(...pbColorControls(row.value, pbRowWriter(row)));
    return wrap;
}

// Text-style rows (NORMAL, EMPHASIS): one or more font + colour pairs, each for Text+, MultiText or both:
// "Poppins Bold, #ffffff · Larken Black, #ffd400 (MultiText)". Anything else the line said (e.g. "— forced on DEFAULT
// presets only") moves into the row's note, so the value stays just the pairs.
const PB_STYLE_ON = [['both', 'Text+ & MultiText'], ['textplus', 'Text+'], ['multitext', 'MultiText']];
function pbParseStyle(v) {
    const t = String(v || '');
    const di = t.search(/\s[—–-]\s/);
    const head = di >= 0 ? t.slice(0, di) : t;
    const extra = [];
    if (di >= 0) extra.push(t.slice(di).replace(/^\s[—–-]\s/, '').trim());
    const pairs = [];
    let share = 100;
    const except = { tags: [], keep: 'both' };
    for (let chunk of head.split(/\s·\s|;/)) {
        chunk = chunk.trim();
        if (!chunk) continue;
        const sm = /^override\s+(\d{1,3})\s*%/i.exec(chunk);
        if (sm) { share = Math.max(0, Math.min(100, parseInt(sm[1], 10))); continue; }
        const em = /^except\s+(.*?)\s*(?:\(\s*keep\s+([^)]*)\))?\s*$/i.exec(chunk);
        if (em) {
            except.tags = em[1].split(',').map(x => x.trim()).filter(Boolean);
            const k = String(em[2] || '').toLowerCase();
            except.keep = /font/.test(k) && /colou?r/.test(k) ? 'both' : (/font/.test(k) ? 'font' : (/colou?r/.test(k) ? 'color' : 'both'));
            continue;
        }
        let on = 'both';
        const m = /\(([^)]*)\)\s*$/.exec(chunk);
        if (m) {
            const w = m[1].toLowerCase().replace(/\s+/g, '');
            const hit = /text\+.*multi|multi.*text\+|both|all/.test(w) ? 'both' : (/multi/.test(w) ? 'multitext' : (/text\+|textplus/.test(w) ? 'textplus' : null));
            if (hit) { on = hit; chunk = chunk.slice(0, m.index).trim(); }
        }
        const parts = chunk.split(',').map(x => x.trim());
        const pair = { font: parts.shift() || '', color: '', on };
        for (const p of parts) {
            const h = pbTextColourHex(p);
            if (!pair.color && h) pair.color = h;
            else if (p) extra.push(p);
        }
        pairs.push(pair);
    }
    if (!pairs.length) pairs.push({ font: '', color: '', on: 'both' });
    return { pairs, share, except, extra: extra.filter(Boolean).join(' — ') };
}
const PB_EXCEPT_KEEP = [['both', 'keep font & colour'], ['font', 'keep font'], ['color', 'keep colour']];
function pbJoinStyle(pairs, share, except) {
    const s = pairs.map(p => {
        const head = [p.font, p.color].filter(Boolean).join(', ');
        const on = (PB_STYLE_ON.find(o => o[0] === p.on) || PB_STYLE_ON[0]);
        return head && p.on !== 'both' ? head + ' (' + on[1] + ')' : head;
    }).filter(Boolean);
    if (share !== undefined && share !== null && share < 100) s.push('override ' + share + '%');
    if (except && except.tags && except.tags.length) {
        s.push('except ' + except.tags.join(', ') + ' (' + (PB_EXCEPT_KEEP.find(k => k[0] === except.keep) || PB_EXCEPT_KEEP[0])[1] + ')');
    }
    return s.join(' · ');
}

// The slider's words: 0% = every clip keeps the preset's default look, 100% = every clip gets the override.
function pbShareLabel(n) {
    if (n <= 0) return 'Preset default';
    if (n >= 100) return 'Always override';
    if (n === 50) return 'Balanced · 50%';
    return 'Override ' + n + '% · default ' + (100 - n) + '%';
}

function pbStyleEditor(row) {
    const st = pbParseStyle(row.value);
    const tidy = pbJoinStyle(st.pairs, st.share, st.except);
    if (tidy !== String(row.value || '').trim()) {
        if (st.extra) row.note = row.note ? row.note + '\n' + st.extra : st.extra;
        row.value = tidy;
        setTimeout(pbChanged, 0);
    }
    const write = (final) => { row.value = pbJoinStyle(st.pairs, st.share, st.except); pbChanged(); if (final) pbPushToPlacement(row); };
    const wrap = pbEl('div', 'pb-style');
    st.pairs.forEach((pair, i) => {
        const box = pbEl('div', 'pb-style-pair');
        const fontLine = pbEl('div', 'pb-style-line');
        const line = pbEl('div', 'pb-style-line');
        const on = pbEl('select', 'pb-style-on');
        on.title = 'Which presets this font and colour are for';
        for (const [v, label] of PB_STYLE_ON) { const o = pbEl('option', '', label); o.value = v; on.appendChild(o); }
        on.value = pair.on;
        on.addEventListener('change', () => { pair.on = on.value; write(true); });
        const add = pbEl('button', 'pb-mini pb-style-add', '+');
        add.title = 'Add another font + colour pair (e.g. one for Text+, one for MultiText)';
        add.addEventListener('click', () => {
            const used = st.pairs.map(p => p.on);
            const next = ['textplus', 'multitext'].find(x => !used.includes(x)) || 'both';
            st.pairs.splice(i + 1, 0, { font: pair.font, color: pair.color, on: next });
            if (pair.on === 'both' && next !== 'both') pair.on = next === 'multitext' ? 'textplus' : 'multitext';
            write(true); pbRebuild();
        });
        fontLine.append(...pbFontControls(pair.font, (t, f) => { pair.font = t; write(f); }));
        line.append(
            ...pbColorControls(pair.color, (t, f) => { const h = normHex(t); if (h || !t.trim()) { pair.color = h || ''; write(f); } }),
            on, add
        );
        if (st.pairs.length > 1) {
            const del = pbEl('button', 'pb-mini pb-del', '×');
            del.title = 'Remove this pair';
            del.addEventListener('click', () => { st.pairs.splice(i, 1); write(true); pbRebuild(); });
            line.appendChild(del);
        }
        box.append(fontLine, line);
        wrap.appendChild(box);
    });
    // How many of the clips get this override: left = the preset's default look, right = always the override.
    const sl = pbEl('div', 'pb-style-share');
    const cap = pbEl('span', 'pb-share-end', 'Default');
    const rng = pbEl('input', 'pb-share-range');
    rng.type = 'range'; rng.min = '0'; rng.max = '100'; rng.step = '5'; rng.value = String(st.share);
    rng.title = 'Share of the clips that get this font and colour; the rest keep the preset\'s default';
    const cap2 = pbEl('span', 'pb-share-end', 'Override');
    const lab = pbEl('span', 'pb-share-label', pbShareLabel(st.share));
    rng.addEventListener('input', () => { st.share = Number(rng.value); lab.textContent = pbShareLabel(st.share); write(false); });
    rng.addEventListener('change', () => write(true));
    sl.append(cap, rng, cap2, lab);
    wrap.appendChild(sl);
    wrap.appendChild(pbStyleExceptEl(st.except, write));
    return wrap;
}

// "Except presets tagged [chips] [keep font & colour | keep font | keep colour]": those presets skip this override.
function pbStyleExceptEl(ex, write) {
    const box = pbEl('div', 'pb-style-except');
    box.appendChild(pbEl('span', 'pb-share-end', 'Except tags'));
    const tags = pbTagNames();
    ex.tags.forEach((name, i) => {
        const chip = pbEl('span', 'pb-chip' + (tags.includes(name) ? '' : ' missing'));
        chip.title = tags.includes(name) ? 'Presets with this tag skip the override' : 'No tag with this name in your library';
        chip.appendChild(pbEl('span', '', name));
        const x = pbEl('button', 'pb-chip-x', '×');
        x.title = 'Remove';
        x.addEventListener('click', () => { ex.tags.splice(i, 1); write(true); pbRebuild(); });
        chip.appendChild(x);
        box.appendChild(chip);
    });
    const sel = pbEl('select', 'pb-chip-add');
    const ph = pbEl('option', '', '+ tag…'); ph.value = ''; sel.appendChild(ph);
    for (const n of tags.filter(n => !ex.tags.includes(n))) { const o = pbEl('option', '', n); o.value = n; sel.appendChild(o); }
    if (sel.options.length === 1) { ph.textContent = tags.length ? 'all tags added' : 'no tags yet'; sel.disabled = true; }
    sel.title = 'Presets with this tag skip the override';
    sel.addEventListener('change', () => { if (sel.value) { ex.tags.push(sel.value); write(true); pbRebuild(); } });
    box.appendChild(sel);
    if (ex.tags.length) {
        const keep = pbEl('select', 'pb-except-keep');
        keep.title = 'What the tagged presets keep of their own look; the rest of the override still applies to them';
        for (const [v, label] of PB_EXCEPT_KEEP) { const o = pbEl('option', '', label); o.value = v; keep.appendChild(o); }
        keep.value = ex.keep;
        keep.addEventListener('change', () => { ex.keep = keep.value; write(true); });
        box.appendChild(keep);
    }
    return box;
}

function pbValueEditor(row, kind) {
    if (kind === 'preset' || kind === 'tags') return pbChipsEditor(row, kind);
    if (kind === 'range') return pbRangeEditor(row);
    if (kind === 'audio') return pbAudioEditor(row);
    if (kind === 'highlight') return pbHighlightEditor(row);
    if (kind === 'font') return pbFontEditor(row);
    if (kind === 'color') return pbColorEditor(row);
    if (kind === 'style') return pbStyleEditor(row);
    if (kind === 'enum') {
        const sel = pbSelect('pb-val', (pbKeySpec(row.key) || {}).options || [], row.value);
        sel.addEventListener('change', () => { row.value = sel.value; pbChanged(); pbPushToPlacement(row); });
        return sel;
    }
    const inp = pbEl('input', 'pb-val');
    inp.type = 'text'; inp.value = row.value; inp.placeholder = 'value';
    inp.addEventListener('input', () => { row.value = inp.value; pbChanged(); });
    inp.addEventListener('change', () => pbPushToPlacement(row));
    return inp;
}

function pbRowEl(section, row, si, ri) {
    const kind = pbRowKind(row, section);
    const el = pbEl('div', 'pb-row');
    el.dataset.key = row.key;
    const main = pbEl('div', 'pb-row-main');
    let key;
    if (/COLOU?R/i.test(section.title) && row.sep === '→') key = pbColourKey(section, row);
    else {
        key = pbEl('input', 'pb-key');
        key.type = 'text'; key.value = row.key; key.spellcheck = false;
        key.setAttribute('list', 'pbKeyList');
        key.addEventListener('input', () => { row.key = key.value; pbChanged(); });
        // A key that switches the editor kind (e.g. typed TAG_MATCH) redraws when you leave it.
        key.addEventListener('change', () => { if (pbRowKind(row, section) !== kind) pbRebuild(); });
    }
    const sep = pbEl('button', 'pb-sep', row.sep);
    sep.title = 'Switch between "KEY: value" and "KEY → value"';
    sep.addEventListener('click', () => { row.sep = row.sep === ':' ? '→' : ':'; pbRebuild(); });
    const acts = pbEl('div', 'pb-acts');
    const ifb = pbEl('button', 'pb-mini', '+ if');
    ifb.title = 'Add a condition: if … → …';
    ifb.addEventListener('click', () => { row.conds.push({ if: '', then: '' }); pbRebuild(); pbFocusLast(si, ri, '.pb-cond-if'); });
    const nb = pbEl('button', 'pb-mini' + (row.note ? ' on' : ''), 'note');
    nb.title = 'Add a special note under this key';
    nb.addEventListener('click', () => {
        row._noteOpen = true; renderPromptBuilder(true); pbFocusLast(si, ri, '.pb-note');
    });
    const del = pbEl('button', 'pb-mini pb-del', '×');
    del.title = 'Remove this key';
    del.addEventListener('click', () => { section.rows.splice(ri, 1); pbRebuild(); });
    if (PB_PLACEMENT[row.key.trim()]) {
        const pl = pbEl('span', 'pb-link', '⇄ Placement');
        pl.title = 'Linked with the Placement settings (Use tab): change either one and the other follows';
        acts.appendChild(pl);
    }
    acts.append(ifb, nb, del);
    main.append(pbDragHandle(el, si, ri), key, sep, pbValueEditor(row, kind), acts);
    el.appendChild(main);

    if (row.note || row._noteOpen) {
        const n = pbEl('textarea', 'pb-note');
        n.rows = Math.max(1, String(row.note || '').split('\n').length);
        n.value = row.note || ''; n.placeholder = 'Special note for this key (one or more lines)';
        n.addEventListener('input', () => { row.note = n.value; n.rows = Math.max(1, n.value.split('\n').length); pbChanged(); });
        n.addEventListener('blur', () => { if (!n.value.trim()) { row._noteOpen = false; row.note = ''; pbRebuild(); } });
        el.appendChild(n);
    }
    row.conds.forEach((c, ci) => {
        const ce = pbEl('div', 'pb-cond');
        ce.appendChild(pbEl('span', 'pb-cond-word', 'if'));
        const a = pbEl('input', 'pb-cond-if');
        a.type = 'text'; a.value = c.if; a.placeholder = 'condition, e.g. the line mentions money';
        a.addEventListener('input', () => { c.if = a.value; pbChanged(); });
        ce.appendChild(a);
        ce.appendChild(pbEl('span', 'pb-cond-word', '→'));
        const b = pbEl('input', 'pb-cond-then');
        b.type = 'text'; b.value = c.then; b.placeholder = 'then (value, preset or action)';
        b.setAttribute('list', 'pbThenList');
        b.addEventListener('input', () => { c.then = b.value; pbChanged(); });
        ce.appendChild(b);
        const x = pbEl('button', 'pb-mini pb-del', '×');
        x.title = 'Remove this condition';
        x.addEventListener('click', () => { row.conds.splice(ci, 1); pbRebuild(); });
        ce.appendChild(x);
        el.appendChild(ce);
    });
    return el;
}

// ---------------------------------------------------------------- drag to reorder keys
// The handle at the left of a row drags that row (with its note and conditions) to another place, in the same
// section or another one. The row is only draggable while the handle is held, so text in its inputs stays selectable.
let pbDrag = null;   // { si, ri } of the row being dragged

function pbDragHandle(rowEl, si, ri) {
    const h = pbEl('span', 'pb-handle', '⋮⋮');
    h.title = 'Drag to move this key';
    h.addEventListener('mousedown', () => { rowEl.draggable = true; });
    h.addEventListener('mouseup', () => { rowEl.draggable = false; });
    rowEl.addEventListener('dragstart', (e) => {
        if (!rowEl.draggable) return;
        pbDrag = { si, ri };
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', ''); } catch (err) { /* ignore */ }
        requestAnimationFrame(() => rowEl.classList.add('pb-dragging'));
    });
    rowEl.addEventListener('dragend', () => {
        rowEl.draggable = false; pbDrag = null;
        rowEl.classList.remove('pb-dragging');
        pbClearDropMarks();
    });
    return h;
}

function pbClearDropMarks() {
    document.querySelectorAll('#promptBuilder .pb-drop-before, #promptBuilder .pb-drop-after')
        .forEach(x => x.classList.remove('pb-drop-before', 'pb-drop-after'));
}

// Where a drop at clientY lands: { si, ri } = insert before row ri of section si (ri may equal rows.length).
function pbDropTarget(e) {
    const secEl = e.target.closest && e.target.closest('#promptBuilder .pb-sec');
    if (!secEl) return null;
    const secs = [...document.querySelectorAll('#promptBuilder .pb-sec')];
    const si = secs.indexOf(secEl);
    const rows = [...secEl.querySelectorAll(':scope > .pb-row')];
    let ri = rows.length;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { ri = i; break; }
    }
    return { si, ri, rows };
}

function initPromptBuilderDrag() {
    const host = $('promptBuilder');
    if (!host) return;
    host.addEventListener('dragover', (e) => {
        if (!pbDrag) return;
        const t = pbDropTarget(e);
        if (!t) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        pbClearDropMarks();
        if (t.ri < t.rows.length) t.rows[t.ri].classList.add('pb-drop-before');
        else if (t.rows.length) t.rows[t.rows.length - 1].classList.add('pb-drop-after');
        else t.rows = null;
    });
    host.addEventListener('dragleave', (e) => { if (!host.contains(e.relatedTarget)) pbClearDropMarks(); });
    host.addEventListener('drop', (e) => {
        if (!pbDrag || !pb.doc) return;
        const t = pbDropTarget(e);
        pbClearDropMarks();
        if (!t) return;
        e.preventDefault();
        const from = pb.doc.sections[pbDrag.si], to = pb.doc.sections[t.si];
        if (!from || !to) return;
        let ri = t.ri;
        if (pbDrag.si === t.si && pbDrag.ri < ri) ri--;   // removing the row first shifts the ones after it
        if (pbDrag.si === t.si && ri === pbDrag.ri) return;
        const [row] = from.rows.splice(pbDrag.ri, 1);
        to.rows.splice(ri, 0, row);
        pbDrag = null;
        pbRebuild();
        const moved = document.querySelectorAll('#promptBuilder .pb-sec')[t.si];
        pbFlash(moved && moved.querySelectorAll(':scope > .pb-row')[ri]);
    });
}

function pbFocusLast(si, ri, sel) {
    const sec = document.querySelectorAll('#promptBuilder .pb-sec')[si];
    const row = sec && sec.querySelectorAll('.pb-row')[ri];
    const all = row ? row.querySelectorAll(sel) : [];
    if (all.length) all[all.length - 1].focus();
}

function pbFlash(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// The first Resolve clip colour no role in this section uses yet (upper case, as the rules write it).
function pbFreeColour(section) {
    const used = section.rows.map(r => r.key.trim().toLowerCase());
    const c = PB_CLIP_COLOURS.find(x => !used.includes(x[0].toLowerCase()));
    return (c ? c[0] : 'Orange').toUpperCase();
}

function pbSectionEl(section, si) {
    const el = pbEl('div', 'pb-sec');
    const head = pbEl('div', 'pb-sec-head');
    const title = pbEl('input', 'pb-sec-title');
    title.type = 'text'; title.value = section.title; title.spellcheck = false;
    title.addEventListener('input', () => { section.title = title.value; pbChanged(); });
    title.addEventListener('change', () => pbRebuild());   // PRESETS / COLOUR titles change the row editors
    const del = pbEl('button', 'pb-mini pb-del', '×');
    del.title = 'Remove this section';
    del.addEventListener('click', () => {
        if (section.rows.length && !confirm('Remove the section "' + section.title + '" and its ' + section.rows.length + ' keys?')) return;
        pb.doc.sections.splice(si, 1); pbRebuild();
    });
    head.append(title, del);
    el.appendChild(head);
    section.rows.forEach((r, ri) => el.appendChild(pbRowEl(section, r, si, ri)));
    const add = pbEl('button', 'pb-add-key', '+ Add key');
    add.addEventListener('click', () => {
        const colour = /COLOU?R/i.test(section.title);
        section.rows.push({ key: colour ? pbFreeColour(section) : 'NEW_KEY', sep: colour ? '→' : ':', value: '', note: '', conds: [] });
        pbRebuild();
        const sec = document.querySelectorAll('#promptBuilder .pb-sec')[si];
        const keys = sec ? sec.querySelectorAll('.pb-key') : [];
        const last = keys[keys.length - 1]; if (last) { last.focus(); last.select(); }
    });
    el.appendChild(add);
    return el;
}

// Shared suggestion lists for key / colour / "then" inputs.
function pbDatalists() {
    const host = $('pbLists');
    if (!host) return;
    host.innerHTML = '';
    const mk = (id, vals) => {
        const dl = document.createElement('datalist'); dl.id = id;
        for (const v of vals) { const o = document.createElement('option'); o.value = v; dl.appendChild(o); }
        host.appendChild(dl);
    };
    mk('pbKeyList', Object.keys(PB_CATALOG).filter(k => /^[A-Z_]+$/.test(k)));
    mk('pbColourList', PB_COLOURS);
    const roles = [];
    if (pb.doc) for (const s of pb.doc.sections) if (/^PRESETS\b/i.test(s.title)) for (const r of s.rows) roles.push(r.key);
    mk('pbThenList', roles.concat(pbPresetNames(), pbTagNames()));
}

// value: "group.item" of the entry to add; anything else (the Add button's click event) = the combobox's active entry
function pbAddFromMenu(value) {
    const v = typeof value === 'string' ? value : pbAddActive;
    if (!v) { const s = $('pbAddSearch'); if (s) s.focus(); return; }
    const [gi, ii] = String(v).split('.').map(Number);
    const g = PB_MCP_PARAMS[gi], it = g && g.items[ii];
    if (!it || !pb.doc) return;
    const secs = pb.doc.sections;
    if (it.newSection) {
        secs.push({ title: 'NEW SECTION', rows: [] });
        pbRebuild();
        const t = document.querySelectorAll('#promptBuilder .pb-sec-title');
        const last = t[t.length - 1]; if (last) { last.focus(); last.select(); }
        return;
    }
    let si = -1;
    if (it.section) {
        const word = it.section.split(/\s+\(/)[0].toUpperCase();
        si = secs.findIndex(s => s.title.toUpperCase().split(/\s+\(/)[0] === word || (word === 'COLOUR ROLES' && /COLOU?R/i.test(s.title)));
        if (si < 0) { secs.push({ title: it.section, rows: [] }); si = secs.length - 1; }
    } else {
        if (!secs.length) secs.push({ title: 'GENERAL', rows: [] });
        si = secs.length - 1;
    }
    const sec = secs[si];
    // A key that is already there is shown instead of added twice (colour roles and custom keys can repeat).
    const repeatable = it.sep === '→' || !it.section;
    const at = sec.rows.findIndex(r => r.key === it.key);
    if (at >= 0 && !repeatable) {
        renderPromptBuilder(true);
        pbFlash(document.querySelectorAll('#promptBuilder .pb-sec')[si].querySelectorAll('.pb-row')[at]);
        setPromptStatus(it.key + ' is already in ' + sec.title + '.', 'ok');
        return;
    }
    let key = it.key;
    if (repeatable && it.sep !== '→') { let n = 2; while (sec.rows.some(r => r.key === key)) key = it.key + '_' + n++; }
    if (it.sep === '→') key = pbFreeColour(sec);
    const fromPanel = pbPlacementValue(key);
    // a key with `after` goes right below that key when it is there (AUDIO_TRACK below CLIP_TRACK)
    let pos = sec.rows.length;
    if (it.after) {
        const ai = sec.rows.findIndex(r => r.key.trim() === it.after || (it.after === 'CLIP_TRACK' && r.key.trim() === 'TRACK_RANGE'));
        if (ai >= 0) pos = ai + 1;
    }
    sec.rows.splice(pos, 0, { key, sep: it.sep || ':', value: fromPanel != null ? fromPanel : (it.value || ''), note: '', conds: [] });
    pbRebuild();
    const rows = document.querySelectorAll('#promptBuilder .pb-sec')[si].querySelectorAll('.pb-row');
    const row = rows[pos];
    pbFlash(row);
    const f = row && row.querySelector('.pb-val, .pb-chip-add, .pb-key');
    if (f) f.focus();
}

// The "Add from MCP" combobox: a search box with the matching entries in a list that opens below it. Every word
// typed must appear in the entry's label, key, MCP call, section or hint (any order, case-insensitive).
// Click or Enter adds an entry; ↑ / ↓ move through the list; Esc closes it (a second Esc clears the search).
let pbAddActive = '';
function pbFillAddMenu() {
    const search = $('pbAddSearch'), list = $('pbAddList');
    if (!search || !list || list.dataset.ready) return;
    list.dataset.ready = '1';
    const itemOf = (v) => { const [gi, ii] = String(v).split('.').map(Number); return PB_MCP_PARAMS[gi] && PB_MCP_PARAMS[gi].items[ii]; };
    const hint = () => {
        const it = pbAddActive ? itemOf(pbAddActive) : null;
        $('pbAddHint').textContent = it ? (it.section ? '→ ' + it.section + (it.key && it.sep !== '→' ? ' / ' + it.key : '') + '. ' : '') + (it.hint || '') : '';
    };
    const opts = () => [...list.querySelectorAll('.pb-combo-opt')];
    const setActive = (v, scroll) => {
        pbAddActive = v || '';
        for (const o of opts()) {
            const on = o.dataset.value === pbAddActive;
            o.classList.toggle('active', on);
            o.setAttribute('aria-selected', on ? 'true' : 'false');
            if (on && scroll) o.scrollIntoView({ block: 'nearest' });
        }
        hint();
    };
    const open = (on) => {
        list.classList.toggle('hidden', !on);
        search.setAttribute('aria-expanded', on ? 'true' : 'false');
    };
    const fill = () => {
        const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
        list.innerHTML = '';
        PB_MCP_PARAMS.forEach((g, gi) => {
            const hits = [];
            g.items.forEach((it, ii) => {
                const hay = [it.label, it.key, g.tool, it.section, it.hint].filter(Boolean).join(' ').toLowerCase();
                if (!words.some(w => !hay.includes(w))) hits.push([it, ii]);
            });
            if (!hits.length) return;
            list.appendChild(pbEl('div', 'pb-combo-group', g.tool === 'custom' ? 'Custom' : g.tool));
            for (const [it, ii] of hits) {
                const o = pbEl('div', 'pb-combo-opt', it.label);
                o.dataset.value = gi + '.' + ii;
                o.setAttribute('role', 'option');
                if (it.key) o.appendChild(pbEl('span', 'pb-combo-key', it.key));
                list.appendChild(o);
            }
        });
        const all = opts();
        if (!all.length) list.appendChild(pbEl('div', 'pb-combo-empty', 'No match for "' + search.value.trim() + '"'));
        setActive(all.some(o => o.dataset.value === pbAddActive) ? pbAddActive : (all[0] ? all[0].dataset.value : ''), true);
    };
    const add = (v) => { open(false); search.value = ''; pbAddFromMenu(v); fill(); };

    search.addEventListener('focus', () => { fill(); open(true); });
    search.addEventListener('click', () => open(true));
    search.addEventListener('input', () => { fill(); open(true); });
    search.addEventListener('blur', () => open(false));
    search.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (list.classList.contains('hidden')) { open(true); return; }
            const all = opts(), i = all.findIndex(o => o.dataset.value === pbAddActive);
            const next = all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
            if (next) setActive(next.dataset.value, true);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (pbAddActive) add(pbAddActive);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (!list.classList.contains('hidden')) open(false);
            else if (search.value) { search.value = ''; fill(); }
        }
    });
    // mousedown, not click: keeps the focus in the search box so blur doesn't close the list first
    list.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const o = e.target.closest('.pb-combo-opt');
        if (o) add(o.dataset.value);
    });
    list.addEventListener('mousemove', (e) => {
        const o = e.target.closest('.pb-combo-opt');
        if (o && o.dataset.value !== pbAddActive) setActive(o.dataset.value, false);
    });
    fill();
}

// Draw the builder from pb.doc. keep = keep the parsed doc (it is already current); otherwise re-parse pb.full.
function renderPromptBuilder(keep) {
    const host = $('promptBuilder');
    if (!host) return;
    if (!keep || !pb.doc) pb.doc = parseJobPrompt(pb.full);
    pbDatalists();
    host.innerHTML = '';
    if (!pb.doc) {
        const e = pbEl('div', 'pb-empty', 'This prompt has no "## SETTINGS" section. ');
        const b = pbEl('button', 'ghost', 'Add one');
        b.addEventListener('click', () => {
            pb.full = '## SETTINGS  (edit here; the rules below refer to these names)\n\nJOB\n  TIMELINE:        "<timeline name>"\n\n' + pb.full;
            saveJobPrompt(pb.full); applyPromptMode();
        });
        e.appendChild(b);
        host.appendChild(e);
        return;
    }
    pb.doc.sections.forEach((s, si) => host.appendChild(pbSectionEl(s, si)));
    const ta = $('promptText');
    if (ta && pb.mode === 'builder' && document.activeElement !== ta) { ta.value = pb.doc.post; renderPromptHilite(); }
}

// The library changed (presets added, renamed, tagged): redraw the chips unless the user is typing in the builder.
function refreshPromptPresets() {
    const host = $('promptBuilder');
    if (!host || pb.mode !== 'builder' || !pb.doc) return;
    if (host.contains(document.activeElement)) { pbDatalists(); return; }
    renderPromptBuilder(true);
}

// ---------------------------------------------------------------- highlighting
// Keys and headings bold, values coloured, comments dimmed. Line based, so it survives any edit the user makes.
function escPrompt(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Inside a value: "(comment)" and "→ note" parts dimmed, the rest coloured.
function hlPromptValue(v) {
    const e = escPrompt(v);
    return '<span class="pr-val">' + e
        .replace(/\([^()]*\)/g, m => '</span><span class="pr-cm">' + m + '</span><span class="pr-val">')
        .replace(/(→|—)\s[^(]*$/, m => '</span><span class="pr-cm">' + m + '</span><span class="pr-val">') + '</span>';
}

// Inside rule text: SETTINGS names (SIZE_MIN, LINE_SPACING_LONG, DEFAULT ...) stand out.
function hlPromptRefs(t) {
    return escPrompt(t).replace(/\b([A-Z][A-Z0-9_]{2,}(?:–[A-Z][A-Z0-9_]{2,})?)\b/g, '<span class="pr-ref">$1</span>');
}

function hlPromptLine(line) {
    if (!line.trim()) return '';
    let m;
    if (/^\s*#/.test(line)) return '<span class="pr-h">' + escPrompt(line) + '</span>';
    // "  KEY:   value"  (keys are upper-case words / underscores, may end with a parenthesised note)
    if ((m = line.match(/^(\s*)([A-Z][A-Z0-9_]*(?:\s*\([^)]*\))?):(\s*)(.*)$/))) {
        return escPrompt(m[1]) + '<span class="pr-key">' + escPrompt(m[2] + ':') + '</span>' + escPrompt(m[3]) + hlPromptValue(m[4]);
    }
    // "  ORANGE → vibe presets"  and  "  Risk, problem ... → DANGER"
    if ((m = line.match(/^(\s*)(.*?)(\s*→\s*)(.*)$/))) {
        const left = /^[A-Z][A-Z0-9_ ]*$/.test(m[2].trim()) ? '<span class="pr-key">' + escPrompt(m[2]) + '</span>' : hlPromptRefs(m[2]);
        return escPrompt(m[1]) + left + '<span class="pr-cm">' + escPrompt(m[3]) + '</span>' + hlPromptValue(m[4]);
    }
    // Section labels: a line that is only upper-case words (optionally with a parenthesised note)
    if (/^[A-Z][A-Z0-9_ ]*(\s*\([^)]*\))?\s*$/.test(line)) return '<span class="pr-sec">' + escPrompt(line) + '</span>';
    // Rule sub-headings: "Vibe (ORANGE)", "Stacks (VIOLET)", numbered steps
    if (/^[A-Z][a-z].*\([A-Z][A-Z, ]*\)\s*$/.test(line) || /^\d+\.\s/.test(line)) return '<span class="pr-key">' + hlPromptRefs(line) + '</span>';
    return hlPromptRefs(line);
}

function renderPromptHilite() {
    const ta = $('promptText'), pre = $('promptHilite');
    if (!ta || !pre) return;
    // A trailing newline needs a visible last line so the heights match.
    pre.innerHTML = ta.value.split('\n').map(hlPromptLine).join('\n') + (ta.value.endsWith('\n') ? ' ' : '');
    pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft;
}

function setPromptStatus(msg, kind) {
    const el = $('promptStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
    if (msg) setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.className = 'status'; } }, 2500);
}

async function copyJobPrompt() {
    const text = pb.full;
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
    if (!ok) {
        // Fallback: put the whole prompt in a hidden text box and use the old copy command.
        try {
            const t = document.createElement('textarea');
            t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
            document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove();
        } catch (e) { ok = false; }
    }
    setPromptStatus(ok ? 'Copied. Paste it into Claude.' : 'Could not copy. Switch to Text, select it and press Cmd+C.', ok ? 'ok' : 'bad');
}

// "edited" shows while the text differs from the default Reset would restore; "Restore built-in" only when a user
// default exists.
function refreshPromptFlags() {
    const ed = $('promptEdited'); if (ed) ed.classList.toggle('hidden', pb.full === effectiveJobPromptDefault());
    const bi = $('promptBuiltIn'); if (bi) bi.classList.toggle('hidden', !userJobPromptDefault());
}

// Builder: the SETTINGS block as rows, the text box holds only the rules after it. Text: the whole prompt as text.
function applyPromptMode() {
    const builder = pb.mode === 'builder';
    $('promptModeBuilder').classList.toggle('on', builder);
    $('promptModeText').classList.toggle('on', !builder);
    $('promptBuilderWrap').classList.toggle('hidden', !builder);
    $('tabPrompt').classList.toggle('pr-mode-text', !builder);
    $('promptRulesLabel').classList.toggle('hidden', !builder);
    const ta = $('promptText');
    pb.doc = null;
    if (builder) {
        renderPromptBuilder(false);
        ta.value = pb.doc ? pb.doc.post : '';
        ta.disabled = !pb.doc;
    } else {
        ta.disabled = false;
        ta.value = pb.full;
    }
    renderPromptHilite();
    refreshPromptFlags();
}

function setJobPromptText(text) {
    pb.full = text;
    saveJobPrompt(text);
    applyPromptMode();
}

// ---------------------------------------------------------------- saved prompts
// Prompts the user saved under a title, stored exactly as they were. The dropdown lists "Default" first (the
// prompt Reset restores), then each saved title. Picking one loads its text as the current prompt.
const SAVED_PROMPTS_KEY = 'sa.savedPrompts';
const SAVED_DEFAULT_VALUE = '__default__';
// The saved prompt last opened (or saved), so the dropdown shows it again when the panel reopens.
const SAVED_PROMPT_LAST_KEY = 'sa.savedPromptLast';

function rememberSavedPrompt(title) {
    try { if (title) localStorage.setItem(SAVED_PROMPT_LAST_KEY, title); else localStorage.removeItem(SAVED_PROMPT_LAST_KEY); } catch (e) { /* ignore */ }
}

function lastSavedPrompt() {
    try { return localStorage.getItem(SAVED_PROMPT_LAST_KEY) || null; } catch (e) { return null; }
}

function loadSavedPrompts() {
    try {
        const a = JSON.parse(localStorage.getItem(SAVED_PROMPTS_KEY) || '[]');
        if (Array.isArray(a)) return a.filter(p => p && typeof p.title === 'string' && typeof p.text === 'string');
    } catch (e) { /* ignore */ }
    return [];
}

function storeSavedPrompts(list) {
    try { localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
}

// Fill the dropdown; select = the title to show selected (or the Default entry).
function renderSavedPrompts(select) {
    const sel = $('promptSavedSel');
    if (!sel) return;
    sel.innerHTML = '';
    const def = document.createElement('option');
    def.value = SAVED_DEFAULT_VALUE;
    def.textContent = 'Default';
    sel.appendChild(def);
    loadSavedPrompts().forEach(p => {
        const o = document.createElement('option');
        o.value = p.title; o.textContent = p.title;
        sel.appendChild(o);
    });
    sel.value = select && [...sel.options].some(o => o.value === select) ? select : SAVED_DEFAULT_VALUE;
    $('promptSavedDelete').disabled = sel.value === SAVED_DEFAULT_VALUE;
}

// Snack bar at the bottom of the panel ("<title> · Saved"), same look as the preset save toast.
function showPromptToast(name, what) {
    document.querySelectorAll('.saved-toast').forEach(x => x.remove());
    const t = document.createElement('div');
    t.className = 'saved-toast';
    const n = document.createElement('b'); n.textContent = name;
    t.append(n, document.createTextNode(' · ' + what));
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3000);
}

function initSavedPrompts() {
    const sel = $('promptSavedSel'), title = $('promptSavedTitle');
    if (!sel || !title) return;
    renderSavedPrompts(lastSavedPrompt());
    const toggle = $('promptSavedToggle'), edit = $('promptSavedEdit');
    if (toggle && edit) {
        toggle.addEventListener('click', () => {
            const open = edit.classList.toggle('hidden') === false;
            toggle.classList.toggle('on', open);
            toggle.setAttribute('aria-expanded', String(open));
            if (open) title.focus();
        });
    }
    sel.addEventListener('change', () => {
        clearTimeout(pbSaveTimer);
        $('promptSavedDelete').disabled = sel.value === SAVED_DEFAULT_VALUE;
        rememberSavedPrompt(sel.value === SAVED_DEFAULT_VALUE ? null : sel.value);
        if (sel.value === SAVED_DEFAULT_VALUE) {
            title.value = '';
            setJobPromptText(effectiveJobPromptDefault());
            setPromptStatus('Loaded the default prompt.', 'ok');
            return;
        }
        const p = loadSavedPrompts().find(x => x.title === sel.value);
        if (!p) return;
        title.value = p.title;
        setJobPromptText(p.text);
        setPromptStatus('Loaded "' + p.title + '".', 'ok');
    });
    const save = () => {
        clearTimeout(pbSaveTimer);
        const t = title.value.trim();
        if (!t) { setPromptStatus('Type a title first.', 'bad'); title.focus(); return; }
        if (t.toLowerCase() === 'default') { setPromptStatus('"Default" is taken; use Save as default for that.', 'bad'); return; }
        const list = loadSavedPrompts();
        const i = list.findIndex(x => x.title === t);
        if (i >= 0) list[i].text = pb.full; else list.push({ title: t, text: pb.full });
        if (!storeSavedPrompts(list)) { setPromptStatus('Could not save the prompt.', 'bad'); return; }
        saveJobPrompt(pb.full);
        rememberSavedPrompt(t);
        renderSavedPrompts(t);
        title.value = '';
        setPromptStatus((i >= 0 ? 'Updated "' : 'Saved "') + t + '".', 'ok');
        showPromptToast(t, i >= 0 ? 'Updated' : 'Saved');
    };
    $('promptSavedSave').addEventListener('click', save);
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    $('promptSavedDelete').addEventListener('click', () => {
        const t = sel.value;
        if (t === SAVED_DEFAULT_VALUE) return;
        storeSavedPrompts(loadSavedPrompts().filter(x => x.title !== t));
        if (lastSavedPrompt() === t) rememberSavedPrompt(null);
        title.value = '';
        renderSavedPrompts(null);
        setPromptStatus('Deleted "' + t + '". The current prompt is unchanged.', 'ok');
        showPromptToast(t, 'Deleted');
    });
    takePromptInbox();
    window.addEventListener('focus', () => takePromptInbox());
}

// Prompts handed over through <library>/prompt-inbox.json (e.g. Claude Code updating the "Tommy" prompt): each is
// saved under its title (replacing a saved prompt of that title), and the one marked load becomes the current prompt.
let inboxBusy = false;
async function takePromptInbox() {
    if (inboxBusy || !window.sa || !window.sa.takePromptInbox) return;
    inboxBusy = true;
    try {
        const got = await window.sa.takePromptInbox();
        if (!Array.isArray(got) || !got.length) return;
        const list = loadSavedPrompts();
        let loaded = null;
        for (const p of got) {
            if (p.title.toLowerCase() === 'default') continue;
            const i = list.findIndex(x => x.title === p.title);
            if (i >= 0) list[i].text = p.text; else list.push({ title: p.title, text: p.text });
            if (p.load) loaded = p;
        }
        if (!storeSavedPrompts(list)) { setPromptStatus('Could not save the prompt from the inbox.', 'bad'); return; }
        if (loaded) {
            clearTimeout(pbSaveTimer);
            rememberSavedPrompt(loaded.title);
            setJobPromptText(loaded.text);
        }
        renderSavedPrompts(loaded ? loaded.title : lastSavedPrompt());
        const names = got.map(p => p.title).join(', ');
        setPromptStatus('Updated "' + names + '" from the prompt inbox.', 'ok');
        showPromptToast(names, 'Updated');
    } catch (e) { /* ignore */ } finally { inboxBusy = false; }
}

// Hovering a one-line input whose text is cut off shows the whole value in a tooltip, wrapped to the input's width.
function initPromptInputTips(root) {
    const tip = document.createElement('div');
    tip.className = 'pr-input-tip hidden';
    document.body.appendChild(tip);
    let cur = null;
    const isTextInput = (el) => el && el.tagName === 'INPUT' && (!el.type || el.type === 'text' || el.type === 'search');
    const hide = () => { cur = null; tip.classList.add('hidden'); };
    const show = (el) => {
        cur = el;
        if (!el.value || el.scrollWidth <= el.clientWidth + 1) { tip.classList.add('hidden'); return; }
        const r = el.getBoundingClientRect();
        tip.textContent = el.value;
        tip.style.width = Math.max(r.width, 120) + 'px';
        tip.style.left = Math.min(r.left, window.innerWidth - Math.max(r.width, 120) - 4) + 'px';
        tip.style.top = '0px';
        tip.classList.remove('hidden');
        const h = tip.offsetHeight;
        // Below the input, or above it when there is no room underneath.
        tip.style.top = (r.bottom + 4 + h > window.innerHeight ? Math.max(4, r.top - 4 - h) : r.bottom + 4) + 'px';
    };
    root.addEventListener('mouseover', (e) => { if (isTextInput(e.target)) show(e.target); });
    root.addEventListener('mouseout', (e) => { if (e.target === cur && !cur.contains(e.relatedTarget)) hide(); });
    root.addEventListener('input', (e) => { if (e.target === cur) show(cur); });
    root.addEventListener('scroll', hide, true);
    root.addEventListener('mousedown', (e) => { if (e.target !== cur) hide(); });
}

// Once per panel: prompts saved before SUBTITLE TRIMMING existed (the current prompt, the user's default and every
// saved prompt) get the section added at the end of their SETTINGS block. Only that text is inserted; the rest of
// each prompt stays exactly as it was.
const TRIMMING_MIGRATED_KEY = 'sa.migrated.subtitleTrimming';
const TRIMMING_SECTION = [
    'SUBTITLE TRIMMING',
    '  WORDS_PER_BLOCK: 1–3',
    '                   words per subtitle block when chopping an .srt (chop_srt minWords / maxWords)',
    '  CHARS_PER_BLOCK: 1–20',
    '                   characters per block, spaces included (chop_srt minChars / maxChars)',
    '                   both limits apply together: a block over either is cut smaller (e.g. 2 + 1 words)'
].join('\n');

function withTrimmingSection(text) {
    const lines = String(text || '').split('\n');
    const si = lines.findIndex(l => /^##\s+SETTINGS\b/i.test(l));
    if (si < 0 || /^SUBTITLE TRIMMING\b/im.test(text)) return text;
    let ei = lines.findIndex((l, i) => i > si && /^##\s/.test(l));
    if (ei < 0) ei = lines.length;
    let at = ei;
    while (at > si + 1 && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, '', TRIMMING_SECTION, ...(at === ei && at < lines.length ? [''] : []));
    return lines.join('\n');
}

function migrateTrimmingSection() {
    try {
        if (localStorage.getItem(TRIMMING_MIGRATED_KEY)) return;
        for (const key of [JOB_PROMPT_KEY, JOB_PROMPT_DEFAULT_KEY]) {
            const t = localStorage.getItem(key);
            if (t && t.trim()) localStorage.setItem(key, withTrimmingSection(t));
        }
        const saved = loadSavedPrompts();
        if (saved.length) storeSavedPrompts(saved.map(p => Object.assign({}, p, { text: withTrimmingSection(p.text) })));
        localStorage.setItem(TRIMMING_MIGRATED_KEY, '1');
    } catch (e) { /* ignore */ }
}

// Once per panel: prompts saved before HIGHLIGHT_BOX existed get the row under EMPHASIS in TEXT STYLE, with
// auto-balance on (the user asked for balanced spacing around highlights in their prompts by default).
const HIGHLIGHT_MIGRATED_KEY = 'sa.migrated.highlightBox';
function withHighlightRow(text) {
    const lines = String(text || '').split('\n');
    const si = lines.findIndex(l => /^##\s+SETTINGS\b/i.test(l));
    if (si < 0 || /^\s+HIGHLIGHT_BOX\s*:/m.test(text)) return text;
    let ei = lines.findIndex((l, i) => i > si && /^##\s/.test(l));
    if (ei < 0) ei = lines.length;
    const ts = lines.findIndex((l, i) => i > si && i < ei && /^TEXT STYLE\b/.test(l));
    if (ts < 0) return text;
    let at = ts + 1, em = -1;
    for (; at < ei && /^\s/.test(lines[at]); at++) if (/^\s{1,3}EMPHASIS\s*:/.test(lines[at])) em = at;
    if (em >= 0) { at = em + 1; while (at < ei && /^\s{4,}\S/.test(lines[at])) at++; }
    else { while (at > ts + 1 && !lines[at - 1].trim()) at--; }
    lines.splice(at, 0, '  HIGHLIGHT_BOX: auto · width 1.00 · height 1.00 · x 0.000 · y 0.000', '            ' + HIGHLIGHT_NOTE);
    return lines.join('\n');
}
function migrateHighlightRow() {
    try {
        if (localStorage.getItem(HIGHLIGHT_MIGRATED_KEY)) return;
        for (const key of [JOB_PROMPT_KEY, JOB_PROMPT_DEFAULT_KEY]) {
            const t = localStorage.getItem(key);
            if (t && t.trim()) localStorage.setItem(key, withHighlightRow(t));
        }
        const saved = loadSavedPrompts();
        if (saved.length) storeSavedPrompts(saved.map(p => Object.assign({}, p, { text: withHighlightRow(p.text) })));
        localStorage.setItem(HIGHLIGHT_MIGRATED_KEY, '1');
    } catch (e) { /* ignore */ }
}

function initPromptTab() {
    const ta = $('promptText');
    if (!ta) return;
    migrateTrimmingSection();
    migrateHighlightRow();
    initPromptInputTips($('tabPrompt'));
    initPromptBuilderDrag();
    initSavedPrompts();
    pb.full = loadJobPrompt();
    mirrorJobPromptToFile(pb.full);
    try { if (localStorage.getItem(JOB_PROMPT_MODE_KEY) === 'text') pb.mode = 'text'; } catch (e) { /* ignore */ }
    pbFillAddMenu();
    $('pbAddBtn').addEventListener('click', pbAddFromMenu);
    const setMode = (m) => {
        pb.mode = m;
        try { localStorage.setItem(JOB_PROMPT_MODE_KEY, m); } catch (e) { /* ignore */ }
        applyPromptMode();
    };
    $('promptModeBuilder').addEventListener('click', () => setMode('builder'));
    $('promptModeText').addEventListener('click', () => setMode('text'));
    applyPromptMode();

    ta.addEventListener('input', () => {
        renderPromptHilite();
        if (pb.mode === 'builder' && pb.doc) { pb.doc.post = ta.value; pb.full = serializeJobPrompt(pb.doc); } else pb.full = ta.value;
        pbSave();
    });
    ta.addEventListener('scroll', () => { const pre = $('promptHilite'); if (pre) { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; } });
    $('promptCopy').addEventListener('click', copyJobPrompt);
    $('promptSaveDefault').addEventListener('click', () => {
        clearTimeout(pbSaveTimer);
        saveJobPromptDefault(pb.full);
        saveJobPrompt(pb.full);
        refreshPromptFlags();
        setPromptStatus(userJobPromptDefault() ? 'Saved as your default.' : 'Same as the built-in prompt, so that is the default.', 'ok');
    });
    $('promptReset').addEventListener('click', () => {
        clearTimeout(pbSaveTimer);
        setJobPromptText(effectiveJobPromptDefault());
        setPromptStatus(userJobPromptDefault() ? 'Back to your default.' : 'Back to the built-in prompt.', 'ok');
    });
    $('promptBuiltIn').addEventListener('click', () => {
        clearTimeout(pbSaveTimer);
        saveJobPromptDefault(null);
        setJobPromptText(DEFAULT_JOB_PROMPT);
        setPromptStatus('Built-in prompt restored; your saved default was removed.', 'ok');
    });
}
