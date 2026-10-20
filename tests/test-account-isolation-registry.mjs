import fs from "node:fs";
import path from "node:path";
import { loadBackgroundHooks, createMemoryAccountEnvironment, createMemoryStorage } from "./test-production-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/semantic-organizer-v1.json"), "utf8"));
const fail = (message) => { throw new Error(message); };
const check = (value, message) => { if (!value) fail(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const LEGACY = "d2l-student-archive";
const SITE = "https://kennesaw.view.usg.edu";
const dbA = `${LEGACY}--${encodeURIComponent(SITE)}--acct-a`;
const dbB = `${LEGACY}--${encodeURIComponent(SITE)}--acct-b`;
const NOW = () => "2026-10-03T12:00:00.000Z";

async function snapshot(adapter) {
  const out = {};
  for (const name of Object.keys(adapter.data)) out[name] = [...adapter.data[name].entries()].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(out);
}

function request(hooks, method, params = {}) {
  return hooks.handleAppApiRequest({ type: "D2L_APP_API_REQUEST", protocolVersion: "1", requestId: `${method}-r`, method, params });
}

const rowsA = fixture.rows;
const rowsB = fixture.rows.map((row) => ({ ...row, title: `B-only ${row.title}`, courseTitle: "Account B Course" }));

// ---- 1-5: two accounts, same course id, isolated reads/writes/activity -----
{
  const hooks = loadBackgroundHooks();
  const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", now: NOW });
  await hooks.ingestAndOrganizeRows(rowsA, { syncRunId: "run-a", ingestedAt: NOW() });
  const repositoryA = await env.registry.repositoryFor("acct-a");
  const snapshotA = await snapshot(env.adapters.get(dbA));
  const coursesA = (await request(hooks, "courses.list")).data.items;
  check(coursesA.length === 1 && coursesA[0].courseId === "900001" && coursesA[0].title === "Synthetic Art Course", "account A should see its own course");
  const evidenceIdsA = (await repositoryA.listEvidence({ limit: 500 })).items.map((item) => item.evidenceId).sort();

  env.storage.data.dashboardProfile = { accountId: "acct-b" };
  check((await request(hooks, "courses.list")).data.items.length === 0, "account B must not see account A's course before its own sync");
  check((await request(hooks, "evidence.list", { limit: 500 })).data.total === 0, "account B evidence read returned account A evidence");
  check((await request(hooks, "search.query", { query: "Project 2" })).data.entities.length === 0, "search for account B returned account A data");

  await hooks.ingestAndOrganizeRows(rowsB, { syncRunId: "run-b", ingestedAt: NOW(), completeCourseSnapshot: true });
  const repositoryB = await env.registry.repositoryFor("acct-b");
  const evidenceIdsB = (await repositoryB.listEvidence({ limit: 500 })).items.map((item) => item.evidenceId).sort();
  check(same(evidenceIdsA, evidenceIdsB) && evidenceIdsA.length > 0, "the fixture should produce identical evidence ids in both accounts");
  check((await request(hooks, "courses.list")).data.items[0].title === "Account B Course", "account B should see its own course title");
  check(await snapshot(env.adapters.get(dbA)) === snapshotA, "writes for account B (complete course snapshot) mutated account A");
  const entityIdsB = (await request(hooks, "entities.list")).data.items.map((entity) => entity.entityId);
  const entityIdsA = (await repositoryA.listEntities({})).map((entity) => entity.entityId);
  check(entityIdsA.length > 0 && same([...entityIdsA].sort(), [...entityIdsB].sort()), "entity ids should match across accounts without colliding");
  check((await repositoryA.listEntities({})).every((entity) => !/B-only/.test(JSON.stringify(entity))), "account B titles leaked into account A entities");
  check((await request(hooks, "search.query", { query: "B-only" })).data.entities.length > 0, "account B search should find its own data");

  // Activity: per account, and the 1000-event cap is per account.
  await repositoryB.recordActivity({ operation: "sync.progress", category: "sync", status: "completed" });
  for (let index = 0; index < 1005; index += 1) {
    await repositoryA.recordActivity({ timestamp: `2026-10-03T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`, operation: "sync.progress", category: "sync", status: "completed" });
  }
  check((await repositoryB.listActivity({ limit: 500 })).length === 1, "account A activity leaked into account B");
  check(env.adapters.get(dbA).data.activity.size === 1000 && env.adapters.get(dbB).data.activity.size === 1, "activity retention must be counted per account");

  // Switching back restores A exactly.
  env.storage.data.dashboardProfile = { accountId: "acct-a" };
  const after = (await request(hooks, "courses.list")).data.items;
  check(after[0].title === "Synthetic Art Course", "switching back to account A did not restore its data");
  check(env.adapters.size === 2 && env.adapters.has(dbA) && env.adapters.has(dbB), `unexpected databases: ${[...env.adapters.keys()]}`);
}

// ---- 9: no safe active account fails closed ---------------------------------
{
  const hooks = loadBackgroundHooks();
  const env = createMemoryAccountEnvironment(hooks, { databases: { [dbA]: hooks.createMemoryArchiveAdapter() } });
  const before = [...env.adapters.keys()];
  const response = await request(hooks, "courses.list");
  check(response.ok === false && response.error.code === "ACCOUNT_UNKNOWN", "a read without a known account must fail closed");
  let threw = false;
  await hooks.ingestAndOrganizeRows(rowsA, { syncRunId: "x", ingestedAt: NOW() }).catch((error) => { threw = error.code === "ACCOUNT_UNKNOWN"; });
  check(threw, "an ingest without a known account must fail closed");
  const outcomes = await hooks.enqueuePriorityRefresh(["5001"], { accountId: "" });
  check(outcomes.every((outcome) => outcome.queued === false), "queueing without an account must not queue");
  env.storage.data.dashboardProfile = { accountId: "bad id|x" };
  check((await request(hooks, "courses.list")).ok === false, "an unusable account id must fail closed");
  check(env.opened.length === 0 && same(before, [...env.adapters.keys()]), "failing closed must not open or create any database");

  const unlisted = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", listDatabases: async () => { throw new Error("no listing"); } });
  const blocked = await request(hooks, "courses.list");
  check(blocked.ok === false && blocked.error.code === "ACCOUNT_QUARANTINED" && unlisted.opened.length === 0, "an unlistable database set must fail closed without opening anything");
}

// ---- 11: registry first-writer-wins and survives a restart -------------------
{
  const hooks = loadBackgroundHooks();
  const env = createMemoryAccountEnvironment(hooks, { configure: false });
  await env.registry.repositoryFor("acct-a");
  const stored = JSON.parse(JSON.stringify(env.storage.data.archiveAccounts));
  const key = `${SITE}|acct-a`;
  check(stored.accounts[key].dbName === dbA, "new account should get its own database name");
  env.storage.data.archiveAccounts.accounts[key].dbName = "tampered";
  const restarted = createMemoryAccountEnvironment(hooks, { storage: env.storage, databases: Object.fromEntries(env.adapters), configure: false });
  const description = await restarted.registry.describe();
  check(description.accounts.find((entry) => entry.accountKey === key).dbName === "tampered", "a restart must trust the stored entry, not re-derive it");
  env.storage.data.archiveAccounts.accounts[key].dbName = dbA;
  await restarted.registry.repositoryFor("acct-a");
  check(env.storage.data.archiveAccounts.accounts[key].dbName === dbA, "an existing registry entry was overwritten");
}

// ---- Legacy binding: preserved in place, bound by provenance -----------------
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
      { key: `freshness:course:${accountId}:9900001:api`, value: { status: "fresh" } }
    ]
  };
}

