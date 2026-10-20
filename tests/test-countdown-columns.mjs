import { appSource } from "./app-source.mjs";
// The date box counts down and flips to the date on a tap; the Assignments
// table drops its Type column (picked Oct 11, 2026, version C with the border
// always on). Open work's box reads "in 2 days", "in 11 hrs", "in 40 min" or
// "late 2 days"; done, missed and closed work keeps its date. The type moves
// into the gray line under the title, Score shows only on Submitted & graded
// and All, and the gray "in 2 days" under a status goes when the box says it.
process.env.TZ = "America/New_York";

import fs from "node:fs";
import path from "node:path";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();
const NOW = "2026-10-10T16:00:00.000Z"; // Sat Oct 10, 12:00 PM

// 1. countdown(): calendar days, hours on the last day, minutes in the last hour.
const face = (dueAt) => { const c = dash.countdown(dueAt, NOW); return c ? `${c.late ? "late" : "in"} ${c.n} ${c.unit}` : ""; };
const cases = {
  "2026-10-11T03:59:00.000Z": "in 11 hrs",     // tonight, 11:59 PM
  "2026-10-10T16:40:00.000Z": "in 40 min",
  "2026-10-10T17:00:00.000Z": "in 1 hr",
  "2026-10-12T03:59:59.000Z": "in 1 day",      // tomorrow, 11:59 PM
  "2026-10-17T03:59:59.000Z": "in 6 days",
  "2026-10-09T03:59:00.000Z": "late 2 days",   // Thu, 11:59 PM
  "2026-10-10T15:30:00.000Z": "late 30 min"
};
for (const [dueAt, want] of Object.entries(cases)) check(face(dueAt) === want, `countdown(${dueAt}) should read "${want}", got "${face(dueAt)}"`);
check(dash.countdown("", NOW) === null, "no deadline, no countdown");
check(["2026-10-10T16:40:00.000Z", "2026-10-11T03:59:00.000Z", "2026-10-17T03:59:59.000Z"].map((d) => dash.countdown(d, NOW).letter).join("") === "mhd", "the box letters should be m, h and d");

