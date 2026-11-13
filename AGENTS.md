# Agent notes: layers and shared code

Read this before adding or editing code. The codebase is being refactored into layers (plans: `../UI_REFACTORING_PLAN.md`,
`../FULLSTACK_REFACTORING_PLAN.md`, each with a Progress section). Every change should use the shared modules below
instead of writing its own copy, and put new code in the layer it belongs to.

## Always

- Run `npm run check` (ESLint, load order, Inspector safety) and `npm test` (main, renderer and Python tests).
- The panel (`src/renderer/`) is classic `<script defer>` files sharing one global scope: no bundler, no ES modules.
  A new script goes into `index.html` **in layer order** (`tools/check-load-order.js` fails otherwise).
- `src/renderer/js/components/preset-preview.js` has a PROTECTED block. Don't change it without the owner's approval.
- Main-process exports are pinned by `test/main/contract.test.js`. When you add or remove an export on purpose, run
  `npm run test:update-exports` and check the diff.
- See CLAUDE.md for the Resolve rules (never replace a kept clip's Fusion comp; sync to the installed copy before testing).

## Panel: what to use

Load order, and the direction of dependencies (a file may use only what loads before it):
`core/bootstrap, helpers` → `core/color, storage, ipc-queue` → `ui/dom, status, tabs, inspector-row` → features (`design/`,
`timeline/`, `stage/`, `library/`) → `app/`.

Feature folders (one concern per file; add to the file that owns the concern, or a new file in the folder):
- `library/effects/` state · glitch · transform · list (cards) · track · spotlight
- `library/broll/` state · form · preview · place · auto · placed · tab
- `library/presets/` menu · tags-section · reorder · view · list (cards) · variants
- `library/prompt/` parser · migrations (pure) · default · catalog · editors · builder · view · saved · tab
- Pure parts next to their component: `components/text-boxes/split.js`, `components/sound-layers/geometry.js`,
  `timeline/clip-controls/row-links.js`, `timeline/anim-timing/math.js`
- Start-up: `app/init.js` only calls each feature's `init*()` in order (`initUseTab`, `initCreateEditor`, `initCreateDraft`,
  `initPanelToggles`, `initSfxOriginals`, `initTagsSection`, `initMainTabs`, `initHeader`, ...). New wiring goes in the
  feature's own `init*()`, not in `initApp`.

