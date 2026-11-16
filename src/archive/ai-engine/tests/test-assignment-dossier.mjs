import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const listeners = {};
const copied = [];
const document = { addEventListener: (name, fn) => { listeners[name] = fn; } };
const navigator = { clipboard: { writeText: async (text) => copied.push(text) } };

function fakeIndexedDb() {
  const rows = new Map();
  const stores = new Set();
  const db = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name) => stores.add(name),
    transaction() {
      const tx = { objectStore: () => ({
        get: (key) => request((req) => { req.result = rows.get(key); }),
        put: (value) => request((req) => { rows.set(value.key, value); req.result = value.key; })
      }) };
      return tx;
    }
  };
  function request(write) {
    const req = {};
    queueMicrotask(() => { write(req); req.onsuccess?.(); });
    return req;
  }
  return {
    open() {
      const req = {};
      queueMicrotask(() => {
        if (!stores.size) req.onupgradeneeded?.({ target: { result: db } });
        req.result = db;
        req.onsuccess?.();
      });
      return req;
    }
  };
}

const context = vm.createContext({ console, document, navigator, indexedDB: fakeIndexedDb(), setTimeout, clearTimeout });
context.globalThis = context;
context.D2LDashboard = {
  escapeHtml: (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]),
  askFileTexts: null,
  askReadFileText: null,
  detailBody: () => "<h2>Instructions</h2><p>Provided instructions.</p>"
};
vm.runInContext(fs.readFileSync(path.join(root, "src/dashboard/assignment-dossier/assignment-dossier.js"), "utf8"), context);
const dash = context.D2LDashboard;
assert.match(dash.detailBody({ kind: "assignment" }), /id="assignment-dossier"/);

const texts = new Map();
const fileTextStore = {
  async all(accountId) { return new Map([...texts].filter(([key]) => key.startsWith(`${accountId}|`)).map(([key, value]) => [key.slice(accountId.length + 1), value])); },
  async keep(accountId, url, value) { texts.set(`${accountId}|${url}`, value); }
};
let reads = 0;
const readFile = async () => {
  reads += 1;
  return { state: "read", text: "Lab 4 report. Submit a 900-word paper with APA citations and save it as PDF.", pageText: ["", "", "", "Lab 4 report. Submit a 900-word paper with APA citations and save it as PDF."] };
};
const assignment = {
  kind: "assignment", title: "Lab 4", item: { id: "assignment:101:4", courseId: "101" }, instructions: "",
  files: [{ name: "Lab 4 Instructions.pdf", downloadUrl: "https://kennesaw.view.usg.edu/d2l/le/content/101/viewContent/4/View" }],
  links: [{ label: "Open assignment in D2L", url: "https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folder_submit_files.d2l?db=4", primary: true }], related: []
};
const index = { list: () => [] };
const engine = dash.createAssignmentDossier({ indexedDB: context.indexedDB, fileTextStore, readFile, document, navigator });

const result = await engine.get({ accountId: "acct-a", assignment, index });
const html = dash.assignmentDossierHtml(result);
assert.equal(result.state, "ready");
assert.match(result.brief.map((line) => line.text).join(" "), /Submit a 900-word paper/);
console.log("PASS: empty assignment displays synthesized brief from attached document");

assert.ok(result.requirements.some((rule) => /APA/.test(rule.text) && /Syllabus|Instructions/.test(rule.source.name)));
assert.match(html, /Inferred from Lab 4 Instructions\.pdf p\. 4/);
console.log("PASS: inferred rules display source attribution badges");

const readsBeforeHit = reads;
const cacheStart = Date.now();
const cached = await engine.get({ accountId: "acct-a", assignment, index });
assert.ok(Date.now() - cacheStart < 100, "the IndexedDB cache hit should resolve quickly");
assert.equal(reads, readsBeforeHit, "a cache hit does not reread source files");
assert.equal(cached.key, result.key);
console.log("PASS: dossier cache hits load instantly from IndexedDB");

assert.match(html, /<input[^>]+type="checkbox"[^>]+aria-label/);
assert.match(html, /<button[^>]+type="button"[^>]+aria-label/);
assert.match(html, /<a[^>]+href="https:\/\//);
assert.match(fs.readFileSync(path.join(root, "src/dashboard/dashboard.css"), "utf8"), /:focus-visible\s*\{/);
assert.match(fs.readFileSync(path.join(root, "src/dashboard/app-events.js"), "utf8"), /event\.key === "Escape"[\s\S]{0,500}closeDetailToBase/);
console.log("PASS: keyboard navigation and focus management in dossier section");

const failedEngine = dash.createAssignmentDossier({
  indexedDB: fakeIndexedDb(), fileTextStore: { all: async () => new Map(), keep: async () => {} },
  readFile: async () => ({ state: "failed" }), document, navigator
});
const failed = await failedEngine.get({ accountId: "acct-b", assignment, index });
const fallback = dash.assignmentDossierHtml(failed);
assert.equal(failed.state, "fallback");
assert.match(fallback, /Open or download Lab 4 Instructions\.pdf/);
assert.match(fallback, /https:\/\/kennesaw\.view\.usg\.edu\/d2l\/lms\/dropbox/);
const missing = await failedEngine.get({ accountId: "acct-c", assignment: { ...assignment, files: [] }, index });
assert.match(dash.assignmentDossierHtml(missing), /Open assignment in D2L/);
console.log("PASS: unreadable or missing attachment renders graceful fallback with D2L download link");

const status = { textContent: "" };
const dossierRoot = { dataset: { copyText: result.copyText, accountId: "acct-a", cacheKey: result.key }, querySelector: () => status };
const copyButton = { closest: () => dossierRoot };
await listeners.click({ target: { closest: () => copyButton } });
assert.equal(copied[0], result.copyText);
assert.equal(status.textContent, "Copied");
const checkId = result.requirements[0].id;
listeners.change({ target: { dataset: { dossierCheck: checkId }, checked: true, closest: () => dossierRoot } });
await new Promise((resolve) => setTimeout(resolve, 0));
const checked = await engine.get({ accountId: "acct-a", assignment, index });
assert.match(dash.assignmentDossierHtml(checked), new RegExp(`data-dossier-check="${checkId}"[^>]*checked`));
