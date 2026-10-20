import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const downloadsRoot = path.join(os.homedir(), "Downloads", "D2L Export");
  const archiveInput = process.argv[2] || newestExport(downloadsRoot);
  const planInput = process.argv[3] || "";

  if (!archiveInput) {
    console.error("Usage: node tools/verify-targeted-validation.mjs [archive-folder] [plan-json]");
    process.exit(1);
  }

  const archiveRoot = path.resolve(archiveInput);
  const manifestPath = path.join(archiveRoot, "manifest.json");
  const planPath = planInput ? path.resolve(planInput) : path.join(archiveRoot, "targeted-validation-plan.json");

  if (!fs.existsSync(manifestPath)) {
    console.error(`No manifest.json found in ${archiveRoot}`);
    process.exit(1);
  }
  if (!fs.existsSync(planPath)) {
    console.error(`No targeted-validation-plan.json found at ${planPath}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const verification = verifyTargetedValidation({ archiveRoot, manifest, plan, planPath });
  const md = markdown(verification);
  const mdPath = path.join(archiveRoot, "targeted-validation-verification.md");
  const jsonPath = path.join(archiveRoot, "targeted-validation-verification.json");

  try {
    fs.writeFileSync(mdPath, md);
    fs.writeFileSync(jsonPath, JSON.stringify(verification, null, 2));
    console.log(`Wrote ${mdPath}`);
    console.log(`Wrote ${jsonPath}`);
  } catch (error) {
    const fallbackBase = path.join(process.cwd(), `targeted-validation-verification-${path.basename(archiveRoot)}`);
    fs.writeFileSync(`${fallbackBase}.md`, md);
    fs.writeFileSync(`${fallbackBase}.json`, JSON.stringify(verification, null, 2));
    console.error(`Could not write into archive folder (${error.code || "error"}); wrote fallback files in current directory.`);
  }
  console.log(md);
}

export function verifyTargetedValidation({ archiveRoot = "", manifest, plan, planPath = "" }) {
  const rows = Array.isArray(manifest?.rows) ? manifest.rows : [];
  const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
  const visitedUrls = pageUrlsSet(pages);
  const evidence = pageEvidence(rows, pages, manifest);
  const baselineEvidence = plan?.pageEvidence && typeof plan.pageEvidence === "object" ? plan.pageEvidence : evidence;
  const plannedSections = (Array.isArray(plan?.prioritySections) && plan.prioritySections.length
    ? plan.prioritySections
    : (Array.isArray(plan?.sections) ? plan.sections.filter((section) => section.needsProof) : []));

  const sections = plannedSections.map((section) => {
    const urls = unique(section.urls.map(normalizeUrl));
    const visitedPlannedUrls = urls.filter((url) => visitedUrls.has(url));
    const missingPlannedUrls = urls.filter((url) => !visitedUrls.has(url));
    const proofGaps = proofGapsForSection(section, baselineEvidence);
    const closedProofGaps = proofGaps.filter((gap) => proofGapClosed(gap, section.label, evidence));
    const openProofGaps = proofGaps.filter((gap) => !closedProofGaps.includes(gap));
    const status = visitedPlannedUrls.length === urls.length && openProofGaps.length === 0
      ? "covered"
      : visitedPlannedUrls.length > 0 || closedProofGaps.length > 0
        ? "partial"
        : "unproven";
    return {
      label: section.label || "Untitled section",
      area: areaForSection(section.label || ""),
      status,
      nextAction: nextActionForSection(section.label || "", openProofGaps, missingPlannedUrls),
      plannedUrlCount: urls.length,
      visitedPlannedUrlCount: visitedPlannedUrls.length,
      visitedPlannedUrls,
      missingPlannedUrls,
      proofGaps,
      closedProofGaps,
      openProofGaps
    };
  });

  const totals = {
    plannedSections: sections.length,
    coveredSections: sections.filter((section) => section.status === "covered").length,
    partialSections: sections.filter((section) => section.status === "partial").length,
    unprovenSections: sections.filter((section) => section.status === "unproven").length,
    plannedUrls: sections.reduce((sum, section) => sum + section.plannedUrlCount, 0),
    visitedPlannedUrls: sections.reduce((sum, section) => sum + section.visitedPlannedUrlCount, 0),
    openProofGaps: sections.reduce((sum, section) => sum + section.openProofGaps.length, 0),
    closedProofGaps: sections.reduce((sum, section) => sum + section.closedProofGaps.length, 0)
  };
  const areaCoverage = areaCoverageSummary(sections);

  return {
    archiveRoot,
    planPath,
    exportedAt: manifest?.exportedAt || "",
    planExportedAt: plan?.exportedAt || "",
    evidence,
    totals,
    areaCoverage,
    sections
  };
}

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

function normalizeUrl(url) {
  try {
    const parsed = new URL(url || "");
    parsed.hash = "";
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return String(url || "").trim();
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function pageUrlsSet(pages) {
  const urls = new Set();
  for (const page of pages) {
    for (const url of [page?.page?.url, page?.pageUrl, page?.crawlTask?.requestedUrl]) {
      const normalized = normalizeUrl(url);
      if (normalized) urls.add(normalized);
    }
  }
  return urls;
}

function pageText(page) {
  return [
    page?.page?.url,
    page?.pageUrl,
    page?.crawlTask?.requestedUrl,
    page?.crawlTask?.kind,
    page?.page?.title,
    page?.page?.text
  ].filter(Boolean).join(" ");
}

function countPages(pages, pattern) {
  return pages.filter((page) => pattern.test(pageText(page))).length;
}

function countSource(rows, ...sources) {
  const sourceSet = new Set(sources);
  return rows.filter((row) => sourceSet.has(row.source)).length;
}

function pageEvidence(rows, pages, manifest = {}) {
  return {
    assignmentFeedbackPages: countPages(pages, /folder_user_view_feedback\.d2l/i),
    rubricFeedbackRows: countSource(rows, "rubricFeedback"),
    rubricCriterionFeedbackRows: countSource(rows, "rubricCriterionFeedback"),
    quizSummaryPages: countPages(pages, /quiz_summary\.d2l/i),
    quizAttemptPages: countPages(pages, /quiz_submissions_attempt\.d2l/i),
    quizSubmissionPages: countPages(pages, /quiz_submissions\.d2l/i),
    quizQuestionResultRows: countSource(rows, "quizQuestionResult"),
    announcementPages: countPages(pages, /\/news\/\d+\/\d+\/view/i),
    announcementAttachmentRows: countSource(rows, "announcementAttachment"),
    announcementLinkRows: countSource(rows, "announcementLink"),
    gradePages: countPages(pages, /grades\/my_grades\/main\.d2l/i),
    gradeFeedbackRows: countSource(rows, "gradeFeedback"),
    courseToolPages: countPages(pages, /classlist|checklist|group|selfassess|survey|attendance|userprogress/i),
    courseToolPageRows: countSource(rows, "courseToolPage"),
    contentTopicRows: countSource(rows, "contentTopic"),
    contentAttachmentRows: countSource(rows, "contentAttachment"),
    contentSnapshotRows: rows.filter((row) => row.localPageTextPath || (row.source === "contentTopic" && row.localPath)).length,
    changeReportAvailable: manifest.changeReport?.available === true ? 1 : 0
  };
}

function proofGapClosed(gap, label, evidence) {
  const text = `${label || ""} ${gap || ""}`.toLowerCase();
  if (text.includes("rubriccriterionfeedback")) return evidence.rubricCriterionFeedbackRows > 0;
  if (text.includes("rubricfeedback")) return evidence.rubricFeedbackRows > 0;
  if (text.includes("quiz attempt")) return evidence.quizAttemptPages > 0;
  if (text.includes("quiz submission")) return evidence.quizSubmissionPages > 0;
  if (text.includes("quizquestionresult")) return evidence.quizQuestionResultRows > 0;
  if (text.includes("announcementattachment")) return evidence.announcementAttachmentRows > 0;
  if (text.includes("announcementlink")) return evidence.announcementLinkRows > 0;
  if (text.includes("announcement detail")) return evidence.announcementPages > 0;
  if (text.includes("visible gradebook")) return evidence.gradePages > 0;
  if (text.includes("gradefeedback")) return evidence.gradeFeedbackRows > 0;
  if (text.includes("secondary course tool")) return evidence.courseToolPages > 0 || evidence.courseToolPageRows > 0;
  if (text.includes("contenttopic")) return evidence.contentTopicRows > 0;
  if (text.includes("localpagetextpath") || text.includes("content snapshots")) return evidence.contentSnapshotRows > 0;
  if (text.includes("contentattachment")) return evidence.contentAttachmentRows > 0;
  if (text.includes("changereport")) return evidence.changeReportAvailable > 0;
  return false;
}

function proofGapsForSection(section, evidence) {
  if (Array.isArray(section.proofGaps) && section.proofGaps.length) return section.proofGaps;
  const label = String(section.label || "").toLowerCase();
  if (label.includes("rubric") || label.includes("assignment feedback")) {
    return [
      evidence.rubricFeedbackRows === 0 ? "no rubricFeedback rows" : "",
      evidence.rubricCriterionFeedbackRows === 0 ? "no rubricCriterionFeedback rows" : ""
    ].filter(Boolean);
  }
  if (label.includes("quiz")) {
    return [
      evidence.quizAttemptPages === 0 ? "no quiz attempt result pages" : "",
      evidence.quizSubmissionPages === 0 ? "no quiz submission pages" : "",
      evidence.quizQuestionResultRows === 0 ? "no quizQuestionResult rows" : ""
    ].filter(Boolean);
  }
  if (label.includes("announcement")) {
    return [
      evidence.announcementPages === 0 ? "no announcement detail pages" : "",
      evidence.announcementAttachmentRows === 0 ? "no announcementAttachment rows" : "",
      evidence.announcementLinkRows === 0 ? "no announcementLink rows" : ""
    ].filter(Boolean);
  }
  if (label.includes("grade")) {
    return [
      evidence.gradePages === 0 ? "no visible gradebook pages" : "",
      evidence.gradeFeedbackRows === 0 ? "no gradeFeedback rows" : ""
    ].filter(Boolean);
  }
  if (label.includes("course tool")) {
    return [
      evidence.courseToolPages === 0 && evidence.courseToolPageRows === 0 ? "no secondary course tool pages" : ""
    ].filter(Boolean);
  }
  if (label.includes("content")) {
    return [
      evidence.contentTopicRows === 0 ? "no contentTopic rows" : "",
      evidence.contentSnapshotRows === 0 ? "no localPageTextPath/content snapshots" : "",
      evidence.contentAttachmentRows === 0 ? "no contentAttachment rows" : ""
    ].filter(Boolean);
  }
  if (label.includes("change")) {
    return [
      evidence.changeReportAvailable === 0 ? "no available changeReport baseline" : ""
    ].filter(Boolean);
  }
  return [];
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

function areaCoverageSummary(sections) {
  const byArea = new Map();
  for (const section of sections) {
    const area = section.area || "unmapped";
    const current = byArea.get(area) || { area, sections: 0, covered: 0, partial: 0, unproven: 0, openProofGaps: 0 };
    current.sections += 1;
    current[section.status] += 1;
    current.openProofGaps += section.openProofGaps.length;
    byArea.set(area, current);
  }
  return [...byArea.values()];
}

function nextActionForSection(label, openProofGaps, missingPlannedUrls) {
  if (missingPlannedUrls.length) return "Run the missing planned URLs in a targeted read-only batch, then verify the new export against the same plan.";
  if (!openProofGaps.length) return "No action needed for this section unless live D2L changed after the export.";
  const text = `${label} ${openProofGaps.join(" ")}`.toLowerCase();
  if (text.includes("rubric")) return "Inspect visited assignment feedback pages and patch rubric table/block parsing if rubric rows are visibly present but not exported.";
  if (text.includes("quiz")) return "Inspect visited quiz summary/result pages for released attempt links or visible question results; patch quiz result parsing if visible data is missing from rows.";
  if (text.includes("announcement")) return "Inspect visited announcement detail pages for visible files and body links; patch attachment/link parsing if visible data is missing from rows.";
  if (text.includes("grade")) return "Inspect the gradebook page for comments, feedback, rubrics, or detail links; patch grade feedback parsing if visible data is missing from rows.";
  if (text.includes("course tool")) return "Inspect the visited tool pages for empty, blocked, or item-visible states; patch courseToolPage/tool-row parsing if the page state was not exported.";
  if (text.includes("content")) return "Inspect content topic pages for readable body text, quicklinks, and downloadable files; patch content snapshot or attachment parsing if visible data is missing.";
  if (text.includes("change")) return "Run a later read-only export against the same extension version, then compare manifests to prove added, changed, due-date, availability, and feedback signals.";
  return "Inspect the visited pages and exported rows for this section, then patch the parser for any visible data that is missing.";
}

function markdown(value) {
  const lines = [
    "# D2L Targeted Validation Verification",
    "",
    `Archive: \`${value.archiveRoot}\``,
    `Plan: \`${value.planPath}\``,
    `Exported: ${value.exportedAt || "unknown"}`,
    `Plan exported: ${value.planExportedAt || "unknown"}`,
    "",
    "## Totals",
    "",
    `- Planned sections: ${value.totals.plannedSections}`,
    `- Covered sections: ${value.totals.coveredSections}`,
    `- Partial sections: ${value.totals.partialSections}`,
    `- Unproven sections: ${value.totals.unprovenSections}`,
    `- Visited planned URLs: ${value.totals.visitedPlannedUrls} / ${value.totals.plannedUrls}`,
    `- Closed proof gaps: ${value.totals.closedProofGaps}`,
    `- Open proof gaps: ${value.totals.openProofGaps}`,
    "",
    "## Area Coverage",
    "",
    ...(value.areaCoverage?.length
      ? value.areaCoverage.map((area) => `- ${area.area}: ${area.covered} covered, ${area.partial} partial, ${area.unproven} unproven, ${area.openProofGaps} open proof gaps`)
      : ["- No mapped targeted validation areas found."]),
    "",
    "## Evidence",
    "",
    ...Object.entries(value.evidence).map(([key, count]) => `- ${key}: ${count}`),
    "",
    "## Sections",
    ""
  ];
  if (!value.sections.length) {
    lines.push("No priority targeted validation sections were found in the plan.");
    lines.push("");
  }
  for (const section of value.sections) {
    lines.push(`### ${section.label}`);
    lines.push("");
    lines.push(`- Area: ${section.area || "unmapped"}`);
    lines.push(`- Status: ${section.status}`);
    lines.push(`- Next action: ${section.nextAction}`);
    lines.push(`- Visited planned URLs: ${section.visitedPlannedUrlCount} / ${section.plannedUrlCount}`);
    if (section.closedProofGaps.length) lines.push(`- Closed proof gaps: ${section.closedProofGaps.join("; ")}`);
    if (section.openProofGaps.length) lines.push(`- Open proof gaps: ${section.openProofGaps.join("; ")}`);
    if (section.missingPlannedUrls.length) {
      lines.push("- Missing planned URLs:");
      section.missingPlannedUrls.forEach((url) => lines.push(`  - ${url}`));
    }
    lines.push("");
  }
  return lines.join("\n");
}
