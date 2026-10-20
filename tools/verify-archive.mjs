import fs from "node:fs";
import path from "node:path";
import { createRecoveryTools } from "./verify/recovery.mjs";
import { createRecordTools } from "./verify/records.mjs";

const source = process.argv[2];
if (!source) {
  console.error("Usage: node tools/verify-archive.mjs /path/to/d2l-export... or /path/to/manifest.json [--compare /path/to/older-export]");
  process.exit(2);
}
const compareIndex = process.argv.indexOf("--compare");
const compareSource = compareIndex >= 0 ? process.argv[compareIndex + 1] : "";

const sourceIsDirectory = fs.statSync(source).isDirectory();
const manifestPath = sourceIsDirectory
  ? path.join(source, "manifest.json")
  : source;
const archiveRoot = path.dirname(manifestPath);
const manifestExists = fs.existsSync(manifestPath);

const {
  walkFiles,
  normalizeText,
  extractDueText,
  extractAvailabilityText,
  parsePageSnapshot,
  baseRecoveredRow,
  assignmentFolderIdFromSnapshot,
  compactAssignmentLabelValues,
  recoveredRowsFromPage,
  sourceForRecoveredFile,
  parseRecoveredFile,
  recoverManifestFromArchive
} = createRecoveryTools({ fs, path, archiveRoot, parseJson });

const manifest = manifestExists
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : recoverManifestFromArchive(archiveRoot);
if (!manifestExists && sourceIsDirectory) {
  fs.writeFileSync(path.join(archiveRoot, "recovered-manifest.json"), JSON.stringify(manifest, null, 2));
}
const rows = Array.isArray(manifest.rows) ? manifest.rows : [];
const audit = manifest.audit || {};
const progressPath = path.join(path.dirname(manifestPath), "export-progress.json");
const progress = fs.existsSync(progressPath) ? JSON.parse(fs.readFileSync(progressPath, "utf8")) : null;

function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function count(sourceName) {
  return rows.filter((row) => row.source === sourceName).length;
}

function any(sourceName) {
  return count(sourceName) > 0;
}

function countPageVisits(pattern) {
  const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
  return pages.filter((page) => pattern.test([
    page?.page?.url,
    page?.pageUrl,
    page?.crawlTask?.requestedUrl
  ].filter(Boolean).join(" "))).length;
}

