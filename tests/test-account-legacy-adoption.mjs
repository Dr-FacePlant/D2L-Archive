import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { loadBackgroundHooks, createMemoryAccountEnvironment, createMemoryStorage } from "./test-production-loader.mjs";
import { loadDashboard } from "./test-dashboard-loader.mjs";

// Phase 5: a quarantined older archive is adopted only by the user's confirmed
// choice, in place, without copying or deleting anything.
const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const fail = (message) => { throw new Error(message); };
const check = (value, message) => { if (!value) fail(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const LEGACY = "d2l-student-archive";
const SITE = "https://kennesaw.view.usg.edu";
const dbName = (id) => `${LEGACY}--${encodeURIComponent(SITE)}--${id}`;
const NOW = () => "2026-10-06T12:00:00.000Z";
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/semantic-organizer-v1.json"), "utf8"));

function rows(adapter) {
  const out = {};
  for (const name of Object.keys(adapter.data)) out[name] = [...adapter.data[name].entries()].sort(([a], [b]) => a.localeCompare(b));
  return out;
}
const snapshot = (adapter) => JSON.stringify(rows(adapter));
// Everything except the binding stamp, which adoption is allowed to write.
function withoutStamp(adapter) {
  const out = rows(adapter);
  if (out.meta) out.meta = out.meta.filter(([key]) => key !== "accountBinding");
  return JSON.stringify(out);
}

async function api(hooks, method, params = {}) {
  const response = await hooks.handleAppApiRequest({ type: "D2L_APP_API_REQUEST", protocolVersion: "1", requestId: `r-${method}`, method, params });
  if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code });
  return response.data;
}

async function refusal(promise) {
  try {
    await promise;
    return "";
  } catch (error) {
    return error.code || error.message;
  }
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
    meta: [{ key: "databaseRevision", value: 153 }, { key: `freshness:course:${accountId}:9900001:api`, value: { status: "fresh" } }]
  };
}

// ---- No provenance: offered to the signed-in account, adopted in place ----------------------------
{
  const hooks = loadBackgroundHooks();
  const legacy = hooks.createMemoryArchiveAdapter({ courses: [{ courseId: "1", title: "Old course", active: true }], evidence: [{ evidenceId: "1:assignment:a", courseId: "1", source: "assignment", revision: 1 }] });
  const env = createMemoryAccountEnvironment(hooks, { databases: { [LEGACY]: legacy }, storageSeed: { dashboardProfile: { accountId: "acct-a" }, dashboardChecklistOwner: "acct-b" }, now: NOW });
  const legacyBefore = snapshot(legacy);

  const context = await api(hooks, "system.getAccountContext");
  check(context.canAdoptLegacy === true && context.legacyOwnerAccountId === "", "a quarantined archive with no provenance should be offered to the signed-in account");
  check((await api(hooks, "courses.list")).items.length === 0, "the quarantined archive must stay unreadable before adoption");
  // A sync during quarantine fills the account's own new database.
  await hooks.ingestAndOrganizeRows(fixture.rows, { syncRunId: "run-new", ingestedAt: NOW() });
  const freshBefore = snapshot(env.adapters.get(dbName("acct-a")));
  const registryBefore = JSON.stringify(env.storage.data.archiveAccounts);

  // The prompt was shown for another account: refused, nothing changes.
  check(await refusal(env.registry.adoptLegacyForActive("acct-b")) === "ACCOUNT_CHANGED", "adoption for an account that is no longer signed in must be refused");
  check(await refusal(env.registry.adoptLegacyForActive("")) === "ACCOUNT_CHANGED", "adoption without an account must be refused");
  check(JSON.stringify(env.storage.data.archiveAccounts) === registryBefore && snapshot(legacy) === legacyBefore, "a refused adoption changed the registry or the archive");

  const result = await env.registry.adoptLegacyForActive("acct-a");
  check(result.adopted === true && result.replaced === dbName("acct-a"), `adoption should succeed and name the replaced database: ${JSON.stringify(result)}`);
  check(withoutStamp(legacy) === legacyBefore, "adoption modified the older archive beyond its binding stamp");
  const stamp = legacy.data.meta.get("accountBinding")?.value;
  check(stamp?.accountKey === `${SITE}|acct-a` && stamp?.via === "adopted", "the older archive should be stamped for the adopting account");
  check(snapshot(env.adapters.get(dbName("acct-a"))) === freshBefore, "the replaced database was modified");
  const stored = env.storage.data.archiveAccounts;
  check(stored.accounts[`${SITE}|acct-a`].dbName === LEGACY && stored.legacy.state === "bound" && stored.legacy.via === "adopted", "the registry should bind the older archive to the adopting account");
  check(same(stored.orphans, [dbName("acct-a")]), "the replaced database should be kept and listed as an orphan");
  check(same((await api(hooks, "courses.list")).items.map((course) => course.title), ["Old course"]), "after adoption the account should read the older archive");
  const after = await api(hooks, "system.getAccountContext");
  check(after.canAdoptLegacy === false && after.legacyOwnerAccountId === "acct-a", "after adoption the prompt must not be offered again");
  check((await env.registry.adoptLegacyForActive("acct-a")).alreadyOwner === true, "adopting twice should be a harmless no-op");

  // Another account can neither adopt nor read it.
  env.storage.data.dashboardProfile = { accountId: "acct-b" };
  check((await api(hooks, "system.getAccountContext")).canAdoptLegacy === false, "a bound archive must not be offered to another account");
  check(await refusal(env.registry.adoptLegacyForActive("acct-b")) === "ACCOUNT_ADOPT_UNAVAILABLE", "another account adopted an archive that already has an owner");
  check((await api(hooks, "courses.list")).items.every((course) => course.title !== "Old course"), "another account read the adopted archive");

  // Restart with the registry lost: the stamp keeps the adopted owner; the replaced database stays an orphan.
  const rebuilt = createMemoryAccountEnvironment(hooks, { storage: createMemoryStorage({ dashboardProfile: { accountId: "acct-a" } }), databases: Object.fromEntries(env.adapters), now: NOW });
  const description = await rebuilt.registry.describe();
  check(description.legacy.state === "bound" && description.legacy.accountKey === `${SITE}|acct-a` && description.legacy.via === "stamp", "after registry loss the older archive should stay bound to the adopter");
  check(description.orphans.includes(dbName("acct-a")), "after registry loss the replaced database should stay an orphan");
  check(same((await api(hooks, "courses.list")).items.map((course) => course.title), ["Old course"]), "after registry loss the adopter should still read the older archive");
}

