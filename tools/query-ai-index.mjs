import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const usage = "Usage: node tools/query-ai-index.mjs /path/to/archive-or-index \"search terms\" [--limit 25] [--json]";

if (args.length < 2) {
  console.error(usage);
  process.exit(2);
}

const source = args[0];
const query = args[1];
const limitFlag = args.indexOf("--limit");
const limit = limitFlag >= 0 ? Math.max(1, Number(args[limitFlag + 1] || 25)) : 25;
const jsonOutput = args.includes("--json");

function sourcePathFor(input) {
  const stat = fs.statSync(input);
  if (!stat.isDirectory()) return { filePath: input, kind: /\.(?:jsonl|ndjson)$/i.test(input) ? "jsonl" : "manifest" };
  const candidates = [
    ["jsonl", path.join(input, "ai-index.ndjson")],
    ["jsonl", path.join(input, "ai-index.jsonl")],
    ["jsonl", path.join(input, "offline-ai-index.jsonl")],
    ["manifest", path.join(input, "manifest.json")],
    ["manifest", path.join(input, "recovered-manifest.json")]
  ];
  const found = candidates.find(([, candidate]) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`No ai-index.ndjson, ai-index.jsonl, offline-ai-index.jsonl, manifest.json, or recovered-manifest.json found in ${input}`);
  }
  return { kind: found[0], filePath: found[1] };
}

function readJsonl(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  return text.split(/\n+/).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL at ${filePath}:${index + 1}: ${error.message}`);
    }
  });
}

function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function stableRowId(row) {
  const ids = parseJson(row.ids);
  return [
    row.courseOrgUnitId,
    row.source,
    ids.contentObjectId,
    ids.quizId,
    ids.dropboxFolderId,
    ids.assignmentFolderId,
    ids.gradeObjectId,
    ids.calendarEventId,
    ids.newsItemId,
    ids.discussionForumId,
    ids.discussionTopicId,
    ids.postId,
    ids.fileId,
    ids.rubricId,
    row.itemUrl || row.pageUrl,
    row.title
  ].filter((value) => value !== undefined && value !== null && String(value).trim() !== "").join("::");
}

function aiIndexRecord(row) {
  const columns = parseJson(row.columns);
  const ids = parseJson(row.ids);
  return {
    id: stableRowId(row),
    courseOrgUnitId: row.courseOrgUnitId || "",
    courseTitle: row.courseTitle || "",
    source: row.source || "",
    title: row.title || "",
    status: row.status || "",
    type: row.type || "",
    linkKind: columns.linkKind || "",
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
      columns.rubricText,
      columns.criterionName,
      columns.rubricLevel,
      columns.scoreText,
      columns.status,
      columns.assignmentTitle,
      columns.quizTitle,
      columns.discussionTopicId,
      columns.author,
      columns.postSubject,
      columns.contentTitle,
      columns.linkKind,
      columns.recoveredFrom,
      columns.toolSource,
      columns.emptyStateText,
      columns.blockedText,
      row.localPageTextSnippet
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
    dueAtText: row.dueAtText || "",
    availabilityText: row.availabilityText || "",
    itemUrl: row.itemUrl || "",
    localPath: row.localPath || "",
    localPageTextPath: row.localPageTextPath || "",
    localPageTextSnippet: row.localPageTextSnippet || "",
    ids,
    columns
  };
}

function readManifestRows(filePath) {
  const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(manifest.rows) ? manifest.rows.map(aiIndexRecord) : [];
}

function words(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
}

function haystack(record) {
  return {
    course: `${record.courseTitle || ""} ${record.courseOrgUnitId || ""}`.toLowerCase(),
    source: String(record.source || "").toLowerCase(),
    title: String(record.title || "").toLowerCase(),
    text: String(record.text || "").toLowerCase(),
    due: `${record.dueAtText || ""} ${record.availabilityText || ""}`.toLowerCase(),
    paths: `${record.localPath || ""} ${record.localPageTextPath || ""} ${record.itemUrl || ""}`.toLowerCase(),
    status: `${record.status || ""} ${record.type || ""} ${record.columns?.status || ""}`.toLowerCase()
  };
}

function containsAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function countOccurrences(text, term) {
  let count = 0;
  let index = text.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

function scoreRecord(record, terms) {
  const fields = haystack(record);
  let score = 0;
  for (const term of terms) {
    score += countOccurrences(fields.title, term) * 10;
    score += countOccurrences(fields.source, term) * 8;
    score += countOccurrences(fields.course, term) * 6;
    score += countOccurrences(fields.due, term) * 5;
    score += countOccurrences(fields.status, term) * 5;
    score += countOccurrences(fields.text, term) * 2;
    score += countOccurrences(fields.paths, term);
  }
  if (containsAny(fields.source, ["quiz", "assignment", "grade", "calendar", "announcement", "apiprobe"])) score += 2;
  if (record.source === "apiProbe") score += 2;
  if (record.dueAtText) score += 1;
  if (record.localPath || record.localPageTextPath) score += 1;
  return score;
}

function resolveArchiveRoot(filePath) {
  return path.dirname(filePath);
}

function cleanCell(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/\|/g, "/").trim();
}

function resultLine(result) {
  const record = result.record;
  const location = record.localPath || record.localPageTextPath || record.itemUrl || "";
  return [
    result.score,
    cleanCell(record.source),
    cleanCell(record.courseTitle || record.courseOrgUnitId),
    cleanCell(record.title),
    cleanCell(record.dueAtText || record.availabilityText),
    cleanCell(location)
  ].join(" | ");
}

const sourcePath = sourcePathFor(source);
const records = sourcePath.kind === "jsonl" ? readJsonl(sourcePath.filePath) : readManifestRows(sourcePath.filePath);
const terms = words(query);
if (!terms.length) {
  console.error("Search terms must include at least one letter or number.");
  process.exit(2);
}

const results = records
  .map((record) => ({ record, score: scoreRecord(record, terms) }))
  .filter((result) => result.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, limit);

if (jsonOutput) {
  console.log(JSON.stringify({ indexPath: sourcePath.filePath, sourceKind: sourcePath.kind, query, results }, null, 2));
  process.exit(0);
}

const lines = [
  "# D2L Archive Query Results",
  "",
  `Index: ${sourcePath.filePath}`,
  `Source kind: ${sourcePath.kind}`,
  `Query: ${query}`,
  `Matches: ${results.length} of ${records.length}`,
  "",
  "score | source | course | title | due/availability | location",
  "--- | --- | --- | --- | --- | ---",
  ...results.map(resultLine)
];

const output = lines.join("\n");
console.log(output);

if (fs.statSync(source).isDirectory()) {
  const archiveRoot = resolveArchiveRoot(sourcePath.filePath);
  const slug = words(query).slice(0, 8).join("-") || "query";
  const outputPath = path.join(archiveRoot, `query-results-${slug}.md`);
  fs.writeFileSync(outputPath, output);
  console.error(`\nWrote ${outputPath}`);
}
