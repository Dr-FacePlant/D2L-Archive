import { appSource } from "./app-source.mjs";
// A student can mark an assignment, quiz or discussion done, or skip it.
// Both are local dashboard state per D2L account: the work leaves Upcoming,
// Needs attention and What's Next, and D2L never changes. "Mark as done"
// files it under Done; "Skip" (and any mark saved before marks had a reason)
// leaves it in the All tab only. On a screen both sit in one quiet line at
// the foot of the to-do card.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const COURSE = "1001";
const NOW = "2026-10-09T16:00:00.000Z";
const entities = [
  // Closed Sep 4 and never taken: flagged forever before this change.
  { entityId: "quiz-closed", entityType: "quizBundle", courseId: COURSE, canonicalTitle: "Quiz 2", gradeEntityId: "grade-q2",
    dates: { availableFrom: "2026-09-03T20:00:00.000Z", dueAt: "2026-09-05T03:59:00.000Z", availableUntil: "2026-09-05T03:59:00.000Z" },
    attempts: { completed: 0, allowed: 1, source: "quizListPage" }, urls: {} },
  { entityId: "grade-q2", entityType: "gradeRecord", courseId: COURSE, kind: "item", canonicalTitle: "Quiz 2", status: "notGraded", grade: { pointsPossible: 10 } },
  // Open, closes within 3 days: in Upcoming and in Needs attention.
  { entityId: "quiz-open", entityType: "quizBundle", courseId: COURSE, canonicalTitle: "Quiz 5", gradeEntityId: "grade-q5",
    dates: { availableFrom: "2026-10-01T20:00:00.000Z", dueAt: "2026-10-12T03:59:00.000Z", availableUntil: "2026-10-12T03:59:00.000Z" },
    attempts: { completed: 0, allowed: 1, source: "quizListPage" }, urls: {} },
  { entityId: "grade-q5", entityType: "gradeRecord", courseId: COURSE, kind: "item", canonicalTitle: "Quiz 5", status: "notGraded", grade: { pointsPossible: 10 } },
  { entityId: "assignment-open", entityType: "assignmentBundle", courseId: COURSE, canonicalTitle: "Essay", pointsPossible: 20, submissionCount: 0,
    dates: { dueAt: "2026-10-15T03:59:00.000Z" }, urls: {} },
  { entityId: "discussion-open", entityType: "discussionThread", courseId: COURSE, canonicalTitle: "Week 7 discussion", grading: { pointsPossible: 5 }, posts: { mine: 0 },
    dates: { availableUntil: "2026-10-20T03:59:00.000Z" }, urls: {} },
  { entityId: "task-1", entityType: "courseToolItem", toolType: "checklistItem", courseId: COURSE, canonicalTitle: "Read chapter 7",
    dates: { dueAt: "2026-10-14T03:59:00.000Z" }, urls: {} }
];

const dash = loadDashboard();
const index = dash.buildIndex({ now: NOW, courses: [{ courseId: COURSE, title: "POLS 9003 Civic Studies" }], entities, settings: {} });
const ids = (rows) => rows.flatMap((row) => row.tasks ? row.tasks.map((task) => task.id) : [row.id]);
const tab = (name, hidden) => ids(dash.workListModel(index, { tab: name }, {}, hidden).rows);

// 1. Before hiding: the closed quiz is stuck in Needs attention.
const none = {};
check(tab("attention", none).includes("quiz-closed"), "a closed, untaken quiz with points should start in Needs attention");
check(tab("attention", none).includes("quiz-open"), "an open quiz closing within 3 days should start in Needs attention");
const before = dash.dashboardModel(index, {}, {}, none);
check(before.attention === 2, `dashboard attention count should start at 2, got ${before.attention}`);

// 2. Hiding the closed quiz takes it out of Needs attention, keeps it in All.
const hideClosed = { "quiz-closed": { hiddenAt: NOW } };
check(!tab("attention", hideClosed).includes("quiz-closed"), "a hidden quiz is still in Needs attention");
const allRows = dash.workListModel(index, { tab: "all" }, {}, hideClosed).rows;
const hiddenRow = allRows.find((row) => row.id === "quiz-closed");
check(hiddenRow?.hidden === true, "a hidden quiz should stay in the All tab, marked hidden");
check(hiddenRow?.status?.label === "Missed", "hiding should keep the real D2L status");
check(hiddenRow?.skipped === true && !hiddenRow?.markedDone, "a mark saved without a reason should count as skipped");
check(!tab("done", hideClosed).includes("quiz-closed"), "skipped work should not move to the Done tab");
check(dash.dashboardModel(index, {}, {}, hideClosed).attention === 1, "the attention bar should drop by one after hiding");
check(dash.workListModel(index, { tab: "attention" }, {}, hideClosed).counts.attention === 1, "the Needs attention tab count should drop by one");

