// File preview for archived and D2L files.
(function initDashboardAppPreview(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { escapeRegex, state } = dash.appModules;
  // ------------------------------------------------------- file preview
  // Previews load the file from D2L (you're signed in there) and keep a copy in
  // this browser, so opening it again is instant and works without D2L. The
  // copy sync saved in Downloads is the fallback; Chrome only lets an extension
  // read that when "Allow access to file URLs" is on. When neither works, the
  // viewer says why: signed out, missing, no access, too big, or offline.

  // The preview cache keeps files up to this size.
  const PREVIEW_LIMIT = 100 * 1024 * 1024;

  // After the extension is reloaded or updated, a page opened before that can
  // no longer reach it until the page is reloaded.
  function extensionAlive() {
    try { return Boolean(chrome.runtime?.id); } catch { return false; }
  }

  function fileUrlOf(filename) {
    const clean = String(filename).replace(/\\/g, "/");
    return `file://${clean.startsWith("/") ? "" : "/"}${clean.split("/").map(encodeURIComponent).join("/").replace(/^\/([A-Za-z])%3A/, "/$1:")}`;
  }

  function readLocalFile(filename) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("GET", fileUrlOf(filename));
      request.responseType = "blob";
      request.onload = () => request.response ? resolve(request.response) : reject(new Error("empty file"));
      request.onerror = () => reject(new Error("read failed"));
      request.send();
    });
  }

  function isD2lFileUrl(url) {
    return dash.isD2lFileUrl(url);
  }

  function blobFromDataUrl(dataUrl, type) {
    const bytes = atob(String(dataUrl).slice(String(dataUrl).indexOf(",") + 1));
    const buffer = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i);
    return new Blob([buffer], { type: type || "" });
  }

  // The extension may load D2L files itself. If D2L answers with a page (not
  // signed in here), the background loads it inside an open D2L tab instead.
  // Saved previews belong to the bound account; the legacy owner also inherits older, unscoped ones.
  function fileScope() {
    return { accountId: state.account.id, adoptLegacy: Boolean(state.account.id) && state.account.id === state.account.legacyOwnerId };
  }

  // Why D2L didn't hand over a file, from its answer. D2L sends its sign-in
  // page (a web page) when you're signed out. The background's copy of this
  // check runs inside a D2L tab.
  function d2lRefusal(response) {
    if (/\/d2l\/login/i.test(response.url || "") || response.status === 401) return "signed-out";
    if (response.status === 404) return "not-found";
    if (response.status === 403) return "no-access";
    if (!response.ok) return "http";
    return /text\/html/i.test(response.headers.get("content-type") || "") ? "not-file" : "";
  }

  async function fetchFromD2l(url) {
    let response;
    // D2L's PDF store lets any page read its signed links, but only without
    // cookies; D2L itself needs them.
    const credentials = url.startsWith(`${dash.D2L_ORIGIN}/`) ? "include" : "omit";
    try { response = await fetch(url, { credentials }); }
    catch { return { reason: navigator.onLine === false ? "offline" : "no-answer" }; }
    const reason = d2lRefusal(response);
    if (reason) return { reason, status: response.status };
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > PREVIEW_LIMIT) return { reason: "too-large", size: declared, limit: PREVIEW_LIMIT };
    const blob = await response.blob();
    return blob.size > PREVIEW_LIMIT ? { reason: "too-large", size: blob.size, limit: PREVIEW_LIMIT } : { blob };
  }

  function keptFile(key) {
    return dash.fileCache?.getFile(fileScope(), key).catch(() => null);
  }

  // { blob } or { reason, ... }; null when the address isn't a D2L file.
  async function fileFromD2l(url) {
    if (!isD2lFileUrl(url)) return null;
    const cached = await keptFile(url);
    return cached ? { blob: cached } : d2lFile(url, url);
  }

  // A file from D2L, kept under key so opening it again is instant.
  async function d2lFile(url, key) {
    let got = await fetchFromD2l(url);
    // Signed out here can still be signed in on a D2L tab, so try there. A
    // missing or too-big file is the same everywhere.
    if (!got.blob && !["not-found", "too-large", "offline"].includes(got.reason)) {
      const reply = await chrome.runtime.sendMessage({ type: "D2L_FETCH_FILE", url }).catch(() => null);
      if (reply?.ok && reply.dataUrl) got = { blob: blobFromDataUrl(reply.dataUrl, reply.type) };
      // With no D2L tab open, what this page heard is the better clue.
      else if (reply?.reason && reply.reason !== "no-tab") got = { reason: reply.reason, status: reply.status, size: reply.size, limit: reply.limit };
    }
    if (got.blob) dash.fileCache?.keepFile(fileScope(), key, got.blob).catch(() => {});
    return got;
  }

  // A topic's D2L page, as text, or "" when D2L won't show it.
  async function pageFromD2l(url) {
    const response = await fetch(url, { credentials: "include" }).catch(() => null);
    if (response && d2lRefusal(response) === "not-file") return response.text();
    const reply = await chrome.runtime.sendMessage({ type: "D2L_FETCH_FILE", url, page: true }).catch(() => null);
    return reply?.ok && typeof reply.html === "string" ? reply.html : "";
  }

  // Where the viewer on a topic's D2L page gets its PDF once the page is open
  // and D2L's own script has asked for it. The background opens the page out
  // of sight in a D2L tab. "" when it can't.
  async function openedPagePdf(page) {
    const reply = await chrome.runtime.sendMessage({ type: "D2L_VIEWER_PDF", url: page }).catch(() => null);
    return reply?.ok ? dash.previewFormats.pdfAddress(reply.location) : "";
  }

  // D2L shows a PowerPoint or Excel file as a PDF it made. The topic's D2L
  // page says where that PDF is, in the page itself or once the page is open.
  // null when there isn't one.
  async function pdfFromD2l(downloadUrl) {
    const parts = dash.isTopicFileUrl(downloadUrl) && /^(.*\/content\/\d+)\/topics\/files\/download\/(\d+)\//i.exec(downloadUrl);
    if (!parts) return null;
    const key = `${downloadUrl}#pdf`;
    let blob = await keptFile(key);
    if (!blob) {
      const page = `${parts[1]}/viewContent/${parts[2]}/View`;
      const source = dash.previewFormats.pdfSource(await pageFromD2l(page));
      const where = source?.url || (source?.later ? await openedPagePdf(page) : "");
      blob = where ? (await d2lFile(where, key)).blob : null;
    }
    return blob && (await dash.previewFormats.identify(blob)).kind === "pdf" ? blob : null;
  }

  // A shown file's addresses are let go when it closes.
  function release(view) {
    for (const url of [view?.src, view?.pdf]) if (url) URL.revokeObjectURL(url);
  }

  // { blob } for the saved copy, or why it can't be read: "missing", "access".
  async function fileFromComputer(localPath) {
    const [item] = localPath
      ? await chrome.downloads.search({ filenameRegex: `${escapeRegex(localPath)}$`, exists: true, state: "complete", limit: 1 })
      : [];
    if (!item) return { reason: "missing" };
    const allowed = await new Promise((resolve) => {
      try { chrome.extension.isAllowedFileSchemeAccess(resolve); } catch { resolve(false); }
    });
    return allowed ? { blob: await readLocalFile(item.filename) } : { reason: "access" };
  }

  function showPreview(view) {
    if (!state.preview) state.previewFocus = document.activeElement;
    state.preview = view;
    let node = document.getElementById("viewer");
    if (!node) {
      node = document.createElement("div");
      node.id = "viewer";
      document.body.append(node);
    }
    node.innerHTML = dash.filePreview(view);
    node.querySelector("[aria-label='Close preview']")?.focus();
  }

  function closePreview() {
    const focus = state.previewFocus;
    release(state.preview);
    state.preview = null;
    state.previewFocus = null;
    document.getElementById("viewer")?.remove();
    if (focus?.isConnected) focus.focus({ preventScroll: true });
  }

  // Loads a file for preview and says what to show: the file itself, or why
  // not. D2L comes first; the saved copy is the fallback. Any file that loads
  // can be downloaded, even one the viewer can't show.
  async function loadFile(base) {
    const fromD2l = await fileFromD2l(base.downloadUrl);
    const got = fromD2l?.blob ? fromD2l : base.localPath ? await fileFromComputer(base.localPath) : null;
    if (!got?.blob) {
      if (!fromD2l) return { state: got?.reason || "missing" };
      const { reason, status, size, limit } = fromD2l;
      return { state: reason, status, size, limit, hint: got?.reason === "access" ? "access" : "" };
    }
    const file = got.blob;
    const format = await dash.previewFormats.identify(file, base.localPath || base.name);
    const download = (blob, type) => {
      const typed = type && blob.type !== type ? new Blob([blob], { type }) : blob;
      return { mime: typed.type, src: URL.createObjectURL(typed) };
    };
    if (format.kind === "unsupported") {
      // The PDF D2L made shows; Download still saves the original file.
      const pdf = format.type !== "application/zip" && await pdfFromD2l(base.downloadUrl).catch(() => null);
      if (pdf) return { state: "ready", kind: "pdf", ...download(file, format.type), pdf: URL.createObjectURL(pdf) };
      return { state: "unsupported", label: format.label, ...download(file, format.type) };
    }
    if (format.kind === "page") return { state: "ready", kind: "page", html: dash.previewFormats.pageDocument(format.html), ...download(new Blob([format.html], { type: "text/html" })) };
    const ready = { state: "ready", kind: format.kind, ...download(file, format.type) };
    if (format.kind === "text") return { ...ready, text: (await file.text()).slice(0, 200000) };
    if (format.kind !== "docx") return ready;
    // D2L shows a Word file as the PDF it made, laid out as Word laid it out.
    // When its page has none, the bundled Word viewer draws the file instead.
    const pdf = await pdfFromD2l(base.downloadUrl).catch(() => null);
    if (pdf) return { ...ready, kind: "pdf", pdf: URL.createObjectURL(pdf) };
    try {
      return { ...ready, html: await dash.previewFormats.docxDocument(file) };
    } catch {
      return { ...ready, state: "unsupported", label: "This Word file" };
    }
  }

  function loadFailure(error) {
    return !extensionAlive() || /context invalidated/i.test(error?.message || "")
      ? { state: "stale" }
      : { state: "error", message: `The file couldn't be read: ${error.message}` };
  }

  async function previewFile(node) {
    const base = { name: node.dataset.name || "File", localPath: node.dataset.path || "", d2lUrl: node.dataset.d2l || "", downloadUrl: node.dataset.download || "" };
    if (!extensionAlive()) return showPreview({ ...base, state: "stale" });
    const ticket = previewFile.ticket = (previewFile.ticket || 0) + 1;
    showPreview({ ...base, state: "loading" });
    try {
      const shown = await loadFile(base);
      if (!state.preview || previewFile.ticket !== ticket) return release(shown);
      showPreview({ ...base, ...shown });
    } catch (error) {
      if (!state.preview || previewFile.ticket !== ticket) return;
      showPreview({ ...base, ...loadFailure(error) });
    }
  }

  // ------------------------------------------ side panel for Related items
  // A Work & grades or Content pill in Related items opens a panel over the
  // right half of the pop-up. Work and grades get a short summary. A content
  // topic shows its file when it can (a PDF, slides, an image, a video, plain text) and
  // otherwise says so, with Open in D2L. The arrows step through the pills that
  // open the panel, in the order they are on screen.

  function peekHost() {
    return document.getElementById("detail-root")?.querySelector(".detail-panel");
  }

  function peekPills() {
    return [...document.querySelectorAll(".related-card [data-action='peek-item']")];
  }

  function peekItem(pill) {
    try { return JSON.parse(pill.dataset.peek); } catch { return null; }
  }

  // What the panel can do with an item: summarize it, load its file, or only
  // describe it.
  function peekKind(item) {
    if (item.mode === "summary") return "summary";
    if (!item.external && (item.localPath || dash.isTopicFileUrl(item.downloadUrl))) return "file";
    return item.external ? "link" : "page";
  }

  function showPeek(view) {
    const host = peekHost();
    if (!host) return;
    release(state.peek?.view);
    state.peek = { ...state.peek, view };
    let node = document.getElementById("related-peek");
    const fresh = !node;
    const kept = node?.contains(document.activeElement) ? document.activeElement : null;
    if (fresh) {
      node = document.createElement("div");
      node.id = "related-peek";
      host.append(node);
      for (const part of host.children) if (part !== node) part.inert = true;
      node.style.top = `${host.querySelector(".detail-layer-head")?.offsetHeight || 54}px`;
      // Keep the one-time entrance running through a fast loading -> ready
      // update. The panel is marked open only after its slide-in completes.
      const markOpen = (event) => {
        if (event.target !== node.querySelector(".peek") || event.animationName !== "peekIn") return;
        node.classList.add("open");
        node.removeEventListener("animationend", markOpen);
      };
      node.addEventListener("animationend", markOpen);
    }
    const rendered = document.createElement("template");
    rendered.innerHTML = dash.relatedPeek(view);
    const nextPeek = rendered.content.querySelector(".peek");
    const currentPeek = node.querySelector(".peek");
    if (!fresh && currentPeek && nextPeek) {
      // Preserve the aside itself so a file finishing its load does not
      // cancel or restart the entrance animation.
      currentPeek.setAttribute("aria-label", nextPeek.getAttribute("aria-label") || "");
      currentPeek.replaceChildren(...nextPeek.childNodes);
    } else node.replaceChildren(rendered.content);
    peekPills().forEach((pill, at) => pill.classList.toggle("sel", at === view.at));
    const again = kept && node.querySelector(`[data-action="${kept.dataset.action}"][data-step="${kept.dataset.step}"]:not([disabled])`);
    // Focus without scrolling: the panel starts off the right edge, and a
    // scroll to reveal its button would cancel the slide.
    (again || node.querySelector("[aria-label='Close preview']"))?.focus({ preventScroll: true });
  }

  async function openPeekAt(at) {
    const pills = peekPills();
    const item = pills[at] && peekItem(pills[at]);
    if (!item) return;
    const ticket = state.peek.ticket = (state.peek.ticket || 0) + 1;
    const base = { ...item, at, count: pills.length };
    const kind = peekKind(item);
    if (kind !== "file") return showPeek({ ...base, state: kind });
    if (!extensionAlive()) return showPeek({ ...base, state: "stale" });
    showPeek({ ...base, state: "loading" });
    try {
      // The title is a label, not a file name, so only a saved copy's name is used to guess the type.
      const shown = await loadFile({ ...item, name: "" });
      if (state.peek?.ticket !== ticket) return release(shown);
      showPeek({ ...base, ...shown });
    } catch (error) {
      if (state.peek?.ticket === ticket) showPeek({ ...base, ...loadFailure(error) });
    }
  }

  function openPeek(pill) {
    if (!state.peek) state.peek = { focus: pill };
    return openPeekAt(peekPills().indexOf(pill));
  }

  function stepPeek(by) {
    const at = state.peek?.view?.at;
    if (at === undefined) return;
    return openPeekAt(at + by);
  }

  // The panel slides back out before it is removed. With no animation to wait
  // for (reduced motion, or the pop-up itself closing) it goes at once.
  function closePeek({ restoreFocus = true } = {}) {
    const current = state.peek;
    if (!current) return;
    state.peek = null;
    const node = document.getElementById("related-peek");
    const gone = () => {
      node?.remove();
      release(current.view);
    };
    const slides = restoreFocus && node && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (slides) {
      node.removeAttribute("id");
      node.classList.remove("open");
      node.classList.add("peek-leaving");
      node.addEventListener("animationend", gone, { once: true });
      setTimeout(gone, 400);
    } else gone();
    const host = peekHost();
    if (host) for (const part of host.children) part.inert = false;
    document.querySelectorAll(".related-card .rel-pill.sel").forEach((pill) => pill.classList.remove("sel"));
    if (restoreFocus && current.focus?.isConnected) current.focus.focus({ preventScroll: true });
  }

  Object.assign(mod, { extensionAlive, fileUrlOf, readLocalFile, isD2lFileUrl, blobFromDataUrl, fileScope, fetchFromD2l, fileFromD2l, pdfFromD2l, fileFromComputer, loadFile, showPreview, closePreview, previewFile, openPeek, stepPeek, closePeek, PREVIEW_LIMIT });
})(globalThis);
