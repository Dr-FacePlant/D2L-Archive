# D2L Archive

D2L Archive is a read-only Chrome extension that saves your D2L course data into a local archive: courses, assignments, quizzes, grades, discussions, announcements, content, and files. Its dashboard shows what is due, what changed, and what was graded; actions open in D2L. Downloads are optional, off by default. No account, server, or telemetry.

Not affiliated with Kennesaw State University or D2L.

## What it does

- **Dashboard** — What's next, recent updates, a grade card per course, and a
  campus-only study banner for upcoming quizzes. Saved data renders first; a
  background refresh updates it from D2L when a tab is available.
- **Assignments** — assignments, quizzes, discussions, checklist tasks, and a
  **Needs attention** tab, with detail views that preserve list state and
  scroll position.
- **Courses, Calendar, Updates, Grades, Content** — course home, every event,
  announcements, grade categories and rubrics, and content in D2L's own order.
- **Search** — results open under the box as you type; Enter lists them all.
- **Overlay** — opens over D2L on a D2L tab. Every assignment, quiz, and
  discussion gets an exact handoff link to the real D2L page.
- **Read-only** — the extension never submits, posts, starts quizzes, deletes
  data, subscribes, marks content complete, or changes D2L settings. It only
  reads and archives what you can already see.
- **Local archive** — a portable folder of JSON, CSV, Markdown, and page
  snapshots plus an offline verifier and query tools.

## Screenshots

The [screenshot gallery](docs/screenshots/README.md) shows each main dashboard
page, plus course details and settings, using synthetic sample data.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open a `https://kennesaw.view.usg.edu/d2l/` page. The overlay opens on first
   visit; the extension icon or `Alt+Shift+A` toggles it.

Settings has a **Download course files** switch. It is off by default; when on,
course-file candidates are saved into the export folder as well as listed in
the manifest.

## Privacy

- Everything stays on your machine: the archive is written under
  `~/Downloads/D2L Export/`, dashboard state lives in extension-owned
  IndexedDB, and settings live in `chrome.storage.local`.
- Network requests go only to your D2L site, using your existing session. There
  is no analytics, no remote configuration, and no third-party server.
- There are no D2L writes. Submitting, posting, and quiz attempts happen only
  when you open the item in D2L yourself.

## Development

```sh
node run-local-checks.mjs     # syntax + static contract + regression suite
node tools/validate-extension.mjs
```

`run-local-checks.mjs` runs the synthetic regression suite and needs no
dependencies beyond Node 20+. The ignored `dashboard-test-exports.json` can
point local preview tools at your own exports; it is never included in Git.

```sh
node tools/dev-dashboard-preview.mjs 8791   # serve the dashboard from saved exports
```

### Repository layout

```
background.js, content.js, popup.*   extension entrypoints
manifest.json                        MV3 manifest
src/background/                     sync, storage, export
src/content/                        page parsers, overlay, school branding
src/dashboard/                      dashboard app, model, render, styles
src/shared/                         constants, URLs, rows, evidence contract
src/popup/                          extractor tools
tests/                              regression suite + synthetic fixtures
tools/                              offline verify/query/preview CLIs
docs/                               specs, field maps, history, store notes
```

Tests are not part of the packaged extension; `node tools/package.mjs` builds a
zip with only the runtime files: `manifest.json`, `background.js`, `content.js`,
`popup.*`, `dashboard.html`, `src/`, `icons/`, and `README.md`.

## Export format

An export lands in `~/Downloads/D2L Export/d2l-export-<timestamp>/`:

- `manifest.json` / `manifest.csv` — every row with source URL and local paths
- `ai-index.jsonl` — retrieval-friendly index over the archive
- `entities.json`, `relationships.json` — canonical bundles and evidence links
- `index.json`, `audit-report.md` — inventory and coverage audit
- `change-report.*`, `student-action-brief.md`, `student-questions.md`
- `courses/<course>/course.json`, `items.csv`, `items.json`
- `courses/<course>/pages/` — readable Markdown page snapshots
- `courses/<course>/files/` — downloaded content candidates (when enabled)

`export-progress.json` records the final phase, so an interrupted run still
leaves an inspectable `phase: "pre-files"` manifest.

## Verify and query an archive

```sh
node tools/verify-archive.mjs "$HOME/Downloads/D2L Export/d2l-export-..."
node tools/verify-archive.mjs "$HOME/Downloads/D2L Export/d2l-export-new" --compare "$HOME/Downloads/D2L Export/d2l-export-old"
node tools/verify-latest.mjs
node tools/query-ai-index.mjs "$HOME/Downloads/D2L Export/d2l-export-..." "quiz feedback due"
```

The verifier writes `offline-verification.md`, `offline-action-brief.md`, and
`offline-ai-index.jsonl` into the archive, and can reconstruct a partial
manifest from page snapshots when `manifest.json` is missing. `verify-latest`
picks the newest export, compares it with the previous one, and writes
`offline-smoke-query-report.json` plus `next-live-review.md`.

## Extraction coverage

Covered: active courses, content modules and files, assignments and
instructions, quiz metadata and released attempts, grade items and rubrics,
full-semester calendar, announcements, discussions, syllabus/policy tags,
classlist, external resources, and per-course capability gaps.

Partial, because D2L gates it per course and per permission: submitted-file
downloads, instructor comments, quiz question-level results, discussion grading
feedback, and tools a course disables. Each export states what it proved,
what was empty, and what still needs review instead of silently omitting it.

See `docs/VALENCE-API-MAP.md`, `docs/PRE-RELEASE-IMPLEMENTATION-PLAN.md`,
and `docs/store-listing.md` for API, release, and listing notes.

## License

MIT — see `LICENSE`.
