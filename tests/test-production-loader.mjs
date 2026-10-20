import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function runtimeStub(overrides = {}) {
  return {
    getManifest: () => JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")),
    onMessage: { addListener() {} },
    sendMessage: async () => ({ ok: true }),
    ...overrides
  };
}

export function loadSharedHooks() {
  const context = vm.createContext({ URL });
  sharedScripts.forEach((relativePath) => runScript(context, relativePath));
  return context.D2LExtractorShared;
}

const sharedScripts = [
  "src/shared/constants.js",
  "src/shared/text.js",
  "src/shared/urls.js",
  "src/shared/rows.js",
  "src/shared/app-contract.js",
  "src/shared/evidence.js"
];
const contentSupportScripts = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))
  .content_scripts[0].js.filter((relativePath) => relativePath !== "content.js");

function runScript(context, relativePath) {
  vm.runInContext(fs.readFileSync(path.join(root, relativePath), "utf8"), context, { filename: relativePath });
}

export function loadBackgroundHooks(options = {}) {
  const baseChrome = {
    runtime: runtimeStub(),
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {}
      }
    }
  };
  const suppliedChrome = options.chrome || {};
  const chrome = {
    ...baseChrome,
    ...suppliedChrome,
    runtime: { ...baseChrome.runtime, ...(suppliedChrome.runtime || {}) },
    storage: {
      ...baseChrome.storage,
      ...(suppliedChrome.storage || {}),
      local: { ...baseChrome.storage.local, ...(suppliedChrome.storage?.local || {}) }
    }
  };
  const context = vm.createContext({
    URL,
    TextEncoder,
    console,
    clearTimeout,
    setTimeout: options.setTimeout || setTimeout,
    chrome
  });
  context.importScripts = (...paths) => paths.forEach((relativePath) => runScript(context, relativePath));
  runScript(context, "background.js");
  return context.__D2LExtractorBackgroundTestHooks;
}

export function loadContentHooks(options = {}) {
  const attributes = new Map();
  const elements = new Map();
  const makeElement = () => ({
    attributes: new Map(),
    style: {},
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    appendChild(child) { elements.set(child.id, child); child.parentNode = this; }
  });
  const documentStub = {
    title: "Test D2L Course",
    body: { innerText: "", textContent: "", appendChild: (child) => elements.set(child.id, child) },
    createElement: makeElement,
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: () => [],
    querySelector: () => null,
    createTreeWalker: () => ({ nextNode: () => null })
  };
  documentStub.documentElement = {
    getAttribute: (name) => attributes.get(name) || null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const location = {
    href: options.href || "https://kennesaw.view.usg.edu/d2l/home/9900002",
    origin: "https://kennesaw.view.usg.edu",
    pathname: new URL(options.href || "https://kennesaw.view.usg.edu/d2l/home/9900002").pathname
  };
  const window = {
    location,
    addEventListener() {},
    postMessage() {}
  };
  window.top = window;
  window.self = window;

  const context = vm.createContext({
    URL,
    console,
    clearTimeout,
    setTimeout,
    setInterval: () => 0,
    fetch: options.fetch || (async () => { throw new Error("Unexpected fetch from production helper test"); }),
    NodeFilter: { SHOW_ELEMENT: 1 },
    DOMParser: options.DOMParser,
    document: options.document ? Object.assign(documentStub, options.document) : documentStub,
    window,
    chrome: { runtime: runtimeStub(options.chrome?.runtime || {}) }
  });
  contentSupportScripts.forEach((relativePath) => runScript(context, relativePath));
  runScript(context, "content.js");
  return context.__D2LExtractorContentTestHooks;
}

export function loadContentModuleHooks() {
  const hooks = loadContentHooks();
  return hooks;
}

// In-memory stand-in for chrome.storage.local (string-key get, object set).
export function createMemoryStorage(seed = {}) {
  const data = JSON.parse(JSON.stringify(seed));
  return {
    data,
    async get(keys) {
      const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(data);
      return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, JSON.parse(JSON.stringify(data[key]))]));
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) data[key] = JSON.parse(JSON.stringify(value));
    }
  };
}

// Wires the production account registry to in-memory archives, one per database
// name (like IndexedDB, opening an unknown name creates it, so `opened` and
// `adapters` reveal any accidental extra database).
export function createMemoryAccountEnvironment(hooks, options = {}) {
  const storage = options.storage || createMemoryStorage(options.storageSeed || {});
  if (options.activeAccountId) storage.data.dashboardProfile = { accountId: options.activeAccountId };
  const adapters = new Map(Object.entries(options.databases || {}));
  const repositories = new Map();
  const opened = [];
  const registry = hooks.createAccountRegistry({
    storage,
    listDatabases: options.listDatabases || (async () => [...adapters.keys()]),
    openRepository: async (dbName) => {
      opened.push(dbName);
      if (!adapters.has(dbName)) adapters.set(dbName, hooks.createMemoryArchiveAdapter());
      if (!repositories.has(dbName)) repositories.set(dbName, hooks.createArchiveRepository(adapters.get(dbName), { databaseName: dbName, now: options.now }));
      return repositories.get(dbName);
    }
  });
  if (options.configure !== false) hooks.configureAccountRegistry(registry);
  return { registry, storage, adapters, repositories, opened };
}

// For tests that only need "the one archive" behind the signed-in account.
export function useRepositoryForAccount(hooks, repository, accountId = "test-account") {
  const registry = hooks.createAccountRegistry({
    storage: createMemoryStorage({ dashboardProfile: { accountId } }),
    listDatabases: async () => [],
    openRepository: async () => repository
  });
  hooks.configureAccountRegistry(registry);
  return registry;
}
