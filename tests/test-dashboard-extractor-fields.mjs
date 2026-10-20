// The dashboard needs D2L fields the extractor used to drop. This replays the
// Valence payload shapes seen live on 2026-09-28 through the real collector and
// organizers, and checks each field survives to the entity the dashboard reads.
import { loadBackgroundHooks, loadContentHooks, loadSharedHooks } from "./test-production-loader.mjs";

const OU = "777";
const routes = new Map(Object.entries({
  "/d2l/api/lp/1.49/users/whoami": { Identifier: "555" },
  [`/d2l/api/lp/1.49/enrollments/myenrollments/${OU}`]: { OrgUnit: { Id: 777, Name: "Test Course Section 01 Fall Semester 2026 CO", Code: "CO.430.TEST1101.12345.20272" }, Access: { IsActive: true, StartDate: "2026-08-24T04:00:00.000Z", EndDate: "2026-12-31T05:00:00.000Z", CanAccess: true } },
  [`/d2l/api/le/1.67/${OU}/content/toc`]: { Modules: [{ ModuleId: 10, Title: "Week 1", StartDateTime: "2026-08-24T12:00:00.000Z", Description: { Text: "", Html: "" }, Modules: [], Topics: [
    { TopicId: 11, Title: "Reading", TypeIdentifier: "File", Url: "/content/enforced/777/reading.pdf", CompletionType: 2 },
    { TopicId: 12, Title: "Georgia reference", TypeIdentifier: "Link", Url: "https://www.georgiaencyclopedia.org/topics/government-politics" }
  ] }] },
  [`/d2l/api/le/1.67/${OU}/quizzes/`]: { Objects: [{ QuizId: 21, Name: "Quiz 1", IsActive: true, GradeItemId: 31,
    Description: { Text: { Text: "Once you start, you will have 15 minutes.", Html: "<p>Once you start…</p>" }, IsDisplayed: true },
    Instructions: { Text: { Text: "", Html: "" }, IsDisplayed: false },
    StartDate: "2026-09-01T20:00:00.000Z", EndDate: "2026-09-03T03:59:59.000Z", DueDate: "2026-09-03T03:59:59.000Z",
    SubmissionTimeLimit: { IsEnforced: true, ShowClock: true, TimeLimitValue: 20 }, AttemptsAllowed: { IsUnlimited: false, NumberOfAttemptsAllowed: 1 } }] },
  [`/d2l/api/le/1.67/${OU}/dropbox/folders/`]: [{ Id: 41, Name: "Paper", CategoryId: 51, GradeItemId: 32, DueDate: "2026-09-14T03:59:00.000Z",
    CustomInstructions: { Text: "Fill in the attached timeline.", Html: "" }, Attachments: [{ FileId: 61, FileName: "Timeline Template.docx", Size: 16183 }],
    Assessment: { ScoreDenominator: 10, Rubrics: [{ RubricId: 71 }] }, Availability: null }],
  [`/d2l/api/le/unstable/${OU}/rubrics?objectType=Dropbox&objectId=41`]: [{ RubricId: 71, Name: "Timeline rubric", IsScoreVisibleToAssessedUsers: true,
    CriteriaGroups: [{ Levels: [{ Id: 1, Name: "Level 4", Points: 5 }, { Id: 2, Name: "Level 1", Points: 0 }], Criteria: [{ Id: 9, Name: "Weekly goals" }] }], OverallLevels: [{ Id: 3, Name: "Complete" }] }],
  [`/d2l/api/le/unstable/${OU}/assessment?assessmentType=Rubric&objectType=Dropbox&objectId=41&rubricId=71&userId=555`]: { OverallOutcome: { LevelId: 3, Score: 5, Feedback: { Text: "Good plan.", Html: "" } }, CriteriaOutcome: [{ CriterionId: 9, LevelId: 1, Score: 5, Feedback: { Text: "", Html: "" } }] },
  [`/d2l/api/le/1.82/${OU}/dropbox/folders/41/submissions/mysubmissions/`]: [],
  [`/d2l/api/le/1.82/${OU}/dropbox/categories/`]: [{ Id: 51, Name: "Graded Project Progress Submissions" }],
  [`/d2l/api/le/1.67/${OU}/calendar/events/?startDateTime=2026-01-01T00:00:00.000Z&endDateTime=2027-06-30T00:00:00.000Z`]: [
    { CalendarEventId: 71, Title: "Quiz 1", EventType: 6, IsAllDayEvent: false, OrgUnitCode: "CO.430.TEST1101.12345.20272",
      CalendarEventViewUrl: `https://kennesaw.view.usg.edu/d2l/le/calendar/${OU}/event/99/detailsview`,
      StartDateTime: "2026-09-03T03:59:59.000Z", EndDateTime: "2026-09-03T03:59:59.000Z",
      AssociatedEntity: { AssociatedEntityType: "D2L.LE.Quizzing.Quiz", AssociatedEntityId: 21, Link: `https://kennesaw.view.usg.edu/d2l/lms/quizzing/quizzing.d2l?ou=${OU}&qi=21` } }
  ],
  [`/d2l/api/le/1.67/${OU}/grades/`]: [
    { Id: 31, Name: "Quiz1", MaxPoints: 10, CategoryId: 0, GradeType: "Numeric", AssociatedTool: { ToolId: 51000, ToolItemId: 21 } },
    { Id: 33, Name: "Module 1 response", MaxPoints: 5, CategoryId: 0, GradeType: "Numeric", AssociatedTool: { ToolId: 3000, ToolItemId: 81 } },
    { Id: 32, Name: "Paper", MaxPoints: 10, CategoryId: 0, GradeType: "Numeric", AssociatedTool: { ToolId: 2000, ToolItemId: 41 } }
  ],
  [`/d2l/api/le/1.67/${OU}/grades/values/myGradeValues/`]: [
    { GradeObjectIdentifier: "31", GradeObjectName: "Quiz1", GradeObjectType: 1, PointsNumerator: 10, PointsDenominator: 10, DisplayedGrade: "100 %", LastModified: "2026-09-10T19:46:52.963Z", Comments: { Text: "", Html: "" } }
  ],
  [`/d2l/api/le/1.82/${OU}/grades/setup/`]: { GradingSystem: "Points", IsNullGradeZero: true, DefaultGradeSchemeId: 0 },
  [`/d2l/api/le/1.82/${OU}/grades/categories/`]: [],
  [`/d2l/api/le/1.82/${OU}/news/`]: [{ Id: 91, Title: "Welcome", Body: { Text: "Hello class", Html: "" }, StartDate: "2026-09-01T15:48:00.000Z", IsPinned: true, IsPublished: true, Attachments: [] }],
  [`/d2l/api/le/1.82/${OU}/discussions/forums/`]: [{ ForumId: 101, Name: "Module 1 Response", Description: { Text: "Read chapter 1.", Html: "" } }],
  [`/d2l/api/le/1.82/${OU}/classlist/paged/?pageSize=200`]: { Objects: [
    { Identifier: "1", DisplayName: "Carrico, Gary", ClasslistRoleDisplayName: "Instructor", RoleId: 109 },
    { Identifier: "555", DisplayName: "Student, Test", ClasslistRoleDisplayName: "Student", RoleId: 110 }
  ] },
  [`/d2l/api/le/1.82/${OU}/content/completions/mycount/?level=1`]: { Objects: [{ ObjectId: 0, Title: "Test Course", RequiredItems: 70, CompletedItems: 26 }] },
  [`/d2l/api/le/1.82/${OU}/content/completions/mycount/?level=2`]: { Objects: [{ ObjectId: 10, Title: "Week 1", RequiredItems: 4, CompletedItems: 0 }] }
}));
const fetched = [];
async function fakeFetch(pathname, options = {}) {
  fetched.push(pathname);
  const body = routes.get(pathname);
  if (options.method === "HEAD" || body === undefined) return { ok: false, status: /topics\/$/.test(pathname) ? 403 : 404, json: async () => null, headers: { get: () => "" } };
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)), headers: { get: () => "application/json" } };
}

