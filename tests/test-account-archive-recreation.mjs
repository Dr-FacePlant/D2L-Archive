import { loadBackgroundHooks, createMemoryAccountEnvironment, createMemoryStorage } from "./test-production-loader.mjs";
import { loadDashboard } from "./test-dashboard-loader.mjs";

// When the registry already lists an account's archive but the browser erased the
// database, opening it recreates it empty. That must be stamped and reported as
// "recreated", in place, without changing which account owns it.
const fail = (message) => { throw new Error(message); };
const check = (value, message) => { if (!value) fail(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const LEGACY = "d2l-student-archive";
const SITE = "https://kennesaw.view.usg.edu";
const dbName = (id) => `${LEGACY}--${encodeURIComponent(SITE)}--${id}`;
const key = (id) => `${SITE}|${id}`;
const NOW = () => "2026-10-06T12:00:00.000Z";
const REGISTERED_AT = "2026-10-03T02:54:00.000Z";

function rows(adapter) {
  const out = {};
  for (const name of Object.keys(adapter.data)) out[name] = [...adapter.data[name].entries()].sort(([a], [b]) => a.localeCompare(b));
  return out;
}
const snapshot = (adapter) => JSON.stringify(rows(adapter));
const stampOf = (adapter) => adapter.data.meta.get("accountBinding")?.value;
const recreatedEvents = (adapter) => [...adapter.data.activity.values()].filter((event) => event.operation === "archive.recreated");

async function api(hooks, method, params = {}) {
  const response = await hooks.handleAppApiRequest({ type: "D2L_APP_API_REQUEST", protocolVersion: "1", requestId: `r-${method}`, method, params });
  if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code });
  return response.data;
}

// The live shape: the original database bound in place to its owner.
function legacyBoundRegistry(accountId) {
  return {
    version: 1,
    accounts: { [key(accountId)]: { dbName: LEGACY, accountId, site: SITE, createdAt: REGISTERED_AT, boundLegacy: true } },
    legacy: { state: "bound", accountKey: key(accountId), accountId, via: "provenance", decidedAt: REGISTERED_AT }
  };
}

function perAccountRegistry(accountId) {
  return {
    version: 1,
    accounts: { [key(accountId)]: { dbName: dbName(accountId), accountId, site: SITE, createdAt: REGISTERED_AT, boundLegacy: false } },
    legacy: { state: "absent", decidedAt: REGISTERED_AT }
  };
}

function baselineSeed(accountId) {
  const make = (count, build) => Array.from({ length: count }, (_, index) => build(index));
  const courseIds = ["9900001", "9900002", "9900003", "9900004"];
  return {
    courses: courseIds.map((courseId) => ({ courseId, title: `Course ${courseId}`, active: true })),
    evidence: make(3297, (i) => ({ evidenceId: `${courseIds[i % 4]}:assignment:${i}`, courseId: courseIds[i % 4], source: "assignment", revision: 1 })),
    entities: make(1778, (i) => ({ entityId: `assignmentBundle:${courseIds[i % 4]}:${i}`, courseId: courseIds[i % 4], entityType: "assignmentBundle" })),
    relationships: make(6423, (i) => ({ relationshipId: `from${i}::references::to${i}`, courseId: courseIds[i % 4], fromId: `from${i}`, toId: `to${i}`, type: "references" })),
    syncRuns: make(153, (i) => ({ syncRunId: `run-${i}`, startedAt: NOW(), status: "completed" })),
    syncJobs: make(28, (i) => ({ jobId: `course-api-${accountId}-${courseIds[i % 4]}-c${i}`, accountId, courseId: courseIds[i % 4], category: `c${i}`, state: "completed" })),
    meta: [
      { key: "databaseRevision", value: 153 },
      { key: "accountBinding", value: { accountKey: key(accountId), accountId, boundAt: "2026-10-05T18:18:36.093Z", via: "created", boundLegacy: true } }
    ]
  };
}

// ---- 1. Genuine first creation still reports "created" ---------------------------------------------
{
  const hooks = loadBackgroundHooks();
  const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", now: NOW });
  const status = (await api(hooks, "sync.getState")).status;
  const fresh = env.adapters.get(dbName("acct-a"));
  check(stampOf(fresh)?.via === "created" && stampOf(fresh)?.accountKey === key("acct-a"), `a first-time account should be stamped created: ${JSON.stringify(stampOf(fresh))}`);
  check(status.archiveRecreatedAt === "", "a first-time account must not report a recreated archive");
  check(recreatedEvents(fresh).length === 0, "a first-time account must not log a recreated event");
  check(same([...env.adapters.keys()], [dbName("acct-a")]), "a first-time account should create exactly its own database");
}

