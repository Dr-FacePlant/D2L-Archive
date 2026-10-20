import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const downloadsRoot = path.join(os.homedir(), "Downloads", "D2L Export");
const input = process.argv[2] || newestExport(downloadsRoot);

if (!input) {
  console.error("Usage: node tools/audit-remaining-extraction.mjs [archive-folder]");
  process.exit(1);
}

const archiveRoot = path.resolve(input);
const manifestPath = path.join(archiveRoot, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`No manifest.json found in ${archiveRoot}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const rows = Array.isArray(manifest.rows) ? manifest.rows : [];
const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
const audit = manifest.audit || {};
const changeReport = manifest.changeReport || {};

function newestExport(root) {
  if (!fs.existsSync(root)) return "";
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^d2l-export-/.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(root, entry.name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.fullPath || "";
}

function hasSource(...sources) {
  const sourceSet = new Set(sources);
  return rows.some((row) => sourceSet.has(row.source));
}

function countSource(...sources) {
  const sourceSet = new Set(sources);
  return rows.filter((row) => sourceSet.has(row.source)).length;
}

function countPages(pattern) {
  return pages.filter((page) => pattern.test([
    page?.page?.url,
    page?.crawlTask?.requestedUrl,
    page?.pageUrl,
    page?.pageType,
    page?.page?.title
  ].filter(Boolean).join(" "))).length;
}

function countRows(pattern) {
  return rows.filter((row) => pattern.test([
    row.source,
    row.title,
    row.description,
    row.status,
    row.type,
    row.itemUrl,
    row.localPath,
    row.localPageTextPath,
    row.columns
  ].filter(Boolean).join(" "))).length;
}

function sourceBreakdown() {
  return rows.reduce((acc, row) => {
    acc[row.source || "unknown"] = (acc[row.source || "unknown"] || 0) + 1;
    return acc;
  }, {});
}

function status(covered, partial, blocked = false) {
  if (covered) return "covered";
  if (blocked) return "blocked";
  if (partial) return "partial";
  return "missing";
}

function pageSnapshotStats() {
  const localPaths = rows.map((row) => row.localPageTextPath).filter(Boolean);
  return {
    rowsWithPageSnapshots: localPaths.length,
    uniquePageSnapshots: new Set(localPaths).size,
    pagesCaptured: pages.length
  };
}

function apiProbeBreakdown(pattern) {
  const probes = rows.filter((row) => row.source === "apiProbe" && pattern.test(`${row.type || ""} ${row.title || ""} ${row.description || ""}`));
  return probes.reduce((acc, row) => {
    const key = row.status || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

const snapshotStats = pageSnapshotStats();
const assignmentProbe = audit.totals?.apiSummary?.assignmentProbePages || {};
const quizProbe = audit.totals?.apiSummary?.quizProbePages || {};
const announcementProbe = audit.totals?.apiSummary?.announcementProbePages || {};
const gradeProbe = audit.totals?.apiSummary?.gradeProbePages || {};
const courseToolProbe = audit.totals?.apiSummary?.courseToolProbePages || {};

const areas = [
  {
    id: "rubrics",
    label: "Rubric-level details and rubric feedback",
    state: status(hasSource("rubricFeedback", "rubricCriterionFeedback"), hasSource("rubric") || countRows(/rubric|criteria|criterion|level achieved|performance level/i)),
    evidence: `${countSource("rubric")} rubric rows; ${countSource("rubricFeedback")} rubric feedback rows; ${countSource("rubricCriterionFeedback")} rubric criterion feedback rows; ${countRows(/rubric|criteria|criterion|level achieved|performance level/i)} rubric-like rows/text hits`,
    apiRoute: "/d2l/api/le/(version)/(orgUnitId)/rubrics/, /rubrics/(rubricId), /assessment",
    uiProof: "Assignment feedback, gradebook, and discussion topic/post pages that render released rubrics.",
    proofRows: "rubric, rubricFeedback, rubricCriterionFeedback, gradeFeedback, discussionFeedback",
    next: "Target assignment/grade/discussion feedback pages with rubric links or rubric blocks; verify criteria, levels, scores, and instructor comments."
  },
  {
    id: "quiz_feedback",
    label: "Released quiz/exam feedback and question/attempt results",
    state: status(hasSource("quizAttempt", "quizSubmission", "quizAttemptRow", "quizQuestionResult"), hasSource("quizSummaryRow") || countPages(/quiz_summary|quiz_submissions/i), countSource("apiProbe") > 0 && Object.keys(apiProbeBreakdown(/quiz attempts/i)).some((key) => /blocked|unavailable|error/i.test(key))),
    evidence: `${countSource("quizAttempt")} API attempts; ${countSource("quizSubmission")} submissions; ${countSource("quizAttemptRow")} UI attempts; ${countSource("quizSummaryRow")} summary rows; ${countSource("quizQuestionResult")} question result rows; ${countPages(/quiz_submissions_attempt/i)} attempt pages; ${countPages(/quiz_submissions\\.d2l/i)} submission pages; ${countPages(/quiz_summary/i)} summary pages; quiz probe visits ${quizProbe.visited || 0}, rows ${quizProbe.rows || 0}; API probes ${JSON.stringify(apiProbeBreakdown(/quiz attempts/i))}`,
    apiRoute: "/d2l/api/le/(version)/(orgUnitId)/quizzes/, /quizzes/(quizId)/attempts/",
    uiProof: "quiz_summary.d2l, quiz_submissions.d2l, and quiz_submissions_attempt.d2l result/review pages only.",
    proofRows: "quiz, quizAttempt, quizSubmission, quizAttemptRow, quizSummaryRow, quizQuestionResult, apiProbe",
    next: "Target only released quiz summary/submission/attempt pages; never start a new quiz attempt."
  },
  {
    id: "grade_feedback",
    label: "Grade item detail feedback/comments",
    state: status(hasSource("gradeFeedback"), hasSource("gradeItem") || countPages(/grades\/my_grades/i) || Number(gradeProbe.visited || 0) > 0),
    evidence: `${countSource("gradeItem")} grade items; ${countSource("gradeFeedback")} grade feedback rows; ${countPages(/grades\/my_grades/i)} grade pages; grade probe visits ${gradeProbe.visited || 0}, rows ${gradeProbe.rows || 0}, failures ${gradeProbe.failed || 0}`,
    apiRoute: "/d2l/api/le/(version)/(orgUnitId)/grades/, /grades/values/myGradeValues/",
    uiProof: "grades/my_grades/main.d2l and any read-only grade detail/rubric links visible from that page.",
    proofRows: "gradeItem, gradeFeedback, rubricFeedback, rubricCriterionFeedback",
    next: "Target gradebook and any grade detail/rubric links exposed from visible grade rows."
  },
  {
    id: "assignment_feedback",
    label: "Assignment submission history and feedback completeness",
    state: status(hasSource("assignmentSubmission", "submittedFile", "assignmentFeedback"), countPages(/folders_history|folder_user_view_feedback/i) || countSource("apiProbe")),
    evidence: `${countSource("assignmentSubmission")} submission rows; ${countSource("submittedFile")} submitted files; ${countSource("assignmentFeedback")} assignment feedback rows; ${countPages(/folders_history/i)} history pages; ${countPages(/folder_user_view_feedback/i)} feedback pages; assignment probe visits ${assignmentProbe.visited || 0}, rows ${assignmentProbe.rows || 0}; API probes ${JSON.stringify(apiProbeBreakdown(/assignment my submissions/i))}`,
    apiRoute: "/d2l/api/le/(version)/(orgUnitId)/dropbox/folders/, /dropbox/folders/(folderId)/submissions/mysubmissions/",
    uiProof: "folders_history.d2l and folder_user_view_feedback.d2l read-only submission/feedback pages.",
    proofRows: "assignment, assignmentSubmission, submittedFile, assignmentFeedback, rubricFeedback, apiProbe",
    next: "Target assignment history/feedback pages for visible inline comments, submitted files, scores, and rubric blocks."
  },
  {
    id: "announcement_details",
    label: "Announcement detail pages and attachments",
    state: status(hasSource("announcementAttachment") || countPages(/\/news\//i) || Number(announcementProbe.visited || 0) > 0, hasSource("announcement")),
    evidence: `${countSource("announcement")} announcements; ${countSource("announcementAttachment")} announcement attachments; ${countSource("announcementLink")} announcement links; ${countPages(/\/news\//i)} announcement/news pages; announcement probe visits ${announcementProbe.visited || 0}, rows ${announcementProbe.rows || 0}, failures ${announcementProbe.failed || 0}`,
    apiRoute: "/d2l/api/le/(version)/(orgUnitId)/news/, /news/(newsItemId)/attachments/(fileId)",
    uiProof: "/d2l/le/news/(orgUnitId)/(newsItemId)/view detail pages.",
    proofRows: "announcement, announcementAttachment, announcementLink, apiProbe",
    next: "Target announcement detail pages where API rows exist; verify embedded links and attachments."
  },
  {
    id: "course_tools",
    label: "Disabled/empty course tools",
    state: status(hasSource("checklistItem", "survey", "selfAssessment", "attendanceRecord", "group", "classlistEntry", "progressRecord", "courseToolPage"), countPages(/checklist|survey|selfassess|attendance|group|classlist|userprogress/i) || countRows(/no checklist|no surveys|no self assessments|no attendance|no items found|empty/i) || Number(courseToolProbe.visited || 0) > 0),
    evidence: `${countSource("courseToolPage")} course tool page summaries; ${countSource("checklistItem")} checklist; ${countSource("survey")} survey; ${countSource("selfAssessment")} self-assessment; ${countSource("attendanceRecord")} attendance; ${countSource("group")} groups; ${countSource("classlistEntry")} classlist; ${countSource("progressRecord")} progress; ${countPages(/checklist|survey|selfassess|attendance|group|classlist|userprogress/i)} tool pages; course tool probe visits ${courseToolProbe.visited || 0}, rows ${courseToolProbe.rows || 0}, failures ${courseToolProbe.failed || 0}`,
    apiRoute: "Tool-specific read APIs when available, plus API/page status probes.",
    uiProof: "classlist, checklist, group, selfassess, survey, attendance, and userprogress pages.",
    proofRows: "courseToolPage, checklistItem, survey, selfAssessment, attendanceRecord, group, classlistEntry, progressRecord, apiProbe",
    next: "Target each enabled tool URL per course and record visible rows or explicit empty/disabled states."
  },
  {
    id: "content_snapshots",
    label: "Content page text/HTML snapshots for AI querying",
    state: status(snapshotStats.uniquePageSnapshots > 0 && rows.some((row) => row.source === "contentTopic" && row.localPath), snapshotStats.uniquePageSnapshots > 0 || hasSource("contentTopic")),
    evidence: `${snapshotStats.uniquePageSnapshots} unique page snapshots; ${snapshotStats.rowsWithPageSnapshots} rows linked to snapshots; ${countSource("contentTopic")} content topics; ${rows.filter((row) => row.source === "contentTopic" && row.localPath).length} content topics with localPath`,
    apiRoute: "/d2l/api/le/(version)/(orgUnitId)/content/toc and course file APIs.",
    uiProof: "Content topic/viewer pages and downloaded file/quicklink pages.",
    proofRows: "contentModule, contentTopic, contentAttachment, externalLink, localPageTextPath",
    next: "Verify important content topics have readable page snapshots in addition to downloaded files/quick links."
  },
  {
    id: "change_detection",
    label: "Change detection / daily update mode",
    state: status(changeReport.available === true, changeReport && Object.keys(changeReport).length > 0),
    evidence: `change-report present: ${!!changeReport && Object.keys(changeReport).length > 0}; available baseline: ${changeReport.available === true}; totals ${JSON.stringify(changeReport.totals || {})}`,
    apiRoute: "Same read-only API/page rows as the current export, compared with prior manifest summaries.",
    uiProof: "A later targeted or daily read-only run with stable row IDs.",
    proofRows: "change-report.md, change-report.json, student-action-brief.md, newlyFeedback, dueChanged, availabilityChanged",
    next: "Run a later export after D2L changes to prove added/changed/removed/newly graded/new feedback/due-date/availability detection."
  }
];

const report = {
  archiveRoot,
  exportedAt: manifest.exportedAt || "",
  totals: {
    rows: rows.length,
    pages: pages.length,
    sources: sourceBreakdown(),
    pageSnapshots: snapshotStats
  },
  areas
};

function markdown(value) {
  const lines = [
    "# Remaining D2L Extraction Audit",
    "",
    `Archive: \`${value.archiveRoot}\``,
    `Exported: ${value.exportedAt || "unknown"}`,
    "",
    "## Totals",
    "",
    `- Rows: ${value.totals.rows}`,
    `- Pages: ${value.totals.pages}`,
    `- Unique page snapshots: ${value.totals.pageSnapshots.uniquePageSnapshots}`,
    "",
    "## Areas",
    ""
  ];
  for (const area of value.areas) {
    lines.push(`### ${area.label}`);
    lines.push(`- Status: ${area.state}`);
    lines.push(`- Evidence: ${area.evidence}`);
    lines.push(`- API route: ${area.apiRoute}`);
    lines.push(`- UI proof: ${area.uiProof}`);
    lines.push(`- Proof rows/signals: ${area.proofRows}`);
    lines.push(`- Next: ${area.next}`);
    lines.push("");
  }
  return lines.join("\n");
}

const jsonPath = path.join(archiveRoot, "remaining-extraction-audit.json");
const mdPath = path.join(archiveRoot, "remaining-extraction-audit.md");
const md = markdown(report);
let wroteJsonPath = jsonPath;
let wroteMdPath = mdPath;
try {
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, md);
} catch (error) {
  const fallbackBase = path.join(process.cwd(), `remaining-extraction-audit-${path.basename(archiveRoot)}`);
  wroteJsonPath = `${fallbackBase}.json`;
  wroteMdPath = `${fallbackBase}.md`;
  fs.writeFileSync(wroteJsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(wroteMdPath, md);
  console.error(`Could not write into archive folder (${error.code || "error"}); wrote fallback files in current directory.`);
}
console.log(`Wrote ${wroteMdPath}`);
console.log(`Wrote ${wroteJsonPath}`);
console.log(md);
