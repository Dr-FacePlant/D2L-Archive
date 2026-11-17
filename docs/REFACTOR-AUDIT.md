# Refactor audit — 2026-11-17

Status: all seven findings are fixed in the working tree. The new
`tests/test-dashboard-wiring.mjs` fails if any of them comes back; it was run
against the pre-fix files and reported all of them.

## Scope

22 refactor commits between the last pre-refactor runtime commit (`750c13f`) and
`HEAD`, touching `src/dashboard` and `src/background`. The audit compared each
commit's removed code against the code that replaced it, then ran five static
checks over the current tree.

Checks run:

1. Cross-module reference check: every `const { … } = mod` / `= dash.appModules`
   name, every `mod.x`, every `dash.x` against the union of `Object.assign`
   exports.
2. Action coverage: every `data-action="…"` emitted in markup against the
   handlers in `app-events*.js`.
3. Dataset contract: every `dataset.x` read against the `data-x` attributes the
   render files emit.
4. Undefined call scan: every `name(` in each dashboard file against the names
   that file declares, plus browser globals.
5. Pre/post token diff per refactor commit: identifiers, property paths and
   string literals removed without a replacement.

The project's own suite (`npm test`, 75 groups) passes with all of these bugs
present. It loads only the model and render modules; it never executes
`app-events*.js`.

## Live bugs, all introduced by the refactor

### 1. "Check this off when it's done" never saves — `src/dashboard/app-events.js:205`

Pre-refactor (`750c13f:src/dashboard/app-events.js:1341-1345`):

```js
if (event.target.matches("[data-action=toggle-checklist]")) {
  await setChecklistDone(event.target.dataset.taskId, event.target.checked);
  render(location.hash);
  return;
}
```

Now:

```js
setChecklistDone(target.dataset.entityId, target.checked);
if (state.detail) state.baseStale = true;
```

The markup writes `data-task-id` (`src/dashboard/render-details.js:27`), so
`dataset.entityId` is `undefined`. `setChecklistDone` returns early on a falsy
id (`src/dashboard/app-plumbing.js:37`). The checkbox toggles visually, nothing
is written, and reopening shows it unchecked. The `render(location.hash)` call
was also dropped, so even a correct save would not redraw the progress line.

Fix: read `target.dataset.taskId`, then `render(location.hash)`.

### 2. ReferenceError on Tab inside a detail — `src/dashboard/app-events.js:185`

`detailRoot()` is called but `detailRoot` was dropped from the destructure at
the top of the file. Pressing Tab while a detail is open throws
`detailRoot is not defined` and the focus trap stops working. Exported by
`src/dashboard/app-render.js:347`.

### 3. ReferenceError when the tab regains focus — `src/dashboard/app-events.js:277`

`renderSyncStatus()` is called on every `visibilitychange` but was dropped from
the destructure. Switching back to the dashboard tab throws
`renderSyncStatus is not defined`. Exported by `src/dashboard/app-sync.js:182`.

### 4. "Remind me to sync" does nothing — `src/dashboard/render-settings.js:76`

Pre-refactor (`750c13f:src/dashboard/app-events.js:1355-1358`) the change
handler saved the setting:

```js
if (event.target.matches("[data-action=set-reminder]")) {
  await saveSettings({ reminderHours: Number(event.target.value) });
  renderSyncStatus();
}
```

That branch was dropped when the change listener was rewritten. The select still
renders, so it silently changes nothing.

### 5. EPUB page buttons do nothing — `src/dashboard/render-details.js:239`

Pre-refactor (`750c13f:src/dashboard/app-events.js:1006-1007`):

```js
if (action === "epub-prev" || action === "epub-next") {
  turnEpub(action === "epub-prev" ? -1 : 1);
}
```

The branch was dropped from the action dispatcher. `turnEpub` is still exported
(`src/dashboard/app-preview.js:345`); only the caller is gone.

