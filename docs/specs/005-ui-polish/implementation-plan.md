# Implementation Plan: Detail, Assignment, and Grades UI Polish

Planned against extension v0.8.193 on September 30, 2026 and completed in v0.8.194. This plan addresses the user-reviewed modal flash and header duplication, the Assignments page's filter density, and the visual mismatch between Dashboard grade cards and the full Grades page. It does not change extraction, normalization, archive formats, D2L handoffs, or student-action safety.

**Status: Complete.** The detail shell is stable and single-mounted, the utility header is simplified, Assignments uses two secondary selectors, and Grades uses responsive dashboard-style overview cards plus a compact selected-course detail. Archive-backed regression tests and browser checks at 1280×800, 1064px desktop, and 390×844 mobile passed without page overflow.

## Goal

Make item inspection feel stable and deliberate, make assignment filtering compact without losing capability, and make Grades feel like a deeper continuation of the dashboard's grade experience rather than a separate administrative screen.

## Requirements

- **R1 Stable detail opening:** An item detail enters once. Loading completion must not remount or replay the modal entrance animation.
- **R2 Quiet detail header:** The header contains only a dark Back control and the existing close control. It does not repeat the item type or title.
- **R3 Accessible detail identity:** Removing the header title must not remove the dialog's accessible name. The final dialog is labelled by the item's main `h1`; loading and error states retain useful labels.
- **R4 Compact assignment filtering:** Keep Upcoming, Needs attention, Submitted & graded, and All as the primary segmented control. Replace the Type and Course chip collections with one compact selector each.
- **R5 Preserve filter state:** Existing `tab`, `type`, and `course` query parameters and deep links remain valid. Changing one filter preserves the others.
- **R6 Grade continuity:** Course-grade selection uses the same visual language and grade-source wording as the dashboard cards.
- **R7 Honest grade language:** Clearly distinguish a D2L-published total, an estimate from graded work, and unavailable data. Never imply that a local estimate is an official final grade or infer an unpublished letter grade.
- **R8 Faster grade scanning:** Current grade context and the beginning of the grade-item table appear substantially earlier; the trend chart no longer consumes nearly the entire first viewport.
- **R9 Responsive and accessible:** All controls remain keyboard operable, labelled, non-overlapping, and usable from 390px mobile through wide desktop.
- **R10 Safety preservation:** Assignment submission, discussion posting, quiz handoff, file preview, exact D2L links, and confirmation gates remain unchanged.

## Design Decisions

### Detail modal

1. Mount one stable detail shell per open item sequence.
2. Run the backdrop/panel entrance animation only when that shell first opens.
3. Resolve the entity bundle into the existing shell instead of replacing `#detail-root` with a second `.detail-layer`.
4. Avoid flashing a loader for fast local reads. Start a short loading threshold of approximately 120ms; if the bundle resolves first, render the final body directly. If it takes longer, show a stable loading state and update only the body when ready.
5. Keep the render token so a slow earlier request cannot overwrite a newer item.
6. Mark the body `aria-busy="true"` while loading and remove it after success/error.
7. Header layout is Back on the left and Close on the right. The Back hover uses the same quiet neutral background family as the close button and keeps dark text.
8. The body owns the visible and accessible title. The panel's `aria-labelledby` points to the item's `h1` after content loads.

### Assignment filters

1. Keep the four status tabs unchanged because they represent the student's primary workflow.
2. Replace the five type chips with a labelled select/menu: `Type: All types`.
3. Replace the course chips with a labelled select/menu: `Course: All courses`.
4. Put both secondary filters in one compact row beside or directly below the status control, depending on available width.
5. Use the existing single-selection model. Do not introduce multi-select, a filter drawer, or hidden state.
6. Keep every existing filter URL valid so bookmarks, Back/Forward, and contextual-detail restoration continue to work.

### Grades page