{
  const hooks = loadBackgroundHooks();
  const legacyAdapter = hooks.createMemoryArchiveAdapter(baselineSeed("TestAcct1"));
  const before = JSON.parse(await snapshot(legacyAdapter));
  const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "TestAcct1", databases: { [LEGACY]: legacyAdapter }, now: NOW });
  const status = (await request(hooks, "system.getDatabaseStatus")).data;
  check(same(status.counts, { courses: 4, evidence: 3297, entities: 1778, relationships: 6423, syncRuns: 153, syncJobs: 28 }), `legacy archive counts changed after binding: ${JSON.stringify(status.counts)}`);
  check(status.databaseName === LEGACY, "the legacy archive must keep its own database");
  const after = JSON.parse(await snapshot(legacyAdapter));
  for (const name of Object.keys(before)) {
    if (name === "meta") continue;
    check(same(before[name], after[name]), `store ${name} was rewritten by binding`);
  }
  check(before.meta.every(([key, value]) => same(after.meta.find(([k]) => k === key)?.[1], value)), "existing meta records changed");
  check(after.meta.length === before.meta.length + 1 && after.meta.some(([key]) => key === "accountBinding"), "binding should add exactly one stamp record");
  check(same([...env.adapters.keys()], [LEGACY]) && same(env.opened.filter((name) => name !== LEGACY), []), "binding the existing account created a second database");
  const description = await env.registry.describe();
  check(description.legacy.state === "bound" && description.legacy.accountKey === `${SITE}|TestAcct1` && description.accounts.length === 1 && description.accounts[0].boundLegacy, "legacy was not bound to its owner");

  // Another account never reaches the legacy archive.
  env.storage.data.dashboardProfile = { accountId: "other" };
  check((await request(hooks, "courses.list")).data.items.length === 0, "a different account saw the legacy archive");
  check(env.adapters.has(`${LEGACY}--${encodeURIComponent(SITE)}--other`), "a different account should get its own database");
  check(same(JSON.parse(await snapshot(legacyAdapter)), after), "another account's visit modified the legacy archive");
}

