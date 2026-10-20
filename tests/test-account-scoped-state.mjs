import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { loadBackgroundHooks, createMemoryAccountEnvironment, createMemoryStorage } from "./test-production-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const fail = (message) => { throw new Error(message); };
const check = (value, message) => { if (!value) fail(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SITE = "https://kennesaw.view.usg.edu";
const LEGACY = "d2l-student-archive";
const dbName = (id) => `${LEGACY}--${encodeURIComponent(SITE)}--${id}`;
const NOW = () => "2026-10-03T12:00:00.000Z";

function loadDashboardModule(file) {
  const context = vm.createContext({ console, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, file), "utf8"), context, { filename: file });
  return context.D2LDashboard;
}
const dash = loadDashboardModule("src/dashboard/account-binding.js");
const { createBinder, loadScoped, saveScoped, scopedKey } = dash.accountBinding;

const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/semantic-organizer-v1.json"), "utf8"));
const rowsFor = (title) => fixture.rows.map((row) => ({ ...row, courseTitle: title }));

// ---- Dashboard rebinding: A -> B -> A ---------------------------------------------------------------
{
  const hooks = loadBackgroundHooks();
  const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", now: NOW });
  await hooks.ingestAndOrganizeRows(rowsFor("Course of A"), { syncRunId: "a", ingestedAt: NOW() });
  env.storage.data.dashboardProfile = { accountId: "acct-b" };
  await hooks.ingestAndOrganizeRows(rowsFor("Course of B"), { syncRunId: "b", ingestedAt: NOW() });
  env.storage.data.dashboardProfile = { accountId: "acct-a" };

  const api = async (method, params = {}) => {
    const response = await hooks.handleAppApiRequest({ type: "D2L_APP_API_REQUEST", protocolVersion: "1", requestId: `r-${method}`, method, params });
    if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code });
    return response.data;
  };
  await saveScoped(env.storage, "dashboardReadUpdates", "acct-a", { "u-a": true });
  await saveScoped(env.storage, "dashboardReadUpdates", "acct-b", { "u-b": true });

  // What the page holds, plus a log of everything it would have rendered.
  const view = { titles: [], read: {}, empty: false, loading: false };
  const rendered = [];
  const paint = (event) => rendered.push({ event, bound: binder.accountId, titles: [...view.titles], read: { ...view.read }, empty: view.empty });
  let hold = null;
  const binder = createBinder({
    getContext: () => api("system.getAccountContext"),
    loadScoped: async (accountId, legacyOwner) => ({ read: await loadScoped(env.storage, "dashboardReadUpdates", accountId, legacyOwner, {}) }),
    loadArchive: async () => {
      const courses = await api("courses.list");
      if (hold) await hold;
      return { courses, entities: await api("entities.list") };
    },
    clearView() { view.titles = []; view.read = {}; view.empty = false; paint("clear"); },
    showLoading() { view.loading = true; paint("loading"); },
    showEmpty() { view.empty = true; paint("empty"); },
    apply({ scoped, archive }) { view.loading = false; view.empty = false; view.titles = archive.courses.items.map((course) => course.title); view.read = scoped.read; paint("apply"); }
  });

  check((await binder.rebind("acct-a")).state === "ready" && same(view.titles, ["Course of A"]) && same(view.read, { "u-a": true }), "account A did not load its own archive and read markers");
  const firstA = JSON.stringify(view);
  // The profile changes to B: the old data must be gone before anything of B can show.
  env.storage.data.dashboardProfile = { accountId: "acct-b" };
  const switching = binder.rebind("acct-b");
  check(view.titles.length === 0 && Object.keys(view.read).length === 0, "account A data was still present right after the switch began");
  check((await switching).state === "ready" && same(view.titles, ["Course of B"]) && same(view.read, { "u-b": true }), "account B did not load its own archive and read markers");
  // Same account again (a new photo, say): no reload, no flash.
  const before = rendered.length;
  check((await binder.rebind("acct-b")).state === "unchanged" && rendered.length === before, "an unchanged account must not clear or reload the view");
  env.storage.data.dashboardProfile = { accountId: "acct-a" };
  await binder.rebind("acct-a");
  check(JSON.stringify(view) === firstA, "switching back to account A did not restore exactly its earlier data");
  for (const entry of rendered) {
    const allowed = entry.bound === "acct-a" ? ["Course of A"] : entry.bound === "acct-b" ? ["Course of B"] : [];
    check(entry.titles.every((title) => allowed.includes(title)) && !(entry.bound === "acct-b" && "u-a" in entry.read) && !(entry.bound === "acct-a" && "u-b" in entry.read),
      `a render for ${entry.bound} (${entry.event}) held another account's data: ${JSON.stringify(entry)}`);
  }

  // A slow load for A that finishes after the switch to B is discarded.
  let release;
  hold = new Promise((resolve) => { release = resolve; });
  env.storage.data.dashboardProfile = { accountId: "acct-b" };
  await binder.rebind("");               // force a fresh binding cycle
  env.storage.data.dashboardProfile = { accountId: "acct-a" };
  const slowA = binder.rebind("acct-a");
  await new Promise((resolve) => setTimeout(resolve, 5));
  hold = null;
  env.storage.data.dashboardProfile = { accountId: "acct-b" };
  const fastB = await binder.rebind("acct-b");
  release();
  check((await slowA).state === "stale" && fastB.state === "ready" && same(view.titles, ["Course of B"]), "a late response for the previous account overwrote the current account's view");

  // No known account: friendly empty state, nothing read, nothing opened.
  env.opened.length = 0;
  delete env.storage.data.dashboardProfile;
  const none = await binder.rebind("");
  check(none.state === "unknown" && view.empty === true && view.titles.length === 0, "an unknown account should show the empty state with no data");
  check(env.opened.length === 0, "the empty state opened an archive");
  // Race: the page believes it has an account but the profile is gone: the archive read fails closed into the same empty state.
  await binder.rebind("acct-a").catch(() => {});
  check(view.empty === true && view.titles.length === 0, "a missing profile at read time must end in the empty state, not an error or data");
  check([...env.adapters.keys()].sort().join() === [dbName("acct-a"), dbName("acct-b")].sort().join(), "unexpected databases were created while rebinding");
}

