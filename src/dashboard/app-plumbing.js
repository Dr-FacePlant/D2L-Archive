// Dashboard controller setup, messaging, activity and profile helpers.
(function initDashboardAppPlumbing(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const {
    state, SETTINGS_KEY, READ_KEY, SYNC_KEY, SYNC_FAILED_KEY, LOGO_KEY, PROFILE_KEY,
    CHECKLIST_KEY, CHECKLIST_OWNER_KEY, RECREATED_SEEN_KEY, HIDDEN_WORK_KEY, COURSE_OVERRIDES_KEY,
    DEFAULT_AVATAR_SVG, SYNC_TIMEOUT_MS, storageGet, storageSet
  } = dash.appState;

  const $ = (selector) => document.querySelector(selector);
  const main = () => $("#main");
  const EMBEDDED = new URLSearchParams(location.search).get("embedded") === "1";
  const look = dash.appearance;

  // ------------------------------------------------------------ plumbing

  function api(method, params = {}) {
    return chrome.runtime.sendMessage({
      type: "D2L_APP_API_REQUEST",
      protocolVersion: "1",
      requestId: `dash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      method,
      params
    }).then((response) => {
      if (!response?.ok) throw Object.assign(new Error(response?.error?.message || `${method} failed`), { code: response?.error?.code });
      return response.data;
    });
  }


  function recordActivity(event) {
    return chrome.runtime.sendMessage({ type: "D2L_ACTIVITY_RECORD", event }).catch(() => null);
  }

  async function setChecklistDone(taskId, done) {
    if (!taskId) return;
    const previous = state.checklistDone || {};
    const next = { ...previous };
    if (done) next[taskId] = true;
    else delete next[taskId];
    state.checklistDone = next;
    const result = await global.D2LDashboardChecklist.persistChecklistState(chrome.storage.local, state.checklistStorageKey, previous, next);
    if (!result.ok) {
      state.checklistDone = result.state;
      toast(`Checklist change wasn't saved locally: ${result.error}`);
      return;
    }
    // The list under an open checklist must redraw when the layer closes.
    if (state.detail) state.baseStale = true;
    await recordActivity({ operation: "checklist.toggle", category: "local-change", status: "saved", itemId: taskId, source: "custom-dashboard", details: { checked: Boolean(done), remoteState: "not_attempted" } });
  }

  // Marking work done or skipping it is saved per account on this computer
  // only; D2L never changes. reason is "done", "skip", or null to undo.
  async function setWorkMark(entityId, reason) {
    if (!entityId) return false;
    if (!state.account.id) {
      toast("Your mark wasn't saved: the D2L account isn't known yet.");
      return false;
    }
    const previous = state.hiddenWork || {};
    const next = { ...previous };
    if (reason) next[entityId] = { hiddenAt: new Date().toISOString(), reason };
    else delete next[entityId];
    state.hiddenWork = next;
    try {
      await chrome.storage.local.set({ [dash.accountBinding.scopedKey(HIDDEN_WORK_KEY, state.account.id)]: next });
    } catch (error) {
      state.hiddenWork = previous;
      toast(`Your mark wasn't saved locally: ${error?.message || "storage unavailable"}`);
      return false;
    }
    if (state.detail) state.baseStale = true;
    toast(reason === "done" ? "Marked done" : reason === "skip" ? "Skipped" : "Back on your lists");
    await recordActivity({ operation: reason === "done" ? "work.markDone" : reason === "skip" ? "work.skip" : "work.unmark", category: "local-change", status: "saved", itemId: entityId, source: "custom-dashboard", details: { remoteState: "not_attempted" } });
    return true;
  }

  async function useChecklistStateForProfile(profile) {
    const loaded = await global.D2LDashboardChecklist.loadChecklistState(chrome.storage.local, {
      keyPrefix: CHECKLIST_KEY,
      legacyKey: CHECKLIST_KEY,
      ownerKey: CHECKLIST_OWNER_KEY,
      accountId: profile?.accountId || ""
    });
    state.checklistStorageKey = loaded.key;
    state.checklistDone = loaded.state;
  }

  function toast(text) {
    const node = $("#toast");
    node.textContent = text;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 3800);
  }

  // School logo: copied from the D2L header by the sync, shown in the corner.
  // With no saved logo the corner shows a plain cap icon instead.
  function renderSchoolLogo(logo) {
    const img = $("#school-logo");
    const fallback = $("#brand-fallback");
    if (!img || !fallback) return;
    const usable = typeof logo?.dataUrl === "string" && /^data:image\//.test(logo.dataUrl);
    if (usable) {
      img.src = logo.dataUrl;
      img.alt = logo.alt || "School logo";
    } else {
      img.removeAttribute("src");
      img.alt = "";
    }
    img.hidden = !usable;
    fallback.hidden = usable;
  }

  function renderUserProfile(profile = state.profile) {
    const nameEl = document.getElementById("profile-name");
    if (nameEl) nameEl.textContent = profile?.displayName?.trim() || "Your account";
    const usable = typeof profile?.dataUrl === "string" && /^data:image\//.test(profile.dataUrl);
    // No photo: the student's initials, or D2L's default icon if the name is unknown.
    const initials = initialsOf(profile?.displayName);
    // The top-bar button and the menu's header each show the same avatar.
    for (const avatar of document.querySelectorAll(".profile-avatar")) {
      const img = avatar.querySelector("img");
      const fallback = avatar.querySelector(".profile-avatar-fallback");
      if (!img || !fallback) continue;
      if (usable) {
        img.src = profile.dataUrl;
        img.alt = "";
      } else {
        img.removeAttribute("src");
      }
      img.hidden = !usable;
      fallback.hidden = usable;
      fallback.classList.toggle("initials", Boolean(initials));
      if (initials) fallback.textContent = initials;
      else if (!fallback.querySelector("svg")) fallback.innerHTML = DEFAULT_AVATAR_SVG;
    }
  }

  // "Casey Example" → "CE"; "Example, Casey" (D2L's Last, First) → "CE".
  function initialsOf(name) {
    const text = String(name || "").trim();
    const parts = (text.includes(",") ? text.split(",").reverse() : [text]).join(" ").split(/\s+/).filter((part) => /\p{L}/u.test(part));
    if (!parts.length) return "";
    const first = parts[0].match(/\p{L}/u)[0];
    const last = parts.length > 1 ? parts.at(-1).match(/\p{L}/u)[0] : "";
    return (first + last).toUpperCase();
  }

  Object.assign(mod, { api, recordActivity, setChecklistDone, setWorkMark, useChecklistStateForProfile, toast, renderSchoolLogo, renderUserProfile, initialsOf, $, main, EMBEDDED, look, state, SETTINGS_KEY, READ_KEY, SYNC_KEY, SYNC_FAILED_KEY, LOGO_KEY, PROFILE_KEY, CHECKLIST_KEY, CHECKLIST_OWNER_KEY, RECREATED_SEEN_KEY, HIDDEN_WORK_KEY, COURSE_OVERRIDES_KEY, DEFAULT_AVATAR_SVG, SYNC_TIMEOUT_MS, storageGet, storageSet });
})(globalThis);
