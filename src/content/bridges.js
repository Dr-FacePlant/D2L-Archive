(function initContentBridges(global) {
  const shared = global.D2LExtractorShared;
  const content = global.D2LExtractorContent ||= {};
  const { normalizeText } = shared;
  const { getOrgUnitId, collectCourseApiWithAccount, extractVisiblePage, probeFrameTask, closeProbeFrame } = content;

  function handleContentRuntimeMessage(message, _sender, sendResponse) {
    if (window.top !== window.self) return false;
    if (message?.type === "D2L_PING") {
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "D2L_WHOAMI") {
      content.inspectVerifiedAccount()
        .then((diag) => sendResponse({ ok: diag.ok, accountId: diag.accountId || "", diagnostic: { ...diag, accountId: undefined } }))
        .catch((err) => sendResponse({ ok: false, accountId: "", diagnostic: { ok: false, reason: "request-error", errorName: String(err?.name || "Error").slice(0, 50) } }));
      return true;
    }
    if (message?.type === "D2L_COLLECT_COURSE_API") {
      collectCourseApiWithAccount(message.orgUnitId || getOrgUnitId(), { category: message.category, priorityOnly: message.priorityOnly === true })
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((err) => sendResponse({ ok: false, error: err?.message || "API collection failed." }));
      return true;
    }
    if (message?.type === "D2L_CURRENT_COURSES") {
      currentCourseOfferings()
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((err) => sendResponse({ ok: false, error: err?.message || "Current course discovery failed." }));
      return true;
    }
    if (message?.type === "D2L_PROBE_FRAME_TASK") {
      probeFrameTask(message.task)
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((err) => sendResponse({ ok: false, error: err?.message || "Probe frame extraction failed." }));
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
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || "Extraction failed." });
    }
    return true;
  }

  async function handleWindowCollectApiMessage(event) {
    if (event.source !== window || event.data?.type !== "D2L_EXTRACTOR_COLLECT_COURSE_API") return;
    const orgUnitId = normalizeText(event.data?.orgUnitId || getOrgUnitId());
    let response;
    try {
      response = { ok: true, payload: await collectCourseApiWithAccount(orgUnitId) };
    } catch (err) {
      response = { ok: false, error: err?.message || "API collection failed." };
    }
    window.postMessage({ type: "D2L_EXTRACTOR_COURSE_API", orgUnitId, response }, "*");
  }

  async function handleWindowExportApiMessage(event) {
    if (event.source !== window || event.data?.type !== "D2L_EXTRACTOR_EXPORT_COURSE_API") return;
    const rawIds = Array.isArray(event.data?.orgUnitIds) ? event.data.orgUnitIds : [event.data?.orgUnitId || getOrgUnitId()];
    const orgUnitIds = [...new Set(rawIds.map((id) => normalizeText(id)).filter(Boolean))];
    const courseTitles = event.data?.courseTitles && typeof event.data.courseTitles === "object" ? event.data.courseTitles : {};
    const apiPayloads = [];
    const failed = [];
    for (const id of orgUnitIds) {
      try {
        apiPayloads.push(await collectCourseApiWithAccount(id));
      } catch (err) {
        failed.push({ orgUnitId: id, error: err?.message || "API collection failed." });
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
    } catch (err) {
      response = { ok: false, failed, error: err?.message || "Could not create API-only export." };
    }
    window.postMessage({ type: "D2L_EXTRACTOR_API_EXPORT", response }, "*");
  }

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

  function installContentMessaging() {
    chrome.runtime.onMessage.addListener(handleContentRuntimeMessage);
    window.addEventListener("message", handleWindowCollectApiMessage);
    window.addEventListener("message", handleWindowExportApiMessage);
    content.installDevBridges?.();
    window.addEventListener("hashchange", maybeRunHashApiExport);
    window.addEventListener("hashchange", maybeRunHashPageProbeExport);
    maybeRunHashApiExport();
    maybeRunHashPageProbeExport();
    setInterval(() => {
      maybeRunHashApiExport();
      maybeRunHashPageProbeExport();
    }, 2000);
  }

  Object.assign(content, { installContentMessaging });
})(globalThis);
