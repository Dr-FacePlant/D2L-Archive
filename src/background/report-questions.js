(function initBackgroundReportQuestionsModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, parseColumns, isStudentFeedbackRow, uniqueRows } = shared;
  const { rowsBySource, rowHasAny } = background;

  function studentQuestionsMarkdown(rows, audit) {
  const sourceCounts = rowsBySource(rows);
  const dueRows = rows.filter((row) => row.dueAtText || /due|availability ends|closes/i.test(`${row.title || ""} ${row.description || ""}`));
  const downloadedRows = rows.filter((row) => row.localPath);
  const feedbackRows = rows.filter(isStudentFeedbackRow);
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

  
  Object.assign(background, { studentQuestionsMarkdown, queryGuideMarkdown });
})(globalThis);