function apiProbeBreakdown(pattern) {
  const counts = {};
  for (const row of rows) {
    if (row.source !== "apiProbe") continue;
    if (pattern && !pattern.test(row.type || "")) continue;
    const key = row.status || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}:${count}`)
    .join(", ") || "none";
}

function apiProbeSummaryRows() {
  const groups = [
    ["Assignment submissions", /assignment my submissions/i],
    ["Quiz attempts", /quiz attempts/i],
    ["Announcements", /announcements|news/i],
    ["Discussions", /discussion/i]
  ];
  return groups.map(([label, pattern]) => {
    const matching = rows.filter((row) => row.source === "apiProbe" && pattern.test(row.type || ""));
    return {
      label,
      count: matching.length,
      breakdown: apiProbeBreakdown(pattern)
    };
  }).filter((entry) => entry.count > 0);
}

function apiProbeLegendLines() {
  return [
    "Legend:",
    "- available: D2L returned data and the extractor captured evidence rows.",
    "- availableEmpty: D2L allowed the read-only probe but returned no evidence rows.",
    "- blocked: D2L denied the read-only probe for this student/session.",
    "- notEnabledOrHidden: D2L returned not found, usually hidden, disabled, or not enabled.",
    "- unreachable/unavailable: the probe could not be reached or returned an unexpected error."
  ];
}

function rowsMatching(pattern) {
  return rows.filter((row) => pattern.test(`${row.title || ""} ${row.description || ""} ${row.type || ""} ${row.itemUrl || ""}`));
}

function filesExist() {
  const fileRows = rows.filter((row) => row.localPath);
  const candidates = (localPath) => [
    path.resolve(localPath),
    path.join(path.dirname(manifestPath), localPath),
    path.join(path.dirname(archiveRoot), localPath),
    path.join(process.env.HOME || "/", "Downloads", localPath),
    path.join(archiveRoot, localPath.replace(/^D2L Export\/d2l-export-[^/]+\//, ""))
  ];
  const checked = fileRows.map((row) => ({
    title: row.title,
    localPath: row.localPath,
    exists: candidates(row.localPath).some((candidate) => fs.existsSync(candidate))
  }));
  return { total: fileRows.length, existing: checked.filter((row) => row.exists).length, missing: checked.filter((row) => !row.exists).slice(0, 25) };
}

const {
  stableRowId,
  rowSignature,
  createExportSummary,
  feedbackSignal,
  summarizeChanges,
  manifestFromSource,
  changeReportMarkdown,
  aiIndexRecord,
  toJsonl
} = createRecordTools({ fs, path, parseJson, normalizeText, recoverManifestFromArchive });

function status(ok, partial = false) {
  if (ok) return "covered";
  if (partial) return "partial";
  return "missing";
}

const sourceCounts = rows.reduce((acc, row) => {
  acc[row.source || "unknown"] = (acc[row.source || "unknown"] || 0) + 1;
  return acc;
}, {});
const courses = new Set(rows.map((row) => row.courseOrgUnitId).filter(Boolean));
const dueRows = rows.filter((row) => row.dueAtText || /due|availability ends/i.test(`${row.title || ""} ${row.description || ""}`));
const scoredGrades = rows.filter((row) => {
  if (row.source !== "gradeItem") return false;
  const columns = parseJson(row.columns);
  return columns.displayedGrade || columns.pointsEarned || columns.points || columns.grade;
});
const fileStatus = filesExist();
const offlineChangeReport = compareSource
  ? summarizeChanges(createExportSummary(manifestFromSource(compareSource)), createExportSummary(manifest))
  : null;
const effectiveChangeReport = manifest.changeReport || offlineChangeReport;

function dateValue(row) {
  const raw = row.dueAtText || "";
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function rowLine(row) {
  return `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source || "item"} | ${row.title || "(untitled)"}${row.dueAtText ? ` | due: ${row.dueAtText}` : ""}${row.localPath ? ` | ${row.localPath}` : ""}`;
}

function uniqueRows(inputRows, keyFn) {
  const seen = new Set();
  return inputRows.filter((row) => {
    const key = keyFn(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function offlineActionBrief() {
  const dueItems = uniqueRows(dueRows
    .filter((row) => !/Page$/.test(row.source || ""))
    .sort((a, b) => dateValue(a) - dateValue(b)),
    (row) => [row.courseOrgUnitId, row.source, row.title, row.dueAtText, row.itemUrl].join("::"))
    .slice(0, 120);
  const gradeItems = uniqueRows(rows
    .filter((row) => row.source === "gradeItem"),
    (row) => {
      const columns = parseJson(row.columns);
      return [row.courseOrgUnitId, row.title, columns.displayedGrade, columns.pointsEarned, columns.pointsPossible, columns.points].join("::");
    })
    .slice(0, 120);
  const policyItems = rows
    .filter((row) => row.source === "syllabusPolicy")
    .slice(0, 120);
  const usefulFiles = uniqueRows(rows
    .filter((row) => (row.localPath || row.source === "contentAttachment") && /syllabus|schedule|quiz|test|exam|assignment|project|paper|rubric|instructions|overview|reference|content|handout|slides?/i.test(`${row.title} ${row.localPath} ${row.source}`)),
    (row) => row.localPath || [row.courseOrgUnitId, row.title].join("::"))
    .slice(0, 160);
  const feedbackItems = uniqueRows(rows
    .filter((row) => [
      "assignmentSubmission",
      "assignmentFeedback",
      "submittedFile",
      "quizAttempt",
      "quizSubmission",
      "quizAttemptRow",
      "quizSummaryRow",
      "gradeFeedback",
      "discussionFeedback",
      "rubricFeedback",
      "rubricCriterionFeedback"
    ].includes(row.source)),
    (row) => [row.courseOrgUnitId, row.source, row.title, row.status, row.itemUrl, row.localPath].join("::"))
    .slice(0, 160);
  const apiProbeItems = uniqueRows(rows
    .filter((row) => row.source === "apiProbe"),
    (row) => [row.courseOrgUnitId, row.type, row.status, row.title].join("::"))
    .slice(0, 160);
  const apiProbeSummaries = apiProbeSummaryRows();
  const reviewChecks = checks.filter(([, , state]) => state !== "covered");

  const brief = [
    "# D2L Offline Action Brief",
    "",
    `Generated from: ${manifestPath}`,
    `Rows considered: ${rows.length}`,
    `Manifest phase: ${manifest.phase || "final"}`,
    "",
    "## Due / Dated Items",
    "",
    dueItems.length ? dueItems.map(rowLine).join("\n") : "- None found.",
    "",
    "## Grades / Scores",
    "",
    gradeItems.length
      ? gradeItems.map((row) => {
        const columns = parseJson(row.columns);
        const score = columns.displayedGrade || (columns.pointsEarned && columns.pointsPossible ? `${columns.pointsEarned}/${columns.pointsPossible}` : columns.points || "");
        return `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.title || "(untitled)"}${score ? ` | ${score}` : ""}`;
      }).join("\n")
      : "- None found.",
    "",
    "## Syllabus / Policies",
    "",
    policyItems.length ? policyItems.map(rowLine).join("\n") : "- None found.",
    "",
    "## Useful Downloaded Files",
    "",
    usefulFiles.length ? usefulFiles.map(rowLine).join("\n") : "- None found.",
    "",
    "## Submissions / Feedback / Results",
    "",
    feedbackItems.length
      ? feedbackItems.map((row) => {
        const columns = parseJson(row.columns);
        const score = columns.displayedGrade || columns.score || (columns.pointsEarned && columns.pointsPossible ? `${columns.pointsEarned}/${columns.pointsPossible}` : columns.points || "");
        return `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source} | ${row.title || "(untitled)"}${row.status ? ` | ${row.status}` : ""}${score ? ` | ${score}` : ""}${row.localPath ? ` | ${row.localPath}` : ""}`;
      }).join("\n")
      : "- None found.",
    "",
    "## API Probe Evidence",
    "",
    apiProbeLegendLines().join("\n"),
    "",
    apiProbeSummaries.length
      ? ["Summary:", ...apiProbeSummaries.map((entry) => `- ${entry.label}: ${entry.count} rows (${entry.breakdown})`), ""].join("\n")
      : "",
    apiProbeItems.length
      ? apiProbeItems.map((row) => `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.type || row.title || "API probe"} | ${row.status || "unavailable"} | ${row.title || "(untitled)"}`).join("\n")
      : "- None recorded.",
    "",
    "## Coverage Needing Review",
    "",
    reviewChecks.length
      ? reviewChecks.map(([id, label, state, evidence]) => `- ${state.toUpperCase()} - ${label} (${id}): ${evidence}`).join("\n")
      : "- All checks covered."
  ];
  return brief.join("\n");
}

function offlineStudentQuestions() {
  const byId = new Map(checks.map(([id, label, state, evidence]) => [id, { label, state, evidence }]));
  const pick = (ids, fallbackState = "missing") => {
    const found = ids.map((id) => byId.get(id)).filter(Boolean);
    if (!found.length) return { state: fallbackState, evidence: "" };
    if (found.some((item) => item.state === "missing")) return { state: "missing", evidence: found.map((item) => item.evidence).join("; ") };
    if (found.some((item) => item.state === "partial")) return { state: "partial", evidence: found.map((item) => item.evidence).join("; ") };
    return { state: "covered", evidence: found.map((item) => item.evidence).join("; ") };
  };
  const row = (question, ids, where) => {
    const result = pick(ids);
    return `| ${question} | ${result.state.toUpperCase()} | ${result.evidence.replace(/\|/g, "/")} | ${where.replace(/\|/g, "/")} |`;
  };
  return [
    "# Offline Student Questions Map",
    "",
    `Generated from: ${manifestPath}`,
    "",
    "This file maps the verified archive to the questions a student would normally open D2L to answer.",
    "",
    "| Question | Status | Evidence | Where to look |",
    "| --- | --- | --- | --- |",
    row("What courses am I actively taking?", ["courses"], "`index.json`, `manifest.csv`, and course folders"),
    row("What is due soon across every course?", ["assignments", "quizzes", "calendar"], "`offline-action-brief.md`, rows with `dueAtText`, and calendar rows"),
    row("Which assignments exist, and are they submitted or graded?", ["assignments", "assignment_submissions"], "`assignment`, `assignmentSubmission`, `submittedFile`, `assignmentFeedback`, and `apiProbe` rows"),
    row("Which quizzes/exams exist, and what results are released?", ["quizzes", "quiz_attempts"], "`quiz`, `quizAttempt`, `quizSubmission`, `quizAttemptRow`, `quizSummaryRow`, and `apiProbe` rows"),
    row("What grades and scored feedback are visible?", ["grades", "rubrics"], "`gradeItem`, `gradeFeedback`, `rubric`, `rubricFeedback`, `rubricCriterionFeedback`, and feedback/result rows"),
    row("What files and course materials were saved locally?", ["content"], "`courses/*/files/`, `contentTopic`, `contentAttachment`, and rows with `localPath`"),
    row("What announcements or instructor notices were posted?", ["announcements"], "`announcement`, `announcementAttachment`, `announcementLink`, and page snapshots"),
    row("What discussions, prompts, replies, and feedback are visible?", ["discussions"], "Discussion rows and topic/thread page snapshots"),
    row("Where are syllabus, schedule, policy, and instructor-info materials?", ["syllabus_policies"], "`syllabusPolicy` rows and related downloaded files"),
    row("Which D2L tools are enabled but empty, blocked, or only partially visible?", ["tools", "external_links", "api_probes"], "`courseToolPage`, `apiProbe` rows, `offline-verification.md`, and page snapshots"),
    row("What changed since the last export?", ["change_tracking"], "`offline-change-report.md` and `offline-change-report.json`"),
    "",
    "`PARTIAL` means the archive contains useful evidence but some fields remain unproven, blocked, empty, permission-dependent, or reconstructed from page snapshots."
  ].join("\n");
}

const quizResultPageVisits = countPageVisits(/\/quizzing\/user\/quiz_submissions_attempt\.d2l/i)
  + countPageVisits(/\/quizzing\/user\/quiz_submissions\.d2l/i)
  + countPageVisits(/\/quizzing\/user\/quiz_summary\.d2l/i);
const quizAttemptApiProbeRows = rows.filter((row) => row.source === "apiProbe" && /quiz attempts/i.test(row.type || "")).length;
const quizResultRows = count("quizAttempt") + count("quizSubmission") + count("quizAttemptRow") + count("quizSummaryRow");

const checks = [
  ["courses", "Active courses", status(courses.size > 0), `${courses.size} course ids`],
  ["content", "Content/topics/files", status(any("contentTopic") || any("contentAttachment"), any("recoveredFile") || any("contentPage")), `${count("contentTopic")} content topics; ${count("contentAttachment")} content attachments; ${count("recoveredFile")} recovered files; ${fileStatus.existing}/${fileStatus.total} local files found`],
  ["assignments", "Assignments", status(any("assignment"), any("assignmentInstruction") || any("assignmentsPage")), `${count("assignment")} submission assignments; ${count("assignmentInstruction")} instruction/project rows; ${count("assignmentsPage")} recovered assignment pages; ${rows.filter((row) => (row.source === "assignment" || row.source === "assignmentInstruction") && row.dueAtText).length} with due dates`],
  ["assignment_submissions", "Assignment submissions/feedback", status(any("assignmentSubmission") || any("assignmentFeedback") || any("submittedFile"), rows.some((row) => /submitted|feedback/i.test(`${row.status || ""} ${row.description || ""}`)) || rows.some((row) => row.source === "apiProbe" && /assignment my submissions/i.test(row.type || "")) || countPageVisits(/\/dropbox\/user\/folders_history\.d2l/i) || countPageVisits(/\/dropbox\/user\/folder_user_view_feedback\.d2l/i)), `${count("assignmentSubmission")} submissions; ${count("submittedFile")} submitted files; ${count("assignmentFeedback")} feedback rows; ${countPageVisits(/\/dropbox\/user\/folders_history\.d2l/i)} history pages; ${countPageVisits(/\/dropbox\/user\/folder_user_view_feedback\.d2l/i)} feedback pages; ${rows.filter((row) => row.source === "apiProbe" && /assignment my submissions/i.test(row.type || "")).length} submission API probe rows (${apiProbeBreakdown(/assignment my submissions/i)})`],
  ["quizzes", "Quizzes/exams", status(any("quiz"), any("quizzesPage")), `${count("quiz")} quizzes; ${count("quizzesPage")} recovered quiz pages; ${rows.filter((row) => row.source === "quiz" && row.dueAtText).length} with due dates`],
  ["quiz_attempts", "Quiz attempts/results", status((any("quizAttempt") || any("quizSubmission") || any("quizAttemptRow")) && (quizResultPageVisits || quizAttemptApiProbeRows), any("quizSummaryRow") || quizResultPageVisits || quizAttemptApiProbeRows || quizResultRows), `${count("quizAttempt")} API attempts; ${count("quizSubmission")} submissions; ${count("quizAttemptRow")} UI attempts; ${count("quizSummaryRow")} summary rows; ${countPageVisits(/\/quizzing\/user\/quiz_submissions_attempt\.d2l/i)} attempt pages; ${countPageVisits(/\/quizzing\/user\/quiz_submissions\.d2l/i)} submission pages; ${countPageVisits(/\/quizzing\/user\/quiz_summary\.d2l/i)} summary pages; ${quizAttemptApiProbeRows} quiz attempt API probe rows (${apiProbeBreakdown(/quiz attempts/i)})`],
  ["grades", "Grades", status(any("gradeItem"), any("gradesPage")), `${count("gradeItem")} grade items; ${count("gradeFeedback")} grade feedback rows; ${count("gradesPage")} recovered grade pages; ${scoredGrades.length} with score-like fields`],
  ["rubrics", "Rubrics", status(any("rubric") || any("rubricFeedback") || any("rubricCriterionFeedback"), rowsMatching(/rubric/i).length > 0), `${count("rubric")} rubric rows; ${count("rubricFeedback")} rubric feedback rows; ${count("rubricCriterionFeedback")} rubric criterion feedback rows`],
  ["announcements", "Announcements", status(any("announcement"), rowsMatching(/announcement|news/i).length > 0 || rows.some((row) => row.source === "apiProbe" && /announcement/i.test(row.type || ""))), `${count("announcement")} announcements; ${count("announcementAttachment")} attachments; ${count("announcementLink")} links; ${rows.filter((row) => row.source === "apiProbe" && /announcement/i.test(row.type || "")).length} blocked/unavailable announcement probes`],
  ["discussions", "Discussions", status(any("discussionTopic") || any("discussionPost"), any("discussionsPage") || rows.some((row) => row.source === "apiProbe" && /discussion/i.test(row.type || ""))), `${count("discussionForum")} forums; ${count("discussionTopic")} topics; ${count("discussionPost")} posts; ${count("discussionAttachment")} attachments; ${count("discussionsPage")} recovered discussion pages; ${rows.filter((row) => row.source === "apiProbe" && /discussion/i.test(row.type || "")).length} blocked/unavailable discussion probes`],
  ["calendar", "Calendar/tasks", status(any("calendarEvent"), any("calendarPage") || dueRows.length > 0), `${count("calendarEvent")} calendar events; ${count("calendarAttachment")} calendar attachments; ${count("calendarPage")} recovered calendar pages; ${dueRows.length} due/datable rows`],
  ["syllabus_policies", "Syllabus/policies", status(any("syllabusPolicy"), rowsMatching(/syllabus|schedule|policy|office hours|instructor|professor/i).length > 0), `${count("syllabusPolicy")} first-class syllabus/policy rows`],
  ["tools", "Checklists/surveys/progress/tools", status(any("courseToolPage") || any("checklistItem") || any("survey") || any("selfAssessment") || any("progressRecord") || any("attendanceRecord") || any("group") || any("classlistEntry"), any("checklistPage") || any("classlistPage")), `${count("courseToolPage")} course tool page summaries; ${count("checklistItem")} checklist; ${count("survey")} survey; ${count("selfAssessment")} self-assessment; ${count("progressRecord")} progress; ${count("attendanceRecord")} attendance; ${count("group")} group; ${count("classlistEntry")} classlist; ${count("checklistPage")} recovered checklist pages`],
  ["external_links", "External tools/links", status(rows.some((row) => /External Resource|Link|externalLink|courseLink|^link$/i.test(`${row.type || ""} ${row.source || ""} ${row.title || ""}`))), `${rows.filter((row) => /External Resource|Link|externalLink|courseLink|^link$/i.test(`${row.type || ""} ${row.source || ""} ${row.title || ""}`)).length} external/link-like rows; ${count("externalLink")} first-class external links`],
  ["api_probes", "API probe evidence", status(any("apiProbe"), manifest.phase === "recovered" || manifest.recovered), `${count("apiProbe")} API probe rows${manifest.phase === "recovered" || manifest.recovered ? "; archive was reconstructed from older page/download output, so API probe absence is unproven" : ""}`],
  ["change_tracking", "Change tracking", status(effectiveChangeReport?.available, !!effectiveChangeReport), effectiveChangeReport?.available ? `${effectiveChangeReport.totals.added} added, ${effectiveChangeReport.totals.changed} changed, ${effectiveChangeReport.totals.removed} removed` : "No comparison baseline was provided or available"]
];

const summary = checks.reduce((acc, [, , state]) => {
  acc[state] = (acc[state] || 0) + 1;
  return acc;
}, {});

const lines = [
  "# D2L Archive Offline Verification",
  "",
  `Manifest: ${manifestPath}`,
  `Rows: ${rows.length}`,
  `Courses: ${courses.size}`,
  `Generated: ${manifest.exportedAt || audit.generatedAt || ""}`,
  `Manifest phase: ${manifest.phase || "final"}`,
  `Progress phase: ${progress?.phase || "unknown"}`,
  "",
  "## Summary",
  "",
  `- Covered: ${summary.covered || 0}`,
  `- Partial: ${summary.partial || 0}`,
  `- Missing: ${summary.missing || 0}`,
  `- Failed pages: ${audit.totals?.failed ?? "unknown"}`,
  `- Uncertain pages: ${audit.totals?.uncertain ?? "unknown"}`,
  "",
  "## Checks",
  "",
  ...checks.map(([id, label, state, evidence]) => `- ${state.toUpperCase()} - ${label} (${id}): ${evidence}`),
  "",
  "## Source Counts",
  "",
  "```json",
  JSON.stringify(sourceCounts, null, 2),
  "```"
];

if (fileStatus.missing.length) {
  lines.push("", "## Missing Local Files", "");
  fileStatus.missing.forEach((row) => lines.push(`- ${row.title || "(untitled)"} | ${row.localPath}`));
}

const output = lines.join("\n");
const outPath = path.join(archiveRoot, "offline-verification.md");
fs.writeFileSync(outPath, output);
const briefPath = path.join(archiveRoot, "offline-action-brief.md");
fs.writeFileSync(briefPath, offlineActionBrief());
const questionsPath = path.join(archiveRoot, "offline-student-questions.md");
fs.writeFileSync(questionsPath, offlineStudentQuestions());
const aiIndexPath = path.join(archiveRoot, "offline-ai-index.jsonl");
fs.writeFileSync(aiIndexPath, toJsonl(rows.map(aiIndexRecord)));
if (offlineChangeReport) {
  fs.writeFileSync(path.join(archiveRoot, "offline-change-report.md"), changeReportMarkdown(offlineChangeReport));
  fs.writeFileSync(path.join(archiveRoot, "offline-change-report.json"), JSON.stringify(offlineChangeReport, null, 2));
}
console.log(output);
console.error(`\nWrote ${outPath}`);
console.error(`Wrote ${briefPath}`);
console.error(`Wrote ${questionsPath}`);
console.error(`Wrote ${aiIndexPath}`);
if (offlineChangeReport) {
  console.error(`Wrote ${path.join(archiveRoot, "offline-change-report.md")}`);
  console.error(`Wrote ${path.join(archiveRoot, "offline-change-report.json")}`);
}
