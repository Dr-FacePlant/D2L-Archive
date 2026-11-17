(function initBackgroundModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, slug, classifyUrl, isSafeReadOnlyUrl, pageKey, flattenItem, toCsv, toJsonl } = shared;
  const { pageTextSnippetMap, dropRedirectedHomepageRows, downloadPageSnapshots } = background;
  // Delegated to export-probes: probeCacheKey, deltaProbes, withPageProbes && (probeTab?.id || probeTab?.mode === "frame")
  const { LAST_EXPORT_KEY, DOWNLOAD_MIME, aiIndexRecord, createExportSummary, summarizeChanges, scopeSummaryToCourses, mergeExportSummaries, summarizeCoverage, auditMarkdown, changeReportMarkdown, actionBriefMarkdown, studentQuestionsMarkdown, queryGuideMarkdown, downloadCourseFiles, downloadText, createWorkerTabs, navigateAndExtract, collectAssignmentProbePages, collectQuizProbePages, collectAnnouncementProbePages, collectDiscussionListProbePages, ingestAndOrganizeRows, buildCourseKnowledgeFiles } = background;

function categoryFreshness(rows, apiSummary = {}) {
  const at = new Date().toISOString();
  const sources = new Set((rows || []).map((row) => row.source));
  const probeFailed = (name) => Number(apiSummary?.[name]?.failed || 0) > 0;
  const has = (...names) => names.some((name) => sources.has(name));
  const entry = (available, failed = false, source = "api") => ({ at, status: failed ? "partial" : available ? "fresh" : "fresh-empty", source });
  return {
    obligations: entry(has("assignment", "quiz", "discussionTopic", "checklistItem", "calendarEvent"), probeFailed("assignmentProbePages") || probeFailed("quizProbePages")),
    announcements: entry(has("announcement", "announcementAttachment"), probeFailed("announcementProbePages")),
    calendar: entry(has("calendarEvent", "calendarAttachment")),
    discussions: entry(has("discussionForum", "discussionTopic", "discussionPost", "discussionAttachment"), probeFailed("discussionProbePages")),
    grades: entry(has("gradeItem", "gradeFeedback", "finalGrade"), probeFailed("gradeProbePages")),
    materials: entry(has("contentTopic", "contentAttachment", "syllabusPolicy")),
    secondary: entry(has("checklistItem", "survey", "group", "attendanceRecord", "progressRecord", "classlistEntry", "courseToolPage"), probeFailed("courseToolProbePages"))
  };
}

async function writePreliminaryExportFiles(archiveRoot, rows, pagePayloads, crawlMeta, previousSummary, droppedRedirectRows) {
  const preliminarySummary = createExportSummary(rows);
  const preliminaryChangeReport = summarizeChanges(previousSummary, preliminarySummary);
  const preliminaryAudit = summarizeCoverage(pagePayloads, rows, preliminaryChangeReport);
  preliminaryAudit.totals.downloadedFiles = 0;
  preliminaryAudit.totals.droppedRedirectRows = droppedRedirectRows;
  preliminaryAudit.totals.apiSummary = crawlMeta.apiSummary || null;
  preliminaryAudit.totals.changeReport = preliminaryChangeReport.totals;
  await downloadText(`${archiveRoot}/manifest.json`, JSON.stringify({
    exportedAt: new Date().toISOString(), phase: "pre-files", crawlMeta, audit: preliminaryAudit, changeReport: preliminaryChangeReport, pages: pagePayloads, rows
  }, null, 2), DOWNLOAD_MIME.json, false);
  await downloadText(`${archiveRoot}/manifest.csv`, toCsv(rows), DOWNLOAD_MIME.csv, false);
  await downloadText(`${archiveRoot}/ai-index.ndjson`, toJsonl(rows.map(aiIndexRecord)), DOWNLOAD_MIME.jsonl, false);
  await downloadText(`${archiveRoot}/export-progress.json`, JSON.stringify({
    archiveRoot, phase: "pre-files", wroteRootManifest: true, pages: pagePayloads.length, rows: rows.length, writtenAt: new Date().toISOString()
  }, null, 2), DOWNLOAD_MIME.json, false);
}

