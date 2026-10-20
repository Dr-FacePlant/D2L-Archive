# Implementation Plan: Primary Page Layout Consistency

Planned against extension v0.8.196 on September 30, 2026 and completed in v0.8.197. This plan corrects the real width mismatch between Updates and the other primary student pages, verifies consistent heading/control alignment, and preserves the recently added Courses semester selector. It does not change extraction, archive data, D2L navigation, grade calculations, or student actions.

**Status: Complete.** All six primary renderers now use the standard page shell, Updates retains its existing controls and behavior, focused utility pages remain slim, and the archive-backed primary-page-layout contract is part of the full local check suite.

## Problem Statement

- Courses, Calendar, Assignments, Grades, and Content use the standard `.page` wrapper with a `1320px` maximum width.
- Updates alone renders as `.page.narrow`, reducing its maximum width to `960px`.
- This makes the Updates heading, controls, list card, and right edge visibly inconsistent with the other primary navigation pages.
- The previous review incorrectly described this as a perceived composition difference. It is an explicit code-level width difference.
- Courses now has a right-aligned Semester menu, but its alignment must be checked against Calendar and the other primary page headers as part of the same layout contract.

## Goal

Make Courses, Calendar, Updates, Assignments, Grades, and Content share one clearly measurable content boundary and header alignment system while retaining each page's appropriate internal layout.

## Requirements

- **R1 Shared primary width:** The six primary pages use the same standard page boundary at every desktop viewport.
- **R2 Exact edge alignment:** At a fixed viewport, their page headings and major content surfaces begin and end on the same x-coordinates, allowing a tolerance of 1 CSS pixel.
- **R3 Updates fills the boundary:** Updates no longer uses the `narrow` modifier. Its header, controls, explanatory text, and update list use the standard primary-page width.
- **R4 Consistent headers:** Primary page headings remain left-aligned. Optional actions or navigation controls occupy the right side without shifting the title block.
- **R5 Courses term navigation:** Keep the custom Semester menu on the right of the Courses header, with current term, archived terms, and All courses behavior unchanged.
- **R6 Responsive behavior:** Headers wrap deliberately on smaller screens, controls remain usable, and no page creates horizontal overflow.
- **R7 Appropriate exceptions:** Search, Settings, About, first-run, loading, and not-found screens may remain `slim` because they are focused utility views rather than primary data workspaces.
- **R8 No behavioral drift:** Update tabs, read state, pagination, course filtering, calendar navigation, assignment filters, grade controls, content controls, routes, and modal behavior remain unchanged.

## Design Decisions

1. Treat `.page` as the canonical shell for primary navigation pages.
2. Remove `narrow` from Updates instead of introducing page-specific width overrides.
3. Keep one shared `max-width`, horizontal padding, centering rule, and responsive breakpoint for all primary pages.
4. Let page-specific content determine internal columns; equal outer width does not require identical card or table structures.
5. Retain `.page-head` as a two-ended flex layout:
   - Title and subtitle stay at the left boundary.
   - Semester, month navigation, tabs, or commands occupy the right boundary when present.
   - A page with no right-side control does not artificially center its title.
6. On narrow screens, allow header controls to wrap below the title at full available width where necessary.
7. Do not broaden prose-oriented utility pages merely for visual uniformity.

## Phase 1: Lock the Layout Contract

### Implement tests first

- Define the primary screen set: `courses`, `calendar`, `updates`, `work`, `grades`, and `resources`.
- Assert each primary renderer uses `class="page"` without `narrow` or `slim`.
- Assert Updates no longer emits `class="page narrow"`.
- Assert Courses retains one labelled Semester listbox trigger in its page header.
- Assert Updates retains Unread, Read, All, and Mark all as read controls.
- Assert utility screens intentionally retain their focused-width modifiers.

### Browser baseline

- Record the left and right bounds of `.page` and the first major content surface for all six pages at the same viewport.
- Record page-header title and right-side-control positions.
- Confirm the current defect numerically: Updates resolves to the `960px` boundary while the other primary pages resolve to the `1320px` boundary when enough space is available.

## Phase 2: Normalize Updates

### Implement

