import fs from "node:fs";
import path from "node:path";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// ---- a small archive, and a clock that never moves ---------------------------------
const now = new Date(2026, 10, 4, 9, 0);
const inDays = (days, hour = 23) => new Date(2026, 10, 4 + days, hour, 59).toISOString();
const courses = [{ courseId: "101", label: "CS 1301" }, { courseId: "202", label: "BIOL 1107" }];
const entities = [
  { entityId: "assignment:101:1", entityType: "assignmentBundle", courseId: "101", canonicalTitle: "Lab 4", dates: { dueAt: inDays(2) }, summary: "Build a sorting visualizer." },
  { entityId: "quiz:101:9", entityType: "quizBundle", courseId: "101", canonicalTitle: "Quiz 3", dates: { dueAt: inDays(4), availableFrom: new Date(2026, 10, 6, 8, 0).toISOString() } },
  { entityId: "assignment:101:3", entityType: "assignmentBundle", courseId: "101", canonicalTitle: "Project 2", dates: { dueAt: inDays(20) } },
  { entityId: "assignment:202:5", entityType: "assignmentBundle", courseId: "202", canonicalTitle: "Stain Reflection", dates: { dueAt: inDays(3), availableFrom: inDays(-5) } },
  { entityId: "assignment:101:0", entityType: "assignmentBundle", courseId: "101", canonicalTitle: "Lab 3", dates: { dueAt: inDays(-3) } },
  { entityId: "assignment:303:1", entityType: "assignmentBundle", courseId: "303", canonicalTitle: "Hidden Course Essay", dates: { dueAt: inDays(1) } },
  { entityId: "assignment:101:2", entityType: "assignmentBundle", courseId: "101", canonicalTitle: "Reading Notes", dates: { dueAt: inDays(-1) } },
  { entityId: "assignment:101:4", entityType: "assignmentBundle", courseId: "101", canonicalTitle: "Turned In Lab", status: "submitted", dates: { dueAt: inDays(1) } },
  { entityId: "assignment:202:7", entityType: "assignmentBundle", courseId: "202", canonicalTitle: "Field Notes", dueAtSource: "apiEndDate", dates: { dueAt: inDays(5), availableUntil: inDays(5) } },
  { entityId: "resource:101:8", entityType: "learningResource", courseId: "101", canonicalTitle: "Week 12 Slides", dates: { availableFrom: new Date(2026, 10, 7, 9, 0).toISOString() } }
];
const evidence = [
  { evidenceId: "ev-syllabus", courseId: "101", source: "contentTopic", title: "Syllabus", description: "<p>The final exam is on December 12 at 8 AM in the main hall.</p>" },
  { evidenceId: "ev-bio", courseId: "202", source: "contentTopic", title: "Staining guide", description: "Use crystal violet to stain cell walls." }
];
const passageIndex = dash.buildPassageIndex({ entities, evidence, courses });
// The dashboard's own index, which gives each item the status and due date the student sees.
const index = dash.buildIndex({ now, courses: [{ courseId: "101", code: "CS1301", title: "Intro to Computing" }, { courseId: "202", code: "BIOL1107", title: "Biology" }], entities, settings: {} });
const ctx = { passageIndex, index, checklistDone: {}, hiddenWork: {}, now };

// The engine itself, over a stand-in model, is tested in test-ask-engine.mjs.

// ---- tools ----------------------------------------------------------------------------------
const search = dash.runAskTool(ctx, "search_archive", { query: "final exam", course: "cs1301" });
check(search.result.results[0]?.text.includes("December 12") && search.result.results[0].course === "CS 1301", "search_archive finds the passage and names its course");
check(search.sources.length === search.result.results.length, "every search result is also a source");
const entitySearch = dash.runAskTool(ctx, "search_archive", { query: "lab 4" });
check(entitySearch.sources[0]?.route === dash.routeFor(entities[0]), "an item result carries the route that opens it");
const wrongCourse = dash.runAskTool(ctx, "search_archive", { query: "exam", course: "PSYC 1101" });
check(/CS 1301, BIOL 1107/.test(wrongCourse.result.error) && !wrongCourse.sources.length, "a wrong course name says which courses exist and does not search everywhere");
check(dash.runAskTool(ctx, "search_archive", { query: "   " }).result.error, "an empty query is an error the model can read");
check(dash.runAskTool(ctx, "search_archive", { query: "quantum chromodynamics" }).result.note, "no match says so");

