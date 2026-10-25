// Related items on an assignment or quiz pop-up: the grade record links by id, module neighbors by title plus tool kind. Nothing is
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
  topic("1", "Week 3 Reading: Policing in America", { description: "Chapter 5 and two linked articles.", urls: { d2l: `https://kennesaw.view.usg.edu/d2l/le/content/${C}/viewContent/1/View` } }),
  topic("2", "Lecture: Police Discretion", { resourceType: "Link", progress: { visited: true } }),
  topic("3", "Reflection Paper", { resourceType: "Link", urls: { download: quickLink("dropbox") } }),
  topic("4", "Week 3 Quiz", { resourceType: "Link", urls: { download: quickLink("quiz") } }),
  topic("5", "<img src=x onerror=alert(1)> Reading", { urls: { d2l: "javascript:alert(1)" } }),
  { entityId: `assignmentBundle:${C}:11`, entityType: "assignmentBundle", courseId: C, canonicalTitle: "Reflection Paper", summary: "Write two pages on police discretion.", dates: { dueAt: "2026-10-28T03:59:00.000Z" }, gradeEntityId: `grade:${C}:7`, urls: {} },
  { entityId: `quizBundle:${C}:12`, entityType: "quizBundle", courseId: C, canonicalTitle: "Week 3 Quiz", description: "Ten questions.", dates: { dueAt: "2026-10-30T03:59:00.000Z" }, attempts: { completed: 0 }, urls: {} },
  { entityId: `grade:${C}:7`, entityType: "gradeRecord", courseId: C, canonicalTitle: "Reflection Paper", kind: "item", status: "pending", grade: {} },
  { entityId: `grade:${C}:8`, entityType: "gradeRecord", courseId: C, canonicalTitle: "Week 3 Quiz", kind: "item", status: "graded", sourceEntityId: `quizBundle:${C}:12`, grade: { pointsEarned: 9, pointsPossible: 10, displayed: "9 / 10" } },
  // Calendar events that target the item are left out of Related items.
  { entityId: `calendar:${C}:1`, entityType: "calendarEvent", courseId: C, canonicalTitle: "Reflection Paper - Due", eventLabel: "Due", targetEntityId: `assignmentBundle:${C}:11`, dates: { dueAt: "2026-10-28T03:59:00.000Z" } },
  { entityId: `calendar:${C}:2`, entityType: "calendarEvent", courseId: C, canonicalTitle: "Reflection Paper - Peer review", eventLabel: "Peer review", targetEntityId: `assignmentBundle:${C}:11`, dates: { startAt: "2026-10-29T14:00:00.000Z" } }
];
const course = { courseId: C, title: "Criminal Justice - Fall 2026", code: "CJ 1100" };
const index = dash.buildIndex({ now: NOW, courses: [course], entities });
const groupOf = (groups, id) => groups.find((group) => group.id === id);
const detail = (idx, name, id) => dash.detailFor(idx, { name, id }, {});

