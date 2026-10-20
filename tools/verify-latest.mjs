import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const downloadsRoot = args[0] || path.join(os.homedir(), "Downloads", "D2L Export");
const extensionRoot = path.dirname(new URL(import.meta.url).pathname);
const verifierPath = path.join(extensionRoot, "verify-archive.mjs");

function usage() {
  return [
    "Usage: node tools/verify-latest.mjs [downloads-export-root]",
    "",
    "Finds the newest d2l-export-* folder, compares it with the previous export when available,",
    "runs offline verification, and performs a few smoke-query checks."
  ].join("\n");
}

function exportDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^d2l-export-/.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(root, entry.name);
      const stat = fs.statSync(fullPath);
      return { name: entry.name, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function runNode(script, scriptArgs, options = {}) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: path.dirname(extensionRoot),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  if (options.echo !== false && result.stdout) process.stdout.write(result.stdout);
  if (options.echo !== false && result.stderr) process.stderr.write(result.stderr);
  return result;
}

function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function readJsonl(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  return text.split(/\n+/).map((line) => JSON.parse(line));
}

function sourcePathForArchive(archivePath) {
  const candidates = [
    ["jsonl", path.join(archivePath, "offline-ai-index.jsonl")],
    ["jsonl", path.join(archivePath, "ai-index.ndjson")],
    ["jsonl", path.join(archivePath, "ai-index.jsonl")],
    ["manifest", path.join(archivePath, "manifest.json")],
    ["manifest", path.join(archivePath, "recovered-manifest.json")]
  ];
  const found = candidates.find(([, candidate]) => fs.existsSync(candidate));
  if (!found) throw new Error(`No archive index or manifest found in ${archivePath}`);
  return { kind: found[0], filePath: found[1] };
}

