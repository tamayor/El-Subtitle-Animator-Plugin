# Contributing

Notes for anyone changing El Subtitle Animator, people and AI assistants alike. [ARCHITECTURE.md](ARCHITECTURE.md)
explains how the code is laid out and why.

## Before you start

```bash
npm install
python3 -m pip install -r requirements-dev.txt    # pyflakes; the rest only for tools/ scripts
```

Work on a branch, not on `main`. Keep commits small and say what moved or changed in the message.

## Rules that protect the user's work

1. **Never replace the Fusion comp of a clip the user keeps** (`ImportFusionComp`, `LoadFusionCompByName`,
   `AddFusionComp`, `comp:Paste`, `tool:LoadSettings`). It empties Resolve's Edit-page Inspector for that clip. Presets
   go in as title templates through `presetTitleFor` (`src/main/title-templates.js`) and
   `InsertFusionTitleIntoTimeline`. `npm run check` fails on such a call without an `// inspector-ok: <reason>` comment.
2. **Never read a follower-driven text from a script** (`GetInput` / `GetValue` on a Text+ fed by a Follower). It
   freezes Resolve. Use the helper's `read_style` operation (MCP: `inspect_placed`).
3. **Never cut the user's clips.** Titles are inserted at the end of the timeline and moved into place; V1 is never
   used for a caption; the cut guard (`cutSnapshot` / `cutCheck`) compares the timeline before and after each step.
4. **`components/preset-preview.js` has a PROTECTED block.** Don't change it without the owner's approval.
5. **Keep the names other code relies on**: the IPC channels and `window.sa` functions, the MCP tool names, the
   helper's operation names, `main.js` / `manifest.xml`, and the files `config.js` points at.

## Checks to run before every commit

```bash
npm run check      # ESLint, panel script load order, Inspector guard
npm run lint:py    # pyflakes
npm test           # Node and Python tests
```

All three must pass with no warnings. When you add or move an exported function on purpose, run
`npm run test:update-exports` and commit the changed `test/fixtures/main-exports.json` with it, so the diff shows the
change in the module's surface.

## Conventions

- **Main process** (`src/main/`): one concern per file; `module.exports` first, then the `require`s; shared constants
  in `config.js`, shared mutable values in `state.js` (read as `state.x`, never destructured).
- **Resolve API calls** return `null` / `false` / an empty list on failure instead of throwing, and handles go stale.
  Give lists a fallback (`|| []`), check a project / timeline before using it, wrap optional calls in their own
  `try / catch` with a comment saying why failing is fine, and report failures of things the user asked for.
- **Round trips cost time.** Use the placement's timeline snapshot (`timeline-snapshot.js`) or `findItemsByIds`
  instead of walking the timeline again, read preset files through `presetText` / `derived`, and send Fusion work
  through `bridgeCall`.
- **Panel scripts** share one global scope and load in `index.html` order. Add a new script where its dependencies are
  already loaded; `npm run check` verifies it.
- **Adding an IPC call**: a handler in `ipc.js` and a matching line in `src/preload.js`.
- **Adding a helper operation**: an `op_<name>` function and an entry in `OPS` in `fusion_bridge.py`.
- **Comments say why**, in plain words: what Resolve does that forced the code to be this way. Many of them record a
  measured cost or a crash; keep them when moving code.
- **Formatting** follows `.editorconfig`: four spaces, LF, UTF-8. Lines run long on purpose where a comment explains a
  call; there is no automatic formatter, so match the code around your change.

## Tests

Tests live in `test/` and run without Resolve (see README.md, "Tests"). When you change logic that can be exercised
without Resolve (track picking, parsing, rules, timing maths), add or update a test. To talk to "Resolve" in a test,
build a fake timeline with `test/helpers/fake-resolve.js`; in Python, use the classes in
`test/python/fakes/DaVinciResolveScript.py`.

The tests never touch the real data folder: `test/helpers/env.js` points `config.js` at a temporary folder. Keep it
that way, and don't call anything in a test that writes outside it (`presetTitleFor` and `installAllTemplates` write
into Resolve's Titles folder).

## Testing in Resolve

Resolve runs the installed copy. After a change, run `Install El Subtitle Animator.command`, quit Resolve completely
and reopen it. Then, on a scratch timeline (never the user's working timeline):

- [ ] The panel opens from Workspace › Workflow Integrations and shows the timeline's subtitles.
- [ ] Place a Text+ preset: the clip lands on the top layer, the sound on a free audio track, the subtitle is switched
      off, and nothing on V1 or the audio tracks was cut.
- [ ] Select the placed clip: the Edit-page Inspector shows its controls (not just a folded "Text+" header).
- [ ] Play it: the animation renders (not blank, not static) at the start, middle and end of the clip.
- [ ] Place a MultiText preset with an emphasised word: rows, highlight box and per-row sounds are right.
- [ ] Preview in Resolve: start, edit text and position, keep it; then start another and cancel it (the clip and its
      sound are removed).
- [ ] Timing bar, Clip controls and an Effect Preset on the selected clip.
- [ ] Library: add a preset from a file, rename it (its title template is renamed), revert, remove.
- [ ] With Claude Code: `status`, `list_subtitles`, one `place`, `inspect_placed`, `remove_placed`.
- [ ] Quit Resolve: the panel closes with it and leaves no temporary clip on the timeline.
