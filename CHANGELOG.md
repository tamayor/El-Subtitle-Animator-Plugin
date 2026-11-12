# Changelog

Notable changes to El Subtitle Animator. The plugin's version is in `package.json` and `manifest.xml`.

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
