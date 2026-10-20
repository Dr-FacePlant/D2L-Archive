(() => {
  const shared = globalThis.D2LExtractorShared ||= {};
  const { normalizeText, canonicalUrl, parseColumns } = shared;

  const ID_PRIORITY = Object.freeze([
    "contentObjectId",
    "quizId",
    "attemptId",
    "dropboxFolderId",
    "assignmentFolderId",
    "submissionId",
    "gradeObjectId",
    "calendarEventId",
    "newsItemId",
    "discussionForumId",
    "discussionTopicId",
    "postId",
    "rubricId",
    "fileId"
  ]);

  const SOURCE_ID_PRIORITY = Object.freeze({
    contentAttachment: ["fileId", "contentObjectId"],
    courseOverviewAttachment: ["fileId", "contentObjectId"],
    submittedFile: ["fileId", "submissionId", "assignmentFolderId", "dropboxFolderId"],
    announcementAttachment: ["fileId", "newsItemId"],
    classlistEntry: ["userId"],
    checklistItem: ["checklistItemId", "checklistId"],
    survey: ["surveyId"],
    surveyAttempt: ["surveyAttemptId", "surveyId"],
    surveyQuestion: ["surveyQuestionId", "surveyId"],
    group: ["groupId", "groupCategoryId"],
    courseToolPage: ["checklistId", "groupCategoryId"],
    discussionTopic: ["discussionTopicId", "discussionForumId"],
    gradeCategory: ["gradeCategoryId"],
    discussionPost: ["postId", "discussionTopicId"],
    discussionAttachment: ["fileId", "postId", "discussionTopicId"],
    discussionFeedback: ["discussionTopicId"],
    contentModule: ["contentModuleId"],
    contentCompletion: ["completionScope"],
    courseOffering: ["courseOrgUnitId"],
    rubric: ["rubricObjectKey", "rubricId"],
    rubricFeedback: ["rubricObjectKey", "rubricId"],
    assignmentSubmission: ["submissionId", "assignmentFolderId", "dropboxFolderId"],
    quizAttempt: ["attemptId", "quizId"],
    quizAttemptRow: ["attemptId", "quizId"],
    quizQuestionResult: ["attemptId", "quizId", "questionNumber"]
  });

  function stableObject(value) {
    if (Array.isArray(value)) return value.map(stableObject);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
  }

  function stableStringify(value) {
    return JSON.stringify(stableObject(value));
  }

  function fnv1a(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value || "")) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function normalizedDate(value) {
    const text = normalizeText(value);
    if (!text) return null;
    const candidate = text
      .replace(/^(?:due|submitted|graded|completed|started)(?:\s+on)?\s*:?[ ]*/i, "")
      .replace(/\b(?:EST|EDT)\b/i, "")
      .trim();
    const time = Date.parse(candidate);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }

  function strongestPlatformIdentity(ids, source = "") {
    const priority = [...(SOURCE_ID_PRIORITY[source] || []), ...ID_PRIORITY];
    for (const key of [...new Set(priority)]) {
      const value = normalizeText(ids?.[key]);
      if (value) return { key, value };
    }
    return null;
  }

  function canonicalEvidenceUrl(row) {
    return canonicalUrl(row.itemUrl || row.downloadUrl || row.feedbackUrl || row.historyUrl || row.pageUrl || "") || "";
  }

  function evidenceIdentity(row) {
    const courseId = normalizeText(row.courseOrgUnitId) || "unknown";
    const source = normalizeText(row.source) || "unknown";
    const ids = parseColumns({ columns: row.ids });
    const columns = parseColumns(row);
    const platformIdentity = strongestPlatformIdentity(ids, source);
    if (source === "apiProbe") {
      const probeKind = normalizeText(row.type || row.title).toLowerCase();
      const target = platformIdentity ? `${platformIdentity.key}:${platformIdentity.value}` : "course";
      return `${courseId}:${source}:${target}:probe:${fnv1a(probeKind)}`;
    }
    if (source === "announcementLink") {
      const newsItemId = normalizeText(ids.newsItemId) || "unknown";
      const url = canonicalEvidenceUrl(row);
      return `${courseId}:${source}:newsItemId:${newsItemId}:url:${fnv1a(url || normalizeText(row.title))}`;
    }
    if (platformIdentity) {
      const recoveredFrom = normalizeText(columns.recoveredFrom);
      if (recoveredFrom && normalizeText(row.pageType) !== "valenceApi") {
        return `${courseId}:${source}:${platformIdentity.key}:${platformIdentity.value}:observation:${fnv1a(recoveredFrom)}`;
      }
      return `${courseId}:${source}:${platformIdentity.key}:${platformIdentity.value}`;
    }
    const url = canonicalEvidenceUrl(row);
    if (url) return `${courseId}:${source}:url:${url}`;
    const fallback = stableStringify({
      courseId,
      source,
      title: normalizeText(row.title),
      type: normalizeText(row.type),
      pageType: normalizeText(row.pageType)
    });
    return `${courseId}:${source}:hash:${fnv1a(fallback)}`;
  }

  function evidenceContentHash(evidence) {
    const raw = { ...(evidence.fields?.raw || {}) };
    for (const key of ["crawledAt", "localPath", "localPageTextPath", "localPageTextSnippet"]) delete raw[key];
    const fields = { ...(evidence.fields || {}), raw };
    return fnv1a(stableStringify({
      courseId: evidence.courseId,
      source: evidence.source,
      title: evidence.title,
      description: evidence.description,
      status: evidence.status,
      gate: evidence.gate,
      type: evidence.type,
      dates: evidence.dates,
      dateText: evidence.dateText,
      urls: evidence.urls,
      platformIds: evidence.platformIds,
      fields
    }));
  }

  function normalizeEvidenceRow(row, options = {}) {
    const ids = parseColumns({ columns: row.ids });
    const columns = parseColumns(row);
    const crawledAt = normalizeText(row.crawledAt) || options.extractedAt || new Date().toISOString();
    const evidence = {
      evidenceId: evidenceIdentity(row),
      revision: Number(options.revision || 1),
      courseId: normalizeText(row.courseOrgUnitId) || "unknown",
      courseTitle: normalizeText(row.courseTitle),
      source: normalizeText(row.source) || "unknown",
      originalSource: normalizeText(row.source),
      title: normalizeText(row.title),
      description: normalizeText(row.description),
      status: normalizeText(row.status),
      gate: normalizeText(row.gate),
      type: normalizeText(row.type),
      dates: {
        dueAt: normalizedDate(row.dueAtText || columns.dueAt || columns.dueDate),
        availableFrom: normalizedDate(columns.startDate || columns.availableFrom),
        availableUntil: normalizedDate(columns.endDate || columns.availableUntil),
        submittedAt: normalizedDate(columns.submittedAt || columns.submissionDate || columns.dateSubmitted),
        gradedAt: normalizedDate(columns.gradedAt || columns.gradedDate)
      },
      dateText: {
        dueAt: normalizeText(row.dueAtText),
        availability: normalizeText(row.availabilityText),
        submittedAt: normalizeText(columns.submittedAt || columns.submissionDate || columns.dateSubmitted),
        gradedAt: normalizeText(columns.gradedAt || columns.gradedDate)
      },
      urls: {
        item: normalizeText(row.itemUrl),
        page: normalizeText(row.pageUrl),
        download: normalizeText(row.downloadUrl),
        history: normalizeText(row.historyUrl),
        feedback: normalizeText(row.feedbackUrl),
        canonical: canonicalEvidenceUrl(row)
      },
      platformIds: ids,
      fields: {
        columns,
        suggestedFileName: normalizeText(row.suggestedFileName),
        downloadError: normalizeText(row.downloadError),
        raw: { ...row }
      },
      local: {
        filePath: normalizeText(row.localPath),
        pageTextPath: normalizeText(row.localPageTextPath),
        pageTextSnippet: normalizeText(row.localPageTextSnippet)
      },
      provenance: {
        pageType: normalizeText(row.pageType),
        pageTitle: normalizeText(row.pageTitle),
        extractedAt: crawledAt,
        extractorVersion: normalizeText(options.extractorVersion),
        syncRunId: normalizeText(options.syncRunId)
      },
      firstSeenAt: options.firstSeenAt || crawledAt,
      lastSeenAt: options.lastSeenAt || crawledAt
    };
    evidence.contentHash = evidenceContentHash(evidence);
    return evidence;
  }

  Object.assign(shared, {
    ID_PRIORITY,
    SOURCE_ID_PRIORITY,
    stableStringify,
    fnv1a,
    normalizedDate,
    strongestPlatformIdentity,
    canonicalEvidenceUrl,
    evidenceIdentity,
    evidenceContentHash,
    normalizeEvidenceRow
  });
})();
