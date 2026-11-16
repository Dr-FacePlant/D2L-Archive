// The pieces that run the model, tested against stand-ins: how the next word-piece
// is picked, how an answer is written, how the chat is handed to the model and the
// reply read back, and how the in-browser runtime starts and steps the model.
import { loadDashboard } from "./test-dashboard-loader.mjs";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();

// ---- picking the next word-piece ---------------------------------------------------------
const scoresOf = (...values) => Float32Array.from(values);
check(dash.sampleToken(scoresOf(1, 5, 3), [], { temperature: 0 }) === 1, "a temperature of zero always takes the best-scoring token");
check(dash.sampleToken(scoresOf(5, 4.9, 1), [0], { temperature: 0 }) === 1, "a token just used is discouraged enough to lose to a close second");
check(dash.sampleToken(scoresOf(-5, -4.9, -9), [0], { temperature: 0 }) === 1, "the discouragement also works on negative scores");
const kept = scoresOf(5, 4.9, 1);
dash.sampleToken(kept, [0, 0, 1], { temperature: 0 });
check(kept.join() === "5,4.900000095367432,1", "the scores are handed back exactly as they came");
const close = scoresOf(1, 0.95, -20, -30);
check(dash.sampleToken(close, [], { temperature: 0.1, topK: 2 }, () => 0.5) === 0 && dash.sampleToken(close, [], { temperature: 0.1, topK: 2 }, () => 0.7) === 1, "chance picks between close scores, weighted toward the better one");
check([0, 0.4, 0.999].every((roll) => [0, 1].includes(dash.sampleToken(scoresOf(1, 0.95, 0.9, 0.8), [], { temperature: 1, topK: 2 }, () => roll))), "only the top few tokens are ever considered");
check(dash.sampleToken(scoresOf(NaN, NaN), [], { temperature: 0 }) === 0 && dash.sampleToken(scoresOf(), []) === 0, "scores that make no sense fall back to the first token");
check(dash.ASK_SAMPLING.temperature === 0.1 && dash.ASK_SAMPLING.topK === 50 && dash.ASK_SAMPLING.repetitionPenalty === 1.1, "the model's recommended settings are used");

// ---- writing an answer ----------------------------------------------------------------------
// A stand-in model: once the prompt is read (prefillCalls steps) it "wants" the next token from `script`, one at a time.
function scriptedModel(script, prefillCalls = 1, vocabulary = 12) {
  const log = { sizes: [] };
  let calls = 0;
  log.step = async (tokens) => {
    log.sizes.push(tokens.length);
    const scores = new Float32Array(vocabulary);
    scores[script[Math.max(0, calls - (prefillCalls - 1))] ?? 9] = 5;
    calls += 1;
    return scores;
  };
  return log;
}
const lowest = { temperature: 0 };
const model = scriptedModel([4, 5, 6, 9], 3);
const written = await dash.askGenerate({ step: model.step, ids: Array.from({ length: 600 }, (_, i) => i % 3), chunk: 256, stopIds: [9], sampling: lowest });
check(model.sizes.slice(0, 3).join() === "256,256,88", `a long prompt is read in chunks the model can take, got ${model.sizes.slice(0, 3)}`);
check(written.tokens.join() === "4,5,6" && written.stopped && model.sizes.slice(3).join() === "1,1,1", "the answer is written one token at a time until the stop token");
check(written.tokensPerSecond >= 0 && written.readMs >= 0, "speed and reading time are reported");
check(written.fed === 3, "every token written before the stop is read back by the model");

const endless = scriptedModel(Array.from({ length: 50 }, () => 4));
const capped = await dash.askGenerate({ step: endless.step, ids: [1, 2], maxNewTokens: 5, stopIds: [9], sampling: lowest });
check(capped.tokens.length === 5 && !capped.stopped && endless.sizes.length === 1 + 4, "an answer that never ends is cut off at the limit without a wasted step");
check(capped.fed === 4, "the token cut off at the limit is counted as not read back yet");
const heard = [];
await dash.askGenerate({ step: scriptedModel([4, 5, 6, 9]).step, ids: [1], stopIds: [9], sampling: lowest, onToken: (tokens) => heard.push(tokens.join("")) });
check(heard.join() === "4,45,456", "each new token is passed on as it is written");

