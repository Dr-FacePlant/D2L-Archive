// Inferred due dates: undated work inside a module inherits the module's close
// date or the next module's open date. The chip inverts with .est and the due
// line reads "Estimated". A guess never counts as late.
process.env.TZ = "America/New_York";

import { loadDashboard } from "./test-dashboard-loader.mjs";

const dash = loadDashboard();
const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

const C = "9900003";
const quickLink = (type, code) => `https://kennesaw.view.usg.edu/d2l/common/dialogs/quickLink/quickLink.d2l?ou=${C}&type=${type}&rcode=${code}`;

const MODULE_1_CLOSE = "2026-10-15T03:59:00.000Z";
const MODULE_2_START = "2026-10-16T12:00:00.000Z";

const entities = [
  // Module 1 with an explicit moduleEndsAt
  { entityId: `resource:${C}:mod1`, entityType: "learningResource", courseId: C, canonicalTitle: "Module 1", isModule: true, moduleId: "", order: 1, moduleEndsAt: MODULE_1_CLOSE },
  { entityId: `resource:${C}:link1`, entityType: "learningResource", courseId: C, canonicalTitle: "Discussion 1", resourceType: "Link", moduleId: "mod1", urls: { download: quickLink("discuss", "d1") } },
  { entityId: `discussionThread:${C}:d1`, entityType: "discussionThread", courseId: C, canonicalTitle: "Discussion 1", status: "visible", dates: {}, posts: { mine: 0 }, grading: { pointsPossible: 10 }, urls: {} },

  // Nested submodule inside Module 1 inheriting parent's close date
  { entityId: `resource:${C}:submod1`, entityType: "learningResource", courseId: C, canonicalTitle: "Submodule 1.1", isModule: true, moduleId: "mod1", parentModuleId: "mod1", order: 2 },
  { entityId: `resource:${C}:link_sub`, entityType: "learningResource", courseId: C, canonicalTitle: "Quiz Sub", resourceType: "Link", moduleId: "submod1", urls: { download: quickLink("quiz", "qsub") } },
  { entityId: `quizBundle:${C}:qsub`, entityType: "quizBundle", courseId: C, canonicalTitle: "Quiz Sub", dates: {}, attempts: { completed: 0 }, urls: {} },

  // Module 2 with no close date, followed by Module 3 with a start date
  { entityId: `resource:${C}:mod2`, entityType: "learningResource", courseId: C, canonicalTitle: "Module 2", isModule: true, moduleId: "", order: 3 },
  { entityId: `resource:${C}:link2`, entityType: "learningResource", courseId: C, canonicalTitle: "Assignment 2", resourceType: "Link", moduleId: "mod2", urls: { download: quickLink("dropbox", "a2") } },
  { entityId: `assignmentBundle:${C}:a2`, entityType: "assignmentBundle", courseId: C, canonicalTitle: "Assignment 2", pointsPossible: 20, dates: {}, urls: {} },
  { entityId: `resource:${C}:mod3`, entityType: "learningResource", courseId: C, canonicalTitle: "Module 3", isModule: true, moduleId: "", order: 4, moduleStartsAt: MODULE_2_START },

  // The quiz cutoff estimates undated work beside it in the same module.
  { entityId: `resource:${C}:mod4`, entityType: "learningResource", courseId: C, canonicalTitle: "Module 4", isModule: true, moduleId: "", order: 5 },
  { entityId: `resource:${C}:link_q4`, entityType: "learningResource", courseId: C, canonicalTitle: "Quiz 4", resourceType: "Link", moduleId: "mod4", urls: { download: quickLink("quiz", "q4") } },
  { entityId: `quiz:${C}:q4`, entityType: "quizBundle", courseId: C, canonicalTitle: "Quiz 4", dates: { dueAt: "2026-10-19T03:59:00.000Z" }, attempts: { completed: 0 }, urls: {} },
  { entityId: `resource:${C}:link_a4`, entityType: "learningResource", courseId: C, canonicalTitle: "Paper 4", resourceType: "Link", moduleId: "mod4", urls: { download: quickLink("dropbox", "a4") } },
  { entityId: `assignment:${C}:a4`, entityType: "assignmentBundle", courseId: C, canonicalTitle: "Paper 4", dates: {}, urls: {} },

  // A calendar event attached to a discussion forum estimates its topics.
  { entityId: `discussionForum:${C}:forum1`, entityType: "discussionForum", courseId: C, canonicalTitle: "Document Questions" },
  { entityId: `discussionThread:${C}:calendarTopic`, entityType: "discussionThread", courseId: C, forumId: `discussionForum:${C}:forum1`, canonicalTitle: "Calendar Topic", dates: {}, posts: { mine: 0 }, grading: { pointsPossible: 10 }, urls: {} },
  { entityId: `calendar:${C}:event1`, entityType: "calendarEvent", courseId: C, canonicalTitle: "Post your questions for each document", eventLabel: "Due", sourceEntityType: "DiscussionForum", targetEntityId: `discussionForum:${C}:forum1`, dates: { dueAt: "2026-10-18T03:59:00.000Z" } },

  // Stated due date item: should NOT be inferred
  { entityId: `resource:${C}:link_stated`, entityType: "learningResource", courseId: C, canonicalTitle: "Stated Assignment", resourceType: "Link", moduleId: "mod1", urls: { download: quickLink("dropbox", "astated") } },
  { entityId: `assignmentBundle:${C}:astated`, entityType: "assignmentBundle", courseId: C, canonicalTitle: "Stated Assignment", pointsPossible: 10, dates: { dueAt: "2026-10-10T03:59:00.000Z" }, urls: {} },

  // Submitted item in Module 1
  { entityId: `resource:${C}:link_sub_done`, entityType: "learningResource", courseId: C, canonicalTitle: "Submitted Assignment", resourceType: "Link", moduleId: "mod1", urls: { download: quickLink("dropbox", "asub") } },
  { entityId: `assignmentBundle:${C}:asub`, entityType: "assignmentBundle", courseId: C, canonicalTitle: "Submitted Assignment", pointsPossible: 10, submissionCount: 1, status: "submitted", dates: {}, urls: {} }
];