1. Replace the plain course dropdown as the primary desktop selector with a responsive course-grade overview using the dashboard card's visual language: course identity, prominent value, source label, and recent-score sparkline.
2. Cards link to the existing `#/grades?course=<id>` route. The selected course receives a clear visual and `aria-current` state.
3. Use a compact Grades-page card variant so four typical courses can fit responsively without dominating the page. Narrow layouts use horizontal scrolling/snap; mobile shows one card cleanly.
4. Retain a compact native course selector on narrow layouts only if it improves keyboard and screen-space ergonomics.
5. Replace the current disconnected picker/result/calculation lines with one selected-course summary:
   - Published total: prominent value, `Published by D2L`, optional points/weight detail.
   - Local summary: prominent value, `Estimate from graded work`, graded-item count, and a clear `D2L has not released a final grade` note.
   - Unavailable: `No grade available yet`, without a fabricated number.
6. Move the full calculation explanation and special rules such as ungraded-as-zero into a short `How this is calculated` disclosure. Keep important caveats available but out of the primary scan path.
7. Reduce the score chart's vertical footprint and simplify its header/control spacing. Preserve every current view/range/zoom function and exact grade-detail link.
8. Bring the grade-item table upward. At a normal desktop viewport, the table heading or first rows should be visible without scrolling past a near-full-screen chart.

## Phase 1: Lock the UI Contracts

### Tests first

- Assert a final detail panel has one shell, one Back control, one close control, and no `.detail-layer-title` block.
- Assert every detail type still has exactly one visible `h1` and the dialog references it.
- Assert the Back hover rule does not change its text to the link-blue token.
- Assert Assignments renders four status tabs and exactly two secondary filter controls.
- Assert changing Type or Course retains the other query parameters.
- Assert existing item and filter hashes parse exactly as before.
- Assert grade cards preserve published/estimated/unavailable source labels from the dashboard model.

### Validate

- Existing contextual-navigation, dashboard-screen, UI-review, live-search, and overlay tests still pass.

## Phase 2: Remove the Detail Flash

### Implement

- Split modal-shell rendering from detail-body rendering in `src/dashboard/render.js`.
- Replace repeated `showDetail()` whole-root assignments with shell lifecycle helpers in `src/dashboard/app.js`.
- Add a cancellable delayed-loading threshold and retain `detailRenderToken` protection.
- Update only the scroll body on bundle success, missing item, or error.
- Preserve body scroll when following a related-detail link where appropriate; reset to the top for a genuinely different item.
- Keep file preview and action confirmation layered above the detail shell.

### Validate

- Instrument one immediate bundle and one artificially delayed bundle.
- Confirm `.detail-layer` is created once in both cases.
- Confirm the entrance animation starts once.
- Rapidly open item A then item B and verify A cannot replace B.
- Verify Back, Forward, Escape, backdrop, close, and focus restoration remain correct.

## Phase 3: Simplify the Detail Header

### Implement

- Remove the centered item type/title markup from loading, success, and error headers.
- Change the header to a two-ended layout with Back and Close.
- Give the content `h1` a stable id and wire `aria-labelledby` after content is installed.
- Make Back's hover neutral: retain dark text, add the same quiet background treatment as the close control, and preserve a visible keyboard focus ring.
- Keep the mobile full-screen header compact and ensure long origin labels truncate safely.

### Validate

- Check assignment, quiz, discussion, announcement, grade, task, event, loading, missing, and error states.
- Confirm no duplicate title is visible or announced.
- Confirm Back and Close have coherent hover, active, and focus-visible states.

## Phase 4: Consolidate Assignment Filters

### Implement

- Add a reusable labelled filter-select renderer if it meaningfully reduces duplication.
- Render Type and Course as compact selectors using current route-building logic.
- Continue using the existing internal navigation action so no form submission or page reload is introduced.
- Keep the primary status segmented control visually dominant.
- Add responsive wrapping that never allows selectors or status labels to overlap.

### Validate

- Exercise all status × type × course combinations represented in saved exports.
- Verify Back/Forward, direct URLs, item-detail open/close, and scroll restoration retain filters.
- Check long course names and four-plus courses without expanding into a wall of buttons.
- Check desktop, 900px, 640px, and 390px layouts.

