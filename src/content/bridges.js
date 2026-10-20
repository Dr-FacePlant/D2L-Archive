(function initContentBridges(global) {
  const shared = global.D2LExtractorShared;
  const content = global.D2LExtractorContent ||= {};
  const { normalizeText, DEV_RELOAD_TOKEN } = shared;
  const { getOrgUnitId, collectCourseApi, collectCourseApiWithAccount, extractVisiblePage, probeFrameTask, closeProbeFrame } = content;

function devReloadHashRequested(url = window.location.href) {
  try {
    const parsed = new URL(String(url || ""), window.location.href);
    return parsed.hash === `#d2l-extractor-dev-reload=${DEV_RELOAD_TOKEN}`;
  } catch {
    return false;
  }
}

function devRuntimeCheckRequested(url = window.location.href) {
  try {
    const parsed = new URL(String(url || ""), window.location.href);
    return parsed.hash === `#d2l-extractor-dev-runtime-check=${DEV_RELOAD_TOKEN}`;
  } catch {
    return false;
  }
}

function showDevRuntimeStatus(result) {
  const id = "d2l-extractor-dev-runtime-status";
  let status = document.getElementById(id);
  if (!status) {
    status = document.createElement("div");
    status.id = id;
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.style.cssText = "position:fixed;z-index:2147483647;right:12px;bottom:12px;max-width:min(760px,calc(100vw - 24px));max-height:45vh;overflow:auto;white-space:pre-wrap;padding:10px 14px;background:#fff;color:#17212b;border:1px solid #7d8997;border-radius:6px;box-shadow:0 2px 12px #0003;font:13px/1.45 ui-monospace,monospace";
    (document.body || document.documentElement).appendChild(status);
  }
  if (!result?.ok) {
    status.textContent = `D2L Archive runtime check failed: ${result?.error || "No response from the extension."}`;
    document.title = status.textContent;
    return;
  }
  const match = result.versionsMatch ? "match" : "MISMATCH";
  const account = result.accountCheck;
  const tabLines = (account?.tabs || []).map((tab) => [
    `Tab ${tab.tabId}${tab.tabId === account.currentTabId ? " (diagnostic sender)" : ""}: ${tab.url}`,
    `  content=${tab.contentScriptResponds ? "responded" : "no response"}; WHOAMI=${tab.whoami.ok ? `HTTP ${tab.whoami.status || "?"}, ${tab.whoami.identity}` : `${tab.whoami.reason}${tab.whoami.status ? ` (HTTP ${tab.whoami.status})` : ""}`}; registry=${tab.registryEntryExists ? "match" : "no match"}; production-helper=${tab.productionHelperVerified ? `verified (${tab.productionIdentity})` : "rejected"}; reason=${tab.reasonCode}`
  ].join("\n"));
  const accountStatus = account ? `\nAccount check: ${account.reasonCode}; ${account.candidateCount} candidate tab(s); registry ${account.registryAvailable ? `available (${account.registryEntryCount} entr${account.registryEntryCount === 1 ? "y" : "ies"})` : "unavailable"}.\n${tabLines.join("\n") || "No matching D2L tabs."}` : "";
  status.textContent = `D2L Archive runtime ${result.backgroundAlive && result.contentAlive ? "connected" : "not connected"}: background ${result.extensionVersion || "unknown"}; page script ${result.contentVersion || "unknown"} (${match}); extension ID ${result.extensionId || "unavailable"}.${accountStatus}`;
  document.title = status.textContent;
}

async function maybeReportDevRuntimeCheck() {
  if (chrome.runtime.getManifest().update_url || !devRuntimeCheckRequested()) return;
  const cleanUrl = new URL(window.location.href);
  cleanUrl.hash = "";
  window.history?.replaceState?.(null, "", cleanUrl.href);
  try {
    const result = await chrome.runtime.sendMessage({
      type: "D2L_DEV_RUNTIME_CHECK",
      token: DEV_RELOAD_TOKEN,
      contentVersion: content.buildVersion || ""
    });
    showDevRuntimeStatus(result);
  } catch (error) {
    showDevRuntimeStatus({ ok: false, error: error?.message || "No response from the extension." });
  }
}

function devSameTabSyncRequest(url = window.location.href) {
  try {
    if (chrome.runtime.getManifest().update_url) return null;
    const parsed = new URL(String(url || ""), window.location.href);
    const prefix = `#d2l-extractor-dev-same-tab-sync=${DEV_RELOAD_TOKEN}:`;
    if (!parsed.hash.startsWith(prefix)) return null;
    const courseIds = parsed.hash.slice(prefix.length).split(",").map((id) => id.trim()).filter((id) => /^\d+$/.test(id));
    return courseIds.length ? [...new Set(courseIds)] : null;
  } catch {
    return null;
  }
}

async function maybeRunDevSameTabSync() {
  const courseIds = devSameTabSyncRequest();
  if (!courseIds) return;
  const runKey = courseIds.join(",");
  if (window.__d2lExtractorDevSameTabSync === runKey) return;
  window.__d2lExtractorDevSameTabSync = runKey;
  const marker = "data-d2l-extractor-dev-same-tab-sync";
  const summaryMarker = `${marker}-summary`;
  document.documentElement.setAttribute(marker, "running");
  document.documentElement.setAttribute(summaryMarker, JSON.stringify({ courseIds, startedAt: new Date().toISOString() }));
  try {
    const response = await chrome.runtime.sendMessage({
      type: "D2L_SYNC_THIS_TAB",
      runId: `dev-${Date.now()}`,
      devToken: DEV_RELOAD_TOKEN,
      courseIds
    });
    document.documentElement.setAttribute(marker, response?.ok ? "complete" : "failed");
    document.documentElement.setAttribute(summaryMarker, JSON.stringify(response || {}).slice(0, 12000));
  } catch (error) {
    document.documentElement.setAttribute(marker, "failed");
    document.documentElement.setAttribute(summaryMarker, JSON.stringify({ error: error?.message || "Same-tab sync failed." }));
  }
}

async function maybeReportDevSameTabSync() {
  if (chrome.runtime.getManifest().update_url) return;
  if (String(window.location.hash || "") !== `#d2l-extractor-dev-same-tab-status=${DEV_RELOAD_TOKEN}`) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: "D2L_GET_SAME_TAB_SYNC_STATE", devToken: DEV_RELOAD_TOKEN });
    document.documentElement.setAttribute("data-d2l-extractor-dev-same-tab-status", JSON.stringify(response || {}).slice(0, 12000));
  } catch (error) {
    document.documentElement.setAttribute("data-d2l-extractor-dev-same-tab-status", JSON.stringify({ ok: false, error: error?.message || "Could not read sync status." }));
  }
}

