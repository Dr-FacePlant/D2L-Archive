(function initBackgroundReportModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, parseColumns } = shared;
  const { rowsBySource, rowHasAny, apiProbeBreakdown, apiProbeSummaryRows, apiProbeLegendLines, assignmentProbePageLines, quizProbePageLines, announcementProbePageLines, gradeProbePageLines, courseToolProbePageLines, uniqueRows, summarizeStudentCoverage } = background;

function auditMarkdown(audit) {
  const lines = [
    "# D2L Export Audit",
    "",
    `Generated: ${audit.generatedAt}`,
    "",
    "## Totals",
    "",
    `- Pages visited: ${audit.totals.pagesVisited}`,
    `- Rows extracted: ${audit.totals.rows}`,
    `- Course buckets: ${audit.totals.courses}`,
    `- Files downloaded: ${audit.totals.downloadedFiles || 0}`,
    `- Skipped intentionally empty pages: ${audit.totals.skipped}`,
    `- Failed pages: ${audit.totals.failed}`,
    `- Uncertain pages: ${audit.totals.uncertain}`,
    `- Warnings: ${audit.totals.warnings}`,
    ""
  ];

  if (audit.totals.apiSummary?.assignmentProbePages) {
    lines.push(...assignmentProbePageLines(audit.totals.apiSummary));
    lines.push("");
  }
  if (audit.totals.apiSummary?.quizProbePages) {
    lines.push(...quizProbePageLines(audit.totals.apiSummary));
    lines.push("");
  }
  if (audit.totals.apiSummary?.announcementProbePages) {
    lines.push(...announcementProbePageLines(audit.totals.apiSummary));
    lines.push("");
  }
  if (audit.totals.apiSummary?.gradeProbePages) {
    lines.push(...gradeProbePageLines(audit.totals.apiSummary));
    lines.push("");
  }
  if (audit.totals.apiSummary?.courseToolProbePages) {
    lines.push(...courseToolProbePageLines(audit.totals.apiSummary));
    lines.push("");
  }

  if (audit.studentCoverage) {
    lines.push("## Student-Complete Coverage");
    lines.push("");
    lines.push(`- Covered: ${audit.studentCoverage.summary.covered}`);
    lines.push(`- Partial: ${audit.studentCoverage.summary.partial}`);
    lines.push(`- Missing: ${audit.studentCoverage.summary.missing}`);
    lines.push(`- Failed/uncertain extraction issues: ${audit.studentCoverage.summary.blockedOrUncertain}`);
    lines.push("");
    for (const check of audit.studentCoverage.checks) {
      lines.push(`- ${check.status.toUpperCase()} - ${check.label}: ${check.evidence}`);
      if (check.status !== "covered") lines.push(`  Next: ${check.nextAction}`);
    }
    lines.push("");
  }

  lines.push("## Courses");
  lines.push("");
  for (const course of audit.byCourse) {
    lines.push(`### ${course.courseTitle} (${course.courseOrgUnitId})`);
    lines.push(`- Pages visited: ${course.pagesVisited}`);
    lines.push(`- Page types: ${JSON.stringify(course.pageTypes)}`);
    lines.push(`- Row sources: ${JSON.stringify(course.sources)}`);
    if (course.warnings.length) {
      lines.push("- Warnings:");
      course.warnings.forEach((warning) => lines.push(`  - ${warning}`));
    }
    lines.push("");
  }

  if (audit.uncertain.length) {
    lines.push("## Uncertain");
    lines.push("");
    audit.uncertain.forEach((item) => lines.push(`- ${item.message}`));
    lines.push("");
  }

  if (audit.failed.length) {
    lines.push("## Failed");
    lines.push("");
    audit.failed.forEach((item) => lines.push(`- ${item.message}`));
    lines.push("");
  }

  if (audit.skipped.length) {
    lines.push("## Skipped");
    lines.push("");
    audit.skipped.forEach((item) => lines.push(`- ${item.message}`));
    lines.push("");
  }

  return lines.join("\n");
}