// Several first calls at once, with the database appearing only after its first write
// (as in a real browser): none of them may mistake the brand-new archive for an erased one.
{
  const hooks = loadBackgroundHooks();
  const adapters = new Map();
  const repositories = new Map();
  const tick = (ms = 2) => new Promise((resolve) => setTimeout(resolve, ms));
  const openDelays = [12]; // the first open is the slowest, so a later caller reads the meta first
  const registry = hooks.createAccountRegistry({
    storage: createMemoryStorage({}),
    now: NOW,
    listDatabases: async () => [...adapters].filter(([, adapter]) => adapter.data.meta.size).map(([name]) => name),
    openRepository: async (name) => {
      await tick(openDelays.shift() ?? 0);
      if (!adapters.has(name)) adapters.set(name, hooks.createMemoryArchiveAdapter());
      if (!repositories.has(name)) repositories.set(name, hooks.createArchiveRepository(adapters.get(name), { databaseName: name, now: NOW }));
      return repositories.get(name);
    }
  });
  const first = registry.repositoryFor("acct-a");
  await tick();
  await Promise.all([first, registry.repositoryFor("acct-a"), registry.repositoryFor("acct-a")]);
  const fresh = adapters.get(dbName("acct-a"));
  check(stampOf(fresh)?.via === "created", `overlapping first opens must stay created: ${JSON.stringify(stampOf(fresh))}`);
  check(recreatedEvents(fresh).length === 0, "overlapping first opens must not log a recreated event");
}

// ---- 2-4. Registered archive missing: recreated in place, same owner, no second database ------------
for (const [label, seedRegistry, expectedName] of [
  ["legacy-bound archive (the live shape)", legacyBoundRegistry("acct-a"), LEGACY],
  ["per-account archive", perAccountRegistry("acct-a"), dbName("acct-a")]
]) {
  const hooks = loadBackgroundHooks();
  const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", storageSeed: { archiveAccounts: seedRegistry }, now: NOW });
  const registryBefore = JSON.stringify(env.storage.data.archiveAccounts);

  const status = (await api(hooks, "sync.getState")).status;
  const recreated = env.adapters.get(expectedName);
  const stamp = stampOf(recreated);
  check(stamp?.via === "recreated" && Number.isFinite(Date.parse(stamp.boundAt)), `${label}: a missing registered archive should be stamped recreated: ${JSON.stringify(stamp)}`);
  check(status.archiveRecreatedAt === stamp.boundAt, `${label}: the archive status should report when it was recreated`);
  const events = recreatedEvents(recreated);
  check(events.length === 1 && events[0].status === "warning" && events[0].details.dbName === expectedName && events[0].details.registeredAt === REGISTERED_AT, `${label}: one recreated event should be logged: ${JSON.stringify(events)}`);
  check(/erased/.test(events[0].details.message) && /re-synced/.test(events[0].details.message), `${label}: the event should explain the erase and re-sync`);

  // 3. Still bound to the same account.
  check(stamp.accountKey === key("acct-a") && stamp.accountId === "acct-a" && stamp.boundLegacy === (expectedName === LEGACY), `${label}: the recreated archive should stay bound to its account`);
  check(JSON.stringify(env.storage.data.archiveAccounts) === registryBefore, `${label}: the account binding in the registry changed`);
  check((await env.registry.describe()).accounts.find((account) => account.accountKey === key("acct-a"))?.dbName === expectedName, `${label}: the account should still point at the same database`);

  // 4. No second database.
  check(same([...env.adapters.keys()], [expectedName]) && same([...new Set(env.opened)], [expectedName]), `${label}: only the registered database may be opened: ${JSON.stringify(env.opened)}`);

  // Later opens, including after a restart, neither log again nor lose the notice.
  await api(hooks, "courses.list");
  const restarted = createMemoryAccountEnvironment(hooks, { storage: env.storage, databases: Object.fromEntries(env.adapters), now: NOW });
  check((await api(hooks, "sync.getState")).status.archiveRecreatedAt === stamp.boundAt, `${label}: the recreated notice should survive a restart`);
  check(recreatedEvents(restarted.adapters.get(expectedName)).length === 1 && stampOf(restarted.adapters.get(expectedName)).via === "recreated", `${label}: reopening must not log or restamp again`);
  check(same([...restarted.adapters.keys()], [expectedName]), `${label}: reopening created another database`);

  // Another account still gets its own new database, and the recreated one is untouched.
  const recreatedSnapshot = snapshot(recreated);
  env.storage.data.dashboardProfile = { accountId: "acct-b" };
  await api(hooks, "sync.getState");
  check(stampOf(restarted.adapters.get(dbName("acct-b")))?.via === "created", `${label}: a different account should get its own created database`);
  check(snapshot(restarted.adapters.get(expectedName)) === recreatedSnapshot, `${label}: another account changed the recreated archive`);
}

