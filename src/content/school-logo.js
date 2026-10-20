// Copies the school's own logo from the D2L header so the dashboard corner can
// show it. Every Brightspace school renders its logo in the same header
// element, so this works for any university. Runs in the top frame only,
// reads the image the page already shows, and never changes anything in D2L.
(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { queryOne, absoluteUrl } = content;
  const STORAGE_KEY = "schoolLogo";
  const MAX_BYTES = 400 * 1024;
  const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
  // Brightspace has shipped this element under both names; KSU (2026-09)
  // renders <d2l-labs-navigation-link-image class="d2l-navigation-s-logo" src>.
  const LOGO_SELECTORS = [
    ".d2l-navigation-s-logo[src]",
    "d2l-labs-navigation-link-image[src]",
    "d2l-navigation-link-image[src]"
  ];

  function findSchoolLogo(find = queryOne) {
    for (const selector of LOGO_SELECTORS) {
      const node = find(selector);
      const src = node?.getAttribute?.("src");
      if (!src) continue;
      const titleSchool = String(globalThis.document?.title || "").split(" - ").slice(1).join(" - ");
      const alt = node.getAttribute("text") || node.getAttribute("alt") || node.getAttribute("title") || titleSchool || "";
      return { sourceUrl: absoluteUrl(src), alt: String(alt).trim() };
    }
    return null;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function captureSchoolLogo({ find = queryOne, fetchImpl = globalThis.fetch, storage, toDataUrl = blobToDataUrl, now = () => new Date() } = {}) {
    const found = findSchoolLogo(find);
    if (!found || !storage) return null;
    const capturedAt = now();
    const saved = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
    const fresh = saved?.sourceUrl === found.sourceUrl && capturedAt.getTime() - Date.parse(saved.capturedAt || 0) < REFRESH_MS;
    if (fresh) return saved;
    const response = await fetchImpl(found.sourceUrl, { credentials: "include" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!/^image\//.test(blob.type) || blob.size > MAX_BYTES) return null;
    const record = {
      dataUrl: await toDataUrl(blob),
      alt: found.alt,
      sourceUrl: found.sourceUrl,
      origin: new URL(found.sourceUrl).origin,
      capturedAt: capturedAt.toISOString()
    };
    await storage.set({ [STORAGE_KEY]: record });
    return record;
  }

  // The header is a web component that can paint late, so look a few times.
  function scheduleCapture() {
    const storage = globalThis.chrome?.storage?.local;
    if (!storage || globalThis.window?.top !== globalThis.window?.self) return;
    // Status shows on <html data-d2l-extractor-school-logo> for checking.
    const mark = (value) => { try { document.documentElement.setAttribute("data-d2l-extractor-school-logo", value); } catch {} };
    let tries = 0;
    const attempt = () => {
      tries += 1;
      if (findSchoolLogo()) {
        captureSchoolLogo({ storage })
          .then((record) => mark(record ? `saved ${record.capturedAt}` : "rejected"))
          .catch((error) => mark(`failed: ${error?.message || error}`));
      } else if (tries < 6) {
        setTimeout(attempt, 1500);
      } else {
        mark("not-found");
      }
    };
    setTimeout(attempt, 800);
  }

  Object.assign(content, { findSchoolLogo, captureSchoolLogo, SCHOOL_LOGO_KEY: STORAGE_KEY });
  scheduleCapture();
})();
