import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const archive = fs.mkdtempSync(path.join(os.tmpdir(), "d2l-verify-"));

try {
  fs.writeFileSync(path.join(archive, "manifest.json"), JSON.stringify({
    exportedAt: "2026-09-23T00:00:00.000Z",
    rows: [{
      courseOrgUnitId: "123",
      courseTitle: "Fixture Course",
      source: "assignment",
      title: "Fixture Assignment",
      dueAtText: "Sep 30, 2026",
      columns: "{}",
      ids: "{}"
    }],
    pages: [],
    audit: { totals: { failed: 0, uncertain: 0 } }
  }));

  const result = spawnSync(process.execPath, [path.join(repoRoot, "tools", "verify-archive.mjs"), archive], {
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error(result.stderr || "Archive verifier exited unsuccessfully");

  for (const name of [
    "offline-verification.md",
    "offline-action-brief.md",
    "offline-student-questions.md",
    "offline-ai-index.jsonl"
  ]) {
    if (!fs.existsSync(path.join(archive, name))) throw new Error(`Archive verifier did not write ${name}`);
  }
  if (!fs.readFileSync(path.join(archive, "offline-verification.md"), "utf8").includes("Rows: 1")) {
    throw new Error("Archive verifier summary did not count fixture evidence");
  }
  if (!fs.readFileSync(path.join(archive, "offline-ai-index.jsonl"), "utf8").includes("Fixture Course")) {
    throw new Error("Archive verifier AI index did not include fixture evidence");
  }
} finally {
  fs.rmSync(archive, { recursive: true, force: true });
}

console.log("Archive verifier CLI smoke test passed.");
