# Architecture

How El Subtitle Animator is put together, and the constraints that shaped it. For installing and using the plugin see
[README.md](README.md); for the day-to-day rules of changing it see [CONTRIBUTING.md](CONTRIBUTING.md).

## The pieces

```
DaVinci Resolve Studio
  │  loads manifest.xml -> main.js (an Electron app Resolve starts as a Workflow Integration)
  ▼
src/main/            Electron main process: talks to Resolve, owns the library and every file
  │  ├─ WorkflowIntegration.node   Blackmagic's scripting API for JavaScript (timeline, clips, Media Pool)
  │  ├─ src/python/fusion_bridge.py   one long-running Python helper for what the JS API cannot reach
  │  │                                (the tools inside a Fusion composition), one JSON line per request
  │  └─ HTTP on 127.0.0.1  ◄──  mcp/el-sa-mcp.js  ◄──  Claude Code (or any MCP client)
  ▼  IPC (src/preload.js: window.sa)
src/renderer/        the panel: plain HTML, CSS and classic scripts
```

Two folders sit side by side: the code (this repo) and the user's data (`El Subtitle Animator/`: `library.json`,
`presets/`, `sounds/`, `previews/`, `fonts/`, `_app/`). Resolve runs the *installed copy* of the code, in its Workflow
Integration Plugins folder; the installer writes `data-location.json` there so that copy finds the data folder.

