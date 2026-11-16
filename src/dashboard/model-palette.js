// What the search pop-up lists. Before you type: work due soon and the latest
// announcements. While you type: the archive's hits (the same search the Search
// page uses). Rows are plain data; render-palette.js draws them.
(function initDashboardModelPalette(global) {
  const dash = global.D2LDashboard ||= {};
  const { fmtTime, plural, relativeDay, routeFor, searchModel, searchPanelModel } = dash;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const DUE_DAYS = 14;
  const HOME_ROWS = 3;
  const HIT_ROWS = 8;
  const WORK_TYPES = new Set(["assignmentBundle", "quizBundle", "discussionThread", "courseToolItem"]);

  const NOTHING = Object.freeze({ query: "", groups: [], total: 0, allRoute: "" });
  const courseLabel = (index, entity) => index.courseById.get(entity.courseId)?.label || "";

  // "Tomorrow, 11:59 PM" for the next two days, "in 5 days" after that.
  function dueText(iso, now) {
    const day = relativeDay(iso, now);
    return day === "Today" || day === "Tomorrow" ? `${day}, ${fmtTime(iso)}` : day;
  }

  function dueSoon(index, skip, now) {
    const from = now.getTime();
    return index.entities
      .filter((entity) => WORK_TYPES.has(entity.entityType) && entity.dates?.dueAt && index.visible.has(entity.courseId) && !skip.has(entity.entityId))
      .map((entity) => ({ entity, at: Date.parse(entity.dates.dueAt) }))
      .filter(({ at }) => at >= from && at <= from + DUE_DAYS * DAY_MS)
      .sort((a, b) => a.at - b.at)
      .slice(0, HOME_ROWS)
      .map(({ entity }) => ({ id: entity.entityId, type: entity.entityType, title: entity.canonicalTitle, tag: courseLabel(index, entity), right: dueText(entity.dates.dueAt, now), route: routeFor(entity) }));
  }

  function latestAnnouncements(index, now) {
    return index.entities
      .filter((entity) => entity.entityType === "announcement" && entity.dates?.publishedAt && index.visible.has(entity.courseId))
      .map((entity) => ({ entity, at: Date.parse(entity.dates.publishedAt) }))
      .filter(({ at }) => Number.isFinite(at))
      .sort((a, b) => b.at - a.at)
      .slice(0, HOME_ROWS)
      .map(({ entity }) => ({ id: entity.entityId, type: entity.entityType, title: entity.canonicalTitle, tag: courseLabel(index, entity), right: relativeDay(entity.dates.publishedAt, now), route: routeFor(entity) }));
  }

  // The list before anything is typed. skip is the set of work marked done or skipped.
  function paletteHome({ index, skip = new Set(), now = new Date() } = {}) {
    if (!index) return NOTHING;
    const groups = [
      { name: "Due soon", rows: dueSoon(index, skip, now) },
      { name: "Latest announcements", rows: latestAnnouncements(index, now) }
    ].filter((group) => group.rows.length);
    return { ...NOTHING, groups };
  }

  // The list for a typed query: the first few hits in the Search page's order, as one group.
  function paletteHits({ index, result, query }) {
    if (!index || !result) return { ...NOTHING, query };
    const panel = searchPanelModel(searchModel(index, { ...result, query }), HIT_ROWS);
    const rows = panel.groups.flatMap((group) => group.items.map((item) => ({ id: item.id, type: item.type, title: item.title, tag: item.kind, right: item.course, snippet: item.snippet, route: item.route })));
    return { query, groups: rows.length ? [{ name: `In your archive · ${plural(panel.total, "result")}`, rows }] : [], total: panel.total, allRoute: panel.allRoute };
  }

  // Everything the arrow keys can land on, top to bottom. With a query, "Ask" comes
  // first and "See all" (the Search page) last, when there are more hits than rows.
  function paletteOptions(view) {
    const hits = view.groups.flatMap((group) => group.rows.map((row) => ({ kind: "hit", route: row.route })));
    if (!view.query) return hits;
    const all = view.total > hits.length ? [{ kind: "all", route: view.allRoute }] : [];
    return [{ kind: "ask" }, ...hits, ...all];
  }

  // Where the highlight starts: the first archive hit (so Enter opens it), else the first row.
  function paletteStart(options) {
    const first = options.findIndex((option) => option.kind === "hit");
    return first >= 0 ? first : options.length ? 0 : -1;
  }

  Object.assign(dash, { paletteHome, paletteHits, paletteOptions, paletteStart });
})(globalThis);
