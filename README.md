# El Subtitle Animator

A DaVinci Resolve Studio Workflow Integration plugin. It turns the subtitle under the playhead into an animated Text+ clip with a sound effect, using presets from a library you build.

## Install

```bash
bash install.command
```

Then quit Resolve completely, reopen it, and choose **Workspace › Workflow Integrations › El Subtitle Animator**. The installer copies only the runtime files (`manifest.xml`, `package.json`, `main.js`, `src/`) plus Blackmagic's `WorkflowIntegration.node`.

User data (presets, sounds, previews, fonts, window state) lives in `~/Documents/Subtitle Animator/`.

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

### Python bridge

`fusion_bridge.py` reads JSON requests on stdin and writes replies on stdout. The ops are in its `OPS` table (`scan`, `set_boxes`, `capture`, `live_frame`, …). Call them from JS with `bridgeCall(op, args, timeoutMs)`.

## Development

```bash
npm install      # dev tools only (ESLint, acorn); nothing is needed at runtime
npm run check    # ESLint (undefined names across all panel scripts) + panel script load-order check
```

To turn on debug logging, run with `SA_DEBUG=1`. The log goes to `_debug/preview-log.txt`.
