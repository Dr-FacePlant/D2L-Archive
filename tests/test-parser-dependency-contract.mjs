import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");

const contracts = [
  {
    file: "src/content/parsers/calendar-tools.js",
    helpers: ["looksLikeFileUrl", "linkRecord", "extractTableRows", "discussionAttachmentRowFromLink", "extractAnnouncements"]
  },
  {
    file: "src/content/parsers/discussions.js",
    helpers: ["looksLikeFileUrl", "isDiscussionAttachmentUrl"]
  },
  {
    file: "src/content/parsers/assignments.js",
    helpers: ["headingText", "pageText"]
  },
  {
    file: "src/content/parsers/quizzes-grades.js",
    helpers: ["extractTableRows", "headingText", "pageText", "compactLabelValueRows"]
  },
  {
    file: "src/content/api/assessments.js",
    helpers: ["gradeDisplay"]
  }
];

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
const scripts = manifest.content_scripts[0].js;
const assignmentsIndex = scripts.indexOf("src/content/parsers/assignments.js");
const announcementsIndex = scripts.indexOf("src/content/parsers/announcements.js");
const calendarToolsIndex = scripts.indexOf("src/content/parsers/calendar-tools.js");
if (assignmentsIndex < 0 || announcementsIndex < 0 || calendarToolsIndex < 0
  || assignmentsIndex > calendarToolsIndex || announcementsIndex > calendarToolsIndex) {
  throw new Error("calendar-tools.js must load after its assignments and announcements parser dependencies");
}

for (const contract of contracts) {
  const source = fs.readFileSync(path.join(repoRoot, contract.file), "utf8");
  const declaration = source.match(/const\s*\{([\s\S]*?)\}\s*=\s*content\s*;/)?.[1] || "";
  for (const helper of contract.helpers) {
    if (!new RegExp(`\\b${helper}\\b`).test(declaration)) {
      throw new Error(`${contract.file} uses ${helper} without importing it from the content namespace`);
    }
  }
}

console.log("Content parser runtime dependencies are declared.");
