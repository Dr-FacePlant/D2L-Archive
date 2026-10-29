importScripts(
  "src/shared/constants.js",
  "src/shared/text.js",
  "src/shared/urls.js",
  "src/shared/rows.js",
  "src/shared/app-contract.js",
  "src/shared/evidence.js",
  "src/background/constants.js",
  "src/background/db/open.js",
  "src/background/db/repositories.js",
  "src/background/account-registry.js",
  "src/background/account-verification.js",
  "src/background/organizer/assignments.js",
  "src/background/organizer/assessments.js",
  "src/background/organizer/communications.js",
  "src/background/organizer/resources.js",
  "src/background/organizer/people-gaps.js",
  "src/background/app-api.js",
  "src/background/course-files.js",
  "src/background/ingest.js",
  "src/background/sync-queue.js",
  "src/background/report-changes.js",
  "src/background/report-coverage.js",
  "src/background/report-markdown.js",
  "src/background/state.js",
  "src/background/navigation.js",
  "src/background/overlay.js",
  "src/background/probes.js",
  "src/background/downloads.js",
  "src/background/export.js",
  "src/background/same-tab-sync.js"
);

const { normalizeText, isSafeReadOnlyUrl, parseColumns, classifyUrl, APP_API_MESSAGE_TYPE, D2L_ORIGIN, DEV_RELOAD_TOKEN } = globalThis.D2LExtractorShared;
const {
  downloadResults, downloadCourseFiles, courseFileDownloadsEnabled, downloadApiOnlyExport, downloadPageProbeExport,
  assignmentProbeTasksFromApiItems, quizProbeTasksFromApiItems, announcementProbeTasksFromApiItems,
  gradeProbeTasksForCourse, courseToolProbeTasksForCourse, aiIndexRecord, feedbackSignal,
  summarizeChanges, scopeSummaryToCourses, mergeExportSummaries, probePageLines, assignmentProbePageLines, quizProbePageLines,
  announcementProbePageLines, gradeProbePageLines, courseToolProbePageLines,
  extensionForRow, isDownloadCandidate, collectApiRows, archivePathFromDownloadItem, safePageProbeUrls,
  pageTextSnippetMap, apiExportSummary, apiCollectionFailurePages, contentScriptFiles, createMemoryArchiveAdapter, createArchiveRepository,
  createIndexedDbArchiveAdapter, openArchiveDatabase, handleAppApiRequest,
  createAccountRegistry, configureAccountRegistry, readAccountScoped, writeAccountScoped, legacyOwnerAccountId, accountKeyFor, dbNameFor, parseDbName, repositoryForAccount, verifyTabAccount, resolveExportRepository, AccountVerificationError, verifyPayloadAccount, activeArchiveRepository, activeArchiveAccountId, describeAccounts, adoptLegacyArchive,
  buildExactAssignmentKnowledge, buildQuizKnowledge, buildGradeKnowledge,
  buildAnnouncementKnowledge, buildDiscussionKnowledge, buildDiscussionForumKnowledge,
  buildDiscussionThreadKnowledge, buildLearningResourceKnowledge, buildCalendarKnowledge,
  buildCoursePolicyKnowledge, buildStudentProgressKnowledge, buildCourseToolKnowledge,
  buildPersonKnowledge, buildExternalResourceKnowledge, buildExtractionStateKnowledge,
  upcomingEntities, searchKnowledge, ingestAndOrganizeRows, reorganizeArchiveIfStale,
  buildCourseKnowledgeFiles, buildArchiveCourseFiles,
  toggleOverlay, handleOverlayMessage, forgetOverlayTab, overlayStateFor, saveOverlayState, isD2lPageUrl,
  navigateAndExtract, frameNavigationTarget, runSameTabSync, handleSameTabSyncState, cancelSameTabSync,
  embeddedDashboardSender, sameTabSyncSender, requestedCourseIds, taskCount,
  categoryStatus, freshnessForPayload,
  enqueuePriorityRefresh, discoverPriorityCourses, drainSyncQueue
} = globalThis.D2LExtractorBackground;

