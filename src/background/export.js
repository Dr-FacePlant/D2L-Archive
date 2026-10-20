(function initBackgroundModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, slug, classifyUrl, isSafeReadOnlyUrl, pageKey, flattenItem, toCsv, toJsonl } = shared;
  const { LAST_EXPORT_KEY, DOWNLOAD_MIME, aiIndexRecord, createExportSummary, summarizeChanges, scopeSummaryToCourses, mergeExportSummaries, summarizeCoverage, auditMarkdown, changeReportMarkdown, actionBriefMarkdown, studentQuestionsMarkdown, queryGuideMarkdown, downloadCourseFiles, downloadText, createWorkerTabs, navigateAndExtract, collectAssignmentProbePages, collectQuizProbePages, collectAnnouncementProbePages, collectDiscussionListProbePages, ingestAndOrganizeRows, buildCourseKnowledgeFiles } = background;

function pageSnapshotMarkdown(pagePayload) {
  const page = pagePayload.page || {};
  const course = pagePayload.course || {};
  const requestedUrl = pagePayload.crawlTask?.requestedUrl || "";
  const redirected = requestedUrl && page.url && requestedUrl !== page.url;
  return [
    `# ${page.title || page.heading || "D2L Page"}`,
    "",
    `- URL: ${page.url || ""}`,
    redirected ? `- Requested URL (redirected away from): ${requestedUrl}` : null,
    `- Page type: ${pagePayload.pageType || ""}`,
    `- Course: ${course.title || ""}`,
    `- Course org unit: ${course.orgUnitId || ""}`,
    `- Extracted at: ${pagePayload.extractor?.extractedAt || ""}`,
    "",
    "## Text",
    "",
    page.text || ""
  ].filter((line) => line !== null).join("\n");
}

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

async function downloadPageSnapshots(pagePayloads, archiveRoot) {
  const byUrl = new Map();
  for (let index = 0; index < pagePayloads.length; index += 1) {
    const pagePayload = pagePayloads[index];
    const page = pagePayload.page || {};
    const key = pageKey(pagePayload);
    if (!key || byUrl.has(key)) continue;
    const courseId = pagePayload.course?.orgUnitId || "unknown";
    const courseTitle = pagePayload.course?.title || pagePayload.course?.pageTitle || "course";
    const courseFolder = slug(`${courseId}-${courseTitle}`, courseId);
    const fileName = `${String(index + 1).padStart(3, "0")}-${slug(`${pagePayload.pageType}-${page.title || page.heading}`, "page")}.md`;
    const localPath = `${archiveRoot}/courses/${courseFolder}/pages/${fileName}`;
    await downloadText(localPath, pageSnapshotMarkdown(pagePayload), DOWNLOAD_MIME.md, false);
    byUrl.set(key, localPath);
  }
  return byUrl;
}

function pageTextSnippetMap(pagePayloads) {
  const byUrl = new Map();
  for (const pagePayload of pagePayloads) {
    const key = pageKey(pagePayload);
    if (!key || byUrl.has(key)) continue;
    const text = normalizeText(pagePayload.page?.text || "");
    if (text) byUrl.set(key, text.slice(0, 1200));
  }
  return byUrl;
}

// Dead "Next"/"Previous" arrows on deleted content redirect to the course
// homepage, so each one produced a full duplicate set of homepage nav rows
// (216 measured on the 2026-09-17 export). The page is still archived; only its
// rows are dropped, since the real homepage is crawled on its own.
function dropRedirectedHomepageRows(rows, pagePayloads) {
  const junkPageUrls = new Set();
  for (const pagePayload of pagePayloads) {
    const requested = pagePayload.crawlTask?.requestedUrl || "";
    const final = pagePayload.page?.url || "";
    if (!requested || !final || requested === final) continue;
    if (/\/d2l\/home\/\d+/.test(final)) junkPageUrls.add(pageKey(pagePayload));
  }
  if (!junkPageUrls.size) return 0;

  let removed = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (junkPageUrls.has(rows[index].pageUrl)) {
      rows.splice(index, 1);
      removed += 1;
    }
  }
  return removed;
}

