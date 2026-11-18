---
name: framelly-prompt-auto
description: Auto mode for Framelly. Reads the Prompt tab's job prompt for its settings, style and allowed presets, but instead of following clip colours it picks which subtitles to animate (default 60%) and which treatment each gets. Use when the user types /framelly-prompt-auto.
argument-hint: "[percent, default 60] [extra instructions, e.g. tracks 3-5, skip first 10 subtitles]"
---

Automated version of /framelly-prompt. The user does NOT colour-code the subtitles first; you decide.

## 1. Load the prompt

Read the job prompt saved by the panel's Prompt tab:

`{{JOB_PROMPT}}`

If it is missing, tell the user to open the Framelly panel and click the Prompt tab once (which writes the file), then stop.

Take from it, and obey exactly as written:
- **SETTINGS**: JOB (timeline, scope, PLAN_THRESHOLD), SIZE, POSITION, PRESETS, TEXT STYLE, SUBTITLE TRIMMING.
- **BEFORE PLACING**, **RULES** (Vibe, Long sentences, Stacks, Sizing, Placement) and **REPORT**.

Ignore from it:
- **COLOUR ROLES** and every "stop if a colour is missing / never place on an uncoloured subtitle" check. In auto mode clip colours are not required. If some subtitles *are* coloured, treat the colour as a hint for that subtitle's treatment, not as a gate.

Arguments: `$ARGUMENTS`
- A leading number (e.g. `60`, `45%`) is COVERAGE, the share of subtitles to animate. Default **60**.
- Anything else is extra instructions for this run; they override the saved prompt where they conflict (a track range named here beats the panel's and the prompt's).

## 2. Set up

Follow the framelly MCP workflow: `get_rules` first, `status` / `get_layout` (layout must apply to this timeline), `set_rules` from SETTINGS (HIGHLIGHT_BOX → `highlight` {auto, width, height, x, y}: `auto` = balanced padding around the highlight box / pill, the rest are the panel's slider values) then `get_rules` to confirm, `list_presets` (only these presets may ever be used, and only the ones the prompt's PRESETS section names), `list_subtitles` with color "any".

## 2b. Trim the active subtitles (SUBTITLE TRIMMING)

Always do this step before choosing. It applies the prompt's SUBTITLE TRIMMING limits (WORDS_PER_BLOCK, CHARS_PER_BLOCK; default 1–3 words, 1–20 characters, both at once) to the timeline subtitles, the same way `chop_srt` does for an .srt file.

**Active subtitles only.** Work only on subtitle clips that are still enabled on the current timeline (fetch it by name, see the "Resolve scripts pin the timeline" memory). Placing a clip disables its subtitle, so a disabled subtitle already has an animation: never trim, regroup or re-place it. Get the enabled ones from `list_subtitles` with `activeOnly: true` (each row also has `enabled`; no Resolve script needed). A trim group is a run of consecutive **active** subtitles. Never pull a word in from a disabled neighbour. If a run starts or ends mid-thought because its neighbour is already animated, leave that edge word as it is ("But", "reported in", "then") and note it in the report.

**How it reaches the timeline.** The Resolve API cannot edit subtitle text. Trimmed phrases therefore become the animated clips: call `regroup` with the run's subtitle numbers and your phrases, then `place` each phrase with its `text`, anchor `subtitle`, `startFrame` and `endFrame`. `regroup` needs the phrases to spell the subtitles' words in order. Pass it the original words, and put any ASR / spelling / `$` fix only in place's `text`. Active subtitles you don't animate keep Resolve's text and cuts (list them in the report).

**Chopping rules** (obey all of them, with the limits above):
1. Transcription correction: fix ASR/transcription errors, misspellings, and technical and company names. Never rewrite the speaker's thought structure, grammar or phrasing style.
2. Contextual flow: chop or group by natural sentence flow, punctuation and spoken context. Keep related phrases together.
3. Length: max WORDS_PER_BLOCK words and CHARS_PER_BLOCK characters (spaces included) per block, 1–2 words allowed when context needs it. A very long word gets a short line of its own rather than sharing one.
4. Currency: always a currency symbol before a number that means money ("13K dollars" → "$13K").
5. Natural pauses: breaks fall on natural spoken pauses.
6. Single line: exactly one line per block, no "\n" inside a trimmed phrase.
7. Key emphasis: a core metric, critical point or dramatic phrase goes alone in its own block.
8. Median timing cuts: split longer phrases into separate sequential blocks ("that they are spending about $13K per month" → "that they are" / "spending about" / "$13K per month"); `regroup` works out the median frames.
9. Semantic grouping and fillers:
   - Never split a core metric, money value or time frame ("$1K per month" stays whole, even past the limits).
   - Fillers, rhetorical questions and transition words ("right?", "okay?", "yep") go alone in their own block.
   - A complete thought or related phrase together beats the minimum word count.
10. Prepositions and modifiers: keep prepositions and articles with the noun they introduce ("a surplus of" stays together). Start a new block for the metric after it ("a surplus of" / "$1K per month"). Never end a block on a hanging preposition ("of", "in", "to", "for") unless it belongs to a fixed phrase.
11. Conjunctions: keep the conjunction with the second option ("in investment" / "or insurance"). Never end a block on "or", "and" or "but". Never separate a modifier from its noun ("At least" / "three months" is fine; "At" / "least three months" is not). Keep common phrases whole ("a lot of them", "don't even have").
12. Subject and action: the subject and its modifiers form one block ("These things"). The verb phrase starts the next ("we can't review"). Never split a pronoun from its verb ("we can't" stays together).

