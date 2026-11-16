// Microphone for voice mode: asks the browser for the microphone and hands the page 160 ms pieces
// (2560 samples, 16 kHz, mono, floats from -1 to 1), the size the listening model takes.
// Nothing is recorded or kept: a piece goes to onPiece and is gone. stop() lets go of the microphone.
(function initDashboardMicCapture(global) {
  const dash = global.D2LDashboard ||= {};
  const RATE = 16000;
  const WORKLET = "src/dashboard/voice/mic-worklet.js";
  const PROCESSOR = "d2l-mic-pieces";
  const CONSTRAINTS = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

  // What went wrong, in words for the screen, from the name the browser gives the failure.
  function failure(error) {
    const name = error?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError") return { state: "blocked", message: "The microphone is blocked. Allow it for D2L Archive in the browser's site settings, or open the dashboard in its own tab, then try again." };
    if (name === "NotFoundError" || name === "OverconstrainedError") return { state: "no-mic", message: "No microphone was found." };
    if (name === "NotReadableError" || name === "AbortError") return { state: "busy", message: "The microphone is in use by another app." };
    return { state: "error", message: error?.message || "The microphone could not be started." };
  }

  function release(opened) {
    if (!opened) return;
    for (const track of opened.stream?.getTracks?.() || []) { try { track.stop(); } catch {} }
    try { opened.source?.disconnect(); } catch {}
    if (opened.node) opened.node.port.onmessage = null;
    try { Promise.resolve(opened.context?.close()).catch(() => {}); } catch {}
  }

  // states: idle, asking (the browser may be showing its permission prompt), listening, blocked,
  // no-mic, busy, unavailable, error. onChange gets { state, message }; message is also kept (why it failed).
  function createMicCapture({
    onPiece = () => {}, onChange = () => {},
    mediaDevices = global.navigator?.mediaDevices,
    fileUrl = (path) => global.chrome.runtime.getURL(path),
    createAudioContext = (options) => new (global.AudioContext || global.webkitAudioContext)(options),
    createNode = (context) => new global.AudioWorkletNode(context, PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 })
  } = {}) {
    let state = "idle", said = "", session = null, starting = null, generation = 0;
    const notify = (next, message = "") => { state = next; said = message; onChange({ state, message }); };

    async function open(mine) {
      const opened = {};
      try {
        opened.stream = await mediaDevices.getUserMedia(CONSTRAINTS);
        if (mine !== generation) return release(opened) || false;
        opened.context = createAudioContext({ sampleRate: RATE });
        if (opened.context.sampleRate !== RATE) throw new Error("This browser can't capture sound at 16 kHz.");
        await opened.context.audioWorklet.addModule(fileUrl(WORKLET));
        await opened.context.resume?.();
        if (mine !== generation) return release(opened) || false;
        opened.source = opened.context.createMediaStreamSource(opened.stream);
        opened.node = createNode(opened.context);
        opened.node.port.onmessage = ({ data }) => { if (session === opened) onPiece(data); };
        opened.source.connect(opened.node);
        opened.stream.getAudioTracks?.()[0]?.addEventListener("ended", () => {
          if (session !== opened) return;
          session = null; release(opened); notify("error", "The microphone stopped working.");
        });
        session = opened;
        notify("listening");
        return true;
      } catch (error) {
        release(opened);
        if (mine === generation) { const reason = failure(error); notify(reason.state, reason.message); }
        return false;
      }
    }

    // Resolves true once pieces are coming, false if it could not start (state says why).
    function start() {
      if (session) return Promise.resolve(true);
      if (starting) return starting;
      if (!mediaDevices?.getUserMedia) { notify("unavailable", "This page can't use a microphone."); return Promise.resolve(false); }
      generation += 1;
      notify("asking");
      const attempt = starting = open(generation);
      attempt.finally(() => { if (starting === attempt) starting = null; });
      return attempt;
    }

    function stop() {
      generation += 1; starting = null;
      const old = session; session = null;
      release(old);
      if (state !== "idle") notify("idle");
    }

    return { start, stop, get state() { return state; }, get message() { return said; } };
  }

  dash.createMicCapture = createMicCapture;
})(globalThis);
