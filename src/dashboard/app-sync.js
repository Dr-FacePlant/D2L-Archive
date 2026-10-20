// Sync status, starting syncs and freshness refresh.
(function initDashboardAppSync(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { $, EMBEDDED, SYNC_FAILED_KEY, SYNC_KEY, SYNC_TIMEOUT_MS, api, applyArchive, fetchArchive, recordActivity, render, state, storageSet, toast, wait } = dash.appModules;
  // --------------------------------------------------------------- sync

  // The top-bar Sync from D2L button: hover says when the last sync was, the
  // icon spins while one runs, and a dot marks a failed or old sync.
  function renderSyncStatus() {
    const button = $("#sync-button");
    if (!button || !state.index) return;
    const model = dash.syncModel(state.index, state.settings, state.syncFailedAt);
    const running = Boolean(state.sync);
    const progress = state.sync?.progress;
    const progressCount = progress?.total ? ` ${progress.completed || 0} of ${progress.total}` : "";
    const label = running ? `${state.sync ? "Syncing" : "Automatically syncing"} from D2L${progressCount}${progress?.current ? `: ${progress.current}` : ""}` : model.hint;
    button.classList.toggle("syncing", running);
    button.setAttribute("aria-busy", String(running));
    button.title = label;
    button.setAttribute("aria-label", running ? label : `Sync from D2L. ${label}`);
    const dot = button.querySelector(".sync-dot");
    dot.hidden = running || !(model.state === "stale" || model.state === "failed");
    dot.className = `sync-dot ${model.state}`;
  }

  async function startSync() {
    if (state.sync) {
      toast("A refresh is already running. New work will stay queued.");
      return;
    }
    state.syncFailedAt = "";
    const activityCorrelationId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state.syncActivityCorrelationId = activityCorrelationId;
    await chrome.storage.local.remove(SYNC_FAILED_KEY).catch(() => {});
    const ids = state.index?.courses.map((course) => course.courseId) || [];
    const route = dash.parseRoute(location.hash);
    const focusCourseId = state.detail?.courseId || route.params?.course || "";
    const message = {
      type: "D2L_SYNC_ENQUEUE_PRIORITY",
      courseIds: ids,
      focusCourseId,
      force: true,
      correlationId: activityCorrelationId
    };
    const response = await chrome.runtime.sendMessage(message).catch((error) => ({ ok: false, error: error?.message || "Could not reach the sync queue." }));
    if (!response?.ok) {
      await recordActivity({ operation: "sync.start", category: "sync", status: "failed", source: "dashboard", correlationId: activityCorrelationId, error: response?.error || "Could not queue refresh." });
      toast(response?.error || "Could not start a D2L refresh.");
      return;
    }
    const syncedIds = Array.isArray(response.courseIds) ? response.courseIds : ids;
    const queuedIds = response.outcomes.map((entry) => entry.jobId).filter(Boolean);
    if (!response.outcomes.some((entry) => entry.queued)) {
      const identityMissing = response.outcomes.some((entry) => entry.reason === "account-identity-unavailable");
      toast(identityMissing ? "Open or reload a D2L page so the signed-in account can be verified." : "Your saved course data is already fresh.");
      return;
    }
    state.sync = {
      mode: "priorityQueue",
      startedAt: new Date().toISOString(),
      correlationId: activityCorrelationId,
      courseIds: syncedIds,
      jobIds: queuedIds,
      accountId: state.profile?.accountId || "",
      progress: { total: queuedIds.length, completed: 0, current: "Refreshing priority course data" }
    };
    await storageSet(SYNC_KEY, state.sync);
    renderSyncStatus();
    await recordActivity({ operation: "sync.start", category: "sync", status: "queued", source: EMBEDDED ? "embedded-dashboard" : "dashboard", correlationId: activityCorrelationId, details: { courses: ids.length } });
    toast("Priority refresh queued. Your dashboard stays available while it runs.");
    pollSync();
  }

  async function enqueueVisitRefresh() {
    if (!state.index || !state.profile?.accountId) return;
    const ids = state.index.courses.map((course) => course.courseId);
    const route = dash.parseRoute(location.hash);
    const correlationId = `visit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const response = await chrome.runtime.sendMessage({
      type: "D2L_SYNC_ENQUEUE_PRIORITY",
      courseIds: ids,
      focusCourseId: state.detail?.courseId || route.params?.course || "",
      correlationId
    }).catch(() => null);
    // First visit after local storage was cleared: discover courses from D2L,
    // then observe the normal durable queue so the empty state redraws itself.
    if (!ids.length && response?.ok && response.outcomes?.some((entry) => entry.queued)) {
      const jobIds = response.outcomes.map((entry) => entry.jobId).filter(Boolean);
      state.sync = {
        mode: "priorityQueue",
        startedAt: new Date().toISOString(),
        correlationId,
        courseIds: response.courseIds || [],
        jobIds,
        accountId: state.profile?.accountId || "",
        progress: { total: jobIds.length, completed: 0, current: "Discovering current courses" }
      };
      await storageSet(SYNC_KEY, state.sync);
      pollSync();
    }
  }

  function refreshIfStaleOnFocus() {
    if (!state.index || state.sync) return;
    const now = Date.now();
    if (now - state.lastFocusRefreshAt < 5 * 60 * 1000) return;
    state.lastFocusRefreshAt = now;
    enqueueVisitRefresh().catch(() => {});
  }

  async function pollSync() {
    clearTimeout(pollSync.timer);
    if (!state.sync) return;
    const queue = await api("sync.getQueue", { limit: 100, jobIds: state.sync.jobIds, accountId: state.sync.accountId }).catch(() => null);
    if (!queue) {
      if (Date.now() - Date.parse(state.sync.startedAt) >= SYNC_TIMEOUT_MS) {
        await recordActivity({ operation: "sync.observe", category: "sync", status: "failed", source: "dashboard", correlationId: state.sync.correlationId, error: "Could not read the durable queue state." });
        state.syncFailedAt = new Date().toISOString();
        await storageSet(SYNC_FAILED_KEY, state.syncFailedAt);
        state.sync = null;
        await chrome.storage.local.remove(SYNC_KEY).catch(() => {});
        toast("Couldn't verify refresh status. Work remains saved in the queue.");
        renderSyncStatus();
        return;
      }
      pollSync.timer = setTimeout(pollSync, 2000);
      return;
    }
    const jobs = queue?.jobs || [];
    const active = jobs.filter((job) => ["queued", "running", "retry-wait", "account-changed"].includes(job.state));
    const completed = jobs.filter((job) => job.state === "completed").length;
    state.sync.progress = {
      total: state.sync.jobIds.length,
      completed,
      current: active.some((job) => job.state === "running") ? "Refreshing course data" : active.length ? "Waiting for an available D2L tab" : "Finishing"
    };
    renderSyncStatus();
    if (active.length && Date.now() - Date.parse(state.sync.startedAt) < SYNC_TIMEOUT_MS) {
      await storageSet(SYNC_KEY, state.sync);
      pollSync.timer = setTimeout(pollSync, 2000);
      return;
    }
    if (active.length) {
      await recordActivity({ operation: "sync.observe", category: "sync", status: "pending", source: "dashboard", correlationId: state.sync.correlationId, details: { pendingJobs: active.length } });
      toast("Refresh is still queued and will resume when D2L is open.");
    } else {
      const blocked = jobs.filter((job) => job.state === "blocked" || job.state === "retry-wait" || job.state === "account-changed").length;
      await recordActivity({ operation: "sync.complete", category: "sync", status: blocked ? "partial" : "completed", source: "dashboard", correlationId: state.sync.correlationId, details: { completed, blocked } });
      const refreshedFor = state.account.id;
      const archive = await fetchArchive();
      if (state.account.id === refreshedFor && refreshedFor) {
        applyArchive(archive);
        render();
      }
      toast(blocked ? "Refresh finished with some areas blocked or waiting; see Activity for details." : "Priority course data refreshed.");
    }
    state.sync = null;
    await chrome.storage.local.remove(SYNC_KEY).catch(() => {});
    renderSyncStatus();
  }

  Object.assign(mod, { renderSyncStatus, startSync, enqueueVisitRefresh, refreshIfStaleOnFocus, pollSync });
})(globalThis);
