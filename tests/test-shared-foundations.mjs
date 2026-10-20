import { loadSharedHooks } from "./test-production-loader.mjs";

const shared = loadSharedHooks();

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

assertEqual(shared.normalizeText("  one\u00a0 two\nthree  "), "one two three", "text normalization is stable");
assertEqual(shared.slug("Course: Week 1 / Notes", "fallback"), "Course-Week-1-Notes", "archive slug is stable");
assertEqual(shared.classifyUrl("https://kennesaw.view.usg.edu/d2l/home/9900002"), "courseHome", "course home classification is stable");
assertEqual(shared.classifyUrl("https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_summary.d2l?ou=1&qi=2"), "quizSummary", "quiz summary classification is stable");
assertEqual(shared.classifyUrl("https://kennesaw.view.usg.edu/d2l/le/9900002/discussions/topics/3359437/View"), "discussions", "discussion classification is stable");
assertEqual(shared.isSafeReadOnlyUrl("/d2l/lms/grades/my_grades/main.d2l?ou=1", "https://kennesaw.view.usg.edu/d2l/home/1"), true, "relative read-only URL is safe");
assertEqual(shared.isSafeReadOnlyUrl("/d2l/lms/quizzing/user/quiz_start.d2l?ou=1&qi=2", "https://kennesaw.view.usg.edu/d2l/home/1"), false, "relative quiz start URL is blocked");
assertEqual(shared.canonicalUrl("https://kennesaw.view.usg.edu/d2l/le/content/1/viewContent/55/View"), "https://kennesaw.view.usg.edu/d2l/le/content/canonical-item/55", "content URL canonicalization is stable");

const payload = {
  pageType: "content",
  page: { url: "https://kennesaw.view.usg.edu/d2l/le/content/1/Home", title: "Content" },
  crawlTask: { requestedUrl: "https://kennesaw.view.usg.edu/d2l/le/content/1/viewContent/55/View" },
  course: { orgUnitId: "1", title: "Course" }
};
const row = shared.flattenItem(payload, {
  source: "contentTopic",
  title: "Week 1, Notes",
  description: "Line one\nLine two",
  ids: { contentObjectId: "55" },
  columns: { module: "Week 1" }
});
assertEqual(row.pageUrl, payload.crawlTask.requestedUrl, "flattened row preserves requested URL");
assertEqual(shared.parseColumns(row).module, "Week 1", "row columns parse from production JSON");

const csv = shared.toCsv([row]);
assertEqual(csv.split("\n")[0], shared.CSV_COLUMNS.join(","), "CSV header order matches schema contract");
if (!csv.includes('"Week 1, Notes"')) throw new Error("CSV escapes commas in titles");

const rowId = shared.stableRowId(row);
if (!rowId.includes("contentTopic") || !rowId.includes("55")) throw new Error("stable row ID preserves source and content id");
const apiObservation = { ...row, columns: JSON.stringify({ module: "Week 1" }) };
const pageObservation = { ...row, columns: JSON.stringify({ module: "Week 1", recoveredFrom: "contentPage" }) };
if (shared.stableRowId(apiObservation) === shared.stableRowId(pageObservation)) {
  throw new Error("stable row ID must distinguish API evidence from recovered page evidence");
}
const historyObservation = { ...row, columns: JSON.stringify({ module: "Week 1", recoveredFrom: "submissionHistoryPage" }) };
if (shared.stableRowId(pageObservation) === shared.stableRowId(historyObservation)) {
  throw new Error("stable row ID must distinguish observations recovered from different page types");
}
const checklistA = { ...row, source: "checklistItem", title: "Task 1", ids: JSON.stringify({ courseOrgUnitId: "1", checklistId: "10", checklistItemId: "101" }), itemUrl: "https://kennesaw.view.usg.edu/d2l/lms/checklist/checklists.d2l?ou=1" };
const checklistB = { ...checklistA, ids: JSON.stringify({ courseOrgUnitId: "1", checklistId: "20", checklistItemId: "201" }) };
if (shared.stableRowId(checklistA) === shared.stableRowId(checklistB)) throw new Error("stable row ID collapsed repeated task titles from different checklists");
const changed = { ...row, dueAtText: "Tomorrow" };
if (shared.rowSignature(row) === shared.rowSignature(changed)) throw new Error("row signature detects meaningful changes");
const relocated = { ...row, localPath: "D2L Export/a-different-run/courses/1/files/notes.pdf" };
if (shared.rowSignature(row) !== shared.rowSignature(relocated)) throw new Error("row signature changed with per-export local path");

console.log("Shared foundation production tests passed.");
