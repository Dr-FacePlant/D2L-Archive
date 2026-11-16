// Ask's saved chats on the Ask screen: loads them for the signed-in account, keeps
// the open chat saved as it grows, and lists them to reopen, delete, or save to
// Downloads as Markdown. Everything stays on this computer (ask-saved-chats.js).
(function initDashboardAppAskChats(global) {
  const dash = global.D2LDashboard ||= {};

  // A download's file is read by then, so its in-memory copy can go.
  const FREE_URL_AFTER_MS = 60_000;

  // onChange: the list or its open/confirm state changed. onOpen(chat), onRemove(id): the
  // screen opens or forgets a chat. canSwitch(): false while an answer is being written.
  function createAskChatList({ toast, onChange, onOpen, onRemove, canSwitch }) {
    const list = { accountId: null, store: null, chats: [], memory: null, open: false, confirm: "" };

    // The saved chats of this account. Another account's are let go first.
    function useAccount(accountId) {
      if (list.accountId === accountId) return;
      const store = dash.createChatStore({ accountId });
      Object.assign(list, { accountId, store, chats: [], memory: null, confirm: "" });
      store.loadAll().then((chats) => {
        if (list.store !== store) return;
        const kept = new Set(list.chats.map((chat) => chat.id));
        list.chats = [...list.chats, ...chats.filter((chat) => !kept.has(chat.id))];
        list.memory = null;
        onChange();
      }, () => toast("Couldn't read your saved chats."));
    }

    // The open chat, saved again after each question and each answer.
    function keep(chat) {
      chat.title = dash.askChatTitle(chat.messages);
      chat.updatedAt = new Date().toISOString();
      list.chats = [chat, ...list.chats.filter((one) => one.id !== chat.id)];
      list.memory = null;
      return list.store?.save(chat).catch(() => toast("Couldn't save this chat on this computer."));
    }

    // What search_past_messages and chat_log read: every saved chat, rebuilt only after a change.
    function memory(currentId) {
      if (list.memory?.currentId !== currentId) list.memory = { currentId, ...dash.buildChatIndex(list.chats, currentId) };
      return list.memory;
    }

    // Each saved chat as a Markdown file in Downloads; saving again replaces the older copy.
    async function saveToDownloads() {
      let saved = 0;
      for (const chat of list.chats) {
        const url = URL.createObjectURL(new Blob([dash.askChatMarkdown(chat)], { type: "text/markdown" }));
        try {
          await chrome.downloads.download({ url, filename: dash.askChatFileName(chat), saveAs: false, conflictAction: "overwrite" });
          saved += 1;
        } catch {
          // Counted as not saved below.
        }
        setTimeout(() => URL.revokeObjectURL(url), FREE_URL_AFTER_MS);
      }
      const where = `Downloads/${dash.ASK_CHATS_FOLDER}`;
      toast(saved === list.chats.length ? `Saved ${dash.plural(saved, "chat")} to ${where}` : `Saved ${saved} of ${list.chats.length} chats to ${where}. Try again for the rest.`);
    }

    function remove(id) {
      list.chats = list.chats.filter((chat) => chat.id !== id);
      Object.assign(list, { memory: null, confirm: "" });
      onRemove(id);
      onChange();
      list.store?.remove(id).catch(() => toast("Couldn't delete that chat."));
    }

    document.addEventListener("click", (event) => {
      const target = event.target.closest?.("[data-ask-chats], [data-ask-open], [data-ask-delete], [data-ask-delete-yes], [data-ask-delete-no], [data-ask-export]");
      if (!target) return;
      if (target.hasAttribute("data-ask-chats")) {
        Object.assign(list, { open: !list.open, confirm: "" });
      } else if (target.hasAttribute("data-ask-open")) {
        const chat = list.chats.find((one) => one.id === target.getAttribute("data-ask-open"));
        if (!chat || !canSwitch()) return toast("Wait for this answer to finish first.");
        Object.assign(list, { open: false, confirm: "" });
        onOpen(chat);
      } else if (target.hasAttribute("data-ask-delete")) {
        list.confirm = target.getAttribute("data-ask-delete");
      } else if (target.hasAttribute("data-ask-delete-yes")) {
        if (!canSwitch()) return toast("Wait for this answer to finish first.");
        return remove(target.getAttribute("data-ask-delete-yes"));
      } else if (target.hasAttribute("data-ask-delete-no")) {
        list.confirm = "";
      } else if (target.hasAttribute("data-ask-export")) {
        return saveToDownloads();
      }
      onChange();
    });

    return { list, useAccount, keep, memory };
  }

  dash.createAskChatList = createAskChatList;
})(globalThis);
