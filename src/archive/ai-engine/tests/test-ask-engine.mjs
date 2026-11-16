import { loadDashboard } from "./test-dashboard-loader.mjs";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();

// ---- a stand-in model that reads and writes one character per token --------------------------------
// A token is a character code + 10, and 9 is the stop token. Each time the model starts reading (rather
// than taking back the token it just wrote), it writes the next text in `writes`, then stops. The
// template copies the real one's shape: <role>content</> per message, then <assistant><think> to
// start the reply (<assistant><think></think> with thinking off).
// A space is always the runner-up, taken when the wanted token is not allowed.
function charRuntime({ writes = [], availability = { state: "idle" }, failLoads = 0, pad = 0, lookupIds } = {}) {
  const log = { loads: 0, unloads: 0, rendered: [], encoded: [], reads: [], conversations: 0, disposed: 0 };
  const encode = (text) => Array.from(text, (char) => char.codePointAt(0) + 10);
  const text = (ids) => String.fromCodePoint(...ids.map((id) => id - 10));
  const runtime = {
    chunk: 4096,
    stopIds: [9],
    lookupIds,
    availability: async () => availability,
    load: async (onProgress) => { log.loads += 1; if (log.loads <= failLoads) throw new Error("no memory left"); onProgress?.(0.5); onProgress?.(1); },
    unload: async () => { log.unloads += 1; },
    render: (messages, tools, { thinking = true } = {}) => {
      log.rendered.push({ messages, tools, thinking });
      return `${"-".repeat(pad)}${messages.map((message) => `<${message.role}>${message.content}</>`).join("")}<assistant><think>${thinking ? "" : "</think>"}`;
    },
    encode: (value) => { log.encoded.push(value); return encode(value); },
    decode: text,
    startConversation: () => {
      log.conversations += 1;
      let reply = [];
      let at = 0;
      let offered = null;
      let fresh = true;
      return {
        step: async (ids) => {
          if (offered !== null && offered !== 9 && ids.length === 1 && ids[0] === offered) {
            at += 1;
            fresh = true;
          } else if (fresh) {
            log.reads.push(text(ids));
            reply = encode(writes.shift() ?? "");
            at = 0;
            fresh = false;
          } else {
            log.reads[log.reads.length - 1] += text(ids);
          }
          offered = reply[at] ?? 9;
          if (offered === 9) fresh = true;
          const scores = new Float32Array(140).fill(-10);
          scores[42] = 0;
          scores[offered] = 10;
          return scores;
        },
        dispose: () => { log.disposed += 1; }
      };
    }
  };
  return { runtime, log };
}

const noTools = { messages: [{ role: "user", content: "hi" }], tools: [] };
const lookupText = (query) => `<tool_call>\n<function=search_archive>\n<parameter=query>\n${query}\n</parameter>\n</function>\n</tool_call>`;

// ---- one turn -----------------------------------------------------------------------------------------
const exam = charRuntime({ writes: ["Plan it out.</think>\n\nThe exam is Dec 12."] });
const examEngine = dash.createLocalEngine({ runtime: exam.runtime });
const answered = await examEngine.chat(noTools);
check(answered.content === "The exam is Dec 12." && answered.thinking === "Plan it out." && !answered.toolCalls.length, "a reply comes back as its answer and, apart, its thinking");
check(answered.raw === "<think>Plan it out.</think>\n\nThe exam is Dec 12." && exam.log.rendered[0].thinking === true, "thinking is on by default, and what the model wrote comes back word for word");
check(exam.log.conversations === 1 && exam.log.disposed === 1 && typeof answered.tokensPerSecond === "number", "the model's memory is freed after an answer, and its speed is reported");

const lookupCall = charRuntime({ writes: ["Check the week.</think>\n\n<tool_call>\n<function=upcoming_due>\n<parameter=days>\n7\n</parameter>\n<parameter=course>\nCS 1301\n</parameter>\n</function>\n</tool_call>"] });
const looked = await dash.createLocalEngine({ runtime: lookupCall.runtime }).chat(noTools);
const lookedArgs = JSON.parse(looked.toolCalls[0]?.function.arguments || "{}");
check(looked.content === "" && looked.toolCalls[0]?.function.name === "upcoming_due" && lookedArgs.days === 7 && lookedArgs.course === "CS 1301", "a tool call written out by the model is understood");
check(lookupCall.log.disposed === 0, "while lookups are to come, the model keeps what it has read");

const plainRun = charRuntime({ writes: ["Just the answer."] });
const plainReply = await dash.createLocalEngine({ runtime: plainRun.runtime }).chat({ ...noTools, thinking: false });
check(plainReply.content === "Just the answer." && plainReply.thinking === "" && plainReply.raw === "<think></think>Just the answer." && plainRun.log.rendered[0].thinking === false, "with thinking off the whole reply is the answer");