function aiIndexRecord(row) {
  const columns = parseJson(row.columns);
  const ids = parseJson(row.ids);
  return {
    courseOrgUnitId: row.courseOrgUnitId || "",
    courseTitle: row.courseTitle || "",
    source: row.source || "",
    title: row.title || "",
    status: row.status || "",
    type: row.type || "",
    text: [
      row.title,
      row.description,
      row.status,
      row.gate,
      row.type,
      row.dueAtText,
      row.availabilityText,
      columns.module,
      columns.topicType,
      columns.displayedGrade,
      columns.points,
      columns.commentsAndAssessments,
      columns.feedbackText,
      columns.author,
      columns.postSubject,
      columns.contentTitle
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
    dueAtText: row.dueAtText || "",
    availabilityText: row.availabilityText || "",
    itemUrl: row.itemUrl || "",
    localPath: row.localPath || "",
    localPageTextPath: row.localPageTextPath || "",
    ids,
    columns
  };
}

function readArchiveRecords(archivePath) {
  const sourcePath = sourcePathForArchive(archivePath);
  if (sourcePath.kind === "jsonl") return readJsonl(sourcePath.filePath);
  const manifest = JSON.parse(fs.readFileSync(sourcePath.filePath, "utf8"));
  return Array.isArray(manifest.rows) ? manifest.rows.map(aiIndexRecord) : [];
}

function readArchiveManifest(archivePath) {
  for (const fileName of ["manifest.json", "recovered-manifest.json"]) {
    const filePath = path.join(archivePath, fileName);
    if (fs.existsSync(filePath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return { filePath, manifest };
      } catch {
        return { filePath, manifest: null };
      }
    }
  }
  return { filePath: "", manifest: null };
}

function pageVisitChecks(archivePath) {
  const { filePath, manifest } = readArchiveManifest(archivePath);
  const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
  const apiSummary = manifest?.audit?.totals?.apiSummary || {};
  const assignmentProbePages = apiSummary.assignmentProbePages || {};
  const quizProbePages = apiSummary.quizProbePages || {};
  const announcementProbePages = apiSummary.announcementProbePages || {};
  const gradeProbePages = apiSummary.gradeProbePages || {};
  const courseToolProbePages = apiSummary.courseToolProbePages || {};
  const pageUrl = (page) => [
    page?.page?.url,
    page?.pageUrl,
    page?.crawlTask?.requestedUrl
  ].filter(Boolean).join(" ");
  const countWhere = (pattern) => pages.filter((page) => pattern.test(pageUrl(page))).length;
  const assignmentHistoryPages = countWhere(/\/dropbox\/user\/folders_history\.d2l/i);
  const assignmentFeedbackPages = countWhere(/\/dropbox\/user\/folder_user_view_feedback\.d2l/i);
  const quizAttemptPages = countWhere(/\/quizzing\/user\/quiz_submissions_attempt\.d2l/i);
  const quizSubmissionPages = countWhere(/\/quizzing\/user\/quiz_submissions\.d2l/i);
  const quizSummaryPages = countWhere(/\/quizzing\/user\/quiz_summary\.d2l/i);
  const announcementDetailPages = countWhere(/\/d2l\/le\/news\/\d+\/\d+\/view/i);
  const gradePages = countWhere(/\/grades\/my_grades\/main\.d2l/i);
  const courseToolPages = countWhere(/\/(?:classlist|checklist|group|selfassess|survey|attendance|userprogress)\//i);
  const assignmentProbeVisited = Number(assignmentProbePages.visited || 0);
  const assignmentProbeFailed = Number(assignmentProbePages.failed || 0);
  const assignmentProbeRows = Number(assignmentProbePages.rows || 0);
  const quizProbeVisited = Number(quizProbePages.visited || 0);
  const quizProbeFailed = Number(quizProbePages.failed || 0);
  const quizProbeRows = Number(quizProbePages.rows || 0);
  const announcementProbeVisited = Number(announcementProbePages.visited || 0);
  const announcementProbeFailed = Number(announcementProbePages.failed || 0);
  const announcementProbeRows = Number(announcementProbePages.rows || 0);
  const gradeProbeVisited = Number(gradeProbePages.visited || 0);
  const gradeProbeFailed = Number(gradeProbePages.failed || 0);
  const gradeProbeRows = Number(gradeProbePages.rows || 0);
  const courseToolProbeVisited = Number(courseToolProbePages.visited || 0);
  const courseToolProbeFailed = Number(courseToolProbePages.failed || 0);
  const courseToolProbeRows = Number(courseToolProbePages.rows || 0);
  const area = {
    assignment: "1 rubric details/feedback and 4 assignment feedback",
    quiz: "2 quiz/exam released results",
    grade: "3 grade item feedback/comments",
    announcement: "5 announcement details/attachments",
    tools: "6 disabled/empty course tools"
  };
  return {
    manifestPath: filePath,
    pageCount: pages.length,
    assignmentProbeVisited,
    assignmentProbeFailed,
    assignmentProbeRows,
    quizProbeVisited,
    quizProbeFailed,
    quizProbeRows,
    announcementProbeVisited,
    announcementProbeFailed,
    announcementProbeRows,
    gradeProbeVisited,
    gradeProbeFailed,
    gradeProbeRows,
    courseToolProbeVisited,
    courseToolProbeFailed,
    courseToolProbeRows,
    assignmentHistoryPages,
    assignmentFeedbackPages,
    quizAttemptPages,
    quizSubmissionPages,
    quizSummaryPages,
    announcementDetailPages,
    gradePages,
    courseToolPages,
    checks: [
      {
        label: "Assignment probe page summary",
        area: area.assignment,
        status: assignmentProbeVisited > 0 ? "found" : "unproven",
        evidence: `${assignmentProbeVisited} visited, ${assignmentProbeFailed} failed, ${assignmentProbeRows} rows from audit.totals.apiSummary.assignmentProbePages`
      },
      {
        label: "Assignment history pages visited",
        area: area.assignment,
        status: assignmentHistoryPages > 0 ? "found" : "unproven",
        evidence: `${assignmentHistoryPages} pages with folders_history.d2l requested or saved`
      },
      {
        label: "Assignment feedback pages visited",
        area: area.assignment,
        status: assignmentFeedbackPages > 0 ? "found" : "unproven",
        evidence: `${assignmentFeedbackPages} pages with folder_user_view_feedback.d2l requested or saved`
      },
      {
        label: "Quiz probe page summary",
        area: area.quiz,
        status: quizProbeVisited > 0 ? "found" : "unproven",
        evidence: `${quizProbeVisited} visited, ${quizProbeFailed} failed, ${quizProbeRows} rows from audit.totals.apiSummary.quizProbePages`
      },
      {
        label: "Quiz attempt result pages visited",
        area: area.quiz,
        status: quizAttemptPages > 0 ? "found" : "unproven",
        evidence: `${quizAttemptPages} pages with quiz_submissions_attempt.d2l requested or saved`
      },
      {
        label: "Quiz submission pages visited",
        area: area.quiz,
        status: quizSubmissionPages > 0 ? "found" : "unproven",
        evidence: `${quizSubmissionPages} pages with quiz_submissions.d2l requested or saved`
      },
      {
        label: "Quiz summary pages visited",
        area: area.quiz,
        status: quizSummaryPages > 0 ? "found" : "unproven",
        evidence: `${quizSummaryPages} pages with quiz_summary.d2l requested or saved`
      },
      {
        label: "Announcement probe page summary",
        area: area.announcement,
        status: announcementProbeVisited > 0 ? "found" : "unproven",
        evidence: `${announcementProbeVisited} visited, ${announcementProbeFailed} failed, ${announcementProbeRows} rows from audit.totals.apiSummary.announcementProbePages`
      },
      {
        label: "Announcement detail pages visited",
        area: area.announcement,
        status: announcementDetailPages > 0 ? "found" : "unproven",
        evidence: `${announcementDetailPages} pages with /d2l/le/news/{course}/{item}/view requested or saved`
      },
      {
        label: "Grade probe page summary",
        area: area.grade,
        status: gradeProbeVisited > 0 ? "found" : "unproven",
        evidence: `${gradeProbeVisited} visited, ${gradeProbeFailed} failed, ${gradeProbeRows} rows from audit.totals.apiSummary.gradeProbePages`
      },
      {
        label: "Visible gradebook pages visited",
        area: area.grade,
        status: gradePages > 0 ? "found" : "unproven",
        evidence: `${gradePages} pages with grades/my_grades/main.d2l requested or saved`
      },
      {
        label: "Secondary course tool probe summary",
        area: area.tools,
        status: courseToolProbeVisited > 0 ? "found" : "unproven",
        evidence: `${courseToolProbeVisited} visited, ${courseToolProbeFailed} failed, ${courseToolProbeRows} rows from audit.totals.apiSummary.courseToolProbePages`
      },
      {
        label: "Secondary course tool pages visited",
        area: area.tools,
        status: courseToolPages > 0 ? "found" : "unproven",
        evidence: `${courseToolPages} pages with classlist/checklist/group/selfassess/survey/attendance/userprogress requested or saved`
      }
    ]
  };
}

function words(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
}

function recordHaystack(record) {
  return [
    record.courseTitle,
    record.courseOrgUnitId,
    record.source,
    record.title,
    record.status,
    record.type,
    record.text,
    record.dueAtText,
    record.availabilityText,
    record.localPath,
    record.localPageTextPath,
    record.itemUrl,
    record.columns?.status,
    record.columns?.feedbackText,
    record.columns?.author,
    record.columns?.postSubject,
    record.columns?.contentTitle
  ].filter(Boolean).join(" ").toLowerCase();
}

function scoreRecord(record, terms) {
  const haystack = recordHaystack(record);
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function statusBreakdown(entries) {
  const counts = {};
  for (const entry of entries) {
    const status = entry.record?.status || "noStatus";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function parseOfflineVerification(archivePath) {
  const filePath = path.join(archivePath, "offline-verification.md");
  if (!fs.existsSync(filePath)) return { available: false, filePath };
  const text = fs.readFileSync(filePath, "utf8");
  const summary = {};
  for (const key of ["Covered", "Partial", "Missing", "Failed pages", "Uncertain pages"]) {
    const match = text.match(new RegExp(`- ${key}:\\s*([^\\n]+)`));
    if (match) summary[key.toLowerCase().replace(/\s+/g, "_")] = match[1].trim();
  }
  const checks = [];
  for (const match of text.matchAll(/^- (COVERED|PARTIAL|MISSING) - ([^(]+) \(([^)]+)\): (.*)$/gm)) {
    checks.push({
      status: match[1].toLowerCase(),
      label: match[2].trim(),
      id: match[3].trim(),
      evidence: match[4].trim()
    });
  }
  return {
    available: true,
    filePath,
    summary,
    checks,
    partialChecks: checks.filter((check) => check.status === "partial"),
    missingChecks: checks.filter((check) => check.status === "missing")
  };
}

function smokeQuery(archivePath, query, expectedSources = []) {
  try {
    const records = readArchiveRecords(archivePath);
    const terms = words(query);
    const scored = records
      .map((record) => ({ record, score: scoreRecord(record, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    const results = scored.slice(0, 100);
    const expected = new Set(expectedSources);
    const expectedEntries = expected.size
      ? scored.filter((entry) => expected.has(entry.record?.source)).slice(0, 100)
      : results;
    const expectedMatches = expected.size
      ? expectedEntries.length
      : results.length;
    const exampleRecords = expectedEntries.slice(0, 5).map((entry) => ({
      source: entry.record.source,
      courseTitle: entry.record.courseTitle,
      title: entry.record.title,
      dueAtText: entry.record.dueAtText || "",
      localPath: entry.record.localPath || entry.record.localPageTextPath || entry.record.itemUrl || ""
    }));
    return {
      query,
      ok: true,
      matches: results.length,
      expectedSources,
      expectedMatches,
      evidenceStatus: expected.size && !expectedMatches ? "unproven" : "found",
      expectedStatusBreakdown: statusBreakdown(expectedEntries),
      expectedExamples: exampleRecords,
      top: results[0]?.record
        ? {
            source: results[0].record.source,
            courseTitle: results[0].record.courseTitle,
            title: results[0].record.title
          }
        : null
    };
  } catch (error) {
    return { query, ok: false, error: error.message };
  }
}

function reviewMarkdown({ latest, previous, coverageSummary, queryResults, pageChecks, needsReview }) {
  const lines = [
    "# D2L Export Next Review",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Latest export: ${latest.fullPath}`,
    `Previous export: ${previous?.fullPath || "(none)"}`,
    "",
    "## Coverage",
    ""
  ];
  if (coverageSummary.available) {
    const s = coverageSummary.summary || {};
    lines.push(`- Covered: ${s.covered || "?"}`);
    lines.push(`- Partial: ${s.partial || "?"}`);
    lines.push(`- Missing: ${s.missing || "?"}`);
    lines.push(`- Failed pages: ${s.failed_pages || "?"}`);
    lines.push(`- Uncertain pages: ${s.uncertain_pages || "?"}`);
  } else {
    lines.push("- Offline verification summary was not available.");
  }
  lines.push("", "## Needs Review", "");
  if (needsReview.length) {
    for (const item of needsReview) {
      const expected = item.expectedSources?.length ? ` Expected sources: ${item.expectedSources.join(", ")}.` : "";
      lines.push(`- ${String(item.status || "review").toUpperCase()} - ${item.label || item.query}: ${item.evidence || ""}${expected}`);
    }
  } else {
    lines.push("- No missing, partial, or unproven categories were reported by the offline verifier.");
  }
  lines.push("", "## Smoke Checks", "");
  for (const result of queryResults) {
    if (!result.ok) {
      lines.push(`- ${result.query}: failed - ${result.error}`);
      continue;
    }
    const status = result.evidenceStatus === "unproven" ? "UNPROVEN" : "FOUND";
    const expected = result.expectedSources?.length ? `; expected sources ${result.expectedSources.join(", ")}` : "";
    const example = result.expectedExamples?.[0] || result.top;
    lines.push(`- ${status} - ${result.query}: ${result.matches} keyword matches, ${result.expectedMatches || 0} expected-source matches${expected}${example?.title ? `; example ${example.source} | ${example.title}` : ""}`);
  }
  lines.push("", "## Page Visit Checks", "");
  for (const check of pageChecks.checks || []) {
    const area = check.area ? ` [${check.area}]` : "";
    lines.push(`- ${String(check.status).toUpperCase()} - ${check.label}${area}: ${check.evidence}`);
  }
  lines.push(
    "",
    "## Next Live Run Gate",
    "",
    "A fresh extension run should be treated as meaningfully better only if it produces:",
    "",
    "- A final `manifest.json` with `phase: \"final\"`, or a clearly inspectable `phase: \"pre-files\"` partial manifest if interrupted.",
    "- At least one `apiProbe` row per probed read-only area, including successful-empty assignment submission and quiz attempt probes where no evidence is returned.",
    "- Audit probe summaries for assignment and quiz probe pages showing whether probe pages ran, failed, or produced zero rows.",
    "- Saved page visits for assignment submission history and feedback probe URLs, specifically `folders_history.d2l` and `folder_user_view_feedback.d2l`.",
    "- Assignment evidence as `assignmentSubmission`, `submittedFile`, or `assignmentFeedback` when D2L exposes it, or `apiProbe` rows explaining empty/denied/unavailable access.",
    "- Saved page visits for quiz result URLs when released results are linked, specifically `quiz_submissions_attempt.d2l`, `quiz_submissions.d2l`, or `quiz_summary.d2l`.",
    "- Quiz result evidence as `quizAttempt`, `quizSubmission`, `quizAttemptRow`, or `quizSummaryRow`, without starting new attempts.",
    "- Downloaded files with local paths that exist inside the course folder.",
    "- A `student-action-brief.md`, `audit-report.md`, and this review file showing no unexplained missing categories."
  );
  return `${lines.join("\n")}\n`;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const dirs = exportDirs(downloadsRoot);
if (!dirs.length) {
  console.error(`No d2l-export-* folders found in ${downloadsRoot}`);
  process.exit(1);
}

const latest = dirs[0];
const previous = dirs[1] || null;
const verifierArgs = previous
  ? [latest.fullPath, "--compare", previous.fullPath]
  : [latest.fullPath];

console.error(`Latest export: ${latest.fullPath}`);
if (previous) console.error(`Previous export: ${previous.fullPath}`);
else console.error("Previous export: none found");

const verifyResult = runNode(verifierPath, verifierArgs);
if (verifyResult.status !== 0) process.exit(verifyResult.status || 1);

const smokeQueries = [
  {
    query: "assignment feedback submission submitted file",
    expectedSources: ["assignmentSubmission", "assignmentFeedback", "submittedFile"]
  },
  {
    query: "quiz attempt result feedback overall grade",
    expectedSources: ["quizAttempt", "quizSubmission", "quizAttemptRow", "quizSummaryRow", "gradeFeedback"]
  },
  {
    query: "discussion feedback rubric post attachment",
    expectedSources: ["discussionFeedback", "rubricFeedback", "gradeFeedback", "discussionAttachment"]
  },
  {
    query: "course material handout slides content attachment",
    expectedSources: ["contentTopic", "contentAttachment", "recoveredFile", "syllabusPolicy"]
  },
  {
    query: "api probe available empty blocked hidden unavailable",
    expectedSources: ["apiProbe"]
  },
  {
    query: "due upcoming calendar",
    expectedSources: ["assignment", "quiz", "calendarEvent", "discussionTopic", "checklistItem", "survey", "selfAssessment"]
  }
];
const queryResults = smokeQueries.map((item) => smokeQuery(latest.fullPath, item.query, item.expectedSources));
const coverageSummary = parseOfflineVerification(latest.fullPath);
const pageChecks = pageVisitChecks(latest.fullPath);
const unprovenCategories = queryResults
  .filter((result) => result.ok && result.evidenceStatus === "unproven")
  .map((result) => ({
    query: result.query,
    expectedSources: result.expectedSources,
    matches: result.matches,
    expectedMatches: result.expectedMatches
  }));
const needsReview = [
  ...unprovenCategories.map((item) => ({
    kind: "smokeQuery",
    label: item.query,
    status: "unproven",
    evidence: `${item.matches} keyword matches, ${item.expectedMatches} expected-source matches`,
    expectedSources: item.expectedSources
  })),
  ...(pageChecks.checks || [])
    .filter((check) => check.status === "unproven")
    .map((check) => ({ kind: "pageVisit", ...check })),
  ...(coverageSummary.partialChecks || []).map((check) => ({ kind: "coverage", ...check })),
  ...(coverageSummary.missingChecks || []).map((check) => ({ kind: "coverage", ...check }))
];
const summaryPath = path.join(latest.fullPath, "offline-smoke-query-report.json");
const reviewPath = path.join(latest.fullPath, "next-live-review.md");
fs.writeFileSync(summaryPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  latestExport: latest.fullPath,
  previousExport: previous?.fullPath || "",
  coverageSummary,
  pageChecks,
  unprovenCategories,
  needsReview,
  queries: queryResults
}, null, 2));
fs.writeFileSync(reviewPath, reviewMarkdown({ latest, previous, coverageSummary, queryResults, pageChecks, needsReview }));

console.error(`Wrote ${summaryPath}`);
console.error(`Wrote ${reviewPath}`);
console.log("\n# Smoke Query Summary\n");
if (coverageSummary.available) {
  const s = coverageSummary.summary || {};
  console.log(`- coverage: covered ${s.covered || "?"}, partial ${s.partial || "?"}, missing ${s.missing || "?"}`);
}
for (const result of queryResults) {
  if (!result.ok) {
    console.log(`- ${result.query}: failed - ${result.error}`);
  } else if (!result.matches) {
    console.log(`- ${result.query}: 0 matches`);
  } else if (result.evidenceStatus === "unproven") {
    console.log(`- ${result.query}: ${result.matches} keyword matches, 0 expected-source matches (${result.expectedSources.join(", ")})`);
  } else {
    const example = result.expectedExamples?.[0] || result.top;
    const statusText = Object.keys(result.expectedStatusBreakdown || {}).length
      ? `; statuses ${Object.entries(result.expectedStatusBreakdown).map(([key, count]) => `${key}:${count}`).join(", ")}`
      : "";
    console.log(`- ${result.query}: ${result.matches} matches, ${result.expectedMatches} expected-source matches${statusText}; example ${example?.source || "item"} | ${example?.title || "(untitled)"}`);
  }
}
if (pageChecks.checks?.length) {
  console.log("\n# Page Visit Checks\n");
  for (const check of pageChecks.checks) {
    const area = check.area ? ` [${check.area}]` : "";
    console.log(`- ${check.status.toUpperCase()} - ${check.label}${area}: ${check.evidence}`);
  }
}
if (needsReview.length) {
  console.log("\n# Needs Review\n");
  for (const item of needsReview.slice(0, 12)) {
    console.log(`- ${item.status.toUpperCase()} - ${item.label || item.query}: ${item.evidence}`);
  }
}
