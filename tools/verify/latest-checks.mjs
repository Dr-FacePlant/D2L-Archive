export function pageVisitChecksFromManifest(manifest) {
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
