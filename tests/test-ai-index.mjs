import { loadBackgroundHooks } from "./test-production-loader.mjs";

const { aiIndexRecord } = loadBackgroundHooks();

function assertIncludes(value, needle, label) {
  if (!String(value || "").includes(needle)) {
    throw new Error(`${label}: expected ${JSON.stringify(value)} to include ${JSON.stringify(needle)}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const apiProbe = aiIndexRecord({
  courseOrgUnitId: "123",
  source: "apiProbe",
  title: "assignment my submissions API 200",
  status: "availableEmpty",
  type: "assignment my submissions",
  columns: JSON.stringify({ status: 200, assignmentTitle: "Essay 1", evidenceCount: 0 }),
  ids: JSON.stringify({ courseOrgUnitId: "123", dropboxFolderId: "44" })
});

assertEqual(apiProbe.status, "availableEmpty", "api probe status is top-level");
assertEqual(apiProbe.type, "assignment my submissions", "api probe type is top-level");
assertIncludes(apiProbe.text, "availableEmpty", "api probe text includes status");
assertIncludes(apiProbe.text, "assignment my submissions", "api probe text includes type");
assertIncludes(apiProbe.text, "Essay 1", "api probe text includes assignment title");
assertEqual(apiProbe.ids.dropboxFolderId, "44", "api probe ids survive indexing");

const gradeFeedback = aiIndexRecord({
  courseOrgUnitId: "123",
  source: "gradeFeedback",
  title: "Paper feedback",
  status: "feedbackAvailable",
  columns: JSON.stringify({ feedbackText: "Strong thesis", rubricText: "Organization level 4" }),
  ids: JSON.stringify({ courseOrgUnitId: "123", gradeObjectId: "77" })
});

assertIncludes(gradeFeedback.text, "Strong thesis", "grade feedback text includes feedbackText");
assertIncludes(gradeFeedback.text, "Organization level 4", "grade feedback text includes rubricText");
assertEqual(gradeFeedback.status, "feedbackAvailable", "grade feedback status is top-level");

const contentAttachment = aiIndexRecord({
  courseOrgUnitId: "123",
  source: "contentAttachment",
  title: "week-1-handout.pdf",
  description: "Download handout",
  localPageTextSnippet: "This page discusses mitochondrial ATP and required lab prep.",
  columns: JSON.stringify({ contentTitle: "Week 1 Overview", recoveredFrom: "contentViewerLink" }),
  ids: JSON.stringify({ courseOrgUnitId: "123", contentObjectId: "555" })
});

assertIncludes(contentAttachment.text, "week-1-handout.pdf", "content attachment text includes file title");
assertIncludes(contentAttachment.text, "Week 1 Overview", "content attachment text includes parent content title");
assertIncludes(contentAttachment.text, "mitochondrial ATP", "content attachment text includes local page text snippet");
assertEqual(contentAttachment.ids.contentObjectId, "555", "content attachment ids survive indexing");

const rubricCriterion = aiIndexRecord({
  courseOrgUnitId: "123",
  source: "rubricCriterionFeedback",
  title: "Organization",
  status: "criterionFeedbackVisible",
  columns: JSON.stringify({ criterionName: "Organization", rubricLevel: "Excellent", scoreText: "Score: 4 / 4", feedbackText: "Clear structure" }),
  ids: JSON.stringify({ courseOrgUnitId: "123", criterionNumber: "1" })
});

assertIncludes(rubricCriterion.text, "Organization", "rubric criterion text includes criterion name");
assertIncludes(rubricCriterion.text, "Excellent", "rubric criterion text includes rubric level");
assertIncludes(rubricCriterion.text, "Score: 4 / 4", "rubric criterion text includes criterion score");

const announcementLink = aiIndexRecord({
  courseOrgUnitId: "123",
  source: "announcementLink",
  title: "Study guide",
  columns: JSON.stringify({ linkKind: "external", recoveredFrom: "announcementDetailLink" }),
  ids: JSON.stringify({ courseOrgUnitId: "123", newsItemId: "7061660" })
});

assertIncludes(announcementLink.text, "external", "announcement link text includes linkKind");
assertIncludes(announcementLink.text, "announcementDetailLink", "announcement link text includes recovery source");
assertEqual(announcementLink.ids.newsItemId, "7061660", "announcement link ids survive indexing");

const courseToolPage = aiIndexRecord({
  courseOrgUnitId: "123",
  source: "courseToolPage",
  title: "Checklist",
  status: "availableEmpty",
  columns: JSON.stringify({ toolSource: "checklistItem", emptyStateText: "No checklists are available" }),
  ids: JSON.stringify({ courseOrgUnitId: "123" })
});

assertIncludes(courseToolPage.text, "checklistItem", "course tool page text includes tool source");
assertIncludes(courseToolPage.text, "No checklists are available", "course tool page text includes empty-state text");

console.log("AI index tests passed.");
