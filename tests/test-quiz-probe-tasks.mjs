import { loadBackgroundHooks } from "./test-production-loader.mjs";

const { quizProbeTasksFromApiItems } = loadBackgroundHooks();

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const tasks = quizProbeTasksFromApiItems("9900002", [
  { source: "quiz", title: "Quiz 1", url: "https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_summary.d2l?ou=9900002&qi=7001", ids: { quizId: "7001" } },
  { source: "quizAttempt", title: "Quiz 1 attempt 1", url: "https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_submissions_attempt.d2l?ou=9900002&qi=7001&ai=9001", ids: { quizId: "7001", attemptId: "9001" } },
  { source: "quizAttempt", title: "Duplicate attempt", url: "https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_submissions_attempt.d2l?ou=9900002&qi=7001&ai=9001", ids: {} },
  { source: "assignment", title: "Assignment should not become quiz probes", ids: { dropboxFolderId: "55" } }
]);

assert(tasks.length === 2, "one quiz summary and one attempt create two read-only probe tasks");
assert(tasks.filter((task) => task.expectedPageType === "quizSummary").length === 1, "quiz gets one summary probe");
assert(tasks.filter((task) => task.expectedPageType === "quizAttempt").length === 1, "existing attempt gets one result probe");
assert(tasks.every((task) => task.courseOrgUnitId === "9900002"), "quiz probes keep course org unit id");
assert(tasks.every((task) => task.sourcePageType === "apiQuizProbe"), "quiz probes keep source page type");
assert(tasks.every((task) => !/quiz_start|\/quizzing\/user\/attempt/i.test(task.url)), "quiz probes never use start or active attempt URLs");
assert(tasks.some((task) => /qi=7001/.test(task.url)), "quiz probes include quiz id");
assert(tasks.some((task) => /ai=9001/.test(task.url)), "attempt probe includes attempt id");

console.log("Quiz probe production tests passed.");
