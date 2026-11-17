// Course textbook shelf queries, persistence, form submission and shelf item builders.
(function initDashboardAppEventsShelf(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { COURSE_TEXTBOOKS_KEY, render, state, toast } = mod;

  function textbookEntriesFor(courseId) {
    const saved = state.courseTextbooks?.[courseId]?.entries;
    if (saved) return saved.slice(0, dash.MAX_TEXTBOOK_ENTRIES);
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

  function handleCoverFile(coverInput, callback) {
    const file = coverInput.files?.[0];
    coverInput.value = "";
    if (!file) return;
    if (file.size > dash.TEXTBOOK_IMAGE_BYTES_LIMIT) {
      toast("That image is over 5 MB. Choose a smaller one.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const side = dash.TEXTBOOK_IMAGE_MAX_EDGE;
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > side || h > side) {
          const s = Math.min(side / w, side / h);
          w = Math.round(w * s);
          h = Math.round(h * s);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        callback(canvas.toDataURL("image/webp", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function buildLinkEntry(form) {
    const title = String(form.querySelector("input[name=linkTitle]")?.value || "").trim();
    if (!title) { toast("Type a name for the link first."); form.querySelector("input[name=linkTitle]")?.focus(); return null; }
    const url = dash.safeLinkUrl(String(form.querySelector("input[name=linkAddress]")?.value || "").trim());
    if (!url) { toast("Enter a web address, like website.com."); form.querySelector("input[name=linkAddress]")?.focus(); return null; }
    const iconLook = form.__linkState?.() || { tone: "violet", mode: "glyph", image: "" };
    return {
      kind: "link", title, meta: "",
      cover: iconLook.mode === "image" ? iconLook.image : "",
      tone: iconLook.tone,
      mark: iconLook.mode === "letter" ? "letter" : "",
      links: [{ title: "", url }]
    };
  }

  function buildBookEntry(form) {
    const title = String(form.querySelector("input[name=title]")?.value || "").trim();
    if (!title) { toast("Type a title for the item first."); form.querySelector("input[name=title]")?.focus(); return null; }
    const links = [];
    const typed = String(form.querySelector("input[name=linkUrl]")?.value || "").trim();
    if (typed) {
      const url = dash.safeLinkUrl(typed);
      if (!url) { toast("Enter a web address, like website.com."); form.querySelector("input[name=linkUrl]")?.focus(); return null; }
      links.push({ title: "View textbook", url });
    }
    return {
      kind: "book", title,
      meta: String(form.querySelector("input[name=meta]")?.value || "").trim(),
      cover: form.__coverState?.().cover || "",
      tone: form.__coverState?.().tone || "",
      ...(form.__bookFile?.() ? { file: form.__bookFile() } : {}),
      links
    };
  }

  async function handleTextbookSubmit(form, event) {
    event.preventDefault();
    const courseId = form.dataset.courseId || "";
    const view = Number(form.dataset.entryIndex) >= 0 ? Number(form.dataset.entryIndex) : -1;
    const isLinkForm = form.dataset.kind === "link";
    const base = textbookEntriesFor(courseId).slice(0, dash.MAX_TEXTBOOK_ENTRIES);
    const entry = isLinkForm ? buildLinkEntry(form) : buildBookEntry(form);
    if (!entry) return;
    if (view >= 0) base[view] = entry;
    else base.push(entry);
    if (await persistTextbookEntries(courseId, base)) {
      closeTextbookEdit();
      render.keepScroll = true;
      await render();
      toast(view >= 0 ? "Shelf item saved." : "Added to the shelf.");
    }
  }

  Object.assign(mod, {
    textbookEntriesFor, persistTextbookEntries, closeTextbookEdit,
    closeAllTextbookEdits, handleCoverFile, buildLinkEntry, buildBookEntry, handleTextbookSubmit
  });
})(typeof window !== "undefined" ? window : globalThis);
