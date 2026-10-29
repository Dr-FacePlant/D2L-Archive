// Shared by the dashboard tests and tools: loads the dashboard's pure modules
// in a sandbox and builds an archive from saved exports through the same read
// calls, in the same shape, as src/dashboard/app.js.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { loadBackgroundHooks } from "./test-production-loader.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

export function loadDashboard() {
  const context = vm.createContext({ URL, URLSearchParams, console, setTimeout, clearTimeout });
  for (const file of [
    "appearance.js", "format.js", "model.js", "model-textbooks.js", "model-archive.js", "model-updates.js", "model-work.js",
    "model-details.js", "model-resources.js", "model-related.js", "model-dashboard.js", "model-courses.js", "model-contact-backup.js", "model-grades.js",
    "model-calendar.js", "model-search.js", "model-routes.js",
    "render.js", "render-dashboard.js", "render-updates.js", "render-courses.js", "render-calendar.js",
    "render-work.js", "render-details.js", "render-grades.js", "render-resources.js", "render-search.js",
    "render-settings.js"
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, "src/dashboard", file), "utf8"), context, { filename: file });
  }
  return context.D2LDashboard;
}

export function savedExports(configPath) {
  if (!fs.existsSync(configPath)) {
    return { skip: "dashboard-test-exports.json is not present; copy dashboard-test-exports.example.json and point it at exported archives" };
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const exportRoot = exportRootFrom(config);
  const missing = [];
  for (const archive of config.archives || []) {
    for (const dir of archive.exports || []) {
      if (!fs.existsSync(path.join(exportRoot, dir, "manifest.json"))) missing.push(dir);
    }
  }
  if (missing.length) return { skip: `saved exports are not on disk: ${[...new Set(missing)].join(", ")}` };
  return { config, exportRoot };
}

export function exportRootFrom(config) {
  return config.exportRoot.replace(/^~(?=\/)/, os.homedir());
}

export async function archiveFrom(dash, exportRoot, exportDirs, courseIds, nowIso) {
  const hooks = loadBackgroundHooks();
  const repository = hooks.createArchiveRepository(hooks.createMemoryArchiveAdapter());
  const rows = [];
  for (const dir of exportDirs) {
    const manifest = JSON.parse(fs.readFileSync(path.join(exportRoot, dir, "manifest.json"), "utf8"));
    const kept = manifest.rows.filter((row) => courseIds.includes(String(row.courseOrgUnitId)));
    rows.push(...kept);
    await hooks.ingestAndOrganizeRows(kept, { repository, syncRunId: `saved-${dir}`, extractorVersion: manifest.crawlMeta?.extensionVersion || "", mode: "offline", ingestedAt: manifest.exportedAt });
  }
  const call = async (method, params = {}) => {
    const response = await hooks.handleAppApiRequest({ type: "D2L_APP_API_REQUEST", protocolVersion: "1", requestId: "screens", method, params }, { repository });
    if (!response.ok) throw new Error(`${method}: ${response.error.message}`);
    return response.data;
  };
  const [courses, entities, updates, sync] = await Promise.all([
    call("courses.list"), call("entities.list"), call("dashboard.getUpdates", { limit: 300 }), call("sync.getState", { limit: 5 })
  ]);
  const index = dash.buildIndex({ now: nowIso, courses: courses.items, entities: entities.items, updates: updates.items, sync, settings: {} });
  return { index, rows, call, entities: entities.items, repository };
}