// ---- Read markers: isolated per account, legacy value only for the legacy owner ------------------------
{
  const storage = createMemoryStorage({ dashboardReadUpdates: { legacyMarker: true } });
  check(same(await loadScoped(storage, "dashboardReadUpdates", "acct-a", "acct-a", {}), { legacyMarker: true }), "the legacy owner lost its existing read markers");
  check(same(await loadScoped(storage, "dashboardReadUpdates", "acct-b", "acct-a", {}), {}), "another account inherited the legacy read markers");
  await saveScoped(storage, "dashboardReadUpdates", "acct-b", { b: true });
  await saveScoped(storage, "dashboardReadUpdates", "acct-a", { a: true });
  check(same(await loadScoped(storage, "dashboardReadUpdates", "acct-a", "acct-a", {}), { a: true }) && same(await loadScoped(storage, "dashboardReadUpdates", "acct-b", "acct-a", {}), { b: true }), "read markers leaked between accounts");
  check(same(storage.data.dashboardReadUpdates, { legacyMarker: true }), "the legacy marker value was modified");
  await saveScoped(storage, "dashboardReadUpdates", "", { x: true });
  check(!Object.keys(storage.data).some((key) => key === scopedKey("dashboardReadUpdates", "")), "read markers were saved without an account");
}

// ---- File preview cache: isolated per account ---------------------------------------------------------------
{
  const files = loadDashboardModule("src/dashboard/file-cache.js");
  const records = new Map();
  const store = {
    get: async (key) => records.get(key),
    getAll: async () => [...records.values()],
    put: async (record) => { records.set(record.url, record); },
    remove: async (keys) => { for (const key of keys) records.delete(key); }
  };
  const cache = files.createFileCache(store);
  const blob = (text) => ({ size: text.length, type: "text/plain", text });
  const url = `${SITE}/d2l/common/file.pdf`;
  const A = { accountId: "acct-a", adoptLegacy: true };
  const B = { accountId: "acct-b", adoptLegacy: false };
  records.set(url, { url, blob: blob("legacy"), size: 6, usedAt: 1 });           // saved before accounts existed
  await cache.keepFile(B, url, blob("b-file"));
  check((await cache.getFile(B, url)).text === "b-file", "account B cannot read its own saved preview");
  check((await cache.getFile(A, url)).text === "legacy", "the legacy owner lost its older preview");
  check((await cache.getFile(B, url)).text === "b-file", "adopting the legacy file disturbed account B");
  check(await cache.getFile({ accountId: "acct-c", adoptLegacy: false }, url) === null, "a third account read someone else's preview");
  check(await cache.getFile({ accountId: "", adoptLegacy: true }, url) === null, "the cache answered with no account");
  await cache.keepFile({ accountId: "", adoptLegacy: false }, url, blob("none"));
  check([...records.keys()].every((key) => key.includes("|")), "an unscoped or legacy-keyed record remained or was written");
  check((await cache.usage(A)).count === 1 && (await cache.usage(B)).count === 1, "usage counted another account's files");
  await cache.clear(A);
  check((await cache.getFile(B, url)).text === "b-file" && await cache.getFile(A, url) === null, "clearing one account's previews touched another's");
}

console.log("Dashboard account rebinding, read markers and file preview cache stay isolated per account.");
