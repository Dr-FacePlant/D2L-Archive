(function initBackgroundModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { classifyUrl, canonicalUrl, isSafeReadOnlyUrl } = shared;
  const { sleep, PAGE_LOAD_DELAY_MS, WORKER_COUNT } = background;

async function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

function contentScriptFiles(manifest = chrome.runtime.getManifest()) {
  const files = manifest?.content_scripts?.[0]?.js;
  return Array.isArray(files) && files.length ? files : ["content.js"];
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: contentScriptFiles()
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForTabReady(tabId) {
  let lastPayload = null;
  let lastError = "";
  for (let index = 0; index < 26; index += 1) {
    try {
      await chrome.tabs.get(tabId);
      const response = await sendToTab(tabId, { type: "D2L_EXTRACT_VISIBLE_PAGE" });
      if (response?.ok) {
        const payload = response.payload;
        lastPayload = payload;
        const expected = payload.diagnostics?.expectedSource;
        const expectedCount = payload.diagnostics?.expectedCount || 0;
        const hasItems = Array.isArray(payload.items) && payload.items.length > 0;
        const acceptable =
          payload.diagnostics?.emptyState ||
          (!payload.diagnostics?.loading && (!expected || expectedCount > 0 || hasItems));
        if (acceptable) return payload;
      } else if (response?.error) {
        lastError = response.error;
      }
    } catch (error) {
      lastError = error?.message || lastError;
      if (index === 2 || index === 8 || index === 16) await ensureContentScript(tabId);
      // Keep polling while content scripts attach and D2L widgets render.
    }
    await sleep(650);
  }
  if (lastPayload) return lastPayload;
  throw new Error(lastError ? `D2L page extraction failed: ${lastError}` : "D2L page did not become readable.");
}

function frameNavigationTarget(target) {
  return target && typeof target === "object" && target.mode === "frame" && Number.isInteger(target.tabId);
}

async function sendToTopFrameWithRetry(tabId, message) {
  let lastError = "";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!isSafeReadOnlyUrl(tab?.url || "")) throw new Error("The sync tab left Kennesaw D2L.");
      const response = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
      if (response?.ok) return response;
      lastError = response?.error || lastError;
    } catch (error) {
      lastError = error?.message || lastError;
    }
    await sleep(750);
  }
  throw new Error(lastError || "The D2L page was not available for same-tab extraction.");
}

function shouldQueue(record, seen) {
  if (!record?.url || seen.has(canonicalUrl(record.url))) return false;
  return isSafeReadOnlyUrl(record.url);
}

function enqueue(queue, seen, records) {
  for (const record of records || []) {
    if (!shouldQueue(record, seen)) continue;
    seen.add(canonicalUrl(record.url));
    queue.push({ ...record, expectedPageType: record.expectedPageType || classifyUrl(record.url) });
  }
}

function prioritizeQueue(queue) {
  const score = (record) => {
    const url = record.url || "";
    if (/\/d2l\/home\/\d+/.test(url)) return 0;
    if (/\/dropbox\/user\/folders_list\.d2l/.test(url)) return 1;
    if (/\/quizzing\/user\/quizzes_list\.d2l/.test(url)) return 2;
    if (/\/grades\/my_grades\/main\.d2l/.test(url)) return 3;
    if (/\/discussions\/List/.test(url)) return 4;
    if (/\/d2l\/le\/content\//.test(url)) return 5;
    if (/\/calendar\//.test(url)) return 6;
    return 10;
  };
  queue.sort((a, b) => score(a) - score(b));
}

async function navigateAndExtract(target, task) {
  if (frameNavigationTarget(target)) {
    await target.onProgress?.({ state: "starting", task });
    try {
      const response = await sendToTopFrameWithRetry(target.tabId, { type: "D2L_PROBE_FRAME_TASK", task });
      await target.onProgress?.({ state: "complete", task });
      return response.payload;
    } catch (error) {
      await target.onProgress?.({ state: "failed", task, error: error?.message || "Probe failed." });
      throw error;
    }
  }

  const tabId = target;
  await chrome.tabs.update(tabId, { url: task.url });
  await sleep(PAGE_LOAD_DELAY_MS);
  let payload;
  try {
    payload = await waitForTabReady(tabId);
  } catch (error) {
    if (task.expectedPageType === "quizSummary" && task.courseOrgUnitId) {
      await chrome.tabs.update(tabId, { url: `https://kennesaw.view.usg.edu/d2l/home/${task.courseOrgUnitId}` });
      await sleep(PAGE_LOAD_DELAY_MS);
      await waitForTabReady(tabId).catch(() => null);
      await chrome.tabs.update(tabId, { url: `https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${task.courseOrgUnitId}` });
      await sleep(PAGE_LOAD_DELAY_MS);
      await waitForTabReady(tabId).catch(() => null);
      await chrome.tabs.update(tabId, { url: task.url });
      await sleep(PAGE_LOAD_DELAY_MS);
      payload = await waitForTabReady(tabId);
    } else {
      throw error;
    }
  }
  payload.crawlTask = {
    title: task.title || "",
    expectedPageType: task.expectedPageType || classifyUrl(task.url),
    requestedUrl: task.url
  };
  return payload;
}


async function createWorkerTabs(startUrl, workerCount = WORKER_COUNT, reusableTabId = null) {
  const tabs = [];
  if (reusableTabId) {
    try {
      const existing = await chrome.tabs.get(reusableTabId);
      if (/^https:\/\/kennesaw\.view\.usg\.edu\/d2l\//.test(existing?.url || "")) {
        const tab = await chrome.tabs.update(reusableTabId, { url: startUrl });
        if (tab?.id) tabs.push(tab);
      }
    } catch {
      // Fall back to a fresh worker tab if the sender tab is unavailable.
    }
  }
  for (let index = tabs.length; index < workerCount; index += 1) {
    const tab = await chrome.tabs.create({ url: startUrl, active: false });
    tabs.push(tab);
  }

  if (chrome.tabs.group && chrome.tabGroups?.update) {
    try {
      const groupId = await chrome.tabs.group({ tabIds: tabs.map((tab) => tab.id) });
      await chrome.tabGroups.update(groupId, { title: "D2L Extractor", color: "blue" });
    } catch {
      // Grouping is cosmetic; continue if the API is unavailable in this browser.
    }
  }

  return tabs;
}

  Object.assign(background, { sendToTab, contentScriptFiles, ensureContentScript, waitForTabReady, frameNavigationTarget, sendToTopFrameWithRetry, shouldQueue, enqueue, prioritizeQueue, navigateAndExtract, createWorkerTabs });
})(globalThis);
