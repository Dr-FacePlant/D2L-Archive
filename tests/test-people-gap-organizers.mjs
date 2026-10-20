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
  pageTitle: "Synthetic Course",
  pageUrl: "https://kennesaw.view.usg.edu/d2l/home/900001",
  courseOrgUnitId: "900001",
  courseTitle: "Synthetic Course",
  itemUrl: "https://kennesaw.view.usg.edu/d2l/home/900001"
};
const rows = [
  {
    ...base,
    source: "classlistEntry",
    title: "Instructor Example",
    status: "visible",
    ids: JSON.stringify({ courseOrgUnitId: "900001", userId: "42" }),
    columns: JSON.stringify({ recoveredFrom: "classlistApi", roleId: 101, roleName: "Instructor", profileIdentifier: "profile-42" })
  },
  {
    ...base,
    source: "externalLink",
    title: "Publisher Courseware",
    itemUrl: "https://publisher.example.edu/courseware/week-1",
    ids: JSON.stringify({ courseOrgUnitId: "900001" }),
    columns: JSON.stringify({ linkKind: "external" })
  },
  {
    ...base,
    source: "announcement",
    title: "Welcome",
    ids: JSON.stringify({ courseOrgUnitId: "900001", newsItemId: "81" }),
    columns: JSON.stringify({ attachmentCount: 0 })
  },
  {
    ...base,
    source: "quizSummaryRow",
    title: "Exam 1",
    ids: JSON.stringify({ courseOrgUnitId: "900001", quizId: "91" }),
    columns: JSON.stringify({ recoveredFrom: "quizSummaryPage" })
  },
  {
    ...base,
    source: "apiProbe",
    title: "quiz attempts API 403",
    status: "blocked",
    ids: JSON.stringify({ courseOrgUnitId: "900001", quizId: "91" }),
    columns: JSON.stringify({ status: 403, evidenceCount: 0 })
  },
  {
    ...base,
    source: "apiProbe",
    title: "checklists API 200",
    status: "availableEmpty",
    ids: JSON.stringify({ courseOrgUnitId: "900001" }),
    columns: JSON.stringify({ status: 200, evidenceCount: 0 })
  },
  {
    ...base,
    source: "apiProbe",
    title: "classlist API 200",
    status: "available",
    ids: JSON.stringify({ courseOrgUnitId: "900001" }),
    columns: JSON.stringify({ status: 200, evidenceCount: 1 })
  }
];

const result = await hooks.ingestAndOrganizeRows(rows, {
  repository,
  syncRunId: "people-gap-fixture",
  extractorVersion: "0.8.151",
  mode: "test",
  ingestedAt: "2026-09-27T12:00:00.000Z"
});
const person = result.entities.find((entity) => entity.entityType === "person");
if (!person || person.userId !== "42" || person.roleName !== "Instructor") throw new Error("Classlist person was not normalized");
const external = result.entities.find((entity) => entity.entityType === "externalResource");
if (!external || external.extractionBoundary !== "intentionallyUnsupportedExternalSystem") throw new Error("External resource boundary was not retained");
const states = result.entities.filter((entity) => entity.entityType === "extractionState");
const state = (id) => states.find((entity) => entity.capabilityId === id);
if (states.length !== 19) throw new Error(`Expected 19 extraction capability states, got ${states.length}`);
if (state("quizAttempts")?.classification !== "permissionBlocked" || state("quizAttempts")?.coverage !== "partial") throw new Error("Blocked quiz attempts were not classified as a partial permission gap");
if (state("checklists")?.classification !== "unavailableCourseData") throw new Error("Empty checklists were not classified as unavailable course data");
if (state("rubrics")?.classification !== "untestedCapability") throw new Error("Unproven rubrics were not classified as untested");
if (state("announcementAttachments")?.classification !== "unavailableCourseData") throw new Error("Zero-count announcement attachments were not classified as absent");
if (state("externalSystems")?.classification !== "intentionallyUnsupportedExternalSystem") throw new Error("External system was not classified as an intentional boundary");
if (state("classlist")?.classification !== "extracted") throw new Error("Available classlist was not classified as extracted");

const request = (method, params = {}) => new Promise((resolve, reject) => {
  const message = { type: "D2L_APP_API_REQUEST", protocolVersion: "1", requestId: `${method}-request`, method, params };
  const keepAlive = listeners[0](message, { id: "extension-test" }, resolve);
  if (keepAlive !== true) reject(new Error(`${method} did not keep the response channel alive`));
});
const people = await request("people.list", { courseId: "900001" });
if (!people.ok || people.data.items.length !== 1) throw new Error("People API did not expose classlist entities");
const externals = await request("externalResources.list", { courseId: "900001" });
if (!externals.ok || externals.data.items.length !== 1) throw new Error("External resources API did not expose link entities");
const gaps = await request("gaps.list", { courseId: "900001" });
if (!gaps.ok || gaps.data.items.some((item) => item.classification === "extracted") || gaps.data.summary.permissionBlocked !== 1) throw new Error("Gap API did not filter covered states or summarize classifications");
const allStates = await request("gaps.list", { courseId: "900001", includeCovered: true });
if (allStates.data.items.length !== 19 || allStates.data.totalCapabilities !== 19) throw new Error("Gap API did not expose the complete capability matrix");

console.log("People, external resources, and extraction gaps are normalized and queryable.");
