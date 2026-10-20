import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(!fs.existsSync(path.join(repoRoot, "src/content/api/actions.js")), "the content action endpoint must be gone");
check(!fs.existsSync(path.join(repoRoot, "src/background/actions.js")), "the background action proxy must be gone");
check(!read("manifest.json").includes("api/actions.js"), "the manifest must not load an action endpoint");
check(!read("background.js").includes("D2L_ACTION_"), "the service worker must not prepare or commit D2L changes");
check(!read("src/content/bridges.js").includes("D2L_ACTION_"), "the content bridge must not carry D2L action messages");
check(!read("dashboard.html").includes("action-confirm"), "the dashboard must not carry the confirmation dialog");
check(!read("src/dashboard/render-details.js").includes("data-action=\"reply-to\""), "discussion posts must stay read-only");
check(!read("src/dashboard/render-details.js").includes("data-action=\"open-form\""), "detail pages must not open posting forms");
check(!read("src/dashboard/app-events.js").includes("D2L_ACTION_"), "the dashboard must not send D2L change requests");
for (const file of walk(path.join(repoRoot, "src")).filter((name) => name.endsWith(".js"))) {
  check(!/method:\s*["']POST["']/.test(fs.readFileSync(file, "utf8")), `${path.relative(repoRoot, file)} must not send a POST request`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Read-only boundary checks passed.");
