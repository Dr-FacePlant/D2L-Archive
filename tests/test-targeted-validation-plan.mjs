function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function safeD2lUrl(url) {
  if (!/^https:\/\/kennesaw\.view\.usg\.edu\/d2l\//i.test(url || "")) return "";
  if (/quiz_start|folder_submit|posts\/new|threads\/create|\/mail\/|\/settings|\/delete/i.test(url)) return "";
  return url;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function orgUnitIds(rows) {
  return unique(rows.map((row) => row.courseOrgUnitId).filter((id) => id && id !== "unknown" && id !== "6629"));
}

function quizResultUrls(rows) {
  const urls = [];
  for (const row of rows) {
    const ids = parseJson(row.ids);
    const courseOrgUnitId = row.courseOrgUnitId || ids.courseOrgUnitId || "";
    const quizId = ids.quizId || "";
    const attemptId = ids.attemptId || "";
    if (courseOrgUnitId && quizId) urls.push(`https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_summary.d2l?ou=${courseOrgUnitId}&qi=${quizId}`);
    if (courseOrgUnitId && quizId && attemptId) urls.push(`https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_submissions_attempt.d2l?ou=${courseOrgUnitId}&qi=${quizId}&ai=${attemptId}`);
  }
  return unique(urls.map(safeD2lUrl));
}

function announcementUrls(rows) {
  const urls = [];
  for (const row of rows) {
    if (row.source !== "announcement") continue;
    const ids = parseJson(row.ids);
    const courseOrgUnitId = row.courseOrgUnitId || ids.courseOrgUnitId || "";
    const newsItemId = ids.newsItemId || "";
    if (courseOrgUnitId && newsItemId) urls.push(`https://kennesaw.view.usg.edu/d2l/le/news/${courseOrgUnitId}/${newsItemId}/view`);
  }
  return unique(urls.map(safeD2lUrl));
}

function gradeUrls(rows) {
  return orgUnitIds(rows).map((orgUnitId) => `https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=${orgUnitId}`);
}

function courseToolUrls(rows) {
  return orgUnitIds(rows).flatMap((orgUnitId) => [
    `https://kennesaw.view.usg.edu/d2l/lms/checklist/checklists.d2l?ou=${orgUnitId}`,
    `https://kennesaw.view.usg.edu/d2l/le/userprogress/${orgUnitId}/Summary`
  ]);
}

function contentUrls(rows) {
  return unique(rows
    .filter((row) => row.source === "contentTopic" || row.source === "contentModule" || row.source === "contentAttachment")
    .flatMap((row) => [row.itemUrl, row.url, row.contentUrl])
    .map(safeD2lUrl));
}

function areaForSection(label) {
  const text = String(label || "").toLowerCase();
  if (text.includes("rubric") || text.includes("assignment feedback")) return "1 rubric details/feedback and 4 assignment feedback";
  if (text.includes("quiz")) return "2 quiz/exam released results";
  if (text.includes("grade")) return "3 grade item feedback/comments";
  if (text.includes("announcement")) return "5 announcement details/attachments";
  if (text.includes("course tool")) return "6 disabled/empty course tools";
  if (text.includes("content")) return "7 content page text/HTML snapshots";
  if (text.includes("change")) return "8 change detection/daily update mode";
  return "unmapped";
}

function proofGuideForSection(label) {
  const text = String(label || "").toLowerCase();
  if (text.includes("quiz")) {
    return {
      apiRoute: "/d2l/api/le/(version)/(orgUnitId)/quizzes/ and /quizzes/(quizId)/attempts/",
      uiProof: "quiz_summary.d2l, quiz_submissions.d2l, and quiz_submissions_attempt.d2l result/review pages",
      proofRows: "quizAttempt, quizSubmission, quizAttemptRow, quizSummaryRow, quizQuestionResult, apiProbe"
    };
  }
  if (text.includes("grade")) {
    return {
      apiRoute: "/d2l/api/le/(version)/(orgUnitId)/grades/ and /grades/values/myGradeValues/",
      uiProof: "grades/my_grades/main.d2l and read-only visible grade detail/rubric links",
      proofRows: "gradeItem, gradeFeedback, rubricFeedback, rubricCriterionFeedback"
    };
  }
  if (text.includes("announcement")) {
    return {
      apiRoute: "/d2l/api/le/(version)/(orgUnitId)/news/ and /news/(newsItemId)/attachments/(fileId)",
      uiProof: "/d2l/le/news/(orgUnitId)/(newsItemId)/view announcement detail pages",
      proofRows: "announcement, announcementAttachment, announcementLink, apiProbe"
    };
  }
  if (text.includes("course tool")) {
    return {
      apiRoute: "Tool-specific read APIs when available, plus page status probes",
      uiProof: "classlist, checklist, group, selfassess, survey, attendance, and userprogress pages",
      proofRows: "courseToolPage, checklistItem, survey, selfAssessment, attendanceRecord, group, classlistEntry, progressRecord, apiProbe"
    };
  }
  if (text.includes("content")) {
    return {
      apiRoute: "/d2l/api/le/(version)/(orgUnitId)/content/toc and course file APIs",
      uiProof: "Content topic/viewer pages and downloaded file/quicklink pages",
      proofRows: "contentModule, contentTopic, contentAttachment, externalLink, localPageTextPath"
    };
  }
  if (text.includes("change")) {
    return {
      apiRoute: "Same read-only API/page rows as the current export, compared with prior manifest summaries",
      uiProof: "A later targeted or daily read-only run with stable row IDs",
      proofRows: "change-report.md, change-report.json, student-action-brief.md, newlyFeedback, dueChanged, availabilityChanged"
    };
  }
  return { apiRoute: "", uiProof: "", proofRows: "" };
}

function urlMetadata(sections) {
  const metadata = new Map();
  for (const section of sections) {
    for (const url of section.urls || []) {
      if (!metadata.has(url)) metadata.set(url, { url, label: section.label, area: section.area, apiRoute: section.apiRoute, uiProof: section.uiProof, proofRows: section.proofRows, proofGaps: section.proofGaps || [] });
    }
  }
  return metadata;
}

function batchDetails(batches, sections) {
  const metadata = urlMetadata(sections);
  return batches.map((urls, index) => ({
    index: index + 1,
    urls,
    items: urls.map((url) => metadata.get(url) || { url, label: "Unmapped URL", area: "unmapped", proofGaps: [] })
  }));
}

function planSections({ rows, evidence }) {
  const allSections = [
    ["Rubric / assignment feedback pages", [], [
      evidence.rubricFeedbackRows === 0 ? "no rubricFeedback rows" : "",
      evidence.rubricCriterionFeedbackRows === 0 ? "no rubricCriterionFeedback rows" : ""
    ]],
    ["Quiz released result pages", quizResultUrls(rows), [
      evidence.quizAttemptPages === 0 ? "no quiz attempt result pages" : "",
      evidence.quizSubmissionPages === 0 ? "no quiz submission pages" : "",
      evidence.quizQuestionResultRows === 0 ? "no quizQuestionResult rows" : ""
    ]],
    ["Announcement detail pages", announcementUrls(rows), [
      evidence.announcementPages === 0 ? "no announcement detail pages" : "",
      evidence.announcementAttachmentRows === 0 ? "no announcementAttachment rows" : "",
      evidence.announcementLinkRows === 0 ? "no announcementLink rows" : ""
    ]],
    ["Visible gradebook pages", gradeUrls(rows), [
      evidence.gradePages === 0 ? "no visible gradebook pages" : "",
      evidence.gradeFeedbackRows === 0 ? "no gradeFeedback rows" : ""
    ]],
    ["Secondary course tool pages", courseToolUrls(rows), [
      evidence.courseToolPages === 0 && evidence.courseToolPageRows === 0 ? "no secondary course tool pages" : ""
    ]],
    ["Content page snapshots", contentUrls(rows), [
      evidence.contentTopicRows === 0 ? "no contentTopic rows" : "",
      evidence.contentSnapshotRows === 0 ? "no localPageTextPath/content snapshots" : "",
      evidence.contentAttachmentRows === 0 ? "no contentAttachment rows" : ""
    ]],
    ["Change detection daily update", [], [
      evidence.changeReportAvailable === 0 ? "no available changeReport baseline" : ""
    ]]
  ].map(([label, urls, reasons]) => {
    const proofGaps = reasons.filter(Boolean);
    return { label, area: areaForSection(label), ...proofGuideForSection(label), urls: unique(urls.map(safeD2lUrl)), needsProof: proofGaps.length > 0, proofGaps };
  });
  return {
    prioritySections: allSections.filter((section) => section.needsProof),
    optionalSections: allSections.filter((section) => !section.needsProof && section.urls.length)
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const rows = [
  { source: "quiz", courseOrgUnitId: "9900002", ids: JSON.stringify({ quizId: "7" }) },
  { source: "quizAttempt", courseOrgUnitId: "9900002", ids: JSON.stringify({ quizId: "7", attemptId: "9" }) },
  { source: "announcement", courseOrgUnitId: "9900002", ids: JSON.stringify({ newsItemId: "123" }) },
  { source: "gradeItem", courseOrgUnitId: "9900002", ids: JSON.stringify({ gradeObjectId: "55" }) },
  { source: "contentTopic", courseOrgUnitId: "9900002", itemUrl: "https://kennesaw.view.usg.edu/d2l/le/content/9900002/viewContent/8877/View" }
];

const quizUrls = quizResultUrls(rows);
const newsUrls = announcementUrls(rows);
const gradebookUrls = gradeUrls(rows);
const toolUrls = courseToolUrls(rows);
const topicUrls = contentUrls(rows);
const allUrls = [...quizUrls, ...newsUrls, ...gradebookUrls, ...toolUrls, ...topicUrls];

assert(quizUrls.some((url) => /quiz_summary\.d2l/.test(url)), "targeted validation plan includes quiz summary URL");
assert(quizUrls.some((url) => /quiz_submissions_attempt\.d2l/.test(url)), "targeted validation plan includes released quiz attempt URL");
assert(newsUrls.some((url) => /\/news\/9900002\/123\/view/.test(url)), "targeted validation plan includes announcement detail URL");
assert(gradebookUrls.some((url) => /grades\/my_grades\/main\.d2l/.test(url)), "targeted validation plan includes visible gradebook URL");
assert(toolUrls.some((url) => /checklist\/checklists\.d2l/.test(url)), "targeted validation plan includes secondary tool URL");
assert(topicUrls.some((url) => /\/content\/9900002\/viewContent\/8877\/View/.test(url)), "targeted validation plan includes content topic URL");
assert(allUrls.every(safeD2lUrl), "targeted validation plan only includes read-only safe D2L URLs");
assert(!allUrls.some((url) => /quiz_start|folder_submit|posts\/new|mail|settings|delete/i.test(url)), "targeted validation plan avoids side-effect URLs");

const planned = planSections({
  rows,
  evidence: {
    assignmentFeedbackPages: 6,
    rubricFeedbackRows: 1,
    rubricCriterionFeedbackRows: 1,
    quizAttemptPages: 0,
    quizSubmissionPages: 0,
    quizQuestionResultRows: 0,
    announcementPages: 0,
    announcementAttachmentRows: 0,
    announcementLinkRows: 0,
    gradePages: 0,
    gradeFeedbackRows: 0,
    courseToolPages: 0,
    courseToolPageRows: 0,
    contentTopicRows: 1,
    contentSnapshotRows: 0,
    contentAttachmentRows: 0,
    changeReportAvailable: 0
  }
});
const batches = [allUrls.slice(0, 3), allUrls.slice(3, 6)];
const details = batchDetails(batches, planned.prioritySections);

assert(planned.prioritySections.some((section) => section.label === "Quiz released result pages"), "targeted validation plan prioritizes quiz pages when attempt details are unproven");
assert(planned.prioritySections.find((section) => section.label === "Quiz released result pages").proofGaps.includes("no quizQuestionResult rows"), "targeted validation plan explains quiz proof gaps");
assert(planned.prioritySections.some((section) => section.label === "Announcement detail pages"), "targeted validation plan prioritizes unproven announcement pages");
assert(planned.prioritySections.find((section) => section.label === "Announcement detail pages").proofGaps.includes("no announcementLink rows"), "targeted validation plan explains announcement link proof gaps");
assert(planned.prioritySections.some((section) => section.label === "Visible gradebook pages"), "targeted validation plan prioritizes unproven gradebook pages");
assert(planned.prioritySections.some((section) => section.label === "Secondary course tool pages"), "targeted validation plan prioritizes unproven course tool pages");
assert(planned.prioritySections.some((section) => section.label === "Content page snapshots"), "targeted validation plan prioritizes unproven content snapshots");
assert(planned.prioritySections.find((section) => section.label === "Content page snapshots").area === "7 content page text/HTML snapshots", "targeted validation plan maps content snapshots to goal area");
assert(planned.prioritySections.find((section) => section.label === "Content page snapshots").proofRows.includes("localPageTextPath"), "targeted validation plan includes content snapshot proof rows");
assert(planned.prioritySections.find((section) => section.label === "Secondary course tool pages").area === "6 disabled/empty course tools", "targeted validation plan maps course tools to goal area");
assert(details[0].items.every((item) => item.area && item.label), "targeted validation plan batch details keep area and label metadata");
assert(details[0].items.every((item) => item.apiRoute && item.uiProof && item.proofRows), "targeted validation plan batch details keep API and UI proof metadata");
assert(details.some((batch) => batch.items.some((item) => item.label === "Announcement detail pages")), "targeted validation plan batch details include announcement section labels");
assert(planned.prioritySections.find((section) => section.label === "Quiz released result pages").apiRoute.includes("/quizzes/(quizId)/attempts/"), "targeted validation plan includes quiz API proof route");
assert(planned.prioritySections.find((section) => section.label === "Visible gradebook pages").proofRows.includes("gradeFeedback"), "targeted validation plan includes grade feedback proof rows");
assert(planned.prioritySections.some((section) => section.label === "Change detection daily update" && section.urls.length === 0), "targeted validation plan records change detection proof gap without crawl URLs");
assert(!planned.prioritySections.some((section) => section.label === "Rubric / assignment feedback pages"), "targeted validation plan skips already-proven assignment feedback pages");
assert(!planned.optionalSections.some((section) => section.label === "Quiz released result pages"), "targeted validation plan does not hide unproven quiz details as optional");

console.log("Targeted validation plan tests passed.");
