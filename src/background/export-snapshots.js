(function initExportSnapshotsModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, slug, pageKey } = shared;
  const { DOWNLOAD_MIME, downloadText } = background;

  function pageSnapshotMarkdown(pagePayload) {
    const page = pagePayload.page || {};
    const course = pagePayload.course || {};
    const requestedUrl = pagePayload.crawlTask?.requestedUrl || "";
    const redirected = requestedUrl && page.url && requestedUrl !== page.url;
    return [
      `# ${page.title || page.heading || "D2L Page"}`,
      "",
      `- URL: ${page.url || ""}`,
      redirected ? `- Requested URL (redirected away from): ${requestedUrl}` : null,
      `- Page type: ${pagePayload.pageType || ""}`,
      `- Course: ${course.title || ""}`,
      `- Course org unit: ${course.orgUnitId || ""}`,
      `- Extracted at: ${pagePayload.extractor?.extractedAt || ""}`,
      "",
      "## Text",
      "",
      page.text || ""
    ].filter((line) => line !== null).join("\n");
  }

  async function downloadPageSnapshots(pagePayloads, archiveRoot) {
    const byUrl = new Map();
    for (let index = 0; index < pagePayloads.length; index += 1) {
      const pagePayload = pagePayloads[index];
      const page = pagePayload.page || {};
      const key = pageKey(pagePayload);
      if (!key || byUrl.has(key)) continue;
      const courseId = pagePayload.course?.orgUnitId || "unknown";
      const courseTitle = pagePayload.course?.title || pagePayload.course?.pageTitle || "course";
      const courseFolder = slug(`${courseId}-${courseTitle}`, courseId);
      const fileName = `${String(index + 1).padStart(3, "0")}-${slug(`${pagePayload.pageType}-${page.title || page.heading}`, "page")}.md`;
      const localPath = `${archiveRoot}/courses/${courseFolder}/pages/${fileName}`;
      await downloadText(localPath, pageSnapshotMarkdown(pagePayload), DOWNLOAD_MIME.md, false);
      byUrl.set(key, localPath);
    }
    return byUrl;
  }

  function pageTextSnippetMap(pagePayloads) {
    const byUrl = new Map();
    for (const pagePayload of pagePayloads) {
      const key = pageKey(pagePayload);
      if (!key || byUrl.has(key)) continue;
      const text = normalizeText(pagePayload.page?.text || "");
      if (text) byUrl.set(key, text.slice(0, 1200));
    }
    return byUrl;
  }

  function dropRedirectedHomepageRows(rows, pagePayloads) {
    const junkPageUrls = new Set();
    for (const pagePayload of pagePayloads) {
      const requested = pagePayload.crawlTask?.requestedUrl || "";
      const final = pagePayload.page?.url || "";
      if (!requested || !final || requested === final) continue;
      if (/\/d2l\/home\/\d+/.test(final)) junkPageUrls.add(pageKey(pagePayload));
    }
    if (!junkPageUrls.size) return 0;

    let removed = 0;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (junkPageUrls.has(rows[index].pageUrl)) {
        rows.splice(index, 1);
        removed += 1;
      }
    }
    return removed;
  }

  Object.assign(background, {
    pageSnapshotMarkdown,
    downloadPageSnapshots,
    pageTextSnippetMap,
    dropRedirectedHomepageRows
  });
})(globalThis);
