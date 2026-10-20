function pageVisitChecksFromManifest(manifest) {
  const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
  const apiSummary = manifest?.audit?.totals?.apiSummary || {};
  const assignmentProbePages = apiSummary.assignmentProbePages || {};
  const quizProbePages = apiSummary.quizProbePages || {};
  const announcementProbePages = apiSummary.announcementProbePages || {};
  const gradeProbePages = apiSummary.gradeProbePages || {};
  const courseToolProbePages = apiSummary.courseToolProbePages || {};
  const pageUrl = (page) => [
    page?.page?.url,
    page?.pageUrl,
    page?.crawlTask?.requestedUrl
  ].filter(Boolean).join(" ");
  const countWhere = (pattern) => pages.filter((page) => pattern.test(pageUrl(page))).length;
  const assignmentHistoryPages = countWhere(/\/dropbox\/user\/folders_history\.d2l/i);
  const assignmentFeedbackPages = countWhere(/\/dropbox\/user\/folder_user_view_feedback\.d2l/i);
  const quizAttemptPages = countWhere(/\/quizzing\/user\/quiz_submissions_attempt\.d2l/i);
  const quizSubmissionPages = countWhere(/\/quizzing\/user\/quiz_submissions\.d2l/i);
  const quizSummaryPages = countWhere(/\/quizzing\/user\/quiz_summary\.d2l/i);
  const announcementDetailPages = countWhere(/\/d2l\/le\/news\/\d+\/\d+\/view/i);
  const gradePages = countWhere(/\/grades\/my_grades\/main\.d2l/i);
  const courseToolPages = countWhere(/\/(?:classlist|checklist|group|selfassess|survey|attendance|userprogress)\//i);
  const assignmentProbeVisited = Number(assignmentProbePages.visited || 0);
  const assignmentProbeFailed = Number(assignmentProbePages.failed || 0);
  const assignmentProbeRows = Number(assignmentProbePages.rows || 0);
  const quizProbeVisited = Number(quizProbePages.visited || 0);
  const quizProbeFailed = Number(quizProbePages.failed || 0);
  const quizProbeRows = Number(quizProbePages.rows || 0);
  const announcementProbeVisited = Number(announcementProbePages.visited || 0);
  const announcementProbeFailed = Number(announcementProbePages.failed || 0);
  const announcementProbeRows = Number(announcementProbePages.rows || 0);
  const gradeProbeVisited = Number(gradeProbePages.visited || 0);
  const gradeProbeFailed = Number(gradeProbePages.failed || 0);
  const gradeProbeRows = Number(gradeProbePages.rows || 0);
  const courseToolProbeVisited = Number(courseToolProbePages.visited || 0);
  const courseToolProbeFailed = Number(courseToolProbePages.failed || 0);
  const courseToolProbeRows = Number(courseToolProbePages.rows || 0);
  const area = {
    assignment: "1 rubric details/feedback and 4 assignment feedback",
    quiz: "2 quiz/exam released results",
    grade: "3 grade item feedback/comments",
    announcement: "5 announcement details/attachments",
    tools: "6 disabled/empty course tools"
  };
  return {
    assignmentProbeVisited,
    assignmentProbeFailed,
    assignmentProbeRows,
    quizProbeVisited,
    quizProbeFailed,
    quizProbeRows,
    announcementProbeVisited,
    announcementProbeFailed,
    announcementProbeRows,
    gradeProbeVisited,
    gradeProbeFailed,
    gradeProbeRows,
    courseToolProbeVisited,
    courseToolProbeFailed,
    courseToolProbeRows,
    assignmentHistoryPages,
    assignmentFeedbackPages,
    quizAttemptPages,
    quizSubmissionPages,
    quizSummaryPages,
    announcementDetailPages,
    gradePages,
    courseToolPages,
    checks: [
      {
        label: "Assignment probe page summary",
        area: area.assignment,
        status: assignmentProbeVisited > 0 ? "found" : "unproven",
        evidence: `${assignmentProbeVisited} visited, ${assignmentProbeFailed} failed, ${assignmentProbeRows} rows from audit.totals.apiSummary.assignmentProbePages`
      },
      {
        label: "Assignment history pages visited",
        area: area.assignment,
        status: assignmentHistoryPages > 0 ? "found" : "unproven",
        evidence: `${assignmentHistoryPages} pages with folders_history.d2l requested or saved`
      },
      {
        label: "Assignment feedback pages visited",
        area: area.assignment,
        status: assignmentFeedbackPages > 0 ? "found" : "unproven",
        evidence: `${assignmentFeedbackPages} pages with folder_user_view_feedback.d2l requested or saved`
      },
      {
        label: "Quiz probe page summary",
        area: area.quiz,
        status: quizProbeVisited > 0 ? "found" : "unproven",
        evidence: `${quizProbeVisited} visited, ${quizProbeFailed} failed, ${quizProbeRows} rows from audit.totals.apiSummary.quizProbePages`
      },
      {
        label: "Quiz attempt result pages visited",
        area: area.quiz,
        status: quizAttemptPages > 0 ? "found" : "unproven",
        evidence: `${quizAttemptPages} pages with quiz_submissions_attempt.d2l requested or saved`
      },
      {
        label: "Quiz submission pages visited",
        area: area.quiz,
        status: quizSubmissionPages > 0 ? "found" : "unproven",
        evidence: `${quizSubmissionPages} pages with quiz_submissions.d2l requested or saved`
      },
      {
        label: "Quiz summary pages visited",
        area: area.quiz,
        status: quizSummaryPages > 0 ? "found" : "unproven",
        evidence: `${quizSummaryPages} pages with quiz_summary.d2l requested or saved`
      },
      {
        label: "Announcement probe page summary",
        area: area.announcement,
        status: announcementProbeVisited > 0 ? "found" : "unproven",
        evidence: `${announcementProbeVisited} visited, ${announcementProbeFailed} failed, ${announcementProbeRows} rows from audit.totals.apiSummary.announcementProbePages`
      },
      {
        label: "Announcement detail pages visited",
        area: area.announcement,
        status: announcementDetailPages > 0 ? "found" : "unproven",
        evidence: `${announcementDetailPages} pages with /d2l/le/news/{course}/{item}/view requested or saved`
      },
      {
        label: "Grade probe page summary",
        area: area.grade,
        status: gradeProbeVisited > 0 ? "found" : "unproven",
        evidence: `${gradeProbeVisited} visited, ${gradeProbeFailed} failed, ${gradeProbeRows} rows from audit.totals.apiSummary.gradeProbePages`
      },
      {
        label: "Visible gradebook pages visited",
        area: area.grade,
        status: gradePages > 0 ? "found" : "unproven",
        evidence: `${gradePages} pages with grades/my_grades/main.d2l requested or saved`
      },
      {
        label: "Secondary course tool probe summary",
        area: area.tools,
        status: courseToolProbeVisited > 0 ? "found" : "unproven",
        evidence: `${courseToolProbeVisited} visited, ${courseToolProbeFailed} failed, ${courseToolProbeRows} rows from audit.totals.apiSummary.courseToolProbePages`
      },
      {
        label: "Secondary course tool pages visited",
        area: area.tools,
        status: courseToolPages > 0 ? "found" : "unproven",
        evidence: `${courseToolPages} pages with classlist/checklist/group/selfassess/survey/attendance/userprogress requested or saved`
      }
    ]
  };
}

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
