import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const _shared = {};
const _rowsPath = new URL("../../src/shared/rows.js", import.meta.url);
const _evidencePath = new URL("../../src/shared/evidence.js", import.meta.url);
const _vmContext = { globalThis: { D2LExtractorShared: _shared }, JSON, Date, String };
vm.runInNewContext(fs.readFileSync(_rowsPath, "utf8"), _vmContext);
vm.runInNewContext(fs.readFileSync(_evidencePath, "utf8"), _vmContext);

export const apiProbeBreakdown = _shared.apiProbeBreakdown;
export const apiProbeSummaryRows = _shared.apiProbeSummaryRows;
export const apiProbeLegendLines = _shared.apiProbeLegendLines;
export const stableRowId = _shared.stableRowId;
export const rowSignature = _shared.rowSignature;
export const toJsonl = _shared.toJsonl;
export const parseColumns = _shared.parseColumns;
export const createExportSummary = _shared.createExportSummary;
export const feedbackSignal = _shared.feedbackSignal;
export const summarizeChanges = _shared.summarizeChanges;
export const emptyChangeReport = _shared.emptyChangeReport;
export const diffRow = _shared.diffRow;
export const aiIndexRecord = _shared.aiIndexRecord;
export const recordTextSnippet = _shared.recordTextSnippet;
export const INDEXED_COLUMN_KEYS = _shared.INDEXED_COLUMN_KEYS;
export const FEEDBACK_SOURCES = _shared.FEEDBACK_SOURCES;
export const uniqueRows = _shared.uniqueRows;
export const isStudentFeedbackRow = _shared.isStudentFeedbackRow;

export function loadArchiveManifest(input, usage) {
  if (!input) {
    console.error(usage);
    process.exit(1);
  }
  const archiveRoot = path.resolve(input);
  const manifestPath = path.join(archiveRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`No manifest.json found in ${archiveRoot}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return { archiveRoot, manifestPath, manifest };
}

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

export function manifestFromSource(source, deps = {}) {
  const resolve = deps.resolve || path.resolve;
  const existsSync = deps.existsSync || fs.existsSync;
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const target = resolve(source);
  const manifestPath = target.endsWith("manifest.json") ? target : path.join(target, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    return {
      exportedAt: raw.exportedAt || raw.audit?.generatedAt || "",
      rows: Array.isArray(raw.rows) ? raw.rows : []
    };
  } catch {
    return null;
  }
}

function appendChangeList(lines, title, items, rowFormatter) {
  if (!items.length) return;
  lines.push("", `### ${title} (${items.length})`);
  items.slice(0, 50).forEach((entry) => lines.push(rowFormatter(entry)));
}

function rowTitle(row) {
  return `${row.source || "row"}: ${row.title || row.id}`;
}

export function changeReportMarkdown(report) {
  if (!report.available) {
    return [
      "# Offline Change Detection Report",
      "",
      `- Status: ${report.reason}`,
      `- Current export: ${report.currentExportedAt || "unknown"}`
    ].join("\n");
  }

  const lines = [
    "# Offline Change Detection Report",
    "",
    `- Previous export: ${report.previousExportedAt || "none"}`,
    `- Current export: ${report.currentExportedAt}`,
    `- Added: ${report.totals.added}`,
    `- Removed: ${report.totals.removed}`,
    `- Changed: ${report.totals.changed}`,
    `- Newly graded: ${report.totals.newlyGraded}`,
    `- Newly due: ${report.totals.newlyDue}`,
    `- Due date changed: ${report.totals.dueChanged}`,
    `- Availability changed: ${report.totals.availabilityChanged}`,
    `- Newly downloaded files: ${report.totals.newlyDownloaded}`,
    `- Newly available feedback: ${report.totals.newlyFeedback}`
  ];

  appendChangeList(lines, "Added Evidence", report.added, (row) => `- ${rowTitle(row)}`);
  appendChangeList(lines, "Removed Evidence", report.removed, (row) => `- ${rowTitle(row)}`);
  appendChangeList(lines, "Newly Graded", report.newlyGraded, (row) => `- ${rowTitle(row)}`);
  appendChangeList(lines, "Newly Due", report.newlyDue, (row) => `- ${rowTitle(row)} (due: ${row.dueAtText || "set"})`);
  appendChangeList(lines, "Due Date Changes", report.dueChanged, ({ before, after }) => `- ${rowTitle(after)}: "${before.dueAtText || ""}" -> "${after.dueAtText || ""}"`);
  appendChangeList(lines, "Availability Changes", report.availabilityChanged, ({ before, after }) => `- ${rowTitle(after)}: "${before.availabilityText || ""}" -> "${after.availabilityText || ""}"`);
  appendChangeList(lines, "Newly Downloaded Files", report.newlyDownloaded, (row) => `- ${rowTitle(row)} -> ${row.localPath}`);
  appendChangeList(lines, "Newly Available Feedback / Results", report.newlyFeedback, (row) => `- ${rowTitle(row)}`);
  appendChangeList(lines, "Other Changed Rows", report.changed, ({ before, after }) => `- ${rowTitle(after)} (signature changed)`);

  return lines.join("\n");
}

export function createRecordTools(deps = {}) {
  const parse = deps.parseJson || parseJson;
  const normalize = deps.normalizeText || ((s) => String(s || "").trim());
  return {
    stableRowId: (row) => stableRowId(row),
    rowSignature,
    createExportSummary: (manifest) => createExportSummary(manifest),
    feedbackSignal: (row) => feedbackSignal(row),
    summarizeChanges: (prev, curr) => summarizeChanges(prev, curr, normalize),
    manifestFromSource: (source) => manifestFromSource(source, deps),
    changeReportMarkdown,
    aiIndexRecord: (row) => aiIndexRecord(row),
    toJsonl
  };
}
