(function initExportProbesModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { flattenItem, isSafeReadOnlyUrl, normalizeText, classifyUrl } = shared;
  const {
    createWorkerTabs, navigateAndExtract, collectAssignmentProbePages,
    collectQuizProbePages, collectAnnouncementProbePages, collectDiscussionListProbePages,
    downloadResults, categoryFreshness
  } = background;

  async function setupProbeWorkerTab(apiPayloads, options, senderTabId, withPageProbes) {
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
    return { workerTabs, probeTab };
  }

  function appendCourseApiRows(payload, courseTitles, withPageProbes, rows, pages, apiSummary) {
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
    return { orgUnitId, courseTitle, course, added };
  }

  function filterDeltaProbeItems(items, orgUnitId, deltaProbes, probeCache) {
    if (!deltaProbes) return items;
    return items.filter((item) => {
      if (!["assignment", "quiz", "quizAttempt", "announcement"].includes(item?.source)) return true;
      const ids = item.ids ? JSON.stringify(item.ids) : "";
      const key = `${orgUnitId}:${item.source}:${ids}:${item.url || item.title || ""}`;
      const signature = JSON.stringify(item);
      item.__probeCacheKey = key;
      item.__probeSignature = signature;
      return probeCache[key] !== signature;
    });
  }

  async function executeCoursePageProbes(probeTab, orgUnitId, course, payload, rows, pages, deltaProbes, probeCache, apiSummary, courseSummary, activityRepository, activityCorrelationId) {
    const probeItems = filterDeltaProbeItems(payload.items || [], orgUnitId, deltaProbes, probeCache);
    const assignmentProbeSummary = await collectAssignmentProbePages(probeTab, orgUnitId, course, probeItems, rows, pages);
    const quizProbeSummary = await collectQuizProbePages(probeTab, orgUnitId, course, probeItems, rows, pages);
    const announcementProbeSummary = await collectAnnouncementProbePages(probeTab, orgUnitId, course, probeItems, rows, pages);
    const discussionProbeSummary = await collectDiscussionListProbePages(probeTab, orgUnitId, course, probeItems, rows, pages);

    for (const [key, value] of Object.entries(discussionProbeSummary)) apiSummary.discussionProbePages[key] += value;
    for (const [key, value] of Object.entries(assignmentProbeSummary)) apiSummary.assignmentProbePages[key] += value;
    for (const [key, value] of Object.entries(quizProbeSummary)) apiSummary.quizProbePages[key] += value;
    for (const [key, value] of Object.entries(announcementProbeSummary)) apiSummary.announcementProbePages[key] += value;
    courseSummary.discussionProbePages = discussionProbeSummary;
    courseSummary.assignmentProbePages = assignmentProbeSummary;
    courseSummary.quizProbePages = quizProbeSummary;
    courseSummary.announcementProbePages = announcementProbeSummary;

    const failed = assignmentProbeSummary.failed || quizProbeSummary.failed || announcementProbeSummary.failed || discussionProbeSummary.failed;
    await activityRepository.recordActivity({
      operation: "probe.course", category: "sync", status: failed ? "partial" : "completed",
      source: "rendered-page", courseId: orgUnitId, correlationId: activityCorrelationId,
      details: { assignment: assignmentProbeSummary, quiz: quizProbeSummary, announcement: announcementProbeSummary, discussion: discussionProbeSummary }
    }).catch(() => {});

    if (deltaProbes && !failed) {
      for (const item of probeItems) {
        if (item.__probeCacheKey) probeCache[item.__probeCacheKey] = item.__probeSignature;
      }
    }
  }

  async function cleanupProbeTabs(probeTab, workerTabs, senderTabId) {
    if (probeTab?.mode === "frame") {
      await chrome.tabs.sendMessage(probeTab.tabId, { type: "D2L_PROBE_FRAME_CLOSE" }, { frameId: 0 }).catch(() => {});
    }
    for (const tab of workerTabs) {
      if (tab.id === senderTabId) continue;
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
  }

  async function downloadApiOnlyExport(apiPayloads, courseTitles = {}, options = {}, senderTabId = null) {
    const withPageProbes = options?.pageProbes === true;
    const archiveRoot = `D2L Export/${withPageProbes ? "d2l-course-export" : "d2l-api-export"}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const rows = [];
    const pages = [];
    const apiSummary = apiExportSummary(options);
    const deltaProbes = options?.deltaProbes === true;
    const probeCacheKey = "d2lProbeSignatures";

    const { repository: activityRepository, accountId: exportAccountId } = await background.resolveExportRepository({ payloads: apiPayloads, tabId: senderTabId, expectedAccountId: options?.expectedAccountId });
    const probeCache = deltaProbes ? ((await background.readAccountScoped(probeCacheKey, exportAccountId)) || {}) : {};
    const activityCorrelationId = `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await activityRepository.recordActivity({ operation: "sync.api-collection", category: "sync", status: "started", source: withPageProbes ? "api-plus-page-probes" : "api", correlationId: activityCorrelationId, details: { courses: (apiPayloads || []).length, deltaProbes } }).catch(() => {});
    pages.push(...apiCollectionFailurePages(options, courseTitles));

    const { workerTabs, probeTab } = await setupProbeWorkerTab(apiPayloads, options, senderTabId, withPageProbes);

    try {
      for (const payload of apiPayloads || []) {
        if (!payload?.orgUnitId) continue;
        const { orgUnitId, courseTitle, course, added } = appendCourseApiRows(payload, courseTitles, withPageProbes, rows, pages, apiSummary);
        const courseSummary = { orgUnitId, title: courseTitle, added, counts: payload.counts || {}, apiStatus: payload.apiStatus || {} };

        if (withPageProbes && (probeTab?.id || probeTab?.mode === "frame")) {
          await executeCoursePageProbes(probeTab, orgUnitId, course, payload, rows, pages, deltaProbes, probeCache, apiSummary, courseSummary, activityRepository, activityCorrelationId);
        }
        apiSummary.courses.push(courseSummary);
        if (deltaProbes) await background.writeAccountScoped(probeCacheKey, exportAccountId, probeCache);
      }

      await downloadResults(rows, pages, archiveRoot, {
        repository: activityRepository, accountId: exportAccountId, mode: withPageProbes ? "apiWithPageProbes" : "apiOnly",
        deltaProbes, reuseArchivedFiles: options?.reuseArchivedFiles === true, downloadFiles: options?.downloadFiles,
        apiSummary, categoryFreshness: categoryFreshness(rows, apiSummary),
        extensionVersion: chrome.runtime.getManifest().version, courseCount: apiSummary.courses.length
      });
      if (deltaProbes) await background.writeAccountScoped(probeCacheKey, exportAccountId, probeCache);

      await activityRepository.recordActivity({ operation: "sync.api-collection", category: "sync", status: "completed", source: withPageProbes ? "api-plus-page-probes" : "api", correlationId: activityCorrelationId, details: { rows: rows.length, courses: apiSummary.courses.length, archiveRoot } }).catch(() => {});

      return { archiveRoot, rows: rows.length, courses: apiSummary.courses, apiSummary };
    } finally {
      await cleanupProbeTabs(probeTab, workerTabs, senderTabId);
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

async function executeProbeUrlTasks(tabId, safeUrls, pages, rows, failures) {
  for (const url of safeUrls) {
    const task = {
      title: url,
      url,
      expectedPageType: classifyUrl(url),
      sourcePageType: "focusedPageProbe"
    };
    try {
      const payload = await navigateAndExtract(tabId, task);
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
}

async function cleanupWorkerTabs(workerTabs, senderTabId) {
  for (const workerTab of workerTabs) {
    if (workerTab.id === senderTabId) continue;
    try {
      await chrome.tabs.remove(workerTab.id);
    } catch {
      // The user may have closed the tab already.
    }
  }
}

async function downloadPageProbeExport(urls, senderTabId = null) {
  const safeUrls = safePageProbeUrls(urls);
  if (!safeUrls.length) throw new Error("No safe D2L page probe URLs were provided.");

  const archiveRoot = `D2L Export/d2l-page-probe-export-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const startUrl = safeUrls[0];
  const pages = [];
  const rows = [];
  const failures = [];
  const workerTabs = await createWorkerTabs(startUrl, 1, null);
  const tab = workerTabs[0];

  try {
    const expectedAccountId = await background.verifyTabAccount(tab.id);
    if (!expectedAccountId) throw new background.AccountVerificationError("account-unverified");
    await executeProbeUrlTasks(tab.id, safeUrls, pages, rows, failures);

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
    await cleanupWorkerTabs(workerTabs, senderTabId);
  }
}

  

  Object.assign(background, {
    apiExportSummary,
    apiCollectionFailurePages,
    safePageProbeUrls,
    downloadApiOnlyExport,
    downloadPageProbeExport
  });
})(globalThis);
