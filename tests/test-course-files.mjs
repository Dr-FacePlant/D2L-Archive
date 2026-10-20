import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadBackgroundHooks, createMemoryAccountEnvironment } from "./test-production-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/semantic-organizer-v1.json"), "utf8"));
const NOW = () => "2026-10-07T12:00:00.000Z";
// Values from the extension's own realm compare structurally only after a copy.
const plain = (value) => JSON.parse(JSON.stringify(value));

// A second course whose work is dated far ahead, so its upcoming list is never empty.
const laterRows = fixture.rows.map((row) => JSON.parse(JSON.stringify(row)
  .replaceAll("900001", "900002")
  .replaceAll("Synthetic Art Course", "Synthetic Later Course")
  .replaceAll("2026", "2099")));
const exportRows = () => JSON.parse(JSON.stringify([...fixture.rows, ...laterRows]));

const downloads = [];
const hooks = loadBackgroundHooks({
  chrome: {
    runtime: { getURL: (file = "") => `chrome-extension://testid/${file}` },
    downloads: {
      download: async ({ filename, url }) => { downloads.push({ filename, url }); return downloads.length; },
      search: async () => [{ state: "complete", filename: "/Users/x/Downloads/D2L Export/parity/file" }],
      erase: async () => [],
      onChanged: { addListener() {}, removeListener() {} }
    }
  }
});
const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a", now: NOW });
const repositoryA = await env.registry.repositoryFor("acct-a");

// 1. Export parity: the files the export writes equal the files built from the archive it left behind.
await hooks.downloadResults(exportRows(), [], "D2L Export/parity", { repository: repositoryA, accountId: "acct-a", mode: "test" });
const decode = ({ url }) => decodeURIComponent(url.slice(url.indexOf(",") + 1));
const exported = new Map();
for (const entry of downloads) {
  const match = entry.filename.match(/^D2L Export\/parity\/courses\/([^/]+)\/(knowledge-index\.json|course-summary\.md)$/);
  if (!match) continue;
  const folder = exported.get(match[1]) || { folder: match[1] };
  folder[match[2] === "knowledge-index.json" ? "knowledgeIndex" : "summary"] = decode(entry);
  exported.set(match[1], folder);
}
const exportedByCourse = new Map([...exported.values()].map((files) => [JSON.parse(files.knowledgeIndex).courseOrgUnitId, files]));
assert.deepEqual([...exportedByCourse.keys()].sort(), ["900001", "900002"], "the export should write both courses' files");

const downloadsBefore = downloads.length;
const built = await hooks.buildArchiveCourseFiles(repositoryA);
assert.equal(downloads.length, downloadsBefore, "building course files from the archive must not download anything");
assert.deepEqual(plain(built.map((course) => course.courseId)).sort(), ["900001", "900002"]);
for (const course of built) {
  const files = exportedByCourse.get(course.courseId);
  assert.equal(course.knowledgeIndexJson, files.knowledgeIndex, `knowledge-index.json differs from the export for ${course.courseId}`);
  assert.equal(course.courseSummaryMarkdown, files.summary, `course-summary.md differs from the export for ${course.courseId}`);
}
// The compared files carry real content, not two empty shells.
const artIndex = JSON.parse(exportedByCourse.get("900001").knowledgeIndex);
assert.ok(artIndex.entities.some((entity) => entity.entityId === "assignment:900001:70002") && artIndex.relationships.length > 0 && artIndex.organizerVersion);
assert.ok(artIndex.entities.every((entity) => entity.courseId === "900001"), "a course file leaked another course's entities");
assert.match(exportedByCourse.get("900002").summary, /^# Synthetic Later Course\n[\s\S]*## Upcoming\n\n- 2099-/);

// 2. Account isolation: only the requested account's archive is read.
const repositoryB = await env.registry.repositoryFor("acct-b");
await hooks.ingestAndOrganizeRows(JSON.parse(JSON.stringify(fixture.rows).replaceAll("900001", "900003").replaceAll("Synthetic Art Course", "Account B Course")), { repository: repositoryB, mode: "test" });
const builtB = await hooks.buildArchiveCourseFiles(repositoryB);
assert.deepEqual(plain(builtB.map((course) => course.courseId)), ["900003"], "account B's build saw another account's courses");

console.log("Course files built from the archive match the export and stay inside the verified account.");
