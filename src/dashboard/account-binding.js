// Keeps the dashboard bound to one D2L account at a time. When the signed-in
// account changes, everything derived from the old account is cleared first
// (synchronously, before any await) so nothing from it can render under the new
// one, then the new account's archive and local state are loaded. A response for
// an account that is no longer current is discarded.
(function initAccountBinding(global) {
  const dash = global.D2LDashboard ||= {};
  const clean = (value) => String(value || "").trim();

  const scopedKey = (baseKey, accountId) => `${baseKey}:${accountId}`;

  // Per-account local state. The old global value belongs to the legacy archive
  // owner only; any other account starts empty.
  async function loadScoped(storage, baseKey, accountId, legacyOwnerId, fallback) {
    const key = scopedKey(baseKey, accountId);
    const scoped = (await storage.get(key))[key];
    if (scoped !== undefined) return scoped;
    if (clean(legacyOwnerId) && clean(legacyOwnerId) === accountId) {
      const legacy = (await storage.get(baseKey))[baseKey];
      if (legacy !== undefined) return legacy;
    }
    return fallback;
  }

  function saveScoped(storage, baseKey, accountId, value) {
    if (!clean(accountId)) return Promise.resolve();
    return Promise.resolve(storage.set({ [scopedKey(baseKey, accountId)]: value })).catch(() => {});
  }

  // deps: getContext() -> { accountId, legacyOwnerAccountId, canAdoptLegacy }, loadScoped(accountId, legacyOwnerId),
  // loadArchive() (rejects with code ACCOUNT_UNKNOWN when no account), clearView(), showLoading(),
  // showEmpty(), apply({ accountId, legacyOwnerAccountId, canAdoptLegacy, scoped, archive }).
  // rebind(id, { force: true }) reloads the same account, e.g. after it adopted the older archive.
  function createBinder(deps) {
    let token = 0;
    let bound = null;

    async function rebind(accountId, { force = false } = {}) {
      const id = clean(accountId);
      if (bound === id && !force) return { state: "unchanged" };
      const mine = ++token;
      bound = id;
      deps.clearView();
      if (!id) {
        deps.showEmpty();
        return { state: "unknown" };
      }
      deps.showLoading();
      const context = await deps.getContext();
      if (mine !== token) return { state: "stale" };
      if (!clean(context?.accountId)) {
        // The account vanished between the event and the read: nothing is read, the empty state shows.
        bound = "";
        deps.clearView();
        deps.showEmpty();
        return { state: "unknown" };
      }
      if (clean(context.accountId) !== id) return { state: "stale" };
      const legacyOwnerAccountId = clean(context.legacyOwnerAccountId);
      const scoped = await deps.loadScoped(id, legacyOwnerAccountId);
      if (mine !== token) return { state: "stale" };
      let archive;
      try {
        archive = await deps.loadArchive();
      } catch (error) {
        if (mine !== token) return { state: "stale" };
        if (error?.code === "ACCOUNT_UNKNOWN") {
          bound = "";
          deps.clearView();
          deps.showEmpty();
          return { state: "unknown" };
        }
        throw error;
      }
      if (mine !== token) return { state: "stale" };
      deps.apply({ accountId: id, legacyOwnerAccountId, canAdoptLegacy: context.canAdoptLegacy === true, scoped, archive });
      return { state: "ready" };
    }

    return { rebind, get accountId() { return bound; } };
  }

  Object.assign(dash, { accountBinding: Object.freeze({ scopedKey, loadScoped, saveScoped, createBinder }) });
})(globalThis);