{
  // No account-keyed records: bind only when profile and checklist owner agree.
  const hooks = loadBackgroundHooks();
  const seed = { courses: [{ courseId: "1", title: "C", active: true }] };
  const agree = createMemoryAccountEnvironment(hooks, { configure: false, databases: { [LEGACY]: hooks.createMemoryArchiveAdapter(seed) }, storageSeed: { dashboardProfile: { accountId: "acct-a" }, dashboardChecklistOwner: "acct-a" } });
  check((await agree.registry.describe()).legacy.state === "bound", "profile and checklist owner agreeing should bind the legacy archive");
  const disagree = createMemoryAccountEnvironment(hooks, { configure: false, databases: { [LEGACY]: hooks.createMemoryArchiveAdapter(seed) }, storageSeed: { dashboardProfile: { accountId: "acct-a" }, dashboardChecklistOwner: "acct-b" } });
  const quarantine = await disagree.registry.describe();
  check(quarantine.legacy.state === "quarantined" && quarantine.legacy.reason === "no-provenance", "disagreeing hints should quarantine");

  // Two accounts' records: quarantine, nothing guessed, legacy untouched.
  const mixed = hooks.createMemoryArchiveAdapter({ syncJobs: [{ jobId: "j1", accountId: "acct-a" }, { jobId: "j2", accountId: "acct-b" }], courses: [{ courseId: "1", title: "Mixed", active: true }] });
  const mixedBefore = await snapshot(mixed);
  const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", databases: { [LEGACY]: mixed } });
  const description = await env.registry.describe();
  check(description.legacy.state === "quarantined" && description.legacy.reason === "multiple-accounts" && description.legacy.candidates.length === 2, "two accounts in the legacy archive must quarantine");
  check((await request(hooks, "courses.list")).data.items.length === 0, "a quarantined legacy archive must not be readable");
  check(await snapshot(mixed) === mixedBefore, "quarantine modified the legacy archive");
  check(env.adapters.has(dbA), "the active account should get a fresh database next to the quarantined one");

  // An account may never be pointed at the legacy database unless it is the bound owner.
  const forced = createMemoryAccountEnvironment(hooks, { configure: false, databases: { [LEGACY]: mixed }, storageSeed: { archiveAccounts: { version: 1, legacy: { state: "quarantined", reason: "multiple-accounts", candidates: ["acct-a", "acct-b"] }, accounts: { [`${SITE}|acct-x`]: { dbName: LEGACY } } } } });
  let refused = "";
  await forced.registry.repositoryFor("acct-x").catch((error) => { refused = error.code; });
  check(refused === "ACCOUNT_QUARANTINED", "a quarantined legacy database must not be handed to any account");
}

