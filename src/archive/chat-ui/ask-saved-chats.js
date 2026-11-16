// Ask's saved chats: kept in the extension's own storage on this computer (one
// list per D2L account), searchable by the model as its memory of earlier chats,
// and written out as Markdown for reading. Nothing here goes online.
(function initDashboardAskSavedChats(global) {
  const dash = global.D2LDashboard ||= {};

  const LIST_KEY = "askChats";
  const CHAT_KEY = "askChat";
  const TITLE_CHARS = 60;
  const FOLDER = "D2L Export/ask-chats";

  // One list of chat ids, and one entry per chat, both kept per D2L account.
  function createChatStore({ storage = global.chrome?.storage?.local, accountId } = {}) {
    const account = String(accountId || "").trim();
    const { scopedKey } = dash.accountBinding;
    const listKey = scopedKey(LIST_KEY, account);
    const chatKey = (id) => scopedKey(`${CHAT_KEY}.${id}`, account);
    // Writes go one after another, so a save and a delete can't undo each other.
    let writing = Promise.resolve();
    const queue = (work) => {
      const next = writing.then(work, work);
      writing = next.catch(() => {});
      return next;
    };
    const ids = async () => (await storage.get(listKey))[listKey] || [];

    // Every saved chat, newest first.
    async function loadAll() {
      if (!account || !storage) return [];
      await writing;
      const keys = (await ids()).map(chatKey);
      if (!keys.length) return [];
      const found = await storage.get(keys);
      return keys.map((key) => found[key]).filter((chat) => chat?.id && Array.isArray(chat.messages))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }

    const save = (chat) => (!account || !storage ? Promise.resolve() : queue(async () => {
      const list = await ids();
      await storage.set({ [chatKey(chat.id)]: chat, ...(list.includes(chat.id) ? {} : { [listKey]: [...list, chat.id] }) });
    }));

    const remove = (id) => (!account || !storage ? Promise.resolve() : queue(async () => {
      await storage.set({ [listKey]: (await ids()).filter((one) => one !== id) });
      await storage.remove(chatKey(id));
    }));

    return { loadAll, save, remove };
  }

  function newChat(at = new Date()) {
    const stamp = at.toISOString();
    return { id: `chat-${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, title: "", startedAt: stamp, updatedAt: stamp, model: "LFM3-1.7B", messages: [] };
  }

  // A chat is named after its first question.
  function chatTitle(messages) {
    const first = String(messages.find((message) => message.role === "user")?.text || "").replace(/\s+/g, " ").trim();
    return first.length > TITLE_CHARS ? `${first.slice(0, TITLE_CHARS - 1).trimEnd()}…` : first || "New chat";
  }

  // The chat as the model re-reads it: questions and answers as plain text. A
  // question whose answer failed is left out with it.
  function chatHistory(messages) {
    return messages.filter((message, i) => !message.failed && message.text && !(message.role === "user" && messages[i + 1]?.failed))
      .map((message) => ({ role: message.role, content: message.text }));
  }

  function messagesBeforeTurn(messages, index) { return messages.slice(0, index); }
  function messagesThroughTurn(messages, index) { return messages.slice(0, index + (messages[index + 1]?.role === "assistant" ? 2 : 1)); }

  // What the model did on the way to an answer: its thinking and its lookups, in order.
  function traceOf(message) {
    return message.trace || (message.steps || []).map((step) => ({ kind: "lookup", ...step }));
  }

  // ---- the model's memory of earlier chats -------------------------------------------
  // Every answered question in the saved chats, searched with the archive's own passage search.
  // The chats themselves come along (newest first) for chat_log.
  function buildChatIndex(chats, currentId = "") {
    const exchanges = new Map();
    const evidence = [];
    for (const chat of chats) {
      chat.messages.forEach((message, i) => {
        const reply = chat.messages[i + 1];
        if (message.role !== "user" || reply?.role !== "assistant" || reply.failed || !reply.text) return;
        const id = `${chat.id}|${i}`;
        exchanges.set(id, { chat: chat.title, when: message.at || chat.startedAt, thisChat: chat.id === currentId, asked: message.text, answered: reply.text });
        evidence.push({ evidenceId: id, courseId: "chats", source: "chat", title: "", description: `${message.text}\n${reply.text}` });
      });
    }
    return { index: dash.buildPassageIndex({ evidence, courses: [{ courseId: "chats", label: "" }] }), exchanges, chats, currentId };
  }

  function searchChats(chatIndex, query, limit = 5) {
    const seen = new Set();
    const out = [];
    for (const hit of dash.searchPassages(chatIndex.index, query, { limit: 20 }).results) {
      const id = hit.id.replace(/#\d+$/, "");
      if (seen.has(id) || !chatIndex.exchanges.has(id)) continue;
      seen.add(id);
      out.push(chatIndex.exchanges.get(id));
      if (out.length >= limit) break;
    }
    return out;
  }

  // ---- as Markdown, for reading --------------------------------------------------------
  const when = (iso) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const clock = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const quoted = (text) => String(text).split("\n").map((line) => `> ${line}`.trimEnd());

  function chatMarkdown(chat) {
    const lines = [`# ${chat.title || "Ask chat"}`, "", `Started ${when(chat.startedAt)} · Ask (${chat.model || "LFM3-1.7B"}, running on this computer)`, ""];
    for (const message of chat.messages) {
      if (message.role === "user") {
        lines.push(`## You${message.at ? ` · ${clock(message.at)}` : ""}`, "", message.text, "");
        continue;
      }
      const timing = [message.seconds && `${message.seconds.toFixed(1)} s`, message.thinkingSeconds && `thought ${message.thinkingSeconds.toFixed(1)} s`].filter(Boolean).join(", ");
      lines.push(["## Ask", message.at && clock(message.at), timing].filter(Boolean).join(" · "), "");
      for (const entry of traceOf(message)) {
        lines.push(...(entry.kind === "thinking" ? quoted(`**Thinking:** ${entry.text}`) : [`> **Looked up:** ${dash.askStepLabel(entry)}`]), "");
      }
      lines.push(message.failed ? `_${message.text}_` : message.text, "");
      if (message.sources?.length) lines.push(`From: ${message.sources.map((source) => [source.course, source.title].filter(Boolean).join(" · ")).join("; ")}`, "");
      if (!message.failed && !message.usedArchive) lines.push("_Not checked against your archive._", "");
    }
    return `${lines.join("\n").trimEnd()}\n`;
  }

  // "D2L Export/ask-chats/2026-11-04-0900-what-is-due-this-week-k3f9.md": the same name each
  // time for the same chat, so saving again brings the file up to date.
  function chatFileName(chat) {
    const at = new Date(chat.startedAt);
    const two = (n) => String(n).padStart(2, "0");
    const date = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}`;
    const slug = String(chat.title || "chat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "") || "chat";
    return `${FOLDER}/${date}-${slug}-${String(chat.id).slice(-4)}.md`;
  }

  Object.assign(dash, {
    createChatStore, newAskChat: newChat, askChatTitle: chatTitle, askChatHistory: chatHistory, askTrace: traceOf,
    askMessagesBeforeTurn: messagesBeforeTurn, askMessagesThroughTurn: messagesThroughTurn,
    buildChatIndex, searchSavedChats: searchChats, askChatMarkdown: chatMarkdown, askChatFileName: chatFileName, ASK_CHATS_FOLDER: FOLDER
  });
})(globalThis);