// Development builds only, read-only: "#d2l-extractor-dev-sync-diag=<token>"
// writes the durable queue, freshness and recent activity to <html>.
async function maybeReportDevSyncDiagnostics() {
  if (chrome.runtime.getManifest().update_url) return;
  if (String(window.location.hash || "") !== `#d2l-extractor-dev-sync-diag=${DEV_RELOAD_TOKEN}`) return;
  const marker = "data-d2l-extractor-dev-sync-diag";
  try {
    const response = await chrome.runtime.sendMessage({ type: "D2L_DEV_SYNC_DIAGNOSTICS", token: DEV_RELOAD_TOKEN });
    document.documentElement.setAttribute(marker, JSON.stringify(response || {}).slice(0, 200000));
  } catch (error) {
    document.documentElement.setAttribute(marker, JSON.stringify({ ok: false, error: error?.message || "Could not read sync diagnostics." }));
  }
}

async function maybeCancelDevSameTabSync() {
  if (chrome.runtime.getManifest().update_url) return;
  if (String(window.location.hash || "") !== `#d2l-extractor-dev-same-tab-cancel=${DEV_RELOAD_TOKEN}`) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: "D2L_CANCEL_SAME_TAB_SYNC", devToken: DEV_RELOAD_TOKEN });
    document.documentElement.setAttribute("data-d2l-extractor-dev-same-tab-cancel", JSON.stringify(response || {}).slice(0, 12000));
  } catch (error) {
    document.documentElement.setAttribute("data-d2l-extractor-dev-same-tab-cancel", JSON.stringify({ ok: false, error: error?.message || "Could not cancel sync." }));
  }
}

