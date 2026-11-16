// The Ask screen: a short chat about the saved archive. Pure HTML builders over
// a plain model; the controller (app-ask.js) keeps the model and patches the
// thread and setup card in place so typing is never interrupted. Answers are shown
// as Markdown (ask/answer-markdown.js); the "Start Ask?" pop-up is ask/start-prompt.js.
(function initDashboardRenderAsk(global) {
  const dash = global.D2LDashboard ||= {};
  const { escapeHtml: e, icon, fmtNumber, fmtDateTime, plural } = dash;

  const SUGGESTIONS = ["What is due this week?", "When is my next exam?", "What are my grades so far?", "Summarize my latest announcements."];
  const MODEL_NAME = "LFM3-1.7B";
  const SEND_ARROW = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>`;
  const DOWNLOAD_COMMAND = "node tools/get-ask-model.mjs";
  const ACTION_PATHS = { retry: "M4 11a8 8 0 1 1 2 6 M4 4v7h7", up: "M7 10v10H4V10h3zm0 9h9a2 2 0 0 0 2-1.5l1.4-6A2 2 0 0 0 17.5 9H14l.5-4a2 2 0 0 0-2-2L9 9l-2 1", down: "M7 14V4H4v10h3zm0-9h9a2 2 0 0 1 2 1.5l1.4 6A2 2 0 0 1 17.5 15H14l.5 4a2 2 0 0 1-2 2L9 15l-2-1", speak: "M4 9v6h4l5 4V5L8 9H4zm12-1a6 6 0 0 1 0 8m2-11a10 10 0 0 1 0 14", stop: "M6 6h12v12H6z" };
  const actionIcon = (name) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ACTION_PATHS[name]}"/></svg>`;

  // The model's answer as Markdown, never as HTML. live: it is still being written.
  function answerHtml(text, live = false) {
    return dash.askAnswerMarkdownHtml(text, { live });
  }

  // The box waits while Ask can't take a question: one is being answered or waits for the
  // model, the archive is still being read, or the model can't run here (or is being looked for).
  function inputLocked(model) {
    return Boolean(model.busy || model.waiting || model.reading?.state === "reading" || ["checking", "missing", "no-gpu"].includes(model.engineState));
  }

  function stepLabel(step) {
    const a = step.args || {};
    const where = a.course ? ` in ${a.course}` : "";
    const count = step.result?.results?.length ?? step.result?.items?.length;
    const read = step.result?.messages?.length;
    const item = step.result?.item;
    const outcome = step.result?.error ? step.result.error
      : item ? [item.kind, item.course].filter(Boolean).join(" in ")
      : read !== undefined ? (read === 1 ? "1 message" : `${read} messages`)
      : count === undefined ? "" : count === 1 ? "1 match" : `${count} matches`;
    // search_past_chats is the old name, kept so chats saved before the rename still read right.
    const what = step.tool === "search_archive" ? `Searched for “${a.query ?? ""}”${where}`
      : step.tool === "upcoming_due" ? `Looked at what is due in ${a.days ?? 7} days${where}`
      : step.tool === "search_past_messages" ? `Searched past messages for “${a.query ?? ""}”`
      : step.tool === "search_past_chats" ? `Searched past chats for “${a.query ?? ""}”`
      : step.tool === "chat_log" ? (a.chat ? `Read the chat “${a.chat}”` : "Read this chat from the start")
      : step.tool === "item_details" ? `Looked up “${a.title ?? ""}”${where}` : `Ran ${step.tool}`;
    return `${what}${outcome ? ` → ${outcome}` : ""}`;
  }

  function messageActionsHtml(message, index, model) {
    if (!message.text) return "";
    const copy = `<button class="btn ask-message-action" type="button" data-ask-copy-message="${index}" aria-label="Copy message" title="Copy message">${icon("copy", 16)}</button>`;
    if (message.role !== "user") {
      const locked = model.busy || model.waiting || model.editingIndex != null ? " disabled" : "";
      const retry = model.messages[index - 1]?.role === "user" ? `<button class="btn ask-message-action" type="button" data-ask-retry="${index}" aria-label="Try again" title="Try again"${locked}>${actionIcon("retry")}</button>` : "";
      const ratings = message.failed ? "" : ["up", "down"].map((value) => `<button class="btn ask-message-action" type="button" data-ask-rate="${index}" data-rating="${value}" aria-label="${value === "up" ? "Good response" : "Bad response"}" title="${value === "up" ? "Good response" : "Bad response"}" aria-pressed="${message.rating === value}"${locked}>${actionIcon(value)}</button>`).join("");
      return `<div class="ask-message-actions">${copy}${retry}${ratings}</div>`;
    }
    const locked = model.busy || model.waiting || model.editingIndex != null ? " disabled" : "";
    const edit = `<button class="btn ask-message-action" type="button" data-ask-edit="${index}" aria-label="Edit message" title="Edit message"${locked}>${icon("pen", 16)}</button>`;
    const hasLaterTurn = model.messages.slice(index + 2).some((item) => item.role === "user");
    const rewind = hasLaterTurn ? `<button class="btn ask-message-action" type="button" data-ask-rewind="${index}" aria-label="Rewind to this turn" title="Rewind to this turn"${locked}>${icon("chevronLeft", 16)}</button>` : "";
    return `<div class="ask-message-actions">${copy}${edit}${rewind}</div>`;
  }

  // What the model did on the way to an answer, folded above it: its thinking and its lookups, in order.
  function traceHtml(trace, { open = false, seconds = 0, live = false } = {}) {
    if (!trace?.length) return "";
    const lookups = trace.filter((entry) => entry.kind !== "thinking").length;
    const thought = trace.some((entry) => entry.kind === "thinking");
    const head = [thought ? (live ? "Thinking" : "Thought") : "How I found this", seconds ? `${seconds.toFixed(1)} s` : "", lookups ? plural(lookups, "lookup") : ""].filter(Boolean).join(" · ");
    const body = trace.map((entry) => (entry.kind === "thinking"
      ? `<div class="ask-thought">${e(entry.text)}</div>`
      : `<div class="ask-lookup">${icon("search", 14)}<span>${e(stepLabel(entry))}</span></div>`)).join("");
    return `<details class="ask-trace"${live ? " data-ask-live-trace" : ""}${open ? " open" : ""}><summary>${icon("chevronRight", 14)}${e(head)}</summary><div class="ask-trace-body">${body}</div></details>`;
  }

  function messageHtml(message, index, model) {
    if (message.role === "user" && model.editingIndex === index) return `<div class="ask-msg ask-you ask-editing-message"><form class="ask-edit-form" id="ask-edit-form"><textarea id="ask-edit-input" aria-label="Edit message" rows="3" required${model.waiting || model.busy ? " disabled" : ""}>${e(model.editDraft ?? message.text)}</textarea><div class="ask-edit-actions"><button class="btn" type="button" data-ask-edit-cancel${model.waiting || model.busy ? " disabled" : ""}>Cancel</button><button class="btn btn-primary" type="submit"${inputLocked(model) ? " disabled" : ""}>Send</button></div></form></div>`;
    if (message.role === "user") return `<div class="ask-msg ask-you"><div class="ask-bubble">${e(message.text)}</div>${messageActionsHtml(message, index, model)}</div>`;
    return `<div class="ask-msg ask-bot${message.failed ? " ask-failed" : ""}">${traceHtml(dash.askTrace(message), { seconds: message.thinkingSeconds })}<div class="ask-bubble ask-answer">${answerHtml(message.text)}</div><div class="ask-answer-meta">${messageActionsHtml(message, index, model)}</div></div>`;
  }

  // The answer being written, under the last question: its thinking and lookups so far (open
  // unless closed), then the answer as it comes, or what it is doing until then.
  function liveHtml(model) {
    if (!model.busy) return "";
    const live = model.live || { trace: [], answer: "" };
    const answer = live.answer ? `<div class="ask-bubble ask-answer">${answerHtml(live.answer, true)}</div>` : `<div class="ask-bubble ask-working" role="status">${e(model.status || "Thinking…")}</div>`;
    return `<div class="ask-msg ask-bot" id="ask-live">${traceHtml(live.trace, { open: model.traceOpen !== false, live: true })}${answer}</div>`;
  }

  // A question sent before the model was loaded: it waits here while the model starts.
  function waitingHtml(model) {
    if (!model.waiting) return "";
    const percent = model.engineState === "loading" ? Math.round((model.progress || 0) * 100) : 0;
    const bar = `<progress class="ask-progress" max="100" value="${percent}" aria-label="Starting Ask"></progress>`;
    return `${model.editingIndex == null && model.retryIndex == null ? `<div class="ask-msg ask-you"><div class="ask-bubble">${e(model.waiting)}</div></div>` : ""}
      <div class="ask-msg ask-bot" id="ask-waiting"><div class="ask-bubble ask-answer ask-starting" role="status"><span class="ask-working">${percent > 0 ? `Starting Ask… ${percent}%` : "Starting Ask…"}</span>${bar}</div></div>`;
  }

  function archiveLine(model) {
    const reading = model.reading;
    if (reading?.state === "reading") return `Reading your archive… ${fmtNumber(reading.done)} of ${fmtNumber(reading.total)} saved items`;
    if (reading?.state === "error") return `Couldn't read your archive: ${reading.message}`;
    return "";
  }

  // Reading the text inside course files, once, after the model starts: progress and Stop, then how it went.
  function filesHtml(model) {
    const files = model.files;
    const later = "The rest are read the next time you start Ask.";
    const line = files && {
      reading: `Reading files ${fmtNumber(files.done)} of ${fmtNumber(files.total)}`,
      done: `Read ${plural(files.done, "course file")}. Ask can search inside them.`,
      stopped: `Stopped after ${fmtNumber(files.done)} of ${fmtNumber(files.total)} files. ${later}`,
      "signed-out": "Sign in to D2L so Ask can read your files.",
      offline: `D2L didn't answer, so some files weren't read. ${later}`,
      "no-answer": `D2L didn't answer, so some files weren't read. ${later}`,
      error: `Couldn't read your files: ${files.message}`
    }[files.state];
    if (!line) return "";
    const reading = files.state === "reading";
    const stop = reading ? `<button class="btn" type="button" data-ask-files-stop>Stop</button>` : "";
    const bar = reading ? `<progress class="ask-progress" max="${files.total}" value="${files.done}" aria-label="Reading course files"></progress>` : "";
    return `<div class="ask-files" id="ask-files" role="status"><span>${e(line)}</span>${stop}${bar}</div>`;
  }

  function threadHtml(model) {
    const line = archiveLine(model);
    const status = line ? `<div class="ask-archive-line" id="ask-archive-line">${e(line)}</div>` : `<div id="ask-archive-line"></div>`;
    if (!model.messages.length && !model.busy && !model.waiting) {
      const reading = model.reading;
      const saved = reading?.state === "ready" ? `: ${fmtNumber(reading.passages)} passages across ${plural(reading.courses, "course")}` : "";
      return `${status}<div class="ask-empty"><h2>What would you like to know?</h2><p>Ask about due dates, grades, policies or announcements. Answers come only from what you've saved${saved}.</p></div>`;
    }
    return `${status}${model.messages.map((message, index) => messageHtml(message, index, model)).join("")}${waitingHtml(model)}${liveHtml(model)}`;
  }

  // Shown only when there is something to see before asking: the model files are missing,
  // there's no graphics card, a start failed, or a start runs with no question waiting on it.
  // Otherwise the screen stays quiet and the first question sent asks to start (start-prompt.js).
  function setupHtml(model) {
    const quiet = ["checking", "idle", "ready"].includes(model.engineState) || (model.engineState === "loading" && model.waiting);
    if (quiet) return "";
    const percent = Math.round((model.progress || 0) * 100);
    const headline = {
      loading: percent > 0 ? `Loading the model… ${percent}%` : "Loading the model…",
      missing: "Ask needs the model files, which aren't in the extension folder yet.",
      "no-gpu": "Ask can't run in this browser.",
      error: "The model couldn't start."
    }[model.engineState] || "The model couldn't start.";
    const reason = model.reason ? `<span class="ask-reason">${e(model.reason)}</span>` : "";
    const bar = model.engineState === "loading" ? `<progress class="ask-progress" max="100" value="${percent}" aria-label="Loading the model"></progress>` : "";
    const missing = model.engineState === "missing" ? `<ol class="ask-steps-list">
        <li>In the extension's folder, download the model once (about 1.4 GB):<div class="ask-command"><code id="ask-command">${e(DOWNLOAD_COMMAND)}</code><button class="btn" type="button" data-ask-copy>${icon("copy", 16)}Copy</button></div></li>
        <li>Then check again:<div class="ask-command"><button class="btn btn-primary" type="button" data-ask-recheck>Check again</button></div></li>
      </ol>` : "";
    const retry = model.engineState === "error" ? `<div class="ask-command"><button class="btn btn-primary" type="button" data-ask-start>Try again</button></div>` : "";
    return `<section class="card card-pad ask-setup" id="ask-setup" aria-label="Set up Ask">
      <div class="ask-setup-head"><b>${e(headline)}</b>${reason}</div>${bar}${missing}${retry}
      <p class="ask-privacy">The model runs inside this browser on your graphics card. Your archive never leaves this computer.</p>
    </section>`;
  }

  // Suggestions for an empty chat. They work before the model is started, like the box.
  function chipsHtml(model) {
    if (model.messages.length || model.busy || model.waiting || ["missing", "no-gpu"].includes(model.engineState)) return "";
    return `<div class="ask-chips" id="ask-chips">${SUGGESTIONS.map((text) => `<button class="btn ask-chip" type="button" data-ask-chip="${e(text)}">${e(text)}</button>`).join("")}</div>`;
  }

  // Saved chats, opened from the header: reopen one, delete one, or save them all to Downloads.
  function chatsHtml(model) {
    if (!model.showChats) return "";
    const chats = model.chats || [];
    const now = new Date();
    const row = (chat) => {
      const asked = chat.messages.filter((message) => message.role === "user").length;
      const title = e(chat.title || "New chat");
      const remove = model.confirmDelete === chat.id
        ? `<span class="ask-chat-confirm">Delete this chat?<button class="btn" type="button" data-ask-delete-yes="${e(chat.id)}">Delete</button><button class="btn" type="button" data-ask-delete-no>Keep</button></span>`
        : `<button class="icon-btn ask-chat-delete" type="button" data-ask-delete="${e(chat.id)}" aria-label="Delete “${title}”" title="Delete">${icon("trash", 16)}</button>`;
      return `<li class="ask-chat-row${chat.id === model.chatId ? " is-current" : ""}"><button class="ask-chat-open" type="button" data-ask-open="${e(chat.id)}"${chat.id === model.chatId ? ` aria-current="true"` : ""}>
        <span class="ask-chat-title">${title}</span><span class="ask-chat-when">${e(fmtDateTime(chat.updatedAt, now))} · ${plural(asked, "question")}</span></button>${remove}</li>`;
    };
    const list = chats.length ? `<ul class="ask-chat-list">${chats.map(row).join("")}</ul>` : `<p class="ask-chats-empty">No saved chats yet. Each chat is saved here as you ask.</p>`;
    return `<section class="card card-pad ask-chats" id="ask-chats" aria-label="Saved chats">
      <div class="ask-chats-head"><b>Saved chats</b><button class="btn" type="button" data-ask-export ${chats.length ? "" : "disabled"}>${icon("folder", 16)}Save to Downloads</button></div>
      ${list}
      <p class="ask-privacy">Chats are kept in this browser on this computer. Save to Downloads writes each one as a Markdown file in Downloads/${e(dash.ASK_CHATS_FOLDER)}.</p>
    </section>`;
  }

  function askPage(model) {
    const locked = inputLocked(model) || model.editingIndex != null;
    return `<div class="page slim ask-page" data-screen="ask">
      <div class="ask-top"><h1>Ask</h1><div class="ask-top-actions">
        <button class="btn" type="button" data-ask-chats aria-expanded="${model.showChats ? "true" : "false"}" aria-controls="ask-chats-slot">${icon("chat", 16)}Chats</button>
        <button class="btn" type="button" data-ask-clear ${model.messages.length ? "" : "hidden"}>${icon("plus", 16)}New chat</button></div></div>
      <div id="ask-chats-slot">${chatsHtml(model)}</div>
      <div id="ask-setup-slot">${setupHtml(model)}</div>
      <div id="ask-files-slot">${filesHtml(model)}</div>
      <div class="ask-thread" id="ask-thread" aria-live="polite">${threadHtml(model)}</div>
      <div id="ask-chips-slot">${chipsHtml(model)}</div>
      <form class="ask-composer" id="ask-form" autocomplete="off">
        <textarea id="ask-input" rows="2" placeholder="Ask about your courses…" aria-label="Your question" ${locked ? "disabled" : ""}></textarea>
        <div class="ask-composer-foot">
          <span class="ask-model" id="ask-model" data-state="${e(model.engineState)}" title="Runs on this computer"><i class="ask-dot" aria-hidden="true"></i>${MODEL_NAME}</span>
          <div class="ask-foot-actions"><button class="ask-send" type="submit" id="ask-send" aria-label="Send" disabled>${SEND_ARROW}</button></div>
        </div>
        <div id="ask-start-slot"></div>
      </form>
      <p class="ask-fine">A small model on this computer reads your saved archive. Nothing is sent over the internet. It can make mistakes.</p>
    </div>`;
  }

  Object.assign(dash, {
    askPage, askThreadHtml: threadHtml, askLiveHtml: liveHtml, askChatsHtml: chatsHtml, askSetupHtml: setupHtml, askChipsHtml: chipsHtml, askFilesHtml: filesHtml,
    askAnswerHtml: answerHtml, askInputLocked: inputLocked, askStepLabel: stepLabel, ASK_DOWNLOAD_COMMAND: DOWNLOAD_COMMAND
  });
})(globalThis);