| Need | Use (file) | Instead of |
| --- | --- | --- |
| Build elements | `createEl(tag, 'class', text)` or `createEl(tag, { class, text, onclick, dataset, style, ...attrs }, kids)` (`js/ui/dom.js`) | `document.createElement` + manual setup, private `mk`/`el` helpers, HTML strings with user text |
| Hex ↔ 0..1 RGB | `hexToRgb(hex[, digits])`, `rgbToHex(r, g, b \| [r,g,b])`, `normHex`, `hexToRgb01`, `rgb01ToHex` (`js/core/color.js`) | a local `toString(16).padStart(2)` copy |
| A design token in canvas code | `cssVar('--cut-pause', '#e5604f')` (`js/core/color.js`) | a hex literal in JS |
| Per-computer settings | `store.get / set / getJSON / setJSON / flag / setFlag / remove` (`js/core/storage.js`), never throws | raw `localStorage` in try/catch |
| Send to Resolve while a value changes | `createThrottledSender(send, { ms, mode: 'throttle' \| 'debounce' })` → `push(values, now)`, `flush()`, `cancel()`, `sentAt` (`js/core/ipc-queue.js`) | a private `setTimeout`/`clearTimeout` pair |
| Status line | `setStatus` (main), `setCreateStatus`, `setPromptStatus`, `brStatus`, or `showStatus(msg, kind, { target, clearAfter, fadeInCompact })` (`js/ui/status.js`) | a new `xxStatus` function |
| "Name · Saved" toast | `showToast(name, what)` (`js/ui/status.js`) | building `.saved-toast` again |
| Sub-tab bar | `bindTabGroup(root, { key, values, buttons, storageKey, onChange, panes })` (`js/ui/tabs.js`); see `presets-tabs.js`, `create-tabs.js`, `brSubTab`, `cutSubTab`, `.rv-tabs` | toggling `.on` / `aria-selected` / `data-*` / pane `.hidden` by hand |
| Slider row (caption + range + value read-out) | `sliderRow({ label, min, max, value, format, tip, onInput, onChange, onReset, onGrab, onRelease, setup, cls })` (`js/ui/inspector-row.js`) | another `.fx-strength` row built by hand |
| Popover, menu, confirm | `openPop`, `openConfirmPop`, `closePop` (`js/ui/popovers.js`) | a custom show/hide dropdown |
| A `⋯` menu of secondary actions | `bindProxyMenu(btn, holder)` (`js/ui/popovers.js`): the real buttons stay in a `.hidden` holder with their ids and handlers | a row of ghost buttons beside the primary action |
| Mode switch (segmented control) | `.seg` (or the existing `.presets-tabs`, `.pr-mode`) + `bindTabGroup` (`css/primitives.css`) | a new pill-bar style |
| On / off option | `<label class="inset-row">` text + `<input type="checkbox" class="switch">` inside an `.inset-group`, with `.inset-title` / `.inset-caption` (`css/primitives.css`) | a bare checkbox with its explanation inline |
| App-wide setting | a row in the Settings sheet (`#settingsSheet`, panes Style / Placement / App; `openSettingsSheet(pane)` in `js/ui/settings-sheet.js`) | a new header button |
| Frame range bar, word lane | `frameRangeBar`, `wordLane` (`js/components/frame-range.js`), the reference component shape | a new range bar |
| Prompt text format | `parseJobPrompt`, `serializeJobPrompt`, `pbParse*` / `pbJoin*`, `pbSplitFont(v, fonts)` (`js/library/prompt/parser.js`); prompt upgrades in `prompt/migrations.js` | parsing prompt text inside UI code |

Rules for panel code:
- **Shared code takes values and callbacks.** `js/core`, `js/ui` and `js/components` never read `state`, `CTX` or storage;
  feature files own their state and keys.
- **Pure logic goes in its own file with a test.** Parsers, geometry and timing maths go next to their feature
  (e.g. `library/prompt/parser.js`) and are tested in `test/renderer/*.test.js` (`loadPanelScripts` in `test/helpers/renderer.js`
  runs panel files in Node without a DOM).
- **Big files get no bigger.** `text-boxes.js`, `sound-layers.js` (IIFE components) and `anim-timing.js` are still
  large: put new pure helpers in their folder (`text-boxes/`, `sound-layers/`, `anim-timing/`) and call them from the IIFE.
- **Update nodes that changed.** Don't clear and rebuild a container on every poll or drag tick.

### Styling
- All colours, radii, font sizes, spacing, layers and timings come from `css/tokens.css` (loaded first). Use
  `var(--radius-md)`, `var(--font-sm)`, `var(--space-3)`, `var(--z-pop)`, `var(--line-strong)` and so on.
  **Need a new colour? Add a token first.** Then use it from CSS and, through `cssVar()`, from canvas code.
- No inline `style="..."` in `index.html` or template strings. Use a class (`.hidden`, `.row.gap-sm`, `.svg-defs`, a feature class).
- Feature CSS lays out and scopes. It doesn't redeclare `.ghost`, input focus rings or card borders.
- Highlights use the app palette tokens `--matcha` / `--strawberry`; the Cut tab kinds are `--cut-*` / `--mark-*`.
- Surfaces read by tone, not outlines (plan: `../APPLE_UI_DESIGN_PLAN.md`): `--bg` → `--card` → `--card-inner` (inset group) →
  `--surface-raised` (a control on an inset group); `--surface-pop` for sheets and popovers. Dividers inside a group are
  `--hairline`. One `button.primary` (matcha fill) per view; selection is matcha; `--strawberry` is for destructive
  actions and `--playhead` for playheads.

