// Best-effort deadlines for D2L work with no usable due date.
(function initDashboardModelInferredDue(global) {
  const dash = global.D2LDashboard ||= {};
  const { LINK_KINDS, lessonKey, time } = dash;
  const WORK_KIND = { assignmentBundle: "assignment", quizBundle: "quiz", discussionThread: "discussion" };

  function moduleBoundaries(entities) {
    const closes = new Map();
    const starts = new Map();
    for (const entity of entities) {
      if (entity.entityType !== "learningResource" || !entity.isModule) continue;
      if (entity.moduleEndsAt) closes.set(entity.entityId, entity.moduleEndsAt);
      if (entity.moduleStartsAt) starts.set(entity.entityId, entity.moduleStartsAt);
    }
    for (const entity of entities) {
      if (entity.entityType !== "calendarEvent" || !entity.targetEntityId || !/ModuleCO$/.test(entity.sourceEntityType || "")) continue;
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

  function linkKind(entity) {
    const linkType = String(entity.urls?.download || entity.urls?.external || "").match(/[?&]type=(discuss|quiz|dropbox)\b/)?.[1];
    return LINK_KINDS[linkType] || "";
  }

  function inferredDueDates(entities, byId) {
    const { closes, starts } = moduleBoundaries(entities);
    const modulesByCourse = new Map();
    const workByKey = new Map();
    const topicsByForum = new Map();
    for (const entity of entities) {
      if (entity.entityType === "learningResource" && entity.isModule) {
        if (!modulesByCourse.has(entity.courseId)) modulesByCourse.set(entity.courseId, []);
        modulesByCourse.get(entity.courseId).push(entity);
      }
      const kind = WORK_KIND[entity.entityType];
      if (kind) workByKey.set(lessonKey(entity.courseId, entity.canonicalTitle, kind), entity);
      if (entity.entityType === "discussionThread" && entity.forumId) {
        const key = `${entity.courseId}|${entity.forumId}`;
        if (!topicsByForum.has(key)) topicsByForum.set(key, []);
        topicsByForum.get(key).push(entity);
      }
    }
    for (const modules of modulesByCourse.values()) modules.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    const guesses = new Map();
    const put = (work, guess, direct = false) => {
      if (!work || !guess?.at || !Number.isFinite(time(guess.at))) return;
      const keys = new Set([
        lessonKey(work.courseId, work.canonicalTitle, WORK_KIND[work.entityType]),
        lessonKey(work.courseId, work.canonicalTitle, "")
      ]);
      for (const key of keys) {
        const old = guesses.get(key);
        const oldDirect = old?.rule === "calendarReminder";
        if (!old || (direct && !oldDirect) || (direct === oldDirect && time(guess.at) < time(old.at))) guesses.set(key, guess);
      }
    };
    const resourceWork = (resource) => workByKey.get(lessonKey(resource.courseId, resource.canonicalTitle, linkKind(resource))) || null;
    const eventTime = (event) => event.dates?.dueAt || event.dates?.startAt || event.dates?.endAt || null;
    const moduleResources = new Map();
    for (const resource of entities) {
      if (resource.entityType !== "learningResource" || resource.isModule || !resource.moduleId) continue;
      const key = `${resource.courseId}|${resource.moduleId}`;
      if (!moduleResources.has(key)) moduleResources.set(key, []);
      moduleResources.get(key).push(resource);
    }

    // Use D2L's explicit event-to-item link, or an exact title match when D2L
    // omitted that link. Unrelated, untargeted calendar reminders are not guessed.
    for (const event of entities.filter((item) => item.entityType === "calendarEvent")) {
      if (["Available", "Availability Ends"].includes(event.eventLabel)) continue;
      const at = eventTime(event);
      if (!at) continue;
      let target = event.targetEntityId ? byId.get(event.targetEntityId) : null;
      let work = target && WORK_KIND[target.entityType] ? target : null;
      if (!work && target?.entityType === "learningResource" && !target.isModule) work = resourceWork(target);
      if (!work && target?.entityType === "learningResource" && target.isModule) {
        const moduleId = target.entityId.split(":").at(-1);
        for (const resource of moduleResources.get(`${event.courseId}|${moduleId}`) || []) {
          const moduleWork = resourceWork(resource);
          if (moduleWork) put(moduleWork, { at, rule: "calendarReminder", sourceTitle: event.canonicalTitle || "D2L calendar reminder" }, true);
        }
        continue;
      }
      if (!work && target?.entityType === "discussionForum") {
        const topics = topicsByForum.get(`${event.courseId}|${target.entityId}`) || [];
        for (const topic of topics) put(topic, { at, rule: "calendarReminder", sourceTitle: event.canonicalTitle || "D2L calendar reminder" }, true);
        continue;
      }
      if (!work) {
        const titleKey = lessonKey(event.courseId, event.canonicalTitle, "");
        work = entities.find((item) => WORK_KIND[item.entityType] && lessonKey(item.courseId, item.canonicalTitle, "") === titleKey) || null;
      }
      if (work) put(work, { at, rule: "calendarReminder", sourceTitle: event.canonicalTitle || "D2L calendar reminder" }, true);
    }

    // A real quiz deadline is a useful module cutoff for undated work beside it.
    for (const resources of moduleResources.values()) {
      const quizzes = resources.map((resource) => ({ resource, work: resourceWork(resource) }))
        .filter(({ resource, work }) => linkKind(resource) === "quiz" && work?.entityType === "quizBundle"
          && work.dueAtSource !== "apiEndDate" && work.dates?.dueAt)
        .sort((a, b) => time(a.work.dates.dueAt) - time(b.work.dates.dueAt));
      if (!quizzes.length) continue;
      const quiz = quizzes[0].work;
      for (const resource of resources) {
        if (linkKind(resource) === "quiz") continue;
        const work = resourceWork(resource);
        if (work) put(work, { at: quiz.dates.dueAt, rule: "moduleQuiz", sourceTitle: quiz.canonicalTitle || "module quiz" });
      }
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
    for (const resource of entities) {
      if (resource.entityType !== "learningResource" || resource.isModule || !resource.moduleId) continue;
      const work = resourceWork(resource);
      if (!work) continue;
      let boundary = null;
      for (const module of moduleChain(byId, resource.courseId, resource.moduleId)) {
        const at = closes.get(module.entityId);
        if (at) { boundary = { at, rule: "moduleClose", module: module.canonicalTitle || resource.moduleTitle || "Module" }; break; }
      }
      if (boundary) put(work, boundary);
      const next = nextOpen(resource.courseId, resource.moduleId);
      if (next) put(work, { at: next.at, rule: "nextModuleOpen", module: next.module.canonicalTitle || "next module" });
    }
    return guesses;
  }

  function inferredDue(index, entity, kind) {
    const found = index.inferredDue?.get(lessonKey(entity.courseId, entity.canonicalTitle, kind))
      || index.inferredDue?.get(lessonKey(entity.courseId, entity.canonicalTitle, ""));
    if (!found || !Number.isFinite(time(found.at))) return null;
    return found;
  }

  Object.assign(dash, { inferredDueDates, inferredDue, moduleBoundaries, linkKind });
})(globalThis);
