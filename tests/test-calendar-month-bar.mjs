// The month chevrons sit in a bar on top of the calendar card, and Today is a
// full-width bar above the selected-day card (chosen Oct 11, 2026, mockup 3 C+A).
process.env.TZ = "America/New_York";

import { loadDashboard } from "./test-dashboard-loader.mjs";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();
const index = dash.buildIndex({ now: "2026-10-11T16:00:00.000Z", courses: [], entities: [], settings: {} });
const page = dash.calendarPage(dash.calendarModel(index, { month: "2026-10", day: "2026-10-13" }));

// 1. The page head holds only the title; no Today button or chevrons in the corner.
const head = page.slice(page.indexOf('<div class="page-head">'), page.indexOf('<div class="cols top">'));
check(!/Today|Previous month|Next month/.test(head), "the page head should no longer hold Today or the chevrons");

// 2. The chevrons and month sit in a bar at the top of the calendar card, before the weekday row.
const card = page.slice(page.indexOf('<section class="card cal">'), page.indexOf('<div class="cal-head">'));
check(/class="cal-bar"/.test(card), "the calendar card should start with the month bar");
check(/class="icon-btn" href="[^"]*month=2026-09[^"]*" aria-label="Previous month"/.test(card), "the left stepper button should go to September");
check(/<span class="cal-month">October 2026<\/span>/.test(card), "the bar should show October 2026");
check(/class="icon-btn" href="[^"]*month=2026-11[^"]*" aria-label="Next month"/.test(card), "the right stepper button should go to November");
const monthBar = card.slice(card.indexOf('<div class="cal-bar">'), card.indexOf("</div>", card.indexOf('<div class="cal-bar">')));
check(!monthBar.includes('class="stepper"') && monthBar.indexOf("Previous month") < monthBar.indexOf("cal-month") && monthBar.indexOf("cal-month") < monthBar.indexOf("Next month"), "the month controls should be left icon, centered month, right icon");

// 3. Today is the first thing in the side column, above the selected-day card, and goes back to today.
const side = page.slice(page.indexOf('<div class="side stack"'));
const bar = side.match(/^<div class="side stack"[^>]*>\s*<a class="today-bar" href="([^"]*)"/);
check(bar, "the Today bar should sit first in the side column");
check(bar && bar[1].includes("day=2026-10-11") && bar[1].includes("month=2026-10"), `Today should go to Oct 11, got ${bar?.[1]}`);
check(side.indexOf("today-bar") < side.indexOf("Tue, Oct 13"), "the Today bar should sit above the selected-day card");

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Calendar month bar sits on the card; Today is a full bar above the day box.");
