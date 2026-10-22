// Routing, screen rendering, detail layers and transitions.
(function initDashboardAppRender(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { $, DEFAULT_AVATAR_SVG, adoptNotice, api, bundleFor, main, recreatedNotice, rememberScreen, renderSettings, renderUserProfile, state, toast } = dash.appModules;
  // ------------------------------------------------------------- render

  const NAV = [
    ["dashboard", "#/", "home", "Dashboard"],
    ["courses", "#/courses", "book", "Courses"],
    ["calendar", "#/calendar", "calendar", "Calendar"],
    ["updates", "#/updates", "bell", "Updates"],
    ["work", "#/work", "work", "Assignments"],
    ["grades", "#/grades", "grade", "Grades"],
    ["resources", "#/resources", "folder", "Content"]
  ];
  // Search lives in the top bar. Settings and account-related links live in
  // the profile menu anchored at the bottom of the sidebar.
  const NAV_OF = { course: "courses", assignment: "work", quiz: "work", discussion: "work", task: "work", checklist: "work", announcement: "updates", grade: "grades", event: "calendar" };

  function renderNav(active) {
    state.activeNav = active;
    $("#nav").innerHTML = NAV.map(([key, href, iconName, label]) => key === "sep"
      ? `<div class="nav-sep"></div>`
      : `<a class="nav-item" href="${href}" ${key === active ? 'aria-current="page"' : ""} title="${label}">${dash.icon(iconName, 20)}${label}</a>`).join("")
      + `<div class="nav-profile menu-root">
          <button class="profile-trigger" type="button" data-menu-toggle aria-controls="profile-menu" aria-expanded="false" aria-label="Open profile menu" ${active === "settings" ? 'aria-current="page"' : ""}>
            <span class="profile-avatar"><img id="profile-avatar" alt="" draggable="false" hidden><span id="profile-avatar-fallback" class="profile-avatar-fallback" aria-hidden="true">${DEFAULT_AVATAR_SVG}</span></span>
          </button>
          <div id="profile-menu" class="menu profile-menu" hidden>
            <a class="menu-item" href="#/settings"><span class="menu-item-icon">${dash.icon("settings", 18)}</span><b>Settings</b></a>
            <a class="menu-item" href="#/settings/about"><span class="menu-item-icon">${dash.icon("help", 18)}</span><b>About</b></a>
            <a class="menu-item" href="https://kennesaw.view.usg.edu/d2l/home" rel="noopener noreferrer" data-d2l-link><span class="menu-item-icon">${dash.icon("external", 18)}</span><b>Open D2L</b></a>
          </div>
        </div>`;
    renderUserProfile();
  }

  const CRUMBS = {
    assignment: { href: "#/work", label: "Assignments" },
    // Quizzes, discussions and tasks live under Assignments in the menu.
    quiz: { href: "#/work?type=quiz", label: "Quizzes", parent: { href: "#/work", label: "Assignments" } },
    discussion: { href: "#/work?type=discussion", label: "Discussions", parent: { href: "#/work", label: "Assignments" } },
    task: { href: "#/work?type=task", label: "Checklist tasks", parent: { href: "#/work", label: "Assignments" } },
    checklist: { href: "#/work", label: "Assignments" },
    announcement: { href: "#/updates", label: "Updates" },
    grade: { href: "#/grades", label: "Grades" },
    event: { href: "#/calendar", label: "Calendar" }
  };

  function normalizedHash(hash) {
    const value = String(hash || "#/").trim();
    if (!value || value === "#") return "#/";
    return value.startsWith("#") ? value : `#/${value.replace(/^\/?/, "")}`;
  }

  function routeLabel(hash) {
    const route = dash.parseRoute(hash);
    const labels = { dashboard: "Dashboard", courses: "Courses", calendar: "Calendar", updates: "Updates", work: "Assignments", grades: "Grades", resources: "Content", search: "Search", settings: "Settings" };
    if (route.name === "course") return state.index?.courseById?.get(route.id)?.label || "Course";
    return labels[route.name] || "Previous page";
  }

  function detailRoot() {
    return document.getElementById("detail-root");
  }

  function setBaseInert(value) {
    const app = document.querySelector(".app");
    if (app) app.inert = value;
    document.body.classList.toggle("detail-open", value);
  }

  function hideDetail({ restoreFocus = false } = {}) {
    const current = state.detail;
    state.detail = null;
    state.detailRenderToken += 1;
    const root = detailRoot();
    if (root) root.innerHTML = "";
    setBaseInert(false);
    if (restoreFocus && current?.trigger?.isConnected) current.trigger.focus({ preventScroll: true });
  }

  function detailLoadingBody() {
    return dash.loadingPage("Loading details…");
  }

  function detailMessageBody(title, message) {
    return `<div class="page detail-page"><section class="card empty"><h1 id="detail-content-title">${dash.escapeHtml(title)}</h1><p>${dash.escapeHtml(message)}</p></section></div>`;
  }

  function mountDetailShell(context, kind = "detail") {
    const root = detailRoot();
    if (!root) return;
    const layer = root.querySelector(".detail-layer");
    if (!layer || (layer.dataset.kind || "detail") !== kind) {
      root.innerHTML = kind === "settings" ? dash.settingsShell() : dash.detailShell(context);
      requestAnimationFrame(() => root.querySelector(".detail-panel")?.focus({ preventScroll: true }));
    }
    setBaseInert(true);
    state.detail = { ...context, open: true };
  }

  function setDetailBusy(value) {
    const body = detailRoot()?.querySelector("[data-detail-body]");
    if (body) body.setAttribute("aria-busy", String(value));
  }

  function updateDetailBody(html, { labelled = false, busy = false } = {}) {
    const root = detailRoot();
    const body = root?.querySelector("[data-detail-body]");
    const panel = root?.querySelector(".detail-panel");
    if (!body || !panel) return;
    body.innerHTML = html;
    body.setAttribute("aria-busy", String(busy));
    if (labelled) {
      panel.removeAttribute("aria-label");
      panel.setAttribute("aria-labelledby", "detail-content-title");
    } else {
      panel.removeAttribute("aria-labelledby");
      panel.setAttribute("aria-label", busy ? "Loading details" : "Item details");
    }
  }

  function contextForDetail(hash, route, trigger = null) {
    const remembered = state.detailContexts.get(hash);
    if (remembered) return { ...remembered, trigger: remembered.trigger?.isConnected ? remembered.trigger : trigger };
    if (state.detail) return { ...state.detail, detailHash: hash };
    const baseHash = dash.canonicalParentForRoute(state.index, route);
    return { baseHash, baseScrollTop: state.pageScrolls.get(baseHash) || 0, originLabel: routeLabel(baseHash), trigger, openedFromApp: false, depth: 0, detailHash: hash };
  }

  function navigateToDetail(hash, trigger = null) {
    const detailHash = normalizedHash(hash);
    const route = dash.parseRoute(detailHash);
    if (!dash.isLayerRoute(route)) {
      location.hash = detailHash;
      return;
    }
    const current = state.detail;
    // Moving between Settings sections replaces the address instead of adding
    // one, so Esc or Close always returns to the page underneath in one step.
    if (route.name === "settings" && current && dash.parseRoute(current.detailHash || location.hash).name === "settings") {
      state.detailContexts.set(detailHash, { ...current, detailHash });
      if (location.hash === detailHash) render(detailHash);
      else location.replace(detailHash);
      return;
    }
    const baseHash = current?.baseHash || state.shownHash || normalizedHash(location.hash);
    const context = {
      baseHash,
      baseScrollTop: current?.baseScrollTop ?? main()?.scrollTop ?? 0,
      originLabel: current?.originLabel || routeLabel(baseHash),
      trigger: current?.trigger || trigger,
      openedFromApp: true,
      depth: current ? current.depth + (current.detailHash === detailHash ? 0 : 1) : 1,
      detailHash
    };
    state.pageScrolls.set(baseHash, context.baseScrollTop);
    state.detailContexts.set(detailHash, context);
    if (location.hash === detailHash) render(detailHash);
    else location.hash = detailHash;
  }

  function backFromDetail() {
    const context = state.detail;
    if (!context) return;
    if (context.openedFromApp && context.depth > 0) history.back();
    else closeDetailToBase();
  }

  function closeDetailToBase() {
    const context = state.detail;
    if (!context) return;
    if (context.openedFromApp && context.depth > 0) {
      history.go(-context.depth);
      return;
    }
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
    if (route.name === "settings") {
      mountDetailShell(context, "settings");
      return renderSettings(route, token);
    }
    mountDetailShell(context);
    setDetailBusy(true);
    const loadingTimer = setTimeout(() => {
      if (token === state.detailRenderToken && location.hash === hash) updateDetailBody(detailLoadingBody(), { busy: true });
    }, 120);
    // The self-check renders screens without moving location.hash.
    const superseded = () => token !== state.detailRenderToken || (!state.selfChecking && location.hash !== hash);
    let bundle;
    try {
      bundle = await bundleFor(route.id);
    } catch (error) {
      clearTimeout(loadingTimer);
      if (superseded()) return;
      updateDetailBody(detailMessageBody("This item could not be loaded", error.message || "Try opening it again."), { labelled: true });
      rememberScreen();
      return;
    }
    clearTimeout(loadingTimer);
    if (superseded()) return;
    const detail = dash.detailFor(state.index, route, bundle);
    if (detail) {
      detail.checklistDone = state.checklistDone;
      detail.hiddenWork = state.hiddenWork;
      updateDetailBody(dash.detailBody(detail), { labelled: true });
    } else {
      updateDetailBody(detailMessageBody("This item is no longer in the archive", "This item may have been removed from D2L."), { labelled: true });
    }
    rememberScreen();
  }

  // Screen changes fade the old view out and the new one in; the sidebar and
  // top bar sit outside #main and stay still. Re-drawing the same screen (for
  // example after marking an update read) swaps instantly.
  const FADE_MS = 250;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const reduceMotion = () => global.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  function fadeOutMain() {
    main().classList.add("is-faded");
    return wait(FADE_MS);
  }

  // Picking a day, a tab or a course keeps you on the same page: only the
  // parts that changed are swapped, so the title and anything else that stayed
  // the same doesn't flash. Course home pages are separate pages per course.
  function samePage(hash, shownHash) {
    if (!shownHash) return false;
    const next = dash.parseRoute(hash);
    const shown = dash.parseRoute(shownHash);
    return next.name === shown.name && !dash.isDetailRoute(next) && (next.name === "resources" || next.id === shown.id);
  }

  function sameAttributes(a, b) {
    if (a.attributes.length !== b.attributes.length) return false;
    return [...a.attributes].every((attribute) => b.getAttribute(attribute.name) === attribute.value);
  }

  function morph(current, next, depth) {
    if (current.isEqualNode(next)) return;
    if (depth > 0 && current.nodeType === 1 && current.tagName === next.tagName && sameAttributes(current, next) && current.childNodes.length === next.childNodes.length) {
      const pairs = [...current.childNodes].map((child, i) => [child, next.childNodes[i]]);
      for (const [child, replacement] of pairs) morph(child, replacement, depth - 1);
      return;
    }
    current.replaceWith(next);
  }

  function focusKey(node) {
    if (!node || node === document.body || !main()?.contains(node)) return "";
    if (node.dataset.day) return `[data-day="${CSS.escape(node.dataset.day)}"]`;
    if (node.id) return `#${CSS.escape(node.id)}`;
    if (node.getAttribute("href")) return `[href="${CSS.escape(node.getAttribute("href"))}"]`;
    if (node.dataset.href) return `[data-href="${CSS.escape(node.dataset.href)}"]`;
    return "";
  }

  function patchMain(html) {
    const node = main();
    const key = focusKey(document.activeElement);
    const next = document.createElement("div");
    next.innerHTML = html;
    if (node.childNodes.length !== next.childNodes.length) {
      node.innerHTML = html;
    } else {
      const pairs = [...node.childNodes].map((child, i) => [child, next.childNodes[i]]);
      for (const [child, replacement] of pairs) morph(child, replacement, 8);
    }
    if (key && !node.contains(document.activeElement)) node.querySelector(key)?.focus({ preventScroll: true });
  }

  // Always clears the fade, so a screen change cut short by a quicker click
  // can't leave the view invisible.
  function showMain(html, hash) {
    const node = main();
    if (state.shownHash && (hash === state.shownHash || samePage(hash, state.shownHash)) && node.querySelector("[data-screen]")) patchMain(html);
    else node.innerHTML = html;
    node.querySelector(".grade-widget-window")?.addEventListener("scroll", updateGradeCarouselControls, { passive: true });
    requestAnimationFrame(updateGradeCarouselControls);
    state.shownHash = hash;
    if (node.classList.contains("is-faded")) {
      void node.offsetHeight;
      node.classList.remove("is-faded");
    }
  }

  function updateGradeCarouselControls() {
    const viewport = main()?.querySelector(".grade-widget-window");
    if (!viewport) return;
    const carousel = viewport.closest(".grade-carousel");
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    carousel.querySelector("[data-action=grade-prev]").disabled = viewport.scrollLeft <= 2;
    carousel.querySelector("[data-action=grade-next]").disabled = viewport.scrollLeft >= max - 2;
  }

  function moveGradeCarousel(direction) {
    const viewport = main()?.querySelector(".grade-widget-window");
    const card = viewport?.querySelector(".grade-widget-main");
    if (!viewport || !card) return;
    const gap = Number.parseFloat(getComputedStyle(viewport.querySelector(".grade-widget")).columnGap) || 16;
    viewport.scrollBy({ left: direction * (card.getBoundingClientRect().width + gap), behavior: reduceMotion() ? "auto" : "smooth" });
    setTimeout(updateGradeCarouselControls, reduceMotion() ? 0 : 250);
  }

  async function render(hash = location.hash) {
    hash = normalizedHash(hash);
    const route = dash.parseRoute(hash);
    // Old #/about bookmarks now land on the only About screen.
    if (route.name === "about") {
      location.replace("#/settings/about");
      return;
    }
    if (dash.isLayerRoute(route)) return renderDetailRoute(hash, route);
    if (state.detail) {
      const context = state.detail;
      hideDetail({ restoreFocus: hash === context.baseHash });
      // A change made in Settings (a hidden course) redraws the page underneath.
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
    const index = state.index;
    let html;
    switch (route.name) {
      case "dashboard":
        html = dash.dashboardPage(dash.dashboardModel(index, state.read, state.checklistDone, state.hiddenWork), recreatedNotice() + adoptNotice());
        break;
      case "courses":
        html = dash.coursesPage(dash.coursesModel(index, route.params, state.hiddenWork));
        break;
      case "course":
        state.lastCourseId = route.id;
        html = dash.courseHomePage(dash.courseHomeModel(index, route.id, state.hiddenWork));
        break;
      case "calendar":
        html = dash.calendarPage(dash.calendarModel(index, route.params));
        break;
      case "updates": {
        const rows = dash.updateRows(index, state.read).filter((row) => !route.params.course || row.courseId === route.params.course);
        html = dash.updatesPage(rows, route.params);
        break;
      }
      case "work":
        html = dash.workListPage(dash.workListModel(index, route.params, state.checklistDone, state.hiddenWork));
        break;
      case "grades": {
        // Opens on the course you came from when the link doesn't name one.
        const model = dash.gradesModel(index, { ...route.params, course: route.params.course || state.lastCourseId });
        if (model.courseId) state.lastCourseId = model.courseId;
        html = dash.gradesPage(model);
        break;
      }
      case "resources":
        if (route.id || route.params.course) state.lastCourseId = route.id || route.params.course;
        html = dash.resourcesPage(dash.resourcesModel(index, { ...route.params, course: route.id || route.params.course }));
        break;
      case "search": {
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
        html = dash.searchPage(dash.searchModel(index, state.search.result), query, state.search.pending);
        break;
      }
      default: {
        if (!CRUMBS[route.name]) {
          html = dash.notFoundPage("That page doesn't exist.");
          break;
        }
        const pending = bundleFor(route.id);
        if (fadedOut) await fadedOut;
        const ready = await Promise.race([pending.then(() => true), wait(0).then(() => false)]);
        if (!ready && token === state.renderToken) showMain(dash.loadingPage("Loading…"), hash);
        const bundle = await pending;
        if (token !== state.renderToken) return;
        const detail = dash.detailFor(index, route, bundle);
        if (detail) {
          detail.checklistDone = state.checklistDone;
          detail.hiddenWork = state.hiddenWork;
        }
        html = dash.detailPage(detail, CRUMBS[route.name]);
      }
    }
    if (fadedOut) await fadedOut;
    if (token !== state.renderToken) return;
    showMain(html, hash);
    if (route.name === "resources" && (route.params.item || route.params.module)) {
      const target = document.getElementById(route.params.item || `module-${route.params.module}`);
      target?.scrollIntoView({ block: "center" });
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

  Object.assign(mod, { renderNav, normalizedHash, routeLabel, detailRoot, setBaseInert, hideDetail, detailLoadingBody, detailMessageBody, mountDetailShell, setDetailBusy, updateDetailBody, contextForDetail, navigateToDetail, backFromDetail, closeDetailToBase, renderDetailRoute, fadeOutMain, samePage, sameAttributes, morph, focusKey, patchMain, showMain, updateGradeCarouselControls, moveGradeCarousel, render, NAV, NAV_OF, CRUMBS, FADE_MS, wait, reduceMotion });
})(globalThis);
