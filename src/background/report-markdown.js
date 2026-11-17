(function initBackgroundReportModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, parseColumns, isStudentFeedbackRow, uniqueRows } = shared;
  const { rowsBySource, rowHasAny, apiProbeBreakdown, apiProbeSummaryRows, apiProbeLegendLines, assignmentProbePageLines, quizProbePageLines, announcementProbePageLines, gradeProbePageLines, courseToolProbePageLines, summarizeStudentCoverage } = background;

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
  const feedbackItems = uniqueRows(rows.filter(isStudentFeedbackRow), (row) => [row.courseOrgUnitId, row.source, row.title, row.status, row.itemUrl, row.localPath].join("::")).slice(0, 100);
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

  Object.assign(background, { auditMarkdown, changeReportMarkdown, dateValue, actionBriefMarkdown });
})(globalThis);
