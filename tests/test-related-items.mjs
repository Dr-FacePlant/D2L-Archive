// Related items on an assignment or quiz pop-up: the grade record and calendar
// events link by id, module neighbors by title plus tool kind. Nothing is
// listed when nothing links, and every title is escaped.
process.env.TZ = "America/New_York";

import fs from "node:fs";
import path from "node:path";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const dash = loadDashboard();
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const C = "9900003";
const NOW = "2026-10-20T12:00:00.000Z";
const quickLink = (type) => `https://kennesaw.view.usg.edu/d2l/common/dialogs/quickLink/quickLink.d2l?ou=${C}&type=${type}&rcode=x`;
const topic = (id, title, extra = {}) => ({ entityId: `resource:${C}:${id}`, entityType: "learningResource", courseId: C, canonicalTitle: title, resourceType: "File", moduleId: "50", moduleTitle: "Week 3", order: Number(id), urls: {}, ...extra });
const entities = [
  { entityId: `resource:${C}:50`, entityType: "learningResource", courseId: C, canonicalTitle: "Week 3", isModule: true, moduleId: "50" },
  topic("1", "Week 3 Reading: Policing in America", { description: "Chapter 5 and two linked articles." }),
  topic("2", "Lecture: Police Discretion", { resourceType: "Link", progress: { visited: true } }),
  topic("3", "Reflection Paper", { resourceType: "Link", urls: { download: quickLink("dropbox") } }),
  topic("4", "Week 3 Quiz", { resourceType: "Link", urls: { download: quickLink("quiz") } }),
  topic("5", "<img src=x onerror=alert(1)> Reading"),
  { entityId: `assignmentBundle:${C}:11`, entityType: "assignmentBundle", courseId: C, canonicalTitle: "Reflection Paper", summary: "Write two pages on police discretion.", dates: { dueAt: "2026-10-28T03:59:00.000Z" }, gradeEntityId: `grade:${C}:7`, urls: {} },
  { entityId: `quizBundle:${C}:12`, entityType: "quizBundle", courseId: C, canonicalTitle: "Week 3 Quiz", description: "Ten questions.", dates: { dueAt: "2026-10-30T03:59:00.000Z" }, attempts: { completed: 0 }, urls: {} },
  { entityId: `grade:${C}:7`, entityType: "gradeRecord", courseId: C, canonicalTitle: "Reflection Paper", kind: "item", status: "pending", grade: {} },
  { entityId: `grade:${C}:8`, entityType: "gradeRecord", courseId: C, canonicalTitle: "Week 3 Quiz", kind: "item", status: "graded", sourceEntityId: `quizBundle:${C}:12`, grade: { pointsEarned: 9, pointsPossible: 10, displayed: "9 / 10" } },
  // The item's own due date repeated on the calendar adds nothing; a different date does.
  { entityId: `calendar:${C}:1`, entityType: "calendarEvent", courseId: C, canonicalTitle: "Reflection Paper - Due", eventLabel: "Due", targetEntityId: `assignmentBundle:${C}:11`, dates: { dueAt: "2026-10-28T03:59:00.000Z" } },
  { entityId: `calendar:${C}:2`, entityType: "calendarEvent", courseId: C, canonicalTitle: "Reflection Paper - Peer review", eventLabel: "Peer review", targetEntityId: `assignmentBundle:${C}:11`, dates: { startAt: "2026-10-29T14:00:00.000Z" } }
];
const course = { courseId: C, title: "Criminal Justice - Fall 2026", code: "CJ 1100" };
const index = dash.buildIndex({ now: NOW, courses: [course], entities });
const groupOf = (groups, id) => groups.find((group) => group.id === id);
const detail = (idx, name, id) => dash.detailFor(idx, { name, id }, {});

// Assignment: content neighbors, work neighbors plus the grade, and a calendar event.
const assignment = detail(index, "assignment", `assignmentBundle:${C}:11`);
const groups = assignment?.related || [];
check(groups.map((group) => group.id).join(",") === "content,work,calendar", `an assignment should list Content, Work & grades and Calendar, got ${groups.map((group) => group.id)}`);
const content = groupOf(groups, "content");
check(content?.items.map((item) => item.title).join("|").startsWith("Week 3 Reading: Policing in America|Lecture: Police Discretion"), "content neighbors should follow the module's order");
check(!content?.items.some((item) => item.title === "Reflection Paper" || item.title === "Week 3 Quiz"), "a topic that opens work should not be listed as content");
check(content?.items[0].route === `#/resources/${C}?item=${encodeURIComponent(`resource:${C}:1`)}`, "a content pill should open the resource in the Content screen");
check(content?.items[1].facts[0]?.v === "Viewed", "a topic D2L reports as visited should say Viewed");
check(content?.items[0].facts.length === 0, "a topic with no progress record should not claim it is unseen");
const work = groupOf(groups, "work");
check(work?.items[0]?.kind === "quiz" && work.items[0].route === `#/quiz/${encodeURIComponent(`quizBundle:${C}:12`)}`, "a quiz in the same module should open its own pop-up");
check(!work?.items.some((item) => item.kind === "assignment"), "the item should not list itself");
const grade = work?.items.find((item) => item.kind === "grade");
check(grade?.route === `#/grade/${encodeURIComponent(`grade:${C}:7`)}` && grade.facts[0].v === "Not graded yet", "the grade pill should link by id and say it isn't graded yet");
const calendar = groupOf(groups, "calendar");
check(calendar?.items.length === 1 && calendar.items[0].title === "Reflection Paper - Peer review", "only a calendar event with a different date should be listed");

