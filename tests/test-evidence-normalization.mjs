import fs from "node:fs";
import path from "node:path";
import { loadSharedHooks } from "./test-production-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures/semantic-organizer-v1.json"), "utf8"));
const { normalizeEvidenceRow, evidenceIdentity } = loadSharedHooks();

const options = { extractorVersion: "0.8.139", syncRunId: "synthetic-run" };
const evidence = fixture.rows.map((row) => normalizeEvidenceRow(row, options));

if (evidence.length !== fixture.rows.length) throw new Error("Every fixture row must normalize");
if (new Set(evidence.map((record) => record.evidenceId)).size !== evidence.length) {
  throw new Error("Synthetic evidence identities collided");
}

const assignment = evidence.find((record) => record.source === "assignment" && record.platformIds.assignmentFolderId === "70002");
if (!assignment) throw new Error("Primary assignment did not normalize");
if (assignment.evidenceId !== "900001:assignment:dropboxFolderId:70002") throw new Error(`Unexpected assignment identity: ${assignment.evidenceId}`);
if (!assignment.dates.dueAt?.startsWith("2026-10-")) throw new Error(`Assignment due date did not normalize: ${assignment.dates.dueAt}`);
if (assignment.fields.raw.title !== "Project 2") throw new Error("Original row was not preserved");
if (assignment.provenance.syncRunId !== "synthetic-run") throw new Error("Sync provenance was not retained");

const attachment = evidence.find((record) => record.source === "contentAttachment");
if (attachment?.evidenceId !== "900001:contentAttachment:fileId:81002") {
  throw new Error(`Content attachment did not prefer file identity: ${attachment?.evidenceId}`);
}
const submission = evidence.find((record) => record.source === "assignmentSubmission");
if (submission?.evidenceId !== "900001:assignmentSubmission:submissionId:91002") {
  throw new Error(`Submission did not prefer submission identity: ${submission?.evidenceId}`);
}

const repeated = normalizeEvidenceRow({ ...fixture.rows[0], crawledAt: "2026-10-01T12:00:00.000Z" }, options);
if (repeated.evidenceId !== assignment.evidenceId) throw new Error("Identity changed with crawl timestamp");
if (repeated.contentHash !== assignment.contentHash) throw new Error("Content hash changed with crawl timestamp");

const relocated = normalizeEvidenceRow({
  ...fixture.rows[0],
  localPath: "D2L Export/a-different-run/courses/900001/files/item.docx",
  localPageTextPath: "D2L Export/a-different-run/courses/900001/pages/page.md",
  localPageTextSnippet: "A snapshot excerpt that is stored separately from normalized evidence."
}, options);
if (relocated.contentHash !== assignment.contentHash) throw new Error("Content hash changed with archive-local paths");

const invalidJson = normalizeEvidenceRow({
  courseOrgUnitId: "900001",
  source: "note",
  title: "Invalid JSON survives",
  ids: "{broken",
  columns: "{broken"
}, options);
if (!invalidJson.evidenceId || Object.keys(invalidJson.platformIds).length) throw new Error("Invalid JSON was not handled safely");

const fallbackA = evidenceIdentity({ courseOrgUnitId: "900001", source: "note", title: "Stable fallback", ids: "{}", columns: "{}" });
const fallbackB = evidenceIdentity({ courseOrgUnitId: "900001", source: "note", title: "Stable fallback", ids: "{}", columns: "{}", crawledAt: "later" });
if (fallbackA !== fallbackB) throw new Error("Fallback identity is not deterministic");

const courseProbeA = evidenceIdentity({ courseOrgUnitId: "900001", source: "apiProbe", title: "checklists API 200", ids: JSON.stringify({ courseOrgUnitId: "900001" }), columns: "{}", itemUrl: "https://kennesaw.view.usg.edu/d2l/home/900001" });
const courseProbeB = evidenceIdentity({ courseOrgUnitId: "900001", source: "apiProbe", title: "surveys API 200", ids: JSON.stringify({ courseOrgUnitId: "900001" }), columns: "{}", itemUrl: "https://kennesaw.view.usg.edu/d2l/home/900001" });
if (courseProbeA === courseProbeB) throw new Error("Course-wide API probe identities collided");
if (!courseProbeA.includes(":apiProbe:course:probe:")) throw new Error(`Course-wide API probe identity lost its probe kind: ${courseProbeA}`);

const classlistA = evidenceIdentity({ courseOrgUnitId: "900001", source: "classlistEntry", title: "Student A", ids: JSON.stringify({ userId: "41" }), columns: "{}", itemUrl: "https://kennesaw.view.usg.edu/d2l/lms/classlist/classlist.d2l?ou=900001" });
const classlistB = evidenceIdentity({ courseOrgUnitId: "900001", source: "classlistEntry", title: "Student B", ids: JSON.stringify({ userId: "42" }), columns: "{}", itemUrl: "https://kennesaw.view.usg.edu/d2l/lms/classlist/classlist.d2l?ou=900001" });
if (classlistA === classlistB || !classlistA.includes(":userId:41")) throw new Error("Classlist identities did not preserve user IDs");

const announcementLinkA = evidenceIdentity({ courseOrgUnitId: "900001", source: "announcementLink", title: "Resource A", ids: JSON.stringify({ newsItemId: "81" }), columns: "{}", itemUrl: "https://example.edu/a" });
const announcementLinkB = evidenceIdentity({ courseOrgUnitId: "900001", source: "announcementLink", title: "Resource B", ids: JSON.stringify({ newsItemId: "81" }), columns: "{}", itemUrl: "https://example.edu/b" });
if (announcementLinkA === announcementLinkB) throw new Error("Announcement links with different URLs collided");

const topicA = evidenceIdentity({ courseOrgUnitId: "900001", source: "discussionTopic", title: "Topic A", ids: JSON.stringify({ discussionForumId: "7", discussionTopicId: "71" }), columns: "{}" });
const topicB = evidenceIdentity({ courseOrgUnitId: "900001", source: "discussionTopic", title: "Topic B", ids: JSON.stringify({ discussionForumId: "7", discussionTopicId: "72" }), columns: "{}" });
if (topicA === topicB || !topicA.includes(":discussionTopicId:71")) throw new Error("Topics in one forum collapsed into the forum identity");
const categoryA = evidenceIdentity({ courseOrgUnitId: "900001", source: "gradeCategory", title: "Quizzes", ids: JSON.stringify({ gradeCategoryId: "61" }), columns: "{}", itemUrl: "https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=900001" });
const categoryB = evidenceIdentity({ courseOrgUnitId: "900001", source: "gradeCategory", title: "Discussions", ids: JSON.stringify({ gradeCategoryId: "62" }), columns: "{}", itemUrl: "https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=900001" });
if (categoryA === categoryB) throw new Error("Grade categories on one page collapsed into one identity");
console.log("Evidence normalization is lossless, stable, and source-aware.");
