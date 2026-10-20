(() => {
  const shared = globalThis.D2LExtractorShared ||= {};

  function normalizeText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function slug(value, fallback = "item") {
    const cleaned = normalizeText(value)
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90);
    return cleaned || fallback;
  }

  function createDataUrl(text, mimeType) {
    return `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`;
  }

  Object.assign(shared, { normalizeText, csvEscape, slug, createDataUrl });
})();
