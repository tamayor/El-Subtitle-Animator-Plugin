---
name: elsa-prompt
description: Run the job prompt from El Subtitle Animator's Prompt tab on the current DaVinci Resolve timeline. Use when the user types /elsa-prompt.
argument-hint: "[extra instructions for this video, e.g. tracks 3-5, skip first 10 subtitles]"
---

Read the job prompt that the El Subtitle Animator panel's Prompt tab saves to:

`{{JOB_PROMPT}}`

Carry it out exactly as if the user had pasted that whole prompt into this chat.

- If the file is missing, tell the user to open the El Subtitle Animator panel (with the updated plugin installed) and click the Prompt tab once, which writes the file, then stop.
- Follow the el-subtitle-animator MCP workflow (get_rules first, etc.) while doing it.
- SETTINGS HIGHLIGHT_BOX (e.g. `auto · width 1.00 · height 1.00 · x 0.000 · y 0.000`) goes to set_rules as `highlight` {auto, width, height, x, y}; every highlight preset placed afterwards gets it. If the user changes it after placing, call adjust_highlights.
- Keep Resolve responsive: send place / place_stack / get_frame / remove_placed / run_script calls one at a time (wait for each result). Never read or change a placed clip's Fusion comp with DaVinci Resolve run_script (GetFusionCompByIndex / GetToolList / GetInput / SetInput): it can freeze Resolve. Sizes and fonts come from place's `inspector` result or `inspect_placed`; enabled subtitles from list_subtitles (`enabled` / `activeOnly`). If a call times out, stop and tell the user; don't retry or relaunch Resolve.

Extra instructions for this run. They override the saved prompt where they conflict, e.g. a track range named here beats the panel's or the prompt's own:

$ARGUMENTS
