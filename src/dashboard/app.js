// Dashboard startup.
(function initDashboardAppBoot(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { $, EMBEDDED, LOGO_KEY, PROFILE_KEY, SETTINGS_KEY, SYNC_FAILED_KEY, SYNC_KEY, SYNC_TIMEOUT_MS, applyLook, bindAccount, enqueueVisitRefresh, look, main, pollSync, render, renderNav, renderSchoolLogo, renderSyncStatus, renderUserProfile, runSelfCheck, state, storageGet, toast } = dash.appModules;
  // --------------------------------------------------------------- boot

  async function boot() {
    if (EMBEDDED) {
      document.documentElement.classList.add("embedded");
      $("#overlay-close").hidden = false;
    }
    renderNav("dashboard");
    main().innerHTML = dash.loadingPage();
    state.settings = { ...state.settings, ...(await storageGet(SETTINGS_KEY, {})) };
    applyLook();
    state.syncFailedAt = await storageGet(SYNC_FAILED_KEY, "");
    state.profile = await storageGet(PROFILE_KEY, null);
    renderSchoolLogo(await storageGet(LOGO_KEY, null));
    renderUserProfile();
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === "local" && changes[LOGO_KEY]) renderSchoolLogo(changes[LOGO_KEY].newValue);
      // The overlay and a dashboard tab follow each other's look.
      if (area === "local" && changes[SETTINGS_KEY]) {
        const appearance = changes[SETTINGS_KEY].newValue?.appearance;
        if (JSON.stringify(look.normalize(appearance)) !== JSON.stringify(look.normalize(state.settings.appearance))) {
          state.settings.appearance = appearance;
          applyLook();
          if (state.detail && dash.parseRoute(location.hash).name === "settings") render();
        }
      }
      if (area === "local" && changes[PROFILE_KEY]) {
        state.profile = changes[PROFILE_KEY].newValue || null;
        renderUserProfile();
        // Same account (a new photo or name): nothing to rebind. A different account clears and reloads everything.
        bindAccount().catch(() => toast("Couldn't switch to the signed-in account."));
      }
    });
    const bound = await bindAccount({ first: true });
    if (bound.state === "error") return;
    if (bound.state !== "ready") {
      // No known account: the friendly empty state is already shown and the profile listener will bind later.
      return;
    }
    const pending = await storageGet(SYNC_KEY, null);
    if (pending?.mode === "priorityQueue" && Date.now() - Date.parse(pending.startedAt) < SYNC_TIMEOUT_MS) {
      state.sync = pending;
      pollSync();
    } else if (pending) {
      await chrome.storage.local.remove(SYNC_KEY).catch(() => {});
    }
    renderSyncStatus();
    await render();
    // Render saved data immediately; enqueue only courses whose API freshness is due.
    if (!state.sync) enqueueVisitRefresh().catch(() => {});
    if (new URLSearchParams(location.search).get("selfcheck") === "1") runSelfCheck().catch((error) => toast(`Self-check failed: ${error.message}`));
  }

  boot();
  Object.assign(mod, { boot });
})(globalThis);
