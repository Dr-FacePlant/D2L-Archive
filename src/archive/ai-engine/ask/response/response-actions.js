// Actions attached to completed Ask answers: retry and local rating.
(function initAskResponseActions(global) {
  const dash = global.D2LDashboard ||= {};

  function bindAskResponseActions({ getState, getMessages, keep, refresh, retry }) {
    function rate(index, value) {
      const ask = getState(), message = getMessages()[index];
      if (ask.busy || ask.editingIndex != null || message?.role !== "assistant" || message.failed) return;
      message.rating = message.rating === value ? null : value;
      keep(ask.chat); refresh();
    }

    document.addEventListener("click", (event) => {
      const target = event.target.closest?.("[data-ask-retry], [data-ask-rate]");
      if (!target || target.disabled) return;
      if (target.hasAttribute("data-ask-retry")) retry(Number(target.dataset.askRetry));
      else if (target.hasAttribute("data-ask-rate")) rate(Number(target.dataset.askRate), target.dataset.rating);
    });
  }

  dash.bindAskResponseActions = bindAskResponseActions;
})(globalThis);
