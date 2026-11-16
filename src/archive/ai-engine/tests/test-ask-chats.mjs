import { loadDashboard } from "./test-dashboard-loader.mjs";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();

// A stand-in for chrome.storage.local: copies in and out, like the real one.
function fakeStorage() {
  const data = {};
  const writes = [];
  return {
    data, writes,
    get: async (keys) => Object.fromEntries([].concat(keys).filter((key) => key in data).map((key) => [key, structuredClone(data[key])])),
    set: async (items) => { await new Promise((resolve) => setTimeout(resolve, Math.random() * 3)); writes.push(Object.keys(items)); Object.assign(data, structuredClone(items)); },
    remove: async (keys) => { for (const key of [].concat(keys)) delete data[key]; }
  };
}

const started = new Date(2026, 10, 4, 9, 0);
const at = (minutes) => new Date(started.getTime() + minutes * 60000).toISOString();
const examChat = {
  id: "chat-a1-ab12", title: "When is the final exam?", startedAt: at(0), updatedAt: at(5), model: "LFM3-1.7B",
  messages: [
    { role: "user", text: "When is the final exam?", at: at(0) },
    { role: "assistant", text: "The final exam is December 12 at 8 AM.", at: at(1), usedArchive: true, seconds: 8.2, thinkingSeconds: 3.1, rating: "up",
      trace: [{ kind: "thinking", text: "Look in the syllabus." }, { kind: "lookup", tool: "search_archive", args: { query: "final exam" }, result: { results: [1] } }],
      sources: [{ course: "CS 1301", title: "Syllabus", route: "#/x" }] },
    { role: "user", text: "Thanks!", at: at(2) },
    { role: "assistant", text: "You're welcome!", at: at(3), usedArchive: false }
  ]
};
const labChat = {
  id: "chat-b2-cd34", title: "Lab 4", startedAt: at(10), updatedAt: at(20), model: "LFM3-1.7B",
  messages: [
    { role: "user", text: "What is Lab 4 about?", at: at(10) },
    { role: "assistant", failed: true, text: "Something went wrong: out of memory" },
    { role: "user", text: "What is Lab 4 about?", at: at(12) },
    { role: "assistant", text: "Lab 4 is a sorting visualizer.", usedArchive: true },
    { role: "user", text: "And Lab 5?", at: at(14) }
  ]
};

// ---- kept on this computer, per account -------------------------------------------------------------
const storage = fakeStorage();
const store = dash.createChatStore({ storage, accountId: "acct-1" });
await Promise.all([store.save(examChat), store.save(labChat)]);
const loaded = await store.loadAll();
check(loaded.map((chat) => chat.id).join() === "chat-b2-cd34,chat-a1-ab12", "saved chats come back newest first");
check(loaded.find((chat) => chat.id === examChat.id).messages[1].rating === "up", "a response rating survives saving and reopening its chat");
check(JSON.stringify(storage.data["askChats:acct-1"]) === '["chat-a1-ab12","chat-b2-cd34"]' && storage.data["askChat.chat-a1-ab12:acct-1"].messages.length === 4, "each chat is kept under the account it belongs to");
check((await dash.createChatStore({ storage, accountId: "acct-2" }).loadAll()).length === 0 && (await dash.createChatStore({ storage, accountId: "" }).loadAll()).length === 0, "another account, or none, sees no chats");
await store.save({ ...examChat, title: "Renamed" });
check(storage.data["askChats:acct-1"].length === 2 && storage.data["askChat.chat-a1-ab12:acct-1"].title === "Renamed", "saving a chat again updates it rather than adding a copy");
await Promise.all([store.save({ ...labChat, id: "chat-c3" }), store.remove("chat-c3"), store.remove("chat-a1-ab12")]);
check(JSON.stringify(storage.data["askChats:acct-1"]) === '["chat-b2-cd34"]' && !("askChat.chat-c3:acct-1" in storage.data) && !("askChat.chat-a1-ab12:acct-1" in storage.data), "saves and deletes happen in the order asked, however quickly they come");
const fresh = dash.newAskChat(started);
check(/^chat-/.test(fresh.id) && fresh.startedAt === started.toISOString() && fresh.messages.length === 0 && fresh.model === "LFM3-1.7B", "a new chat starts empty, named for the model");

