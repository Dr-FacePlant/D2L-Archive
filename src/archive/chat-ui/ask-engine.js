// The model behind Ask, as the agent sees it: give it the chat and the tools it may
// call, get back either text to show or tool calls to run. The model itself runs
// inside this browser tab (ask-runtime.js), so nothing here can reach the internet.
(function initDashboardAskEngine(global) {
  const dash = global.D2LDashboard ||= {};

  // Longer chats than this are refused rather than left to run for minutes.
  const MAX_PROMPT_TOKENS = 12000;
  // Word-pieces the model may spend thinking, then on its answer. A model still
  // thinking at the limit is told to stop and answer.
  const LIMITS = Object.freeze({ thinking: 1024, answer: 600 });
  const CLOSE_THINKING = "\n</think>\n\n";
  // What has been written is passed on at most this often while the model writes.
  const SHOW_EVERY_MS = 80;

  function createLocalEngine({ runtime = dash.createBrowserRuntime(), limits = LIMITS, now = () => Date.now() } = {}) {
    let loading = null;
    // What the model has read so far in this question: the conversation (its memory on
    // the graphics card) and the text it holds. A lookup's result is then all it reads
    // next, rather than the whole chat again. Let go once the answer is written.
    let live = null;
    const forget = () => { live?.conversation.dispose(); live = null; };

    // "idle" (files and graphics card are there, not started), "missing" or "no-gpu".
    const check = () => runtime.availability();

    // Starts the model (a few seconds), reporting 0..1 as it goes. Safe to call again.
    function load(onProgress) {
      loading ||= runtime.load(onProgress).catch((error) => { loading = null; throw error; });
      return loading;
    }

    // Frees the model's memory. Loading again starts from scratch.
    async function unload() {
      const pending = loading;
      loading = null;
      if (pending) await pending.catch(() => {});
      forget();
      await runtime.unload();
    }

    // One model turn: either text to show, or tool calls to run first. onText hears
    // { thinking, answer } as they are written. thinking: false skips the thinking.
    // lookups: false keeps the tools described (so what was read is reused) but the
    // model may not start a lookup, so it has to answer.
    async function chat({ messages, tools, signal, onText, thinking = true, lookups = true }) {
      await load();
      const text = runtime.render(dash.askTemplateMessages(messages), tools, { thinking });
      const reuse = Boolean(live) && text.length > live.text.length && text.startsWith(live.text);
      const ids = runtime.encode(reuse ? text.slice(live.text.length) : text);
      if ((reuse ? live.length : 0) + ids.length > MAX_PROMPT_TOKENS) {
        forget();
        throw new Error("That chat has grown too long for the model. Start a new chat and ask again.");
      }
      if (!reuse) {
        forget();
        live = { conversation: runtime.startConversation(), text: "", length: 0 };
      }
      const { conversation } = live;
      const written = [];
      let thinkMs = 0;
      let shownAt = 0;
      let writeStart = 0;
      const show = (force) => {
        if (!onText && (thinkMs || !thinking)) return;
        const at = now();
        if (!force && at - shownAt < SHOW_EVERY_MS) return;
        shownAt = at;
        const reply = dash.splitReply(runtime.decode(written), thinking);
        if (thinking && reply.thought && !thinkMs) thinkMs = Math.max(at - writeStart, 1);
        onText?.({ thinking: reply.thinking, answer: reply.answer });
      };
      const banIds = lookups ? [] : runtime.lookupIds || [];
      const run = (input, maxNewTokens) => dash.askGenerate({
        step: conversation.step, ids: input, chunk: runtime.chunk, maxNewTokens, stopIds: runtime.stopIds, banIds, signal,
        onToken: (tokens) => { if (!writeStart) writeStart = now(); written.push(tokens[tokens.length - 1]); show(false); }
      });
      try {
        let result = await run(ids, thinking ? limits.thinking : limits.answer);
        const readMs = result.readMs;
        let writeMs = result.writeMs;
        let fed = result.fed;
        // Cut off at the thinking limit: what it has not read back yet, a close to its
        // thinking if it was still thinking, then the rest of the answer.
        if (thinking && !result.stopped && result.tokens.length) {
          const unread = written.slice(fed);
          const extra = dash.splitReply(runtime.decode(written), true).thought ? [] : runtime.encode(CLOSE_THINKING);
          written.push(...extra);
          const seen = written.length;
          result = await run([...unread, ...extra], limits.answer);
          writeMs += result.writeMs;
          fed = seen + result.fed;
        }
        show(true);
        const raw = runtime.decode(written);
        const reply = dash.splitReply(raw, thinking);
        const toolCalls = lookups ? dash.parseRawToolCalls(reply.rest) : [];
        const tokens = live.length + ids.length + written.length;
        // Kept only while there are lookups to come, and only if it read back all it wrote.
        if (toolCalls.length && result.stopped && fed === written.length) {
          live.text = text + raw;
          live.length += ids.length + written.length;
        } else {
          forget();
        }
        return {
          content: toolCalls.length ? "" : reply.answer,
          thinking: reply.thinking,
          toolCalls,
          raw: `${thinking ? "<think>" : "<think></think>"}${raw}`,
          tokensPerSecond: written.length > 1 && writeMs > 0 ? (written.length - 1) / (writeMs / 1000) : 0,
          readMs,
          thinkMs,
          reused: reuse,
          // How much of the model's limit this chat now fills: what it read and what it wrote.
          tokens
        };
      } catch (error) {
        forget();
        throw error;
      }
    }

    return { check, load, unload, chat };
  }

  Object.assign(dash, { createLocalEngine, ASK_MAX_PROMPT_TOKENS: MAX_PROMPT_TOKENS, ASK_LIMITS: LIMITS });
})(globalThis);