const week = dash.runAskTool(ctx, "upcoming_due", { days: 7 }).result.items;
check(week.map((item) => item.title).join(",") === "Reading Notes,Lab 4,Stain Reflection,Quiz 3,Field Notes", `a week ahead lists soonest first, got ${week.map((i) => i.title)}`);
check(!week.some((item) => /Lab 3|Project 2|Hidden Course|Turned In/.test(item.title)), "work late for over 2 days, work beyond the window, hidden courses and turned-in work are left out");
const byTitle = Object.fromEntries(week.map((item) => [item.title, item]));
check(byTitle["Lab 4"].course === "CS 1301" && byTitle["Lab 4"].kind === "Assignment" && byTitle["Lab 4"].status === "Open" && byTitle["Lab 4"].when === "due Fri, Nov 6, 2026, 11:59 PM (in 2 days)" && !/open/.test(byTitle["Stain Reflection"].when), `each item names its course, kind, status and its due time with the year and how far off it is, got ${JSON.stringify(byTitle["Lab 4"])}`);
check(byTitle["Quiz 3"].status === "Not open yet" && byTitle["Quiz 3"].when === "due Sun, Nov 8, 2026, 11:59 PM (in 4 days) · opens Fri, Nov 6, 2026, 8:00 AM (in 2 days)", `work not open yet says when it opens as well as when it is due, got ${JSON.stringify(byTitle["Quiz 3"])}`);
check(byTitle["Reading Notes"].status === "Late" && byTitle["Reading Notes"].when === "due Tue, Nov 3, 2026, 11:59 PM (yesterday)", "work that went late yesterday is listed as Late");
check(byTitle["Field Notes"].when === "due Mon, Nov 9, 2026, 11:59 PM (in 5 days)" && Object.keys(byTitle["Field Notes"]).every((key) => !/close/i.test(key)), "a close-only date is given as due");
check(dash.runAskTool(ctx, "upcoming_due", { days: 30, course: "BIOL 1107" }).result.items.every((item) => item.course === "BIOL 1107"), "a course name limits what is due");
check(dash.runAskTool({ ...ctx, hiddenWork: { "assignment:101:1": { reason: "done" } } }, "upcoming_due", { days: 7 }).result.items.every((item) => item.title !== "Lab 4"), "work you marked done is not listed");
const slides = dash.runAskTool(ctx, "search_archive", { query: "week 12 slides" }).result.results[0];
check(slides.title === "Week 12 Slides" && slides.when === "opens Sat, Nov 7, 2026, 9:00 AM (in 3 days)" && !("status" in slides), `an item that isn't work still says when it opens, got ${JSON.stringify(slides)}`);
const quizHit = dash.runAskTool(ctx, "search_archive", { query: "quiz 3" }).result.results[0];
check(quizHit.title === "Quiz 3" && quizHit.status === "Not open yet" && quizHit.when === "due Sun, Nov 8, 2026, 11:59 PM (in 4 days) · opens Fri, Nov 6, 2026, 8:00 AM (in 2 days)", `a search result for an item carries its status and labeled times, got ${JSON.stringify(quizHit)}`);
check(!/Due 20|November/.test(quizHit.text) && !("when" in search.result.results[0]), "the passage text itself carries no second date style, and a document without a date has no due");
check(dash.askTime("2026-11-13", now) === "Fri, Nov 13, 2026 (in 9 days)" && dash.askTime("", now) === "" && dash.askNow(now).startsWith("Wednesday, November 4, 2026, 9:00 AM"), "a date with no time of day has none, and the clock reads in full");
check(dash.runAskTool(ctx, "upcoming_due", { days: "soon" }).result.days === 7 && dash.runAskTool(ctx, "upcoming_due", { days: 9999 }).result.days === 120, "days defaults to a week and is capped");
check(dash.runAskTool(ctx, "upcoming_due", { days: 1, course: "BIOL 1107" }).result.note, "an empty window says so");
check(dash.runAskTool(ctx, "upcoming_due", { days: 7, course: "PSYC" }).result.error, "a wrong course name is an error for due dates too");
check(dash.runAskTool(ctx, "delete_everything", {}).result.error && dash.runAskTool(ctx, "search_archive", "oops").result.error, "an unknown tool or bad arguments is an error, never a crash");

// ---- the loop ---------------------------------------------------------------------------------
function scripted(turns) {
  const seen = [];
  const asked = [];
  return { seen, asked, chat: async ({ messages, tools, thinking, lookups }) => { seen.push(structuredClone(messages)); asked.push({ tools, thinking, lookups }); const turn = turns.shift(); if (!turn) throw new Error("the script ran out"); return { content: "", toolCalls: [], tokensPerSecond: 40, ...turn }; } };
}
const call = (name, args, id = "t1") => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });

const engine = scripted([{ toolCalls: [call("search_archive", { query: "final exam" })] }, { content: "The final exam is December 12 at 8 AM (CS 1301 Syllabus)." }]);
const steps = [];
const done = await dash.askArchive({ engine, ctx, question: "When is the final exam?", onStep: (step) => steps.push(step.tool) });
check(done.answer.includes("December 12") && done.usedArchive && done.steps.length === 1 && steps[0] === "search_archive", "a question is answered after one lookup");
check(done.sources[0]?.course === "CS 1301" && done.tokensPerSecond === 40, "the answer carries its sources and speed");
const second = engine.seen[1];
check(second.at(-1).role === "tool" && second.at(-1).tool_call_id === "t1" && second.at(-1).content.includes("December 12") && second.at(-2).tool_calls?.[0].function.name === "search_archive", "the model gets its own call and the result back");
check(engine.seen[0][0].role === "system" && engine.seen[0][0].content.includes("It is Wednesday, November 4, 2026, 9:00 AM") && engine.seen[0][0].content.includes("CS 1301, BIOL 1107"), "the model is told today's date and the course names");
check(done.trace.length === 1 && done.trace[0] === done.steps[0] && done.steps[0].kind === "lookup", "each lookup is kept, in order, for the screen");
const order = [];
const twice = scripted([{ toolCalls: [call("upcoming_due", { days: 7 }, "a"), call("search_archive", { query: "final exam" }, "b")] }, { toolCalls: [call("search_archive", { query: "quiz" }, "c")] }, { content: "Done." }]);
await dash.askArchive({ engine: twice, ctx, question: "x", onLookup: (name, round) => order.push(`look ${name} ${round}`), onStep: (step) => order.push(`step ${step.tool}`) });
check(order.join("|") === "look upcoming_due 0|step upcoming_due|look search_archive 0|step search_archive|look search_archive 1|step search_archive", `a lookup is announced, with its round, just before it runs, got ${order.join("|")}`);