async function organizeAndExportKnowledge(archiveRoot, rows, accountRepository, crawlMeta) {
  let knowledge = null;
  try {
    knowledge = await ingestAndOrganizeRows(rows, {
      repository: accountRepository,
      mode: crawlMeta.mode || "export",
      completeCourseSnapshot: crawlMeta.completeCourseSnapshot === true,
      categoryFreshness: crawlMeta.categoryFreshness || categoryFreshness(rows, crawlMeta.apiSummary)
    });
    crawlMeta.knowledgeSummary = {
      syncRunId: knowledge.syncRunId, databaseRevision: knowledge.databaseRevision, ingest: knowledge.ingest,
      courses: knowledge.courses, entityCount: knowledge.entityCount, relationshipCount: knowledge.relationshipCount
    };
    await downloadText(`${archiveRoot}/entities.json`, JSON.stringify(knowledge.entities, null, 2), DOWNLOAD_MIME.json, false);
    await downloadText(`${archiveRoot}/relationships.json`, JSON.stringify(knowledge.relationships, null, 2), DOWNLOAD_MIME.json, false);
    await downloadText(`${archiveRoot}/evidence.ndjson`, toJsonl(knowledge.evidence || []), DOWNLOAD_MIME.jsonl, false);
    await downloadText(`${archiveRoot}/extraction-gaps.json`, JSON.stringify(knowledge.entities.filter((entity) => entity.entityType === "extractionState"), null, 2), DOWNLOAD_MIME.json, false);
  } catch (error) {
    crawlMeta.knowledgeSummary = { error: error?.message || "Knowledge organization failed." };
  }
  return knowledge;
}

function buildRootExportIndex(archiveRoot, crawlMeta, audit) {
  return JSON.stringify({
    archiveRoot, exportedAt: new Date().toISOString(), crawlMeta,
    manifestCsv: `${archiveRoot}/manifest.csv`, manifestJson: `${archiveRoot}/manifest.json`,
    aiIndexJsonl: `${archiveRoot}/ai-index.ndjson`, aiIndexNdjson: `${archiveRoot}/ai-index.ndjson`,
    auditReport: `${archiveRoot}/audit-report.md`, changeReport: `${archiveRoot}/change-report.md`,
    studentActionBrief: `${archiveRoot}/student-action-brief.md`, studentQuestions: `${archiveRoot}/student-questions.md`,
    queryGuide: `${archiveRoot}/query-guide.md`, evidenceJsonl: `${archiveRoot}/evidence.ndjson`,
    evidenceNdjson: `${archiveRoot}/evidence.ndjson`, entitiesJson: `${archiveRoot}/entities.json`,
    relationshipsJson: `${archiveRoot}/relationships.json`, extractionGapsJson: `${archiveRoot}/extraction-gaps.json`,
    totals: audit.totals,
    courses: audit.byCourse.map((course) => ({
      courseOrgUnitId: course.courseOrgUnitId, courseTitle: course.courseTitle,
      folder: `${archiveRoot}/courses/${slug(`${course.courseOrgUnitId}-${course.courseTitle}`, course.courseOrgUnitId)}`,
      pagesVisited: course.pagesVisited, pageTypes: course.pageTypes, sources: course.sources, warnings: course.warnings.length
    }))
  }, null, 2);
}