const barred = await dash.askGenerate({ step: scriptedModel([4, 5, 6, 9]).step, ids: [1], stopIds: [9], banIds: [5], sampling: lowest });
check(barred.tokens.join() === "4,0,6", `a token it may not write is never written: the next best is taken, got ${barred.tokens}`);

const instantStop = await dash.askGenerate({ step: scriptedModel([9]).step, ids: [1], stopIds: [9], sampling: lowest });
check(instantStop.tokens.length === 0 && instantStop.stopped, "a model that stops at once writes nothing");

const stopper = new AbortController();
const midway = scriptedModel(Array.from({ length: 50 }, () => 4));
let steps = 0;
let abortError = null;
try {
  await dash.askGenerate({ step: async (tokens) => { steps += 1; if (steps === 4) stopper.abort(); return midway.step(tokens); }, ids: [1, 2], stopIds: [9], sampling: lowest, signal: stopper.signal });
} catch (error) { abortError = error; }
check(abortError && steps === 4, `stopping mid-answer stops at the next token, not at the end (steps ${steps})`);

// ---- the chat in, the reply out ---------------------------------------------------------------
check(JSON.stringify(dash.parseToolArguments('{"query":"exam"}')) === '{"query":"exam"}' && dash.parseToolArguments({ a: 1 }).a === 1, "arguments work as JSON text or as an object");
check(Object.keys(dash.parseToolArguments("{not json")).length === 0 && Object.keys(dash.parseToolArguments(null)).length === 0 && Object.keys(dash.parseToolArguments("7")).length === 0, "arguments that make no sense become none");
const plain = [{ role: "user", content: "hi" }];
const asked = [{ role: "assistant", content: "", tool_calls: [{ id: "a", type: "function", function: { name: "search_archive", arguments: '{"query":"exam"}' } }] }, { role: "tool", tool_call_id: "a", content: "{}" }];
const handed = dash.askTemplateMessages([...plain, ...asked]);
check(handed[0] === plain[0] && handed[1].tool_calls[0].function.arguments.query === "exam" && typeof asked[0].tool_calls[0].function.arguments === "string", "tool-call arguments become objects for the template without changing the chat itself");
const split = dash.splitReply("Plan.</think>The answer.");
const tagged = dash.splitReply("<think>x</think>Yes.");
check(split.thinking === "Plan." && split.answer === "The answer." && split.thought && tagged.thinking === "x" && tagged.answer === "Yes.", "a reply splits into its thinking and its answer");
const midThought = dash.splitReply("Still weighing it <th");
check(midThought.thinking === "Still weighing it" && midThought.answer === "" && !midThought.thought, "a reply still thinking is all thinking, without a half-written tag");
check(dash.splitReply("Plain.", false).answer === "Plain." && dash.splitReply("Plain.", false).thinking === "", "with thinking off the whole reply is the answer");
const withCall = dash.splitReply("Look it up.</think>\n\n<tool_call>\n<function=search_archive>");
check(withCall.answer === "" && withCall.rest.includes("<tool_call>") && dash.splitReply("ok</think>Partial <tool_c").answer === "Partial", "a tool call, even half-written, is never shown as part of the answer");
const replayed = dash.askTemplateMessages([{ role: "assistant", raw: "<think>x</think>\n<tool_call>y</tool_call>", content: "", tool_calls: asked[0].tool_calls }]);
check(replayed[0].content === "<think>x</think>\n<tool_call>y</tool_call>" && !replayed[0].tool_calls, "a lookup round goes back to the template exactly as the model wrote it");
check(dash.cleanReply("Done.<|im_end|>") === "Done." && dash.cleanReply("<|endoftext|>Hi<|im_end|>\n") === "Hi", "the model's stop markers are not part of the reply");
const twoCalls = dash.parseRawToolCalls("<tool_call>\n<function=search_archive>\n<parameter=query>\nfinal exam\n</parameter>\n</function>\n</tool_call>\n<tool_call>\n<function=upcoming_due>\n<parameter=days>\n14\n</parameter>\n</function>\n</tool_call><|im_end|>");
check(twoCalls.length === 2 && twoCalls[0].id === "raw-0" && twoCalls[1].id === "raw-1" && JSON.parse(twoCalls[0].function.arguments).query === "final exam" && JSON.parse(twoCalls[1].function.arguments).days === 14, "several tool calls in one reply are all read, numbers as numbers");
check(dash.parseRawToolCalls("<tool_call>no name here</tool_call>").length === 0 && dash.parseRawToolCalls("just words").length === 0 && dash.parseRawToolCalls(undefined).length === 0, "text that isn't a tool call isn't read as one");

