(function initSyncQueue(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { flattenItem, normalizeText } = shared;
  const { ingestAndOrganizeRows } = background;

  const FRESHNESS_MS = 5 * 60 * 1000;
  const CATEGORY_RETRY_MS = 10 * 60 * 1000;
  const ACCOUNT_RETRY_MS = 30 * 1000;
  const PRIORITY_CATEGORIES = Object.freeze(["obligations", "announcements", "calendar", "discussions", "grades", "materials", "secondary"]);
  let draining = false;

  // Quiz attempt/question routes are instructor-oriented enrichment; a student gets 403 by design.
  const OPTIONAL_WHEN_FORBIDDEN = Object.freeze(["quizAttempts", "quizQuestions"]);

  function categoryStatus(apiStatus, keys) {
    const values = [];
    let optional = false;
    const visit = (value) => {
      if (optional && Number(value) === 403) return;
      if (value && typeof value === "object") {
        for (const nested of Object.values(value)) visit(nested);
      } else if (value !== undefined && value !== null && value !== "") {
        values.push(value);
      }
    };
    keys.forEach((key) => { optional = OPTIONAL_WHEN_FORBIDDEN.includes(key); visit(apiStatus?.[key]); });
    if (!values.length) return { status: "partial", reason: "no-status" };
    const statuses = values.map((value) => {
      const code = Number(value);
      if (Number.isFinite(code)) return code >= 200 && code < 300 ? "ok" : code === 401 || code === 403 ? "blocked" : "failed";
      const text = String(value).toLowerCase();
      if (/^(ok|success|fresh|complete|completed|200|204)$/.test(text)) return "ok";
      if (/^(deferred|notrequested)$/.test(text)) return "deferred";
      if (/blocked|forbidden|unauthor|401|403/.test(text)) return "blocked";
      if (/failed|error|timeout|5\d\d/.test(text)) return "failed";
      return "partial";
    });
    const ok = statuses.filter((status) => status === "ok").length;
    const blocked = statuses.filter((status) => status === "blocked").length;
    return {
      status: ok === statuses.length ? "fresh" : blocked === statuses.length ? "blocked" : ok + statuses.filter((status) => status === "deferred").length === statuses.length ? "deferred" : "partial",
      observations: statuses.length,
      blocked: blocked,
      failed: statuses.filter((status) => status === "failed").length
    };
  }

  function freshnessForPayload(payload) {
    const status = payload?.apiStatus || {};
    return {
      obligations: categoryStatus(status, ["dropbox", "dropboxMySubmissions", "dropboxCategories", "quizzes", "quizList", "quizAttempts", "quizAttemptDetails", "quizQuestions", "checklists", "checklistItems", "checklistCategories"]),
      announcements: categoryStatus(status, ["news"]),
      calendar: categoryStatus(status, ["calendar"]),
      discussions: categoryStatus(status, ["discussionForums", "discussionTopics", "discussionPosts"]),
      grades: categoryStatus(status, ["gradeDefinitions", "gradeValues", "gradeSetup", "gradeCategories", "finalGrade"]),
      materials: categoryStatus(status, ["toc"]),
      secondary: categoryStatus(status, ["courseOverview", "courseOverviewAttachment", "surveys", "surveyAttempts", "surveyQuestions", "groups", "groupsByCategory", "classlist", "contentUserProgress", "contentCompletion", "contentCompletionModules"])
    };
  }

  async function enqueuePriorityRefresh(courseIds = [], options = {}) {
    const accountId = normalizeText(options.accountId);
    if (!accountId) {
      // No account means no archive to record into: fail closed without touching any database.
      return courseIds.map((courseId) => ({ courseId: String(courseId), queued: false, reason: "account-identity-unavailable" }));
    }
    const repository = await background.repositoryForAccount(accountId);
    const now = new Date().toISOString();
    const outcomes = [];
    for (const courseIdValue of [...new Set(courseIds.map(String).filter((id) => /^\d+$/.test(id)))]) {
      const courseId = courseIdValue;
      const freshness = await repository.getFreshness(`course:${accountId}:${courseId}:api`);
      for (const [categoryIndex, category] of PRIORITY_CATEGORIES.entries()) {
        const prior = freshness?.categories?.[category] || {};
        const checkedAt = Date.parse(prior.checkedAt || "");
        const nextAt = Date.parse(prior.nextEligibleAt || "");
        const fresh = prior.status === "fresh" && Number.isFinite(checkedAt) && Date.now() - checkedAt < FRESHNESS_MS;
        const backedOff = prior.status !== "fresh" && Number.isFinite(nextAt) && Date.now() < nextAt;
        const jobId = `course-api-${accountId}-${courseId}-${category}`;
        if (options.force !== true && (fresh || backedOff)) {
          outcomes.push({ courseId, category, jobId, queued: false, reason: "fresh-or-backoff" });
          continue;
        }
        const priority = categoryIndex * 10 + (courseId === String(options.focusCourseId || "") ? 0 : 5);
        const result = await repository.enqueueSyncJob({
          jobId,
          dedupeKey: `d2l:${accountId}:${courseId}:${category}`,
          accountId,
          courseId,
          category,
          priority,
          correlationId: options.correlationId || `visit-${Date.now()}`,
          createdAt: now
        });
        outcomes.push({ courseId, category, jobId: result.job.jobId, queued: true, deduplicated: result.deduplicated });
      }
    }
    return outcomes;
  }

  const maskAccount = (value) => { const text = normalizeText(value); return text ? `${text.slice(0, 3)}…(${text.length})` : "(none)"; };

  async function collectOneCourse(job, workerId, tab, repository) {
    const courseId = String(job.courseId);
    const freshnessScope = `course:${job.accountId}:${courseId}:api`;
    const priorFreshness = await repository.getFreshness(freshnessScope) || {};
    const categoryFreshness = { ...(priorFreshness.categories || {}) };
    const category = String(job.category || "");
    if (!PRIORITY_CATEGORIES.includes(category)) throw new Error(`Unknown priority sync category: ${category || "(empty)"}`);
    const cursor = Number(job.cursor || 0);
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, {
        type: "D2L_COLLECT_COURSE_API", orgUnitId: courseId, category
      }, { frameId: 0 });
    } catch (error) {
      const attempts = Number(job.attempts || 1);
      const delay = Math.min(60 * 60 * 1000, 30000 * (2 ** Math.min(attempts - 1, 6)));
      const message = error?.message || "D2L category request failed.";
      await repository.updateSyncJob(job.jobId, {
        state: /403|401|sign in|unauthor/i.test(message) ? "blocked" : "retry-wait",
        cursor,
        nextEligibleAt: new Date(Date.now() + delay).toISOString(),
        lastError: message
      }, workerId).catch(() => {});
      await repository.recordActivity({ operation: "sync.category-refresh", category, status: /403|401|sign in|unauthor/i.test(message) ? "blocked" : "failed", courseId, source: "authenticated-d2l-api", correlationId: job.correlationId, error: message }).catch(() => {});
      return;
    }
    if (!response?.ok || !response.payload) {
      const message = response?.error || "D2L did not return category data.";
      const attempts = Number(job.attempts || 1);
      const delay = Math.min(60 * 60 * 1000, 30000 * (2 ** Math.min(attempts - 1, 6)));
      await repository.updateSyncJob(job.jobId, { state: /403|401|sign in|unauthor/i.test(message) ? "blocked" : "retry-wait", cursor, nextEligibleAt: new Date(Date.now() + delay).toISOString(), lastError: message }, workerId);
      await repository.recordActivity({ operation: "sync.category-refresh", category, status: /403|401|sign in|unauthor/i.test(message) ? "blocked" : "failed", courseId, source: "authenticated-d2l-api", correlationId: job.correlationId, error: message }).catch(() => {});
      return;
    }

    const verification = await background.verifyPayloadAccount(job.accountId, response.payload, repository);
    if (!verification.ok) {
      // Nothing from this payload is written: no evidence, entities, relationships, sync run or freshness.
      await repository.updateSyncJob(job.jobId, {
        state: "account-changed", cursor, lastError: verification.reason,
        nextEligibleAt: new Date(Date.now() + ACCOUNT_RETRY_MS).toISOString()
      }, workerId);
      await repository.recordActivity({
        operation: "sync.category-refresh", category: "identity", status: "blocked", courseId, source: "authenticated-d2l-api", correlationId: job.correlationId,
        error: `Collected data was discarded: ${verification.reason}.`,
        details: { category, reason: verification.reason, jobAccount: maskAccount(verification.expected), reportedStart: maskAccount(verification.startId), reportedEnd: maskAccount(verification.endId) }
      }).catch(() => {});
      return;
    }

    {
      const payload = response.payload;
      const courseTitle = normalizeText((payload.items || []).find((item) => item.source === "courseOffering")?.title
        || (await repository.getCourse(courseId))?.title || courseId);
      const pagePayload = {
        pageType: "valenceApi",
        page: { url: `https://kennesaw.view.usg.edu/d2l/home/${courseId}`, title: courseTitle },
        course: { orgUnitId: courseId, title: courseTitle },
        apiStatus: payload.apiStatus || {},
        apiCounts: payload.counts || {},
        extractor: { extractedAt: new Date().toISOString(), mode: "priorityApi", category }
      };
      const rows = (payload.items || []).map((item) => flattenItem(pagePayload, item));
      const allCategoryStates = freshnessForPayload(payload);
      const result = allCategoryStates[category] || { status: "partial", reason: "category-status-missing" };
      const ingested = await ingestAndOrganizeRows(rows, {
        syncRunId: `priority-${job.correlationId}-${courseId}-${category}`,
        correlationId: job.correlationId,
        mode: "priorityApi",
        repository,
        categoryFreshness: { [category]: result },
        completeCourseSnapshot: false
      });
      const now = new Date().toISOString();
      const retryDelay = result.status === "fresh" ? FRESHNESS_MS : CATEGORY_RETRY_MS;
      categoryFreshness[category] = { ...result, checkedAt: now, nextEligibleAt: new Date(Date.now() + retryDelay).toISOString(), rowCount: rows.length };
      await repository.setFreshness(freshnessScope, {
        attemptedAt: now,
        lastSuccessAt: result.status === "fresh" ? now : priorFreshness.lastSuccessAt || "",
        nextEligibleAt: categoryFreshness[category].nextEligibleAt,
        status: result.status,
        categories: { ...categoryFreshness },
        rowCount: Object.values(categoryFreshness).reduce((sum, entry) => sum + Number(entry.rowCount || 0), 0),
        databaseRevision: ingested.databaseRevision
      });
      const blocked = result.status === "blocked";
      await repository.updateSyncJob(job.jobId, {
        state: blocked ? "blocked" : "completed",
        cursor: null,
        lastError: blocked ? `D2L blocked the ${category} category.` : "",
        completedAt: now
      }, workerId);
      await repository.recordActivity({
        operation: "sync.category-refresh", category: "sync", status: result.status === "fresh" ? "completed" : result.status,
        courseId, source: "authenticated-d2l-api", correlationId: job.correlationId,
        details: { category, rows: rows.length, cursor }
      }).catch(() => {});
    }
  }

  // Tabs opened before an extension reload/update keep a dead content script, so
  // the first matching D2L tab may have no receiver. Ping candidates, active and
  // most recently used first, and use the first one that answers.
  async function findLiveD2lTab() {
    const tabs = (await chrome.tabs.query({ url: "https://kennesaw.view.usg.edu/d2l/*" }))
      .filter((candidate) => candidate.id >= 0 && !candidate.discarded)
      .sort((a, b) => Number(b.active === true) - Number(a.active === true) || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0));
    for (const candidate of tabs) {
      try {
        const reply = await chrome.tabs.sendMessage(candidate.id, { type: "D2L_PING" }, { frameId: 0 });
        if (reply?.ok) return candidate;
      } catch {
        // No content script in this tab; try the next one.
      }
    }
    return null;
  }

  // An empty local archive has no course IDs to enqueue yet. Bootstrap those
  // IDs from the same authenticated, top-frame D2L API bridge used by sync,
  // while still requiring the live account to match the dashboard account.
  async function discoverPriorityCourses(expectedAccountId = "") {
    const tab = await findLiveD2lTab();
    if (!tab) return { ok: false, reason: "no-open-d2l-tab", courseIds: [] };
    const accountId = await background.verifyTabAccount(tab.id);
    if (!accountId) return { ok: false, reason: "account-identity-unavailable", courseIds: [] };
    if (normalizeText(expectedAccountId) && normalizeText(expectedAccountId) !== accountId) {
      return { ok: false, reason: "account-mismatch", accountId, courseIds: [] };
    }
    try {
      const response = await background.sendToTopFrameWithRetry(tab.id, { type: "D2L_CURRENT_COURSES" });
      const offerings = Array.isArray(response?.payload) ? response.payload : [];
      const courseIds = [...new Set(offerings.map((offering) => normalizeText(offering?.orgUnitId)).filter((id) => /^\d+$/.test(id)))];
      return { ok: courseIds.length > 0, reason: courseIds.length ? "discovered" : "no-current-courses", accountId, courseIds };
    } catch (error) {
      return { ok: false, reason: "course-discovery-failed", error: error?.message || "Current courses could not be read.", accountId, courseIds: [] };
    }
  }

  // The queue is drained for exactly one account: the one the live D2L tab
  // reports right now (its own whoami, not the stored dashboard profile, which
  // is overwritten by whichever D2L page loaded last). If the tab cannot verify
  // an account, nothing is drained and no database is opened.
  const verifiedAccountId = (tab) => background.verifyTabAccount(tab.id);

  async function drainSyncQueue(options = {}) {
    if (draining) return { started: false, reason: "worker-running" };
    draining = true;
    const workerId = `worker-${global.crypto?.randomUUID?.() || Date.now()}`;
    try {
      const tab = await findLiveD2lTab();
      if (!tab) return { started: false, reason: "no-open-d2l-tab" };
      const accountId = await verifiedAccountId(tab);
      if (!accountId) return { started: false, reason: "account-identity-unavailable" };
      let repository;
      try {
        repository = await background.repositoryForAccount(accountId);
      } catch (error) {
        return { started: false, reason: "account-archive-unavailable", error: error?.code || error?.message };
      }
      const maxJobs = Math.min(Math.max(Number(options.maxJobs || 1), 1), 3);
      let processed = 0;
      while (processed < maxJobs) {
        const job = await repository.claimSyncJob(workerId, { leaseMs: 120000, accountId });
        if (!job) break;
        processed += 1;
        try {
          await collectOneCourse(job, workerId, tab, repository);
        } catch (error) {
          const attempts = Number(job.attempts || 1);
          const delay = Math.min(60 * 60 * 1000, 30000 * (2 ** Math.min(attempts - 1, 6)));
          const message = error?.message || "Course refresh failed.";
          await repository.updateSyncJob(job.jobId, {
            state: /403|401|sign in|unauthor/i.test(message) ? "blocked" : "retry-wait",
            nextEligibleAt: new Date(Date.now() + delay).toISOString(),
            lastError: message
          }, workerId).catch(() => {});
          await repository.recordActivity({ operation: "sync.course-refresh", category: "diagnostic", status: /403|401|sign in|unauthor/i.test(message) ? "blocked" : "failed", courseId: job.courseId, source: "authenticated-d2l-api", correlationId: job.correlationId, error: message }).catch(() => {});
        }
      }
      return { started: true, processed };
    } finally {
      draining = false;
    }
  }

  Object.assign(background, { FRESHNESS_MS, categoryStatus, freshnessForPayload, enqueuePriorityRefresh, discoverPriorityCourses, drainSyncQueue });
})(globalThis);
