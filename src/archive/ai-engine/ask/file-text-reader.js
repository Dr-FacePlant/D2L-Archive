// Reads the text inside course files so Ask can search them: PDFs through the bundled
// pdf.js, Word files through the bundled zip reader, PowerPoint and Excel files through
// the PDF D2L made of them, and D2L pages and plain text as they are. Files come only
// from D2L, the way the file viewer gets them, one at a time; nothing is sent anywhere.
// What each file held is kept (file-text-store.js), so a file is read only once.
(function initDashboardAskFileTextReader(global) {
  const dash = global.D2LDashboard ||= {};

  const MAX_BYTES = 15 * 1024 * 1024;
  // Enough for any syllabus or handout; a whole textbook would crowd out everything else.
  const MAX_CHARS = 60000;
  // A PDF with fewer letters than this per page is pictures of pages: a scan.
  const SCAN_LETTERS_PER_PAGE = 20;
  const PDFJS = "src/vendor/pdfjs";
  const ATTACHMENTS = { assignmentAttachment: ["assignment", "dropboxFolderId"], announcementAttachment: ["announcement", "newsItemId"], contentAttachment: ["resource", "contentObjectId"] };
  // D2L's answers worth trying again later: signed out here, or no connection.
  const LATER = new Set(["signed-out", "offline", "no-answer"]);
  const KIND_WHAT = { image: "picture", video: "video", audio: "recording" };

  // Every course file the archive names, once each: Content topics that are files, and
  // files attached to assignments, announcements and topics. owner is the item it belongs to.
  function courseFiles(entities = [], evidence = [], byId = new Map()) {
    const files = new Map();
    const add = (file) => { if (!files.has(file.url)) files.set(file.url, file); };
    for (const entity of entities) {
      if (entity.entityType !== "learningResource" || entity.isModule || !dash.isTopicFileUrl(entity.urls?.download)) continue;
      add({ url: entity.urls.download, name: entity.canonicalTitle || "File", courseId: entity.courseId, ownerId: entity.entityId, owner: entity.canonicalTitle || "", size: 0 });
    }
    for (const record of evidence) {
      const [kind, idName] = ATTACHMENTS[record.source] || [];
      if (!kind || !dash.isD2lFileUrl(record.urls?.download)) continue;
      const ownerId = record.platformIds?.[idName] ? `${kind}:${record.courseId}:${record.platformIds[idName]}` : "";
      add({ url: record.urls.download, name: record.title || "File", courseId: record.courseId, ownerId, owner: byId.get(ownerId)?.canonicalTitle || "", size: Number(record.size) || 0 });
    }
    return [...files.values()];
  }

  // A library that won't load stops the whole reading: no file could be read with it.
  const stopAll = (what) => (error) => { throw Object.assign(new Error(`${what} couldn't be loaded: ${error?.message || error}`), { stopAll: true }); };

  let pdfLibrary = null;
  function pdfJs() {
    pdfLibrary ||= import(chrome.runtime.getURL(`${PDFJS}/pdf.min.mjs`)).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(`${PDFJS}/pdf.worker.min.mjs`);
      return lib;
    }).catch((error) => { pdfLibrary = null; throw error; });
    return pdfLibrary.catch(stopAll("The PDF reader"));
  }

  const tidy = (text) => text.replace(/[ \t\u00a0]+/g, " ").replace(/ *\n[\n ]*/g, "\n").trim();
  const letters = (text) => (text.match(/[\p{L}\p{N}]/gu) || []).length;
  const kept = (text) => {
    const clean = tidy(text);
    return clean.length > MAX_CHARS ? { text: clean.slice(0, MAX_CHARS), cut: true } : { text: clean };
  };

  // A PDF's text, page by page, until there's enough. No script in the file is run.
  async function pdfRecord(blob) {
    const lib = await pdfJs();
    const task = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, disableFontFace: true, verbosity: 0 });
    try {
      const doc = await task.promise;
      const pages = [];
      let length = 0;
      for (let n = 1; n <= doc.numPages && length < MAX_CHARS; n += 1) {
        const page = await doc.getPage(n);
        const { items } = await page.getTextContent();
        const text = items.map((item) => `${item.str ?? ""}${item.hasEOL ? "\n" : ""}`).join("");
        page.cleanup();
        pages.push(text);
        length += text.length;
      }
      const text = pages.join("\n");
      if (letters(text) < SCAN_LETTERS_PER_PAGE * Math.max(pages.length, 1)) return { state: "scan", pages: doc.numPages };
      return { state: "read", pages: doc.numPages, ...kept(text), pageText: pages };
    } finally {
      await task.destroy();
    }
  }

  const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };
  const unescapeXml = (text) => text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|amp|quot|apos));/gi,
    (_, hex, dec, name) => (name ? ENTITIES[name.toLowerCase()] : String.fromCodePoint(parseInt(hex || dec, hex ? 16 : 10))));

  // A Word file's text: its paragraphs, tabs and line breaks, from word/document.xml.
  async function docxText(blob) {
    const JSZip = await dash.previewFormats.zipLibrary().catch(stopAll("The zip reader"));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file("word/document.xml")?.async("string") || "";
    return unescapeXml(xml.replace(/<w:tab\b[^>]*\/>/g, "\t").replace(/<w:(?:br|cr)\b[^>]*\/>|<\/w:p>/g, "\n").replace(/<[^>]+>/g, ""));
  }

  // A D2L page's words: not its scripts or styles, and with the characters plainText leaves as codes.
  const NAMED = { ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", bull: "•" };
  const pageText = (html) => dash.plainText(String(html).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/&(?:#x([0-9a-f]+)|(ndash|mdash|lsquo|rsquo|ldquo|rdquo|hellip|bull));/gi, (_, hex, name) => (name ? NAMED[name.toLowerCase()] : String.fromCodePoint(parseInt(hex, 16)))));

  const textRecord = (text) => (letters(text) ? { state: "read", ...kept(text) } : { state: "empty" });

  // What one file holds: { state: read | scan | empty | too-large | unsupported | unavailable | failed, ... },
  // or { state: signed-out | offline | no-answer } when D2L can't be asked now; those aren't kept.
  async function readFileText(file) {
    if (file.size > MAX_BYTES) return { state: "too-large", size: file.size };
    const got = await dash.appModules.fileFromD2l(file.url, { keep: false });
    if (!got) return { state: "unavailable", reason: "not-file" };
    if (!got.blob) return LATER.has(got.reason) ? { state: got.reason } : got.reason === "too-large" ? { state: "too-large", size: got.size || 0 } : { state: "unavailable", reason: got.reason || "http" };
    if (got.blob.size > MAX_BYTES) return { state: "too-large", size: got.blob.size };
    try {
      const format = await dash.previewFormats.identify(got.blob, file.name);
      if (format.kind === "pdf") return await pdfRecord(got.blob);
      if (format.kind === "docx") return textRecord(await docxText(got.blob));
      if (format.kind === "page") return textRecord(pageText(format.html));
      if (format.kind === "text") return textRecord(await got.blob.text());
      // PowerPoint, Excel and older Office files: the PDF D2L made of them, when it has one.
      const pdf = format.kind === "unsupported" && format.type !== "application/zip" && await dash.appModules.pdfFromD2l(file.url, { keep: false }).catch(() => null);
      if (pdf) return await pdfRecord(pdf);
      return { state: "unsupported", what: KIND_WHAT[format.kind] || "file" };
    } catch (error) {
      if (error?.stopAll) throw error;
      return { state: "failed" };
    }
  }

  // Reads the files not read before, one at a time, keeping each as it is read. known maps
  // a file's address to what was kept; it gains each new record. Stops early when signal
  // is aborted, or at the first file D2L won't hand over for now (signed out, offline).
  // onProgress({ done, total, name }) after each file.
  async function readCourseFiles({ files, known, keep, onProgress = () => {}, signal } = {}) {
    const todo = files.filter((file) => !known.has(file.url));
    let done = 0;
    for (const file of todo) {
      if (signal?.aborted) return { state: "stopped", done, total: todo.length };
      const record = await readFileText(file);
      if (LATER.has(record.state)) return { state: record.state, done, total: todo.length };
      const full = { ...record, name: file.name, readAt: new Date().toISOString() };
      known.set(file.url, full);
      await keep(file.url, full);
      done += 1;
      onProgress({ done, total: todo.length, name: file.name });
    }
    return { state: "done", done, total: todo.length };
  }

  // The files' text as search passages input: one per file that was read.
  function filePassages(files, known) {
    return files.filter((file) => known.get(file.url)?.state === "read")
      .map((file) => ({ key: file.url, courseId: file.courseId, title: file.name, partOf: file.owner === file.name ? "" : file.owner, ownerId: file.ownerId, text: known.get(file.url).text }));
  }

  Object.assign(dash, { askCourseFiles: courseFiles, askReadFileText: readFileText, askReadCourseFiles: readCourseFiles, askFilePassages: filePassages, ASK_FILE_MAX_BYTES: MAX_BYTES });
})(globalThis);
