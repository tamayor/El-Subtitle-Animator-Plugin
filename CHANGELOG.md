# Changelog

Notable changes to El Subtitle Animator. The plugin's version is in `package.json` and `manifest.xml`.

## Unreleased: Cut tab, media analysis, Match Cut

### Added

- **Collage Auto-fill** (B-roll > Collage, "Start and auto-fill" / "Auto-fill"; MCP `collage_auto`): the beat-by-beat
  set-up in one run. Joins one-subtitle beats into 2.5-5 s thoughts, gives the strongest about half of the time B-roll
  (`autoPlanBeats` in `collage-plan.js`: years -> date tag, names -> name label, two names -> stack, actions -> clip with a
  stock key), searches, picks the first pictures no other beat uses, and puts beats with no results back on the speaker.
  Hand-set beats are kept. MCP `planOnly` + `beats` lets Claude write the plan; `render: true` also renders and places.
  The pane opens on Auto-fill only (Start project removed). A **Context** field ("Philippines") goes on every search
  (context results rank first, plain ones fill in); changing it redoes the beats Auto-fill set up (`auto` flag, cleared
  by any hand edit). **Reset** moves the project files to `_old/<time>/` (render/ and placed clips stay).
- **Collage evidence pictures** (real posts, banners, tarpaulins): every beat has a paste box (click, ⌘V), Choose file,
  drop, and a Google Images button; the picture is credited "rights to confirm" and the beat becomes a Document.
  `broll/collage/vision-scan.swift` (macOS Vision, compiled once into `_app/bin`) reads its words and faces;
  `evidencePlan` highlights the words the line says and zooms (a whole-card punch-in) onto the biggest; names, places,
  hashtags and faces are found but blurred only when the beat's **Blur names & faces** switch is on, plus boxes drawn in
  the full-size viewer (double-click any picture: ← → Space Esc; drag = blur box, Shift-drag = highlight). Blur
  strength 1-100 (opaque SVG blur, nothing shows through). Candidates rank context matches first and Commons before
  stock for names.
- **B-roll > Collage** (new sub-tab; `js/library/broll/collage.js`, `src/main/collage.js`, pure part in
  `src/main/collage-plan.js`): the collage-style explainer B-roll of `broll/collage/` in the panel. Start project makes
  the timeline's folder (script, word timings, one beat per subtitle); each beat is set to Talking head, Photo, Photo
  stack, Medallion, Document or Title card, with Commons search words, the pictures found (pick / unpick, credited in
  credits.csv) and date / label / title overlays. Preview at playhead draws the frame with the B-roll tab's warm
  renderer; Render and place renders the clips and captions (ProRes 4444 with alpha, `-v<n>` names so open clips are
  never overwritten) and places them (B-roll + titles on one track, captions above). Placing again swaps the media of
  the collage clips already there and takes off the ones the plan no longer has. `render-collage.mjs` now shares the
  segments, SRT and picture sizes with the panel.
  - **Video clip beats**: a beat can play a short video in its card. Find clips searches videos (at least 720 px and
    3 s); picking one streams its first 90 s through ffmpeg into `assets/<beat>-NN.mp4` (H.264, a key frame every 15
    frames), keeps its poster, size and source in `assets/clips.json`, and Start the clip at sets the in-point. A beat
    keeps its pictures and its clip when its visual changes; each visual uses its own kind.
  - **Sound effects** (Render & place switch, on by default): a whoosh as each card or clip comes in (leading by 3
    frames after the speaker), a hit on title cards, pops for a photo stack's cards, clicks for dates and labels, a
    highlighter for callouts (`sfxCuesOf` in collage-plan.js; cues closer than 6 frames keep the stronger one, each
    ends before the next). Sounds come from the SFX Originals Library by name, take turns within a kind, go on one
    free audio track with the usual -20..-15 dBFS peak window and pitch variation, and are replaced on the next place
    (`render/sfx-placed.json`).
  - **Sources & API keys** (optional): Wikimedia Commons is always searched; a Pexels and / or Pixabay API key adds
    their photos and videos. Keys are kept in `<data>/_app/collage-sources.json` (never in the project folder) and the
    panel only sees their last 4 characters; a refused key is reported. Each found picture's ↗ opens its page.
