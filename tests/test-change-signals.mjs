import { loadBackgroundHooks } from "./test-production-loader.mjs";

const { feedbackSignal, summarizeChanges } = loadBackgroundHooks();

function createStoredSummary(rows) {
  return {
    rows: rows.map((row) => ({
      id: row.id,
      signature: row.signature,
      source: row.source || "",
      title: row.title || "",
      status: row.status || "",
      dueAtText: row.dueAtText || "",
      availabilityText: row.availabilityText || "",
      itemUrl: row.itemUrl || "",
      localPath: row.localPath || "",
      columns: row.columns || "{}"
    }))
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const ordinaryGrade = {
  source: "gradeItem",
  title: "Quiz 1",
  columns: JSON.stringify({ displayedGrade: "9 / 10", pointsEarned: 9, pointsPossible: 10 })
};

const gradeWithComment = {
  source: "gradeItem",
  title: "Paper",
  columns: JSON.stringify({ displayedGrade: "95%", commentsAndAssessments: "Instructor comment: strong thesis." })
};

const quizSummary = {
  source: "quizSummaryRow",
  title: "Quiz 1 - Overall Grade",
  columns: JSON.stringify({ displayedGrade: "9 / 10" })
};

const discussionFeedback = {
  source: "discussionFeedback",
  title: "Discussion feedback",
  columns: "{}"
};

assertEqual(feedbackSignal(ordinaryGrade), "", "ordinary scored grade item is not feedback");
assertEqual(feedbackSignal(gradeWithComment), "Instructor comment: strong thesis.", "structured grade comments count as feedback");
assertEqual(feedbackSignal(quizSummary), "quizSummaryRow", "quiz summary result counts as feedback/result");
assertEqual(feedbackSignal(discussionFeedback), "discussionFeedback", "discussion feedback counts as feedback");

const previousRows = [
  { id: "assignment-1", signature: "old-due", source: "assignment", title: "Paper", dueAtText: "Sep 20, 2026", availabilityText: "Available until Sep 20" },
  { id: "quiz-1", signature: "old-availability", source: "quiz", title: "Quiz", dueAtText: "Sep 22, 2026", availabilityText: "Available Sep 18" },
  { id: "discussion-1", signature: "old-no-due", source: "discussionTopic", title: "Intro Discussion", dueAtText: "", availabilityText: "" }
];
const currentRows = [
  { id: "assignment-1", signature: "new-due", source: "assignment", title: "Paper", dueAtText: "Sep 24, 2026", availabilityText: "Available until Sep 20" },
  { id: "quiz-1", signature: "new-availability", source: "quiz", title: "Quiz", dueAtText: "Sep 22, 2026", availabilityText: "Available Sep 19" },
  { id: "discussion-1", signature: "new-due", source: "discussionTopic", title: "Intro Discussion", dueAtText: "Sep 25, 2026", availabilityText: "" }
];

const changeReport = summarizeChanges(createStoredSummary(previousRows), createStoredSummary(currentRows));

assertEqual(changeReport.totals.dueChanged, 1, "changed due date is a first-class daily change signal");
assertEqual(changeReport.totals.availabilityChanged, 1, "changed availability is a first-class daily change signal");
assertEqual(changeReport.totals.newlyDue, 1, "newly added due date remains a daily change signal");
assertEqual(changeReport.dueChanged[0].after.title, "Paper", "due date change keeps changed row");
assertEqual(changeReport.availabilityChanged[0].after.title, "Quiz", "availability change keeps changed row");
assertEqual(createStoredSummary(currentRows).rows[1].availabilityText, "Available Sep 19", "stored daily summary preserves availability text");

// A run for different courses must not report the other courses' rows as removed.
const { scopeSummaryToCourses, mergeExportSummaries } = loadBackgroundHooks();
const courseRow = (course, id) => ({ id, signature: `${id}-sig`, courseOrgUnitId: course, source: "assignment", title: id });
const artRun = { exportedAt: "2026-09-28T01:00:00Z", rows: [courseRow("A", "a1"), courseRow("A", "a2")] };
const histRun = { exportedAt: "2026-09-28T02:00:00Z", rows: [courseRow("H", "h1")] };
const stored = mergeExportSummaries(mergeExportSummaries(null, histRun), artRun);
assertEqual(stored.rows.length, 3, "merged summary keeps every course's latest rows");
const histAgain = { exportedAt: "2026-09-28T03:00:00Z", rows: [courseRow("H", "h1")] };
const scoped = scopeSummaryToCourses(stored, new Set(["H"]));
const scopedReport = summarizeChanges(scoped, histAgain);
assertEqual(scopedReport.totals.removed, 0, "other courses' rows are not reported as removed");
assertEqual(scopedReport.totals.added, 0, "same course rerun reports no additions");
assertEqual(scoped.exportedAt, "2026-09-28T02:00:00Z", "previous export time is the course's own last run");

console.log("Change signal tests passed.");
