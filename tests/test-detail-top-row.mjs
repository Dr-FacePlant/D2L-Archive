// Assignment and quiz pop-ups keep a steady 360px top row, so the Related items
// card starts at the same height on every page. A long body sits in a clamp
// that Show more opens, and the to-do card grows with it. Other detail pages
// keep their usual layout.
process.env.TZ = "America/New_York";

import fs from "node:fs";
import path from "node:path";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const dash = loadDashboard();
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const C = "9900004";
const NOW = "2026-10-20T12:00:00.000Z";
const entities = [
  { entityId: `assignmentBundle:${C}:11`, entityType: "assignmentBundle", courseId: C, canonicalTitle: "Reflection Paper", summary: "Write two pages on police discretion. ".repeat(40), dates: { dueAt: "2026-10-28T03:59:00.000Z" }, urls: {} },
  { entityId: `quizBundle:${C}:12`, entityType: "quizBundle", courseId: C, canonicalTitle: "Week 3 Quiz", description: "Ten questions.", dates: { dueAt: "2026-10-30T03:59:00.000Z" }, attempts: { completed: 0 }, urls: {} },
  { entityId: `announcement:${C}:5`, entityType: "announcement", courseId: C, canonicalTitle: "Welcome", body: "Hello." }
];
const index = dash.buildIndex({ now: NOW, courses: [{ courseId: C, title: "Criminal Justice", code: "CJ 1100" }], entities });
const page = (name, id) => dash.detailPage(dash.detailFor(index, { name, id }, {}), { body: true });

for (const [name, id] of [["assignment", `assignmentBundle:${C}:11`], ["quiz", `quizBundle:${C}:12`]]) {
  const html = page(name, id);
  check(/<div class="detail-layout[^"]*\bis-fixed\b/.test(html), `a ${name} pop-up should use the fixed top row`);
  check(html.includes('<div class="detail-top">'), `a ${name} pop-up should wrap its title, details and to-do card in .detail-top`);
  const order = ['class="card detail-head"', 'class="card detail"', 'class="card side-card'].map((marker) => html.indexOf(marker));
  check(order.every((at) => at > html.indexOf('<div class="detail-top">')), `a ${name}'s title, details and to-do card should sit inside .detail-top`);
  check(html.includes('<div class="detail-clamp" id="detail-clamp">'), `a ${name}'s text should sit in the clamp`);
  check(/<button class="detail-more" type="button" data-action="detail-more" aria-expanded="false" aria-controls="detail-clamp" hidden>Show more<\/button>/.test(html), `a ${name} should start with a hidden, labelled Show more button`);
  const clampAt = html.indexOf('class="detail-clamp"');
  check(html.indexOf('class="facts"') < clampAt, `a ${name}'s dates should stay above the clamp so they never fade out`);
}

// The fixed row is only for assignments and quizzes.
const announcement = page("announcement", `announcement:${C}:5`);
check(!announcement.includes("is-fixed") && !announcement.includes("detail-top") && !announcement.includes("detail-clamp"), "an announcement should keep its usual layout");

// CSS: 360px band at wide widths, grows when opened, drops away when narrow.
const css = read("src/dashboard/dashboard.css");
const wide = css.match(/@container detail \(min-width: 781px\) \{([\s\S]*?)\n\}/)?.[1] || "";
check(/\.detail-layout\.is-fixed > \.detail-top \{[^}]*height: 360px;[^}]*align-items: stretch;/.test(wide), "the top row should be a fixed 360px with both columns stretched");
check(/\.detail-layout\.is-fixed\.is-open > \.detail-top \{ height: auto; \}/.test(wide), "Show more should let the row grow so the to-do card matches the details card");
check(/\.detail-layout\.is-fixed > \.detail-top > \.side-card \{ align-self: stretch; \}/.test(wide), "the to-do card should stretch to the row's height, not sit at its own height");
check(/\.detail-layout\.is-fixed\.is-clipped:not\(\.is-open\) \.detail-clamp::after/.test(wide), "a clipped body should fade out");
check(/grid-template-areas: "top" "related";/.test(wide), "the Related items card should sit below the fixed row");
check(/\.detail-top \{ display: contents; \}/.test(css), "the wrapper should step aside in the narrow layout");
check(!/\.detail-layout\.has-todo > \.(detail-head|detail)\b/.test(css) && !/\.detail-layout:not\(\.has-todo\) > \.side-card/.test(css), "narrow rules must not depend on the cards being direct children");
check(css.includes(".detail-layout > .side-card, .detail-top > .side-card { grid-area: side; }"), "the to-do card should keep its grid area inside the wrapper");

// Wiring.
const render = read("src/dashboard/app-render.js");
const events = read("src/dashboard/app-events.js");
check(render.includes("function markDetailClamp") && render.includes("clamp.scrollHeight > clamp.clientHeight + 1"), "Show more should appear only when the text overflows the row");
check(render.includes("new ResizeObserver") && render.includes("fitDetailClamp(body)") && render.includes("fitDetailClamp(node)"), "the overflow check should run on every detail draw and when the width changes");
check(render.includes("function setDetailMore") && render.includes('more.textContent = open ? "Show less" : "Show more"') && render.includes('more.setAttribute("aria-expanded", String(open))'), "the button should flip its label and aria-expanded");
check(render.includes("reopen") && render.includes("setDetailMore(body.querySelector"), "redrawing the same item should keep Show more open");
check(events.includes('action === "detail-more"') && events.includes("setDetailMore(layout, !layout?.classList.contains(\"is-open\"))"), "clicking Show more should toggle the row");
check(read("src/dashboard/model-related.js").includes("const MAX_CONTENT = 6;"), "Related items should fold after 6 content pills");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Assignment and quiz pop-ups keep a fixed top row, with Show more growing the to-do card to match.");
