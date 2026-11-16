import { loadDashboard } from "./test-dashboard-loader.mjs";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();

// ---- a small archive, and a clock that never moves ---------------------------------
const now = new Date(2026, 10, 4, 9, 0);
const inDays = (days, hour = 23) => new Date(2026, 10, 4 + days, hour, 59).toISOString();
const api = { provenance: { pageType: "valenceApi" } };
const lab4 = { entityId: "assignment:101:1", entityType: "assignmentBundle", courseId: "101", canonicalTitle: "Lab 4", category: "Labs", pointsPossible: 20, rubricCount: 1, gradeEntityId: "grade:101:1",
  attachments: [{ name: "lab4-starter.zip", size: 20480 }], dates: { dueAt: inDays(2) }, summary: "<p>Build a sorting visualizer.</p><p>Turn in one zip.</p>", urls: { d2l: "https://d2l.example/lab4" } };
const entities = [
  { entityId: "assignment:101:7", entityType: "assignmentBundle", courseId: "101", canonicalTitle: "Lab" },
  { entityId: "grade:101:1", entityType: "gradeRecord", courseId: "101", canonicalTitle: "Lab 4", sourceEntityId: "assignment:101:1" },
  lab4,
  { entityId: "assignment:101:12", entityType: "assignmentBundle", courseId: "101", canonicalTitle: "Quiz 3 Review", dates: { dueAt: inDays(3) } },
  { entityId: "quiz:101:9", entityType: "quizBundle", courseId: "101", canonicalTitle: "Quiz 3", timeLimitMinutes: 30, attempts: { allowed: 2, completed: 0, source: "api" },
    description: "Covers chapters 4 and 5.", dates: { dueAt: inDays(4), availableFrom: new Date(2026, 10, 6, 8, 0).toISOString() } },
  { entityId: "quiz:101:30", entityType: "quizBundle", courseId: "101", canonicalTitle: "Quiz 30", attempts: { allowed: 3, completed: 1, source: "api" }, dates: { dueAt: inDays(40) } },
  { entityId: "quiz:202:40", entityType: "quizBundle", courseId: "202", canonicalTitle: "Quiz 40", dates: { dueAt: inDays(40) } },
  { entityId: "quiz:202:3", entityType: "quizBundle", courseId: "202", canonicalTitle: "Quiz 3", timeLimitMinutes: 15, attempts: { unlimited: true, source: "api" }, description: "Cells.", dates: { dueAt: inDays(6) } },
  { entityId: "quiz:101:4", entityType: "quizBundle", courseId: "101", canonicalTitle: "Quiz 4", dates: { dueAt: inDays(11) } },
  { entityId: "discussion:101:2", entityType: "discussionThread", courseId: "101", canonicalTitle: "Introduce Yourself", forumTitle: "Week 1", prompt: "Say hello and name your major.", dates: { dueAt: inDays(1) } },
  { entityId: "announcement:101:5", entityType: "announcement", courseId: "101", canonicalTitle: "Midterm moved", body: "<p>The midterm is now on Nov 12.</p>", dates: { publishedAt: new Date(2026, 10, 2, 14, 30).toISOString() } },
  { entityId: "event:101:6", entityType: "calendarEvent", courseId: "101", canonicalTitle: "Midterm Exam", dates: { startAt: new Date(2026, 10, 12, 10, 0).toISOString() } },
  { entityId: "resource:101:8", entityType: "learningResource", courseId: "101", canonicalTitle: "Syllabus", resourceType: "File", moduleTitle: "Start Here", description: "Course policies." },
  { entityId: "resource:101:0", entityType: "learningResource", courseId: "101", canonicalTitle: "Start Here", isModule: true },
  { entityId: "assignment:303:1", entityType: "assignmentBundle", courseId: "303", canonicalTitle: "Hidden Course Essay", dates: { dueAt: inDays(1) } }
];
const courses = [{ courseId: "101", label: "CS 1301" }, { courseId: "202", label: "BIOL 1107" }];
const passageIndex = dash.buildPassageIndex({ entities, courses });
const index = dash.buildIndex({ now, courses: [{ courseId: "101", code: "CS1301", title: "Intro to Computing" }, { courseId: "202", code: "BIOL1107", title: "Biology" }], entities, settings: {} });
const bundles = {
  "assignment:101:1": { evidence: [
    { ...api, source: "assignmentSubmission", dates: { submittedAt: new Date(2026, 10, 3, 20, 15).toISOString() }, fields: { columns: { fileCount: 1 } } },
    { ...api, source: "assignmentFeedback", description: "Nice work on the bars.", fields: { columns: { score: 18, outOf: 20 } } }
  ] }
};
const ctx = { passageIndex, index, checklistDone: {}, hiddenWork: {}, now, bundleFor: async (id) => bundles[id] || null };
const details = (args, over = {}) => dash.runAskTool({ ...ctx, ...over }, "item_details", args);

