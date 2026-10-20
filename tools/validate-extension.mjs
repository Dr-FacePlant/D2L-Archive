import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const toolsRoot = path.join(root, "tools");
const testsRoot = path.join(root, "tests");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const contentSupportRuntime = manifest.content_scripts[0].js
  .filter((file) => file !== "content.js")
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");
const contentRuntime = `${contentSupportRuntime}\n${content}`;
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const backgroundImports = [...background.matchAll(/"(src\/(?:shared|background)\/[^"\n]+\.js)"/g)]
  .map((match) => match[1]);
const sharedRuntime = backgroundImports
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");
const backgroundRuntime = `${sharedRuntime}\n${background}`;
const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const popupJs = fs.readFileSync(path.join(root, "popup.js"), "utf8");
const popupRuntime = [...popupHtml.matchAll(/<script\s+src="([^"]+\.js)"/g)]
  .map((match) => fs.readFileSync(path.join(root, match[1]), "utf8"))
  .join("\n");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const valenceApiMap = fs.readFileSync(path.join(root, "docs", "VALENCE-API-MAP.md"), "utf8");
const verifyArchive = fs.readFileSync(path.join(toolsRoot, "verify-archive.mjs"), "utf8");
const verifyArchiveRuntime = [
  ...verifyArchive.matchAll(/from\s+"(\.\/verify\/[^"]+\.mjs)"/g)
].map((match) => fs.readFileSync(path.join(toolsRoot, match[1]), "utf8")).join("\n") + `\n${verifyArchive}`;
const queryAiIndex = fs.readFileSync(path.join(toolsRoot, "query-ai-index.mjs"), "utf8");
const verifyLatest = fs.readFileSync(path.join(toolsRoot, "verify-latest.mjs"), "utf8");
const remainingExtractionAudit = fs.readFileSync(path.join(toolsRoot, "audit-remaining-extraction.mjs"), "utf8");
const targetedValidationPlan = fs.readFileSync(path.join(toolsRoot, "plan-targeted-validation.mjs"), "utf8");
const targetedValidationVerifier = fs.readFileSync(path.join(toolsRoot, "verify-targeted-validation.mjs"), "utf8");
const testRemainingExtractionAudit = fs.readFileSync(path.join(testsRoot, "test-remaining-extraction-audit.mjs"), "utf8");
const testChangeSignals = fs.readFileSync(path.join(testsRoot, "test-change-signals.mjs"), "utf8");
const testUrlSafety = fs.readFileSync(path.join(testsRoot, "test-url-safety.mjs"), "utf8");
const testApiProbes = fs.readFileSync(path.join(testsRoot, "test-api-probes.mjs"), "utf8");
const testAssignmentProbeTasks = fs.readFileSync(path.join(testsRoot, "test-assignment-probe-tasks.mjs"), "utf8");
const testQuizProbeTasks = fs.readFileSync(path.join(testsRoot, "test-quiz-probe-tasks.mjs"), "utf8");
const testAnnouncementProbeTasks = fs.readFileSync(path.join(testsRoot, "test-announcement-probe-tasks.mjs"), "utf8");
const testGradeProbeTasks = fs.readFileSync(path.join(testsRoot, "test-grade-probe-tasks.mjs"), "utf8");
const testCourseToolProbeTasks = fs.readFileSync(path.join(testsRoot, "test-course-tool-probe-tasks.mjs"), "utf8");
const testTargetedValidationPlan = fs.readFileSync(path.join(testsRoot, "test-targeted-validation-plan.mjs"), "utf8");
const testTargetedValidationVerifier = fs.readFileSync(path.join(testsRoot, "test-targeted-validation-verifier.mjs"), "utf8");
const testAssignmentPageParsers = fs.readFileSync(path.join(testsRoot, "test-assignment-page-parsers.mjs"), "utf8");
const testQuizResultParsers = fs.readFileSync(path.join(testsRoot, "test-quiz-result-parsers.mjs"), "utf8");
const testGradeFeedbackParsers = fs.readFileSync(path.join(testsRoot, "test-grade-feedback-parsers.mjs"), "utf8");
const testAnnouncementAttachmentParsers = fs.readFileSync(path.join(testsRoot, "test-announcement-attachment-parsers.mjs"), "utf8");
const testDiscussionAttachmentParsers = fs.readFileSync(path.join(testsRoot, "test-discussion-attachment-parsers.mjs"), "utf8");
const testCalendarAttachmentParsers = fs.readFileSync(path.join(testsRoot, "test-calendar-attachment-parsers.mjs"), "utf8");
const testContentAttachmentParsers = fs.readFileSync(path.join(testsRoot, "test-content-attachment-parsers.mjs"), "utf8");
const testExternalLinkParsers = fs.readFileSync(path.join(testsRoot, "test-external-link-parsers.mjs"), "utf8");
const testDownloadPaths = fs.readFileSync(path.join(testsRoot, "test-download-paths.mjs"), "utf8");
const testAiIndex = fs.readFileSync(path.join(testsRoot, "test-ai-index.mjs"), "utf8");
const testAuditReport = fs.readFileSync(path.join(testsRoot, "test-audit-report.mjs"), "utf8");
const testVerifyLatestPageChecks = fs.readFileSync(path.join(testsRoot, "test-verify-latest-page-checks.mjs"), "utf8");
const testProductionLoader = fs.readFileSync(path.join(testsRoot, "test-production-loader.mjs"), "utf8");
const runLocalChecks = fs.readFileSync(path.join(root, "run-local-checks.mjs"), "utf8");

