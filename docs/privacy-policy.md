# D2L Archive — Privacy Policy

Last updated: 2026-10-21

Published at <https://dr-faceplant.github.io/D2L-Archive/privacy-policy.html>.

D2L Archive is a Chrome extension that saves the D2L course pages you can already
see into a local archive on your own computer and shows them in a dashboard. It
has no server, no account, and no analytics. This build is for Kennesaw State
University's D2L site. This page lists exactly what is stored, what leaves your
device, and how to delete it.

## Data stored on your device

- **Archive files.** When you run a sync or export, the extension writes an export
  folder under `~/Downloads/D2L Export/`: JSON and CSV manifests, Markdown page
  snapshots, and — only if you turn on **Download course files** — the course-file
  candidates it finds. These are ordinary files you can open, move, or delete.
- **Dashboard state.** Course list, read marks, done/skip marks, checklist state,
  and settings are stored in extension-owned IndexedDB and `chrome.storage.local`,
  scoped to the D2L account that produced them.
- **Per-tab state.** Whether the overlay is open and which screen it is on is kept
  in `chrome.storage.session` and cleared when the browser closes.
- **Saved previews.** Files you open in the dashboard's preview are cached locally
  (oldest first, after 300 MB) so they open faster. **Settings → Saved previews →
  Clear** removes them.

Nothing here is uploaded anywhere. It stays in your browser profile and your
Downloads folder.

## Data that leaves your device

- **Requests to your D2L site only.** The extension calls the same
  `https://kennesaw.view.usg.edu/d2l/*` pages and API routes your browser already
  uses, with your existing session. `manifest.json` lists that host as the only
  host permission.
- **No other network traffic.** There is no telemetry, no crash reporting, no
  remote configuration, no advertising, and no third-party service. The extension
  contains no analytics SDK and no remote code.

## Permissions and why

| Permission | Why it is needed |
| --- | --- |
| `host_permissions: https://kennesaw.view.usg.edu/d2l/*` | Read the D2L pages and API routes the archive is built from. |
| `scripting` | Load the content scripts that read the visible D2L page. |
| `tabs` | Find an existing D2L tab to sync in, instead of opening new tabs. |
| `alarms` | Resume queued, rate-limited sync work after a short delay. |
| `storage` | Save settings and per-account dashboard state. |
| `unlimitedStorage` | Hold the local archive index when it grows past the normal quota. |
| `downloads`, `downloads.open` | Write export files and opened previews into your Downloads folder. |

The extension requests no permission for any site other than D2L, and no
permission to read or change unrelated browsing history.

## D2L actions it can take

The extension only reads D2L. It does not submit assignments, post discussions,
start quizzes, delete data, subscribe to anything, mark content complete, or
change D2L settings. When you need to act, the dashboard opens the item in D2L
and you complete the action there yourself.

## Retention and deletion

- **Export folders** live in your Downloads folder and are yours; delete the
  folder to remove the archive.
- **Saved previews** are cleared with **Settings → Saved previews → Clear**.
- **Dashboard state and settings** are removed when you remove the extension from
  `chrome://extensions`, or by clearing the extension's site data.
- Your D2L account itself is never modified.

## Changes

If this policy changes, the updated text ships in the repository next to the
version of the extension it applies to.

## Contact

Questions or problems: open an issue on the project's GitHub repository.