const lazy = scripted([{ content: "Not found in your course materials." }, { content: "The final exam is December 12." }]);
const lazyDone = await dash.askArchive({ engine: lazy, ctx, question: "When is the final exam?" });
const lazyStep = lazyDone.steps[0];
check(lazyDone.steps.length === 1 && lazyStep.tool === "search_archive" && lazyStep.args.query === "When is the final exam?" && lazyStep.result.results.length > 0, "when the model answers without looking, the question is looked up for it");
check(lazyDone.answer === "The final exam is December 12." && lazyDone.usedArchive && lazy.seen[1].at(-1).role === "tool" && lazy.seen[1].at(-1).content.includes("December 12"), "the model then answers from what the lookup found, not from its first reply");
for (const shrug of ["I don't have the specific date for the final exam in CS 1301.", "I can’t find that in my materials.", "I have no information about the exam."]) {
  const unsure = scripted([{ content: shrug }, { content: "December 12." }]);
  const unsureDone = await dash.askArchive({ engine: unsure, ctx, question: "When is the final exam?" });
  check(unsureDone.steps[0]?.args.query === "When is the final exam?" && unsureDone.answer === "December 12.", `a first reply that says it doesn't know is looked up: "${shrug}"`);
}
const lookup = (text) => scripted([{ toolCalls: [call("search_archive", { query: "x" })] }, { content: text }]);
const empty = await dash.askArchive({ engine: lookup(""), ctx, question: "when is it?" });
check(/couldn't come up/i.test(empty.answer), "an empty answer becomes a message, not a blank");
const looping = await dash.askArchive({ engine: scripted(Array.from({ length: 10 }, () => ({ toolCalls: [call("search_archive", { query: "x" })] }))), ctx, question: "loop" });
check(looping.steps.length === 2 && /couldn't finish/i.test(looping.answer), "a model that keeps looking up what isn't there must answer after two lookups that find nothing, and an answer with nothing written is a give-up");
const lookups = Array.from({ length: 3 }, (_, i) => ({ toolCalls: [call("search_archive", { query: "final exam" }, `f${i}`)] }));
const finishing = scripted([...lookups, { content: "The final exam is December 12." }]);
const finished = await dash.askArchive({ engine: finishing, ctx, question: "exam?" });
check(finished.answer === "The final exam is December 12." && finished.steps.length === 3 && finished.sources.length > 0, "once two lookups in a row find nothing new, the model answers from what it found, with its sources");
check(finishing.asked.slice(0, 3).every((one) => one.lookups === true) && finishing.asked[3].lookups === false && finishing.asked.every((one) => one.tools.length) && finishing.seen[3].at(-1).content.includes("No lookups are left") && !finishing.seen[2].at(-1).content.includes("No lookups are left"), "the last round can't start a lookup but still has the tools described, and the lookups just before it say so");
const words = ["amber", "basil", "cedar", "dahlia", "ember", "fennel", "garnet", "hazel", "indigo", "juniper", "kestrel", "lilac", "maple"];
const sheets = words.map((word, n) => ({ evidenceId: `ev-${word}`, courseId: "101", source: "contentTopic", title: `Fact sheet ${n}`, description: `The codeword is ${word}.` }));
const wideCtx = { ...ctx, passageIndex: dash.buildPassageIndex({ entities, evidence: [...evidence, ...sheets], courses }) };
const searches = (some) => ({ toolCalls: some.map((word) => call("search_archive", { query: word }, word)) });
const digging = scripted([searches(words.slice(0, 1)), searches(words.slice(1, 4)), searches(words.slice(4, 7)), searches(words.slice(7, 10)), searches(words.slice(10, 13)), { content: "Found them." }]);
const dug = await dash.askArchive({ engine: digging, ctx: wideCtx, question: "codewords?" });
check(dug.steps.length === 12 && dug.steps.at(-1).args.query === "lilac" && digging.seen[5].findLast((message) => message.role === "assistant").tool_calls.length === 2, `lookups that keep finding something go on to 12, the last round's cut to what is left (${dug.steps.length})`);
check(dug.answer === "Found them." && digging.asked.length === 6 && digging.asked[5].lookups === false && digging.seen[5].at(-1).content.includes("No lookups are left"), "after 12 lookups the model must answer");
const crowded = scripted([{ tokens: 8000, toolCalls: [call("search_archive", { query: "final exam" })] }, { content: "December 12." }]);
const crowdedDone = await dash.askArchive({ engine: crowded, ctx, question: "exam?" });
check(crowdedDone.answer === "December 12." && crowded.asked[1].lookups === false && crowded.seen[1].at(-1).content.includes("No lookups are left") && engine.asked[1].lookups === true, "a chat near the model's limit must answer after its lookup, while one with room may look further");
const stubborn = await dash.askArchive({ engine: scripted([...structuredClone(lookups), { content: "December 12.", toolCalls: [call("search_archive", { query: "again" })] }]), ctx, question: "exam?" });
check(stubborn.answer === "December 12." && stubborn.steps.length === 3, "a lookup written in the last round anyway is not run, and what was written is the answer");
const quiet = lookup("ok");
await dash.askArchive({ engine: quiet, ctx, question: "x", thinking: false });
check(quiet.asked.every((one) => one.thinking === false) && engine.asked.every((one) => one.thinking === true), "thinking can be turned off for every round, and is on unless it is");
const spammy = scripted([{ toolCalls: Array.from({ length: 6 }, (_, i) => call("search_archive", { query: "lab" }, `s${i}`)) }, { content: "ok" }]);
check((await dash.askArchive({ engine: spammy, ctx, question: "spam" })).steps.length === 3, "no more than three lookups per round");
const odd = scripted([{ toolCalls: [call("search_archive", "{not json"), call("upcoming_due", { days: 7 }, "t2"), call("nope", {}, "t3")] }, { content: "done" }]);
const oddDone = await dash.askArchive({ engine: odd, ctx, question: "odd" });
check(oddDone.answer === "done" && oddDone.steps[0].result.error && oddDone.steps[1].result.items.length && oddDone.steps[2].result.error, "bad arguments and unknown tools reach the model as errors");
const objectArgs = await dash.askArchive({ engine: scripted([{ toolCalls: [call("search_archive", { query: "calculator" })].map((c) => ({ ...c, function: { ...c.function, arguments: { query: "lab 4" } } })) }, { content: "ok" }]), ctx, question: "obj" });
check(objectArgs.steps[0].result.results.length > 0, "arguments that arrive as an object work as well as JSON text");

// ---- what it remembers of this chat ------------------------------------------------------------------
const shortChat = [{ role: "user", content: "q0" }, { role: "assistant", content: "a0" }, { role: "user", content: "q1" }, { role: "assistant", content: "a1" }];
const recall = lookup("x");
await dash.askArchive({ engine: recall, ctx, history: shortChat, question: "next" });
check(recall.seen[0].length === 1 + 4 + 1 && recall.seen[0][1].content === "q0" && /You can see this whole chat/.test(recall.seen[0][0].content), "a short chat goes along whole, and the model is told it sees all of it");
const longChat = Array.from({ length: 40 }, (_, n) => ({ role: n % 2 ? "assistant" : "user", content: `${n} ${"x".repeat(600)}` }));
const budget = lookup("x");
await dash.askArchive({ engine: budget, ctx, history: longChat, question: "next" });
const inView = budget.seen[0].slice(1, -1);
check(inView.length > 6 && inView.length < longChat.length && inView[0].role === "user" && inView.at(-1).content === longChat.at(-1).content, `a long chat goes along from its newest messages back, starting at a question (${inView.length} of 40)`);
check(inView.reduce((sum, message) => sum + message.content.length, 0) <= dash.ASK_HISTORY_CHARS, "what goes along stays within the budget");
check(budget.seen[0][0].content.includes(`This chat has 40 earlier messages; you can see the latest ${inView.length}. The rest, and earlier chats, are saved: search_past_messages and chat_log find them.`), "the model is told how much of the chat it can see, and how to look further back");
check(/start of a new chat/.test(engine.seen[0][0].content), "a first question is the start of a new chat");

// ---- greetings, and answers that found nothing ------------------------------------------------
const hello = scripted([{ content: "Hi! I'm Ask. What would you like to know about your courses?" }]);
const hi = await dash.askArchive({ engine: hello, ctx, question: "Hi" });
check(hi.answer.startsWith("Hi!") && !hi.steps.length && !hi.sources.length && !hi.usedArchive && hello.seen.length === 1, "a greeting is answered by the model itself, with no lookup");
const told = hello.seen[0][0].content;
check(/^You are LFM3-1\.7B, a small language model made by Liquid AI/.test(told) && /on this computer/.test(told) && /no internet/.test(told) && !/You are Ask/.test(told), "the model is told its own name and where it runs");
check(/This is the start of a new chat\. Earlier chats are saved: search_past_messages and chat_log find them\./.test(told) && /Don't guess where else to look/.test(told), "the model is told earlier messages are saved, and not to guess where else to look");
check(/Greetings, thanks, and questions about you: answer briefly, without tools/.test(told) && /Course questions: look it up first/.test(told) && /Not found in your course materials/.test(told), "greetings need no lookup, but course questions are looked up first");
check(/Give the answer first, without describing your search\. Give each time with the word the lookup puts before it: due, opens or at\./.test(told) && told.split("\n").length === 9 && told.length < 1200, `the prompt is short: answer first, every time labeled (${told.length} characters)`);
check(/For upcoming_due, set days from the time asked: today 1, tomorrow 2, this week 7, 2 weeks 14, a month 30, 2 months 60, 3 months 90\./.test(told), "the model is told how to turn a time phrase into days");
check(!("askSmallTalk" in dash) && !/SMALL_TALK|smallTalk/.test(fs.readFileSync(path.join(root, "src/dashboard/ask-agent.js"), "utf8")), "there are no canned replies");
const blank = scripted([{ content: "  " }, { content: "The final exam is December 12." }]);
const blankDone = await dash.askArchive({ engine: blank, ctx, question: "When is the final exam?" });
check(blankDone.steps[0]?.args.query === "When is the final exam?" && blankDone.answer.includes("December 12"), "a blank first reply is looked up too");
const gaveUp = scripted([{ content: "Not found in your course materials.", raw: "<think>x</think>Not found in your course materials." }, { content: "ok" }]);
await dash.askArchive({ engine: gaveUp, ctx, question: "When is the final exam?" });
check(!("raw" in gaveUp.seen[1][1 + 1]), "a lookup made for the model is not passed off as its own words");

const rawTurn = scripted([{ raw: "<think>x</think>call", toolCalls: [call("search_archive", { query: "lab" })] }, { content: "ok" }]);
await dash.askArchive({ engine: rawTurn, ctx, question: "lab?" });
const cutTurn = scripted([{ raw: "R", toolCalls: Array.from({ length: 6 }, (_, i) => call("search_archive", { query: "lab" }, `c${i}`)) }, { content: "ok" }]);
await dash.askArchive({ engine: cutTurn, ctx, question: "lab?" });
check(rawTurn.seen[1][2].raw === "<think>x</think>call" && !("raw" in cutTurn.seen[1][2]), "a lookup round goes back word for word, unless some of its calls were cut");

const traced = scripted([{ thinking: "Need the syllabus.", thinkMs: 1500, toolCalls: [call("search_archive", { query: "final exam" })] }, { thinking: "It says Dec 12.", thinkMs: 500, content: "December 12." }]);
const updates = [];
const tracedDone = await dash.askArchive({ engine: traced, ctx, question: "exam?", onUpdate: (live) => updates.push(live.trace.length) });
check(tracedDone.trace.map((entry) => entry.kind).join() === "thinking,lookup,thinking" && tracedDone.trace[0].text === "Need the syllabus." && tracedDone.trace[1].tool === "search_archive", "its thinking and lookups are kept in order");
check(updates.includes(2) && tracedDone.thinkingSeconds === 2 && tracedDone.firstWordSeconds >= 0, "the screen hears each lookup, and thinking time adds up across rounds");
const pastCtx = { ...ctx, pastChats: dash.buildChatIndex([{ id: "c1", title: "Exam", startedAt: now.toISOString(), messages: [{ role: "user", text: "When is the exam?" }, { role: "assistant", text: "December 12." }] }]) };
const remembered = await dash.askArchive({ engine: scripted([{ toolCalls: [call("search_past_messages", { query: "exam" }), call("chat_log", {}, "t2")] }, { content: "You asked when the exam is." }]), ctx: { ...pastCtx, pastChats: { ...pastCtx.pastChats, currentId: "c1" } }, question: "What did I ask before?" });
check(remembered.steps[0].result.results[0]?.asked === "When is the exam?" && remembered.steps[1].result.messages[0].text === "When is the exam?" && !remembered.usedArchive && !remembered.sources.length, "looking through past messages is not counted as checking the archive");
const rereads = await dash.askArchive({ engine: scripted([{ toolCalls: [call("chat_log", {})] }, { toolCalls: [call("chat_log", {}, "t2")] }, { toolCalls: [call("chat_log", { chat: "Exam" }, "t3")] }, { content: "ok" }]), ctx: { ...pastCtx, pastChats: { ...pastCtx.pastChats, currentId: "c1" } }, question: "What did I ask first?" });
check(rereads.steps.length === 3 && rereads.answer === "ok", "a chat log that shows messages counts as finding something; the same messages again do not");

const nothing = await dash.askArchive({ engine: scripted([{ toolCalls: [call("search_archive", { query: "final exam" })] }, { content: "Not found in your course materials." }]), ctx, question: "What is the airspeed of a swallow?" });
check(nothing.answer === "Not found in your course materials." && nothing.usedArchive && nothing.steps.length === 1 && nothing.sources.length === 0, "a not-found answer names no sources, but still shows that the archive was searched");
check((await dash.askArchive({ engine: scripted([{ toolCalls: [call("search_archive", { query: "final exam" })] }, { content: "  not found in your course materials" }]), ctx, question: "x?" })).sources.length === 0, "a not-found answer is recognised however it is capitalised or spaced");
check((await dash.askArchive({ engine: lookup(""), ctx, question: "x?" })).sources.length === 0, "an empty answer names no sources");
check((await dash.askArchive({ engine: scripted(Array.from({ length: 10 }, () => ({ toolCalls: [call("search_archive", { query: "final exam" })] }))), ctx, question: "loop" })).sources.length === 0, "a lookup that never finished names no sources");
check(done.sources.length > 0, "a real answer still names its sources");

// ---- the screen -------------------------------------------------------------------------------------
const base = { engineState: "ready", reason: "", progress: 0, messages: [], busy: false, status: "", reading: { state: "ready", passages: 12, courses: 2 } };
const lockedInput = /<textarea id="ask-input"[^>]*disabled/;
const empty1 = dash.askPage(base);
check(empty1.includes("data-ask-chip") && !empty1.includes("ask-setup\"") && !lockedInput.test(empty1), "a ready, empty chat shows suggestions and an open input");
const missingPage = dash.askPage({ ...base, engineState: "missing", reason: "Missing model files: tokenizer.json." });
check(missingPage.includes("id=\"ask-setup\"") && missingPage.includes("node tools/get-ask-model.mjs") && missingPage.includes("data-ask-recheck") && missingPage.includes("Missing model files") && lockedInput.test(missingPage), "missing model files show how to get them and lock the input");
check(!/llama|127\.0\.0\.1|data-ask-connect|ask-address/.test(missingPage), "nothing about an outside server is left on the screen");
const noGpuPage = dash.askPage({ ...base, engineState: "no-gpu", reason: "This browser can't use the graphics card (WebGPU) for the model." });
check(noGpuPage.includes("run in this browser") && noGpuPage.includes("WebGPU") && lockedInput.test(noGpuPage), "no graphics card is explained and locks the input");
const loadingPage = dash.askPage({ ...base, engineState: "loading", progress: 0.42 });
check(loadingPage.includes("Loading the model… 42%") && loadingPage.includes('<progress class="ask-progress" max="100" value="42"') && !lockedInput.test(loadingPage), "a start with no question waiting (Try again) shows its progress, and a question can still be sent to wait for it");
const waitingPage = dash.askPage({ ...base, engineState: "loading", progress: 0.42, waiting: "What is due?" });
check(!waitingPage.includes('id="ask-setup"') && waitingPage.includes('class="ask-msg ask-you"><div class="ask-bubble">What is due?') && waitingPage.includes("Starting Ask… 42%") && waitingPage.includes('aria-label="Starting Ask"') && !waitingPage.includes("What would you like to know?") && !waitingPage.includes("data-ask-chip") && lockedInput.test(waitingPage), "a question sent before Start waits in the chat with the progress under it, and the box waits too");
check(dash.askPage({ ...base, engineState: "error", reason: "no memory left" }).includes("Try again"), "a failed start offers a retry");
const checkingPage = dash.askPage({ ...base, engineState: "checking" });
check(!checkingPage.includes('id="ask-setup"') && lockedInput.test(checkingPage), "looking for the model shows no card, and the box waits for the answer");
const idlePage = dash.askPage({ ...base, engineState: "idle" });
check(!idlePage.includes('id="ask-setup"') && !idlePage.includes("ready to start") && !idlePage.includes("data-ask-start") && !lockedInput.test(idlePage) && idlePage.includes("data-ask-chip") && idlePage.includes('data-state="idle"') && idlePage.includes('<div id="ask-start-slot"></div>'), "before Start the screen stays quiet: no start card, an open box and suggestions, and a place for the Start pop-up");
check(idlePage.includes("Answers come only from what you've saved: 12 passages across 2 courses.") && !idlePage.includes("Ready to search"), "how much of the archive Ask searches is told in the greeting, not in a line of its own");
check(!dash.askPage({ ...base, engineState: "missing" }).includes("data-ask-chip") && !dash.askPage({ ...base, engineState: "no-gpu" }).includes("data-ask-chip") && !dash.askPage({ ...base, engineState: "missing" }).includes("data-ask-start"), "suggestions and Start are offered only when the model can run");
check(dash.askPage({ ...base, engineState: "error", reason: "x" }).includes("data-ask-start"), "a failed start offers Try again as a Start");
check(lockedInput.test(dash.askPage({ ...base, reading: { state: "reading", done: 500, total: 1500 } })) && dash.askPage({ ...base, reading: { state: "reading", done: 500, total: 1500 } }).includes("500 of 1500"), "while the archive is being read the input waits and progress shows");
check(dash.askPage({ ...base, busy: true, status: "Thinking…" }).includes("Thinking…"), "a pending answer shows what is happening");
check(/<textarea id="ask-input" rows="2"/.test(empty1) && !/<input[^>]*ask-input/.test(empty1), "the question box is a multi-line message box");
check(/id="ask-send"[^>]*disabled/.test(empty1) && empty1.includes('aria-label="Send"'), "Send starts off, because there is nothing to send yet");
check(empty1.includes('id="ask-model" data-state="ready"') && empty1.includes("LFM3-1.7B") && dash.askPage({ ...base, engineState: "no-gpu" }).includes('data-state="no-gpu"'), "the model pill names the model and follows its state");
check(!/data-ask-thinking|Think first/.test(empty1), "there is no switch to turn thinking off: without it the model made up answers");
check(empty1.includes("What would you like to know?") && empty1.includes('class="ask-composer"'), "an empty chat greets you above the message box");
const controller = fs.readFileSync(path.join(root, "src/dashboard/app-ask.js"), "utf8");
check(/event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing/.test(controller) && controller.includes("requestSubmit"), "Enter sends, Shift+Enter adds a line, and a composing input method is left alone");
check(!/thinking:|THINKING_KEY/.test(controller), "every question is asked with thinking on");
check(controller.includes("BOX_MAX") && /\$\("#ask-send"\)\.disabled = isLocked\(\) \|\| !input\.value\.trim\(\)/.test(controller), "the box grows to a limit and Send waits for text");

const evil = "<img src=x onerror=alert(1)>";
const chat = dash.askThreadHtml({ ...base, messages: [
  { role: "user", text: evil },
  { role: "assistant", text: `**Bold** and ${evil}\n- item`, usedArchive: true, seconds: 3.42, sources: [{ title: evil, course: "CS 1301", route: "#/assignment/a1\" onmouseover=\"x" }, { title: "Syllabus", course: "CS 1301", route: "" }], steps: [{ tool: "search_archive", args: { query: evil, course: "CS 1301" }, result: { results: [1] } }] },
  { role: "assistant", text: "Hello", usedArchive: false },
  { role: "user", text: "Follow-up" },
  { role: "assistant", text: "Follow-up answer", usedArchive: true }
] });
check(!chat.includes("<img") && chat.includes("&lt;img") && !chat.includes('" onmouseover="'), "nothing the user, the model or the archive wrote can become markup");
check(chat.includes("<strong>Bold</strong>") && chat.includes("<li>item</li>") && chat.includes('class="ask-bubble ask-answer"'), "an answer is shown as Markdown: bold and bullets");
check(dash.askThreadHtml({ ...base, messages: [{ role: "user", text: "**not bold**" }] }).includes("**not bold**"), "your own words are shown as you typed them, not as Markdown");
check(!chat.includes("Not checked against your archive") && !chat.includes('class="ask-timing"') && chat.includes("How I found this"), "answers omit the archive warning and elapsed time while keeping lookup details");
const thought = dash.askThreadHtml({ ...base, messages: [{ role: "assistant", text: "Dec 12.", usedArchive: true, thinkingSeconds: 2, trace: [{ kind: "thinking", text: evil }, { kind: "lookup", tool: "search_archive", args: { query: "exam" }, result: { results: [1] } }] }] });
check(thought.includes("Thought · 2.0 s · 1 lookup") && thought.includes('class="ask-thought">&lt;img') && thought.includes("Searched for “exam” → 1 match") && !/<details class="ask-trace"[^>]* open/.test(thought), "a saved answer keeps its thinking and lookups folded above it");
const writing = dash.askThreadHtml({ ...base, busy: true, status: "Thinking…", live: { trace: [{ kind: "thinking", text: "Hmm" }], answer: "The final" } });
check(writing.includes('id="ask-live"') && /<details class="ask-trace" data-ask-live-trace open>/.test(writing) && writing.includes("Thinking") && writing.includes("The final") && !writing.includes("Thinking…"), "the answer being written shows its thinking unfolded, then the words so far");
check(!/data-ask-live-trace open/.test(dash.askThreadHtml({ ...base, busy: true, traceOpen: false, live: { trace: [{ kind: "thinking", text: "Hmm" }], answer: "" } })) && dash.askThreadHtml({ ...base, busy: true, status: "Thinking…" }).includes("Thinking…"), "folded thinking stays folded, and before any words the status shows");
check(!chat.includes("ask-sources") && !chat.includes("ask-source") && !chat.includes("Syllabus"), "sources aren't rendered as From pills under answers");
check((chat.match(/data-ask-copy-message=/g) || []).length === 5 && chat.includes('data-ask-edit="0"') && chat.includes('data-ask-rewind="0"'), "messages can be copied, and earlier user turns can be edited or rewound");
check(chat.includes('data-ask-retry="1"') && chat.includes('data-ask-rate="1"') && !chat.includes("data-ask-speak"), "answers keep retry and rating actions while speech is archived");
const rated = dash.askThreadHtml({ ...base, messages: [{ role: "user", text: "Hi" }, { role: "assistant", text: "Hello", rating: "up" }] });
check(!rated.includes("data-ask-speak") && rated.includes('aria-pressed="true"'), "saved ratings remain marked and no speech control is rendered");
check(!/>Copy<|>Edit<|>Rewind</.test(chat), "message actions use icons with accessible labels");
const editingPage = dash.askPage({ ...base, messages: [{ role: "user", text: "Old question" }], editingIndex: 0 });
check(editingPage.includes('id="ask-edit-form"') && editingPage.includes('id="ask-edit-input"') && editingPage.includes("data-ask-edit-cancel"), "editing opens an inline form that can be canceled");
const waitingEdit = dash.askThreadHtml({ ...base, messages: [{ role: "user", text: "Old question" }], editingIndex: 0, editDraft: "Revised", waiting: "Revised" });
check(waitingEdit.includes('id="ask-edit-input" aria-label="Edit message" rows="3" required disabled') && !waitingEdit.includes('class="ask-bubble">Revised'), "an edit waiting for the model cannot be canceled or shown twice");
const turns = [{ role: "user", text: "First" }, { role: "assistant", text: "Answer" }, { role: "user", text: "Second" }, { role: "assistant", text: "Answer 2" }];
check(dash.askMessagesThroughTurn(turns, 0).length === 2 && dash.askMessagesBeforeTurn(turns, 2).length === 2, "rewind keeps the chosen exchange, while editing starts from the turns before it");
check(dash.askStepLabel({ tool: "upcoming_due", args: { days: 7 }, result: { items: [1, 2] } }) === "Looked at what is due in 7 days → 2 matches", "a lookup is described in plain words");
check(dash.askStepLabel({ tool: "search_past_messages", args: { query: "exam" }, result: { results: [1] } }) === "Searched past messages for “exam” → 1 match" && dash.askStepLabel({ tool: "search_past_chats", args: { query: "exam" }, result: { results: [] } }) === "Searched past chats for “exam” → 0 matches", "past-message lookups read in plain words, under the old name too");
check(dash.askStepLabel({ tool: "chat_log", args: {}, result: { messages: [1, 2, 3] } }) === "Read this chat from the start → 3 messages" && dash.askStepLabel({ tool: "chat_log", args: { chat: "Lab 4" }, result: { error: "No saved chat" } }) === "Read the chat “Lab 4” → No saved chat", "reading a chat log reads in plain words");

// ---- nothing leaves this computer ---------------------------------------------------------------------
const read = (file) => fs.readFileSync(path.join(root, "src/dashboard", file), "utf8").replace(/^\s*\/\/.*$/gm, "");
const askFiles = ["ask/time-labels.js", "ask/chat-log-tool.js", "ask/item-details-tool.js", "ask/file-text-store.js", "ask/answer-markdown.js", "ask/start-prompt.js", "ask-prompt.js", "ask-generate.js", "ask-engine.js", "ask-lifecycle.js", "ask-tools.js", "ask-saved-chats.js", "ask-agent.js", "render-ask.js", "app-ask-chats.js", "app-ask-archive.js", "app-ask.js"];
const talks = /\bfetch\s*\(|\bfetchImpl\b|XMLHttpRequest|WebSocket|sendBeacon|EventSource|\bimport\s*\(|importScripts/;
// The answer setup loads only the two bundled Markdown libraries, from inside the extension.
const markdownImports = ["import(url(LIBRARIES.markdownIt))", "import(url(LIBRARIES.remend))"];
const withoutMarkdownImports = (file, text) => file === "ask/answer-markdown.js" ? markdownImports.reduce((rest, use) => rest.replace(use, ""), text) : text;
check(askFiles.every((file) => !talks.test(withoutMarkdownImports(file, read(file)))), "no Ask file but the model runtime can fetch or load anything");
const answerSetup = read("ask/answer-markdown.js");
check(markdownImports.every((use) => answerSetup.includes(use)) && /const url = \(file\) => global\.chrome\.runtime\.getURL\(file\);/.test(answerSetup) && /const LIBRARIES = \{ markdownIt: "src\/vendor\/markdown-it\/markdown-it\.umd\.min\.js", remend: "src\/vendor\/remend\/index\.js" \};/.test(answerSetup), "the answer setup loads only the bundled markdown-it and remend, from inside the extension");
// Course files come through the file viewer's own loader; the reader itself loads only the bundled pdf.js.
const fileReader = read("ask/file-text-reader.js");
const pdfImports = fileReader.match(/\bimport\s*\(([^)]*\))\)/g) || [];
check(pdfImports.length === 1 && pdfImports[0] === "import(chrome.runtime.getURL(`${PDFJS}/pdf.min.mjs`))" && /const PDFJS = "src\/vendor\/pdfjs";/.test(fileReader), "the file reader loads only the bundled pdf.js, from inside the extension");
check(!talks.test(fileReader.replace(pdfImports[0] || "", "")) && !/https?:/.test(fileReader) && /appModules\.fileFromD2l\(file\.url, \{ keep: false \}\)/.test(fileReader), "the file reader gets files the way the file viewer does, and talks to nothing else");
check(/isEvalSupported: false/.test(fileReader), "pdf.js is told not to run code from a PDF");
const runtimeText = read("ask-runtime.js");
check(/allowRemoteModels:\s*false/.test(runtimeText) && /useBrowserCache:\s*false/.test(runtimeText), "the model loader is told never to download from the internet");
check([...askFiles, "ask-runtime.js"].every((file) => !/https?:/.test(read(file))), "no web address appears anywhere in the Ask code");
check([...runtimeText.matchAll(/inExtension\(([^)]*)\)/g)].every((use) => /LIBRARY_PATH|LIBRARY_FOLDER|MODEL_FOLDER/.test(use[1])), "the runtime only asks for files inside the extension");
// The thinking panel scrolls on its own: the live redraw keeps that panel (and its scroll place) and never swaps the whole live box.
const paintLive = controller.slice(controller.indexOf("function paintLive()"), controller.indexOf("// ---- the archive, as passages"));
check(/patchLive\(box, dash\.askLiveHtml\(model\(\)\)\)/.test(paintLive) && !/outerHTML|replaceWith/.test(paintLive) && /body\.innerHTML = fresh\.innerHTML;\s+body\.scrollTop = atEnd \? body\.scrollHeight : top;/.test(controller), "redrawing the live answer keeps the thinking panel and its scroll place");
const startPrompt = read("ask/start-prompt.js");
check((controller.match(/life\.start\(/g) || []).length === 1 && /target\.hasAttribute\("data-ask-start"\)\) await life\.start\(\);/.test(controller) && /if \(life\.state !== "ready"\) return starter\.request\(question\);/.test(controller), "in the controller only Try again starts the model; a question sent before that asks first");
check((startPrompt.match(/life\.start\(/g) || []).length === 1 && /async function begin\(question\) \{[^}]*await life\.start\(\)/.test(startPrompt) && (startPrompt.match(/begin\(question\)/g) || []).length === 4, "the pop-up starts the model only from Start and send, the saved Don't ask again, or a start already under way");
const vendored = ["src/vendor/markdown-it/markdown-it.umd.min.js", "src/vendor/remend/index.js"].map((file) => fs.readFileSync(path.join(root, file), "utf8"));
check(vendored.every((text) => !/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|\bimport\s*\(|importScripts/.test(text)), "the Markdown libraries can't fetch or load anything");
check(/route\.name !== "ask"\) dash\.askScreen\.left\(\)/.test(fs.readFileSync(path.join(root, "src/dashboard/app-render.js"), "utf8")), "leaving the Ask page frees the model");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
check(!manifest.optional_host_permissions, "Ask asks for no extra permission, since it talks to nothing");
check(!manifest.host_permissions.some((pattern) => /127\.0\.0\.1|localhost/.test(pattern)), "no permission to reach this computer's own servers");
check(!manifest.content_security_policy || /wasm-unsafe-eval/.test(JSON.stringify(manifest.content_security_policy)), "the page may still run the model's WebAssembly");

if (failures.length) {
  console.error(failures.map((message) => `FAIL: ${message}`).join("\n"));
  process.exit(1);
}
console.log("Ask tests passed.");
