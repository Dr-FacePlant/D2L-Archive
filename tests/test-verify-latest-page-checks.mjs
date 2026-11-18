import { pageVisitChecksFromManifest } from "../tools/verify/latest-checks.mjs";

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function checkByLabel(result, label) {
  return result.checks.find((check) => check.label === label);
}

const found = pageVisitChecksFromManifest({
  audit: {
    totals: {
      apiSummary: {
        assignmentProbePages: { visited: 4, failed: 1, rows: 2 },
        quizProbePages: { visited: 3, failed: 0, rows: 5 },
        announcementProbePages: { visited: 2, failed: 0, rows: 4 },
        gradeProbePages: { visited: 1, failed: 0, rows: 12 },
        courseToolProbePages: { visited: 7, failed: 1, rows: 3 }
      }
    }
  },
  pages: [
    { crawlTask: { requestedUrl: "https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folders_history.d2l?db=44&ou=9900002" } },
    { crawlTask: { requestedUrl: "https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folder_user_view_feedback.d2l?db=44&ou=9900002" } },
    { crawlTask: { requestedUrl: "https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_submissions_attempt.d2l?ou=9900002&qi=7&ai=9" } },
    { crawlTask: { requestedUrl: "https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_summary.d2l?ou=9900002&qi=7" } },
    { crawlTask: { requestedUrl: "https://kennesaw.view.usg.edu/d2l/le/news/9900002/123/view" } },
    { crawlTask: { requestedUrl: "https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=9900002" } },
    { crawlTask: { requestedUrl: "https://kennesaw.view.usg.edu/d2l/lms/checklist/checklists.d2l?ou=9900002" } }
  ]
});

assertEqual(checkByLabel(found, "Assignment probe page summary").status, "found", "assignment probe summary found when probes visited");
assertEqual(checkByLabel(found, "Assignment probe page summary").evidence, "4 visited, 1 failed, 2 rows from audit.totals.apiSummary.assignmentProbePages", "assignment probe summary evidence includes counts");
assertEqual(checkByLabel(found, "Quiz probe page summary").status, "found", "quiz probe summary found when probes visited");
assertEqual(checkByLabel(found, "Quiz attempt result pages visited").status, "found", "quiz attempt page visit found");
assertEqual(checkByLabel(found, "Quiz summary pages visited").status, "found", "quiz summary page visit found");
assertEqual(checkByLabel(found, "Announcement probe page summary").status, "found", "announcement probe summary found when probes visited");
assertEqual(checkByLabel(found, "Announcement detail pages visited").status, "found", "announcement detail page visit found");
assertEqual(checkByLabel(found, "Grade probe page summary").status, "found", "grade probe summary found when probes visited");
assertEqual(checkByLabel(found, "Visible gradebook pages visited").status, "found", "gradebook page visit found");
assertEqual(checkByLabel(found, "Secondary course tool probe summary").status, "found", "course tool probe summary found when probes visited");
assertEqual(checkByLabel(found, "Secondary course tool pages visited").status, "found", "course tool page visit found");
assertEqual(checkByLabel(found, "Assignment feedback pages visited").area, "1 rubric details/feedback and 4 assignment feedback", "assignment page visit area maps to assignment/rubric feedback goal");
assertEqual(checkByLabel(found, "Quiz attempt result pages visited").area, "2 quiz/exam released results", "quiz page visit area maps to quiz goal");
assertEqual(checkByLabel(found, "Announcement detail pages visited").area, "5 announcement details/attachments", "announcement page visit area maps to announcement goal");
assertEqual(checkByLabel(found, "Visible gradebook pages visited").area, "3 grade item feedback/comments", "grade page visit area maps to grade goal");
assertEqual(checkByLabel(found, "Secondary course tool pages visited").area, "6 disabled/empty course tools", "course tool page visit area maps to course tool goal");

const missing = pageVisitChecksFromManifest({ audit: { totals: { apiSummary: {} } }, pages: [] });
assertEqual(checkByLabel(missing, "Assignment probe page summary").status, "unproven", "assignment probe summary unproven when probes never ran");
assertEqual(checkByLabel(missing, "Quiz probe page summary").status, "unproven", "quiz probe summary unproven when probes never ran");
assertEqual(checkByLabel(missing, "Announcement probe page summary").status, "unproven", "announcement probe summary unproven when probes never ran");
assertEqual(checkByLabel(missing, "Grade probe page summary").status, "unproven", "grade probe summary unproven when probes never ran");
assertEqual(checkByLabel(missing, "Secondary course tool probe summary").status, "unproven", "course tool probe summary unproven when probes never ran");

console.log("Verify latest page check tests passed.");
