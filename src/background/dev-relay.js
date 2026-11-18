(function () {
  "use strict";

  const { normalizeText, D2L_ORIGIN, DEV_RELOAD_TOKEN, APP_API_MESSAGE_TYPE } = globalThis.D2LExtractorShared;
  const {
    accountKeyFor, verifyTabAccount, describeAccounts,
    handleAppApiRequest, activeArchiveAccountId, activeArchiveRepository
  } = globalThis.D2LExtractorBackground;

  const DASHBOARD_PATH = "dashboard.html";

  function isAuthorizedDevRequest(message, sender, requireFrameZero = false) {
    const senderUrl = sender?.tab?.url || sender?.url || "";
    const isDevelopmentBuild = !chrome.runtime.getManifest().update_url;
    if (message?.token !== DEV_RELOAD_TOKEN || !senderUrl.startsWith(`${D2L_ORIGIN}/d2l/`) || !isDevelopmentBuild) {
      return false;
    }
    if (requireFrameZero && sender?.frameId !== 0) return false;
    return true;
  }

  function handleDevReload(message, sender, sendResponse) {
    if (!isAuthorizedDevRequest(message, sender)) {
      sendResponse({ ok: false, error: "Development reload request rejected." });
      return false;
    }
    sendResponse({ ok: true });
    setTimeout(() => chrome.runtime.reload(), 50);
    return false;
  }

  async function checkTabIdentity(tab, registry) {
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
  }

  function summarizeAccountChecks(checks, currentTabId, registry) {
    const verifiedIds = checks.map((entry) => entry.productionIdentity).filter(Boolean);
    const currentTabCheck = checks.find((entry) => entry.tabId === currentTabId) || null;
    let overallReasonCode = "verified";
    if (!checks.length) overallReasonCode = "no-d2l-tabs-matched";
    else if (!verifiedIds.length) overallReasonCode = currentTabCheck?.reasonCode || "no-unique-verified-account";
    else if (new Set(verifiedIds).size > 1) overallReasonCode = "multiple-verified-accounts";
    else if (checks.some((entry) => entry.productionHelperVerified && !entry.registryEntryExists)) overallReasonCode = "registry-entry-missing";
    const registryCount = Array.isArray(registry.accounts) ? registry.accounts.length : null;
    return {
      ok: overallReasonCode === "verified",
      reasonCode: overallReasonCode,
      candidateCount: checks.length,
      registryEntryCount: registryCount,
      registryAvailable: !registry.error,
      currentTabId,
      currentTabIncluded: Boolean(currentTabCheck),
      tabs: checks
    };
  }

  function handleDevRuntimeCheck(message, sender, sendResponse) {
    if (!isAuthorizedDevRequest(message, sender, true)) {
      sendResponse({ ok: false, error: "Development runtime check rejected." });
      return false;
    }
    const extensionVersion = chrome.runtime.getManifest().version || "";
    const contentVersion = normalizeText(message.contentVersion);
    (async () => {
      const d2lTabs = await chrome.tabs.query({ url: `${D2L_ORIGIN}/d2l/*` }).catch(() => []);
      const registry = await describeAccounts().catch((error) => ({ error: error?.code || "registry-unavailable", accounts: [] }));
      const checks = await Promise.all(d2lTabs.map((tab) => checkTabIdentity(tab, registry)));
      const accountCheck = summarizeAccountChecks(checks, sender.tab.id, registry);
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

  async function collectSyncDiagnostics(call) {
    const accountId = normalizeText(await activeArchiveAccountId());
    const queue0 = await call("sync.getQueue", { accountId, limit: 100 });
    const courseIds = [...new Set((queue0.jobs || []).map((job) => String(job.courseId || "")).filter(Boolean))];
    const queue = courseIds.length ? await call("sync.getQueue", { accountId, limit: 100, courseIds }) : queue0;
    const localKeys = Object.keys(await chrome.storage.local.get(null))
      .filter((key) => /^(d2lLastExportSummary|d2lProbeSignatures|dashboardReadUpdates|dashboardHiddenWork)/.test(key)).sort();
    const dashboardCheck = await call("dashboard.getOverview", {}).then((overview) => overview.error ? overview : {
      courses: overview.courses.length,
      entityTypes: Object.keys(overview.entityCounts).length,
      entities: Object.values(overview.entityCounts).reduce((sum, count) => sum + count, 0),
      gradedItems: overview.gradedItems
    });
    return {
      ok: true,
      at: new Date().toISOString(),
      accountId,
      queue,
      syncState: await call("sync.getState", { limit: 5 }),
      activitySummary: await call("activity.getSummary", {}),
      activity: await call("activity.list", { limit: 60 }),
      dashboardCheck,
      accountContext: await call("system.getAccountContext", {}),
      localKeys,
      storeCounts: await activeArchiveRepository().then((repo) => repo.getStoreCounts(), (err) => ({ error: err?.code || err?.message })),
      databaseNames: await indexedDB.databases().then((list) => list.map((db) => db.name).filter((name) => String(name).startsWith("d2l-student-archive")), () => null),
      registry: await describeAccounts().catch((error) => ({ error: error?.code || error?.message }))
    };
  }

  function handleDevSyncDiagnostics(message, sender, sendResponse) {
    if (!isAuthorizedDevRequest(message, sender, true)) {
      sendResponse({ ok: false, error: "Development diagnostics request rejected." });
      return false;
    }
    (async () => {
      const call = async (method, params) => {
        const response = await handleAppApiRequest({ type: APP_API_MESSAGE_TYPE, protocolVersion: "1", requestId: `dev-diag-${method}`, method, params });
        return response.ok ? response.data : { error: response.error };
      };
      const diagnostics = await collectSyncDiagnostics(call);
      sendResponse(diagnostics);
    })().catch((error) => sendResponse({ ok: false, error: error?.message || "Diagnostics failed." }));
    return true;
  }

  function handleDevOpenDashboard(message, sender, sendResponse) {
    if (!isAuthorizedDevRequest(message, sender)) {
      sendResponse({ ok: false, error: "Development dashboard request rejected." });
      return false;
    }
    const route = /^#[\w\-/:%?=&.]*$/.test(message.route || "") ? message.route : "";
    const query = message.selfcheck === true ? "?selfcheck=1" : "";
    chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD_PATH) + query + route, openerTabId: sender.tab.id, index: sender.tab.index + 1, active: false })
      .then(async (tab) => {
        if (sender.tab.groupId !== undefined && sender.tab.groupId !== -1) await chrome.tabs.group({ groupId: sender.tab.groupId, tabIds: [tab.id] }).catch(() => {});
        sendResponse({ ok: true, tabId: tab.id });
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not open the dashboard." }));
    return true;
  }

  function handleDevMessage(message, sender, sendResponse) {
    if (message?.type === "D2L_DEV_RELOAD_EXTENSION") return handleDevReload(message, sender, sendResponse);
    if (message?.type === "D2L_DEV_RUNTIME_CHECK") return handleDevRuntimeCheck(message, sender, sendResponse);
    if (message?.type === "D2L_DEV_SYNC_DIAGNOSTICS") return handleDevSyncDiagnostics(message, sender, sendResponse);
    if (message?.type === "D2L_DEV_OPEN_DASHBOARD") return handleDevOpenDashboard(message, sender, sendResponse);
    return undefined;
  }

  globalThis.D2LExtractorBackground = {
    ...globalThis.D2LExtractorBackground,
    handleDevMessage
  };
})();
