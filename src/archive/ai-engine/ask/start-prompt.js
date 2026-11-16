// The "Start Ask?" pop-up. The model (about 1.4 GB) is loaded only when you say so,
// so a question sent while it isn't loaded asks first, just above the message box.
// "Start and send" loads it and sends the question; "Not now" puts the question back
// in the box. "Don't ask again" is saved with the other settings; from then on a send
// starts the model straight away. While it loads, the question waits in the chat
// (render-ask.js shows it with the progress) and is sent once the model is ready.
(function initAskStartPrompt(global) {
  const dash = global.D2LDashboard ||= {};
  const SETTING = "askStartWithoutAsking";

  function startPromptHtml() {
    return `<div class="ask-start-pop" id="ask-start-pop" role="dialog" aria-labelledby="ask-start-title" aria-describedby="ask-start-text">
      <b id="ask-start-title">Start Ask?</b>
      <p id="ask-start-text">Ask loads a 1.4 GB model into your computer's memory and graphics card. It is let go when you leave Ask. Your archive never leaves this computer.</p>
      <label class="ask-start-again"><input type="checkbox" id="ask-start-again"> Don't ask again</label>
      <div class="ask-start-row"><button class="btn" type="button" data-ask-start-cancel>Not now</button><button class="btn btn-primary" type="button" data-ask-start-go>Start and send</button></div>
    </div>`;
  }

  // life: the model's lifecycle (ask-lifecycle.js). settings() and saveSettings(patch): the
  // dashboard's saved settings. send(question) once the model is ready; putBack(question)
  // returns a question to the box; onChange() redraws the chat.
  function createAskStart({ life, $, settings, saveSettings, send, putBack, onChange }) {
    let asking = "";
    let waiting = "";

    async function begin(question) {
      waiting = question;
      onChange();
      await life.start();
      // A new chat, or leaving Ask, dropped this question while the model loaded.
      if (waiting !== question) return;
      waiting = "";
      if (life.state === "ready") send(question);
      else { onChange(); putBack(question); }
    }

    function open(question) {
      const slot = $("#ask-start-slot");
      if (!slot) return putBack(question);
      asking = question;
      slot.innerHTML = startPromptHtml();
      slot.querySelector("[data-ask-start-go]").focus();
    }

    function close({ back = true } = {}) {
      const question = asking;
      asking = "";
      const slot = $("#ask-start-slot");
      if (slot) slot.innerHTML = "";
      if (back && question) putBack(question);
    }

    // A question sent while the model isn't loaded. One question at a time: another one
    // sent meanwhile goes back in the box.
    function request(question) {
      if (waiting || asking) return putBack(question);
      if (life.state === "loading") return void begin(question);
      if (!["idle", "error"].includes(life.state)) return putBack(question);
      if (settings()[SETTING] === true) return void begin(question);
      open(question);
    }

    function go() {
      const question = asking;
      if ($("#ask-start-again")?.checked) saveSettings({ [SETTING]: true });
      close({ back: false });
      begin(question);
    }

    // A new chat or leaving Ask: the pop-up closes and nothing waits any more.
    function reset() {
      close({ back: false });
      waiting = "";
    }

    document.addEventListener("click", (event) => {
      if (event.target.closest?.("[data-ask-start-go]")) go();
      else if (event.target.closest?.("[data-ask-start-cancel]")) close();
    });
    // A press anywhere else, or Esc, is "Not now". (pointerdown: the click that opened it has already happened.)
    document.addEventListener("pointerdown", (event) => {
      if (asking && !event.target.closest?.("#ask-start-pop")) close();
    });
    // This Esc closes only the pop-up, not the archive window around it (app-events.js listens later).
    document.addEventListener("keydown", (event) => {
      if (asking && event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    });

    return { request, reset, get waiting() { return waiting; }, get asking() { return asking; } };
  }

  Object.assign(dash, { askStartPromptHtml: startPromptHtml, createAskStart, ASK_START_SETTING: SETTING });
})(globalThis);
