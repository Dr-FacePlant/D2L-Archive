// Archive loading and account binding.
(function initDashboardAppArchive(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { CHECKLIST_KEY, COURSE_OVERRIDES_KEY, COURSE_TEXTBOOKS_KEY, HIDDEN_WORK_KEY, READ_KEY, RECREATED_SEEN_KEY, api, main, state, toast, useChecklistStateForProfile } = dash.appModules;
  // ------------------------------------------------------------- archive

  // Reads the bound account's archive. Nothing is applied here: the binder applies it only if that account is still current.
  async function fetchArchive() {
    // Rebuild organized records if this version organizes differently.
    const prepared = await chrome.runtime.sendMessage({ type: "D2L_DASHBOARD_PREPARE" });
    if (prepared?.ok === false) throw Object.assign(new Error(prepared.error || "Archive preparation failed."), { code: prepared.code });
    const [courses, entities, updates, sync] = await Promise.all([
      api("courses.list"),
      api("entities.list"),
      api("dashboard.getUpdates", { limit: 300 }),
      api("sync.getState", { limit: 5 })
    ]);
    return { courses, entities, updates, sync };
  }

  function applyArchive({ courses, entities, updates, sync }) {
    state.bundles.clear();
    state.archiveRecreatedAt = sync?.status?.archiveRecreatedAt || "";
    state.index = dash.buildIndex({
      now: new Date().toISOString(),
      courses: courses.items,
      entities: entities.items,
      updates: updates.items,
      sync,
      settings: state.settings,
      courseContactOverrides: state.courseContactOverrides,
      courseTextbooks: state.courseTextbooks
    });
    dash.appModules.renderSyncStatus();
  }

  // Drops everything derived from the previously bound account. Synchronous on purpose:
  // it runs before any await, so the old account's data can never render under the new one.
  function clearAccountView() {
    state.index = null;
    state.account = { id: "", legacyOwnerId: "", canAdoptLegacy: false };
    state.adopt = { confirming: false, pending: false, error: "" };
    state.archiveRecreatedAt = "";
    state.recreatedSeen = "";
    state.read = {};
    state.checklistDone = {};
    state.checklistStorageKey = CHECKLIST_KEY;
    state.hiddenWork = {};
    state.courseContactOverrides = {};
    state.courseTextbooks = {};
    state.search = { query: "", result: null, pending: false };
    state.bundles.clear();
    state.detailContexts.clear();
    state.pageScrolls.clear();
    if (state.detail) dash.appModules.hideDetail();
    dash.appModules.closeSearchPanel();
  }

  const binder = dash.accountBinding.createBinder({
    getContext: () => api("system.getAccountContext"),
    loadScoped: async (accountId, legacyOwnerId) => ({
      read: await dash.accountBinding.loadScoped(chrome.storage.local, READ_KEY, accountId, legacyOwnerId, {}),
      recreatedSeen: await dash.accountBinding.loadScoped(chrome.storage.local, RECREATED_SEEN_KEY, accountId, "", ""),
      hiddenWork: await dash.accountBinding.loadScoped(chrome.storage.local, HIDDEN_WORK_KEY, accountId, "", {}),
      courseContactOverrides: await dash.accountBinding.loadScoped(chrome.storage.local, COURSE_OVERRIDES_KEY, accountId, legacyOwnerId, {}),
      courseTextbooks: await dash.accountBinding.loadScoped(chrome.storage.local, COURSE_TEXTBOOKS_KEY, accountId, legacyOwnerId, {})
    }),
    loadArchive: fetchArchive,
    clearView: clearAccountView,
    showLoading() {
      state.accountUnknown = false;
      main().innerHTML = dash.loadingPage();
    },
    showEmpty() {
      state.accountUnknown = true;
      main().innerHTML = dash.noAccountPage();
    },
    apply({ accountId, legacyOwnerAccountId, canAdoptLegacy, scoped, archive }) {
      state.accountUnknown = false;
      state.account = { id: accountId, legacyOwnerId: legacyOwnerAccountId, canAdoptLegacy: canAdoptLegacy === true };
      state.read = scoped.read || {};
      state.recreatedSeen = scoped.recreatedSeen || "";
      state.hiddenWork = scoped.hiddenWork || {};
      state.courseContactOverrides = scoped.courseContactOverrides || {};
      state.courseTextbooks = scoped.courseTextbooks || {};
      applyArchive(archive);
    }
  });

  // (Re)binds the dashboard to whichever account the profile names, then refreshes what depends on it.
  async function bindAccount({ first = false, force = false } = {}) {
    let result;
    try {
      result = await binder.rebind(state.profile?.accountId, { force });
    } catch (error) {
      main().innerHTML = dash.notFoundPage(`The archive couldn't be read: ${error.message}`);
      return { state: "error" };
    }
    if (result.state !== "ready") return result;
    await useChecklistStateForProfile(state.profile);
    if (!first) {
      dash.appModules.renderSyncStatus();
      await dash.appModules.render();
      dash.appModules.enqueueVisitRefresh().catch(() => {});
    }
    return result;
  }

  // The adopt prompt for a quarantined older archive (empty when there is nothing to offer).
  function adoptNotice() {
    if (!state.account.canAdoptLegacy) return "";
    return dash.adoptLegacyNotice({ name: state.profile?.displayName, ...state.adopt });
  }

  // Says (until dismissed) that the browser erased this account's saved archive and it is being rebuilt.
  function recreatedNotice() {
    const at = state.archiveRecreatedAt;
    return at && state.recreatedSeen !== at ? dash.archiveRecreatedNotice({ at }) : "";
  }

  function redrawAdoptNotice() {
    const node = main()?.querySelector("[data-adopt-legacy]");
    if (!node) return;
    const html = adoptNotice();
    if (html) node.outerHTML = html;
    else node.remove();
  }

  // Sends the confirmed choice; the background re-checks that this account is still the signed-in one.
  async function adoptLegacyArchive() {
    const accountId = state.account.id;
    if (!accountId || state.adopt.pending) return;
    state.adopt = { confirming: true, pending: true, error: "" };
    redrawAdoptNotice();
    const response = await chrome.runtime.sendMessage({ type: "D2L_ARCHIVE_ADOPT_LEGACY", accountId }).catch((error) => ({ ok: false, error: error?.message }));
    if (state.account.id !== accountId) return;
    if (!response?.ok) {
      state.adopt = { confirming: true, pending: false, error: response?.error || "The older archive couldn't be adopted." };
      redrawAdoptNotice();
      return;
    }
    const result = await bindAccount({ force: true });
    if (result.state === "ready") toast("Showing the older archive for your account.");
  }

  async function bundleFor(entityId) {
    if (!state.bundles.has(entityId)) state.bundles.set(entityId, api("entities.getBundle", { entityId }).catch(() => null));
    return state.bundles.get(entityId);
  }

  Object.assign(mod, { fetchArchive, applyArchive, clearAccountView, bindAccount, adoptNotice, recreatedNotice, redrawAdoptNotice, adoptLegacyArchive, bundleFor, binder });
})(globalThis);
