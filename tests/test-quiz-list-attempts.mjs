// Students get 403 on D2L's quiz attempts API, so the normal (obligations) sync
// reads each course's Quiz List page for attempt counts. The markup below
// follows the live HIST 9002 page as read on Oct 9, 2026, with synthetic ids.
process.env.TZ = "America/New_York";

import { loadBackgroundHooks, loadContentHooks, loadSharedHooks } from "./test-production-loader.mjs";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const COURSE = "5001";
const quizRow = (quizId, title, evaluation, used, allowed, extra = "") => `<tr><td style=""><div class="dco"><div class="dco_c"><a class="d2l-link d2l-link-inline" onclick="GoToQuiz(${quizId}, true);;return false;" href="javascript://" title="Quiz summary">${title}</a></div></div>${extra}</td><td class="d_gn">${evaluation}</td><td class="d_gn d_gc"><label>${used}</label><label> / ${allowed}</label></td></tr>`;
const sectionRow = (label) => `<tr class="d_gh" header><th scope="col" class="d_hch d_gl" style=""><label>${label}</label></th><th scope="col" class="d_hch d_gc">Evaluation Status</th><th scope="col" class="d_hch d_gc"> Attempts</th></tr>`;
const quizListHtml = `<html><body><div id="d2l_body"><table id="z_b" class="d2l-table d2l-grid d_gl" type="list">
${sectionRow("Current Quizzes")}
${quizRow(1, "Quiz 1", `<label>Feedback: </label><a class="d2l-link d2l-link-inline" href="/d2l/lms/quizzing/user/quiz_submissions.d2l?qi=1&amp;ou=${COURSE}">On Attempt</a>`, 1, 1)}
${quizRow(2, "Quiz 2", "&nbsp;", 1, 1, `<div class="dco"><div class="dco_c"><span class="ds_b">Due on Oct 9, 2026 11:59 PM<br/>Available on Oct 8, 2026 4:30 PM until Oct 9, 2026 11:59 PM </span></div></div>`)}
${sectionRow("Past Quizzes")}
${quizRow(3, "Quiz 3", "&nbsp;", 0, 1)}
${quizRow(4, "Review &amp; Practice", "&nbsp;", 2, "Unlimited")}
</table></div>
<script>var template = "<tr><td>not a quiz</td><td>9 / 9</td></tr>";</script>
</body></html>`;