// ---- the in-browser runtime, over stand-ins --------------------------------------------------------
const base = "chrome-extension://abc/dashboard.html?embedded=1#/ask";
const folder = "chrome-extension://abc/models/LiquidAI/LFM3-1.7B-ONNX/";
const okFetch = (seen) => async (url, init) => { seen.push(String(url)); return { ok: true, status: 200, init }; };
const adapterGpu = { requestAdapter: async () => ({}) };

check((await dash.createBrowserRuntime({ baseUrl: base, gpu: undefined, fetchImpl: okFetch([]) }).availability()).state === "no-gpu", "a browser without WebGPU is told so");
check((await dash.createBrowserRuntime({ baseUrl: base, gpu: { requestAdapter: async () => null }, fetchImpl: okFetch([]) }).availability()).state === "no-gpu", "a browser with no graphics adapter is told so");
check((await dash.createBrowserRuntime({ baseUrl: base, gpu: { requestAdapter: async () => { throw new Error("blocked"); } }, fetchImpl: okFetch([]) }).availability()).state === "no-gpu", "a graphics check that throws counts as no graphics card");
const asked1 = [];
const ready = await dash.createBrowserRuntime({ baseUrl: base, gpu: adapterGpu, fetchImpl: okFetch(asked1) }).availability();
check(ready.state === "idle" && asked1.length === dash.ASK_MODEL_FILES.length && asked1.every((url) => url.startsWith(folder)), "with every file there, the model is ready to load, and only the extension's own folder was asked");
const lacking = await dash.createBrowserRuntime({ baseUrl: base, gpu: adapterGpu, fetchImpl: async (url) => { if (String(url).endsWith("tokenizer.json")) throw new TypeError("net::ERR_FILE_NOT_FOUND"); return { ok: !String(url).endsWith("model_q4f16.onnx_data") }; } }).availability();
check(lacking.state === "missing" && lacking.missing.length === 2 && lacking.reason.includes("tokenizer.json") && lacking.reason.includes("model_q4f16.onnx_data"), "each missing model file is named");
const drop = new Set();
await dash.createBrowserRuntime({ baseUrl: base, gpu: adapterGpu, fetchImpl: async (url, init) => { init.signal.addEventListener("abort", () => drop.add(String(url))); return { ok: true }; } }).availability();
check(drop.size === dash.ASK_MODEL_FILES.length, "checking for a file drops the download right away");

