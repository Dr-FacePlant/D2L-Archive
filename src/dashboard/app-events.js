// Document event handlers, search, settings and confirmed actions.
(function initDashboardAppEvents(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const {
    $, EMBEDDED, READ_KEY, SETTINGS_KEY, closeDetailToBase, closeFilterMenu,
    closeMenu, closePeek, closePreview, closeSearchPanel, handleActionClick,
    handleContactSubmit, handleTextbookSubmit, main, moveFilterMenuOption,
    moveGradeCarousel, moveSearchOption, navigateToDetail, openFilterMenu,
    peekLeaving, previewFile, queueLiveSearch, render, reopenLiveSearch,
    saveLook, searchInput, searchOptions, searchPanelNode, setChecklistDone,
    setDetailMore, showAccountView, showLinkConfirm, state, storageSet,
    turnEpub, updateGradeCarouselControls
  } = mod;

  function markRead(ids, value = true) {
    for (const id of ids) {
      if (value) state.read[id] = true;
      else delete state.read[id];
    }
    dash.accountBinding.saveScoped(chrome.storage.local, READ_KEY, state.account.id, state.read);
    if (state.detail) state.baseStale = true;
  }

  async function saveSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    await storageSet(SETTINGS_KEY, state.settings);
  }

  function syncModulesButton() {
    const list = [...main().querySelectorAll("details.module:not(.pinned)")];
    const button = main().querySelector("[data-action=modules]");
    if (!button || !list.length) return;
    const allOpen = list.every((node) => node.open);
    button.dataset.open = allOpen ? "false" : "true";
    button.textContent = allOpen ? "Collapse all" : "Expand all";
  }

  function placeRelatedCard(event) {
    const pill = event.target.closest?.(".rel");
    const tip = pill?.querySelector?.(".rel-tip");
    if (!tip) return;
    tip.classList.remove("tip-flip");
    const tipBox = tip.getBoundingClientRect();
    const margin = 16;
    if (tipBox.right > window.innerWidth - margin) tip.classList.add("tip-flip");
  }

  function handleMenuToggleClick(toggle) {
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
  }

  function handleLinkClick(event, link) {
    if (link.hasAttribute("data-preview")) {
      event.preventDefault();
      previewFile(link);
      return true;
    }
    if (dash.isOutboundLink(link.getAttribute("href"))) {
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
      return true;
    }
    if (dash.isLayerRoute(link.getAttribute("href"))) {
      event.preventDefault();
      navigateToDetail(link.getAttribute("href"), link);
      return true;
    }
    return false;
  }

  document.addEventListener("click", async (event) => {
    const link = event.target.closest("a[href]");
    const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    const flip = event.target.closest("[data-action=flip-date]");
    if (flip) {
      event.preventDefault();
      flip.classList.toggle("flipped");
      return;
    }
    if (EMBEDDED && event.target.closest("[data-action=close-overlay]")) { closeMenu(); mod.closeOverlay(); return; }
    if (link && plain && handleLinkClick(event, link)) return;
    const toggle = event.target.closest("[data-menu-toggle]");
    if (toggle) { handleMenuToggleClick(toggle); return; }
    if (state.menu && !event.target.closest(".menu")) closeMenu();
    if (state.filterMenu && !event.target.closest(".select")) closeFilterMenu();
    if (!event.target.closest(".topbar-spacer")) closeSearchPanel();
    const dot = event.target.closest(".chart-dot");
    if (dot && matchMedia("(hover: none)").matches && !dot.classList.contains("show")) {
      event.preventDefault();
      for (const other of document.querySelectorAll(".chart-dot.show")) other.classList.remove("show");
      dot.classList.add("show");
      return;
    }
    if (event.target.id === "textbook-layer") { mod.closeTextbookEdit(); return; }
    const actionNode = event.target.closest("[data-action]");
    if (actionNode) await handleActionClick(actionNode, actionNode.dataset.action, event);
  });

  document.addEventListener("toggle", (event) => {
    if (event.target.matches("details.module:not(.pinned)")) syncModulesButton();
  }, true);

  function handleFilterMenuKeydown(event) {
    const focusedOption = document.activeElement?.closest('[role="option"]');
    if (event.key === "Escape") { event.preventDefault(); closeFilterMenu(true); return true; }
    if (focusedOption && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      moveFilterMenuOption(focusedOption, event.key);
      return true;
    }
    return false;
  }

  function handleSearchKeydown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSearchOption(event.key === "ArrowDown" ? 1 : -1);
      return true;
    }
    if (event.key === "Enter") {
      const active = searchOptions().find((option) => option.getAttribute("aria-selected") === "true");
      if (active) {
        event.preventDefault();
        closeSearchPanel();
        location.hash = active.dataset.href;
        return true;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel();
      searchInput()?.blur();
      return true;
    }
    return false;
  }

  function handleGlobalShortcuts(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      closeMenu();
      const input = searchInput();
      input?.focus();
      input?.select();
      return true;
    }
    if (event.key === "Escape") {
      if (state.peek) {
        event.preventDefault();
        closePeek();
        return;
      }
      if (state.detail) { closeDetailToBase(); return; }
      if (event.key === "Escape" && state.menu) { closeMenu(); return; }
      const textbookEditor = document.querySelector("[data-textbook-editor]");
      if (textbookEditor || document.getElementById("textbook-layer")) { mod.closeTextbookEdit(); return; }
    }
    return false;
  }

  document.addEventListener("keydown", (event) => {
    if (state.filterMenu && handleFilterMenuKeydown(event)) return;
    if (document.activeElement === searchInput() && handleSearchKeydown(event)) return;
    if (event.key === "Tab" && state.detail && !state.preview && !document.getElementById("action-confirm")?.open) {
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
    if (handleGlobalShortcuts(event)) return;
    const trigger = event.target.closest?.("[data-action=filter-menu-toggle]");
    if (trigger && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      openFilterMenu(trigger, event.key === "ArrowDown" ? 1 : -1);
    }
  });

  document.addEventListener("change", async (event) => {
    const target = event.target;
    if (target.matches("input[type=checkbox][data-action=toggle-checklist]")) {
      setChecklistDone(target.dataset.entityId, target.checked);
      if (state.detail) state.baseStale = true;
      return;
    }
    if (target.matches("input[type=checkbox][data-setting]")) {
      const key = target.dataset.setting;
      await saveSettings({ [key]: target.checked });
      render.keepScroll = true;
      render();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) mod.refreshIfStaleOnFocus();
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (form.matches("[data-contact-editor]")) { await handleContactSubmit(form, event); return; }
    if (form.matches("[data-textbook-editor]")) { await handleTextbookSubmit(form, event); return; }
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

  document.addEventListener("mouseover", placeRelatedCard);
  document.addEventListener("focusin", placeRelatedCard);
  document.addEventListener("focusin", reopenLiveSearch);
  document.addEventListener("focusin", (event) => {
    if (state.menu && !event.target.closest(".menu") && !event.target.closest("[data-menu-toggle]")) closeMenu();
  });
  document.addEventListener("click", reopenLiveSearch);

  window.addEventListener("hashchange", () => {
    closeMenu();
    closeFilterMenu();
    closeSearchPanel();
    mod.rememberScreen(location.hash);
    if (state.peek) closePeek({ restoreFocus: false });
    if (state.detail) {
      if (dash.isLayerRoute(location.hash)) render(location.hash);
      else closeDetailToBase({ navigate: false });
    } else {
      render(location.hash);
    }
  });

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

  window.addEventListener("resize", updateGradeCarouselControls);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderSyncStatus(); });

  Object.assign(mod, { markRead, saveSettings, syncModulesButton, placeRelatedCard, countdownTimer });
})(typeof window !== "undefined" ? window : globalThis);
