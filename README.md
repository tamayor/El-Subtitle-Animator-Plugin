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
- The template is rebuilt from the preset file on every apply, so presets saved from the timeline, dropped in, replaced or reverted are covered automatically.
- The template is named after the preset's name in the panel (`presetTitleNames`; same-named presets get " 2", " 3" in list order). `syncTemplates` renames the template when a preset is renamed, reverted or reordered, and deletes it when the preset is removed or its file replaced. At startup `startupTemplates` renames templates from older versions (named after the preset file) and prunes the rest. Only `*.setting` files in the plugin's own `Subtitle Animator` folder are touched. Clips already made from a deleted or renamed template keep working.
- To change which preset a clip uses, insert a new clip. Don't swap the comp on the existing one.
- `npm run check` fails on any comp-replacing call without an `// inspector-ok: <reason>` comment. Use that comment only for clips the user never inspects (temporary render clips) or for the logged fallback in `apply.js`, which warns the user.

### Python bridge

`fusion_bridge.py` reads JSON requests on stdin and writes replies on stdout. The ops are in its `OPS` table (`scan`, `set_boxes`, `capture`, `live_frame`, …). Call them from JS with `bridgeCall(op, args, timeoutMs)`.

## Development

```bash
npm install      # dev tools only (ESLint, acorn); nothing is needed at runtime
npm run check    # ESLint + panel script load-order check + Inspector guard (tools/check-inspector-safe.js)
```

To turn on debug logging, run with `SA_DEBUG=1`. The log goes to `_debug/preview-log.txt`.
