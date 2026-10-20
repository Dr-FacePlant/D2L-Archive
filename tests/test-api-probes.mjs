import { loadContentHooks } from "./test-production-loader.mjs";

const { apiProbeStatus, addApiProbeRow } = loadContentHooks();

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

assertEqual(apiProbeStatus(200), "available", "200 maps to available");
assertEqual(apiProbeStatus(403), "blocked", "403 maps to blocked");
assertEqual(apiProbeStatus(404), "notEnabledOrHidden", "404 maps to notEnabledOrHidden");
assertEqual(apiProbeStatus(0), "unreachable", "0 maps to unreachable");
assertEqual(apiProbeStatus(500), "unavailable", "500 maps to unavailable");

const rows = [];
addApiProbeRow(rows, "123", "assignment my submissions", 200, { evidenceCount: 0, dropboxFolderId: 44 }, { includeAvailable: true });
addApiProbeRow(rows, "123", "quiz attempts", 200, { evidenceCount: 2, quizId: 55 }, { includeAvailable: true });
addApiProbeRow(rows, "123", "discussion posts", 403, { discussionTopicId: 66 });
addApiProbeRow(rows, "123", "grade values", 200, { evidenceCount: 9 });

assertEqual(rows.length, 3, "available probes without includeAvailable are omitted");
assertEqual(rows[0].status, "availableEmpty", "successful empty probe records availableEmpty");
assertEqual(rows[0].ids.dropboxFolderId, "44", "assignment probe keeps folder id");
assertEqual(rows[1].status, "available", "successful probe with evidence records available");
assertEqual(rows[1].ids.quizId, "55", "quiz probe keeps quiz id");
assertEqual(rows[2].status, "blocked", "blocked probe records blocked");
assertEqual(rows[2].ids.discussionTopicId, "66", "discussion probe keeps topic id");

console.log("API probe production tests passed.");
