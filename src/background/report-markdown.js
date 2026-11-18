(function initBackgroundReportModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, parseColumns, isStudentFeedbackRow, uniqueRows } = shared;
  const { rowsBySource, rowHasAny, apiProbeBreakdown, apiProbeSummaryRows, apiProbeLegendLines, assignmentProbePageLines, quizProbePageLines, announcementProbePageLines, gradeProbePageLines, courseToolProbePageLines, summarizeStudentCoverage } = background;

function buildAuditTotalsLines(audit) {
  const lines = [
    "# D2L Export Audit", "",
    `Generated: ${audit.generatedAt}`, "",
    "## Totals", "",
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
  if (audit.totals.apiSummary?.assignmentProbePages) lines.push(...assignmentProbePageLines(audit.totals.apiSummary), "");
  if (audit.totals.apiSummary?.quizProbePages) lines.push(...quizProbePageLines(audit.totals.apiSummary), "");
  if (audit.totals.apiSummary?.announcementProbePages) lines.push(...announcementProbePageLines(audit.totals.apiSummary), "");
  if (audit.totals.apiSummary?.gradeProbePages) lines.push(...gradeProbePageLines(audit.totals.apiSummary), "");
  if (audit.totals.apiSummary?.courseToolProbePages) lines.push(...courseToolProbePageLines(audit.totals.apiSummary), "");
  return lines;
}

function buildAuditCourseAndStatusLines(audit) {
  const lines = [];
  if (audit.studentCoverage) {
    lines.push("## Student-Complete Coverage", "",
      `- Covered: ${audit.studentCoverage.summary.covered}`,
      `- Partial: ${audit.studentCoverage.summary.partial}`,
      `- Missing: ${audit.studentCoverage.summary.missing}`,
      `- Failed/uncertain extraction issues: ${audit.studentCoverage.summary.blockedOrUncertain}`, ""
    );
    for (const check of audit.studentCoverage.checks) {
      lines.push(`- ${check.status.toUpperCase()} - ${check.label}: ${check.evidence}`);
      if (check.status !== "covered") lines.push(`  Next: ${check.nextAction}`);
    }
    lines.push("");
  }
  lines.push("## Courses", "");
  for (const course of audit.byCourse) {
    lines.push(`### ${course.courseTitle} (${course.courseOrgUnitId})`,
      `- Pages visited: ${course.pagesVisited}`,
      `- Page types: ${JSON.stringify(course.pageTypes)}`,
      `- Row sources: ${JSON.stringify(course.sources)}`
    );
    if (course.warnings.length) {
      lines.push("- Warnings:");
      course.warnings.forEach((warning) => lines.push(`  - ${warning}`));
    }
    lines.push("");
  }
  const pushSection = (title, items) => {
    if (!items.length) return;
    lines.push(`## ${title}`, "");
    items.forEach((item) => lines.push(`- ${item.message}`));
    lines.push("");
  };
  pushSection("Uncertain", audit.uncertain);
  pushSection("Failed", audit.failed);
  pushSection("Skipped", audit.skipped);
  return lines;
}

function auditMarkdown(audit) {
  return [...buildAuditTotalsLines(audit), ...buildAuditCourseAndStatusLines(audit)].join("\n");
}

function changeReportMarkdown(changeReport) {
  const itemLine = (row) => `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source || "item"} | ${row.title || "(untitled)"}`;
  const changedLine = (entry) => {
    const before = entry.before || {};
    const after = entry.after || {};
    return `- ${after.courseTitle || after.courseOrgUnitId || "Unknown course"} | ${after.source || "item"} | ${after.title || "(untitled)"} | due: ${before.dueAtText || "(blank)"} -> ${after.dueAtText || "(blank)"} | status: ${before.status || "(blank)"} -> ${after.status || "(blank)"}`;
  };

  const lines = [
    "# D2L Change Report", "",
    `Generated: ${changeReport.generatedAt}`, "",
    "## Summary", "",
    `- Items added: ${changeReport.totals.added}`,
    `- Items changed: ${changeReport.totals.changed}`,
    `- Items removed: ${changeReport.totals.removed}`,
    `- Newly graded items: ${changeReport.totals.newlyGraded}`,
    `- Newly due items: ${changeReport.totals.newlyDue}`,
    `- Due date changed: ${changeReport.totals.dueChanged || 0}`,
    `- Availability changed: ${changeReport.totals.availabilityChanged || 0}`,
    `- New feedback/results: ${changeReport.totals.newlyFeedback || 0}`,
    ""
  ];

  const sections = [
    ["Added Items", changeReport.added, itemLine],
    ["Changed Items", changeReport.changed, changedLine],
    ["Removed Items", changeReport.removed, itemLine],
    ["Newly Graded Items", changeReport.newlyGraded, itemLine],
    ["Newly Due Items", changeReport.newlyDue, itemLine],
    ["Due Date Changed", changeReport.dueChanged, changedLine],
    ["Availability Changed", changeReport.availabilityChanged, changedLine],
    ["New Feedback Or Results", changeReport.newlyFeedback, itemLine]
  ];

  for (const [title, items, formatter] of sections) {
    if (!items?.length) continue;
    lines.push(`## ${title}`, "");
    items.forEach((item) => lines.push(formatter(item)));
    lines.push("");
  }

  return lines.join("\n");
}

function dateValue(row) {
  const text = row.dueAtText || row.availabilityUntilText || "";
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function buildBriefItemBuckets(rows) {
  const dueSources = new Set(["assignment", "quiz", "checklistItem", "calendarEvent"]);
  const dueItems = uniqueRows(rows
    .filter((row) => dueSources.has(row.source) && (row.dueAtText || /due|availability ends/i.test(`${row.title} ${row.description}`)))
    .sort((a, b) => dateValue(a) - dateValue(b)),
    (row) => [row.courseOrgUnitId, row.source, row.title, row.dueAtText, row.itemUrl].join("::")).slice(0, 80);
  const gradeItems = uniqueRows(rows.filter((row) => {
    if (row.source !== "gradeItem") return false;
    const col = parseColumns(row);
    return col.displayedGrade || col.pointsEarned || col.points || row.status === "graded";
  }), (row) => {
    const col = parseColumns(row);
    return [row.courseOrgUnitId, row.title, col.displayedGrade, col.pointsEarned, col.pointsPossible, col.points].join("::");
  }).slice(0, 80);
  const fileItems = uniqueRows(rows.filter((row) => row.localPath), (row) => row.localPath || [row.courseOrgUnitId, row.title].join("::")).slice(0, 80);
  const feedbackItems = uniqueRows(rows.filter(isStudentFeedbackRow), (row) => [row.courseOrgUnitId, row.source, row.title, row.status, row.itemUrl, row.localPath].join("::")).slice(0, 100);
  const policyItems = uniqueRows(rows.filter((row) => row.source === "syllabusPolicy"), (row) => [row.courseOrgUnitId, row.title, row.localPath, row.itemUrl].join("::")).slice(0, 80);
  const rubricItems = uniqueRows(rows.filter((row) => /^(rubric|rubricFeedback|rubricCriterionFeedback)$/.test(row.source)), (row) => [row.courseOrgUnitId, row.source, row.title, row.itemUrl].join("::")).slice(0, 80);
  const progressItems = uniqueRows(rows.filter((row) => /^(checklistItem|survey|selfAssessment|attendanceRecord|progressRecord|group)$/.test(row.source)), (row) => [row.courseOrgUnitId, row.source, row.title, row.status, row.itemUrl].join("::")).slice(0, 80);
  const apiProbeItems = uniqueRows(rows.filter((row) => row.source === "apiProbe"), (row) => [row.courseOrgUnitId, row.type, row.status, row.title].join("::")).slice(0, 120);
  return { dueItems, gradeItems, fileItems, feedbackItems, policyItems, rubricItems, progressItems, apiProbeItems, apiProbeSummaries: apiProbeSummaryRows(rows) };
}

function renderBriefChangeLines(changeReport) {
  if (!changeReport?.available) return ["- No previous export baseline was available; this run establishes one."];
  if (!changeReport.totals.added && !changeReport.totals.changed && !changeReport.totals.removed) return ["- No added, changed, or removed manifest items detected."];
  return [
    `- Added: ${changeReport.totals.added}`, `- Changed: ${changeReport.totals.changed}`, `- Removed: ${changeReport.totals.removed}`,
    `- Newly graded: ${changeReport.totals.newlyGraded}`, `- Newly due: ${changeReport.totals.newlyDue}`,
    `- Due date changed: ${changeReport.totals.dueChanged || 0}`, `- Availability changed: ${changeReport.totals.availabilityChanged || 0}`,
    `- New feedback/results: ${changeReport.totals.newlyFeedback || 0}`
  ];
}

function renderBriefContentSections(lines, buckets) {
  const itemLine = (row) => `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source || "item"} | ${row.title || "(untitled)"}${row.dueAtText ? ` | due: ${row.dueAtText}` : ""}`;
  const addSec = (title, items, empty, renderRow) => {
    lines.push("", `## ${title}`, "");
    if (!items.length) lines.push(empty);
    else items.forEach((row) => lines.push(renderRow(row)));
  };
  addSec("Due / Dated Items", buckets.dueItems, "- None found in structured rows.", itemLine);
  addSec("Grades With Scores", buckets.gradeItems, "- None found in structured rows.", (row) => {
    const c = parseColumns(row);
    return `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.title || "(untitled)"} | ${c.displayedGrade || c.pointsEarned || c.points || row.status || ""}`;
  });
  addSec("Downloaded Course Files", buckets.fileItems, "- None downloaded.", (row) => `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.title || "(untitled)"} | ${row.localPath}`);
  addSec("Submissions / Feedback / Results", buckets.feedbackItems, "- None found in structured rows.", (row) => {
    const c = parseColumns(row);
    const score = c.displayedGrade || c.score || (c.pointsEarned && c.pointsPossible ? `${c.pointsEarned}/${c.pointsPossible}` : c.points || "");
    return `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source} | ${row.title || "(untitled)"}${row.status ? ` | ${row.status}` : ""}${score ? ` | ${score}` : ""}${row.localPath ? ` | ${row.localPath}` : ""}`;
  });
  addSec("Syllabus / Policies", buckets.policyItems, "- None tagged as first-class syllabus/policy rows.", (row) => `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.title || "(untitled)"}${row.localPath ? ` | ${row.localPath}` : ""}`);
  addSec("Rubrics / Criteria", buckets.rubricItems, "- None tagged as first-class rubric rows.", (row) => `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source} | ${row.title || "(untitled)"}`);
  addSec("Checklists / Surveys / Progress", buckets.progressItems, "- None found in structured rows.", (row) => `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source} | ${row.title || "(untitled)"}${row.status ? ` | ${row.status}` : ""}`);
}

function actionBriefMarkdown(rows, audit, changeReport = null) {
  const buckets = buildBriefItemBuckets(rows);
  const uncertain = audit.studentCoverage?.checks?.filter((check) => check.status !== "covered") || [];
  const lines = ["# D2L Student Action Brief", "", `Generated: ${audit.generatedAt}`, "", "## What Changed", "", ...renderBriefChangeLines(changeReport)];
  renderBriefContentSections(lines, buckets);
  lines.push("", "## Needs Review", "");
  if (!uncertain.length) lines.push("- Student-complete coverage checks are all marked covered.");
  else uncertain.forEach((check) => lines.push(`- ${check.status.toUpperCase()} - ${check.label}: ${check.evidence}`));
  lines.push("", "## API Probe Evidence", "", ...apiProbeLegendLines(), "");
  if (buckets.apiProbeSummaries.length) {
    lines.push("Summary:");
    buckets.apiProbeSummaries.forEach((entry) => lines.push(`- ${entry.label}: ${entry.count} rows (${entry.breakdown})`));
    lines.push("");
  }
  if (!buckets.apiProbeItems.length) lines.push("- None recorded.");
  else buckets.apiProbeItems.forEach((row) => lines.push(`- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.type || row.title || "API probe"} | ${row.status || "unavailable"} | ${row.title || "(untitled)"}`));
  return lines.join("\n");
}

  Object.assign(background, { auditMarkdown, changeReportMarkdown, dateValue, actionBriefMarkdown });
})(globalThis);