// ---- Two accounts recorded: only one of them is offered the archive --------------------------------
{
  const hooks = loadBackgroundHooks();
  const mixed = hooks.createMemoryArchiveAdapter({ syncJobs: [{ jobId: "j1", accountId: "acct-a" }, { jobId: "j2", accountId: "acct-b" }], courses: [{ courseId: "1", title: "Mixed", active: true }] });
  const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-c", databases: { [LEGACY]: mixed }, now: NOW });
  const before = snapshot(mixed);
  check((await api(hooks, "system.getAccountContext")).canAdoptLegacy === false, "an account not recorded in a mixed archive must not be offered it");
  check(await refusal(env.registry.adoptLegacyForActive("acct-c")) === "ACCOUNT_ADOPT_REFUSED", "an unrecorded account adopted a mixed archive");
  check(snapshot(mixed) === before && env.storage.data.archiveAccounts.legacy.state === "quarantined", "a refused adoption changed the mixed archive or registry");

  env.storage.data.dashboardProfile = { accountId: "acct-b" };
  check((await api(hooks, "system.getAccountContext")).canAdoptLegacy === true, "a recorded account should be offered the mixed archive");
  await env.registry.adoptLegacyForActive("acct-b");
  check(same((await api(hooks, "courses.list")).items.map((course) => course.title), ["Mixed"]), "the recorded account should read the archive it adopted");
  env.storage.data.dashboardProfile = { accountId: "acct-a" };
  check((await api(hooks, "courses.list")).items.length === 0, "the other recorded account read an archive adopted by someone else");
  check(await refusal(env.registry.adoptLegacyForActive("acct-a")) === "ACCOUNT_ADOPT_UNAVAILABLE", "a second account adopted an archive that already has an owner");
}

// ---- Fail closed: archive gone, stamped for someone else, or listing unavailable ---------------------
{
  const hooks = loadBackgroundHooks();
  const seed = { courses: [{ courseId: "1", title: "Old", active: true }] };
  const quarantined = { version: 1, accounts: {}, legacy: { state: "quarantined", reason: "no-provenance", candidates: [] } };

  const gone = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", storageSeed: { archiveAccounts: quarantined } });
  check(await refusal(gone.registry.adoptLegacyForActive("acct-a")) === "ACCOUNT_ADOPT_UNAVAILABLE", "adoption must refuse when the older archive is no longer on disk");
  check(!gone.opened.includes(LEGACY) && same(gone.storage.data.archiveAccounts, quarantined), "a refused adoption opened a missing archive or wrote the registry");

  const stamped = hooks.createMemoryArchiveAdapter({ ...seed, meta: [{ key: "accountBinding", value: { accountKey: `${SITE}|acct-z` } }] });
  const tampered = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", databases: { [LEGACY]: stamped }, storageSeed: { archiveAccounts: quarantined } });
  const stampedBefore = snapshot(stamped);
  check(await refusal(tampered.registry.adoptLegacyForActive("acct-a")) === "ACCOUNT_DB_MISMATCH", "adoption must refuse an archive stamped for another account");
  check(snapshot(stamped) === stampedBefore && same(tampered.storage.data.archiveAccounts, quarantined), "a refused adoption rewrote the stamp or the registry");

  const unlisted = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", databases: { [LEGACY]: hooks.createMemoryArchiveAdapter(seed) }, storageSeed: { archiveAccounts: quarantined }, listDatabases: async () => { throw new Error("no listing"); } });
  check(await refusal(unlisted.registry.adoptLegacyForActive("acct-a")) === "ACCOUNT_REGISTRY_UNAVAILABLE", "adoption must refuse when databases cannot be listed");

  const nobody = createMemoryAccountEnvironment(hooks, { databases: { [LEGACY]: hooks.createMemoryArchiveAdapter(seed) }, storageSeed: { archiveAccounts: quarantined } });
  check(await refusal(nobody.registry.adoptLegacyForActive("acct-a")) === "ACCOUNT_UNKNOWN", "adoption must refuse when no account is signed in");
}

