import { pageVisitChecksFromManifest, reviewMarkdown } from "./verify/latest-checks.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aiIndexRecord } from "./verify/records.mjs";
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
  return { manifestPath: filePath, ...pageVisitChecksFromManifest(manifest) };
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