async function maybeRunDevReload() {
  if (!devReloadHashRequested()) return;
  const cleanUrl = new URL(window.location.href);
  cleanUrl.hash = "";
  window.history?.replaceState?.(null, "", cleanUrl.href);
  document.documentElement.setAttribute("data-d2l-extractor-dev-reload", "requested");
  try {
    await chrome.runtime.sendMessage({ type: "D2L_DEV_RELOAD_EXTENSION", token: DEV_RELOAD_TOKEN });
  } catch {
    document.documentElement.setAttribute("data-d2l-extractor-dev-reload", "failed");
  }
}

// Development builds only: "#d2l-extractor-open-dashboard=<token>[:<route>]"
// opens the dashboard next to this tab, in the same tab group, so a test
// harness driving this tab can check the dashboard too.
async function maybeRunDevOpenDashboard() {
  const match = String(window.location.hash || "").match(new RegExp(`^#d2l-extractor-open-dashboard=${DEV_RELOAD_TOKEN}(?::(.*))?$`));
  if (!match) return;
  const cleanUrl = new URL(window.location.href);
  cleanUrl.hash = "";
  window.history?.replaceState?.(null, "", cleanUrl.href);
  try {
    const route = decodeURIComponent(match[1] || "");
    const response = await chrome.runtime.sendMessage({ type: "D2L_DEV_OPEN_DASHBOARD", token: DEV_RELOAD_TOKEN, route: route === "selfcheck" ? "" : route, selfcheck: route === "selfcheck" });
    document.documentElement.setAttribute("data-d2l-extractor-dev-dashboard", response?.ok ? "opened" : "rejected");
  } catch {
    document.documentElement.setAttribute("data-d2l-extractor-dev-dashboard", "failed");
  }
}

