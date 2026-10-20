(function initProbeFrameModule(global) {
  const shared = global.D2LExtractorShared;
  const content = global.D2LExtractorContent ||= {};
  const { D2L_ORIGIN, isSafeReadOnlyUrl } = shared;

  const REQUEST = "D2L_EXTRACTOR_PROBE_FRAME_READ";
  const RESPONSE = "D2L_EXTRACTOR_PROBE_FRAME_RESULT";
  const FRAME_ID = "d2l-extractor-probe-frame";
  const READ_ATTEMPTS = 26;
  const READ_DELAY_MS = 650;
  const LOAD_TIMEOUT_MS = 20000;
  let chain = Promise.resolve();
  let frame = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function safeProbeTask(task) {
    const url = String(task?.url || "");
    if (!isSafeReadOnlyUrl(url)) throw new Error("Probe frames only load safe Kennesaw D2L URLs.");
    return {
      title: String(task?.title || ""),
      url,
      expectedPageType: String(task?.expectedPageType || ""),
      courseOrgUnitId: String(task?.courseOrgUnitId || ""),
      sourcePageType: String(task?.sourcePageType || "sameTabProbe")
    };
  }

  function probePayloadReady(payload) {
    if (!payload || typeof payload !== "object") return false;
    const expected = payload.diagnostics?.expectedSource;
    const expectedCount = Number(payload.diagnostics?.expectedCount || 0);
    const hasItems = Array.isArray(payload.items) && payload.items.length > 0;
    return Boolean(payload.diagnostics?.emptyState
      || (!payload.diagnostics?.loading && (!expected || expectedCount > 0 || hasItems)));
  }

  function ensureFrame() {
    if (frame?.isConnected) return frame;
    frame = document.createElement("iframe");
    frame.id = FRAME_ID;
    frame.title = "D2L extraction probe";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1280px;height:900px;visibility:hidden;pointer-events:none;border:0";
    document.documentElement.append(frame);
    return frame;
  }

  function closeProbeFrame() {
    if (frame?.isConnected) frame.remove();
    frame = null;
  }

  function waitForLoad(target) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("D2L probe frame did not load.")), LOAD_TIMEOUT_MS);
      target.addEventListener("load", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }

  function requestExtraction(target, requestId) {
    return new Promise((resolve) => {
      const listener = (event) => {
        if (event.origin !== D2L_ORIGIN || event.source !== target.contentWindow) return;
        if (event.data?.type !== RESPONSE || event.data?.requestId !== requestId) return;
        global.removeEventListener("message", listener);
        resolve(event.data);
      };
      global.addEventListener("message", listener);
      target.contentWindow.postMessage({ type: REQUEST, requestId }, D2L_ORIGIN);
      setTimeout(() => {
        global.removeEventListener("message", listener);
        resolve(null);
      }, READ_DELAY_MS - 50);
    });
  }

  async function readLoadedFrame(target) {
    let lastPayload = null;
    let lastError = "";
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
      const requestId = `${Date.now()}-${attempt}-${Math.random().toString(36).slice(2, 9)}`;
      const result = await requestExtraction(target, requestId);
      if (result?.payload) {
        lastPayload = result.payload;
        if (probePayloadReady(lastPayload)) return lastPayload;
      } else if (result?.error) {
        lastError = result.error;
      }
      await sleep(READ_DELAY_MS);
    }
    if (lastPayload) return lastPayload;
    throw new Error(lastError || "D2L probe frame did not become readable.");
  }

  async function navigateAndRead(url) {
    const target = ensureFrame();
    const loaded = waitForLoad(target);
    target.src = url;
    await loaded;
    return readLoadedFrame(target);
  }

  async function runProbeFrameTask(rawTask) {
    const task = safeProbeTask(rawTask);
    let payload;
    try {
      payload = await navigateAndRead(task.url);
    } catch (error) {
      if (task.expectedPageType !== "quizSummary" || !task.courseOrgUnitId) throw error;
      await navigateAndRead(`${D2L_ORIGIN}/d2l/home/${task.courseOrgUnitId}`).catch(() => null);
      await navigateAndRead(`${D2L_ORIGIN}/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${task.courseOrgUnitId}`).catch(() => null);
      payload = await navigateAndRead(task.url);
    }
    payload.crawlTask = {
      title: task.title,
      expectedPageType: task.expectedPageType,
      requestedUrl: task.url
    };
    return payload;
  }

  function probeFrameTask(task) {
    const run = chain.then(() => runProbeFrameTask(task));
    chain = run.catch(() => {});
    return run;
  }

  // A child D2L frame extracts its own rendered document. The random request ID
  // and event.source check keep unrelated page messages out of the exchange.
  if (global.top !== global.self) {
    global.addEventListener("message", (event) => {
      if (event.origin !== D2L_ORIGIN || event.source !== global.parent || event.data?.type !== REQUEST) return;
      try {
        const payload = content.extractVisiblePage();
        global.parent.postMessage({ type: RESPONSE, requestId: event.data.requestId, payload }, D2L_ORIGIN);
      } catch (error) {
        global.parent.postMessage({ type: RESPONSE, requestId: event.data.requestId, error: error?.message || "Probe extraction failed." }, D2L_ORIGIN);
      }
    });
  }

  Object.assign(content, { safeProbeTask, probePayloadReady, probeFrameTask, closeProbeFrame });
})(globalThis);
