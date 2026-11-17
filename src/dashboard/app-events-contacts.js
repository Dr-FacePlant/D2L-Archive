// Course contact overrides, syllabus editor and contact edit import/export.
(function initDashboardAppEventsContacts(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { COURSE_OVERRIDES_KEY, blobFromDataUrl, main, recordActivity, render, showPreview, state, toast } = mod;

  const CONTACT_FIELD_LABELS = Object.freeze({ name: "instructor name", email: "instructor email", officeHours: "office hours", syllabus: "syllabus link" });

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

  function resolveSyllabusObject(value, course) {
    if (value.type === "text") {
      const text = String(value.text || "").trim();
      if (text) course.syllabus = { type: "text", title: "Custom syllabus", text };
      else delete course.syllabus;
    } else if (value.type === "file" && value.dataUrl) {
      course.syllabus = { type: "file", title: value.name || "Syllabus", name: value.name || "Syllabus", mime: value.mime || "application/pdf", dataUrl: value.dataUrl };
    } else {
      delete course.syllabus;
    }
  }

  async function saveSyllabusOverride(courseId, value) {
    const previous = state.courseContactOverrides || {};
    const course = { ...(previous[courseId] || {}) };
    if (value && typeof value === "object") {
      resolveSyllabusObject(value, course);
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

  async function applyImportedContacts(file) {
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
      if (file) await applyImportedContacts(file);
    });
    document.body.append(input);
    input.click();
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

  function cancelContactEdit(row) {
    if (!row?.__instructorHTML) return;
    row.innerHTML = row.__instructorHTML;
    delete row.__instructorHTML;
    row.querySelector(".instructor-edit")?.focus();
  }

  function buildContactFieldInput(field, label, value) {
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
    return input;
  }

  function buildSyllabusFilePicker(form, save, cancel) {
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
        form.__syllabusFile = { name: file.name, mime: file.type || "application/pdf", dataUrl: reader.result };
      };
      reader.readAsDataURL(file);
    });
    form.append(fileWrap, save, cancel);
    fileInput.focus();
  }

  function openSyllabusModeEditor(form, mode, input, save, cancel, value) {
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
      buildSyllabusFilePicker(form, save, cancel);
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
  }

  function buildSyllabusChipsRow(form, input, save, cancel, value) {
    form.classList.add("is-syllabus-chips-row");
    const chipsWrap = document.createElement("div");
    chipsWrap.className = "syllabus-choice-chips";
    const makeChip = (label, iconName) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "syllabus-chip-btn";
      btn.innerHTML = `${dash.icon(iconName, 14)}<span>${label}</span>`;
      return btn;
    };
    const btnLink = makeChip("Link", "link");
    const btnFile = makeChip("File", "file");
    const btnText = makeChip("Text", "pencil");
    chipsWrap.append(btnLink, btnFile, btnText);
    const cancelRowBtn = document.createElement("button");
    cancelRowBtn.type = "button";
    cancelRowBtn.className = "instructor-cancel syllabus-cancel-icon";
    cancelRowBtn.dataset.action = "cancel-instructor-edit";
    cancelRowBtn.setAttribute("aria-label", "Cancel edit");
    cancelRowBtn.innerHTML = dash.icon("close", 14);
    form.append(chipsWrap, cancelRowBtn);
    btnLink.addEventListener("click", () => openSyllabusModeEditor(form, "link", input, save, cancel, value));
    btnFile.addEventListener("click", () => openSyllabusModeEditor(form, "file", input, save, cancel, value));
    btnText.addEventListener("click", () => openSyllabusModeEditor(form, "text", input, save, cancel, value));
    return btnLink;
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
    const input = buildContactFieldInput(field, label, value);
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
      const btnLink = buildSyllabusChipsRow(form, input, save, cancel, value);
      row.append(form);
      btnLink.focus();
    } else {
      form.append(input, save, cancel);
      row.append(form);
      input.focus();
      input.select();
    }
  }

  async function handleContactSubmit(form, event) {
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
        if (!form.__syllabusFile) { toast("Choose a file to upload or click Cancel."); return; }
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
    if (!saved) { (form.querySelector("input, textarea") || form).focus(); return; }
    render.keepScroll = true;
    await render();
    main()?.querySelector(`[data-contact-row][data-course-id="${CSS.escape(courseId)}"][data-contact-index="${CSS.escape(contactIndex)}"][data-field="${CSS.escape(field)}"] .instructor-edit`)?.focus({ preventScroll: true });
  }

  Object.assign(mod, {
    persistContactOverrides, saveContactOverride, saveSyllabusOverride,
    exportContactEdits, importContactEdits, copyToClipboard, cancelContactEdit,
    beginContactEdit, handleContactSubmit
  });
})(typeof window !== "undefined" ? window : globalThis);
