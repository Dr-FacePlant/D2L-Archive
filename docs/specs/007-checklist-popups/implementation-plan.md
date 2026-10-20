# Implementation Plan: Checklist Task Popups

## Goal

Make checklist rows behave like assignments, quizzes, and discussions: clicking a checklist opens an in-dashboard detail popup instead of changing the Type and Course filters. The popup should present a useful, read-only checklist view and preserve the underlying work-list state when closed.

## Current behavior

- `src/dashboard/model.js` groups checklist tasks by course and due date in `groupTasks()`.
- A grouped row receives a synthetic route such as `#/work?tab=upcoming&type=task&course=...`, which explains the unexpected Type and Course filter changes.
- Individual checklist rows can reach the `task` detail route, but `taskModel()` currently exposes only basic facts, description, and an Open in D2L link.
- The existing detail-layer system in `src/dashboard/app.js` and `src/dashboard/render.js` already supports task routes, focus management, back/close behavior, and restoration of the underlying list.

## Scope

Included:

- Entity-specific checklist detail routes.
- A grouped-checklist popup showing all tasks represented by a grouped row.
- Checklist title, category, description, dates, availability, course, source evidence, and D2L links where available.
- Read-only completion/status presentation when the archive has that information.
- Preservation of current tab, type filter, course filter, and scroll position after closing.

Excluded for this pass:

- Marking a checklist item complete.
- Editing checklist data.
- Any D2L write request.
- Replacing the existing grouped-row behavior for dashboard summaries unless the same popup route can be reused safely.

## Phase 1: Define route and view-model contracts

1. Add a stable checklist route format for individual items, for example `#/task/<entityId>`.
2. Add a stable grouped-checklist route format that cannot be confused with a work-list filter, for example `#/checklist/<groupKey>` or a task route carrying a serialized group identifier.
3. Extend route parsing, detail-route recognition, parent-route calculation, and navigation labels for grouped and individual checklist details.
4. Define a task detail model with explicit fields for:
   - checklist name/category
   - task title and description
   - due, available-from, and available-until dates
   - completion/status state when known
   - course identity
   - source evidence and D2L URL
5. Define a grouped checklist model containing the group title, course, date context, and ordered child tasks.

Acceptance checks:

- Routes for assignments, quizzes, discussions, individual tasks, and grouped checklists are distinct.
- Parsing a checklist route never produces `type` or `course` filter changes.
- Invalid or missing checklist IDs return the normal not-found detail state.

## Phase 2: Change checklist row navigation

1. Preserve the current visual grouping and counting behavior in `groupTasks()`.
2. Replace the synthetic grouped row filter URL with the grouped-checklist detail route.
3. Ensure individual checklist rows use their entity-specific task route.
4. Keep the row’s displayed course and checklist information, but make the row a detail trigger like other work rows.
5. Preserve the existing filter controls as the only way to intentionally change Type or Course.

Acceptance checks:

- Clicking a checklist row from All Types opens a popup without changing filters.
- Clicking a grouped checklist row opens one popup containing every task represented by that row.
- Clicking an individual task opens only that task.
- Browser Back, Close, and Escape return to the exact previous list state and scroll position.

## Phase 3: Render the read-only checklist popup

1. Reuse the existing detail shell and modal accessibility behavior.
2. Render a checklist-specific body rather than treating the task as a generic sparse detail page.
3. Show each task in a stable order with:
   - title
   - checklist/category label
   - description, if present
   - due and availability information
   - completion/status badge when available
   - D2L link for opening the source page
4. For grouped views, show a compact summary followed by individual task sections or rows.
5. Make absent fields explicit but unobtrusive; do not invent completion or due-date values.
6. Do not render editable checkboxes or controls that imply a completion write action.

Acceptance checks:

- The popup is useful even when only a title and D2L URL are available.
- Missing descriptions, dates, and completion states do not create broken layout or misleading text.
- No checklist popup contains a submit, edit, delete, or mark-complete control.

## Phase 4: Preserve D2L handoff behavior

1. Keep “Open in D2L” as the explicit action for completing or changing checklist work.
2. In the overlay, route D2L links through the existing same-tab handoff so the archive closes before D2L opens.
3. In a standalone dashboard tab, retain the existing external-link behavior.
4. Keep all checklist navigation read-only inside the extension.

Acceptance checks:

- The D2L URL remains exact and course-scoped when available.
- No checklist route invokes a D2L mutation endpoint.
- Same-tab overlay behavior remains unchanged for other item types.

## Phase 5: Targeted regression and live validation

1. Add model tests for individual and grouped checklist routes.
2. Add renderer tests for task and grouped-checklist popup contents.
3. Extend contextual-navigation tests to verify parent restoration and filter preservation.
4. Extend dashboard screen tests to cover every checklist entity and grouped checklist row.
5. Run the focused tests first, then the full local suite.
6. Validate one live checklist page read-only, comparing the popup fields with the archived row and D2L page.

Success criteria:

- Checklist clicks open detail popups rather than changing Type or Course filters.
- Grouped rows show all represented tasks.
- Closing the popup restores the exact list state.
- The popup exposes all currently archived checklist information without claiming unavailable completion data.
- Focused and full regression suites pass.
- Any D2L fields still unavailable are documented as extraction limitations, not silently omitted.

## Files expected to change

- `src/dashboard/model.js`
- `src/dashboard/render.js`
- `src/dashboard/app.js` only if route/detail restoration needs a focused change
- `src/dashboard/dashboard.css` only for checklist-specific presentation
- `test-dashboard-contextual-navigation.mjs`
- `test-dashboard-screens.mjs`
- A focused checklist popup test if the existing test boundaries do not cover the new grouped model

No extractor, API, or D2L write behavior should be changed for this UI/navigation fix.
