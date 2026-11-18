(function initArchiveRepositoryJobsModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText } = shared;

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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

  function createActivityEvent(input, now) {
    const timestamp = input.timestamp || now();
    const activityId = normalizeText(input.activityId) || `${timestamp.replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 10)}`;
    return {
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
  }

  async function enqueueSyncJob(adapter, now, input = {}) {
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

  async function claimSyncJob(adapter, now, owner, options = {}) {
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

  async function updateSyncJob(adapter, now, jobId, patch = {}, owner = "") {
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

  async function listSyncJobs(adapter, params = {}) {
    const wanted = params.jobIds ? new Set(params.jobIds.map(String)) : null;
    return adapter.runTransaction(["syncJobs"], "readonly", async ({ syncJobs }) => (await syncJobs.getAll())
      .filter((job) => !wanted || wanted.has(job.jobId))
      .filter((job) => !params.accountId || job.accountId === String(params.accountId))
      .filter((job) => !params.state || job.state === String(params.state))
      .sort((a, b) => Number(a.priority ?? 50) - Number(b.priority ?? 50) || Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0)));
  }

  async function recordActivity(adapter, now, input = {}) {
    const event = createActivityEvent(input, now);
    return adapter.runTransaction(["activity"], "readwrite", async ({ activity }) => {
      await activity.put(event);
      const all = (await activity.getAll()).sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
      for (const old of all.slice(1000)) await activity.delete(old.activityId);
      return clone(event);
    });
  }

  async function listActivity(adapter, params = {}) {
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

  async function getActivitySummary(adapter, params = {}) {
    const events = await listActivity(adapter, { ...params, limit: 500 });
    return {
      total: events.length,
      byStatus: Object.fromEntries([...new Set(events.map((e) => e.status))].sort().map((s) => [s, events.filter((e) => e.status === s).length])),
      byCategory: Object.fromEntries([...new Set(events.map((e) => e.category))].sort().map((c) => [c, events.filter((e) => e.category === c).length])),
      latest: events[0] || null
    };
  }

  function createRepositoryJobs(adapter, now) {
    return {
      enqueueSyncJob: (input) => enqueueSyncJob(adapter, now, input),
      claimSyncJob: (owner, options) => claimSyncJob(adapter, now, owner, options),
      updateSyncJob: (jobId, patch, owner) => updateSyncJob(adapter, now, jobId, patch, owner),
      listSyncJobs: (params) => listSyncJobs(adapter, params),
      recordActivity: (input) => recordActivity(adapter, now, input),
      listActivity: (params) => listActivity(adapter, params),
      getActivitySummary: (params) => getActivitySummary(adapter, params)
    };
  }

  Object.assign(background, {
    safeActivityDetails,
    createRepositoryJobs
  });
})(globalThis);