// ---- Already bound (the live case): no prompt, nothing changes ------------------------------------
{
  const hooks = loadBackgroundHooks();
  const legacy = hooks.createMemoryArchiveAdapter(baselineSeed("TestAcct1"));
  const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "TestAcct1", databases: { [LEGACY]: legacy }, now: NOW });
  const context = await api(hooks, "system.getAccountContext");
  check(context.canAdoptLegacy === false && context.legacyOwnerAccountId === "TestAcct1", "a bound archive must not show the adopt prompt");
  const before = snapshot(legacy);
  const registryBefore = JSON.stringify(env.storage.data.archiveAccounts);
  check((await env.registry.adoptLegacyForActive("TestAcct1")).alreadyOwner === true, "the bound owner adopting again should be a no-op");
  check(snapshot(legacy) === before && JSON.stringify(env.storage.data.archiveAccounts) === registryBefore, "a no-op adoption changed the archive or registry");
  const counts = (await api(hooks, "system.getDatabaseStatus")).counts;
  check(same(counts, { courses: 4, evidence: 3297, entities: 1778, relationships: 6423, syncRuns: 153, syncJobs: 28 }), `baseline counts changed: ${JSON.stringify(counts)}`);
  env.storage.data.dashboardProfile = { accountId: "acct-other" };
  check((await api(hooks, "system.getAccountContext")).canAdoptLegacy === false, "another account was offered a bound archive");
}

// ---- Dashboard: the binder reports the offer and can reload the same account ---------------------
{
  const context = vm.createContext({ console, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/dashboard/account-binding.js"), "utf8"), context, { filename: "account-binding.js" });
  const { createBinder } = context.D2LDashboard.accountBinding;
  let offer = true;
  let loads = 0;
  const applied = [];
  const binder = createBinder({
    getContext: async () => ({ accountId: "acct-a", legacyOwnerAccountId: offer ? "" : "acct-a", canAdoptLegacy: offer }),
    loadScoped: async () => ({}),
    loadArchive: async () => ({ load: ++loads }),
    clearView() {},
    showLoading() {},
    showEmpty() {},
    apply(view) { applied.push(view); }
  });
  await binder.rebind("acct-a");
  check(applied[0].canAdoptLegacy === true && applied[0].legacyOwnerAccountId === "", "the binder should pass the adopt offer to the page");
  offer = false;
  check((await binder.rebind("acct-a")).state === "unchanged" && loads === 1, "an ordinary rebind of the same account should not reload");
  check((await binder.rebind("acct-a", { force: true })).state === "ready" && loads === 2, "a forced rebind should reload the same account");
  check(applied[1].canAdoptLegacy === false && applied[1].legacyOwnerAccountId === "acct-a", "after adoption the page should get the new owner and no offer");
}

// ---- Dashboard: the prompt text and its two-step confirmation ------------------------------------
{
  const dash = loadDashboard();
  const offer = dash.adoptLegacyNotice({ name: "<Sam>", confirming: false, pending: false, error: "" });
  check(/data-action="adopt-legacy"/.test(offer) && !/adopt-legacy-confirm/.test(offer), "the first step should only offer, not confirm");
  check(offer.includes("&lt;Sam&gt;") && !offer.includes("<Sam>"), "the account name must be escaped");
  const confirm = dash.adoptLegacyNotice({ name: "Sam", confirming: true, pending: false, error: "Nope <b>" });
  check(/data-action="adopt-legacy-confirm"/.test(confirm) && /data-action="adopt-legacy-cancel"/.test(confirm) && /Nothing is deleted/.test(confirm), "the second step should confirm, cancel and say nothing is deleted");
  check(confirm.includes("Nope &lt;b&gt;"), "the error text must be escaped");
  check(/disabled/.test(dash.adoptLegacyNotice({ name: "Sam", confirming: true, pending: true, error: "" })), "the buttons should be disabled while adopting");
  const page = dash.dashboardPage({ hasArchive: false }, offer);
  check(page.includes('data-screen="first-run"') && page.includes("data-adopt-legacy"), "an empty archive page should still show the prompt");
}

console.log("Legacy archive adoption tests passed.");
