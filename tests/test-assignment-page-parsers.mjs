import { loadContentHooks } from "./test-production-loader.mjs";

const { isUsefulAssignmentSubmissionRow } = loadContentHooks();

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeFileUrl(href) {
  if (/\/d2l\/lms\/dropbox\/user\/(?:folder_submit_files|folders_history|folder_user_view_feedback)\.d2l/i.test(href)) return false;
  return /\/d2l\/api\/.*\/files?\//i.test(href)
    || /\/d2l\/api\/.*\/attachments?\//i.test(href)
    || /\/d2l\/common\/dialog\/file/i.test(href)
    || /[?&](?:fileId|fid|cfql|download)=/i.test(href)
    || /\/d2l\/lms\/dropbox\/.*(?:file|download|get)/i.test(href)
    || /\/d2l\/lp\/(?:file|files|attachments)\//i.test(href)
    || /\/content\/enforced\//i.test(href)
    || /\.(?:pdf|docx?|pptx?|xlsx?|csv|txt|rtf|zip|png|jpe?g|gif|heic|mp4|mov|m4a|mp3)(?:[?#]|$)/i.test(href);
}

function compactLabelValueRows(text, labels) {
  const normalized = normalizeText(text);
  const out = {};
  for (const label of labels) {
    const pattern = new RegExp(`\\b${label}\\b\\s*:?\\s*([^]+?)(?=\\s+(?:${labels.join("|")})\\b\\s*:?|$)`, "i");
    const value = normalized.match(pattern)?.[1]?.trim();
    if (value) out[label.replace(/\s+/g, "_").toLowerCase()] = value.slice(0, 800);
  }
  return out;
}

function assignmentSubmissionStatus(text) {
  return /not submitted|no submission/i.test(text)
    ? "notSubmittedVisible"
    : /submitted|submission/i.test(text)
      ? "submissionHistoryVisible"
      : "checked";
}

function assignmentFeedbackStatus(text) {
  return /no feedback|feedback is not available|not graded/i.test(text)
    ? "noFeedbackVisible"
    : "feedbackPageVisible";
}

function rubricFeedbackRow({ text, href, assignmentFolderId }) {
  const rubricText = normalizeText(text);
  const rubricLevel = rubricText.match(/Level Achieved:\s*([^]+?)(?=\s+(?:Overall Feedback|Feedback|Comments|Score|Grade|Rubric|Level Achieved)\b|$)/i)?.[1]?.trim() || "";
  return {
    source: "rubricFeedback",
    description: rubricText,
    url: href,
    columns: {
      recoveredFrom: "assignmentFeedbackPageRubricBlock",
      rubricLevel
    },
    ids: { courseOrgUnitId: "9900002", assignmentFolderId, dropboxFolderId: assignmentFolderId }
  };
}

function rubricCriterionRows({ text, rubricTitle, assignmentFolderId }) {
  const chunks = normalizeText(text)
    .split(/(?=\b(?:Criterion|Criteria)\b\s*:?\s*)/i)
    .map((chunk) => normalizeText(chunk))
    .filter((chunk) => /\b(?:Criterion|Criteria)\b/i.test(chunk) && /\b(?:Level Achieved|Score|Feedback|Comments)\b/i.test(chunk));
  return chunks.map((chunk, index) => {
    const criterionName = chunk.match(/\b(?:Criterion|Criteria)\b\s*:?\s*([^]+?)(?=\s+\b(?:Level Achieved|Score|Feedback|Comments|Criterion|Criteria)\b|$)/i)?.[1]?.trim() || "";
    const rubricLevel = chunk.match(/\bLevel Achieved\b\s*:?\s*([^]+?)(?=\s+\b(?:Score|Feedback|Comments|Criterion|Criteria)\b|$)/i)?.[1]?.trim() || "";
    const scoreText = chunk.match(/\bScore\b\s*:?\s*(?:\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:point|points|pts)|\d+(?:\.\d+)?%)/i)?.[0] || "";
    const feedbackText = chunk.match(/\b(?:Feedback|Comments)\b\s*:?\s*([^]+?)(?=\s+\b(?:Criterion|Criteria|Score|Level Achieved)\b|$)/i)?.[1]?.trim() || "";
    return {
      source: "rubricCriterionFeedback",
      title: criterionName || `${rubricTitle || "Rubric criterion"} ${index + 1}`,
      status: scoreText || rubricLevel || feedbackText ? "criterionFeedbackVisible" : "criterionVisible",
      columns: {
        recoveredFrom: "assignmentFeedbackPageRubricCriterion",
        rubricTitle,
        criterionName,
        rubricLevel,
        scoreText,
        feedbackText
      },
      ids: { courseOrgUnitId: "9900002", assignmentFolderId, dropboxFolderId: assignmentFolderId, criterionNumber: String(index + 1) }
    };
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

assertEqual(looksLikeFileUrl("https://kennesaw.view.usg.edu/d2l/api/le/1/9900002/dropbox/folders/44/submissions/55/files/66"), true, "D2L API submitted file URL is captured");
assertEqual(looksLikeFileUrl("https://kennesaw.view.usg.edu/d2l/lp/files/temp/submission.docx"), true, "D2L lp file URL is captured");
assertEqual(looksLikeFileUrl("https://kennesaw.view.usg.edu/content/enforced/9900002/report.pdf"), true, "content enforced file URL is captured");
assertEqual(looksLikeFileUrl("https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folder_user_view_feedback.d2l?db=44&ou=9900002"), false, "feedback page URL is not mistaken for a file");
assertEqual(looksLikeFileUrl("https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folder_submit_files.d2l?db=44&ou=9900002"), false, "submit page URL is not mistaken for a file");

const submissionLabels = compactLabelValueRows(
  "Submission Date: Sep 18, 2026 11:21 PM Status: Submitted Score: 9 / 10 Feedback: Nice work",
  ["Submitted", "Submission Date", "Date Submitted", "Last Submitted", "Status", "Score", "Grade", "Feedback"]
);
assertEqual(submissionLabels.submission_date, "Sep 18, 2026 11:21 PM", "submission page captures submission date");
assertEqual(submissionLabels.status, "Submitted", "submission page captures status");
assertEqual(submissionLabels.score, "9 / 10", "submission page captures score");
assertEqual(submissionLabels.feedback, "Nice work", "submission page captures feedback text");

const feedbackLabels = compactLabelValueRows(
  "Overall Feedback: Strong revision Comments: See inline notes Grade: Complete Rubric: Level Achieved: Excellent",
  ["Overall Feedback", "Feedback", "Comments", "Score", "Grade", "Rubric", "Level Achieved"]
);
assertEqual(feedbackLabels.overall_feedback, "Strong revision", "feedback page captures overall feedback");
assertEqual(feedbackLabels.comments, "See inline notes", "feedback page captures comments");
assertEqual(feedbackLabels.grade, "Complete", "feedback page captures grade");

assertEqual(assignmentSubmissionStatus("No submission has been made yet."), "notSubmittedVisible", "not-submitted assignment history is explicit");
assertEqual(assignmentSubmissionStatus("Submitted Sep 18, 2026 File report.pdf"), "submissionHistoryVisible", "submitted assignment history is explicit");
assertEqual(assignmentFeedbackStatus("Feedback is not available."), "noFeedbackVisible", "unreleased feedback is explicit");
assertEqual(assignmentFeedbackStatus("Overall Feedback: Good work Score: 9/10"), "feedbackPageVisible", "released feedback is explicit");
assertEqual(isUsefulAssignmentSubmissionRow({ title: "Individual assignment", columns: { Assignment: "Individual assignment" }, ids: {} }), false, "assignment navigation table row is ignored");
assertEqual(isUsefulAssignmentSubmissionRow({ title: "report.pdf", columns: { "Submission ID": "55", "Date Submitted": "Sep 18, 2026" }, ids: {} }), true, "submission evidence table row is retained");

const rubricRow = rubricFeedbackRow({
  text: "Assignment Rubric Level Achieved: Excellent Overall Feedback: Strong revision",
  href: "https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folder_user_view_feedback.d2l?db=44&ou=9900002",
  assignmentFolderId: "44"
});
assertEqual(rubricRow.columns.recoveredFrom, "assignmentFeedbackPageRubricBlock", "rubric feedback records recovery source");
assertEqual(rubricRow.columns.rubricLevel, "Excellent", "rubric feedback captures level achieved");
assertEqual(rubricRow.ids.assignmentFolderId, "44", "rubric feedback keeps assignment folder id");

const criterionRows = rubricCriterionRows({
  text: "Criterion: Organization Level Achieved: Excellent Score: 4 / 4 Feedback: Clear structure Criterion: Evidence Level Achieved: Good Score: 3 / 4 Comments: Add citations",
  rubricTitle: "Research Paper Rubric",
  assignmentFolderId: "44"
});
assertEqual(criterionRows.length, 2, "rubric criterion parser emits criterion-level feedback rows");
assertEqual(criterionRows[0].source, "rubricCriterionFeedback", "rubric criterion parser uses first-class source");
assertEqual(criterionRows[0].columns.criterionName, "Organization", "rubric criterion parser captures criterion name");
assertEqual(criterionRows[0].columns.rubricLevel, "Excellent", "rubric criterion parser captures criterion level");
assertEqual(criterionRows[0].columns.scoreText, "Score: 4 / 4", "rubric criterion parser captures criterion score");
assertEqual(criterionRows[1].columns.feedbackText, "Add citations", "rubric criterion parser captures criterion feedback");
assertEqual(criterionRows[1].ids.criterionNumber, "2", "rubric criterion parser numbers criteria");

console.log("Assignment page parser tests passed.");
