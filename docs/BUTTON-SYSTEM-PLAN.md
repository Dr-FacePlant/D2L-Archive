# Button system + read-only D2L affordances — implementation plan

Status: **Track A complete; Track B not started.** Decisions 1–7 settled on the
default options. Track A shipped in `0.9.0`: the submission and post forms are
gone and every D2L-facing control is an "Open … in D2L" link.
Decision pages: [`docs/decisions/`](decisions/index.html). Full mockup:
`docs/button-system-mockup.html` (light/dark and "highlight changes" toggles are
in the page header).

This plan covers two tracks that touch the same screens:

- **Track A — Stop looking like the dashboard controls D2L.** Remove the in-app
  assignment-submission and discussion-post forms; every D2L-facing control
  becomes an "Open … in D2L" link.
- **Track B — Collapse the button zoo.** Go from 12 interactive control styles
  to four tiers plus a small set of shared components.

Track A changes what exists. Track B changes how it looks. They can ship
separately, but the mockup assumes both, because the detail-page "after" only
makes sense once the forms are gone.

---

## 1. Audit summary

Current dashboard controls (dashboard only, excluding plain navigation links):

| # | Style | CSS | Count (approx.) | Problem |
|---|---|---|---|---|
| 1 | `.btn` | `dashboard.css:289` | 19 | Used for commands *and* internal navigation |
| 2 | `.btn.btn-primary` | `:293` | 8 | Sometimes more than one per screen |
| 3 | `.link-btn` | `:346` | 12 | Used for commands *and* navigation |
| 4 | `.icon-btn` | `:286` | 16 | Close, external link, header command, chart control |
| 5 | `.filter-menu-trigger` / `-option` | `:413`, `:420` | 6 menus | A second "choose one" pattern |
| 6 | `.seg button` | `:403-404` | 3 groups | A third "choose one" pattern |
| 7 | `.switch` | `:801` | 5 | Fine; keep |
| 8 | `.grade-carousel-btn` | `:485` | 2 | Arrow style A |
| 9 | `.cal-nav-tile` | `:727` | 2 | Arrow style B |
| 10 | `.icon-btn` chart arrows | `render-grades.js:34-35` | 4 | Arrow style C |
| 11 | `.swatch` / `.tile` | `:930`, `:932` | 8 + 6 | Pickers; fine; align focus ring |
| 12 | `.nav-item` / `.profile-trigger` / `.menu-item` | `:306`, `:314`, `:298` | 7 + 1 + 7 | Navigation; fine; keep |
| — | popup bare `button` | `popup.css:49` | 3 | Outside the system |

Also `.chip` (`:406`) is dead CSS; only `.chips` (layout) and `.chip-note` survive.

Target: **four tiers** (primary, secondary, tertiary, icon), **one select
component**, **one segmented control**, **one grade carousel**, **one switch**,
**one menu row**, **one tag**. Each remaining family has exactly one job.

---

## 2. Principles (locked only after approval)

1. **One primary per screen.** The single most likely next step. Everything
   else is secondary, tertiary, or icon.
2. **Links navigate; buttons act.** Use `<a>` for routes and URLs, `<button>`
   for commands. Never a `<button>` whose only job is `location.hash = …`.
3. **Buttons never look like links and links never look like buttons.** Internal
   cross-links are tertiary; external/D2L links are tertiary with the external
   icon; icon-only controls are square and labelled.
4. **One appearance per job.** All single-choice controls share height, radius,
   font, and focus ring. Only the presentation differs (segmented for ≤ 4
   visible options, select for long lists).
5. **Standard control height is 36px, radius 8px.** Full-width page CTA is 42px.
   Nothing else invents its own height.
6. **Sentence case for actions.** "Open assignment in D2L", not "Turn in on D2L"
   or "Open Grades in D2L".
7. **No action verb that implies the dashboard performs it.** Use "Open … in
   D2L" for navigation. Reserve "Sync", "Export", "Clear" for things the
   extension actually does locally.
