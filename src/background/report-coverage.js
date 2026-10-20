(function initBackgroundReportModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, parseColumns } = shared;
  const {  } = background;

function summarizeCoverage(pages, rows, changeReport = null) {
  const byCourse = {};
  const warnings = [];
  const skipped = [];
  const failed = [];
  const uncertain = [];
  const expectedSources = {
    assignments: "assignment",
    assignmentSubmissions: "assignmentSubmission",
    assignmentFeedback: "assignmentFeedback",
    quizzes: "quiz",
    quizAttempt: "quizAttemptRow",
    quizSubmissions: "quizSubmission",
    quizSummary: "quizSummaryRow",
    grades: "gradeItem",
    announcementDetail: "announcement",
    discussions: "discussionTopic",
    content: "contentTopic",
    calendar: "calendarEvent",
    checklist: "checklistItem",
    survey: "survey",
    selfAssessment: "selfAssessment",
    group: "group",
    courseLink: "courseLink",
    attendance: "attendanceRecord",
    userProgress: "progressRecord",
    mediaLibrary: "mediaFile"
  };

  for (const page of pages) {
    const courseId = page.course?.orgUnitId || "unknown";
    const courseTitle = page.course?.title || page.course?.pageTitle || "Unknown";
    byCourse[courseId] ||= {
      courseOrgUnitId: courseId,
      courseTitle,
      pagesVisited: 0,
      pageTypes: {},
      sources: {},
      warnings: []
    };
    byCourse[courseId].pagesVisited += 1;
    byCourse[courseId].pageTypes[page.pageType] = (byCourse[courseId].pageTypes[page.pageType] || 0) + 1;

    const requestedUrl = page.crawlTask?.requestedUrl;
    if (requestedUrl && page.page?.url && requestedUrl !== page.page.url) {
      const warning = `Link redirected away from requested content: ${requestedUrl} -> ${page.page.url} (likely a stale or module-only content id)`;
      warnings.push({ courseOrgUnitId: courseId, severity: "warning", message: warning, url: requestedUrl });
      byCourse[courseId].warnings.push(warning);
      uncertain.push({ courseOrgUnitId: courseId, reason: "redirectedContentLink", message: warning, url: requestedUrl });
    }

    const expectedSource = expectedSources[page.pageType];
    const pageItems = Array.isArray(page.items) ? page.items : [];
    const expectedCount = expectedSource ? pageItems.filter((item) => item.source === expectedSource).length : pageItems.length;
    if (expectedSource && expectedCount === 0 && page.diagnostics?.emptyState) {
      const note = `${page.pageType} page appears intentionally empty: ${page.page?.url}`;
      skipped.push({ courseOrgUnitId: courseId, reason: "emptyState", message: note, url: page.page?.url });
    } else if (expectedSource && expectedCount === 0) {
      const warning = `${page.pageType} page visited but no ${expectedSource} rows were extracted: ${page.page?.url}`;
      warnings.push({ courseOrgUnitId: courseId, severity: "warning", message: warning, url: page.page?.url });
      byCourse[courseId].warnings.push(warning);
      uncertain.push({ courseOrgUnitId: courseId, reason: "expectedRowsMissing", message: warning, url: page.page?.url });
    }

    if (page.error) {
      const warning = `Failed to extract page: ${page.page?.url} (${page.error})`;
      warnings.push({ courseOrgUnitId: courseId, severity: "error", message: warning, url: page.page?.url });
      byCourse[courseId].warnings.push(warning);
      failed.push({ courseOrgUnitId: courseId, message: warning, url: page.page?.url });
    }
  }

  for (const row of rows) {
    const courseId = row.courseOrgUnitId || "unknown";
    byCourse[courseId] ||= {
      courseOrgUnitId: courseId,
      courseTitle: row.courseTitle || "Unknown",
      pagesVisited: 0,
      pageTypes: {},
      sources: {},
      warnings: []
    };
    byCourse[courseId].sources[row.source] = (byCourse[courseId].sources[row.source] || 0) + 1;
  }

  const studentCoverage = summarizeStudentCoverage(rows, pages, { warnings, skipped, failed, uncertain }, changeReport);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      pagesVisited: pages.length,
      rows: rows.length,
      courses: Object.keys(byCourse).length,
      skipped: skipped.length,
      failed: failed.length,
      uncertain: uncertain.length,
      warnings: warnings.length
    },
    byCourse: Object.values(byCourse),
    warnings,
    skipped,
    failed,
    uncertain,
    studentCoverage
  };
}

