import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const _shared = {};
const _rowsPath = new URL("../../src/shared/rows.js", import.meta.url);
vm.runInNewContext(fs.readFileSync(_rowsPath, "utf8"), {
  globalThis: { D2LExtractorShared: _shared },
  JSON,
  Date,
  String
});
export const stableRowId = _shared.stableRowId;
export const rowSignature = _shared.rowSignature;
export const toJsonl = _shared.toJsonl;
export const parseColumns = _shared.parseColumns;

export function newestExport(exportDir) {
  if (!fs.existsSync(exportDir)) return "";
  return fs.readdirSync(exportDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^d2l-export-/.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(exportDir, entry.name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.fullPath || "";
}

export function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

export function createExportSummary(sourceManifest, parse = parseJson) {
  const sourceRows = Array.isArray(sourceManifest?.rows) ? sourceManifest.rows : [];
  return {
    exportedAt: sourceManifest?.exportedAt || sourceManifest?.audit?.generatedAt || "",
    rows: sourceRows.map((row) => ({
      id: stableRowId(row, parse),
      signature: rowSignature(row),
      courseOrgUnitId: row.courseOrgUnitId || "",
      courseTitle: row.courseTitle || "",
      source: row.source || "",
      title: row.title || "",
      status: row.status || "",
      dueAtText: row.dueAtText || "",
      availabilityText: row.availabilityText || "",
      itemUrl: row.itemUrl || "",
      localPath: row.localPath || "",
      columns: row.columns || ""
    })).filter((row) => row.id)
  };
}

export function feedbackSignal(row, parse = parseJson) {
  const columns = parse(row.columns);
  if (["assignmentFeedback", "gradeFeedback", "quizAttempt", "quizSubmission", "quizAttemptRow", "quizSummaryRow", "discussionFeedback", "rubricFeedback", "rubricCriterionFeedback"].includes(row.source)) {
    return row.source;
  }
  const text = [
    columns.feedbackText,
    columns.rubricText,
    columns.commentsAndAssessments
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return /feedback|comment|rubric|assessment/i.test(text) ? text : "";
}

function emptyChangeReport(previous, current) {
  return {
    available: false,
    previousExportedAt: previous?.exportedAt || "",
    currentExportedAt: current?.exportedAt || "",
    reason: "No previous export rows were available for offline comparison.",
    totals: { added: 0, removed: 0, changed: 0, newlyGraded: 0, newlyDue: 0, dueChanged: 0, availabilityChanged: 0, newlyDownloaded: 0, newlyFeedback: 0 },
    added: [],
    removed: [],
    changed: [],
    newlyGraded: [],
    newlyDue: [],
    dueChanged: [],
    availabilityChanged: [],
    newlyDownloaded: [],
    newlyFeedback: []
  };
}

function diffRow(before, row, state, normalize, parse) {
  state.changed.push({ before, after: row });
  const beforeColumns = parse(before.columns);
  const afterColumns = parse(row.columns);
  const beforeGrade = `${beforeColumns.displayedGrade || beforeColumns.pointsEarned || beforeColumns.points || ""}`.trim();
  const afterGrade = `${afterColumns.displayedGrade || afterColumns.pointsEarned || afterColumns.points || ""}`.trim();
  if (!beforeGrade && afterGrade) state.newlyGraded.push(row);
  if (!before.dueAtText && row.dueAtText) state.newlyDue.push(row);
  if (before.dueAtText && row.dueAtText && normalize(before.dueAtText) !== normalize(row.dueAtText)) state.dueChanged.push({ before, after: row });
  if (normalize(before.availabilityText || "") !== normalize(row.availabilityText || "")) state.availabilityChanged.push({ before, after: row });
  if (!before.localPath && row.localPath) state.newlyDownloaded.push(row);
  if (!feedbackSignal(before, parse) && feedbackSignal(row, parse)) state.newlyFeedback.push(row);
}

export function summarizeChanges(previous, current, normalize = (s) => String(s || "").trim(), parse = parseJson) {
  if (!previous?.rows?.length) return emptyChangeReport(previous, current);

  const previousById = new Map(previous.rows.map((row) => [row.id, row]));
  const currentById = new Map(current.rows.map((row) => [row.id, row]));
  const state = {
    added: [], removed: [], changed: [], newlyGraded: [], newlyDue: [],
    dueChanged: [], availabilityChanged: [], newlyDownloaded: [], newlyFeedback: []
  };

  for (const row of current.rows) {
    const before = previousById.get(row.id);
    if (!before) {
      state.added.push(row);
      if (feedbackSignal(row, parse)) state.newlyFeedback.push(row);
      continue;
    }
    if (before.signature !== row.signature) {
      diffRow(before, row, state, normalize, parse);
    }
  }

  for (const row of previous.rows) {
    if (!currentById.has(row.id)) state.removed.push(row);
  }

  const limit = (items) => items.slice(0, 200);
  return {
    available: true,
    previousExportedAt: previous.exportedAt || "",
    currentExportedAt: current.exportedAt || "",
    totals: {
      added: state.added.length,
      removed: state.removed.length,
      changed: state.changed.length,
      newlyGraded: state.newlyGraded.length,
      newlyDue: state.newlyDue.length,
      dueChanged: state.dueChanged.length,
      availabilityChanged: state.availabilityChanged.length,
      newlyDownloaded: state.newlyDownloaded.length,
      newlyFeedback: state.newlyFeedback.length
    },
    added: limit(state.added),
    removed: limit(state.removed),
    changed: limit(state.changed),
    newlyGraded: limit(state.newlyGraded),
    newlyDue: limit(state.newlyDue),
    dueChanged: limit(state.dueChanged),
    availabilityChanged: limit(state.availabilityChanged),
    newlyDownloaded: limit(state.newlyDownloaded),
    newlyFeedback: limit(state.newlyFeedback)
  };
}

export function manifestFromSource(input, deps = {}) {
  const fileSys = deps.fs || fs;
  const pathMod = deps.path || path;
  const recover = deps.recoverManifestFromArchive || (() => ({}));
  const inputIsDirectory = fileSys.statSync(input).isDirectory();
  const primary = inputIsDirectory ? pathMod.join(input, "manifest.json") : input;
  if (fileSys.existsSync(primary)) return JSON.parse(fileSys.readFileSync(primary, "utf8"));
  const recovered = inputIsDirectory ? pathMod.join(input, "recovered-manifest.json") : "";
  if (recovered && fileSys.existsSync(recovered)) return JSON.parse(fileSys.readFileSync(recovered, "utf8"));
  if (inputIsDirectory) return recover(input);
  throw new Error(`No manifest found for ${input}`);
}

export function changeReportMarkdown(changeReport) {
  const itemLine = (row) => `- ${row.courseTitle || row.courseOrgUnitId || "Unknown course"} | ${row.source || "item"} | ${row.title || "(untitled)"}`;
  const changedLine = (entry) => {
    const before = entry.before || {};
    const after = entry.after || {};
    return `- ${after.courseTitle || after.courseOrgUnitId || "Unknown course"} | ${after.source || "item"} | ${after.title || "(untitled)"} | due: ${before.dueAtText || "(blank)"} -> ${after.dueAtText || "(blank)"} | status: ${before.status || "(blank)"} -> ${after.status || "(blank)"}`;
  };

  const lines = [
    "# D2L Change Report", "",
    `Current export: ${changeReport.currentExportedAt || ""}`,
    `Previous export: ${changeReport.previousExportedAt || ""}`, ""
  ];

  if (!changeReport.available) {
    lines.push("No previous export summary was available for comparison.", "", `Reason: ${changeReport.reason || "unknown"}`);
    return lines.join("\n");
  }

  lines.push(
    "## Totals", "",
    `- Added: ${changeReport.totals.added}`,
    `- Removed: ${changeReport.totals.removed}`,
    `- Changed: ${changeReport.totals.changed}`,
    `- Newly graded: ${changeReport.totals.newlyGraded}`,
    `- Newly due: ${changeReport.totals.newlyDue}`,
    `- Due date changed: ${changeReport.totals.dueChanged || 0}`,
    `- Availability changed: ${changeReport.totals.availabilityChanged || 0}`,
    `- Newly downloaded: ${changeReport.totals.newlyDownloaded}`,
    `- New feedback/results: ${changeReport.totals.newlyFeedback || 0}`, ""
  );

  const sections = [
    ["New Feedback / Results", changeReport.newlyFeedback || [], itemLine],
    ["Newly Graded", changeReport.newlyGraded, itemLine],
    ["Newly Due", changeReport.newlyDue, itemLine],
    ["Due Date Changed", changeReport.dueChanged || [], changedLine],
    ["Availability Changed", changeReport.availabilityChanged || [], changedLine],
    ["Added", changeReport.added, itemLine],
    ["Removed", changeReport.removed, itemLine],
    ["Changed", changeReport.changed, changedLine],
    ["Newly Downloaded", changeReport.newlyDownloaded, itemLine]
  ];

  for (const [title, items, formatter] of sections) {
    lines.push(`## ${title}`, "");
    if (!items.length) lines.push("- None");
    else items.forEach((item) => lines.push(formatter(item)));
    lines.push("");
  }
  return lines.join("\n");
}

const INDEXED_COLUMN_KEYS = [
  "module", "topicType", "displayedGrade", "points", "commentsAndAssessments",
  "feedbackText", "rubricText", "criterionName", "rubricLevel", "scoreText",
  "status", "assignmentTitle", "quizTitle", "discussionTopicId", "author",
  "postSubject", "calendarEventTitle", "contentTitle", "linkKind",
  "recoveredFrom", "toolSource", "emptyStateText", "blockedText"
];

function recordTextSnippet(row, columns) {
  const parts = [
    row.title, row.description, row.status, row.gate, row.type, row.dueAtText, row.availabilityText,
    ...INDEXED_COLUMN_KEYS.map((k) => columns[k]),
    row.localPageTextSnippet
  ];
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function aiIndexRecord(row, parse = parseJson) {
  const columns = parse(row.columns);
  const ids = parse(row.ids);
  return {
    id: stableRowId(row, parse),
    courseOrgUnitId: row.courseOrgUnitId || "",
    courseTitle: row.courseTitle || "",
    source: row.source || "",
    title: row.title || "",
    status: row.status || "",
    type: row.type || "",
    linkKind: columns.linkKind || "",
    text: recordTextSnippet(row, columns),
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

export function createRecordTools(deps = {}) {
  const parse = deps.parseJson || parseJson;
  const normalize = deps.normalizeText || ((s) => String(s || "").trim());
  return {
    stableRowId: (row) => stableRowId(row, parse),
    rowSignature,
    createExportSummary: (manifest) => createExportSummary(manifest, parse),
    feedbackSignal: (row) => feedbackSignal(row, parse),
    summarizeChanges: (prev, curr) => summarizeChanges(prev, curr, normalize, parse),
    manifestFromSource: (source) => manifestFromSource(source, deps),
    changeReportMarkdown,
    aiIndexRecord: (row) => aiIndexRecord(row, parse),
    toJsonl
  };
}
