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

  function compactLabelValueRows(text, labels) {
    const normalized = normalizeText(text);
    const out = {};
    for (const label of labels) {
      const pattern = new RegExp(`\\b${label}\\b\\s*:?\\s*([^]+?)(?=\\s+(?:${labels.join("|")})\\b\\s*:?|$)`, "i");
      const value = normalized.match(pattern)?.[1]?.trim();
      if (value) out[label.replace(/\s+/g, "_").toLowerCase()] = value.slice(0, 800);
    }
    return out;
  }
  Object.assign(shared, { normalizeText, compactLabelValueRows, csvEscape, slug, createDataUrl });
})();