// A small model: one convolution layer and one attention layer.
function standInLibrary() {
  const record = { imports: [], tokenizerFor: [], modelFor: [], runs: [], made: [], outputs: [] };
  class Tensor {
    constructor(type, data, dims) {
      this.ort_tensor = { type, data, dims, disposed: false, dispose() { this.disposed = true; } };
      record.made.push(this.ort_tensor);
    }
  }
  const output = (type, dims) => {
    const made = { type, dims, disposed: false, dispose() { this.disposed = true; }, getData: async () => Float32Array.from({ length: 12 }, (_, i) => (i === 7 ? 3 : 0)) };
    record.outputs.push(made);
    return made;
  };
  const library = {
    env: { backends: { onnx: { wasm: {} } } },
    Tensor,
    AutoTokenizer: {
      from_pretrained: async (id) => { record.tokenizerFor.push(id); return {
        encode: (text) => (text === "<|im_end|>" ? [9] : text === "<|endoftext|>" ? [8] : text === "<tool_call>" ? [7] : text === "two tokens" ? [1, 2] : [1, 2, 3]),
        apply_chat_template: (messages, options) => { record.template = { messages, options }; return "TEMPLATE"; },
        decode: (ids, options) => { record.decode = { ids, options }; return "decoded"; }
      }; }
    },
    AutoModelForCausalLM: {
      from_pretrained: async (id, options) => {
        record.modelFor.push({ id, options });
        return { config: { layer_types: ["conv", "full_attention"], hidden_size: 2048, conv_L_cache: 7, num_key_value_heads: 4, head_dim: 128 }, sessions: { model: { run: async (feeds) => { record.runs.push(feeds); return { logits: output("float32", [1, 1, 12]), "present_conv.0": output("float16", [1, 2048, 7]), "present.1.key": output("float16", [1, 4, 1, 128]), "present.1.value": output("float16", [1, 4, 1, 128]) }; } } } };
      }
    }
  };
  return { record, library };
}
// The weights file as the extension serves it: no size is given, a byte range is honoured, and the pieces come in uneven sizes.
const weightsFile = Uint8Array.from({ length: 25 }, (_, i) => i + 1);
function serving({ file = weightsFile, ignoreRange = false, log = [] } = {}) {
  return async (url, init) => {
    log.push({ url: String(url), range: init?.headers?.Range });
    if (!String(url).endsWith("model_q4f16.onnx_data")) return { ok: true, status: 200 };
    const [from, to] = /bytes=(\d+)-(\d+)/.exec(init?.headers?.Range || "")?.slice(1).map(Number) ?? [0, file.length - 1];
    if (!ignoreRange && from >= file.length) return { ok: false, status: 416 };
    const piece = ignoreRange ? file : file.subarray(from, to + 1);
    let at = 0;
    return { ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({
      read: async () => { if (at >= piece.length) return { done: true }; const end = Math.min(at + 3 + (at % 2), piece.length); const value = piece.slice(at, end); at = end; return { done: false, value }; },
      cancel: async () => { log.cancelled = true; }
    }) } };
  };
}
const smallRuntime = (stand, options = {}) => dash.createBrowserRuntime({ baseUrl: base, gpu: adapterGpu, weightsBytes: 25, sliceBytes: 10, importImpl: async (url) => { stand.record.imports.push(url); return stand.library; }, ...options });

