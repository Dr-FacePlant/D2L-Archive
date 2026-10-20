(function initApplicationApiModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const {
    APP_API_PROTOCOL_VERSION,
    APP_API_ERROR_CODES,
    appApiError,
    appApiResponse,
    appApiErrorResponse,
    validateAppApiRequest
  } = shared;

  const IMPLEMENTED_READ_METHODS = Object.freeze([
    "system.getCapabilities",
    "system.getDatabaseStatus",
    "system.getAccountContext",
    "courses.list",
    "courses.get",
    "courses.getOverview",
    "evidence.list",
    "evidence.get",
    "entities.list",
    "entities.get",
    "entities.getBundle",
    "relationships.list",
    "assignments.list",
    "quizzes.list",
    "grades.list",
    "announcements.list",
    "discussions.list",
    "resources.list",
    "calendar.list",
    "policies.list",
    "progress.list",
    "tools.list",
    "people.list",
    "externalResources.list",
    "gaps.list",
    "dashboard.getOverview",
    "dashboard.getUpcoming",
    "dashboard.getRecentChanges",
    "dashboard.getUpdates",
    "search.query",
    "sync.getState",
    "sync.getQueue",
    "sync.getRun",
    "activity.list",
    "activity.getSummary"
  ]);
  const IMPLEMENTED_INTERNAL_METHODS = Object.freeze(["archive.ingestRows"]);

  // There is no default archive: every request resolves the signed-in
  // account's own repository, or fails closed.
  function accountApiError(error) {
    const code = error?.code === "ACCOUNT_UNKNOWN" ? APP_API_ERROR_CODES.ACCOUNT_UNKNOWN : APP_API_ERROR_CODES.ACCOUNT_QUARANTINED;
    return appApiError(code, error?.message || "The archive for this account is unavailable.");
  }

  function requireString(params, key) {
    const value = String(params?.[key] || "").trim();
    if (!value) throw appApiError(APP_API_ERROR_CODES.INVALID_PARAMS, `${key} is required.`);
    return value;
  }

  function entityCounts(entities) {
    return Object.fromEntries([...new Set(entities.map((entity) => entity.entityType))]
      .sort()
      .map((entityType) => [entityType, entities.filter((entity) => entity.entityType === entityType).length]));
  }

  function dueAtForEntity(entity) {
    return entity?.dates?.dueAt || entity?.dates?.availableUntil || null;
  }

  // Work the student already turned in is not "upcoming"; includeCompleted brings it back.
  const COMPLETED_STATUSES = new Set(["submitted", "graded", "attempted", "completed"]);

  async function upcomingEntities(repository, params = {}) {
    const now = Date.parse(params.now || new Date().toISOString());
    const horizonDays = Math.min(Math.max(Number(params.horizonDays || 120), 1), 730);
    const limit = Math.min(Math.max(Number(params.limit || 50), 1), 200);
    const horizon = now + horizonDays * 24 * 60 * 60 * 1000;
    return (await repository.listEntities({ courseId: params.courseId }))
      .map((entity) => ({ ...entity, dueAt: dueAtForEntity(entity) }))
      .filter((entity) => {
        const due = Date.parse(entity.dueAt || "");
        return !(entity.entityType === "calendarEvent" && entity.targetEntityId)
          && (params.includeCompleted === true || !COMPLETED_STATUSES.has(entity.status))
          && Number.isFinite(due)
          && (params.includePast === true || due >= now)
          && due <= horizon;
      })
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
      .slice(0, limit);
  }

  // Evidence sources whose due date or first appearance the student cares about.
  const WATCHED_SOURCES = Object.freeze({
    assignment: (record) => `assignment:${record.courseId}:${record.platformIds?.dropboxFolderId || ""}`,
    quiz: (record) => `quiz:${record.courseId}:${record.platformIds?.quizId || ""}`,
    discussionTopic: (record) => `discussionThread:${record.courseId}:${record.platformIds?.discussionTopicId || ""}`,
    checklistItem: (record) => `tool:${record.courseId}:checklistItem:${record.evidenceId.replace(`${record.courseId}:checklistItem:`, "")}`
  });

  // What changed for the student, newest first. Announcements and grades carry
  // D2L's own dates (posted, graded); due-date changes and new work come from
  // comparing one sync's evidence with the revision it replaced.
  async function recentUpdates(repository, params = {}) {
    const limit = Math.min(Math.max(Number(params.limit || 50), 1), 300);
    const [entities, changes, courses] = await Promise.all([
      repository.listEntities({ courseId: params.courseId }),
      repository.listChanges({ courseId: params.courseId, limit: 500 }),
      repository.listCourses({})
    ]);
    const entityIds = new Set(entities.map((entity) => entity.entityId));
    const updates = [];
    for (const entity of entities) {
      if (entity.entityType === "announcement" && entity.dates?.publishedAt) {
        updates.push({ updateId: `announcement:${entity.entityId}`, kind: "announcement", courseId: entity.courseId, entityId: entity.entityId, title: entity.canonicalTitle, at: entity.dates.publishedAt });
      }
      if (entity.entityType === "gradeRecord" && entity.kind === "item" && entity.status === "graded" && entity.dates?.gradedAt) {
        updates.push({ updateId: `grade:${entity.entityId}:${entity.dates.gradedAt}`, kind: "grade", courseId: entity.courseId, entityId: entity.entityId, title: entity.canonicalTitle, detail: entity.grade?.displayed || "", at: entity.dates.gradedAt });
      }
    }
    const firstSeenByCourse = new Map(courses.map((course) => [course.courseId, course.firstSeenAt]));
    const watched = changes.filter((change) => change.type !== "removed");
    const evidence = await repository.getEvidenceMany(watched.map((change) => change.evidenceId));
    const evidenceById = new Map(evidence.filter((record) => WATCHED_SOURCES[record.source]).map((record) => [record.evidenceId, record]));
    const updatedIds = watched.filter((change) => change.type === "updated" && evidenceById.has(change.evidenceId)).map((change) => change.evidenceId);
    const revisions = updatedIds.length ? await repository.listEvidenceRevisions({ evidenceIds: updatedIds }) : [];
    for (const change of watched) {
      const record = evidenceById.get(change.evidenceId);
      if (!record) continue;
      const entityId = WATCHED_SOURCES[record.source](record);
      if (!entityIds.has(entityId)) continue;
      if (change.type === "updated") {
        const previous = revisions.filter((revision) => revision.evidenceId === record.evidenceId && Number(revision.revision) < Number(record.revision)).at(-1);
        if (previous && (previous.dates?.dueAt || null) !== (record.dates?.dueAt || null)) {
          updates.push({ updateId: `due:${change.changeId}`, kind: "dueDateChanged", courseId: record.courseId, entityId, title: record.title, from: previous.dates?.dueAt || null, to: record.dates?.dueAt || null, at: change.recordedAt });
        }
      } else if (change.type === "added" && firstSeenByCourse.get(record.courseId) && firstSeenByCourse.get(record.courseId) < change.recordedAt) {
        // Only items that appeared after the course's first sync are "new".
        updates.push({ updateId: `new:${change.changeId}`, kind: "newItem", courseId: record.courseId, entityId, title: record.title, source: record.source, at: change.recordedAt });
      }
    }
    return updates
      .filter((update) => Number.isFinite(Date.parse(update.at)))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.updateId.localeCompare(b.updateId))
      .slice(0, limit);
  }

  function includesQuery(value, query) {
    return JSON.stringify(value || {}).toLowerCase().includes(query);
  }

  async function searchKnowledge(repository, params = {}) {
    const query = requireString(params, "query").toLowerCase();
    const limit = Math.min(Math.max(Number(params.limit || 25), 1), 100);
    const [entities, evidencePage] = await Promise.all([
      repository.listEntities({ courseId: params.courseId }),
      repository.listEvidence({ courseId: params.courseId, limit: 500 })
    ]);
    return {
      query,
      entities: entities.filter((item) => includesQuery(item, query)).slice(0, limit),
      evidence: evidencePage.items.filter((item) => includesQuery(item, query)).slice(0, limit)
    };
  }

  async function dispatchAppApiMethod(repository, method, params, options = {}) {
    if (method === "system.getCapabilities") {
      return {
        protocolVersion: APP_API_PROTOCOL_VERSION,
        readMethods: [...IMPLEMENTED_READ_METHODS],
        internalMethods: [...IMPLEMENTED_INTERNAL_METHODS],
        features: {
          evidenceStorage: true,
          evidenceRevisions: true,
          semanticEntities: true,
          assignmentBundles: true,
          quizBundles: true,
          gradeRecords: true,
          announcements: true,
          discussions: true,
          learningResources: true,
          calendarEvents: true,
          coursePolicies: true,
          studentProgress: true,
          courseTools: true,
          people: true,
          externalResources: true,
          extractionGapTaxonomy: true,
          dashboardQueries: true
        }
      };
    }
    if (method === "system.getDatabaseStatus") return repository.getDatabaseStatus();
    if (method === "courses.list") return { items: await repository.listCourses(params) };
    if (method === "courses.get") {
      const courseId = requireString(params, "courseId");
      const course = await repository.getCourse(courseId);
      if (!course) throw appApiError(APP_API_ERROR_CODES.NOT_FOUND, `Course ${courseId} was not found.`);
      return course;
    }
    if (method === "courses.getOverview") {
      const courseId = requireString(params, "courseId");
      const course = await repository.getCourse(courseId);
      if (!course) throw appApiError(APP_API_ERROR_CODES.NOT_FOUND, `Course ${courseId} was not found.`);
      const entities = await repository.listEntities({ courseId });
      return { course, entityCounts: entityCounts(entities), upcoming: await upcomingEntities(repository, { ...params, courseId }) };
    }
    if (method === "evidence.list") return repository.listEvidence(params);
    if (method === "evidence.get") {
      const evidenceId = requireString(params, "evidenceId");
      const evidence = await repository.getEvidence(evidenceId);
      if (!evidence) throw appApiError(APP_API_ERROR_CODES.NOT_FOUND, `Evidence ${evidenceId} was not found.`);
      return evidence;
    }
    if (method === "entities.list") return { items: await repository.listEntities(params) };
    if (method === "entities.get") {
      const entityId = requireString(params, "entityId");
      const entity = await repository.getEntity(entityId);
      if (!entity) throw appApiError(APP_API_ERROR_CODES.NOT_FOUND, `Entity ${entityId} was not found.`);
      return entity;
    }
    if (method === "entities.getBundle") {
      const entityId = requireString(params, "entityId");
      const bundle = await repository.getEntityBundle(entityId);
      if (!bundle) throw appApiError(APP_API_ERROR_CODES.NOT_FOUND, `Entity ${entityId} was not found.`);
      return bundle;
    }
    if (method === "relationships.list") return { items: await repository.listRelationships(params) };
    if (method === "assignments.list") return { items: await repository.listEntities({ ...params, entityType: "assignmentBundle" }) };
    if (method === "quizzes.list") return { items: await repository.listEntities({ ...params, entityType: "quizBundle" }) };
    if (method === "grades.list") return { items: await repository.listEntities({ ...params, entityType: "gradeRecord" }) };
    if (method === "announcements.list") return { items: await repository.listEntities({ ...params, entityType: "announcement" }) };
    if (method === "discussions.list") {
      const [forums, threads] = await Promise.all([
        repository.listEntities({ ...params, entityType: "discussionForum" }),
        repository.listEntities({ ...params, entityType: "discussionThread" })
      ]);
      return { forums, threads };
    }
    if (method === "resources.list") return { items: await repository.listEntities({ ...params, entityType: "learningResource" }) };
    if (method === "calendar.list") return { items: await repository.listEntities({ ...params, entityType: "calendarEvent" }) };
    if (method === "policies.list") return { items: await repository.listEntities({ ...params, entityType: "coursePolicy" }) };
    if (method === "progress.list") return { items: await repository.listEntities({ ...params, entityType: "studentProgress" }) };
    if (method === "tools.list") return { items: await repository.listEntities({ ...params, entityType: "courseToolItem" }) };
    if (method === "people.list") return { items: await repository.listEntities({ ...params, entityType: "person" }) };
    if (method === "externalResources.list") return { items: await repository.listEntities({ ...params, entityType: "externalResource" }) };
    if (method === "gaps.list") {
      const states = await repository.listEntities({ ...params, entityType: "extractionState" });
      const filtered = states
        .filter((state) => params.includeCovered === true || state.isGap)
        .filter((state) => !params.classification || state.classification === String(params.classification));
      const summary = Object.fromEntries([...new Set(states.map((state) => state.classification))]
        .sort().map((classification) => [classification, states.filter((state) => state.classification === classification).length]));
      return { items: filtered, summary, totalCapabilities: states.length };
    }
    if (method === "dashboard.getUpcoming") return { items: await upcomingEntities(repository, params) };
    if (method === "dashboard.getRecentChanges") return { items: await repository.listChanges(params) };
    if (method === "dashboard.getUpdates") return { items: await recentUpdates(repository, params) };
    if (method === "dashboard.getOverview") {
      const [courses, entities] = await Promise.all([repository.listCourses({ active: params.active }), repository.listEntities({})]);
      return {
        courses,
        entityCounts: entityCounts(entities),
        upcoming: await upcomingEntities(repository, params),
        gradedItems: entities.filter((entity) => entity.entityType === "gradeRecord" && entity.status === "graded").length,
        blockedQuizzes: entities.filter((entity) => entity.entityType === "quizBundle" && (entity.access?.attempts === "blocked" || entity.access?.questions === "blocked")).length,
        recentAnnouncements: entities.filter((entity) => entity.entityType === "announcement")
          .sort((a, b) => Date.parse(b.dates?.publishedAt || 0) - Date.parse(a.dates?.publishedAt || 0))
          .slice(0, 10)
      };
    }
    if (method === "search.query") return searchKnowledge(repository, params);
    if (method === "sync.getState") {
      const [status, runs, latestSyncRunId] = await Promise.all([
        repository.getDatabaseStatus(),
        repository.listSyncRuns({ limit: Number(params.limit || 10) }),
        repository.getMeta("latestSyncRunId")
      ]);
      return { status, latestSyncRunId: latestSyncRunId || "", runs };
    }
    if (method === "sync.getQueue") {
      const [jobs, freshness] = await Promise.all([
        repository.listSyncJobs({ limit: Number(params.limit || 100), accountId: params.accountId, jobIds: params.jobIds }),
        Promise.all((Array.isArray(params.courseIds) ? params.courseIds : []).map(async (courseId) => ({
          courseId: String(courseId),
          value: await repository.getFreshness(`course:${String(params.accountId || "")}:${String(courseId)}:api`)
        })))
      ]);
      return { jobs, freshness: Object.fromEntries(freshness.map((entry) => [entry.courseId, entry.value])) };
    }
    if (method === "sync.getRun") {
      const syncRunId = requireString(params, "syncRunId");
      const run = await repository.getSyncRun(syncRunId);
      if (!run) throw appApiError(APP_API_ERROR_CODES.NOT_FOUND, `Sync run ${syncRunId} was not found.`);
      return run;
    }
    if (method === "activity.list") return { items: await repository.listActivity(params) };
    if (method === "activity.getSummary") return repository.getActivitySummary(params);
    if (method === "archive.ingestRows" && options.allowMutations === true) {
      if (!Array.isArray(params.rows)) throw appApiError(APP_API_ERROR_CODES.INVALID_PARAMS, "rows must be an array.");
      return repository.ingestRows(params.rows, params.options || {});
    }
    throw appApiError(APP_API_ERROR_CODES.METHOD_NOT_FOUND, `Application API method is not implemented: ${method}`);
  }

  async function handleAppApiRequest(message, options = {}) {
    const validationError = validateAppApiRequest(message);
    if (validationError) return appApiErrorResponse(message, validationError);
    // Which account the archive would open, without opening it. Never throws for "unknown".
    if (message.method === "system.getAccountContext" && !options.repository) {
      const accountId = await background.activeArchiveAccountId().catch(() => "");
      const legacyOwnerAccountId = accountId ? await background.legacyOwnerAccountId().catch(() => "") : "";
      // Whether the dashboard should offer to adopt a quarantined older archive for this account.
      const legacyArchive = accountId ? await background.legacyAdoptionStatus(accountId).catch(() => null) : null;
      return appApiResponse(message, { accountId, legacyOwnerAccountId, canAdoptLegacy: legacyArchive?.canAdopt === true }, { databaseRevision: 0 });
    }
    let repository = options.repository;
    if (!repository) {
      try {
        repository = await background.activeArchiveRepository();
      } catch (error) {
        return appApiErrorResponse(message, error?.name === "AccountError" ? accountApiError(error) : appApiError(APP_API_ERROR_CODES.INTERNAL_ERROR, error?.message || "Archive unavailable."));
      }
    }
    try {
      const data = await dispatchAppApiMethod(repository, message.method, message.params || {}, options);
      const databaseRevision = message.method === "system.getDatabaseStatus"
        ? data.databaseRevision
        : Number(await repository.getMeta("databaseRevision") || 0);
      return appApiResponse(message, data, { databaseRevision });
    } catch (error) {
      const known = error?.code && Object.values(APP_API_ERROR_CODES).includes(error.code);
      return appApiErrorResponse(message, known ? error : appApiError(APP_API_ERROR_CODES.INTERNAL_ERROR, error?.message || "Application API request failed."));
    }
  }

  Object.assign(background, {
    IMPLEMENTED_READ_METHODS,
    IMPLEMENTED_INTERNAL_METHODS,
    dispatchAppApiMethod,
    upcomingEntities,
    recentUpdates,
    searchKnowledge,
    handleAppApiRequest
  });
})(globalThis);
