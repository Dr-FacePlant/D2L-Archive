(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;
  const { queryAll, absoluteUrl } = content;

  function extractDashboard() {
    return queryAll("a[href*='/d2l/home/']")
      .filter((link) => /\/d2l\/home\/\d+/.test(link.getAttribute("href") || ""))
      .map((link) => {
        const label = normalizeText(link.getAttribute("aria-label") || link.textContent);
        const orgMatch = (link.getAttribute("href") || "").match(/\/d2l\/home\/(\d+)/);
        return {
          source: "dashboardCourseCard",
          title: label,
          url: absoluteUrl(link.getAttribute("href")),
          ids: { courseOrgUnitId: orgMatch?.[1] || null }
        };
      });
  }

  Object.assign(content, { extractDashboard });
})();
