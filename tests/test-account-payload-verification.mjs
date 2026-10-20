import { loadBackgroundHooks, createMemoryAccountEnvironment } from "./test-production-loader.mjs";

const fail = (message) => { throw new Error(message); };
const check = (value, message) => { if (!value) fail(message); };
const SITE = "https://kennesaw.view.usg.edu";
const LEGACY = "d2l-student-archive";
const dbA = `${LEGACY}--${encodeURIComponent(SITE)}--acct-a`;
const NOW = () => new Date().toISOString();

// What the collecting tab reports for the pass, and what the tab's whoami says when the drain starts.
let reported = { startId: "acct-a", endId: "acct-a" };
let omitAccount = false;
let title = "First notice";
const collects = [];
const hooks = loadBackgroundHooks({
  chrome: {
    tabs: {
      query: async () => [{ id: 9, url: `${SITE}/d2l/home`, discarded: false, active: true, lastAccessed: 1 }],
      sendMessage: async (tabId, message) => {
        if (message.type === "D2L_PING") return { ok: true };
        if (message.type === "D2L_WHOAMI") return { ok: true, accountId: "acct-a" };
        collects.push(message.category);
        const payload = {
          orgUnitId: message.orgUnitId,
          apiStatus: { news: 200 },
          items: [
            { source: "courseOffering", title: "Fall 2026 · Test", ids: { courseOrgUnitId: "5001" }, columns: { courseCode: "TEST 1000" } },
            { source: "announcement", title, ids: { courseOrgUnitId: "5001", newsItemId: "82" } }
          ]
        };
        if (!omitAccount) payload.account = { ...reported };
        return { ok: true, payload };
      }
    }
  }
});
const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a" });
const repository = await env.registry.repositoryFor("acct-a");
const adapter = env.adapters.get(dbA);
const jobId = "course-api-acct-a-5001-announcements";

const archiveStores = ["courses", "evidence", "evidenceRevisions", "entities", "relationships", "syncRuns", "changes"];
const archiveSnapshot = () => JSON.stringify(archiveStores.map((name) => [...adapter.data[name].entries()].sort(([a], [b]) => a.localeCompare(b))));
const metaSnapshot = () => JSON.stringify([...adapter.data.meta.entries()].sort(([a], [b]) => a.localeCompare(b)));
const job = async () => (await repository.listSyncJobs({ jobIds: [jobId] }))[0];
const enqueue = () => repository.enqueueSyncJob({ jobId, dedupeKey: "d2l:acct-a:5001:announcements", accountId: "acct-a", courseId: "5001", category: "announcements", correlationId: "visit-1" });
const eligibleNow = () => repository.updateSyncJob(jobId, { nextEligibleAt: new Date(Date.now() - 1000).toISOString() });

// 1. A matching payload is ingested normally.
await enqueue();
let drained = await hooks.drainSyncQueue({ maxJobs: 1 });
check(drained.started && drained.processed === 1, "matching payload run did not process the job");
check((await job()).state === "completed", "matching payload did not complete the job");
const stored = await repository.listEvidence({ courseId: "5001", limit: 50 });
check(stored.items.some((item) => item.title === "First notice"), "matching payload was not ingested");
check((await repository.getFreshness("course:acct-a:5001:api")).categories.announcements.status === "fresh", "matching payload did not set freshness");

