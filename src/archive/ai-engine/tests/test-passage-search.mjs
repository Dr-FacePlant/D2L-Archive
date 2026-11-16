import { loadDashboard } from "./test-dashboard-loader.mjs";

// Due dates are read on the student's own clock; these tests use KSU's.
process.env.TZ = "America/New_York";
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();

// ---- an archive in the shape the dashboard holds ------------------------------
const filler = (topic, n) => Array.from({ length: n }, (_, i) => `${topic} note ${i + 1} explains routine classroom expectations for everyone.`).join(" ");
const syllabus = [
  "Welcome to the course.", filler("Intro", 12),
  "Office hours are Tuesdays 2-4 PM in room 210.", filler("Middle", 14),
  "Late work loses 10% per day.", filler("Policy", 14),
  "The final exam is on December 12 at 8 AM in the main hall."
].join(" ");

const courses = [{ courseId: "101", label: "CS 1301" }, { courseId: "202", label: "BIOL 1107" }];
const entities = [
  { entityId: "assignment:101:1", entityType: "assignmentBundle", courseId: "101", canonicalTitle: "Lab 4", status: "open", dates: { dueAt: "2026-11-06T04:59:00.000Z" }, summary: "Build a sorting visualizer." },
  { entityId: "quiz:101:9", entityType: "quizBundle", courseId: "101", canonicalTitle: "Quiz 3", dates: { dueAt: "2026-11-08T04:59:00.000Z" } },
  { entityId: "assignment:202:5", entityType: "assignmentBundle", courseId: "202", canonicalTitle: "Lab 4 Reflection on Cell Staining", dates: { dueAt: "2026-11-20T04:59:00.000Z" } },
  { entityId: "grade:101:2", entityType: "gradeRecord", courseId: "101", canonicalTitle: "Midterm", grade: { displayed: "88 / 100" } },
  { entityId: "state:101", entityType: "extractionState", courseId: "101", canonicalTitle: "Lab 4 extraction state" }
];
const evidence = [
  { evidenceId: "ev-syllabus", courseId: "101", source: "contentTopic", title: "Syllabus", description: `<p>${syllabus}</p>` },
  { evidenceId: "ev-announce", courseId: "101", source: "announcement", title: "Bring a calculator", description: "<p>Bring your <b>graphing calculator</b> to class.</p>" },
  { evidenceId: "ev-probe", courseId: "101", source: "apiProbe", title: "assignment my submissions API 200", description: "Lab 4 probe noise" },
  { evidenceId: "ev-bio", courseId: "202", source: "contentTopic", title: "Staining guide", description: "Use crystal violet to stain cell walls before viewing." }
];
const index = dash.buildPassageIndex({ entities, evidence, courses });
const search = (query, options) => dash.searchPassages(index, query, options);

// ---- a question finds the part of a long document that answers it --------------
const exam = search("when is the final exam");
check(exam.results[0]?.snippet.includes("December 12"), `final exam question should surface the exam sentence first, got ${JSON.stringify(exam.results[0])}`);
check(exam.results[0]?.course === "CS 1301" && exam.results[0]?.title === "Syllabus", "a result names its course and the document it came from");
check(!exam.results[0]?.snippet.includes("Office hours"), "a long document is cut into passages, so the snippet is only the relevant part");
check(exam.results[0].snippet.length <= 421, "a snippet stays short enough to put several in a small model's prompt");
const hours = search("office hours");
check(hours.results[0]?.snippet.includes("Tuesdays 2-4 PM") && !hours.results[0].snippet.includes("December 12"), "office hours finds its own passage");

