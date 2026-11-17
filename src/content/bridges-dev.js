(function initContentBridgesDev(global) {
  const shared = global.D2LExtractorShared;
  const content = global.D2LExtractorContent ||= {};
  const { DEV_RELOAD_TOKEN } = shared;

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
    let status = document.getElementById("d2l-extractor-dev-runtime-status");
    if (!status) {
      status = document.createElement("div");
      status.id = "d2l-extractor-dev-runtime-status";
      status.style.cssText = "position:fixed;bottom:12px;left:12px;background:#111;color:#fff;padding:8px 12px;border-radius:4px;font:12px/1.4 monospace;z-index:999999;max-width:800px;white-space:pre-wrap;box-shadow:0 4px 12px rgba(0,0,0,0.3);";
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

  async function maybeRunDevOpenDashboard() {
    const match = String(window.location.hash || "").match(new RegExp(`^#d2l-extractor-open-dashboard=${DEV_RELOAD_TOKEN}(?:::([^&]+))?$`));
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

  function installDevBridges() {
    window.addEventListener("hashchange", maybeRunDevReload);
    window.addEventListener("hashchange", maybeReportDevRuntimeCheck);
    window.addEventListener("hashchange", maybeRunDevOpenDashboard);
    window.addEventListener("hashchange", maybeRunDevSameTabSync);
    window.addEventListener("hashchange", maybeReportDevSameTabSync);
    window.addEventListener("hashchange", maybeCancelDevSameTabSync);
    window.addEventListener("hashchange", maybeReportDevSyncDiagnostics);
    maybeRunDevOpenDashboard();
    maybeRunDevReload();
    maybeReportDevRuntimeCheck();
    maybeRunDevSameTabSync();
    maybeReportDevSameTabSync();
    maybeCancelDevSameTabSync();
    maybeReportDevSyncDiagnostics();
  }

  Object.assign(content, {
    devReloadHashRequested,
    devRuntimeCheckRequested,
    showDevRuntimeStatus,
    maybeReportDevRuntimeCheck,
    devSameTabSyncRequest,
    maybeRunDevSameTabSync,
    maybeReportDevSameTabSync,
    maybeReportDevSyncDiagnostics,
    maybeCancelDevSameTabSync,
    maybeRunDevReload,
    maybeRunDevOpenDashboard,
    installDevBridges
  });
})(globalThis);
