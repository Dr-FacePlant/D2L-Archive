import { loadBackgroundHooks, useRepositoryForAccount } from "./test-production-loader.mjs";

const listeners = [];
const hooks = loadBackgroundHooks({
  chrome: { runtime: { onMessage: { addListener(listener) { listeners.push(listener); } } } }
});
const repository = hooks.createArchiveRepository(hooks.createMemoryArchiveAdapter(), { now: () => "2026-09-27T12:00:00.000Z" });
useRepositoryForAccount(hooks, repository);
const base = {
  crawledAt: "2026-09-27T12:00:00.000Z",
  pageType: "valenceApi",
  pageTitle: "Course resources",
  pageUrl: "https://kennesaw.view.usg.edu/d2l/home/900001",
  courseOrgUnitId: "900001",
  courseTitle: "Synthetic Course"
};
const rows = [
  {
    ...base,
    source: "contentTopic",
    title: "Project Instructions",
    description: "Module 2",
    dueAtText: "2026-10-01T16:00:00.000Z",
    itemUrl: "https://kennesaw.view.usg.edu/d2l/le/content/900001/viewContent/1001/View",
    downloadUrl: "https://kennesaw.view.usg.edu/d2l/le/content/900001/topics/files/download/1001/DirectFileTopicDownload",
    localPath: "D2L Export/synthetic/files/project.pdf",
    ids: JSON.stringify({ courseOrgUnitId: "900001", contentObjectId: "1001" }),
    columns: JSON.stringify({ module: "Module 2", topicType: "File", isBroken: false })
  },
  {
    ...base,
    source: "contentAttachment",
    title: "rubric.pdf",
    downloadUrl: "https://kennesaw.view.usg.edu/d2l/content/files/rubric.pdf",
    ids: JSON.stringify({ courseOrgUnitId: "900001", contentObjectId: "1001", fileId: "1101" }),
    columns: "{}"
  },
  {
    ...base,
    source: "progressRecord",
    title: "Content progress 1001",
    status: "completedOrProgressed",
    ids: JSON.stringify({ courseOrgUnitId: "900001", contentObjectId: "1001", userId: "self" }),
    columns: JSON.stringify({ visits: 3, totalTime: 12, lastVisited: "2026-09-26T18:00:00.000Z" })
  },
  {
    ...base,
    source: "calendarEvent",
    title: "Project Instructions",
    dueAtText: "2026-10-01T16:00:00.000Z",
    ids: JSON.stringify({ courseOrgUnitId: "900001", calendarEventId: "2001" }),
    columns: JSON.stringify({ startDateTime: "2026-10-01T16:00:00.000Z", endDateTime: "2026-10-01T16:00:00.000Z", entityType: "D2L.LE.Content.ContentObject.TopicCO", entityId: 1001 })
  },
  {
    ...base,
    source: "calendarEvent",
    title: "Office hours",
    dueAtText: "2026-10-02T16:00:00.000Z",
    ids: JSON.stringify({ courseOrgUnitId: "900001", calendarEventId: "2002" }),
    columns: JSON.stringify({ startDateTime: "2026-10-02T16:00:00.000Z", endDateTime: "2026-10-02T17:00:00.000Z" })
  },
  {
    ...base,
    source: "syllabusPolicy",
    title: "Late work policy",
    description: "Late work is accepted for seven days.",
    ids: JSON.stringify({ courseOrgUnitId: "900001", contentObjectId: "3001" }),
    columns: JSON.stringify({ derivedFromSource: "contentTopic" })
  },
  {
    ...base,
    source: "checklistItem",
    title: "Read the syllabus",
    status: "complete",
    ids: JSON.stringify({ courseOrgUnitId: "900001", checklistId: "4001", checklistItemId: "4002" }),
    columns: "{}"
  }
];

const result = await hooks.ingestAndOrganizeRows(rows, {
  repository,
  syncRunId: "resource-fixture",
  extractorVersion: "0.8.147",
  mode: "test",
  ingestedAt: "2026-09-27T12:00:00.000Z"
});
const resources = result.entities.filter((entity) => entity.entityType === "learningResource");
const events = result.entities.filter((entity) => entity.entityType === "calendarEvent");
const policies = result.entities.filter((entity) => entity.entityType === "coursePolicy");
const progress = result.entities.filter((entity) => entity.entityType === "studentProgress");
const tools = result.entities.filter((entity) => entity.entityType === "courseToolItem");
if (resources.length !== 1 || events.length !== 2 || policies.length !== 1 || progress.length !== 1 || tools.length !== 1) throw new Error("Resource organizers omitted entity types");
if (resources[0].attachmentCount !== 1 || resources[0].progress?.visits !== 3 || resources[0].localFilePath !== rows[0].localPath) throw new Error("Learning resource did not retain file and progress state");
if (events[0].targetEntityId !== resources[0].entityId) throw new Error("Calendar event did not resolve its exact content target");
const calendarBundle = await repository.getEntityBundle(events[0].entityId);
if (!calendarBundle.linkedEntities.some((entity) => entity.entityId === resources[0].entityId)) throw new Error("Calendar bundle omitted its linked resource entity");

const request = (method, params = {}) => new Promise((resolve, reject) => {
  const message = { type: "D2L_APP_API_REQUEST", protocolVersion: "1", requestId: `${method}-request`, method, params };
  const keepAlive = listeners[0](message, { id: "extension-test" }, resolve);
  if (keepAlive !== true) reject(new Error(`${method} did not keep the response channel alive`));
});
for (const [method, key] of [["resources.list", "items"], ["calendar.list", "items"], ["policies.list", "items"], ["progress.list", "items"], ["tools.list", "items"]]) {
  const response = await request(method, { courseId: "900001" });
  if (!response.ok || !response.data[key].length) throw new Error(`${method} did not expose resource knowledge`);
}
const upcoming = await request("dashboard.getUpcoming", { courseId: "900001", now: "2026-09-27T12:00:00.000Z", horizonDays: 30 });
if (upcoming.data.items.some((entity) => entity.entityId === events[0].entityId) || !upcoming.data.items.some((entity) => entity.entityId === events[1].entityId)) {
  throw new Error("Upcoming query did not suppress a linked calendar duplicate or omitted a standalone event");
}
const search = await request("search.query", { courseId: "900001", query: "project instructions" });
if (!search.ok || !search.data.entities.some((entity) => entity.entityId === resources[0].entityId)) throw new Error("Knowledge search did not find the resource entity");
const recentChanges = await request("dashboard.getRecentChanges", { courseId: "900001", limit: 20 });
if (!recentChanges.ok || !recentChanges.data.items.length) throw new Error("Recent changes API returned no ingest changes");
const syncState = await request("sync.getState", {});
if (!syncState.ok || syncState.data.latestSyncRunId !== "resource-fixture") throw new Error("Sync state did not expose the latest run");
const syncRun = await request("sync.getRun", { syncRunId: "resource-fixture" });
if (!syncRun.ok || syncRun.data.status !== "ingested") throw new Error("Sync run API did not return run details");

console.log("Resources, calendar events, policies, progress, and course tools organize exact links without duplicate upcoming work.");