### 6. Textbook cover size cap and resize never apply — `src/dashboard/app-events-shelf.js:49,57`

```js
if (file.size > dash.TEXTBOOK_IMAGE_BYTES_LIMIT) { … }
const side = dash.TEXTBOOK_IMAGE_MAX_EDGE;
```

Neither constant is defined or exported anywhere (`model-textbooks.js` exports
`TEXTBOOK_FILE_BYTES_LIMIT` for the 25 MB book file, not these). The comparison
is always false and `side` is `undefined`, so a 20 MB cover is read, kept at full
resolution, and encoded. The 5 MB toast in the code never fires.

### 7. Dead destructure — `src/dashboard/app-events.js:10`

`peekLeaving` is destructured from `mod` but no module exports it. Harmless
today because nothing calls it; it hides the same class of mistake as items 2–3.

## Fixed earlier in this thread

- `location.hash = ;` syntax error in `select-day` (`043e359`).
- `handleActionClick is not a function`: the module did not parse, so nothing was
  exported.
- Detail close walked browser history twice and left the D2L tab (`219c66e`).

## Checked and not a regression

`nav-select` and `pick-grade-course` handlers were also dropped, but no markup
has emitted either action since before the refactor, so nothing changed.

## Why the skill allowed this

What `/refactor` does today:

- `scan` runs heuristic finders only: commented-out code, comment habits, unused
  imports/functions/files, duplicate code, long functions, oversized files and
  folders, circular imports, design tokens, inline style/script, stylesheet
  placement, markup in JS strings. None of them parse references or run code.
- `clean` fixes one kind at a time, at most 5 findings per batch, and after each
  batch runs `verify` (the project's test command) and `scan --out`, keeping the
  batch only if the tests pass and no new finding appears.
- Kind 5 ("long function") tells the model to "split into named steps"; kind 6
  tells it to "split into files named for their one job". Both invite rewriting,
  not moving.

The model followed those instructions. The gate it was given cannot see wiring:

- The test command passes because no test executes the controller files. The
  dashboard loader (`tests/test-dashboard-loader.mjs`) loads only model and
  render modules; `test-dashboard-static.mjs` greps source text.
- `scan` has no `no-undef` rule and no reference check, so `detailRoot`,
  `renderSyncStatus` and `peekLeaving` are invisible to it.
- Nothing checks that a `data-action` still has a handler, or that
  `dataset.x` matches the emitted `data-x`.
- "Tests pass" was treated as "behavior preserved", which it was not.

So: not an accident, and not disobedience. A 1,558-line file was split into six
files in one batch, the model rewrote handlers while moving them, and the only
safety net was a suite that never loads the result.

## Suggested skill changes, highest value first

1. **Add `no-undef` to `scan`.** Bundle a small parser (acorn) and report
   identifiers used but never declared, imported or destructured. This alone
   catches items 2, 3 and 7 before a batch is kept.
2. **Add contract checks.** Every emitted `data-action` must appear in a
   handler; every `dataset.x` read must have a matching `data-x` attribute.
   Both are text-level and fit the existing finder shape. Catches item 1.
3. **Make "splits are moves" a hard rule.** Decomposition may cut and paste but
   must not rename identifiers, drop statements or invent constants. After each
   batch, run a token diff and list every identifier or string literal removed
   without a replacement; any entry must be explained or the batch is undone.
   Catches items 1, 4, 5 and 6.
4. **Gate on coverage, not on "tests exist".** If the changed file is never
   loaded by the test command, treat it as "no tests" and restrict the batch to
   kinds 1–3. Today a file can be split, never executed, and still pass.
5. **Add a behavioral smoke test.** A headless page loads `dashboard.html` with a
   stubbed `chrome` API, clicks every `[data-action]` and fails on any console
   error. This is the only check that would have caught all six bugs at once.
6. **Keep the batch small for splits.** One new file per batch when kind 5 or 6
   touches a controller, so a bad move is a two-line undo instead of a
   six-file rewrite.
