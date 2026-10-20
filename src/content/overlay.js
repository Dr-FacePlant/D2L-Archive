// The D2L Archive opens over D2L in the same tab. The dashboard runs
// unchanged in a frame (dashboard.html?embedded=1) inside a closed shadow root,
// so D2L's styles can't reach it and nothing here changes D2L's own page.
// Top frame only. The background remembers per tab whether the student dismissed
// the overlay and on which screen, so a D2L page load can bring it back
// (src/background/overlay.js). A dismissed overlay leaves a small launcher.
(function initStudentArchiveOverlay(global) {
  if (global.top !== global.self || global.__D2LArchiveOverlay) return;
  const doc = global.document;
  const ROUTE_PATTERN = /^#\/[\w\-/:%?=&.,+~]*$/;

  const STYLE = `
    [hidden] { display: none !important; }
    .panel { position: fixed; inset: 0; z-index: 2147483647; background: #F5F7F9; animation: overlay-in .16s ease-out; }
    .panel iframe { display: block; width: 100%; height: 100%; border: 0; background: #F5F7F9; }
    .launcher { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; display: inline-flex; align-items: center; gap: 8px; min-height: 44px; margin: 0; padding: 0 14px 0 10px; border: 1px solid #D8DEE6; border-radius: 999px; background: #FFFFFF; color: #16202B; box-shadow: 0 6px 20px rgba(15, 23, 42, .18); font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: .01em; cursor: pointer; }
    .launcher:hover { border-color: #AEB9C6; box-shadow: 0 9px 26px rgba(15, 23, 42, .24); }
    .launcher:active { transform: translateY(1px); }
    .launcher:focus-visible { outline: 3px solid #2D6A4F; outline-offset: 3px; }
    .launcher .mark { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 7px; background: #16202B; color: #FFFFFF; font-size: 8px; font-weight: 800; letter-spacing: .02em; }
    @keyframes overlay-in { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .panel { animation: none; } .launcher:active { transform: none; } }
    @media print { .panel, .launcher { display: none !important; } }
  `;

  const host = doc.createElement("div");
  host.id = "d2l-student-archive";
  host.setAttribute("style", "all: initial !important");
  host.setAttribute("data-state", "closed");
  const root = host.attachShadow({ mode: "closed" });
  const style = doc.createElement("style");
  style.textContent = STYLE;
  root.append(style);

  const launcher = doc.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.hidden = true;
  launcher.setAttribute("aria-label", "Open D2L Archive");
  const mark = doc.createElement("span");
  mark.className = "mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "D2L";
  const launcherText = doc.createElement("span");
  launcherText.textContent = "D2L Archive";
  launcher.append(mark, launcherText);
  root.append(launcher);
  host.setAttribute("data-launcher", "hidden");

  const overlay = { open: false, route: "#/", panel: null, frame: null, watcher: null, returnFocus: null };

  function showLauncher(show) {
    launcher.hidden = !show;
    host.setAttribute("data-launcher", show ? "shown" : "hidden");
  }

  launcher.addEventListener("click", () => {
    if (overlay.open) return;
    showLauncher(false);
    openOverlay(overlay.route, launcher);
    send({ type: "D2L_OVERLAY_SET", open: true, route: overlay.route }).catch(() => {});
  });

  // While the frame loads, the panel shows the dashboard's own page color, so
  // the dark theme (Settings > Appearance) doesn't flash light first.
  const GROUNDS = { light: "#F5F7F9", dark: "#0F1318" };
  let ground = GROUNDS.light;
  function readGround(settings) {
    const theme = settings?.appearance?.theme;
    const dark = theme === "dark" || (theme === "system" && global.matchMedia?.("(prefers-color-scheme: dark)").matches === true);
    ground = dark ? GROUNDS.dark : GROUNDS.light;
    overlay.panel?.setAttribute("style", `background: ${ground}`);
    overlay.frame?.setAttribute("style", `background: ${ground}`);
  }
  try {
    chrome.storage?.local?.get("dashboardSettings").then((saved) => readGround(saved?.dashboardSettings)).catch(() => {});
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === "local" && changes.dashboardSettings) readGround(changes.dashboardSettings.newValue);
    });
  } catch {
    // Storage isn't reachable after the extension reloads; the light color stays.
  }

  function cleanRoute(route) {
    return ROUTE_PATTERN.test(String(route || "")) ? route : "#/";
  }

  function openOverlay(route, returnFocus) {
    if (overlay.open) return;
    overlay.open = true;
    overlay.route = cleanRoute(route);
    overlay.returnFocus = returnFocus || (doc.activeElement === host ? null : doc.activeElement);
    showLauncher(false);
    const panel = doc.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "D2L Archive");
    const frame = doc.createElement("iframe");
    panel.setAttribute("style", `background: ${ground}`);
    frame.setAttribute("style", `background: ${ground}`);
    frame.title = "D2L Archive";
    frame.src = `${chrome.runtime.getURL("dashboard.html")}?embedded=1${overlay.route}`;
    frame.addEventListener("load", () => {
      host.setAttribute("data-frame", "loaded");
      frame.focus();
    });
    panel.append(frame);
    root.append(panel);
    // Another extension can pull the frame out (Claude in Chrome does, before
    // it runs a script on the page). Close rather than leave a blank panel.
    const openedAt = Date.now();
    const watcher = new global.MutationObserver(() => {
      if (frame.isConnected || overlay.frame !== frame) return;
      host.setAttribute("data-frame", `removed after ${Date.now() - openedAt} ms`);
      closeOverlay();
      showLauncher(true);
      send({ type: "D2L_OVERLAY_SET", open: false }).catch(() => {});
    });
    watcher.observe(panel, { childList: true });
    watcher.observe(root, { childList: true });
    Object.assign(overlay, { panel, frame, watcher });
    host.setAttribute("data-state", "open");
    host.setAttribute("data-route", overlay.route);
    host.setAttribute("data-frame", "loading");
  }

  // Closing removes the frame, so a closed overlay costs D2L nothing.
  function closeOverlay() {
    if (!overlay.open) return;
    overlay.watcher.disconnect();
    overlay.panel.remove();
    const back = overlay.returnFocus;
    Object.assign(overlay, { open: false, panel: null, frame: null, watcher: null, returnFocus: null });
    host.setAttribute("data-state", "closed");
    if (back && back.isConnected && back !== doc.body) back.focus();
  }

  function send(message) {
    try {
      return Promise.resolve(chrome.runtime.sendMessage(message));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // After the extension reloads, this copy of the script can't reach it any
  // more, so remove its host until the page loads again.
  function orphaned() {
    closeOverlay();
    host.remove();
  }

  function apply(state) {
    if (!state?.ok) return;
    if (state.open) {
      openOverlay(state.route);
    } else {
      closeOverlay();
      showLauncher(true);
    }
  }

  // Development builds: #d2l-extractor-overlay=open[&route=/work] or =close, so
  // live checks can open a screen without clicking inside the page; =report
  // copies what the background saved, and the frame's size, onto the host
  // (data-saved-*, data-frame-size), since checks can't look inside the frame.
  function devRequest() {
    if (chrome.runtime.getManifest().update_url) return null;
    const match = String(global.location.hash).match(/d2l-extractor-overlay=(open|close|report)(?:&route=([^&]*))?/);
    if (!match) return null;
    if (match[1] === "report") return { report: true };
    return match[2] ? { open: match[1] === "open", route: `#${decodeURIComponent(match[2])}` } : { open: match[1] === "open" };
  }

  function applyDevRequest() {
    const request = devRequest();
    if (!request) return false;
    if (request.report) {
      send({ type: "D2L_OVERLAY_STATE", url: global.location.href, navigationType: navigationType() }).then((state) => {
        host.setAttribute("data-saved-open", String(state?.open));
        host.setAttribute("data-saved-dismissed", String(state?.dismissed));
        host.setAttribute("data-saved-route", String(state?.route));
        host.setAttribute("data-launcher", launcher.hidden ? "hidden" : "shown");
        host.setAttribute("data-frame-size", overlay.frame ? `${overlay.frame.offsetWidth}x${overlay.frame.offsetHeight}` : "none");
      }).catch(orphaned);
      return true;
    }
    send({ type: "D2L_OVERLAY_SET", ...request }).then((state) => {
      if (state?.ok && state.open) closeOverlay();
      apply(state);
    }).catch(orphaned);
    return true;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "D2L_OVERLAY_APPLY") return false;
    apply({ ok: true, open: message.open === true, route: message.route });
    sendResponse({ ok: true });
    return false;
  });

  function navigationType() {
    try {
      return global.performance?.getEntriesByType?.("navigation")?.[0]?.type || "";
    } catch {
      return "";
    }
  }

  global.addEventListener("hashchange", applyDevRequest);
  doc.documentElement.append(host);
  global.__D2LArchiveOverlay = Object.freeze({ host, open: openOverlay, close: closeOverlay, isOpen: () => overlay.open, route: () => overlay.route });
  if (!applyDevRequest()) send({ type: "D2L_OVERLAY_STATE", url: global.location.href, navigationType: navigationType() }).then(apply).catch(orphaned);
})(globalThis);
