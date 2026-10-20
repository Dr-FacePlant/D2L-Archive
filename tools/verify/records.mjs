export function createRecordTools({ fs, path, parseJson, normalizeText, recoverManifestFromArchive }) {
function stableRowId(row) {
  const ids = parseJson(row.ids);
  return [
    row.courseOrgUnitId,
    row.source,
    ids.contentObjectId,
    ids.quizId,
    ids.dropboxFolderId,
    ids.assignmentFolderId,
    ids.gradeObjectId,
    ids.calendarEventId,
    ids.newsItemId,
    ids.discussionForumId,
    ids.discussionTopicId,
    ids.postId,
    ids.fileId,
    row.itemUrl || row.pageUrl,
    row.title
  ].filter((value) => value !== undefined && value !== null && String(value).trim() !== "").join("::");
}

function rowSignature(row) {
  return JSON.stringify({
    courseOrgUnitId: row.courseOrgUnitId || "",
    source: row.source || "",
    title: row.title || "",
    status: row.status || "",
    type: row.type || "",
    dueAtText: row.dueAtText || "",
    availabilityText: row.availabilityText || "",
    itemUrl: row.itemUrl || "",
    historyUrl: row.historyUrl || "",
    feedbackUrl: row.feedbackUrl || "",
    localPath: row.localPath || "",
    downloadError: row.downloadError || "",
    ids: row.ids || "",
    columns: row.columns || ""
  });
}

function createExportSummary(sourceManifest) {
  const sourceRows = Array.isArray(sourceManifest.rows) ? sourceManifest.rows : [];
  return {
    exportedAt: sourceManifest.exportedAt || sourceManifest.audit?.generatedAt || "",
    rows: sourceRows.map((row) => ({
      id: stableRowId(row),
      signature: rowSignature(row),
      courseOrgUnitId: row.courseOrgUnitId || "",
      courseTitle: row.courseTitle || "",
      source: row.source || "",
      title: row.title || "",
      status: row.status || "",
      dueAtText: row.dueAtText || "",
      availabilityText: row.availabilityText || "",
      itemUrl: row.itemUrl || "",
      localPath: row.localPath || "",
      columns: row.columns || ""
    })).filter((row) => row.id)
  };
}

function feedbackSignal(row) {
  const columns = parseJson(row.columns);
  if (["assignmentFeedback", "gradeFeedback", "quizAttempt", "quizSubmission", "quizAttemptRow", "quizSummaryRow", "discussionFeedback", "rubricFeedback", "rubricCriterionFeedback"].includes(row.source)) {
    return row.source;
  }
  const text = [
    columns.feedbackText,
    columns.rubricText,
    columns.commentsAndAssessments
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return /feedback|comment|rubric|assessment/i.test(text) ? text : "";
}

function summarizeChanges(previous, current) {
  if (!previous?.rows?.length) {
    return {
      available: false,
      previousExportedAt: previous?.exportedAt || "",
      currentExportedAt: current.exportedAt,
      reason: "No previous export rows were available for offline comparison.",
      totals: { added: 0, removed: 0, changed: 0, newlyGraded: 0, newlyDue: 0, dueChanged: 0, availabilityChanged: 0, newlyDownloaded: 0, newlyFeedback: 0 },
      added: [],
      removed: [],
      changed: [],
      newlyGraded: [],
      newlyDue: [],
      dueChanged: [],
      availabilityChanged: [],
      newlyDownloaded: [],
      newlyFeedback: []
    };
  }

  const previousById = new Map(previous.rows.map((row) => [row.id, row]));
  const currentById = new Map(current.rows.map((row) => [row.id, row]));
  const added = [];
  const removed = [];
  const changed = [];
  const newlyGraded = [];
  const newlyDue = [];
  const dueChanged = [];
  const availabilityChanged = [];
  const newlyDownloaded = [];
  const newlyFeedback = [];

  for (const row of current.rows) {
    const before = previousById.get(row.id);
    if (!before) {
      added.push(row);
      if (feedbackSignal(row)) newlyFeedback.push(row);
      continue;
    }
    if (before.signature !== row.signature) {
      changed.push({ before, after: row });
      const beforeColumns = parseJson(before.columns);
      const afterColumns = parseJson(row.columns);
      const beforeGrade = `${beforeColumns.displayedGrade || beforeColumns.pointsEarned || beforeColumns.points || ""}`.trim();
      const afterGrade = `${afterColumns.displayedGrade || afterColumns.pointsEarned || afterColumns.points || ""}`.trim();
      if (!beforeGrade && afterGrade) newlyGraded.push(row);
      if (!before.dueAtText && row.dueAtText) newlyDue.push(row);
      if (before.dueAtText && row.dueAtText && normalizeText(before.dueAtText) !== normalizeText(row.dueAtText)) dueChanged.push({ before, after: row });
      if (normalizeText(before.availabilityText || "") !== normalizeText(row.availabilityText || "")) availabilityChanged.push({ before, after: row });
      if (!before.localPath && row.localPath) newlyDownloaded.push(row);
      if (!feedbackSignal(before) && feedbackSignal(row)) newlyFeedback.push(row);
    }
  }

  for (const row of previous.rows) {
    if (!currentById.has(row.id)) removed.push(row);
  }

  const limit = (items) => items.slice(0, 200);
  return {
    available: true,
    previousExportedAt: previous.exportedAt || "",
    currentExportedAt: current.exportedAt || "",
    totals: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      newlyGraded: newlyGraded.length,
      newlyDue: newlyDue.length,
      dueChanged: dueChanged.length,
      availabilityChanged: availabilityChanged.length,
      newlyDownloaded: newlyDownloaded.length,
      newlyFeedback: newlyFeedback.length
    },
    added: limit(added),
    removed: limit(removed),
    changed: limit(changed),
    newlyGraded: limit(newlyGraded),
    newlyDue: limit(newlyDue),
    dueChanged: limit(dueChanged),
    availabilityChanged: limit(availabilityChanged),
    newlyDownloaded: limit(newlyDownloaded),
    newlyFeedback: limit(newlyFeedback)
  };
}

function manifestFromSource(input) {
  const inputIsDirectory = fs.statSync(input).isDirectory();
  const primary = inputIsDirectory ? path.join(input, "manifest.json") : input;
  if (fs.existsSync(primary)) return JSON.parse(fs.readFileSync(primary, "utf8"));
  const recovered = inputIsDirectory ? path.join(input, "recovered-manifest.json") : "";
  if (recovered && fs.existsSync(recovered)) return JSON.parse(fs.readFileSync(recovered, "utf8"));
  if (inputIsDirectory) return recoverManifestFromArchive(input);
  throw new Error(`No manifest found for ${input}`);
}

function changeReportMarkdown(changeReport) {
  const itemLine = (row) => `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source || "item"} | ${row.title || "(untitled)"}`;
  const changedLine = (entry) => {
    const before = entry.before || {};
    const after = entry.after || {};
    return `- ${after.courseTitle || after.courseOrgUnitId || "Unknown course"} | ${after.source || "item"} | ${after.title || "(untitled)"} | due: ${before.dueAtText || "(blank)"} -> ${after.dueAtText || "(blank)"} | status: ${before.status || "(blank)"} -> ${after.status || "(blank)"}`;
  };
  const lines = [
    "# D2L Offline Change Report",
    "",
    `Current export: ${changeReport.currentExportedAt || ""}`,
    `Previous export: ${changeReport.previousExportedAt || ""}`,
    ""
  ];
  if (!changeReport.available) {
    lines.push("No previous export rows were available for comparison.", "", `Reason: ${changeReport.reason || "unknown"}`);
    return lines.join("\n");
  }
  lines.push("## Totals", "");
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
  for (const [title, items, formatter] of [
    ["New Feedback / Results", changeReport.newlyFeedback || [], itemLine],
    ["Newly Graded", changeReport.newlyGraded, itemLine],
    ["Newly Due", changeReport.newlyDue, itemLine],
    ["Due Date Changed", changeReport.dueChanged || [], changedLine],
    ["Availability Changed", changeReport.availabilityChanged || [], changedLine],
    ["Added", changeReport.added, itemLine],
    ["Removed", changeReport.removed, itemLine],
    ["Changed", changeReport.changed, changedLine],
    ["Newly Downloaded", changeReport.newlyDownloaded, itemLine]
  ]) {
    lines.push(`## ${title}`, "");
    if (!items.length) lines.push("- None");
    else items.forEach((item) => lines.push(formatter(item)));
    lines.push("");
  }
  return lines.join("\n");
}

function aiIndexRecord(row) {
  const columns = parseJson(row.columns);
  const ids = parseJson(row.ids);
  return {
    id: stableRowId(row),
    courseOrgUnitId: row.courseOrgUnitId || "",
    courseTitle: row.courseTitle || "",
    source: row.source || "",
    title: row.title || "",
    status: row.status || "",
    type: row.type || "",
    linkKind: columns.linkKind || "",
    text: [
      row.title,
      row.description,
      row.status,
      row.gate,
      row.type,
      row.dueAtText,
      row.availabilityText,
      columns.module,
      columns.topicType,
      columns.displayedGrade,
      columns.points,
      columns.commentsAndAssessments,
      columns.feedbackText,
      columns.rubricText,
      columns.criterionName,
      columns.rubricLevel,
      columns.scoreText,
      columns.status,
      columns.assignmentTitle,
      columns.quizTitle,
      columns.discussionTopicId,
      columns.author,
      columns.postSubject,
      columns.calendarEventTitle,
      columns.contentTitle,
      columns.linkKind,
      columns.recoveredFrom,
      columns.toolSource,
      columns.emptyStateText,
      columns.blockedText,
      row.localPageTextSnippet
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
    dueAtText: row.dueAtText || "",
    availabilityText: row.availabilityText || "",
    itemUrl: row.itemUrl || "",
    localPath: row.localPath || "",
    localPageTextPath: row.localPageTextPath || "",
    localPageTextSnippet: row.localPageTextSnippet || "",
    ids,
    columns
  };
}

function toJsonl(records) {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

  return {
    stableRowId,
    rowSignature,
    createExportSummary,
    feedbackSignal,
    summarizeChanges,
    manifestFromSource,
    changeReportMarkdown,
    aiIndexRecord,
    toJsonl
  };
}
