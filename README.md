# El Subtitle Animator

A DaVinci Resolve Studio Workflow Integration plugin. It turns the subtitle under the playhead into an animated Text+ clip with a sound effect, using presets from a library you build.

## Install

Keep both folders together in one main folder (it can live anywhere):

```
El Subtitle Animator Plugin Main/
  El Subtitle Animator Plugin/   the code (this repo, with the installer)
  El Subtitle Animator/          your presets, sounds, previews, fonts
```

Copy and paste into Terminal (or double-click the installer in Finder):

```bash
bash "$HOME/Documents/El Subtitle Animator Plugin Main/El Subtitle Animator Plugin/Install El Subtitle Animator.command"
```

Then quit Resolve completely, reopen it, and choose **Workspace › Workflow Integrations › El Subtitle Animator**. The installer copies only the runtime files (`manifest.xml`, `package.json`, `main.js`, `src/`) plus Blackmagic's `WorkflowIntegration.node`.

User data (presets, sounds, previews, fonts, window state) lives in `El Subtitle Animator/`, next to the code folder. The installer writes the main folder's location to `data-location.json` in the installed plugin, so if you move or rename the main folder, run the installer again.

## Layout

```
main.js                  Entry point Resolve loads (manifest.xml); just requires src/main
src/
  main/                  Electron main process (CommonJS modules)
  preload.js             window.sa: the panel's API, one function per IPC channel
  python/fusion_bridge.py  Long-running helper for the Fusion work the JS API cannot do
  renderer/
    index.html           The panel; loads the CSS and JS below, in order
    css/                 Stylesheets, split by section (order = cascade order)
    js/                  Panel scripts (classic scripts sharing one global scope)
tools/                   Dev checks (not installed)
```

### Main process: `src/main/`

| Module | Responsibility |
| --- | --- |
| `index.js` | Start-up and app lifecycle hooks |
| `ipc.js` | Every IPC channel → handler (`SAFE_HANDLERS` return `{ error }` instead of throwing) |
| `config.js` | Constants and file locations. Requires no project module |
| `state.js` | Mutable state shared between modules |
| `resolve.js`, `workflow-integration.js` | Resolve connection, timeline metadata, timecodes, subtitles |
| `poll.js` | Playhead polling, idle / parked state, live frame, seek |
| `apply.js`, `placement.js` | Putting the Text+ and its sounds on the timeline |
| `live-preview.js` | "Preview in Resolve" (live clip on the timeline) |
| `timeline-sync.js`, `selection.js` | Pushing panel edits to the latest placed / selected clip |
| `previews.js` | Rendering preset previews from Fusion, preview cache |
| `library.js`, `library-actions.js`, `library-overwrite.js` | `library.json` storage and every library action |
| `fusion-setting.js` | Parsing Fusion `.setting` files (keyframes, Text+ style, nodes) |
| `fusion-bridge.js` | Talking to `python/fusion_bridge.py` |
| `fonts.js`, `sfx.js`, `color-picker.js` | Fonts, sound files, native colour picker |
| `window.js`, `lifecycle.js`, `app-version.js`, `log.js` | Window, quitting with Resolve, version bump, debug log |
| `automation.js` | Local HTTP server for the MCP script (`mcp/el-sa-mcp.js`), editing rules (`edit-rules.json`) |
| `layout.js`, `layouts/` | Safe-zone layouts read from a reference PNG (safe area, guide lines, zones). Default: `layouts/social-9x16.png` + its analysed `.json` (guides eye / captions / graphics, zone head), used on 9:16 timelines only. Regenerate the `.json` with `analyzeLayout()` after changing the PNG |

Conventions:

- **Exports come first.** Each module starts with `module.exports = { ... }` and then its `require`s. Function declarations are hoisted, so modules that require each other in a cycle still see the full API. Export only functions this way. Constants go in `config.js`, and shared mutable values go in `state.js`.
- **Shared state is accessed as `state.x`.** Don't destructure it (`const { applying } = state` copies the value once and goes stale).
- **To add an IPC call**, add the handler to `SAFE_HANDLERS` (or `RAW_HANDLERS`) in `ipc.js` and a matching line in `src/preload.js`.

### Panel: `src/renderer/js/`

The panel scripts are classic `<script defer>` files, not ES modules. They share one global scope and run in the order listed in `index.html`:

