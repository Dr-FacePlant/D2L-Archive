import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const downloadsRoot = path.join(os.homedir(), "Downloads", "D2L Export");
const input = process.argv[2] || newestExport(downloadsRoot);

if (!input) {
  console.error("Usage: node tools/plan-targeted-validation.mjs [archive-folder]");
  process.exit(1);
}

const archiveRoot = path.resolve(input);
const manifestPath = path.join(archiveRoot, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`No manifest.json found in ${archiveRoot}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const rows = Array.isArray(manifest.rows) ? manifest.rows : [];
const pages = Array.isArray(manifest.pages) ? manifest.pages : [];

function newestExport(root) {
  if (!fs.existsSync(root)) return "";
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^d2l-export-/.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(root, entry.name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.fullPath || "";
}

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

function pageUrls(pattern) {
  return pages.map((page) => [
    page?.page?.url,
    page?.pageUrl,
    page?.crawlTask?.requestedUrl
  ].filter(Boolean).join(" "))
    .filter((url) => pattern.test(url));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function countSource(...sources) {
  const sourceSet = new Set(sources);
  return rows.filter((row) => sourceSet.has(row.source)).length;
}

function orgUnitIds() {
  return unique(rows.map((row) => row.courseOrgUnitId).filter((id) => id && id !== "unknown" && id !== "6629"));
}

function assignmentFeedbackUrls() {
  return unique(rows.flatMap((row) => [row.feedbackUrl, row.historyUrl, row.itemUrl])
    .map(safeD2lUrl)
    .filter((url) => /\/dropbox\/user\/(?:folder_user_view_feedback|folders_history)\.d2l/i.test(url)));
}

function quizResultUrls() {
  const urls = [];
  for (const row of rows) {
    const ids = parseJson(row.ids);
    const courseOrgUnitId = row.courseOrgUnitId || ids.courseOrgUnitId || "";
    const quizId = ids.quizId || String(row.itemUrl || "").match(/[?&](?:qi|quizId)=(\d+)/)?.[1] || "";
    const attemptId = ids.attemptId || String(row.itemUrl || "").match(/[?&](?:ai|attemptId)=(\d+)/)?.[1] || "";
    if (courseOrgUnitId && quizId) urls.push(`https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_summary.d2l?ou=${courseOrgUnitId}&qi=${quizId}`);
    if (courseOrgUnitId && quizId && attemptId) urls.push(`https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_submissions_attempt.d2l?ou=${courseOrgUnitId}&qi=${quizId}&ai=${attemptId}`);
  }
  return unique(urls.map(safeD2lUrl));
}

function announcementUrls() {
  const urls = [];
  for (const row of rows) {
    if (row.source !== "announcement") continue;
    const ids = parseJson(row.ids);
    const courseOrgUnitId = row.courseOrgUnitId || ids.courseOrgUnitId || "";
    const newsItemId = ids.newsItemId || String(row.itemUrl || "").match(/\/news\/\d+\/(\d+)\/view/i)?.[1] || "";
    const existing = safeD2lUrl(row.itemUrl || "");
    if (existing && /\/news\/\d+\/\d+\/view/i.test(existing)) urls.push(existing);
    else if (courseOrgUnitId && newsItemId) urls.push(`https://kennesaw.view.usg.edu/d2l/le/news/${courseOrgUnitId}/${newsItemId}/view`);
  }
  return unique(urls.map(safeD2lUrl));
}

function gradeUrls() {
  return orgUnitIds().map((orgUnitId) => `https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=${orgUnitId}`);
}

function courseToolUrls() {
  return orgUnitIds().flatMap((orgUnitId) => [
    `https://kennesaw.view.usg.edu/d2l/lms/classlist/classlist.d2l?ou=${orgUnitId}`,
    `https://kennesaw.view.usg.edu/d2l/lms/checklist/checklists.d2l?ou=${orgUnitId}`,
    `https://kennesaw.view.usg.edu/d2l/lms/group/group_list.d2l?ou=${orgUnitId}`,
    `https://kennesaw.view.usg.edu/d2l/lms/selfassess/selfassess.d2l?ou=${orgUnitId}`,
    `https://kennesaw.view.usg.edu/d2l/lms/survey/surveys.d2l?ou=${orgUnitId}`,
    `https://kennesaw.view.usg.edu/d2l/lms/attendance/registers/registers_list.d2l?ou=${orgUnitId}`,
    `https://kennesaw.view.usg.edu/d2l/le/userprogress/${orgUnitId}/Summary`
  ]);
}