// ---- its title, and what the model re-reads -----------------------------------------------------------
check(dash.askChatTitle(examChat.messages) === "When is the final exam?" && dash.askChatTitle([]) === "New chat", "a chat is named after its first question");
const longTitle = dash.askChatTitle([{ role: "user", text: `What ${"really ".repeat(20)}matters?` }]);
check(longTitle.length <= 60 && longTitle.endsWith("…"), "a long first question is cut short in the title");
const history = dash.askChatHistory(labChat.messages);
check(history.length === 3 && history[0].content === "What is Lab 4 about?" && history[1].content === "Lab 4 is a sorting visualizer." && history.every((message) => message.role && message.content), "the model re-reads questions and answers as plain text, leaving out failed answers and their questions");

// ---- the model's memory of earlier chats -----------------------------------------------------------------
const memory = dash.buildChatIndex([examChat, labChat], labChat.id);
check(memory.exchanges.size === 3, "every answered question is searchable, and unanswered ones are not");
const found = dash.runAskTool({ pastChats: memory }, "search_past_messages", { query: "final exam" });
check(found.result.results[0]?.asked === "When is the final exam?" && found.result.results[0].answered.includes("December 12") && found.result.results[0].this_chat === false && /Nov/.test(found.result.results[0].when), "search_past_messages finds what was asked and answered, and when");
check(dash.runAskTool({ pastChats: memory }, "search_past_messages", { query: "sorting" }).result.results[0]?.this_chat === true, "the older part of this chat is found too, and marked as this chat");
check(found.sources.length === 0, "past chats are never shown as sources");
check(dash.runAskTool({ pastChats: memory }, "search_past_messages", { query: "photosynthesis" }).result.note && dash.runAskTool({}, "search_past_messages", { query: "exam" }).result.note, "nothing found, or no saved chats, says so");
check(dash.runAskTool({ pastChats: memory }, "search_past_messages", { query: " " }).result.error, "an empty query is an error the model can read");
check(!dash.ASK_TOOLS.some((tool) => tool.function.name === "search_past_chats") && dash.runAskTool({ pastChats: memory }, "search_past_chats", { query: "exam" }).result.error, "the old name is gone from the tools");