Show the trim in the plan (step 5) as: subtitle #s → trimmed phrases. After trimming, every phrase is 1–3 words, so LONG / WORDS_PER_LINE line breaks normally don't apply. Use STACK for consecutive trimmed phrases that build one thought, when that reads better than single clips.

## 3. Choose what to animate (COVERAGE %)

In auto mode the units are the trimmed phrases from step 2b, taken from active subtitles only. COVERAGE % is counted on the active subtitles in SCOPE.

Read the whole subtitle list as a script first. Then pick about COVERAGE % of the subtitles in SCOPE to animate (round to the nearest subtitle; e.g. 40 subtitles at 60% → 24). Leave the rest as plain subtitles.

Pick the subtitles that carry the message; skip filler. In priority order:
0. Kinetic statements, when the prompt's KINETIC STATEMENTS section has USE_KINETIC true: every subtitle matching KINETIC_FOR gets the KINETIC preset, and they count toward COVERAGE. List the matches you found before placing, as the prompt says.
1. Lines with a clear keyword to emphasise: a claim, a number, a price, a name, a verdict, a contrast ("not X, Y").
2. Risk / warning / mistake lines → DANGER treatment. Money / price / revenue lines → MONEY.
3. Punchlines, surprises, hype, big claims → FUN / HYPE.
4. Long explanatory sentences (LONG_SENTENCE words or more) that need the LONG treatment to stay readable.
5. Rapid runs of short consecutive one-liners that read as one list or build-up → STACK (Violet-style group).
6. A setup + payoff thought (warning, price, verdict, punchline at the end), when the prompt's COMBOS section has USE_COMBOS true → COMBO: setup in DEFAULT/LONG, payoff (1–3 words, last line, bigger) in the vibe preset. Follow the prompt's Combos rule and HOW_OFTEN.

Skip: connective filler ("so", "and then", "you know"), half-thoughts that only make sense with the previous cut, and anything that would put two heavy animations back to back with nothing to breathe. Spread the animations through the video rather than clustering them at the start.

Grouping: Resolve's cuts often fall mid-thought. Use `regroup` with startFrame/endFrame so each placed phrase is a complete thought, never a stranded word (see the MCP server's workflow notes).

## 4. Emphasis on keywords — treat this as the most important choice

Emphasis is what makes a caption worth animating. For every animated line:
- Find the **one** word (at most a short phrase, 3 words max) the viewer must take away: the number, the verb of the claim, the contrast word, the name. Not articles, not the first word by habit.
- When the line has such a word, prefer a KEYWORDS / emphasis MultiText preset from the prompt's PRESETS, with parts `{upper, emphasis, lower}` that together spell the whole text and the keyword in `emphasis`, styled per TEXT STYLE → EMPHASIS.
- LONG treatment: still put the key word/phrase in the emphasis part, as the prompt's Long-sentences rule says.
- No real keyword in the line → use DEFAULT / vibe preset, no emphasis. Never emphasise a word just to use the effect; emphasising everything emphasises nothing.
- Never two different emphasis words in one caption; never emphasise more than one word per short line.
- Respect the Vibe no-repeat rule: never the same special preset on two consecutive animated subtitles (DANGER and MONEY excepted, as the prompt says; LONG repeats are fine).

## 5. Plan, then place

Before placing more than PLAN_THRESHOLD clips, show the plan as a table: subtitle #, text, treatment (DEFAULT / DANGER / MONEY / FUN / HYPE / LONG / STACK / KEYWORD / COMBO; for a COMBO give both presets and the setup / payoff split), preset, emphasis word, line split. Mark which subtitles are skipped and why in one word. Wait for a go unless the user already said to proceed.

Place with the prompt's Sizing and Placement rules (X 0.5, band centre, explicit textSize within SIZE_MIN–SIZE_MAX, never `scale`, never pass `track`). After the first few clips call `get_frame` at the end of the subtitle to check: inside the band, no face covered, nothing cut off, and the animation actually renders. Check the size from the `inspector` values in each place result (or `inspect_placed`); fix anything that fails before moving on.

**Keep Resolve responsive (hard rules, a breach freezes Resolve and the user loses the session):**
- One Resolve-touching call at a time: wait for each `place` / `place_stack` / `get_frame` / `remove_placed` / `run_script` result before sending the next. Never batch them in one message.
- Never touch a placed clip's Fusion comp from DaVinci Resolve `run_script` (`GetFusionCompByIndex`, `GetToolList`, `GetInput`, `SetInput`). Size / font read-backs come only from `inspector` / `inspect_placed`.
- `run_script` is only for plain timeline facts the plugin tools don't give (clip names, starts, ends, enabling a subtitle clip), small and one purpose per script.
- If any call times out or the panel stops answering, stop and tell the user. Do not retry, and do not relaunch Resolve yourself.

## 6. Report

Use the prompt's REPORT format, but organise it by treatment instead of by colour, and add at the top: subtitles in scope, how many were active (enabled) vs already animated, the trims made (subtitle #s → phrases, plus any ASR / $ fixes), how many animated, the resulting percentage, and a one-line list of emphasised keywords.
