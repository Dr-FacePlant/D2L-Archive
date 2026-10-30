// Textbook and link entries shown on a course page. The syllabus text is
// searched for a named textbook ("Required Text:", "Textbook:"), and every
// shelf entry can be filled or corrected by hand; manual edits are saved per
// D2L account, never sent anywhere.
(function initDashboardModelTextbooks(global) {
  const dash = global.D2LDashboard ||= {};

  const TITLE_LIMIT = 140;
  const META_LIMIT = 140;
  const COVER_LIMIT = 5000000;
  // An attached book file (PDF or EPUB) is kept inside the extension, so cap it.
  const FILE_BYTES_LIMIT = 25 * 1024 * 1024;
  const FILE_MIMES = ["application/pdf", "application/epub+zip"];
  const URL_LIMIT = 2000;
  const MAX_ENTRIES = 8;
  const MAX_LINKS = 4;
  const MAX_DETECTED = 3;
  // A link shows as a rounded app tile in one of these colours.
  const LINK_TONES = ["violet", "blue", "green", "yellow", "rose", "gray"];

  // The pale background each tone uses, so a course colour that is nearly one
  // of them can be spotted and not offered twice in the cover picker.
  const TONE_BACKGROUNDS = { violet: "#EDE9FE", blue: "#E4EEFE", green: "#E3F6EA", yellow: "#FEF6DA", rose: "#FDE8EC", gray: "#F1F3F6" };
  function toneMatchingTint(tint) {
    const hex = /#([0-9a-f]{6})/i.exec(String(tint || ""))?.[1];
    if (!hex) return "";
    const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const target = rgb(hex);
    let best = "";
    let bestDistance = 40;
    for (const [name, value] of Object.entries(TONE_BACKGROUNDS)) {
      const distance = Math.hypot(...rgb(value.slice(1)).map((n, i) => n - target[i]));
      if (distance < bestDistance) { best = name; bestDistance = distance; }
    }
    return best;
  }

  const clean = (value) => String(value ?? "").trim();
  const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  // Only web links are kept, so a pasted "javascript:" address can never
  // reach an href. A bare "website.com/page" (no scheme, a dot, no spaces)
  // is read as https; anything with another scheme is still refused.
  function safeLinkUrl(value) {
    let text = clean(value);
    if (!text || text.length > URL_LIMIT || UNSAFE_KEYS.has(text)) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && /^[^\s/?#]+\.[^\s/?#]{2,}(?:[/?#]\S*)?$/.test(text)) text = `https://${text}`;
    try {
      const url = new URL(text);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function safeCoverUrl(value) {
    const text = String(value ?? "");
    return /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(text) && text.length <= COVER_LIMIT ? text : "";
  }

  // A book's attached PDF/EPUB: {name, mime, dataUrl}, or null when it isn't one.
  function safeBookFile(file) {
    if (!file || typeof file !== "object" || Array.isArray(file)) return null;
    const mime = FILE_MIMES.find((one) => one === file.mime);
    const dataUrl = String(file.dataUrl ?? "");
    if (!mime || dataUrl.length > Math.ceil(FILE_BYTES_LIMIT * 4 / 3) + 100) return null;
    if (!dataUrl.startsWith(`data:${mime};base64,`) || !/^[A-Za-z0-9+/=]+$/.test(dataUrl.slice(dataUrl.indexOf(",") + 1))) return null;
    const fallback = mime === "application/pdf" ? "Textbook.pdf" : "Textbook.epub";
    return { name: clean(file.name).slice(0, TITLE_LIMIT) || fallback, mime, dataUrl };
  }

  function normalizeTextbookEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const title = clean(entry.title).slice(0, TITLE_LIMIT);
    if (!title) return null;
    const meta = clean(entry.meta).slice(0, META_LIMIT);
    const links = [];
    if (Array.isArray(entry.links)) {
      for (const link of entry.links) {
        if (links.length >= MAX_LINKS) break;
        if (!link || typeof link !== "object" || Array.isArray(link)) continue;
        const url = safeLinkUrl(link.url);
        if (!url) continue;
        links.push({ title: clean(link.title).slice(0, TITLE_LIMIT), url });
      }
    }
    const kind = entry.kind === "link" ? "link" : "book";
    const cover = safeCoverUrl(entry.cover);
    if (kind === "link") {
      return {
        kind,
        title,
        meta,
        cover,
        tone: LINK_TONES.includes(entry.tone) ? entry.tone : "violet",
        mark: entry.mark === "letter" ? "letter" : "",
        links: links.slice(0, 1)
      };
    }
    const file = safeBookFile(entry.file);
    return { kind, title, meta, cover, ...(LINK_TONES.includes(entry.tone) ? { tone: entry.tone } : {}), ...(file ? { file } : {}), links };
  }

  function normalizeTextbookEntries(input) {
    if (!Array.isArray(input)) return [];
    const entries = [];
    const seen = new Set();
    for (const entry of input) {
      if (entries.length >= MAX_ENTRIES) break;
      const one = normalizeTextbookEntry(entry);
      if (!one) continue;
      const key = `${one.title.toLowerCase()}|${one.links[0]?.url || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(one);
    }
    return entries;
  }

  // ----------------------------------------------------------- detection
  // A syllabus names its book as "Required Text: World of Art, 8th Edition",
  // "Textbook: ..." or "Text: ...". A capture that begins with the word
  // "book", "n/a" or "none" (or is empty) is skipped as a false match.
  // The captured fragment runs to a sentence period, semicolon or line end —
  // except a URL may carry its own periods, so a link printed beside the
  // title still lands in the fragment and is reclaimed into the links list.
  const TITLE_FRAGMENT = String.raw`((?:[^.;|\n]|https?:\/\/[^\s;"'<>()]+){5,140})`;
  const TEXTBOOK_PATTERN = new RegExp([
    String.raw`\b(?:required|optional|expected|need(?:ed)?|using)\s+(?:texts?|text\s*books?)\b[^.;|:\n]*?[:\-–—]\s*` + TITLE_FRAGMENT,
    String.raw`\btext\s*books?\b[^.;|:\n]*?[:\-–—]\s*` + TITLE_FRAGMENT,
    String.raw`\btexts?\b[^.;|:\n]{0,30}[:\-–—]\s*` + TITLE_FRAGMENT
  ].join("|"), "gi");
  const REJECTED_LEAD = /^(?:book|texts?\s*books?|n\s*\/?\s*a|none|unknown|see|includes?:|please|you|we|i|messages?|mails?|notifications?)\b/i;
  const ISBN_TAIL = /\b(?:ISBN(?:-1[03])?|isbn)\b[\s:]*[\dXx][\dXx\s\-–—]*$/i;
  const PRICE_TAIL = /\s*\$\s*\d[\d.,]*\s*(?:USD)?\b.*$/i;
  const EDITION_TAIL = /\b(\d{1,2})\s*(st|nd|rd|th)?\s*(?:ed(?:ition)?\b\.?,?\s*)$/i;
  const LINK_IN_TEXT = /https?:\/\/[^\s;"'<>()]+/g;

  function cleanTitle(fragment) {
    let text = clean(fragment).replace(/\s+/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'");
    text = text.replace(/\((?:required|optional)\)/gi, "").replace(/\s*\((?:buy|here)\)/gi, "");
    text = text.replace(PRICE_TAIL, "");
    if (ISBN_TAIL.test(text)) text = text.replace(ISBN_TAIL, "");
    text = text.replace(/[\s,;–\-—:]+$/, "");
    return text.trim();
  }

  function splitEdition(text) {
    const match = text.match(EDITION_TAIL);
    if (!match) return { title: text, meta: "" };
    const head = text.slice(0, match.index).replace(/[\s,;:–\-—]+$/, "");
    return { title: head || text, meta: `${match[1]}${match[2] || ""} ${/edition/i.test(match[0]) ? "edition" : "ed."}` };
  }

  function detectTextbooks(text) {
    // Entities are unescaped before the scan: "&amp;" must read as "&" and not
    // end a mid-title capture on its semicolon. URLs are swapped for tokens
    // with none of the excluded characters, so they can survive the title
    // capture that otherwise stops at every period.
    const raw = String(text || "").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'");
    const urls = [];
    const tokenized = raw.replace(new RegExp(LINK_IN_TEXT.source, "g"), (url) => `⟦U${urls.push(url.trimEnd()) - 1}⟧`);
    const reconstitute = (value) => value.replace(/⟦U(\d+)⟧/g, (_, i) => urls[Number(i)] ? urls[Number(i)].replace(/[.,)\]]+$/, "") : "");
    if (!raw) return [];
    const entries = [];
    TEXTBOOK_PATTERN.lastIndex = 0;
    let match;
    while ((match = TEXTBOOK_PATTERN.exec(tokenized)) !== null && entries.length < MAX_DETECTED) {
      for (const fragment of match.slice(1)) {
        if (!fragment) continue;
        let title = cleanTitle(fragment);
        title = reconstitute(title);
        const links = [...title.matchAll(new RegExp(LINK_IN_TEXT.source, "g"))].slice(0, 2).map((link) => {
          const url = safeLinkUrl(link[0]);
          title = url ? title.split(link[0])[0] : title;
          return url ? { title: "", url } : null;
        }).filter(Boolean);
        title = title.replace(/[\s,;:–\-—]+$/, "").trim();
        if (!title || REJECTED_LEAD.test(title)) continue;
        const split = splitEdition(title);
        entries.push(normalizeTextbookEntry({ title: split.title, meta: split.meta, cover: "", links }) || { title: split.title, meta: split.meta, cover: "", links: [] });
        if (entries.length >= MAX_DETECTED) break;
      }
    }
    return normalizeTextbookEntries(entries);
  }

  Object.assign(dash, {
    MAX_TEXTBOOK_ENTRIES: MAX_ENTRIES,
    TEXTBOOK_LINK_TONES: LINK_TONES,
    TEXTBOOK_FILE_BYTES_LIMIT: FILE_BYTES_LIMIT,
    normalizeTextbookEntry,
    normalizeTextbookEntries,
    parseTextbookMentions: detectTextbooks,
    safeLinkUrl,
    safeCoverUrl,
    safeBookFile,
    toneMatchingTint
  });
})(globalThis);