// Opens the dashboard in its own tab (or focuses the one already open).
const DASHBOARD_PATH = "dashboard.html";
const AUTO_BRIEF_ALARM = "student-archive-brief-sync";
async function configureAutomaticSync() {
  await chrome.alarms.clear?.("student-archive-deep-sync");
  await chrome.alarms.create(AUTO_BRIEF_ALARM, { delayInMinutes: 2, periodInMinutes: 2 });
}

// YouTube refuses to play a video ("Error 153") when the page around the
// player sends no web address, and the archive's pages send none. This one
// rule names the archive to YouTube, only for players the archive opens.
const YOUTUBE_PLAYER_RULE = 1;
async function configureYoutubePlayer() {
  await chrome.declarativeNetRequest?.updateDynamicRules({
    removeRuleIds: [YOUTUBE_PLAYER_RULE],
    addRules: [{
      id: YOUTUBE_PLAYER_RULE,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: `https://${chrome.runtime.id}.chromiumapp.org/` }] },
      condition: { urlFilter: "||www.youtube-nocookie.com/embed/", resourceTypes: ["sub_frame"], initiatorDomains: [chrome.runtime.id] }
    }]
  });
}

chrome.runtime.onInstalled?.addListener(() => { configureAutomaticSync().catch(() => {}); configureYoutubePlayer().catch(() => {}); });
chrome.runtime.onStartup?.addListener(() => { configureAutomaticSync().catch(() => {}); configureYoutubePlayer().catch(() => {}); });
function handleAutomaticSyncAlarm(alarm) {
  if (alarm?.name !== AUTO_BRIEF_ALARM) return Promise.resolve(null);
  return drainSyncQueue({ maxJobs: 3 });
}
chrome.alarms?.onAlarm?.addListener((alarm) => { handleAutomaticSyncAlarm(alarm).catch(() => {}); });
chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && String(tab?.url || "").startsWith(`${D2L_ORIGIN}/d2l/`)) {
    setTimeout(() => drainSyncQueue().catch(() => {}), 3000);
  }
});
async function openDashboard() {
  const url = chrome.runtime.getURL(DASHBOARD_PATH);
  const [existing] = await chrome.tabs.query({ url: `${url}*` });
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    return existing;
  }
  return chrome.tabs.create({ url });
}

// On a D2L tab the toolbar icon and Alt+Shift+A open or close the overlay on
// the page; anywhere else they open the dashboard in its own tab.
async function openArchive(tab) {
  if (!(await toggleOverlay(tab))) await openDashboard();
}
chrome.action?.onClicked?.addListener((tab) => { openArchive(tab); });
chrome.commands?.onCommand?.addListener((command, tab) => { if (command === "toggle-overlay") openArchive(tab); });
chrome.tabs?.onRemoved?.addListener((tabId) => { forgetOverlayTab(tabId); });
// Leaving D2L ends the visit: returning later is a new one, so the archive opens fresh.
chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
  if (changeInfo.url && !isD2lPageUrl(changeInfo.url)) forgetOverlayTab(tabId);
});

