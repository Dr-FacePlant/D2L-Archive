// Ask controller: keeps the chat (saved as it grows, see app-ask-chats.js), reads the
// archive into a searchable index once (app-ask-archive.js), starts the model that runs inside this tab
// (only when asked, through ask/start-prompt.js, and let go again when you leave Ask), reads the text inside course
// files once the model has started (ask/file-text-reader.js), and sends each question,
// showing the model's thinking and answer as it writes them.
// Read-only: it never changes the archive or D2L, and nothing it does goes
// online (see ask-runtime.js).
(function initDashboardAppAsk(global) {
  const dash = global.D2LDashboard ||= {};
  const { $, api, state, toast } = dash.appModules;

  // chat is the open saved chat (null until the first question). live is the answer being
  // written: { trace, answer }. traceOpen: whether its thinking stays unfolded. files is how
  // reading course files goes ({ state, done, total }); filesRun stops it.
  const ask = {
    accountId: null, chatEpoch: 0, chat: null, busy: false, status: "", live: null, traceOpen: true, editingIndex: null, editDraft: "", retryIndex: null,
    reading: null, archive: null, loadingFor: null, loading: null, pending: "", files: null, filesRun: null
  };

  // The archive as passages, and the course files read once the model has started (app-ask-archive.js).
  const { loadArchive, readFiles } = dash.createAskArchive({ ask, state, api, refresh, paintFiles });

  // The model's own state (checking, idle, loading, ready, ...) lives in the lifecycle, defined below.
  // Once it is ready, the course files not read before are read.
  const life = dash.createModelLifecycle({
    onChange: (kind) => {
      if (kind === "progress") return refresh();
      refresh({ setup: true });
      if (life.state === "ready") readFiles();
    }
  });

  const saved = dash.createAskChatList({
    toast,
    onChange: () => refresh(),
    onOpen: (chat) => { resetChat(); ask.chat = chat; refresh({ bottom: true }); },
    onRemove: (id) => { if (ask.chat?.id === id) resetChat(); },
    canSwitch: () => !ask.busy
  });

  // A question sent before the model was loaded asks to start it, then waits for it.
  const starter = dash.createAskStart({
    life, $, settings: () => state.settings, saveSettings: (patch) => dash.appModules.saveSettings(patch),
    send: (question) => submit(question), putBack, onChange: () => refresh()
  });

  const messages = () => ask.chat?.messages || [];
  dash.bindAskMessageActions({ $, getMessages: messages, getState: () => ask, keep: saved.keep, refresh, toast, submit });
  dash.bindAskResponseActions({ getMessages: messages, getState: () => ask, keep: saved.keep, refresh, retry });
  const model = () => ({
    engineState: life.state, reason: life.reason, progress: life.percent / 100, messages: messages(), busy: ask.busy, status: ask.status, reading: ask.reading, waiting: starter.waiting, editingIndex: ask.editingIndex, editDraft: ask.editDraft, retryIndex: ask.retryIndex,
    live: ask.live, traceOpen: ask.traceOpen, chatId: ask.chat?.id || "", chats: saved.list.chats, showChats: saved.list.open, confirmDelete: saved.list.confirm, files: ask.files
  });
  const onAskPage = () => Boolean($("#ask-thread"));

  // A new chat. The old one stays saved.
  function resetChat() {
    ask.chatEpoch += 1;
    starter.reset();
    Object.assign(ask, { chat: null, busy: false, status: "", live: null, editingIndex: null, editDraft: "", retryIndex: null });
  }

  // A different account: nothing read from the last one may be kept.
  function resetAll() {
    resetChat();
    ask.filesRun?.abort();
    Object.assign(ask, { archive: null, loadingFor: null, loading: null, reading: null, files: null, filesRun: null });
  }

  // ---- the message box: grows with the text; Send waits for something to send ----
  const BOX_MAX = 220;
  const isLocked = () => dash.askInputLocked(model()) || ask.editingIndex != null;
  function syncComposer() {
    const input = $("#ask-input");
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, BOX_MAX)}px`;
    $("#ask-send").disabled = isLocked() || !input.value.trim();
  }

  // A question that couldn't be sent yet goes back in the box, unless something new was typed there.
  function putBack(question) {
    if (ask.retryIndex != null) { ask.retryIndex = null; refresh(); return; }
    if (ask.editingIndex != null) { ask.editDraft = question; refresh(); $("#ask-edit-input")?.focus(); return; }
    const input = $("#ask-input");
    if (!input) return;
    if (!input.value.trim()) input.value = question;
    syncComposer();
    input.focus();
  }

  // ---- drawing: patch the pieces, never the input being typed in ----------------
  let shownSetup = "";
  const setupKey = () => `${life.state}|${life.reason}|${life.percent}`;
  const atBottom = (thread) => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
  function refresh({ setup = false, bottom = false } = {}) {
    if (!onAskPage()) return;
    const m = model();
    const thread = $("#ask-thread");
    const stuck = atBottom(thread);
    const editor = $("#ask-edit-input"), focused = editor && document.activeElement === editor, start = editor?.selectionStart, end = editor?.selectionEnd;
    thread.innerHTML = dash.askThreadHtml(m);
    if (focused) { const next = $("#ask-edit-input"); next?.focus(); next?.setSelectionRange(start, end); }
    if (stuck || bottom) thread.scrollTop = thread.scrollHeight;
    $("#ask-chats-slot").innerHTML = dash.askChatsHtml(m);
    $("[data-ask-chats]").setAttribute("aria-expanded", String(saved.list.open));
    if (setup || setupKey() !== shownSetup) {
      shownSetup = setupKey();
      $("#ask-setup-slot").innerHTML = dash.askSetupHtml(m);
    }
    $("#ask-chips-slot").innerHTML = dash.askChipsHtml(m);
    $("#ask-files-slot").innerHTML = dash.askFilesHtml(m);
    $("#ask-input").disabled = isLocked();
    $("#ask-model").dataset.state = life.state;
    syncComposer();
    $("[data-ask-clear]").hidden = !messages().length;
    $("[data-ask-clear]").disabled = ask.busy;
  }

  // The thinking panel scrolls by itself, so it is updated in place, never replaced (a new one would
  // start at the top again). It follows new thinking only while you are at its end.
  function patchLive(box, html) {
    const next = Object.assign(document.createElement("div"), { innerHTML: html }).firstElementChild;
    const body = box.querySelector(".ask-trace-body");
    const fresh = next.querySelector(".ask-trace-body");
    if (!body || !fresh) return void box.replaceWith(next);
    const top = body.scrollTop, atEnd = body.scrollHeight - top - body.clientHeight < 8;
    box.querySelector("summary").innerHTML = next.querySelector("summary").innerHTML;
    body.innerHTML = fresh.innerHTML;
    body.scrollTop = atEnd ? body.scrollHeight : top;
    box.lastElementChild.replaceWith(next.lastElementChild);
  }

  // While the model writes, only the answer in progress is redrawn, once per frame.
  let liveFrame = 0;
  function paintLive() {
    if (liveFrame || !onAskPage()) return;
    liveFrame = requestAnimationFrame(() => {
      liveFrame = 0;
      const box = $("#ask-live");
      if (!box || !ask.busy) return;
      const thread = $("#ask-thread");
      const stuck = atBottom(thread);
      patchLive(box, dash.askLiveHtml(model()));
      if (stuck) thread.scrollTop = thread.scrollHeight;
    });
  }

  // ---- course files: the archive and the files are read in app-ask-archive.js ---------
  function paintFiles() {
    if (onAskPage()) $("#ask-files-slot").innerHTML = dash.askFilesHtml(model());
  }

  // ---- one question -----------------------------------------------------------------
  function retry(index) {
    const answer = messages()[index], question = messages()[index - 1];
    if (ask.busy || ask.editingIndex != null || ask.retryIndex != null || starter.waiting || starter.asking || answer?.role !== "assistant" || question?.role !== "user" || !String(question.text || "").trim()) return;
    if (index < messages().length - 1 && !global.confirm("Try again and remove the later messages from this chat?")) return;
    ask.retryIndex = index - 1; submit(question.text);
  }

  // watch.onText hears the answer as it is written; watch.onLookup(toolName, round) hears each lookup as it starts; watch.spoken says the
  // question was spoken, so the answer will be heard. Settles with { answer, failed } once the answer is
  // in the chat, or nothing when the question was not sent (busy, not started yet, or the chat changed).
  async function submit(text, watch = {}) {
    const question = String(text || "").trim();
    if (!question || ask.busy) return;
    if (life.state !== "ready") return starter.request(question);
    const epoch = ask.chatEpoch;
    const chat = ask.chat ||= dash.newAskChat();
    const replaceAt = ask.retryIndex ?? ask.editingIndex;
    if (Number.isInteger(replaceAt)) chat.messages = dash.askMessagesBeforeTurn(chat.messages, replaceAt); ask.editingIndex = null; ask.retryIndex = null; ask.editDraft = "";
    // What the model re-reads of this chat: everything before this question.
    const history = dash.askChatHistory(chat.messages);
    chat.messages.push({ role: "user", text: question, at: new Date().toISOString() });
    saved.keep(chat);
    Object.assign(ask, { busy: true, status: "Reading your archive…", live: { trace: [], answer: "" }, traceOpen: true });
    refresh({ bottom: true });
    let outcome;
    try {
      const archive = await loadArchive(state.index);
      ask.status = "Thinking…";
      refresh();
      const result = await dash.askArchive({
        engine: life.engine,
        ctx: { passageIndex: archive.passageIndex, index: archive.forIndex, checklistDone: state.checklistDone || {}, hiddenWork: state.hiddenWork || {}, now: new Date(), pastChats: saved.memory(chat.id), bundleFor: dash.appModules.bundleFor, fileTexts: archive.texts },
        history,
        question,
        spoken: Boolean(watch.spoken),
        onStep: () => { if (epoch === ask.chatEpoch) ask.status = "Reading what I found…"; },
        onLookup: (tool, round) => { if (epoch === ask.chatEpoch) watch.onLookup?.(tool, round); },
        onUpdate: (live) => { if (epoch === ask.chatEpoch) { ask.live = live; paintLive(); watch.onText?.(live.answer); } }
      });
      if (epoch !== ask.chatEpoch) return;
      const { answer, trace, sources, usedArchive, seconds, thinkingSeconds, firstWordSeconds } = result;
      chat.messages.push({ role: "assistant", text: answer, trace, sources, usedArchive, seconds, thinkingSeconds, firstWordSeconds, at: new Date().toISOString() });
      outcome = { answer, failed: false };
    } catch (error) {
      if (epoch !== ask.chatEpoch) return;
      chat.messages.push({ role: "assistant", failed: true, text: `Something went wrong: ${error.message}`, trace: ask.live?.trace || [], at: new Date().toISOString() });
      outcome = { answer: error.message, failed: true };
    } finally {
      if (epoch === ask.chatEpoch) { saved.keep(chat); Object.assign(ask, { busy: false, status: "", live: null }); refresh(); $("#ask-input")?.focus(); }
      life.settled({ busy: ask.busy });
    }
    return outcome;
  }

  // ---- the screen ---------------------------------------------------------------------
  function page() {
    if (ask.accountId !== state.account.id) { resetAll(); ask.accountId = state.account.id; }
    saved.useAccount(state.account.id);
    shownSetup = setupKey();
    return dash.askPage(model());
  }

  async function mounted() {
    life.stay();
    dash.askLoadAnswerMarkdown().then(() => refresh(), () => {});
    if (state.index) loadArchive(state.index).catch(() => {});
    if (["checking", "missing", "no-gpu"].includes(life.state)) await life.check();
    const waiting = ask.pending;
    ask.pending = "";
    if (waiting) submit(waiting);
    if (!starter.asking) $("#ask-input")?.focus();
  }

  // A question typed somewhere else (the search pop-up). On the Ask page it is sent
  // now; from any other page it waits until the Ask page has opened.
  function askFrom(text) {
    const question = String(text || "").trim();
    if (!question) return;
    if (onAskPage() && !state.detail) return void submit(question);
    ask.pending = question; location.hash = "#/ask";
  }

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "ask-form") return;
    event.preventDefault(); const input = $("#ask-input"), text = input.value; input.value = ""; syncComposer(); submit(text);
  });

  document.addEventListener("input", (event) => { if (event.target.id === "ask-input") syncComposer(); });
  // Enter sends; Shift+Enter starts a new line. Not while an input method is composing.
  document.addEventListener("keydown", (event) => {
    if (event.target.id !== "ask-input" || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault(); if (!$("#ask-send").disabled) $("#ask-form").requestSubmit();
  });

  document.addEventListener("click", async (event) => {
    const target = event.target.closest?.("[data-ask-chip], [data-ask-copy], [data-ask-start], [data-ask-recheck], [data-ask-clear], [data-ask-files-stop]");
    if (!target) return;
    if (target.hasAttribute("data-ask-chip")) submit(target.getAttribute("data-ask-chip"));
    else if (target.hasAttribute("data-ask-files-stop")) ask.filesRun?.abort();
    else if (target.hasAttribute("data-ask-copy")) await navigator.clipboard?.writeText(dash.ASK_DOWNLOAD_COMMAND).then(() => toast("Command copied"), () => toast("Couldn't copy. Select the command and copy it."));
    else if (target.hasAttribute("data-ask-start")) await life.start();
    else if (target.hasAttribute("data-ask-recheck")) await life.check();
    else if (target.hasAttribute("data-ask-clear") && !ask.busy) { resetChat(); refresh(); }
  });

  // Folding the thinking away keeps it folded for the rest of this answer. (toggle doesn't bubble.)
  document.addEventListener("toggle", (event) => {
    if (event.target.matches?.("[data-ask-live-trace]")) ask.traceOpen = event.target.open;
  }, true);

  // Leaving Ask stops reading files too; the next start goes on from there.
  function left() {
    starter.reset(); ask.retryIndex = null; ask.filesRun?.abort(); life.leave({ busy: ask.busy });
  }

  dash.askScreen = { page, mounted, left, engineState: () => life.state, state: ask, ask: askFrom, send: submit };
})(globalThis);