const marker = content.match(/D2L_EXTRACTOR_VERSION\s*=\s*"([^"]+)"/)?.[1];
const requiredBackgroundSnippets = [
  "change-report.md",
  "student-action-brief.md",
  "student-questions.md",
  "studentQuestionsMarkdown",
  "feedbackSignal",
  "newlyFeedback",
  "dueChanged",
  "availabilityChanged",
  "status: row.status",
  "type: row.type",
  "columns.rubricText",
  "isSafeReadOnlyUrl",
  "folder_submit_files\\.d2l",
  "quiz_start",
  "ai-index.jsonl",
  "localPageTextSnippet",
  "export-progress.json",
  "phase: \"pre-files\"",
  "assignmentSubmission",
  "quizAttempt",
  "submittedFile",
  "announcementAttachment",
  "announcementLink",
  "discussionPost",
  "discussionAttachment",
  "calendarAttachment",
  "contentAttachment",
  "hasSource(\"contentAttachment\")",
  "externalLink",
  "syllabusPolicy",
  "rubricFeedback",
  "rubricCriterionFeedback",
  "gradeFeedback",
  "progressRecord",
  "attendance_progress_groups",
  "apiProbe",
  "apiProbeBreakdown",
  "apiProbeSummaryRows",
  "apiProbeLegendLines",
  "availableEmpty: D2L allowed",
  "API Probe Evidence",
  "assignmentProbeTasksFromApiItems",
  "collectAssignmentProbePages",
  "quizProbeTasksFromApiItems",
  "collectQuizProbePages",
  "announcementProbeTasksFromApiItems",
  "collectAnnouncementProbePages",
  "gradeProbeTasksForCourse",
  "collectGradeProbePages",
  "courseToolProbeTasksForCourse",
  "collectCourseToolProbePages",
  "archivePathFromDownloadItem",
  "waitForDownloadComplete",
  "download interrupted",
  "quizProbePages",
  "Quiz Probe Pages",
  "quizQuestionResult",
  "announcementProbePages",
  "Announcement Probe Pages",
  "gradeProbePages",
  "Grade Probe Pages",
  "courseToolProbePages",
  "Course Tool Probe Pages",
  "assignmentProbePages",
  "Assignment Probe Pages",
  "assignmentProbePageLines",
  "announcementProbePageLines",
  "gradeProbePageLines",
  "courseToolProbePageLines",
  "courseToolPage",
  "history pages",
  "feedback pages",
  "attempt pages",
  "submission pages",
  "summary pages",
  "Submissions / Feedback / Results"
];
const requiredContentSnippets = [
  "submissions/mysubmissions",
  "/quizzes/${quizId}/attempts/",
  "/news/",
  "/discussions/forums/",
  "extractAssignmentSubmissions",
  "extractAssignmentFeedback",
  "extractAnnouncementDetail",
  "announcementAttachment",
  "announcementLink",
  "a[href*='fileId=']",
  "extractDiscussionPosts",
  "discussionVisiblePostLink",
  "derivedStudentUsefulRows",
  "extractToolRows",
  "/userprogress/",
  "registers_list.d2l",
  "apiProbeStatus",
  "addApiProbeRow",
  "availableEmpty",
  "includeAvailable",
  "discussionForumId",
  "discussionAttachment",
  "calendarAttachment",
  "calendarEventDetailLink",
  "contentAttachment",
  "contentViewerLink",
  "isExternalResourceUrl",
  "linkKind",
  "externalLink",
  "generatedAssignmentProbeLinks",
  "folders_history.d2l?db=",
  "assignmentSubmissionHistoryPage",
  "assignmentFeedbackPage",
  "assignmentFeedbackPageRubricBlock",
  "submittedFileRows",
  "extractQuizResultRows",
  "quizQuestionRowsFromText",
  "quizQuestionResult",
  "quizScoreText",
  "quizIdsFromUrl",
  "gradeFeedbackRow",
  "firstRichText",
  "gradeFeedback",
  "courseToolPage",
  "blockedOrUnavailable",
  "availableEmpty",
  "toolSource"
];

