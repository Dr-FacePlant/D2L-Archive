// The lookups behind real questions (fixtures/ask-real-questions.mjs): none of them may fail,
// each must find what a right answer needs, and none may say something wrong. A lookup that
// breaks becomes an error the model can read, not a failed answer.
import { loadDashboard } from "./test-dashboard-loader.mjs";
import { NOW, COURSES, ENTITIES, EVIDENCE, QUESTIONS } from "./fixtures/ask-real-questions.mjs";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();

const index = dash.buildIndex({ now: NOW, courses: COURSES.map(({ courseId, code, title }) => ({ courseId, code, title })), entities: ENTITIES, settings: {} });
const passageIndex = dash.buildPassageIndex({ entities: ENTITIES, evidence: EVIDENCE, courses: COURSES.map(({ courseId, label }) => ({ courseId, label })) });
const ctx = { passageIndex, index, checklistDone: {}, hiddenWork: {}, now: NOW, bundleFor: async () => null };
const BROKE = /That lookup broke/;

// ---- each question's lookups ------------------------------------------------------------------
for (const question of QUESTIONS) {
  const results = [];
  for (const [tool, args] of question.lookups) {
    let result;
    try { ({ result } = await dash.runAskTool(ctx, tool, args)); } catch (error) { result = { thrown: error.message }; }
    check(!result.thrown && !BROKE.test(result.error || ""), `"${question.ask}": ${tool} ${JSON.stringify(args)} fails: ${result.thrown || result.error}`);
    results.push(JSON.stringify(result));
  }
  const all = results.join("\n");
  for (const pattern of question.found || []) check(pattern.test(all), `"${question.ask}": the lookups don't find ${pattern}, got ${all.slice(0, 600)}`);
  for (const pattern of question.wrong || []) check(!pattern.test(all), `"${question.ask}": the lookups say ${all.match(pattern)?.[0].slice(0, 160)}`);
}

// ---- one row per item: a quiz's calendar entries and its settings page join the quiz ----------
const rows = dash.runAskTool(ctx, "search_archive", { course: "POLS 1101", query: "Quiz 8" }).result.results;
const quiz8 = rows.filter((row) => row.title === "Quiz 8");
check(quiz8.length === 1 && quiz8[0].kind === "Quiz" && quiz8[0].status === "Not open yet" && /15 minutes/.test(quiz8[0].text)
  && quiz8[0].when === "due Fri, Nov 6, 2026, 11:59 PM (tomorrow) · opens Thu, Nov 5, 2026, 4:30 PM (today)", `Quiz 8 is one row with its status, times and settings, got ${JSON.stringify(rows)}`);
check(!rows.some((row) => /calendar/i.test(row.kind)), `a calendar entry for a saved item is never its own row, got ${rows.map((row) => row.kind)}`);
const quizDetails = (await dash.runAskTool(ctx, "item_details", { course: "POLS 1101", title: "Quiz 8" })).result;
check(quizDetails.item?.kind === "Quiz" && !quizDetails.others, `item_details gives the quiz, not its calendar entries, got ${JSON.stringify(quizDetails)}`);
const wrapUp = (await dash.runAskTool(ctx, "item_details", { title: "Week 11 Wrap-up" })).result.item;
check(wrapUp?.kind === "Course content" && wrapUp.when === "due Thu, Nov 5, 2026, 8:00 AM (today)", `a topic with a calendar due gives the topic with that due, got ${JSON.stringify(wrapUp)}`);
check(dash.askTimes(dash.askEventTimes({ eventLabel: "Available", dates: { startAt: ENTITIES[1].dates.startAt } }), NOW).when === "opens Thu, Nov 5, 2026, 4:30 PM (today)"
  && dash.askTimes(dash.askEventTimes({ eventLabel: "", dates: { startAt: ENTITIES[1].dates.startAt } }), NOW).when === "at Thu, Nov 5, 2026, 4:30 PM (today)", "a calendar entry that is no deadline never says due");

// ---- a checklist's name finds its tasks; its page and surveys are never read as tasks ----------
const checklist = (await dash.runAskTool(ctx, "item_details", { course: "HIST 1111", title: "Checklist 11" })).result;
check(checklist.item?.kind === "Checklist task" && checklist.item.title === "Review chapter notes and answer study questions" && checklist.item.when === "due Fri, Nov 6, 2026, 11:59 PM (tomorrow)",
  `a checklist's name gives its first task, got ${JSON.stringify(checklist)}`);
check(checklist.others?.some((one) => one.startsWith("Answer question from your classmate")), `and names its other tasks, got ${checklist.others}`);
check(!JSON.stringify(checklist).includes("feedback survey"), "a survey named like the checklist is not offered as a task");
const survey = (await dash.runAskTool(ctx, "item_details", { course: "HIST 1111", title: "Checklist 11 feedback survey" })).result;
check(!BROKE.test(survey.error || "") && survey.item?.title !== "Checklist 11 feedback survey", `a survey is not described as a task, got ${JSON.stringify(survey)}`);

// ---- a lookup that breaks is an error the model reads ------------------------------------------
const broken = { ...ctx, get index() { throw new Error("index went missing"); } };
const due = dash.runAskTool(broken, "upcoming_due", {});
check(BROKE.test(due.result?.error || "") && Array.isArray(due.sources), `a lookup that throws at once gives an error result, got ${JSON.stringify(due)}`);
const details = await dash.runAskTool(broken, "item_details", { title: "Quiz 8" });
check(BROKE.test(details.result?.error || "") && Array.isArray(details.sources), `a lookup that fails later gives an error result too, got ${JSON.stringify(details)}`);

// ---- upcoming_due: days may be left out -----------------------------------------------------------
const dueTool = dash.ASK_TOOLS.find((tool) => tool.function.name === "upcoming_due").function;
check(!(dueTool.parameters.required || []).includes("days") && /7/.test(dueTool.parameters.properties.days.description), `days is optional and its default is told, got ${JSON.stringify(dueTool.parameters)}`);
check(dash.runAskTool(ctx, "upcoming_due", {}).result.days === 7, "left out, days is 7");

if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`Ask real-question lookups passed (${QUESTIONS.length} questions).`);