const content = loadContentHooks({ fetch: fakeFetch });
const payload = await content.collectCourseApi(OU);
const bySource = (source) => payload.items.filter((item) => item.source === source);

const quiz = bySource("quiz")[0];
if (quiz.description !== "Once you start, you will have 15 minutes.") throw new Error(`quiz description should be its text, got ${JSON.stringify(quiz.description)}`);
if (quiz.columns.timeLimitMinutes !== 20 || quiz.columns.gradeItemId !== 31) throw new Error("quiz time limit or grade item id was dropped");
const assignment = bySource("assignment")[0];
if (assignment.columns.categoryName !== "Graded Project Progress Submissions" || assignment.columns.scoreOutOf !== 10) throw new Error("assignment category or points were dropped");
if (bySource("assignmentAttachment")[0]?.downloadUrl !== `https://kennesaw.view.usg.edu/d2l/api/le/1.82/${OU}/dropbox/folders/41/attachments/61`) throw new Error("assignment attachment is not downloadable");
const event = bySource("calendarEvent")[0];
if (event.columns.viewUrl !== `https://kennesaw.view.usg.edu/d2l/le/calendar/${OU}/event/99/detailsview` || event.columns.eventLabel !== "Due") throw new Error("calendar view URL or Due label was dropped");
const quizGrade = bySource("gradeItem").find((item) => item.ids.gradeObjectId === "31");
if (quizGrade.ids.associatedQuizId !== "21" || quizGrade.columns.gradedAt !== "2026-09-10T19:46:52.963Z") throw new Error("grade item lost its quiz link or graded date");
if (bySource("gradeItem").find((item) => item.ids.gradeObjectId === "33").ids.associatedDiscussionTopicId !== "81") throw new Error("discussion grade item lost its topic link");
if (bySource("gradeSetup")[0].columns.isNullGradeZero !== true) throw new Error("ungraded-as-zero rule was dropped");
if (bySource("courseOffering")[0].columns.courseCode !== "CO.430.TEST1101.12345.20272") throw new Error("course code was dropped");
const completion = bySource("contentCompletion");
if (completion.length !== 2 || completion[0].columns.completedItems !== 26) throw new Error("content completion counts were dropped");
if (bySource("classlistEntry").find((item) => item.ids.userId === "1").columns.roleName !== "Instructor") throw new Error("classlist role name was dropped");
if (!bySource("contentModule").length || bySource("contentTopic")[1].columns.tocOrder !== 2) throw new Error("content module order was dropped");