// ---- watching it write ----------------------------------------------------------------------------------
let clock = 0;
const shown = [];
const streaming = charRuntime({ writes: [`Look it up.</think>\n\n${lookupText("exam")}`] });
const streamed = await dash.createLocalEngine({ runtime: streaming.runtime, now: () => (clock += 100) }).chat({ ...noTools, onText: (part) => shown.push({ ...part }) });
check(shown.length > 10 && shown.some((part) => part.thinking === "Look it") && shown.at(-1).thinking === "Look it up.", "the thinking is passed on as it is written");
check(shown.every((part) => !/<|tool_call|function=/.test(part.answer)), "a tool call being written never shows as answer text");
check(streamed.thinkMs > 0, "how long it thought is measured");

// ---- lookups: the model carries on from what it read -------------------------------------------------------
const question = [{ role: "user", content: "When is the exam?" }];
const twice = charRuntime({ writes: [`Look.</think>\n\n${lookupText("exam")}`, "Found it.</think>\n\nDec 12."] });
const twiceEngine = dash.createLocalEngine({ runtime: twice.runtime });
const round1 = await twiceEngine.chat({ messages: question, tools: [] });
const toolReply = { role: "tool", tool_call_id: round1.toolCalls[0].id, content: "{\"results\":[1]}" };
const round2 = await twiceEngine.chat({ messages: [...question, { role: "assistant", content: "", tool_calls: round1.toolCalls, raw: round1.raw }, toolReply], tools: [] });
check(round2.content === "Dec 12." && !round1.reused && round2.reused, "the second round carries on from the first");
check(twice.log.reads.length === 2 && twice.log.reads[1] === "</><tool>{\"results\":[1]}</><assistant><think>", `after a lookup the model reads only its result, got ${JSON.stringify(twice.log.reads[1])}`);
check(twice.log.conversations === 1 && twice.log.disposed === 1, "both rounds share one conversation, freed after the answer");
const wrote = (reply) => reply.raw.length - "<think>".length;
check(round1.tokens === twice.log.reads[0].length + wrote(round1) && round2.tokens === round1.tokens + twice.log.reads[1].length + wrote(round2), "each round says how much of the model's limit the chat now fills");

const differs = charRuntime({ writes: [`Look.</think>\n\n${lookupText("exam")}`, "Dec 12."] });
const differsEngine = dash.createLocalEngine({ runtime: differs.runtime });
const first = await differsEngine.chat({ messages: question, tools: [] });
const fresh = await differsEngine.chat({ messages: [...question, { role: "assistant", content: "", tool_calls: first.toolCalls }, toolReply], tools: [] });
check(!fresh.reused && differs.log.conversations === 2 && differs.log.disposed === 2, "a chat that doesn't carry on from what was read starts over, freeing the old memory");

const kept = charRuntime({ writes: [`Look.</think>\n\n${lookupText("exam")}`] });
const keptEngine = dash.createLocalEngine({ runtime: kept.runtime });
await keptEngine.chat(noTools);
await keptEngine.unload();
check(kept.log.disposed === 1 && kept.log.unloads === 1, "letting the model go frees a conversation left waiting for a lookup");

// ---- a turn that must answer ---------------------------------------------------------------------------------
const marker = "~".codePointAt(0) + 10;
const barred = charRuntime({ writes: ["Dec 12~"], lookupIds: [marker] });
const barredReply = await dash.createLocalEngine({ runtime: barred.runtime, limits: { thinking: 5, answer: 10 } }).chat({ ...noTools, thinking: false, lookups: false });
const open = charRuntime({ writes: ["Dec 12~"], lookupIds: [marker] });
const openReply = await dash.createLocalEngine({ runtime: open.runtime, limits: { thinking: 5, answer: 10 } }).chat({ ...noTools, thinking: false });
check(barredReply.content === "Dec 12" && !barredReply.raw.includes("~") && openReply.content === "Dec 12~", "a turn that can't look anything up never writes the start of a lookup, and other turns can");
const written = charRuntime({ writes: [`Answer it.</think>\n\nDec 12.${lookupText("exam")}`] });
const writtenReply = await dash.createLocalEngine({ runtime: written.runtime }).chat({ ...noTools, lookups: false });
check(!writtenReply.toolCalls.length && writtenReply.content === "Dec 12." && written.log.disposed === 1, "a lookup written anyway on such a turn is not a lookup, and the words before it are the answer");

