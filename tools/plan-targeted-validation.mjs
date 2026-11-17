import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newestExport, loadArchiveManifest } from "./verify/records.mjs";
import { safeD2lUrl, formatPlanSection, batchDetails, buildTargetedSections } from "./verify/targeted-plan.mjs";

const downloadsRoot = path.join(os.homedir(), "Downloads", "D2L Export");
const { archiveRoot, manifestPath, manifest } = loadArchiveManifest(process.argv[2] || newestExport(downloadsRoot), "Usage: node tools/plan-targeted-validation.mjs [archive-folder]");
const rows = Array.isArray(manifest.rows) ? manifest.rows : [];
const pages = Array.isArray(manifest.pages) ? manifest.pages : [];



function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

// safeD2lUrl imported from ./verify/targeted-plan.mjs

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

const evidence = pageEvidence();
const allSectionDefs = [
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
];
const allSections = buildTargetedSections(allSectionDefs);

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
  for (const section of value.prioritySections) formatPlanSection(lines, section, true);
  lines.push("## Optional / Already-Proven Areas", "");
  for (const section of value.optionalSections) formatPlanSection(lines, section, false);
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
