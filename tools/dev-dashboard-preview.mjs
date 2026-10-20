// Serves dashboard.html outside the browser extension for development, backed
// by saved exports instead of the extension's database. A small stand-in for
// chrome.* forwards read-only API calls to this process.
//
//   node tools/dev-dashboard-preview.mjs [port]      (exports from dashboard-test-exports.json)
//
// /__mock-d2l is a stand-in D2L page running src/content/overlay.js, so the
// overlay (launcher, open, close, screen kept across page loads) can be tried
// without the extension. The page plays the background's part.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadBackgroundHooks } from "../tests/test-production-loader.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const port = Number(process.argv[2] || process.env.PORT || 8765);
const config = JSON.parse(fs.readFileSync(path.join(root, "dashboard-test-exports.json"), "utf8"));
const exportRoot = config.exportRoot.replace(/^~(?=\/)/, os.homedir());

const hooks = loadBackgroundHooks();
const repository = hooks.createArchiveRepository(hooks.createMemoryArchiveAdapter());
// The config lists the newest export first; ingest oldest first so the newest
// revision of each item wins, as it does in the extension.
for (const entry of [...config.archives].reverse()) {
  for (const dir of entry.exports) {
    const manifest = JSON.parse(fs.readFileSync(path.join(exportRoot, dir, "manifest.json"), "utf8"));
    const rows = manifest.rows.filter((row) => entry.courseIds.includes(String(row.courseOrgUnitId)));
    await hooks.ingestAndOrganizeRows(rows, { repository, syncRunId: `preview-${dir}`, mode: "offline", ingestedAt: manifest.exportedAt });
  }
}

const SHIM = `<script>
// In the mock D2L page's overlay, let the page reach this frame for checks
// (the overlay's closed shadow root hides it from window.frames).
if (window.parent !== window) window.parent.__previewDashboard = window;
window.chrome = {
  runtime: {
    id: "preview",
    getManifest: () => ({ version: "preview" }),
    getURL: (p) => location.origin + "/" + String(p).replace(/^\\//, ""),
    sendMessage: (message) => String(message?.type).startsWith("D2L_OVERLAY_") && window.parent !== window && window.parent.__previewOverlay
      ? Promise.resolve(window.parent.__previewOverlay(message, { fromDashboard: true }))
      : fetch("/__message", { method: "POST", body: JSON.stringify(message) }).then((r) => r.json())
  },
  storage: { local: {
    get: async (key) => ({ [key]: JSON.parse(localStorage.getItem("preview:" + key) || "null") ?? undefined }),
    set: async (values) => { for (const [k, v] of Object.entries(values)) localStorage.setItem("preview:" + k, JSON.stringify(v)); },
    remove: async (key) => localStorage.removeItem("preview:" + key)
  } },
  tabs: { create: async (options) => { window.__previewOpenedTabs = [...(window.__previewOpenedTabs || []), options.url]; return { id: 1 }; }, remove: async () => {} },
  downloads: { search: async (query) => { window.__previewDownloadQueries = [...(window.__previewDownloadQueries || []), query]; return []; }, open: async () => {}, show: () => {}, download: async (options) => { window.__previewDownloads = [...(window.__previewDownloads || []), options]; return 1; } }
};
</script>`;