// ---- 5. A healthy archive is unaffected ----------------------------------------------------------------
{
  const hooks = loadBackgroundHooks();
  const healthy = hooks.createMemoryArchiveAdapter(baselineSeed("acct-a"));
  const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", databases: { [LEGACY]: healthy }, storageSeed: { archiveAccounts: legacyBoundRegistry("acct-a") }, now: NOW });
  const before = snapshot(healthy);
  const registryBefore = JSON.stringify(env.storage.data.archiveAccounts);
  const status = (await api(hooks, "sync.getState")).status;
  await api(hooks, "courses.list");
  check(snapshot(healthy) === before, "opening a healthy archive changed it");
  check(status.archiveRecreatedAt === "" && same(status.counts, { courses: 4, evidence: 3297, entities: 1778, relationships: 6423, syncRuns: 153, syncJobs: 28 }), `a healthy archive should report its counts and no recreate: ${JSON.stringify(status)}`);
  check(JSON.stringify(env.storage.data.archiveAccounts) === registryBefore && same([...env.adapters.keys()], [LEGACY]), "a healthy archive changed the registry or gained a database");
}

// An existing database without a stamp (a stamp write that failed earlier) is not an erase.
{
  const hooks = loadBackgroundHooks();
  const unstamped = hooks.createMemoryArchiveAdapter({ courses: [{ courseId: "1", title: "Kept", active: true }] });
  const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", databases: { [dbName("acct-a")]: unstamped }, storageSeed: { archiveAccounts: perAccountRegistry("acct-a") }, now: NOW });
  check((await api(hooks, "sync.getState")).status.archiveRecreatedAt === "", "an unstamped existing archive must not report a recreate");
  check(stampOf(unstamped)?.via === "created" && recreatedEvents(unstamped).length === 0 && env.adapters.size === 1, "an unstamped existing archive should be stamped created");
}

// When the browser can't list databases, nothing is assumed: the old behavior stays.
{
  const hooks = loadBackgroundHooks();
  const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", storageSeed: { archiveAccounts: perAccountRegistry("acct-a") }, listDatabases: async () => { throw new Error("listing broke"); }, now: NOW });
  check((await api(hooks, "sync.getState")).status.archiveRecreatedAt === "", "a failed listing must not report a recreate");
  check(stampOf(env.adapters.get(dbName("acct-a")))?.via === "created", "a failed listing should keep the created stamp");
}

// Quarantine and adoption still work as before.
{
  const hooks = loadBackgroundHooks();
  const legacy = hooks.createMemoryArchiveAdapter({ courses: [{ courseId: "1", title: "Old course", active: true }] });
  const env = createMemoryAccountEnvironment(hooks, { databases: { [LEGACY]: legacy }, storageSeed: { dashboardProfile: { accountId: "acct-a" } }, now: NOW });
  check((await api(hooks, "system.getAccountContext")).canAdoptLegacy === true, "a quarantined archive should still be offered");
  check((await api(hooks, "sync.getState")).status.archiveRecreatedAt === "", "a new account beside a quarantined archive must not report a recreate");
  check(stampOf(env.adapters.get(dbName("acct-a")))?.via === "created", "a new account beside a quarantined archive should be stamped created");
  check((await env.registry.adoptLegacyForActive("acct-a")).adopted === true && stampOf(legacy)?.via === "adopted", "adoption should still stamp the older archive adopted");
  check((await api(hooks, "sync.getState")).status.archiveRecreatedAt === "" && recreatedEvents(legacy).length === 0, "an adopted archive must not report a recreate");
}

// ---- Dashboard notice ------------------------------------------------------------------------------------
{
  const dash = loadDashboard();
  const notice = dash.archiveRecreatedNotice({ at: "2026-10-05T18:18:36.093Z" });
  check(/data-archive-recreated/.test(notice) && /role="status"/.test(notice) && /data-action="dismiss-recreated"/.test(notice), "the notice should be a dismissable status banner");
  check(/Oct 5/.test(notice) && /erased/i.test(notice) && /synced again/.test(notice), `the notice should say when the archive was erased and that it is re-syncing: ${notice}`);
  const odd = dash.archiveRecreatedNotice({ at: "<i>x" });
  check(!odd.includes("<i>") && !/ on /.test(odd), "an unreadable date must not be shown or injected");
  check(dash.dashboardPage({ hasArchive: false }, notice).includes("data-archive-recreated"), "the empty first-run page should show the notice");
}

console.log("Archive recreation tests passed.");
