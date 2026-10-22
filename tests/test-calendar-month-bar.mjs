// The month chevrons sit in a bar on top of the calendar card, and Today is a
// 48px icon-only shortcut in the selected-day header (chosen Oct 11, 2026).
process.env.TZ = "America/New_York";

import fs from "node:fs";
import path from "node:path";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, "..", file), "utf8");
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

// 3. Today is a 48px icon-only link in the selected-day card header, and it goes back to today.
const side = page.slice(page.indexOf('<div class="side stack"'));
const jump = side.match(/<a class="today-jump" href="([^"]*)" aria-label="Go to today" title="Today">/);
check(jump, "the Today shortcut should sit in the selected-day card header");
check(jump && jump[1].includes("day=2026-10-11") && jump[1].includes("month=2026-10"), `Today should go to Oct 11, got ${jump?.[1]}`);
check(side.indexOf("today-jump") > side.indexOf('<section class="card card-pad">'), "the Today shortcut should be inside the day card, not above it");
check(!page.includes("today-bar"), "the standalone Today bar should be gone");

// 4. The header carries the long date; the shortcut is icon-only.
const todayPage = dash.calendarPage(dash.calendarModel(index, { month: "2026-10", day: "2026-10-11" }));
const todaySide = todayPage.slice(todayPage.indexOf('<div class="side stack"'));
check(side.includes(">Tuesday, October 13th</h2>"), "the day header should spell out the selected date");
check(todaySide.includes(">Sunday, October 11th</h2>"), "the day header should spell out the selected date even when it is today");
check(!todayPage.includes("today-tag"), "the separate Today status tag should be gone");
check(todaySide.includes('aria-label="Go to today"') && todaySide.includes('title="Today"'), "the icon-only shortcut should keep its accessible label and tooltip");
check(!/>Today</.test(todaySide), "the Today shortcut should not add a second visible Today label");
const now = new Date("2026-10-11T16:00:00.000Z");
check(dash.fmtLongDate("2026-10-21T12:00:00", now) === "Wednesday, October 21st", "fmtLongDate should use the weekday, month, and ordinal");
check(dash.fmtLongDate("2027-01-01T12:00:00", now) === "Friday, January 1st, 2027", "fmtLongDate should add a different year");

const css = read("src/dashboard/dashboard.css");
check(/\.today-jump \{[^}]*width: 48px;[^}]*height: 48px;[^}]*background: var\(--accent\)[^}]*color: var\(--on-accent\)/.test(css), "the Today shortcut should be a 48px blue icon button");
check(!css.includes(".today-bar") && !css.includes(".today-tag"), "the old Today bar and tag should not leave dead CSS");

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Calendar month bar sits on the card; Today is a 48px icon button in the long-date header.");
