# Implementation Plan: Contextual navigation and detail layers

Replace disruptive item-page transitions with context-preserving detail layers, and replace taxonomy-style course breadcrumbs with obvious back navigation. Planned against source v0.8.191 on Sep 30, 2026 and completed in v0.8.192. The pre-change restore point is the project sibling `d2l-extractor-extension-0.8.191-backup-2026-09-30.zip`, with its neighboring SHA-256 file.

**Status: Complete.** All seven item route types now use the shared detail layer; course workspaces use `Back to Courses`; existing hashes and D2L handoffs are unchanged. Focused archive-backed tests and desktop/mobile browser acceptance cover direct links, Back/Forward, Close/Escape, focus restoration, canonical parents, and responsive overflow. No extraction behavior changed.

## Goal

A student can inspect an assignment, quiz, discussion, announcement, grade, checklist item, calendar event, or related content without losing the page, filters, course context, or scroll position they came from. Browser Back and Forward remain reliable, direct links still work, and course workspaces have a clear way back to Courses.

## Requirements

- **R1 Context preservation:** Opening an item retains the originating page, query parameters, filters, and scroll position underneath it.
- **R2 Detail layer:** Item details open in one large in-app modal/sheet with a visible close control, not as a replacement page.
- **R3 Predictable return:** Closing the layer or pressing browser Back returns to the exact originating state. Browser Forward reopens it.
- **R4 Direct links:** Existing hashes remain valid. Refreshing or directly opening an item route renders the item over a sensible canonical parent.
- **R5 Course navigation:** A course remains a full workspace page and uses an explicit `Back to Courses` control instead of `Courses / Course` breadcrumbs.
- **R6 Safety:** Assignment submission, discussion posting, quiz handoff, D2L links, confirmation gates, and read-only behavior remain unchanged.
- **R7 Accessibility:** Focus is trapped in an open detail layer, Escape closes it when no higher-priority confirmation is open, focus returns to the trigger, and mobile uses a full-screen presentation.
- **R8 One navigation model:** Related-item links replace the current detail inside the same layer; they never stack multiple detail layers.

## Navigation Model

### Full pages

- Dashboard
- Courses
- Individual course workspace
- Calendar
- Updates
- Assignments
- Grades
- Content
- Search, Settings, and About

### Detail layers

- Assignment
- Quiz
- Discussion
- Announcement
- Individual grade
- Checklist task
- Calendar event
- A content topic only when it has meaningful inspectable detail; module navigation itself remains on Content

### Compact modals that remain separate

- File preview
- Submission/post confirmation
- Small destructive or consequential confirmations

## Key Design Decisions

1. **Keep all existing hashes.** `#/assignment/...`, `#/quiz/...`, and the other entity routes remain canonical. Presentation changes from a full page to a detail layer; data identity and deep links do not change.
2. **Keep the base page mounted.** The detail layer lives outside `#main`. Opening an item must not call `showMain()` with a detail page or reset `main().scrollTop`.
3. **Record navigation state in `history.state`.** Each app navigation records the route, base route, base scroll position, and whether the entry represents a detail. Do not infer the origin from static breadcrumbs.
4. **Use a canonical parent only as a fallback.** A directly loaded assignment opens over Assignments; an announcement over Updates; a grade over Grades; an event over Calendar. If opened from Dashboard, Search, or a course, that real origin wins.
5. **Use one large native dialog or equivalent accessible sheet.** Desktop shows a large panel with some origin context still visible; narrow screens use the whole viewport. The layer header is sticky and includes `Back`/close, item type, title, course, and the existing D2L handoff when applicable.
6. **Do not stack entity details.** `See the grade`, `Graded work`, and similar links update the current detail route and body. Browser Back walks through those related details before closing to the base page.
7. **Action confirmation remains a separate higher layer.** Turning in an assignment or posting to a discussion still requires the existing digest-bound confirmation flow. Closing the confirmation returns to the detail layer without changing navigation.
8. **A course is durable context, not a quick detail.** Course cards still open `#/course/:id`. The course header receives `Back to Courses`; browser Back may return elsewhere when that is the actual same-app origin, but a stable Courses fallback is always available.

## Current Code Constraints

