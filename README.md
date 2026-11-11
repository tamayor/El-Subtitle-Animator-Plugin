# El Subtitle Animator

A Workflow Integration plugin for DaVinci Resolve Studio. It turns the subtitles on a timeline into animated Text+ and
MultiText captions with sound effects, using presets from a library you build yourself. Captions can be placed one at a
time from the panel, or a whole timeline at once by Claude Code through the bundled MCP server.

## Features

- **Place a caption from a subtitle.** Pick a preset, and the subtitle under the playhead becomes a real Resolve title
  clip on a free video layer, with its sound effect on a free audio track. The subtitle clip under it is switched off.
- **A preset library of your own.** Save Fusion compositions from the timeline or from `.setting` / `.comp` files, with
  tags, a rendered preview, a default sound and text style. Each preset keeps its original, so edits can be reverted.
- **Working Inspector.** Presets are installed as Resolve title templates, so every placed clip keeps its full
  Edit-page Inspector (text, font, size, the preset's own controls).
- **Preview in Resolve.** Try a preset as a live clip on the timeline before keeping it; text, position, size and style
  edits in the panel follow onto the clip.
- **Text+ and MultiText.** Upper / Emphasis / Lower rows with highlight boxes and pills, row gap and justify controls,
  per-row timing and per-row sounds.
- **Sound effects.** Trim and fade in the panel, layered sounds, levels pulled into a -20 to -15 dBFS peak window,
  small pitch variation between repeated copies, and a project copy of each sound kept beside the footage.
- **Effect presets** for any clip: Glitch, Wiggle, Stop Motion, Transform, Track Subject.
- **Safe-zone layouts** read from a reference image, so captions stay inside the safe area and off marked zones.
- **Automation.** An MCP server lets Claude Code read the subtitles, follow your editing rules, and place, stack,
  inspect, adjust and remove captions.

## Requirements

| | |
| --- | --- |
| DaVinci Resolve | **Studio** (Workflow Integrations are not available in the free version). Developed and tested on Resolve Studio 21.2. |
| Operating system | macOS. The installer, the colour picker, playback control and font discovery use macOS tools. |
| Python | Python 3 for the Fusion helper. The one bundled with Resolve is used when present, otherwise `/usr/bin/python3` or a Homebrew `python3`. Standard library only. |
| Resolve setting | Preferences › General › External scripting using: **Local**. |
| Optional | `ffmpeg` (Homebrew) to measure sound peaks; without it sounds keep their preset volume. Track Subject installs OpenCV into its own virtual environment the first time it is used. |
| Development only | Node.js 22 or newer and npm (linting and tests). Nothing from `node_modules` is needed at runtime. |

## Installation

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

It asks for your Mac password, because Resolve reads plugins from a system folder. Then quit Resolve completely, reopen
it, and choose **Workspace › Workflow Integrations › El Subtitle Animator**.

The installer copies only the runtime files (`manifest.xml`, `package.json`, `main.js`, `src/`) plus Blackmagic's
`WorkflowIntegration.node` into
`/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.el.subtitleanimator`.
Resolve runs that copy, not this folder: **run the installer again after every code change.**

User data (presets, sounds, previews, fonts, window state) lives in `El Subtitle Animator/`, next to the code folder.
The installer writes the main folder's location to `data-location.json` in the installed plugin, so if you move or
rename the main folder, run the installer again.

### Claude Code (optional)

Register the MCP server once:

```bash
claude mcp add el-subtitle-animator -- node "$HOME/Documents/El Subtitle Animator Plugin Main/El Subtitle Animator Plugin/mcp/el-sa-mcp.js"
```

The panel must be open in Resolve: when it starts it writes its local address and a token to
`~/.el-subtitle-animator/mcp-endpoint.json`, which the MCP script reads.

## Usage

Open a timeline that has a subtitle track, then open the panel. It has four tabs:

- **Use**: choose a preset, see it on the current subtitle, adjust text, position, size, style, timing and sounds, and
  add it to the timeline. *Preview in Resolve* shows it as a live clip first. The dock at the bottom holds the timing
  bar, Clip controls and Effect Presets for the clip selected in Resolve.
- **Library**: the presets, their tags, order, previews and default sounds.
- **Create**: make a preset from the clip selected on the timeline or from a file, or save a variant.
- **Prompt**: the job prompt and editing rules used by Claude Code (allowed tags, fonts and colours, layer range,
  subtitle trimming, highlight box and row settings).

The **Fusion** button in the header holds the wake settings and performance measuring.

With Claude Code, ask it to animate the timeline. It reads the rules (`get_rules`), the allowed presets and the
subtitles, shows its plan, and places the clips one at a time. The MCP tools are: `status`, `get_rules`, `set_rules`,
`reset_rules`, `get_layout`, `set_layout`, `list_tags`, `list_presets`, `list_subtitles`, `get_frame`, `get_tracks`,
`place`, `place_stack`, `measure_text`, `regroup`, `adjust_highlights`, `adjust_rows`, `list_placed`, `inspect_placed`,
`remove_placed`, `repair_inspector`, `verify_placed`, `perf`, `read_srt` and `chop_srt` (the last two work on `.srt`
files without Resolve).

## Project structure

```
main.js                    Entry point Resolve loads (manifest.xml); just requires src/main
manifest.xml               Plugin id, name and entry file for Resolve
Install El Subtitle Animator.command   The installer
src/
  main/                    Electron main process (CommonJS modules), one concern per file
  preload.js               window.sa: the panel's API, one function per IPC channel
  python/
    fusion_bridge.py       Long-running helper for the Fusion work the JS API cannot do
    subject_tracker.py     Track Subject (OpenCV, own virtual environment)
  renderer/
    index.html             The panel; loads the CSS and JS below, in order
    css/                   Stylesheets, split by section (order = cascade order)
    js/                    Panel scripts (classic scripts sharing one global scope)
mcp/el-sa-mcp.js           MCP server for Claude Code (stdio, no dependencies)
tools/                     Dev checks and preset generators (not installed)
test/                      Tests (not installed)
  helpers/                 Electron stub, temporary data folder, fake Resolve API
  main/                    Node tests for src/main
  python/                  Python tests for fusion_bridge.py, with a fake DaVinciResolveScript
  fixtures/                Small preset files and the recorded module exports
```

[ARCHITECTURE.md](ARCHITECTURE.md) describes each module, the conventions, and why presets are placed as title
templates. [CONTRIBUTING.md](CONTRIBUTING.md) has the rules for changing the code. [CHANGELOG.md](CHANGELOG.md) lists
what changed.

## Development

```bash
npm install        # dev tools only (ESLint, acorn)
npm run check      # ESLint + panel script load-order check + Inspector guard
npm run lint:py    # pyflakes on the Python sources (python3 -m pip install -r requirements-dev.txt)
npm test           # all tests: Node (test/main) and Python (test/python)
```

### Tests

The tests run without DaVinci Resolve, without Electron and without your data folder: `electron` is a stub, Blackmagic's
addon is replaced by a fake Resolve object model (`test/helpers/fake-resolve.js`), the Python helper imports a fake
`DaVinciResolveScript` (`test/python/fakes/`), and every data path points at a temporary folder.

```bash
npm run test:js                              # Node tests only
npm run test:py                              # Python tests only
node --test test/main/resolve.test.js        # one file
npm run test:update-exports                  # after adding or moving an exported function on purpose
```

They cover the timeline logic (track picking, the cut guard, timecode, subtitles, regrouping), reading Fusion
`.setting` files, the editing rules, sound levels, the helper's request loop and retry rules, and a set of contract
checks: every module loads, every imported name exists, every IPC channel has a handler, every bridge operation the
panel calls exists, and Resolve's entry points are in place.

What they cannot cover is anything Resolve itself does: whether a title renders, whether the Inspector shows its
controls, how a composition behaves. Those are checked by hand in Resolve; see the checklist in
[CONTRIBUTING.md](CONTRIBUTING.md).

To turn on debug logging, run with `SA_DEBUG=1`. The log goes to `_debug/preview-log.txt`.
