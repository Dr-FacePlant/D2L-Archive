(() => {
  const popup = globalThis.D2LExtractorPopup;
  const { elements } = popup;
  const { extractButton, copyButton, downloadButton } = elements;
  const { requestExtraction, copyJson, downloadJson } = popup;

  extractButton.addEventListener("click", requestExtraction);
  copyButton.addEventListener("click", copyJson);
  downloadButton.addEventListener("click", downloadJson);

  requestExtraction();
})();