// Expose pure production helpers to the local Node regression harness. This
// avoids copy-pasted test implementations drifting away from the extension.
globalThis.__D2LExtractorBackgroundTestHooks = Object.freeze({
  classifyUrl,
  isSafeReadOnlyUrl,
  assignmentProbeTasksFromApiItems,
  quizProbeTasksFromApiItems,
  announcementProbeTasksFromApiItems,
  gradeProbeTasksForCourse,
  courseToolProbeTasksForCourse,
  parseColumns,
  aiIndexRecord,
  feedbackSignal,
  summarizeChanges,
  scopeSummaryToCourses,
  mergeExportSummaries,
  probePageLines,
  assignmentProbePageLines,
  quizProbePageLines,
  announcementProbePageLines,
  gradeProbePageLines,
  courseToolProbePageLines,
  extensionForRow,
  isDownloadCandidate,
  collectApiRows,
  archivePathFromDownloadItem,
  safePageProbeUrls,
  pageTextSnippetMap,
  apiExportSummary,
  apiCollectionFailurePages,
  contentScriptFiles,
  createMemoryArchiveAdapter,
  createArchiveRepository,
  createIndexedDbArchiveAdapter,
  openArchiveDatabase,
  handleAppApiRequest,
  createAccountRegistry,
  configureAccountRegistry,
  readAccountScoped,
  writeAccountScoped,
  legacyOwnerAccountId,
  downloadApiOnlyExport,
  accountKeyFor,
  dbNameFor,
  parseDbName,
  repositoryForAccount,
  verifyTabAccount,
  resolveExportRepository,
  verifyPayloadAccount,
  buildExactAssignmentKnowledge,
  buildQuizKnowledge,
  buildGradeKnowledge,
  buildAnnouncementKnowledge,
  buildDiscussionKnowledge,
  buildDiscussionForumKnowledge,
  buildDiscussionThreadKnowledge,
  buildLearningResourceKnowledge,
  buildCalendarKnowledge,
  buildCoursePolicyKnowledge,
  buildStudentProgressKnowledge,
  buildCourseToolKnowledge,
  buildPersonKnowledge,
  buildExternalResourceKnowledge,
  buildExtractionStateKnowledge,
  upcomingEntities,
  searchKnowledge,
  buildCourseKnowledgeFiles,
  buildArchiveCourseFiles,
  downloadResults,
  downloadCourseFiles,
  courseFileDownloadsEnabled,
  ingestAndOrganizeRows,
  reorganizeArchiveIfStale,
  openDashboard,
  openArchive,
  toggleOverlay,
  handleOverlayMessage,
  overlayStateFor,
  saveOverlayState,
  navigateAndExtract,
  frameNavigationTarget,
  runSameTabSync,
  handleSameTabSyncState,
  cancelSameTabSync,
  embeddedDashboardSender,
  sameTabSyncSender,
  requestedCourseIds,
  taskCount,
  categoryStatus,
  freshnessForPayload,
  enqueuePriorityRefresh,
  discoverPriorityCourses,
  drainSyncQueue,
  handleAutomaticSyncAlarm
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (typeof message?.type === "string" && message.type.startsWith("D2L_OVERLAY_")) {
    handleOverlayMessage(message, sender)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Overlay request failed." }));
    return true;
  }

  if (message?.type === "D2L_DEV_RELOAD_EXTENSION") {
    const senderUrl = sender?.tab?.url || sender?.url || "";
    const isDevelopmentBuild = !chrome.runtime.getManifest().update_url;
    if (message.token !== DEV_RELOAD_TOKEN || !senderUrl.startsWith(`${D2L_ORIGIN}/d2l/`) || !isDevelopmentBuild) {
      sendResponse({ ok: false, error: "Development reload request rejected." });
      return false;
    }
    sendResponse({ ok: true });
    setTimeout(() => chrome.runtime.reload(), 50);
    return false;
  }

  if (message?.type === "D2L_DEV_RUNTIME_CHECK") {
    const senderUrl = sender?.tab?.url || sender?.url || "";
    const isDevelopmentBuild = !chrome.runtime.getManifest().update_url;
    if (message.token !== DEV_RELOAD_TOKEN || sender?.frameId !== 0 || !senderUrl.startsWith(`${D2L_ORIGIN}/d2l/`) || !isDevelopmentBuild) {
      sendResponse({ ok: false, error: "Development runtime check rejected." });
      return false;
    }
    const extensionVersion = chrome.runtime.getManifest().version || "";
    const contentVersion = normalizeText(message.contentVersion);
    (async () => {
      const d2lTabs = await chrome.tabs.query({ url: `${D2L_ORIGIN}/d2l/*` }).catch(() => []);
      const registry = await describeAccounts().catch((error) => ({ error: error?.code || "registry-unavailable", accounts: [] }));
      const checks = await Promise.all(d2lTabs.map(async (tab) => {
        const identity = await chrome.tabs.sendMessage(tab.id, { type: "D2L_WHOAMI" }, { frameId: 0 })
          .then((reply) => ({ replied: true, reply }), (error) => ({ replied: false, errorName: String(error?.name || "Error").slice(0, 50) }));
        const whoamiAccountId = identity.reply?.ok ? normalizeText(identity.reply.accountId) : "";
        const productionAccountId = await verifyTabAccount(tab.id);
        let registryEntryExists = false;
        if (whoamiAccountId) {
          try {
            const accountKey = accountKeyFor(whoamiAccountId, D2L_ORIGIN);
            registryEntryExists = (registry.accounts || []).some((entry) => entry.accountKey === accountKey);
          } catch {}
        }
        const maskedIdentity = (value) => value ? `…${value.slice(-4)}` : "";
        let reasonCode = "verified";
        if (!identity.replied) reasonCode = identity.errorName === "TimeoutError" ? "whoami-timeout" : "content-script-no-response";
        else if (!identity.reply?.ok) reasonCode = identity.reply?.diagnostic?.reason || "whoami-rejected";
        else if (!productionAccountId) reasonCode = "production-verifier-rejected";
        else if (!registryEntryExists) reasonCode = "registry-entry-missing";
        return {
          tabId: tab.id,
          url: `${D2L_ORIGIN}${new URL(tab.url).pathname}${new URL(tab.url).search}`,
          contentScriptResponds: identity.replied,
          whoami: {
            ok: Boolean(whoamiAccountId),
            status: identity.reply?.diagnostic?.status || null,
            reason: identity.reply?.diagnostic?.reason || (identity.replied ? "unavailable" : "no-response"),
            identity: maskedIdentity(whoamiAccountId)
          },
          registryEntryExists,
          productionHelperVerified: Boolean(productionAccountId),
          productionIdentity: maskedIdentity(productionAccountId),
          reasonCode
        };
      }));
      const verifiedIds = checks.map((entry) => entry.productionIdentity).filter(Boolean);
      const currentTabCheck = checks.find((entry) => entry.tabId === sender.tab.id) || null;
      let overallReasonCode = "verified";
      if (!checks.length) overallReasonCode = "no-d2l-tabs-matched";
      else if (!verifiedIds.length) overallReasonCode = currentTabCheck?.reasonCode || "no-unique-verified-account";
      else if (new Set(verifiedIds).size > 1) overallReasonCode = "multiple-verified-accounts";
      else if (checks.some((entry) => entry.productionHelperVerified && !entry.registryEntryExists)) overallReasonCode = "registry-entry-missing";
      const registryCount = Array.isArray(registry.accounts) ? registry.accounts.length : null;
      const accountCheck = {
        ok: overallReasonCode === "verified",
        reasonCode: overallReasonCode,
        candidateCount: checks.length,
        registryEntryCount: registryCount,
        registryAvailable: !registry.error,
        currentTabId: sender.tab.id,
        currentTabIncluded: Boolean(currentTabCheck),
        tabs: checks
      };
      sendResponse({
        ok: true,
        backgroundAlive: true,
        contentAlive: true,
        extensionVersion,
        contentVersion,
        versionsMatch: Boolean(contentVersion) && contentVersion === extensionVersion,
        extensionId: chrome.runtime.id || "",
        accountCheck
      });
    })().catch((error) => sendResponse({ ok: false, error: error?.message || "Runtime account diagnostic failed." }));
    return true;
  }

  // Read-only diagnostics. Fixed allowlist: callers cannot choose a method.
  if (message?.type === "D2L_DEV_SYNC_DIAGNOSTICS") {
    const senderUrl = sender?.tab?.url || "";
    const isDevelopmentBuild = !chrome.runtime.getManifest().update_url;
    if (message.token !== DEV_RELOAD_TOKEN || sender?.frameId !== 0 || !senderUrl.startsWith(`${D2L_ORIGIN}/d2l/`) || !isDevelopmentBuild) {
      sendResponse({ ok: false, error: "Development diagnostics request rejected." });
      return false;
    }
    (async () => {
      const call = async (method, params) => {
        const response = await handleAppApiRequest({ type: APP_API_MESSAGE_TYPE, protocolVersion: "1", requestId: `dev-diag-${method}`, method, params });
        return response.ok ? response.data : { error: response.error };
      };
      const accountId = normalizeText(await activeArchiveAccountId());
      const queue0 = await call("sync.getQueue", { accountId, limit: 100 });
      const courseIds = [...new Set((queue0.jobs || []).map((job) => String(job.courseId || "")).filter(Boolean))];
      const queue = courseIds.length ? await call("sync.getQueue", { accountId, limit: 100, courseIds }) : queue0;
      sendResponse({
        ok: true,
        at: new Date().toISOString(),
        accountId,
        queue,
        syncState: await call("sync.getState", { limit: 5 }),
        activitySummary: await call("activity.getSummary", {}),
        activity: await call("activity.list", { limit: 60 }),
        // Read-only integrity checkpoint: every store's row count, every archive database on disk, and the account registry.
        // The same reads the dashboard makes, summarized, to prove they resolve to this account's archive.
        dashboardCheck: await call("dashboard.getOverview", {}).then((overview) => overview.error ? overview : { courses: overview.courses.length, entityTypes: Object.keys(overview.entityCounts).length, entities: Object.values(overview.entityCounts).reduce((sum, count) => sum + count, 0), gradedItems: overview.gradedItems }),
        accountContext: await call("system.getAccountContext", {}),
        // Names only (never values) of the per-account local state keys, to show which scoped keys exist.
        localKeys: Object.keys(await chrome.storage.local.get(null)).filter((key) => /^(d2lLastExportSummary|d2lProbeSignatures|dashboardReadUpdates|dashboardHiddenWork)/.test(key)).sort(),
        storeCounts: await activeArchiveRepository().then((repository) => repository.getStoreCounts(), (error) => ({ error: error?.code || error?.message })),
        databaseNames: await indexedDB.databases().then((list) => list.map((database) => database.name).filter((name) => String(name).startsWith("d2l-student-archive")), () => null),
        registry: await describeAccounts().catch((error) => ({ error: error?.code || error?.message }))
      });
    })().catch((error) => sendResponse({ ok: false, error: error?.message || "Diagnostics failed." }));
    return true;
  }

  if (message?.type === "D2L_DEV_OPEN_DASHBOARD") {
    const senderUrl = sender?.tab?.url || "";
    const isDevelopmentBuild = !chrome.runtime.getManifest().update_url;
    if (message.token !== DEV_RELOAD_TOKEN || !senderUrl.startsWith(`${D2L_ORIGIN}/d2l/`) || !isDevelopmentBuild) {
      sendResponse({ ok: false, error: "Development dashboard request rejected." });
      return false;
    }
    const route = /^#\/[\w\-/:%?=&.]*$/.test(message.route || "") ? message.route : "";
    // selfcheck: the dashboard walks every screen and saves what it rendered.
    const query = message.selfcheck === true ? "?selfcheck=1" : "";
    chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD_PATH) + query + route, openerTabId: sender.tab.id, index: sender.tab.index + 1, active: false })
      .then(async (tab) => {
        if (sender.tab.groupId !== undefined && sender.tab.groupId !== -1) await chrome.tabs.group({ groupId: sender.tab.groupId, tabIds: [tab.id] }).catch(() => {});
        sendResponse({ ok: true, tabId: tab.id });
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not open the dashboard." }));
    return true;
  }

  // Only the extension's own pages may ask for the local re-organization.
  if (message?.type === "D2L_FETCH_FILE") {
    fetchFileInD2lTab(message.url, sender, message.page === true).then(sendResponse, (error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === "D2L_VIEWER_PDF") {
    viewerPdfInD2lTab(message.url, sender).then(sendResponse, (error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === "D2L_DASHBOARD_PREPARE") {
    const fromExtensionPage = !sender?.tab || String(sender?.url || "").startsWith(chrome.runtime.getURL(""));
    if (!fromExtensionPage) {
      sendResponse({ ok: false, error: "Dashboard preparation is only available to extension pages." });
      return false;
    }
    reorganizeArchiveIfStale()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, code: error?.code, error: error?.message || "Reorganization failed." }));
    return true;
  }

  if (message?.type === "D2L_SYNC_ENQUEUE_PRIORITY") {
    const dashboardUrl = chrome.runtime.getURL(DASHBOARD_PATH);
    if (sender?.id !== chrome.runtime.id || !String(sender?.url || "").startsWith(dashboardUrl)) {
      sendResponse({ ok: false, error: "Priority refresh requests are only available to the extension dashboard." });
      return false;
    }
    activeArchiveAccountId().then(async (activeAccountId) => {
      const accountId = normalizeText(activeAccountId);
      let courseIds = [...new Set((Array.isArray(message.courseIds) ? message.courseIds : []).map(String).filter((id) => /^\d+$/.test(id)))];
      const correlationId = normalizeText(message.correlationId) || `visit-${Date.now()}`;
      if (!courseIds.length) {
        const discovery = await discoverPriorityCourses(accountId);
        if (!discovery.ok) {
          sendResponse({ ok: false, error: discovery.error || `Could not discover current D2L courses (${discovery.reason}).`, reason: discovery.reason, courseIds: [] });
          return;
        }
        courseIds = discovery.courseIds;
      }
      const outcomes = await enqueuePriorityRefresh(courseIds, { accountId, force: message.force === true, correlationId });
      sendResponse({ ok: true, outcomes, queued: outcomes.some((item) => item.queued), correlationId, courseIds });
      if (outcomes.some((item) => item.queued)) drainSyncQueue({ maxJobs: 3 }).catch(() => {});
    }).catch((error) => sendResponse({ ok: false, error: error?.message || "Could not queue a priority refresh." }));
    return true;
  }

  // The user confirmed, on the dashboard, that the quarantined older archive is theirs.
  if (message?.type === "D2L_ARCHIVE_ADOPT_LEGACY") {
    const dashboardUrl = chrome.runtime.getURL(DASHBOARD_PATH);
    if (sender?.id !== chrome.runtime.id || !String(sender?.url || "").startsWith(dashboardUrl)) {
      sendResponse({ ok: false, error: "Adopting the older archive is only available to the extension dashboard." });
      return false;
    }
    adoptLegacyArchive(message.accountId)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, code: error?.code || "", error: error?.message || "The older archive could not be adopted." }));
    return true;
  }

  if (message?.type === "D2L_ACTIVITY_RECORD") {
    const fromExtensionPage = !sender?.tab || String(sender?.url || "").startsWith(chrome.runtime.getURL(""));
    if (!fromExtensionPage || !message.event || typeof message.event !== "object") {
      sendResponse({ ok: false, error: "Activity recording is only available to extension pages." });
      return false;
    }
    activeArchiveRepository().then((repository) => repository.recordActivity(message.event))
      .then((event) => sendResponse({ ok: true, event }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not record activity." }));
    return true;
  }

  if (message?.type === "D2L_SYNC_THIS_TAB") {
    runSameTabSync(message, sender)
      .then((state) => sendResponse({ ok: state?.complete === true, state, error: state?.error || "" }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Same-tab sync failed." }));
    return true;
  }

  if (message?.type === "D2L_GET_SAME_TAB_SYNC_STATE") {
    handleSameTabSyncState(message, sender)
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not read same-tab sync state." }));
    return true;
  }

  if (message?.type === "D2L_CANCEL_SAME_TAB_SYNC") {
    cancelSameTabSync(message, sender)
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not cancel same-tab sync." }));
    return true;
  }

  if (message?.type === APP_API_MESSAGE_TYPE) {
    handleAppApiRequest(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: { code: "INTERNAL_ERROR", message: error?.message || "Application API request failed." } }));
    return true;
  }

  if (message?.type === "D2L_DOWNLOAD_API_EXPORT") {
    const apiPayloads = Array.isArray(message.apiPayloads) ? message.apiPayloads : [];
    const courseTitles = message.courseTitles && typeof message.courseTitles === "object" ? message.courseTitles : {};
    const options = message.options && typeof message.options === "object" ? message.options : {};
    downloadApiOnlyExport(apiPayloads, courseTitles, options, sender?.tab?.id || null)
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "API-only export failed." }));
    return true;
  }

  if (message?.type === "D2L_DOWNLOAD_PAGE_PROBE_EXPORT") {
    const urls = Array.isArray(message.urls) ? message.urls : [];
    downloadPageProbeExport(urls, sender?.tab?.id || null)
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Page probe export failed." }));
    return true;
  }

  return false;
});