// ---- one chat, in order ------------------------------------------------------------------------------------
const later = new Date(2026, 10, 4, 10, 0);
const log = dash.runAskTool({ pastChats: memory, now: later }, "chat_log", {});
check(log.result.chat === "Lab 4" && log.result.this_chat === true && log.result.started === "Wed, Nov 4, 2026, 9:10 AM (today)" && log.sources.length === 0, `chat_log with no name shows this chat, from when it started, got ${JSON.stringify(log.result)}`);
check(log.result.messages.map((m) => `${m.n} ${m.from} ${m.at || "-"} ${m.text}`).join(" | ") === "1 student 9:10 AM What is Lab 4 about? | 2 student 9:12 AM What is Lab 4 about? | 3 you - Lab 4 is a sorting visualizer. | 4 student 9:14 AM And Lab 5?", `its messages come numbered, in order, with who wrote them and when, leaving out a failed answer, got ${JSON.stringify(log.result.messages)}`);
const earlier = dash.runAskTool({ pastChats: memory, now: later }, "chat_log", { chat: "final EXAM" }).result;
check(earlier.chat === "When is the final exam?" && earlier.this_chat === false && earlier.messages[0].text === "When is the final exam?" && earlier.messages.length === 4, "an earlier chat is found by its name, however it is written");
const twins = dash.buildChatIndex([{ id: "n", title: "Lab 4 and Lab 5", startedAt: at(20), messages: [{ role: "user", text: "both?" }] }, labChat], "n");
check(dash.runAskTool({ pastChats: twins, now: later }, "chat_log", { chat: "lab 4" }).result.chat === "Lab 4", "a chat with exactly that name beats a newer one that only contains it");
const lost = dash.runAskTool({ pastChats: memory, now: later }, "chat_log", { chat: "photosynthesis" }).result.error;
check(/No saved chat is called "photosynthesis"\. Recent chats: "When is the final exam\?" \(Wed, Nov 4, 2026, 9:00 AM \(today\)\), "Lab 4"/.test(lost), `a name that matches nothing lists the recent chats, got ${lost}`);
check(/isn't saved yet\. There are no saved chats/.test(dash.runAskTool({}, "chat_log", {}).result.error), "with no saved chats chat_log says so");
const many = { id: "chat-many", title: "Long", startedAt: at(0), messages: Array.from({ length: 40 }, (_, n) => ({ role: n % 2 ? "assistant" : "user", text: `m${n + 1} ${"word ".repeat(n === 0 ? 200 : 1)}`, at: n === 39 ? new Date(2026, 10, 5, 8, 0).toISOString() : at(n) })) };
const longLog = dash.runAskTool({ pastChats: dash.buildChatIndex([many], "chat-many"), now: later }, "chat_log", {}).result;
check(longLog.messages.length === 30 && longLog.messages[9].n === 10 && longLog.messages[10].n === 21 && /Messages 11 to 20 are left out/.test(longLog.note), "a long chat keeps its first 10 and latest 20 messages, and says what it left out");
check(longLog.messages[0].text.length <= 300 && longLog.messages.at(-1).at === "Thu, Nov 5, 2026, 8:00 AM (tomorrow)", "a long message is cut short, and one from another day gives its date");

const wordy = dash.buildChatIndex([{ ...examChat, messages: [{ role: "user", text: "exam?" }, { role: "assistant", text: `exam ${"word ".repeat(300)}` }] }]);
check(dash.runAskTool({ pastChats: wordy }, "search_past_messages", { query: "exam" }).result.results[0].answered.length <= 400, "a long earlier answer is cut short, so the model's prompt stays small");
check(dash.searchSavedChats(dash.buildChatIndex([{ ...examChat, messages: [{ role: "user", text: "exam exam" }, { role: "assistant", text: `exam ${"exam words ".repeat(100)}` }] }]), "exam").length === 1, "a long exchange is found once, not once per passage");

// ---- as Markdown, in Downloads --------------------------------------------------------------------------
const markdown = dash.askChatMarkdown(examChat);
check(markdown.startsWith("# When is the final exam?\n") && markdown.includes("running on this computer") && markdown.includes("## You · 9:00 AM") && markdown.includes("## Ask · 9:01 AM · 8.2 s, thought 3.1 s"), "a saved chat reads as a titled conversation with times");
check(markdown.includes("> **Thinking:** Look in the syllabus.") && markdown.includes("> **Looked up:** Searched for “final exam” → 1 match") && markdown.includes("From: CS 1301 · Syllabus"), "its thinking, lookups and sources are written out");
check(markdown.includes("You're welcome!\n\n_Not checked against your archive._"), "an answer made without a lookup says so");
check(dash.askChatMarkdown(labChat).includes("_Something went wrong: out of memory_"), "a failed answer is kept, marked as one");
check(dash.askChatFileName(examChat) === "D2L Export/ask-chats/2026-11-04-0900-when-is-the-final-exam-ab12.md" && dash.askChatFileName(examChat) === dash.askChatFileName({ ...examChat, updatedAt: at(99) }), "each chat has one file name in Downloads, so saving again replaces it");
check(dash.askChatFileName({ ...examChat, title: "../../etc/passwd?" }).startsWith("D2L Export/ask-chats/2026-11-04-0900-etc-passwd-"), "a title can't steer the file out of its folder");

// ---- the list on screen ------------------------------------------------------------------------------------
const evil = "<img src=x onerror=alert(1)>";
const listed = { showChats: true, chatId: examChat.id, chats: [{ ...labChat, title: evil }, examChat], confirmDelete: "" };
const listHtml = dash.askChatsHtml(listed);
check(dash.askChatsHtml({ ...listed, showChats: false }) === "", "the list shows only when opened");
check((listHtml.match(/data-ask-open=/g) || []).length === 2 && (listHtml.match(/data-ask-delete="/g) || []).length === 2 && /data-ask-open="chat-a1-ab12" aria-current="true"/.test(listHtml), "each chat can be opened or deleted, and the open one is marked");
check(!listHtml.includes("<img") && listHtml.includes("&lt;img") && listHtml.includes("2 questions") && listHtml.includes("3 questions"), "titles are shown as text, with how many questions each has");
check(listHtml.includes("data-ask-export") && !/data-ask-export disabled/.test(listHtml) && listHtml.includes("Downloads/D2L Export/ask-chats") && /on this computer/.test(listHtml), "the list says where chats are kept and offers to save them to Downloads");
const confirming = dash.askChatsHtml({ ...listed, confirmDelete: examChat.id });
check(confirming.includes(`data-ask-delete-yes="${examChat.id}"`) && confirming.includes("data-ask-delete-no") && (confirming.match(/data-ask-delete="/g) || []).length === 1, "deleting asks first");
const none = dash.askChatsHtml({ showChats: true, chats: [] });
check(/No saved chats yet/.test(none) && /data-ask-export disabled/.test(none), "with no chats the list says so and there is nothing to save");
const page = dash.askPage({ engineState: "ready", messages: [], busy: false, reading: null, showChats: false, chats: [] });
check(page.includes("data-ask-chats") && page.includes('aria-expanded="false"') && page.includes('id="ask-chats-slot"'), "the header has a Chats button for the saved chats");

if (failures.length) {
  console.error(failures.map((message) => `FAIL: ${message}`).join("\n"));
  process.exit(1);
}
console.log("Ask saved-chat tests passed.");
