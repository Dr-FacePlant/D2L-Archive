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
      shared.normalizeText(row.itemUrl || row.pageUrl),
      shared.normalizeText(row.title)
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

  Object.assign(shared, { pageKey, flattenItem, toCsv, toJsonl, parseColumns, stableRowId, rowSignature });
})();
