// Dashboard self-check screen walk.
(function initDashboardAppSelfcheck(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { detailRoot, look, main, render, state, toast } = dash.appModules;
  // ---------------------------------------------------------- self-check
  // Development builds only (?selfcheck=1): visit every screen, record what
  // the real page rendered (text, links, look), and save it next to the
  // exports so it can be compared with live D2L.

  function selfCheckRoutes(index) {
    const routes = ["#/", "#/courses", "#/updates", "#/work", "#/work?tab=all", "#/work?tab=done", "#/settings", "#/settings/about", "#/search?q=Iceman"];
    for (const course of index.courses) {
      routes.push(`#/course/${course.courseId}`, `#/grades?course=${course.courseId}`, `#/resources/${course.courseId}`);
    }
    for (const month of [...new Set(dash.calendarEvents(index).map((event) => event.day.slice(0, 7)))].sort()) routes.push(`#/calendar?month=${month}&day=${month}-15`);
    for (const entity of index.entities) {
      if (!index.visible.has(entity.courseId)) continue;
      if (entity.entityType === "courseToolItem" && entity.toolType !== "checklistItem") continue;
      const route = dash.routeFor(entity);
      if (route && !route.startsWith("#/resources/")) routes.push(route);
    }
    return routes;
  }

  async function waitForSearch(hash) {
    for (let i = 0; i < 50 && state.search.pending; i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    await render(hash);
  }

  async function runSelfCheck() {
    if (chrome.runtime.getManifest().update_url) return;
    const errors = [];
    window.addEventListener("error", (event) => errors.push(String(event.message || event.error)));
    window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason?.message || event.reason)));
    await (document.fonts?.ready || Promise.resolve());
    const body = getComputedStyle(document.body);
    const primary = document.querySelector(".btn-primary") || document.querySelector("#sync-button");
    const look = {
      fontFamily: body.fontFamily,
      plexLoaded: document.fonts ? document.fonts.check('14px "IBM Plex Sans"') : null,
      ground: body.backgroundColor,
      topbar: getComputedStyle(document.querySelector(".topbar")).backgroundColor,
      navWidth: getComputedStyle(document.querySelector(".sidenav")).width,
      primaryButton: primary ? getComputedStyle(primary).backgroundColor : ""
    };
    const routes = selfCheckRoutes(state.index);
    const results = [];
    // Render each route directly: Chrome silently drops history.replaceState
    // after ~100 rapid calls, which left most screens rendering a stale hash.
    state.selfChecking = true;
    for (const route of routes) {
      await render(route);
      if (route.startsWith("#/search")) await waitForSearch(route);
      const root = dash.isLayerRoute(route) ? detailRoot() : main();
      results.push({
        route,
        screen: root.querySelector("[data-screen]")?.getAttribute("data-screen") || "",
        title: root.querySelector("h1")?.textContent.trim() || "",
        text: root.innerText.slice(0, route.startsWith("#/calendar") || route.startsWith("#/resources") || route.startsWith("#/grades") ? 20000 : 8000),
        links: [...root.querySelectorAll("a[href]")].map((a) => [a.textContent.trim().replace(/\s+/g, " ").slice(0, 120), a.getAttribute("href"), a.hasAttribute("data-d2l-link") ? 1 : 0]),
        facts: [...root.querySelectorAll(".fact")].map((fact) => [fact.querySelector(".k")?.textContent.trim() || "", fact.querySelector(".v")?.textContent.trim() || ""]),
        rows: [...root.querySelectorAll("[data-entity]")].map((row) => [row.getAttribute("data-entity"), row.innerText.replace(/\s+/g, " ").trim().slice(0, 300)]),
        groups: [...root.querySelectorAll(".group-row")].map((row) => row.innerText.replace(/\s+/g, " ").trim()),
        promo: route === "#/" ? root.querySelector(".promo")?.innerText || "" : undefined
      });
    }
    state.selfChecking = false;
    const report = {
      generatedAt: new Date().toISOString(),
      extensionVersion: chrome.runtime.getManifest().version,
      databaseRevision: dash.syncModel(state.index, state.settings).revision,
      sync: dash.syncModel(state.index, state.settings),
      look,
      courses: state.index.allCourses.map((course) => ({ courseId: course.courseId, code: course.code, shown: state.index.visible.has(course.courseId), currentTerm: course.currentTerm })),
      errors,
      routes: results
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report)], { type: "application/json" }));
    await chrome.downloads.download({ url, filename: `D2L Export/dashboard-selfcheck-${report.generatedAt.replace(/[:.]/g, "-")}.json`, saveAs: false, conflictAction: "overwrite" });
    toast(`Self-check saved: ${results.length} screens.`);
  }

  Object.assign(mod, { selfCheckRoutes, waitForSearch, runSelfCheck });
})(globalThis);
