(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;
  const { queryAll, queryOne, absoluteUrl, getOrgUnitId, looksLikeFileUrl } = content;

  function extractContent() {
    const topicLinks = queryAll("a[href*='/d2l/le/content/'][href*='/viewContent/']");
    const moduleLinks = queryAll("a").filter((link) => /module:|Incomplete activities|All tasks are completed/i.test(normalizeText(link.getAttribute("aria-label") || link.textContent)));
    const modules = moduleLinks.map((link) => ({
      source: "contentModule",
      title: normalizeText((link.getAttribute("aria-label") || link.textContent).split(" module:")[0]),
      description: normalizeText(link.getAttribute("aria-label") || link.textContent),
      url: absoluteUrl(link.getAttribute("href")),
      ids: { courseOrgUnitId: getOrgUnitId() }
    }));
    const topics = topicLinks.map((link) => {
      const href = link.getAttribute("href") || "";
      const contentObjectId = href.match(/\/viewContent\/(\d+)\/View/)?.[1] || null;
      const text = normalizeText(link.closest("li, tr, [id], div")?.textContent || link.textContent);
      return {
        source: "contentTopic",
        title: normalizeText(link.textContent || link.getAttribute("aria-label")),
        description: text,
        type: text.match(/PDF document|HTML document|Word document|PowerPoint|Video|File/i)?.[0] || null,
        url: absoluteUrl(href),
        status: /viewed/i.test(text) ? "viewed" : /Task: View/i.test(text) ? "notViewed" : null,
        ids: { courseOrgUnitId: getOrgUnitId(), contentObjectId }
      };
    });
    return modules.length || topics.length ? [...modules, ...topics] : extractContentViewer();
  }

  function extractContentViewer() {
    const viewContentMatch = window.location.href.match(/\/viewContent\/(\d+)\/View/);
    if (!viewContentMatch) return [];
    const title = normalizeText(queryOne("h1, h2[class*='title'], [class*='ContentTopicTitle']")?.textContent || document.title);
    const bodyText = normalizeText(queryOne("body")?.textContent || "");
    const type = bodyText.match(/PDF document|HTML document|Word document|PowerPoint|Video|File|External Resource/i)?.[0] || null;
    const lastVisitedMatch = bodyText.match(/Last Visited\s+([A-Za-z]+ \d{1,2}, \d{4})/);
    const iframeSrc = absoluteUrl(queryOne("iframe[src]")?.getAttribute("src"));
    const externalActionRaw = queryOne("[data-onclick]")?.getAttribute("data-onclick") || null;
    const contentObjectId = viewContentMatch[1];
    const attachments = queryAll("a[href]").map((link) => {
      const href = absoluteUrl(link.getAttribute("href"));
      const label = normalizeText(link.textContent || link.getAttribute("aria-label") || link.title);
      if (!href || !label || !looksLikeFileUrl(href)) return null;
      return {
        source: "contentAttachment",
        title: label,
        description: normalizeText(link.closest("li, tr, div, section, article")?.textContent || label).slice(0, 1200),
        url: href,
        downloadUrl: href,
        suggestedFileName: label,
        columns: { recoveredFrom: "contentViewerLink", contentTitle: title },
        ids: { courseOrgUnitId: getOrgUnitId(), contentObjectId }
      };
    }).filter(Boolean);
    return [{
      source: "contentTopic",
      title,
      description: bodyText.match(/Activity Details[\s\S]{0,120}/)?.[0] ? normalizeText(bodyText.match(/Activity Details[\s\S]{0,120}/)[0]) : title,
      type,
      url: iframeSrc || window.location.href,
      status: /you have viewed this topic/i.test(bodyText) ? "viewed" : /task: view/i.test(bodyText) ? "notViewed" : null,
      lastVisited: lastVisitedMatch ? lastVisitedMatch[1] : null,
      columns: { recoveredFrom: "contentViewerPage", ...(externalActionRaw ? { externalActionRaw } : {}), attachmentCount: attachments.length },
      ids: { courseOrgUnitId: getOrgUnitId(), contentObjectId }
    }, ...attachments];
  }

  Object.assign(content, { extractContent, extractContentViewer });
})();
