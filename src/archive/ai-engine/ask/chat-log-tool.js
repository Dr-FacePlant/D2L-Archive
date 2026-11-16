// chat_log: one saved chat's messages in order, numbered, with their times, so the
// model can answer "what did I ask first?" or pick up an earlier chat. It reads the
// chats kept on this computer (ask-saved-chats.js) and nothing else.
(function initDashboardAskChatLogTool(global) {
  const dash = global.D2LDashboard ||= {};
  const { askTime, dayKey, fmtTime } = dash;

  const MESSAGE_CHARS = 300;
  // A longer chat keeps its first and its latest messages; search_past_messages finds the rest.
  const FIRST_MESSAGES = 10;
  const LATEST_MESSAGES = 20;
  const LISTED_CHATS = 8;

  const CHAT_LOG_TOOL = Object.freeze({
    type: "function",
    function: {
      name: "chat_log",
      description: "Shows one chat's messages in order, numbered, with their times. Without a chat name it shows this chat.",
      parameters: {
        type: "object",
        properties: {
          chat: { type: "string", description: "Optional name of an earlier chat, as search_past_messages gives it" }
        },
        required: []
      }
    }
  });

  const squash = (value) => String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const clip = (text) => (text.length > MESSAGE_CHARS ? `${text.slice(0, MESSAGE_CHARS - 1).trimEnd()}…` : text);

  // The chat whose name matches best: the same name, else one that contains it. Newest first.
  function findChat(chats, wanted) {
    const name = squash(wanted);
    if (!name) return null;
    return chats.find((chat) => squash(chat.title) === name) || chats.find((chat) => squash(chat.title).includes(name)) || null;
  }

  // ctx.pastChats is the saved chats' index from buildChatIndex: its chats, newest first, and the open chat's id.
  function chatLogTool({ pastChats, now }, args) {
    const chats = pastChats?.chats || [];
    const wanted = String(args.chat ?? "").trim();
    const chat = wanted ? findChat(chats, wanted) : chats.find((one) => one.id === pastChats?.currentId);
    if (!chat) {
      const listed = chats.slice(0, LISTED_CHATS).map((one) => `"${one.title}" (${askTime(one.startedAt, now)})`).join(", ");
      const error = wanted ? `No saved chat is called "${wanted}".` : "This chat isn't saved yet.";
      return { result: { error: `${error} ${listed ? `Recent chats: ${listed}.` : "There are no saved chats."}` }, sources: [] };
    }
    const started = dayKey(chat.startedAt);
    const all = chat.messages.filter((message) => !message.failed && message.text).map((message, i) => ({
      n: i + 1,
      from: message.role === "user" ? "student" : "you",
      ...(message.at ? { at: dayKey(message.at) === started ? fmtTime(message.at) : askTime(message.at, now) } : {}),
      text: clip(String(message.text).replace(/\s+/g, " ").trim())
    }));
    const cut = all.length > FIRST_MESSAGES + LATEST_MESSAGES;
    const messages = cut ? [...all.slice(0, FIRST_MESSAGES), ...all.slice(-LATEST_MESSAGES)] : all;
    const note = cut ? `Messages ${FIRST_MESSAGES + 1} to ${all.length - LATEST_MESSAGES} are left out; search_past_messages finds them.` : "";
    return { result: { chat: chat.title, this_chat: chat.id === pastChats.currentId, started: askTime(chat.startedAt, now), messages, ...(note ? { note } : {}) }, sources: [] };
  }

  Object.assign(dash, { ASK_CHAT_LOG_TOOL: CHAT_LOG_TOOL, askChatLogTool: chatLogTool });
})(globalThis);