The plugin renders nothing itself. A placement is a series of Resolve scripting calls (each one a round trip from
Electron's main thread), a few requests to the Python helper for the Fusion work, and file work. Almost every design
decision below is about making those round trips few, and about never breaking Resolve's own Inspector.

## Main process: `src/main/`

| Area | Modules |
| --- | --- |
| Start-up, window, lifecycle | `index.js` (entry, warm-ups), `window.js`, `lifecycle.js` (quits with Resolve), `app-version.js`, `log.js` |
| Configuration and state | `config.js` (constants and file locations; requires no project module), `state.js` (mutable state shared between modules) |
| Panel API | `ipc.js` (every IPC channel → handler), mirrored by `src/preload.js` |
| Resolve connection | `resolve.js` (connection, timeline metadata, timecode, subtitles, item lookups), `workflow-integration.js` (the native addon), `resolve-load.js` (is Resolve busy?), `poll.js` (playhead polling), `playback.js`, `selection.js`, `clip-colors-db.js` (subtitle clip colours from the project database) |
| Placing a caption | `apply.js` (the main action), `placement.js` (track picking, title insert / move / trim, cut guard, main and layered sounds), `title-templates.js` (presets as Resolve title templates), `timeline-snapshot.js` (one read of the timeline per placement), `stack.js` (stacked captions), `settle.js` (second wake), `regroup.js` (subtitles regrouped by thought) |
| Sounds | `sfx.js` (sound files and the originals library), `sfx-import.js` (Media Pool import, the project's copy beside the footage), `sfx-level.js` (peak window, pitch variation), `row-sfx.js` (sounds that follow a MultiText row) |
| Editing placed clips | `live-preview.js` (Preview in Resolve), `timeline-sync.js` (panel edits → latest clip), `anim-timing.js` (timing bar), `seg-watch.js` (Inspector timing sliders), `clip-controls.js`, `addon-controls.js`, `effect-presets.js` (Glitch / Wiggle / Stop Motion / Transform / Track as Fusion effects), `subject-track.js`, `repair.js` (empty-Inspector repair) |
| Library and previews | `library.js`, `library-actions.js`, `library-overwrite.js`, `previews.js`, `png-compress.js`, `fonts.js`, `color-picker.js` |
| Fusion | `fusion-bridge.js` (the Python helper's process, queue and lanes), `fusion-setting.js` (reading `.setting` / `.comp` files), `fusion-fixes.js` (wake settings), `retime.js` (Animation Frames retiming) |
| Automation | `automation.js` (HTTP server and the MCP tools), `edit-rules.js` (editing rules), `layout.js` + `layouts/` (safe-zone layouts read from a reference PNG) |
| Measuring | `perf.js` |

Conventions:

- **Exports come first.** Each module starts with `module.exports = { ... }` and then its `require`s. Function
  declarations are hoisted, so modules that require each other in a cycle still see the full API. Export only functions
  this way. A constant that has to be exported is declared above `module.exports` (see `FADE_WARNING` in
  `placement.js`); shared constants go in `config.js`, and shared mutable values go in `state.js`.
- **Shared state is accessed as `state.x`.** Don't destructure it (`const { applying } = state` copies the value once and
  goes stale).
- **To add an IPC call**, add the handler to `SAFE_HANDLERS` (or `RAW_HANDLERS`) in `ipc.js` and a matching line in
  `src/preload.js`. The contract test fails when the two lists differ.
- **Resolve API calls can fail quietly.** They return `null`, `false` or an empty list instead of throwing, and a handle
  can go stale at any time. Lists are read as `(await tl.GetItemListInTrack(kind, t)) || []`, optional calls sit in
  their own `try / catch` with a comment saying why the failure does not matter, and anything the user asked for
  reports the failure back (`{ ok: false, error }` / a warning) rather than throwing into the panel.
- **System locations live in `config.js`**: the data folders, Resolve's app, scripting and template folders
  (`resolveUserDir`), `osascript`, and `RESOLVE_BATCH` (how many timeline items are asked about at once).

## Panel: `src/renderer/js/`

The panel scripts are classic `<script defer>` files, not ES modules. They share one global scope and run in the order
listed in `index.html`:

- `core/`: `state`, `$`, helpers, waveforms, idle handling and the poll loop
- `design/`: Text Design panel (fonts, HTML templates, inspector controls, colour fields, layout, save bar)
- `timeline/`: Use/Create contexts (`CTX`), alignment timeline, timing bar, Clip controls, scrubbing, playback,
  placement menu, adjust panel, bottom dock
- `stage/`: the preview stage (images, Fusion preview, drawing, interaction)
- `live/`: Preview in Resolve
- `library/`: preset list, effect list, tags, summaries, text style, Create tab, Prompt tab, settings
- `ui/`: popovers, drag-to-adjust number fields, slider fill, compact mode, Fusion fixes popover
- `app/`: actions, `initApp`, the Use dock, and `boot.js`, which starts the panel and must stay last
- `components/`: self-contained IIFEs that publish `window.SABoxes`, `window.SAThumbs` / `window.SAPreview` and
  `window.SASounds`
- `workers/`: the colour-key web worker for preview frames

**Order matters.** Inside one file, a function can be called before its declaration. Across files it can't. Code that
runs while the scripts load may only use names declared in earlier files. `npm run check` verifies this.

`components/preset-preview.js` holds a block marked **PROTECTED** (the preset card preview). Don't change it without the
owner's explicit approval.

## Python helper: `src/python/`

`fusion_bridge.py` reads JSON requests on stdin and writes replies on stdout. The ops are in its `OPS` table (`scan`,
`set_boxes`, `capture`, `live_frame`, …). Call them from JS with `bridgeCall(op, args, timeoutMs)`
(`src/main/fusion-bridge.js`), which queues requests in three lanes (interactive, placement, background) and can run
renders in a second helper process.

- A failed operation is tried once more (a stale handle, Resolve mid-update), except renders and watchers
  (`NO_RETRY`), and never after a wake has run.
- Per request, each composition's tool list and each tool's attributes are read once.
- Never read a follower-driven text input from a script (`GetInput` on a mirror Text+): it deadlocks Resolve's main
  thread. Read-backs go through `read_style`, which skips those tools.

`subject_tracker.py` is the Track Subject tracker (OpenCV). It runs in its own virtual environment that the panel
installs on first use (`src/main/subject-track.js`).

## Design notes

### Presets are inserted as Resolve title templates

Resolve's Edit-page Inspector only shows a Fusion title's controls when Resolve built the title itself. If a script replaces a clip's comp (`ImportFusionComp`, `LoadFusionCompByName`, `AddFusionComp`, `comp:Paste`, `tool:LoadSettings`), the Inspector shows only a folded "Text+" header with no controls. This happens even when the imported comp is the clip's own export. Tagging the comp with `TEMPLATE_ID` or expanding its tools doesn't help.

So `presetTitleFor` (in `title-templates.js`) writes each preset to `Fusion/Templates/Edit/Titles/Subtitle Animator/<Text+|MultiText> <preset name>.setting`, and the clip is inserted with `InsertFusionTitleIntoTimeline(<that name>)`. Resolve picks up new or rewritten template files immediately. The "Text+" / "MultiText" prefix keeps `isTitleClipName` and the cut guard working.

- On insert, Resolve connects the title's MediaOut to the tool named `Template`, whatever the template file says. For presets that run the text through effects (wiggle, glitch, stop motion), `apply.js` reconnects it to the real output tool (`presetOutputFor` + the bridge op `set_output`). Without that step these presets show plain text.
- A preset without a MediaOut (nodes copied out of the Fusion page) gets one, wired to its final tool (`withOutput`). Otherwise Resolve inserts an unconnected MediaOut and the clip is black. Macro / group presets are left to Resolve, which wires them itself.
- The template is rebuilt from the preset file on every apply, so presets saved from the timeline, dropped in, replaced or reverted are covered automatically. Every preset's template is also installed up front (`installAllTemplates`, run at startup and after each library change): Resolve 21.2 throws for a template it has not scanned yet, and a template written only on the preset's first use could still be unknown at that moment. `insertTitleAtEnd` (`placement.js`) retries a thrown insert for a few seconds before `apply.js` falls back to a plain title (that fallback clip works but has an empty Inspector, and is warned about).
- Clips that did fall back (named just "Text+" / "MultiText" but holding a preset) can be rebuilt: the MCP tool `repair_inspector` (`src/main/repair.js`) inserts the same preset as a title-template clip of the same length, copies every plain input value and the clip transform over (bridge ops `tools` and `copy_inputs`; nothing is imported or pasted), puts it in the old clip's place and removes the old clip.
- The template is named after the preset's name in the panel (`presetTitleNames`; same-named presets get " 2", " 3" in list order). `syncTemplates` renames the template when a preset is renamed, reverted or reordered, and deletes it when the preset is removed or its file replaced. At startup `startupTemplates` renames templates from older versions (named after the preset file) and prunes the rest. Only `*.setting` files in the plugin's own `Subtitle Animator` folder are touched. Clips already made from a deleted or renamed template keep working.
- To change which preset a clip uses, insert a new clip. Don't swap the comp on the existing one.
- `npm run check` fails on any comp-replacing call without an `// inspector-ok: <reason>` comment. Use that comment only for clips the user never inspects (temporary render clips) or for the logged fallback in `apply.js`, which warns the user.

### MultiText Inspector controls

The Upper / Emphasis / Lower MultiText presets (Highlight Select, Glass Pill, Pill Soft / Outline / Solid, Soft Marker, Underline Draw) carry extra Inspector controls on the Template, added by scripts in `tools/` (run them on a preset file; running them again changes nothing; `gen-pills.py` applies both):

- `add-highlight-box-controls.py`: Box Width / Height / X / Y for the box or pill behind the emphasised word. The panel's HIGHLIGHT_BOX row and `rules.highlight` write the same controls (bridge op `highlight_box`).
- `add-multitext-row-controls.py`: Row Gap, Link Rows, All / Upper / Emphasis / Lower Y, All / Upper / Emphasis / Lower X, Justify. The layers' `Center`, H Anchor and justification become expressions of these controls and of each row's Size, line count (read from the followers' `Text.Value`, never a follower output) and Line Spacing, so the gap above and below the emphasis is always the same and follows a resize or a Box Height change. Row Gap is in text lines (0 = touching; gap = Row Gap × 0.32 × the two rows' mean Size). Every Template input read inside an expression costs about 0.15 ms per frame, so the expressions read as little as they can (own offsets unless Link Rows is on, Line Spacing only for multi-line rows, text widths only for Left / Right): about 4.5 ms per frame for the three rows against 0.5 ms without them. Justify Center / Left / Right lines the rows' edges up and overrides the per-row X sliders; Manual (the default) lets the X sliders place each row. `size_multitext` leaves expression-driven Centers alone. `rules.rows` { gap, justify }, the `place` argument `rows` and the MCP tool `adjust_rows` write the controls (bridge op `multitext_rows`).

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
