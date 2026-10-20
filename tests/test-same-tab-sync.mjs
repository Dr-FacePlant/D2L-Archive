import { appSource } from "./app-source.mjs";
import fs from "node:fs";
import path from "node:path";
import { loadBackgroundHooks, loadContentHooks } from "./test-production-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const contentFiles = manifest.content_scripts[0].js;

if (!contentFiles.includes("src/content/probe-frame.js") || contentFiles.indexOf("src/content/probe-frame.js") > contentFiles.indexOf("src/content/bridges.js")) {
  throw new Error("The probe-frame controller must load before the content message bridge");
}

const content = loadContentHooks();
const safe = content.safeProbeTask({
  title: "Grades",
  url: "https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=9900004",
  expectedPageType: "grades"
});
if (safe.expectedPageType !== "grades" || !content.probePayloadReady({ diagnostics: { emptyState: true }, items: [] })) {
  throw new Error("Probe-frame task validation or readiness did not load from production code");
}
let rejected = false;
try {
  content.safeProbeTask({ url: "https://example.com/not-d2l" });
} catch {
  rejected = true;
}
if (!rejected) throw new Error("Probe frames accepted an off-site URL");

const tabCalls = { create: 0, update: 0, remove: 0, group: 0, messages: [] };
const progress = [];
const chrome = {
  runtime: { getURL: (file = "") => `chrome-extension://testid/${file}` },
  tabs: {
    get: async (tabId) => ({ id: tabId, url: "https://kennesaw.view.usg.edu/d2l/home/9900004" }),
    sendMessage: async (tabId, message, options) => {
      tabCalls.messages.push({ tabId, message, options });
      return {
        ok: true,
        payload: {
          pageType: "grades",
          page: { url: message.task.url, title: "Grades" },
          course: { orgUnitId: "9900004", title: "Art" },
          diagnostics: { emptyState: true, loading: false },
          items: [],
          crawlTask: { requestedUrl: message.task.url }
        }
      };
    },
    create: async () => { tabCalls.create += 1; return { id: 99 }; },
    update: async () => { tabCalls.update += 1; return { id: 7 }; },
    remove: async () => { tabCalls.remove += 1; }
  },
  tabGroups: { update: async () => { tabCalls.group += 1; } },
  storage: {
    local: { get: async () => ({}), set: async () => {} },
    session: { get: async () => ({}), set: async () => {} }
  }
};
const hooks = loadBackgroundHooks({ chrome });
const task = { title: "Visible grades", url: safe.url, expectedPageType: "grades", courseOrgUnitId: "9900004" };
const payload = await hooks.navigateAndExtract({
  mode: "frame",
  tabId: 7,
  onProgress: async (entry) => progress.push(entry.state)
}, task);

if (payload.pageType !== "grades" || !hooks.frameNavigationTarget({ mode: "frame", tabId: 7 })) {
  throw new Error("Frame navigation did not return the content-script payload");
}
if (JSON.stringify(progress) !== JSON.stringify(["starting", "complete"])) {
  throw new Error(`Unexpected same-tab progress: ${JSON.stringify(progress)}`);
}
if (tabCalls.create || tabCalls.update || tabCalls.remove || tabCalls.group) {
  throw new Error(`Same-tab frame navigation touched browser tabs: ${JSON.stringify(tabCalls)}`);
}
if (tabCalls.messages.length !== 1 || tabCalls.messages[0].options?.frameId !== 0 || tabCalls.messages[0].message?.type !== "D2L_PROBE_FRAME_TASK") {
  throw new Error(`Probe work was not sent to the existing D2L top frame: ${JSON.stringify(tabCalls.messages)}`);
}
if (JSON.stringify(hooks.requestedCourseIds({ courseIds: ["9900004", "9900004", "bad"] })) !== JSON.stringify(["9900004"])) {
  throw new Error("Same-tab sync did not normalize requested course IDs");
}
const devSender = { tab: { id: 7, url: "https://kennesaw.view.usg.edu/d2l/home/9900004" }, frameId: 0, url: "https://kennesaw.view.usg.edu/d2l/home/9900004" };
if (!hooks.sameTabSyncSender({ devToken: "d2l-local-dev-8f6c2a1e" }, devSender)
  || hooks.sameTabSyncSender({ devToken: "wrong" }, devSender)
  || hooks.sameTabSyncSender({ devToken: "d2l-local-dev-8f6c2a1e" }, { ...devSender, url: "https://example.com/" })) {
  throw new Error("The development same-tab trigger is not restricted to its exact token and D2L top frame");
}
const stateResult = await hooks.handleSameTabSyncState({ devToken: "d2l-local-dev-8f6c2a1e" }, devSender);
if (stateResult !== null) throw new Error("A fresh tab should not report a same-tab run");
if (content.devSameTabSyncRequest("https://kennesaw.view.usg.edu/d2l/home#d2l-extractor-dev-same-tab-sync=d2l-local-dev-8f6c2a1e:9900004,9900004,bad")?.join(",") !== "9900004") {
  throw new Error("The development same-tab URL trigger did not validate course IDs");
}

const app = appSource();
if (!app.includes('type: "D2L_SYNC_ENQUEUE_PRIORITY"') || !app.includes('mode: "priorityQueue"') || /D2L_SYNC_THIS_TAB|D2L_GET_SAME_TAB_SYNC_STATE|D2L_CANCEL_SAME_TAB_SYNC/.test(app)) {
  throw new Error("The dashboard is not wired to the durable priority queue or still invokes the legacy full same-tab loop");
}
if (!/withPageProbes && \(probeTab\?\.id \|\| probeTab\?\.mode === "frame"\)/.test(read("src/background/export.js"))) {
  throw new Error("The exporter would skip collectors for a frame navigation target");
}

console.log("Same-tab helpers remain available, while the dashboard uses the durable priority queue.");
