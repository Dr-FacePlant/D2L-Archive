import { loadBackgroundHooks } from "./test-production-loader.mjs";

const tabId = 41;
let currentUrl = "https://kennesaw.view.usg.edu/d2l/home/123";
const navigatedUrls = [];
const chrome = {
  tabs: {
    update: async (id, update) => {
      if (id !== tabId) throw new Error(`Unexpected tab ${id}`);
      currentUrl = update.url;
      navigatedUrls.push(currentUrl);
      return { id, url: currentUrl };
    },
    get: async (id) => ({ id, url: currentUrl }),
    sendMessage: async (id, message) => {
      if (id !== tabId) throw new Error(`Unexpected tab ${id}`);
      if (message.type === "D2L_COLLECT_COURSE_API") {
        return {
          ok: true,
          payload: {
            apiStatus: { calendar: 200 },
            counts: { calendarEvents: 1 },
            items: [{
              source: "calendarEvent",
              title: "API Exam",
              description: "From Valence",
              url: "https://kennesaw.view.usg.edu/d2l/le/calendar/123",
              dueAtText: "2026-10-01T12:00:00Z",
              ids: { courseOrgUnitId: "123", calendarEventId: "9" }
            }]
          }
        };
      }
      if (message.type === "D2L_EXTRACT_VISIBLE_PAGE") {
        return {
          ok: true,
          payload: {
            extractor: { extractedAt: "2026-09-24T12:00:00.000Z" },
            pageType: "courseTool",
            page: { url: currentUrl, title: "Test Course", text: "" },
            course: { orgUnitId: "123", title: "Test Course" },
            diagnostics: { emptyState: true, loading: false, expectedSource: null, expectedCount: 0 },
            items: []
          }
        };
      }
      throw new Error(`Unexpected message ${message.type}`);
    }
  }
};

const immediateTimeout = (callback) => {
  callback();
  return 0;
};
const { collectApiRows } = loadBackgroundHooks({ chrome, setTimeout: immediateTimeout });
const rows = [
  {
    courseOrgUnitId: "123",
    source: "calendarEvent",
    title: "Old rendered event",
    itemUrl: "https://kennesaw.view.usg.edu/d2l/le/calendar/123",
    columns: "{}"
  },
  {
    courseOrgUnitId: "123",
    source: "discussionTopic",
    title: "Visible discussion evidence",
    itemUrl: "https://kennesaw.view.usg.edu/d2l/le/123/discussions/topics/456/View",
    columns: JSON.stringify({ recoveredFrom: "discussionTopicPage" })
  }
];
const pages = [{
  pageType: "courseHome",
  page: { url: currentUrl, title: "Test Course" },
  course: { orgUnitId: "123", title: "Test Course" },
  items: []
}];

const summary = await collectApiRows({ id: tabId }, rows, pages);
const apiRows = rows.filter((row) => row.source === "calendarEvent" && row.title === "API Exam");

if (summary.failed.length !== 0) throw new Error(`API collection failed: ${JSON.stringify(summary.failed)}`);
if (summary.courses.length !== 1) throw new Error("Expected one API course summary");
if (summary.replaced !== 1) throw new Error(`Expected one replaced row, got ${summary.replaced}`);
if (summary.added !== 1) throw new Error(`Expected one API row, got ${summary.added}`);
if (apiRows.length !== 1) throw new Error("API calendar event was not merged exactly once");
if (rows.some((row) => row.title === "Old rendered event")) throw new Error("Stale rendered calendar row survived");
if (!rows.some((row) => row.title === "Visible discussion evidence")) throw new Error("Live discussion evidence was removed");
if (summary.courses[0].apiStatus.calendar !== 200) throw new Error("API status was not preserved");
if (summary.courses[0].counts.calendarEvents !== 1) throw new Error("API counts were not preserved");
if (summary.gradeProbePages.visited !== 1 || summary.gradeProbePages.failed !== 0) {
  throw new Error(`Unexpected grade probe summary: ${JSON.stringify(summary.gradeProbePages)}`);
}
if (summary.courseToolProbePages.visited !== 7 || summary.courseToolProbePages.failed !== 0) {
  throw new Error(`Unexpected course tool probe summary: ${JSON.stringify(summary.courseToolProbePages)}`);
}
if (navigatedUrls.length !== 9) throw new Error(`Expected 9 navigations, got ${navigatedUrls.length}`);

console.log("API collection orchestration replaced stale rows, preserved live evidence, and ran targeted probes.");