const at = (now) => dash.buildIndex({ now, courses: [{ courseId: C, title: "Course 1", code: "C1" }], entities });

{
  const index = at("2026-10-01T12:00:00.000Z");
  const all = dash.allWork(index);

  // 1. Module with end date -> guess set, inferred true, due line says Estimated
  const d1 = all.find((item) => item.id === `discussionThread:${C}:d1`);
  check(d1?.dueAt === MODULE_1_CLOSE, `1: Discussion 1 should take Module 1 close date (${MODULE_1_CLOSE}), got ${d1?.dueAt}`);
  check(d1?.inferred?.rule === "moduleClose", `1: rule should be moduleClose, got ${d1?.inferred?.rule}`);
  check(/^Estimated · Module 1 closes/.test(dash.dueLine(d1, index.now)), `1: dueLine should say Estimated · Module 1 closes..., got "${dash.dueLine(d1, index.now)}"`);
  check(dash.upcomingWork(index).some((item) => item.id === d1?.id), "1: Discussion 1 should appear in upcomingWork");

  // 2. Nested module with no date inherits parent's close
  const qsub = all.find((item) => item.id === `quizBundle:${C}:qsub`);
  check(qsub?.dueAt === MODULE_1_CLOSE, `2: Quiz Sub should inherit parent close date (${MODULE_1_CLOSE}), got ${qsub?.dueAt}`);
  check(qsub?.inferred?.rule === "moduleClose", `2: rule should be moduleClose, got ${qsub?.inferred?.rule}`);

  // 3. No end date -> next module's start is used
  const a2 = all.find((item) => item.id === `assignmentBundle:${C}:a2`);
  check(a2?.dueAt === MODULE_2_START, `3: Assignment 2 should use next module start (${MODULE_2_START}), got ${a2?.dueAt}`);
  check(a2?.inferred?.rule === "nextModuleOpen", `3: rule should be nextModuleOpen, got ${a2?.inferred?.rule}`);
  check(/^Estimated · next module opens/.test(dash.dueLine(a2, index.now)), `3: dueLine should say Estimated · next module opens..., got "${dash.dueLine(a2, index.now)}"`);

  // 4. A same-module quiz cutoff estimates an undated assignment.
  const a4 = all.find((item) => item.id === `assignment:${C}:a4`);
  check(a4?.dueAt === "2026-10-19T03:59:00.000Z", `4: Paper 4 should use the Quiz 4 deadline, got ${a4?.dueAt}`);
  check(a4?.inferred?.rule === "moduleQuiz", `4: Paper 4 rule should be moduleQuiz, got ${a4?.inferred?.rule}`);
  check(/^Estimated · Quiz 4 deadline/.test(dash.dueLine(a4, index.now)), `4: Paper 4 dueLine should name Quiz 4, got "${dash.dueLine(a4, index.now)}"`);

  // 5. A linked calendar reminder estimates a forum topic and names the source.
  const calendarTopic = all.find((item) => item.id === `discussionThread:${C}:calendarTopic`);
  check(calendarTopic?.dueAt === "2026-10-18T03:59:00.000Z", `5: Calendar Topic should use its reminder date, got ${calendarTopic?.dueAt}`);
  check(calendarTopic?.inferred?.rule === "calendarReminder", `5: Calendar Topic rule should be calendarReminder, got ${calendarTopic?.inferred?.rule}`);
  check(/^Estimated · calendar reminder “Post your questions/.test(dash.dueLine(calendarTopic, index.now)), `5: Calendar Topic dueLine should name its reminder, got "${dash.dueLine(calendarTopic, index.now)}"`);

  // 6. Stated due date always wins over a guess
  const astated = all.find((item) => item.id === `assignmentBundle:${C}:astated`);
  check(!astated?.inferred, "6: Stated assignment should NOT have inferred date");
  check(astated?.hasDueDate === true, "6: Stated assignment hasDueDate should be true");
  check(!dash.dueLine(astated, index.now).startsWith("Estimated"), `6: Stated dueLine should not start with Estimated: "${dash.dueLine(astated, index.now)}"`);

  // 5. dateBox output carries est
  const d1Row = dash.workListModel(index, {}).rows.find((row) => row.id === d1.id);
  const boxHtml = dash.dateBox(d1Row.parts, d1Row.count, d1Row.inferred);
  check(/class="datebox flip est"/.test(boxHtml), `7: dateBox should include "est" class, got ${boxHtml}`);
  check(/title="Estimated — tap to see the date"/.test(boxHtml), `7: dateBox title should reflect Estimated, got ${boxHtml}`);

  // 6. Submitted item also receives inferred date
  const asub = all.find((item) => item.id === `assignmentBundle:${C}:asub`);
  check(asub?.dueAt === MODULE_1_CLOSE, `8: Submitted item should take module close date (${MODULE_1_CLOSE}), got ${asub?.dueAt}`);
  check(asub?.inferred?.rule === "moduleClose", `8: Submitted item rule should be moduleClose`);
  check(/^Estimated · Module 1 closes/.test(dash.dueLine(asub, index.now)), `8: Submitted item dueLine should be Estimated, got "${dash.dueLine(asub, index.now)}"`);
  const submittedRow = dash.workListModel(index, { tab: "done" }).rows.find((item) => item.id === asub.id);
  check(Boolean(submittedRow?.inferred), "8: Submitted item should remain estimated in Submitted & graded");
  const submittedBox = submittedRow ? dash.dateBox(submittedRow.parts, submittedRow.count, submittedRow.inferred) : "";
  check(/class="datebox est"/.test(submittedBox), `8: Submitted estimate should keep the inverted date box, got ${submittedBox}`);
}

{
  // 7. A past guess -> not in Upcoming (because it is in the past and not late), not Late, not Needs attention
  const pastIndex = at("2026-10-20T12:00:00.000Z"); // After both MODULE_1_CLOSE and MODULE_2_START
  const allPast = dash.allWork(pastIndex);
  const d1Past = allPast.find((item) => item.id === `discussionThread:${C}:d1`);
  check(d1Past?.dueAt === MODULE_1_CLOSE, `7: Past guess keeps its estimated dueAt, got ${d1Past?.dueAt}`);
  check(d1Past?.inferred?.rule === "moduleClose", "7: Past guess keeps inferred metadata");
  check(!dash.upcomingWork(pastIndex).some((item) => item.id === d1Past?.id), "7: Past guess should not be in upcomingWork");
  check(!dash.needsAttention(d1Past, pastIndex.now.getTime()), "7: Past guess should not need attention");
  check(!dash.isLate(d1Past), "7: Past guess should not be late");
}

if (failures.length) {
  console.error(`Inferred due date checks failed (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Inferred due date tests passed.");
