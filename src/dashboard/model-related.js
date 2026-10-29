// "Related items" at the bottom of an assignment or quiz pop-up.
//
// What D2L links by id, and so is exact: the item's grade record. What it
// doesn't: a content module names an
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

  const norm = (title) => String(title || "").replace(/\s+/g, " ").trim().toLowerCase();
  const byOrder = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.canonicalTitle).localeCompare(String(b.canonicalTitle));

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

  function excerpt(text, max = 360) {
    const clean = dash.plainText(text || "").replace(/\s+/g, " ").trim();
    if (clean.length <= max) return clean;
    return `${clean.slice(0, max).replace(/\s+\S*$/, "")}…`;
  }

  const web = (url) => /^https?:\/\//i.test(url || "") ? url : "";

  // Work, grade and content pills open the side panel; `peek` carries what it
  // needs. Work and grades get a short summary. A content topic shows its file,
  // or is described when there is none, and falls back to the Content screen
  // when there is nothing behind it at all.
  function contentItem(index, topic, moduleTitle) {
    const resource = dash.resourceItem(index, topic);
    const peek = {
      mode: "content",
      title: topic.canonicalTitle,
      icon: resource.icon,
      // Only a topic D2L reports as visited says so; no record is not "unseen".
      meta: [moduleTitle, resource.type, resource.visited ? "Viewed" : ""].filter(Boolean).join(" · "),
      d2lUrl: web(resource.d2lUrl),
      downloadUrl: web(resource.downloadUrl),
      localPath: resource.localPath,
      external: web(resource.external)
    };
    return {
      id: topic.entityId,
      kind: "content",
      icon: resource.icon,
      title: topic.canonicalTitle,
      line: [resource.type, moduleTitle, resource.visited ? "Viewed" : ""].filter(Boolean).join(" · "),
      peek: peek.d2lUrl || peek.downloadUrl || peek.localPath || peek.external ? peek : null,
      route: dash.routeFor(topic)
    };
  }

  function workItemFor(index, entity, kind, moduleTitle) {
    const item = dash.workItem(index, entity);
    const due = item.dueAt ? dash.fmtDateTime(item.dueAt, index.now) : "";
    const route = dash.routeFor(entity);
    return {
      id: entity.entityId,
      kind,
      icon: WORK_ICONS[kind],
      title: entity.canonicalTitle,
      line: [WORK_LABELS[kind], moduleTitle, item.status.label].filter(Boolean).join(" · "),
      peek: {
        mode: "summary",
        title: entity.canonicalTitle,
        icon: WORK_ICONS[kind],
        meta: [WORK_LABELS[kind], moduleTitle].filter(Boolean).join(" · "),
        facts: [
          due ? { k: "Due", v: due } : null,
          item.points ? { k: "Worth", v: item.points } : null,
          { k: "Status", v: item.score ? `${item.status.label} · ${item.score}` : item.status.label }
        ].filter(Boolean),
        text: excerpt(entity.summary || entity.description || entity.prompt),
        d2lUrl: web(item.d2lUrl),
        route
      },
      route
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

  // Groups, in the order the pop-up lists them: Assignments, then Content.
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
    const groups = [
      { id: "work", label: "Assignments", items: work.slice(0, MAX_WORK), more: null },
      { id: "content", label: "Content", items: content.slice(0, MAX_CONTENT), more: content.length > MAX_CONTENT ? { count: content.length - MAX_CONTENT, route: `#/resources/${encodeURIComponent(entity.courseId)}?module=${encodeURIComponent(near.moduleId)}` } : null }
    ];
    return groups.filter((group) => group.items.length);
  }

  Object.assign(dash, { relatedItems });
})(globalThis);