const stand = standInLibrary();
const served = [];
const runtime = smallRuntime(stand, { fetchImpl: serving({ log: served }) });
let notLoaded = "";
try { runtime.render([], []); } catch (error) { notLoaded = error.message; }
check(/isn't loaded/.test(notLoaded), "using the model before it is loaded is an error, not a crash");
const reported = [];
await runtime.load((fraction) => reported.push(fraction));
check(stand.record.imports.join() === "chrome-extension://abc/vendor/ask-runtime/transformers.bundle.js", "the model library is loaded from the extension's own folder");
const env = stand.library.env;
check(env.allowRemoteModels === false && env.useBrowserCache === false && env.useWasmCache === false && env.localModelPath === "/models/" && env.backends.onnx.wasm.wasmPaths === "chrome-extension://abc/vendor/ask-runtime/", "the loader is told to use only the extension's own files");
check(stand.record.modelFor[0].id === "LiquidAI/LFM3-1.7B-ONNX" && stand.record.modelFor[0].options.device === "webgpu" && stand.record.modelFor[0].options.dtype === "q4f16", "the 4-bit model is loaded onto the graphics card");
const handedOver = stand.record.modelFor[0].options;
check(handedOver.use_external_data_format === false && handedOver.session_options.externalData.length === 1 && handedOver.session_options.externalData[0].path === "model_q4f16.onnx_data" && !("progress_callback" in handedOver), "the weights are read by us and handed over by name, so the library does not read them a second time");
check(handedOver.session_options.extra?.optimization?.disable_specified_optimizers === "ConstantFolding", "the runtime's early pre-computing step is off, so the weights are not copied twice");
check(Object.prototype.toString.call(handedOver.session_options.externalData[0].data) === "[object Uint8Array]" && handedOver.session_options.externalData[0].data.join() === weightsFile.join(), "the weights arrive whole and in order, though the pieces came in uneven sizes");
const weightRequests = served.filter((request) => request.url.endsWith("model_q4f16.onnx_data"));
check(weightRequests.map((request) => request.range).join() === "bytes=0-9,bytes=10-19,bytes=20-24", `the weights are asked for a slice at a time, never the whole file at once, got ${weightRequests.map((request) => request.range)}`);
check(served.every((request) => request.url.startsWith("chrome-extension://abc/")), "loading asks only for the extension's own files");
check(reported.map((fraction) => fraction.toFixed(2)).join() === "0.36,0.72,0.90,1.00", `loading progress follows the weights being read and ends at 1, got ${reported}`);
async function failureOf(options) {
  const lonely = standInLibrary();
  const failing = smallRuntime(lonely, options);
  try { await failing.load(); return { message: "", lonely }; } catch (error) { return { message: error.message, lonely }; }
}
const cutShort = await failureOf({ fetchImpl: serving({ file: weightsFile.subarray(0, 23) }) });
check(/could not be read past/.test(cutShort.message) && /Download the model again/.test(cutShort.message) && cutShort.lonely.record.modelFor.length === 0, "a weights file that comes up short is named, and the model is never started on it");
const gone = await failureOf({ fetchImpl: serving({ file: weightsFile.subarray(0, 10) }) });
check(/Download the model again/.test(gone.message) && gone.lonely.record.modelFor.length === 0, "a slice the file can't give is an error, not a half-empty model");
const wholeFile = [];
const ignored = await failureOf({ fetchImpl: serving({ ignoreRange: true, log: wholeFile }) });
check(/Download the model again/.test(ignored.message) && wholeFile.cancelled === true && ignored.lonely.record.modelFor.length === 0, "a server that ignores the slice and sends the whole file is stopped, not read to the end");
check(runtime.stopIds.join() === "9,8", "the model's stop tokens are found");
check(runtime.lookupIds.join() === "7", "the marker that starts a lookup is found, and a marker the model doesn't have as one token is left out");
const options = () => stand.record.template.options;
check(runtime.render([{ role: "user", content: "hi" }], dash.ASK_TOOLS) === "TEMPLATE" && options().tokenize === false && options().enable_thinking === true && options().add_generation_prompt === true && options().tools === dash.ASK_TOOLS, "the chat is rendered as text, with the tools described and thinking on");
runtime.render([{ role: "user", content: "hi" }], [], { thinking: false });
check(options().enable_thinking === false, "thinking can be switched off");
check(runtime.encode("TEMPLATE").join() === "1,2,3", "text becomes the model's tokens");
runtime.render([], []);
check(!("tools" in stand.record.template.options), "no tools means none are described");
runtime.decode([4, 5]);
check(stand.record.decode.ids.join() === "4,5" && stand.record.decode.options.skip_special_tokens === false, "the reply is read back with its special markers, so tool calls survive");

const conversation = runtime.startConversation();
const first = stand.record.made.length;
const scores = await conversation.step([10, 11, 12]);
const run1 = stand.record.runs[0];
check(run1.input_ids.dims.join() === "1,3" && run1.attention_mask.dims.join() === "1,3" && run1.position_ids.data.join() === "0,1,2" && run1.logits_to_keep.data.join() === "1", "the first step hands the model its tokens with positions from zero");
check(run1["past_conv.0"].dims.join() === "1,2048,7" && run1["past_key_values.1.key"].dims.join() === "1,4,0,128" && run1["past_key_values.1.value"].dims.join() === "1,4,0,128", "the model starts with an empty memory of the right shapes");
check(scores.length === 12 && scores[7] === 3 && first > 0, "the scores for the next token come back");
await conversation.step([7]);
const run2 = stand.record.runs[1];
check(run2.attention_mask.dims.join() === "1,4" && run2.position_ids.data.join() === "3" && run2["past_conv.0"].dims.join() === "1,2048,7" && run2["past_key_values.1.key"].dims.join() === "1,4,1,128", "the next step continues where the last stopped, with the memory it wrote");
check(run1["past_conv.0"].disposed && run1.input_ids.disposed && run1.attention_mask.disposed && run2["past_conv.0"].disposed, "what the model is done with is freed after each step");
const [logitsOut, ...memoryOut] = stand.record.outputs.slice(-4);
check(logitsOut.disposed && memoryOut.every((tensor) => !tensor.disposed), "the newest memory is kept for the next step");
conversation.dispose();
check(memoryOut.every((tensor) => tensor.disposed), "ending the conversation frees its memory");

if (failures.length) {
  console.error(failures.map((message) => `FAIL: ${message}`).join("\n"));
  process.exit(1);
}
console.log("Ask model tests passed.");
