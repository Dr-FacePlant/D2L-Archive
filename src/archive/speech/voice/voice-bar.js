// What voice mode looks like on the Ask screen: the microphone button next to Send, the bar above the
// message box (what it is doing, the words heard so far, Stop), and the "Start voice?" pop-up text.
// Pure HTML builders over the view that voice-screen.js keeps: { embedded, blocked, preparing, state,
// message, heard, question }. state is voice mode's: off, starting, listening, thinking, speaking.
(function initVoiceBar(global) {
  const dash = global.D2LDashboard ||= {};
  const e = (text) => dash.escapeHtml(text);

  const MIC = "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M18 11v1a6 6 0 0 1-12 0v-1 M12 18v3 M9 21h6";
  const icon = (path, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;

  // Before voice has been set up (or in a test of the page alone) there is nothing to show.
  const QUIET = { embedded: false, blocked: false, preparing: false, state: "off", message: "", heard: "", question: "" };
  const isOn = (voice) => Boolean(voice.preparing || voice.state !== "off");

  // In the small window inside a D2L page the microphone can't be used, so the button opens the dashboard in a tab.
  function buttonHtml(voice = QUIET) {
    if (voice.embedded) {
      return `<button class="ask-voice-tab" type="button" data-ask-voice-tab title="Voice works in the dashboard's own tab. Open it there.">${dash.icon("external", 14)}Voice: open in a tab</button>`;
    }
    const on = isOn(voice);
    const label = voice.blocked ? "Voice needs Ask to run in this browser" : on ? "Stop voice" : "Start voice";
    return `<button class="ask-voice${on ? " is-on" : ""}" type="button" data-ask-voice aria-pressed="${on}" aria-label="${label}" title="${label}"${voice.blocked ? " disabled" : ""}>${icon(MIC)}</button>`;
  }

  // The heading says what voice is doing; the words under it are what was heard, or the question being answered.
  function barParts(voice) {
    if (voice.preparing) return { label: "Starting Ask…", words: "" };
    if (voice.state === "starting") return { label: "Getting the voice ready…", words: voice.message };
    if (voice.state === "listening") return { label: "Listening…", words: voice.heard || voice.message || "Say your question." };
    if (voice.state === "thinking") return { label: "Thinking…", words: voice.question };
    if (voice.state === "speaking") return { label: "Speaking…", words: voice.question };
    return voice.message ? { label: "Voice stopped", words: voice.message } : null;
  }

  function barHtml(voice = QUIET) {
    const parts = barParts(voice);
    if (!parts) return "";
    const state = voice.preparing ? "starting" : voice.state;
    const action = state === "off" ? `<button class="btn" type="button" data-ask-voice-dismiss>Close</button>` : `<button class="btn" type="button" data-ask-voice-stop>Stop</button>`;
    const words = parts.words ? `<span class="ask-voice-words">${e(parts.words)}</span>` : "";
    return `<div class="ask-voice-bar" data-state="${state}" role="group" aria-label="Voice"><i class="ask-voice-dot" aria-hidden="true"></i><div class="ask-voice-text"><span class="ask-voice-state" role="status">${e(parts.label)}</span>${words}</div>${action}</div>`;
  }

  function startPopHtml() {
    return `<div class="ask-start-pop" id="ask-voice-pop" role="dialog" aria-labelledby="ask-voice-title" aria-describedby="ask-voice-text">
      <b id="ask-voice-title">Start voice?</b>
      <p id="ask-voice-text">Voice loads two small models into this computer's memory, one that listens (about 190 MB) and one that speaks (about 100 MB), and starts Ask if it isn't running. The microphone is on only while voice is. Sound is never saved or sent anywhere.</p>
      <label class="ask-start-again"><input type="checkbox" id="ask-voice-again"> Don't ask again</label>
      <div class="ask-start-row"><button class="btn" type="button" data-ask-voice-cancel>Not now</button><button class="btn btn-primary" type="button" data-ask-voice-go>Start voice</button></div>
    </div>`;
  }

  Object.assign(dash, { askVoiceButtonHtml: buttonHtml, askVoiceBarHtml: barHtml, askVoiceStartHtml: startPopHtml });
})(globalThis);