// Same payload through the background organizers the dashboard reads.
const shared = loadSharedHooks();
const pagePayload = { pageType: "valenceApi", page: { url: `https://kennesaw.view.usg.edu/d2l/home/${OU}`, title: "Test Course" }, course: { orgUnitId: OU, title: "Test Course Section 01 Fall Semester 2026 CO" } };
const rows = payload.items.map((item) => ({ ...shared.flattenItem(pagePayload, item), downloadUrl: item.downloadUrl || "" }));
const background = loadBackgroundHooks();
const repository = background.createArchiveRepository(background.createMemoryArchiveAdapter());
await background.ingestAndOrganizeRows(rows, { repository, syncRunId: "fields", extractorVersion: "test", ingestedAt: "2026-09-28T12:00:00.000Z" });
const entity = async (id) => { const found = await repository.getEntity(id); if (!found) throw new Error(`missing entity ${id}`); return found; };

const quizEntity = await entity(`quiz:${OU}:21`);
if (quizEntity.timeLimitMinutes !== 20 || quizEntity.gradeEntityId !== `grade:${OU}:31` || !quizEntity.urls.d2l.includes("quiz_summary.d2l?ou=777&qi=21")) throw new Error("quiz entity is missing time limit, exact grade link, or D2L link");
const gradeEntity = await entity(`grade:${OU}:31`);
if (gradeEntity.sourceEntityId !== `quiz:${OU}:21` || gradeEntity.dates.gradedAt !== "2026-09-10T19:46:52.963Z" || gradeEntity.ungradedCountsAsZero !== true) throw new Error("grade entity lost its quiz, graded date, or zero rule");
if (!gradeEntity.urls.quizAttempts.includes("quiz_submissions.d2l?qi=21&ou=777")) throw new Error("grade entity lost the View Quiz Attempts link");
const assignmentEntity = await entity(`assignment:${OU}:41`);
if (assignmentEntity.attachments[0]?.name !== "Timeline Template.docx" || assignmentEntity.pointsPossible !== 10 || assignmentEntity.category !== "Graded Project Progress Submissions") throw new Error("assignment entity lost files, points, or category");
const calendarEntity = await entity(`calendar:${OU}:71`);
if (calendarEntity.eventLabel !== "Due" || calendarEntity.targetEntityId !== `quiz:${OU}:21` || !calendarEntity.urls.d2l.endsWith("/event/99/detailsview")) throw new Error("calendar entity lost its label, target, or view URL");
const announcement = await entity(`announcement:${OU}:91`);
if (announcement.urls.d2l !== `https://kennesaw.view.usg.edu/d2l/le/news/${OU}/91/view?ou=${OU}` || announcement.isPinned !== true) throw new Error("announcement entity lost its exact view URL or pin");
const courseCompletion = await entity(`progress:${OU}:completion:course`);
if (courseCompletion.completedItems !== 26 || courseCompletion.requiredItems !== 70) throw new Error("course completion entity is wrong");
const instructor = await entity(`person:${OU}:1`);
if (instructor.roleName !== "Instructor") throw new Error("person entity lost the instructor role");
const course = await repository.getCourse(OU);
if (course.code !== "CO.430.TEST1101.12345.20272") throw new Error("course record lost its D2L code");
const paperGrade = await entity(`grade:${OU}:32`);
if (paperGrade.rubric?.criteria?.[0]?.level !== "Level 4" || paperGrade.rubric.criteria[0].score !== 5 || paperGrade.rubric.overallFeedback !== "Good plan.") throw new Error("graded rubric did not reach the grade entity");
if (assignmentEntity.rubric?.name !== "Timeline rubric") throw new Error("graded rubric did not reach the assignment entity");
const link = await entity(`resource:${OU}:12`);
if (link.urls.external !== "https://www.georgiaencyclopedia.org/topics/government-politics" || link.moduleTitle !== "Week 1" || link.order !== 2) throw new Error("resource entity lost its outside link, module, or order");

