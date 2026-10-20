// Route parsing, detail dispatch and link targets.
(function initDashboardModelRoutes(global) {
  const dash = global.D2LDashboard ||= {};
  const { D2L_ORIGIN, DETAIL_ROUTES, announcementModel, assignmentModel, checklistModel, discussionModel, eventModel, gradeDetailModel, quizModel, taskModel } = dash;
  // ------------------------------------------------------------------ misc

  function detailFor(index, route, bundle) {
    if (route.name === "checklist") return checklistModel(index, route.id);
    const entity = index.byId.get(route.id);
    if (!entity) return null;
    if (route.name === "assignment" && entity.entityType === "assignmentBundle") return assignmentModel(index, entity, bundle);
    if (route.name === "quiz" && entity.entityType === "quizBundle") return quizModel(index, entity, bundle);
    if (route.name === "discussion" && entity.entityType === "discussionThread") return discussionModel(index, entity, bundle);
    if (route.name === "task" && entity.entityType === "courseToolItem") return taskModel(index, entity);
    if (route.name === "announcement" && entity.entityType === "announcement") return announcementModel(index, entity, bundle);
    if (route.name === "grade" && entity.entityType === "gradeRecord") return gradeDetailModel(index, entity, bundle);
    if (route.name === "event" && entity.entityType === "calendarEvent") return eventModel(index, entity);
    return null;
  }

  function parseRoute(hash) {
    const clean = String(hash || "").replace(/^#\/?/, "");
    const [path, query = ""] = clean.split("?");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const params = Object.fromEntries(new URLSearchParams(query));
    const name = parts[0] || "dashboard";
    return { name, id: parts[1] || "", params };
  }

  function isDetailRoute(routeOrHash) {
    const route = typeof routeOrHash === "string" ? parseRoute(routeOrHash) : routeOrHash;
    return DETAIL_ROUTES.has(route?.name);
  }

  // Routes that open over the current page: an item's details, or Settings.
  function isLayerRoute(routeOrHash) {
    const route = typeof routeOrHash === "string" ? parseRoute(routeOrHash) : routeOrHash;
    return isDetailRoute(route) || route?.name === "settings";
  }

  function canonicalParentForRoute(index, routeOrHash) {
    const route = typeof routeOrHash === "string" ? parseRoute(routeOrHash) : routeOrHash;
    const entity = route?.id ? index?.byId?.get(route.id) : null;
    const course = entity?.courseId ? encodeURIComponent(entity.courseId) : "";
    if (route?.name === "assignment") return "#/work";
    if (route?.name === "quiz") return "#/work?type=quiz";
    if (route?.name === "discussion") return "#/work?type=discussion";
    if (route?.name === "task") return "#/work?type=task";
    if (route?.name === "checklist") return "#/work";
    if (route?.name === "announcement") return course ? `#/updates?course=${course}` : "#/updates";
    if (route?.name === "grade") return course ? `#/grades?course=${course}` : "#/grades";
    if (route?.name === "event") return "#/calendar";
    return "#/";
  }

  // Where a link goes when the dashboard runs in the overlay on a D2L page:
  // "route" stays in the overlay, "d2l" opens in that same tab (the overlay
  // closes), "extension" and "external" open a new tab as usual.
  function embeddedLinkTarget(href) {
    const link = String(href || "");
    if (link.startsWith("#")) return "route";
    if (link.startsWith(`${D2L_ORIGIN}/`)) return "d2l";
    if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith("//")) return "external";
    return "extension";
  }


  Object.assign(dash, {
    detailFor, parseRoute, isDetailRoute, isLayerRoute, canonicalParentForRoute, embeddedLinkTarget
  });
})(globalThis);
