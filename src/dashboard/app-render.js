// Routing, screen rendering, detail layers and transitions.
(function initDashboardAppRender(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { $, adoptNotice, api, bundleFor, closePeek, main, recreatedNotice, rememberScreen, renderSettings, renderUserProfile, state, toast } = dash.appModules;
  // ------------------------------------------------------------- render

  const NAV = [
    ["dashboard", "#/", "home", "Dashboard"], ["courses", "#/courses", "book", "Courses"], ["calendar", "#/calendar", "calendar", "Calendar"],
    ["updates", "#/updates", "bell", "Updates"], ["work", "#/work", "work", "Assignments"], ["grades", "#/grades", "grade", "Grades"], ["resources", "#/resources", "folder", "Content"]
  ];
  const NAV_OF = { course: "courses", assignment: "work", quiz: "work", discussion: "work", task: "work", checklist: "work", announcement: "updates", grade: "grades", event: "calendar" };

  function renderNav(active) {
    state.activeNav = active;
    $("#nav").innerHTML = NAV.map(([k, h, ic, l]) => k === "sep" ? '<div class="nav-sep"></div>' : `<a class="nav-item" href="${h}" ${k === active ? 'aria-current="page"' : ""} title="${l}">${dash.icon(ic, 20)}${l}</a>`).join("");
    const btn = $("#profile-button");
    if (active === "settings") btn?.setAttribute("aria-current", "page"); else btn?.removeAttribute("aria-current");
    renderUserProfile();
  }

  const CRUMBS = {
    assignment: { href: "#/work", label: "Assignments" },
    quiz: { href: "#/work?type=quiz", label: "Quizzes", parent: { href: "#/work", label: "Assignments" } },
    discussion: { href: "#/work?type=discussion", label: "Discussions", parent: { href: "#/work", label: "Assignments" } },
    task: { href: "#/work?type=task", label: "Checklist tasks", parent: { href: "#/work", label: "Assignments" } },
    checklist: { href: "#/work", label: "Assignments" }, announcement: { href: "#/updates", label: "Updates" },
    grade: { href: "#/grades", label: "Grades" }, event: { href: "#/calendar", label: "Calendar" }
  };

  const normalizedHash = (h) => { const v = String(h || "#/").trim(); return !v || v === "#" ? "#/" : v.startsWith("#") ? v : `#/${v.replace(/^\/?/, "")}`; };
  function routeLabel(hash) {
    const route = dash.parseRoute(hash);
    const labels = { dashboard: "Dashboard", courses: "Courses", calendar: "Calendar", updates: "Updates", work: "Assignments", grades: "Grades", resources: "Content", search: "Search", settings: "Settings" };
    return route.name === "course" ? (state.index?.courseById?.get(route.id)?.label || "Course") : (labels[route.name] || "Previous page");
  }

  const detailRoot = () => document.getElementById("detail-root");
  function setBaseInert(value) {
    const app = document.querySelector(".app");
    if (app) app.inert = value;
    document.body.classList.toggle("detail-open", value);
  }

  function hideDetail({ restoreFocus = false } = {}) {
    const current = state.detail;
    state.detail = null;
    state.detailRenderToken += 1;
    closePeek({ restoreFocus: false });
    const root = detailRoot();
    if (root) root.innerHTML = "";
    setBaseInert(false);
    if (restoreFocus && current?.trigger?.isConnected) current.trigger.focus({ preventScroll: true });
  }

  const detailLoadingBody = () => dash.loadingPage("Loading details…");
  const detailMessageBody = (t, m) => `<div class="page detail-page"><section class="card empty"><h1 id="detail-content-title">${dash.escapeHtml(t)}</h1><p>${dash.escapeHtml(m)}</p></section></div>`;

  function mountDetailShell(context, kind = "detail") {
    const root = detailRoot();
    if (!root) return;
    const layer = root.querySelector(".detail-layer");
    if (!layer || (layer.dataset.kind || "detail") !== kind) {
      closePeek({ restoreFocus: false });
      root.innerHTML = kind === "settings" ? dash.settingsShell() : dash.detailShell(context);
      requestAnimationFrame(() => root.querySelector(".detail-panel")?.focus({ preventScroll: true }));
    }
    setBaseInert(true);
    state.detail = { ...context, open: true };
  }

  const setDetailBusy = (val) => detailRoot()?.querySelector("[data-detail-body]")?.setAttribute("aria-busy", String(val));

  // Assignment and quiz details keep a steady top row (see .detail-top in the
  // CSS). Show more appears only when the text is taller than that row.
  const clampWatch = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => entries.forEach((e) => markDetailClamp(e.target))) : null;

  function markDetailClamp(clamp) {
    const layout = clamp?.closest(".detail-layout");
    if (!layout || layout.classList.contains("is-open")) return;
    const clipped = clamp.scrollHeight > clamp.clientHeight + 1;
    layout.classList.toggle("is-clipped", clipped);
    const more = clamp.querySelector(".detail-more");
    if (more) more.hidden = !clipped;
  }

  function fitDetailClamp(root) {
    const clamps = [...(root?.querySelectorAll(".detail-clamp") || [])];
    for (const clamp of clamps) { markDetailClamp(clamp); clampWatch?.observe(clamp); }
    if (clamps.length) requestAnimationFrame(() => clamps.forEach(markDetailClamp));
  }

  function setDetailMore(layout, open) {
    if (!layout) return;
    layout.classList.toggle("is-open", open);
    const more = layout.querySelector(".detail-more");
    if (!more) return;
    more.setAttribute("aria-expanded", String(open));
    more.textContent = open ? "Show less" : "Show more";
    if (open) more.hidden = false; else markDetailClamp(layout.querySelector(".detail-clamp"));
  }

  function updateDetailBody(html, { labelled = false, busy = false } = {}) {
    const root = detailRoot(), body = root?.querySelector("[data-detail-body]"), panel = root?.querySelector(".detail-panel");
    if (!body || !panel) return;
    const titleOf = () => body.querySelector("#detail-content-title")?.textContent;
    const shown = titleOf(), reopen = body.querySelector(".detail-layout.is-open") ? shown : null;
    body.innerHTML = html;
    if (state.peek && titleOf() !== shown) closePeek({ restoreFocus: false });
    if (reopen && titleOf() === reopen) setDetailMore(body.querySelector(".detail-layout"), true);
    fitDetailClamp(body);
    body.setAttribute("aria-busy", String(busy));
    if (labelled) { panel.removeAttribute("aria-label"); panel.setAttribute("aria-labelledby", "detail-content-title"); }
    else { panel.removeAttribute("aria-labelledby"); panel.setAttribute("aria-label", busy ? "Loading details" : "Item details"); }
  }

  function contextForDetail(hash, route, trigger = null) {
    const remembered = state.detailContexts.get(hash);
    if (remembered) return { ...remembered, trigger: remembered.trigger?.isConnected ? remembered.trigger : trigger };
    if (state.detail) return { ...state.detail, detailHash: hash };
    const baseHash = dash.canonicalParentForRoute(state.index, route);
    return { baseHash, baseScrollTop: state.pageScrolls.get(baseHash) || 0, originLabel: routeLabel(baseHash), trigger, openedFromApp: false, depth: 0, detailHash: hash };
  }

  function navigateToDetail(hash, trigger = null) {
    const detailHash = normalizedHash(hash), route = dash.parseRoute(detailHash);
    if (!dash.isLayerRoute(route)) { location.hash = detailHash; return; }
    const current = state.detail;
    if (route.name === "settings" && current && dash.parseRoute(current.detailHash || location.hash).name === "settings") {
      state.detailContexts.set(detailHash, { ...current, detailHash });
      if (location.hash === detailHash) render(detailHash); else location.replace(detailHash);
      return;
    }
    const baseHash = current?.baseHash || state.shownHash || normalizedHash(location.hash);
    const context = {
      baseHash, baseScrollTop: current?.baseScrollTop ?? main()?.scrollTop ?? 0,
      originLabel: current?.originLabel || routeLabel(baseHash), trigger: current?.trigger || trigger,
      openedFromApp: true, depth: current ? current.depth + (current.detailHash === detailHash ? 0 : 1) : 1, detailHash
    };
    state.pageScrolls.set(baseHash, context.baseScrollTop);
    state.detailContexts.set(detailHash, context);
    if (location.hash === detailHash) render(detailHash); else location.hash = detailHash;
  }

  const backFromDetail = () => closeDetailToBase();

  function closeDetailToBase() {
    const context = state.detail;
    if (!context) return;
    history.replaceState({ d2lArchive: true, route: context.baseHash }, "", context.baseHash);
    rememberScreen();
    render(context.baseHash);
  }

  async function renderDetailRoute(hash, route) {
    let context = contextForDetail(hash, route);
    const hasBase = Boolean(main()?.querySelector("[data-screen]"));
    if (!hasBase || !state.shownHash || dash.isLayerRoute(state.shownHash)) {
      await render(context.baseHash);
      context = { ...context, baseScrollTop: state.pageScrolls.get(context.baseHash) || context.baseScrollTop };
      if (main()) main().scrollTop = context.baseScrollTop;
    }
    const token = ++state.detailRenderToken;
    renderNav(NAV_OF[route.name] || route.name);
    if (route.name === "settings") { mountDetailShell(context, "settings"); return renderSettings(route, token); }
    mountDetailShell(context);
    setDetailBusy(true);
    const loadingTimer = setTimeout(() => {
      if (token === state.detailRenderToken && location.hash === hash) updateDetailBody(detailLoadingBody(), { busy: true });
    }, 120);
    const superseded = () => token !== state.detailRenderToken || (!state.selfChecking && location.hash !== hash);
    let bundle;
    try { bundle = await bundleFor(route.id); }
    catch (error) {
      clearTimeout(loadingTimer);
      if (superseded()) return;
      updateDetailBody(detailMessageBody("This item could not be loaded", error.message || "Try opening it again."), { labelled: true });
      rememberScreen();
      return;
    }
    clearTimeout(loadingTimer);
    if (superseded()) return;
    const detail = dash.detailFor(state.index, route, bundle);
    if (detail) { detail.checklistDone = state.checklistDone; detail.hiddenWork = state.hiddenWork; }
    updateDetailBody(detail ? dash.detailBody(detail) : detailMessageBody("This item is no longer in the archive", "This item may have been removed from D2L."), { labelled: true });
    rememberScreen();
  }

  const FADE_MS = 250;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const reduceMotion = () => global.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const fadeOutMain = () => { main().classList.add("is-faded"); return wait(FADE_MS); };

  function samePage(hash, shownHash) {
    if (!shownHash) return false;
    const next = dash.parseRoute(hash), shown = dash.parseRoute(shownHash);
    return next.name === shown.name && !dash.isDetailRoute(next) && (next.name === "resources" || next.id === shown.id);
  }

  const sameAttributes = (a, b) => a.attributes.length === b.attributes.length && [...a.attributes].every((attr) => b.getAttribute(attr.name) === attr.value);

  function morph(current, next, depth) {
    if (current.isEqualNode(next)) return;
    if (depth > 0 && current.nodeType === 1 && current.tagName === next.tagName && sameAttributes(current, next) && current.childNodes.length === next.childNodes.length) {
      for (let i = 0; i < current.childNodes.length; i++) morph(current.childNodes[i], next.childNodes[i], depth - 1);
      return;
    }
    current.replaceWith(next);
  }

  function focusKey(node) {
    if (!node || node === document.body) return "";
    if (node.id) return `#${CSS.escape(node.id)}`;
    if (node.dataset?.action) return `[data-action="${CSS.escape(node.dataset.action)}"]`;
    return "";
  }

  function patchMain(html) {
    const node = main(), key = focusKey(document.activeElement), next = document.createElement("div");
    next.innerHTML = html;
    if (node.childNodes.length !== next.childNodes.length) node.innerHTML = html;
    else for (let i = 0; i < node.childNodes.length; i++) morph(node.childNodes[i], next.childNodes[i], 8);
    if (key && !node.contains(document.activeElement)) node.querySelector(key)?.focus({ preventScroll: true });
  }

  function showMain(html, hash) {
    const node = main();
    if (state.shownHash && (hash === state.shownHash || samePage(hash, state.shownHash)) && node.querySelector("[data-screen]")) patchMain(html);
    else node.innerHTML = html;
    node.querySelector(".grade-widget-window")?.addEventListener("scroll", updateGradeCarouselControls, { passive: true });
    requestAnimationFrame(updateGradeCarouselControls);
    fitDetailClamp(node);
    state.shownHash = hash;
    if (node.classList.contains("is-faded")) { void node.offsetHeight; node.classList.remove("is-faded"); }
  }

  function updateGradeCarouselControls() {
    const viewport = main()?.querySelector(".grade-widget-window");
    if (!viewport) return;
    const carousel = viewport.closest(".grade-carousel"), max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    carousel.querySelector("[data-action=grade-prev]").disabled = viewport.scrollLeft <= 2;
    carousel.querySelector("[data-action=grade-next]").disabled = viewport.scrollLeft >= max - 2;
  }

  function moveGradeCarousel(direction) {
    const viewport = main()?.querySelector(".grade-widget-window"), card = viewport?.querySelector(".grade-widget-main");
    if (!viewport || !card) return;
    const gap = Number.parseFloat(getComputedStyle(viewport.querySelector(".grade-widget")).columnGap) || 16;
    viewport.scrollBy({ left: direction * (card.getBoundingClientRect().width + gap), behavior: reduceMotion() ? "auto" : "smooth" });
    setTimeout(updateGradeCarouselControls, reduceMotion() ? 0 : 250);
  }

  function searchScreenHtml(route, token, hash) {
    const query = route.params.q || "";
    if (query && state.search.query !== query) {
      state.search = { query, result: null, pending: true };
      api("search.query", { query, limit: 60 }).then((result) => {
        if (state.search.query !== query) return;
        state.search = { query, result, pending: false };
        if (token === state.renderToken) render(hash);
      }).catch((error) => {
        state.search = { query, result: { query, entities: [], evidence: [] }, pending: false };
        toast(`Search failed: ${error.message}`);
      });
    }
    return dash.searchPage(dash.searchModel(state.index, state.search.result), query, state.search.pending);
  }

  async function standaloneDetailHtml(route, token, hash, fadedOut) {
    if (!CRUMBS[route.name]) return dash.notFoundPage("That page doesn't exist.");
    const pending = bundleFor(route.id);
    if (fadedOut) await fadedOut;
    const ready = await Promise.race([pending.then(() => true), wait(0).then(() => false)]);
    if (!ready && token === state.renderToken) showMain(dash.loadingPage("Loading…"), hash);
    const bundle = await pending;
    if (token !== state.renderToken) return "";
    const detail = dash.detailFor(state.index, route, bundle);
    if (detail) { detail.checklistDone = state.checklistDone; detail.hiddenWork = state.hiddenWork; }
    return dash.detailPage(detail, CRUMBS[route.name]);
  }

  function screenHtml(route, token, hash, fadedOut) {
    const index = state.index;
    switch (route.name) {
      case "dashboard": return dash.dashboardPage(dash.dashboardModel(index, state.read, state.checklistDone, state.hiddenWork), recreatedNotice() + adoptNotice());
      case "courses": return dash.coursesPage(dash.coursesModel(index, route.params, state.hiddenWork));
      case "course": state.lastCourseId = route.id; return dash.courseHomePage(dash.courseHomeModel(index, route.id, state.hiddenWork));
      case "calendar": return dash.calendarPage(dash.calendarModel(index, route.params));
      case "updates": return dash.updatesPage(dash.updateRows(index, state.read).filter((r) => !route.params.course || r.courseId === route.params.course), route.params);
      case "work": return dash.workListPage(dash.workListModel(index, route.params, state.checklistDone, state.hiddenWork));
      case "grades": {
        const model = dash.gradesModel(index, { ...route.params, course: route.params.course || state.lastCourseId });
        if (model.courseId) state.lastCourseId = model.courseId;
        return dash.gradesPage(model);
      }
      case "resources":
        if (route.id || route.params.course) state.lastCourseId = route.id || route.params.course;
        return dash.resourcesPage(dash.resourcesModel(index, { ...route.params, course: route.id || route.params.course }));
      case "search": return searchScreenHtml(route, token, hash);
      default: return standaloneDetailHtml(route, token, hash, fadedOut);
    }
  }

  async function render(hash = location.hash) {
    hash = normalizedHash(hash);
    const route = dash.parseRoute(hash);
    if (route.name === "about") { location.replace("#/settings/about"); return; }
    if (dash.isLayerRoute(route)) return renderDetailRoute(hash, route);
    if (state.detail) {
      const context = state.detail;
      hideDetail({ restoreFocus: hash === context.baseHash });
      if (hash === context.baseHash && state.shownHash === hash && main()?.querySelector("[data-screen]") && !state.baseStale) {
        renderNav(NAV_OF[route.name] || route.name);
        main().scrollTop = context.baseScrollTop;
        rememberScreen();
        return;
      }
    }
    const token = ++state.renderToken;
    state.baseStale = false;
    renderNav(NAV_OF[route.name] || route.name);
    if (!state.index) {
      main().innerHTML = state.accountUnknown ? dash.noAccountPage() : dash.loadingPage();
      return;
    }
    const stayed = samePage(hash, state.shownHash);
    const fade = hash !== state.shownHash && !stayed && !reduceMotion();
    const fadedOut = fade ? fadeOutMain() : null;
    const html = await screenHtml(route, token, hash, fadedOut);
    if (fadedOut) await fadedOut;
    if (token !== state.renderToken || !html) return;
    showMain(html, hash);
    if (route.name === "resources" && (route.params.item || route.params.module)) {
      document.getElementById(route.params.item || `module-${route.params.module}`)?.scrollIntoView({ block: "center" });
    } else if (!render.keepScroll && !stayed) {
      main().scrollTop = state.pageScrolls.get(hash) || 0;
    }
    render.keepScroll = false;
    if (route.name === "search") {
      const input = dash.appModules.searchInput();
      if (input && document.activeElement !== input) input.value = route.params.q || "";
      if (!route.params.q) input?.focus();
    }
  }

  Object.assign(mod, { renderNav, normalizedHash, routeLabel, detailRoot, setBaseInert, hideDetail, detailLoadingBody, detailMessageBody, mountDetailShell, setDetailBusy, updateDetailBody, setDetailMore, contextForDetail, navigateToDetail, backFromDetail, closeDetailToBase, renderDetailRoute, fadeOutMain, samePage, sameAttributes, morph, focusKey, patchMain, showMain, updateGradeCarouselControls, moveGradeCarousel, render, NAV, NAV_OF, CRUMBS, FADE_MS, wait, reduceMotion });
})(globalThis);