// Quiz: its grade is found from the grade record's source when the quiz has no gradeEntityId.
const quizModel = detail(index, "quiz", `quizBundle:${C}:12`);
const quizGroups = quizModel?.related || [];
const quizGrade = groupOf(quizGroups, "work")?.items.find((item) => item.kind === "grade");
check(quizGrade?.facts[0].v === "Graded · 9 / 10" && quizGrade.facts[0].tone === "good", `a graded quiz should show its score, got ${quizGrade?.facts[0]?.v}`);
check(groupOf(quizGroups, "work")?.items.some((item) => item.kind === "assignment"), "a quiz should list the assignment in its module");

// Rendering: side labels, icon-tile pill, hover card tied to its pill, escaped titles.
const html = dash.detailPage(assignment, { body: true });
check(html.includes("<h2>Related items</h2>") && html.includes('class="rel-label">Content<'), "the page should show Related items with side labels");
check(/<a class="rel-pill" href="[^"]+" aria-describedby="(rel-tip-\d+)">[\s\S]*?role="tooltip" id="\1"/.test(html), "each hover card should be described by its own pill");
check(html.includes('class="rel-tile"') && html.includes("Open quiz"), "each pill should lead with an icon tile and its card should say what opens");
check(!html.includes("<img src=x") && html.includes("&lt;img src=x"), "a topic title with markup should be escaped");
check(html.indexOf("Related items") > html.indexOf("Instructions"), "Related items should sit below the instructions");

// Nothing linked: no section at all. Older archives without module data keep only exact links.
const bare = dash.buildIndex({ now: NOW, courses: [course], entities: [entities[6]] });
const bareModel = detail(bare, "assignment", `assignmentBundle:${C}:11`);
check((bareModel?.related || []).length === 0 && !dash.detailPage(bareModel, { body: true }).includes("Related items"), "an item with nothing related should show no section");
const noModules = dash.buildIndex({ now: NOW, courses: [course], entities: entities.filter((entity) => entity.entityType !== "learningResource") });
const exactOnly = detail(noModules, "assignment", `assignmentBundle:${C}:11`)?.related || [];
check(exactOnly.map((group) => group.id).join(",") === "work,calendar" && exactOnly[0].items.length === 1, "without module data only the grade and calendar links should remain");

// A long module folds into "+N more" that opens the module.
const many = [entities[0], ...Array.from({ length: 12 }, (_, n) => topic(String(100 + n), `Reading ${n + 1}`)), topic("3", "Reflection Paper", { resourceType: "Link", urls: { download: quickLink("dropbox") } }), entities[6]];
const crowded = detail(dash.buildIndex({ now: NOW, courses: [course], entities: many }), "assignment", `assignmentBundle:${C}:11`)?.related || [];
const crowdedContent = groupOf(crowded, "content");
check(crowdedContent?.items.length === 8 && crowdedContent.more?.count === 4 && crowdedContent.more.route === `#/resources/${C}?module=50`, "a long module should show 8 pills and a +4 more link to the module");

// Wiring.
const css = read("src/dashboard/dashboard.css");
const events = read("src/dashboard/app-events.js");
check(/\.rel:hover \.rel-tip, \.rel:focus-within \.rel-tip/.test(css), "the card should open on hover and on keyboard focus");
check(css.includes("@media (hover: none) { .rel-tip { display: none; } }"), "touch screens should skip the hover card");
check(css.includes("@container detail (max-width: 560px)") && css.includes(".rel-group { display: block; }"), "side labels should stack in a narrow pop-up");
check(events.includes("function placeRelatedCard") && events.includes('document.addEventListener("focusin", placeRelatedCard)'), "the card should reposition near an edge, on hover and focus");
check(read("dashboard.html").includes("model-related.js"), "the dashboard should load the related-items model");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Related items link the grade and calendar by id, module neighbors by title, and hide when empty.");