// ART-style course: topics API 403, topic visible on the Discussions List page.
const html = '<p>Q1. Do you think Warhol’s soup cans are art?</p>';
const heading = { tagName: "H2", textContent: " Module 6: Andy Warhol Response " };
const cell = {
  textContent: "Module 6: Ch.5 Andy Warhol Contains unread posts Available on Sep 27, 2026 8:00 AM Access restricted before availability starts. Available until Oct 4, 2026 11:00 PM Access restricted after availability ends. Must post first. You must start a thread before you can read and reply to other threads",
  querySelector: (selector) => selector.startsWith("d2l-html-block") ? { getAttribute: () => html } : null
};
const topicLink = { tagName: "A", textContent: "Module 6: Ch.5 Andy Warhol", getAttribute: () => `/d2l/le/9900004/discussions/topics/5100/View`, closest: () => cell };
class FakeDOMParser { parseFromString(value) { return { body: { textContent: value.replace(/<[^>]+>/g, "") } }; } }
const listContent = loadContentHooks({
  href: "https://kennesaw.view.usg.edu/d2l/le/9900004/discussions/List",
  DOMParser: FakeDOMParser,
  document: { querySelectorAll: (selector) => selector.includes("h2") ? [heading, topicLink] : [] }
});
const [listTopic] = listContent.extractDiscussionListTopics();
if (!listTopic || listTopic.ids.discussionTopicId !== "5100" || listTopic.columns.forumTitle !== "Module 6: Andy Warhol Response") throw new Error("Discussions List topic lost its id or forum");
if (listTopic.gate !== "mustPostFirst" || !listTopic.description.startsWith("Q1. Do you think")) throw new Error("Discussions List topic lost its gate or prompt");
if (!listTopic.columns.startDate || !listTopic.columns.endDate) throw new Error("Discussions List topic lost its window");

console.log("Dashboard extractor fields survive collection and organization.");