// ---- items, dates and grades ----------------------------------------------------
const due = search("when is lab 4 due");
check(due.results[0]?.entityId === "assignment:101:1", `the plainly named Lab 4 should outrank the longer-named one, got ${JSON.stringify(due.results.map((r) => r.entityId))}`);
check(due.results[0]?.dueAt === "2026-11-06T04:59:00.000Z" && !/November|2026/.test(due.results[0].snippet), "a due date is returned, and left out of the text, since Ask writes times itself");
const onDay = (query) => search(query).results[0]?.entityId;
check(onDay("due 2026-11-05") === "assignment:101:1" && onDay("thursday november 5") === "assignment:101:1" && !index.passages.find((p) => p.entityId === "assignment:101:1").counts.has("friday"), "a due date is still searchable in words and as a date on the student's clock (11:59 PM is not the next day)");
check(due.results[0]?.route.startsWith("#/assignment/"), "an item result carries the dashboard route that opens it");
check(search("midterm grade").results[0]?.snippet.includes("88 / 100"), "a grade's score is part of its passage");
check(search("assignments due").results.some((r) => r.entityId === "assignment:101:1"), "word endings are forgiven: 'assignments' finds an assignment");
check(search("quizzes").results.some((r) => r.entityId === "quiz:101:9") && dash.passageTokens("quizzes")[0] === dash.passageTokens("quiz")[0], "'quizzes' finds a quiz");
check(search("grading").results.some((r) => r.entityId === "grade:101:2") && search("graded").results.some((r) => r.entityId === "grade:101:2"), "grade, graded and grading meet");

// ---- scope ---------------------------------------------------------------------
const scoped = search("lab 4", { course: "BIOL 1107" });
check(scoped.results.length === 1 && scoped.results[0].courseId === "202", "a course name limits results to that course");
check(search("lab 4", { course: "cs1301" }).results.every((r) => r.courseId === "101"), "a course name ignores case and spaces");
check(search("lab 4", { courseId: "202" }).results.every((r) => r.courseId === "202"), "a course id limits results too");
const unknown = search("lab 4", { course: "PSYC 1101" });
check(unknown.results.length === 0 && /no course/i.test(unknown.note || ""), "an unknown course says so and does not fall back to every course");
check(search("calculator", { limit: 1 }).results.length === 1 && search("lab", { limit: 2 }).results.length <= 2, "limit is honoured");

// ---- what is left out, and what comes back empty ---------------------------------
check(!search("probe noise").results.length, "API probe records are not searchable text");
check(!search("extraction state").results.some((r) => r.entityId === "state:101"), "bookkeeping entities are not searchable");
check(search("the is a").total === 0 && search("   ").total === 0 && search("").total === 0, "a query with nothing but filler words finds nothing");
check(search("quantum chromodynamics").results.length === 0, "a query with no match returns no results");
const html = search("graphing calculator").results[0];
check(html && !/[<>]/.test(html.snippet) && html.snippet.includes("graphing calculator"), "HTML is stripped from snippets");
check(dash.searchPassages(dash.buildPassageIndex(), "anything").results.length === 0, "an empty archive is fine");

// ---- results are plain data (they go into a prompt) -------------------------------
const plain = search("final exam");
check(JSON.stringify(JSON.parse(JSON.stringify(plain))) === JSON.stringify(plain), "results survive JSON with nothing lost");

// ---- a big archive stays quick ------------------------------------------------------
const bigEvidence = Array.from({ length: 4000 }, (_, i) => ({ evidenceId: `big-${i}`, courseId: i % 2 ? "101" : "202", source: "announcement", title: `Notice ${i}`, description: filler(`Topic${i % 50}`, 6) }));
const bigIndex = dash.buildPassageIndex({ entities, evidence: [...evidence, ...bigEvidence], courses });
const started = performance.now();
for (let n = 0; n < 5; n += 1) dash.searchPassages(bigIndex, "when is the final exam");
const perSearch = (performance.now() - started) / 5;
check(dash.searchPassages(bigIndex, "when is the final exam").results[0]?.snippet.includes("December 12"), "the right answer still ranks first among 4000 other notices");
check(perSearch < 250, `a search over 4000 notices should take well under a quarter second, took ${perSearch.toFixed(0)} ms`);

if (failures.length) {
  console.error(failures.map((message) => `FAIL: ${message}`).join("\n"));
  process.exit(1);
}
console.log(`Passage search tests passed (${perSearch.toFixed(0)} ms per search over ${bigIndex.passages.length} passages).`);
