// Account menu, filter menus and live search dropdown.
(function initDashboardAppEventsMenu(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { state, api } = mod;

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

  // ---- live search: results open under the top-bar box as you type.
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
    state.search = { query, result: { ...result, query }, pending: false };
    showSearchPanel(dash.searchPanel(dash.searchPanelModel(dash.searchModel(state.index, state.search.result)), false));
  }

  function moveSearchOption(step) {
    const options = searchOptions();
    if (!options.length) return;
    options[liveSearch.active]?.setAttribute("aria-selected", "false");
    options[liveSearch.active]?.classList.remove("active");
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

  function reopenLiveSearch(event) {
    if (!event.target.closest?.(".topbar-spacer")) return;
    const query = String(searchInput()?.value || "").trim();
    if (query && searchPanelNode()?.hidden) queueLiveSearch(query);
  }

  Object.assign(mod, {
    showAccountView, closeMenu, filterMenuOptions, closeFilterMenu, openFilterMenu,
    moveFilterMenuOption, searchInput, searchPanelNode, searchOptions, showSearchPanel,
    closeSearchPanel, queueLiveSearch, runLiveSearch, moveSearchOption, reopenLiveSearch
  });
})(typeof window !== "undefined" ? window : globalThis);
