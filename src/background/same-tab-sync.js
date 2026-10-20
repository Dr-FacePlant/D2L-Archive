(function initSameTabSyncModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { D2L_ORIGIN, DEV_RELOAD_TOKEN, normalizeText, isSafeReadOnlyUrl } = shared;
  const STATE_KEY = "d2lSameTabSyncRuns";
  const CHECKPOINT_PREFIX = "d2lSameTabSyncCheckpoint:";
  const active = new Map();
  const cancelled = new Set();
  let memoryStates = {};


  async function readCheckpoint(tabId) {
    const key = `${CHECKPOINT_PREFIX}${tabId}`;
    if (!chrome.storage.session?.get) return null;
    return (await chrome.storage.session.get(key))[key] || null;
  }

  async function writeCheckpoint(tabId, value) {
    if (!chrome.storage.session?.set) return;
    await chrome.storage.session.set({ [`${CHECKPOINT_PREFIX}${tabId}`]: value });
  }

  async function clearCheckpoint(tabId) {
    if (chrome.storage.session?.remove) await chrome.storage.session.remove(`${CHECKPOINT_PREFIX}${tabId}`);
  }

  async function readStates() {
    if (!chrome.storage.session?.get) return { ...memoryStates };
    return (await chrome.storage.session.get(STATE_KEY))[STATE_KEY] || {};
  }

  async function writeState(tabId, patch) {
    const states = await readStates();
    const before = states[tabId] || {};
    const next = { ...before, ...patch, tabId, updatedAt: new Date().toISOString() };
    states[tabId] = next;
    memoryStates = states;
    if (chrome.storage.session?.set) await chrome.storage.session.set({ [STATE_KEY]: states });
    return next;
  }

  async function sameTabSyncState(tabId) {
    const state = (await readStates())[tabId] || null;
    if (!state?.running) return state;
    const beat = Date.parse(state.updatedAt || state.startedAt || "");
    if (Number.isFinite(beat) && Date.now() - beat < 3 * 60 * 1000) return state;
    return writeState(tabId, { running: false, complete: false, error: "The same-tab sync was interrupted. Start it again." });
  }

  function embeddedDashboardSender(sender) {
    return Boolean(sender?.tab?.id)
      && String(sender?.url || "").startsWith(chrome.runtime.getURL("dashboard.html"))
      && isSafeReadOnlyUrl(sender.tab.url || "");
  }

  function sameTabSyncSender(message, sender) {
    if (embeddedDashboardSender(sender)) return true;
    const development = !chrome.runtime.getManifest().update_url;
    return development
      && message?.devToken === DEV_RELOAD_TOKEN
      && sender?.frameId === 0
      && Boolean(sender?.tab?.id)
      && isSafeReadOnlyUrl(sender?.url || sender?.tab?.url || "");
  }

  function requestedCourseIds(message) {
    return [...new Set((message?.courseIds || []).map((id) => normalizeText(id)).filter((id) => /^\d+$/.test(id)))];
  }

  function taskCount(payloads) {
    const {
      assignmentProbeTasksFromApiItems,
      quizProbeTasksFromApiItems,
      announcementProbeTasksFromApiItems,
      discussionListProbeTasksFromApiItems
    } = background;
    let total = 0;
    for (const payload of payloads) {
      const id = String(payload?.orgUnitId || "");
      const items = payload?.items || [];
      total += assignmentProbeTasksFromApiItems(id, items).length;
      total += quizProbeTasksFromApiItems(id, items).length;
      total += announcementProbeTasksFromApiItems(id, items).length;
      total += discussionListProbeTasksFromApiItems(id, items).length;
    }
    return total;
  }

  function cancellationError() {
    const error = new Error("Sync canceled.");
    error.code = "D2L_SYNC_CANCELED";
    return error;
  }

  async function collectCurrentCourses(tabId) {
    const response = await background.sendToTopFrameWithRetry(tabId, { type: "D2L_CURRENT_COURSES" });
    return Array.isArray(response.payload) ? response.payload : [];
  }

  async function executeSameTabSync(message, sender, runId) {
    const tabId = sender.tab.id;
    const courseTitles = message?.courseTitles && typeof message.courseTitles === "object" ? { ...message.courseTitles } : {};
    let courseIds = requestedCourseIds(message);
    const failures = [];
    const apiPayloads = [];
    let checkpoint = null;
    // The destination account is whatever D2L says this tab belongs to at the start;
    // payloads must agree with it, and the stored dashboard profile plays no part.
    let runRepository = null;
    const recordRunActivity = (event) => (runRepository ? runRepository.recordActivity(event) : Promise.resolve(null));
    try {
      const expectedAccountId = await background.verifyTabAccount(tabId);
      if (!expectedAccountId) throw new background.AccountVerificationError("account-unverified");
      runRepository = await background.repositoryForAccount(expectedAccountId);
      if (!courseIds.length) {
        const offerings = await collectCurrentCourses(tabId);
        courseIds = offerings.map((offering) => String(offering.orgUnitId || "")).filter((id) => /^\d+$/.test(id));
        for (const offering of offerings) courseTitles[offering.orgUnitId] = offering.title;
      }
      if (!courseIds.length) throw new Error("No current D2L courses were found.");

      checkpoint = await readCheckpoint(tabId);
      const sameCourseSet = checkpoint?.courseIds?.length === courseIds.length
        && checkpoint.courseIds.every((id, index) => String(id) === String(courseIds[index]));
      if (!sameCourseSet) checkpoint = null;
      if (checkpoint) {
        await recordRunActivity({ operation: "sync.resume", category: "recovery", status: "started", source: "same-tab", correlationId: runId, details: { completed: checkpoint.completedIds?.length || 0, total: courseIds.length } }).catch(() => {});
        apiPayloads.push(...(checkpoint.apiPayloads || []));
        failures.push(...(checkpoint.failures || []));
        Object.assign(courseTitles, checkpoint.courseTitles || {});
      }

      const completedIds = new Set((checkpoint?.completedIds || []).map(String));
      await writeState(tabId, { runId, running: true, complete: false, error: "", phase: "api", completed: completedIds.size, total: courseIds.length, current: completedIds.size ? "Resuming D2L course API collection" : "Reading D2L course APIs" });
      for (let index = 0; index < courseIds.length; index += 1) {
        if (cancelled.has(runId)) throw cancellationError();
        const orgUnitId = courseIds[index];
        if (completedIds.has(String(orgUnitId))) continue;
        await writeState(tabId, { phase: "api", completed: completedIds.size, total: courseIds.length, current: `Reading course ${index + 1} of ${courseIds.length}` });
        try {
          const response = await background.sendToTopFrameWithRetry(tabId, { type: "D2L_COLLECT_COURSE_API", orgUnitId });
          apiPayloads.push(response.payload);
          completedIds.add(String(orgUnitId));
          if (!courseTitles[orgUnitId]) {
            courseTitles[orgUnitId] = normalizeText((response.payload?.items || []).find((item) => item?.source === "courseOffering")?.title || orgUnitId);
          }
        } catch (error) {
          failures.push({ orgUnitId, error: error?.message || "API collection failed." });
          completedIds.add(String(orgUnitId));
        }
        await writeCheckpoint(tabId, { courseIds, completedIds: [...completedIds], apiPayloads, failures, courseTitles });
      }
      if (!apiPayloads.length) throw new Error(failures[0]?.error || "D2L API collection returned no courses.");

      const total = taskCount(apiPayloads);
      let completed = 0;
      await writeState(tabId, { phase: "probes", completed, total, current: total ? "Preparing rendered-page probes" : "Organizing API data" });
      const onProbeProgress = async ({ state, task }) => {
        if (cancelled.has(runId)) throw cancellationError();
        if (state === "complete" || state === "failed") completed += 1;
        await writeState(tabId, {
          phase: "probes",
          completed,
          total,
          current: normalizeText(task?.title || task?.url || "Reading a D2L page")
        });
      };

      const summary = await background.downloadApiOnlyExport(apiPayloads, courseTitles, {
        pageProbes: true,
        sameTab: true,
        reuseArchivedFiles: true,
        collectionFailures: failures,
        requestedOrgUnitIds: courseIds,
        expectedAccountId,
        onProbeProgress
      }, tabId);
      await clearCheckpoint(tabId);
      return writeState(tabId, {
        runId,
        running: false,
        complete: true,
        error: "",
        phase: "complete",
        completed: total,
        total,
        current: "Sync complete",
        completedAt: new Date().toISOString(),
        summary
      });
    } catch (error) {
      // A rejected account check writes nothing: no archive is known to own this failure.
      if (error?.code !== "ACCOUNT_VERIFICATION_FAILED") await recordRunActivity({ operation: "sync.failure", category: "diagnostic", status: cancelled.has(runId) ? "skipped" : "failed", source: "same-tab", correlationId: runId, error: error?.message || "Same-tab sync failed." }).catch(() => {});
      await chrome.tabs.sendMessage(tabId, { type: "D2L_PROBE_FRAME_CLOSE" }, { frameId: 0 }).catch(() => {});
      const wasCancelled = cancelled.has(runId);
      return writeState(tabId, {
        runId,
        running: false,
        complete: false,
        cancelled: wasCancelled,
        error: wasCancelled ? "" : (error?.message || "Same-tab sync failed."),
        phase: wasCancelled ? "canceled" : "failed",
        current: wasCancelled ? "Sync canceled" : "Sync failed",
        completedAt: new Date().toISOString()
      });
    } finally {
      cancelled.delete(runId);
      active.delete(tabId);
    }
  }

  async function runSameTabSync(message, sender) {
    if (!sameTabSyncSender(message, sender)) throw new Error("Same-tab sync must start from the D2L Archive overlay on D2L.");
    const tabId = sender.tab.id;
    if (active.has(tabId)) return active.get(tabId);
    const current = await sameTabSyncState(tabId);
    if (current?.running) throw new Error("A same-tab sync is already running in this D2L tab.");
    const runId = /^[-\w]{8,80}$/.test(String(message?.runId || "")) ? String(message.runId) : crypto.randomUUID();
    await writeState(tabId, { runId, running: true, complete: false, error: "", phase: "starting", completed: 0, total: 0, current: "Starting sync", startedAt: new Date().toISOString() });
    const run = executeSameTabSync(message, sender, runId);
    active.set(tabId, run);
    return run;
  }

  async function handleSameTabSyncState(message, sender) {
    if (!sameTabSyncSender(message, sender)) throw new Error("Sync status is only available inside the D2L overlay.");
    return sameTabSyncState(sender.tab.id);
  }

  async function cancelSameTabSync(message, sender) {
    if (!sameTabSyncSender(message, sender)) throw new Error("Sync cancellation is only available inside the D2L overlay.");
    const tabId = sender.tab.id;
    const state = await sameTabSyncState(tabId);
    if (!state?.running) return state;
    cancelled.add(state.runId);
    await chrome.tabs.sendMessage(tabId, { type: "D2L_PROBE_FRAME_CLOSE" }, { frameId: 0 }).catch(() => {});
    return writeState(tabId, { running: false, complete: false, cancelled: true, error: "", phase: "canceled", current: "Sync canceled", completedAt: new Date().toISOString() });
  }

  Object.assign(background, { STATE_KEY, embeddedDashboardSender, sameTabSyncSender, requestedCourseIds, taskCount, sameTabSyncState, runSameTabSync, handleSameTabSyncState, cancelSameTabSync });
})(globalThis);
