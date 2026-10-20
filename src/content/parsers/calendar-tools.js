(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;
  const {
    queryAll,
    queryOne,
    absoluteUrl,
    looksLikeFileUrl,
    isExternalResourceUrl,
    linkRecord,
    getOrgUnitId,
    headingText,
    pageText,
    extractTableRows,
    discussionAttachmentRowFromLink,
    extractAnnouncements
  } = content;

function extractCalendar() {
  const detailMatch = window.location.href.match(/\/calendar\/\d+\/event\/(\d+)\/detailsview/);
  if (detailMatch) return extractCalendarEventDetail(detailMatch[1]);

  const eventLinks = queryAll("a[href*='/detailsview']").concat(
    queryAll("a").filter((link) => /View Event/i.test(link.getAttribute("aria-label") || link.textContent))
  );
  const seen = new Set();
  return eventLinks.filter((link) => {
    const href = link.getAttribute("href") || "";
    if (seen.has(href)) return false;
    seen.add(href);
    return true;
  }).map((link) => {
    const container = link.closest("li, tr, div");
    return {
      source: "calendarEvent",
      title: normalizeText(link.getAttribute("aria-label") || link.textContent).replace(/^View Event - /, ""),
      description: normalizeText(container?.textContent || link.textContent),
      url: absoluteUrl(link.getAttribute("href")),
      ids: { courseOrgUnitId: getOrgUnitId() }
    };
  });
}

function extractCalendarEventDetail(calendarEventId) {
  const heading = queryOne("h1, h2[class*='title'], [class*='EventTitle']");
  const bodyText = pageText();
  const title = normalizeText(heading?.textContent || document.title).replace(/^View Event - /, "");
  const attachments = queryAll("a[href]")
    .map((link) => {
      const href = absoluteUrl(link.getAttribute("href"));
      const label = normalizeText(link.textContent || link.getAttribute("aria-label") || link.title);
      if (!href || !label || !looksLikeFileUrl(href)) return null;
      return {
        source: "calendarAttachment",
        title: label,
        description: normalizeText(link.closest("li, tr, div, section")?.textContent || label).slice(0, 1200),
        url: href,
        downloadUrl: href,
        suggestedFileName: label,
        columns: {
          recoveredFrom: "calendarEventDetailLink",
          calendarEventTitle: title
        },
        ids: { courseOrgUnitId: getOrgUnitId(), calendarEventId }
      };
    })
    .filter(Boolean);

  return [{
    source: "calendarEvent",
    title,
    description: bodyText.slice(0, 600),
    url: window.location.href,
    dueAtText: bodyText.match(/[A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M/)?.[0] || null,
    columns: {
      attachmentCount: attachments.length
    },
    ids: { courseOrgUnitId: getOrgUnitId(), calendarEventId }
  }, ...attachments];
}

function extractGenericPage() {
  const headingItems = queryAll("h1, h2, h3, [role='heading']")
    .map((node) => ({
      source: "heading",
      title: normalizeText(node.textContent),
      description: normalizeText(node.parentElement?.textContent || node.textContent),
      ids: { courseOrgUnitId: getOrgUnitId() }
    }))
    .filter((item) => item.title);

  const tableItems = extractTableRows("tableRow");
  const usefulLinks = queryAll("a[href]")
    .map((link) => {
      const attachment = discussionAttachmentRowFromLink(link);
      if (attachment) return attachment;
      const href = absoluteUrl(link.getAttribute("href"));
      const external = isExternalResourceUrl(href);
      return {
        source: external ? "externalLink" : "link",
        title: normalizeText(link.textContent || link.getAttribute("aria-label")),
        url: href,
        description: normalizeText(link.closest("li, tr, div")?.textContent || link.textContent),
        columns: {
          linkKind: external ? "external" : "internal"
        },
        ids: { courseOrgUnitId: getOrgUnitId() }
      };
    })
    .filter((item) => item.title && item.url && !item.url.startsWith("javascript:"))
    .slice(0, 150);

  return [...headingItems, ...tableItems, ...usefulLinks];
}

function extractToolRows(source) {
  const tableRows = extractTableRows(source);
  const cardRows = queryAll("li, article, [role='listitem'], [class*='d2l-card'], [class*='item']")
    .map((node) => {
      const text = normalizeText(node.textContent || "");
      if (!text || text.length < 6) return null;
      const link = node.querySelector?.("a[href]");
      const url = absoluteUrl(link?.getAttribute("href"));
      const title = normalizeText(link?.textContent || node.querySelector?.("h1, h2, h3, [role='heading']")?.textContent || text.slice(0, 120));
      if (!title) return null;
      return {
        source: source === "courseLink" && isExternalResourceUrl(url) ? "externalLink" : source,
        title,
        description: text.slice(0, 2000),
        url,
        status: /complete|completed|done/i.test(text) ? "completed" : /not complete|incomplete|not started|available/i.test(text) ? "open" : "",
        dueAtText: text.match(/Due(?: on)?:?\s+[A-Z][a-z]{2,9}\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s+[AP]M)?/)?.[0] || "",
        availabilityText: text.match(/Available.*?(?=(Due|$))/i)?.[0] || "",
        columns: {
          linkKind: source === "courseLink" && isExternalResourceUrl(url) ? "external" : "internal"
        },
        ids: { courseOrgUnitId: getOrgUnitId() }
      };
    })
    .filter(Boolean);

  const seen = new Set();
  return [...tableRows, ...cardRows].filter((row) => {
    const key = `${row.source}:${row.title}:${row.url || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractToolPage(source, label) {
  const rows = extractToolRows(source);
  const text = pageText();
  const blocked = /not authorized|do not have permission|unavailable|not available|access denied|disabled/i.test(text);
  const empty = /No items found|No results|No checklists?|No surveys|No self assessments?|No groups|No attendance|There are no|nothing to display/i.test(text);
  const summary = {
    source: "courseToolPage",
    title: label || headingText(1) || document.title || source,
    description: text.slice(0, 2400),
    url: window.location.href,
    status: blocked ? "blockedOrUnavailable" : empty || rows.length === 0 ? "availableEmpty" : "itemsVisible",
    columns: {
      toolSource: source,
      itemCount: rows.length,
      emptyStateText: empty ? (text.match(/(?:No items found|No results|No checklists?|No surveys|No self assessments?|No groups|No attendance|There are no[^.]{0,160}|nothing to display[^.]{0,160})/i)?.[0] || "") : "",
      blockedText: blocked ? (text.match(/(?:not authorized|do not have permission|unavailable|not available|access denied|disabled)[^.]{0,160}/i)?.[0] || "") : ""
    },
    ids: { courseOrgUnitId: getOrgUnitId() }
  };
  return [summary, ...rows];
}


function extractCourseHome() {
  const navLinks = queryAll("a[href*='/d2l/']").map(linkRecord);
  const widgetHeadings = queryAll("h2, [role='heading'][aria-level='2']")
    .map((node) => ({
      source: "courseWidget",
      title: normalizeText(node.textContent),
      description: normalizeText(node.closest("section, article, div")?.textContent || node.textContent),
      ids: { courseOrgUnitId: getOrgUnitId() }
    }))
    .filter((item) => item.title);

  return [
    ...extractAnnouncements(),
    ...extractCalendar(),
    ...widgetHeadings,
    ...navLinks.map((link) => ({
      source: "courseNavOrLink",
      title: link.title || link.text,
      url: link.href,
      ids: { courseOrgUnitId: getOrgUnitId() }
    }))
  ];
}


  Object.assign(content, {
    extractCalendar,
    extractCalendarEventDetail,
    extractGenericPage,
    extractToolRows,
    extractToolPage,
    extractCourseHome
  });
})();
