(function initPopupModule(global) {
  const popup = global.D2LExtractorPopup ||= {};
  const { elements, state } = popup;
  const { statusEl, outputEl, pageTypeEl, courseEl, itemCountEl, lastRunEl, extractButton, copyButton, downloadButton } = elements;

function setBusy(isBusy) {
  extractButton.disabled = isBusy;
  statusEl.textContent = isBusy ? "Extracting visible D2L data..." : statusEl.textContent;
}

function showPayload(payload) {
  state.latestPayload = payload;
  const items = Array.isArray(payload.items) ? payload.items : [];
  pageTypeEl.textContent = payload.pageType || "-";
  courseEl.textContent = payload.course?.title || payload.course?.orgUnitId || "-";
  itemCountEl.textContent = String(items.length);
  outputEl.textContent = JSON.stringify(payload, null, 2);
  copyButton.disabled = false;
  downloadButton.disabled = false;
  statusEl.textContent = "Extraction complete. Data stayed local in this browser.";
  if (lastRunEl) lastRunEl.textContent = `Last extracted ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${payload.pageType || "page"}`;
}

function showError(message) {
  statusEl.textContent = message;
  outputEl.textContent = "";
  pageTypeEl.textContent = "-";
  courseEl.textContent = "-";
  itemCountEl.textContent = "-";
  copyButton.disabled = true;
  downloadButton.disabled = true;
}

async function copyJson() {
  if (!state.latestPayload) return;
  await navigator.clipboard.writeText(JSON.stringify(state.latestPayload, null, 2));
  statusEl.textContent = "JSON copied.";
}

function downloadJson() {
  if (!state.latestPayload) return;
  const courseId = state.latestPayload.course?.orgUnitId || "d2l";
  const pageType = state.latestPayload.pageType || "page";
  const filename = `d2l-${courseId}-${pageType}-${Date.now()}.json`;
  const blob = new Blob([JSON.stringify(state.latestPayload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({ url, filename, saveAs: true }, () => {
    URL.revokeObjectURL(url);
  });
}

  Object.assign(popup, { setBusy, showPayload, showError, copyJson, downloadJson });
})(globalThis);