function rowsBySource(rows) {
  return rows.reduce((counts, row) => {
    counts[row.source || "unknown"] = (counts[row.source || "unknown"] || 0) + 1;
    return counts;
  }, {});
}

function rowHasAny(row, fields) {
  return fields.some((field) => {
    const value = row[field];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function apiProbeBreakdown(rows, pattern) {
  const counts = {};
  for (const row of rows) {
    if (row.source !== "apiProbe") continue;
    if (pattern && !pattern.test(row.type || "")) continue;
    const key = row.status || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}:${count}`)
    .join(", ") || "none";
}

function apiProbeSummaryRows(rows) {
  const groups = [
    ["Assignment submissions", /assignment my submissions/i],
    ["Quiz attempts", /quiz attempts/i],
    ["Announcements", /announcements|news/i],
    ["Discussions", /discussion/i]
  ];
  return groups.map(([label, pattern]) => {
    const matching = rows.filter((row) => row.source === "apiProbe" && pattern.test(row.type || ""));
    return {
      label,
      count: matching.length,
      breakdown: apiProbeBreakdown(rows, pattern)
    };
  }).filter((entry) => entry.count > 0);
}

function apiProbeLegendLines() {
  return [
    "Legend:",
    "- available: D2L returned data and the extractor captured evidence rows.",
    "- availableEmpty: D2L allowed the read-only probe but returned no evidence rows.",
    "- blocked: D2L denied the read-only probe for this student/session.",
    "- notEnabledOrHidden: D2L returned not found, usually hidden, disabled, or not enabled.",
    "- unreachable/unavailable: the probe could not be reached or returned an unexpected error."
  ];
}

function probePageLines(apiSummary, key, title, emptyMessage) {
  const probePages = apiSummary?.[key] || {};
  const visited = Number(probePages.visited || 0);
  const failed = Number(probePages.failed || 0);
  const rows = Number(probePages.rows || 0);
  const lines = [
    `## ${title}`,
    "",
    `- Read-only probe pages visited: ${visited}`,
    `- Read-only probe page failures: ${failed}`,
    `- Rows extracted from those pages: ${rows}`
  ];
  if (Array.isArray(apiSummary?.courses) && apiSummary.courses.length) {
    lines.push("");
    lines.push("| Course | Visited | Failed | Rows |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const course of apiSummary.courses) {
      const courseProbe = course[key] || {};
      lines.push(`| ${course.orgUnitId || ""} | ${courseProbe.visited || 0} | ${courseProbe.failed || 0} | ${courseProbe.rows || 0} |`);
    }
  }
  if (!visited) {
    lines.push("");
    lines.push(emptyMessage);
  }
  return lines;
}

function assignmentProbePageLines(apiSummary) {
  return probePageLines(
    apiSummary,
    "assignmentProbePages",
    "Assignment Probe Pages",
    "No assignment history/feedback page visits were recorded. On a fresh build this means assignment submission/feedback remains unproven even if assignment folders were found."
  );
}

function quizProbePageLines(apiSummary) {
  return probePageLines(
    apiSummary,
    "quizProbePages",
    "Quiz Probe Pages",
    "No quiz summary/attempt result page visits were recorded. On a fresh build this means released quiz results remain unproven even if quizzes were found."
  );
}

function announcementProbePageLines(apiSummary) {
  return probePageLines(
    apiSummary,
    "announcementProbePages",
    "Announcement Probe Pages",
    "No announcement detail page visits were recorded. On a fresh build this means announcement bodies, links, and attachments remain unproven even if announcement API rows were found."
  );
}

function gradeProbePageLines(apiSummary) {
  return probePageLines(
    apiSummary,
    "gradeProbePages",
    "Grade Probe Pages",
    "No visible gradebook page visits were recorded. On a fresh build this means grade comments and rubric snippets from the student UI remain unproven even if grade API rows were found."
  );
}

function courseToolProbePageLines(apiSummary) {
  return probePageLines(
    apiSummary,
    "courseToolProbePages",
    "Course Tool Probe Pages",
    "No checklist/survey/self-assessment/attendance/groups/classlist/progress tool visits were recorded. On a fresh build this means disabled or empty course tools remain ambiguous."
  );
}

function uniqueRows(inputRows, keyFn) {
  const seen = new Set();
  return inputRows.filter((row) => {
    const key = keyFn(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizeStudentCoverage(rows, pages, issueLists, changeReport = null) {
  const sourceCounts = rowsBySource(rows);
  const hasSource = (source) => (sourceCounts[source] || 0) > 0;
  const countWhere = (source, predicate) => rows.filter((row) => row.source === source && predicate(row, parseColumns(row))).length;
  const countPages = (pattern) => pages.filter((page) => pattern.test([
    page.page?.url,
    page.crawlTask?.requestedUrl
  ].filter(Boolean).join(" "))).length;
  const pageTypes = new Set(pages.map((page) => page.pageType).filter(Boolean));
  const apiStatuses = [];
  const hasAssignmentProbe = countWhere("apiProbe", (row) => /assignment my submissions/i.test(row.type)) > 0;
  const hasQuizProbe = countWhere("apiProbe", (row) => /quiz attempts/i.test(row.type)) > 0;
  const assignmentHistoryPages = countPages(/\/dropbox\/user\/folders_history\.d2l/i);
  const assignmentFeedbackPages = countPages(/\/dropbox\/user\/folder_user_view_feedback\.d2l/i);
  const quizAttemptPages = countPages(/\/quizzing\/user\/quiz_submissions_attempt\.d2l/i);
  const quizSubmissionPages = countPages(/\/quizzing\/user\/quiz_submissions\.d2l/i);
  const quizSummaryPages = countPages(/\/quizzing\/user\/quiz_summary\.d2l/i);

  for (const page of pages) {
    if (page.pageType !== "valenceApi" || !page.apiStatus) continue;
    apiStatuses.push({ courseOrgUnitId: page.course?.orgUnitId || "", apiStatus: page.apiStatus });
  }

  const checks = [
    {
      id: "active_courses",
      label: "Active courses discovered",
      status: hasSource("dashboardCourseCard") || rows.some((row) => row.courseOrgUnitId && row.courseOrgUnitId !== "unknown") ? "covered" : "missing",
      evidence: `${new Set(rows.map((row) => row.courseOrgUnitId).filter((id) => id && id !== "unknown")).size} course ids in manifest`,
      nextAction: "Start the crawl from the D2L dashboard if this is missing."
    },
    {
      id: "content_and_files",
      label: "Course content, modules, links, and files",
      status: hasSource("contentTopic") || hasSource("contentAttachment") ? "covered" : "missing",
      evidence: `${sourceCounts.contentTopic || 0} content topics; ${sourceCounts.contentAttachment || 0} content attachments; ${rows.filter((row) => row.localPath).length} downloaded files`,
      nextAction: "Use the Valence content/toc pass, DirectFileTopicDownload for first-party files, and contentAttachment rows from HTML topic bodies."
    },
    {
      id: "assignments_due_dates",
      label: "Assignments and due dates",
      status: hasSource("assignment") ? "covered" : "missing",
      evidence: `${sourceCounts.assignment || 0} assignments; ${countWhere("assignment", (row) => rowHasAny(row, ["dueAtText"]))} with due date text`,
      nextAction: "Confirm blank due dates against the assignment page and calendar entity joins."
    },
    {
      id: "assignment_submissions_feedback",
      label: "Assignment submission status, submitted files, and feedback",
      status: hasSource("assignmentSubmission") || hasSource("submittedFile") || hasSource("assignmentFeedback") || hasAssignmentProbe || assignmentHistoryPages || assignmentFeedbackPages ? "partial" : countWhere("assignment", (row) => /submitted|feedback/i.test(`${row.status} ${row.feedbackUrl} ${row.historyUrl} ${row.description}`)) ? "partial" : "missing",
      evidence: `${sourceCounts.assignmentSubmission || 0} submission rows; ${sourceCounts.submittedFile || 0} submitted files; ${sourceCounts.assignmentFeedback || 0} feedback rows; ${assignmentHistoryPages} history pages; ${assignmentFeedbackPages} feedback pages; ${countWhere("apiProbe", (row) => /assignment my submissions/i.test(row.type))} submission API probe rows (${apiProbeBreakdown(rows, /assignment my submissions/i)})`,
      nextAction: "Review mysubmissions apiProbe rows; crawl read-only history and feedback pages where API access is denied or empty."
    },
    {
      id: "quizzes_due_attempts",
      label: "Quizzes/exams, availability, and attempts allowed",
      status: hasSource("quiz") ? "covered" : "missing",
      evidence: `${sourceCounts.quiz || 0} quizzes; ${countWhere("quiz", (_row, columns) => columns.attempts !== undefined && columns.attempts !== "")} with attempts metadata`,
      nextAction: "Use quiz API plus visible quiz list/summary pages for availability wording."
    },
    {
      id: "quiz_results_feedback",
      label: "Quiz/exam attempts, scores, question results, and released feedback",
      status: hasSource("quizAttempt") || hasSource("quizSubmission") || hasSource("quizAttemptRow") || hasSource("quizSummaryRow") || hasSource("quizQuestionResult") || hasQuizProbe || quizAttemptPages || quizSubmissionPages || quizSummaryPages ? "partial" : "missing",
      evidence: `${sourceCounts.quizAttempt || 0} API attempt rows; ${sourceCounts.quizSubmission || 0} submission rows; ${sourceCounts.quizAttemptRow || 0} UI attempt rows; ${sourceCounts.quizSummaryRow || 0} summary rows; ${sourceCounts.quizQuestionResult || 0} question result rows; ${quizAttemptPages} attempt pages; ${quizSubmissionPages} submission pages; ${quizSummaryPages} summary pages; ${countWhere("apiProbe", (row) => /quiz attempts/i.test(row.type))} quiz attempt API probe rows (${apiProbeBreakdown(rows, /quiz attempts/i)})`,
      nextAction: "Review quiz attempt apiProbe rows; crawl released quiz submissions/feedback links only; never start a new quiz attempt."
    },
    {
      id: "grades",
      label: "Grades, points, weights, and displayed scores",
      status: hasSource("gradeItem") ? "covered" : "missing",
      evidence: `${sourceCounts.gradeItem || 0} grade items; ${sourceCounts.gradeFeedback || 0} grade feedback rows; ${countWhere("gradeItem", (_row, columns) => columns.displayedGrade || columns.pointsEarned || columns.points)} with score-like fields`,
      nextAction: "Join grade definitions with myGradeValues; keep UI grade table as verification."
    },
    {
      id: "rubrics",
      label: "Rubrics and rubric-level feedback",
      status: hasSource("rubric") || hasSource("rubricFeedback") || hasSource("rubricCriterionFeedback") ? "partial" : rows.some((row) => /rubric/i.test(`${row.title} ${row.description} ${row.itemUrl}`)) ? "partial" : "missing",
      evidence: `${sourceCounts.rubric || 0} rubric rows; ${sourceCounts.rubricFeedback || 0} rubric feedback rows; ${sourceCounts.rubricCriterionFeedback || 0} rubric criterion feedback rows`,
      nextAction: "Verify rubric criteria and score details from visible assignment/grade feedback pages."
    },
    {
      id: "announcements",
      label: "Announcements/notices",
      status: hasSource("announcement") ? "partial" : "missing",
      evidence: `${sourceCounts.announcement || 0} announcements; ${sourceCounts.announcementAttachment || 0} announcement attachments; ${sourceCounts.announcementLink || 0} announcement links; ${countWhere("apiProbe", (row) => /announcements/i.test(row.type))} blocked/unavailable announcement probes`,
      nextAction: "Verify news API/status codes and crawl visible news detail pages where API access is denied."
    },
    {
      id: "discussions",
      label: "Discussion forums, prompts, replies, and participation",
      status: hasSource("discussionPost") ? "partial" : hasSource("discussionTopic") ? "partial" : "missing",
      evidence: `${sourceCounts.discussionForum || 0} forums; ${sourceCounts.discussionTopic || 0} topics; ${sourceCounts.discussionPost || 0} posts; ${sourceCounts.discussionAttachment || 0} attachments; ${countWhere("apiProbe", (row) => /discussion/i.test(row.type))} blocked/unavailable discussion probes`,
      nextAction: "Verify discussion API/status codes; keep read-only topic page fallback for must-post-first or hidden posts."
    },
    {
      id: "calendar",
      label: "Calendar events and due-date cross-checks",
      status: hasSource("calendarEvent") ? "covered" : "missing",
      evidence: `${sourceCounts.calendarEvent || 0} calendar events; ${sourceCounts.calendarAttachment || 0} calendar attachments`,
      nextAction: "Keep full-semester API range, join events by D2L associated entity id, and verify event-detail attachments."
    },
    {
      id: "checklists_surveys_self_assessments",
      label: "Checklists, surveys, and self-assessments",
      status: hasSource("courseToolPage") || hasSource("checklistItem") || hasSource("survey") || hasSource("selfAssessment") || pageTypes.has("checklist") || pageTypes.has("survey") || pageTypes.has("selfAssessment") ? "partial" : "missing",
      evidence: `${sourceCounts.courseToolPage || 0} course tool page summaries; ${sourceCounts.checklistItem || 0} checklist rows; ${sourceCounts.survey || 0} survey rows; ${sourceCounts.selfAssessment || 0} self-assessment rows`,
      nextAction: "Live-verify completion/status fields and D2L empty-state handling for each course."
    },
    {
      id: "attendance_progress_groups",
      label: "Attendance, progress, groups, and classlist",
      status: hasSource("courseToolPage") || hasSource("attendanceRecord") || hasSource("progressRecord") || hasSource("group") || hasSource("classlistEntry") ? "partial" : "missing",
      evidence: `${sourceCounts.courseToolPage || 0} course tool page summaries; ${sourceCounts.attendanceRecord || 0} attendance rows; ${sourceCounts.progressRecord || 0} progress rows; ${sourceCounts.group || 0} group rows; ${sourceCounts.classlistEntry || 0} classlist rows`,
      nextAction: "Live-verify whether each course enables these tools and whether visible rows include useful completion/membership state."
    },
    {
      id: "syllabus_policies",
      label: "Syllabus, schedule, course policies, and instructor info",
      status: hasSource("syllabusPolicy") ? "partial" : rows.some((row) => /syllabus|schedule|policy|office hours|instructor|professor/i.test(`${row.title} ${row.description}`)) ? "partial" : "missing",
      evidence: `${sourceCounts.syllabusPolicy || 0} first-class syllabus/policy rows`,
      nextAction: "Live-verify that syllabus/policy rows include downloadable files or page snapshots for every course."
    },
    {
      id: "external_tools",
      label: "External/publisher/LTI resources",
      status: rows.some((row) => /External Resource|Link|externalLink/i.test(`${row.type} ${row.source}`)) ? "partial" : "missing",
      evidence: `${rows.filter((row) => /External Resource|Link|externalLink/i.test(`${row.type} ${row.source}`)).length} external/link-like rows; ${sourceCounts.externalLink || 0} first-class external links`,
      nextAction: "Preserve launch URLs and metadata; do not crawl third-party accounts unless explicitly authorized."
    },
    {
      id: "change_tracking",
      label: "Change tracking between exports",
      status: changeReport?.available ? "covered" : changeReport ? "partial" : "missing",
      evidence: changeReport?.available
        ? `${changeReport.totals.added} added, ${changeReport.totals.changed} changed, ${changeReport.totals.removed} removed`
        : "Change report is generated, but the first run has no previous export baseline.",
      nextAction: "Run another export after D2L changes; review change-report.md for added, changed, removed, newly graded, newly due, and newly downloaded items."
    }
  ];

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      covered: checks.filter((check) => check.status === "covered").length,
      partial: checks.filter((check) => check.status === "partial").length,
      missing: checks.filter((check) => check.status === "missing").length,
      blockedOrUncertain: (issueLists.failed?.length || 0) + (issueLists.uncertain?.length || 0)
    },
    checks,
    apiStatuses
  };
}

  Object.assign(background, { summarizeCoverage, rowsBySource, rowHasAny, apiProbeBreakdown, apiProbeSummaryRows, apiProbeLegendLines, probePageLines, assignmentProbePageLines, quizProbePageLines, announcementProbePageLines, gradeProbePageLines, courseToolProbePageLines, uniqueRows, summarizeStudentCoverage });
})(globalThis);