// 2. Rows: open work counts down, finished work keeps its date.
const CRJU = "9900004", HIST = "9900003", POLS = "9900001";
const task = (id, title, dueAt) => ({ entityId: `tool:${HIST}:checklistItem:checklistItemId:${id}`, entityType: "courseToolItem", toolType: "checklistItem", courseId: HIST, canonicalTitle: title, description: "", category: "Checklist 7", dates: { dueAt, availableFrom: null, availableUntil: null }, urls: {} });
const entities = [
  { entityId: "q-today", entityType: "quizBundle", courseId: HIST, canonicalTitle: "Lesson 7 reading quiz", pointsPossible: 10, dates: { dueAt: "2026-10-11T03:59:00.000Z" }, attempts: { source: "none" }, urls: {} },
  { entityId: "q-m7", entityType: "quizBundle", courseId: CRJU, canonicalTitle: "Module 7 Quiz", pointsPossible: 10, dates: { dueAt: "2026-10-12T03:59:59.000Z" }, attempts: { source: "none" }, urls: {} },
  { entityId: "a-late", entityType: "assignmentBundle", courseId: CRJU, canonicalTitle: "Module 6 Homework", pointsPossible: 10, submissionCount: 0, dates: { dueAt: "2026-10-09T03:59:00.000Z" }, urls: {} },
  { entityId: "a-sub", entityType: "assignmentBundle", courseId: CRJU, canonicalTitle: "Module 6 Reflection", pointsPossible: 10, submissionCount: 1, dates: { dueAt: "2026-10-08T03:59:00.000Z" }, urls: {} },
  { entityId: "a-graded", entityType: "assignmentBundle", courseId: POLS, canonicalTitle: "Constitution essay", pointsPossible: 10, submissionCount: 1, score: { displayed: "9 / 10", pointsEarned: 9, pointsPossible: 10 }, dates: { dueAt: "2026-10-03T03:59:00.000Z" }, urls: {} },
  { entityId: "q-missed", entityType: "quizBundle", courseId: POLS, canonicalTitle: "Quiz 5", pointsPossible: 10, dates: { dueAt: "2026-10-10T03:59:59.000Z", availableUntil: "2026-10-10T03:59:59.000Z" }, attempts: { source: "quizList", completed: 0, allowed: 1 }, urls: {} },
  { entityId: "q-closed", entityType: "quizBundle", courseId: POLS, canonicalTitle: "Quiz 4", pointsPossible: 10, dates: { dueAt: "2026-10-04T03:59:59.000Z", availableUntil: "2026-10-04T03:59:59.000Z" }, attempts: { source: "none" }, urls: {} },
  task("t-open", "Task 6", "2026-10-13T03:59:00.000Z"),
  task("t-ticked", "Task 3", "2026-10-02T03:59:00.000Z")
];
const courses = [{ courseId: CRJU, code: "CO.000.CRJU9004.1.20272", title: "Justice Foundations" }, { courseId: HIST, code: "CO.000.HIST9002.1.20272", title: "World History" }, { courseId: POLS, code: "CO.000.POLS9003.1.20272", title: "Civic Studies" }];
const index = dash.buildIndex({ now: NOW, courses, entities, settings: {} });
const ticks = { [`tool:${HIST}:checklistItem:checklistItemId:t-ticked`]: true };
const pages = Object.fromEntries(["upcoming", "attention", "done", "all"].map((tab) => [tab, dash.workListPage(dash.workListModel(index, { tab }, ticks))]));
const rowOf = (html, id) => html.match(new RegExp(`data-entity="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">[\\s\\S]*?</a>`))?.[0] || "";
const boxFace = (row) => {
  const flip = row.match(/<span class="datebox flip( late)?" data-action="flip-date" data-due="[^"]+" title="Tap to see the date" aria-hidden="true"><span class="face cd"><span class="mon">(\w+)<\/span><span class="day">(\d+)<span class="unit">([mhd])<\/span><\/span><\/span><span class="face dt"><span class="mon">\w+<\/span><span class="day">\d+<\/span><span class="dow">\w+<\/span><\/span><\/span>/);
  if (flip) return `${flip[2]} ${flip[3]}${flip[4]}${flip[1] ? " (amber)" : ""}`;
  const date = row.match(/<div class="datebox"><span class="mon">(\w+)<\/span><span class="day">(\d+)<\/span>/);
  return date ? `date ${date[1]} ${date[2]}` : "none";
};
const all = pages.all;
const want = {
  // The unit is one letter beside the number, full size (picked Oct 11, 2026, version B).
  "q-today": "in 11h", "q-m7": "in 1d", "a-late": "late 2d (amber)",
  [`tool:${HIST}:checklistItem:checklistItemId:t-open`]: "in 2d",
  "a-sub": "date OCT 7", "a-graded": "date OCT 2", "q-missed": "date OCT 9", "q-closed": "date OCT 3",
  [`tool:${HIST}:checklistItem:checklistItemId:t-ticked`]: "date OCT 1"
};
for (const [id, face] of Object.entries(want)) check(boxFace(rowOf(all, id)) === face, `${id}'s date box should read "${face}", got "${boxFace(rowOf(all, id))}"`);

// 3. The gray "in 2 days" goes where the box counts down; finished work keeps "3 days ago".
check(!/<small>/.test(rowOf(all, "q-m7").split('class="col-status"')[1] || "x<small>"), "an open row shouldn't repeat its countdown under the status");
check(/<small>3 days ago<\/small>/.test(rowOf(all, "a-sub")), "a submitted row should keep \"3 days ago\" under its status");

// 4. Columns: no Type column anywhere, Score only on Submitted & graded and All.
for (const [tab, html] of Object.entries(pages)) {
  check(!/col-type|<span[^>]*>Type<\/span>/.test(html.slice(html.indexOf('<div class="table-head"'))), `${tab}: the table should have no Type column`);
  const score = /<span class="col-score">Score<\/span>/.test(html);
  check(score === (tab === "done" || tab === "all"), `${tab}: ${tab === "done" || tab === "all" ? "should" : "shouldn't"} show a Score column`);
}
check(/data-entity="a-late">[\s\S]*?>Assignment  ·  CRJU 9004  ·  10 points</.test(all), "the gray line should read \"Assignment · CRJU 9004 · 10 points\"");
check(/data-entity="q-m7">[\s\S]*?>Quiz  ·  CRJU 9004</.test(all), "a quiz's gray line should start with \"Quiz\"");
check(/Filter by type/.test(all), "the Type filter should stay");

