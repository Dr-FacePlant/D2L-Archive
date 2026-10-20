(function initBackgroundReportModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, parseColumns, stableRowId, rowSignature } = shared;
  const {  } = background;

function aiIndexRecord(row) {
  const columns = parseColumns(row);
  const ids = parseColumns({ columns: row.ids });
  return {
    id: stableRowId(row),
    courseOrgUnitId: row.courseOrgUnitId || "",
    courseTitle: row.courseTitle || "",
    source: row.source || "",
    title: row.title || "",
    status: row.status || "",
    type: row.type || "",
    linkKind: columns.linkKind || "",
    text: normalizeText([
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
    ].filter(Boolean).join(" ")),
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

function createExportSummary(rows) {
  return {
    exportedAt: new Date().toISOString(),
    rows: rows.map((row) => ({
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
  const columns = parseColumns(row);
  if (["assignmentFeedback", "gradeFeedback", "quizAttempt", "quizSubmission", "quizAttemptRow", "quizSummaryRow", "quizQuestionResult", "discussionFeedback", "rubricFeedback", "rubricCriterionFeedback"].includes(row.source)) {
    return row.source;
  }
  const feedbackText = normalizeText([
    columns.feedbackText,
    columns.rubricText,
    columns.commentsAndAssessments
  ].filter(Boolean).join(" "));
  return /feedback|comment|rubric|assessment/i.test(feedbackText) ? feedbackText : "";
}

function summarizeChanges(previous, current) {
  if (!previous?.rows?.length) {
    return {
      available: false,
      previousExportedAt: previous?.exportedAt || "",
      currentExportedAt: current.exportedAt,
      reason: "No previous export summary was stored in this browser profile.",
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
      const beforeColumns = parseColumns(before);
      const afterColumns = parseColumns(row);
      const beforeGrade = normalizeText(beforeColumns.displayedGrade || beforeColumns.pointsEarned || beforeColumns.points || "");
      const afterGrade = normalizeText(afterColumns.displayedGrade || afterColumns.pointsEarned || afterColumns.points || "");
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
    currentExportedAt: current.exportedAt,
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

// Compare each course only against its own last export, so a run covering
// different courses does not report every other course's rows as removed.
function scopeSummaryToCourses(stored, courseIds) {
  if (!stored?.rows?.length) return stored || null;
  const rows = stored.rows.filter((row) => courseIds.has(row.courseOrgUnitId || ""));
  const times = [...courseIds].map((id) => stored.courseExportedAt?.[id]).filter(Boolean).sort();
  return { ...stored, exportedAt: rows.length ? (times[times.length - 1] || stored.exportedAt || "") : "", rows };
}

function mergeExportSummaries(stored, current) {
  const courseIds = new Set(current.rows.map((row) => row.courseOrgUnitId || ""));
  const kept = (stored?.rows || []).filter((row) => !courseIds.has(row.courseOrgUnitId || ""));
  const courseExportedAt = { ...(stored?.courseExportedAt || {}) };
  for (const id of courseIds) courseExportedAt[id] = current.exportedAt;
  return { ...current, courseExportedAt, rows: [...kept, ...current.rows] };
}

  Object.assign(background, { aiIndexRecord, createExportSummary, feedbackSignal, summarizeChanges, scopeSummaryToCourses, mergeExportSummaries });
})(globalThis);
