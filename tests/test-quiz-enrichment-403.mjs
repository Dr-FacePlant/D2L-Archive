import { loadBackgroundHooks, loadContentHooks } from "./test-production-loader.mjs";

const check = (value, message) => { if (!value) throw new Error(message); };
const quizzes = [1, 2, 3].map((id) => ({ QuizId: id, Name: `Quiz ${id}`, GradeItemId: 100 + id }));
// The student Quiz List page, read for attempt counts during the obligations pass.
const quizListPage = [/\/quizzes_list\.d2l$/, {
  status: 200,
  html: `<table>${quizzes.map((quiz) => `<tr><td><a onclick="GoToQuiz(${quiz.QuizId}, true);;return false;">${quiz.Name}</a></td><td>&nbsp;</td><td><label>0</label><label> / 1</label></td></tr>`).join("")}</table>`
}];

function mockFetch(routes, requested) {
  return async (url) => {
    const path = String(url).split("?")[0];
    requested.push(path);
    for (const [pattern, reply] of [...routes, quizListPage]) {
      if (pattern.test(path)) {
        const result = typeof reply === "function" ? reply(path) : reply;
        return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body, text: async () => result.html ?? "" };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  };
}
const count = (requested, re) => requested.filter((path) => re.test(path)).length;

// 1. Attempts and questions both 403: one probe each, scores/core data kept, obligations fresh.
{
  const requested = [];
  const content = loadContentHooks({ fetch: mockFetch([
    [/\/quizzes\/\d+\/attempts\/$/, { status: 403 }],
    [/\/quizzes\/\d+\/questions\/$/, { status: 403 }],
    [/\/quizzes\/$/, { status: 200, body: { Objects: quizzes } }],
    [/\/dropbox\/folders\/$/, { status: 200, body: [] }],
    [/\/dropbox\/categories\/$/, { status: 200, body: [] }],
    [/\/checklists\/$/, { status: 200, body: [] }],
    [/\/users\/whoami$/, { status: 200, body: { Identifier: "9" } }]
  ], requested) });
  const payload = await content.collectCourseApi("5001", { category: "obligations" });
  check(count(requested, /\/attempts\/$/) === 1, `attempts route should be asked once after a 403, asked ${count(requested, /\/attempts\/$/)}`);
  check(count(requested, /\/questions\/$/) === 1, `questions route should be asked once after a 403, asked ${count(requested, /\/questions\/$/)}`);
  check(payload.items.filter((item) => item.source === "quiz" || item.type === "quizzes" || /quiz/i.test(item.type || "")).length >= 3, "quiz core rows were lost");
  check(Object.keys(payload.apiStatus.quizAttempts).length === 3, "every quiz should still have an attempts status entry");
  const freshness = loadBackgroundHooks().freshnessForPayload(payload).obligations;
  check(freshness.status === "fresh" && freshness.blocked === 0, `obligations should be fresh with only enrichment 403s, got ${JSON.stringify(freshness)}`);
}

// 2. Attempts succeed: nothing is suppressed, every quiz is asked.
{
  const requested = [];
  const content = loadContentHooks({ fetch: mockFetch([
    [/\/quizzes\/\d+\/attempts\/$/, { status: 200, body: { Objects: [] } }],
    [/\/quizzes\/\d+\/questions\/$/, { status: 200, body: { Objects: [] } }],
    [/\/quizzes\/$/, { status: 200, body: { Objects: quizzes } }],
    [/\/dropbox\/folders\/$/, { status: 200, body: [] }],
    [/\/dropbox\/categories\/$/, { status: 200, body: [] }],
    [/\/checklists\/$/, { status: 200, body: [] }],
    [/\/users\/whoami$/, { status: 200, body: { Identifier: "9" } }]
  ], requested) });
  await content.collectCourseApi("5001", { category: "obligations" });
  check(count(requested, /\/attempts\/$/) === 3 && count(requested, /\/questions\/$/) === 3, "accessible enrichment routes were suppressed");
}

// 3. Questions 403 but attempts accessible: only the questions route is skipped.
{
  const requested = [];
  const content = loadContentHooks({ fetch: mockFetch([
    [/\/quizzes\/\d+\/attempts\/$/, { status: 200, body: { Objects: [] } }],
    [/\/quizzes\/\d+\/questions\/$/, { status: 403 }],
    [/\/quizzes\/$/, { status: 200, body: { Objects: quizzes } }],
    [/\/dropbox\/folders\/$/, { status: 200, body: [] }],
    [/\/dropbox\/categories\/$/, { status: 200, body: [] }],
    [/\/checklists\/$/, { status: 200, body: [] }],
    [/\/users\/whoami$/, { status: 200, body: { Identifier: "9" } }]
  ], requested) });
  await content.collectCourseApi("5001", { category: "obligations" });
  check(count(requested, /\/attempts\/$/) === 3 && count(requested, /\/questions\/$/) === 1, "route families should be skipped independently");
}

// 4. A 500 on a quiz attempts route is not an expected 403: it is retried per quiz and keeps obligations partial.
{
  const requested = [];
  const content = loadContentHooks({ fetch: mockFetch([
    [/\/quizzes\/\d+\/attempts\/$/, { status: 500 }],
    [/\/quizzes\/\d+\/questions\/$/, { status: 403 }],
    [/\/quizzes\/$/, { status: 200, body: { Objects: quizzes } }],
    [/\/dropbox\/folders\/$/, { status: 200, body: [] }],
    [/\/dropbox\/categories\/$/, { status: 200, body: [] }],
    [/\/checklists\/$/, { status: 200, body: [] }],
    [/\/users\/whoami$/, { status: 200, body: { Identifier: "9" } }]
  ], requested) });
  const payload = await content.collectCourseApi("5001", { category: "obligations" });
  check(count(requested, /\/attempts\/$/) === 3, "a 500 must not trigger the 403 skip");
  check(loadBackgroundHooks().freshnessForPayload(payload).obligations.status === "partial", "an unexpected 500 must keep obligations partial");
}

console.log("Quiz attempts/questions 403 handling passed.");
