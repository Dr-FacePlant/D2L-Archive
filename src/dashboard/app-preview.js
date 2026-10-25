// File preview for archived and D2L files.
(function initDashboardAppPreview(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { escapeRegex, state } = dash.appModules;
  // ------------------------------------------------------- file preview
  // Previews load the file from D2L (you're signed in there) and keep a copy in
  // this browser, so opening it again is instant and works without D2L. The
  // copy sync saved in Downloads is the fallback; Chrome only lets an extension
  // read that when "Allow access to file URLs" is on.

  const PREVIEW_KINDS = [
    [/\.pdf$/i, "pdf", "application/pdf"],
    [/\.(png|jpe?g|gif|webp|bmp)$/i, "image", ""],
    [/\.svg$/i, "image", "image/svg+xml"],
    [/\.(mp4|m4v|webm|mov)$/i, "video", ""],
    [/\.(mp3|m4a|wav|ogg)$/i, "audio", ""],
    [/\.(txt|csv|md|json)$/i, "text", "text/plain"]
  ];
  const PREVIEW_TYPES = [
    [/^application\/pdf/i, "pdf", "application/pdf"],
    [/^image\//i, "image", ""],
    [/^video\//i, "video", ""],
    [/^audio\//i, "audio", ""],
    [/^text\/(plain|csv|markdown)|^application\/json/i, "text", "text/plain"]
  ];

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
    return typeof url === "string" && url.startsWith(`${dash.D2L_ORIGIN}/d2l/`) && !/quickLink/i.test(url);
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

  async function fileFromD2l(url) {
    if (!isD2lFileUrl(url)) return null;
    const cached = await dash.fileCache?.getFile(fileScope(), url).catch(() => null);
    if (cached) return cached;
    let blob = await fetch(url, { credentials: "include" })
      .then((response) => response.ok && !/text\/html/i.test(response.headers.get("content-type") || "") ? response.blob() : null)
      .catch(() => null);
    if (!blob) {
      const reply = await chrome.runtime.sendMessage({ type: "D2L_FETCH_FILE", url }).catch(() => null);
      if (reply?.ok && reply.dataUrl) blob = blobFromDataUrl(reply.dataUrl, reply.type);
    }
    if (blob) dash.fileCache?.keepFile(fileScope(), url, blob).catch(() => {});
    return blob;
  }

  // Returns the saved copy, or the reason it can't be shown ("missing", "access").
  async function fileFromComputer(localPath) {
    const [item] = localPath
      ? await chrome.downloads.search({ filenameRegex: `${escapeRegex(localPath)}$`, exists: true, state: "complete", limit: 1 })
      : [];
    if (!item) return "missing";
    const allowed = await new Promise((resolve) => {
      try { chrome.extension.isAllowedFileSchemeAccess(resolve); } catch { resolve(false); }
    });
    return allowed ? readLocalFile(item.filename) : "access";
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
    if (state.preview?.src) URL.revokeObjectURL(state.preview.src);
    state.preview = null;
    state.previewFocus = null;
    document.getElementById("viewer")?.remove();
    if (focus?.isConnected) focus.focus({ preventScroll: true });
  }

  // Loads a file for preview and says what to show: the file itself, or why not.
  async function loadFile(base) {
    const named = base.localPath || base.name;
    let match = PREVIEW_KINDS.find(([pattern]) => pattern.test(named));
    // A file whose name says it can't be shown (a .zip, a Word file) isn't downloaded.
    if (!match && /\.[a-z0-9]{2,5}$/i.test(named)) return { state: "unsupported" };
    const found = await fileFromD2l(base.downloadUrl) || await fileFromComputer(base.localPath);
    if (typeof found === "string") return { state: found };
    match ||= PREVIEW_TYPES.find(([pattern]) => pattern.test(found.type || ""));
    if (!match) return { state: "unsupported" };
    const [, kind, type] = match;
    if (kind === "text") return { state: "ready", kind, text: (await found.text()).slice(0, 200000) };
    const typed = type && found.type !== type ? new Blob([found], { type }) : found;
    return { state: "ready", kind, mime: typed.type, src: URL.createObjectURL(typed) };
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
      if (!state.preview || previewFile.ticket !== ticket) return;
      showPreview({ ...base, ...shown });
    } catch (error) {
      if (!state.preview || previewFile.ticket !== ticket) return;
      showPreview({ ...base, ...loadFailure(error) });
    }
  }

  // ------------------------------------------- side panel for a Content item
  // A Content pill in Related items opens a panel over the right half of the
  // pop-up. It shows the item when it can (a PDF, an image, a video, plain
  // text) and otherwise says so, with Open in D2L. The arrows step through the
  // Content pills on screen.

  function peekHost() {
    return document.getElementById("detail-root")?.querySelector(".detail-panel");
  }

  function peekPills() {
    return [...document.querySelectorAll(".related-card [data-action='peek-content']")];
  }

  function peekItem(pill) {
    try { return JSON.parse(pill.dataset.peek); } catch { return null; }
  }

  // What the panel can do with an item: load a file, or only describe it.
  function peekKind(item) {
    if (item.localPath || isD2lFileUrl(item.downloadUrl)) return "file";
    return item.external ? "link" : "page";
  }

  function showPeek(view) {
    const host = peekHost();
    if (!host) return;
    if (state.peek?.view?.src) URL.revokeObjectURL(state.peek.view.src);
    state.peek = { ...state.peek, view };
    let node = document.getElementById("content-peek");
    const kept = node?.contains(document.activeElement) ? document.activeElement : null;
    if (!node) {
      node = document.createElement("div");
      node.id = "content-peek";
      host.append(node);
      for (const part of host.children) if (part !== node) part.inert = true;
      node.style.top = `${host.querySelector(".detail-layer-head")?.offsetHeight || 54}px`;
    }
    node.innerHTML = dash.contentPeek(view);
    peekPills().forEach((pill, at) => pill.classList.toggle("sel", at === view.at));
    const again = kept && node.querySelector(`[data-action="${kept.dataset.action}"][data-step="${kept.dataset.step}"]:not([disabled])`);
    (again || node.querySelector("[aria-label='Close preview']"))?.focus();
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
      if (state.peek?.ticket !== ticket) return void (shown.src && URL.revokeObjectURL(shown.src));
      showPeek({ ...base, ...shown });
    } catch (error) {
      if (state.peek?.ticket === ticket) showPeek({ ...base, ...loadFailure(error) });
    }
  }

  function peekContent(pill) {
    if (!state.peek) state.peek = { focus: pill };
    return openPeekAt(peekPills().indexOf(pill));
  }

  function stepPeek(by) {
    const at = state.peek?.view?.at;
    if (at === undefined) return;
    return openPeekAt(at + by);
  }

  function closePeek({ restoreFocus = true } = {}) {
    const current = state.peek;
    if (!current) return;
    state.peek = null;
    if (current.view?.src) URL.revokeObjectURL(current.view.src);
    document.getElementById("content-peek")?.remove();
    const host = peekHost();
    if (host) for (const part of host.children) part.inert = false;
    document.querySelectorAll(".related-card .rel-pill.sel").forEach((pill) => pill.classList.remove("sel"));
    if (restoreFocus && current.focus?.isConnected) current.focus.focus({ preventScroll: true });
  }

  Object.assign(mod, { extensionAlive, fileUrlOf, readLocalFile, isD2lFileUrl, blobFromDataUrl, fileScope, fileFromD2l, fileFromComputer, showPreview, closePreview, previewFile, peekContent, stepPeek, closePeek, PREVIEW_KINDS, PREVIEW_TYPES });
})(globalThis);
