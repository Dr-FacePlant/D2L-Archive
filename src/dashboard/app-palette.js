// The search pop-up. Opens from the top-bar button or Cmd/Ctrl+K, searches the
// archive as you type, opens a result, or hands the typed words to the Ask
// screen. Read-only: it only calls search.query and changes the address.
(function initDashboardAppPalette(global) {
  const dash = global.D2LDashboard ||= {};
  const { $, api, closeMenu, navigateToDetail, state } = dash.appModules;

  const SEARCH_WAIT_MS = 150;
  const SEARCH_LIMIT = 60;
  const MAC = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "");
  const NO_HITS = Object.freeze({ groups: [], total: 0, allRoute: "" });

  // queued is the search the wait is holding back; running is the one on its way.
  const palette = { open: false, opener: null, view: null, options: [], active: -1, timer: 0, seq: 0, queued: null, running: Promise.resolve() };

  const root = () => document.getElementById("palette-root");
  const field = () => document.getElementById("palette-input");
  const list = () => document.getElementById("palette-list");
  const trigger = () => document.querySelector("[data-palette-open]");

  // Until you have visited Ask, nothing knows whether the model can run, so only the known-bad states warn.
  const askNote = () => {
    const engine = dash.askScreen.engineState();
    if (engine === "idle") return "Ask isn't started yet. This opens Ask, where you press Start";
    return ["missing", "no-gpu", "error"].includes(engine) ? "The model isn't ready yet. This opens Ask to set it up" : "";
  };
  const home = () => dash.paletteHome({ index: state.index, skip: new Set(Object.keys(state.hiddenWork || {})), now: new Date() });

  // ---- drawing --------------------------------------------------------------------
  function markActive() {
    for (const row of list().querySelectorAll("[role=option]")) row.setAttribute("aria-selected", String(Number(row.dataset.paletteIndex) === palette.active));
    const row = document.getElementById(`palette-opt-${palette.active}`);
    if (row) {
      field().setAttribute("aria-activedescendant", row.id);
      row.scrollIntoView({ block: "nearest" });
    } else {
      field().removeAttribute("aria-activedescendant");
    }
  }

  function show(view) {
    palette.view = { ...view, askNote: askNote() };
    palette.options = dash.paletteOptions(palette.view);
    palette.active = dash.paletteStart(palette.options);
    list().innerHTML = dash.paletteList(palette.view, palette.active);
    list().scrollTop = 0;
    markActive();
  }

  function move(step) {
    if (!palette.options.length) return;
    palette.active = (palette.active + step + palette.options.length) % palette.options.length;
    markActive();
  }

  // ---- searching: a short wait keeps fast typing from sending a search per key, and
  // an answer that arrives after a newer query (or after the pop-up closed) is dropped ----
  async function search({ query, seq }) {
    const result = await api("search.query", { query, limit: SEARCH_LIMIT }).catch(() => ({ query, entities: [], evidence: [] }));
    if (seq !== palette.seq || !palette.open) return;
    // The Search page reuses this answer when "See all" opens it.
    state.search = { query, result: { ...result, query }, pending: false };
    show(dash.paletteHits({ index: state.index, result, query }));
  }

  // Starts the held-back search now and waits for the latest one to finish.
  function settle() {
    const queued = palette.queued;
    palette.queued = null;
    clearTimeout(palette.timer);
    if (queued) palette.running = search(queued);
    return palette.running;
  }

  function typed(value) {
    const query = value.trim();
    clearTimeout(palette.timer);
    palette.queued = null;
    palette.seq += 1;
    if (!query) return show(home());
    // The last hits stay on screen while the new ones load, so the list doesn't blink.
    show({ ...(palette.view?.query ? palette.view : NO_HITS), query, pending: true });
    palette.queued = { query, seq: palette.seq };
    palette.timer = setTimeout(settle, SEARCH_WAIT_MS);
  }

  // ---- open, close, choose ------------------------------------------------------------
  const blocked = () => Boolean($("#action-confirm")?.open || state.preview);

  function open(opener) {
    if (palette.open || blocked()) return;
    closeMenu?.();
    Object.assign(palette, { open: true, opener: opener || document.activeElement });
    root().innerHTML = dash.paletteShell();
    root().hidden = false;
    trigger()?.setAttribute("aria-expanded", "true");
    show(home());
    field().focus();
  }

  function close({ restore = true } = {}) {
    if (!palette.open) return;
    clearTimeout(palette.timer);
    palette.queued = null;
    palette.seq += 1;
    palette.open = false;
    root().hidden = true;
    root().innerHTML = "";
    trigger()?.setAttribute("aria-expanded", "false");
    if (restore && palette.opener?.isConnected) palette.opener.focus();
  }

  function choose(number) {
    const option = palette.options[number];
    if (!option) return;
    const question = field().value.trim();
    const opener = palette.opener;
    close({ restore: false });
    if (option.kind === "ask") dash.askScreen.ask(question);
    else if (dash.isLayerRoute(option.route)) navigateToDetail(option.route, opener);
    else location.hash = option.route;
  }

  const askNow = () => {
    if (field().value.trim()) choose(palette.options.findIndex((option) => option.kind === "ask"));
  };

  // ---- events (capture phase, so the pop-up gets keys and clicks before the page does) ----
  const isShortcut = (event) => (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";

  window.addEventListener("keydown", (event) => {
    if (!palette.open) {
      if (!isShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      open(document.activeElement);
      return;
    }
    // While it is open the page behind gets no keys: Esc closes only this, not a detail or the overlay.
    event.stopPropagation();
    if (isShortcut(event)) { event.preventDefault(); close(); return; }
    if (event.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1); }
    else if (event.key === "Enter") {
      event.preventDefault();
      // Wait for the search in flight, so Enter never opens a result for words you've since changed.
      if (!event.repeat) settle().then(() => { if (palette.open) choose(palette.active); });
    } else if (event.key === "Tab") {
      event.preventDefault();
      if (!event.shiftKey) askNow();
    }
  }, true);

  window.addEventListener("click", (event) => {
    const opener = event.target.closest?.("[data-palette-open]");
    if (opener) {
      event.preventDefault();
      if (palette.open) close();
      else open(opener);
      return;
    }
    if (!palette.open) return;
    if (event.target.closest("[data-palette-close]")) {
      event.stopPropagation();
      close();
      return;
    }
    const row = event.target.closest(".palette-row");
    if (!row || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.stopPropagation();
    event.preventDefault();
    choose(Number(row.dataset.paletteIndex));
  }, true);

  document.addEventListener("input", (event) => {
    if (palette.open && event.target.id === "palette-input") typed(event.target.value);
  });

  document.addEventListener("mousemove", (event) => {
    const row = palette.open ? event.target.closest?.(".palette-row") : null;
    const number = row ? Number(row.dataset.paletteIndex) : palette.active;
    if (number !== palette.active) { palette.active = number; markActive(); }
  });

  // Clicking inside the pop-up (a heading, the gap between rows) must not pull focus out of the box.
  document.addEventListener("mousedown", (event) => {
    if (palette.open && event.target.closest(".palette") && event.target !== field()) event.preventDefault();
  });

  window.addEventListener("hashchange", () => close({ restore: false }));

  const hint = trigger()?.querySelector("kbd");
  if (hint) hint.textContent = MAC ? "⌘K" : "Ctrl K";

  dash.palette = { open, close, state: palette };
})(globalThis);
