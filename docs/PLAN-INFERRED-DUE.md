# Inferred due dates — plan

Undated work gets a guessed deadline from its module. The chip inverts (option D: no
label, no animation) and the due line says "Estimated". A guess never becomes Late,
never triggers Needs attention, and never overwrites a date D2L stated.

## What exists today

- `src/dashboard/model-work.js:51-141` — every item computes
  `dueAt = realDue(entity) || lesson?.at || null`, then `dueAt: dueAt || closesAt`.
  `hasDueDate` is true only for a stated date or a lesson date.
- `src/dashboard/model-archive.js:165-187` — `lessonDeadlines` already infers a date
  from a module's calendar "Due" event and walks `parentModuleId`. This is the same
  idea, already shipped, and the place to extend.
- Module end dates already arrive in evidence: `src/content/api/course-builders.js:34`
  writes `columns.endDate` for modules, `src/content/api/client.js:38` gives topics
  only `moduleStartDate`. `src/background/organizer/resources.js:57` persists
  `moduleStartsAt` and drops the end date.
- `upcomingWork` (`model-work.js:260-268`) keeps only rows with a finite `dueAt`, so
  undated work never reaches Upcoming, What's next, or the week headings.

## Rules, in order

1. **Module close** — the item's module (walking `parentModuleId`) has
   `moduleEndsAt`, or a calendar event labelled "Availability Ends" targeting it.
   Due line: `Estimated · module closes Fri, Nov 20 · 11:59 PM`.
2. **Next module opens** — first module in the course, by `tocOrder`, whose start is
   after this module's start. Due line: `Estimated · next module opens …`.
3. Nothing found — the item stays undated, exactly as today.

Lesson dates from `lessonDue` are marked inferred too: D2L never stated them, so they
get the same chip and the same "Estimated" wording.

## Files

1. `src/content/api/client.js:27-45` — `flattenTocTopics` carries the nearest
   ancestor's `EndDateTime` down to each topic, plus the module id and title that
   supplied it.
2. `src/content/api/course-builders.js:63-67` — pass `moduleEndDate`,
   `moduleEndFromId`, `moduleEndFromTitle` into topic columns.
3. `src/background/organizer/resources.js:42-58` — persist `moduleEndsAt` on module
   entities and on topic resources.
4. `src/shared/app-contract.js:8` — bump `ORGANIZER_VERSION` so
   `reorganizeArchiveIfStale` replays stored evidence. No re-sync, no D2L calls.
5. `src/dashboard/model-archive.js` — new `inferredDueDates(entities, byId)` beside
   `lessonDeadlines`; exposed as `index.inferredDue` from `buildIndex`.
6. `src/dashboard/model-work.js` — the four item builders set `inferred` and
   `inferredFrom`; `countdownFor` never returns a late countdown for a guess;
   `isLate`, `needsAttention` and `status` skip inferred items; `dueLine` and
   `dueFull` print the Estimated wording.
7. `src/dashboard/render.js:112-117` — `dateBox(parts, count, inferred)` adds `est`.
8. `src/dashboard/render-work.js:23`, `src/dashboard/render-dashboard.js:9` — pass
   the flag through.
9. `src/dashboard/dashboard.css:406-417` — `.datebox.est` inverts to
   `background: var(--ink)`, text `var(--on-ink)`, muted line via `color-mix`.
   Dark mode inverts for free because both tokens flip.
10. `src/background/app-api.js:36-38` — `dueAtForEntity` falls back to the guess so
    `dashboard.getUpcoming` matches the dashboard. No in-repo caller; contract only.
11. `tests/test-inferred-due.mjs` (new) and its entry in `run-local-checks.mjs`.

## Behaviour changes

- Undated work appears in Upcoming, What's next and the Assignments list, sorted by
  the guess and filed under the week it falls in.
- A guess already in the past is dropped from Upcoming and never reads Late; it
  stays "No due date" in the All tab.
- Submitted, graded and hidden work is never inferred.
- When D2L later states the date, the chip turns gray by itself — no migration.

## Tests

Mirror `tests/test-dashboard-lesson-deadlines.mjs`: synthetic entities through
`dash.buildIndex`, then assert on `allWork`, `upcomingWork`, `dueLine`,
`workListModel`.

1. Module with an end date → guess set, `inferred` true, due line says Estimated.
2. Nested module with no date inherits the parent's end.
3. No end date → next module's start is used.
4. No module at all → still undated and absent from Upcoming.
5. A stated due date always wins over a guess.
6. A past guess → not Upcoming, not Late, not Needs attention.
7. A submitted item is never inferred.
8. `dateBox` output carries `est` and no animation class.

Then `npm test` (`node run-local-checks.mjs`).

## Risks

- A guess can look authoritative; the "Estimated" wording in the due line is the
  guard, so it must not be dropped from any surface.
- "Next module opens" is a soft boundary and can be weeks early. It only runs when no
  close date exists.
- D2L sends local ISO strings; reuse `normalizedDate`/`toDate` rather than parsing.
- The version bump rewrites every course's knowledge from stored evidence. Cheap, but
  it touches all archives at once.

## Defaults I picked

- Lesson dates count as inferred (they are guesses too).
- Both rules ship in v1, close date first.
