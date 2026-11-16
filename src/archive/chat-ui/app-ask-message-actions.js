// Message controls for Ask: copying, editing and rewinding saved turns.
(function initDashboardAppAskMessageActions(global) {
  const dash = global.D2LDashboard ||= {};

  function bindAskMessageActions({ $, getMessages, getState, keep, refresh, toast, submit }) {
    function edit(index) {
      const ask = getState(), message = getMessages()[index];
      if (ask.busy || ask.editingIndex != null || message?.role !== "user") return;
      ask.editingIndex = index; ask.editDraft = message.text; refresh();
      const input = $("#ask-edit-input"); input?.focus(); input?.setSelectionRange(0, input.value.length);
    }

    function rewind(index) {
      const ask = getState(), chat = ask.chat, message = chat?.messages[index];
      if (ask.busy || ask.editingIndex != null || message?.role !== "user") return;
      const kept = dash.askMessagesThroughTurn(chat.messages, index);
      if (kept.length === chat.messages.length || !global.confirm("Remove later messages from this chat?")) return;
      chat.messages = kept; keep(chat); refresh({ bottom: true });
    }

    async function copy(index) {
      const message = getMessages()[index];
      if (typeof message?.text !== "string") return;
      try {
        if (!global.navigator?.clipboard?.writeText) throw new Error();
        await global.navigator.clipboard.writeText(message.text);
        toast("Message copied");
      } catch {
        toast("Couldn't copy the message.");
      }
    }

    document.addEventListener("click", (event) => {
      const target = event.target.closest?.("[data-ask-copy-message], [data-ask-edit], [data-ask-rewind], [data-ask-edit-cancel]");
      if (!target) return;
      if (target.hasAttribute("data-ask-copy-message")) copy(Number(target.dataset.askCopyMessage));
      else if (target.hasAttribute("data-ask-edit")) edit(Number(target.dataset.askEdit));
      else if (target.hasAttribute("data-ask-rewind")) rewind(Number(target.dataset.askRewind));
      else if (target.hasAttribute("data-ask-edit-cancel")) {
        getState().editingIndex = null; getState().editDraft = ""; refresh(); $("#ask-input")?.focus();
      }
    });
    document.addEventListener("input", (event) => { if (event.target.id === "ask-edit-input") getState().editDraft = event.target.value; });
    document.addEventListener("submit", (event) => {
      if (event.target.id !== "ask-edit-form") return;
      event.preventDefault(); const text = $("#ask-edit-input")?.value.trim();
      if (text && !getState().busy) submit(text);
    });
  }

  dash.bindAskMessageActions = bindAskMessageActions;
})(globalThis);