function mockFetch(routes, requested) {
  return async (url) => {
    const path = String(url).split("?")[0];
    requested.push(path);
    for (const [pattern, reply] of routes) {
      if (pattern.test(path)) {
        return {
          ok: reply.status >= 200 && reply.status < 300,
          status: reply.status,
          json: async () => reply.body,
          text: async () => reply.html ?? ""
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  };
}
const quizzes = [
  { QuizId: 1, Name: "Quiz 1", AttemptsAllowed: { IsUnlimited: false, NumberOfAttemptsAllowed: 1 } },
  { QuizId: 2, Name: "Quiz 2", AttemptsAllowed: { IsUnlimited: false, NumberOfAttemptsAllowed: 1 } },
  { QuizId: 3, Name: "Quiz 3", AttemptsAllowed: { IsUnlimited: false, NumberOfAttemptsAllowed: 1 }, StartDate: "2026-09-01T04:00:00.000Z", EndDate: "2026-09-08T03:59:00.000Z" },
  { QuizId: 4, Name: "Review & Practice", AttemptsAllowed: { IsUnlimited: true, NumberOfAttemptsAllowed: null } },
  { QuizId: 5, Name: "Quiz 5", AttemptsAllowed: { IsUnlimited: false, NumberOfAttemptsAllowed: 1 } }
];
const studentRoutes = (quizList, objects = quizzes) => [
  [/\/quizzes\/\d+\/attempts\/$/, { status: 403 }],
  [/\/quizzes\/\d+\/questions\/$/, { status: 403 }],
  [/\/quizzes\/$/, { status: 200, body: { Objects: objects } }],
  [/\/quizzes_list\.d2l$/, quizList],
  [/\/dropbox\/folders\/$/, { status: 200, body: [] }],
  [/\/dropbox\/categories\/$/, { status: 200, body: [] }],
  [/\/checklists\/$/, { status: 200, body: [] }],
  [/\/users\/whoami$/, { status: 200, body: { Identifier: "9" } }]
];
const listRequests = (requested) => requested.filter((path) => /quizzes_list\.d2l$/.test(path)).length;
const freshness = (payload) => loadBackgroundHooks().freshnessForPayload(payload).obligations;

// 1. The obligations sync reads the Quiz List page once and keeps one row per quiz.
const requested = [];
const content = loadContentHooks({ fetch: mockFetch(studentRoutes({ status: 200, html: quizListHtml }), requested) });
const payload = await content.collectCourseApi(COURSE, { category: "obligations" });
const listRows = payload.items.filter((item) => item.source === "quizListRow");
const row = (quizId) => listRows.find((item) => item.ids.quizId === quizId);
check(listRequests(requested) === 1, `the Quiz List page should be read once, read ${listRequests(requested)} times`);
check(listRows.length === 4, `expected 4 quiz list rows (the script's <tr> is not a quiz), got ${listRows.length}`);
check(row("1")?.columns.attemptsCompleted === 1 && row("1")?.columns.attemptsAllowed === 1, "Quiz 1 should read 1 of 1 attempts");
check(row("1")?.columns.evaluationStatus === "Feedback: On Attempt", `Quiz 1 evaluation status reads "${row("1")?.columns.evaluationStatus}"`);
check(row("1")?.columns.section === "Current Quizzes", `Quiz 1 section reads "${row("1")?.columns.section}"`);
check(row("2")?.columns.attemptsCompleted === 1 && row("2")?.title === "Quiz 2", "Quiz 2 should read 1 attempt used");
check(row("3")?.columns.attemptsCompleted === 0 && row("3")?.columns.section === "Past Quizzes", "Quiz 3 should read 0 attempts in Past Quizzes");
check(row("4")?.title === "Review & Practice" && row("4")?.columns.attemptsUnlimited === true && row("4")?.columns.attemptsCompleted === 2, "an unlimited quiz keeps its count and decoded title");
check(payload.apiStatus.quizList === 200, `apiStatus.quizList should be 200, got ${payload.apiStatus.quizList}`);
check(payload.counts.quizListRows === 4, `counts.quizListRows should be 4, got ${payload.counts.quizListRows}`);
check(freshness(payload).status === "fresh", `obligations should stay fresh, got ${JSON.stringify(freshness(payload))}`);

// 2. A page without quiz rows (login redirect, new layout) is not "no attempts": nothing is kept and obligations is partial.
{
  const seen = [];
  const content2 = loadContentHooks({ fetch: mockFetch(studentRoutes({ status: 200, html: "<html><body><form>Sign in</form></body></html>" }), seen) });
  const result = await content2.collectCourseApi(COURSE, { category: "obligations" });
  check(!result.items.some((item) => item.source === "quizListRow"), "an unparsed page must not create quiz list rows");
  check(result.apiStatus.quizList === "unparsed", `an unparsed page should report "unparsed", got ${result.apiStatus.quizList}`);
  check(freshness(result).status === "partial", `an unparsed Quiz List page should keep obligations partial, got ${freshness(result).status}`);
}

// 3. A failed page keeps obligations partial.
{
  const content3 = loadContentHooks({ fetch: mockFetch(studentRoutes({ status: 500 }), []) });
  const result = await content3.collectCourseApi(COURSE, { category: "obligations" });
  check(result.apiStatus.quizList === 500 && freshness(result).status === "partial", "a 500 from the Quiz List page should keep obligations partial");
}

// 4. No active quiz: the page is not requested and freshness is unaffected.
for (const objects of [[], quizzes.map((quiz) => ({ ...quiz, IsActive: false }))]) {
  const seen = [];
  const content4 = loadContentHooks({ fetch: mockFetch(studentRoutes({ status: 200, html: quizListHtml }, objects), seen) });
  const result = await content4.collectCourseApi(COURSE, { category: "obligations" });
  check(listRequests(seen) === 0, `with ${objects.length} inactive-or-no quizzes the Quiz List page should not be read`);
  check(result.apiStatus.quizList === "" && freshness(result).status === "fresh", "skipping the page must not change obligations freshness");
}

// 5. Other categories never read the page.
{
  const seen = [];
  const content5 = loadContentHooks({ fetch: mockFetch(studentRoutes({ status: 200, html: quizListHtml }), seen) });
  await content5.collectCourseApi(COURSE, { category: "announcements" });
  check(listRequests(seen) === 0, "the announcements category should not read the Quiz List page");
}

// 6. Organized and shown: list rows mark quizzes as taken on the dashboard.
const { flattenItem } = loadSharedHooks();
const hooks = loadBackgroundHooks();
const repository = hooks.createArchiveRepository(hooks.createMemoryArchiveAdapter(), { now: () => "2026-10-09T16:00:00.000Z" });
const pagePayload = {
  pageType: "valenceApi",
  page: { url: `https://kennesaw.view.usg.edu/d2l/home/${COURSE}`, title: "Synthetic Course" },
  course: { orgUnitId: COURSE, title: "Synthetic Course" },
  extractor: { extractedAt: "2026-10-09T16:00:00.000Z", mode: "priorityApi", category: "obligations" }
};
const organized = await hooks.ingestAndOrganizeRows(payload.items.map((item) => flattenItem(pagePayload, item)), {
  repository,
  syncRunId: "quiz-list-fixture",
  mode: "priorityApi",
  ingestedAt: "2026-10-09T16:00:00.000Z"
});
const entity = (quizId) => organized.entities.find((item) => item.entityId === `quiz:${COURSE}:${quizId}`);
check(entity("2")?.attempts.completed === 1 && entity("2")?.attempts.source === "quizListPage", `Quiz 2 attempts should come from the Quiz List page, got ${JSON.stringify(entity("2")?.attempts)}`);
check(entity("3")?.attempts.completed === 0 && entity("3")?.attempts.source === "quizListPage", "Quiz 3 should be known untaken");
check(entity("5")?.attempts.source === "none", "a quiz missing from the list page keeps no attempt source");
check(organized.relationships.some((item) => item.fromId === `quiz:${COURSE}:2` && item.type === "hasSummary"), "the list row should link to its quiz");

const dash = loadDashboard();
const index = dash.buildIndex({ now: "2026-10-09T16:00:00.000Z", courses: [{ courseId: COURSE, title: "Synthetic Course" }], entities: organized.entities });
const view = (quizId) => {
  const model = dash.quizModel(index, entity(quizId), { evidence: [] });
  // The quiz screen's to-do step carries the attempts: "Quiz (…, 1 attempt)", then "1 of 1 used".
  const take = model.steps[0];
  return { status: model.item.status.label, done: model.item.done, step: take.state, what: take.what, when: take.when };
};
const quiz2 = view("2");
check(quiz2.status === "Submitted" && quiz2.done === true, `Quiz 2 should show Submitted, got ${JSON.stringify(quiz2)}`);
check(quiz2.step === "done" && quiz2.when === "1 of 1 used", `Quiz 2's step should read "1 of 1 used", got ${JSON.stringify(quiz2)}`);
const quiz3 = view("3");
check(quiz3.status === "Missed" && quiz3.step === "missed" && /^Missed: it closed .* before you started it\.$/.test(quiz3.when), `closed untaken Quiz 3 reads ${JSON.stringify(quiz3)}`);
const quiz4 = view("4");
check(quiz4.status === "Submitted" && quiz4.when === "2 of unlimited used" && quiz4.what.includes("unlimited attempts"), `unlimited quiz reads ${JSON.stringify(quiz4)}`);
const quiz5 = view("5");
check(quiz5.status === "Open" && quiz5.step === "todo" && quiz5.what.includes("1 attempt"), `a quiz without a list row stays Open, got ${JSON.stringify(quiz5)}`);

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Quiz List page attempts: read once per course, parsed, freshness kept honest, organized, and shown as Submitted.");