- `src/dashboard/app.js::render()` currently treats every hash as a full screen and replaces all of `#main`.
- `showMain()` assigns `innerHTML`; most route changes then reset `main().scrollTop` to zero.
- `CRUMBS` describes static taxonomy, not the page the student came from.
- `detailPage()` combines the item body, side panel, and breadcrumb into one full-page string.
- `hashchange` currently closes file previews and rerenders the main screen.
- The file viewer and action confirmation provide proven visual and accessibility patterns, but item details need a separate root and lifecycle.
- Embedded mode remembers the current hash across D2L navigation; that behavior must continue with a detail open.

## Phase 1: Lock the navigation contract

### Prime

- Read `src/dashboard/app.js` routing, hash-change, embedded route persistence, delegated click handling, and preview lifecycle.
- Read `src/dashboard/render.js` course and detail renderers.
- Read `src/dashboard/model.js::routeFor`, `detailFor`, and `parseRoute`.
- Read dashboard route/link assertions in `test-dashboard-screens.mjs`, `test-dashboard-review-fixes.mjs`, and `test-overlay.mjs`.

### Tests first

- Add a route-presentation contract classifying every route as `page`, `detail`, or `resource-focus`.
- Assert every entity type has one canonical parent fallback.
- Assert every existing route still parses and `routeFor()` output is unchanged.
- Assert the same route cannot be both a full page and a detail layer.

### Implement

- Add small pure helpers in the dashboard model for route classification and canonical parent selection.
- Keep `CRUMBS` temporarily for the old renderer until migration is complete.

### Validate

- Existing dashboard screen and link tests pass unchanged.

## Phase 2: Add context-aware app navigation

### Tests first

- Navigating from Dashboard, a filtered Assignments list, Search, and a course records the exact base hash and scroll position.
- Browser Back from a detail restores the base without rerendering it.
- Browser Forward reopens the same detail.
- A direct detail URL selects the canonical parent rather than leaving the extension or producing an empty background.
- Rapid clicks cannot let a slower bundle replace a newer detail.

### Implement

- Introduce one `navigate()` path for internal links instead of allowing unrelated hash changes to define context implicitly.
- Store app-owned entries in `history.state`, including `route`, `baseRoute`, `baseScrollTop`, and `detailRoute`.
- Intercept only same-dashboard links. External, extension-file, download, and D2L links retain their current behavior.
- Separate page rendering from detail rendering in the hash/popstate lifecycle.
- Add a render token dedicated to asynchronous detail bundles.

### Validate

- Scroll and filters survive open/close cycles on every list surface.
- Existing embedded route persistence tests still pass.

## Phase 3: Build the reusable detail layer

### Tests first

- Exactly one detail layer can exist.
- Open moves focus into the layer; close restores focus to the triggering element when it still exists.
- Escape closes the detail layer unless the action-confirmation dialog or file viewer is active.
- Backdrop click closes only when the click originated on the backdrop.
- The underlying page cannot receive pointer or keyboard interaction while the layer is modal.
- Loading, missing-item, and API-error states are rendered inside the layer without replacing the base page.

### Implement

- Add a dedicated detail root to `dashboard.html`, separate from `#main`, the file viewer, and action confirmation.
- Create a large accessible dialog/sheet with a sticky header, scrollable body, and stable dimensions.
- Desktop: preserve a visible hint of the originating page. Mobile: fill the viewport and respect safe areas.
- Add clear `Back` and close controls. Use `Back to <origin>` when a reliable human-readable origin is available.
- Add motion consistent with `prefers-reduced-motion`.

### Validate

- Visual checks at 1440x900, the user's current desktop width, 900px, 640px, and 390x844.
- No page-level horizontal overflow, clipped controls, or nested-card layout.

## Phase 4: Split and migrate detail rendering

### Tests first

- Each detail type renders the same facts, instructions, feedback, attachments, rubrics, posts, submissions, links, and status it renders today.
- All `Open in D2L` URLs remain exact.
- Assignment and discussion forms remain available only in embedded mode.
- Quizzes never start inside the archive and retain the LockDown Browser warning/handoff.
- Related detail links replace the layer body and preserve Back history.

### Implement

