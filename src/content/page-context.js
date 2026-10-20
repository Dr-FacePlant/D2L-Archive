(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText, classifyUrl } = globalThis.D2LExtractorShared;
  const { queryAll } = content;

  function getOrgUnitId(url = window.location.href) {
    const href = String(url || "");
    const parsed = new URL(href, window.location.href);
    const ou = parsed.searchParams.get("ou");
    if (ou) return ou;
    return href.match(/\/d2l\/home\/(\d+)/)?.[1]
      || href.match(/\/d2l\/le\/content\/(\d+)\//)?.[1]
      || href.match(/\/d2l\/le\/(\d+)\/discussions\//)?.[1]
      || href.match(/\/d2l\/p\/le\/discussions\/(\d+)/)?.[1]
      || href.match(/\/d2l\/le\/calendar\/(\d+)/)?.[1]
      || null;
  }

  function classifyPage() {
    return classifyUrl(window.location.href);
  }

  function getCourse() {
    const orgUnitId = getOrgUnitId();
    const navCourseLink = queryAll("a[href*='/d2l/home/']").find((link) => {
      const href = link.getAttribute("href") || "";
      return orgUnitId ? href.includes(`/d2l/home/${orgUnitId}`) : !href.endsWith("/d2l/home");
    });
    return {
      orgUnitId,
      title: normalizeText(navCourseLink?.getAttribute("aria-label") || navCourseLink?.textContent || document.title),
      pageTitle: document.title,
      url: window.location.href
    };
  }

  Object.assign(content, { getOrgUnitId, classifyPage, getCourse });
})();
