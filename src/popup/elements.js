(function initPopupElements(global) {
  const popup = global.D2LExtractorPopup ||= {};
  const elements = {
    statusEl: document.getElementById("status"),
    outputEl: document.getElementById("output"),
    pageTypeEl: document.getElementById("pageType"),
    courseEl: document.getElementById("course"),
    itemCountEl: document.getElementById("itemCount"),
    lastRunEl: document.getElementById("last-run"),
    extractButton: document.getElementById("extract"),
    copyButton: document.getElementById("copy"),
    downloadButton: document.getElementById("download")
  };
  const state = { latestPayload: null };
  Object.assign(popup, { elements, state });
})(globalThis);
