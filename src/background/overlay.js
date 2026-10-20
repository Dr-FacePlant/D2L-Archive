(function initBackgroundModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { D2L_ORIGIN } = shared;

// The D2L Archive overlay on D2L pages (src/content/overlay.js). Per tab it
// remembers which dashboard screen it shows and whether the student dismissed
// it, so internal D2L navigation stays quiet but a reload, Home, or a return
// from another site brings it back. chrome.storage.session keeps this until the
// browser closes; content scripts can't read it, so they ask here.
const OVERLAY_KEY = "overlayTabs";
const ROUTE_PATTERN = /^#\/[\w\-/:%?=&.,+~]*$/;

function isD2lPageUrl(url) {
  return String(url || "").startsWith(`${D2L_ORIGIN}/d2l/`);
}

function isD2lHomeUrl(url) {
  try {
    return /^\/d2l\/home\/?$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function cleanRoute(route) {
  return ROUTE_PATTERN.test(String(route || "")) ? route : "#/";
}

function wasDismissed(saved) {
  if (!saved) return false;
  if (typeof saved.dismissed === "boolean") return saved.dismissed;
  // Sessions saved before the launcher existed only stored `open`.
  return saved.open === false;
}

async function readOverlayTabs() {
  try {
    return (await chrome.storage.session.get(OVERLAY_KEY))[OVERLAY_KEY] || {};
  } catch {
    return {};
  }
}

async function overlayStateFor(tabId, options = {}) {
  const saved = (await readOverlayTabs())[tabId];
  const route = cleanRoute(saved?.route);
  if (!saved) return { open: true, route };
  // A D2L link opened from the overlay closes the archive for that destination
  // once. Reloading or moving on afterwards brings it back normally.
  if (saved.suppress === true) {
    await saveOverlayState(tabId, { suppress: false });
    return { open: false, route };
  }
  const dismissed = wasDismissed(saved);
  const reset = options.navigationType === "reload" || options.navigationType === "back_forward" || isD2lHomeUrl(options.url);
  if (dismissed && reset) {
    await saveOverlayState(tabId, { dismissed: false });
    return { open: true, route };
  }
  return { open: !dismissed, route };
}

// Two messages can land together (the dashboard's route and a close), so
// writes run one at a time on the latest saved value.
let overlayWrites = Promise.resolve();
function updateOverlayTabs(change) {
  const run = overlayWrites.then(async () => {
    const tabs = await readOverlayTabs();
    const result = change(tabs);
    await chrome.storage.session.set({ [OVERLAY_KEY]: tabs });
    return result;
  });
  overlayWrites = run.catch(() => {});
  return run;
}

function saveOverlayState(tabId, patch) {
  return updateOverlayTabs((tabs) => {
    const saved = tabs[tabId];
    const next = {
      dismissed: typeof patch.dismissed === "boolean"
        ? patch.dismissed
        : typeof patch.open === "boolean" ? !patch.open : wasDismissed(saved),
      suppress: typeof patch.suppress === "boolean" ? patch.suppress : saved?.suppress === true,
      route: cleanRoute(patch.route ?? saved?.route)
    };
    tabs[tabId] = next;
    return { open: !next.dismissed, route: next.route };
  });
}

function forgetOverlayTab(tabId) {
  return updateOverlayTabs((tabs) => { delete tabs[tabId]; });
}

// Tells the page's overlay script (top frame only) to open or close.
async function applyOverlay(tabId, state) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "D2L_OVERLAY_APPLY", open: state.open, route: state.route }, { frameId: 0 });
    return response?.ok === true;
  } catch {
    return false;
  }
}

// Toolbar icon and Alt+Shift+A. Returns false when this tab can't show the
// overlay (not D2L, or a page loaded before the extension was), so the caller
// opens the dashboard tab instead.
async function toggleOverlay(tab) {
  if (!tab?.id || !isD2lPageUrl(tab.url)) return false;
  const before = await overlayStateFor(tab.id, { url: tab.url });
  const next = await saveOverlayState(tab.id, { dismissed: before.open, suppress: false });
  if (await applyOverlay(tab.id, next)) return true;
  await saveOverlayState(tab.id, { dismissed: !before.open, suppress: false });
  return false;
}

function fromDashboardFrame(sender) {
  return Boolean(sender?.tab?.id) && String(sender?.url || "").startsWith(chrome.runtime.getURL("dashboard.html"));
}

function fromD2lTopFrame(sender) {
  return Boolean(sender?.tab?.id) && sender.frameId === 0 && isD2lPageUrl(sender.url || sender.tab.url);
}

// D2L_OVERLAY_STATE  page script, on load: is the overlay open, on which screen?
//                    The page also reports whether this load was a reload and
//                    which URL it is, so Home and reloads reset a dismissal.
// D2L_OVERLAY_SET    dashboard frame (screen, Close) or development control:
//                    saves {dismissed, route}; a close from the dashboard reaches the page.
// D2L_OVERLAY_OPEN_D2L  dashboard frame: open a D2L link in this tab with the
//                    overlay closed for that destination only.
async function handleOverlayMessage(message, sender) {
  const dashboard = fromDashboardFrame(sender);
  if (!dashboard && !fromD2lTopFrame(sender)) return { ok: false, error: "Overlay requests come from a D2L page or the overlay itself." };
  const tabId = sender.tab.id;
  if (message.type === "D2L_OVERLAY_STATE") {
    const state = await overlayStateFor(tabId, {
      url: message.url || sender.url || sender.tab.url,
      navigationType: message.navigationType
    });
    return { ok: true, ...state };
  }
  if (message.type === "D2L_OVERLAY_SET") {
    const patch = {};
    if (typeof message.open === "boolean") {
      patch.dismissed = !message.open;
      patch.suppress = false;
    }
    if (typeof message.dismissed === "boolean") patch.dismissed = message.dismissed;
    if (typeof message.suppress === "boolean") patch.suppress = message.suppress;
    if (typeof message.route === "string") patch.route = message.route;
    const state = await saveOverlayState(tabId, patch);
    if (dashboard && patch.dismissed === true) await applyOverlay(tabId, state);
    return { ok: true, ...state };
  }
  if (message.type === "D2L_OVERLAY_OPEN_D2L") {
    const url = String(message.url || "");
    if (!dashboard || !url.startsWith(`${D2L_ORIGIN}/`)) return { ok: false, error: "Only D2L links open in this tab." };
    const state = await saveOverlayState(tabId, { dismissed: true, suppress: true });
    await applyOverlay(tabId, state);
    await chrome.tabs.update(tabId, { url });
    return { ok: true, ...state };
  }
  return { ok: false, error: `Unknown overlay request ${message.type}.` };
}

Object.assign(background, { OVERLAY_KEY, isD2lPageUrl, isD2lHomeUrl, overlayStateFor, saveOverlayState, forgetOverlayTab, applyOverlay, toggleOverlay, handleOverlayMessage });
})(globalThis);