async function downloadResults(rows, pagePayloads, archiveRoot, crawlMeta = {}) {
  const activityCorrelationId = crawlMeta.syncRunId || `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // The export writes into the archive of the account D2L verified (never the stored
  // profile): the caller's already-verified destination, or a live check of its tab.
  const { repository: accountRepository, accountId: exportAccountId } = crawlMeta.repository && crawlMeta.accountId
    ? { repository: crawlMeta.repository, accountId: crawlMeta.accountId }
    : await background.resolveExportRepository({ tabId: crawlMeta.verifyTabId, expectedAccountId: crawlMeta.expectedAccountId });
  await accountRepository.recordActivity({ operation: "export.start", category: "export", status: "started", source: crawlMeta.mode || "export", correlationId: activityCorrelationId, details: { rows: rows.length, pages: pagePayloads.length } }).catch(() => {});
  const downloadOptions = { reuseArchivedFiles: crawlMeta.reuseArchivedFiles === true, repository: accountRepository };
  if (crawlMeta.downloadFiles === true || crawlMeta.downloadFiles === false) downloadOptions.downloadFiles = crawlMeta.downloadFiles;
  const droppedRedirectRows = dropRedirectedHomepageRows(rows, pagePayloads);
  const storedSummary = (await background.readAccountScoped(LAST_EXPORT_KEY, exportAccountId)) || null;
  const previousSummary = scopeSummaryToCourses(storedSummary, new Set(rows.map((row) => row.courseOrgUnitId || "")));
  const preliminarySummary = createExportSummary(rows);
  const preliminaryChangeReport = summarizeChanges(previousSummary, preliminarySummary);
  const preliminaryAudit = summarizeCoverage(pagePayloads, rows, preliminaryChangeReport);
  preliminaryAudit.totals.downloadedFiles = 0;
  preliminaryAudit.totals.droppedRedirectRows = droppedRedirectRows;
  preliminaryAudit.totals.apiSummary = crawlMeta.apiSummary || null;
  preliminaryAudit.totals.changeReport = preliminaryChangeReport.totals;
  await downloadText(`${archiveRoot}/manifest.json`, JSON.stringify({
    exportedAt: new Date().toISOString(),
    phase: "pre-files",
    crawlMeta,
    audit: preliminaryAudit,
    changeReport: preliminaryChangeReport,
    pages: pagePayloads,
    rows
  }, null, 2), DOWNLOAD_MIME.json, false);
  await downloadText(`${archiveRoot}/manifest.csv`, toCsv(rows), DOWNLOAD_MIME.csv, false);
  await downloadText(`${archiveRoot}/ai-index.ndjson`, toJsonl(rows.map(aiIndexRecord)), DOWNLOAD_MIME.jsonl, false);
  await downloadText(`${archiveRoot}/export-progress.json`, JSON.stringify({
    archiveRoot,
    phase: "pre-files",
    wroteRootManifest: true,
    pages: pagePayloads.length,
    rows: rows.length,
    writtenAt: new Date().toISOString()
  }, null, 2), DOWNLOAD_MIME.json, false);

  const pageTextPaths = await downloadPageSnapshots(pagePayloads, archiveRoot);
  const pageTextSnippets = pageTextSnippetMap(pagePayloads);
  for (const row of rows) {
    row.localPageTextPath = pageTextPaths.get(row.pageUrl) || "";
    row.localPageTextSnippet = pageTextSnippets.get(row.pageUrl) || "";
  }
  const downloadedFiles = await downloadCourseFiles(rows, archiveRoot, downloadOptions);
  let knowledge = null;
  try {
    knowledge = await ingestAndOrganizeRows(rows, {
      repository: accountRepository,
      mode: crawlMeta.mode || "export",
      // API collectors can omit page-only sources or return partial data; never
      // interpret their absence as deletion from a full course snapshot.
      completeCourseSnapshot: crawlMeta.completeCourseSnapshot === true,
      categoryFreshness: crawlMeta.categoryFreshness || categoryFreshness(rows, crawlMeta.apiSummary)
    });
    crawlMeta.knowledgeSummary = {
      syncRunId: knowledge.syncRunId,
      databaseRevision: knowledge.databaseRevision,
      ingest: knowledge.ingest,
      courses: knowledge.courses,
      entityCount: knowledge.entityCount,
      relationshipCount: knowledge.relationshipCount
    };
    await downloadText(`${archiveRoot}/entities.json`, JSON.stringify(knowledge.entities, null, 2), DOWNLOAD_MIME.json, false);
    await downloadText(`${archiveRoot}/relationships.json`, JSON.stringify(knowledge.relationships, null, 2), DOWNLOAD_MIME.json, false);
    await downloadText(`${archiveRoot}/evidence.ndjson`, toJsonl(knowledge.evidence || []), DOWNLOAD_MIME.jsonl, false);
    await downloadText(`${archiveRoot}/extraction-gaps.json`, JSON.stringify(knowledge.entities.filter((entity) => entity.entityType === "extractionState"), null, 2), DOWNLOAD_MIME.json, false);
  } catch (error) {
    crawlMeta.knowledgeSummary = { error: error?.message || "Knowledge organization failed." };
  }
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
  await downloadText(`${archiveRoot}/index.json`, JSON.stringify({
    archiveRoot,
    exportedAt: new Date().toISOString(),
    crawlMeta,
    manifestCsv: `${archiveRoot}/manifest.csv`,
    manifestJson: `${archiveRoot}/manifest.json`,
    aiIndexJsonl: `${archiveRoot}/ai-index.ndjson`,
    aiIndexNdjson: `${archiveRoot}/ai-index.ndjson`,
    auditReport: `${archiveRoot}/audit-report.md`,
    changeReport: `${archiveRoot}/change-report.md`,
    studentActionBrief: `${archiveRoot}/student-action-brief.md`,
    studentQuestions: `${archiveRoot}/student-questions.md`,
    queryGuide: `${archiveRoot}/query-guide.md`,
    evidenceJsonl: `${archiveRoot}/evidence.ndjson`,
    evidenceNdjson: `${archiveRoot}/evidence.ndjson`,
    entitiesJson: `${archiveRoot}/entities.json`,
    relationshipsJson: `${archiveRoot}/relationships.json`,
    extractionGapsJson: `${archiveRoot}/extraction-gaps.json`,
    totals: audit.totals,
    courses: audit.byCourse.map((course) => ({
      courseOrgUnitId: course.courseOrgUnitId,
      courseTitle: course.courseTitle,
      folder: `${archiveRoot}/courses/${slug(`${course.courseOrgUnitId}-${course.courseTitle}`, course.courseOrgUnitId)}`,
      pagesVisited: course.pagesVisited,
      pageTypes: course.pageTypes,
      sources: course.sources,
      warnings: course.warnings.length
    }))
  }, null, 2), DOWNLOAD_MIME.json, false);
  await downloadText(`${archiveRoot}/export-progress.json`, JSON.stringify({
    archiveRoot,
    phase: "complete",
    wroteRootManifest: true,
    wroteCourseManifests: false,
    pages: pagePayloads.length,
    rows: rows.length,
    downloadedFiles,
    writtenAt: new Date().toISOString()
  }, null, 2), DOWNLOAD_MIME.json, false);
  await background.writeAccountScoped(LAST_EXPORT_KEY, exportAccountId, mergeExportSummaries(storedSummary, currentSummary));

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
      courseOrgUnitId: courseId,
      courseTitle,
      folder: courseFolder,
      itemsCsv: `${courseFolder}/items.csv`,
      itemsJson: `${courseFolder}/items.json`,
      filesFolder: `${courseFolder}/files/`,
      pagesFolder: `${courseFolder}/pages/`,
      rowCount: courseRows.length,
      downloadedFileCount: fileRows.length,
      pageSnapshotCount: pageRows.length,
      sources: courseAudit?.sources || {},
      pageTypes: courseAudit?.pageTypes || {},
      warnings: courseAudit?.warnings || []
    }, null, 2), DOWNLOAD_MIME.json, false);
    await downloadText(`${courseFolder}/items.csv`, toCsv(courseRows), DOWNLOAD_MIME.csv, false);
    await downloadText(`${courseFolder}/items.json`, JSON.stringify(courseRows, null, 2), DOWNLOAD_MIME.json, false);
    await downloadText(`${courseFolder}/ai-index.ndjson`, toJsonl(courseRows.map(aiIndexRecord)), DOWNLOAD_MIME.jsonl, false);
    if (knowledge) {
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
  }
  await downloadText(`${archiveRoot}/export-progress.json`, JSON.stringify({
    archiveRoot,
    phase: "complete",
    wroteRootManifest: true,
    wroteCourseManifests: true,
    pages: pagePayloads.length,
    rows: rows.length,
    downloadedFiles,
    writtenAt: new Date().toISOString()
  }, null, 2), DOWNLOAD_MIME.json, false);
  await accountRepository.recordActivity({ operation: "export.complete", category: "export", status: "completed", source: crawlMeta.mode || "export", correlationId: activityCorrelationId, details: { rows: rows.length, pages: pagePayloads.length, downloadedFiles } }).catch(() => {});
}

async function downloadApiOnlyExport(apiPayloads, courseTitles = {}, options = {}, senderTabId = null) {
  const withPageProbes = options?.pageProbes === true;
  const archiveRoot = `D2L Export/${withPageProbes ? "d2l-course-export" : "d2l-api-export"}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const rows = [];
  const pages = [];
  const apiSummary = apiExportSummary(options);
  const deltaProbes = options?.deltaProbes === true;
  const probeCacheKey = "d2lProbeSignatures";
  // Destination archive = the account D2L verified in the payloads (and the expected one, if known). Nothing is written before this passes.
  const { repository: activityRepository, accountId: exportAccountId } = await background.resolveExportRepository({ payloads: apiPayloads, tabId: senderTabId, expectedAccountId: options?.expectedAccountId });
  const probeCache = deltaProbes ? ((await background.readAccountScoped(probeCacheKey, exportAccountId)) || {}) : {};
  const activityCorrelationId = `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await activityRepository.recordActivity({ operation: "sync.api-collection", category: "sync", status: "started", source: withPageProbes ? "api-plus-page-probes" : "api", correlationId: activityCorrelationId, details: { courses: (apiPayloads || []).length, deltaProbes } }).catch(() => {});
  pages.push(...apiCollectionFailurePages(options, courseTitles));

  let workerTabs = [];
  let probeTab = null;

  if (withPageProbes) {
    const firstPayload = (apiPayloads || []).find((payload) => payload?.orgUnitId);
    if (firstPayload?.orgUnitId && options?.sameTab === true && senderTabId) {
      probeTab = {
        mode: "frame",
        tabId: senderTabId,
        onProgress: typeof options.onProbeProgress === "function" ? options.onProbeProgress : null
      };
    } else if (firstPayload?.orgUnitId) {
      workerTabs = await createWorkerTabs(`https://kennesaw.view.usg.edu/d2l/home/${firstPayload.orgUnitId}`, 1, senderTabId);
      probeTab = workerTabs[0] || null;
    }
  }

  try {
    for (const payload of apiPayloads || []) {
      if (!payload?.orgUnitId) continue;
      const orgUnitId = String(payload.orgUnitId);
      const courseTitle = normalizeText(courseTitles[orgUnitId] || orgUnitId);
      const course = { orgUnitId, title: courseTitle };
      const pagePayload = {
        pageType: "valenceApi",
        page: { url: `https://kennesaw.view.usg.edu/d2l/home/${orgUnitId}`, title: courseTitle },
        course,
        apiStatus: payload.apiStatus || {},
        apiCounts: payload.counts || {},
        extractor: { extractedAt: new Date().toISOString(), mode: withPageProbes ? "apiWithPageProbes" : "apiOnly" }
      };
      pages.push(pagePayload);

      const before = rows.length;
      for (const item of payload.items || []) {
        const row = flattenItem(pagePayload, item);
        row.downloadUrl = item.downloadUrl || "";
        row.suggestedFileName = item.suggestedFileName || "";
        rows.push(row);
      }
      const added = rows.length - before;
      apiSummary.added += added;

      const courseSummary = {
        orgUnitId,
        title: courseTitle,
        added,
        counts: payload.counts || {},
        apiStatus: payload.apiStatus || {}
      };

      if (withPageProbes && (probeTab?.id || probeTab?.mode === "frame")) {
        const probeItems = deltaProbes
          ? (payload.items || []).filter((item) => {
            if (!["assignment", "quiz", "quizAttempt", "announcement"].includes(item?.source)) return true;
            const ids = item.ids ? JSON.stringify(item.ids) : "";
            const key = `${orgUnitId}:${item.source}:${ids}:${item.url || item.title || ""}`;
            const signature = JSON.stringify(item);
            item.__probeCacheKey = key;
            item.__probeSignature = signature;
            return probeCache[key] !== signature;
          })
          : (payload.items || []);
        const assignmentProbeSummary = await collectAssignmentProbePages(probeTab, orgUnitId, course, probeItems, rows, pages);
        const quizProbeSummary = await collectQuizProbePages(probeTab, orgUnitId, course, probeItems, rows, pages);
        const announcementProbeSummary = await collectAnnouncementProbePages(probeTab, orgUnitId, course, probeItems, rows, pages);
        const discussionProbeSummary = await collectDiscussionListProbePages(probeTab, orgUnitId, course, probeItems, rows, pages);
        for (const [key, value] of Object.entries(discussionProbeSummary)) apiSummary.discussionProbePages[key] += value;
        courseSummary.discussionProbePages = discussionProbeSummary;
        for (const [key, value] of Object.entries(assignmentProbeSummary)) apiSummary.assignmentProbePages[key] += value;
        for (const [key, value] of Object.entries(quizProbeSummary)) apiSummary.quizProbePages[key] += value;
        for (const [key, value] of Object.entries(announcementProbeSummary)) apiSummary.announcementProbePages[key] += value;
        courseSummary.assignmentProbePages = assignmentProbeSummary;
        courseSummary.quizProbePages = quizProbeSummary;
        courseSummary.announcementProbePages = announcementProbeSummary;
        await activityRepository.recordActivity({ operation: "probe.course", category: "sync", status: (assignmentProbeSummary.failed || quizProbeSummary.failed || announcementProbeSummary.failed || discussionProbeSummary.failed) ? "partial" : "completed", source: "rendered-page", courseId: orgUnitId, correlationId: activityCorrelationId, details: { assignment: assignmentProbeSummary, quiz: quizProbeSummary, announcement: announcementProbeSummary, discussion: discussionProbeSummary } }).catch(() => {});
        if (deltaProbes && !assignmentProbeSummary.failed && !quizProbeSummary.failed && !announcementProbeSummary.failed && !discussionProbeSummary.failed) {
          for (const item of probeItems) {
            if (item.__probeCacheKey) probeCache[item.__probeCacheKey] = item.__probeSignature;
          }
        }
      }

      apiSummary.courses.push(courseSummary);
      // Persist successful delta work after each course so an interrupted deep
      // sync can resume without repeating completed rendered-page probes.
      if (deltaProbes) await background.writeAccountScoped(probeCacheKey, exportAccountId, probeCache);
    }

    await downloadResults(rows, pages, archiveRoot, {
      repository: activityRepository,
      accountId: exportAccountId,
      mode: withPageProbes ? "apiWithPageProbes" : "apiOnly",
      deltaProbes,
      reuseArchivedFiles: options?.reuseArchivedFiles === true,
      downloadFiles: options?.downloadFiles,
      apiSummary,
      categoryFreshness: categoryFreshness(rows, apiSummary),
      extensionVersion: chrome.runtime.getManifest().version,
      courseCount: apiSummary.courses.length
    });
    if (deltaProbes) await background.writeAccountScoped(probeCacheKey, exportAccountId, probeCache);

    await activityRepository.recordActivity({ operation: "sync.api-collection", category: "sync", status: "completed", source: withPageProbes ? "api-plus-page-probes" : "api", correlationId: activityCorrelationId, details: { rows: rows.length, courses: apiSummary.courses.length, archiveRoot } }).catch(() => {});

    return { archiveRoot, rows: rows.length, courses: apiSummary.courses, apiSummary };
  } finally {
    if (probeTab?.mode === "frame") {
      await chrome.tabs.sendMessage(probeTab.tabId, { type: "D2L_PROBE_FRAME_CLOSE" }, { frameId: 0 }).catch(() => {});
    }
    for (const tab of workerTabs) {
      if (tab.id === senderTabId) continue;
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        // The user may have closed the tab already.
      }
    }
  }
}

