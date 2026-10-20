// Work D2L gives no date of its own takes the deadline of the content module
// (lesson) it sits in, from that module's "Due" event on D2L's calendar. Built
// from the HIST 9002 Sample Reading reading as synced on Sep 30, 2026.
process.env.TZ = "America/New_York";

import { loadDashboard } from "./test-dashboard-loader.mjs";

const dash = loadDashboard();
const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

const C = "9900003";
const LESSON_DUE = "2026-10-07T03:59:00.000Z"; // Tue, Oct 6, 11:59 PM in Georgia
const quickLink = (type, code) => `https://kennesaw.view.usg.edu/d2l/common/dialogs/quickLink/quickLink.d2l?ou=${C}&type=${type}&rcode=${code}`;
const entities = [
  { entityId: `resource:${C}:63697084`, entityType: "learningResource", courseId: C, canonicalTitle: "Lesson 6. The World of Rome", isModule: true, moduleId: "", dates: { availableFrom: "2026-09-29T12:00:00.000Z" } },
  { entityId: `calendar:${C}:21509515`, entityType: "calendarEvent", courseId: C, canonicalTitle: "Lesson 6. The World of Rome", eventLabel: "Due", sourceEntityType: "D2L.LE.Content.ContentObject.ModuleCO", targetEntityId: `resource:${C}:63697084`, dates: { startAt: LESSON_DUE, endAt: LESSON_DUE, dueAt: LESSON_DUE } },
  { entityId: `resource:${C}:63697129`, entityType: "learningResource", courseId: C, canonicalTitle: "Reading assignment: The Sample Reading and the Edict of Milan", resourceType: "Link", moduleId: "63697084", urls: { download: quickLink("discuss", "usgq-33951227") } },
  { entityId: `discussionThread:${C}:3338273`, entityType: "discussionThread", courseId: C, canonicalTitle: "Reading assignment: The Sample Reading and the Edict of Milan", status: "visible", dates: { availableFrom: null, availableUntil: null }, posts: { count: 0, replies: 0, threads: 0, mine: 0 }, grading: { pointsPossible: 10, pointsEarned: null }, urls: {} },
  // A quiz inside a module named after the quiz keeps a plain "Due".
  { entityId: `resource:${C}:1`, entityType: "learningResource", courseId: C, canonicalTitle: "Quiz 1", isModule: true, moduleId: "" },
  { entityId: `calendar:${C}:2`, entityType: "calendarEvent", courseId: C, canonicalTitle: "Quiz 1", eventLabel: "Due", sourceEntityType: "D2L.LE.Content.ContentObject.ModuleCO", targetEntityId: `resource:${C}:1`, dates: { dueAt: "2026-09-16T03:59:00.000Z" } },
  { entityId: `resource:${C}:3`, entityType: "learningResource", courseId: C, canonicalTitle: "Quiz 1", resourceType: "Link", moduleId: "1", urls: { download: quickLink("quiz", "usgq-28472610") } },
  { entityId: `quizBundle:${C}:9`, entityType: "quizBundle", courseId: C, canonicalTitle: "Quiz 1", dates: {}, attempts: { completed: 0 }, urls: {} },
  // A discussion with no content link stays undated.
  { entityId: `discussionThread:${C}:4`, entityType: "discussionThread", courseId: C, canonicalTitle: "Roman and Byzantine Views of Barbarians", dates: {}, posts: { mine: 0 }, grading: { pointsPossible: 10 }, urls: {} }
];
const at = (now) => dash.buildIndex({ now, courses: [{ courseId: C, title: "World History - Section 15 - Fall Semester 2026 - CO", code: "CO.000.HIST9002.84756.20272" }], entities });

{
  const index = at("2026-09-30T22:00:00.000Z");
  const edict = dash.allWork(index).find((item) => item.id === `discussionThread:${C}:3338273`);
  check(edict?.dueAt === LESSON_DUE, `L1: the Edict reading should be due with Lesson 6 (${LESSON_DUE}), got ${edict?.dueAt}`);
  check(edict?.lesson === "Lesson 6", `L1: the lesson label should be "Lesson 6", got "${edict?.lesson}"`);
  check(edict?.status.key === "open", `L1: before the deadline the reading is Open, got ${edict?.status.key}`);
  check(dash.dueLine(edict, index.now) === "Due with Lesson 6 · 11:59 PM", `L1: due line reads "${dash.dueLine(edict, index.now)}"`);
  check(dash.dueFull(edict, index.now).startsWith("Due with Lesson 6 · "), `L1: full due text reads "${dash.dueFull(edict, index.now)}"`);
  check(dash.upcomingWork(index).some((item) => item.id === edict?.id), "L1: the Edict reading should be in Upcoming");
  check(dash.workListModel(index, {}).rows.some((row) => row.id === edict?.id), "L1: the Edict reading should be on the Assignments page's default tab");

  const quiz = dash.allWork(index).find((item) => item.kind === "quiz");
  check(quiz?.dueAt === "2026-09-16T03:59:00.000Z" && quiz?.lesson === "", `L2: Quiz 1 takes its module's date without naming it again (lesson "${quiz?.lesson}")`);

  const barbarians = dash.allWork(index).find((item) => item.id === `discussionThread:${C}:4`);
  check(barbarians && !barbarians.dueAt && dash.dueLine(barbarians, index.now) === "No due date", "L3: a discussion that isn't in any dated lesson keeps No due date");
}

{
  const index = at("2026-10-08T12:00:00.000Z");
  const edict = dash.allWork(index).find((item) => item.id === `discussionThread:${C}:3338273`);
  check(edict?.status.key === "pastDue" && edict.status.label === "Late", `L4: after Lesson 6's deadline an unposted reading is Late, got ${edict?.status.key}`);
  check(dash.needsAttention(edict, index.now.getTime()), "L4: a late reading worth points needs attention");
  check(/^Was due with Lesson 6 · .* · still open$/.test(dash.dueLine(edict, index.now)), `L4: late due line reads "${dash.dueLine(edict, index.now)}"`);
}

if (failures.length) {
  console.error(`Lesson deadline checks failed (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Lesson deadline checks passed.");
