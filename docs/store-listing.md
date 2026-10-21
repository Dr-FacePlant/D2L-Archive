# Chrome Web Store listing — D2L Archive

Draft copy for the Chrome Web Store submission. Keep in sync with `manifest.json`
(`name`, `description`, version) and `docs/privacy-policy.md`.

## Name

D2L Archive

## Short description (132 characters max)

Read-only KSU D2L archive and dashboard: courses, assignments, grades, files. Local only.

## Summary (GitHub repo description, 350 characters max)

D2L Archive is a read-only Chrome extension for Kennesaw State University that
saves your D2L course data into a local archive: courses, assignments, quizzes,
grades, discussions, announcements, content, and files. Its dashboard shows what
is due, what changed, and what was graded; actions open in D2L. Downloads are
optional, off by default. No account, server, or telemetry.

## Detailed description

D2L Archive keeps a personal, searchable copy of your Kennesaw State University
D2L course data and shows it in a dashboard that answers the questions students
actually open D2L for: what is due, what changed, and what was graded.

- Dashboard: What's Next, Recent Updates, a grade card per course, and upcoming
  quizzes at a glance.
- Assignments: assignments, quizzes, discussions, checklist tasks, and a Needs
  attention tab, with detail views that keep your filters and scroll position.
- Courses, Calendar, Updates, Grades, Content: course home, every event,
  announcements, grade categories and rubrics, and content in D2L's own order.
- Search: results open under the search box as you type.
- Overlay: opens over D2L in the same tab. Every action is an exact handoff back
  to the item on D2L, where you complete it yourself.
- Local archive: a folder of JSON, CSV, Markdown, and page snapshots you can keep
  or read elsewhere, with offline verify and query tools.

Read-only. The extension does not submit assignments, post discussions, start
quizzes, delete data, subscribe, mark content complete, or change D2L settings.
It does not send your data anywhere: no account, no server, no analytics.

Course-file downloads are opt-in and off by default.

Not affiliated with, endorsed by, or made by Kennesaw State University or D2L.

## Single purpose statement

D2L Archive saves the D2L course pages a signed-in student can already see into a
local, read-only archive and displays that archive in a dashboard.

## Permission justifications

| Permission | Justification |
| --- | --- |
| Host permission `https://kennesaw.view.usg.edu/d2l/*` | Required to read the D2L pages and API routes that make up the archive. No other site is requested. |
| `scripting` | Injects the read-only content scripts that parse the visible D2L page. |
| `tabs` | Finds an already-open D2L tab for background sync instead of opening new tabs. |
| `alarms` | Resumes queued, rate-limited sync work without keeping a page open. |
| `storage` | Saves settings and per-account dashboard state locally. |
| `unlimitedStorage` | Stores the local archive index when it exceeds the default quota. |
| `downloads`, `downloads.open` | Writes export files and previews into the user's Downloads folder. |

## Privacy practices form

- **Data collected:** none. No personally identifiable information, health,
  financial, authentication, personal communications, location, web history, user
  activity, or website content is transmitted to the developer or any third party.
- **Data sold or shared:** no.
- **Data used for purposes unrelated to the single purpose:** no.
- **Remote code:** no. All code ships in the package.
- **Privacy policy URL:** https://dr-faceplant.github.io/D2L-Archive/privacy-policy.html
- **Certification:** the extension's use of data complies with the Chrome Web Store
  User Data Policy.

## Screenshot checklist

Capture at 1280×800 (or 640×400) from the real build, with synthetic or demo data
and no student names, grades, course labels, or other personal data visible. Pick
five of these:

1. Dashboard with What's Next, Recent Updates, and course grade cards.
2. Assignments → Needs attention.
3. Grades → one course with categories and a graded rubric.
4. Calendar with a populated month.
5. Search with results open under the box.
6. Settings → Sync, with **Download course files** visible.
7. About page showing the disclaimer.

Store icon: `icons/icon-128.png`. Promotional tile (440×280) is optional; reuse the
icon mark on the dashboard background color.

## Submission checklist

- [x] `manifest.json` name and version match this document; its description is
      read-only and local.
- [x] `node run-local-checks.mjs` and `node tools/validate-extension.mjs` pass.
- [x] `node tools/package.mjs` produces the store ZIP and prints only shipped files.
- [ ] Unzip the package into a clean folder, load it unpacked, and run the reload
      checklist (dashboard, overlay, Settings, sync, About).
- [x] No `_`-prefixed files, docs, tests, or scratch JSON in the ZIP.
- [ ] Privacy policy published and URL filled in.
- [x] Permission list matches the table above (no `tabGroups` or `activeTab`).
- [ ] Screenshots and 128×128 icon uploaded.