function apiExportSummary(options = {}) {
  return {
    courses: [],
    added: 0,
    failed: Array.isArray(options.collectionFailures) ? options.collectionFailures.map((failure) => ({ ...failure })) : [],
    requestedOrgUnitIds: Array.isArray(options.requestedOrgUnitIds) ? [...options.requestedOrgUnitIds] : [],
    assignmentProbePages: { visited: 0, failed: 0, rows: 0 },
    quizProbePages: { visited: 0, failed: 0, rows: 0 },
    announcementProbePages: { visited: 0, failed: 0, rows: 0 },
    discussionProbePages: { visited: 0, failed: 0, rows: 0 }
  };
}

function apiCollectionFailurePages(options = {}, courseTitles = {}) {
  return (Array.isArray(options.collectionFailures) ? options.collectionFailures : []).map((failure) => {
    const orgUnitId = normalizeText(failure?.orgUnitId) || "unknown";
    const title = normalizeText(courseTitles[orgUnitId] || orgUnitId);
    return {
      pageType: "failed",
      page: { url: `https://kennesaw.view.usg.edu/d2l/home/${orgUnitId}`, title },
      course: { orgUnitId, title },
      items: [],
      error: normalizeText(failure?.error) || "Course API collection failed."
    };
  });
}

function safePageProbeUrls(urls) {
  return [...new Set((urls || []).map((url) => normalizeText(url)).filter((url) => isSafeReadOnlyUrl(url)))].slice(0, 24);
}

