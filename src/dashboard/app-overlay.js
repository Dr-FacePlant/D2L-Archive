// Embedded overlay messaging and navigation.
(function initDashboardAppOverlay(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { EMBEDDED } = dash.appModules;
  // ----------------------------------------------------------- overlay
  // In the overlay, D2L links open in the same tab (the overlay closes so D2L's
  // page shows), and the screen you're on is remembered for the next D2L page.

  function overlayMessage(message) {
    return chrome.runtime.sendMessage(message).catch(() => null);
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

  Object.assign(mod, { overlayMessage, closeOverlay, rememberScreen, openInD2l });
})(globalThis);
