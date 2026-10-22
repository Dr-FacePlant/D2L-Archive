// Embedded overlay messaging and navigation.
(function initDashboardAppOverlay(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { EMBEDDED, state } = dash.appModules;
  // ----------------------------------------------------------- overlay
  // In the overlay, D2L links open in the same tab (the overlay closes so D2L's
  // page shows), and the screen you're on is remembered for the next D2L page.

  function overlayMessage(message) {
    return chrome.runtime.sendMessage(message).catch(() => null);
  }

  function externalHost(url) {
    try { return new URL(url).hostname.replace(/^www\./i, ""); }
    catch { return "External website"; }
  }

  function confirmHost() {
    let node = document.getElementById("link-confirm");
    if (!node) {
      node = document.createElement("div");
      node.id = "link-confirm";
      document.body.append(node);
    }
    return node;
  }

  // A link that leaves the archive asks once before it opens. D2L links use the
  // same prompt: the answer is still the same tab, not a second tab.
  function showLinkConfirm({ url, title, kind = "external" }) {
    if (!url) return;
    closeLinkConfirm({ restoreFocus: false });
    const focus = document.activeElement;
    state.linkConfirm = { type: "link", url, title, kind, focus };
    confirmHost().innerHTML = dash.linkConfirmPanel({ title, domain: externalHost(url), kind });
    document.querySelector("#link-confirm [data-action=confirm-link]")?.focus();
  }

  function showFileOpen({ path, name, d2l, download }) {
    if (!path) return;
    closeLinkConfirm({ restoreFocus: false });
    const focus = document.activeElement;
    state.linkConfirm = { type: "file", path, name, d2l, download, focus };
    confirmHost().innerHTML = dash.fileOpenPanel({ name });
    document.querySelector("#link-confirm [data-action=preview-confirmed-file]")?.focus();
  }

  function closeLinkConfirm({ restoreFocus = true } = {}) {
    const current = state.linkConfirm;
    state.linkConfirm = null;
    document.getElementById("link-confirm")?.remove();
    if (restoreFocus && current?.focus?.isConnected) current.focus.focus({ preventScroll: true });
  }

  // A confirmed link uses the current tab. In the overlay that means the D2L
  // page's tab, so the dashboard frame asks the background to navigate it.
  function openLinkInCurrentTab(url, kind) {
    if (!url) return;
    if (!EMBEDDED) return location.assign(url);
    if (kind === "d2l") return openInD2l(url);
    return overlayMessage({ type: "D2L_OVERLAY_OPEN_URL", url });
  }

  function openConfirmedLink() {
    const current = state.linkConfirm;
    if (current?.type !== "link" || !current.url) return;
    closeLinkConfirm();
    openLinkInCurrentTab(current.url, current.kind);
  }

  function previewConfirmedFile() {
    const current = state.linkConfirm;
    if (current?.type !== "file" || !current.path) return;
    closeLinkConfirm();
    const node = { dataset: { path: current.path, name: current.name || "File", d2l: current.d2l || "", download: current.download || "" } };
    dash.appModules.previewFile(node);
  }

  function openConfirmedD2l() {
    const current = state.linkConfirm;
    if (current?.type !== "file" || !current.d2l) return;
    closeLinkConfirm();
    openLinkInCurrentTab(current.d2l, "d2l");
  }

  function closeOverlay() {
    return overlayMessage({ type: "D2L_OVERLAY_SET", open: false });
  }

  function rememberScreen() {
    if (EMBEDDED) overlayMessage({ type: "D2L_OVERLAY_SET", route: location.hash || "#/" });
  }

  function openInD2l(url) {
    return overlayMessage({ type: "D2L_OVERLAY_OPEN_D2L", url });
  }

  Object.assign(mod, { overlayMessage, closeOverlay, rememberScreen, openInD2l, externalHost, showLinkConfirm, showFileOpen, closeLinkConfirm, openConfirmedLink, previewConfirmedFile, openConfirmedD2l });
})(globalThis);