8. **State is never color-only.** Hover, focus-visible, disabled, pressed, and
   checked each get a non-color cue.
9. **Dark mode is a gate, not an afterthought.** Every control is checked in
   both themes and with every accent.
10. **Popups inherit the system.** The popup is part of the product.

---

## 3. Target taxonomy

### 3.1 Four tiers

| Tier | Class (keep existing names) | Use | Never use for |
|---|---|---|---|
| Primary | `.btn.btn-primary` | The screen's one next step, including "Open … in D2L" on a detail page | A second action on the same screen |
| Secondary | `.btn` | A real local command (Sync, Export, Clear, Reload, Show more) or a full-width alternative | Internal route links |
| Tertiary | `.link-btn` | Cross-links, "View all", "See the grade", external/D2L links, per-item commands (Mark read) | Bulk or destructive commands |
| Icon | `.icon-btn` | Close, external, header utility, chart pan/zoom | Anything without an `aria-label`/`title` |

Sizes: `--control-h: 36px`, `--control-h-lg: 42px`, `--control-radius: 8px`.
Icon buttons stay 38×38 with `--control-radius: 8px`.

### 3.2 Shared components

| Component | Class | Replaces | Behaviour |
|---|---|---|---|
| Select | `.select` (trigger + `.select-option`) | `.filter-menu-trigger/option` | 36px, chevron, popover listbox; same skin as segmented |
| Segmented | `.seg` | `.seg` (keep) | Shared height/radius/font; `aria-pressed` |
| Grade carousel | `.grade-carousel-btn.prev\|next` | the old tall bars | 48×260 side rails in a `48px minmax(0,1fr) 48px` grid; 28px overlays at ≤640px |
| Month nav | `.cal-bar` + two `.icon-btn`s | `.cal-nav-tile` | Previous left, centered `.cal-month`, Next right |
| Switch | `.switch` | `.switch` (keep) | 42×24; `role="switch"` |
| Menu row | `.menu-item` | `.menu-item` (keep) | 36px min height, 8px radius |
| Tag | `.tag` | `.today-tag`, `.study-chip`, `.chip` | Non-interactive; no pointer cursor |
| Picker | `.swatch`, `.tile` | keep | Add shared focus ring and pressed ring |

Retire: `.chip`, `.filter-menu-*`, `.cal-nav-tile`, and the unused `.stepper`.

### 3.3 Labels

| Surface | Before | After |
|---|---|---|
| Assignment, open | "Turn in a file" → in-app form; "Turn in on D2L" | **"Open assignment in D2L"** |
| Assignment, submitted/graded | "Open in D2L" | **"Open assignment in D2L"** |
| Assignment step | "Turn in your work" | **"Submitted …" / "Submission"** (status, not instruction) |
| Quiz, open | "Start quiz in D2L" | **"Open quiz in D2L"** |
| Quiz, LockDown | "View quiz details in D2L" | **"Open quiz in D2L"** |
| Quiz step | "Take the quiz (15 min, 2 attempts)" | **"Quiz (15 min, 2 attempts)"** |
| Discussion, open | "Write a post"; "Post on D2L"; "Reply on D2L" | **"Open discussion in D2L"** |
| Discussion step | "Start your own thread"; "Reply to 2 classmates…" | keep (these are requirements, not buttons) |
| Task | "Go to the discussion" / "Open checklist in D2L" | **"Open discussion in D2L"** / **"Open checklist in D2L"** |
| Grade | "Open Grades in D2L" | **"Open grades in D2L"** |
| Module | "Open this module in D2L" | **"Open module in D2L"** |
| Calendar | "Open D2L calendar" | **"Open calendar in D2L"** |
| Event | "Open event in D2L" | keep |
| Header help | "Submit, take quizzes and post there" | **"Assignments, quizzes, and discussions open there"** |