// 5. What's Next and the course page count down too, without repeating it.
const dashPage = dash.dashboardPage(dash.dashboardModel(index, {}, ticks));
check(/data-entity="q-today">\s*<span class="datebox flip"/.test(dashPage), "What's Next should count down");
const home = dash.courseHomePage(dash.courseHomeModel(index, CRJU));
const homeRow = rowOf(home, "q-m7");
check(/datebox flip/.test(homeRow) && !/<br>Tomorrow/.test(homeRow), "the course page's upcoming list should count down without repeating \"Tomorrow\"");

// 6. The app flips on a tap before a row can open, and recounts once a minute.
const app = appSource();
const flipAt = app.indexOf('closest("[data-action=flip-date]")');
check(flipAt > 0 && flipAt < app.indexOf("navigateToDetail(link.getAttribute"), "the flip should be handled before a row link opens");
check(/flip\.classList\.toggle\("flipped"\)/.test(app) && /event\.preventDefault\(\);\s*flip\.classList/.test(app), "a tap should flip the box and stop the row from opening");
check(/setInterval\(\(\) => \{[\s\S]*?dash\.countdown\(box\.dataset\.due, now\)[\s\S]*?unit\.textContent = count\.letter;[\s\S]*?\}, 60 \* 1000\)/.test(app), "countdowns should recount once a minute, letter included");

// 7. CSS: the border, the flip faces, amber late, one header style.
const css = fs.readFileSync(path.join(repoRoot, "src/dashboard/dashboard.css"), "utf8");
check(/\.datebox \{[^}]*border: 1px solid var\(--faint\); background: var\(--sunk\)/.test(css), "the date box should keep its gray fill and always have a border");
check(/\.datebox\.flip \.dt, \.datebox\.flip\.flipped \.cd \{ display: none; \}/.test(css) && /\.datebox\.flip\.flipped \.dt \{ display: flex; \}/.test(css), "the box should flip between its two faces");
check(/\.datebox\.flip\.late \.cd \.mon, \.datebox\.flip\.late \.cd \.day, \.datebox\.flip\.late \.cd \.dow \{ color: var\(--warn\); \}/.test(css), "late countdowns should be amber, \"days\" included");
// Light mode: amber words readable on white, marks the brighter gold; dark mode uses one gold for both.
const lightBlock = css.match(/:root \{[\s\S]*?\n\}/)?.[0] || "";
const darkBlock = css.match(/:root\[data-mode="dark"\] \{[\s\S]*?\n\}/)?.[0] || "";
check(/--warn: #A16207;/.test(lightBlock) && /--warn-mark: #E0A800;/.test(lightBlock), "light amber should be #A16207 words with #E0A800 marks");
check(/--warn: #EDC05A;[^\n]*--warn-mark: #EDC05A;/.test(darkBlock), "dark amber should keep one gold for words and marks");
check(/\.table-head \.col-score \{ font-size: inherit; font-weight: inherit; color: inherit; \}/.test(css), "the Score header should look like the others");
check(!/\.col-type\b/.test(css), "the Type column style should be gone");
// The tab container (Upcoming · Needs attention · …) must differ from the page
// behind it in both themes; in dark mode it once matched exactly and vanished.
for (const [theme, block] of [["light", css.match(/:root \{[\s\S]*?\n\}/)?.[0]], ["dark", css.match(/:root\[data-mode="dark"\] \{[\s\S]*?\n\}/)?.[0]]]) {
  const token = (name) => block?.match(new RegExp(`--${name}: (#[0-9A-Fa-f]{6})`))?.[1]?.toUpperCase();
  check(token("seg-ground") && token("ground") && token("seg-ground") !== token("ground"), `${theme}: the tab container (${token("seg-ground")}) should differ from the page (${token("ground")})`);
}

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Date boxes count down and flip to the date; Assignments has no Type column, and Score only where work is finished.");
