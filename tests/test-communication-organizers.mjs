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
  pageTitle: "Communications",
  pageUrl: "https://kennesaw.view.usg.edu/d2l/home/900001",
  courseOrgUnitId: "900001",
  courseTitle: "Synthetic Course"
};
const rows = [
  {
    ...base,
    source: "announcement",
    title: "Welcome",
    description: "The complete announcement body with meaningful instructions for students.",
    status: "publishedOrVisible",
    ids: JSON.stringify({ courseOrgUnitId: "900001", newsItemId: "5001" }),
    columns: JSON.stringify({ startDate: "2026-09-20T12:00:00.000Z", publishedDate: "2026-09-20T12:00:00.000Z", attachmentCount: 1 })
  },
  {
    ...base,
    pageType: "announcementDetail",
    source: "announcement",
    title: "Welcome",
    description: "Welcome Posted Sep 20, 2026",
    ids: JSON.stringify({ courseOrgUnitId: "900001", newsItemId: "5001" }),
    columns: JSON.stringify({ recoveredFrom: "announcementDetailPage", postedAtText: "Posted Sep 20, 2026 8:00 AM" })
  },
  {
    ...base,
    source: "announcementAttachment",
    title: "welcome.pdf",
    downloadUrl: "https://kennesaw.view.usg.edu/d2l/api/le/1.75/900001/news/5001/attachments/88",
    ids: JSON.stringify({ courseOrgUnitId: "900001", newsItemId: "5001", fileId: "88" }),
    columns: "{}"
  },
  {
    ...base,
    source: "discussionForum",
    title: "Module Discussions",
    description: "Choose a module and respond.",
    status: "visible",
    ids: JSON.stringify({ courseOrgUnitId: "900001", discussionForumId: "6001" }),
    columns: "{}"
  },
  {
    ...base,
    source: "discussionTopic",
    title: "Module 1",
    description: "Introduce yourself to the class.",
    status: "visible",
    gate: "mustPostFirst",
    ids: JSON.stringify({ courseOrgUnitId: "900001", discussionForumId: "6001", discussionTopicId: "7001" }),
    columns: JSON.stringify({ scoreOutOf: 5 })
  },
  {
    ...base,
    source: "discussionPost",
    title: "Hello",
    description: "A visible student post body.",
    status: "visible",
    ids: JSON.stringify({ courseOrgUnitId: "900001", discussionForumId: "6001", discussionTopicId: "7001", postId: "8001" }),
    columns: JSON.stringify({ author: "Student", parentPostId: "" })
  },
  {
    ...base,
    source: "discussionPost",
    title: "Re: Hello",
    description: "A visible reply body.",
    status: "visible",
    ids: JSON.stringify({ courseOrgUnitId: "900001", discussionForumId: "6001", discussionTopicId: "7001", postId: "8002" }),
    columns: JSON.stringify({ author: "Instructor", parentPostId: "8001" })
  },
  {
    ...base,
    source: "discussionAttachment",
    title: "reply.pdf",
    downloadUrl: "https://kennesaw.view.usg.edu/d2l/discussions/files/reply.pdf",
    ids: JSON.stringify({ courseOrgUnitId: "900001", discussionForumId: "6001", discussionTopicId: "7001", postId: "8002", fileId: "9001" }),
    columns: "{}"
  },
  {
    ...base,
    source: "discussionFeedback",
    title: "Module 1 - Feedback",
    description: "5 / 5 100%",
    status: "graded",
    ids: JSON.stringify({ courseOrgUnitId: "900001", discussionTopicId: "7001" }),
    columns: JSON.stringify({ pointsEarned: 5, pointsPossible: 5, percent: 100 })
  }
];

const result = await hooks.ingestAndOrganizeRows(rows, {
  repository,
  syncRunId: "communications-fixture",
  extractorVersion: "0.8.146",
  mode: "test",
  ingestedAt: "2026-09-27T12:00:00.000Z"
});

if (result.ingest.added !== rows.length) throw new Error(`Page and API announcement observations collided: ${JSON.stringify(result.ingest)}`);
const announcement = result.entities.find((entity) => entity.entityType === "announcement");
const forum = result.entities.find((entity) => entity.entityType === "discussionForum");
const thread = result.entities.find((entity) => entity.entityType === "discussionThread");
if (!announcement || !forum || !thread) throw new Error("Communication organizers omitted an entity type");
if (!announcement.body.includes("meaningful instructions") || announcement.attachmentCount !== 1) throw new Error("Announcement body or attachment was not organized");
if (thread.gate !== "mustPostFirst" || thread.posts.count !== 2 || thread.posts.replies !== 1 || thread.attachmentCount !== 1) throw new Error("Discussion participation state is incorrect");
if (thread.grading.pointsEarned !== 5 || thread.grading.pointsPossible !== 5 || thread.grading.percent !== 100) throw new Error("Discussion grading state is incorrect");

const bundle = await repository.getEntityBundle(thread.entityId);
if (!bundle.linkedEntities.some((entity) => entity.entityId === forum.entityId)) throw new Error("Discussion thread bundle did not include its forum entity");

const request = (method, params = {}) => new Promise((resolve, reject) => {
  const message = { type: "D2L_APP_API_REQUEST", protocolVersion: "1", requestId: `${method}-request`, method, params };
  const keepAlive = listeners[0](message, { id: "extension-test" }, resolve);
  if (keepAlive !== true) reject(new Error(`${method} did not keep the response channel alive`));
});
const announcements = await request("announcements.list", { courseId: "900001" });
const discussions = await request("discussions.list", { courseId: "900001" });
if (announcements.data.items.length !== 1 || discussions.data.forums.length !== 1 || discussions.data.threads.length !== 1) {
  throw new Error("Communication list APIs did not return organized entities");
}

console.log("Announcements and discussions organize bodies, attachments, posts, replies, grades, gates, and entity links.");
