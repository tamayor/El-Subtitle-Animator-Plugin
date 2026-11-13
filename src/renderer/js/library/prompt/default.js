// Prompt tab: the job prompt for Claude (El Subtitle Animator MCP), editable in the panel with a Copy button.
// The SETTINGS block at the top of the prompt is what changes per video; the rules below it refer to those names.
// Builder mode shows SETTINGS as sections of key rows (each with its own input, "+ if" conditions and a note),
// preset keys pick from the library, and the bottom menu adds keys for the MCP call parameters. Text mode edits
// the whole prompt as plain text; both write the same text.
// Edits are kept in localStorage and mirrored to <library>/job-prompt.md (read by the /elsa-prompt command). "Save as default" stores the current text as the user's own
// default; Reset goes back to that (or to the built-in text when none is saved); "Restore built-in" drops it.

const JOB_PROMPT_KEY = 'sa.jobPrompt';
const JOB_PROMPT_DEFAULT_KEY = 'sa.jobPromptDefault';

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
    { const s = store.get(JOB_PROMPT_DEFAULT_KEY); if (s && s.trim()) return s; }
    return null;
}

// What Reset goes back to.
function effectiveJobPromptDefault() {
    return userJobPromptDefault() || DEFAULT_JOB_PROMPT;
}

function loadJobPrompt() {
    { const s = store.get(JOB_PROMPT_KEY); if (s && s.trim()) return s; }
    return effectiveJobPromptDefault();
}

function saveJobPrompt(text) {
    mirrorJobPromptToFile(text);
    if (text === effectiveJobPromptDefault()) store.remove(JOB_PROMPT_KEY); else store.set(JOB_PROMPT_KEY, text);
}

// Also written to job-prompt.md in the library folder so Claude Code's /elsa-prompt command can read it.
function mirrorJobPromptToFile(text) {
    try { if (window.sa && window.sa.saveJobPromptFile) window.sa.saveJobPromptFile(String(text || '')); } catch (e) { /* ignore */ }
}

function saveJobPromptDefault(text) {
    if (text === null || text === DEFAULT_JOB_PROMPT) store.remove(JOB_PROMPT_DEFAULT_KEY); else store.set(JOB_PROMPT_DEFAULT_KEY, text);
}
