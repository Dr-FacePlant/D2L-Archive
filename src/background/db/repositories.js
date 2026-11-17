(function initArchiveRepositoryModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, APP_DB_VERSION, ORGANIZER_VERSION } = shared;
  const { inferSemester, courseFromEvidence, ingestRows } = background;

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function keyForValue(storeName, value) {
    if (storeName === "evidenceRevisions") return `${value.evidenceId}::${value.revision}`;
    const keys = { courses: "courseId", evidence: "evidenceId", entities: "entityId", relationships: "relationshipId", syncRuns: "syncRunId", changes: "changeId", activity: "activityId", syncJobs: "jobId", meta: "key" };
    return String(value?.[keys[storeName]] || "");
  }

  function normalizedMemoryKey(storeName, key) {
    return storeName === "evidenceRevisions" && Array.isArray(key) ? `${key[0]}::${key[1]}` : String(key);
  }

  function createMemoryArchiveAdapter(seed = {}) {
    const data = Object.fromEntries(Object.keys(background.ARCHIVE_STORE_DEFINITIONS).map((name) => [name, new Map()]));
    for (const [storeName, values] of Object.entries(seed)) {
      for (const value of values || []) data[storeName]?.set(keyForValue(storeName, value), clone(value));
    }
    return {
      data,
      async runTransaction(storeNames, mode, operation) {
        const snapshots = mode === "readonly" ? null : Object.fromEntries(storeNames.map((name) => [name, new Map([...data[name]].map(([key, value]) => [key, clone(value)]))]));
        const stores = Object.fromEntries(storeNames.map((name) => [name, {
          get: async (key) => clone(data[name].get(normalizedMemoryKey(name, key))),
          getAll: async () => [...data[name].values()].map(clone),
          put: async (value) => {
            const key = keyForValue(name, value);
            if (!key) throw new Error(`Missing key for ${name}`);
            data[name].set(key, clone(value));
            return key;
          },
          delete: async (key) => data[name].delete(normalizedMemoryKey(name, key)),
          clear: async () => data[name].clear()
        }]));
        try {
          return await operation(stores);
        } catch (error) {
          if (snapshots) for (const name of storeNames) data[name] = snapshots[name];
          throw error;
        }
      }
    };
  }

  function createMetaReaders(adapter) {
    return {
      getMeta: (key) => adapter.runTransaction(["meta"], "readonly", async ({ meta }) => (await meta.get(key))?.value),
      setMeta: (key, value) => adapter.runTransaction(["meta"], "readwrite", async ({ meta }) => {
        await meta.put({ key, value });
        return value;
      }),
      getAccountProvenance: () => adapter.runTransaction(["syncJobs", "meta"], "readonly", async ({ syncJobs, meta }) => {
        const accountIds = new Set();
        for (const job of await syncJobs.getAll()) if (job.accountId) accountIds.add(String(job.accountId));
        for (const record of await meta.getAll()) {
          const match = /^freshness:course:([^:]+):/.exec(String(record.key || ""));
          if (match) accountIds.add(match[1]);
        }
        return { accountIds: [...accountIds].sort() };
      }),
      getStoreCounts: () => {
        const names = Object.keys(background.ARCHIVE_STORE_DEFINITIONS);
        return adapter.runTransaction(names, "readonly", async (stores) => {
          const entries = await Promise.all(names.map(async (name) => [name, (await stores[name].getAll()).length]));
          return Object.fromEntries(entries);
        });
      },
      setFreshness: (scope, entry) => {
        const key = `freshness:${normalizeText(scope)}`;
        return adapter.runTransaction(["meta"], "readwrite", async ({ meta }) => {
          const previous = await meta.get(key);
          const record = { key, value: { ...(previous?.value || {}), ...entry } };
          await meta.put(record);
          return record.value;
        });
      },
      getFreshness: async (scope) => {
        const value = await adapter.runTransaction(["meta"], "readonly", async ({ meta }) => (await meta.get(`freshness:${normalizeText(scope)}`))?.value);
        return value || null;
      }
    };
  }

  function createSyncHistoryReaders(adapter, options) {
    return {
      getDatabaseStatus: () => adapter.runTransaction(["courses", "evidence", "entities", "relationships", "syncRuns", "syncJobs", "meta"], "readonly", async (stores) => {
        const [courses, evidence, entities, relationships, syncRuns, syncJobs, revision, binding] = await Promise.all([
          stores.courses.getAll(), stores.evidence.getAll(), stores.entities.getAll(), stores.relationships.getAll(), stores.syncRuns.getAll(), stores.syncJobs.getAll(), stores.meta.get("databaseRevision"), stores.meta.get("accountBinding")
        ]);
        return {
          databaseName: options.databaseName || shared.APP_DB_NAME,
          schemaVersion: APP_DB_VERSION,
          organizerVersion: ORGANIZER_VERSION,
          databaseRevision: Number(revision?.value || 0),
          archiveRecreatedAt: binding?.value?.via === "recreated" ? normalizeText(binding.value.boundAt) : "",
          counts: { courses: courses.length, evidence: evidence.length, entities: entities.length, relationships: relationships.length, syncRuns: syncRuns.length, syncJobs: syncJobs.length }
        };
      }),
      listCourses: (params = {}) => adapter.runTransaction(["courses"], "readonly", async ({ courses }) => (await courses.getAll())
        .filter((c) => params.active === undefined || c.active === params.active)
        .sort((a, b) => a.title.localeCompare(b.title))),
      getCourse: (courseId) => adapter.runTransaction(["courses"], "readonly", ({ courses }) => courses.get(String(courseId || ""))),
      listChanges: (params = {}) => {
        const limit = Math.min(Math.max(Number(params.limit || 100), 1), 500);
        const since = Date.parse(params.since || "");
        return adapter.runTransaction(["changes"], "readonly", async ({ changes }) => (await changes.getAll())
          .filter((c) => !params.courseId || c.courseId === String(params.courseId))
          .filter((c) => !params.syncRunId || c.syncRunId === String(params.syncRunId))
          .filter((c) => !Number.isFinite(since) || Date.parse(c.recordedAt || "") >= since)
          .sort((a, b) => Date.parse(b.recordedAt || 0) - Date.parse(a.recordedAt || 0))
          .slice(0, limit));
      },
      getSyncRun: (syncRunId) => adapter.runTransaction(["syncRuns"], "readonly", ({ syncRuns }) => syncRuns.get(String(syncRunId || ""))),
      listSyncRuns: (params = {}) => {
        const limit = Math.min(Math.max(Number(params.limit || 20), 1), 100);
        return adapter.runTransaction(["syncRuns"], "readonly", async ({ syncRuns }) => (await syncRuns.getAll())
          .sort((a, b) => Date.parse(b.completedAt || b.startedAt || 0) - Date.parse(a.completedAt || a.startedAt || 0))
          .slice(0, limit));
      }
    };
  }

  function createEvidenceReaders(adapter) {
    return {
      listEvidence: (params = {}) => {
        const limit = Math.min(Math.max(Number(params.limit || 100), 1), 500);
        const offset = Math.max(Number(params.offset || 0), 0);
        return adapter.runTransaction(["evidence"], "readonly", async ({ evidence }) => {
          const records = (await evidence.getAll())
            .filter((r) => !params.courseId || r.courseId === String(params.courseId))
            .filter((r) => !params.source || r.source === String(params.source))
            .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
          return { items: records.slice(offset, offset + limit), total: records.length, offset, limit };
        });
      },
      getEvidence: (evidenceId) => adapter.runTransaction(["evidence"], "readonly", ({ evidence }) => evidence.get(String(evidenceId || ""))),
      getEvidenceMany: (evidenceIds = []) => {
        const wanted = [...new Set((evidenceIds || []).map(String))];
        return adapter.runTransaction(["evidence"], "readonly", async ({ evidence }) => {
          const found = [];
          for (const evidenceId of wanted) {
            const record = await evidence.get(evidenceId);
            if (record) found.push(record);
          }
          return found;
        });
      },
      listEvidenceRevisions: (params = {}) => {
        const wanted = params.evidenceIds ? new Set(params.evidenceIds.map(String)) : null;
        return adapter.runTransaction(["evidenceRevisions"], "readonly", async ({ evidenceRevisions }) => (await evidenceRevisions.getAll())
          .filter((r) => !wanted || wanted.has(r.evidenceId))
          .filter((r) => !params.courseId || r.courseId === String(params.courseId))
          .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId) || Number(a.revision) - Number(b.revision)));
      }
    };
  }

  function createKnowledgeReaders(adapter) {
    async function getEntity(entityId) {
      return adapter.runTransaction(["entities"], "readonly", ({ entities }) => entities.get(String(entityId || "")));
    }
    async function listRelationships(params = {}) {
      return adapter.runTransaction(["relationships"], "readonly", async ({ relationships }) => (await relationships.getAll())
        .filter((r) => !params.courseId || r.courseId === String(params.courseId))
        .filter((r) => !params.fromId || r.fromId === String(params.fromId))
        .filter((r) => !params.type || r.type === String(params.type))
        .sort((a, b) => a.relationshipId.localeCompare(b.relationshipId)));
    }
    async function getEntityBundle(entityId) {
      const entity = await getEntity(entityId);
      if (!entity) return null;
      const relationships = await listRelationships({ fromId: entityId });
      const evidence = [];
      const linkedEntities = [];
      for (const rel of relationships) {
        const record = await adapter.runTransaction(["evidence"], "readonly", ({ evidence: ev }) => ev.get(rel.toId));
        if (record) evidence.push(record);
        else {
          const linked = await getEntity(rel.toId);
          if (linked) linkedEntities.push(linked);
        }
      }
      return { entity, relationships, evidence, linkedEntities };
    }
    return {
      replaceCourseKnowledge: (courseId, entityType, knowledge) => adapter.runTransaction(["entities", "relationships", "meta"], "readwrite", async (stores) => {
        const existingEntities = (await stores.entities.getAll()).filter((e) => e.courseId === courseId && e.entityType === entityType);
        const replacedIds = new Set(existingEntities.map((e) => e.entityId));
        for (const e of existingEntities) await stores.entities.delete(e.entityId);
        for (const r of await stores.relationships.getAll()) {
          if (replacedIds.has(r.fromId)) await stores.relationships.delete(r.relationshipId);
        }
        for (const entity of knowledge.entities || []) await stores.entities.put(entity);
        for (const relationship of knowledge.relationships || []) await stores.relationships.put(relationship);
        await stores.meta.put({ key: "organizerVersion", value: ORGANIZER_VERSION });
        return { entities: knowledge.entities?.length || 0, relationships: knowledge.relationships?.length || 0 };
      }),
      listEntities: (params = {}) => adapter.runTransaction(["entities"], "readonly", async ({ entities }) => (await entities.getAll())
        .filter((e) => !params.courseId || e.courseId === String(params.courseId))
        .filter((e) => !params.entityType || e.entityType === String(params.entityType))
        .sort((a, b) => a.entityId.localeCompare(b.entityId))),
      getEntity,
      listRelationships,
      getEntityBundle
    };
  }

  function createArchiveRepository(adapter, options = {}) {
    const now = options.now || (() => new Date().toISOString());
    const metaOps = createMetaReaders(adapter);
    const syncOps = createSyncHistoryReaders(adapter, options);
    const evidenceOps = createEvidenceReaders(adapter);
    const knowledgeOps = createKnowledgeReaders(adapter);
    const jobOps = (background.createRepositoryJobs || (() => ({})))(adapter, now);

    return {
      ...metaOps,
      ...syncOps,
      ...evidenceOps,
      ...knowledgeOps,
      ...jobOps,
      ingestRows: (rows, ingestOptions) => (background.ingestRows || ingestRows)(adapter, now, rows, ingestOptions)
    };
  }

  Object.assign(background, {
    createMemoryArchiveAdapter,
    inferSemester: inferSemester || background.inferSemester,
    courseFromEvidence: courseFromEvidence || background.courseFromEvidence,
    createArchiveRepository
  });
})(globalThis);
