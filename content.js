(() => {
  const D2L_EXTRACTOR_VERSION = "0.9.0";
  const content = globalThis.D2LExtractorContent;
  content.buildVersion = D2L_EXTRACTOR_VERSION;
  const { normalizeText } = globalThis.D2LExtractorShared;

  try {
    document.documentElement.setAttribute("data-d2l-extractor-build", D2L_EXTRACTOR_VERSION);
  } catch {}

  globalThis.__D2LExtractorContentTestHooks = Object.freeze({
    normalizeText,
    ...content,
    buildVersion: D2L_EXTRACTOR_VERSION,
    devRuntimeStatus: () => document.getElementById("d2l-extractor-dev-runtime-status")?.textContent || "",
    devRuntimeTitle: () => document.title
  });

  content.installContentMessaging();
})();
