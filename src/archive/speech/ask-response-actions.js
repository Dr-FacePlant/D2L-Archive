// Actions attached to completed Ask answers: retry, local rating and speech.
(function initAskResponseActions(global) {
  const dash = global.D2LDashboard ||= {};

  function bindAskResponseActions({ getState, getMessages, keep, refresh, retry, speech }) {
    function rate(index, value) {
      const ask = getState(), message = getMessages()[index];
      if (ask.busy || ask.editingIndex != null || message?.role !== "assistant" || message.failed) return;
      message.rating = message.rating === value ? null : value;
      keep(ask.chat); refresh();
    }

    function speak(index) {
      const ask = getState(), message = getMessages()[index];
      if (ask.speechIndex === index && ["loading", "playing"].includes(ask.speechState)) return speech.stop();
      if (ask.busy || ask.editingIndex != null || message?.role !== "assistant" || message.failed) return;
      ask.speechIndex = index;
      speech.play(message.text);
    }

    document.addEventListener("click", (event) => {
      const target = event.target.closest?.("[data-ask-retry], [data-ask-rate], [data-ask-speak]");
      if (!target || target.disabled) return;
      if (target.hasAttribute("data-ask-retry")) retry(Number(target.dataset.askRetry));
      else if (target.hasAttribute("data-ask-rate")) rate(Number(target.dataset.askRate), target.dataset.rating);
      else speak(Number(target.dataset.askSpeak));
    });
  }

  dash.bindAskResponseActions = bindAskResponseActions;
})(globalThis);