Keep local-only "Mark as done" / "Skip" only if approved; if kept, reword the
line to "Done another way? Hide from Needs attention" and keep the tooltip
"Only this dashboard changes. D2L doesn't."

---

## 4. Track A — remove the in-app D2L write path

### 4.1 What exists today

- Only mutating request in the extension: `src/content/api/actions.js:144`
  (`POST` to assignment-submit or discussion-post routes).
- Dashboard forms: `src/dashboard/render-details.js:52-79`; open/submit handlers
  at `src/dashboard/app-events.js:475-520`; confirm dialog in `dashboard.html:40-47`.
- Model fields: `submissionAction` (`model-details.js:190-207`) and `postAction`
  (`:301-313`); `actionsEnabled = EMBEDDED` (`app-render.js:219,415`).
- Discussion content is already read-only-renderable: `myPosts` and `allPosts`
  sections (`render-details.js:157-158`). Reply controls only appear when
  `actionsEnabled && postAction?.enabled` (`:158`), so Track A removes the write
  affordances without touching post bodies or replies.
- Proxy path: `src/background/actions.js`, `background.js:442-443`,
  `src/content/bridges.js:219-220`.

### 4.2 Removal steps

1. **Model** — replace `submissionAction`/`postAction` with one `openAction`
   `{ label, url, primary: true }` per work item, built from `entity.urls.d2l`.
   Delete `actionsEnabled` plumbing. Keep `links` for history/feedback/attempts.
2. **Render** — delete `actionForm()` and the `open-form` button branch; delete
   the per-post "Reply" button; delete "Write a post" and receipt banners.
   **Keep the thread itself**: `myPosts` / `allPosts` headings, post bodies, and
   every reply render exactly as they do now, under a "Read-only archive" note.
   The to-do card always renders one primary D2L link, then tertiary links, then
   the hide line.
3. **Events** — delete `openActionForm`, `reviewStudentAction`,
   `confirmStudentAction`, the `submit` branches for assignment/discussion, and
   the `action-confirm` listeners. Keep local `mark-done`/`skip-work` if approved.
4. **HTML/CSS** — delete `#action-confirm`, `.action-form`, `.action-dialog`,
   `.action-summary`, receipt styles; keep `.open-d2l`.
5. **Background/content** — delete `src/background/actions.js`, the
   `D2L_ACTION_*` handlers, the bridge branches, `src/content/api/actions.js`,
   and its `importScripts`/script-tag entry. No permission changes.
6. **Tests** — delete action tests; add:
   - static: no `method: "POST"` anywhere in `src/`;
   - static: no `D2L_ACTION_PREPARE|D2L_ACTION_COMMIT|assignment-submit|discussion-submit`;
   - label matrix: every detail kind resolves to "Open … in D2L";
   - read-only API audit still passes.
7. **Docs** — update privacy/store copy if it mentions submitting from the
   dashboard (grep `turn in`, `submit`, `post`).

### 4.3 Decision

**Settled:** keep the discussion readable, remove every write affordance.
Users can still scroll their posts and replies; Reply buttons, "Write a post",
the composer, and the confirm dialog disappear. See
[decision 1](decisions/01-discussion-thread.html).

This removes a shipped capability. If the answer changes to "keep it", Track A
becomes "hide it behind a setting" instead, and Track B's detail-page mockup
changes: the primary would remain "Turn in a file" with a secondary "Open in
D2L". The rest of the plan is unaffected.

---

## 5. Track B — migration by file

### 5.1 CSS foundation (`dashboard.css`)

1. Add `--control-h`, `--control-h-lg`, `--control-radius`.
2. Point `.btn`, `.link-btn`, `.icon-btn`, `.seg`, `.select`, `.switch` at
   those tokens.
3. Delete `.chip` and `.filter-menu-*` after the last call site moves.
4. Delete `.cal-nav-tile` after the month bar migration; keep
   `.grade-carousel-btn` and restyle it as the side control.
5. Keep `.detail .btn:not(.open-d2l)` override but express it with the token.
6. Keep `.open-d2l { width: 100%; height: 42px; }`.

