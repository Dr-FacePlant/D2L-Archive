import { loadBackgroundHooks } from "./test-production-loader.mjs";

const { announcementProbeTasksFromApiItems } = loadBackgroundHooks();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const tasks = announcementProbeTasksFromApiItems("9900002", [
  { source: "announcement", title: "First Week Hello", url: "https://kennesaw.view.usg.edu/d2l/le/news/9900002/7012901/view", ids: { courseOrgUnitId: "9900002", newsItemId: "7012901" } },
  { source: "announcement", title: "Duplicate", url: "https://kennesaw.view.usg.edu/d2l/le/news/9900002/7012901/view", ids: { newsItemId: "7012901" } },
  { source: "assignment", title: "Not an announcement", ids: { newsItemId: "999" } },
  { source: "announcement", title: "Construct from id", ids: { newsItemId: "7032368" } },
  { source: "announcement", title: "Unsafe host", url: "https://example.com/d2l/le/news/9900002/999/view", ids: { newsItemId: "999" } }
]);

assert(tasks.length === 2, "two unique announcements create two probes");
assert(tasks.every((task) => task.expectedPageType === "announcementDetail"), "announcement probes target detail pages");
assert(tasks.every((task) => task.sourcePageType === "apiAnnouncementProbe"), "announcement probes keep source page type");
assert(tasks.some((task) => task.url.endsWith("/7012901/view")), "explicit detail URL is preserved");
assert(tasks.some((task) => task.url.endsWith("/7032368/view")), "detail URL is constructed from id");
assert(tasks.every((task) => !task.url.includes("example.com")), "unsafe hosts are rejected");

console.log("Announcement probe production tests passed.");
