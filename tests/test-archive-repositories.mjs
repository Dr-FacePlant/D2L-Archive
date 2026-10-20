import fs from "node:fs";
import path from "node:path";
import { loadBackgroundHooks } from "./test-production-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/semantic-organizer-v1.json"), "utf8"));
const { createMemoryArchiveAdapter, createArchiveRepository } = loadBackgroundHooks();
const adapter = createMemoryArchiveAdapter();
const repository = createArchiveRepository(adapter, { now: () => "2026-09-27T12:00:00.000Z" });

const first = await repository.ingestRows(fixture.rows, {
  syncRunId: "fixture-1",
  extractorVersion: "0.8.139",
  ingestedAt: "2026-09-27T12:00:00.000Z"
});
if (first.counts.added !== fixture.rows.length || first.counts.updated !== 0 || first.counts.courses !== 1) {
  throw new Error(`Unexpected first ingest: ${JSON.stringify(first.counts)}`);
}

const second = await repository.ingestRows(fixture.rows, {
  syncRunId: "fixture-2",
  extractorVersion: "0.8.139",
  ingestedAt: "2026-09-27T13:00:00.000Z"
});
if (second.counts.unchanged !== fixture.rows.length || second.counts.added || second.counts.updated) {
  throw new Error(`Re-ingestion was not idempotent: ${JSON.stringify(second.counts)}`);
}

const changedRows = fixture.rows.map((row) => ({ ...row }));
const feedback = changedRows.find((row) => row.source === "assignmentFeedback");
feedback.description = "Updated instructor feedback.";
feedback.columns = JSON.stringify({ scoreText: "94 / 100", feedbackText: "Updated instructor feedback." });
const third = await repository.ingestRows(changedRows, {
  syncRunId: "fixture-3",
  extractorVersion: "0.8.139",
  ingestedAt: "2026-09-27T14:00:00.000Z"
});
if (third.counts.updated !== 1 || third.counts.unchanged !== fixture.rows.length - 1) {
  throw new Error(`Changed evidence did not create one revision: ${JSON.stringify(third.counts)}`);
}

const courses = await repository.listCourses({ active: true });
if (courses.length !== 1 || courses[0].courseId !== "900001" || courses[0].sourceRecordIds.length !== fixture.rows.length) {
  throw new Error("Course repository did not retain its evidence references");
}
const assignments = await repository.listEvidence({ courseId: "900001", source: "assignment", limit: 1 });
if (assignments.total !== 2 || assignments.items.length !== 1 || assignments.limit !== 1) {
  throw new Error("Evidence filtering or pagination failed");
}
const updatedFeedback = await repository.getEvidence(third.evidenceIds.find((id) => id.includes("assignmentFeedback")));
if (updatedFeedback.revision !== 2 || updatedFeedback.description !== "Updated instructor feedback.") {
  throw new Error("Latest evidence revision was not stored");
}
if (adapter.data.evidenceRevisions.size !== 1) throw new Error("Prior evidence revision was not preserved");

const snapshotRows = changedRows.filter((row) => row.source !== "assignmentFeedback");
const snapshot = await repository.ingestRows(snapshotRows, {
  syncRunId: "fixture-4",
  extractorVersion: "0.8.143",
  ingestedAt: "2026-09-27T15:00:00.000Z",
  completeCourseSnapshot: true
});
if (snapshot.counts.removed !== 1) throw new Error(`Complete snapshot did not remove missing evidence: ${JSON.stringify(snapshot.counts)}`);
if (await repository.getEvidence(updatedFeedback.evidenceId)) throw new Error("Removed snapshot evidence remained current");
if (!adapter.data.evidenceRevisions.has(`${updatedFeedback.evidenceId}::2`)) throw new Error("Removed evidence was not preserved in revision history");

const status = await repository.getDatabaseStatus();
if (status.databaseRevision !== 4 || status.counts.evidence !== snapshotRows.length || status.counts.syncRuns !== 4) {
  throw new Error(`Unexpected database status: ${JSON.stringify(status)}`);
}

try {
  await adapter.runTransaction(["meta"], "readwrite", async ({ meta }) => {
    await meta.put({ key: "rollback-test", value: true });
    throw new Error("rollback");
  });
} catch {}
if (adapter.data.meta.has("rollback-test")) throw new Error("Memory transaction did not roll back");

console.log("Archive repositories ingest idempotently, preserve revisions, paginate, and roll back failures.");
