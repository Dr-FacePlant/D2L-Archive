import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Offline query CLI answers read-only API methods from an export folder.
const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/semantic-organizer-v1.json"), "utf8"));
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "d2l-query-archive-"));
fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ exportedAt: "2026-09-27T15:00:00.000Z", crawlMeta: { extensionVersion: "test" }, rows: fixture.rows }));

function query(method, params = {}) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "tools", "query-archive.mjs"), folder, method, JSON.stringify(params)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${method} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

try {
  if (!query("assignments.list").data.items.some((item) => item.entityId === "assignment:900001:70002")) throw new Error("Offline assignments.list lost the fixture assignment");
  if (!Array.isArray(query("dashboard.getUpcoming", { includePast: true, horizonDays: 730, now: "2026-01-01T00:00:00Z" }).data.items)) throw new Error("Offline upcoming-work query failed");
  if (!query("system.getCapabilities").data.readMethods.includes("search.query")) throw new Error("Offline capabilities omit search");
} finally {
  fs.rmSync(folder, { recursive: true, force: true });
}
console.log("Offline archive query CLI answers read-only API methods.");
