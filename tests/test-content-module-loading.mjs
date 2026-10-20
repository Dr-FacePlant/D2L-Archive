import { loadContentHooks } from "./test-production-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const extensionVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8")).version;

const hooks = loadContentHooks();
const requiredHelpers = [
  "normalizeText",
  "looksLikeFileUrl",
  "isExternalResourceUrl",
  "isDiscussionAttachmentUrl",
  "discussionTopicIdFromUrl",
  "compactLabelValueRows",
  "quizIdsFromUrl",
  "quizScoreText",
  "quizQuestionRowsFromText",
  "gradeFeedbackRow",
  "extractVisiblePage",
  "discoverCrawlLinks",
  "installContentMessaging"
];

for (const helper of requiredHelpers) {
  if (typeof hooks[helper] !== "function") throw new Error(`Content module helper ${helper} did not load`);
}

const payload = hooks.extractVisiblePage();
if (payload.pageType !== "courseHome") throw new Error(`Expected executed courseHome extraction, got ${payload.pageType}`);
if (payload.extractor.version !== extensionVersion) throw new Error(`Expected executed extractor version ${extensionVersion}, got ${payload.extractor.version}`);
if (!Array.isArray(payload.items)) throw new Error("Executed extraction did not return an items array");

console.log("Content parser modules loaded and course-home extraction executed.");
