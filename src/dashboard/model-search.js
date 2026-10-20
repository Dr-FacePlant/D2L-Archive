// Search results and the search panel.
(function initDashboardModelSearch(global) {
  const dash = global.D2LDashboard ||= {};
  const { KIND_LABELS, ROUTE_BY_TYPE, fmtShortDate, plainText, routeFor, words } = dash;
  // ---------------------------------------------------------------- search

  // The words around the first match, so a result shows why it matched.
  function snippetOf(query, texts) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return null;
    for (const raw of texts) {
      const text = plainText(raw || "").replace(/\s+/g, " ").trim();
      const at = text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, at - 60)) + 1);
      const end = Math.min(text.length, at + needle.length + 90);
      return { before: `${start > 0 ? "…" : ""}${text.slice(start, at)}`, match: text.slice(at, at + needle.length), after: `${text.slice(at + needle.length, end)}${end < text.length ? "…" : ""}` };
    }
    return null;
  }

  function searchDate(entity, now) {
    const at = entity.dates?.publishedAt || entity.dates?.dueAt || entity.dates?.gradedAt || entity.dates?.startAt || entity.dates?.availableUntil;
    return at ? fmtShortDate(at, now) : "";
  }

  function searchModel(index, result) {
    if (!result) return { query: "", groups: [], total: 0 };
    const groups = new Map();
    const seen = new Set();
    const add = (group, entity, record = null) => {
      if (!entity || seen.has(entity.entityId) || !index.visible.has(entity.courseId)) return;
      const route = routeFor(entity);
      if (!route) return;
      const course = index.courseById.get(entity.courseId);
      const title = entity.canonicalTitle || entity.displayName || "";
      // D2L's gradebook can hold two items with one name (CRJU's quiz-linked
      // "Exam 1" and a plain "Exam 1"); search shows one, the linked one. The
      // Grades page still lists both.
      const nameKey = `${group}|${entity.courseId}|${title}`;
      if (group === "Grades" && seen.has(nameKey)) return;
      seen.add(entity.entityId);
      seen.add(nameKey);
      if (!groups.has(group)) groups.set(group, []);
      const texts = [entity.body, entity.description, entity.summary, entity.prompt, entity.instructions, entity.feedback, record?.description, record?.title];
      groups.get(group).push({
        id: entity.entityId,
        title,
        sub: [KIND_LABELS[ROUTE_BY_TYPE[entity.entityType]] || GROUP_LABELS[entity.entityType] || "", course?.label].filter(Boolean).join(" · "),
        date: searchDate(entity, index.now),
        snippet: snippetOf(result.query, texts),
        route
      });
    };
    const entities = (result.entities || []).map((entity) => index.byId.get(entity.entityId) || entity);
    // Grade items linked to their quiz or assignment go first, so the linked one wins a name clash.
    const linkedFirst = (entity) => (entity.entityType === "gradeRecord" && entity.sourceEntityId ? 0 : 1);
    entities.sort((a, b) => linkedFirst(a) - linkedFirst(b));
    for (const entity of entities) add(GROUP_OF[entity.entityType] || "Other", entity);
    // Evidence hits (post text, file names, page text) point back to their entity.
    for (const record of result.evidence || []) {
      const entity = index.entities.find((candidate) => candidate.primaryEvidenceId === record.evidenceId) || entityForEvidence(index, record);
      add(GROUP_OF[entity?.entityType] || "Other", entity, record);
    }
    const order = ["Work", "Announcements", "Grades", "Content", "Calendar", "Other"];
    // Items named for the query come first ("Exam 1" before homework whose
    // instructions mention "examples"); the rest keep the archive's order.
    const needle = String(result.query || "").trim().toLowerCase();
    const named = (item) => (needle && item.title.toLowerCase().includes(needle) ? 0 : 1);
    const list = order.filter((name) => groups.has(name)).map((name) => ({ name, items: groups.get(name).slice().sort((a, b) => named(a) - named(b)) }));
    return { query: result.query, groups: list, total: list.reduce((sum, group) => sum + group.items.length, 0) };
  }

  // The live panel under the top-bar box: the first few hits in the Search
  // page's group order, plus a link to all of them.
  const SEARCH_PANEL_HITS = 6;
  function searchPanelModel(model, limit = SEARCH_PANEL_HITS) {
    const query = String(model?.query || "").trim();
    const groups = [];
    let left = limit;
    for (const group of model?.groups || []) {
      if (!left) break;
      const items = group.items.slice(0, left);
      left -= items.length;
      groups.push({ name: group.name, items });
    }
    return { query, groups, shown: limit - left, total: model?.total || 0, allRoute: query ? `#/search?q=${encodeURIComponent(query)}` : "#/search" };
  }

  const GROUP_OF = Object.freeze({
    assignmentBundle: "Work", quizBundle: "Work", discussionThread: "Work", courseToolItem: "Work",
    announcement: "Announcements", gradeRecord: "Grades", learningResource: "Content", calendarEvent: "Calendar"
  });
  const GROUP_LABELS = Object.freeze({ announcement: "Announcement", gradeRecord: "Grade", learningResource: "Content", calendarEvent: "Calendar event" });

  function entityForEvidence(index, record) {
    const ids = record.platformIds || {};
    const course = record.courseId;
    const candidates = [
      ids.discussionTopicId && `discussionThread:${course}:${ids.discussionTopicId}`,
      ids.dropboxFolderId && `assignment:${course}:${ids.dropboxFolderId}`,
      ids.quizId && `quiz:${course}:${ids.quizId}`,
      ids.newsItemId && `announcement:${course}:${ids.newsItemId}`,
      ids.contentObjectId && `resource:${course}:${ids.contentObjectId}`,
      ids.gradeObjectId && `grade:${course}:${ids.gradeObjectId}`
    ].filter(Boolean);
    return candidates.map((id) => index.byId.get(id)).find(Boolean) || null;
  }


  Object.assign(dash, {
    snippetOf, searchDate, searchModel, searchPanelModel, entityForEvidence, SEARCH_PANEL_HITS, GROUP_OF, GROUP_LABELS
  });
})(globalThis);
