# D2L Archive — Pre-Release Implementation Plan

Status: **draft, not started**. No code has been modified for this plan.
Baseline version: `0.8.265`. Reference build: `src/dashboard` at the state where the
study banner (Option D) replaced the sponsor slideshow + attention bar.

This plan does six things in order:

1. Freeze the current working state in git (so every later step is a reversible commit).
2. Archive the ChatGPT integration out of the shipped extension.
3. Make course-file downloads opt-in.
4. Remove the sponsor/ad system completely.
5. Repo hygiene: .gitignore, LICENSE, docs/tests/tools moved, personal artifacts excluded.
6. Store polish: icons, rebrand to "D2L Archive", privacy policy, packaging script.

God-file splits were originally out of scope for the release (Phase 7). The user
reversed that on 2026-10-19 and asked for them before shipping; Phase 7 is complete.

---

## Ground rules

### Verification protocol (run after every phase)

**I can run** (fast, deterministic):

```bash
node run-local-checks.mjs            # syntax sweep + core test subset (~100 tests)
node test-background-module-loading.mjs
node validate-extension.mjs
```

Plus static gates per phase (grep counts, `node --check`, manifest parse).

**You have to do** (only possible in a real browser):

1. `chrome://extensions` → Reload.
2. Open the dashboard; confirm: study banner renders, What's Next / Recent Updates /
   grades render, no red errors in the service-worker console.
3. Settings opens and all sections render.
4. Run "Sync now" once; confirm activity history records it.
5. Open an old course from a past term (archive still readable).
6. Open one file preview (cache path works).

### Baseline first (do this before any edit)

Record the pre-change result so regressions are detectable:

```bash
node run-local-checks.mjs | tail -5        # save the pass/fail counts
node validate-extension.mjs | tail -5
```

If the baseline is already red, fix or document that test *before* starting Phase 1 —
otherwise every phase inherits a broken signal.

### Rollback strategy

- Phase 1–4 are **git commits**; revert = `git revert <sha>` or `git checkout <sha> -- <path>`.
- Phase 1 also produces a standalone archive so the ChatGPT feature can be restored
  without git history.
- Phase 3 archives `ads.js` + `sponsors.json` into the same archive folder.
- No phase touches the user's `~/Downloads` data.

### Naming/placement constraints

- **Never create `_`-prefixed files or folders inside the extension directory.**
  Chrome refuses to load unpacked extensions with reserved names. All archives live
  one level up: `outputs/_archive-*`.
- The store ZIP must contain only: `manifest.json`, `background.js`, `content.js`,
  `popup.*`, `dashboard.html`, `src/` (minus `src/verify`), icons. Tests, tools,
  docs, fixtures stay out (Phase 5 adds the packaging script).

---

## Phase 0 — Freeze the working state

**Goal:** every later phase is a clean diff and an easy revert.

### Steps

### 0a. Reconcile the one known-red check (done 2026-10-19)

The frozen baseline included the study banner, which removed the dashboard attention
bar. `test-dashboard-review-fixes.mjs:300` (A3) asserted that bar and failed.
Updated in place to assert the study-banner contract instead (`class="promo study-banner"`,
no `attention-bar`, `Upcoming quizzes` when `soonQuizzes` is non-empty, otherwise
`Nothing to study for right now.`), keeping the model-level `dashboard.attention`
assertion intact. **Baseline is now fully green.**

### 0b. Artifacts: move vs gitignore (corrected after inspection)

Two different classes, handled differently:

**Move out** (nothing reads them; they hold real data/paths), to
`../_dev-artifacts-2026-10-19/{personal-artifacts,dev-state}/`:
- `ACCOUNT-ISOLATION-BASELINE.json` — real account id + counts
- `remaining-extraction-audit-*.{md,json}` — local paths, 534 real rows
- `.claude/` — dev state
- `dev-fixtures/chatgpt-real-files/` — empty ChatGPT fixture dirs

**Gitignore only, keep on disk** (the test suite reads them *unconditionally*, so
moving them turns the baseline red):
- `dashboard-test-exports.json` — read by `test-overlay`, `test-dashboard-contextual-navigation`,
  `test-dashboard-live-search`, `test-dashboard-review-fixes`, `test-primary-page-layout`,
  `test-dashboard-screens`, `dev-dashboard-preview`. Contains `~/Downloads/D2L Export`
  and real course labels.