- Change the Updates root from `.page.narrow` to `.page`.
- Keep the existing header structure, status tabs, Mark all as read command, explanatory text, grouped update rows, and Show more behavior.
- Allow the update card to fill the primary content width.
- Review row flex behavior at the wider size so titles use available space and timestamps/actions remain aligned rather than floating awkwardly.
- Avoid adding decorative columns, nested cards, or empty filler solely to occupy width.

### Validate

- Compare Updates with Courses, Calendar, Assignments, Grades, and Content at identical viewport sizes.
- Confirm matching left and right page boundaries within 1px.
- Confirm long announcement and grade-update titles truncate or wrap coherently without colliding with timestamps or Mark read controls.
- Exercise Unread, Read, All, Mark all as read, and Show more without changing their routes or stored read state.

## Phase 3: Standardize Header Alignment

### Implement only where measurements show a defect

- Keep every primary title block anchored to the same left edge and top padding.
- Keep right-side controls aligned to the page's right edge on desktop.
- Verify the Courses Semester menu is bottom-aligned coherently with the title/subtitle block and does not make the heading appear centered.
- Verify Calendar month controls, Updates status/actions, and Content's D2L command use the same header spacing conventions.
- Leave Assignments and Grades unchanged if their measured alignment already satisfies the contract.
- Add a small shared header-control class only if it removes repeated inline layout rules without changing behavior.

### Validate

- Check headings with and without right-side controls.
- Check long semester labels and long translated-style control labels.
- Confirm keyboard focus rings are visible and no popover is clipped by a page or card boundary.

## Phase 4: Responsive Verification

### Desktop widths

- `1440px`: all six primary pages share the full standard boundary.
- `1280px`: boundaries remain aligned and page controls do not force overflow.
- `1064px`: headers wrap only when needed; cards, tables, and controls remain coherent.

### Narrow widths

- `768px`: header actions can move below the title without changing page padding.
- `390×844`: one-column presentation, full-width controls where appropriate, readable update rows, and zero horizontal overflow.

### Interaction checks

- Courses Semester menu: pointer, outside click, Escape, arrows, Home/End, Enter, and Space.
- Updates: all tabs, Mark all as read, item detail open/close, browser Back/Forward, and Show more.
- Calendar, Assignments, Grades, and Content: smoke-test their existing controls after shared CSS changes.

## Phase 5: Regression and Release

### Automated checks

- Add a focused primary-page-layout regression test to `run-local-checks.mjs` or extend the existing UI-polish contract if that remains clearer.
- Run `node test-dashboard-screens.mjs`.
- Run `node test-dashboard-review-fixes.mjs`.
- Run `node test-dashboard-contextual-navigation.mjs`.
- Run `node test-dashboard-ui-polish.mjs`.
- Run `node test-dashboard-static.mjs`.
- Run `node test-overlay.mjs`.
- Run `node run-local-checks.mjs`.

### Release checkpoint

- Bump `manifest.json` and `content.js` only after automated and browser acceptance checks pass.
- Update README, Dashboard Spec, handoff notes, and this plan's status.
- Reload the unpacked extension through the existing development trigger and confirm the installed build marker.

## Completion Criteria

- Courses, Calendar, Updates, Assignments, Grades, and Content use the same outer page width.
- Their left and right content boundaries match within 1px at the same desktop viewport.
- Updates no longer uses `.page.narrow` and no longer appears visibly shorter than the other primary pages.
- Primary headings remain consistently left-aligned; right-side controls do not shift or visually center them.
- The Courses semester selector and all existing page controls still work.
- No horizontal overflow, clipping, overlapping text, or broken mobile layout is present.
- Search, Settings, About, and other focused utility screens retain their intentionally narrower layouts.
- The full local test suite passes and the installed extension reports the new build.

## Explicit Non-Goals

- Do not redesign update-row content or invent new update categories.
- Do not change which courses or semesters are extracted.
- Do not change the archive schema, sync behavior, API calls, or file downloads.
- Do not change grade estimation, assignment status, or calendar calculations.
- Do not modify submission, posting, quiz, or other student-action safety boundaries.
- Do not force every modal, settings form, search result, or prose page to `1320px`.
