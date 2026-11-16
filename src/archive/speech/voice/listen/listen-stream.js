// The page's side of the listening worker: load it once, then feed() it 160 ms pieces from the
// microphone. Each feed() settles with what that piece contained: { words, ended }.
// dispose() stops the worker and frees the model; pieces still waiting are rejected.
(function initVoiceListenStream(global) {
  const dash = global.D2LDashboard ||= {};
  const WORKER = "src/dashboard/voice/listen/listen-worker.js";

  function createListenStream({
    fileUrl = (path) => global.chrome.runtime.getURL(path),
    createWorker = (url) => new global.Worker(url)
  } = {}) {
    let worker = null, loading = null, ready = false, nextId = 0;
    const waiting = new Map();

    function failAll(error) {
      for (const [, entry] of waiting) entry.reject(error);
      waiting.clear();
    }

    function load() {
      if (ready) return Promise.resolve();
      if (loading) return loading;
      loading = new Promise((resolve, reject) => {
        const mine = worker = createWorker(fileUrl(WORKER));
        const fail = (error) => { if (worker === mine) dispose(error); reject(error); };
        mine.onerror = (event) => fail(new Error(event?.message || "The listening model could not start."));
        mine.onmessage = ({ data }) => {
          if (worker !== mine) return;
          if (data.type === "ready") { ready = true; resolve(); }
          else if (data.type === "error" && !ready) fail(new Error(data.message));
          else if (data.type === "error") { waiting.get(data.id)?.reject(new Error(data.message)); waiting.delete(data.id); }
          else if (data.type === "heard") { waiting.get(data.id)?.resolve({ words: data.words, ended: data.ended }); waiting.delete(data.id); }
        };
        mine.postMessage({ type: "load", base: fileUrl("") });
      }).finally(() => { loading = null; });
      return loading;
    }

    // The piece's memory goes to the worker; the caller must not use it afterwards.
    function feed(piece) {
      if (!ready) return Promise.reject(new Error("The listening model is not loaded."));
      const id = nextId += 1;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        worker.postMessage({ type: "piece", id, audio: piece }, [piece.buffer]);
      });
    }

    // The next piece starts a new utterance.
    function reset() { if (ready) worker.postMessage({ type: "reset" }); }

    function dispose(error = new Error("Listening stopped.")) {
      const old = worker;
      worker = null; ready = false;
      failAll(error);
      if (old) { old.onmessage = null; old.onerror = null; old.terminate(); }
    }

    return { load, feed, reset, dispose, get ready() { return ready; } };
  }

  dash.createListenStream = createListenStream;
})(globalThis);
