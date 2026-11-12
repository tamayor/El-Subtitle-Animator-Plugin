# Changelog

Notable changes to El Subtitle Animator. The plugin's version is in `package.json` and `manifest.xml`.

## Unreleased: Cut tab, media analysis, Match Cut

### Added

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
