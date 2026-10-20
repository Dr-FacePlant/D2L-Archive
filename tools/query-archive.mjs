// Answers read-only application API queries from a downloaded export folder,
// offline, using the same organizers and API code the extension runs.
//
//   node tools/query-archive.mjs <export-folder> <method> ['{"param":"value"}'] [--since=<older-export-folder>]
//   node tools/query-archive.mjs "~/Downloads/D2L Export/d2l-api-export-..." dashboard.getUpcoming '{"horizonDays":30}'
//   node tools/query-archive.mjs <export-folder> system.getCapabilities     (lists every read method)
//
// --since ingests an older export first, so dashboard.getRecentChanges and
// sync.* describe what changed between the two archives.
import fs from "node:fs";
import path from "node:path";
import { loadBackgroundHooks } from "../tests/test-production-loader.mjs";

const args = process.argv.slice(2);
const since = args.find((arg) => arg.startsWith("--since="))?.slice("--since=".length);
const [exportDir, method, paramsJson = "{}"] = args.filter((arg) => !arg.startsWith("--since="));
if (!exportDir || !method) {
  console.error("Usage: node tools/query-archive.mjs <export-folder> <method> ['{\"param\":\"value\"}'] [--since=<older-export-folder>]");
  process.exit(2);
}

function readManifest(folder) {
  const file = path.join(folder, "manifest.json");
  if (!fs.existsSync(file)) throw new Error(`No manifest.json in ${folder}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const hooks = loadBackgroundHooks();
const repository = hooks.createArchiveRepository(hooks.createMemoryArchiveAdapter());
for (const folder of [since, exportDir].filter(Boolean)) {
  const manifest = readManifest(folder);
  await hooks.ingestAndOrganizeRows(manifest.rows || [], {
    repository,
    syncRunId: `offline-${path.basename(path.resolve(folder))}`,
    extractorVersion: manifest.crawlMeta?.extensionVersion || "",
    mode: "offline",
    ingestedAt: manifest.exportedAt || new Date().toISOString()
  });
}

const response = await hooks.handleAppApiRequest({
  type: "D2L_APP_API_REQUEST",
  protocolVersion: "1",
  requestId: "offline-cli",
  method,
  params: JSON.parse(paramsJson)
}, { repository });
// exitCode (not exit()) lets large results finish writing to a pipe.
process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
process.exitCode = response.ok ? 0 : 1;
