(function initArchiveRepositoryModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, normalizedDate, normalizeEvidenceRow, APP_DB_VERSION, ORGANIZER_VERSION } = shared;

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
        // Only a write can need rolling back, so reads skip the snapshot copy.
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

  function inferSemester(title) {
    return normalizeText(title).match(/(?:Spring|Summer|Fall|Winter) Semester \d{4}/i)?.[0] || "";
  }

  function courseFromEvidence(record, now) {
    return {
      courseId: record.courseId,
      title: record.courseTitle || record.courseId,
      code: normalizeText(record.fields?.columns?.courseCode),
      semester: inferSemester(record.courseTitle),
      active: true,
      firstSeenAt: now,
      lastSeenAt: now,
      sourceRecordIds: []
    };
  }

  function createArchiveRepository(adapter, options = {}) {
    const now = options.now || (() => new Date().toISOString());

    async function getMeta(key) {
      return adapter.runTransaction(["meta"], "readonly", async ({ meta }) => (await meta.get(key))?.value);
    }

    async function setMeta(key, value) {
      return adapter.runTransaction(["meta"], "readwrite", async ({ meta }) => {
        await meta.put({ key, value });
        return value;
      });
    }

    // Which D2L accounts built this database, judged from account-keyed records
    // (queue jobs and freshness markers). Used once to decide who owns the
    // pre-isolation shared archive.
    async function getAccountProvenance() {
      return adapter.runTransaction(["syncJobs", "meta"], "readonly", async ({ syncJobs, meta }) => {
        const accountIds = new Set();
        for (const job of await syncJobs.getAll()) if (job.accountId) accountIds.add(String(job.accountId));
        for (const record of await meta.getAll()) {
          const match = /^freshness:course:([^:]+):/.exec(String(record.key || ""));
          if (match) accountIds.add(match[1]);
        }
        return { accountIds: [...accountIds].sort() };
      });
    }

    // Row count of every store, for read-only integrity checkpoints.
    async function getStoreCounts() {
      const names = Object.keys(background.ARCHIVE_STORE_DEFINITIONS);
      return adapter.runTransaction(names, "readonly", async (stores) => Object.fromEntries(
        await Promise.all(names.map(async (name) => [name, (await stores[name].getAll()).length]))
      ));
    }

    async function setFreshness(scope, entry) {
      const key = `freshness:${normalizeText(scope)}`;
      return adapter.runTransaction(["meta"], "readwrite", async ({ meta }) => {
        const previous = await meta.get(key);
        const record = { key, value: { ...(previous?.value || {}), ...entry } };
        await meta.put(record);
        return record.value;
      });
    }

    async function getFreshness(scope) {
      const value = await getMeta(`freshness:${normalizeText(scope)}`);
      return value || null;
    }

    function safeActivityDetails(value) {
      if (!value || typeof value !== "object") return {};
      const blocked = /token|cookie|authorization|password|secret|credential|body|html/i;
      const sanitize = (item, depth = 0) => {
        if (depth > 6) return "[depth-limited]";
        if (typeof item === "string") return item
          .replace(/([?&](?:access_?token|refresh_?token|auth(?:orization)?|session|code)=)[^&#\s]*/ig, "$1[redacted]")
          .slice(0, 500);
        if (Array.isArray(item)) return item.slice(0, 100).map((nested) => sanitize(nested, depth + 1));
        if (!item || typeof item !== "object") return item;
        return Object.fromEntries(Object.entries(item)
          .filter(([key]) => !blocked.test(key))
          .map(([key, nested]) => [key, sanitize(nested, depth + 1)]));
      };
      return sanitize(value);
    }

    async function recordActivity(input = {}) {
      const timestamp = input.timestamp || now();
      const activityId = normalizeText(input.activityId) || `${timestamp.replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 10)}`;
      const event = {
        activityId,
        timestamp,
        operation: normalizeText(input.operation).slice(0, 100) || "unknown",
        category: normalizeText(input.category).slice(0, 60) || "diagnostic",
        status: normalizeText(input.status).slice(0, 40) || "completed",
        courseId: normalizeText(input.courseId),
        itemId: normalizeText(input.itemId),
        source: normalizeText(input.source).slice(0, 80),
        correlationId: normalizeText(input.correlationId),
        details: safeActivityDetails(input.details),
        error: normalizeText(safeActivityDetails({ error: input.error }).error).slice(0, 500)
      };
      return adapter.runTransaction(["activity"], "readwrite", async ({ activity }) => {
        await activity.put(event);
        const all = (await activity.getAll()).sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
        for (const old of all.slice(1000)) await activity.delete(old.activityId);
        return clone(event);
      });
    }

    async function listActivity(params = {}) {
      const limit = Math.min(Math.max(Number(params.limit || 100), 1), 500);
      const since = Date.parse(params.since || "");
      return adapter.runTransaction(["activity"], "readonly", async ({ activity }) => (await activity.getAll())
        .filter((event) => !params.courseId || event.courseId === String(params.courseId))
        .filter((event) => !params.operation || event.operation === String(params.operation))
        .filter((event) => !params.status || event.status === String(params.status))
        .filter((event) => !Number.isFinite(since) || Date.parse(event.timestamp || "") >= since)
        .sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0))
        .slice(0, limit));
    }

    async function getActivitySummary(params = {}) {
      const events = await listActivity({ ...params, limit: 500 });
      return {
        total: events.length,
        byStatus: Object.fromEntries([...new Set(events.map((event) => event.status))].sort().map((status) => [status, events.filter((event) => event.status === status).length])),
        byCategory: Object.fromEntries([...new Set(events.map((event) => event.category))].sort().map((category) => [category, events.filter((event) => event.category === category).length])),
        latest: events[0] || null
      };
    }

    async function enqueueSyncJob(input = {}) {
      const at = input.createdAt || now();
      const dedupeKey = normalizeText(input.dedupeKey || [input.site || "d2l", input.accountId || "unknown", input.courseId || "all", input.category || "obligations", input.itemId || ""].join(":"));
      if (!dedupeKey) throw new Error("A sync job dedupe key is required.");
      const jobId = normalizeText(input.jobId) || `job-${dedupeKey}`;
      return adapter.runTransaction(["syncJobs"], "readwrite", async ({ syncJobs }) => {
        const prior = await syncJobs.get(jobId);
        if (prior && ["queued", "running", "retry-wait", "account-changed"].includes(prior.state)) {
          prior.priority = Math.min(Number(prior.priority ?? 50), Number(input.priority ?? 50));
          prior.nextEligibleAt = [prior.nextEligibleAt, input.nextEligibleAt || at].filter(Boolean).sort()[0];
          prior.updatedAt = at;
          if (input.correlationId) prior.correlationId = normalizeText(input.correlationId);
          await syncJobs.put(prior);
          return { job: prior, deduplicated: true };
        }
        const job = {
          jobId, dedupeKey, site: normalizeText(input.site || "https://kennesaw.view.usg.edu"),
          accountId: normalizeText(input.accountId), courseId: normalizeText(input.courseId),
          category: normalizeText(input.category || "obligations"), itemId: normalizeText(input.itemId),
          priority: Math.max(0, Math.min(100, Number(input.priority ?? 50))),
          state: "queued", cursor: input.cursor ?? null, attempts: 0,
          nextEligibleAt: input.nextEligibleAt || at, leaseOwner: "", leaseExpiresAt: "",
          lastError: "", correlationId: normalizeText(input.correlationId), createdAt: at, updatedAt: at
        };
        await syncJobs.put(job);
        return { job, deduplicated: false };
      });
    }

    async function claimSyncJob(owner, options = {}) {
      const at = options.now || now();
      const atMs = Date.parse(at);
      const leaseMs = Math.min(Math.max(Number(options.leaseMs || 60000), 5000), 10 * 60 * 1000);
      return adapter.runTransaction(["syncJobs"], "readwrite", async ({ syncJobs }) => {
        const jobs = (await syncJobs.getAll()).filter((job) =>
          (!options.accountId || job.accountId === String(options.accountId))
          && ((["queued", "retry-wait", "account-changed"].includes(job.state) && Date.parse(job.nextEligibleAt || 0) <= atMs)
            || (job.state === "running" && Date.parse(job.leaseExpiresAt || 0) <= atMs)));
        jobs.sort((a, b) => {
          const ageA = Math.max(0, atMs - Date.parse(a.createdAt || at));
          const ageB = Math.max(0, atMs - Date.parse(b.createdAt || at));
          const scoreA = Number(a.priority ?? 50) - Math.floor(ageA / 60000);
          const scoreB = Number(b.priority ?? 50) - Math.floor(ageB / 60000);
          return scoreA - scoreB || Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0);
        });
        const job = jobs[0];
        if (!job) return null;
        job.state = "running";
        job.leaseOwner = normalizeText(owner) || "worker";
        job.leaseExpiresAt = new Date(atMs + leaseMs).toISOString();
        job.attempts = Number(job.attempts || 0) + 1;
        job.updatedAt = at;
        await syncJobs.put(job);
        return job;
      });
    }

    async function updateSyncJob(jobId, patch = {}, owner = "") {
      return adapter.runTransaction(["syncJobs"], "readwrite", async ({ syncJobs }) => {
        const job = await syncJobs.get(String(jobId || ""));
        if (!job) return null;
        if (owner && job.state === "running" && job.leaseOwner !== owner) throw new Error("Sync job lease is owned by another worker.");
        Object.assign(job, patch, { updatedAt: now() });
        if (job.state !== "running") { job.leaseOwner = ""; job.leaseExpiresAt = ""; }
        await syncJobs.put(job);
        return job;
      });
    }

    async function listSyncJobs(params = {}) {
      const limit = Math.min(Math.max(Number(params.limit || 100), 1), 500);
      return adapter.runTransaction(["syncJobs"], "readonly", async ({ syncJobs }) => (await syncJobs.getAll())
        .filter((job) => !params.state || job.state === String(params.state))
        .filter((job) => !params.accountId || job.accountId === String(params.accountId))
        .filter((job) => !Array.isArray(params.jobIds) || params.jobIds.includes(job.jobId))
        .filter((job) => !params.courseId || job.courseId === String(params.courseId))
        .sort((a, b) => Number(a.priority ?? 50) - Number(b.priority ?? 50) || Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0))
        .slice(0, limit));
    }

    async function getDatabaseStatus() {
      return adapter.runTransaction(["courses", "evidence", "entities", "relationships", "syncRuns", "syncJobs", "meta"], "readonly", async (stores) => {
        const [courses, evidence, entities, relationships, syncRuns, syncJobs, revision, binding] = await Promise.all([
          stores.courses.getAll(), stores.evidence.getAll(), stores.entities.getAll(), stores.relationships.getAll(), stores.syncRuns.getAll(), stores.syncJobs.getAll(), stores.meta.get("databaseRevision"), stores.meta.get("accountBinding")
        ]);
        return {
          databaseName: options.databaseName || shared.APP_DB_NAME,
          schemaVersion: APP_DB_VERSION,
          organizerVersion: ORGANIZER_VERSION,
          databaseRevision: Number(revision?.value || 0),
          // Set when the browser erased this archive and it was recreated empty under the same name.
          archiveRecreatedAt: binding?.value?.via === "recreated" ? normalizeText(binding.value.boundAt) : "",
          counts: { courses: courses.length, evidence: evidence.length, entities: entities.length, relationships: relationships.length, syncRuns: syncRuns.length, syncJobs: syncJobs.length }
        };
      });
    }

    async function ingestRows(rows, ingestOptions = {}) {
      const ingestedAt = ingestOptions.ingestedAt || now();
      const syncRunId = normalizeText(ingestOptions.syncRunId) || `run-${ingestedAt.replace(/[^0-9]/g, "")}`;
      const normalizedRecords = (rows || []).map((row) => normalizeEvidenceRow(row, {
        extractorVersion: ingestOptions.extractorVersion || "", syncRunId, extractedAt: ingestedAt
      }));
      const evidenceRecords = [...new Map(normalizedRecords.map((record) => [record.evidenceId, record])).values()];

      return adapter.runTransaction(["courses", "evidence", "evidenceRevisions", "syncRuns", "changes", "meta"], "readwrite", async (stores) => {
        const revisionMeta = await stores.meta.get("databaseRevision");
        const databaseRevision = Number(revisionMeta?.value || 0) + 1;
        const counts = { added: 0, updated: 0, unchanged: 0, removed: 0, courses: 0 };
        const touchedCourses = new Set();
        const incomingEvidenceIds = new Set(evidenceRecords.map((record) => record.evidenceId));

        for (const record of evidenceRecords) {
          const existing = await stores.evidence.get(record.evidenceId);
          if (!existing) {
            counts.added += 1;
          } else if (existing.contentHash === record.contentHash) {
            counts.unchanged += 1;
            record.revision = existing.revision;
            record.firstSeenAt = existing.firstSeenAt;
          } else {
            counts.updated += 1;
            await stores.evidenceRevisions.put(existing);
            record.revision = Number(existing.revision || 1) + 1;
            record.firstSeenAt = existing.firstSeenAt;
          }
          record.lastSeenAt = ingestedAt;
          await stores.evidence.put(record);
          touchedCourses.add(record.courseId);

          const changeType = existing ? (existing.contentHash === record.contentHash ? "unchanged" : "updated") : "added";
          if (changeType !== "unchanged") {
            await stores.changes.put({ changeId: `${syncRunId}:${record.evidenceId}:${changeType}`, syncRunId, courseId: record.courseId, evidenceId: record.evidenceId, type: changeType, recordedAt: ingestedAt });
          }

          const existingCourse = await stores.courses.get(record.courseId);
          const course = existingCourse || courseFromEvidence(record, ingestedAt);
          course.title = record.courseTitle || course.title;
          course.semester ||= inferSemester(course.title);
          // The enrollment row carries D2L's course code and term dates.
          if (record.source === "courseOffering") {
            const columns = record.fields?.columns || {};
            course.code = normalizeText(columns.courseCode) || course.code || "";
            course.startsAt = normalizedDate(columns.startDate) || course.startsAt || null;
            course.endsAt = normalizedDate(columns.endDate) || course.endsAt || null;
          }
          course.lastSeenAt = ingestedAt;
          course.sourceRecordIds = [...new Set([...(course.sourceRecordIds || []), record.evidenceId])];
          await stores.courses.put(course);
        }

        if (ingestOptions.completeCourseSnapshot === true) {
          for (const existing of await stores.evidence.getAll()) {
            if (!touchedCourses.has(existing.courseId) || incomingEvidenceIds.has(existing.evidenceId)) continue;
            await stores.evidenceRevisions.put(existing);
            await stores.evidence.delete(existing.evidenceId);
            await stores.changes.put({
              changeId: `${syncRunId}:${existing.evidenceId}:removed`,
              syncRunId,
              courseId: existing.courseId,
              evidenceId: existing.evidenceId,
              type: "removed",
              recordedAt: ingestedAt
            });
            counts.removed += 1;
          }
          for (const courseId of touchedCourses) {
            const course = await stores.courses.get(courseId);
            if (!course) continue;
            course.sourceRecordIds = evidenceRecords.filter((record) => record.courseId === courseId).map((record) => record.evidenceId);
            await stores.courses.put(course);
          }
        }

        counts.courses = touchedCourses.size;
        const syncRun = { syncRunId, correlationId: normalizeText(ingestOptions.correlationId), mode: ingestOptions.mode || "ingestRows", status: "ingested", startedAt: ingestOptions.startedAt || ingestedAt, completedAt: ingestedAt, extractorVersion: ingestOptions.extractorVersion || "", categoryFreshness: ingestOptions.categoryFreshness || {}, databaseRevision, counts };
        await stores.syncRuns.put(syncRun);
        await stores.meta.put({ key: "databaseRevision", value: databaseRevision });
        await stores.meta.put({ key: "schemaVersion", value: APP_DB_VERSION });
        await stores.meta.put({ key: "organizerVersion", value: ORGANIZER_VERSION });
        await stores.meta.put({ key: "latestSyncRunId", value: syncRunId });
        return { syncRunId, databaseRevision, counts, evidenceIds: evidenceRecords.map((record) => record.evidenceId) };
      });
    }

    async function listCourses(params = {}) {
      return adapter.runTransaction(["courses"], "readonly", async ({ courses }) => (await courses.getAll())
        .filter((course) => params.active === undefined || course.active === params.active)
        .sort((a, b) => a.title.localeCompare(b.title)));
    }

    async function getCourse(courseId) {
      return adapter.runTransaction(["courses"], "readonly", ({ courses }) => courses.get(String(courseId || "")));
    }

    async function listEvidence(params = {}) {
      const limit = Math.min(Math.max(Number(params.limit || 100), 1), 500);
      const offset = Math.max(Number(params.offset || 0), 0);
      return adapter.runTransaction(["evidence"], "readonly", async ({ evidence }) => {
        const records = (await evidence.getAll())
          .filter((record) => !params.courseId || record.courseId === String(params.courseId))
          .filter((record) => !params.source || record.source === String(params.source))
          .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
        return { items: records.slice(offset, offset + limit), total: records.length, offset, limit };
      });
    }

    async function getEvidence(evidenceId) {
      return adapter.runTransaction(["evidence"], "readonly", ({ evidence }) => evidence.get(String(evidenceId || "")));
    }

    async function replaceCourseKnowledge(courseId, entityType, knowledge) {
      return adapter.runTransaction(["entities", "relationships", "meta"], "readwrite", async (stores) => {
        const existingEntities = (await stores.entities.getAll()).filter((entity) => entity.courseId === courseId && entity.entityType === entityType);
        const replacedEntityIds = new Set(existingEntities.map((entity) => entity.entityId));
        for (const entity of existingEntities) await stores.entities.delete(entity.entityId);
        for (const relationship of await stores.relationships.getAll()) {
          if (replacedEntityIds.has(relationship.fromId)) await stores.relationships.delete(relationship.relationshipId);
        }
        for (const entity of knowledge.entities || []) await stores.entities.put(entity);
        for (const relationship of knowledge.relationships || []) await stores.relationships.put(relationship);
        await stores.meta.put({ key: "organizerVersion", value: ORGANIZER_VERSION });
        return { entities: knowledge.entities?.length || 0, relationships: knowledge.relationships?.length || 0 };
      });
    }

    async function listEntities(params = {}) {
      return adapter.runTransaction(["entities"], "readonly", async ({ entities }) => (await entities.getAll())
        .filter((entity) => !params.courseId || entity.courseId === String(params.courseId))
        .filter((entity) => !params.entityType || entity.entityType === String(params.entityType))
        .sort((a, b) => a.entityId.localeCompare(b.entityId)));
    }

    async function getEntity(entityId) {
      return adapter.runTransaction(["entities"], "readonly", ({ entities }) => entities.get(String(entityId || "")));
    }

    async function listRelationships(params = {}) {
      return adapter.runTransaction(["relationships"], "readonly", async ({ relationships }) => (await relationships.getAll())
        .filter((relationship) => !params.courseId || relationship.courseId === String(params.courseId))
        .filter((relationship) => !params.fromId || relationship.fromId === String(params.fromId))
        .filter((relationship) => !params.type || relationship.type === String(params.type))
        .sort((a, b) => a.relationshipId.localeCompare(b.relationshipId)));
    }

    async function getEntityBundle(entityId) {
      const entity = await getEntity(entityId);
      if (!entity) return null;
      const relationships = await listRelationships({ fromId: entityId });
      const evidence = [];
      const linkedEntities = [];
      for (const relationship of relationships) {
        const record = await getEvidence(relationship.toId);
        if (record) {
          evidence.push(record);
        } else {
          const linkedEntity = await getEntity(relationship.toId);
          if (linkedEntity) linkedEntities.push(linkedEntity);
        }
      }
      return { entity, relationships, evidence, linkedEntities };
    }

    async function getEvidenceMany(evidenceIds = []) {
      const wanted = [...new Set((evidenceIds || []).map(String))];
      return adapter.runTransaction(["evidence"], "readonly", async ({ evidence }) => {
        const found = [];
        for (const evidenceId of wanted) {
          const record = await evidence.get(evidenceId);
          if (record) found.push(record);
        }
        return found;
      });
    }

    async function listEvidenceRevisions(params = {}) {
      const wanted = params.evidenceIds ? new Set(params.evidenceIds.map(String)) : null;
      return adapter.runTransaction(["evidenceRevisions"], "readonly", async ({ evidenceRevisions }) => (await evidenceRevisions.getAll())
        .filter((record) => !wanted || wanted.has(record.evidenceId))
        .filter((record) => !params.courseId || record.courseId === String(params.courseId))
        .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId) || Number(a.revision) - Number(b.revision)));
    }

    async function listChanges(params = {}) {
      const limit = Math.min(Math.max(Number(params.limit || 100), 1), 500);
      const since = Date.parse(params.since || "");
      return adapter.runTransaction(["changes"], "readonly", async ({ changes }) => (await changes.getAll())
        .filter((change) => !params.courseId || change.courseId === String(params.courseId))
        .filter((change) => !params.syncRunId || change.syncRunId === String(params.syncRunId))
        .filter((change) => !Number.isFinite(since) || Date.parse(change.recordedAt || "") >= since)
        .sort((a, b) => Date.parse(b.recordedAt || 0) - Date.parse(a.recordedAt || 0))
        .slice(0, limit));
    }

    async function getSyncRun(syncRunId) {
      return adapter.runTransaction(["syncRuns"], "readonly", ({ syncRuns }) => syncRuns.get(String(syncRunId || "")));
    }

    async function listSyncRuns(params = {}) {
      const limit = Math.min(Math.max(Number(params.limit || 20), 1), 100);
      return adapter.runTransaction(["syncRuns"], "readonly", async ({ syncRuns }) => (await syncRuns.getAll())
        .sort((a, b) => Date.parse(b.completedAt || b.startedAt || 0) - Date.parse(a.completedAt || a.startedAt || 0))
        .slice(0, limit));
    }

    return {
      getMeta, setMeta, getAccountProvenance, getStoreCounts, getDatabaseStatus, ingestRows, listCourses, getCourse, listEvidence, getEvidence,
      replaceCourseKnowledge, listEntities, getEntity, listRelationships, getEntityBundle,
      getEvidenceMany, listEvidenceRevisions, listChanges, getSyncRun, listSyncRuns,
      recordActivity, listActivity, getActivitySummary,
      enqueueSyncJob, claimSyncJob, updateSyncJob, listSyncJobs, setFreshness, getFreshness
    };
  }

  Object.assign(background, { createMemoryArchiveAdapter, inferSemester, courseFromEvidence, createArchiveRepository });
})(globalThis);
