// "Related items" at the bottom of an assignment or quiz pop-up.
//
// What D2L links by id, and so is exact: the item's grade record and any
// calendar event that targets it. What it doesn't: a content module names an
// assignment or quiz only by title and tool kind, so module neighbors are found
// the way lesson deadlines are (title plus kind) and left out when nothing
// matches. Announcements carry no link to an item, so they are not listed.
(function initDashboardModelRelated(global) {
  const dash = global.D2LDashboard ||= {};

  const WORK_TYPES = Object.freeze({ quiz: "quizBundle", assignment: "assignmentBundle", discussion: "discussionThread" });
  const WORK_ICONS = Object.freeze({ quiz: "quiz", assignment: "work", discussion: "chat" });
  const WORK_LABELS = Object.freeze({ quiz: "Quiz", assignment: "Assignment", discussion: "Discussion" });
  const MAX_CONTENT = 6;
  const MAX_WORK = 6;
  const MAX_EVENTS = 3;

  const norm = (title) => String(title || "").replace(/\s+/g, " ").trim().toLowerCase();
  const byOrder = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.canonicalTitle).localeCompare(String(b.canonicalTitle));

  function excerpt(text, max = 120) {
    const clean = dash.plainText(text || "").replace(/\s+/g, " ").trim();
    if (clean.length <= max) return clean;
    return `${clean.slice(0, max).replace(/\s+\S*$/, "")}…`;
  }

  // D2L's quick link says which tool a content topic opens (type=quiz, ...).
  function topicKind(topic) {
    const type = String(topic.urls?.download || topic.urls?.external || "").match(/[?&]type=(discuss|quiz|dropbox)\b/)?.[1];
    return dash.LINK_KINDS?.[type] || "";
  }

  // The content topic that stands for this item inside its module, then every
  // other topic in that module. A plain page that happens to share the title
  // counts only when it is the single match.
  function moduleNeighbors(index, entity, kind) {
    const topics = index.list(entity.courseId, "learningResource").filter((topic) => !topic.isModule && topic.moduleId);
    const same = topics.filter((topic) => norm(topic.canonicalTitle) === norm(entity.canonicalTitle));
    const home = same.find((topic) => topicKind(topic) === kind) || (same.length === 1 && !topicKind(same[0]) ? same[0] : null);
    if (!home) return null;
    const module = index.byId.get(`resource:${entity.courseId}:${home.moduleId}`);
    return {
      moduleId: String(home.moduleId),
      title: module?.canonicalTitle || home.moduleTitle || "",
      topics: topics.filter((topic) => String(topic.moduleId) === String(home.moduleId) && topic.entityId !== home.entityId).sort(byOrder)
    };
  }

  function chip(v, tone = "neutral") {
    return { k: "Status", v, tone };
  }

  // A content pill opens the item in D2L (through the usual "Open in D2L?"
  // prompt). A topic with no web link falls back to the Content screen.
  function contentItem(index, topic, moduleTitle) {
    const resource = dash.resourceItem(index, topic);
    const d2lUrl = /^https?:\/\//i.test(resource.d2lUrl) ? resource.d2lUrl : "";
    return {
      id: topic.entityId,
      kind: "content",
      icon: resource.icon,
      title: topic.canonicalTitle,
      meta: [resource.type, moduleTitle].filter(Boolean).join(" · "),
      text: excerpt(topic.description),
      // Only a topic D2L reports as visited says so; no record is not "unseen".
      facts: topic.progress ? [chip("Viewed", "good")] : [],
      route: dash.routeFor(topic),
      d2lUrl,
      open: d2lUrl ? "Open in D2L" : "Open content"
    };
  }

  function workItemFor(index, entity, kind, moduleTitle) {
    const item = dash.workItem(index, entity);
    const due = item.dueAt ? dash.fmtDateTime(item.dueAt, index.now) : "";
    return {
      id: entity.entityId,
      kind,
      icon: WORK_ICONS[kind],
      title: entity.canonicalTitle,
      meta: [WORK_LABELS[kind], moduleTitle].filter(Boolean).join(" · "),
      text: excerpt(entity.summary || entity.description || entity.prompt),
      facts: [due ? { k: "Due", v: due } : null, chip(item.status.label, item.status.tone)].filter(Boolean),
      route: dash.routeFor(entity),
      open: `Open ${kind}`
    };
  }

  // A content topic that opens a quiz, assignment or discussion becomes that
  // item's own pill when a bundle with the same title exists in the course.
  function workNeighbor(index, topic, self, moduleTitle) {
    const kind = topicKind(topic);
    if (!kind) return null;
    const bundle = index.list(topic.courseId, WORK_TYPES[kind]).find((entity) => norm(entity.canonicalTitle) === norm(topic.canonicalTitle));
    return bundle && bundle.entityId !== self.entityId ? workItemFor(index, bundle, kind, moduleTitle) : null;
  }

  function gradeItem(index, entity) {
    const grade = entity.gradeEntityId
      ? index.byId.get(entity.gradeEntityId)
      : index.list(entity.courseId, "gradeRecord").find((record) => record.sourceEntityId === entity.entityId);
    if (!grade) return null;
    const graded = dash.isGradedGrade(grade);
    const score = dash.gradeLabel(grade);
    return {
      id: grade.entityId,
      kind: "grade",
      icon: "grade",
      title: grade.canonicalTitle,
      meta: "Grade item · Grades",
      text: graded ? (score ? `Your score: ${score}.` : "D2L has graded this.") : "D2L hasn't posted a grade yet.",
      facts: [graded ? chip(score ? `Graded · ${score}` : "Graded", "good") : chip("Not graded yet")],
      route: dash.routeFor(grade),
      open: "Open grade"
    };
  }

  // A calendar event that only repeats the item's own due date adds nothing.
  function eventItems(index, entity) {
    const own = entity.dates?.dueAt ? dash.time(entity.dates.dueAt) : NaN;
    return index.list(entity.courseId, "calendarEvent")
      .filter((event) => event.targetEntityId === entity.entityId)
      .filter((event) => !(event.eventLabel === "Due" && dash.time(event.dates?.dueAt || event.dates?.startAt) === own))
      .slice(0, MAX_EVENTS)
      .map((event) => {
        const at = event.dates?.dueAt || event.dates?.startAt || null;
        const when = at ? dash.fmtDateTime(at, index.now) : "";
        return {
          id: event.entityId,
          kind: "event",
          icon: "calendar",
          title: event.canonicalTitle,
          meta: `Calendar · ${event.eventLabel || "Event"}`,
          text: when,
          facts: [],
          route: dash.routeFor(event),
          open: "Open event"
        };
      });
  }

  // Groups, in the order the pop-up lists them: Work & grades, Content, Calendar.
  // An empty group is dropped, so an archive with no module data shows only
  // what links exactly, and an item with nothing related shows no section.
  function relatedItems(index, entity, kind) {
    if (!entity || !WORK_TYPES[kind] || !dash.workItem) return [];
    const near = moduleNeighbors(index, entity, kind);
    const moduleTitle = near?.title || "";
    const work = [];
    const content = [];
    for (const topic of near?.topics || []) {
      const neighbor = workNeighbor(index, topic, entity, moduleTitle);
      if (neighbor) work.push(neighbor);
      else if (!topicKind(topic)) content.push(contentItem(index, topic, moduleTitle));
    }
    const grade = gradeItem(index, entity);
    const groups = [
      { id: "work", label: "Work & grades", items: [...work.slice(0, MAX_WORK), grade].filter(Boolean), more: null },
      { id: "content", label: "Content", items: content.slice(0, MAX_CONTENT), more: content.length > MAX_CONTENT ? { count: content.length - MAX_CONTENT, route: `#/resources/${encodeURIComponent(entity.courseId)}?module=${encodeURIComponent(near.moduleId)}` } : null },
      { id: "calendar", label: "Calendar", items: eventItems(index, entity), more: null }
    ];
    return groups.filter((group) => group.items.length);
  }

  Object.assign(dash, { relatedItems });
})(globalThis);