// The background's overlay part, played by the mock page: per-tab state lives
// in sessionStorage, "Open in D2L" loads the mock page again with that URL.
const MOCK_D2L = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mock D2L - Art Foundations</title>
<style>
  body { margin: 0; font: 16px/1.5 Lato, system-ui, sans-serif; color: #202122; background: #f9fbff; }
  .d2l-bar { height: 56px; background: #fff; border-bottom: 1px solid #e3e9f1; display: flex; align-items: center; gap: 18px; padding: 0 24px; }
  .d2l-bar b { color: #0a2a52; } .d2l-bar span { color: #494c4e; font-size: 14px; }
  .d2l-nav { background: #0a2a52; color: #fff; display: flex; gap: 22px; padding: 10px 24px; font-size: 14px; flex-wrap: wrap; }
  main { max-width: 1100px; margin: 24px auto; padding: 0 16px; }
  .card { background: #fff; border: 1px solid #e3e9f1; border-radius: 6px; padding: 18px 20px; margin-bottom: 16px; }
  .url { font: 13px ui-monospace, monospace; color: #6e7477; word-break: break-all; }
  .d2l-foot { position: fixed; left: 0; right: 0; bottom: 0; height: 44px; background: #fff; border-top: 1px solid #e3e9f1; display: flex; align-items: center; justify-content: flex-start; gap: 12px; padding: 0 24px; font-size: 13px; color: #494c4e; }
</style></head><body>
<div class="d2l-bar"><b>KSU D2L (mock)</b><span>Art Foundations Section A Term 2024</span></div>
<nav class="d2l-nav"><span>Course Home</span><span>Content</span><span>Discussions</span><span>Assignments</span><span>Quizzes</span><span>Grades</span></nav>
<main>
  <div class="card"><h2 style="margin-top:0">Announcements</h2><p>This page stands in for D2L so the overlay can be tried without the extension.</p><div class="url" id="shown-url"></div></div>
  <div class="card"><h2 style="margin-top:0">Upcoming events</h2><p>Module 6: Andy Warhol Response, due Oct 5.</p></div>
  ${Array.from({ length: 6 }, (_, i) => `<div class="card"><h3 style="margin-top:0">Content module ${i + 1}</h3><p>Readings and slides for this module.</p></div>`).join("")}
</main>
<div class="d2l-foot">D2L footer bar (mock): the launcher should not cover it.</div>
<script>
  (function () {
    const KEY = "preview:overlay";
    const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || { open: false, route: "#/" }; } catch { return { open: false, route: "#/" }; } };
    const save = (state) => { sessionStorage.setItem(KEY, JSON.stringify(state)); return state; };
    const listeners = [];
    const apply = (state) => listeners.forEach((listener) => listener({ type: "D2L_OVERLAY_APPLY", ...state }, {}, () => {}));
    const shown = new URLSearchParams(location.search).get("page");
    document.getElementById("shown-url").textContent = shown ? "Opened from the overlay: " + shown : "Mock course home";
    window.__previewOverlay = (message, from = {}) => {
      const state = read();
      if (message.type === "D2L_OVERLAY_STATE") return { ok: true, ...state };
      if (message.type === "D2L_OVERLAY_SET") {
        if (typeof message.open === "boolean") state.open = message.open;
        if (typeof message.route === "string" && /^#\\/[\\w\\-/:%?=&.,+~]*$/.test(message.route)) state.route = message.route;
        save(state);
        if (from.fromDashboard && message.open === false) apply(state);
        return { ok: true, ...state };
      }
      if (message.type === "D2L_OVERLAY_OPEN_D2L") {
        save({ ...state, open: false });
        apply({ ...state, open: false });
        location.href = "/__mock-d2l?page=" + encodeURIComponent(message.url);
        return { ok: true, ...state, open: false };
      }
      return { ok: false };
    };
    window.chrome = { runtime: {
      getURL: (file) => location.origin + "/" + String(file).replace(/^\\//, ""),
      getManifest: () => ({ version: "preview" }),
      sendMessage: (message) => Promise.resolve(window.__previewOverlay(message)),
      onMessage: { addListener: (listener) => listeners.push(listener) }
    } };
  })();
</script>
<script src="/src/content/overlay.js"></script>
</body></html>`;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };

http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/__message") {
    let body = "";
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body || "{}");
    const result = message.type === "D2L_DASHBOARD_PREPARE"
      ? { ok: true, result: { reorganized: false } }
      : await hooks.handleAppApiRequest(message, { repository });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
    return;
  }
  const urlPath = decodeURIComponent(new URL(request.url, "http://x").pathname);
  if (urlPath === "/__mock-d2l") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(MOCK_D2L);
    return;
  }
  const file = path.join(root, urlPath === "/" ? "dashboard.html" : urlPath);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404);
    response.end("not found");
    return;
  }
  let content = fs.readFileSync(file);
  if (file.endsWith("dashboard.html")) content = Buffer.from(String(content).replace("<script ", `${SHIM}\n    <script `));
  response.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  response.end(content);
}).listen(port, () => console.log(`Dashboard preview on http://localhost:${port}/`));
