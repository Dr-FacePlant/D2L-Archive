(function initPopupModule(global) {
  const popup = global.D2LExtractorPopup ||= {};
  const { setBusy, showPayload, showError } = popup;

// The toolbar icon opens the dashboard, so these tools usually run in their own
// tab (Settings > Extractor tools). Then the D2L tab to work on is the one the
// student used most recently.
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.includes("kennesaw.view.usg.edu/d2l/")) return tab;
  const d2lTabs = await chrome.tabs.query({ url: "https://kennesaw.view.usg.edu/d2l/*" });
  return d2lTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || tab;
}

async function requestExtraction() {
  setBusy(true);
  try {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url?.includes("kennesaw.view.usg.edu/d2l/")) {
      showError("Open a Kennesaw D2L page before extracting.");
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: "D2L_EXTRACT_VISIBLE_PAGE" });
    if (!response?.ok) {
      showError(response?.error || "The content script did not return data. Reload the page and try again.");
      return;
    }

    showPayload(response.payload);
  } catch (error) {
    showError("Could not extract from this page. Reload D2L and try again.");
  } finally {
    setBusy(false);
  }
}

  Object.assign(popup, { getActiveTab, requestExtraction });
})(globalThis);
