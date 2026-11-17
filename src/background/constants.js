(function initBackgroundModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { ORGANIZER_VERSION } = shared || {};
  const {  } = background;

const CRAWL_STATE_KEY = "d2lCrawlerState";
const LAST_EXPORT_KEY = "d2lLastExportSummary";
const MAX_PAGES = 400;
const WORKER_COUNT = 3;
const PAGE_LOAD_DELAY_MS = 3200;
const DOWNLOAD_MIME = {
  csv: "text/csv",
  json: "application/json",
  jsonl: "application/x-ndjson",
  md: "text/markdown"
};

function createOrganizerRelation(from, toId, type, signal, value, createdAt) {
  return {
    relationshipId: `${from.entityId}::${type}::${toId}`,
    courseId: from.courseId,
    fromId: from.entityId,
    toId,
    type,
    confidence: 1,
    classification: "confirmed",
    evidence: [{ signal, value: shared.normalizeText ? shared.normalizeText(value) : String(value || "").trim(), weight: 1 }],
    organizerVersion: ORGANIZER_VERSION || "8",
    createdAt
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


  function createOrganizerMeta(record, createdAt) {
    return {
      conflicts: [],
      primaryEvidenceId: record.evidenceId,
      organizerVersion: ORGANIZER_VERSION || "8",
      createdAt,
      updatedAt: createdAt
    };
  }

  Object.assign(background, { createOrganizerMeta, createOrganizerRelation, CRAWL_STATE_KEY, LAST_EXPORT_KEY, MAX_PAGES, WORKER_COUNT, PAGE_LOAD_DELAY_MS, DOWNLOAD_MIME, sleep });
})(globalThis);