## Main process: what to use

| Need | Use | Instead of |
| --- | --- | --- |
| Read a file many times (preset `.setting`, templates, JSON) | `fileCache(name, { max })` (`src/main/cache.js`): `.text(file)`, `.value(file, 'name', make)`, `.prime(file, text, values)` after writing it, `.invalidate(file)` | a private `Map` keyed by mtime, or `readFileSync` on every call |
| Remember what Resolve / the Python helper said (not a file) | `memoCache(name, { max })` (`src/main/cache.js`): `.fresh(key, maxAgeMs)`, `.entry(key)` (any age), `.set`, `.delete`; see `anim-timing.js` | a private `Map` with `{ at, value }` |
| An MCP tool's arguments | its schema in `src/main/tool-schemas.js` (the MCP script lists it, `automation.js` checks calls with `checkToolArgs`) | a schema only in `mcp/el-sa-mcp.js`, or ad-hoc checks |
| Planning a placement without Resolve (tags, MultiText split, boxes, sizes, layout) | `src/main/auto-plan.js` | logic inside a tool handler |
| The automation session (placed clips, current timeline, wait until the panel is free) | `src/main/auto-session.js` | module state in `automation.js` |
| A preset's text and values worked out from it | `presetText(file)` / `derived(file, name, make)` (`fusion-setting.js`, on the shared `presets` cache) | re-reading or re-regexing the preset |
| `library.json` | `loadLib()` (a structuredClone per caller) / `saveLib(lib)` (`library.js`) | reading the file yourself |
| `edit-rules.json` | `loadRules()` / `saveRules(r)` (`edit-rules.js`) | reading the file yourself |
| Timing a slow path | `PERF.span(name)` / `timed` / `record` (`perf.js`); module counters with `PERF.addSummarySource(name, fn)` | `console.time` |
| Timeline reads in one operation | the operation's `takeSnapshot` / `findItemsByIds` (`timeline-snapshot.js`, `resolve.js`) | another `GetItemListInTrack` walk |
| Fusion work | `bridgeCall(op, args, { lane })` (`fusion-bridge.js`) | a new Python process |

- A cache hands out copies when callers may change what they get. Its hits, misses and evictions show in the perf summary
  (`caches`; MCP `perf`, Fusion popover > Performance).
- Never cache: the automation auth token, the live playhead or selection, drag/scrub state, the `applying` /
  live-session locks.
- New MCP tool: add its schema to `tool-schemas.js`, a one-line route in `automation.js` `TOOLS`, and the work in a
  service module (like `auto-place.js` for `place`). New IPC channel: handler in `ipc.js`, name in `preload.js`
  (`contract.test.js` checks both sides).
- Module layout: `module.exports` is at the top of most files, so a `const` it names must be declared above it (or the
  export list goes at the end, as in `broll-words.js`). The contract test fails with "Cannot access ... before
  initialization" otherwise.
- Pure B-roll logic is in `broll-words.js` (spoken-word matching) and `broll-suggest.js` (suggestions); `broll.js` keeps
  the render worker, Resolve and files.

## Not built yet (planned; don't start these as a side effect of another change)

- `createCombobox` / `openMenuPop` for the two custom dropdowns (`pbAddList`, `cfgAudioOrigDropdown`).
- Splitting `src/python/fusion_bridge.py`. It runs as `__main__`, so a section module that imports `fusion_bridge` gets a
  second copy with its own caches. First move its shared state and core helpers into a `bridge_core.py`, then the op
  sections, and test it in Resolve.
- Splitting the render worker out of `broll.js` (`worker` / `current` / `cancelAsked` are reassigned from several sections).
- Flipping the `promiseApi` / `renderProcess` defaults (benchmark in Resolve first).

## Before you finish
- `npm run check` and `npm test` pass; any new pure module has a test.
- New scripts are in `index.html` in layer order; new styles use tokens.
- You added no duplicate helper, hex literal, inline style or raw `localStorage` call.
- If you completed a plan step, update that plan's Progress section.
