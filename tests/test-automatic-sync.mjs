import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const background = fs.readFileSync(path.join(repoRoot, "background.js"), "utf8");
const sync = fs.readFileSync(path.join(repoRoot, "src/background/same-tab-sync.js"), "utf8");
const exportSource = fs.readFileSync(path.join(repoRoot, "src/background/export.js"), "utf8");
const bridge = fs.readFileSync(path.join(repoRoot, "src/content/bridges.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));

function check(value, message) {
  if (!value) throw new Error(message);
}

check(manifest.permissions.includes("alarms"), "automatic sync needs the alarms permission");
check(background.includes('"student-archive-brief-sync"') && background.includes("periodInMinutes: 2"), "the persistent queue should wake every two minutes");
check(background.includes("handleAutomaticSyncAlarm") && background.includes("drainSyncQueue({ maxJobs: 3 })"), "alarm handler should run a bounded batch of priority category jobs");
check(!background.includes("startAutomaticSync") && !background.includes("AUTO_SYNC_PERIOD_MINUTES"), "legacy hidden-tab full-export loops should be retired");
check(background.includes("chrome.tabs?.onUpdated?.addListener") && background.includes("D2L_SYNC_ENQUEUE_PRIORITY"), "D2L page readiness and dashboard visits should wake priority sync");
check(sync.includes("CHECKPOINT_PREFIX") && sync.includes("completedIds") && sync.includes("writeCheckpoint"), "same-tab API collection checkpoints completed courses");
check(exportSource.includes("probeCacheKey") && exportSource.includes("deltaProbes") && exportSource.includes("completeCourseSnapshot: crawlMeta.completeCourseSnapshot === true"), "deep exports persist delta probes without treating partial runs as complete snapshots");
check(bridge.includes("const deltaProbes") && bridge.includes("deltaProbes"), "the D2L bridge forwards delta mode");
const queue = fs.readFileSync(path.join(repoRoot, "src/background/sync-queue.js"), "utf8");
check(queue.includes("const maxJobs") && queue.includes("accountId"), "queue worker should be bounded and account-scoped");
check(queue.includes("discoverPriorityCourses") && queue.includes('type: "D2L_CURRENT_COURSES"'), "an empty archive should discover current course IDs through the verified D2L tab before queueing");
check(queue.includes("categoryFreshness: { [category]: result }") && queue.includes("completeCourseSnapshot: false"), "short refresh should commit category results without deleting out-of-scope evidence");

console.log("Priority queue alarms, bounded refreshes, delta probes, and resumable checkpoint contracts passed.");