function changeReportMarkdown(changeReport) {
  const itemLine = (row) => `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source || "item"} | ${row.title || "(untitled)"}`;
  const changedLine = (entry) => {
    const before = entry.before || {};
    const after = entry.after || {};
    return `- ${after.courseTitle || after.courseOrgUnitId || "Unknown course"} | ${after.source || "item"} | ${after.title || "(untitled)"} | due: ${before.dueAtText || "(blank)"} -> ${after.dueAtText || "(blank)"} | status: ${before.status || "(blank)"} -> ${after.status || "(blank)"}`;
  };

  const lines = [
    "# D2L Change Report",
    "",
    `Current export: ${changeReport.currentExportedAt || ""}`,
    `Previous export: ${changeReport.previousExportedAt || ""}`,
    ""
  ];

  if (!changeReport.available) {
    lines.push("No previous export summary was available for comparison.");
    lines.push("");
    lines.push(`Reason: ${changeReport.reason || "unknown"}`);
    return lines.join("\n");
  }

  lines.push("## Totals");
  lines.push("");
  lines.push(`- Added: ${changeReport.totals.added}`);
  lines.push(`- Removed: ${changeReport.totals.removed}`);
  lines.push(`- Changed: ${changeReport.totals.changed}`);
  lines.push(`- Newly graded: ${changeReport.totals.newlyGraded}`);
  lines.push(`- Newly due: ${changeReport.totals.newlyDue}`);
  lines.push(`- Due date changed: ${changeReport.totals.dueChanged || 0}`);
  lines.push(`- Availability changed: ${changeReport.totals.availabilityChanged || 0}`);
  lines.push(`- Newly downloaded: ${changeReport.totals.newlyDownloaded}`);
  lines.push(`- New feedback/results: ${changeReport.totals.newlyFeedback || 0}`);
  lines.push("");

  const sections = [
    ["New Feedback / Results", changeReport.newlyFeedback || [], itemLine],
    ["Newly Graded", changeReport.newlyGraded, itemLine],
    ["Newly Due", changeReport.newlyDue, itemLine],
    ["Due Date Changed", changeReport.dueChanged || [], changedLine],
    ["Availability Changed", changeReport.availabilityChanged || [], changedLine],
    ["Added", changeReport.added, itemLine],
    ["Removed", changeReport.removed, itemLine],
    ["Changed", changeReport.changed, changedLine],
    ["Newly Downloaded", changeReport.newlyDownloaded, itemLine]
  ];

  for (const [title, items, formatter] of sections) {
    lines.push(`## ${title}`);
    lines.push("");
    if (!items.length) {
      lines.push("- None");
    } else {
      items.forEach((item) => lines.push(formatter(item)));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function dateValue(row) {
  const raw = row.dueAtText || row.availabilityText || "";
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function actionBriefMarkdown(rows, audit, changeReport) {
  const dueSources = new Set(["assignment", "quiz", "calendarEvent", "discussionTopic", "survey", "checklistItem", "selfAssessment", "attendanceRecord", "progressRecord"]);
  const dueItems = uniqueRows(rows
    .filter((row) => dueSources.has(row.source) && (row.dueAtText || /due|availability ends/i.test(`${row.title} ${row.description}`)))
    .sort((a, b) => dateValue(a) - dateValue(b)),
    (row) => [row.courseOrgUnitId, row.source, row.title, row.dueAtText, row.itemUrl].join("::"))
    .slice(0, 80);
  const gradeItems = uniqueRows(rows
    .filter((row) => row.source === "gradeItem")
    .filter((row) => {
      const columns = parseColumns(row);
      return columns.displayedGrade || columns.pointsEarned || columns.points || row.status === "graded";
    }),
    (row) => {
      const columns = parseColumns(row);
      return [row.courseOrgUnitId, row.title, columns.displayedGrade, columns.pointsEarned, columns.pointsPossible, columns.points].join("::");
    })
    .slice(0, 80);
  const fileItems = uniqueRows(rows.filter((row) => row.localPath), (row) => row.localPath || [row.courseOrgUnitId, row.title].join("::")).slice(0, 80);
  const feedbackItems = uniqueRows(rows.filter((row) => [
    "assignmentSubmission",
    "assignmentFeedback",
    "submittedFile",
    "quizAttempt",
    "quizSubmission",
    "quizAttemptRow",
    "quizSummaryRow",
    "quizQuestionResult",
    "gradeFeedback",
    "discussionFeedback",
    "rubricFeedback",
    "rubricCriterionFeedback"
  ].includes(row.source)), (row) => [row.courseOrgUnitId, row.source, row.title, row.status, row.itemUrl, row.localPath].join("::")).slice(0, 100);
  const policyItems = uniqueRows(rows.filter((row) => row.source === "syllabusPolicy"), (row) => [row.courseOrgUnitId, row.title, row.localPath, row.itemUrl].join("::")).slice(0, 80);
  const rubricItems = uniqueRows(rows.filter((row) => row.source === "rubric" || row.source === "rubricFeedback" || row.source === "rubricCriterionFeedback"), (row) => [row.courseOrgUnitId, row.source, row.title, row.itemUrl].join("::")).slice(0, 80);
  const progressItems = uniqueRows(rows.filter((row) => row.source === "checklistItem" || row.source === "survey" || row.source === "selfAssessment" || row.source === "attendanceRecord" || row.source === "progressRecord" || row.source === "group"), (row) => [row.courseOrgUnitId, row.source, row.title, row.status, row.itemUrl].join("::")).slice(0, 80);
  const apiProbeItems = uniqueRows(rows.filter((row) => row.source === "apiProbe"), (row) => [row.courseOrgUnitId, row.type, row.status, row.title].join("::")).slice(0, 120);
  const apiProbeSummaries = apiProbeSummaryRows(rows);
  const uncertainChecks = audit.studentCoverage?.checks?.filter((check) => check.status !== "covered") || [];
  const itemLine = (row) => `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source || "item"} | ${row.title || "(untitled)"}${row.dueAtText ? ` | due: ${row.dueAtText}` : ""}`;

  const lines = [
    "# D2L Student Action Brief",
    "",
    `Generated: ${audit.generatedAt}`,
    "",
    "## What Changed",
    ""
  ];

  if (!changeReport?.available) {
    lines.push("- No previous export baseline was available; this run establishes one.");
  } else if (!changeReport.totals.added && !changeReport.totals.changed && !changeReport.totals.removed) {
    lines.push("- No added, changed, or removed manifest items detected.");
  } else {
    lines.push(`- Added: ${changeReport.totals.added}`);
    lines.push(`- Changed: ${changeReport.totals.changed}`);
    lines.push(`- Removed: ${changeReport.totals.removed}`);
    lines.push(`- Newly graded: ${changeReport.totals.newlyGraded}`);
    lines.push(`- Newly due: ${changeReport.totals.newlyDue}`);
    lines.push(`- Due date changed: ${changeReport.totals.dueChanged || 0}`);
    lines.push(`- Availability changed: ${changeReport.totals.availabilityChanged || 0}`);
    lines.push(`- New feedback/results: ${changeReport.totals.newlyFeedback || 0}`);
  }

  lines.push("");
  lines.push("## Due / Dated Items");
  lines.push("");
  if (!dueItems.length) lines.push("- None found in structured rows.");
  else dueItems.forEach((row) => lines.push(itemLine(row)));

  lines.push("");
  lines.push("## Grades With Scores");
  lines.push("");
  if (!gradeItems.length) lines.push("- None found in structured rows.");
  else {
    gradeItems.forEach((row) => {
      const columns = parseColumns(row);
      const grade = columns.displayedGrade || columns.pointsEarned || columns.points || row.status || "";
      lines.push(`- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.title || "(untitled)"} | ${grade}`);
    });
  }

  lines.push("");
  lines.push("## Downloaded Course Files");
  lines.push("");
  if (!fileItems.length) lines.push("- None downloaded.");
  else fileItems.forEach((row) => lines.push(`- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.title || "(untitled)"} | ${row.localPath}`));

  lines.push("");
  lines.push("## Submissions / Feedback / Results");
  lines.push("");
  if (!feedbackItems.length) lines.push("- None found in structured rows.");
  else {
    feedbackItems.forEach((row) => {
      const columns = parseColumns(row);
      const score = columns.displayedGrade || columns.score || (columns.pointsEarned && columns.pointsPossible ? `${columns.pointsEarned}/${columns.pointsPossible}` : columns.points || "");
      lines.push(`- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source} | ${row.title || "(untitled)"}${row.status ? ` | ${row.status}` : ""}${score ? ` | ${score}` : ""}${row.localPath ? ` | ${row.localPath}` : ""}`);
    });
  }

  lines.push("");
  lines.push("## Syllabus / Policies");
  lines.push("");
  if (!policyItems.length) lines.push("- None tagged as first-class syllabus/policy rows.");
  else policyItems.forEach((row) => lines.push(`- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.title || "(untitled)"}${row.localPath ? ` | ${row.localPath}` : ""}`));

  lines.push("");
  lines.push("## Rubrics / Criteria");
  lines.push("");
  if (!rubricItems.length) lines.push("- None tagged as first-class rubric rows.");
  else rubricItems.forEach((row) => lines.push(`- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source} | ${row.title || "(untitled)"}`));

  lines.push("");
  lines.push("## Checklists / Surveys / Progress");
  lines.push("");
  if (!progressItems.length) lines.push("- None found in structured rows.");
  else progressItems.forEach((row) => lines.push(`- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source} | ${row.title || "(untitled)"}${row.status ? ` | ${row.status}` : ""}`));

  lines.push("");
  lines.push("## Needs Review");
  lines.push("");
  if (!uncertainChecks.length) lines.push("- Student-complete coverage checks are all marked covered.");
  else uncertainChecks.forEach((check) => lines.push(`- ${check.status.toUpperCase()} - ${check.label}: ${check.evidence}`));

  lines.push("");
  lines.push("## API Probe Evidence");
  lines.push("");
  lines.push(...apiProbeLegendLines());
  lines.push("");
  if (apiProbeSummaries.length) {
    lines.push("Summary:");
    apiProbeSummaries.forEach((entry) => lines.push(`- ${entry.label}: ${entry.count} rows (${entry.breakdown})`));
    lines.push("");
  }
  if (!apiProbeItems.length) lines.push("- None recorded.");
  else apiProbeItems.forEach((row) => lines.push(`- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.type || row.title || "API probe"} | ${row.status || "unavailable"} | ${row.title || "(untitled)"}`));

  return lines.join("\n");
}

function studentQuestionsMarkdown(rows, audit) {
  const sourceCounts = rowsBySource(rows);
  const dueRows = rows.filter((row) => row.dueAtText || /due|availability ends|closes/i.test(`${row.title || ""} ${row.description || ""}`));
  const downloadedRows = rows.filter((row) => row.localPath);
  const feedbackRows = rows.filter((row) => [
    "assignmentSubmission",
    "assignmentFeedback",
    "submittedFile",
    "quizAttempt",
    "quizSubmission",
    "quizAttemptRow",
    "quizSummaryRow",
    "quizQuestionResult",
    "discussionFeedback",
    "rubricFeedback",
    "rubricCriterionFeedback"
  ].includes(row.source));
  const coverageById = new Map((audit.studentCoverage?.checks || []).map((check) => [check.id, check]));
  const statusFor = (ids, fallback) => {
    const checks = ids.map((id) => coverageById.get(id)).filter(Boolean);
    if (!checks.length) return fallback;
    if (checks.some((check) => check.status === "missing")) return "missing";
    if (checks.some((check) => check.status === "partial")) return "partial";
    return "covered";
  };
  const evidenceFor = (ids, fallback) => ids.map((id) => coverageById.get(id)?.evidence).filter(Boolean).join("; ") || fallback;
  const questionRows = [
    ["What courses am I actively taking?", statusFor(["active_courses"], "missing"), evidenceFor(["active_courses"], `${audit.byCourse?.length || 0} course buckets`), "Check `index.json`, `manifest.csv`, and per-course folders."],
    ["What is due soon across every course?", statusFor(["assignments_due_dates", "quizzes_due_attempts", "calendar"], dueRows.length ? "partial" : "missing"), `${dueRows.length} due/datable rows; ${sourceCounts.calendarAttachment || 0} calendar attachments`, "Start with `student-action-brief.md`, then filter rows with `dueAtText`."],
    ["Which assignments exist, and are they submitted or graded?", statusFor(["assignments_due_dates", "assignment_submissions_feedback"], "missing"), evidenceFor(["assignments_due_dates", "assignment_submissions_feedback"], `${sourceCounts.assignment || 0} assignments; ${sourceCounts.assignmentSubmission || 0} submissions; ${sourceCounts.assignmentFeedback || 0} feedback rows`), "Filter `assignment`, `assignmentSubmission`, `submittedFile`, `assignmentFeedback`, and `apiProbe` rows."],
    ["Which quizzes/exams exist, and what results are released?", statusFor(["quizzes_due_attempts", "quiz_results_feedback"], "missing"), evidenceFor(["quizzes_due_attempts", "quiz_results_feedback"], `${sourceCounts.quiz || 0} quizzes; ${sourceCounts.quizSubmission || 0} quiz submissions; ${sourceCounts.quizSummaryRow || 0} summary rows; ${sourceCounts.quizQuestionResult || 0} question result rows`), "Filter `quiz`, `quizAttempt`, `quizSubmission`, `quizAttemptRow`, `quizSummaryRow`, `quizQuestionResult`, and `apiProbe` rows."],
    ["What grades and scored feedback are visible?", statusFor(["grades", "rubrics"], "missing"), evidenceFor(["grades", "rubrics"], `${sourceCounts.gradeItem || 0} grade items; ${sourceCounts.gradeFeedback || 0} grade feedback rows; ${sourceCounts.rubric || 0} rubric rows; ${sourceCounts.rubricFeedback || 0} rubric feedback rows; ${sourceCounts.rubricCriterionFeedback || 0} rubric criterion feedback rows`), "Filter `gradeItem`, `gradeFeedback`, `rubric`, `rubricFeedback`, `rubricCriterionFeedback`, and feedback/result rows."],
    ["What files and course materials were saved locally?", statusFor(["content_and_files"], downloadedRows.length ? "partial" : "missing"), `${sourceCounts.contentTopic || 0} content topics; ${downloadedRows.length} rows with local files`, "Open `courses/*/files/` or filter rows with `localPath`."],
    ["What announcements or instructor notices were posted?", statusFor(["announcements"], "missing"), evidenceFor(["announcements"], `${sourceCounts.announcement || 0} announcements; ${sourceCounts.announcementAttachment || 0} attachments; ${sourceCounts.announcementLink || 0} links`), "Filter `announcement`, `announcementAttachment`, and `announcementLink` rows; use page snapshots when detail rows are sparse."],
    ["What discussions, prompts, replies, and feedback are visible?", statusFor(["discussions"], "missing"), evidenceFor(["discussions"], `${sourceCounts.discussionTopic || 0} topics; ${sourceCounts.discussionPost || 0} posts; ${sourceCounts.discussionFeedback || 0} feedback rows`), "Filter discussion rows and respect must-post-first gates as read-only blocked states."],
    ["Where are syllabus, schedule, policy, and instructor-info materials?", statusFor(["syllabus_policies"], "missing"), evidenceFor(["syllabus_policies"], `${sourceCounts.syllabusPolicy || 0} syllabus/policy rows`), "Filter `syllabusPolicy` rows and related downloaded files."],
    ["Which D2L tools are enabled but empty, blocked, or only partially visible?", statusFor(["checklists_surveys_self_assessments", "attendance_progress_groups", "external_tools"], "missing"), evidenceFor(["checklists_surveys_self_assessments", "attendance_progress_groups", "external_tools"], `${sourceCounts.courseToolPage || 0} course tool page summaries; ${sourceCounts.checklistItem || 0} checklist rows; ${sourceCounts.survey || 0} surveys; ${sourceCounts.progressRecord || 0} progress rows; ${sourceCounts.externalLink || 0} external links; ${sourceCounts.apiProbe || 0} API probes`), "Review `audit-report.md`, `courseToolPage` rows, `apiProbe` rows, externalLink rows, and `localPageTextPath` snapshots."],
    ["What changed since the last export?", statusFor(["change_tracking"], "missing"), evidenceFor(["change_tracking"], "No change evidence available"), "Open `change-report.md` and `change-report.json`."]
  ];
  const lines = [
    "# Student Questions Map",
    "",
    `Generated: ${audit.generatedAt}`,
    "",
    "This file maps the archive to the questions a student would normally open D2L to answer.",
    "",
    "| Question | Status | Evidence | Where to look |",
    "| --- | --- | --- | --- |"
  ];
  for (const [question, status, evidence, where] of questionRows) {
    lines.push(`| ${question} | ${String(status).toUpperCase()} | ${String(evidence).replace(/\|/g, "/")} | ${where.replace(/\|/g, "/")} |`);
  }
  lines.push(
    "",
    "Statuses come from `audit.studentCoverage` plus manifest counts. `PARTIAL` means the archive contains useful evidence but the related D2L area still has unproven fields, blocked endpoints, empty results, or permission-dependent details."
  );
  return lines.join("\n");
}

function queryGuideMarkdown() {
  return [
    "# D2L Archive Query Guide",
    "",
    "This archive is designed for local AI/search workflows.",
    "",
    "## Start Here",
    "",
    "- `index.json`: high-level course and archive index.",
    "- `audit-report.md`: coverage summary, warnings, failed pages, uncertain pages, and intentionally empty pages.",
    "- `manifest.csv`: spreadsheet-friendly flat list of extracted rows.",
    "- `manifest.json`: full export with page payloads, audit data, and rows.",
    "- `ai-index.jsonl`: one compact searchable JSON object per row for local AI/RAG indexing.",
    "- `audit.studentCoverage`: checklist-style coverage status for student-useful questions such as due work, grades, feedback, files, discussions, announcements, and missing areas.",
    "- `change-report.md`: what changed since the previous export in this browser profile.",
    "- `change-report.json`: machine-readable added/removed/changed/newly-graded/newly-due lists.",
    "- `student-action-brief.md`: compact day-to-day view of changes, due/datable items, grades with scores, downloaded files, and remaining review gaps.",
    "- `student-questions.md`: question-oriented map of what the archive can answer and what remains partial.",
    "",
    "## Course Folders",
    "",
    "Each `courses/<course>/` folder contains:",
    "",
    "- `course.json`: compact course summary.",
    "- `items.csv`: extracted rows for that course.",
    "- `items.json`: JSON copy of course rows.",
    "- `ai-index.jsonl`: compact searchable rows for that course.",
    "- `pages/`: Markdown text snapshots of crawled D2L pages.",
    "- `files/`: downloaded content candidates.",
    "",
    "## Useful Manifest Columns",
    "",
    "- `source`: item type, such as `assignment`, `quiz`, `gradeItem`, `contentTopic`, `discussionTopic`, `announcement`, or `calendarEvent`.",
    "- `title`: primary item title.",
    "- `description`: visible surrounding text from D2L.",
    "- `dueAtText`: due date text when D2L exposes one.",
    "- `availabilityText`: availability window text when D2L exposes one.",
    "- `itemUrl`: original D2L URL.",
    "- `localPath`: downloaded local file path when available.",
    "- `localPageTextPath`: Markdown page snapshot path for fallback reading.",
    "- `ids`: JSON string with known D2L ids.",
    "- `columns`: JSON string with page-specific fields.",
    "",
    "## Query Patterns",
    "",
    "- Upcoming quizzes: filter `source = quiz`, then read `dueAtText`, `availabilityText`, and `columns.attempts`.",
    "- Assignments: filter `source = assignment`; if no rows exist, check `audit-report.md` for intentionally empty assignment pages.",
    "- Course materials/files: filter `source = contentTopic`; open `localPath` if present, otherwise inspect `localPageTextPath`.",
    "- Embedded content files: filter `source = contentAttachment`; open `localPath` if present, otherwise use `itemUrl`/`downloadUrl`.",
    "- Discussion prompts: filter `source = discussionTopic`; use `description` and `gate`.",
    "- Calendar due dates: filter `source = calendarEvent` and search `title` for `Due` or `Availability Ends`; filter `source = calendarAttachment` for files linked from event details.",
    "- Syllabus and policies: filter `source = syllabusPolicy`; open `localPath` or `localPageTextPath` where present.",
    "- Rubrics and grading criteria: filter `source = rubric`, `source = rubricFeedback`, or `source = rubricCriterionFeedback`.",
    "- External course tools and links: filter `source = externalLink`; these are recorded as link-only rows unless D2L exposes a first-party downloadable file.",
    "- Submission/feedback/result history: filter `source` for `assignmentSubmission`, `assignmentFeedback`, `submittedFile`, `quizAttempt`, `quizSubmission`, `quizSummaryRow`, `gradeFeedback`, `discussionFeedback`, or `rubricFeedback`.",
    "- Parser gaps: open `audit-report.md`, then inspect affected `localPageTextPath` page snapshots.",
    "- Student completeness: open `audit-report.md` and read `Student-Complete Coverage`; anything marked `MISSING` or `PARTIAL` should be treated as unproven.",
    "- What changed since last run: open `change-report.md`; on the first run it creates the baseline for future comparisons.",
    "- Quick daily check: open `student-action-brief.md` first, then drill into the manifests or course folders.",
    "",
    "## Safety",
    "",
    "This export is read-only. It is intended to preserve visible D2L information locally, not submit coursework or modify D2L state."
  ].join("\n");
}

  Object.assign(background, { auditMarkdown, changeReportMarkdown, dateValue, actionBriefMarkdown, studentQuestionsMarkdown, queryGuideMarkdown });
})(globalThis);