## Phase 5: Build the Grade Overview Selector

### Implement

- Extract or adapt the dashboard grade-card renderer so grade wording and visual primitives have one source of truth.
- Add a compact selectable variant for the Grades page without changing dashboard dimensions.
- Render all visible courses, selected state, routes, values, source labels, and sparklines.
- Preserve the existing course dropdown as a mobile/accessibility fallback only if browser testing shows it is useful; do not show redundant selectors together.

### Validate

- Published-total courses, estimated courses, and unavailable courses each render truthfully.
- Four-course desktop, narrower desktop overflow, keyboard navigation, and mobile scrolling work without clipping or page-level horizontal overflow.
- Selecting a course updates the summary, chart, and table through the existing route.

## Phase 6: Recompose the Selected Grade View

### Implement

- Build a concise selected-course summary with grade value, source, item count, course identity, and exact D2L handoff.
- Move detailed calculation prose into an accessible disclosure.
- Reduce chart height and tighten its control layout while retaining points/percentage views, range controls, zoom, time navigation, labels, and tooltips.
- Keep the grade table structurally unchanged unless small spacing adjustments are needed; preserve categories, subtotals, dropped/bonus/excluded markers, feedback indicators, and detail routes.

### Validate

- Compare every visible number and label against the saved exports and current dashboard model.
- Ensure a missing D2L final grade is never phrased as though the estimate were official.
- Ensure the chart and table remain readable with weighted and points-based courses.
- At 1440×900 and 1280×800, confirm the table heading or first grade rows enter the initial viewport.

## Phase 7: Regression and Release Checkpoint

### Automated

- Add focused modal-lifecycle, filter-control, and Grades-page regressions to `run-local-checks.mjs`.
- Run `node test-dashboard-contextual-navigation.mjs`.
- Run `node test-dashboard-review-fixes.mjs`.
- Run `node test-dashboard-static.mjs`.
- Run `node test-dashboard-screens.mjs`.
- Run `node test-dashboard-live-search.mjs`.
- Run `node test-overlay.mjs`.
- Run `node run-local-checks.mjs`.

### Browser acceptance

- Modal: fast load, delayed load, related detail, Back, Forward, Close, Escape, backdrop, and rapid item switching.
- Modal visuals: desktop and mobile; neutral Back hover; no duplicate header title; no second flash.
- Assignments: every selector, preserved combined filters, direct links, long labels, and detail return.
- Grades: all course states, selection, chart controls, table details, grade-detail modal, desktop/mobile layouts, and zero horizontal overflow.
- Do not submit an assignment, post to a discussion, or start a quiz during acceptance.

### Release

- Bump `manifest.json` and `content.js` only after all checks pass.
- Update README, Dashboard Spec, handoff notes, and this plan's status.
- Reload the unpacked extension with the existing development trigger and verify the installed build marker.

## Completion Criteria

- Opening an item produces one smooth modal entrance with no second flash or positional jump.
- The modal header contains only Back and Close; Back remains dark on hover.
- Item type and title appear once in the content and continue to provide the accessible dialog name.
- Assignments shows four primary status tabs plus only two secondary filter controls.
- Every existing assignment-filter route and combined-filter behavior still works.
- Grades uses dashboard-consistent course cards and explicit grade-source language.
- The selected grade summary, trend, and grade-item table form a clear hierarchy, with the table beginning within the first desktop viewport.
- No extraction, D2L link, archive, or student-action behavior regresses.

## Explicit Non-Goals

- Do not change extraction or resync D2L for this work.
- Do not alter grade calculations or invent letter grades.
- Do not add multi-select assignment filters.
- Do not redesign Dashboard grade-card dimensions or the dashboard carousel.
- Do not modify assignment/discussion confirmation rules or quiz-taking behavior.
- Do not replace the grade-item table with decorative cards; it remains the detailed, scannable record.