**Keep tracked** (synthetic, test dependencies):
- `fixtures/semantic-organizer-v1.json` (fake org units `900001`…)
- `refactor-baseline-contract.json` (message-name contract, no personal data)

### 0c. Planning doc + LICENSE

- This plan lives at `docs/PRE-RELEASE-IMPLEMENTATION-PLAN.md`.
- `LICENSE` (MIT) added **now**, not Phase 4, because the repo is public from day one;
  a public repo without a license is "all rights reserved".

### 0d. Commit

`git init`, `git add -A`, commit `chore: baseline v0.8.265 with study banner`.

### Verify

- `node run-local-checks.mjs` → `All local D2L extractor checks passed.` (log saved to
  `../_dev-artifacts-2026-10-19/baseline-logs/`).
- `node validate-extension.mjs` → `0.8.265 static validation passed`.
- `git ls-files` contains no `ACCOUNT-ISOLATION-BASELINE`, no `remaining-extraction-audit`,
  no `dashboard-test-exports.json`.
- Reload extension once; dashboard still shows the study banner (frozen reference build).

**Rollback:** delete `.git`, restore artifacts from `_dev-artifacts-2026-10-19/`.

### 0e. Push gate (do NOT push until this passes)

The repo is public from day one, so sanitize before the first push — a force-push
cannot un-publish anything already fetched. **All items below are DONE as of
2026-10-19** (before the Phase 0 commit):

- The real D2L account id (the 9-character `accountId` from the live baseline) appeared
  in `test-account-legacy-adoption.mjs` (×4), `test-account-isolation-registry.mjs` (×3)
  and `ACCOUNT-ISOLATION-PLAN.md` (×2): replaced with the synthetic `TestAcct1`;
  both affected tests re-run green.
- Absolute home paths appeared in 8 docs and `test-download-paths.mjs`: rewritten to
  `~/…` (the test uses `/Users/student/…`, still an absolute path) — that test re-run green.
- Gate commands (both must return 0 hits in tracked files):
  `rg -n "<your-macos-username>" --glob '!*_backup*' --glob '!_dev-artifacts*'` and
  `rg -n "<the live accountId from ../_dev-artifacts-2026-10-19/personal-artifacts/ACCOUNT-ISOLATION-BASELINE.json>" .`
  (the literal id is intentionally not written down in this repo).
- Not treated as leaks (decided): `kennesaw.view.usg.edu` and course org-unit ids
  appear throughout the tests and in `manifest.json` host permissions; the institution
  is inherent to the current build, and org-unit ids carry no student identity.
  Revisit only if the extension is generalized to other schools (Phase 5+).

---

## Phase 1 — Archive the ChatGPT integration

**Scope:** ~165 KB, 15 files. Touches 4 non-chatgpt files with small, precise edits.
Zero dashboard/D2L/shared-code dependencies (verified).

### 1a. Build the archive (before deleting anything)

Create `outputs/_archive-d2l-chatgpt-2026-10-19/` containing:

```
source/
  src/chatgpt/{content,flow,card,main-world,project-sync}.js
  src/shared/chatgpt-protocol.js
  src/background/chatgpt-context.js
tests/
  test-chatgpt-{flow,course-files,main-world,protocol,project-sync,presentation-contract,card,dev-reload}.mjs
touched-originals/          # exact pre-removal copies for straight restore
  manifest.json
  background.js
  run-local-checks.mjs
  test-background-module-loading.mjs
docs/
  PROJECT-STATUS-CURRENT.md         # for its chatgpt sections
  AI-PROJECT-HANDOFF.md             # version-marker coupling note
  CHATGPT-FEATURE-NOTES.md          # 1-page features/limits summary (write it)
RESTORE.md
chatgpt-feature-v0.8.265.tar.gz     # source/ + tests/ + touched-originals/ + RESTORE.md
```

`RESTORE.md` must document, in order:
1. Copy `touched-originals/*` back over the repo.
2. Copy `source/` and `tests/` back to their paths.
3. Re-add manifest blocks (see below) and run `node run-local-checks.mjs`.
4. Note orphaned storage keys (`chatgptProject`, `chatgptMode`) are harmless.
5. The dev-reload token hash and the version-marker agreement note (handoff doc line 19).

