// Getting messages into the model's chat format and its reply back out: the
// arguments the model's template wants, and the tool calls and thinking text
// the model writes into its reply.
(function initDashboardAskPrompt(global) {
  const dash = global.D2LDashboard ||= {};

  // Arguments arrive as JSON text from a model, or already as an object.
  function parseToolArguments(value) {
    if (value && typeof value === "object") return value;
    try {
      const parsed = JSON.parse(value || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  // The model's template refuses tool calls whose arguments are JSON text, so
  // earlier calls in the chat are handed over with their arguments as objects.
  // A turn the model wrote during this question goes back exactly as written
  // (raw), so it matches what the model has already read and need not be read again.
  function templateMessages(messages) {
    return messages.map((message) => {
      if (message.raw) return { role: "assistant", content: message.raw };
      return !message.tool_calls ? message : {
        ...message,
        tool_calls: message.tool_calls.map((call) => ({ ...call, function: { ...call.function, arguments: parseToolArguments(call.function?.arguments) } }))
      };
    });
  }

  const STOP_MARKERS = /<\|(?:im_end|endoftext)\|>/g;
  // The start of a marker still being written ("</thi") is held back until it is whole.
  const PARTIAL_TAG = /<\/?[a-z_|]*$/i;

  // The model ends a reply with a stop marker. It is not part of the reply.
  function cleanReply(text) {
    return String(text ?? "").replace(STOP_MARKERS, "").trim();
  }

  // What the model has written so far, split into its thinking and its answer.
  // With thinking on, the prompt ends inside <think>, so everything up to </think>
  // is thinking. rest is all that follows the thinking (tool calls included);
  // answer is the part to show, which stops where a tool call starts.
  function splitReply(text, thinking = true) {
    const raw = String(text ?? "").replace(STOP_MARKERS, "");
    const end = raw.indexOf("</think>");
    if (end < 0 && thinking) return { thinking: raw.replace(PARTIAL_TAG, "").trim(), answer: "", rest: "", thought: false };
    const thought = end < 0 ? "" : raw.slice(0, end).replace(/^\s*<think>/, "").trim();
    const rest = end < 0 ? raw : raw.slice(end + "</think>".length);
    return { thinking: thought, answer: rest.split("<tool_call>")[0].replace(PARTIAL_TAG, "").trim(), rest, thought: true };
  }

  // The model writes a tool call as <tool_call><function=NAME><parameter=KEY>VALUE… text.
  // This turns it into the usual shape: { id, type, function: { name, arguments } }.
  function parseRawToolCalls(text) {
    const calls = [];
    for (const block of String(text ?? "").matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)) {
      const name = /<function=([^>\s]+)>/.exec(block[1])?.[1];
      if (!name) continue;
      const args = {};
      for (const param of block[1].matchAll(/<parameter=([^>\s]+)>\s*([\s\S]*?)\s*<\/parameter>/g)) args[param[1]] = /^-?\d+$/.test(param[2]) ? Number(param[2]) : param[2];
      calls.push({ id: `raw-${calls.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
    }
    return calls;
  }

  Object.assign(dash, { parseToolArguments, askTemplateMessages: templateMessages, cleanReply, splitReply, parseRawToolCalls });
})(globalThis);
