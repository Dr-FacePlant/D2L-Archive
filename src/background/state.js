(function initBackgroundModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const {  } = shared;
  const { CRAWL_STATE_KEY } = background;

const STALE_CRAWL_MS = 3 * 60 * 1000;

async function setState(patch) {
  const current = (await chrome.storage.local.get(CRAWL_STATE_KEY))[CRAWL_STATE_KEY] || {};
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [CRAWL_STATE_KEY]: next });
  return next;
}

async function getState() {
  return (await chrome.storage.local.get(CRAWL_STATE_KEY))[CRAWL_STATE_KEY] || null;
}

function isStaleRunningState(state) {
  if (!state?.running) return false;
  const beat = Date.parse(state.updatedAt || state.startedAt || "");
  return !Number.isFinite(beat) || Date.now() - beat > STALE_CRAWL_MS;
}

// A crawl cannot outlive this service worker, so a "running" flag found at
// startup is always left over from a worker that was terminated mid-crawl.
(async () => {
  const state = await getState();
  if (state?.running) {
    await setState({
      running: false,
      complete: false,
      error: "Previous crawl was interrupted and has been reset.",
      activeWorkers: 0
    });
  }
})();

  Object.assign(background, { STALE_CRAWL_MS, setState, getState, isStaleRunningState });
})(globalThis);