// 2b. Mark as done: off Needs attention, into Done, real status kept.
const doneClosed = { "quiz-closed": { hiddenAt: NOW, reason: "done" } };
check(!tab("attention", doneClosed).includes("quiz-closed"), "work marked done is still in Needs attention");
const doneRow = dash.workListModel(index, { tab: "done" }, {}, doneClosed).rows.find((row) => row.id === "quiz-closed");
check(doneRow?.markedDone === true && doneRow?.status?.label === "Missed", "work marked done should be in the Done tab with its real D2L status");
check(dash.dashboardModel(index, {}, {}, doneClosed).attention === 1, "the attention bar should drop by one after marking done");
const skipOpen = { "quiz-open": { hiddenAt: NOW, reason: "skip" } };
check(!tab("upcoming", skipOpen).includes("quiz-open") && !tab("done", skipOpen).includes("quiz-open") && tab("all", skipOpen).includes("quiz-open"), "a skipped quiz should be in the All tab only");

// 3. Hiding open work removes it from Upcoming, What's Next, course pages.
const hideOpen = { "quiz-open": { hiddenAt: NOW }, "assignment-open": { hiddenAt: NOW }, "discussion-open": { hiddenAt: NOW } };
check(["quiz-open", "assignment-open", "discussion-open"].every((id) => tab("upcoming", none).includes(id)), "open work should start in Upcoming");
check(!["quiz-open", "assignment-open", "discussion-open"].some((id) => tab("upcoming", hideOpen).includes(id)), "hidden open work is still in Upcoming");
check(tab("upcoming", hideOpen).includes("task-1"), "hiding graded work should not touch checklist tasks");
const next = ids(dash.dashboardModel(index, {}, {}, hideOpen).next);
check(!next.includes("quiz-open") && !next.includes("assignment-open"), "hidden work is still in What's Next");
const courseHome = dash.courseHomeModel(index, COURSE, hideOpen);
check(!JSON.stringify(courseHome).includes("\"quiz-open\""), "hidden work is still on the course home's upcoming list");
const courses = dash.coursesModel(index, {}, hideOpen);
check(!JSON.stringify(courses).includes("Quiz 5"), "hidden work is still a course card's next item");

// 4. Undo puts it back.
check(tab("attention", {}).includes("quiz-closed") && tab("upcoming", {}).includes("quiz-open"), "undo should put hidden work back on both lists");

// 5. Submitted work keeps its real status even when hidden.
const submitted = dash.buildIndex({ now: NOW, courses: [{ courseId: COURSE, title: "POLS 9003" }], entities: entities.map((entity) => entity.entityId === "quiz-closed" ? { ...entity, attempts: { completed: 1, allowed: 1, source: "quizListPage" } } : entity), settings: {} });
const submittedRow = dash.workListModel(submitted, { tab: "done" }, {}, hideClosed).rows.find((row) => row.id === "quiz-closed");
check(submittedRow?.status?.label === "Submitted", "a hidden quiz that D2L records as taken should show Submitted in the Done tab");

