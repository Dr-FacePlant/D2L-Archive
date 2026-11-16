// The "Start voice?" pop-up, just above the message box. Voice loads two models and turns on the
// microphone, so the first start asks. "Start voice" begins; "Not now", Esc or a press elsewhere
// closes it. "Don't ask again" is saved with the other settings; from then on the button starts voice at once.
// It works like the "Start Ask?" pop-up (ask/start-prompt.js) and sits in its own slot beside that one.
(function initVoiceStart(global) {
  const dash = global.D2LDashboard ||= {};
  const SETTING = "voiceStartWithoutAsking";

  // $ finds things on the page. settings() and saveSettings(patch): the dashboard's saved settings.
  // begin() starts voice.
  function createVoiceStart({ $, settings, saveSettings, begin }) {
    let asking = false;

    function close() {
      asking = false;
      const slot = $("#ask-voice-start-slot");
      if (slot) slot.innerHTML = "";
    }

    function request() {
      if (settings()[SETTING] === true) return void begin();
      const slot = $("#ask-voice-start-slot");
      if (!slot) return;
      asking = true;
      slot.innerHTML = dash.askVoiceStartHtml();
      slot.querySelector("[data-ask-voice-go]").focus();
    }

    function go() {
      if ($("#ask-voice-again")?.checked) saveSettings({ [SETTING]: true });
      close();
      begin();
    }

    document.addEventListener("click", (event) => {
      if (event.target.closest?.("[data-ask-voice-go]")) go();
      else if (event.target.closest?.("[data-ask-voice-cancel]")) close();
    });
    // A press anywhere else, or Esc, is "Not now". The microphone button is left out: its own click closes it.
    document.addEventListener("pointerdown", (event) => {
      if (asking && !event.target.closest?.("#ask-voice-pop, [data-ask-voice]")) close();
    });
    document.addEventListener("keydown", (event) => {
      if (asking && event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    });

    return { request, close, get asking() { return asking; } };
  }

  Object.assign(dash, { createVoiceStart, VOICE_START_SETTING: SETTING });
})(globalThis);