async function downloadPageProbeExport(urls, senderTabId = null) {
  const safeUrls = safePageProbeUrls(urls);
  if (!safeUrls.length) throw new Error("No safe D2L page probe URLs were provided.");

  const archiveRoot = `D2L Export/d2l-page-probe-export-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const startUrl = safeUrls[0];
  const pages = [];
  const rows = [];
  const failures = [];
  // Keep the trigger tab stable so its bridge can report completion. Reusing a
  // browser-controlled sender tab can make Chrome reject the worker navigation.
  const workerTabs = await createWorkerTabs(startUrl, 1, null);
  const tab = workerTabs[0];

  try {
    // Fail before any page is read if the tab cannot say which account it belongs to.
    const expectedAccountId = await background.verifyTabAccount(tab.id);
    if (!expectedAccountId) throw new background.AccountVerificationError("account-unverified");
    for (const url of safeUrls) {
      const task = {
        title: url,
        url,
        expectedPageType: classifyUrl(url),
        sourcePageType: "focusedPageProbe"
      };
      try {
        const payload = await navigateAndExtract(tab.id, task);
        payload.crawlTask.sourcePageType = "focusedPageProbe";
        pages.push(payload);
        rows.push(...(Array.isArray(payload.items) ? payload.items : []).map((item) => flattenItem(payload, item)));
      } catch (error) {
        failures.push({ url, error: error?.message || "Page probe failed." });
        pages.push({
          pageType: "failed",
          page: { url, title: url },
          course: { orgUnitId: "", title: "" },
          items: [],
          error: error?.message || "Page probe failed.",
          crawlTask: task
        });
      }
    }

    await downloadResults(rows, pages, archiveRoot, {
      verifyTabId: tab.id,
      expectedAccountId,
      mode: "pageProbe",
      extensionVersion: chrome.runtime.getManifest().version,
      probeUrls: safeUrls,
      failures
    });

    return { archiveRoot, rows: rows.length, pages: pages.length, failures };
  } finally {
    for (const workerTab of workerTabs) {
      if (workerTab.id === senderTabId) continue;
      try {
        await chrome.tabs.remove(workerTab.id);
      } catch {
        // The user may have closed the tab already.
      }
    }
  }
}

  Object.assign(background, { pageSnapshotMarkdown, downloadPageSnapshots, pageTextSnippetMap, dropRedirectedHomepageRows, downloadResults, apiExportSummary, apiCollectionFailurePages, downloadApiOnlyExport, safePageProbeUrls, downloadPageProbeExport, categoryFreshness });
})(globalThis);