// File previews: when the dashboard can't load a D2L file itself, load it inside
// an open D2L tab (where D2L's sign-in applies) and hand it back as a data URL.
// With page set, it hands back a topic's D2L page as text instead, so the
// dashboard can find the PDF D2L made of a PowerPoint or Excel file.
// Only D2L addresses, up to 50 MB. A refusal says why, with the same
// reasons the dashboard uses: signed-out, not-found, no-access, http, not-file,
// too-large, offline, no-answer, or no-tab.
const PREVIEW_FETCH_LIMIT = 50 * 1024 * 1024;

// The D2L tab the dashboard is open on, or else any open D2L tab.
async function d2lTabFor(sender) {
  const own = sender?.tab?.url?.startsWith(`${D2L_ORIGIN}/d2l/`) ? [sender.tab] : [];
  const tabs = own.length ? own : await chrome.tabs.query({ url: `${D2L_ORIGIN}/d2l/*` });
  return tabs.find((candidate) => candidate.id >= 0 && !candidate.discarded) || null;
}

async function fetchFileInD2lTab(url, sender, page = false) {
  if (typeof url !== "string" || !url.startsWith(`${D2L_ORIGIN}/`)) return { ok: false, reason: "not-file", error: "Not a D2L file." };
  const tab = await d2lTabFor(sender);
  if (!tab) return { ok: false, reason: "no-tab", error: "No signed-in D2L tab is open." };
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [url, PREVIEW_FETCH_LIMIT, page],
    func: async (fileUrl, limit, page = false) => {
      let response;
      try { response = await fetch(fileUrl, { credentials: "include" }); }
      catch { return { ok: false, reason: navigator.onLine === false ? "offline" : "no-answer" }; }
      const type = response.headers.get("content-type") || "";
      const html = /text\/html/i.test(type);
      const reason = /\/d2l\/login/i.test(response.url || "") || response.status === 401 ? "signed-out"
        : response.status === 404 ? "not-found"
        : response.status === 403 ? "no-access"
        : !response.ok ? "http"
        : html !== page ? "not-file" : "";
      if (reason) return { ok: false, reason, status: response.status, error: `D2L answered ${response.status}.` };
      if (page) return { ok: true, html: await response.text() };
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > limit) return { ok: false, reason: "too-large", size: declared, limit, error: "The file is too large to preview." };
      const blob = await response.blob();
      if (blob.size > limit) return { ok: false, reason: "too-large", size: blob.size, limit, error: "The file is too large to preview." };
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return { ok: true, dataUrl, type: blob.type };
    }
  });
  return injection?.result || { ok: false, reason: "no-answer", error: "D2L didn't answer." };
}

