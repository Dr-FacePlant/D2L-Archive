// Guessed deadlines for work D2L leaves undated: a module's close date, or when
// the next module opens. A guess is never a stated due date and never counts as
// late; the work item decides that, this file only finds the candidate date.
(function initDashboardModelInferredDue(global) {
  const dash = global.D2LDashboard ||= {};
  const { LINK_KINDS, lessonKey, time } = dash;

  // A module's own close date, or the same boundary D2L puts on the calendar as
  // "Availability Ends". Older archives stored modules before their dates were
  // kept, so the calendar covers them.
  function moduleBoundaries(entities) {
    const closes = new Map();
    const starts = new Map();
    for (const entity of entities) {
      if (entity.entityType !== "learningResource" || !entity.isModule) continue;
      if (entity.moduleEndsAt) closes.set(entity.entityId, entity.moduleEndsAt);
      if (entity.moduleStartsAt) starts.set(entity.entityId, entity.moduleStartsAt);
    }
    for (const entity of entities) {
      if (entity.entityType !== "calendarEvent" || !entity.targetEntityId) continue;
      if (!/ModuleCO$/.test(entity.sourceEntityType || "")) continue;
      const at = entity.dates?.dueAt || entity.dates?.endAt || entity.dates?.startAt;
      if (!at) continue;
      if (entity.eventLabel === "Availability Ends" && !closes.has(entity.targetEntityId)) closes.set(entity.targetEntityId, at);
      if (entity.eventLabel === "Available" && !starts.has(entity.targetEntityId)) starts.set(entity.targetEntityId, at);
    }
    return { closes, starts };
  }

  function moduleChain(byId, courseId, moduleId) {
    const found = [];
    const seen = new Set();
    for (let id = moduleId; id && !seen.has(id);) {
      seen.add(id);
      const module = byId.get(`resource:${courseId}:${id}`);
      if (!module) break;
      found.push(module);
      id = module.parentModuleId || "";
    }
    return found;
  }

  // Content links are how work joins its module: the link's title matches the
  // work's title and D2L's quick link says which tool it points at.
  function linkKind(entity) {
    const linkType = String(entity.urls?.download || entity.urls?.external || "").match(/[?&]type=(discuss|quiz|dropbox)\b/)?.[1];
    return LINK_KINDS[linkType] || "";
  }

  function inferredDueDates(entities, byId) {
    const { closes, starts } = moduleBoundaries(entities);
    const modulesByCourse = new Map();
    for (const entity of entities) {
      if (entity.entityType !== "learningResource" || !entity.isModule) continue;
      if (!modulesByCourse.has(entity.courseId)) modulesByCourse.set(entity.courseId, []);
      modulesByCourse.get(entity.courseId).push(entity);
    }
    for (const modules of modulesByCourse.values()) {
      modules.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    }
    const nextOpen = (courseId, moduleId) => {
      const modules = modulesByCourse.get(courseId) || [];
      const at = modules.findIndex((module) => module.entityId === `resource:${courseId}:${moduleId}`);
      if (at < 0) return null;
      for (const module of modules.slice(at + 1)) {
        const start = starts.get(module.entityId);
        if (start) return { at: start, module };
      }
      return null;
    };
    const guesses = new Map();
    for (const entity of entities) {
      if (entity.entityType !== "learningResource" || entity.isModule || !entity.moduleId) continue;
      const kind = linkKind(entity);
      let guess = null;
      for (const module of moduleChain(byId, entity.courseId, entity.moduleId)) {
        const at = closes.get(module.entityId);
        if (at) { guess = { at, rule: "moduleClose", module: module.canonicalTitle || entity.moduleTitle || "" }; break; }
      }
      if (!guess) {
        const next = nextOpen(entity.courseId, entity.moduleId);
        if (next) guess = { at: next.at, rule: "nextModuleOpen", module: next.module.canonicalTitle || "" };
      }
      if (!guess) continue;
      for (const key of new Set([lessonKey(entity.courseId, entity.canonicalTitle, kind), lessonKey(entity.courseId, entity.canonicalTitle, "")])) {
        if (!guesses.has(key)) guesses.set(key, guess);
      }
    }
    return guesses;
  }

  // A guess already in the past says nothing about when the work is due, so it
  // is not offered at all: the item reads "No due date" again.
  function inferredDue(index, entity, kind) {
    const found = index.inferredDue?.get(lessonKey(entity.courseId, entity.canonicalTitle, kind))
      || index.inferredDue?.get(lessonKey(entity.courseId, entity.canonicalTitle, ""));
    if (!found || !Number.isFinite(time(found.at)) || time(found.at) < index.now.getTime()) return null;
    return found;
  }

  Object.assign(dash, { inferredDueDates, inferredDue, moduleBoundaries, linkKind });
})(globalThis);
