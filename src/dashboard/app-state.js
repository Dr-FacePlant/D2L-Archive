// Shared dashboard controller state and local-storage helpers.
(function initDashboardAppState(global) {
  const dash = global.D2LDashboard ||= {};
  const SETTINGS_KEY = "dashboardSettings";
  const READ_KEY = "dashboardReadUpdates";
  const SYNC_KEY = "dashboardSyncInProgress";
  const SYNC_FAILED_KEY = "dashboardSyncFailedAt";
  const LOGO_KEY = "schoolLogo";
  const PROFILE_KEY = "dashboardProfile";
  const CHECKLIST_KEY = "dashboardChecklistState";
  const CHECKLIST_OWNER_KEY = "dashboardChecklistOwner";
  const RECREATED_SEEN_KEY = "dashboardArchiveRecreatedSeen";
  const HIDDEN_WORK_KEY = "dashboardHiddenWork";
  const COURSE_OVERRIDES_KEY = "dashboardCourseOverrides";
  // D2L's profile-default icon, shown only when neither a photo nor a name is known.
  const DEFAULT_AVATAR_SVG = `<svg width="24" height="24" viewBox="0 0 18 18" aria-hidden="true"><path fill="currentColor" d="M9 0a9 9 0 0 0-9 9 8.654 8.654 0 0 0 .05.92 9 9 0 0 0 17.9 0A8.654 8.654 0 0 0 18 9a9 9 0 0 0-9-9zm5.42 13.42c-.01 0-.06.08-.07.08a6.975 6.975 0 0 1-10.7 0c-.01 0-.06-.08-.07-.08a.512.512 0 0 1-.09-.27.522.522 0 0 1 .34-.48c.74-.25 1.45-.49 1.65-.54a.16.16 0 0 1 .03-.13.49.49 0 0 1 .43-.36l1.27-.1a2.077 2.077 0 0 0-.19-.79v-.01a2.814 2.814 0 0 0-.45-.78 3.83 3.83 0 0 1-.79-2.38A3.38 3.38 0 0 1 8.88 4h.24a3.38 3.38 0 0 1 3.1 3.58 3.83 3.83 0 0 1-.79 2.38 2.814 2.814 0 0 0-.45.78v.01a2.077 2.077 0 0 0-.19.79l1.27.1a.49.49 0 0 1 .43.36.16.16 0 0 1 .03.13c.2.05.91.29 1.65.54a.49.49 0 0 1 .25.75z"/></svg>`;
  const SYNC_TIMEOUT_MS = 30 * 60 * 1000;

  const state = {
    index: null,
    account: { id: "", legacyOwnerId: "", canAdoptLegacy: false },
    adopt: { confirming: false, pending: false, error: "" },
    archiveRecreatedAt: "",
    recreatedSeen: "",
    accountUnknown: false,
    settings: { hiddenCourseIds: [], shownCourseIds: [], reminderHours: 24, downloadCourseFiles: false },
    read: {},
    checklistDone: {},
    checklistStorageKey: CHECKLIST_KEY,
    hiddenWork: {},
    courseContactOverrides: {},
    profile: null,
    sync: null,
    menu: null,
    filterMenu: null,
    search: { query: "", result: null, pending: false },
    bundles: new Map(),
    renderToken: 0,
    detailRenderToken: 0,
    detail: null,
    detailContexts: new Map(),
    pageScrolls: new Map(),
    previewFocus: null,
    peek: null,
    linkConfirm: null,
    baseStale: false,
    shownHash: null,
    lastFocusRefreshAt: 0
  };
  let lastFocusRefreshAt = 0;

  async function storageGet(key, fallback) {
    try {
      const value = (await chrome.storage.local.get(key))[key];
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function storageSet(key, value) {
    return chrome.storage.local.set({ [key]: value }).catch(() => {});
  }

  Object.assign(dash, {
    appState: {
      state, SETTINGS_KEY, READ_KEY, SYNC_KEY, SYNC_FAILED_KEY, LOGO_KEY, PROFILE_KEY,
      CHECKLIST_KEY, CHECKLIST_OWNER_KEY, RECREATED_SEEN_KEY, HIDDEN_WORK_KEY, COURSE_OVERRIDES_KEY,
      DEFAULT_AVATAR_SVG, SYNC_TIMEOUT_MS, storageGet, storageSet
    }
  });
})(globalThis);
