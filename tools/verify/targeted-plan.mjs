export function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

export function safeD2lUrl(url) {
  if (!/^https:\/\/kennesaw\.view\.usg\.edu\/d2l\//i.test(url || "")) return "";
  if (/quiz_start|folder_submit|posts\/new|threads\/create|\/mail\/|\/settings|\/delete/i.test(url)) return "";
  return url;
}

export function areaForSection(label) {
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

export function proofGuideForSection(label) {
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
      proofRows: "contentModule, contentTopic, contentAttachment, localPageTextPath"
    };
  }
  if (text.includes("change")) {
    return {
      apiRoute: "Same-tab extraction or recurring sync against previous manifest",
      uiProof: "Verified export summary comparison and change-report.md",
      proofRows: "added, removed, changed, newlyGraded, newlyDue, dueChanged, availabilityChanged, newlyDownloaded, newlyFeedback"
    };
  }
  return { apiRoute: "unknown", uiProof: "unknown", proofRows: "unknown" };
}

export function formatPlanSection(lines, section, isPriority) {
  lines.push(`### ${section.label}`, "", `- Area: ${section.area}`, `- API route: ${section.apiRoute}`, `- UI proof: ${section.uiProof}`, `- Proof rows/signals: ${section.proofRows}`);
  if (!section.urls.length) lines.push("- No URLs found from this archive.");
  else {
    if (isPriority && section.proofGaps?.length) lines.push(`- Why priority: ${section.proofGaps.join("; ")}`);
    section.urls.forEach((url) => lines.push(`- ${url}`));
  }
  lines.push("");
}

export function urlMetadata(sections) {
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

export function batchDetails(batches, sections) {
  const metadata = urlMetadata(sections);
  return batches.map((urls, index) => ({
    index: index + 1,
    urls,
    items: urls.map((url) => metadata.get(url) || { url, label: "Unmapped URL", area: "unmapped", apiRoute: "", uiProof: "", proofRows: "", proofGaps: [] })
  }));
}

export function buildTargetedSections(sectionDefinitions) {
  return sectionDefinitions.map(([label, urls, reasons]) => {
    const proofGaps = reasons.filter(Boolean);
    return {
      label,
      area: areaForSection(label),
      ...proofGuideForSection(label),
      urls: [...new Set((urls || []).map(safeD2lUrl).filter(Boolean))],
      needsProof: proofGaps.length > 0,
      proofGaps
    };
  });
}