// Assignment: content neighbors, work neighbors plus the grade. Calendar events are not listed.
const assignment = detail(index, "assignment", `assignmentBundle:${C}:11`);
const groups = assignment?.related || [];
check(groups.map((group) => group.id).join(",") === "work,content", `an assignment should list Work & grades, then Content, and no Calendar, got ${groups.map((group) => group.id)}`);
const content = groupOf(groups, "content");
check(content?.items.map((item) => item.title).join("|").startsWith("Week 3 Reading: Policing in America|Lecture: Police Discretion"), "content neighbors should follow the module's order");
check(!content?.items.some((item) => item.title === "Reflection Paper" || item.title === "Week 3 Quiz"), "a topic that opens work should not be listed as content");
check(content?.items[0].peek?.d2lUrl === `https://kennesaw.view.usg.edu/d2l/le/content/${C}/viewContent/1/View` && content.items[0].peek.title === "Week 3 Reading: Policing in America", "a content pill should carry the item's D2L link for the side panel");
check(content?.items[1].peek === null && content.items[1].route === `#/resources/${C}?item=${encodeURIComponent(`resource:${C}:2`)}`, "a content item with nothing to show should fall back to the Content screen");
check(!content?.items.some((item) => String(item.peek?.d2lUrl).startsWith("javascript:")) && content?.items.find((item) => item.title.startsWith("<img"))?.peek === null, "a content link that is not a web address should never reach the panel");
check(content?.items[1].line === "Link · Week 3 · Viewed", `a topic D2L reports as visited should say Viewed in its hover line, got ${content?.items[1].line}`);
check(content?.items[0].line === "File · Week 3" && !content.items[0].line.includes("Viewed"), "a topic with no progress record should not claim it is unseen");
const work = groupOf(groups, "work");
check(work?.items[0]?.kind === "quiz" && work.items[0].route === `#/quiz/${encodeURIComponent(`quizBundle:${C}:12`)}`, "a quiz in the same module should open its own pop-up");
check(!work?.items.some((item) => item.kind === "assignment"), "the item should not list itself");
const grade = work?.items.find((item) => item.kind === "grade");
check(grade?.route === `#/grade/${encodeURIComponent(`grade:${C}:7`)}` && grade.line === "Grade item · Not graded yet", "the grade pill should link by id and say it isn't graded yet");
const quizPill = work?.items[0];
check(quizPill?.peek?.mode === "summary" && quizPill.peek.route === quizPill.route && quizPill.peek.meta === "Quiz · Week 3" && quizPill.peek.text === "Ten questions.", "a quiz pill should open a summary that links to its own pop-up");
check(quizPill?.peek?.facts.map((fact) => fact.k).join(",") === "Due,Status" && quizPill.peek.facts[0].v.includes("Oct 29") && quizPill.peek.facts.at(-1).v === "Open", `a quiz summary should list its due date and status, got ${JSON.stringify(quizPill?.peek?.facts)}`);
check(grade?.peek?.mode === "summary" && grade.peek.facts[0].v === "Not graded yet" && grade.peek.text === "D2L hasn't posted a grade yet.", "a grade pill should open a summary of where it stands");
check(!groupOf(groups, "calendar"), "calendar events should not be listed, even when one targets the item");

// Quiz: its grade is found from the grade record's source when the quiz has no gradeEntityId.
const quizModel = detail(index, "quiz", `quizBundle:${C}:12`);
const quizGroups = quizModel?.related || [];
const quizGrade = groupOf(quizGroups, "work")?.items.find((item) => item.kind === "grade");
check(quizGrade?.line === "Grade item · Graded · 9 / 10", `a graded quiz should show its score, got ${quizGrade?.line}`);
check(groupOf(quizGroups, "work")?.items.some((item) => item.kind === "assignment"), "a quiz should list the assignment in its module");

// Rendering: side labels, icon-tile pill, hover card tied to its pill, escaped titles.
const html = dash.detailPage(assignment, { body: true });
check(html.includes('<h2>Related items <span class="rel-count">5</span></h2>') && html.includes('class="rel-label">Content<'), "the page should show a Related items card with a count and side labels");
const detailCard = html.match(/<section class="card detail">([\s\S]*?)<\/section>/)?.[1] || "";
check(html.includes('<section class="card related-card">') && !detailCard.includes("Related items"), "Related items should be its own card, not part of the content card");
check(html.indexOf('class="card related-card"') > html.indexOf('class="card side-card"') && html.indexOf('class="card related-card"') > html.indexOf('class="card detail"'), "the Related items card should come after the content and to-do cards");
check(/<(?:a|button) class="rel-pill" [^>]*aria-describedby="(rel-tip-\d+)">[\s\S]*?<div class="rel-tip" role="tooltip" id="\1">[^<]+<\/div>/.test(html), "each pill should be described by its own one-line hover card");
check(html.includes('<button class="rel-pill" type="button" data-action="peek-item" data-peek="') && html.includes(`&quot;d2lUrl&quot;:&quot;https://kennesaw.view.usg.edu/d2l/le/content/${C}/viewContent/1/View&quot;`), "a content pill should open the side panel and carry its D2L link");
check(html.includes(`<a class="rel-pill" href="#/resources/${C}?item=${encodeURIComponent(`resource:${C}:2`)}" aria-describedby=`), "a content item with nothing to show should still open the Content screen");
check(!html.includes("javascript:"), "an unsafe link should never reach the page");
check(html.indexOf('class="rel-label">Work &amp; grades<') < html.indexOf('class="rel-label">Content<') && !html.includes('class="rel-label">Calendar<') && !html.includes("Peer review"), "the page should read Work & grades, then Content, with no Calendar");
check(html.includes('class="rel-tile"') && html.includes('role="tooltip" id="rel-tip-1">Quiz · Week 3 · ') && !html.includes("rel-tip-foot") && !html.includes("rel-tip-facts"), "each pill should lead with an icon tile and show a one-line hover card");
check(!html.includes("<img src=x") && html.includes("&lt;img src=x"), "a topic title with markup should be escaped");
check(html.indexOf("Related items") > html.indexOf("Instructions"), "Related items should sit below the instructions");

