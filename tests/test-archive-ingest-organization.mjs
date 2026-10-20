import fs from "node:fs";
import path from "node:path";
import { loadBackgroundHooks } from "./test-production-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/semantic-organizer-v1.json"), "utf8"));
const hooks = loadBackgroundHooks();
const repository = hooks.createArchiveRepository(hooks.createMemoryArchiveAdapter(), { now: () => "2026-09-27T15:00:00.000Z" });

const result = await hooks.ingestAndOrganizeRows(fixture.rows, {
  repository,
  syncRunId: "vertical-slice",
  extractorVersion: "0.8.140",
  mode: "test",
  ingestedAt: "2026-09-27T15:00:00.000Z"
});

if (result.ingest.added !== fixture.rows.length || result.courses.length !== 1) throw new Error("Vertical ingest counts are incorrect");
const extractionStates = result.entities.filter((entity) => entity.entityType === "extractionState");
const domainEntities = result.entities.filter((entity) => entity.entityType !== "extractionState");
if (domainEntities.length !== 5 || extractionStates.length !== 19 || result.relationshipCount < 12) {
  throw new Error("Vertical organizer did not persist domain knowledge and the extraction capability matrix");
}
if (!result.entities.some((entity) => entity.entityId === "assignment:900001:70002")) throw new Error("Primary assignment entity is absent");
if (!result.entities.some((entity) => entity.entityId === "grade:900001:93002")) throw new Error("Grade record entity is absent");
if (!result.entities.some((entity) => entity.entityId === "resource:900001:80002")) throw new Error("Learning resource entity is absent");
if (!result.entities.some((entity) => entity.entityId === "calendar:900001:92002")) throw new Error("Calendar event entity is absent");
if (!result.relationships.some((relationship) => relationship.type === "hasFile")) throw new Error("Assignment file relationship is absent");

const status = await repository.getDatabaseStatus();
if (status.counts.evidence !== fixture.rows.length || status.counts.entities !== result.entityCount || status.counts.relationships !== result.relationshipCount) {
  throw new Error(`Persistent status disagrees with organizer output: ${JSON.stringify(status)}`);
}

const secondCourse = await hooks.ingestAndOrganizeRows([{
  ...fixture.rows.find((row) => row.source === "contentTopic"),
  courseOrgUnitId: "900002",
  courseTitle: "Second Synthetic Course",
  ids: JSON.stringify({ courseOrgUnitId: "900002", contentObjectId: "81002" })
}], {
  repository,
  syncRunId: "second-course-slice",
  extractorVersion: "0.8.156",
  mode: "test",
  ingestedAt: "2026-09-27T15:10:00.000Z"
});
if (!secondCourse.entities.length || secondCourse.entities.some((entity) => entity.courseId !== "900002")) {
  throw new Error("Ingest result leaked persistent entities from a course outside the current archive");
}
if (!(await repository.listEntities({ courseId: "900001" })).length) throw new Error("Archive scoping removed persistent knowledge for another course");

console.log("Archive vertical slice ingests evidence, organizes assignments, and returns portable knowledge output.");
