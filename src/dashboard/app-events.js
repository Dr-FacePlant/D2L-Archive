// Document event handlers, search, settings and confirmed actions.
(function initDashboardAppEvents(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { $, EMBEDDED, READ_KEY, RECREATED_SEEN_KEY, SETTINGS_KEY, adoptLegacyArchive, api, backFromDetail, closeDetailToBase, closeOverlay, closePreview, detailRoot, exportActivity, fileScope, look, main, moveGradeCarousel, navigateToDetail, openArchivedFile, openInD2l, previewFile, redrawAdoptNotice, refreshIfStaleOnFocus, rememberScreen, render, renderSyncStatus, saveLook, setChecklistDone, setWorkMark, startSync, state, storageSet, toast, updateGradeCarouselControls, wait } = dash.appModules;
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
    if (EMBEDDED) {
      if (event.target.closest("[data-action=close-overlay]")) {
        closeOverlay();
        return;
      }
      // A plain click on a D2L link shows that page in this tab; Ctrl/Cmd-click
      // and middle-click still open a new tab.
      if (link && plain && dash.embeddedLinkTarget(link.getAttribute("href")) === "d2l") {
        event.preventDefault();
        openInD2l(link.href);
        return;
      }
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
    if (action === "copy-instructor") {
      const value = actionNode.dataset.copyValue || "";
      const label = actionNode.dataset.copyLabel || "instructor information";
      const text = actionNode.querySelector(".copy-label");
      if (!value || !text) return;
      clearTimeout(actionNode.copyFeedbackTimer);
      await copyToClipboard(value).then(() => {
        text.textContent = "Copied";
        actionNode.setAttribute("aria-label", `Copied ${label}`);
      }).catch(() => {
        text.textContent = "Failed";
        actionNode.setAttribute("aria-label", `Couldn't copy ${label}`);
      });
      actionNode.copyFeedbackTimer = setTimeout(() => {
        if (!actionNode.isConnected) return;
        text.textContent = "Copy";
        actionNode.setAttribute("aria-label", `Copy ${label}`);
      }, 1400);
    } else if (action === "nav") {
      const href = actionNode.dataset.href;
      if (dash.isLayerRoute(href)) navigateToDetail(href, actionNode);
      else location.hash = href;
    } else if (action === "export-activity") {
      await exportActivity(actionNode.dataset.format || "json").catch((error) => toast(`Activity export failed: ${error.message}`));
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
    closeSearchPanel();
    rememberScreen();
    render();
  });
  window.addEventListener("resize", updateGradeCarouselControls);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderSyncStatus(); });

  Object.assign(mod, { markRead, closeMenu, filterMenuOptions, closeFilterMenu, openFilterMenu, moveFilterMenuOption, searchInput, searchPanelNode, searchOptions, showSearchPanel, closeSearchPanel, queueLiveSearch, runLiveSearch, moveSearchOption, saveSettings, syncModulesButton, reopenLiveSearch, LIVE_SEARCH_MS, liveSearch, countdownTimer });
})(globalThis);
