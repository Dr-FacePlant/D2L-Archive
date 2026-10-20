(function initAccountRegistryModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { APP_DB_NAME, D2L_ORIGIN, normalizeText } = shared;

  const REGISTRY_KEY = "archiveAccounts";
  const PROFILE_KEY = "dashboardProfile";
  const CHECKLIST_OWNER_KEY = "dashboardChecklistOwner";
  const BINDING_META_KEY = "accountBinding";
  const DB_PREFIX = `${APP_DB_NAME}--`;

  class AccountError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "AccountError";
      this.code = code;
      this.details = details;
    }
  }

  function accountKeyFor(accountId, site = D2L_ORIGIN) {
    const id = normalizeText(accountId);
    if (!id || /[|\s]/.test(id)) throw new AccountError("ACCOUNT_UNKNOWN", "The signed-in D2L account is not known, so no archive was opened.");
    return `${site}|${id}`;
  }

  function dbNameFor(accountId, site = D2L_ORIGIN) {
    return `${DB_PREFIX}${encodeURIComponent(site)}--${encodeURIComponent(normalizeText(accountId))}`;
  }

  // Inverse of dbNameFor, used to find account databases when the registry is gone.
  function parseDbName(name) {
    if (!String(name || "").startsWith(DB_PREFIX)) return null;
    const rest = name.slice(DB_PREFIX.length);
    const split = rest.indexOf("--");
    if (split < 1) return null;
    try {
      const site = decodeURIComponent(rest.slice(0, split));
      const accountId = decodeURIComponent(rest.slice(split + 2));
      return accountId && dbNameFor(accountId, site) === name ? { site, accountId, accountKey: `${site}|${accountId}` } : null;
    } catch {
      return null;
    }
  }

  function emptyState() {
    return { version: 1, accounts: {}, legacy: null };
  }

  function validState(value) {
    return value && typeof value === "object" && value.version === 1
      && value.accounts && typeof value.accounts === "object" && !Array.isArray(value.accounts);
  }

  // Maps each D2L account to its own archive database. The original shared
  // database is bound in place to the account that built it (never copied).
  function createAccountRegistry(deps = {}) {
    const { storage, openRepository } = deps;
    const site = deps.site || D2L_ORIGIN;
    const now = deps.now || (() => new Date().toISOString());
    const listDatabases = deps.listDatabases || (async () => { throw new Error("Database listing is unavailable."); });
    if (!storage || typeof openRepository !== "function") throw new Error("Account registry needs storage and openRepository.");

    let state = null;
    let readyPromise = null;
    let chain = Promise.resolve();
    const repositories = new Map();
    // Accounts this registry added itself: their database may not exist yet, so
    // a missing database there is a first creation, not an erased archive.
    // Known low-risk edge case (left as is in 0.8.252): if the service worker
    // stops after adding an account but before its first open, the next worker
    // reports that empty database as "recreated" instead of "created".
    const addedHere = new Set();

    // Registry writes are read-modify-write; run them one at a time.
    function serialize(operation) {
      const run = chain.then(operation, operation);
      chain = run.catch(() => {});
      return run;
    }

    async function readStored() {
      const stored = (await storage.get(REGISTRY_KEY))[REGISTRY_KEY];
      return validState(stored) ? stored : null;
    }

    async function writeState(next) {
      state = next;
      await storage.set({ [REGISTRY_KEY]: next });
    }

    // First writer wins: an existing entry is never replaced.
    function addAccount(accountKey, entry) {
      return serialize(async () => {
        const latest = (await readStored()) || state || emptyState();
        if (latest.accounts[accountKey]) {
          state = latest;
          return latest.accounts[accountKey];
        }
        addedHere.add(accountKey);
        await writeState({ ...latest, accounts: { ...latest.accounts, [accountKey]: entry } });
        return entry;
      });
    }

    async function decideLegacy(names) {
      const decidedAt = now();
      if (!names.includes(APP_DB_NAME)) return { state: "absent", decidedAt };
      const legacy = await openRepository(APP_DB_NAME);
      const stamp = await legacy.getMeta(BINDING_META_KEY);
      if (stamp?.accountKey) return { state: "bound", accountKey: stamp.accountKey, accountId: stamp.accountId, via: "stamp", decidedAt };
      const { accountIds } = await legacy.getAccountProvenance();
      let ownerId = "";
      let via = "";
      if (accountIds.length === 1) {
        ownerId = accountIds[0];
        via = "provenance";
      } else if (!accountIds.length) {
        const profile = (await storage.get(PROFILE_KEY))[PROFILE_KEY]?.accountId;
        const checklistOwner = (await storage.get(CHECKLIST_OWNER_KEY))[CHECKLIST_OWNER_KEY];
        if (normalizeText(profile) && normalizeText(profile) === normalizeText(checklistOwner)) {
          ownerId = normalizeText(profile);
          via = "profile-and-checklist-owner";
        } else {
          return { state: "quarantined", reason: "no-provenance", candidates: [], decidedAt };
        }
      } else {
        return { state: "quarantined", reason: "multiple-accounts", candidates: accountIds, decidedAt };
      }
      const accountKey = accountKeyFor(ownerId, site);
      await legacy.setMeta(BINDING_META_KEY, { accountKey, accountId: ownerId, boundAt: decidedAt, via, boundLegacy: true }).catch(() => {});
      return { state: "bound", accountKey, accountId: ownerId, via, decidedAt };
    }

    function ensureReady() {
      readyPromise ||= serialize(async () => {
        const stored = await readStored();
        let next = stored || emptyState();
        if (!stored || !next.legacy) {
          let names;
          try {
            names = await listDatabases();
          } catch (error) {
            throw new AccountError("ACCOUNT_REGISTRY_UNAVAILABLE", `Archive databases could not be listed, so no archive was opened (${error?.message || "unknown"}).`);
          }
          // The legacy database is decided first so it keeps its owner even when
          // a stray per-account database for the same owner also exists.
          const legacy = next.legacy || await decideLegacy(names);
          const accounts = { ...next.accounts };
          if (legacy.state === "bound" && !accounts[legacy.accountKey]) {
            accounts[legacy.accountKey] = { dbName: APP_DB_NAME, accountId: legacy.accountId, site, createdAt: legacy.decidedAt, boundLegacy: true };
          }
          const orphans = [...(next.orphans || [])];
          for (const name of names) {
            const parsed = parseDbName(name);
            if (!parsed) continue;
            if (!accounts[parsed.accountKey]) {
              accounts[parsed.accountKey] = { dbName: name, accountId: parsed.accountId, site: parsed.site, createdAt: now(), boundLegacy: false, recovered: true };
            } else if (accounts[parsed.accountKey].dbName !== name && !orphans.includes(name)) {
              orphans.push(name);
            }
          }
          next = { ...next, accounts, legacy, ...(orphans.length ? { orphans } : {}), ...(stored ? {} : { recoveredAt: now() }) };
          await writeState(next);
        } else {
          state = next;
        }
        return state;
      }).catch((error) => {
        readyPromise = null;
        throw error;
      });
      return readyPromise;
    }

    // True only when the database listing works and lacks this name: opening it
    // will create it empty. When the listing fails, nothing is assumed.
    async function databaseMissing(dbName) {
      try {
        return !(await listDatabases()).includes(dbName);
      } catch {
        return false;
      }
    }

    async function repositoryFor(accountId) {
      const accountKey = accountKeyFor(accountId, site);
      await ensureReady();
      let entry = state.accounts[accountKey];
      const registered = Boolean(entry) && !addedHere.has(accountKey);
      if (!entry) {
        const boundHere = state.legacy?.state === "bound" && state.legacy.accountKey === accountKey;
        entry = await addAccount(accountKey, boundHere
          ? { dbName: APP_DB_NAME, accountId: normalizeText(accountId), site, createdAt: now(), boundLegacy: true }
          : { dbName: dbNameFor(accountId, site), accountId: normalizeText(accountId), site, createdAt: now(), boundLegacy: false });
      }
      if (entry.dbName === APP_DB_NAME && !(state.legacy?.state === "bound" && state.legacy.accountKey === accountKey)) {
        throw new AccountError("ACCOUNT_QUARANTINED", "The existing archive is not bound to this account.", { accountKey });
      }
      const cached = repositories.get(accountKey);
      if (cached?.dbName === entry.dbName) return cached.repository;
      // The registry already lists this archive, so if it is gone from disk the
      // browser erased it: the open below recreates it empty under the same name.
      const recreated = registered && await databaseMissing(entry.dbName);
      const repository = await openRepository(entry.dbName);
      const stamp = await repository.getMeta(BINDING_META_KEY);
      if (!stamp) {
        const boundAt = now();
        await repository.setMeta(BINDING_META_KEY, { accountKey, accountId: normalizeText(accountId), boundAt, via: recreated ? "recreated" : "created", boundLegacy: entry.boundLegacy === true });
        if (recreated) {
          await repository.recordActivity({
            operation: "archive.recreated",
            category: "archive",
            status: "warning",
            details: { dbName: entry.dbName, registeredAt: entry.createdAt || "", recreatedAt: boundAt, message: "The browser-local archive was missing, apparently erased by the browser, and was recreated empty. Data is being re-synced from D2L." }
          }).catch(() => {});
        }
      } else if (stamp.accountKey !== accountKey) {
        throw new AccountError("ACCOUNT_DB_MISMATCH", "That archive database belongs to a different account.", { accountKey });
      }
      repositories.set(accountKey, { dbName: entry.dbName, repository });
      return repository;
    }

    // The account the dashboard last saw sign in. Fine for dashboard-driven
    // reads; background work that talks to D2L verifies the account live instead.
    async function activeAccountId() {
      return normalizeText((await storage.get(PROFILE_KEY))[PROFILE_KEY]?.accountId);
    }

    async function activeRepository() {
      const accountId = await activeAccountId();
      if (!accountId) throw new AccountError("ACCOUNT_UNKNOWN", "The signed-in D2L account is not known. Open D2L so the archive can identify your account.");
      return repositoryFor(accountId);
    }

    async function describe() {
      await ensureReady();
      return {
        accounts: Object.entries(state.accounts).map(([accountKey, entry]) => ({ accountKey, dbName: entry.dbName, boundLegacy: entry.boundLegacy === true, recovered: entry.recovered === true })),
        legacy: state.legacy ? { state: state.legacy.state, accountKey: state.legacy.accountKey || "", reason: state.legacy.reason || "", candidates: state.legacy.candidates || [], via: state.legacy.via || "" } : null,
        orphans: state.orphans || []
      };
    }

    // The account that built the pre-isolation shared archive ("" when none or quarantined).
    async function legacyOwnerAccountId() {
      await ensureReady();
      return state.legacy?.state === "bound" ? normalizeText(state.legacy.accountId) : "";
    }

    // A quarantined legacy archive may be adopted by the signed-in account: any
    // account when there was no provenance, only a recorded owner when it mixes accounts.
    function canAdopt(legacy, accountId) {
      if (legacy?.state !== "quarantined" || !accountId) return false;
      return legacy.reason !== "multiple-accounts" || (legacy.candidates || []).map(normalizeText).includes(accountId);
    }

    async function legacyAdoptionStatus(accountId) {
      await ensureReady();
      const legacy = state.legacy;
      return { state: legacy?.state || "absent", reason: legacy?.reason || "", canAdopt: canAdopt(legacy, normalizeText(accountId)) };
    }

    // The user's confirmed choice: bind the quarantined legacy archive in place to
    // this account. Nothing is copied or deleted; a database the account was using
    // until now stays on disk, unmodified, listed under orphans.
    async function adoptLegacy(accountId) {
      const id = normalizeText(accountId);
      const accountKey = accountKeyFor(id, site);
      await ensureReady();
      return serialize(async () => {
        const latest = (await readStored()) || state;
        if (latest.legacy?.state === "bound" && latest.legacy.accountKey === accountKey) return { adopted: false, alreadyOwner: true, accountId: id };
        if (latest.legacy?.state !== "quarantined") throw new AccountError("ACCOUNT_ADOPT_UNAVAILABLE", "There is no unowned archive to adopt.", { accountKey });
        if (!canAdopt(latest.legacy, id)) throw new AccountError("ACCOUNT_ADOPT_REFUSED", "This account is not one of the accounts recorded in the older archive.", { accountKey });
        let names;
        try {
          names = await listDatabases();
        } catch (error) {
          throw new AccountError("ACCOUNT_REGISTRY_UNAVAILABLE", `Archive databases could not be listed, so nothing was adopted (${error?.message || "unknown"}).`);
        }
        if (!names.includes(APP_DB_NAME)) throw new AccountError("ACCOUNT_ADOPT_UNAVAILABLE", "The older archive is no longer on this computer.", { accountKey });
        const legacyRepository = await openRepository(APP_DB_NAME);
        const stamp = await legacyRepository.getMeta(BINDING_META_KEY);
        if (stamp?.accountKey && stamp.accountKey !== accountKey) throw new AccountError("ACCOUNT_DB_MISMATCH", "The older archive is already bound to a different account.", { accountKey });
        const adoptedAt = now();
        await legacyRepository.setMeta(BINDING_META_KEY, { accountKey, accountId: id, boundAt: adoptedAt, via: "adopted", boundLegacy: true });
        const previous = latest.accounts[accountKey];
        const replaced = previous && previous.dbName !== APP_DB_NAME ? previous.dbName : "";
        const orphans = [...(latest.orphans || [])];
        if (replaced && !orphans.includes(replaced)) orphans.push(replaced);
        await writeState({
          ...latest,
          accounts: { ...latest.accounts, [accountKey]: { dbName: APP_DB_NAME, accountId: id, site, createdAt: adoptedAt, boundLegacy: true, adoptedAt, ...(replaced ? { replaced } : {}) } },
          legacy: { state: "bound", accountKey, accountId: id, via: "adopted", decidedAt: adoptedAt, adoptedFrom: { reason: latest.legacy.reason || "", candidates: latest.legacy.candidates || [] } },
          ...(orphans.length ? { orphans } : {})
        });
        repositories.delete(accountKey);
        return { adopted: true, accountId: id, replaced };
      });
    }

    // Per-account local state ("base:accountId"). The old global value belongs to
    // the legacy owner only; every other account starts empty.
    async function readAccountScoped(baseKey, accountId) {
      const id = normalizeText(accountId);
      if (!id) throw new AccountError("ACCOUNT_UNKNOWN", "No account for account-scoped state.");
      const scopedKey = `${baseKey}:${id}`;
      const scoped = (await storage.get(scopedKey))[scopedKey];
      if (scoped !== undefined) return scoped;
      return (await legacyOwnerAccountId()) === id ? (await storage.get(baseKey))[baseKey] : undefined;
    }

    async function writeAccountScoped(baseKey, accountId, value) {
      const id = normalizeText(accountId);
      if (!id) throw new AccountError("ACCOUNT_UNKNOWN", "No account for account-scoped state.");
      await storage.set({ [`${baseKey}:${id}`]: value });
    }

    // Dashboard entry point: the account the prompt was shown for must still be the active one.
    async function adoptLegacyForActive(expectedAccountId) {
      const active = await activeAccountId();
      if (!active) throw new AccountError("ACCOUNT_UNKNOWN", "The signed-in D2L account is not known, so nothing was adopted.");
      if (normalizeText(expectedAccountId) !== active) throw new AccountError("ACCOUNT_CHANGED", "The signed-in account changed before the archive was adopted. Nothing was changed.");
      return adoptLegacy(active);
    }

    return { repositoryFor, activeAccountId, activeRepository, describe, ensureReady, legacyOwnerAccountId, legacyAdoptionStatus, adoptLegacy, adoptLegacyForActive, readAccountScoped, writeAccountScoped };
  }

  let registry = null;

  function defaultRegistry() {
    registry ||= createAccountRegistry({
      storage: global.chrome.storage.local,
      listDatabases: async () => (await global.indexedDB.databases()).map((database) => database.name),
      openRepository: async (dbName) => background.createArchiveRepository(
        background.createIndexedDbArchiveAdapter({ indexedDB: global.indexedDB, databaseName: dbName }),
        { databaseName: dbName }
      )
    });
    return registry;
  }

  function configureAccountRegistry(next) {
    registry = next;
  }

  const repositoryForAccount = (accountId) => defaultRegistry().repositoryFor(accountId);
  const activeArchiveRepository = () => defaultRegistry().activeRepository();
  const activeArchiveAccountId = () => defaultRegistry().activeAccountId();
  const describeAccounts = () => defaultRegistry().describe();
  const legacyOwnerAccountId = () => defaultRegistry().legacyOwnerAccountId();
  const legacyAdoptionStatus = (accountId) => defaultRegistry().legacyAdoptionStatus(accountId);
  const adoptLegacyArchive = (expectedAccountId) => defaultRegistry().adoptLegacyForActive(expectedAccountId);
  const readAccountScoped = (baseKey, accountId) => defaultRegistry().readAccountScoped(baseKey, accountId);
  const writeAccountScoped = (baseKey, accountId, value) => defaultRegistry().writeAccountScoped(baseKey, accountId, value);

  Object.assign(background, {
    AccountError, accountKeyFor, dbNameFor, parseDbName, createAccountRegistry, configureAccountRegistry,
    repositoryForAccount, activeArchiveRepository, activeArchiveAccountId, describeAccounts,
    legacyOwnerAccountId, legacyAdoptionStatus, adoptLegacyArchive, readAccountScoped, writeAccountScoped
  });
})(globalThis);
