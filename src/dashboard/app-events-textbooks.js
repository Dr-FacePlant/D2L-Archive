// Course textbook shelf modal editor and row component builders.
(function initDashboardAppEventsTextbooks(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { closeAllTextbookEdits, handleCoverFile, state, textbookEntriesFor, toast } = mod;

  const el = (tag, cls = "", txt = "") => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt) e.textContent = txt;
    return e;
  };

  function buildTextbookField(name, placeholder, label, value, mode) {
    const wrap = el("label", "textbook-field");
    const input = el("input", "instructor-edit-input");
    input.name = name;
    input.type = "text";
    input.value = value || "";
    input.autocomplete = "off";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", label);
    if (mode) input.inputMode = mode;
    wrap.append(el("span", "", label), input);
    return wrap;
  }

  function setupFileInput(fileInput, fileText, fileRemove, setFile) {
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
        const bookFile = dash.safeBookFile?.(chosen) || null;
        if (!bookFile) toast("Couldn't read that file.");
        setFile(bookFile);
      };
      reader.readAsDataURL(file);
    });
  }

  function buildBookFileRow(form, existing) {
    let bookFile = existing?.kind !== "link" ? existing?.file || null : null;
    const fileField = el("div", "textbook-field");
    const fileRow = el("div", "textbook-file-row");
    const filePicker = el("label", "textbook-file-picker-label");
    const fileInput = el("input", "sr-only");
    fileInput.type = "file";
    fileInput.accept = ".pdf,.epub,application/pdf,application/epub+zip";
    const fileText = el("span", "textbook-file-chosen-text");
    const fileRemove = el("button", "link-icon-chip", "Remove");
    fileRemove.type = "button";
    const paintFile = () => { fileText.textContent = bookFile ? bookFile.name : "Choose a file…"; fileRemove.hidden = !bookFile; };
    setupFileInput(fileInput, fileText, fileRemove, (f) => { bookFile = f; paintFile(); });
    fileRemove.addEventListener("click", () => { bookFile = null; paintFile(); });
    filePicker.append(fileInput, fileText);
    fileRow.append(filePicker, fileRemove);
    fileField.append(el("span", "", "Attach a PDF or EPUB (optional)"), fileRow);
    form.__bookFile = () => bookFile;
    paintFile();
    return fileField;
  }

  function paintBookCoverArt(coverPreview, coverMode, coverImage, coverTone, course, bookPane) {
    coverPreview.replaceChildren();
    if (coverMode === "image" && coverImage) {
      const img = el("img", "textbook-cover-img");
      img.alt = "";
      img.src = coverImage;
      coverPreview.append(img);
    } else {
      const art = el("span", `textbook-cover-default${coverTone ? ` tone-${coverTone}` : ""}`);
      if (!coverTone && course.tint) art.style.background = course.tint;
      if (!coverTone && course.ink) art.style.color = course.ink;
      const title = el("span", "tc-title", String(bookPane.querySelector("input[name=title]")?.value || "").trim() || "Title");
      const mark = el("span");
      mark.innerHTML = dash.icon("book", 11, 'class="tc-mark"');
      art.append(el("span", "tc-spine"), title, mark.firstChild);
      coverPreview.append(art);
    }
  }

  function makeCoverSwatches(coverSwatchRow, sameAsCourse, coverTone, onPick) {
    const swatches = {};
    for (const name of ["", ...(dash.TEXTBOOK_LINK_TONES || [])]) {
      if (sameAsCourse && (name === "" ? coverTone === sameAsCourse : name === sameAsCourse && coverTone !== sameAsCourse)) continue;
      const swatch = el("button", name ? `link-swatch tone-${name}` : "link-swatch is-course");
      swatch.type = "button";
      swatch.title = name ? name[0].toUpperCase() + name.slice(1) : "Course color";
      swatch.setAttribute("aria-label", `${swatch.title} cover`);
      swatch.addEventListener("click", () => onPick(name));
      swatches[name] = swatch;
      coverSwatchRow.append(swatch);
    }
    return swatches;
  }

  function buildBookCoverRow(bookPane, course, existing, form) {
    const coverWrap = el("div", "textbook-field");
    const coverRow = el("div", "link-icon-row");
    const coverPreview = el("span", "textbook-frame is-preview");
    const coverControls = el("div", "link-icon-controls");
    const coverModes = el("div", "link-icon-modes");
    const coverSwatchRow = el("div", "link-swatches");
    let coverImage = existing?.kind !== "link" ? existing?.cover || "" : "";
    let coverMode = coverImage ? "image" : "default";
    let coverTone = existing?.kind !== "link" ? existing?.tone || "" : "";
    const defaultChip = el("button", "link-icon-chip", "Default book");
    defaultChip.type = "button";
    defaultChip.addEventListener("click", () => { coverMode = "default"; paintCover(); });
    const coverUpload = el("label", "link-icon-chip");
    const coverInput = el("input", "syllabus-file-input sr-only");
    coverInput.type = "file";
    coverInput.accept = "image/png,image/jpeg,image/webp,image/gif";
    coverUpload.append(coverInput, document.createTextNode("Upload image"));
    coverInput.addEventListener("change", () => {
      handleCoverFile(coverInput, (url) => { coverImage = url; coverMode = "image"; paintCover(); });
    });
    coverModes.append(defaultChip, coverUpload);
    const swatches = makeCoverSwatches(coverSwatchRow, dash.toneMatchingTint?.(course.tint) || "", coverTone, (name) => {
      coverTone = name; coverMode = "default"; paintCover();
    });
    const paintCover = () => {
      paintBookCoverArt(coverPreview, coverMode, coverImage, coverTone, course, bookPane);
      const activeMode = coverMode === "image" && !coverImage ? "default" : coverMode;
      defaultChip.classList.toggle("is-on", activeMode === "default");
      coverUpload.classList.toggle("is-on", activeMode === "image");
      coverSwatchRow.hidden = activeMode === "image";
      for (const [name, swatch] of Object.entries(swatches)) {
        swatch.classList.toggle("is-on", name === coverTone);
        swatch.setAttribute("aria-pressed", String(name === coverTone));
      }
    };
    bookPane.addEventListener("input", paintCover);
    coverControls.append(coverModes, coverSwatchRow);
    coverRow.append(coverPreview, coverControls);
    coverWrap.append(el("span", "", "Cover"), coverRow);
    form.__coverState = () => ({ cover: coverMode === "image" ? coverImage : "", tone: coverMode === "image" ? "" : coverTone });
    paintCover();
    return coverWrap;
  }

  function paintLinkTileArt(preview, mode, image, tone, linkPane) {
    preview.className = `link-tile is-preview tone-${tone}`;
    preview.replaceChildren();
    if (mode === "image" && image) {
      const img = el("img", "textbook-cover-img");
      img.alt = "";
      img.src = image;
      preview.append(img);
    } else if (mode === "letter") {
      const letter = el("span", "link-tile-letter");
      letter.textContent = Array.from(String(linkPane.querySelector("input[name=linkTitle]")?.value || "").trim())[0]?.toUpperCase() || "?";
      preview.append(letter);
    } else {
      preview.innerHTML = dash.icon("link", 24);
    }
  }

  function makeLinkSwatches(swatchRow, onPick) {
    const swatches = {};
    for (const name of dash.TEXTBOOK_LINK_TONES || []) {
      const swatch = el("button", `link-swatch tone-${name}`);
      swatch.type = "button";
      swatch.title = name[0].toUpperCase() + name.slice(1);
      swatch.setAttribute("aria-label", `${swatch.title} tile`);
      swatch.addEventListener("click", () => onPick(name));
      swatches[name] = swatch;
      swatchRow.append(swatch);
    }
    return swatches;
  }

  function buildLinkIconRow(linkPane, existing, form) {
    const isLink = existing?.kind === "link";
    let tone = isLink ? existing.tone || "violet" : "violet";
    let mode = isLink && existing.cover ? "image" : isLink && existing.mark === "letter" ? "letter" : "glyph";
    let image = isLink ? existing.cover || "" : "";
    const iconWrap = el("div", "textbook-field");
    const iconRow = el("div", "link-icon-row");
    const preview = el("span", "link-tile is-preview");
    const iconControls = el("div", "link-icon-controls");
    const modeRow = el("div", "link-icon-modes");
    const swatchRow = el("div", "link-swatches");
    const modeButtons = {};
    const chip = (name, label) => {
      const btn = el("button", "link-icon-chip", label);
      btn.type = "button";
      btn.addEventListener("click", () => { mode = name; paint(); });
      modeButtons[name] = btn;
      return btn;
    };
    const uploadChip = el("label", "link-icon-chip");
    const uploadInput = el("input", "syllabus-file-input sr-only");
    uploadInput.type = "file";
    uploadInput.accept = "image/png,image/jpeg,image/webp,image/gif";
    uploadChip.append(uploadInput, document.createTextNode("Upload image"));
    modeButtons.image = uploadChip;
    uploadInput.addEventListener("change", () => {
      handleCoverFile(uploadInput, (url) => { image = url; mode = "image"; paint(); });
    });
    modeRow.append(chip("glyph", "Link icon"), chip("letter", "First letter"), uploadChip);
    const swatches = makeLinkSwatches(swatchRow, (t) => { tone = t; paint(); });
    const paint = () => {
      paintLinkTileArt(preview, mode, image, tone, linkPane);
      for (const [name, button] of Object.entries(modeButtons)) {
        button.classList.toggle("is-on", name === (mode === "image" && !image ? "glyph" : mode));
      }
      for (const [name, swatch] of Object.entries(swatches)) {
        swatch.classList.toggle("is-on", name === tone);
        swatch.setAttribute("aria-pressed", String(name === tone));
      }
    };
    linkPane.addEventListener("input", paint);
    iconControls.append(modeRow, swatchRow);
    iconRow.append(preview, iconControls);
    iconWrap.append(el("span", "", "Icon"), iconRow);
    form.__linkState = () => ({ tone, mode: mode === "image" && !image ? "glyph" : mode, image });
    paint();
    return iconWrap;
  }

  function buildKindTabs(form, bookPane, linkPane) {
    const tabs = el("div", "textbook-kind-tabs");
    tabs.setAttribute("role", "tablist");
    const tabButtons = {};
    const setKind = (next) => {
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
      const button = el("button", "", label);
      button.type = "button";
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => setKind(name));
      tabButtons[name] = button;
      tabs.append(button);
    }
    tabButtons.book.classList.add("is-on");
    tabButtons.book.setAttribute("aria-selected", "true");
    tabButtons.link.setAttribute("aria-selected", "false");
    return tabs;
  }
  function buildTextbookModalHeader(course, existing) {
    const head = el("div", "textbook-panel-head");
    const titleEl = el("b", "", existing ? (existing.kind === "link" ? "Edit link" : "Edit textbook") : "Add textbook or link");
    titleEl.id = "textbook-layer-title";
    const sub = el("span", "panel-sub", ["Textbooks & Links", course.label || ""].filter(Boolean).join(" · "));
    const closeBtn = el("button", "icon-btn");
    closeBtn.type = "button";
    closeBtn.dataset.action = "cancel-textbook-edit";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = dash.icon("close", 16);
    const heading = el("div");
    heading.append(titleEl, sub);
    head.append(heading, closeBtn);
    return head;
  }
  function buildTextbookEditorActions(formId, existing) {
    const actions = el("div", "textbook-editor-actions");
    const save = el("button", "btn btn-primary instructor-save", "Save");
    save.type = "submit";
    save.setAttribute("form", formId);
    const cancel = el("button", "btn instructor-cancel", "Cancel");
    cancel.type = "button";
    cancel.dataset.action = "cancel-textbook-edit";
    actions.append(cancel, save);
    if (existing) {
      const remove = el("button", "btn instructor-cancel", "Remove");
      remove.type = "button";
      remove.dataset.action = "remove-textbook";
      actions.prepend(remove);
    }
    return actions;
  }
  function buildTextbookEditorForm(courseId, entryIndex, existing, course) {
    const form = el("form", "textbook-editor");
    form.id = "textbook-editor-form";
    form.dataset.textbookEditor = "";
    form.dataset.courseId = courseId;
    form.dataset.entryIndex = String(entryIndex);
    if (existing) form.__textbookEntry = existing;
    const kind = existing?.kind === "link" ? "link" : "book";
    form.dataset.kind = kind;

    const bookPane = el("div", "textbook-pane");
    bookPane.hidden = kind !== "book";
    bookPane.append(buildTextbookField("title", "Type the title, like World of Art", "Title", existing?.title));
    bookPane.append(buildTextbookField("meta", "Edition, author, type — optional", "Details (optional)", existing?.meta));
    bookPane.append(buildTextbookField("linkUrl", "website.com", "URL (optional)", existing?.links?.[0]?.url, "url"));
    bookPane.append(buildBookFileRow(form, existing));
    bookPane.append(buildBookCoverRow(bookPane, course, existing, form));

    const linkPane = el("div", "textbook-pane");
    linkPane.hidden = kind !== "link";
    const isLink = existing?.kind === "link";
    linkPane.append(
      buildTextbookField("linkTitle", "Type a name, like Class Portal", "Title", isLink ? existing.title : ""),
      buildTextbookField("linkAddress", "website.com", "URL", isLink ? existing.links?.[0]?.url : "", "url")
    );
    linkPane.append(buildLinkIconRow(linkPane, existing, form));

    if (!existing) form.append(buildKindTabs(form, bookPane, linkPane));
    form.append(bookPane, linkPane);
    return form;
  }

  function beginTextbookEdit(courseId, entryIndex) {
    if (!courseId) return;
    closeAllTextbookEdits();
    const entries = textbookEntriesFor(courseId);
    const existing = entryIndex >= 0 && entryIndex < entries.length ? entries[entryIndex] : null;
    const course = state.index?.courseById?.get(courseId) || {};
    const layer = el("div", "textbook-layer");
    layer.id = "textbook-layer";
    const panel = el("div", "textbook-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "textbook-layer-title");
    panel.append(buildTextbookModalHeader(course, existing));

    const form = buildTextbookEditorForm(courseId, entryIndex, existing, course);
    panel.append(form, buildTextbookEditorActions(form.id, existing));
    layer.append(panel);
    document.body.append(layer);
    form.querySelector(form.dataset.kind === "link" ? "input[name=linkTitle]" : "input[name=title]")?.focus();
  }

  Object.assign(mod, {
    beginTextbookEdit, buildTextbookField, buildBookFileRow, buildBookCoverRow,
    buildLinkIconRow, buildKindTabs
  });
})(typeof window !== "undefined" ? window : globalThis);