// A PowerPoint's D2L page often doesn't say where D2L's PDF of it is until
// D2L's own script on the page has asked D2L for it. The extension never sends
// that request itself: this opens the topic page out of sight in a D2L tab, as
// you would open it, and reads where its viewer gets the PDF. Only topic
// pages, for up to 20 seconds.
const VIEWER_WAIT = 20000;

async function viewerPdfInD2lTab(url, sender) {
  if (typeof url !== "string" || !url.startsWith(`${D2L_ORIGIN}/d2l/le/content/`) || !/\/viewContent\/\d+\/View$/.test(url)) return { ok: false, error: "Not a D2L topic page." };
  const tab = await d2lTabFor(sender);
  if (!tab) return { ok: false, reason: "no-tab", error: "No signed-in D2L tab is open." };
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [url, VIEWER_WAIT],
    func: async (pageUrl, wait) => {
      const frame = document.createElement("iframe");
      frame.title = "D2L Archive slides";
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1280px;height:900px;visibility:hidden;pointer-events:none;border:0";
      frame.src = pageUrl;
      document.documentElement.append(frame);
      try {
        for (const until = Date.now() + wait; Date.now() < until;) {
          await new Promise((next) => setTimeout(next, 400));
          const where = frame.contentDocument?.querySelector(".d2l-fileviewer-pdf-pdfjs[data-location]")?.getAttribute("data-location");
          if (where) return { ok: true, location: where };
        }
        return { ok: false, reason: "no-answer", error: "D2L's page didn't show a PDF." };
      } catch {
        return { ok: false, reason: "no-answer", error: "D2L's page couldn't be read." };
      } finally {
        frame.remove();
      }
    }
  });
  return injection?.result || { ok: false, reason: "no-answer", error: "D2L didn't answer." };
}
