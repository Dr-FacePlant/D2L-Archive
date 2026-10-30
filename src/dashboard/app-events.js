// Document event handlers, search, settings and confirmed actions.
(function initDashboardAppEvents(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { $, COURSE_OVERRIDES_KEY, COURSE_TEXTBOOKS_KEY, EMBEDDED, READ_KEY, RECREATED_SEEN_KEY, SETTINGS_KEY, adoptLegacyArchive, api, backFromDetail, blobFromDataUrl, closeDetailToBase, closeLinkConfirm, closeOverlay, closePeek, closePreview, detailRoot, exportActivity, fileScope, look, main, moveGradeCarousel, navigateToDetail, openArchivedFile, openConfirmedLink, openPeek, previewFile, recordActivity, turnEpub, redrawAdoptNotice, refreshIfStaleOnFocus, rememberScreen, render, renderSyncStatus, saveLook, setChecklistDone, setDetailMore, showPreview, stepPeek, setWorkMark, showLinkConfirm, startSync, state, storageSet, toast, updateGradeCarouselControls, wait } = dash.appModules;
  // ------------------------------------------------------------- events

  function markRead(ids, value = true) {
    for (const id of ids) {
      if (value) state.read[id] = true;
      else delete state.read[id];
    }
    dash.accountBinding.saveScoped(chrome.storage.local, READ_KEY, state.account.id, state.read);
    if (state.detail) state.baseStale = true;
  }

  // The account menu slides between its main list and the Help links.
  function showAccountView(help, focus = false) {
    const menu = document.getElementById("account-menu");
    const shown = document.getElementById(help ? "account-help" : "account-main");
    const away = document.getElementById(help ? "account-main" : "account-help");
    if (!menu || !shown || !away) return;
    menu.classList.toggle("view-help", help);
    away.setAttribute("inert", "");
    shown.removeAttribute("inert");
    menu.querySelector(".account-slider").style.height = `${shown.scrollHeight}px`;
    if (focus) menu.querySelector(help ? ".account-back" : "[data-action=account-help]")?.focus({ preventScroll: true });
  }

  function closeMenu() {
    if (!state.menu) return;
    document.getElementById(state.menu)?.classList.remove("view-help");
    document.getElementById(state.menu)?.setAttribute("hidden", "");
    document.querySelector(`[aria-controls="${state.menu}"]`)?.setAttribute("aria-expanded", "false");
    state.menu = null;
  }

  function filterMenuOptions(menu) {
    return [...(menu?.querySelectorAll('[role="option"]') || [])];
  }

  function closeFilterMenu(restoreFocus = false) {
    if (!state.filterMenu) return;
    const menu = document.getElementById(state.filterMenu);
    const trigger = document.querySelector(`[aria-controls="${state.filterMenu}"]`);
    menu?.setAttribute("hidden", "");
    trigger?.setAttribute("aria-expanded", "false");
    state.filterMenu = null;
    if (restoreFocus) trigger?.focus();
  }

  function openFilterMenu(trigger, focusDirection = 0) {
    const id = trigger.getAttribute("aria-controls");
    const menu = document.getElementById(id);
    if (!menu) return;
    closeFilterMenu();
    menu.removeAttribute("hidden");
    trigger.setAttribute("aria-expanded", "true");
    state.filterMenu = id;
    if (focusDirection) {
      const options = filterMenuOptions(menu);
      const selected = Math.max(0, options.findIndex((option) => option.getAttribute("aria-selected") === "true"));
      const index = focusDirection < 0 ? Math.max(0, options.length - 1) : selected;
      options[index]?.focus();
    }
  }

  function moveFilterMenuOption(option, key) {
    const options = filterMenuOptions(option.closest('[role="listbox"]'));
    const current = options.indexOf(option);
    let next = current;
    if (key === "Home") next = 0;
    else if (key === "End") next = options.length - 1;
    else next = (current + (key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  }

  // ---- live search: results open under the top-bar box as you type. A short
  // wait keeps fast typing from sending a search per key, and an answer that
  // arrives after a newer query (or after the panel closed) is dropped.
  const LIVE_SEARCH_MS = 200;
  const liveSearch = { timer: 0, seq: 0, active: -1 };
  function searchInput() { return document.querySelector(".top-search input[name=q]"); }
  function searchPanelNode() { return document.getElementById("search-panel"); }
  function searchOptions() { return [...(searchPanelNode()?.querySelectorAll("[role=option]") || [])]; }

  function showSearchPanel(html) {
    const panel = searchPanelNode();
    if (!panel) return;
    panel.innerHTML = html;
    panel.hidden = !html;
    liveSearch.active = -1;
    searchInput()?.setAttribute("aria-expanded", html ? "true" : "false");
    searchInput()?.removeAttribute("aria-activedescendant");
  }

  function closeSearchPanel() {
    clearTimeout(liveSearch.timer);
    liveSearch.seq += 1;
    showSearchPanel("");
  }

  function queueLiveSearch(value) {
    const query = String(value || "").trim();
    clearTimeout(liveSearch.timer);
    if (!query || !state.index) {
      closeSearchPanel();
      return;
    }
    liveSearch.timer = setTimeout(() => runLiveSearch(query), LIVE_SEARCH_MS);
  }

  async function runLiveSearch(query) {
    const seq = ++liveSearch.seq;
    if (searchPanelNode()?.hidden) showSearchPanel(dash.searchPanel(dash.searchPanelModel({ query }), true));
    const result = await api("search.query", { query, limit: 60 }).catch(() => ({ query, entities: [], evidence: [] }));
    if (seq !== liveSearch.seq) return;
    // The Search page reuses this answer when you press Enter.
    state.search = { query, result: { ...result, query }, pending: false };
    showSearchPanel(dash.searchPanel(dash.searchPanelModel(dash.searchModel(state.index, state.search.result)), false));
  }

  function moveSearchOption(step) {
    const options = searchOptions();
    if (!options.length) return;
    options[liveSearch.active]?.setAttribute("aria-selected", "false");
    options[liveSearch.active]?.classList.remove("active");
    // -1 is "nothing picked"; the arrows cycle through it.
    const size = options.length + 1;
    liveSearch.active = ((liveSearch.active + 1 + step + size) % size) - 1;
    const option = options[liveSearch.active];
    if (option) {
      option.setAttribute("aria-selected", "true");
      option.classList.add("active");
      option.scrollIntoView({ block: "nearest" });
      searchInput()?.setAttribute("aria-activedescendant", option.id);
    } else {
      searchInput()?.removeAttribute("aria-activedescendant");
    }
  }

  async function saveSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    await storageSet(SETTINGS_KEY, state.settings);
  }

  // Saved to this D2L account's own local bucket, never to D2L. A later sync
  // cannot overwrite them because they are read after the archive is built.
  async function persistContactOverrides(next) {
    if (!state.account.id) {
      toast("That change wasn't saved: the D2L account isn't known yet.");
      return false;
    }
    try {
      await chrome.storage.local.set({ [dash.accountBinding.scopedKey(COURSE_OVERRIDES_KEY, state.account.id)]: next });
    } catch {
      toast("That change wasn't saved locally.");
      return false;
    }
    state.courseContactOverrides = next;
    if (state.index) state.index.courseContactOverrides = next;
    return true;
  }

  async function saveContactOverride(courseId, contactIndex, field, value) {
    const previous = state.courseContactOverrides || {};
    const course = { ...(previous[courseId] || {}) };
    course[contactIndex] = { ...(course[contactIndex] || {}), [field]: value };
    return persistContactOverrides({ ...previous, [courseId]: course });
  }

  // The syllabus link lives beside the contact edits so it shares their
  // per-account bucket and backup file. An empty value goes back to the
  // syllabus the archive detected.
  async function saveSyllabusOverride(courseId, value) {
    const previous = state.courseContactOverrides || {};
    const course = { ...(previous[courseId] || {}) };
    if (value && typeof value === "object") {
      if (value.type === "text") {
        const text = String(value.text || "").trim();
        if (text) course.syllabus = { type: "text", title: "Custom syllabus", text };
        else delete course.syllabus;
      } else if (value.type === "file" && value.dataUrl) {
        course.syllabus = {
          type: "file",
          title: value.name || "Syllabus",
          name: value.name || "Syllabus",
          mime: value.mime || "application/pdf",
          dataUrl: value.dataUrl
        };
      } else {
        delete course.syllabus;
      }
      const next = { ...previous };
      if (Object.keys(course).length) next[courseId] = course;
      else delete next[courseId];
      return persistContactOverrides(next);
    }
    const url = dash.safeSyllabusUrl(value);
    if (value && !url) {
      toast("Enter a full web link that starts with http:// or https://.");
      return false;
    }
    if (url) course.syllabus = { url };
    else delete course.syllabus;
    const next = { ...previous };
    if (Object.keys(course).length) next[courseId] = course;
    else delete next[courseId];
    return persistContactOverrides(next);
  }

  // A file is the only way these local edits survive clearing extension data
  // or moving to another browser. It carries no D2L data.
  async function exportContactEdits() {
    const overrides = state.courseContactOverrides || {};
    const fields = dash.contactEditCount(overrides);
    if (!fields) {
      toast("There are no contact edits to export yet.");
      return;
    }
    const body = JSON.stringify(dash.contactBackupDocument(overrides), null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    try {
      await chrome.downloads.download({ url, filename: `D2L Export/contact-edits-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, saveAs: false, conflictAction: "uniquify" });
    } catch (error) {
      toast(`Contact edits weren't exported: ${error.message || "the download failed."}`);
      return;
    }
    await recordActivity({ operation: "contacts.export", category: "export", status: "completed", source: "storage-settings", details: { fields, courses: Object.keys(overrides).length } });
    toast(`Exported ${fields} contact ${fields === 1 ? "edit" : "edits"}.`);
  }

  async function importContactEdits() {
    if (!state.account.id) {
      toast("Those edits weren't imported: the D2L account isn't known yet.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.hidden = true;
    input.addEventListener("cancel", () => input.remove());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      const parsed = dash.parseContactBackup(await file.text().catch(() => ""));
      if (!parsed.ok) {
        toast(`That file couldn't be imported: ${parsed.error}`);
        return;
      }
      const { next, changed } = dash.mergeContactOverrides(state.courseContactOverrides || {}, parsed.overrides);
      if (!changed) {
        toast("Those edits are already saved.");
        return;
      }
      try {
        await chrome.storage.local.set({ [dash.accountBinding.scopedKey(COURSE_OVERRIDES_KEY, state.account.id)]: next });
      } catch {
        toast("Those edits weren't saved locally.");
        return;
      }
      state.courseContactOverrides = next;
      if (state.index) state.index.courseContactOverrides = next;
      await recordActivity({ operation: "contacts.import", category: "local-change", status: "saved", source: "storage-settings", details: { fields: parsed.fields, courses: parsed.courses, changed } });
      render.keepScroll = true;
      await render();
      toast(`Imported ${changed} contact ${changed === 1 ? "edit" : "edits"}.`);
    });
    document.body.append(input);
    input.click();
  }

  const CONTACT_FIELD_LABELS = Object.freeze({ name: "instructor name", email: "instructor email", officeHours: "office hours", syllabus: "syllabus link" });

  // ---- textbook shelf: the entries saved here replace whatever the archive
  // detected for the course, and each edit rewrites the whole list, so the
  // editor reads from the same list it renders.
  function textbookEntriesFor(courseId) {
    const saved = state.courseTextbooks?.[courseId]?.entries;
    if (saved) return saved.slice(0, dash.MAX_TEXTBOOK_ENTRIES);
    // Nothing is auto-detected onto the shelf: it shows only what was added here.
    return [];
  }

  async function persistTextbookEntries(courseId, nextEntries) {
    if (!state.account.id) {
      toast("That change wasn't saved: the D2L account isn't known yet.");
      return false;
    }
    const entries = dash.normalizeTextbookEntries?.(nextEntries) || [];
    const previous = state.courseTextbooks || {};
    const course = { ...(previous[courseId] || {}) };
    if (entries.length) course.entries = entries;
    else delete course.entries;
    const next = { ...previous };
    if (Object.keys(course).length) next[courseId] = course;
    else delete next[courseId];
    try {
      await chrome.storage.local.set({ [dash.accountBinding.scopedKey(COURSE_TEXTBOOKS_KEY, state.account.id)]: next });
    } catch {
      toast("That change wasn't saved locally.");
      return false;
    }
    state.courseTextbooks = next;
    if (state.index) state.index.courseTextbooks = next;
    return true;
  }

  function closeTextbookEdit() {
    document.getElementById("textbook-layer")?.remove();
  }

  function closeAllTextbookEdits() {
    closeTextbookEdit();
  }

  function beginTextbookEdit(courseId, entryIndex) {
    if (!courseId) return;
    closeAllTextbookEdits();
    const entries = textbookEntriesFor(courseId);
    const existing = entryIndex >= 0 && entryIndex < entries.length ? entries[entryIndex] : null;
    const course = state.index?.courseById?.get(courseId) || {};
    // The whole page keeps living behind the pop-up, so it never hides the
    // shelf: a fixed scrim with a small titled panel over it.
    const layer = document.createElement("div");
    layer.id = "textbook-layer";
    layer.className = "textbook-layer";
    const panel = document.createElement("div");
    panel.className = "textbook-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "textbook-layer-title");
    const head = document.createElement("div");
    head.className = "textbook-panel-head";
    const heading = document.createElement("div");
    const titleEl = document.createElement("b");
    titleEl.id = "textbook-layer-title";
    titleEl.textContent = existing ? (existing.kind === "link" ? "Edit link" : "Edit textbook") : "Add textbook or link";
    const sub = document.createElement("span");
    sub.className = "panel-sub";
    sub.textContent = ["Textbooks & Links", course.label || ""].filter(Boolean).join(" · ");
    const closeBtn = document.createElement("button");
    closeBtn.className = "icon-btn";
    closeBtn.type = "button";
    closeBtn.dataset.action = "cancel-textbook-edit";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = dash.icon("close", 16);
    heading.append(titleEl, sub);
    head.append(heading, closeBtn);
    layer.append(panel);
    panel.append(head);

    const form = document.createElement("form");
    form.className = "textbook-editor";
    form.id = "textbook-editor-form";
    form.dataset.textbookEditor = "";
    form.dataset.courseId = courseId;
    form.dataset.entryIndex = String(entryIndex);
    if (existing) form.__textbookEntry = existing;
    let kind = existing?.kind === "link" ? "link" : "book";
    form.dataset.kind = kind;

    const field = (name, placeholder, label, value, mode) => {
      const wrap = document.createElement("label");
      wrap.className = "textbook-field";
      const caption = document.createElement("span");
      caption.textContent = label;
      const input = document.createElement("input");
      input.className = "instructor-edit-input";
      input.name = name;
      input.type = "text";
      input.value = value || "";
      input.autocomplete = "off";
      input.placeholder = placeholder;
      input.setAttribute("aria-label", label);
      if (mode) input.inputMode = mode;
      wrap.append(caption, input);
      return wrap;
    };

    const bookPane = document.createElement("div");
    bookPane.className = "textbook-pane";
    bookPane.hidden = kind !== "book";
    bookPane.append(field("title", "Type the title, like World of Art", "Title", existing?.title));
    bookPane.append(field("meta", "Edition, author, type — optional", "Details (optional)", existing?.meta));
    bookPane.append(field("linkUrl", "website.com", "URL (optional)", existing?.links?.[0]?.url, "url"));

    // An attached PDF or EPUB: the shelf cover opens it. Kept inside the extension.
    let bookFile = existing?.kind !== "link" ? existing?.file || null : null;
    const fileField = document.createElement("div");
    fileField.className = "textbook-field";
    const fileCaption = document.createElement("span");
    fileCaption.textContent = "Attach a PDF or EPUB (optional)";
    const fileRow = document.createElement("div");
    fileRow.className = "textbook-file-row";
    const filePicker = document.createElement("label");
    filePicker.className = "textbook-file-picker-label";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.className = "sr-only";
    fileInput.accept = ".pdf,.epub,application/pdf,application/epub+zip";
    const fileText = document.createElement("span");
    fileText.className = "textbook-file-chosen-text";
    const fileRemove = document.createElement("button");
    fileRemove.type = "button";
    fileRemove.className = "link-icon-chip";
    fileRemove.textContent = "Remove";
    const paintFile = () => {
      fileText.textContent = bookFile ? bookFile.name : "Choose a file…";
      fileRemove.hidden = !bookFile;
    };
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      const isEpub = /\.epub$/i.test(file.name) || file.type === "application/epub+zip";
      const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
      if (!isEpub && !isPdf) { toast("Choose a PDF or EPUB file."); return; }
      if (file.size > dash.TEXTBOOK_FILE_BYTES_LIMIT) { toast("That file is over 25 MB. Choose a smaller one."); return; }
      const mime = isEpub ? "application/epub+zip" : "application/pdf";
      const reader = new FileReader();
      reader.onload = () => {
        const chosen = { name: file.name, mime, dataUrl: `data:${mime};base64,${String(reader.result).slice(String(reader.result).indexOf(",") + 1)}` };
        bookFile = dash.safeBookFile?.(chosen) || null;
        if (!bookFile) toast("Couldn't read that file.");
        paintFile();
      };
      reader.readAsDataURL(file);
    });
    fileRemove.addEventListener("click", () => { bookFile = null; paintFile(); });
    filePicker.append(fileInput, fileText);
    fileRow.append(filePicker, fileRemove);
    fileField.append(fileCaption, fileRow);
    bookPane.append(fileField);
    form.__bookFile = () => bookFile;
    paintFile();

    // The cover row mirrors the Link tab's icon row: a live preview of the
    // book that will sit on the shelf, plus the choices that change it. With
    // no image the preview is the default cover drawn from the title.
    const coverWrap = document.createElement("div");
    coverWrap.className = "textbook-field";
    const coverCaption = document.createElement("span");
    coverCaption.textContent = "Cover";
    const coverRow = document.createElement("div");
    coverRow.className = "link-icon-row";
    const coverPreview = document.createElement("span");
    coverPreview.className = "textbook-frame is-preview";
    const coverControls = document.createElement("div");
    coverControls.className = "link-icon-controls";
    const coverModes = document.createElement("div");
    coverModes.className = "link-icon-modes";
    const coverSwatchRow = document.createElement("div");
    coverSwatchRow.className = "link-swatches";
    let coverImage = existing?.kind !== "link" ? existing?.cover || "" : "";
    let coverMode = coverImage ? "image" : "default";
    let coverTone = existing?.kind !== "link" ? existing?.tone || "" : "";
    const defaultChip = document.createElement("button");
    defaultChip.type = "button";
    defaultChip.className = "link-icon-chip";
    defaultChip.textContent = "Default book";
    defaultChip.addEventListener("click", () => { coverMode = "default"; paintCover(); });
    const coverUpload = document.createElement("label");
    coverUpload.className = "link-icon-chip";
    const coverInput = document.createElement("input");
    coverInput.type = "file";
    coverInput.className = "syllabus-file-input sr-only";
    coverInput.accept = "image/png,image/jpeg,image/webp,image/gif";
    coverUpload.append(coverInput, document.createTextNode("Upload image"));
    coverInput.addEventListener("change", () => {
      const file = coverInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result || "");
        if (!dash.safeCoverUrl?.(url)) {
          toast("That image type can't be used — pick a PNG, JPEG, WebP or GIF.");
          return;
        }
        coverImage = url;
        coverMode = "image";
        paintCover();
      };
      reader.readAsDataURL(file);
    });
    coverModes.append(defaultChip, coverUpload);
    const coverSwatches = {};
    // The course colour is often nearly one of the tones, which showed as two
    // of the same colour: offer only one of the pair (the saved one wins).
    const sameAsCourse = dash.toneMatchingTint?.(course.tint) || "";
    for (const name of ["", ...(dash.TEXTBOOK_LINK_TONES || [])]) {
      if (sameAsCourse && (name === "" ? coverTone === sameAsCourse : name === sameAsCourse && coverTone !== sameAsCourse)) continue;
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = name ? `link-swatch tone-${name}` : "link-swatch is-course";
      if (!name && course.tint) swatch.style.background = course.tint;
      swatch.title = name ? name[0].toUpperCase() + name.slice(1) : "Course color";
      swatch.setAttribute("aria-label", `${swatch.title} cover`);
      swatch.addEventListener("click", () => { coverTone = name; coverMode = "default"; paintCover(); });
      coverSwatches[name] = swatch;
      coverSwatchRow.append(swatch);
    }
    const paintCover = () => {
      coverPreview.replaceChildren();
      if (coverMode === "image" && coverImage) {
        const img = document.createElement("img");
        img.className = "textbook-cover-img";
        img.alt = "";
        img.src = coverImage;
        coverPreview.append(img);
      } else {
        const art = document.createElement("span");
        art.className = `textbook-cover-default${coverTone ? ` tone-${coverTone}` : ""}`;
        if (!coverTone) {
          if (course.tint) art.style.background = course.tint;
          if (course.ink) art.style.color = course.ink;
        }
        const spine = document.createElement("span");
        spine.className = "tc-spine";
        const title = document.createElement("span");
        title.className = "tc-title";
        title.textContent = String(bookPane.querySelector("input[name=title]")?.value || "").trim() || "Title";
        const mark = document.createElement("span");
        mark.innerHTML = dash.icon("book", 11, 'class="tc-mark"');
        art.append(spine, title, mark.firstChild);
        coverPreview.append(art);
      }
      const activeMode = coverMode === "image" && !coverImage ? "default" : coverMode;
      defaultChip.classList.toggle("is-on", activeMode === "default");
      coverUpload.classList.toggle("is-on", activeMode === "image");
      coverSwatchRow.hidden = activeMode === "image";
      for (const [name, swatch] of Object.entries(coverSwatches)) {
        swatch.classList.toggle("is-on", name === coverTone);
        swatch.setAttribute("aria-pressed", String(name === coverTone));
      }
    };
    bookPane.addEventListener("input", paintCover);
    coverControls.append(coverModes, coverSwatchRow);
    coverRow.append(coverPreview, coverControls);
    coverWrap.append(coverCaption, coverRow);
    form.__coverState = () => ({ cover: coverMode === "image" ? coverImage : "", tone: coverMode === "image" ? "" : coverTone });
    bookPane.append(coverWrap);
    paintCover();

    // The Link tab: a name, a web address, and the tile's
    // icon (the link glyph, the name's first letter, or an uploaded image)
    // in one of the tile colours.
    const linkPane = document.createElement("div");
    linkPane.className = "textbook-pane";
    linkPane.hidden = kind !== "link";
    const isLink = existing?.kind === "link";
    linkPane.append(
      field("linkTitle", "Type a name, like Class Portal", "Title", isLink ? existing.title : ""),
      field("linkAddress", "website.com", "URL", isLink ? existing.links?.[0]?.url : "", "url")
    );
    let tone = isLink ? existing.tone || "violet" : "violet";
    let mode = isLink && existing.cover ? "image" : isLink && existing.mark === "letter" ? "letter" : "glyph";
    let image = isLink ? existing.cover || "" : "";
    const iconWrap = document.createElement("div");
    iconWrap.className = "textbook-field";
    const iconCaption = document.createElement("span");
    iconCaption.textContent = "Icon";
    const iconRow = document.createElement("div");
    iconRow.className = "link-icon-row";
    const preview = document.createElement("span");
    preview.className = "link-tile is-preview";
    const iconControls = document.createElement("div");
    iconControls.className = "link-icon-controls";
    const modeRow = document.createElement("div");
    modeRow.className = "link-icon-modes";
    const swatchRow = document.createElement("div");
    swatchRow.className = "link-swatches";
    const modeButtons = {};
    const chip = (name, label) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "link-icon-chip";
      button.textContent = label;
      button.addEventListener("click", () => { mode = name; paint(); });
      modeButtons[name] = button;
      return button;
    };
    const uploadChip = document.createElement("label");
    uploadChip.className = "link-icon-chip";
    const uploadInput = document.createElement("input");
    uploadInput.type = "file";
    uploadInput.className = "syllabus-file-input sr-only";
    uploadInput.accept = "image/png,image/jpeg,image/webp,image/gif";
    uploadChip.append(uploadInput, document.createTextNode("Upload image"));
    modeButtons.image = uploadChip;
    uploadInput.addEventListener("change", () => {
      const file = uploadInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result || "");
        if (!dash.safeCoverUrl?.(url)) {
          toast("That image type can't be used — pick a PNG, JPEG, WebP or GIF.");
          return;
        }
        image = url;
        mode = "image";
        paint();
      };
      reader.readAsDataURL(file);
    });
    modeRow.append(chip("glyph", "Link icon"), chip("letter", "First letter"), uploadChip);
    const swatches = {};
    for (const name of dash.TEXTBOOK_LINK_TONES || []) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = `link-swatch tone-${name}`;
      swatch.title = name[0].toUpperCase() + name.slice(1);
      swatch.setAttribute("aria-label", `${swatch.title} tile`);
      swatch.addEventListener("click", () => { tone = name; paint(); });
      swatches[name] = swatch;
      swatchRow.append(swatch);
    }
    const paint = () => {
      preview.className = `link-tile is-preview tone-${tone}`;
      preview.replaceChildren();
      if (mode === "image" && image) {
        const img = document.createElement("img");
        img.className = "textbook-cover-img";
        img.alt = "";
        img.src = image;
        preview.append(img);
      } else if (mode === "letter") {
        const letter = document.createElement("span");
        letter.className = "link-tile-letter";
        letter.textContent = Array.from(String(linkPane.querySelector("input[name=linkTitle]")?.value || "").trim())[0]?.toUpperCase() || "?";
        preview.append(letter);
      } else {
        preview.innerHTML = dash.icon("link", 24);
      }
      for (const [name, button] of Object.entries(modeButtons)) {
        const on = name === (mode === "image" && !image ? "glyph" : mode);
        button.classList.toggle("is-on", on);
      }
      for (const [name, swatch] of Object.entries(swatches)) {
        swatch.classList.toggle("is-on", name === tone);
        swatch.setAttribute("aria-pressed", String(name === tone));
      }
    };
    linkPane.addEventListener("input", paint);
    iconControls.append(modeRow, swatchRow);
    iconRow.append(preview, iconControls);
    iconWrap.append(iconCaption, iconRow);
    linkPane.append(iconWrap);
    paint();
    form.__linkState = () => ({ tone, mode: mode === "image" && !image ? "glyph" : mode, image });

    // New items choose their type on tabs; an existing item keeps its type.
    if (!existing) {
      const tabs = document.createElement("div");
      tabs.className = "textbook-kind-tabs";
      tabs.setAttribute("role", "tablist");
      const tabButtons = {};
      const setKind = (next) => {
        kind = next;
        form.dataset.kind = next;
        bookPane.hidden = next !== "book";
        linkPane.hidden = next !== "link";
        for (const [name, button] of Object.entries(tabButtons)) {
          button.classList.toggle("is-on", name === next);
          button.setAttribute("aria-selected", String(name === next));
        }
        form.querySelector(next === "link" ? "input[name=linkTitle]" : "input[name=title]")?.focus();
      };
      for (const [name, label] of [["book", "Textbook"], ["link", "Link"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "tab");
        button.textContent = label;
        button.addEventListener("click", () => setKind(name));
        tabButtons[name] = button;
        tabs.append(button);
      }
      tabButtons.book.classList.add("is-on");
      tabButtons.book.setAttribute("aria-selected", "true");
      tabButtons.link.setAttribute("aria-selected", "false");
      form.append(tabs);
    }
    form.append(bookPane, linkPane);

    const actions = document.createElement("div");
    actions.className = "textbook-editor-actions";
    const save = document.createElement("button");
    save.className = "btn btn-primary instructor-save";
    save.type = "submit";
    save.setAttribute("form", form.id);
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.className = "btn instructor-cancel";
    cancel.type = "button";
    cancel.dataset.action = "cancel-textbook-edit";
    cancel.textContent = "Cancel";
    actions.append(cancel, save);
    if (existing) {
      const remove = document.createElement("button");
      remove.className = "btn instructor-cancel";
      remove.type = "button";
      remove.dataset.action = "remove-textbook";
      remove.textContent = "Remove";
      actions.prepend(remove);
    }
    panel.append(form);
    panel.append(actions);
    document.body.append(layer);
    form.querySelector(kind === "link" ? "input[name=linkTitle]" : "input[name=title]")?.focus();
  }


  function cancelContactEdit(row) {
    if (!row?.__instructorHTML) return;
    row.innerHTML = row.__instructorHTML;
    delete row.__instructorHTML;
    row.querySelector(".instructor-edit")?.focus();
  }

  function beginContactEdit(row) {
    if (!row || row.querySelector("[data-contact-editor]")) return;
    cancelContactEdit(document.querySelector("[data-contact-editor]")?.closest("[data-contact-row]"));
    row.__instructorHTML = row.innerHTML;
    const field = row.dataset.field || "";
    const label = CONTACT_FIELD_LABELS[field] || field;
    const value = row.dataset.editValue || "";
    row.querySelector(".instructor-contact-value")?.remove();
    row.querySelector(".instructor-actions")?.remove();
    const form = document.createElement("form");
    form.className = "instructor-contact-editor";
    form.dataset.contactEditor = "";
    const input = document.createElement("input");
    input.className = "instructor-edit-input";
    input.name = "value";
    input.type = "text";
    input.value = value;
    input.autocomplete = "off";
    input.setAttribute("aria-label", `Edit ${label}`);
    if (field === "name") input.placeholder = "Type the instructor's name";
    if (field === "email") {
      input.inputMode = "email";
      input.placeholder = "Type the instructor's email address";
    }
    if (field === "officeHours") input.placeholder = "Type the office hours, like Mon and Wed 2–4 PM";
    if (field === "syllabus") {
      input.inputMode = "url";
      input.placeholder = "Paste a link, or leave empty to use the detected one";
    }
    const save = document.createElement("button");
    save.className = "btn btn-primary instructor-save";
    save.type = "submit";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.className = "btn instructor-cancel";
    cancel.type = "button";
    cancel.dataset.action = "cancel-instructor-edit";
    cancel.textContent = "Cancel";

    if (field === "syllabus") {
      form.classList.add("is-syllabus-chips-row");
      const chipsWrap = document.createElement("div");
      chipsWrap.className = "syllabus-choice-chips";

      const btnLink = document.createElement("button");
      btnLink.type = "button";
      btnLink.className = "syllabus-chip-btn";
      btnLink.innerHTML = `${dash.icon("link", 14)}<span>Link</span>`;

      const btnFile = document.createElement("button");
      btnFile.type = "button";
      btnFile.className = "syllabus-chip-btn";
      btnFile.innerHTML = `${dash.icon("file", 14)}<span>File</span>`;

      const btnText = document.createElement("button");
      btnText.type = "button";
      btnText.className = "syllabus-chip-btn";
      btnText.innerHTML = `${dash.icon("pencil", 14)}<span>Text</span>`;

      chipsWrap.append(btnLink, btnFile, btnText);

      const cancelRowBtn = document.createElement("button");
      cancelRowBtn.type = "button";
      cancelRowBtn.className = "instructor-cancel syllabus-cancel-icon";
      cancelRowBtn.dataset.action = "cancel-instructor-edit";
      cancelRowBtn.setAttribute("aria-label", "Cancel edit");
      cancelRowBtn.innerHTML = dash.icon("close", 14);

      form.append(chipsWrap, cancelRowBtn);

      const openModeEditor = (mode) => {
        form.innerHTML = "";
        form.classList.remove("is-syllabus-chips-row");
        form.classList.add("is-syllabus-step2");
        form.dataset.syllabusMode = mode;

        if (mode === "link") {
          input.hidden = false;
          form.append(input, save, cancel);
          input.focus();
          input.select();
        } else if (mode === "file") {
          const fileWrap = document.createElement("label");
          fileWrap.className = "syllabus-file-picker-label";
          const fileInput = document.createElement("input");
          fileInput.type = "file";
          fileInput.className = "syllabus-file-input sr-only";
          fileInput.accept = ".pdf,.doc,.docx,.txt,.rtf,image/*";
          const fileText = document.createElement("span");
          fileText.className = "syllabus-file-chosen-text";
          fileText.textContent = "Choose PDF or document...";
          fileWrap.append(fileInput, fileText);

          fileInput.addEventListener("change", () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            fileText.textContent = file.name;
            const reader = new FileReader();
            reader.onload = () => {
              form.__syllabusFile = {
                name: file.name,
                mime: file.type || "application/pdf",
                dataUrl: reader.result
              };
            };
            reader.readAsDataURL(file);
          });

          form.append(fileWrap, save, cancel);
          fileInput.focus();
        } else if (mode === "text") {
          const textArea = document.createElement("textarea");
          textArea.className = "instructor-edit-textarea";
          textArea.name = "syllabusText";
          textArea.rows = 2;
          textArea.placeholder = "Paste raw syllabus text here...";
          textArea.value = value;
          const actions = document.createElement("div");
          actions.className = "syllabus-editor-actions";
          actions.append(save, cancel);
          form.append(textArea, actions);
          textArea.focus();
        }
      };

      btnLink.addEventListener("click", () => openModeEditor("link"));
      btnFile.addEventListener("click", () => openModeEditor("file"));
      btnText.addEventListener("click", () => openModeEditor("text"));
      row.append(form);
      btnLink.focus();
    } else {
      form.append(input, save, cancel);
      row.append(form);
      input.focus();
      input.select();
    }
  }

  async function copyToClipboard(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {}
    }
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    let copied = false;
    try { copied = document.execCommand("copy"); }
    finally { field.remove(); }
    if (!copied) throw new Error("Clipboard copy was blocked");
  }

  document.addEventListener("click", async (event) => {
    const link = event.target.closest("a[href]");
    const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    // A date box flips between how long is left and the date; it never opens its row.
    const flip = event.target.closest("[data-action=flip-date]");
    if (flip) {
      event.preventDefault();
      flip.classList.toggle("flipped");
      return;
    }
    if (EMBEDDED && event.target.closest("[data-action=close-overlay]")) {
      closeMenu();
      closeOverlay();
      return;
    }
    // A file row previews here. It stays an anchor to the D2L page, so
    // modified clicks still open D2L in a new tab.
    if (link && plain && link.hasAttribute("data-preview")) {
      event.preventDefault();
      previewFile(link);
      return;
    }
    // Every link that leaves the archive asks once. Modified clicks keep the
    // browser's own new-tab behavior and skip the prompt.
    if (link && plain && dash.isOutboundLink(link.getAttribute("href"))) {
      event.preventDefault();
      const d2l = link.hasAttribute("data-d2l-link") || dash.embeddedLinkTarget(link.getAttribute("href")) === "d2l";
      const title = link.getAttribute("data-confirm-external")
        || link.getAttribute("data-confirm-title")
        || link.getAttribute("aria-label")
        || link.textContent.trim()
        || link.getAttribute("title")
        || "this link";
      closeMenu();
      showLinkConfirm({ url: link.href, title, kind: d2l ? "d2l" : "external" });
      return;
    }
    const toggle = event.target.closest("[data-menu-toggle]");
    if (toggle) {
      const id = toggle.getAttribute("aria-controls");
      const open = state.menu === id;
      closeMenu();
      closeFilterMenu();
      if (!open) {
        document.getElementById(id).removeAttribute("hidden");
        toggle.setAttribute("aria-expanded", "true");
        state.menu = id;
        if (id === "account-menu") showAccountView(false);
      }
      return;
    }
    if (state.menu && !event.target.closest(".menu")) closeMenu();
    if (state.filterMenu && !event.target.closest(".select")) closeFilterMenu();
    if (!event.target.closest(".topbar-spacer")) closeSearchPanel();

    // Phones have no hover: the first tap on a chart dot shows its score, a
    // second tap opens the grade.
    const dot = event.target.closest(".chart-dot");
    if (dot && matchMedia("(hover: none)").matches && !dot.classList.contains("show")) {
      event.preventDefault();
      for (const other of document.querySelectorAll(".chart-dot.show")) other.classList.remove("show");
      dot.classList.add("show");
      return;
    }

    if (link && plain && dash.isLayerRoute(link.getAttribute("href"))) {
      event.preventDefault();
      navigateToDetail(link.getAttribute("href"), link);
    }

    if (event.target.id === "textbook-layer") {
      closeTextbookEdit();
      return;
    }
    const actionNode = event.target.closest("[data-action]");
    if (!actionNode) return;
    const action = actionNode.dataset.action;
    if (action === "account-help" || action === "account-back") {
      showAccountView(action === "account-help", true);
      return;
    }
    if (action === "edit-instructor") {
      beginContactEdit(actionNode.closest("[data-contact-row]"));
      return;
    }
    if (action === "cancel-instructor-edit") {
      cancelContactEdit(actionNode.closest("[data-contact-row]"));
      return;
    }
    if (action === "add-textbook" || action === "edit-textbook") {
      beginTextbookEdit(actionNode.dataset.courseId || "", action === "edit-textbook" ? Number(actionNode.dataset.entryIndex) : -1);
      return;
    }
    if (action === "cancel-textbook-edit") {
      closeTextbookEdit();
      return;
    }
    if (action === "remove-textbook") {
      const form = event.target.closest(".textbook-panel")?.querySelector("[data-textbook-editor]") || event.target.closest("[data-textbook-editor]");
      if (!form) return;
      actionNode.disabled = true;
      const courseId = form.dataset.courseId || "";
      const entries = textbookEntriesFor(courseId).slice(0, dash.MAX_TEXTBOOK_ENTRIES);
      const index = Number(form.dataset.entryIndex);
      if (index >= 0 && index < entries.length) entries.splice(index, 1);
      closeTextbookEdit();
      if (await persistTextbookEntries(courseId, entries)) {
        render.keepScroll = true;
        await render();
        toast("Item removed from the shelf.");
      }
      return;
    }
    if (action === "open-textbook-file") {
      const file = textbookEntriesFor(actionNode.dataset.courseId || "")[Number(actionNode.dataset.entryIndex)]?.file;
      if (!file) return;
      const blob = blobFromDataUrl(file.dataUrl, file.mime);
      const src = URL.createObjectURL(blob);
      if (file.mime === "application/pdf") {
        showPreview({ name: file.name, state: "ready", kind: "pdf", src, pdf: src, mime: file.mime });
      } else {
        showPreview({ name: file.name, state: "ready", kind: "epub", src, file: new File([blob], file.name, { type: file.mime }), mime: file.mime });
      }
      return;
    }
    if (action === "epub-prev" || action === "epub-next") {
      turnEpub(action === "epub-prev" ? -1 : 1);
      return;
    }
    if (action === "view-custom-syllabus") {
      const courseId = actionNode.dataset.courseId;
      const syllabus = state.courseContactOverrides?.[courseId]?.syllabus || state.index?.courseContactOverrides?.[courseId]?.syllabus;
      if (!syllabus) return;
      if (syllabus.type === "text") {
        const text = syllabus.text || "";
        const blob = new Blob([text], { type: "text/plain" });
        showPreview({
          name: syllabus.title || "Custom syllabus",
          state: "ready",
          kind: "text",
          text,
          src: URL.createObjectURL(blob),
          mime: "text/plain"
        });
      } else if (syllabus.type === "file" && syllabus.dataUrl) {
        const mime = syllabus.mime || "application/pdf";
        const blob = blobFromDataUrl(syllabus.dataUrl, mime);
        const src = URL.createObjectURL(blob);
        if (mime === "text/plain" || mime === "text/markdown") {
          blob.text().then((text) => {
            showPreview({
              name: syllabus.name || syllabus.title || "Syllabus",
              state: "ready",
              kind: "text",
              text,
              src,
              mime
            });
          });
        } else {
          showPreview({
            name: syllabus.name || syllabus.title || "Syllabus",
            state: "ready",
            kind: mime === "application/pdf" ? "pdf" : mime.startsWith("image/") ? "image" : "unsupported",
            src,
            pdf: mime === "application/pdf" ? src : undefined,
            mime
          });
        }
      }
      return;
    }
    if (action === "copy-instructor") {
      const value = actionNode.dataset.copyValue || "";
      const label = actionNode.dataset.copyLabel || "instructor information";
      if (!value) return;
      clearTimeout(actionNode.copyFeedbackTimer);
      const copied = await copyToClipboard(value).then(() => true, () => false);
      const status = actionNode.parentElement?.querySelector("[data-copy-status]");
      const message = copied ? `Copied ${label}` : `Couldn't copy ${label}`;
      actionNode.innerHTML = dash.icon(copied ? "check" : "close", 15);
      actionNode.classList.toggle("is-copied", copied);
      actionNode.classList.toggle("is-failed", !copied);
      actionNode.setAttribute("aria-label", message);
      actionNode.title = message;
      if (status) status.textContent = message;
      actionNode.copyFeedbackTimer = setTimeout(() => {
        if (!actionNode.isConnected) return;
        actionNode.innerHTML = dash.icon("copy", 15);
        actionNode.classList.remove("is-copied", "is-failed");
        actionNode.setAttribute("aria-label", `Copy ${label}`);
        actionNode.title = `Copy ${label}`;
        if (status) status.textContent = "";
      }, 1400);
    } else if (action === "nav") {
      const href = actionNode.dataset.href;
      if (dash.isLayerRoute(href)) navigateToDetail(href, actionNode);
      else location.hash = href;
    } else if (action === "export-activity") {
      await exportActivity(actionNode.dataset.format || "json").catch((error) => toast(`Activity export failed: ${error.message}`));
    } else if (action === "export-contact-edits") {
      await exportContactEdits();
    } else if (action === "import-contact-edits") {
      await importContactEdits();
    } else if (action === "filter-menu-toggle") {
      const open = state.filterMenu === actionNode.getAttribute("aria-controls");
      closeMenu();
      if (open) closeFilterMenu();
      else openFilterMenu(actionNode);
    } else if (action === "filter-menu-option") {
      const href = actionNode.dataset.href;
      closeFilterMenu();
      location.hash = href;
    } else if (action === "detail-back") {
      backFromDetail();
    } else if (action === "close-detail") {
      if (!actionNode.dataset.backdrop || event.target === actionNode) closeDetailToBase();
    } else if (action === "grade-prev" || action === "grade-next") {
      moveGradeCarousel(action === "grade-next" ? 1 : -1);
    } else if (action === "detail-more") {
      const layout = actionNode.closest(".detail-layout");
      setDetailMore(layout, !layout?.classList.contains("is-open"));
      actionNode.scrollIntoView({ block: "nearest" });
    } else if (action === "show-more") {
      // Reveal the next batch of rows; a time heading shows with its first row.
      const step = Number(actionNode.dataset.step) || 20;
      let revealed = 0;
      for (const node of main().querySelectorAll("[data-more][hidden]")) {
        if (revealed === step) break;
        node.hidden = false;
        if (node.matches("[data-update]")) revealed += 1;
      }
      const left = main().querySelectorAll("[data-update][data-more][hidden]").length;
      if (left) actionNode.textContent = `Show ${Math.min(step, left)} more`;
      else actionNode.remove();
    } else if (action === "sync") {
      closeMenu();
      startSync().catch((error) => toast(`Couldn't start sync: ${error.message}`));
    } else if (action === "adopt-legacy" || action === "adopt-legacy-cancel") {
      state.adopt = { confirming: action === "adopt-legacy", pending: false, error: "" };
      redrawAdoptNotice();
    } else if (action === "adopt-legacy-confirm") {
      adoptLegacyArchive();
    } else if (action === "mark-done" || action === "skip-work" || action === "unmark-work") {
      actionNode.disabled = true;
      const reason = action === "mark-done" ? "done" : action === "skip-work" ? "skip" : null;
      if (await setWorkMark(actionNode.dataset.entityId, reason)) render(location.hash);
      else actionNode.disabled = false;
    } else if (action === "dismiss-recreated") {
      state.recreatedSeen = state.archiveRecreatedAt;
      dash.accountBinding.saveScoped(chrome.storage.local, RECREATED_SEEN_KEY, state.account.id, state.recreatedSeen);
      main()?.querySelector("[data-archive-recreated]")?.remove();
    } else if (action === "select-day") {
      render.keepScroll = true;
      // Keep the calendar's filters (opening dates, hidden courses) and the
      // month on screen: a gray day from the month before or after is only
      // selected. Only the chevrons change the month.
      const params = new URLSearchParams(location.hash.split("?")[1] || "");
      params.set("month", actionNode.dataset.month || actionNode.dataset.day.slice(0, 7));
      params.set("day", actionNode.dataset.day);
      location.hash = `#/calendar?${params}`;
    } else if (action === "read-update") {
      markRead([actionNode.dataset.updateId]);
    } else if (action === "toggle-read") {
      markRead([actionNode.dataset.updateId], !state.read[actionNode.dataset.updateId]);
      render.keepScroll = true;
      render();
    } else if (action === "mark-all-read") {
      markRead(dash.updateRows(state.index, state.read).map((row) => row.id));
      render.keepScroll = true;
      render();
    } else if (action === "open-file") {
      openArchivedFile(actionNode.dataset.path);
    } else if (action === "peek-item") {
      openPeek(actionNode);
    } else if (action === "peek-step") {
      stepPeek(Number(actionNode.dataset.step));
    } else if (action === "close-peek") {
      closePeek();
    } else if (action === "preview-file") {
      previewFile(actionNode);
    } else if (action === "confirm-link") {
      openConfirmedLink();
    } else if (action === "close-link-confirm") {
      if (!actionNode.dataset.backdrop || event.target === actionNode) closeLinkConfirm();
    } else if (action === "reload-page") {
      location.reload();
    } else if (action === "close-preview") {
      if (!actionNode.dataset.backdrop || event.target === actionNode) closePreview();
    } else if (action === "modules") {
      for (const node of main().querySelectorAll("details.module:not(.pinned)")) node.open = actionNode.dataset.open === "true";
      syncModulesButton();
    } else if (action === "toggle-course") {
      const id = actionNode.dataset.course;
      const hidden = new Set(state.settings.hiddenCourseIds);
      const shown = new Set(state.settings.shownCourseIds || []);
      const visible = state.index.visible.has(id);
      if (visible) { hidden.add(id); shown.delete(id); } else { hidden.delete(id); shown.add(id); }
      await saveSettings({ hiddenCourseIds: [...hidden], shownCourseIds: [...shown] });
      state.index = dash.buildIndex({ ...state.index.raw, settings: state.settings });
      if (state.detail) state.baseStale = true;
      render.keepScroll = true;
      render();
    } else if (action === "toggle-download-files") {
      await saveSettings({ downloadCourseFiles: state.settings.downloadCourseFiles !== true });
      render.keepScroll = true;
      render();
    } else if (action === "set-look") {
      await saveLook({ [actionNode.dataset.key]: actionNode.dataset.value });
      render();
    } else if (action === "clear-previews") {
      await dash.fileCache?.clear(fileScope()).catch(() => {});
      toast("Saved previews cleared.");
      render();
    }
  });

  // One Expand all / Collapse all button: it collapses once every module is open.
  function syncModulesButton() {
    const button = main().querySelector('[data-action="modules"]');
    if (!button) return;
    const allOpen = [...main().querySelectorAll("details.module:not(.pinned)")].every((node) => node.open);
    button.dataset.open = String(!allOpen);
    button.textContent = allOpen ? "Collapse all" : "Expand all";
  }

  document.addEventListener("toggle", (event) => {
    if (event.target.matches?.("details.module")) syncModulesButton();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (state.linkConfirm) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLinkConfirm();
        return;
      }
      if (event.key === "Tab") {
        const panel = document.querySelector("#link-confirm .link-confirm-panel");
        const focusable = [...(panel?.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])]
          .filter((node) => !node.hidden && node.getClientRects().length);
        if (focusable.length) {
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!panel.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
          else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        return;
      }
    }
    if (event.key === "Tab" && state.detail && !state.preview && !$("#action-confirm")?.open) {
      const panel = state.peek ? document.getElementById("related-peek") : detailRoot()?.querySelector(".detail-panel");
      const focusable = [...(panel?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])]
        .filter((node) => !node.hidden && node.getClientRects().length);
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    const filterTrigger = event.target.closest?.('[data-action="filter-menu-toggle"]');
    if (filterTrigger && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (state.filterMenu === filterTrigger.getAttribute("aria-controls")) closeFilterMenu();
      else openFilterMenu(filterTrigger, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    const filterOption = event.target.closest?.('[data-action="filter-menu-option"]');
    if (filterOption && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      moveFilterMenuOption(filterOption, event.key);
      return;
    }
    if (filterOption && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      filterOption.click();
      return;
    }
    const contactEditor = event.target.closest?.("[data-contact-editor]");
    if (contactEditor && event.key === "Escape") {
      event.preventDefault();
      cancelContactEdit(contactEditor.closest("[data-contact-row]"));
      return;
    }
    const textbookEditor = event.target.closest?.("[data-textbook-editor]");
    if ((textbookEditor || document.getElementById("textbook-layer")) && event.key === "Escape") {
      event.preventDefault();
      closeTextbookEdit();
      return;
    }
    if (event.key === "Escape" && state.filterMenu) {
      event.preventDefault();
      closeFilterMenu(true);
      return;
    }
    if (event.key === "Tab" && state.filterMenu) closeFilterMenu();
    // The first Esc in the box only closes the results; the browser's own Esc
    // (clear the box) waits for the second.
    if (event.key === "Escape" && event.target === searchInput() && !searchPanelNode()?.hidden) event.preventDefault();
    if (event.key === "Escape" && state.menu) {
      event.preventDefault();
      const opener = document.querySelector(`[aria-controls="${state.menu}"]`);
      closeMenu();
      opener?.focus();
      return;
    }
    if (state.preview?.kind === "epub" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      turnEpub(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (event.key === "Escape") {
      if ($("#action-confirm")?.open) return;
      if (state.preview) {
        event.preventDefault();
        closePreview();
        return;
      }
      if (state.peek) {
        event.preventDefault();
        closePeek();
        return;
      }
      if (state.detail) {
        event.preventDefault();
        closeDetailToBase();
        return;
      }
      // In the overlay, an Esc that has nothing else to close closes the overlay
      // (but not while it clears a filled-in search box).
      const busy = Boolean(state.menu || !searchPanelNode()?.hidden || (event.target === searchInput() && searchInput().value));
      closeMenu();
      closeSearchPanel();
      if (EMBEDDED && !busy) closeOverlay();
    }
    if (event.target === searchInput() && !searchPanelNode()?.hidden) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSearchOption(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      const picked = searchOptions()[liveSearch.active];
      if (event.key === "Enter" && picked) {
        event.preventDefault();
        closeSearchPanel();
        const href = picked.getAttribute("href");
        if (dash.isLayerRoute(href)) navigateToDetail(href, picked);
        else location.hash = href;
        return;
      }
    }
    const cell = event.target.closest?.("[data-action=select-day]");
    if (cell && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      cell.click();
    }
  });

  document.addEventListener("change", async (event) => {
    if (event.target.matches("[data-action=toggle-checklist]")) {
      await setChecklistDone(event.target.dataset.taskId, event.target.checked);
      render(location.hash);
      return;
    }
    if (event.target.matches("[data-action=nav-select]")) {
      location.hash = event.target.value;
      return;
    }
    if (event.target.matches("[data-action=pick-grade-course]")) {
      location.hash = `#/grades?course=${encodeURIComponent(event.target.value)}`;
      return;
    }
    if (event.target.matches("[data-action=set-reminder]")) {
      await saveSettings({ reminderHours: Number(event.target.value) });
      renderSyncStatus();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshIfStaleOnFocus();
  });
  globalThis.addEventListener?.("focus", refreshIfStaleOnFocus);

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (form.matches("[data-contact-editor]")) {
      event.preventDefault();
      const row = form.closest("[data-contact-row]");
      if (!row) return;
      const input = form.querySelector("input[name=value]");
      const courseId = row.dataset.courseId || "";
      const contactIndex = row.dataset.contactIndex || "0";
      const field = row.dataset.field || "";
      const value = String(input?.value || "").trim();
      let saved = false;
      if (field === "syllabus") {
        const mode = form.dataset.syllabusMode || "link";
        if (mode === "file") {
          if (!form.__syllabusFile) {
            toast("Choose a file to upload or click Cancel.");
            return;
          }
          saved = await saveSyllabusOverride(courseId, { type: "file", ...form.__syllabusFile });
        } else if (mode === "text") {
          const text = form.querySelector("textarea[name=syllabusText]")?.value || "";
          saved = await saveSyllabusOverride(courseId, { type: "text", text });
        } else {
          saved = await saveSyllabusOverride(courseId, value);
        }
      } else {
        if (!input) return;
        saved = await saveContactOverride(courseId, contactIndex, field, value);
      }
      if (!saved) {
        const focusTarget = form.querySelector("input, textarea") || form;
        focusTarget.focus();
        return;
      }
      render.keepScroll = true;
      await render();
      main()?.querySelector(`[data-contact-row][data-course-id="${CSS.escape(courseId)}"][data-contact-index="${CSS.escape(contactIndex)}"][data-field="${CSS.escape(field)}"] .instructor-edit`)?.focus({ preventScroll: true });
      return;
    }
    if (form.matches("[data-textbook-editor]")) {
      event.preventDefault();
      const courseId = form.dataset.courseId || "";
      const view = Number(form.dataset.entryIndex) >= 0 ? Number(form.dataset.entryIndex) : -1;
      const isLinkForm = form.dataset.kind === "link";
      const base = textbookEntriesFor(courseId).slice(0, dash.MAX_TEXTBOOK_ENTRIES);
      const previous = view >= 0 && view < base.length ? base[view] : null;
      let entry;
      if (isLinkForm) {
        const title = String(form.querySelector("input[name=linkTitle]")?.value || "").trim();
        if (!title) {
          toast("Type a name for the link first.");
          form.querySelector("input[name=linkTitle]")?.focus();
          return;
        }
        const url = dash.safeLinkUrl(String(form.querySelector("input[name=linkAddress]")?.value || "").trim());
        if (!url) {
          toast("Enter a web address, like website.com.");
          form.querySelector("input[name=linkAddress]")?.focus();
          return;
        }
        const iconLook = form.__linkState?.() || { tone: "violet", mode: "glyph", image: "" };
        entry = {
          kind: "link",
          title,
          meta: "",
          cover: iconLook.mode === "image" ? iconLook.image : "",
          tone: iconLook.tone,
          mark: iconLook.mode === "letter" ? "letter" : "",
          links: [{ title: "", url }]
        };
      } else {
        const title = String(form.querySelector("input[name=title]")?.value || "").trim();
        if (!title) {
          toast("Type a title for the item first.");
          form.querySelector("input[name=title]")?.focus();
          return;
        }
        const links = [];
        const typed = String(form.querySelector("input[name=linkUrl]")?.value || "").trim();
        if (typed) {
          const url = dash.safeLinkUrl(typed);
          if (!url) {
            toast("Enter a web address, like website.com.");
            form.querySelector("input[name=linkUrl]")?.focus();
            return;
          }
          links.push({ title: "View textbook", url });
        }
        entry = {
          kind: "book",
          title,
          meta: String(form.querySelector("input[name=meta]")?.value || "").trim(),
          cover: form.__coverState?.().cover || "",
          tone: form.__coverState?.().tone || "",
          ...(form.__bookFile?.() ? { file: form.__bookFile() } : {}),
          links
        };
      }
      if (view >= 0) base[view] = entry;
      else base.push(entry);
      if (await persistTextbookEntries(courseId, base)) {
        closeTextbookEdit();
        render.keepScroll = true;
        await render();
        toast(view >= 0 ? "Shelf item saved." : "Added to the shelf.");
      }
      return;
    }
    if (form.matches("[data-action=search]")) {
      event.preventDefault();
      closeSearchPanel();
      const query = String(new FormData(form).get("q") || "").trim();
      if (query) form.querySelector("input")?.blur();
      location.hash = query ? `#/search?q=${encodeURIComponent(query)}` : "#/search";
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target === searchInput()) queueLiveSearch(event.target.value);
  });
  // A related-item card opens above its pill. Near the right edge it aligns to
  // the pill's right side, and near the top of the scrolling pop-up it opens
  // below, so the scroll area never clips it.
  function placeRelatedCard(event) {
    const rel = event.target.closest?.(".rel");
    const tip = rel?.querySelector(".rel-tip");
    if (!tip) return;
    const box = rel.getBoundingClientRect();
    const areaTop = rel.closest(".detail-layer-scroll")?.getBoundingClientRect().top || 0;
    rel.classList.toggle("end", box.left + tip.offsetWidth > document.documentElement.clientWidth - 16);
    rel.classList.toggle("below", box.top - areaTop < tip.offsetHeight + 16);
  }
  document.addEventListener("mouseover", placeRelatedCard);
  document.addEventListener("focusin", placeRelatedCard);


  // Coming back to the box (focus, or a click while it already has focus)
  // reopens the results for what's in it.
  function reopenLiveSearch(event) {
    const query = event.target === searchInput() ? event.target.value.trim() : "";
    // No panel over the Search page when it already lists this query.
    const listed = location.hash.startsWith("#/search") && state.search.query === query;
    if (query && !listed && searchPanelNode()?.hidden) queueLiveSearch(query);
  }
  document.addEventListener("focusin", reopenLiveSearch);
  document.addEventListener("focusin", (event) => {
    if (state.filterMenu && !event.target.closest(".select")) closeFilterMenu();
  });
  document.addEventListener("click", reopenLiveSearch);

  // Date-box countdowns stay current while the page is open: once a minute
  // each box recounts from its deadline ("in 3h" becomes "in 2h").
  const countdownTimer = setInterval(() => {
    const now = new Date();
    for (const box of document.querySelectorAll(".datebox.flip[data-due]")) {
      const count = dash.countdown(box.dataset.due, now);
      const [word, number] = box.querySelectorAll(".cd > span");
      const unit = number?.querySelector(".unit");
      if (!count || !unit) continue;
      box.classList.toggle("late", count.late);
      word.textContent = count.late ? "late" : "in";
      number.firstChild.textContent = String(count.n);
      unit.textContent = count.letter;
    }
  }, 60 * 1000);
  countdownTimer?.unref?.();

  window.addEventListener("hashchange", () => {
    const next = dash.parseRoute(location.hash);
    if (!dash.isLayerRoute(next) && state.shownHash && main()) state.pageScrolls.set(state.shownHash, main().scrollTop);
    closeMenu();
    closeFilterMenu();
    closePreview();
    closeLinkConfirm({ restoreFocus: false });
    closeSearchPanel();
    rememberScreen();
    render();
  });
  window.addEventListener("resize", updateGradeCarouselControls);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderSyncStatus(); });

  Object.assign(mod, { markRead, closeMenu, filterMenuOptions, closeFilterMenu, openFilterMenu, moveFilterMenuOption, searchInput, searchPanelNode, searchOptions, showSearchPanel, closeSearchPanel, queueLiveSearch, runLiveSearch, moveSearchOption, saveSettings, syncModulesButton, reopenLiveSearch, LIVE_SEARCH_MS, liveSearch, countdownTimer });
})(globalThis);