// 2. Every kind of mismatch is discarded completely and explained.
const rejections = [
  ["account-mismatch", { startId: "acct-b", endId: "acct-b" }, false],
  ["account-changed-during-collection", { startId: "acct-a", endId: "acct-b" }, false],
  ["account-unverified", { startId: "", endId: "" }, false],
  ["account-unverified", null, true]
];
title = "Rejected replacement";
for (const [reason, account, omit] of rejections) {
  await enqueue();
  reported = account || reported;
  omitAccount = omit;
  const revisionBefore = await repository.getMeta("databaseRevision");
  const archiveBefore = archiveSnapshot();
  const metaBefore = metaSnapshot();
  const activityBefore = adapter.data.activity.size;
  const runsBefore = adapter.data.syncRuns.size;
  const namesBefore = [...env.adapters.keys()].sort().join();
  drained = await hooks.drainSyncQueue({ maxJobs: 1 });
  check(drained.started && drained.processed === 1, `${reason}: job was not attempted`);
  check(archiveSnapshot() === archiveBefore, `${reason}: archive stores changed (evidence, entities, relationships, runs or changes)`);
  check(metaSnapshot() === metaBefore && await repository.getMeta("databaseRevision") === revisionBefore, `${reason}: freshness or database revision changed`);
  check(adapter.data.syncRuns.size === runsBefore, `${reason}: a sync run was written`);
  check((await repository.listEvidence({ courseId: "5001", limit: 50 })).items.every((item) => item.title !== "Rejected replacement"), `${reason}: rejected data reached the archive`);
  const rejected = await job();
  check(rejected.state === "account-changed" && rejected.lastError === reason, `${reason}: job state was ${rejected.state}/${rejected.lastError}`);
  check(Date.parse(rejected.nextEligibleAt) > Date.now(), `${reason}: rejected job is immediately eligible again`);
  check(adapter.data.activity.size === activityBefore + 1, `${reason}: expected exactly one explanatory activity event`);
  const event = (await repository.listActivity({ limit: 50 })).find((entry) => entry.status === "blocked" && entry.details?.reason === reason);
  check(event && event.details.category === "announcements" && event.category === "identity", `${reason}: activity did not explain the rejection`);
  check(!JSON.stringify(event).includes("acct-b") && !JSON.stringify(event).includes("acct-a"), `${reason}: activity exposed a full account id`);
  check([...env.adapters.keys()].sort().join() === namesBefore && !env.adapters.has(`${LEGACY}--${encodeURIComponent(SITE)}--acct-b`), `${reason}: a database was created`);
  // Not claimable until the retry delay passes, then claimable again (account-changed is a retry state).
  check(await repository.claimSyncJob("probe", { accountId: "acct-a" }) === null, `${reason}: rejected job retried immediately`);
  await eligibleNow();
  await repository.updateSyncJob(jobId, { state: "retry-wait" });
}

// A repository bound to a different account refuses the write even when the tab reports the job's account.
reported = { startId: "acct-a", endId: "acct-a" };
omitAccount = false;
const goodStamp = await repository.getMeta("accountBinding");
await repository.setMeta("accountBinding", { ...goodStamp, accountId: "acct-z", accountKey: `${SITE}|acct-z` });
await enqueue();
await eligibleNow();
const archiveBeforeStamp = archiveSnapshot();
await hooks.drainSyncQueue({ maxJobs: 1 });
check((await job()).lastError === "repository-mismatch" && archiveSnapshot() === archiveBeforeStamp, "a repository bound elsewhere accepted the payload");
await repository.setMeta("accountBinding", goodStamp);

// 3. Retrying later with the correct account succeeds.
title = "Corrected notice";
await eligibleNow();
const before = (await job());
check(before.state === "account-changed", "job should still be waiting after the mismatch");
drained = await hooks.drainSyncQueue({ maxJobs: 1 });
const after = await job();
check(drained.processed === 1 && after.state === "completed" && after.lastError === "", `retry with the right account did not complete (${after.state}/${after.lastError})`);
check((await repository.listEvidence({ courseId: "5001", limit: 50 })).items.some((item) => item.title === "Corrected notice"), "retry with the right account did not ingest");

// The queue's own dedupe still treats an account-changed job as pending work.
await repository.updateSyncJob(jobId, { state: "account-changed" });
const dedupe = await repository.enqueueSyncJob({ jobId, dedupeKey: "d2l:acct-a:5001:announcements", accountId: "acct-a", courseId: "5001", category: "announcements" });
check(dedupe.deduplicated === true, "an account-changed job should deduplicate like other pending work");

console.log("Payload account verification: matching data ingests, every mismatch is fully discarded and explained, retry with the right account succeeds.");