{
  // A database stamped for a different account is refused.
  const hooks = loadBackgroundHooks();
  const wrong = hooks.createMemoryArchiveAdapter({ meta: [{ key: "accountBinding", value: { accountKey: `${SITE}|acct-a` } }] });
  const env = createMemoryAccountEnvironment(hooks, { configure: false, databases: { [dbB]: wrong } });
  let refused = "";
  await env.registry.repositoryFor("acct-b").catch((error) => { refused = error.code; });
  check(refused === "ACCOUNT_DB_MISMATCH", "a database stamped for another account must be refused");
}

// ---- Loss of the registry: databases are rediscovered, none duplicated --------
{
  const hooks = loadBackgroundHooks();
  const legacyAdapter = hooks.createMemoryArchiveAdapter(baselineSeed("acct-a"));
  const first = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", databases: { [LEGACY]: legacyAdapter }, now: NOW });
  const repositoryB = await first.registry.repositoryFor("acct-b");
  await repositoryB.ingestRows(rowsB, { syncRunId: "run-b", ingestedAt: NOW() });
  const namesBefore = [...first.adapters.keys()].sort();
  const snapshots = Object.fromEntries(await Promise.all([...first.adapters].map(async ([name, adapter]) => [name, await snapshot(adapter)])));

  // Registry wiped, profile wiped too: only the databases themselves remain.
  const lost = createMemoryAccountEnvironment(hooks, { databases: Object.fromEntries(first.adapters), configure: false, now: NOW });
  const repositoryA2 = await lost.registry.repositoryFor("acct-a");
  const repositoryB2 = await lost.registry.repositoryFor("acct-b");
  check((await repositoryA2.getDatabaseStatus()).counts.evidence === 3297, "account A lost access to its archive after registry loss");
  check((await repositoryB2.listEvidence({ limit: 500 })).total > 0, "account B lost access to its archive after registry loss");
  check(same([...lost.adapters.keys()].sort(), namesBefore), `registry loss created or removed a database: ${[...lost.adapters.keys()]}`);
  const rebuilt = await lost.registry.describe();
  check(rebuilt.accounts.length === 2 && rebuilt.accounts.some((entry) => entry.accountKey === `${SITE}|acct-a` && entry.dbName === LEGACY && entry.boundLegacy), "legacy owner was not rebound after registry loss");
  check(rebuilt.accounts.some((entry) => entry.accountKey === `${SITE}|acct-b` && entry.recovered), "account B database was not rediscovered");
  for (const [name, adapter] of lost.adapters) {
    const now = JSON.parse(await snapshot(adapter));
    const was = JSON.parse(snapshots[name]);
    for (const store of Object.keys(was)) if (store !== "meta") check(same(was[store], now[store]), `${name}.${store} changed during recovery`);
  }

  // The stamp inside the legacy database is gone too: provenance rebuilds the same answer.
  legacyAdapter.data.meta.delete("accountBinding");
  const noStamp = createMemoryAccountEnvironment(hooks, { databases: Object.fromEntries(first.adapters), configure: false });
  const description = await noStamp.registry.describe();
  check(description.legacy.state === "bound" && description.legacy.accountKey === `${SITE}|acct-a`, "provenance did not rebind the legacy archive");

  // A stray duplicate for the legacy owner never displaces the legacy archive.
  const withStray = createMemoryAccountEnvironment(hooks, { databases: { ...Object.fromEntries(first.adapters), [dbA]: hooks.createMemoryArchiveAdapter() }, configure: false });
  const strayRepository = await withStray.registry.repositoryFor("acct-a");
  check((await strayRepository.getDatabaseStatus()).counts.evidence === 3297, "a stray empty database displaced the legacy archive");
  check((await withStray.registry.describe()).orphans.includes(dbA), "the stray database should be reported, not used or deleted");
  check(withStray.adapters.has(dbA), "the stray database must not be deleted");
}