const failures = [];
if (manifest.version !== marker) failures.push(`manifest version ${manifest.version} does not match content marker ${marker || "(missing)"}`);
if (!backgroundRuntime.includes("const WORKER_COUNT = 3")) failures.push("background runtime default worker pool should be 3");
for (const snippet of requiredBackgroundSnippets) {
  if (!backgroundRuntime.includes(snippet)) failures.push(`background runtime missing ${snippet}`);
}
for (const snippet of requiredContentSnippets) {
  if (!contentRuntime.includes(snippet)) failures.push(`content runtime missing ${snippet}`);
}
for (const snippet of ["extract", "copy", "download"]) {
  if (!popupHtml.includes(snippet)) failures.push(`popup.html missing ${snippet}`);
}
for (const snippet of ["crawlCurrent", "crawlTargets", "crawlMode", "targetUrls", "crawl-options"]) {
  if (popupHtml.includes(snippet)) failures.push(`popup.html still has retired crawl UI ${snippet}`);
}
for (const snippet of ["VALENCE-API-MAP.md", "run-local-checks.mjs", "MIT"]) {
  if (!readme.includes(snippet)) failures.push(`README.md missing ${snippet}`);
}
for (const snippet of ["D2L Valence API Map", "rubrics/(rubricId)", "quizzes/(quizId)/attempts", "grades/values/myGradeValues", "submissions/mysubmissions", "news/(newsItemId)/attachments", "courseToolPage", "localPageTextPath", "change-report.json", "Read-Only Rules"]) {
  if (!valenceApiMap.includes(snippet)) failures.push(`VALENCE-API-MAP.md missing ${snippet}`);
}
for (const snippet of ["requestExtraction", "getActiveTab"]) {
  if (!popupRuntime.includes(snippet)) failures.push(`popup runtime missing ${snippet}`);
}
for (const snippet of ["startConfiguredCrawl", "crawlConfig", "seedUrls", "workerCount"]) {
  if (popupRuntime.includes(snippet)) failures.push(`popup runtime still has retired crawl code ${snippet}`);
}
for (const snippet of ["offline-verification.md", "offline-action-brief.md", "offline-student-questions.md", "offlineStudentQuestions", "offline-ai-index.jsonl", "offline-change-report.md", "offlineChangeReport", "changeReportMarkdown", "--compare", "offlineActionBrief", "aiIndexRecord", "feedbackSignal", "newlyFeedback", "dueChanged", "availabilityChanged", "recovered-manifest.json", "recoverManifestFromArchive", "recoveredRowsFromPage", "localPageTextSnippet", "contentPageText", "calendarDetailPageText", "checklistPageText", "assignmentInstruction", "assignmentContentPageText", "courseHomeAnnouncementText", "quizPageText", "gradePageText", "quizSubmissionPageText", "discussionTopicPageText", "discussionVisibleFeedbackText", "discussionThreadPageText", "discussionFeedback", "rubricFeedback", "rubricCriterionFeedback", "gradeFeedback", "courseToolPage", "externalLink", "calendarAttachment", "contentAttachment", "quizResultPageVisits", "first-class external links", "Assignment submissions/feedback", "countPageVisits", "history pages", "feedback pages", "Quiz attempts/results", "attempt pages", "submission pages", "summary pages", "Checklists/surveys/progress/tools", "API probe evidence", "apiProbe", "apiProbeBreakdown", "apiProbeSummaryRows", "apiProbeLegendLines", "availableEmpty: D2L allowed", "Submissions / Feedback / Results"]) {
  if (!verifyArchiveRuntime.includes(snippet)) failures.push(`verify-archive runtime missing ${snippet}`);
}
for (const snippet of ["offline-ai-index.jsonl", "ai-index.jsonl", "manifest.json", "query-results", "scoreRecord", "aiIndexRecord", "--json", "feedbackText", "apiProbe", "fileId", "postSubject", "contentTitle", "localPageTextSnippet", "criterionName", "rubricLevel", "recoveredFrom", "toolSource", "emptyStateText", "blockedText", "linkKind"]) {
  if (!queryAiIndex.includes(snippet)) failures.push(`query-ai-index.mjs missing ${snippet}`);
}
for (const snippet of ["verify-archive.mjs", "offline-smoke-query-report.json", "next-live-review.md", "reviewMarkdown", "readArchiveRecords", "pageVisitChecks", "Page Visit Checks", "offline-ai-index.jsonl", "ai-index.jsonl", "audit.totals.apiSummary.assignmentProbePages", "audit.totals.apiSummary.quizProbePages", "audit.totals.apiSummary.announcementProbePages", "audit.totals.apiSummary.gradeProbePages", "audit.totals.apiSummary.courseToolProbePages", "Assignment probe page summary", "Quiz probe page summary", "Announcement probe page summary", "Grade probe page summary", "Secondary course tool probe summary", "folders_history.d2l", "folder_user_view_feedback.d2l", "quiz_submissions_attempt.d2l", "quiz_submissions.d2l", "quiz_summary.d2l", "grades/my_grades/main.d2l", "expectedSources", "expectedStatusBreakdown", "coverageSummary", "unprovenCategories", "needsReview", "assignment feedback submission", "quiz attempt result", "gradeFeedback", "course material handout slides content attachment", "contentAttachment", "recoveredFile", "syllabusPolicy", "contentTitle", "const scored", "expected.has", "api probe available empty blocked hidden unavailable", "1 rubric details/feedback and 4 assignment feedback", "6 disabled/empty course tools", "check.area"]) {
  if (!verifyLatest.includes(snippet)) failures.push(`verify-latest.mjs missing ${snippet}`);
}
for (const snippet of ["Remaining D2L Extraction Audit", "Rubric-level details", "Released quiz/exam feedback", "Grade item detail", "Assignment submission history", "Announcement detail pages", "Disabled/empty course tools", "Content page text/HTML snapshots", "Change detection / daily update mode", "API route:", "UI proof:", "Proof rows/signals:", "submissions/mysubmissions", "grades/values/myGradeValues", "localPageTextPath"]) {
  if (!remainingExtractionAudit.includes(snippet)) failures.push(`audit-remaining-extraction.mjs missing ${snippet}`);
}
for (const snippet of ["remaining audit markdown includes grade API route guidance", "remaining audit markdown includes announcement attachment API guidance", "remaining audit JSON preserves change detection proof signals"]) {
  if (!testRemainingExtractionAudit.includes(snippet)) failures.push(`test-remaining-extraction-audit.mjs missing ${snippet}`);
}
for (const snippet of ["D2L Targeted Validation Plan", "Priority Areas", "Optional / Already-Proven Areas", "After Running Batches", "verify-targeted-validation.mjs", "targeted-validation-verification.md", "Why priority", "Area:", "API route:", "UI proof:", "Proof rows/signals:", "proofGuideForSection", "Batch details", "batchDetails", "areaForSection", "announcementLinkRows", "courseToolPageRows", "contentSnapshotRows", "changeReportAvailable", "Content page snapshots", "Change detection daily update", "Quiz released result pages", "Announcement detail pages", "Visible gradebook pages", "Secondary course tool pages", "Workers `3`", "quiz_submissions_attempt.d2l"]) {
  if (!targetedValidationPlan.includes(snippet)) failures.push(`plan-targeted-validation.mjs missing ${snippet}`);
}
for (const snippet of ["D2L Targeted Validation Verification", "targeted-validation-verification.md", "Area Coverage", "nextActionForSection", "Next action", "areaForSection", "proofGaps", "visitedPlannedUrls", "openProofGaps", "missingPlannedUrls", "announcementLinkRows", "courseToolPageRows", "contentSnapshotRows", "changeReportAvailable", "7 content page text/HTML snapshots", "8 change detection/daily update mode"]) {
  if (!targetedValidationVerifier.includes(snippet)) failures.push(`verify-targeted-validation.mjs missing ${snippet}`);
}
for (const snippet of ["ordinary scored grade item is not feedback", "structured grade comments count as feedback", "quiz summary result counts as feedback", "discussion feedback counts as feedback", "changed due date is a first-class daily change signal", "changed availability is a first-class daily change signal", "stored daily summary preserves availability text"]) {
  if (!testChangeSignals.includes(snippet)) failures.push(`test-change-signals.mjs missing ${snippet}`);
}
for (const snippet of ["loadBackgroundHooks", "isSafeReadOnlyUrl", "assignment history page is safe", "assignment feedback page is safe", "assignment submit page is blocked", "quiz start page is blocked", "discussion post create page is blocked", "mail page is blocked"]) {
  if (!testUrlSafety.includes(snippet)) failures.push(`test-url-safety.mjs missing ${snippet}`);
}
for (const snippet of ["loadContentHooks", "apiProbeStatus", "addApiProbeRow", "successful empty probe records availableEmpty", "available probes without includeAvailable are omitted", "assignment probe keeps folder id", "discussion probe keeps topic id"]) {
  if (!testApiProbes.includes(snippet)) failures.push(`test-api-probes.mjs missing ${snippet}`);
}
for (const snippet of ["loadBackgroundHooks", "assignmentProbeTasksFromApiItems", "two unique assignment folders create four read-only probe tasks", "probe tasks never use submit or attempt URLs", "probe tasks include folder id parsed from url"]) {
  if (!testAssignmentProbeTasks.includes(snippet)) failures.push(`test-assignment-probe-tasks.mjs missing ${snippet}`);
}
for (const snippet of ["loadBackgroundHooks", "quizProbeTasksFromApiItems", "one quiz summary and one attempt create two read-only probe tasks", "quiz probes never use start or active attempt URLs", "attempt probe includes attempt id"]) {
  if (!testQuizProbeTasks.includes(snippet)) failures.push(`test-quiz-probe-tasks.mjs missing ${snippet}`);
}
for (const snippet of ["loadBackgroundHooks", "announcementProbeTasksFromApiItems", "two unique announcements create two probes", "announcement probes target detail pages", "unsafe hosts are rejected"]) {
  if (!testAnnouncementProbeTasks.includes(snippet)) failures.push(`test-announcement-probe-tasks.mjs missing ${snippet}`);
}
for (const snippet of ["loadBackgroundHooks", "gradeProbeTasksForCourse", "one course should create one gradebook probe", "grade probe should use student gradebook URL", "grade probe URL should be read-only safe"]) {
  if (!testGradeProbeTasks.includes(snippet)) failures.push(`test-grade-probe-tasks.mjs missing ${snippet}`);
}
for (const snippet of ["loadBackgroundHooks", "courseToolProbeTasksForCourse", "one course should create seven secondary-tool probes", "missing ${type} course-tool probe", "course-tool probes contain a side-effect URL"]) {
  if (!testCourseToolProbeTasks.includes(snippet)) failures.push(`test-course-tool-probe-tasks.mjs missing ${snippet}`);
}
for (const snippet of ["targeted validation plan includes quiz summary URL", "targeted validation plan includes announcement detail URL", "targeted validation plan includes content topic URL", "targeted validation plan only includes read-only safe D2L URLs", "targeted validation plan prioritizes quiz pages when attempt details are unproven", "targeted validation plan explains quiz proof gaps", "targeted validation plan explains announcement link proof gaps", "targeted validation plan maps course tools to goal area", "targeted validation plan maps content snapshots to goal area", "targeted validation plan records change detection proof gap without crawl URLs", "targeted validation plan batch details keep area and label metadata", "targeted validation plan batch details keep API and UI proof metadata", "targeted validation plan includes quiz API proof route", "targeted validation plan includes grade feedback proof rows", "targeted validation plan prioritizes unproven announcement pages", "targeted validation plan skips already-proven assignment feedback pages"]) {
  if (!testTargetedValidationPlan.includes(snippet)) failures.push(`test-targeted-validation-plan.mjs missing ${snippet}`);
}
for (const snippet of ["targeted validation verifier closes quiz proof gaps", "targeted validation verifier suggests quiz parser next action", "targeted validation verifier marks covered sections as no action needed", "targeted validation verifier suggests rerunning missing URLs", "targeted validation verifier recognizes useful announcement detail link rows", "targeted validation verifier maps announcement section to goal area", "targeted validation verifier keeps attachment gap open when only links are found", "targeted validation verifier recognizes courseToolPage rows", "targeted validation verifier closes content snapshot proof gaps", "targeted validation verifier closes change detection proof gaps", "targeted validation verifier summarizes area coverage"]) {
  if (!testTargetedValidationVerifier.includes(snippet)) failures.push(`test-targeted-validation-verifier.mjs missing ${snippet}`);
}
for (const snippet of ["D2L API submitted file URL is captured", "feedback page URL is not mistaken for a file", "submission page captures feedback text", "unreleased feedback is explicit", "rubric feedback captures level achieved", "rubric feedback keeps assignment folder id", "rubric criterion parser emits criterion-level feedback rows", "rubric criterion parser captures criterion score"]) {
  if (!testAssignmentPageParsers.includes(snippet)) failures.push(`test-assignment-page-parsers.mjs missing ${snippet}`);
}
for (const snippet of ["loadContentHooks", "compactLabelValueRows", "quizIdsFromUrl", "quizScoreText", "quizQuestionRowsFromText", "quiz result parser captures quiz id", "quiz result parser captures feedback", "quiz question parser emits visible question results", "quiz parser captures question feedback"]) {
  if (!testQuizResultParsers.includes(snippet)) failures.push(`test-quiz-result-parsers.mjs missing ${snippet}`);
}
for (const snippet of ["loadContentHooks", "gradeFeedbackRow", "ordinary grade row does not emit grade feedback", "comment grade row emits gradeFeedback", "rubric grade feedback preserves rubricText"]) {
  if (!testGradeFeedbackParsers.includes(snippet)) failures.push(`test-grade-feedback-parsers.mjs missing ${snippet}`);
}
for (const snippet of ["announcement API attachment URL is captured", "announcement detail page URL is not mistaken for an attachment", "announcement detail parser keeps news item id instead of course id", "announcement detail external link is captured separately", "course home URL is not mistaken for an attachment"]) {
  if (!testAnnouncementAttachmentParsers.includes(snippet)) failures.push(`test-announcement-attachment-parsers.mjs missing ${snippet}`);
}
for (const snippet of ["visible discussion attachment emits discussionAttachment", "visible discussion attachment keeps post subject", "discussion topic link is not mistaken for attachment"]) {
  if (!testDiscussionAttachmentParsers.includes(snippet)) failures.push(`test-discussion-attachment-parsers.mjs missing ${snippet}`);
}
for (const snippet of ["calendar detail attachment emits calendarAttachment", "calendar detail attachment keeps event title", "calendar event detail link is not mistaken for attachment"]) {
  if (!testCalendarAttachmentParsers.includes(snippet)) failures.push(`test-calendar-attachment-parsers.mjs missing ${snippet}`);
}
for (const snippet of ["content viewer file emits contentAttachment", "content viewer file keeps content object id", "ordinary content navigation link is not mistaken for attachment", "content viewer page emits contentTopic", "content viewer topic records recovery source", "content viewer topic counts attachments"]) {
  if (!testContentAttachmentParsers.includes(snippet)) failures.push(`test-content-attachment-parsers.mjs missing ${snippet}`);
}
for (const snippet of ["off-site course link emits externalLink", "D2L quickLink course link emits externalLink", "ordinary D2L course link stays courseLink"]) {
  if (!testExternalLinkParsers.includes(snippet)) failures.push(`test-external-link-parsers.mjs missing ${snippet}`);
}
for (const snippet of ["loadBackgroundHooks", "archivePathFromDownloadItem", "isDownloadCandidate", "d2l-api-export", "d2l-course-export", "d2l-page-probe-export", "submitted file is downloadable", "announcement attachment is downloadable", "download path falls back when Chrome item is unavailable"]) {
  if (!testDownloadPaths.includes(snippet)) failures.push(`test-download-paths.mjs missing ${snippet}`);
}
for (const snippet of ["vm.runInContext", "background.js", "content.js", "__D2LExtractorBackgroundTestHooks", "__D2LExtractorContentTestHooks"]) {
  if (!testProductionLoader.includes(snippet)) failures.push(`test-production-loader.mjs missing ${snippet}`);
}
for (const snippet of ["api probe status is top-level", "api probe text includes assignment title", "grade feedback text includes rubricText", "content attachment text includes parent content title", "content attachment text includes local page text snippet", "rubric criterion text includes criterion score", "announcement link text includes linkKind", "course tool page text includes empty-state text"]) {
  if (!testAiIndex.includes(snippet)) failures.push(`test-ai-index.mjs missing ${snippet}`);
}
for (const snippet of ["audit includes assignment probe section", "audit includes visited count", "audit explains unproven assignment probe pages", "audit includes quiz probe section", "audit explains unproven quiz probe pages", "audit includes announcement probe section", "audit explains unproven announcement probe pages", "audit includes grade probe section", "audit explains unproven grade probe pages", "audit includes course tool probe section", "audit explains unproven course tool probe pages"]) {
  if (!testAuditReport.includes(snippet)) failures.push(`test-audit-report.mjs missing ${snippet}`);
}
for (const snippet of ["assignment probe summary found when probes visited", "assignment probe summary unproven when probes never ran", "quiz probe summary unproven when probes never ran", "announcement probe summary found when probes visited", "grade probe summary found when probes visited", "course tool probe summary found when probes visited", "assignment page visit area maps to assignment/rubric feedback goal", "course tool page visit area maps to course tool goal"]) {
  if (!testVerifyLatestPageChecks.includes(snippet)) failures.push(`test-verify-latest-page-checks.mjs missing ${snippet}`);
}
for (const snippet of ["background syntax", "remaining extraction audit regression", "change signal regression", "url safety regression", "api probe regression", "assignment probe task regression", "quiz probe task regression", "announcement probe task regression", "grade probe task regression", "course tool probe task regression", "targeted validation plan regression", "targeted validation verifier regression", "assignment page parser regression", "quiz result parser regression", "grade feedback parser regression", "announcement attachment parser regression", "discussion attachment parser regression", "calendar attachment parser regression", "content attachment parser regression", "external link parser regression", "download path regression", "ai index regression", "audit report regression", "verify latest page checks regression", "static extension validation"]) {
  if (!runLocalChecks.includes(snippet)) failures.push(`run-local-checks.mjs missing ${snippet}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`D2L extractor ${manifest.version} static validation passed.`);
