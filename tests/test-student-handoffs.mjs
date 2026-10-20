import { loadDashboard } from "./test-dashboard-loader.mjs";

const dash = loadDashboard();
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const course = { courseId: "9900004", code: "CRJU 9004", name: "Criminal Justice", label: "CRJU 9004", tint: "#eef1f5", ink: "#222" };
const base = {
  kind: "quiz",
  item: { status: { key: "open", label: "Open", tone: "good" } },
  course,
  title: "Exam 1",
  facts: [],
  steps: [{ state: "todo", what: "Quiz (120 min, 1 attempt)", when: "Due Sat, Oct 3 · 8:00 PM · in 2 days", note: "" }],
  description: "",
  summaryText: "",
  grade: null,
  links: [{ label: "Open quiz in D2L", url: "https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_summary.d2l?ou=9900004&qi=1", primary: true }]
};

check(dash.quizRequiresLockdown("Exam 1 - Requires Respondus LockDown Browser + Screen Recording") === true, "an explicit LockDown Browser requirement must be detected");
check(dash.quizRequiresLockdown("The Respondus lock-down browser is required for this quiz.") === true, "a requirement in quiz instructions must be detected");
check(dash.quizRequiresLockdown("The Respondus lock-down browser is not required for this quiz (but it should be set up for Quiz 2).") === false, "an explicit not-required statement must not be mislabeled");

const ordinary = dash.detailPage({ ...base, lockdown: false, lockdownNote: "" }, { href: "#/work?type=quiz", label: "Quizzes" });
check(ordinary.includes("Open quiz in D2L"), "an ordinary quiz needs an explicit Open quiz in D2L handoff");
check(ordinary.includes("data-d2l-link"), "quiz handoff must use the same-tab D2L link contract");
// Starting a quiz uses an attempt, so the dashboard never starts one: its only blue button hands you to D2L.
check((ordinary.match(/btn-primary/g) || []).length === 1 && /<a class="btn btn-primary open-d2l [^"]*" href="https:\/\/kennesaw\.view\.usg\.edu\/[^"]*"[^>]*data-d2l-link>Open quiz in D2L/.test(ordinary), "the quiz's one blue button must be the D2L handoff");

const lockdown = dash.detailPage({ ...base, lockdown: true, steps: [{ ...base.steps[0], note: "Needs LockDown Browser. Open this quiz from the Respondus LockDown Browser application." }], links: [{ label: "Open quiz in D2L", url: base.links[0].url, primary: true }] }, { href: "#/work?type=quiz", label: "Quizzes" });
check(lockdown.includes("Needs LockDown Browser"), "LockDown Browser quizzes need a visible requirement note");
check(lockdown.includes("Open quiz in D2L") && !lockdown.includes("Start quiz in D2L"), "LockDown Browser quizzes open in D2L without a Start button");

const assignment = dash.detailPage({
  kind: "assignment", item: base.item, course, title: "Paper", facts: [], instructions: "", files: [], rubric: null,
  rubricNote: "", submissions: [], submittedFiles: [], feedback: [], score: "", grade: null,
  links: [{ label: "Open assignment in D2L", url: "https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folders_list.d2l?ou=9900004", primary: true }]
}, { href: "#/work", label: "Assignments" });
check(/btn-primary open-d2l [^"]*"[^>]*data-d2l-link>Open assignment in D2L/.test(assignment), "assignments need one blue Open assignment in D2L button");
check(!/action-form|data-action="assignment-submit"|type="file"/.test(assignment), "assignments must not offer a turn-in form");

const discussion = dash.detailPage({
  kind: "discussion", item: base.item, course, title: "Topic", forum: "Forum", facts: [], gate: "", prompt: "", rubric: null,
  myPosts: [], recentPosts: [], allPosts: [{ id: "55", parentPostId: "", subject: "Question", author: "Student", at: "2026-09-29T12:00:00Z", text: "Body" }], lastPost: "", grade: null,
  links: [{ label: "Open discussion in D2L", url: "https://kennesaw.view.usg.edu/d2l/le/9900004/discussions/topics/1/View", primary: true }]
}, { href: "#/work?type=discussion", label: "Discussions" });
check(/btn-primary open-d2l [^"]*"[^>]*data-d2l-link>Open discussion in D2L/.test(discussion), "discussions need one blue Open discussion in D2L button");
check(discussion.includes("Question") && !/data-action="discussion-submit"|data-action="reply-to"|Write a post/.test(discussion), "discussion posts stay readable without Reply or Write a post controls");

check(dash.embeddedLinkTarget(base.links[0].url) === "d2l", "D2L action handoffs must close the overlay and navigate the owning tab");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Student action handoffs and quiz safety checks passed.");