async function writeRootExportReports(archiveRoot, rows, pagePayloads, crawlMeta, previousSummary, droppedRedirectRows, downloadedFiles, exportAccountId) {
  const currentSummary = createExportSummary(rows);
  const changeReport = summarizeChanges(previousSummary, currentSummary);
  const audit = summarizeCoverage(pagePayloads, rows, changeReport);
  audit.totals.downloadedFiles = downloadedFiles;
  audit.totals.droppedRedirectRows = droppedRedirectRows;
  audit.totals.apiSummary = crawlMeta.apiSummary || null;
  audit.totals.changeReport = changeReport.totals;
  const json = JSON.stringify({ exportedAt: new Date().toISOString(), crawlMeta, audit, changeReport, pages: pagePayloads, rows }, null, 2);
  const csv = toCsv(rows);

  await downloadText(`${archiveRoot}/manifest.csv`, csv, DOWNLOAD_MIME.csv, false);
  await downloadText(`${archiveRoot}/manifest.json`, json, DOWNLOAD_MIME.json, false);
  await downloadText(`${archiveRoot}/ai-index.ndjson`, toJsonl(rows.map(aiIndexRecord)), DOWNLOAD_MIME.jsonl, false);
  await downloadText(`${archiveRoot}/audit-report.md`, auditMarkdown(audit), DOWNLOAD_MIME.md, false);
  await downloadText(`${archiveRoot}/change-report.md`, changeReportMarkdown(changeReport), DOWNLOAD_MIME.md, false);
  await downloadText(`${archiveRoot}/change-report.json`, JSON.stringify(changeReport, null, 2), DOWNLOAD_MIME.json, false);
  await downloadText(`${archiveRoot}/student-action-brief.md`, actionBriefMarkdown(rows, audit, changeReport), DOWNLOAD_MIME.md, false);
  await downloadText(`${archiveRoot}/student-questions.md`, studentQuestionsMarkdown(rows, audit), DOWNLOAD_MIME.md, false);
  await downloadText(`${archiveRoot}/query-guide.md`, queryGuideMarkdown(), DOWNLOAD_MIME.md, false);
  await downloadText(`${archiveRoot}/index.json`, buildRootExportIndex(archiveRoot, crawlMeta, audit), DOWNLOAD_MIME.json, false);
  await downloadText(`${archiveRoot}/export-progress.json`, JSON.stringify({
    archiveRoot, phase: "complete", wroteRootManifest: true, wroteCourseManifests: false,
    pages: pagePayloads.length, rows: rows.length, downloadedFiles, writtenAt: new Date().toISOString()
  }, null, 2), DOWNLOAD_MIME.json, false);
  const storedSummary = (await background.readAccountScoped(LAST_EXPORT_KEY, exportAccountId)) || null;
  await background.writeAccountScoped(LAST_EXPORT_KEY, exportAccountId, mergeExportSummaries(storedSummary, currentSummary));
  return audit;
}

async function writeCourseKnowledgeExports(courseFolder, courseId, courseTitle, knowledge) {
  if (!knowledge) return;
  const { courseEntities, upcoming, knowledgeIndexJson, courseSummaryMarkdown } = buildCourseKnowledgeFiles({ courseId, courseTitle, entities: knowledge.entities, relationships: knowledge.relationships });
  const grades = courseEntities.filter((entity) => entity.entityType === "gradeRecord");
  const people = courseEntities.filter((entity) => entity.entityType === "person");
  const externalResources = courseEntities.filter((entity) => entity.entityType === "externalResource");
  const extractionGaps = courseEntities.filter((entity) => entity.entityType === "extractionState");
  await downloadText(`${courseFolder}/knowledge-index.json`, knowledgeIndexJson, DOWNLOAD_MIME.json, false);
  await downloadText(`${courseFolder}/upcoming-work.json`, JSON.stringify(upcoming, null, 2), DOWNLOAD_MIME.json, false);
  await downloadText(`${courseFolder}/grades.json`, JSON.stringify(grades, null, 2), DOWNLOAD_MIME.json, false);
  await downloadText(`${courseFolder}/people.json`, JSON.stringify(people, null, 2), DOWNLOAD_MIME.json, false);
  await downloadText(`${courseFolder}/external-resources.json`, JSON.stringify(externalResources, null, 2), DOWNLOAD_MIME.json, false);
  await downloadText(`${courseFolder}/extraction-gaps.json`, JSON.stringify(extractionGaps, null, 2), DOWNLOAD_MIME.json, false);
  await downloadText(`${courseFolder}/course-summary.md`, courseSummaryMarkdown, DOWNLOAD_MIME.md, false);
}

