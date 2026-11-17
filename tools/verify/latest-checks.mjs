export function pageVisitChecksFromManifest(manifest) {
  const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
  const apiSummary = manifest?.audit?.totals?.apiSummary || {};
  const assignmentProbePages = apiSummary.assignmentProbePages || {};
  const quizProbePages = apiSummary.quizProbePages || {};
  const announcementProbePages = apiSummary.announcementProbePages || {};
  const gradeProbePages = apiSummary.gradeProbePages || {};
  const courseToolProbePages = apiSummary.courseToolProbePages || {};
  const pageUrl = (page) => [
    page?.page?.url,
    page?.pageUrl,
    page?.crawlTask?.requestedUrl
  ].filter(Boolean).join(" ");
  const countWhere = (pattern) => pages.filter((page) => pattern.test(pageUrl(page))).length;
  const assignmentHistoryPages = countWhere(/\/dropbox\/user\/folders_history\.d2l/i);
  const assignmentFeedbackPages = countWhere(/\/dropbox\/user\/folder_user_view_feedback\.d2l/i);
  const quizAttemptPages = countWhere(/\/quizzing\/user\/quiz_submissions_attempt\.d2l/i);
  const quizSubmissionPages = countWhere(/\/quizzing\/user\/quiz_submissions\.d2l/i);
  const quizSummaryPages = countWhere(/\/quizzing\/user\/quiz_summary\.d2l/i);
  const announcementDetailPages = countWhere(/\/d2l\/le\/news\/\d+\/\d+\/view/i);
  const gradePages = countWhere(/\/grades\/my_grades\/main\.d2l/i);
  const courseToolPages = countWhere(/\/(?:classlist|checklist|group|selfassess|survey|attendance|userprogress)\//i);
  const assignmentProbeVisited = Number(assignmentProbePages.visited || 0);
  const assignmentProbeFailed = Number(assignmentProbePages.failed || 0);
  const assignmentProbeRows = Number(assignmentProbePages.rows || 0);
  const quizProbeVisited = Number(quizProbePages.visited || 0);
  const quizProbeFailed = Number(quizProbePages.failed || 0);
  const quizProbeRows = Number(quizProbePages.rows || 0);
  const announcementProbeVisited = Number(announcementProbePages.visited || 0);
  const announcementProbeFailed = Number(announcementProbePages.failed || 0);
  const announcementProbeRows = Number(announcementProbePages.rows || 0);
  const gradeProbeVisited = Number(gradeProbePages.visited || 0);
  const gradeProbeFailed = Number(gradeProbePages.failed || 0);
  const gradeProbeRows = Number(gradeProbePages.rows || 0);
  const courseToolProbeVisited = Number(courseToolProbePages.visited || 0);
  const courseToolProbeFailed = Number(courseToolProbePages.failed || 0);
  const courseToolProbeRows = Number(courseToolProbePages.rows || 0);
  const area = {
    assignment: "1 rubric details/feedback and 4 assignment feedback",
    quiz: "2 quiz/exam released results",
    grade: "3 grade item feedback/comments",
    announcement: "5 announcement details/attachments",
    tools: "6 disabled/empty course tools"
  };
  return {
    assignmentProbeVisited,
    assignmentProbeFailed,
    assignmentProbeRows,
    quizProbeVisited,
    quizProbeFailed,
    quizProbeRows,
    announcementProbeVisited,
    announcementProbeFailed,
    announcementProbeRows,
    gradeProbeVisited,
    gradeProbeFailed,
    gradeProbeRows,
    courseToolProbeVisited,
    courseToolProbeFailed,
    courseToolProbeRows,
    assignmentHistoryPages,
    assignmentFeedbackPages,
    quizAttemptPages,
    quizSubmissionPages,
    quizSummaryPages,
    announcementDetailPages,
    gradePages,
    courseToolPages,
    checks: [
      {
        label: "Assignment probe page summary",
        area: area.assignment,
        status: assignmentProbeVisited > 0 ? "found" : "unproven",
        evidence: `${assignmentProbeVisited} visited, ${assignmentProbeFailed} failed, ${assignmentProbeRows} rows from audit.totals.apiSummary.assignmentProbePages`
      },
      {
        label: "Assignment history pages visited",
        area: area.assignment,
        status: assignmentHistoryPages > 0 ? "found" : "unproven",
        evidence: `${assignmentHistoryPages} pages with folders_history.d2l requested or saved`
      },
      {
        label: "Assignment feedback pages visited",
        area: area.assignment,
        status: assignmentFeedbackPages > 0 ? "found" : "unproven",
        evidence: `${assignmentFeedbackPages} pages with folder_user_view_feedback.d2l requested or saved`
      },
      {
        label: "Quiz probe page summary",
        area: area.quiz,
        status: quizProbeVisited > 0 ? "found" : "unproven",
        evidence: `${quizProbeVisited} visited, ${quizProbeFailed} failed, ${quizProbeRows} rows from audit.totals.apiSummary.quizProbePages`
      },
      {
        label: "Quiz attempt result pages visited",
        area: area.quiz,
        status: quizAttemptPages > 0 ? "found" : "unproven",
        evidence: `${quizAttemptPages} pages with quiz_submissions_attempt.d2l requested or saved`
      },
      {
        label: "Quiz submission pages visited",
        area: area.quiz,
        status: quizSubmissionPages > 0 ? "found" : "unproven",
        evidence: `${quizSubmissionPages} pages with quiz_submissions.d2l requested or saved`
      },
      {
        label: "Quiz summary pages visited",
        area: area.quiz,
        status: quizSummaryPages > 0 ? "found" : "unproven",
        evidence: `${quizSummaryPages} pages with quiz_summary.d2l requested or saved`
      },
      {
        label: "Announcement probe page summary",
        area: area.announcement,
        status: announcementProbeVisited > 0 ? "found" : "unproven",
        evidence: `${announcementProbeVisited} visited, ${announcementProbeFailed} failed, ${announcementProbeRows} rows from audit.totals.apiSummary.announcementProbePages`
      },
      {
        label: "Announcement detail pages visited",
        area: area.announcement,
        status: announcementDetailPages > 0 ? "found" : "unproven",
        evidence: `${announcementDetailPages} pages with /d2l/le/news/{course}/{item}/view requested or saved`
      },
      {
        label: "Grade probe page summary",
        area: area.grade,
        status: gradeProbeVisited > 0 ? "found" : "unproven",
        evidence: `${gradeProbeVisited} visited, ${gradeProbeFailed} failed, ${gradeProbeRows} rows from audit.totals.apiSummary.gradeProbePages`
      },
      {
        label: "Visible gradebook pages visited",
        area: area.grade,
        status: gradePages > 0 ? "found" : "unproven",
        evidence: `${gradePages} pages with grades/my_grades/main.d2l requested or saved`
      },
      {
        label: "Secondary course tool probe summary",
        area: area.tools,
        status: courseToolProbeVisited > 0 ? "found" : "unproven",
        evidence: `${courseToolProbeVisited} visited, ${courseToolProbeFailed} failed, ${courseToolProbeRows} rows from audit.totals.apiSummary.courseToolProbePages`
      },
      {
        label: "Secondary course tool pages visited",
        area: area.tools,
        status: courseToolPages > 0 ? "found" : "unproven",
        evidence: `${courseToolPages} pages with classlist/checklist/group/selfassess/survey/attendance/userprogress requested or saved`
      }
    ]
  };
}

export function gateLines() {
  return [
    "",
    "## Next Live Run Gate",
    "",
    "A fresh extension run should be treated as meaningfully better only if it produces:",
    "",
    '- A final `manifest.json` with `phase: "final"`, or a clearly inspectable `phase: "pre-files"` partial manifest if interrupted.',
    "- At least one `apiProbe` row per probed read-only area, including successful-empty assignment submission and quiz attempt probes where no evidence is returned.",
    "- Audit probe summaries for assignment and quiz probe pages showing whether probe pages ran, failed, or produced zero rows.",
    "- Saved page visits for assignment submission history and feedback probe URLs, specifically `folders_history.d2l` and `folder_user_view_feedback.d2l`.",
    "- Assignment evidence as `assignmentSubmission`, `submittedFile`, or `assignmentFeedback` when D2L exposes it, or `apiProbe` rows explaining empty/denied/unavailable access.",
    "- Saved page visits for quiz result URLs when released results are linked, specifically `quiz_submissions_attempt.d2l`, `quiz_submissions.d2l`, or `quiz_summary.d2l`.",
    "- Quiz result evidence as `quizAttempt`, `quizSubmission`, `quizAttemptRow`, or `quizSummaryRow`, without starting new attempts.",
    "- Downloaded files with local paths that exist inside the course folder.",
    "- A `student-action-brief.md`, `audit-report.md`, and this review file showing no unexplained missing categories."
  ];
}

function formatSmokeChecks(queryResults) {
  const lines = [];
  for (const result of queryResults) {
    if (!result.ok) {
      lines.push(`- ${result.query}: failed - ${result.error}`);
      continue;
    }
    const status = result.evidenceStatus === "unproven" ? "UNPROVEN" : "FOUND";
    const expected = result.expectedSources?.length ? `; expected sources ${result.expectedSources.join(", ")}` : "";
    const example = result.expectedExamples?.[0] || result.top;
    lines.push(`- ${status} - ${result.query}: ${result.matches} keyword matches, ${result.expectedMatches || 0} expected-source matches${expected}${example?.title ? `; example ${example.source} | ${example.title}` : ""}`);
  }
  return lines;
}

export function reviewMarkdown({ latest, previous, coverageSummary, queryResults, pageChecks, needsReview }) {
  const lines = [
    "# D2L Export Next Review",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Latest export: ${latest.fullPath}`,
    `Previous export: ${previous?.fullPath || "(none)"}`,
    "",
    "## Coverage",
    ""
  ];
  if (coverageSummary.available) {
    const s = coverageSummary.summary || {};
    lines.push(`- Covered: ${s.covered || "?"}`, `- Partial: ${s.partial || "?"}`, `- Missing: ${s.missing || "?"}`, `- Failed pages: ${s.failed_pages || "?"}`, `- Uncertain pages: ${s.uncertain_pages || "?"}`);
  } else {
    lines.push("- Offline verification summary was not available.");
  }
  lines.push("", "## Needs Review", "");
  if (needsReview.length) {
    for (const item of needsReview) {
      const expected = item.expectedSources?.length ? ` Expected sources: ${item.expectedSources.join(", ")}.` : "";
      lines.push(`- ${String(item.status || "review").toUpperCase()} - ${item.label || item.query}: ${item.evidence || ""}${expected}`);
    }
  } else {
    lines.push("- No missing, partial, or unproven categories were reported by the offline verifier.");
  }
  lines.push("", "## Smoke Checks", "", ...formatSmokeChecks(queryResults), "", "## Page Visit Checks", "");
  for (const check of pageChecks.checks || []) {
    const area = check.area ? ` [${check.area}]` : "";
    lines.push(`- ${String(check.status).toUpperCase()} - ${check.label}${area}: ${check.evidence}`);
  }
  lines.push(...gateLines());
  return `${lines.join("\n")}\n`;
}
