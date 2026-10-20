import { loadBackgroundHooks, useRepositoryForAccount } from "./test-production-loader.mjs";

const listeners = [];
const hooks = loadBackgroundHooks({
  chrome: { runtime: { onMessage: { addListener(listener) { listeners.push(listener); } } } }
});
const repository = hooks.createArchiveRepository(hooks.createMemoryArchiveAdapter(), { now: () => "2026-09-27T12:00:00.000Z" });
useRepositoryForAccount(hooks, repository);

const base = {
  crawledAt: "2026-09-27T12:00:00.000Z",
  pageType: "valenceApi",
  pageTitle: "Assessments",
  pageUrl: "https://kennesaw.view.usg.edu/d2l/home/900001",
  courseOrgUnitId: "900001",
  courseTitle: "Synthetic Course"
};
const rows = [
  {
    ...base,
    source: "quiz",
    title: "TEST 1 CH 1-4",
    dueAtText: "2026-09-28T03:00:00.000Z",
    itemUrl: "https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_summary.d2l?ou=900001&qi=4980779",
    ids: JSON.stringify({ courseOrgUnitId: "900001", quizId: "4980779" }),
    columns: JSON.stringify({ startDate: "2026-09-25T04:01:00.000Z", endDate: "2026-09-28T03:00:00.000Z", attempts: { NumberOfAttemptsAllowed: 1 } })
  },
  {
    ...base,
    pageType: "quizSummary",
    source: "quizSummaryRow",
    title: "Summary - TEST 1 CH 1-4",
    status: "resultVisible",
    ids: JSON.stringify({ courseOrgUnitId: "900001", quizId: "4980779" }),
    columns: JSON.stringify({ attemptsAllowed: "1", attemptsCompleted: "0", timeLimitText: "60 minutes" })
  },
  {
    ...base,
    source: "apiProbe",
    title: "quiz attempts API 403",
    type: "quiz attempts",
    status: "blocked",
    ids: JSON.stringify({ courseOrgUnitId: "900001", quizId: "4980779" }),
    columns: JSON.stringify({ status: 403 })
  },
  {
    ...base,
    source: "apiProbe",
    title: "quiz questions API 403",
    type: "quiz questions",
    status: "blocked",
    ids: JSON.stringify({ courseOrgUnitId: "900001", quizId: "4980779" }),
    columns: JSON.stringify({ status: 403 })
  },
  {
    ...base,
    source: "gradeItem",
    title: "Test 1",
    ids: JSON.stringify({ courseOrgUnitId: "900001", gradeObjectId: "17243679" }),
    columns: JSON.stringify({ displayedGrade: "12 / 15", pointsEarned: 12, pointsPossible: 15, weight: 10, isGraded: true })
  }
];

const result = await hooks.ingestAndOrganizeRows(rows, {
  repository,
  syncRunId: "assessment-fixture",
  extractorVersion: "0.8.143",
  mode: "test",
  ingestedAt: "2026-09-27T12:00:00.000Z"
});

if (result.ingest.added !== rows.length) throw new Error("Distinct quiz API probes did not retain separate evidence identities");
const quiz = result.entities.find((entity) => entity.entityType === "quizBundle");
const grade = result.entities.find((entity) => entity.entityType === "gradeRecord");
if (!quiz || !grade) throw new Error("Quiz and grade organizers did not create entities");
if (quiz.status !== "available" || quiz.attempts.allowed !== 1 || quiz.attempts.completed !== 0) throw new Error("Quiz availability or attempt state is incorrect");
if (quiz.access.attempts !== "blocked" || quiz.access.questions !== "blocked") throw new Error("Blocked quiz API states were not preserved independently");
if (grade.status !== "graded" || grade.grade.pointsEarned !== 12 || grade.grade.pointsPossible !== 15) throw new Error("Grade record values are incorrect");
const quizRelationships = result.relationships.filter((item) => item.fromId === quiz.entityId);
if (quizRelationships.filter((item) => item.type === "hasAccessProbe").length !== 2) throw new Error("Quiz access probes were not linked separately");
const gradeLink = quizRelationships.find((item) => item.type === "hasGrade");
if (!gradeLink || gradeLink.classification !== "likely" || gradeLink.confidence !== 0.85) throw new Error("Conservative quiz-to-grade title link is missing");

const request = (method, params = {}) => new Promise((resolve, reject) => {
  const message = { type: "D2L_APP_API_REQUEST", protocolVersion: "1", requestId: `${method}-request`, method, params };
  const keepAlive = listeners[0](message, { id: "extension-test" }, resolve);
  if (keepAlive !== true) reject(new Error(`${method} did not keep the response channel alive`));
});

const overview = await request("dashboard.getOverview", { now: "2026-09-27T12:00:00.000Z" });
if (!overview.ok || overview.data.entityCounts.quizBundle !== 1 || overview.data.entityCounts.gradeRecord !== 1 || overview.data.blockedQuizzes !== 1) {
  throw new Error("Dashboard overview did not expose organized assessment state");
}
const upcoming = await request("dashboard.getUpcoming", { courseId: "900001", now: "2026-09-27T12:00:00.000Z", horizonDays: 7 });
if (!upcoming.ok || upcoming.data.items.length !== 1 || upcoming.data.items[0].entityId !== quiz.entityId) throw new Error("Dashboard upcoming query omitted the quiz deadline");
const quizzes = await request("quizzes.list", { courseId: "900001" });
const grades = await request("grades.list", { courseId: "900001" });
if (quizzes.data.items.length !== 1 || grades.data.items.length !== 1) throw new Error("Assessment list APIs did not return semantic entities");

console.log("Quiz and grade entities preserve access states, values, cautious links, and dashboard queries.");