### 5.2 Screen-by-screen

| File | Changes |
|---|---|
| `render.js` | `previewButton` stays secondary; "Download from D2L" becomes tertiary with external icon (it is a link, not a command); `cardHead` link stays tertiary; not-found "Back to dashboard" becomes the one primary; `fileRow` keeps its row layout |
| `render-dashboard.js` | "See work", "Get to studying" stay primary (different screens/states); remove the duplicate "Sync from D2L" primary (decision 6B); "Grades: x of y" becomes tertiary with arrow; "Mark read" stays tertiary; "View all" stays tertiary; adopt/dismiss stay secondary |
| `render-courses.js` | Course D2L home stays icon; "Grades: …" demoted to tertiary; course cards become fully clickable rows |
| `render-details.js` | One primary "Open … in D2L"; "Belongs to" / "Graded work" demoted to tertiary; "Submission history"/"Feedback"/"Attempts" tertiary; "Open on this computer" secondary; "Reload" stays primary only in the stale state; close stays icon; remove Reply buttons and forms (Track A) |
| `render-resources.js` | "Open link" becomes tertiary; remove the duplicate icon when the text link exists; "Expand all" secondary; module D2L link tertiary; row external icon only when there is no text link |
| `render-grades.js` | Course/view selects use `.select`; chart zoom/pan use `.icon-btn`; carousel arrows stay as flush `.grade-carousel-btn` side rails; "Open grades in D2L" tertiary, sentence case; disabled icon keeps `aria-label` |
| `render-updates.js` | Segmented filter stays; "Mark all as read" secondary (bulk); per-row "Mark read" tertiary; "Show N more" secondary; "View all" tertiary |
| `render-settings.js` | "Sync now" sole primary; "Clear" and both exports secondary; theme stays segmented; switches keep; close icon; "How this dashboard is paid for" tertiary; "Extractor tools" tertiary |
| `render-calendar.js` | Month nav becomes previous icon, centered month, next icon in `.cal-bar`; switches stay; "Open calendar in D2L" tertiary |
| `app-render.js` | Header keeps one labeled "Sync from D2L" action plus a last-synced note (decision 6B); help/overlay-close stay icon; profile/help menu rows stay; no new styles |
| `popup.html` / `popup.css` | Replace bare buttons with `.btn`/`.btn-primary` using the same tokens (copy the ~20 lines, or extract a shared `controls.css` if you want one source) |

### 5.3 Selection rule

- **≤ 4 visible options:** segmented control (it wraps at narrow widths).
- **Everything else:** select.
- Both share 36px height, 8px radius, 13px/500 type, and the same focus ring.
- This means Assignments keeps status as segmented and Type/Course as selects;
  the difference is now skin-consistent instead of three unrelated widgets.

### 5.4 Arrow rule

Grade cards keep dedicated side rails: 48×260 `.grade-carousel-btn`s in a
three-column grid, collapsing to 28px absolute overlays at ≤640px so they never
squeeze the card. The calendar month uses two 38px `.icon-btn`s inside
`.cal-bar`, not a wrapper. Chart pan/zoom stays icon-only because it is not
previous/next.

---

## 6. Phases, commits, gates

Each phase is its own commit. Do not batch phases.

| Phase | Work | Gate |
|---|---|---|
| 0 | Approve decisions in §8 | Written answers |
| 1 | Tokens + primitive CSS + focus/disabled states; no markup changes | `run-local-checks`, static validation, screenshot diff (should be near-zero) |
| 2 | `.select` component and migrate the six filter menus | Assignments/Grades/Content filters work; keyboard listbox; dark mode |
| 3 | Segmented alignment + arrow migration (grade side rails, calendar icon bar, chart) | Arrows behave identically; disabled states; keyboard |
| 4 | Tier migration screen by screen (dashboard, courses, details, resources, updates, settings) | Every screen: one primary, no internal `.btn` routes; saved-screen tests |
| 5 | Track A removal (settled: read-only thread) | No POST in `src/`; no action dialog/forms; thread bodies and replies still render; API audit |
| 6 | Popup adoption | Popup renders with shared tokens; extract/copy/download still work |
| 7 | Docs + final visual matrix | Light/dark × every accent; 200% zoom; keyboard-only pass |