Then delete the staging folder, keeping only the `.tar.gz` (that is the "extremely
compressed, restorable" artifact you asked for).

### 1b. Deletions (15 files)

- `src/chatgpt/{content,flow,card,main-world,project-sync}.js`
- `src/shared/chatgpt-protocol.js`
- `src/background/chatgpt-context.js`
- `test-chatgpt-{flow,course-files,main-world,protocol,project-sync,presentation-contract,card,dev-reload}.mjs`

**Keep `src/background/course-files.js`** — it is shared with the export path
(`src/background/export.js:5,261`). Only reword its stale comment at line 38.

### 1c. Edits

**`manifest.json`**
- Remove `"https://chatgpt.com/*"` from `host_permissions` (line 19).
- Remove the entire second `content_scripts` block (lines 64–69).
- Nothing else (no web_accessible_resources entries exist for it).

**`background.js`**
- Remove `importScripts` entries for `src/shared/chatgpt-protocol.js` and
  `src/background/chatgpt-context.js` (lines 19, 21); keep the `course-files.js` import.
- Remove `queryChatGptCourseFiles` / `validateChatGptPageMessage` from destructuring
  (line 55) and from the test-hooks object (lines 184–185); keep
  `buildCourseKnowledgeFiles` / `buildArchiveCourseFiles` hooks.
- Remove `reattachChatGptTabs()` and its call inside `chrome.runtime.onInstalled`
  (lines 73–84). **Keep `configureAutomaticSync`** in that listener.
- Remove `chatGptFilesInFlight` (line 116).
- Remove message handlers `D2L_CHATGPT_INJECT_MAIN`, `D2L_CHATGPT_COURSE_FILES`,
  `D2L_CHATGPT_COURSE_FILES_HASH` (lines 214–252) and `D2L_CHATGPT_DEV_RELOAD`
  (lines 254–266).
- **Keep** `D2L_DEV_RELOAD_EXTENSION` (line ~275) — that is the D2L-side reload.

**`run-local-checks.mjs`**
- Drop chatgpt syntax checks and the eight chatgpt plan entries.
- Keep the `course-files.js` syntax check.
- Move the export-parity assertions from `test-chatgpt-course-files.mjs` (the parts
  covering `buildArchiveCourseFiles` / `buildCourseKnowledgeFiles`) into a renamed
  `test-course-files.mjs` **before** deleting the original, so export coverage survives.

**`test-background-module-loading.mjs`**
- Remove `"queryChatGptCourseFiles"` from `requiredHelpers` (line 16).

### 1d. Verify

```bash
node --check background.js
node test-background-module-loading.mjs
node run-local-checks.mjs
grep -ri "chatgpt\|chat-gpt" --include="*.js" --include="*.json" . \
  | grep -v "_backup\|docs/PRE-RELEASE\|docs/history"   # expect 0 shipped-code hits
```

Browser: reload; open dashboard; sync once; confirm no service-worker errors and
no `chatgpt.com` permission shown under the extension's site access.

Commit: `feat!: archive chatgpt integration out of the shipped extension`

**Rollback:** `git revert`, or extract the `.tar.gz` and follow RESTORE.md.

---

## Phase 2 — Make course-file downloads opt-in

**Scope:** one new setting, one gate, three call-site threads, one stale-copy fix.
No automatic path currently downloads binaries (verified), so this protects the
manual/dev paths and makes the promise explicit in the UI.

### 2a. Settings plumbing (follow the existing `dashboardSettings` pattern)

- `src/dashboard/app.js:30` — add default `downloadCourseFiles: false`.
- `src/dashboard/render.js` settings section (Sync): add a `role="switch"` row like
  `toggle-course` (`render.js:1056`), label: "Download course files — saves files
  from your courses into your archive. Off by default; course data still syncs."
  Sub-copy: "When off, Sync refreshes course data only and files already saved
  stay linked."
- `src/dashboard/app.js` events block — handler mirroring `saveSettings` usage
  (`app.js:1449-1452`, handler style at `app.js:1792-1795`).
- Back-compat decision (pick one, document in the commit):
  - **A (recommended):** `undefined` → off. Older users stop accumulating files
    silently; UI shows the toggle off with a one-line note.
  - **B:** `undefined` → on. Preserves old behavior; users must opt out.
- Remove the stale copy in `render.js:1061-1062` ("deeper page and file refresh runs
  every 3 hours" — that loop no longer exists). Replace with accurate text:
  "Routine sync refreshes course data only. Files are downloaded only when you ask."

### 2b. The gate

- Central choke point: `src/background/downloads.js` (`downloadCourseFiles`).
  Reads `chrome.storage.local["dashboardSettings"].downloadCourseFiles` once per
  call and skips new downloads when it is not exactly `true` (missing → off).
  `archivedCopyFor` reuse still runs first, so files already on disk stay linked;
  skipped rows get `localPath: ""` so the manifest shape does not change.
- The setting governs every production path. `downloadOptions.downloadFiles`
  stays available as an explicit tri-state override for tests and future callers,
  but no shipped caller forces it on. Threaded through
  `src/background/export.js` (`crawlMeta.downloadFiles` → `downloadOptions`,
  and `options.downloadFiles` from `downloadApiOnlyExport`) and
  `src/background/crawler.js` (`crawlConfig.downloadFiles`).
- `background.js` `D2L_START_CRAWL` copies a tri-state `message.downloadFiles`
  into `crawlConfig`. `D2L_DOWNLOAD_API_EXPORT` already forwards `message.options`,
  so a caller may pass `downloadFiles` there.
- `src/background/same-tab-sync.js` and URL-flag exports
  (`src/content/bridges.js`) pass nothing: they follow the setting, so
  "off" means no file writes even for those runs. This deviates from the earlier
  draft (which kept the dev path forced on); the setting has to govern every path
  for the toggle-off verification to mean anything.

### 2c. Tests

Add `test-download-toggle.mjs` (node, production-loader style):
- setting off → `downloadCourseFiles` returns 0 and calls no `chrome.downloads.download`
- setting on → existing behavior
- explicit override wins over the setting
- `downloadCourseFiles` absent from storage → treated per chosen back-compat default

### 2d. Verify

```bash
node test-download-toggle.mjs
node run-local-checks.mjs
```

Browser: toggle off → "Sync now" → no new `~/Downloads/D2L Export` folder (check
timestamp); toggle on → export/crawl writes files again. Settings text matches behavior.

Commit: `feat: course-file downloads opt-in (off by default)`

---

## Phase 3 — Remove the sponsor/ad system

**The visible banner is already gone** (replaced by `studyBanner` in Phase 0's
baseline). This phase deletes the now-dead system so no ad code ships.

### 3a. Archive first

Add to `outputs/_archive-d2l-chatgpt-2026-10-19/`? No — separate folder:
`outputs/_archive-d2l-ads-2026-10-19/` with `ads.js`, `sponsors.json`,
`promo()` extract from `render.js`, slideshow extract from `app.js`, and the
`promo-controls` CSS extract.

### 3b. Deletions

- `src/dashboard/ads.js` (138 lines)
- `src/dashboard/sponsors.json`
- `render.js`: `promo(slideshow)` function (~line 156–186) — dead after the banner swap
- `app.js`: slideshow state/section (~860–893), `loadSponsorList` wiring
  (~886–888), slide handlers (`slide-prev/next/pause` actions) and auto-advance timer
- `dashboard.html`: `<script src="src/dashboard/ads.js">` tag
- `dashboard.css`: slideshow-only rules — `.promo-controls`, `.promo-count`,
  `.round-btn` (check for other users first), slideshow keyframes if unused

**Do NOT delete** the shared promo shell classes used by the study banner:
`.promo`, `.promo-art`, `.wedge`, `.panel`, `.glass`, `.promo-copy`, `.promo-label`.
The study banner depends on them.

### 3c. Loader/test updates

- `dashboard.html` script list (line ~49–56)
- `test-dashboard-loader.mjs:13-20` (remove `ads.js` from the vm load list)
- `run-local-checks.mjs` syntax list
- Any dashboard test that clicked slide controls (grep `slide-` under `test-*.mjs`)

### 3d. Verify

```bash
node run-local-checks.mjs
grep -rn "sponsor\|slideshow\|slide-next\|slide-prev\|loadSponsorList" \
  --include="*.js" --include="*.html" --include="*.json" . | grep -v _backup
# expect 0 shipped hits
```

Browser: dashboard banner still renders identically; no console 404 for
`sponsors.json`; settings About page has no sponsor copy.

Commit: `chore: remove sponsor/ad system (study banner stays)`

---

## Phase 4 — Repo hygiene

**Goal:** a repo a stranger can clone and understand; nothing personal in history.

### 4a. File moves (git mv, in one commit, with path updates)

| From | To |
|---|---|
| 20 non-README `*.md` (handoffs/status/plans) | `docs/history/` |
| `CHROME-WEB-STORE-REVIEW.md`, `VALENCE-API-MAP.md` | `docs/` (keep) |
| `test-*.mjs` (94, including the two `test-*-loader.mjs`) | `tests/` |
| `run-local-checks.mjs` | stays at root (entrypoint) |
| 11 dev tools (`validate-extension.mjs`, `verify-*`, `query-*`, `plan-*`, `audit-*`, `dev-dashboard-preview.mjs`, `live-check-dashboard.mjs`) | `tools/` |
| `src/verify/{recovery,records}.mjs` (node-only CLIs) | `tools/verify/` |
| `docs/calendar-nav-mockup-3.html` (233 KB) | `docs/mockups/` |

**Path updates required (these walk relative paths) — done:**
- `run-local-checks.mjs` — every listed path
- `tests/test-production-loader.mjs` — manifest/script roots
- `tests/test-dashboard-loader.mjs` — dashboard script paths
- `tools/validate-extension.mjs` — manifest ↔ file checks
- any test with `import "./..."` chain (grep)

### 4b. Repo files

- Extend `.gitignore`: export folders, `*.log`, `*.tar.gz`, `tools/output/`
- `README.md` — refresh: the approved 341-character blurb, features, install
  (unpacked), architecture map, test command, privacy summary, disclaimer.
- `LICENSE` — **done in Phase 0** (MIT; change holder from "D2L Archive contributors"
  if you want your name on it).
- `docs/privacy-policy.md` — see Phase 5.
- Remove empty `.claude/`, `dev-fixtures/` residue (done in Phase 0b).

### 4d. Make the export-dependent tests hermetic (needed for CI)

`dashboard-test-exports.json` is gitignored but **read unconditionally** by six tests
and `dev-dashboard-preview.mjs`; on a fresh clone they throw instead of skipping. Pick one:

- **Preferred:** guard each read with `fs.existsSync` and print
  `skipped (no local export config)` + exit 0 when absent; document in README how to
  generate the file locally. Keeps the repo public and CI green.
- Alternative: ship a *synthetic* export set as a fixture (more work; the saved-export
  tests then run everywhere).

Implemented: guards via `savedExports()` in `tests/test-dashboard-loader.mjs`,
`dashboard-test-exports.example.json` documents the format, and
`.github/workflows/ci.yml` runs the suite on push/PR.

### 4c. Verify

```bash
node run-local-checks.mjs                    # must match Phase 0 baseline
node tests/test-production-loader.mjs
node tools/validate-extension.mjs
git status                                   # clean tree
git log --oneline                            # one commit per phase
```

Browser: reload; dashboard, popup, overlay, and sync all still work (no relative
path in shipped code was touched — confirm via the reload checklist).

Commit: `chore: repo hygiene (docs/tests/tools, license, gitignore)`

---

## Phase 5 — Store polish: icons, rebrand, privacy, packaging

### 5a. Icons — done

- Create `icons/icon-16.png`, `32`, `48`, `128` (simple mark; decision needed on design).
- `manifest.json`: add `"icons": {...}` and `"action": {"default_icon": {...}}`.

### 5b. Rebrand to "D2L Archive" — done (version 0.9.0)

- `manifest.json`: `name` → `"D2L Archive"`, `description` → store blurb, keep
  `version` bump to `0.9.0`.
- `action.default_title`, popup title/header, dashboard.html `<title>`, About page,
  README, any "Student Archive" string (grep `Student Archive`).
- Keep the internal namespace `D2LDashboard` (renaming it is churn with no user value).

### 5c. Privacy policy + store assets — done (`docs/privacy-policy.md`, `docs/store-listing.md`; hosting URL still open)

- `docs/privacy-policy.md`: what is stored (local IndexedDB + chrome.storage),
  what leaves the device (D2L requests with the student's own session; nothing else),
  permissions rationale (one line each), retention/deletion (clear data, exports),
  contact. Publish as a URL for CWS (GitHub Pages or a gist-based page).
- `docs/store-listing.md`: name, 341-char blurb, detailed description, permission
  justifications, screenshot checklist.

### 5d. Packaging script — done (`tools/package.mjs`, `--dry-run`)

Build a store ZIP containing **only**:
`manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js`-family,
`dashboard.html`, `src/` minus `src/verify/`, `icons/`.
Assert: no `_`-prefixed entries, no `docs/`, no `tests/`, no `*.json` scratch.

### 5e. Verify

```bash
node run-local-checks.mjs
node tools/validate-extension.mjs
node tools/package.mjs --dry-run     # prints the file list; assert rules above
```

Browser: reload → extension name and icon correct in `chrome://extensions`, toolbar
icon visible, dashboard works, About shows new name. CWS manual: manifest parses,
single purpose statement matches, permissions list shows no `chatgpt.com`, no `tabGroups`
if retired.

Commit: `feat: rebrand to D2L Archive; icons, privacy policy, packaging`

---

## Phase 6 (required, pre-release) — Retire legacy crawl + permission trimming

Legacy crawl is retired in this release (decision locked 2026-10-19):

- [x] Deleted `src/background/crawler.js` and its crawl-only helper; kept
  `src/background/navigation.js`, which also provides tab messaging and is used by
  same-tab sync, probes, and export. Removed
  the `D2L_START_CRAWL`/`D2L_GET_CRAWL_STATE` handlers, the popup crawl UI
  (`src/popup/crawl.js` → `src/popup/extract.js` keeps Extract/Copy/Download),
  the content-script crawl triggers, and `tests/test-full-crawl-hash-trigger.mjs`.
- [x] Removed `tabGroups` from `manifest.json`.
- [x] Removed `activeTab` too: the only consumer was the popup tab lookup, which
  relies on the `tabs` permission and the D2L host permission.
- [x] No test referenced the removed paths; `tests/test-same-tab-sync.mjs` keeps a
  harmless `tabGroups` mock. Permission tables in `docs/privacy-policy.md` and
  `docs/store-listing.md` updated.

---

## Phase 7 — God-file splits (executed pre-release by user request)

Originally scheduled post-release; the user reversed that on 2026-10-19. Status:
**complete**, one commit per split, moves-only verified against pre-split backups,
full local checks + static validation + package dry-run green after each.

Actual splits (load order in `dashboard.html`):

1. **`model.js`** → `model-archive.js`, `model-updates.js`, `model-work.js`,
   `model-details.js`, `model-resources.js`, `model-dashboard.js`, `model-courses.js`,
   `model-grades.js`, `model-calendar.js`, `model-search.js`, `model-routes.js`.
   `model.js` keeps the namespace, constants, `time`, `routeFor`, `themeFor`.
   Dashboard↔courses cycle resolved with late `dash.*` calls. Commit `454b867`.
2. **`render.js`** → core helpers plus `render-dashboard.js`, `render-updates.js`,
   `render-courses.js`, `render-calendar.js`, `render-work.js`, `render-details.js`,
   `render-grades.js`, `render-resources.js`, `render-search.js`, `render-settings.js`.
   Commit `6c614cc`.
3. **`app.js`** → first extracted shared state/storage into `app-state.js`
   (commit `c3f910b`), then split into `app-plumbing.js`, `app-overlay.js`,
   `app-files.js`, `app-preview.js`, `app-appearance.js`, `app-archive.js`,
   `app-render.js`, `app-sync.js`, `app-events.js`, `app-selfcheck.js`; `app.js`
   is now startup only. Nine cross-module calls are late-bound through
   `dash.appModules`; the rest arrive as `const { ... } = dash.appModules`.
   Commit `1166aa3`.

Also fixed while mapping `boot()`: the sponsor removal had left a call to the
deleted `scheduleSlide()`, which threw on every dashboard load. Removed the call
and added a static regression guard (commit `e76bc39`).

Each split updated in lockstep: `dashboard.html` script tags, `run-local-checks.mjs`
syntax list, `tests/test-dashboard-static.mjs`, and every test that reads app
source (now via `tests/app-source.mjs`). Behavior is unchanged: the page is still
one `D2LDashboard` namespace assembled from IIFEs.

Gate per split: `node run-local-checks.mjs` matches baseline, screenshot diff of
every screen, no behavior change in the diff (moves only).

---

## Decisions (locked 2026-10-19)

1. **LICENSE:** MIT — added in Phase 0.
2. **Download toggle back-compat:** missing setting means **off**; Settings copy tells
   users files are downloaded only when they ask.
3. **Legacy crawl / `tabGroups`:** **retire before release** (Phase 6 becomes mandatory,
   not optional) — same-tab sync replaces it.
4. **Repo visibility:** **public from day one** — therefore the Phase 0e sanitization
   gate must pass before the first push, and personal JSONs never enter git history.

Still open (Phase 5 only, not blocking Phases 1–4):

5. **Icons:** design direction (monogram "D2L" on accent blue vs an archive/folder glyph).
6. **Privacy policy host:** GitHub Pages under your account, or another URL.
7. **LICENSE holder:** currently "D2L Archive contributors" — give me a name if you
   want it personalized.