function installContentMessaging() {
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // all_frames injects this script into every frame; sendMessage takes whichever
    // frame answers first, so subframes must stay silent or they win the race.
    if (window.top !== window.self) return false;

    if (message?.type === "D2L_PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "D2L_WHOAMI") {
      content.inspectVerifiedAccount()
        .then((diagnostic) => sendResponse({ ok: diagnostic.ok, accountId: diagnostic.accountId || "", diagnostic: { ...diagnostic, accountId: undefined } }))
        .catch((error) => sendResponse({ ok: false, accountId: "", diagnostic: { ok: false, reason: "request-error", errorName: String(error?.name || "Error").slice(0, 50) } }));
      return true;
    }

    if (message?.type === "D2L_COLLECT_COURSE_API") {
      collectCourseApiWithAccount(message.orgUnitId || getOrgUnitId(), { category: message.category, priorityOnly: message.priorityOnly === true })
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || "API collection failed." }));
      return true;
    }

    if (message?.type === "D2L_CURRENT_COURSES") {
      currentCourseOfferings()
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Current course discovery failed." }));
      return true;
    }

    if (message?.type === "D2L_PROBE_FRAME_TASK") {
      probeFrameTask(message.task)
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Probe frame extraction failed." }));
      return true;
    }

    if (message?.type === "D2L_PROBE_FRAME_CLOSE") {
      closeProbeFrame();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type !== "D2L_EXTRACT_VISIBLE_PAGE") return false;
    try {
      sendResponse({ ok: true, payload: extractVisiblePage() });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "Extraction failed." });
    }
    return true;
  });

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== "D2L_EXTRACTOR_COLLECT_COURSE_API") return;
    const orgUnitId = normalizeText(event.data?.orgUnitId || getOrgUnitId());
    let response;
    try {
      response = { ok: true, payload: await collectCourseApiWithAccount(orgUnitId) };
    } catch (error) {
      response = { ok: false, error: error?.message || "API collection failed." };
    }
    window.postMessage({ type: "D2L_EXTRACTOR_COURSE_API", orgUnitId, response }, "*");
  });

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== "D2L_EXTRACTOR_EXPORT_COURSE_API") return;
    const rawIds = Array.isArray(event.data?.orgUnitIds) ? event.data.orgUnitIds : [event.data?.orgUnitId || getOrgUnitId()];
    const orgUnitIds = [...new Set(rawIds.map((id) => normalizeText(id)).filter(Boolean))];
    const courseTitles = event.data?.courseTitles && typeof event.data.courseTitles === "object" ? event.data.courseTitles : {};
    const apiPayloads = [];
    const failed = [];

    for (const orgUnitId of orgUnitIds) {
      try {
        apiPayloads.push(await collectCourseApiWithAccount(orgUnitId));
      } catch (error) {
        failed.push({ orgUnitId, error: error?.message || "API collection failed." });
      }
    }

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "D2L_DOWNLOAD_API_EXPORT",
        apiPayloads,
        courseTitles,
        options: { collectionFailures: failed, requestedOrgUnitIds: orgUnitIds }
      });
      if (failed.length) response = { ...(response || {}), failed };
    } catch (error) {
      response = { ok: false, failed, error: error?.message || "Could not create API-only export." };
    }
    window.postMessage({ type: "D2L_EXTRACTOR_API_EXPORT", response }, "*");
  });

  async function runApiExportBridge(orgUnitIds, courseTitles = {}, options = {}) {
    const apiPayloads = [];
    const failed = [];
    for (const orgUnitId of [...new Set((orgUnitIds || []).map((id) => normalizeText(id)).filter(Boolean))]) {
      try {
        apiPayloads.push(await collectCourseApiWithAccount(orgUnitId));
      } catch (error) {
        failed.push({ orgUnitId, error: error?.message || "API collection failed." });
      }
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "D2L_DOWNLOAD_API_EXPORT",
        apiPayloads,
        courseTitles,
        options: { ...options, collectionFailures: failed, requestedOrgUnitIds: orgUnitIds }
      });
      return failed.length ? { ...(response || {}), failed } : response;
    } catch (error) {
      return { ok: false, failed, error: error?.message || "Could not create API-only export." };
    }
  }

  async function runPageProbeExportBridge(urls) {
    try {
      return await chrome.runtime.sendMessage({
        type: "D2L_DOWNLOAD_PAGE_PROBE_EXPORT",
        urls
      });
    } catch (error) {
      return { ok: false, error: error?.message || "Could not create page-probe export." };
    }
  }

  // "auto" (sent by the dashboard's Sync button) means every course offering the
  // student is enrolled in whose term dates include today.
  async function currentCourseOfferings(now = Date.now()) {
    const offerings = [];
    let bookmark = "";
    for (let page = 0; page < 10; page += 1) {
      const query = `isActive=true&canAccess=true&orgUnitTypeId=3${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ""}`;
      const response = await fetch(`/d2l/api/lp/1.49/enrollments/myenrollments/?${query}`, { credentials: "include" });
      if (!response.ok) break;
      const data = await response.json();
      for (const item of data?.Items || []) {
        const start = Date.parse(item.Access?.StartDate || "");
        const end = Date.parse(item.Access?.EndDate || "");
        if (Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end) {
          offerings.push({ orgUnitId: String(item.OrgUnit.Id), title: normalizeText(item.OrgUnit.Name) });
        }
      }
      if (!data?.PagingInfo?.HasMoreItems) break;
      bookmark = data.PagingInfo.Bookmark || "";
    }
    return offerings;
  }

  async function maybeRunHashApiExport() {
    const match = String(window.location.href || "").match(/[?#&](d2l-extractor-api-export|d2l-extractor-course-export)=([^&]+)/);
    if (!match) return;
    const triggerName = match[1];
    let orgUnitIds = decodeURIComponent(match[2]).split(",").map((id) => id.trim()).filter(Boolean);
    const reuseArchivedFiles = /[?#&]d2l-extractor-reuse-files=1(?:&|$)/.test(String(window.location.href || ""));
    const deltaProbes = /[?#&]d2l-extractor-delta=1(?:&|$)/.test(String(window.location.href || ""));
    const discoveredTitles = {};
    if (orgUnitIds.length === 1 && orgUnitIds[0] === "auto") {
      const offerings = await currentCourseOfferings();
      orgUnitIds = offerings.map((offering) => offering.orgUnitId);
      for (const offering of offerings) discoveredTitles[offering.orgUnitId] = offering.title;
    }
    if (!orgUnitIds.length) return;
    const marker = triggerName === "d2l-extractor-course-export" ? "data-d2l-extractor-course-export" : "data-d2l-extractor-api-export";
    const summaryMarker = `${marker}-summary`;
    const runKey = `${triggerName}:${orgUnitIds.join(",")}`;
    if (window.__d2lExtractorHashExportRunning === runKey) return;
    window.__d2lExtractorHashExportRunning = runKey;
    document.documentElement.setAttribute(marker, "started");
    document.documentElement.setAttribute(summaryMarker, JSON.stringify({ orgUnitIds, startedAt: new Date().toISOString() }).slice(0, 2000));
    const response = await runApiExportBridge(orgUnitIds, discoveredTitles, {
      pageProbes: triggerName === "d2l-extractor-course-export",
      reuseArchivedFiles,
      deltaProbes
    });
    window.__d2lExtractorLastApiExport = response;
    document.documentElement.setAttribute(marker, response?.ok ? "complete" : "failed");
    document.documentElement.setAttribute(summaryMarker, JSON.stringify(response || {}).slice(0, 2000));
  }

  async function maybeRunHashPageProbeExport() {
    const match = String(window.location.href || "").match(/[?#&]d2l-extractor-page-export=([^&]+)/);
    if (!match) return;
    const urls = decodeURIComponent(match[1]).split(/\n|\|/).map((url) => url.trim()).filter(Boolean);
    if (!urls.length) return;
    const key = urls.join("|");
    if (window.__d2lExtractorPageProbeExportRunning === key) return;
    window.__d2lExtractorPageProbeExportRunning = key;
    document.documentElement.setAttribute("data-d2l-extractor-page-export", "started");
    document.documentElement.setAttribute("data-d2l-extractor-page-export-summary", JSON.stringify({ urls, startedAt: new Date().toISOString() }).slice(0, 2000));
    const response = await runPageProbeExportBridge(urls);
    window.__d2lExtractorLastPageProbeExport = response;
    document.documentElement.setAttribute("data-d2l-extractor-page-export", response?.ok ? "complete" : "failed");
    document.documentElement.setAttribute("data-d2l-extractor-page-export-summary", JSON.stringify(response || {}).slice(0, 2000));
  }

  window.addEventListener("hashchange", maybeRunHashApiExport);
  window.addEventListener("hashchange", maybeRunHashPageProbeExport);
  window.addEventListener("hashchange", maybeRunDevReload);
  window.addEventListener("hashchange", maybeReportDevRuntimeCheck);
  window.addEventListener("hashchange", maybeRunDevOpenDashboard);
  window.addEventListener("hashchange", maybeRunDevSameTabSync);
  window.addEventListener("hashchange", maybeReportDevSameTabSync);
  window.addEventListener("hashchange", maybeCancelDevSameTabSync);
  window.addEventListener("hashchange", maybeReportDevSyncDiagnostics);
  maybeRunDevOpenDashboard();
  maybeRunHashApiExport();
  maybeRunHashPageProbeExport();
  maybeRunDevReload();
  maybeReportDevRuntimeCheck();
  maybeRunDevSameTabSync();
  maybeReportDevSameTabSync();
  maybeCancelDevSameTabSync();
  maybeReportDevSyncDiagnostics();
  setInterval(() => {
    maybeRunHashApiExport();
    maybeRunHashPageProbeExport();
  }, 2000);
}

  Object.assign(content, { installContentMessaging, devReloadHashRequested, devRuntimeCheckRequested, maybeReportDevRuntimeCheck, devSameTabSyncRequest });
})(globalThis);
