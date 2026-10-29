// File formats the viewer can show, and how each becomes something a frame
// can display. PDFs, pictures, video, audio and plain text show as they are.
// A page made in D2L arrives as a .zip holding one .html file; it shows in a
// sandboxed frame with no scripts. A Word (.docx) file is turned into a page
// by the bundled docx-preview library, unless D2L has made a PDF of it. A
// PowerPoint or Excel file shows as the PDF D2L made of it, when D2L has one.
// Everything else is named, so the viewer can say what it is and offer
// Download and Open in D2L.
(function initDashboardPreviewFormats(global) {
  const dash = global.D2LDashboard ||= {};

  const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  // [file name or type, kind, the type the frame needs]
  const BY_NAME = [
    [/\.pdf$/i, "pdf", "application/pdf"],
    [/\.(png|jpe?g|gif|webp|bmp)$/i, "image", ""],
    [/\.svg$/i, "image", "image/svg+xml"],
    [/\.(mp4|m4v|webm|mov)$/i, "video", ""],
    [/\.(mp3|m4a|wav|ogg)$/i, "audio", ""],
    [/\.(txt|csv|md|json)$/i, "text", "text/plain"],
    [/\.html?$/i, "page", "text/html"]
  ];
  const BY_TYPE = [
    [/^application\/pdf/i, "pdf", "application/pdf"],
    [/^image\//i, "image", ""],
    [/^video\//i, "video", ""],
    [/^audio\//i, "audio", ""],
    [/^text\/(plain|csv|markdown)|^application\/json/i, "text", "text/plain"]
  ];
  // What a file the viewer can't show is called, by name or type.
  const UNSHOWN = [
    [/\.(pptx?|ppsx?)$|presentationml|ms-powerpoint/i, "PowerPoint files"],
    [/\.(xlsx?|xlsm)$|spreadsheetml|ms-excel/i, "Excel files"],
    [/\.doc$|msword/i, "Older Word files (.doc)"],
    [/\.(odt|ods|odp)$|opendocument/i, "OpenDocument files"],
    [/\.(pages|numbers|key)$/i, "Apple Pages, Numbers and Keynote files"],
    [/\.(zip|rar|7z)$|^application\/(x-)?zip/i, "Zip folders"]
  ];

  function unshown(name, type, fallback = "") {
    const hit = UNSHOWN.find(([pattern]) => pattern.test(name) || pattern.test(type));
    return { kind: "unsupported", label: hit ? hit[1] : fallback };
  }

  // The first bytes say more than a name or a type: D2L often sends neither.
  async function magic(blob) {
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    const starts = (...bytes) => bytes.every((byte, at) => head[at] === byte);
    if (starts(0x25, 0x50, 0x44, 0x46)) return "pdf";
    if (starts(0x50, 0x4b, 0x03, 0x04)) return "zip";
    if (starts(0xd0, 0xcf, 0x11, 0xe0)) return "office97";
    return "";
  }

  // The libraries load only when a .zip or Word file is opened.
  const scripts = new Map();
  function library(file, name) {
    if (global[name]) return Promise.resolve(global[name]);
    if (!scripts.has(file)) {
      scripts.set(file, new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `src/vendor/${file}`;
        script.onload = () => global[name] ? resolve(global[name]) : reject(new Error(`${file} didn't start.`));
        script.onerror = () => {
          scripts.delete(file);
          reject(new Error(`${file} couldn't be loaded.`));
        };
        document.head.append(script);
      }));
    }
    return scripts.get(file);
  }
  const zipLibrary = () => library("jszip.min.js", "JSZip");
  const docxLibrary = () => zipLibrary().then(() => library("docx-preview.min.js", "docx"));

  // A .zip is a Word, PowerPoint or Excel file, a D2L page, or a real folder.
  async function inZip(blob) {
    const zip = await (await zipLibrary()).loadAsync(await blob.arrayBuffer());
    if (zip.file("word/document.xml")) return { kind: "docx", type: DOCX_TYPE };
    if (zip.file("ppt/presentation.xml")) return { ...unshown(".pptx", ""), type: PPTX_TYPE };
    if (zip.file("xl/workbook.xml")) return { ...unshown(".xlsx", ""), type: XLSX_TYPE };
    const page = Object.values(zip.files).find((entry) => !entry.dir && /\.html?$/i.test(entry.name));
    if (page) return { kind: "page", html: await page.async("string") };
    return { ...unshown(".zip", ""), type: "application/zip" };
  }

  // What a loaded file is: { kind, type } plus { html } for a page or
  // { label } for a file the viewer can't show.
  async function identify(blob, name = "") {
    const start = await magic(blob);
    if (start === "pdf") return { kind: "pdf", type: "application/pdf" };
    if (start === "zip") return inZip(blob);
    if (start === "office97") return unshown(name, blob.type, "Older Office files (.doc, .ppt, .xls)");
    const known = BY_NAME.find(([pattern]) => pattern.test(name)) || BY_TYPE.find(([pattern]) => pattern.test(blob.type || ""));
    if (known?.[1] === "page") return { kind: "page", html: await blob.text() };
    if (known) return { kind: known[1], type: known[2] };
    return unshown(name, blob.type || "");
  }

  const EMBED_NOTE = `<p class="archive-embed">A video or tool goes here. It only plays in D2L, so use Open in D2L to see it.</p>`;
  const PAGE_STYLE = "body{margin:0;padding:24px 28px;background:#fff;color:#1f2328;font:15px/1.6 system-ui,sans-serif}img,video{max-width:100%;height:auto}table{max-width:100%}.archive-embed{margin:12px 0;padding:14px 16px;border:1px dashed #b8bec6;border-radius:8px;background:#f6f8fa;color:#57606a;font:14px/1.5 system-ui,sans-serif}";

  // A D2L page on its own: its links point at D2L and open in a new tab, and
  // an embedded video or tool becomes a note, since it needs D2L to play.
  // The frame it shows in runs no scripts.
  function pageDocument(html) {
    const head = `<base href="${dash.D2L_ORIGIN}/" target="_blank"><style>${PAGE_STYLE}</style>`;
    const page = String(html).replace(/<iframe\b[^>]*>(?:[\s\S]*?<\/iframe>)?/gi, EMBED_NOTE);
    return /<head\b[^>]*>/i.test(page)
      ? page.replace(/<head\b[^>]*>/i, (tag) => `${tag}${head}`)
      : `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${page}</body></html>`;
  }

  // A Word file as a page. Pictures are kept inside the page, since the
  // sandboxed frame can't read this page's file addresses.
  async function docxDocument(blob) {
    const docx = await docxLibrary();
    const body = document.createElement("div");
    const styles = document.createElement("div");
    await docx.renderAsync(blob, body, styles, { useBase64URL: true, experimental: false, ignoreLastRenderedPageBreak: true });
    return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0}.docx-wrapper{background:#eef0f2!important}</style>${styles.innerHTML}</head><body>${body.innerHTML}</body></html>`;
  }

  // An address from a D2L page, made whole; "" unless it's on D2L.
  function d2lAddress(where) {
    if (!where) return "";
    try {
      const url = new URL(String(where).replace(/&amp;/g, "&"), `${dash.D2L_ORIGIN}/`);
      return url.origin === dash.D2L_ORIGIN ? url.href : "";
    } catch {
      return "";
    }
  }

  // D2L keeps the PDFs it makes of Office files in its own store on Amazon S3,
  // e.g. d2l-docbuilder-prod-us-east-1-converted.s3.us-east-1.amazonaws.com,
  // behind a short-lived signed link.
  const PDF_STORE = /^d2l-docbuilder-[a-z0-9-]+\.s3\.[a-z0-9-]+\.amazonaws\.com$/;

  // Where a topic page's viewer gets its PDF: on D2L or in D2L's PDF store.
  function pdfAddress(where) {
    const onD2l = d2lAddress(where);
    if (onD2l || !where) return onD2l;
    try {
      const url = new URL(String(where).replace(/&amp;/g, "&"));
      return url.protocol === "https:" && PDF_STORE.test(url.hostname) ? url.href : "";
    } catch {
      return "";
    }
  }

  // D2L turns PowerPoint, Excel and other Office files into a PDF, and its
  // topic page shows that PDF in its file viewer. { url } when the page names
  // the PDF. { later: true } when its PDF viewer doesn't say where yet: D2L's
  // script on the page (D2L.LP.FileViewerRenders.DocumentToPdf) asks D2L for
  // the PDF after the page opens, and only then does the viewer say. null
  // when the page shows no PDF.
  function pdfSource(html) {
    const page = String(html || "");
    const viewer = /<[a-z][^>]*\bclass="[^"]*\bd2l-fileviewer-pdf[^"]*"[^>]*>/i.exec(page)?.[0] || "";
    const url = pdfAddress(/\bdata-location="([^"]+)"/i.exec(viewer)?.[1]);
    if (url) return { url };
    return viewer || /\bclass="[^"]*\bd2l-documentToPdfViewer\b/.test(page) ? { later: true } : null;
  }

  dash.previewFormats = Object.freeze({ identify, pageDocument, docxDocument, pdfSource, pdfAddress, d2lAddress, DOCX_TYPE });
})(globalThis);
