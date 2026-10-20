(function initContentExtraction(global) {
  const shared = global.D2LExtractorShared;
  const content = global.D2LExtractorContent ||= {};
  const {  } = shared;
  const { headingText, pageText, getCourse, classifyPage, extractDashboard, extractAnnouncements, extractAnnouncementDetail, extractContent, extractTableRows, extractAssignments, extractAssignmentSubmissions, extractAssignmentFeedback, extractDiscussions, extractDiscussionPageMeta, extractDiscussionPosts, extractDiscussionAttachments, dedupeDiscussionAttachments, extractGrades, extractQuizzes, extractCalendar, extractGenericPage, extractToolPage, extractCourseHome, extractQuizResultRows } = content;

function extractVisiblePage() {
    const pageType = classifyPage();
    let items = [];

    if (pageType === "dashboard") items = extractDashboard();
    if (pageType === "courseHome") items = extractCourseHome();
    if (pageType === "announcementDetail") items = extractAnnouncementDetail();
    if (pageType === "content") items = extractContent();
    if (pageType === "discussions") {
      items = dedupeDiscussionAttachments([
        ...extractDiscussions(),
        ...extractDiscussionPageMeta(),
        ...extractDiscussionPosts(),
        ...extractDiscussionAttachments()
      ]);
    }
    if (pageType === "assignments") items = extractAssignments();
    if (pageType === "assignmentSubmissions") items = extractAssignmentSubmissions();
    if (pageType === "assignmentFeedback") items = extractAssignmentFeedback();
    if (pageType === "quizzes") items = extractQuizzes();
    if (pageType === "grades") items = extractGrades();
    if (pageType === "calendar") items = extractCalendar();
    if (pageType === "quizAttempt") items = extractQuizResultRows("quizAttemptRow");
    if (pageType === "quizSubmissions") items = extractQuizResultRows("quizSubmission");
    if (pageType === "quizSummary") items = extractQuizResultRows("quizSummaryRow");
    if (pageType === "classlist") items = extractToolPage("classlistEntry", "Classlist");
    if (pageType === "checklist") items = extractToolPage("checklistItem", "Checklist");
    if (pageType === "survey") items = extractToolPage("survey", "Surveys");
    if (pageType === "selfAssessment") items = extractToolPage("selfAssessment", "Self Assessments");
    if (pageType === "group") items = extractToolPage("group", "Groups");
    if (pageType === "courseLink") items = extractToolPage("courseLink", "Course Links");
    if (pageType === "attendance") items = extractToolPage("attendanceRecord", "Attendance");
    if (pageType === "userProgress") items = extractToolPage("progressRecord", "Progress");
    if (pageType === "mediaLibrary") items = extractTableRows("mediaFile");

    if (pageType === "unknown") {
      items = [
        ...extractAnnouncements(),
        ...extractCalendar(),
        ...extractGenericPage()
      ];
    }

    const text = pageText();
    const expectedSourceByPageType = {
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
    };
    const expectedSource = expectedSourceByPageType[pageType] || null;
    const expectedCount = expectedSource ? items.filter((item) => item.source === expectedSource || item.source === "courseToolPage").length : items.length;
    const emptyState = /There are no assignments|There are no quizzes|No surveys at this time|There are no announcements to display|No checklists|No checklist|No self assessments|No groups|No links|No attendance|No items found|No results/i.test(text);
    const loading = /Loading\.\.\.|Loading…|Please wait/i.test(text);

    return {
      extractor: {
        name: "D2L Archive",
        version: chrome.runtime.getManifest().version,
        extractedAt: new Date().toISOString()
      },
      pageType,
      page: {
        title: document.title,
        url: window.location.href,
        heading: headingText(1),
        text
      },
      course: getCourse(),
      diagnostics: {
        expectedSource,
        expectedCount,
        emptyState,
        loading,
        textLength: text.length
      },
      items
    };
  }

  Object.assign(content, { extractVisiblePage });
})(globalThis);