// Nothing linked: no section at all. Older archives without module data keep only exact links.
const bare = dash.buildIndex({ now: NOW, courses: [course], entities: [entities[6]] });
const bareModel = detail(bare, "assignment", `assignmentBundle:${C}:11`);
check((bareModel?.related || []).length === 0 && !dash.detailPage(bareModel, { body: true }).includes("Related items"), "an item with nothing related should show no section");
const noModules = dash.buildIndex({ now: NOW, courses: [course], entities: entities.filter((entity) => entity.entityType !== "learningResource") });
const exactOnly = detail(noModules, "assignment", `assignmentBundle:${C}:11`)?.related || [];
check(exactOnly.map((group) => group.id).join(",") === "work" && exactOnly[0].items.length === 1, "without module data only the grade link should remain");

// A long module folds into "+N more" that opens the module.
const many = [entities[0], ...Array.from({ length: 12 }, (_, n) => topic(String(100 + n), `Reading ${n + 1}`)), topic("3", "Reflection Paper", { resourceType: "Link", urls: { download: quickLink("dropbox") } }), entities[6]];
const crowded = detail(dash.buildIndex({ now: NOW, courses: [course], entities: many }), "assignment", `assignmentBundle:${C}:11`)?.related || [];
const crowdedContent = groupOf(crowded, "content");
check(crowdedContent?.items.length === 6 && crowdedContent.more?.count === 6 && crowdedContent.more.route === `#/resources/${C}?module=50`, "a long module should show 6 pills and a +6 more link to the module");
check(dash.detailPage(detail(dash.buildIndex({ now: NOW, courses: [course], entities: many }), "assignment", `assignmentBundle:${C}:11`), { body: true }).includes('<span class="rel-count">12</span>'), "the count should include the pills folded into +N more");

// Wiring.
const css = read("src/dashboard/dashboard.css");
const events = read("src/dashboard/app-events.js");
check(/\.rel:hover \.rel-tip, \.rel:has\(:focus-visible\) \.rel-tip/.test(css), "the card should open on hover and on keyboard focus");
check(css.includes("@media (hover: none) { .rel-tip { display: none; } }"), "touch screens should skip the hover card");
check(css.includes('grid-template-areas: "head side" "main side" "related related"'), "the Related items card should span both columns under the content and to-do cards");
check(css.includes('"head" "side" "main" "related"') && css.includes('"head" "main" "side" "related"'), "in a narrow pop-up the Related items card should come last");
check(/\.related-card \{ grid-area: related;/.test(css), "the Related items card should sit in its own grid area");
check(css.includes("@container detail (max-width: 560px)") && css.includes(".rel-group { display: block; }"), "side labels should stack in a narrow pop-up");
check(events.includes("function placeRelatedCard") && events.includes('document.addEventListener("focusin", placeRelatedCard)'), "the card should reposition near an edge, on hover and focus");
check(read("dashboard.html").includes("model-related.js"), "the dashboard should load the related-items model");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Related items link the grade by id, module neighbors by title, and hide when empty.");
