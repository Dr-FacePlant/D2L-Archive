(function initChecklistStateModule(global) {
  async function loadChecklistState(storage, options = {}) {
    const { keyPrefix, legacyKey, ownerKey, accountId = "" } = options;
    const owner = (await storage.get(ownerKey))[ownerKey] || "";
    const accountKey = accountId ? `${keyPrefix}:${accountId}` : legacyKey;
    const stored = (await storage.get(accountKey))[accountKey];
    if (stored !== undefined) return { key: accountKey, state: stored || {} };

    const legacy = (await storage.get(legacyKey))[legacyKey] || {};
    if (!accountId) return { key: legacyKey, state: owner ? {} : legacy };
    if (owner && owner !== accountId) return { key: accountKey, state: {} };

    await storage.set({ [accountKey]: legacy, [ownerKey]: accountId });
    return { key: accountKey, state: legacy };
  }

  async function persistChecklistState(storage, key, previous, next) {
    try {
      await storage.set({ [key]: next });
      return { ok: true, state: next };
    } catch (error) {
      return { ok: false, state: previous, error: error?.message || "storage unavailable" };
    }
  }

  global.D2LDashboardChecklist = Object.freeze({ loadChecklistState, persistChecklistState });
})(globalThis);
