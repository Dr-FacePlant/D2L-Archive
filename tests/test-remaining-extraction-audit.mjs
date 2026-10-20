import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const archiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), "d2l-remaining-audit-"));

function assertIncludes(text, snippet, label) {
  if (!text.includes(snippet)) {
    throw new Error(`${label}: missing ${JSON.stringify(snippet)}`);
  }
}

const manifest = {
  exportedAt: "2026-09-21T00:00:00.000Z",
  rows: [
    {
      source: "gradeItem",
      title: "Essay",
      columns: JSON.stringify({ gradeObjectId: 55 })
    },
    {
      source: "gradeFeedback",
      title: "Essay feedback",
      columns: JSON.stringify({ feedbackText: "Good work", rubricText: "Criterion A" })
    },
    {
      source: "announcement",
      title: "Exam review",
      ids: { courseOrgUnitId: "9900002", newsItemId: "123" }
    },
    {
      source: "announcementAttachment",
      title: "Review PDF",
      ids: { courseOrgUnitId: "9900002", newsItemId: "123", fileId: "99" }
    },
    {
      source: "contentTopic",
      title: "Week 1",
      localPath: "courses/Test/pages/week-1.md",
      localPageTextPath: "courses/Test/pages/week-1.md"
    },
    {
      source: "apiProbe",
      type: "quiz attempts",
      status: "blocked",
      title: "Attempt probe"
    }
  ],
  pages: [
    { crawlTask: { requestedUrl: "https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=9900002" } },
    { crawlTask: { requestedUrl: "https://kennesaw.view.usg.edu/d2l/le/news/9900002/123/view" } },
    { crawlTask: { requestedUrl: "https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_summary.d2l?ou=9900002&qi=77" } }
  ],
  audit: {
    totals: {
      apiSummary: {
        quizProbePages: { visited: 1, failed: 0, rows: 1 },
        announcementProbePages: { visited: 1, failed: 0, rows: 2 },
        gradeProbePages: { visited: 1, failed: 0, rows: 2 }
      }
    }
  },
  changeReport: {
    available: true,
    totals: { added: 1, changed: 0, newlyFeedback: 1 }
  }
};

fs.writeFileSync(path.join(archiveRoot, "manifest.json"), JSON.stringify(manifest, null, 2));

const result = spawnSync(process.execPath, [path.join(repoRoot, "tools", "audit-remaining-extraction.mjs"), archiveRoot], {
  cwd: root,
  encoding: "utf8",
  stdio: "pipe"
});

if (result.status !== 0) {
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  throw new Error(`remaining extraction audit exited ${result.status}`);
}

const md = fs.readFileSync(path.join(archiveRoot, "remaining-extraction-audit.md"), "utf8");
const json = JSON.parse(fs.readFileSync(path.join(archiveRoot, "remaining-extraction-audit.json"), "utf8"));

assertIncludes(md, "- API route: /d2l/api/le/(version)/(orgUnitId)/grades/, /grades/values/myGradeValues/", "remaining audit markdown includes grade API route guidance");
assertIncludes(md, "- UI proof: grades/my_grades/main.d2l", "remaining audit markdown includes grade UI proof guidance");
assertIncludes(md, "- Proof rows/signals: gradeItem, gradeFeedback, rubricFeedback, rubricCriterionFeedback", "remaining audit markdown includes grade proof row guidance");
assertIncludes(md, "- API route: /d2l/api/le/(version)/(orgUnitId)/news/, /news/(newsItemId)/attachments/(fileId)", "remaining audit markdown includes announcement attachment API guidance");
assertIncludes(md, "- Proof rows/signals: change-report.md, change-report.json, student-action-brief.md, newlyFeedback, dueChanged, availabilityChanged", "remaining audit markdown includes change detection proof signals");

const gradeArea = json.areas.find((area) => area.id === "grade_feedback");
const changeArea = json.areas.find((area) => area.id === "change_detection");
if (gradeArea?.apiRoute !== "/d2l/api/le/(version)/(orgUnitId)/grades/, /grades/values/myGradeValues/") {
  throw new Error("remaining audit JSON preserves grade API route guidance");
}
if (!String(changeArea?.proofRows || "").includes("newlyFeedback")) {
  throw new Error("remaining audit JSON preserves change detection proof signals");
}

console.log("Remaining extraction audit tests passed.");