- `core/`: `state`, `$`, helpers, waveforms, idle handling and the poll loop
- `design/`: Text Design panel (fonts, HTML templates, inspector controls, colour fields, layout, save bar)
- `timeline/`: Use/Create contexts (`CTX`), alignment timeline, scrubbing, playback, placement menu, adjust panel
- `stage/`: the preview stage (images, Fusion preview, drawing, interaction)
- `live/`: Preview in Resolve
- `library/`: preset list, tags, summaries, Create tab, settings
- `ui/`: popovers, drag-to-adjust number fields
- `app/`: actions, `initApp`, and `boot.js`, which starts the panel and must stay last
- `components/`: self-contained IIFEs that publish `window.SABoxes`, `window.SAThumbs` / `window.SAPreview` and `window.SASounds`

**Order matters.** Inside one file, a function can be called before its declaration. Across files it can't. Code that runs while the scripts load may only use names declared in earlier files. `npm run check` verifies this.

`components/preset-preview.js` holds a block marked **PROTECTED** (the preset card preview). Don't change it without the owner's explicit approval.

### Presets are inserted as Resolve title templates

Resolve's Edit-page Inspector only shows a Fusion title's controls when Resolve built the title itself. If a script replaces a clip's comp (`ImportFusionComp`, `LoadFusionCompByName`, `AddFusionComp`, `comp:Paste`, `tool:LoadSettings`), the Inspector shows only a folded "Text+" header with no controls. This happens even when the imported comp is the clip's own export. Tagging the comp with `TEMPLATE_ID` or expanding its tools doesn't help.

So `presetTitleFor` (in `placement.js`) writes each preset to `Fusion/Templates/Edit/Titles/Subtitle Animator/<Text+|MultiText> <preset name>.setting`, and the clip is inserted with `InsertFusionTitleIntoTimeline(<that name>)`. Resolve picks up new or rewritten template files immediately. The "Text+" / "MultiText" prefix keeps `isTitleClipName` and the cut guard working.

- On insert, Resolve connects the title's MediaOut to the tool named `Template`, whatever the template file says. For presets that run the text through effects (wiggle, glitch, stop motion), `apply.js` reconnects it to the real output tool (`presetOutputFor` + the bridge op `set_output`). Without that step these presets show plain text.
- A preset without a MediaOut (nodes copied out of the Fusion page) gets one, wired to its final tool (`withOutput`). Otherwise Resolve inserts an unconnected MediaOut and the clip is black. Macro / group presets are left to Resolve, which wires them itself.
- The template is rebuilt from the preset file on every apply, so presets saved from the timeline, dropped in, replaced or reverted are covered automatically. Every preset's template is also installed up front (`installAllTemplates`, run at startup and after each library change): Resolve 21.2 throws for a template it has not scanned yet, and a template written only on the preset's first use could still be unknown at that moment. `insertTitleAtEnd` retries a thrown insert for a few seconds before `apply.js` falls back to a plain title (that fallback clip works but has an empty Inspector, and is warned about).
- Clips that did fall back (named just "Text+" / "MultiText" but holding a preset) can be rebuilt: the MCP tool `repair_inspector` (`src/main/repair.js`) inserts the same preset as a title-template clip of the same length, copies every plain input value and the clip transform over (bridge ops `tools` and `copy_inputs`; nothing is imported or pasted), puts it in the old clip's place and removes the old clip.
- The template is named after the preset's name in the panel (`presetTitleNames`; same-named presets get " 2", " 3" in list order). `syncTemplates` renames the template when a preset is renamed, reverted or reordered, and deletes it when the preset is removed or its file replaced. At startup `startupTemplates` renames templates from older versions (named after the preset file) and prunes the rest. Only `*.setting` files in the plugin's own `Subtitle Animator` folder are touched. Clips already made from a deleted or renamed template keep working.
- To change which preset a clip uses, insert a new clip. Don't swap the comp on the existing one.
- `npm run check` fails on any comp-replacing call without an `// inspector-ok: <reason>` comment. Use that comment only for clips the user never inspects (temporary render clips) or for the logged fallback in `apply.js`, which warns the user.

### MultiText Inspector controls

The Upper / Emphasis / Lower MultiText presets (Highlight Select, Glass Pill, Pill Soft / Outline / Solid, Soft Marker, Underline Draw) carry extra Inspector controls on the Template, added by scripts in `tools/` (run them on a preset file; running them again changes nothing; `gen-pills.py` applies both):