async function writeCourseExports(archiveRoot, rows, audit, knowledge) {
  const byCourse = new Map();
  for (const row of rows) {
    const key = row.courseOrgUnitId || "unknown";
    if (!byCourse.has(key)) byCourse.set(key, []);
    byCourse.get(key).push(row);
  }
  for (const [courseId, courseRows] of byCourse) {
    const courseTitle = courseRows.find((row) => row.courseTitle)?.courseTitle || courseId;
    const courseFolder = `${archiveRoot}/courses/${slug(`${courseId}-${courseTitle}`, courseId)}`;
    const courseAudit = audit.byCourse.find((course) => course.courseOrgUnitId === courseId) || null;
    const fileRows = courseRows.filter((row) => row.localPath);
    const pageRows = [...new Set(courseRows.map((row) => row.localPageTextPath).filter(Boolean))];
    await downloadText(`${courseFolder}/course.json`, JSON.stringify({
      courseOrgUnitId: courseId, courseTitle, folder: courseFolder,
      itemsCsv: `${courseFolder}/items.csv`, itemsJson: `${courseFolder}/items.json`,
      filesFolder: `${courseFolder}/files/`, pagesFolder: `${courseFolder}/pages/`,
      rowCount: courseRows.length, downloadedFileCount: fileRows.length, pageSnapshotCount: pageRows.length,
      sources: courseAudit?.sources || {}, pageTypes: courseAudit?.pageTypes || {}, warnings: courseAudit?.warnings || []
    }, null, 2), DOWNLOAD_MIME.json, false);
    await downloadText(`${courseFolder}/items.csv`, toCsv(courseRows), DOWNLOAD_MIME.csv, false);
    await downloadText(`${courseFolder}/items.json`, JSON.stringify(courseRows, null, 2), DOWNLOAD_MIME.json, false);
    await downloadText(`${courseFolder}/ai-index.ndjson`, toJsonl(courseRows.map(aiIndexRecord)), DOWNLOAD_MIME.jsonl, false);
    await writeCourseKnowledgeExports(courseFolder, courseId, courseTitle, knowledge);
  }
}

async function downloadResults(rows, pagePayloads, archiveRoot, crawlMeta = {}) {
  const activityCorrelationId = crawlMeta.syncRunId || `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { repository: accountRepository, accountId: exportAccountId } = crawlMeta.repository && crawlMeta.accountId
    ? { repository: crawlMeta.repository, accountId: crawlMeta.accountId }
    : await background.resolveExportRepository({ tabId: crawlMeta.verifyTabId, expectedAccountId: crawlMeta.expectedAccountId });
  await accountRepository.recordActivity({ operation: "export.start", category: "export", status: "started", source: crawlMeta.mode || "export", correlationId: activityCorrelationId, details: { rows: rows.length, pages: pagePayloads.length } }).catch(() => {});
  const downloadOptions = { reuseArchivedFiles: crawlMeta.reuseArchivedFiles === true, repository: accountRepository };
  if (crawlMeta.downloadFiles === true || crawlMeta.downloadFiles === false) downloadOptions.downloadFiles = crawlMeta.downloadFiles;
  const droppedRedirectRows = dropRedirectedHomepageRows(rows, pagePayloads);
  const storedSummary = (await background.readAccountScoped(LAST_EXPORT_KEY, exportAccountId)) || null;
  const previousSummary = scopeSummaryToCourses(storedSummary, new Set(rows.map((row) => row.courseOrgUnitId || "")));

  await writePreliminaryExportFiles(archiveRoot, rows, pagePayloads, crawlMeta, previousSummary, droppedRedirectRows);

  const pageTextPaths = await downloadPageSnapshots(pagePayloads, archiveRoot);
  const pageTextSnippets = pageTextSnippetMap(pagePayloads);
  for (const row of rows) {
    row.localPageTextPath = pageTextPaths.get(row.pageUrl) || "";
    row.localPageTextSnippet = pageTextSnippets.get(row.pageUrl) || "";
  }
  const downloadedFiles = await downloadCourseFiles(rows, archiveRoot, downloadOptions);
  const knowledge = await organizeAndExportKnowledge(archiveRoot, rows, accountRepository, crawlMeta);
  const audit = await writeRootExportReports(archiveRoot, rows, pagePayloads, crawlMeta, previousSummary, droppedRedirectRows, downloadedFiles, exportAccountId);
  await writeCourseExports(archiveRoot, rows, audit, knowledge);

  await downloadText(`${archiveRoot}/export-progress.json`, JSON.stringify({
    archiveRoot, phase: "complete", wroteRootManifest: true, wroteCourseManifests: true,
    pages: pagePayloads.length, rows: rows.length, downloadedFiles, writtenAt: new Date().toISOString()
  }, null, 2), DOWNLOAD_MIME.json, false);
  await accountRepository.recordActivity({ operation: "export.complete", category: "export", status: "completed", source: crawlMeta.mode || "export", correlationId: activityCorrelationId, details: { rows: rows.length, pages: pagePayloads.length, downloadedFiles } }).catch(() => {});
}

  Object.assign(background, {
    categoryFreshness,
    downloadResults
  });
})(globalThis);
