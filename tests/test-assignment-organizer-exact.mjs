import fs from "node:fs";
import path from "node:path";
import { loadBackgroundHooks } from "./test-production-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/semantic-organizer-v1.json"), "utf8"));
const hooks = loadBackgroundHooks();
const repository = hooks.createArchiveRepository(hooks.createMemoryArchiveAdapter(), { now: () => "2026-09-27T12:00:00.000Z" });
await repository.ingestRows(fixture.rows, { syncRunId: "organizer-fixture", extractorVersion: "0.8.139", ingestedAt: "2026-09-27T12:00:00.000Z" });
const evidence = (await repository.listEvidence({ courseId: "900001", limit: 500 })).items;
const knowledge = hooks.buildExactAssignmentKnowledge(evidence, { createdAt: "2026-09-27T12:05:00.000Z" });

if (knowledge.entities.length !== 2) throw new Error(`Expected two assignment entities, got ${knowledge.entities.length}`);
const primary = knowledge.entities.find((entity) => entity.entityId === "assignment:900001:70002");
const practice = knowledge.entities.find((entity) => entity.entityId === "assignment:900001:70099");
if (!primary || !practice) throw new Error("Assignment entities did not use folder identities");
// A submitted assignment whose grade column has a score is "graded", with the score kept.
if (primary.canonicalTitle !== "Project 2" || primary.status !== "graded" || primary.submissionCount < 1 || !primary.score?.displayed) throw new Error("Primary assignment state is incorrect");
if (!primary.urls?.d2l.includes("folder_submit_files.d2l?db=70002") || !primary.urls.history.includes("folders_history.d2l?db=70002")) throw new Error("Assignment D2L links are not exact");
if (practice.status === "submitted") throw new Error("Empty submission history incorrectly marked the practice assignment submitted");
if (!primary.dates.dueAt?.startsWith("2026-10-")) throw new Error("Primary assignment due date is missing");

const primaryRelationships = knowledge.relationships.filter((relationship) => relationship.fromId === primary.entityId);
const types = new Set(primaryRelationships.map((relationship) => relationship.type));
for (const expected of ["sameAs", "hasInstructions", "hasFile", "hasSubmission", "hasFeedback", "hasGrade", "hasDeadline"]) {
  if (!types.has(expected)) throw new Error(`Missing exact assignment relationship ${expected}`);
}
if (primaryRelationships.some((relationship) => relationship.classification !== "confirmed" || relationship.confidence !== 1)) {
  throw new Error("Exact relationships were not marked confirmed");
}
if (!primaryRelationships.some((relationship) => relationship.type === "hasFile" && relationship.evidence[0].signal === "matchingContentObjectId")) {
  throw new Error("Content attachment did not link indirectly through its instruction topic");
}
if (knowledge.relationships.some((relationship) => relationship.fromId === primary.entityId && relationship.toId.includes("70099"))) {
  throw new Error("Similarly named practice assignment was incorrectly linked");
}
if (knowledge.relationships.some((relationship) => relationship.fromId === practice.entityId && relationship.type === "hasSubmission")) {
  throw new Error("Empty submission history incorrectly created a submission relationship");
}

await repository.replaceCourseKnowledge("900001", "assignmentBundle", knowledge);
const bundle = await repository.getEntityBundle(primary.entityId);
if (!bundle || bundle.relationships.length !== primaryRelationships.length || bundle.evidence.length !== primaryRelationships.length) {
  throw new Error("Persisted assignment bundle is incomplete");
}

const rerun = hooks.buildExactAssignmentKnowledge(evidence, { createdAt: "2026-09-27T12:10:00.000Z" });
await repository.replaceCourseKnowledge("900001", "assignmentBundle", rerun);
const entities = await repository.listEntities({ courseId: "900001", entityType: "assignmentBundle" });
const relationships = await repository.listRelationships({ courseId: "900001" });
if (entities.length !== 2 || relationships.length !== knowledge.relationships.length) throw new Error("Organizer replacement was not idempotent");

console.log("Exact assignment organizer bundles misnamed evidence by platform IDs without title false positives.");
