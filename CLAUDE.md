# El Subtitle Animator Plugin

- Run `npm run check` after changes. It includes `tools/check-inspector-safe.js`.
- Never replace the Fusion comp of a timeline clip the user keeps (`ImportFusionComp`, `LoadFusionCompByName`, `AddFusionComp`, `comp:Paste`, `tool:LoadSettings`). It empties Resolve's Edit-page Inspector for that clip. Presets go in as title templates via `presetTitleFor` (src/main/placement.js) and `InsertFusionTitleIntoTimeline`. See "Presets are inserted as Resolve title templates" in README.md.
- The plugin runs from the installed copy in `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.el.subtitleanimator`, not from this repo. Sync `src/` there (or run `Install El Subtitle Animator.command`) before asking the user to test.
- `src/renderer/js/components/preset-preview.js` has a PROTECTED block. Don't change it without the owner's approval.