- Refactor `detailPage()` into a reusable detail-content renderer plus the temporary full-page compatibility wrapper.
- Migrate assignment, quiz, discussion, announcement, grade, checklist task, and event routes to the detail layer.
- Keep file previews in the existing viewer. Closing a preview returns to the same item detail and scroll position.
- Keep action confirmation above the item layer. Success receipts update the open detail without closing it.
- Decide content-topic behavior from real archived examples: meaningful topic detail uses the layer; module-only navigation stays in the Content page and expands/scrolls in place.

### Validate

- Compare rendered detail text, facts, links, forms, and file counts against every saved export in `dashboard-test-exports.json`.
- No entity becomes unreachable from its previous surface.

## Phase 5: Replace course breadcrumbs

### Tests first

- A course opened from Courses displays `Back to Courses` with a left-arrow icon.
- The control returns to the same Courses scroll position when history context exists.
- A direct course URL uses Courses as the safe fallback.
- Course links opened from a detail do not accidentally close the entire D2L overlay.

### Implement

- Replace `Courses / <course>` with a compact back control in `courseHomePage()`.
- Prefer the recorded same-app origin when appropriate; otherwise link to `#/courses`.
- Keep course pages full-screen and retain their existing Grades, Content, Announcements, Discussions, and Upcoming Work links.

### Validate

- Keyboard, browser Back, visible Back, and direct-link behavior agree.

## Phase 6: History, refresh, and embedded-overlay hardening

### Tests first

- Refreshing with a detail hash reconstructs canonical base plus detail.
- Reloading or navigating the underlying D2L page preserves the open detail route when embedded.
- Closing a directly loaded detail does not navigate outside the extension or close the Student Archive overlay.
- Forward/Back sequences across base page, detail A, related detail B, and base page are deterministic.
- Search query, course filter, work tab, calendar month/day, resource module, and scroll positions survive detail inspection.

### Implement

- Reconcile `hashchange`, `popstate`, `rememberScreen()`, and the overlay's saved route around the new navigation state.
- Persist only serializable route context; do not persist DOM references or stale bundles.
- On archive refresh/sync, keep the layer open when its entity still exists; otherwise show a clear removed-item state with a return action.

### Validate

- Run the overlay tests and an installed-extension read-only acceptance pass without starting quizzes, submitting, or posting.

## Phase 7: Accessibility, regression, and release checkpoint

### Automated validation

- Add focused navigation/detail-layer tests to `run-local-checks.mjs`.
- Run `node test-dashboard-review-fixes.mjs`.
- Run `node test-dashboard-static.mjs`.
- Run `node test-dashboard-screens.mjs`.
- Run `node test-overlay.mjs`.
- Run `node run-local-checks.mjs`.

### Interaction validation

- Open and close every detail type from Dashboard, its primary list, Search, and a course where applicable.
- Verify visible Back, browser Back, browser Forward, Escape, close button, and backdrop behavior.
- Verify focus order, focus return, long content scrolling, and screen-reader names.
- Verify file preview inside a detail and action confirmation inside assignment/discussion details.
- Verify no submission, post, quiz start, subscription, or D2L setting change occurs during acceptance.

### Completion criteria

- Item inspection never destroys the originating page state.
- Course navigation has an obvious return control.
- Every old route and exact D2L handoff still works.
- All saved-export screens and details remain represented.
- No new write path exists and current action confirmations remain mandatory.
- Version is bumped consistently in `manifest.json` and `content.js` only after implementation is validated.
- README, dashboard specification, and handoff notes describe the new navigation model.

## Recommended Implementation Order

Implement Phases 1 through 3 as the foundation, migrate one low-risk read-only type first (announcement), and validate the complete history lifecycle. Then migrate grade/event/task, followed by assignment/quiz/discussion, where forms and safety gates make regressions more consequential. Replace course breadcrumbs after the shared navigation mechanism exists, then finish the refresh/embedded and accessibility passes.

## Explicit Non-Goals

- Do not change extraction, normalization, sync, or archive formats.
- Do not replace D2L quiz-taking UI.
- Do not loosen assignment/discussion confirmation requirements.
- Do not open multiple stacked entity-detail modals.
- Do not remove deep-linkable hashes merely because details are presented as overlays.
- Do not redesign the dashboard cards, grade carousel, or primary sidebar as part of this work.
