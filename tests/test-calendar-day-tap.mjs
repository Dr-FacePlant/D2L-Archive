import { appSource } from "./app-source.mjs";
// Tapping a gray day from the month before or after (Sep 27 on the October
// grid) only selects it; the calendar stays on October. Only the chevrons
// change the month (reported Oct 11, 2026).
process.env.TZ = "America/New_York";

import fs from "node:fs";
import path from "node:path";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();
const index = dash.buildIndex({ now: "2026-10-11T16:00:00.000Z", courses: [], entities: [], settings: {} });

// 1. The October grid's gray Sep 27 cell says the month on screen is October.
const october = dash.calendarPage(dash.calendarModel(index, { month: "2026-10" }));
const sep27 = october.match(/<div class="cal-cell out[^"]*" data-action="select-day" data-day="2026-09-27" data-month="([\d-]+)"/);
check(sep27?.[1] === "2026-10", `the gray Sep 27 cell should carry the October month, got ${sep27?.[1]}`);
// Days after the month too: the September grid ends with gray Oct 1–3.
const september = dash.calendarPage(dash.calendarModel(index, { month: "2026-09" }));
const oct3 = september.match(/<div class="cal-cell out[^"]*" data-action="select-day" data-day="2026-10-03" data-month="([\d-]+)"/);
check(oct3?.[1] === "2026-09", `the gray Oct 3 cell should carry the September month, got ${oct3?.[1]}`);

// 2. Selecting Sep 27 while on October keeps the October grid and highlights Sep 27.
const picked = dash.calendarPage(dash.calendarModel(index, { month: "2026-10", day: "2026-09-27" }));
check(/data-day="2026-10-31"/.test(picked) && /<div class="cal-cell out[^"]*sel[^"]*" data-action="select-day" data-day="2026-09-27"/.test(picked), "picking Sep 27 on the October grid should keep October and highlight Sep 27");

// 3. The tap keeps the month on screen instead of the tapped day's month.
const app = appSource();
const handler = app.slice(app.indexOf('action === "select-day"'), app.indexOf('action === "read-update"'));
check(/params\.set\("month", actionNode\.dataset\.month \|\|/.test(handler), "a day tap should keep the month on screen");

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Tapping a gray day keeps the calendar on the month you're viewing.");