// ---- one item, in full ----------------------------------------------------------------------
const lab = await details({ title: "Lab 4" });
const labItem = lab.result.item;
check(labItem.course === "CS 1301" && labItem.kind === "Assignment" && labItem.title === "Lab 4" && labItem.status === "Open" && labItem.when === "due Fri, Nov 6, 2026, 11:59 PM (in 2 days)", `an assignment gives its course, kind, status and due time, got ${JSON.stringify(labItem)}`);
check(labItem.points === "20 points" && labItem.category === "Labs" && labItem.instructions === "Build a sorting visualizer. Turn in one zip." && labItem.files.join() === "lab4-starter.zip (20 KB)" && /1 rubric/.test(labItem.rubric) && labItem.link === "https://d2l.example/lab4", `and its points, instructions as plain text, files, rubric and link, got ${JSON.stringify(labItem)}`);
check(labItem.turned_in === "Tue, Nov 3, 2026, 8:15 PM (yesterday)" && labItem.feedback === "Nice work on the bars." && !("not_saved" in labItem), "with the item's saved records it says when it was turned in and the feedback");
check(!lab.result.others && !lab.result.note && lab.sources[0]?.route === dash.routeFor(lab4) && lab.sources[0].course === "CS 1301", "the work comes before its grade row, which is not listed as another match, and the item is a source");
const bare = (await details({ title: "Lab 4" }, { bundleFor: async () => { throw new Error("gone"); } })).result.item;
check(bare.instructions && !("turned_in" in bare), "without its saved records it still gives what the archive index holds");

const quiz = await details({ title: "quiz 3" });
const quizItem = quiz.result.item;
check(quizItem.course === "CS 1301" && quizItem.status === "Not open yet" && quizItem.when === "due Sun, Nov 8, 2026, 11:59 PM (in 4 days) · opens Fri, Nov 6, 2026, 8:00 AM (in 2 days)", `a quiz gives when it opens and when it is due, got ${JSON.stringify(quizItem)}`);
check(quizItem.time_limit === "30 minutes" && quizItem.attempts === "2 attempts allowed" && quizItem.instructions === "Covers chapters 4 and 5.", `and its time limit, attempts and instructions, got ${JSON.stringify(quizItem)}`);
check(quiz.result.others?.join() === "Quiz 3 (Quiz, BIOL 1107)", `an item of the same name in another course is named, and Quiz 30 and Quiz 3 Review are not, got ${quiz.result.others}`);
check((await details({ title: "Quiz 30" })).result.item.attempts === "3 attempts allowed, 1 used", "attempts already used are counted");
const bio = (await details({ title: "Quiz 3", course: "biol 1107" })).result;
check(bio.item.course === "BIOL 1107" && bio.item.attempts === "Unlimited" && bio.item.time_limit === "15 minutes" && !bio.others, "a course name picks that course's item");
check((await details({ title: "Quiz 4" })).result.item.not_saved === "The archive has no saved time limit, number of attempts or instructions for it.", "what isn't saved is said, not guessed");