// ---- the thinking limit ----------------------------------------------------------------------------------------
const ponder = charRuntime({ writes: ["Hmm hmm hmm hmm", "Answer."] });
const pondered = await dash.createLocalEngine({ runtime: ponder.runtime, limits: { thinking: 5, answer: 50 } }).chat(noTools);
check(pondered.thinking === "Hmm h" && pondered.content === "Answer." && ponder.log.reads[1] === "h\n</think>\n\n", `a model still thinking at the limit is told to stop and answer, got ${JSON.stringify(ponder.log.reads)}`);
const onwards = charRuntime({ writes: ["ok</think>\n\nAn answer that runs on"] });
const ranOn = await dash.createLocalEngine({ runtime: onwards.runtime, limits: { thinking: 12, answer: 50 } }).chat(noTools);
check(ranOn.content === "An answer that runs on" && onwards.log.reads.length === 1 && !onwards.log.encoded.some((value) => value.includes("</think>")), "a model already answering at the thinking limit just carries on");
const capped = charRuntime({ writes: [`x</think>\n\n${lookupText("exam")}`] });
const cappedReply = await dash.createLocalEngine({ runtime: capped.runtime, limits: { thinking: 30, answer: 10 } }).chat(noTools);
check(!cappedReply.toolCalls.length && capped.log.disposed === 1, "a reply cut off at the limit is not kept for a next round");

// ---- loading and stopping -------------------------------------------------------------------------------------------
const progress = [];
await examEngine.load((fraction) => progress.push(fraction));
check(exam.log.loads === 1, "the model is loaded once, however many questions follow");
const progressEngine = dash.createLocalEngine({ runtime: charRuntime().runtime });
await progressEngine.load((fraction) => progress.push(fraction));
check(progress.join() === "0.5,1", "loading reports its progress");

const flaky = charRuntime({ failLoads: 1 });
const flakyEngine = dash.createLocalEngine({ runtime: flaky.runtime });
let startError = "";
try { await flakyEngine.load(); } catch (error) { startError = error.message; }
check(/no memory/.test(startError), "a model that can't start says why");
await flakyEngine.load();
check(flaky.log.loads === 2, "asking again after a failed start tries again");

const huge = charRuntime({ pad: dash.ASK_MAX_PROMPT_TOKENS });
let hugeError = "";
try { await dash.createLocalEngine({ runtime: huge.runtime }).chat(noTools); } catch (error) { hugeError = error.message; }
check(/too long/.test(hugeError) && huge.log.conversations === 0, "a chat that is too long is refused before the model starts reading");

const stopped = new AbortController();
stopped.abort();
const interrupted = charRuntime({ writes: ["never"] });
let abortSeen = false;
try { await dash.createLocalEngine({ runtime: interrupted.runtime }).chat({ ...noTools, signal: stopped.signal }); } catch { abortSeen = true; }
check(abortSeen && interrupted.log.conversations === 1 && interrupted.log.disposed === 1, "stopping mid-answer still frees the model's memory");
check((await dash.createLocalEngine({ runtime: charRuntime({ availability: { state: "missing", reason: "Missing model files: tokenizer.json." } }).runtime }).check()).state === "missing", "the engine passes on whether the model files are there");

// ---- a whole question, through the real loop -------------------------------------------------------------------------
const courses = [{ courseId: "101", label: "CS 1301" }];
const evidence = [{ evidenceId: "ev-syllabus", courseId: "101", source: "contentTopic", title: "Syllabus", description: "The final exam is on December 12 at 8 AM in the main hall." }];
const ctx = { passageIndex: dash.buildPassageIndex({ entities: [], evidence, courses }), now: new Date(2026, 10, 4, 9, 0) };
const whole = charRuntime({ writes: [`Search the syllabus.</think>\n\n${lookupText("final exam")}`, "It says December 12.</think>\n\nThe final exam is December 12 (CS 1301 Syllabus)."] });
const updates = [];
const done = await dash.askArchive({ engine: dash.createLocalEngine({ runtime: whole.runtime }), ctx, question: "When is the final exam?", onUpdate: (live) => updates.push(live.answer) });
check(done.answer.startsWith("The final exam is December 12") && done.usedArchive && done.sources[0]?.title === "Syllabus", "a question is answered from a real lookup");
check(whole.log.conversations === 1 && whole.log.disposed === 1, "the lookup round and the answer share one conversation");
check(done.trace.map((entry) => entry.kind).join() === "thinking,lookup,thinking" && done.trace[2].text === "It says December 12.", "its thinking and lookups are kept in order");
check(updates.some((answer) => answer.startsWith("The final")) && done.firstWordSeconds <= done.seconds, "the answer is passed on as it is written");

const greet = charRuntime({ writes: ["The student says hi.</think>\n\nHi! I'm Ask. What would you like to know about your courses?"] });
const hi = await dash.askArchive({ engine: dash.createLocalEngine({ runtime: greet.runtime }), ctx, question: "Hi" });
check(hi.answer.startsWith("Hi! I'm Ask") && !hi.steps.length && !hi.usedArchive && !hi.sources.length && greet.log.reads.length === 1, "a greeting gets the model's own reply, with no lookup");

if (failures.length) {
  console.error(failures.map((message) => `FAIL: ${message}`).join("\n"));
  process.exit(1);
}
console.log("Ask engine tests passed.");