Rollback: phases 1–4 and 6 are CSS/markup-only and can be reverted independently.
Phase 5 is the only one with a capability change; keep it isolated.

---

## 7. Test plan

Add `tests/test-button-system.mjs`:

- no `class="chip"` or `.filter-menu` after migration;
- no `cal-nav-tile` or `.stepper`; grade arrows use
  `.grade-carousel-btn.prev` / `.next`;
- every `<a>` with a `data-d2l-link` carries the external icon and
  `target="_blank" rel="noopener noreferrer"`;
- every `.icon-btn` has `aria-label` (and `title` when it is not inside a
  labelled group);
- every `<button>` has `type="button"` unless it is a submit;
- no internal route (`href="#/…"`) has `class="btn"` except the allow-listed
  primary CTAs ("See work", "Get to studying", "Back to dashboard");
- rendered detail pages contain exactly one `.btn-primary`;
- static: no `POST` in `src/` (Track A).

Extend the saved-screen tests to snapshot the control inventory per screen:
`primary`, `secondary`, `tertiary`, `icon`, `select`, `seg`, `switch`,
`carousel`, `tag`.

Manual matrix (per phase): 1440px, 1024px, 390px; light + dark; blue + one other
accent; keyboard-only; 200% zoom; screen reader names for icon buttons.

---

## 8. Decisions (all settled)

Defaults approved. Each decision has a focused page in
[`decisions/`](decisions/index.html).

1. **Track A — read-only discussion thread. Settled.** Keep posts and replies
   visible and scrollable; remove Reply buttons, "Write a post", the composer,
   and the confirm dialog. Only D2L-facing links remain.
   [See it](decisions/01-discussion-thread.html)
2. **Local controls. Settled.** Keep "Mark as done" / "Skip", reworded to
   "Hide from Needs attention" so it is clear only this dashboard changes.
3. **Selection rule. Settled — A.** Segmented for ≤ 4 visible options, select for
   longer lists, shared skin.
   [See it](decisions/02-selection-rule.html)
4. **Arrow treatment. Implemented — side rails.** Grade cards keep side
   chevrons because moving them into the header covered the card; the calendar
   uses icon buttons in its month bar. Chart keeps icon-only pan/zoom.
   [Original options](decisions/03-arrows.html)
5. **Popup. Settled — adopt now.** Use the shared button system in the toolbar
   popup in this pass.
   [See it](decisions/04-popup.html)
6. **Sync duplication. Settled — B.** One labeled "Sync from D2L" action in the
   dashboard header with a last-synced note; remove the duplicate dashboard
   button.
   [See it](decisions/05-sync-duplication.html)
7. **Sentence case. Settled — labels and headings.** Apply sentence case to
   actions and headings; keep proper nouns, acronyms, and content.
   [See it](decisions/06-sentence-case.html)

---

## 9. Acceptance criteria

- Control families are consolidated; `.chip`, `.filter-menu-*`, `.cal-nav-tile`,
  and `.stepper` are gone. Grade side rails remain their own 48px family.
- Every screen has exactly one primary control.
- No internal route uses `.btn` except the three allow-listed primaries.
- Every D2L-facing label reads "Open … in D2L" (sentence case).
- No in-app write surface remains (Track A settled): no forms, no confirm
  dialog, no POST, no receipt banners.
- Discussion pages still render every post and reply read-only, with no Reply,
  "Write a post", or composer controls.
- All controls are 36px tall (42px full-width CTA), 8px radius, with visible
  focus and disabled states in light and dark.
- Saved-screen tests and the full local suite pass; package dry-run passes.
