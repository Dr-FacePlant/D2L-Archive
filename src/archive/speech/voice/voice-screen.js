// Voice mode on the Ask screen: the microphone button, the bar, and the "Start voice?" pop-up, wired to
// voice-mode.js. Voice needs Ask's model, so starting voice starts Ask first when it isn't running.
// The parts are made the first time voice starts and let go by dispose() (leaving Ask), which frees the
// listening and speaking models. The microphone works only in the dashboard's own tab, so in the small
// window inside a D2L page the button opens that tab instead.
(function initVoiceScreen(global) {
  const dash = global.D2LDashboard ||= {};
  const OFF = { state: "off", message: "", heard: "", question: "", answer: "" };

  function openDashboardTab() {
    const url = global.chrome.runtime.getURL("dashboard.html#/ask");
    if (global.chrome.tabs?.create) global.chrome.tabs.create({ url });
    else global.open(url, "_blank");
  }

  // life: Ask's model lifecycle. send(question, { spoken, onText, onLookup }): sends a question to Ask (the screen's submit).
  // The create* arguments make the pieces; they are swapped for stand-ins in tests.
  function createVoiceScreen({
    $, life, send, settings, saveSettings, embedded = false, openTab = openDashboardTab,
    createMic = (options) => dash.createMicCapture(options),
    createListener = () => dash.createListenStream(),
    createSpeaker = () => dash.createPhononPlayback()
  }) {
    let voice = null, listener = null, speaker = null, snapshot = OFF, preparing = false, dismissed = false;

    const view = () => ({
      embedded, preparing, blocked: ["missing", "no-gpu"].includes(life.state), ...snapshot,
      message: snapshot.state === "off" && dismissed ? "" : snapshot.message
    });
    const active = () => preparing || snapshot.state !== "off";

    // The bar and the button are patched in place, so typing in the message box is never interrupted.
    function draw() {
      const bar = $("#ask-voice-slot"), slot = $("#ask-voice-button-slot");
      if (bar) bar.innerHTML = dash.askVoiceBarHtml(view());
      if (!slot) return;
      const refocus = Boolean(slot.querySelector("[data-ask-voice]") && global.document?.activeElement === slot.querySelector("[data-ask-voice]"));
      slot.innerHTML = dash.askVoiceButtonHtml(view());
      if (refocus) slot.querySelector("[data-ask-voice]")?.focus();
    }

    function parts() {
      if (voice) return voice;
      listener = createListener();
      speaker = createSpeaker();
      const mic = createMic({ onPiece: (piece) => voice.piece(piece) });
      voice = dash.createVoiceMode({ mic, listener, speaker, ask: { send }, onChange: (next) => { snapshot = next; draw(); } });
      return voice;
    }

    async function begin() {
      dismissed = false;
      snapshot = OFF; preparing = true; draw();
      if (life.state !== "ready") await life.start();
      if (!preparing) return;
      preparing = false;
      if (life.state !== "ready") {
        snapshot = { ...OFF, message: "Ask could not start, so voice could not start." };
        draw();
        return;
      }
      await parts().start();
    }

    const pop = dash.createVoiceStart({ $, settings, saveSettings, begin });

    function stop() {
      const wasPreparing = preparing;
      preparing = false;
      voice?.stop();
      if (wasPreparing) draw();
    }

    function toggle() {
      if (pop.asking) return pop.close();
      if (active()) return stop();
      pop.request();
    }

    // Leaving Ask: voice stops and the models are let go.
    function dispose() {
      stop(); pop.close();
      listener?.dispose(); speaker?.dispose();
      voice = listener = speaker = null;
      snapshot = OFF; dismissed = false;
    }

    document.addEventListener("click", (event) => {
      const target = event.target.closest?.("[data-ask-voice], [data-ask-voice-tab], [data-ask-voice-stop], [data-ask-voice-dismiss]");
      if (!target) return;
      if (target.hasAttribute("data-ask-voice-tab")) openTab();
      else if (target.hasAttribute("data-ask-voice-stop")) stop();
      else if (target.hasAttribute("data-ask-voice-dismiss")) { dismissed = true; draw(); }
      else toggle();
    });

    return { view, dispose, stop, toggle, get active() { return active(); } };
  }

  dash.createVoiceScreen = createVoiceScreen;
})(globalThis);
