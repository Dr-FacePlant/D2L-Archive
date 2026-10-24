// Document event handlers, search, settings and confirmed actions.
(function initDashboardAppEvents(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { $, COURSE_OVERRIDES_KEY, EMBEDDED, READ_KEY, RECREATED_SEEN_KEY, SETTINGS_KEY, adoptLegacyArchive, api, backFromDetail, closeDetailToBase, closeLinkConfirm, closeOverlay, closePreview, detailRoot, exportActivity, fileScope, look, main, moveGradeCarousel, navigateToDetail, openArchivedFile, openConfirmedD2l, openConfirmedLink, previewConfirmedFile, previewFile, recordActivity, redrawAdoptNotice, refreshIfStaleOnFocus, rememberScreen, render, renderSyncStatus, saveLook, setChecklistDone, setDetailMore, setWorkMark, showFileOpen, showLinkConfirm, startSync, state, storageSet, toast, updateGradeCarouselControls, wait } = dash.appModules;
  // ------------------------------------------------------------- events

  function markRead(ids, value = true) {
    for (const id of ids) {
      if (value) state.read[id] = true;
      else delete state.read[id];
    }
    dash.accountBinding.saveScoped(chrome.storage.local, READ_KEY, state.account.id, state.read);
    if (state.detail) state.baseStale = true;
  }

  function closeMenu() {
    if (!state.menu) return;
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
    const url = dash.safeSyllabusUrl(value);
    if (value && !url) {
      toast("Enter a full web link that starts with http:// or https://.");
      return false;
    }
    const previous = state.courseContactOverrides || {};
    const course = { ...(previous[courseId] || {}) };
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
    if (field === "email") input.inputMode = "email";
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
    form.append(input, save, cancel);
    row.append(form);
    input.focus();
    input.select();
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
      closeOverlay();
      return;
    }
    // A saved file can be previewed here or opened on D2L. Its row stays an
    // anchor, so modified clicks still open the D2L original in a new tab.
    if (link && plain && link.hasAttribute("data-file-open")) {
      event.preventDefault();
      showFileOpen({
        path: link.getAttribute("data-path"),
        name: link.getAttribute("data-name") || "File",
        d2l: link.getAttribute("data-d2l") || link.href,
        download: link.getAttribute("data-download") || ""
      });
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

    const actionNode = event.target.closest("[data-action]");
    if (!actionNode) return;
    const action = actionNode.dataset.action;
    if (action === "edit-instructor") {
      beginContactEdit(actionNode.closest("[data-contact-row]"));
      return;
    }
    if (action === "cancel-instructor-edit") {
      cancelContactEdit(actionNode.closest("[data-contact-row]"));
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
    } else if (action === "preview-file") {
      previewFile(actionNode);
    } else if (action === "confirm-link") {
      openConfirmedLink();
    } else if (action === "preview-confirmed-file") {
      previewConfirmedFile();
    } else if (action === "open-confirmed-d2l") {
      openConfirmedD2l();
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
      const panel = detailRoot()?.querySelector(".detail-panel");
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
    if (event.key === "Escape" && state.filterMenu) {
      event.preventDefault();
      closeFilterMenu(true);
      return;
    }
    if (event.key === "Tab" && state.filterMenu) closeFilterMenu();
    // The first Esc in the box only closes the results; the browser's own Esc
    // (clear the box) waits for the second.
    if (event.key === "Escape" && event.target === searchInput() && !searchPanelNode()?.hidden) event.preventDefault();
    if (event.key === "Escape") {
      if ($("#action-confirm")?.open) return;
      if (state.preview) {
        event.preventDefault();
        closePreview();
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
      const input = form.querySelector("input[name=value]");
      if (!row || !input) return;
      const courseId = row.dataset.courseId || "";
      const contactIndex = row.dataset.contactIndex || "0";
      const field = row.dataset.field || "";
      const value = String(input.value || "").trim();
      const saved = field === "syllabus"
        ? await saveSyllabusOverride(courseId, value)
        : await saveContactOverride(courseId, contactIndex, field, value);
      if (!saved) {
        input.focus();
        return;
      }
      render.keepScroll = true;
      await render();
      main()?.querySelector(`[data-contact-row][data-course-id="${CSS.escape(courseId)}"][data-contact-index="${CSS.escape(contactIndex)}"][data-field="${CSS.escape(field)}"] .instructor-edit`)?.focus({ preventScroll: true });
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