const talk = (await details({ title: "introduce yourself" })).result.item;
check(talk.kind === "Discussion" && talk.forum === "Week 1" && talk.instructions === "Say hello and name your major." && talk.steps.join(" | ") === "Start your own thread: to do | Reply to a classmate's thread: to do", `a discussion gives its prompt and its steps, got ${JSON.stringify(talk)}`);
const news = (await details({ title: "Midterm moved" })).result.item;
check(news.kind === "Announcement" && news.posted === "Mon, Nov 2, 2026, 2:30 PM (2 days ago)" && news.text === "The midterm is now on Nov 12." && !("status" in news) && /\/d2l\/le\/news\/101\/5\/view/.test(news.link), `an announcement gives when it was posted and its text, got ${JSON.stringify(news)}`);
const exam = (await details({ title: "midterm exam" })).result.item;
check(exam.kind === "Calendar event" && exam.when === "at Thu, Nov 12, 2026, 10:00 AM (in 8 days)", `a calendar event gives when it is, got ${JSON.stringify(exam)}`);
const file = await details({ title: "Syllabus" });
check(file.result.item.kind === "Course content" && file.result.item.type === "File" && file.result.item.module === "Start Here" && file.result.item.description === "Course policies." && file.sources[0].route.startsWith("#/resources/101"), `a course file gives its type and module, got ${JSON.stringify(file.result.item)}`);
check((await details({ title: "Start Here" })).result.item?.title !== "Start Here", "a module is not an item");

// ---- finding the item -----------------------------------------------------------------------
const guess = (await details({ title: "sorting visualizer" })).result;
check(guess.item?.title === "Lab 4" && /closest match/.test(guess.note), "a name that matches nothing falls back to the archive search, and says so");
const wordy = (await details({ title: "Lab 4 instructions" })).result;
check(wordy.item.title === "Lab 4" && !wordy.note, "a name with extra words finds the longest item name inside it");
const near = (await details({ title: "Quiz 4", course: "BIOL" })).result;
check(near.item.title === "Quiz 40" && /closest match/.test(near.note), "Quiz 40 is not called Quiz 4: it comes back only as the closest match");
check(/Nothing saved is called "Quantum"/.test((await details({ title: "Quantum" })).result.error), "nothing found is an error the model can read");
check(/CS 1301, BIOL 1107/.test((await details({ title: "Lab 4", course: "PSYC" })).result.error), "a wrong course name lists the courses");
check((await details({ title: "  " })).result.error && (await details({ title: "Hidden Course Essay" })).result.error, "an empty name is an error, and courses not on the dashboard are left out");
const long = (await details({ title: "Lab 4" }, { index: dash.buildIndex({ now, courses: [{ courseId: "101", code: "CS1301" }], entities: [{ ...lab4, summary: "word ".repeat(1000) }], settings: {} }) })).result.item;
check(long.instructions.length === 1500 && long.instructions.endsWith("…"), "long instructions are cut to 1,500 characters");

// ---- in the loop ---------------------------------------------------------------------------
const call = (name, args, id = "t1") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const turns = [{ toolCalls: [call("item_details", { title: "Lab 4" })] }, { content: "Lab 4 is due Fri, Nov 6." }];
const engine = { chat: async () => ({ content: "", toolCalls: [], ...turns.shift() }) };
const asked = await dash.askArchive({ engine, ctx, question: "What are the Lab 4 instructions?" });
check(asked.usedArchive && asked.sources[0]?.title === "Lab 4" && asked.steps[0].result.item.instructions, "item_details counts as checking the archive and its item is a source");
turns.push({ toolCalls: [call("item_details", { title: "Lab 4" })] }, { toolCalls: [call("item_details", { title: "Lab 4" })] }, { toolCalls: [call("item_details", { title: "Quiz 3" })] }, { content: "done" });
const again = await dash.askArchive({ engine, ctx, question: "Lab 4 and Quiz 3?" });
check(again.steps.length === 3 && again.answer === "done", "an item looked up again finds nothing new; a different item does");
check(dash.askStepLabel(asked.steps[0]) === "Looked up “Lab 4” → Assignment in CS 1301" && dash.askStepLabel({ tool: "item_details", args: { title: "X", course: "CS 1301" }, result: { error: "Nothing saved" } }) === "Looked up “X” in CS 1301 → Nothing saved", "the lookup reads in plain words");
check(dash.ASK_TOOLS.some((tool) => tool.function.name === "item_details" && tool.function.parameters.required.join() === "title"), "the model is offered item_details");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Ask item details tests passed.");
