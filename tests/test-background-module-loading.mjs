import fs from "node:fs";
import { loadBackgroundHooks } from "./test-production-loader.mjs";

const hooks = loadBackgroundHooks();
const requiredHelpers = [
  "assignmentProbeTasksFromApiItems",
  "quizProbeTasksFromApiItems",
  "announcementProbeTasksFromApiItems",
  "gradeProbeTasksForCourse",
  "courseToolProbeTasksForCourse",
  "collectApiRows",
  "createMemoryArchiveAdapter",
  "createArchiveRepository",
  "createIndexedDbArchiveAdapter",
  "openArchiveDatabase",
  "handleAppApiRequest",
  "configureAccountRegistry",
  "createAccountRegistry",
  "repositoryForAccount",
  "buildExactAssignmentKnowledge",
  "ingestAndOrganizeRows",
  "aiIndexRecord",
  "summarizeChanges",
  "extensionForRow",
  "archivePathFromDownloadItem"
];

for (const helper of requiredHelpers) {
  if (typeof hooks[helper] !== "function") throw new Error(`Background module helper ${helper} did not load`);
}

// The export-probes module takes its helpers from the shared namespace. A split
// that drops one from the destructure throws a ReferenceError only when a page
// probe runs, which no other test does, so call the exposed ones here.
const failedPages = hooks.apiCollectionFailurePages({ collectionFailures: [{ orgUnitId: 42, error: "  probe failed  " }] }, {});
if (failedPages.length !== 1 || failedPages[0].course.title !== "42" || failedPages[0].error !== "probe failed") {
  throw new Error("export probe failure pages lost their normalized text");
}
const safeUrls = hooks.safePageProbeUrls(["https://kennesaw.view.usg.edu/d2l/home/42", "javascript:alert(1)"]);
if (safeUrls.length !== 1) throw new Error("page probe url filtering changed");
const summary = hooks.apiExportSummary({ collectionFailures: [{ orgUnitId: 42 }] });
if (summary.failed.length !== 1 || summary.courses.length !== 0) throw new Error("api export summary changed");

// Every name a background module takes from `shared` must be assigned by some
// src/shared module; otherwise the module reads undefined and throws on use.
const sharedKeys = new Set();
const sharedDir = new URL("../src/shared/", import.meta.url);
for (const name of fs.readdirSync(sharedDir).filter((entry) => entry.endsWith(".js"))) {
  const text = fs.readFileSync(new URL(name, sharedDir), "utf8");
  for (const m of text.matchAll(/Object\.assign\(shared,\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const key = part.split(":").pop().trim();
      if (key) sharedKeys.add(key);
    }
  }
  for (const m of text.matchAll(/shared\.([A-Za-z_$][\w$]*)\s*=/g)) sharedKeys.add(m[1]);
}
const backgroundDir = new URL("../src/background/", import.meta.url);
for (const name of fs.readdirSync(backgroundDir).filter((entry) => entry.endsWith(".js"))) {
  const text = fs.readFileSync(new URL(name, backgroundDir), "utf8");
  for (const m of text.matchAll(/const\s*\{([^}]*)\}\s*=\s*shared\s*;/g)) {
    for (const part of m[1].split(",")) {
      const key = part.split(":").pop().trim();
      if (key && !sharedKeys.has(key)) throw new Error(`${name} takes "${key}" from shared, but no src/shared module assigns it`);
    }
  }
}

console.log("Background modules loaded in service-worker import order.");
