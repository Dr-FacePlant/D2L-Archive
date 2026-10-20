import { loadBackgroundHooks, loadContentHooks, createMemoryAccountEnvironment } from "./test-production-loader.mjs";

const fail = (message) => { throw new Error(message); };
const check = (value, message) => { if (!value) fail(message); };

const requestedUrls = [];
const content = loadContentHooks({
  fetch: async (url) => {
    requestedUrls.push(String(url));
    return { ok: false, status: 403 };
  }
});
const priorityPayload = await content.collectCourseApi("5001", { priorityOnly: true });
check(priorityPayload.apiStatus.surveys === "deferred" && priorityPayload.apiStatus.groups === "deferred", "short-visit API mode should identify deferred secondary areas");
check(requestedUrls.some((url) => url.includes("/dropbox/folders/")) && requestedUrls.some((url) => url.includes("/grades/values/myGradeValues")), "short-visit API mode omitted obligations or grades");
check(!requestedUrls.some((url) => /\/(surveys|groups|classlist|attendance)\//i.test(url)), "short-visit API mode spent requests on deferred course tools");
requestedUrls.length = 0;
await content.collectCourseApi("5001", { category: "announcements" });
check(requestedUrls.some((url) => url.includes("/news/")) && requestedUrls.length === 1, "announcement checkpoint should request and return only announcement API data");
requestedUrls.length = 0;
await content.collectCourseApi("5001", { category: "obligations" });
check(requestedUrls.some((url) => url.includes("/quizzes/")) && requestedUrls.some((url) => url.includes("/dropbox/folders/")) && !requestedUrls.some((url) => url.includes("/grades/")), "obligation checkpoint mixed in unrelated grades requests");

const d2lStatus = {
  toc: 200, quizzes: 200, dropbox: 200, dropboxMySubmissions: { "11": 200 }, dropboxCategories: 200,
  calendar: 200, gradeDefinitions: 200, gradeValues: 200, gradeSetup: 200, gradeCategories: 200, finalGrade: 200,
  news: 200, discussionForums: 200, discussionTopics: { "21": 200 }, discussionPosts: { "21": 200 },
  checklists: 200, checklistItems: { "31": 200 }, checklistCategories: { "31": 200 },
  surveys: 200, surveyAttempts: {}, surveyQuestions: {}, groups: 200, groupsByCategory: {}, classlist: 200, contentUserProgress: 200,
  courseOverview: 200, courseOverviewAttachment: 200, contentCompletion: 200, contentCompletionModules: 200
};
const deferredSecondary = { ...d2lStatus, surveys: "deferred", groups: "deferred", classlist: "deferred", contentUserProgress: "deferred", courseOverview: "deferred", courseOverviewAttachment: "deferred", contentCompletion: "deferred", contentCompletionModules: "deferred" };
const freshness = loadBackgroundHooks().freshnessForPayload({ apiStatus: deferredSecondary });
check(freshness.obligations.status === "fresh" && freshness.grades.status === "fresh", "successful priority categories were not recognized as fresh");
check(freshness.secondary.status === "deferred", "deferred secondary data should not be mislabeled as a failure");
const optional403 = loadBackgroundHooks().freshnessForPayload({ apiStatus: { ...d2lStatus, quizAttempts: { "7": 403, "8": 403 }, quizQuestions: { "7": 403, "8": 403 } } }).obligations;
check(optional403.status === "fresh" && optional403.blocked === 0, "expected student 403s on quiz attempts/questions must not make obligations partial");
check(loadBackgroundHooks().freshnessForPayload({ apiStatus: { ...d2lStatus, quizQuestions: { "7": 500 } } }).obligations.status === "partial", "an unexpected quiz question failure must keep obligations partial");
check(loadBackgroundHooks().freshnessForPayload({ apiStatus: { ...d2lStatus, quizAttempts: { "7": 403, "8": 200 }, quizAttemptDetails: { "8": { "1": 200 } } } }).obligations.status === "fresh", "mixed 403 and successful quiz attempts should stay fresh");
check(loadBackgroundHooks().freshnessForPayload({ apiStatus: { ...d2lStatus, dropbox: 403 } }).obligations.status === "partial", "a blocked core obligations route must stay partial");
check(loadBackgroundHooks().freshnessForPayload({ apiStatus: { ...d2lStatus, quizzes: 403, quizAttempts: {}, quizQuestions: {} } }).obligations.status === "partial", "a blocked quizzes list must stay partial");

let d2lPayload = {
  orgUnitId: "5001",
  apiStatus: d2lStatus,
  items: [{ source: "courseOffering", title: "Fall 2026 · Test Course", ids: { courseOrgUnitId: "5001" }, columns: { courseCode: "TEST 1000" } }]
};
const categoryCalls = [];
let failCalendarOnce = true;
let earlierCategoriesVisible = false;
let repository;
const categoryEvidence = {
  obligations: { source: "assignment", title: "Priority assignment", ids: { courseOrgUnitId: "5001", dropboxFolderId: "81" } },
  announcements: { source: "announcement", title: "Instructor notice", ids: { courseOrgUnitId: "5001", newsItemId: "82" } },
  calendar: { source: "calendarEvent", title: "Course event", ids: { courseOrgUnitId: "5001", calendarEventId: "83" } },
  discussions: { source: "discussionTopic", title: "Discussion topic", ids: { courseOrgUnitId: "5001", discussionTopicId: "84" } },
  grades: { source: "gradeItem", title: "Grade item", ids: { courseOrgUnitId: "5001", gradeObjectId: "85" } },
  materials: { source: "contentModule", title: "Course module", ids: { courseOrgUnitId: "5001", contentModuleId: "86" } },
  secondary: { source: "courseToolPage", title: "Course tools", ids: { courseOrgUnitId: "5001", checklistId: "87" } }
};
const hooks = loadBackgroundHooks({
  chrome: {
    storage: { local: { get: async () => ({ dashboardProfile: { accountId: "acct-a" } }) } },
    tabs: {
      get: async (tabId) => ({ id: tabId, url: "https://kennesaw.view.usg.edu/d2l/home" }),
      // Tab 43 simulates a D2L tab left over from before an extension reload: no receiver.
      query: async () => [
        { id: 43, url: "https://kennesaw.view.usg.edu/d2l/home", discarded: false, active: false, lastAccessed: 1 },
        { id: 44, url: "https://kennesaw.view.usg.edu/d2l/home/5001", discarded: false, active: true, lastAccessed: 2 }
      ],
      sendMessage: async (tabId, message) => {
        if (tabId === 43) throw new Error("Could not establish connection. Receiving end does not exist.");
        if (message.type === "D2L_PING") return { ok: true };
        if (message.type === "D2L_WHOAMI") return { ok: true, accountId: "acct-a" };
        if (message.type === "D2L_CURRENT_COURSES") return { ok: true, payload: [
          { orgUnitId: "5001", title: "Test Course" },
          { orgUnitId: "5001", title: "Duplicate Test Course" },
          { orgUnitId: "not-a-course", title: "Invalid" }
        ] };
        const category = message.category;
        categoryCalls.push(category);
        if (category === "announcements") {
          const saved = await repository.listEvidence({ courseId: "5001", limit: 100 });
        earlierCategoriesVisible = saved.total > 0;
        }
        if (category === "calendar" && failCalendarOnce) {
          failCalendarOnce = false;
          throw new Error("simulated interruption before calendar response");
        }
        return { ok: true, payload: { ...d2lPayload, account: { startId: "acct-a", endId: "acct-a" }, items: [...d2lPayload.items, categoryEvidence[category]] } };
      }
    }
  }
});
const env = createMemoryAccountEnvironment(hooks, { activeAccountId: "acct-a" });
repository = await env.registry.repositoryFor("acct-a");
const repositoryB = await env.registry.repositoryFor("acct-b");

const discovered = await hooks.discoverPriorityCourses("acct-a");
check(discovered.ok && discovered.accountId === "acct-a" && JSON.stringify(discovered.courseIds) === JSON.stringify(["5001"]), "an empty archive could not discover current courses through the verified live D2L tab");
const rejectedDiscovery = await hooks.discoverPriorityCourses("acct-b");
check(!rejectedDiscovery.ok && rejectedDiscovery.reason === "account-mismatch", "course discovery did not preserve account isolation");

const queued = await hooks.enqueuePriorityRefresh(["5001"], { accountId: "acct-a", focusCourseId: "5001", force: true, correlationId: "visit-a" });
const obligationJobId = "course-api-acct-a-5001-obligations";
const calendarJobId = "course-api-acct-a-5001-calendar";
check(queued.length === 7 && queued[0].queued && queued[0].jobId === obligationJobId, "priority refresh did not create deterministic category-level account-bound jobs");
const deduplicated = await hooks.enqueuePriorityRefresh(["5001"], { accountId: "acct-a", force: true, correlationId: "manual-sync-b" });
const pendingObligations = (await repository.listSyncJobs({ accountId: "acct-a", jobIds: [obligationJobId] }))[0];
check(deduplicated[0].deduplicated && pendingObligations.correlationId === "manual-sync-b", "a new explicit sync did not re-correlate its deduplicated pending job");
const otherAccount = await repositoryB.enqueueSyncJob({ jobId: "course-api-acct-b-5001-obligations", accountId: "acct-b", courseId: "5001", dedupeKey: "d2l:acct-b:5001:obligations", category: "obligations" });
check(otherAccount.job.accountId === "acct-b", "other-account work did not retain its partition");
const wrongAccountClaim = await repositoryB.claimSyncJob("worker-test", { accountId: "acct-b" });
check(wrongAccountClaim.jobId === "course-api-acct-b-5001-obligations", "account-specific queue claiming failed");
await repositoryB.updateSyncJob(wrongAccountClaim.jobId, { state: "queued", nextEligibleAt: new Date().toISOString() }, "worker-test");

check(await hooks.handleAutomaticSyncAlarm({ name: "unrelated-alarm" }) === null, "unrelated alarms should not run the D2L queue");
const result = await hooks.handleAutomaticSyncAlarm({ name: "student-archive-brief-sync" });
check(result.started && result.processed === 3, "the production alarm handler should process a bounded batch of category jobs");
check(earlierCategoriesVisible, `obligation evidence was not saved before announcement collection began (${categoryCalls.join(",")})`);
let jobs = await repository.listSyncJobs({ limit: 10 });
const interrupted = jobs.find((job) => job.jobId === calendarJobId);
check(interrupted?.state === "retry-wait" && interrupted.cursor === 0, "interruption did not preserve the unfinished category job");
await repository.updateSyncJob(calendarJobId, { state: "queued", nextEligibleAt: new Date().toISOString() });
const resumed = await hooks.handleAutomaticSyncAlarm({ name: "student-archive-brief-sync" });
check(resumed.started && resumed.processed === 3, "the production alarm did not resume unfinished category work");
jobs = await repository.listSyncJobs({ limit: 10 });
check(jobs.find((job) => job.jobId === calendarJobId)?.state === "completed", "priority category job did not complete after retry");
check((await repositoryB.listSyncJobs({ limit: 10 })).find((job) => job.jobId === "course-api-acct-b-5001-obligations")?.state === "queued", "worker claimed a job for a different signed-in account");
check(!jobs.some((job) => job.accountId === "acct-b"), "account A queue contains account B work");
const storedFreshness = await repository.getFreshness("course:acct-a:5001:api");
check(storedFreshness?.categories.obligations.status === "fresh" && storedFreshness.categories.calendar.status === "fresh", "account-scoped category freshness was not persisted accurately");
check(categoryCalls.join(",") === "obligations,announcements,calendar,calendar,discussions,grades", "the worker did not retry the interrupted category and continue by priority");
const categoryActivities = await repository.listActivity({ operation: "sync.category-refresh", limit: 20 });
check(categoryActivities.length === 6 && categoryActivities.every((event) => event.correlationId === "manual-sync-b"), "category activity did not share the latest explicit-sync correlation ID");
check(await repository.getFreshness("course:acct-b:5001:api") === null, "freshness leaked between account partitions");

const active = await repositoryB.claimSyncJob("worker-one", { accountId: "acct-b" });
const competing = await repositoryB.claimSyncJob("worker-two", { accountId: "acct-b" });
check(active && !competing, "a live queue lease was claimed twice");

console.log("Short-visit API selection, account-scoped category queueing, bounded workers, retry, and freshness passed.");
