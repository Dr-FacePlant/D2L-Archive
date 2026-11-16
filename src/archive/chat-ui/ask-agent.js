// One question to the model, start to finish: the model may look things up in
// the archive (up to 12 lookups), then answers from what came back. The
// engine is passed in, so this runs the same against a real model or a fake.
(function initDashboardAskAgent(global) {
  const dash = global.D2LDashboard ||= {};
  const { ASK_TOOLS, runAskTool } = dash;

  // Lookups for one question; after them the model must answer from what it found.
  const MAX_LOOKUPS = 12;
  const MAX_CALLS_PER_ROUND = 3;
  // It must also answer once this many lookups in a row turn up nothing new.
  const MAX_MISSES = 2;
  // ...or once the chat leaves less room than one more round needs: thinking, a lookup
  // call, three results and the answer, in word-pieces. A result is counted as one per 3 characters.
  const ROUND_TOKENS = 5000;
  const CHARS_PER_TOKEN = 3;
  // How much of this chat the model re-reads with each question: about 3,000 word-pieces.
  const HISTORY_CHARS = 12000;
  // Lookups that read the archive. An answer after only these counts as checked against it.
  const ARCHIVE_TOOLS = new Set(["search_archive", "upcoming_due", "item_details"]);
  const GAVE_UP = "I couldn't finish looking that up. Try asking it another way.";
  const NO_ANSWER = "I couldn't come up with an answer. Try asking it another way.";
  const NOT_FOUND = /^\s*not found in your course materials\b/i;
  // A first reply that says it doesn't know, written without looking anything up.
  const DIDNT_LOOK = /not found in your course materials|\bI (?:don['’]t|do not|can['’]t|cannot|couldn['’]t|could not) (?:have|find|see|access|confirm)\b|\bno (?:information|details) (?:about|on)\b/i;
  // Added to what the last lookups return: in the round after them it can't look anything up.
  const LAST_LOOKUP = "No lookups are left. Answer now from what you have found.";
  // Added to the prompt when the question was spoken: the answer is heard, not read, so it is short and has no tables or lists.
  const SPOKEN_STYLE = [
    "The student is hearing this, not reading it.",
    "Answer in one to three short sentences. No tables, lists, links or symbols.",
    "Say each date the way a person says it, like Friday at 11:59 PM.",
    "Name at most three items, then say how many more there are.",
    "Example answer: Two things are due Friday: the Lab 4 report in Chemistry 101, and the Week 5 quiz in Writing 200."
  ];

  // Whether a lookup's result holds anything earlier ones didn't. seen keeps what they held.
  function addsNew(result, seen) {
    let added = false;
    for (const item of [...(result.results || []), ...(result.items || []), ...(result.messages || []), ...(result.item ? [result.item] : [])]) {
      const key = JSON.stringify(item);
      if (seen.has(key)) continue;
      seen.add(key);
      added = true;
    }
    return added;
  }

  // The newest whole messages of this chat that fit the budget, starting at a question.
  function recentHistory(history, budget = HISTORY_CHARS) {
    let used = 0;
    let start = history.length;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      used += String(history[i].content ?? "").length;
      if (used > budget) break;
      start = i;
    }
    while (start < history.length && history[start].role !== "user") start += 1;
    return history.slice(start);
  }

  // Everything the model is told about itself and where it is. seen of total earlier messages are in view.
  // spoken: the question was spoken, so the answer will be heard.
  function systemPrompt({ now, courseLabels = [], seen = 0, total = 0, spoken = false }) {
    const memory = total > seen
      ? `This chat has ${total} earlier messages; you can see the latest ${seen}. The rest, and earlier chats, are saved`
      : `${total ? "You can see this whole chat." : "This is the start of a new chat."} Earlier chats are saved`;
    return [
      "You are LFM3-1.7B, a small language model made by Liquid AI. You run inside the student's D2L Archive, a browser extension, entirely on this computer with no internet access. The student talks to you on its Ask screen.",
      `It is ${dash.askNow(now)}.`,
      courseLabels.length ? `The student's courses: ${courseLabels.join(", ")}.` : "The student has no saved courses yet.",
      "Your tools read the student's saved courses, their files, and your earlier messages with the student. You can't open websites or change anything in D2L.",
      `${memory}: search_past_messages and chat_log find them.`,
      "Greetings, thanks, and questions about you: answer briefly, without tools.",
      "Course questions: look it up first, answer only from what you find, and name the course and item. If nothing useful turns up, say: Not found in your course materials. Don't guess where else to look.",
      "For upcoming_due, set days from the time asked: today 1, tomorrow 2, this week 7, 2 weeks 14, a month 30, 2 months 60, 3 months 90.",
      "Give the answer first, without describing your search. Give each time with the word the lookup puts before it: due, opens or at. Keep answers short.",
      ...(spoken ? SPOKEN_STYLE : [])
    ].join("\n");
  }

  // ctx is what the tools read: { passageIndex, index, checklistDone, hiddenWork, now, pastChats, bundleFor }. history holds this
  // chat's earlier questions and answers as plain text. onUpdate hears { trace, answer } while the
  // model writes: trace is its thinking and its lookups in order, answer what it has written so far. onLookup(toolName, round) hears
  // each lookup just before it runs (onStep hears it after), so a caller can say what is being looked up while it is.
  // spoken: the question was spoken, so the model is told its answer will be heard.
  async function askArchive({ engine, ctx, history = [], question, onStep, onLookup, onUpdate, signal, thinking = true, spoken = false }) {
    const started = Date.now();
    const recent = recentHistory(history);
    const messages = [
      { role: "system", content: systemPrompt({ now: ctx.now, courseLabels: ctx.passageIndex.courses.map((course) => course.label).filter(Boolean), seen: recent.length, total: history.length, spoken }) },
      ...recent,
      { role: "user", content: question }
    ];
    const steps = [];
    const trace = [];
    const live = { trace, answer: "" };
    const sources = new Map();
    let tokensPerSecond = 0;
    let thinkMs = 0;
    let firstWordMs = 0;
    let answer = GAVE_UP;
    const seen = new Set();
    let lookups = 0;
    let misses = 0;
    let last = false;

    // Every round but the last runs at least one lookup, so this ends within MAX_LOOKUPS + 1 rounds.
    for (let round = 0; ; round += 1) {
      let thought = null;
      let firstWord = 0;
      const note = (text) => {
        if (!text) return;
        if (!thought) trace.push(thought = { kind: "thinking", text: "" });
        thought.text = text;
      };
      const onText = ({ thinking: text, answer: partial }) => {
        note(text);
        if (partial && !firstWord) firstWord = Date.now() - started;
        live.answer = partial;
        onUpdate?.(live);
      };
      // In the last round the model can't start a lookup, so it answers from what it found.
      let turn = await engine.chat({ messages, tools: ASK_TOOLS, lookups: !last, signal, onText, thinking });
      note(turn.thinking);
      tokensPerSecond = turn.tokensPerSecond || tokensPerSecond;
      thinkMs += turn.thinkMs || 0;
      // The small model sometimes says it doesn't know without looking. Look the question up for it.
      if (round === 0 && !turn.toolCalls.length && (!turn.content.trim() || DIDNT_LOOK.test(turn.content))) {
        turn = { ...turn, raw: "", toolCalls: [{ id: "auto-search", type: "function", function: { name: "search_archive", arguments: JSON.stringify({ query: question }) } }] };
      }
      if (!turn.toolCalls.length || last) {
        answer = turn.content || (last ? GAVE_UP : NO_ANSWER);
        firstWordMs = firstWord;
        break;
      }
      const calls = turn.toolCalls.slice(0, Math.min(MAX_CALLS_PER_ROUND, MAX_LOOKUPS - lookups));
      // What it wrote goes back word for word, so the model carries on from what it already read.
      messages.push({ role: "assistant", content: "", tool_calls: calls, ...(turn.raw && calls.length === turn.toolCalls.length ? { raw: turn.raw } : {}) });
      const replies = [];
      for (const call of calls) {
        const name = call.function?.name || "";
        const args = dash.parseToolArguments(call.function?.arguments);
        onLookup?.(name, round);
        const { result, sources: found } = await runAskTool(ctx, name, args);
        for (const source of found) sources.set(`${source.route}|${source.course}|${source.title}`, source);
        misses = addsNew(result, seen) ? 0 : misses + 1;
        const step = { kind: "lookup", tool: name, args, result };
        steps.push(step);
        trace.push(step);
        onStep?.(step);
        replies.push({ id: call.id, result });
      }
      lookups += calls.length;
      const filled = (turn.tokens || 0) + replies.reduce((sum, reply) => sum + JSON.stringify(reply.result).length, 0) / CHARS_PER_TOKEN;
      last = lookups >= MAX_LOOKUPS || misses >= MAX_MISSES || dash.ASK_MAX_PROMPT_TOKENS - filled < ROUND_TOKENS;
      for (const [i, { id, result }] of replies.entries()) {
        const told = last && i === replies.length - 1 ? { ...result, note: [result.note, LAST_LOOKUP].filter(Boolean).join(" ") } : result;
        messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(told) });
      }
      live.answer = "";
      onUpdate?.(live);
    }

    // "From" names where an answer came from, so it is left off when there was no real answer.
    const grounded = answer !== GAVE_UP && answer !== NO_ANSWER && !NOT_FOUND.test(answer);
    const seconds = (Date.now() - started) / 1000;
    return {
      answer,
      trace,
      steps,
      sources: grounded ? [...sources.values()] : [],
      usedArchive: steps.some((step) => ARCHIVE_TOOLS.has(step.tool)),
      tokensPerSecond,
      seconds,
      thinkingSeconds: thinkMs / 1000,
      firstWordSeconds: firstWordMs ? firstWordMs / 1000 : seconds
    };
  }

  Object.assign(dash, { askArchive, askSystemPrompt: systemPrompt, askRecentHistory: recentHistory, ASK_HISTORY_CHARS: HISTORY_CHARS });
})(globalThis);
