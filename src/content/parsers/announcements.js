(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;
  const { queryAll, absoluteUrl, isExternalResourceUrl, headingText, pageText, getOrgUnitId, looksLikeFileUrl } = content;

  function extractAnnouncements() {
    return queryAll("a[href*='/d2l/le/news/'], a[href*='/d2l/lms/news/']")
      .map((link) => {
        const container = link.closest("li, tr, article, div");
        const text = normalizeText(container?.textContent || link.textContent);
        return {
          source: "announcement",
          title: normalizeText(link.textContent || link.getAttribute("aria-label")),
          description: text,
          url: absoluteUrl(link.getAttribute("href")),
          postedAtText: text.match(/Posted [A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M/)?.[0] || null
        };
      })
      .filter((item) => item.title);
  }

  function extractAnnouncementDetail() {
    const text = pageText();
    const title = headingText(1) || document.title;
    const newsItemId = window.location.href.match(/\/news\/\d+\/(\d+)\/view/i)?.[1]
      || window.location.href.match(/[?&](?:newsId|nid)=(\d+)/i)?.[1]
      || window.location.href.match(/\/news\/(\d+)(?:[/?#]|$)/i)?.[1]
      || "";
    const attachments = queryAll([
      "a[href*='news'][href*='attachments']", "a[href*='download']", "a[href*='fileId=']",
      "a[href*='/files/']", "a[href*='/lp/file']", "a[href*='/lp/files']",
      "a[href*='/content/enforced/']", "a[href$='.pdf']", "a[href$='.doc']",
      "a[href$='.docx']", "a[href$='.ppt']", "a[href$='.pptx']", "a[href$='.xls']",
      "a[href$='.xlsx']", "a[href$='.csv']", "a[href$='.zip']"
    ].join(", ")).map((link) => {
      const href = absoluteUrl(link.getAttribute("href"));
      const label = normalizeText(link.textContent || link.getAttribute("aria-label") || link.title);
      if (!href || !label || !looksLikeFileUrl(href)) return null;
      return {
        source: "announcementAttachment",
        title: label,
        description: normalizeText(link.closest("li, tr, div")?.textContent || label),
        url: href,
        downloadUrl: href,
        suggestedFileName: label,
        columns: { recoveredFrom: "announcementDetailAttachmentLink" },
        ids: { courseOrgUnitId: getOrgUnitId(), newsItemId }
      };
    }).filter(Boolean);
    const attachmentUrls = new Set(attachments.map((item) => item.url));
    const detailLinks = queryAll("a[href]").map((link) => {
      const href = absoluteUrl(link.getAttribute("href"));
      const label = normalizeText(link.textContent || link.getAttribute("aria-label") || link.title);
      if (!href || !label || href.startsWith("javascript:") || attachmentUrls.has(href)) return null;
      if (/\/d2l\/(?:le|lms)\/news\/\d+\/\d+\/view/i.test(href)) return null;
      return {
        source: "announcementLink",
        title: label,
        description: normalizeText(link.closest("li, tr, p, div")?.textContent || label).slice(0, 1200),
        url: href,
        columns: { recoveredFrom: "announcementDetailLink", linkKind: isExternalResourceUrl(href) ? "external" : "internal" },
        ids: { courseOrgUnitId: getOrgUnitId(), newsItemId }
      };
    }).filter(Boolean).slice(0, 80);

    return [{
      source: "announcement",
      title: normalizeText(title),
      description: text.slice(0, 4000),
      url: window.location.href,
      columns: {
        recoveredFrom: "announcementDetailPage",
        postedAtText: text.match(/Posted [A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M/)?.[0] || "",
        attachmentCount: attachments.length,
        linkCount: detailLinks.length
      },
      ids: { courseOrgUnitId: getOrgUnitId(), newsItemId }
    }, ...attachments, ...detailLinks];
  }

  Object.assign(content, { extractAnnouncements, extractAnnouncementDetail });
})();
