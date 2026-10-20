import fs from "node:fs";
import path from "node:path";
import { loadBackgroundHooks, useRepositoryForAccount } from "./test-production-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/semantic-organizer-v1.json"), "utf8"));
const listeners = [];
const hooks = loadBackgroundHooks({
  chrome: { runtime: { onMessage: { addListener(listener) { listeners.push(listener); } } } }
});
const adapter = hooks.createMemoryArchiveAdapter();
const repository = hooks.createArchiveRepository(adapter, { now: () => "2026-09-27T12:00:00.000Z" });
useRepositoryForAccount(hooks, repository);

await repository.ingestRows(fixture.rows, {
  syncRunId: "api-routing-fixture",
  extractorVersion: "0.8.139",
  ingestedAt: "2026-09-27T12:00:00.000Z"
});
const evidence = (await repository.listEvidence({ courseId: "900001", limit: 500 })).items;
await repository.replaceCourseKnowledge(
  "900001",
  "assignmentBundle",
  hooks.buildExactAssignmentKnowledge(evidence, { createdAt: "2026-09-27T12:05:00.000Z" })
);

if (listeners.length !== 1) throw new Error(`Expected one production background listener, got ${listeners.length}`);
const request = (method, params = {}) => new Promise((resolve, reject) => {
  const message = {
    type: "D2L_APP_API_REQUEST",
    protocolVersion: "1",
    requestId: `${method}-request`,
    method,
    params
  };
  const keepAlive = listeners[0](message, { id: "extension-test" }, resolve);
  if (keepAlive !== true) reject(new Error(`${method} did not keep the response channel alive`));
});

const capabilities = await request("system.getCapabilities");
if (!capabilities.ok || !capabilities.data.readMethods.includes("evidence.list") || !capabilities.data.readMethods.includes("sync.getQueue")) throw new Error("Capabilities did not route through production listener");

const courses = await request("courses.list", { active: true });
if (!courses.ok || courses.data.items.length !== 1 || courses.meta.databaseRevision !== 1) throw new Error("Course API response is invalid");

const assignments = await request("evidence.list", { courseId: "900001", source: "assignment", limit: 10 });
if (!assignments.ok || assignments.data.total !== 2) throw new Error("Evidence list did not filter through production API");

const bundle = await request("entities.getBundle", { entityId: "assignment:900001:70002" });
if (!bundle.ok || bundle.data.entity.canonicalTitle !== "Project 2" || bundle.data.relationships.length < 7) {
  throw new Error("Semantic assignment bundle did not route through production API");
}

const assignmentList = await request("assignments.list", { courseId: "900001" });
if (!assignmentList.ok || assignmentList.data.items.length !== 2) throw new Error("Assignment list API did not expose assignment bundles");

const queue = await request("sync.getQueue", { courseIds: ["900001"], accountId: "test-account" });
if (!queue.ok || !Array.isArray(queue.data.jobs) || queue.data.freshness["900001"] !== null) throw new Error("Sync queue status did not use the production app API");

const missing = await request("courses.get", { courseId: "not-real" });
if (missing.ok || missing.error.code !== "NOT_FOUND") throw new Error("Missing course did not return stable NOT_FOUND response");

const mutation = await request("archive.ingestRows", { rows: [] });
if (mutation.ok || mutation.error.code !== "METHOD_NOT_FOUND") throw new Error("Page-facing listener exposed raw archive mutation");

console.log("Production background listener exposes paginated read APIs and rejects raw mutation.");
