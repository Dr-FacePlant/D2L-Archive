(() => {
  const shared = globalThis.D2LExtractorShared ||= {};

  shared.D2L_ORIGIN = "https://kennesaw.view.usg.edu";
  shared.DEV_RELOAD_TOKEN = "d2l-local-dev-8f6c2a1e";
  shared.PAGE_TYPE_EXPECTED_SOURCES = Object.freeze({
    assignments: "assignment",
    assignmentSubmissions: "assignmentSubmission",
    assignmentFeedback: "assignmentFeedback",
    quizzes: "quiz",
    quizAttempt: "quizAttemptRow",
    quizSubmissions: "quizSubmission",
    quizSummary: "quizSummaryRow",
    grades: "gradeItem",
    announcementDetail: "announcement",
    discussions: "discussionTopic",
    content: "contentTopic",
    calendar: "calendarEvent",
    checklist: "checklistItem",
    survey: "survey",
    selfAssessment: "selfAssessment",
    group: "group",
    courseLink: "courseLink",
    attendance: "attendanceRecord",
    userProgress: "progressRecord",
    mediaLibrary: "mediaFile",
    dashboard: "dashboardCourseCard"
  });
  shared.CSV_COLUMNS = Object.freeze([
    "crawledAt",
    "pageType",
    "pageTitle",
    "pageUrl",
    "courseOrgUnitId",
    "courseTitle",
    "source",
    "title",
    "description",
    "status",
    "gate",
    "type",
    "dueAtText",
    "availabilityText",
    "itemUrl",
    "downloadUrl",
    "suggestedFileName",
    "historyUrl",
    "feedbackUrl",
    "localPath",
    "downloadError",
    "localPageTextPath",
    "localPageTextSnippet",
    "ids",
    "columns"
  ]);
})();
