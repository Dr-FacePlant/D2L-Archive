(function initContentExtraction(global) {
  const shared = global.D2LExtractorShared;
  const content = global.D2LExtractorContent ||= {};
  const {  } = shared;
  const { headingText, pageText, getCourse, classifyPage, extractDashboard, extractAnnouncements, extractAnnouncementDetail, extractContent, extractTableRows, extractAssignments, extractAssignmentSubmissions, extractAssignmentFeedback, extractDiscussions, extractDiscussionPageMeta, extractDiscussionPosts, extractDiscussionAttachments, dedupeDiscussionAttachments, extractGrades, extractQuizzes, extractCalendar, extractGenericPage, extractToolPage, extractCourseHome, extractQuizResultRows } = content;

function extractItemsForPageType(pageType) {
  if (pageType === "dashboard") return extractDashboard();
  if (pageType === "courseHome") return extractCourseHome();
  if (pageType === "announcementDetail") return extractAnnouncementDetail();
  if (pageType === "content") return extractContent();
  if (pageType === "discussions") {
    return dedupeDiscussionAttachments([
      ...extractDiscussions(),
      ...extractDiscussionPageMeta(),
      ...extractDiscussionPosts(),
      ...extractDiscussionAttachments()
    ]);
  }
  if (pageType === "assignments") return extractAssignments();
  if (pageType === "assignmentSubmissions") return extractAssignmentSubmissions();
  if (pageType === "assignmentFeedback") return extractAssignmentFeedback();
  if (pageType === "quizzes") return extractQuizzes();
  if (pageType === "grades") return extractGrades();
  if (pageType === "calendar") return extractCalendar();
  if (pageType === "quizAttempt") return extractQuizResultRows("quizAttemptRow");
  if (pageType === "quizSubmissions") return extractQuizResultRows("quizSubmission");
  if (pageType === "quizSummary") return extractQuizResultRows("quizSummaryRow");
  const toolMap = {
    classlist: ["classlistEntry", "Classlist"],
    checklist: ["checklistItem", "Checklist"],
    survey: ["survey", "Surveys"],
    selfAssessment: ["selfAssessment", "Self Assessments"],
    group: ["group", "Groups"],
    courseLink: ["courseLink", "Course Links"],
    attendance: ["attendanceRecord", "Attendance"],
    userProgress: ["progressRecord", "Progress"]
  };
  if (toolMap[pageType]) return extractToolPage(...toolMap[pageType]);
  if (pageType === "mediaLibrary") return extractTableRows("mediaFile");
  if (pageType === "unknown") {
    return [...extractAnnouncements(), ...extractCalendar(), ...extractGenericPage()];
  }
  return [];
}

function buildPageDiagnostics(pageType, items, text) {
  const expectedSourceByPageType = globalThis.D2LExtractorShared.PAGE_TYPE_EXPECTED_SOURCES;
  const expectedSource = expectedSourceByPageType[pageType] || null;
  const expectedCount = expectedSource ? items.filter((item) => item.source === expectedSource || item.source === "courseToolPage").length : items.length;
  const emptyState = /There are no assignments|There are no quizzes|No surveys at this time|There are no announcements to display|No checklists|No checklist|No self assessments|No groups|No links|No attendance|No items found|No results/i.test(text);
  const loading = /Loading\.\.\.|Loading…|Please wait/i.test(text);
  return { expectedSource, expectedCount, emptyState, loading, textLength: text.length };
}

function extractVisiblePage() {
  const pageType = classifyPage();
  const items = extractItemsForPageType(pageType);
  const text = pageText();
  const diagnostics = buildPageDiagnostics(pageType, items, text);

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
    diagnostics,
    items
  };
}

  Object.assign(content, { extractVisiblePage });
})(globalThis);
