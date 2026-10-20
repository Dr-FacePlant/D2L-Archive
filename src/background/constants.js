(function initBackgroundModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const {  } = shared;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

  Object.assign(background, { CRAWL_STATE_KEY, LAST_EXPORT_KEY, MAX_PAGES, WORKER_COUNT, PAGE_LOAD_DELAY_MS, DOWNLOAD_MIME, sleep });
})(globalThis);
