import { loadBackgroundHooks, createMemoryAccountEnvironment, createMemoryStorage } from "./test-production-loader.mjs";

const fail = (message) => { throw new Error(message); };
const check = (value, message) => { if (!value) fail(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SITE = "https://kennesaw.view.usg.edu";
const LEGACY = "d2l-student-archive";
const dbName = (id) => `${LEGACY}--${encodeURIComponent(SITE)}--${id}`;
const NOW = () => "2026-10-03T12:00:00.000Z";

// Session state the fake D2L tab reports.
let tabAccount = "acct-a";
let collectAccount = null;                // account stamped on payloads collected by the tab (null = same as tabAccount)
let omitAccount = false;
const downloads = [];
const sessionStore = {};
const payloadFor = (orgUnitId, accountId, title = "Notice") => {
  const payload = {
    orgUnitId,
    apiStatus: { news: 200, toc: 200, quizzes: 200, dropbox: 200 },
    items: [
      { source: "courseOffering", title: `Fall 2026 · ${accountId} course`, ids: { courseOrgUnitId: orgUnitId }, columns: { courseCode: "TEST 1000" } },
      { source: "announcement", title: `${title} ${accountId}`, ids: { courseOrgUnitId: orgUnitId, newsItemId: "82" } }
    ]
  };
  if (!omitAccount) payload.account = { startId: accountId, endId: accountId };
  return payload;
};

const hooks = loadBackgroundHooks({
  chrome: {
    runtime: { getURL: (file = "") => `chrome-extension://testid/${file}` },
    downloads: {
      download: async (options) => { downloads.push(options.filename); return downloads.length; },
      search: async () => [{ state: "complete", filename: "/Users/x/Downloads/D2L Export/d2l-api-export-test/file" }],
      onChanged: { addListener() {}, removeListener() {} }
    },
    tabs: {
      get: async (tabId) => ({ id: tabId, url: `${SITE}/d2l/home` }),
      query: async () => [],
      sendMessage: async (tabId, message) => {
        if (message.type === "D2L_WHOAMI") return { ok: Boolean(tabAccount), accountId: tabAccount };
        if (message.type === "D2L_CURRENT_COURSES") return { ok: true, payload: [{ orgUnitId: "5001", title: "Fall 2026 · Test" }] };
        if (message.type === "D2L_COLLECT_COURSE_API") return { ok: true, payload: payloadFor(message.orgUnitId, collectAccount ?? tabAccount) };
        if (message.type === "D2L_PROBE_FRAME_CLOSE") return { ok: true };
        return { ok: false, error: "unexpected message" };
      },
      update: async () => ({}),
      remove: async () => {}
    },
    storage: { session: { get: async (key) => (typeof key === "string" ? { [key]: sessionStore[key] } : { ...sessionStore }), set: async (values) => Object.assign(sessionStore, values) } }
  }
});
const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", now: NOW });
// The extension's own local storage is the registry's storage; the export summary and probe cache keys live there.
const chromeLocal = env.storage;

const repositoryA = await env.registry.repositoryFor("acct-a");
const adapterA = env.adapters.get(dbName("acct-a"));
const archiveStores = ["courses", "evidence", "evidenceRevisions", "entities", "relationships", "syncRuns", "changes"];
const snap = (adapter) => JSON.stringify(archiveStores.map((name) => [...adapter.data[name].entries()].sort(([a], [b]) => a.localeCompare(b))));
const titlesIn = async (repository) => (await repository.listEvidence({ limit: 200 })).items.map((item) => item.title);
const exportKeys = () => Object.keys(chromeLocal.data).filter((key) => /^d2l(LastExportSummary|ProbeSignatures)/.test(key)).sort();


const exportApi = (payloads, options = {}) => hooks.downloadApiOnlyExport(payloads, {}, { reuseArchivedFiles: false, ...options }, null);
const rejects = async (promise) => { try { await promise; return null; } catch (error) { return error; } };

// 1. A matching export ingests into that account's archive and keeps its summary under its own key.
await exportApi([payloadFor("5001", "acct-a")], { expectedAccountId: "acct-a", deltaProbes: true });
check((await titlesIn(repositoryA)).includes("Notice acct-a"), "a matching export was not ingested");
check(same(exportKeys(), ["d2lLastExportSummary:acct-a", "d2lProbeSignatures:acct-a"]), `export state keys: ${exportKeys()}`);
check(!("d2lLastExportSummary" in chromeLocal.data) && !("d2lProbeSignatures" in chromeLocal.data), "export wrote a global (unscoped) summary or probe cache");
check(env.adapters.size === 1, "a matching export created another database");
const summaryA = JSON.stringify(chromeLocal.data["d2lLastExportSummary:acct-a"]);

// 2. Rejected exports mutate nothing at all.
async function expectRejected(label, payloads, options, reason) {
  const archiveBefore = snap(adapterA);
  const activityBefore = adapterA.data.activity.size;
  const metaBefore = JSON.stringify([...adapterA.data.meta.entries()]);
  const localBefore = JSON.stringify(chromeLocal.data);
  const downloadsBefore = downloads.length;
  const error = await rejects(exportApi(payloads, options));
  check(error?.code === "ACCOUNT_VERIFICATION_FAILED" && error.reason === reason, `${label}: expected ${reason}, got ${error?.code}/${error?.reason}/${error?.message}`);
  check(snap(adapterA) === archiveBefore && adapterA.data.activity.size === activityBefore && JSON.stringify([...adapterA.data.meta.entries()]) === metaBefore, `${label}: the archive changed`);
  check(JSON.stringify(chromeLocal.data) === localBefore, `${label}: local state (summary, probe cache) changed`);
  check(downloads.length === downloadsBefore, `${label}: files were written`);
  check(env.adapters.size === 1 && !env.adapters.has(dbName("acct-b")), `${label}: a database was created`);
}
await expectRejected("B payload while A is expected", [payloadFor("5001", "acct-b", "Intruder")], { expectedAccountId: "acct-a", deltaProbes: true }, "account-mismatch");
await expectRejected("payload without account", [{ ...payloadFor("5001", "acct-a", "Unverified"), account: undefined }], { expectedAccountId: "acct-a" }, "account-unverified");
await expectRejected("account changed during collection", [{ ...payloadFor("5001", "acct-a", "Moved"), account: { startId: "acct-a", endId: "acct-b" } }], { expectedAccountId: "acct-a" }, "account-changed-during-collection");
await expectRejected("mixed sessions in one export", [payloadFor("5001", "acct-a"), payloadFor("5002", "acct-b", "Mixed")], {}, "account-mismatch");
check(!(await titlesIn(repositoryA)).some((title) => /Intruder|Unverified|Moved|Mixed/.test(title)), "rejected data reached account A");

// 3. The destination is the verified account, never the dashboard profile: B's payload goes to B even though the profile says A.
check(env.storage.data.dashboardProfile.accountId === "acct-a", "setup: the profile should still say account A");
const archiveABefore = snap(adapterA);
await exportApi([payloadFor("5001", "acct-b", "Real")], { deltaProbes: true });
const repositoryB = await env.registry.repositoryFor("acct-b");
check((await titlesIn(repositoryB)).includes("Real acct-b") && !(await titlesIn(repositoryA)).some((title) => title.includes("acct-b")), "export for B did not land only in B");
check(snap(adapterA) === archiveABefore, "an export for B mutated account A's archive");
check(JSON.stringify(chromeLocal.data["d2lLastExportSummary:acct-a"]) === summaryA, "an export for B changed account A's export summary");
check(same(exportKeys(), ["d2lLastExportSummary:acct-a", "d2lLastExportSummary:acct-b", "d2lProbeSignatures:acct-a", "d2lProbeSignatures:acct-b"]), `export state keys after B: ${exportKeys()}`);

// 4. Export summary and probe cache stay isolated, and legacy global values only reach the legacy owner.
{
  const legacyHooks = loadBackgroundHooks();
  const seededStorage = createMemoryStorage({ d2lLastExportSummary: { legacy: true }, d2lProbeSignatures: { sig: "legacy" } });
  const legacyEnv = createMemoryAccountEnvironment(legacyHooks, {
    storage: seededStorage,
    databases: { [LEGACY]: legacyHooks.createMemoryArchiveAdapter({ syncJobs: [{ jobId: "j1", accountId: "acct-a" }] }) }
  });
  check(same(await legacyHooks.readAccountScoped("d2lLastExportSummary", "acct-a"), { legacy: true }), "the legacy owner lost its previous export summary");
  check(await legacyHooks.readAccountScoped("d2lLastExportSummary", "acct-b") === undefined && await legacyHooks.readAccountScoped("d2lProbeSignatures", "acct-b") === undefined, "another account inherited the legacy export summary or probe cache");
  await legacyHooks.writeAccountScoped("d2lProbeSignatures", "acct-b", { sig: "b" });
  check(same(await legacyHooks.readAccountScoped("d2lProbeSignatures", "acct-a"), { sig: "legacy" }) && same(await legacyHooks.readAccountScoped("d2lProbeSignatures", "acct-b"), { sig: "b" }), "probe caches leaked between accounts");
  check(same(seededStorage.data.d2lLastExportSummary, { legacy: true }), "the legacy export summary was modified");
  await rejects(legacyHooks.writeAccountScoped("d2lProbeSignatures", "", {}));
  check(!("d2lProbeSignatures:" in seededStorage.data), "a probe cache was written with no account");
  void legacyEnv;
}

// 5. Same-tab sync verifies the tab's own account, and its payloads must agree.
const sender = { tab: { id: 7, url: `${SITE}/d2l/home/5001` }, frameId: 0, url: `${SITE}/d2l/home/5001` };
let runCounter = 0;
const syncMessage = () => ({ devToken: "d2l-local-dev-8f6c2a1e", courseIds: ["5001"], runId: `run-test-${String(++runCounter).padStart(4, "0")}` });
tabAccount = "acct-a";
collectAccount = null;
let state = await hooks.runSameTabSync(syncMessage(), sender);
check(state.complete === true && state.error === "", `a matching same-tab sync should finish (${state.error})`);
check((await titlesIn(repositoryA)).includes("Notice acct-a"), "a matching same-tab sync did not ingest");

// The tab says A at the start, but the data was collected under B.
for (const key of Object.keys(sessionStore)) delete sessionStore[key];
collectAccount = "acct-b";
const archiveBeforeSync = snap(adapterA);
const activityBeforeSync = adapterA.data.activity.size;
const localBeforeSync = JSON.stringify(chromeLocal.data);
const syncRepositoryBSnapshot = snap(env.adapters.get(dbName("acct-b")));
state = await hooks.runSameTabSync(syncMessage(), sender);
check(state.complete !== true && /account-mismatch/.test(state.error), `a mismatched same-tab sync should fail with account-mismatch (${state.complete}/${state.error})`);
check(snap(adapterA) === archiveBeforeSync && adapterA.data.activity.size === activityBeforeSync, "a mismatched same-tab sync mutated account A");
check(snap(env.adapters.get(dbName("acct-b"))) === syncRepositoryBSnapshot, "a mismatched same-tab sync wrote into account B");
check(JSON.stringify(chromeLocal.data) === localBeforeSync, "a mismatched same-tab sync changed local state");

// The tab cannot say who it is.
for (const key of Object.keys(sessionStore)) delete sessionStore[key];
tabAccount = "";
collectAccount = null;
state = await hooks.runSameTabSync(syncMessage(), sender);
check(state.complete !== true && /account-unverified/.test(state.error) && snap(adapterA) === archiveBeforeSync, "an unverifiable same-tab sync must write nothing");

// Retrying with the correct account works again.
for (const key of Object.keys(sessionStore)) delete sessionStore[key];
tabAccount = "acct-a";
state = await hooks.runSameTabSync(syncMessage(), sender);
check(state.complete === true, `retry with the right account should succeed (${state.error})`);
check(env.adapters.size === 2, `unexpected databases: ${[...env.adapters.keys()]}`);

console.log("Export and same-tab sync verify the collecting account, scope their local state per account, and reject mismatches without mutation.");