- `add-highlight-box-controls.py`: Box Width / Height / X / Y for the box or pill behind the emphasised word. The panel's HIGHLIGHT_BOX row and `rules.highlight` write the same controls (bridge op `highlight_box`).
- `add-multitext-row-controls.py`: Row Gap, Link Rows, All / Upper / Emphasis / Lower Y, All / Upper / Emphasis / Lower X, Justify. The layers' `Center`, H Anchor and justification become expressions of these controls and of each row's Size, line count (read from the followers' `Text.Value`, never a follower output) and Line Spacing, so the gap above and below the emphasis is always the same and follows a resize or a Box Height change. Row Gap is in text lines (0 = touching; gap = Row Gap × 0.32 × the two rows' mean Size). Every Template input read inside an expression costs about 0.15 ms per frame, so the expressions read as little as they can (own offsets unless Link Rows is on, Line Spacing only for multi-line rows, text widths only for Left / Right): about 4.5 ms per frame for the three rows against 0.5 ms without them. Justify Center / Left / Right lines the rows' edges up and overrides the per-row X sliders; Manual (the default) lets the X sliders place each row. `size_multitext` leaves expression-driven Centers alone. `rules.rows` { gap, justify }, the `place` argument `rows` and the MCP tool `adjust_rows` write the controls (bridge op `multitext_rows`).

### Python bridge

`fusion_bridge.py` reads JSON requests on stdin and writes replies on stdout. The ops are in its `OPS` table (`scan`, `set_boxes`, `capture`, `live_frame`, …). Call them from JS with `bridgeCall(op, args, timeoutMs)`.

## Development

```bash
npm install      # dev tools only (ESLint, acorn); nothing is needed at runtime
npm run check    # ESLint + panel script load-order check + Inspector guard (tools/check-inspector-safe.js)
```

To turn on debug logging, run with `SA_DEBUG=1`. The log goes to `_debug/preview-log.txt`.

### Performance measuring

The panel does no video rendering of its own: a placement is Resolve scripting calls (one per clip property, from
Electron's main thread), one serial Python helper for the Fusion work, and file work on the main thread. `src/main/perf.js`
times all of that at runtime, switched on from the header **Fusion** popover (Performance) or the MCP tool `perf`
(`{ enable: true }`); the settings live in `<data>/_app/perf.json`.

- Every measurement goes to `_debug/perf-log.jsonl` (one JSON line each, buffered, written asynchronously) and into an
  in-memory summary: `perf` (MCP), `status.perf`, or "Copy summary" in the popover.
- Names: `apply` and its stages (`apply.snapshot`, `apply.pickTrackV`, `apply.sfxPrepare`, `apply.sweep`, `apply.template`,
  `apply.insert`, `apply.setOutput`, `apply.setText`, `apply.transform`, `apply.sfx`, `apply.refresh`, `apply.highlight`,
  `apply.rows`, `apply.cutCheck`, `apply.disableSubs`), `live.update`, `poll`, `sub.full` / `sub.probe` / `sub.setEnabled`,
  `tl.snapshot` / `tl.findItems` / `tl.sweepTemp`, `place.*` (pickTrack, cutSnapshot, importSfx, presetTitleFor,
  presetTitleNames, extraSfx, insertDirect, insertThrew, mediaPoolItem), `bridge.<op>` (sent to answered),
  `bridge.wait.<op>` (queued), `bridge.py.<op>` (the helper's own time) and `bridge.<op>#toolLists / getAttrs / getInputs /
  setInputs / woken / renders` (the helper's Fusion calls per request), `segwatch.*`, `timing.candidates`, `startup.*`,
  `resolve.<Method>` (every Resolve API call, through a Proxy around the Resolve object while measuring is on; the
  summary's `resolveCallsPerSec` comes from these), and with "Panel self-timing" `renderer.pollRtt.p50 / p95` and
  `renderer.longTasks` (tasks over 50 ms on the panel's thread, per minute).
- `verify_placed` (MCP) renders every clip placed this session at two frames through the helper (`probe_render`) and
  reports how many came out blank: run it before and after changing the wake settings (the "Lighter variants" in the
  popover: `refreshIfRecentWake`, `wakeLock`, `highlightProbeFrames`; all default to the panel's old behaviour).
- `promiseApi`: `probe` tries Blackmagic's promise-based scripting API once next to the blocking one and logs what it does
  (`perf.probe.promiseApi`); `on` connects with it (every call then yields to the event loop instead of blocking
  it). `renderProcess`: a second Python helper takes the renders (preview captures, live frames) so they never hold up
  placements.

How the hot paths are kept cheap (so a change there keeps it that way): one timeline snapshot per placement
(`timeline-snapshot.js`; `pickTrack`, `cutSnapshot`, `sweepTempClips` take it), items looked up by id in one pass
(`findItemsByIds`), the subtitle list read with four calls per clip and sent to the panel only when its version
changes, preset files read once per version (`fusion-setting.js presetText / derived`; template bodies, text styles,
nodes, add-ons all derive from it), the library parsed once per file version, the Fusion helper's requests queued in
three lanes with the timeout counted from the moment a request is sent, and the helper reading each comp's tool list
and each tool's attributes once per request.