// ---- Sync queue: which repository is drained -------------------------------------
{
  const hooks = loadBackgroundHooks();
  let verified = { ok: true, accountId: "acct-b" };
  let tabs = [{ id: 9, url: `${SITE}/d2l/home`, discarded: false, active: true, lastAccessed: 1 }];
  const collected = [];
  const queueHooks = loadBackgroundHooks({
    chrome: {
      tabs: {
        query: async () => tabs,
        sendMessage: async (tabId, message) => {
          if (message.type === "D2L_PING") return { ok: true };
          if (message.type === "D2L_WHOAMI") return verified;
          collected.push(message.orgUnitId);
          return { ok: true, payload: { orgUnitId: message.orgUnitId, account: { startId: verified.accountId, endId: verified.accountId }, apiStatus: { news: 200 }, items: [{ source: "courseOffering", title: "Fall 2026 · Q", ids: { courseOrgUnitId: message.orgUnitId }, columns: { courseCode: "Q 1" } }] } };
        }
      }
    }
  });
  // Profile says acct-a (stale: last page load), the live tab says acct-b.
  // The production queue schedules with the wall clock. Keep this repository on
  // that same clock so due-time comparisons test account routing, not clock skew.
  const env = createMemoryAccountEnvironment(queueHooks, { activeAccountId: "acct-a" });
  const repositoryA = await env.registry.repositoryFor("acct-a");
  const repositoryB = await env.registry.repositoryFor("acct-b");
  await queueHooks.enqueuePriorityRefresh(["5001"], { accountId: "acct-a", force: true, correlationId: "a" });
  await queueHooks.enqueuePriorityRefresh(["6001"], { accountId: "acct-b", force: true, correlationId: "b" });
  check((await repositoryA.listSyncJobs({})).every((job) => job.accountId === "acct-a") && (await repositoryB.listSyncJobs({})).every((job) => job.accountId === "acct-b"), "jobs were queued into the wrong account database");

  const drained = await queueHooks.drainSyncQueue({ maxJobs: 1 });
  check(drained.started && drained.processed === 1, "the verified account's queue should drain");
  check(collected.every((id) => id === "6001"), `the worker used the stale dashboard profile instead of the verified account (${collected})`);
  check((await repositoryA.listSyncJobs({})).every((job) => job.state === "queued"), "the other account's queue was touched");
  check((await repositoryA.listEvidence({ limit: 10 })).total === 0 && (await repositoryB.listEvidence({ limit: 10 })).total > 0, "collected data landed in the wrong account");

  // The live tab cannot verify an account: nothing is drained, nothing is opened.
  verified = { ok: false, accountId: "" };
  env.opened.length = 0;
  const unverified = await queueHooks.drainSyncQueue({ maxJobs: 1 });
  check(unverified.started === false && unverified.reason === "account-identity-unavailable" && env.opened.length === 0, "an unverified tab must not drain any queue");
  // No D2L tab: also nothing.
  tabs = [];
  const noTab = await queueHooks.drainSyncQueue({ maxJobs: 1 });
  check(noTab.started === false && noTab.reason === "no-open-d2l-tab" && env.opened.length === 0, "no tab must not open a database");
  // A verified account that is brand new gets an empty queue in its own database, not another account's.
  tabs = [{ id: 9, url: `${SITE}/d2l/home`, discarded: false, active: true, lastAccessed: 1 }];
  verified = { ok: true, accountId: "acct-c" };
  const empty = await queueHooks.drainSyncQueue({ maxJobs: 1 });
  check(empty.started && empty.processed === 0 && env.adapters.has(`${LEGACY}--${encodeURIComponent(SITE)}--acct-c`), "a new verified account should drain its own empty queue");
}

console.log("Account registry: per-account databases, legacy binding in place, fail-closed resolution, registry recovery, and verified-account queue draining passed.");
