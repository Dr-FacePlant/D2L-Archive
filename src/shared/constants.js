(() => {
  const shared = globalThis.D2LExtractorShared ||= {};

  shared.D2L_ORIGIN = "https://kennesaw.view.usg.edu";
  shared.DEV_RELOAD_TOKEN = "d2l-local-dev-8f6c2a1e";
  shared.CSV_COLUMNS = Object.freeze([
    "crawledAt",
    "pageType",
    "pageTitle",
    "pageUrl",
    "courseOrgUnitId",
    "courseTitle",
    "source",
    "title",
    "description",
    "status",
    "gate",
    "type",
    "dueAtText",
    "availabilityText",
    "itemUrl",
    "downloadUrl",
    "suggestedFileName",
    "historyUrl",
    "feedbackUrl",
    "localPath",
    "downloadError",
    "localPageTextPath",
    "localPageTextSnippet",
    "ids",
    "columns"
  ]);
})();
