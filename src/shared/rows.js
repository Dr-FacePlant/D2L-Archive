(() => {
  const shared = globalThis.D2LExtractorShared ||= {};

  function pageKey(pagePayload) {
    return pagePayload.crawlTask?.requestedUrl || pagePayload.page?.url || "";
  }

  function flattenItem(pagePayload, item) {
    return {
      crawledAt: new Date().toISOString(),
      pageType: pagePayload.pageType || "",
      pageTitle: pagePayload.page?.title || "",
      pageUrl: pageKey(pagePayload),
      courseOrgUnitId: item.ids?.courseOrgUnitId || pagePayload.course?.orgUnitId || "",
      courseTitle: pagePayload.course?.title || "",
      source: item.source || "",
      title: item.title || "",
      description: item.description || "",
      status: item.status || "",
      gate: item.gate || "",
      type: item.type || "",
      dueAtText: item.dueAtText || "",
      availabilityText: item.availabilityText || "",
      itemUrl: item.url || "",
      downloadUrl: item.downloadUrl || "",
      suggestedFileName: item.suggestedFileName || "",
      historyUrl: item.historyUrl || "",
      feedbackUrl: item.feedbackUrl || "",
      localPath: item.localPath || "",
      downloadError: item.downloadError || "",
      localPageTextPath: "",
      localPageTextSnippet: "",
      ids: JSON.stringify(item.ids || {}),
      columns: JSON.stringify(item.columns || {})
    };
  }

  function toCsv(rows) {
    return [
      shared.CSV_COLUMNS.join(","),
      ...rows.map((row) => shared.CSV_COLUMNS.map((header) => shared.csvEscape(row[header])).join(","))
    ].join("\n");
  }

  function toJsonl(records) {
    return records.map((record) => JSON.stringify(record)).join("\n");
  }

  function parseColumns(row) {
    try {
      return JSON.parse(row.columns || "{}");
    } catch {
      return {};
    }
  }

  function stableRowId(row) {
    const ids = parseColumns({ columns: row.ids });
    const columns = parseColumns(row);
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
      ids.rubricId,
      ids.gradeCategoryId,
      ids.checklistId,
      ids.checklistCategoryId,
      ids.checklistItemId,
      ids.surveyId,
      ids.surveyAttemptId,
      ids.surveyQuestionId,
      ids.groupCategoryId,
      ids.groupId,
      ids.userId,
      columns.recoveredFrom ? `observation:${columns.recoveredFrom}` : "",
      (shared.normalizeText || ((s) => String(s || "").trim()))(row.itemUrl || row.pageUrl),
      (shared.normalizeText || ((s) => String(s || "").trim()))(row.title)
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
      downloadError: row.downloadError || "",
      ids: row.ids || "",
      columns: row.columns || ""
    });
  }

  const INDEXED_COLUMN_KEYS = Object.freeze([
    "module", "topicType", "displayedGrade", "points", "commentsAndAssessments",
    "feedbackText", "rubricText", "criterionName", "rubricLevel", "scoreText",
    "status", "assignmentTitle", "quizTitle", "discussionTopicId", "author",
    "postSubject", "calendarEventTitle", "contentTitle", "linkKind",
    "recoveredFrom", "toolSource", "emptyStateText", "blockedText"
  ]);

  function recordTextSnippet(row, columns) {
    const norm = shared.normalizeText || ((s) => String(s || "").trim().replace(/\s+/g, " "));
    const parts = [
      row.title, row.description, row.status, row.gate, row.type, row.dueAtText, row.availabilityText,
      ...INDEXED_COLUMN_KEYS.map((k) => columns[k]),
      row.localPageTextSnippet
    ];
    return norm(parts.filter(Boolean).join(" "));
  }

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
      text: recordTextSnippet(row, columns),
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

  function createExportSummary(source) {
    const sourceRows = Array.isArray(source?.rows) ? source.rows : (Array.isArray(source) ? source : []);
    const exportedAt = source?.exportedAt || source?.audit?.generatedAt || new Date().toISOString();
    return {
      exportedAt,
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

  const FEEDBACK_SOURCES = Object.freeze([
    "assignmentFeedback", "gradeFeedback", "quizAttempt", "quizSubmission",
    "quizAttemptRow", "quizSummaryRow", "quizQuestionResult",
    "discussionFeedback", "rubricFeedback", "rubricCriterionFeedback"
  ]);

  function feedbackSignal(row) {
    if (FEEDBACK_SOURCES.includes(row.source)) return row.source;
    const columns = parseColumns(row);
    const text = [
      columns.feedbackText,
      columns.rubricText,
      columns.commentsAndAssessments
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    return /feedback|comment|rubric|assessment/i.test(text) ? text : "";
  }

  function emptyChangeReport(previous, current, reason) {
    return {
      available: false,
      previousExportedAt: previous?.exportedAt || "",
      currentExportedAt: current?.exportedAt || "",
      reason: reason || "No previous export summary was stored in this browser profile.",
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

  function diffRow(before, row, state, normalize) {
    state.changed.push({ before, after: row });
    const beforeColumns = parseColumns(before);
    const afterColumns = parseColumns(row);
    const beforeGrade = normalize(beforeColumns.displayedGrade || beforeColumns.pointsEarned || beforeColumns.points || "");
    const afterGrade = normalize(afterColumns.displayedGrade || afterColumns.pointsEarned || afterColumns.points || "");
    if (!beforeGrade && afterGrade) state.newlyGraded.push(row);
    if (!before.dueAtText && row.dueAtText) state.newlyDue.push(row);
    if (before.dueAtText && row.dueAtText && normalize(before.dueAtText) !== normalize(row.dueAtText)) state.dueChanged.push({ before, after: row });
    if (normalize(before.availabilityText || "") !== normalize(row.availabilityText || "")) state.availabilityChanged.push({ before, after: row });
    if (!before.localPath && row.localPath) state.newlyDownloaded.push(row);
    if (!feedbackSignal(before) && feedbackSignal(row)) state.newlyFeedback.push(row);
  }

  function summarizeChanges(previous, current, customNormalize) {
    const normalize = customNormalize || shared.normalizeText || ((s) => String(s || "").trim());
    if (!previous?.rows?.length) return emptyChangeReport(previous, current);

    const previousById = new Map(previous.rows.map((row) => [row.id, row]));
    const currentById = new Map(current.rows.map((row) => [row.id, row]));
    const state = {
      added: [], removed: [], changed: [], newlyGraded: [], newlyDue: [],
      dueChanged: [], availabilityChanged: [], newlyDownloaded: [], newlyFeedback: []
    };

    for (const row of current.rows) {
      const before = previousById.get(row.id);
      if (!before) {
        state.added.push(row);
        if (feedbackSignal(row)) state.newlyFeedback.push(row);
        continue;
      }
      if (before.signature !== row.signature) {
        diffRow(before, row, state, normalize);
      }
    }

    for (const row of previous.rows) {
      if (!currentById.has(row.id)) state.removed.push(row);
    }

    const limit = (items) => items.slice(0, 200);
    return {
      available: true,
      previousExportedAt: previous.exportedAt || "",
      currentExportedAt: current.exportedAt || "",
      totals: {
        added: state.added.length,
        removed: state.removed.length,
        changed: state.changed.length,
        newlyGraded: state.newlyGraded.length,
        newlyDue: state.newlyDue.length,
        dueChanged: state.dueChanged.length,
        availabilityChanged: state.availabilityChanged.length,
        newlyDownloaded: state.newlyDownloaded.length,
        newlyFeedback: state.newlyFeedback.length
      },
      added: limit(state.added),
      removed: limit(state.removed),
      changed: limit(state.changed),
      newlyGraded: limit(state.newlyGraded),
      newlyDue: limit(state.newlyDue),
      dueChanged: limit(state.dueChanged),
      availabilityChanged: limit(state.availabilityChanged),
      newlyDownloaded: limit(state.newlyDownloaded),
      newlyFeedback: limit(state.newlyFeedback)
    };
  }


  const STUDENT_FEEDBACK_SOURCES = Object.freeze([
    "assignmentSubmission", "assignmentFeedback", "submittedFile",
    "quizAttempt", "quizSubmission", "quizAttemptRow", "quizSummaryRow", "quizQuestionResult",
    "gradeFeedback", "discussionFeedback", "rubricFeedback", "rubricCriterionFeedback"
  ]);

  function isStudentFeedbackRow(row) {
    return STUDENT_FEEDBACK_SOURCES.includes(row?.source);
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

  Object.assign(shared, {
    STUDENT_FEEDBACK_SOURCES, isStudentFeedbackRow, uniqueRows,
    pageKey, flattenItem, toCsv, toJsonl, parseColumns, stableRowId, rowSignature,
    INDEXED_COLUMN_KEYS, recordTextSnippet, aiIndexRecord, createExportSummary,
    FEEDBACK_SOURCES, feedbackSignal, emptyChangeReport, diffRow, summarizeChanges
  });
  if (typeof module !== "undefined" && module.exports) module.exports = shared;
})();