function contentUrls() {
  return unique(rows
    .filter((row) => row.source === "contentTopic" || row.source === "contentModule" || row.source === "contentAttachment")
    .flatMap((row) => [row.itemUrl, row.url, row.contentUrl])
    .map(safeD2lUrl));
}

function chunks(values, size = 3) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function urlMetadata(sections) {
  const metadata = new Map();
  for (const section of sections) {
    for (const url of section.urls || []) {
      if (!metadata.has(url)) {
        metadata.set(url, {
          url,
          label: section.label,
          area: section.area,
          apiRoute: section.apiRoute,
          uiProof: section.uiProof,
          proofRows: section.proofRows,
          proofGaps: section.proofGaps || []
        });
      }
    }
  }
  return metadata;
}

function batchDetails(batches, sections) {
  const metadata = urlMetadata(sections);
  return batches.map((urls, index) => ({
    index: index + 1,
    urls,
    items: urls.map((url) => metadata.get(url) || { url, label: "Unmapped URL", area: "unmapped", apiRoute: "", uiProof: "", proofRows: "", proofGaps: [] })
  }));
}

function pageEvidence() {
  return {
    assignmentFeedbackPages: pageUrls(/folder_user_view_feedback\.d2l/i).length,
    rubricFeedbackRows: countSource("rubricFeedback"),
    rubricCriterionFeedbackRows: countSource("rubricCriterionFeedback"),
    quizSummaryPages: pageUrls(/quiz_summary\.d2l/i).length,
    quizAttemptPages: pageUrls(/quiz_submissions_attempt\.d2l/i).length,
    quizSubmissionPages: pageUrls(/quiz_submissions\.d2l/i).length,
    quizQuestionResultRows: countSource("quizQuestionResult"),
    announcementPages: pageUrls(/\/news\/\d+\/\d+\/view/i).length,
    announcementAttachmentRows: countSource("announcementAttachment"),
    announcementLinkRows: countSource("announcementLink"),
    gradePages: pageUrls(/grades\/my_grades\/main\.d2l/i).length,
    gradeFeedbackRows: countSource("gradeFeedback"),
    courseToolPages: pageUrls(/classlist|checklist|group|selfassess|survey|attendance|userprogress/i).length,
    courseToolPageRows: countSource("courseToolPage"),
    contentTopicRows: countSource("contentTopic"),
    contentAttachmentRows: countSource("contentAttachment"),
    contentSnapshotRows: rows.filter((row) => row.localPageTextPath || (row.source === "contentTopic" && row.localPath)).length,
    changeReportAvailable: manifest.changeReport?.available === true ? 1 : 0
  };
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
  if (text.includes("rubric") || text.includes("assignment feedback")) {
    return {
      apiRoute: "/d2l/api/le/(version)/(orgUnitId)/dropbox/folders/(folderId)/submissions/mysubmissions/ plus /rubrics/ and /assessment when object ids are visible",
      uiProof: "folder_user_view_feedback.d2l and folders_history.d2l read-only assignment feedback pages",
      proofRows: "assignmentSubmission, submittedFile, assignmentFeedback, rubricFeedback, rubricCriterionFeedback"
    };
  }
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

const evidence = pageEvidence();
const allSections = [
  ["Rubric / assignment feedback pages", assignmentFeedbackUrls(), [
    evidence.rubricFeedbackRows === 0 ? "no rubricFeedback rows" : "",
    evidence.rubricCriterionFeedbackRows === 0 ? "no rubricCriterionFeedback rows" : ""
  ]],
  ["Quiz released result pages", quizResultUrls(), [
    evidence.quizAttemptPages === 0 ? "no quiz attempt result pages" : "",
    evidence.quizSubmissionPages === 0 ? "no quiz submission pages" : "",
    evidence.quizQuestionResultRows === 0 ? "no quizQuestionResult rows" : ""
  ]],
  ["Announcement detail pages", announcementUrls(), [
    evidence.announcementPages === 0 ? "no announcement detail pages" : "",
    evidence.announcementAttachmentRows === 0 ? "no announcementAttachment rows" : "",
    evidence.announcementLinkRows === 0 ? "no announcementLink rows" : ""
  ]],
  ["Visible gradebook pages", gradeUrls(), [
    evidence.gradePages === 0 ? "no visible gradebook pages" : "",
    evidence.gradeFeedbackRows === 0 ? "no gradeFeedback rows" : ""
  ]],
  ["Secondary course tool pages", courseToolUrls(), [
    evidence.courseToolPages === 0 && evidence.courseToolPageRows === 0 ? "no secondary course tool pages" : ""
  ]],
  ["Content page snapshots", contentUrls(), [
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

const prioritySections = allSections.filter((section) => section.needsProof);
const optionalSections = allSections.filter((section) => !section.needsProof && section.urls.length);
const allUrls = unique(prioritySections.flatMap((section) => section.urls));
const batches = chunks(allUrls, 3);
const report = {
  archiveRoot,
  exportedAt: manifest.exportedAt || "",
  pageEvidence: evidence,
  prioritySections,
  optionalSections,
  sections: allSections,
  batches,
  batchDetails: batchDetails(batches, prioritySections)
};

function markdown(value) {
  const lines = [
    "# D2L Targeted Validation Plan",
    "",
    `Archive: \`${value.archiveRoot}\``,
    `Exported: ${value.exportedAt || "unknown"}`,
    "",
    "Use the extension popup with Mode `Targeted`, Workers `3`, Follow discovered links off, and paste one batch at a time into Target URLs.",
    "",
    "## Existing Page Evidence",
    "",
    ...Object.entries(value.pageEvidence).map(([key, count]) => `- ${key}: ${count}`),
    "",
    "## URL Batches",
    ""
  ];
  if (!value.batches.length) {
    lines.push("No priority URL batches are needed from this archive. Optional/proven URLs are listed below.");
    lines.push("");
  }
  value.batches.forEach((batch, index) => {
    lines.push(`### Batch ${index + 1}`);
    lines.push("");
    lines.push("```");
    lines.push(...batch);
    lines.push("```");
    const details = value.batchDetails?.[index]?.items || [];
    if (details.length) {
      lines.push("");
      lines.push("Batch details:");
      for (const item of details) {
        const gaps = item.proofGaps?.length ? `; gaps: ${item.proofGaps.join("; ")}` : "";
        const proof = item.proofRows ? `; proof rows: ${item.proofRows}` : "";
        const route = item.apiRoute ? `; API: ${item.apiRoute}` : "";
        lines.push(`- ${item.area} | ${item.label}${gaps}${proof}${route}`);
      }
    }
    lines.push("");
  });
  lines.push("## After Running Batches", "");
  lines.push("Run the targeted validation verifier against the new export folder and this plan JSON:");
  lines.push("");
  lines.push("```");
  lines.push("node tools/verify-targeted-validation.mjs /path/to/new-d2l-export /path/to/this-export/targeted-validation-plan.json");
  lines.push("```");
  lines.push("");
  lines.push("Expected verifier outputs:");
  lines.push("- `targeted-validation-verification.md`");
  lines.push("- `targeted-validation-verification.json`");
  lines.push("");
  lines.push("Use the verifier's `Area Coverage` and `Open proof gaps` sections to decide whether to patch parsers or run another targeted batch.");
  lines.push("");
  lines.push("## Priority Areas", "");
  for (const section of value.prioritySections) {
    lines.push(`### ${section.label}`);
    lines.push("");
    lines.push(`- Area: ${section.area}`);
    lines.push(`- API route: ${section.apiRoute}`);
    lines.push(`- UI proof: ${section.uiProof}`);
    lines.push(`- Proof rows/signals: ${section.proofRows}`);
    if (!section.urls.length) lines.push("- No URLs found from this archive.");
    else {
      if (section.proofGaps?.length) lines.push(`- Why priority: ${section.proofGaps.join("; ")}`);
      section.urls.forEach((url) => lines.push(`- ${url}`));
    }
    lines.push("");
  }
  lines.push("## Optional / Already-Proven Areas", "");
  for (const section of value.optionalSections) {
    lines.push(`### ${section.label}`);
    lines.push("");
    lines.push(`- Area: ${section.area}`);
    lines.push(`- API route: ${section.apiRoute}`);
    lines.push(`- UI proof: ${section.uiProof}`);
    lines.push(`- Proof rows/signals: ${section.proofRows}`);
    if (!section.urls.length) lines.push("- No URLs found from this archive.");
    else section.urls.forEach((url) => lines.push(`- ${url}`));
    lines.push("");
  }
  return lines.join("\n");
}

const md = markdown(report);
const mdPath = path.join(archiveRoot, "targeted-validation-plan.md");
const jsonPath = path.join(archiveRoot, "targeted-validation-plan.json");
try {
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`Wrote ${mdPath}`);
  console.log(`Wrote ${jsonPath}`);
} catch (error) {
  const fallbackBase = path.join(process.cwd(), `targeted-validation-plan-${path.basename(archiveRoot)}`);
  fs.writeFileSync(`${fallbackBase}.md`, md);
  fs.writeFileSync(`${fallbackBase}.json`, JSON.stringify(report, null, 2));
  console.error(`Could not write into archive folder (${error.code || "error"}); wrote fallback files in current directory.`);
}
console.log(md);