- **B-roll effect search**: a search box in the Effect step filters the cards by name, description and category
  (Enter picks the first, Esc clears). The × in the Use tab's preset search boxes now hides while they are empty.
- **B-roll: 35 more effects** (54 in all; `broll/effects.json`, `broll/src/effects/`): Ring gauge, Mini chart, Audio
  pulse, Sticker pop, Step badge, Lower third, News ticker, Pull quote, Doodle callout / icon / boil, Journal note,
  Cutout pop, Paper frame, Cutout puppet, Ransom text, Headline wall, Zoom-through cut, Phone mockup, Viewfinder zoom,
  UI world, Sticky text, Before + after, Pull-back reveal, Wall of videos, Notification stack, Checklist card, Avatar
  split, Timeline arc, and the six footage effects below. The Effect step has a category filter
  (`group`); fields can be dropdowns (`select`) or picture files (`image`); `suggest_broll` reads the new ones from
  the words. Comment drop takes a reply text and button, the Counter a start value. Status: `../NEW_BROLLS_PLAN.md`.
- **B-roll reads the footage** (`src/main/broll-footage.js`, `src/python/broll_cutout.py`, `broll/src/lib/footage.tsx`):
  before a render, an effect gets the dialogue's loudness (Cut tab's envelope), the speaker cut out of every frame
  (Spotlight's matte engine), the clip's own frames, or frames of the timeline's clips. New effects on it: Paper cut,
  Depth scatter, Orbit, Frame break, Vertigo, Green screen. Audio pulse and Cutout puppet move with the voice; Cutout
  pop can take the speaker or remove a photo's background; Doodle boil follows the speaker's outline; Viewfinder zoom
  and Pull-back reveal carry the footage; Wall of videos shows the timeline's clips. Footage renders are Rec.709-tagged.
- **Cut tab** (new top-level tab, two sub-tabs):
  - **Rough cut** (`src/main/auto-cut.js`, `src/python/auto_cut.py`, pause rules adapted from ghost-editor, MIT): five
    numbered steps (Source, Pauses, Take out, Analyse, Build). Shortens pauses, trims heads and tails, takes out
    retakes, outtakes, stutters, fillers and sounds without words (from Resolve's transcription or the subtitle track),
    optional script mode. Build makes a new "(cut)" timeline; the source timeline is never edited.
  - After Analyse, the clip's real waveform with every cut drawn on it (`js/library/cut-wave.js`). The pause rules also
    run in the panel (`js/library/cut-plan.js`, kept identical to `auto_cut.py` by `test/main/cut-plan.test.js`), so
    pause settings, unticked lines and clicks on the waveform (keep / cut / drag a range) show at once and Build uses
    them. Double-click listens to the join (`cut:listen`). Sliders for the five pause values; "What counts as
    silence" (`pauseDb`, `voiceDb`) for recordings where the cut ate into words.
  - **Measure** (`src/main/media-analysis.js`, `src/main/cut-tools.js`, ideas from kajisho5/ffmpeg-skill, MIT):
    speech pauses, shot changes with brightness (light B-roll), beat grid, word timings from a local speech engine
    (mlx-whisper), render check (black / frozen frames). Results are drawn over the range's waveform
    (`js/library/cut-tools-view.js`) with Resolve's playhead (followed live), and listed; a click moves the playhead.
  - Pauses work like Resolve's Remove Silence: Threshold (peak dBFS), Pre head, Post tail, Minimum to strip (frames),
    clicks up to 60 ms bridged. Add markers (pause markers then follow the settings), Clear markers, and
    "Delete marked pauses" (a new "(no pauses)" timeline without them; the scripting API cannot trim in place).
  - Words: a running transcript; the word being said is highlighted and kept centred during playback.
- MCP tools `auto_cut`, `find_pauses`, `find_cuts`, `find_beats`, `transcribe_words`, `check_render`, `break_lines`;
  `regroup` snaps phrase cuts onto measured pauses; `chop_srt` takes `media`.
- Built-in TikTok / Reels / Shorts safe-zone layouts (`src/main/layouts/*-9x16.json`).
- Phrase-aware line breaks (`src/main/line-break.js`).
- **Match Cut** effect card and MCP tool `match_cut` (`src/main/match-cut.js`, `src/python/news_match_cut.py`): a
  news-article match cut of one word, placed at the playhead.

### Changed

- **B-roll limits lifted** (`src/main/broll-footage.js`, `src/python/subject_matte.py`, `broll/render.mjs`):
  - Effects that cut the speaker out of every frame take up to 20 s (was 10 s), frames-only effects up to 30 s. The
    matte now runs while Resolve is still exporting the frames, and its edge and hole steps were made faster (same
    pixels, ~176 → ~142 ms a frame). The footage cache is capped at 4 GB as well as 16 folders.
  - **Vertigo**: new What moves (Room grows / Speaker grows) and Room shrinks. Room grows is the real dolly zoom: the
    room stretches behind a speaker who stays put, drawn from a clean plate (the speaker filled in from the room, written
    by the matte script), so no halo.
  - **Green screen**: the Backdrop can be a video (read as frames at the timeline rate, looped); the picker takes videos.
  - **Sticky text**: Stick to the shot (on by default) tracks the spot under the label from the frame it lands on
    (Track Subject's tracker), so it moves with the camera or the object.
  - **Before + after**: Before look (Flat (log) / Washed out / Black & white / Tint). With a footage look the "before"
    side is the clip's own frames with that look and the "after" side is clear, so the real graded clip shows: two
    real looks. Tint is the old divider + tint.
  - Every B-roll render is written Rec.709 (matrix + tags), not only the footage ones. Checked in Resolve: the old
    renders showed matcha #8ccf8e as (135, 197, 140), the new ones as (140, 206, 142). Clips placed before keep the old
    shift until they are re-rendered (adjust or finalize them).
- **B-roll vibes reach the newer effects**: Lower third, Ring gauge, Step badge, Mini chart, Pull quote, News ticker
  (type; the bar keeps its red), Sticker pop, Audio pulse, Cutout pop, Cutout puppet (speech bubble), Depth scatter,
  Zoom-through cut, Wall of videos, UI world (type and corners), Sticky text and Before + after draw with `useVibe`.
  Plain Classic keeps their exact old look (`plainClassic`, `face` in `broll/src/lib/vibe.tsx`). The material ones
  (paper, journal, ransom, doodles, phone, headline wall, editor, viewfinder, frame break, orbit, Vertigo, Green screen)
  take the vibe's accent and motion only, by design.
- **Panel layout, Apple-style pass** (plan: `../APPLE_UI_DESIGN_PLAN.md`): a one-row header (status dot + timeline name,
  Rescan, Settings gear); the six tabs are always visible (the Text menu is gone); a Settings sheet
  `Style | Placement | App` holds Preset Set Up, Text Style, Placement, Fusion fixes, Resolve Loop, Real-time render,
  Auto-collapse and Keep on top. The Use tab's action bar has **Customize**: a drawer with Animation timing and Clip
  controls that opens when a placed clip is selected. Cut and Broll options are grouped switch rows; Library and Prompt
  keep their secondary actions in `⋯` menus; `Exact values`, `Script` and `Placement & timing` remember open / closed.
  Surfaces read by tone instead of outlines and selection is matcha. Shared pieces: `css/primitives.css`,
  `js/ui/settings-sheet.js`, `bindProxyMenu`, `rememberDetails`. Switching tabs no longer drops compact mode.

### Fixed

- Rough cut Build left the endFrame test piece's audio at the head of the cut (it played twice); markers are now off
  by default.
- `GetSourceEndFrame` is inclusive on some timeline items and exclusive on others: the clip end is now read from the
  reading that matches the duration, pieces are never under 2 frames, and a batch Resolve refuses is placed piece by
  piece ("Invalid items to append" on Delete marked pauses).
- Measure's waveform left every third or fourth 10 ms bucket empty, which read as silence and marked speech as pauses.
- Pauses across a cut join are measured as one pause.
- Clear markers also removes a build's "... cut" markers and falls back to Resolve's Python API.
- Speech engine: the model download resumes with curl (Hugging Face's downloader restarted from zero and showed no
  progress), shows MB / speed / time left, stops on a stall instead of hanging, Cancel ends it at once, and leftovers
  of earlier runs are stopped. Inside Resolve the engine could not find `ffmpeg` (no Homebrew folders on PATH).

## Unreleased: clean-up and tests

No change in behaviour is intended. Everything below was checked with the new test suite, ESLint, the load-order and
Inspector checks, and pyflakes; what only a live Resolve session can confirm is listed in CONTRIBUTING.md
("Testing in Resolve").

### Added

- A test suite that runs without DaVinci Resolve, Electron or the data folder: Node tests for the main process
  (`test/main`) and Python tests for the Fusion helper (`test/python`), with a fake Resolve API for both.
  `npm test`, `npm run test:js`, `npm run test:py`.
- Contract tests: every main-process module loads whichever is required first, every imported name is exported by its
  module, every IPC channel has a handler, every helper operation the panel calls exists, the panel's scripts and
  stylesheets exist, and Resolve's entry points are in place.
- `npm run lint:py` (pyflakes), `requirements-dev.txt`, `.editorconfig`, and `engines` (Node 22+, development only) in
  `package.json`.
- `ARCHITECTURE.md`, `CONTRIBUTING.md` and this file. `README.md` now covers features, requirements, installation,
  usage, structure and tests; its design notes moved to `ARCHITECTURE.md`.

### Changed

- **Word timings: every word has its own in and out.** The word lane in the Animation timing card shows a strawberry in
  handle and a matcha out handle on each word (`js/components/frame-range.js`). The out now does something on every
  preset: Justified Pop words land their pop on it and hold until the next word; Word by Word Typing types each word
  from its in to its out (Fit to words types a word over the time it is said); letter reveals end the word there.
  Kinetic Cloud / Lines rows pop into the next row, so their out follows the next in (dimmed handle).

- `src/main/placement.js` was split by concern. Code moved verbatim; no function was renamed:
  - `title-templates.js`: presets as Resolve title templates (`presetTitleFor`, `presetTitleNames`, `syncTemplates`,
    `installAllTemplates`, `startupTemplates`, `pruneTemplates`, `titlesDir`, `titleKindFor`, `isTitleClipName`,
    `inspectorSafeComp`, `presetOutputFor`, `presetHasRowControls`, `tailFor`, `typingFramesFor`)
  - `sfx-import.js`: `importSfx`, `relinkToProjectCopy`
  - `row-sfx.js`: `loneRow`, `rowFramesFor`, `refitRowSfx`, `segSfxFor`, `segSfxForget`, `segSfxRecord`,
    `segSfxSetEmpty`
  - `placement.js` keeps track picking, title insert / move / trim, the cut guard, and the main and layered sounds.
- The editing rules moved from `automation.js` into `edit-rules.js`.
- System locations are defined once in `config.js`: `resolveUserDir()` (was worked out separately for titles and
  effects), `RESOLVE_PYTHON`, `RESOLVE_SCRIPT_API`, `RESOLVE_SCRIPT_LIB`, `OSASCRIPT`, `OSACOMPILE`. The paths are the
  same as before.
- `RESOLVE_BATCH` (40) names the number of timeline items asked about at once; it replaces the literal in seven
  modules.
- `fusion_bridge.py` imports `re`, `time` and `math` once at the top instead of inside ten functions.
- The installer leaves `test/`, `.editorconfig` and `requirements-dev.txt` out of the installed plugin.

### Removed

- Unused panel code: `setPresetNow`, `previewMatchesDesign`, `ADJUST_HTML`, and the unused variable `lastStage`.

### Fixed

- `sfx.js` now exports `pruneSfxCache`. `index.js` imported it, but it was never exported, so the start-up and
  six-hourly clean-up of `_app/sfx-cache` failed silently and the cache was only pruned when a trimmed sound was saved.

## 1.0.0

The plugin as it stood before the clean-up. See the git history for the individual changes.
