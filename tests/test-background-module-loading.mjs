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

console.log("Background modules loaded in service-worker import order.");