// 6. Detail screens: the card on assignment, quiz and discussion only.
const detail = (kind, id, hidden, from = index) => {
  const model = dash.detailFor(from, { name: kind, id, params: {} }, { evidence: [] });
  model.hiddenWork = hidden;
  return dash.detailPage(model, { href: "#/", label: "Back" });
};
for (const [kind, id] of [["quiz", "quiz-closed"], ["assignment", "assignment-open"], ["discussion", "discussion-open"]]) {
  const shown = detail(kind, id, {});
  check(shown.includes('data-action="mark-done"') && shown.includes(`data-entity-id="${id}"`) && shown.includes("Mark as done"), `${kind} screen has no Mark as done button`);
  check(shown.includes('data-action="skip-work"') && shown.includes(">Hide from Needs attention<"), `${kind} screen has no Skip link`);
  check(shown.includes("Done another way?") && shown.includes("D2L doesn't."), `${kind} screen should ask "Done another way?" and say D2L doesn't change`);
  const skipped = detail(kind, id, { [id]: { hiddenAt: NOW } });
  check(skipped.includes('data-action="unmark-work"') && skipped.includes("Skipped by you") && skipped.includes(">Undo<"), `${kind} screen has no Undo once skipped`);
  const marked = detail(kind, id, { [id]: { hiddenAt: NOW, reason: "done" } });
  check(marked.includes('data-action="unmark-work"') && marked.includes("Marked done by you") && marked.includes(">Undo<"), `${kind} screen has no Undo once marked done`);
}
const closedQuiz = detail("quiz", "quiz-closed", {});
const todo = closedQuiz.slice(closedQuiz.indexOf('class="card side-card todo-card"'));
check(todo.indexOf('class="steps"') >= 0 && todo.indexOf('class="steps"') < todo.indexOf("data-hide-card") && todo.indexOf("data-hide-card") < todo.indexOf("</aside>"), "the quiet line should sit at the foot of the to-do card, under the steps");
check(!detail("quiz", "quiz-closed", {}, submitted).includes("data-hide-card"), "work D2L already counts as done should get no card");
check(detail("quiz", "quiz-closed", { "quiz-closed": { hiddenAt: NOW } }, submitted).includes('data-action="unmark-work"'), "marked work D2L counts as done should still offer Undo");
check(!detail("task", "task-1", {}).includes("data-hide-card"), "checklist tasks should not get a hide card");

// 7. Rows say how they were marked.
const allPage = dash.workListPage(dash.workListModel(index, { tab: "all" }, {}, hideClosed));
check(allPage.includes("Skipped by you"), "the All tab should label skipped rows");
const donePage = dash.workListPage(dash.workListModel(index, { tab: "done" }, {}, doneClosed));
check(donePage.includes("Marked done by you"), "the Done tab should label rows marked done");

// 8. Per-account storage: one account's hidden list never applies to another.
const bindingContext = vm.createContext({ console });
vm.runInContext(read("src/dashboard/account-binding.js"), bindingContext, { filename: "account-binding.js" });
const { loadScoped, scopedKey } = bindingContext.D2LDashboard.accountBinding;
const data = {};
const storage = { get: async (key) => ({ [key]: data[key] }), set: async (values) => Object.assign(data, values) };
await storage.set({ [scopedKey("dashboardHiddenWork", "acct-a")]: hideClosed });
check(JSON.stringify(await loadScoped(storage, "dashboardHiddenWork", "acct-a", "", {})) === JSON.stringify(hideClosed), "account A lost its hidden list");
check(JSON.stringify(await loadScoped(storage, "dashboardHiddenWork", "acct-b", "", {})) === "{}", "account B inherited account A's hidden list");

// 9. The controller wires it per account, rolls back on a failed save, and feeds every list.
const app = appSource();
check(app.includes('const HIDDEN_WORK_KEY = "dashboardHiddenWork"'), "the hidden-work storage key is missing");
check(/hiddenWork: await dash\.accountBinding\.loadScoped\(chrome\.storage\.local, HIDDEN_WORK_KEY, accountId, "", \{\}\)/.test(app), "hidden work is not loaded per account");
check(/clearAccountView\(\) \{[^]*?state\.hiddenWork = \{\};/.test(app), "switching accounts does not clear the hidden list");
check(/scopedKey\(HIDDEN_WORK_KEY, state\.account\.id\)/.test(app), "hidden work is not saved under the account's key");
check(/catch \(error\) \{\s*state\.hiddenWork = previous;\s*toast\(/.test(app), "a failed save does not roll back and tell the student");
for (const call of ["dashboardModel(index, state.read, state.checklistDone, state.hiddenWork)", "workListModel(index, route.params, state.checklistDone, state.hiddenWork)", "courseHomeModel(index, route.id, state.hiddenWork)", "coursesModel(index, route.params, state.hiddenWork)"]) {
  check(app.includes(call), `the dashboard does not pass hidden work to ${call.split("(")[0]}`);
}
check((app.match(/detail\.hiddenWork = state\.hiddenWork/g) || []).length === 2, "both detail renderers should get the hidden list");
check(/action === "mark-done" \|\| action === "skip-work" \|\| action === "unmark-work"/.test(app), "the mark, skip and undo buttons are not handled");
check(/next\[entityId\] = \{ hiddenAt: new Date\(\)\.toISOString\(\), reason \}/.test(app), "marks are not saved with their reason");
check(!/mark-done[^]{0,600}(sendToD2L|D2L_STUDENT_ACTION|api\("actions)/.test(app), "marking must never send anything to D2L");

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Work marked done goes to Done, skipped work stays in All, both have Undo and are saved per account.");
