function buildProbeCounts(manifest) {
  const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
  const apiSummary = manifest?.audit?.totals?.apiSummary || {};
  const ap = apiSummary.assignmentProbePages || {};
  const qp = apiSummary.quizProbePages || {};
  const anp = apiSummary.announcementProbePages || {};
  const gp = apiSummary.gradeProbePages || {};
  const ctp = apiSummary.courseToolProbePages || {};
  const pageUrl = (page) => [page?.page?.url, page?.pageUrl, page?.crawlTask?.requestedUrl].filter(Boolean).join(" ");
  const countWhere = (pattern) => pages.filter((page) => pattern.test(pageUrl(page))).length;
  return {
    assignmentHistoryPages: countWhere(/\/dropbox\/user\/folders_history\.d2l/i),
    assignmentFeedbackPages: countWhere(/\/dropbox\/user\/folder_user_view_feedback\.d2l/i),
    quizAttemptPages: countWhere(/\/quizzing\/user\/quiz_submissions_attempt\.d2l/i),
    quizSubmissionPages: countWhere(/\/quizzing\/user\/quiz_submissions\.d2l/i),
    quizSummaryPages: countWhere(/\/quizzing\/user\/quiz_summary\.d2l/i),
    announcementDetailPages: countWhere(/\/d2l\/le\/news\/\d+\/\d+\/view/i),
    gradePages: countWhere(/\/grades\/my_grades\/main\.d2l/i),
    courseToolPages: countWhere(/\/(?:classlist|checklist|group|selfassess|survey|attendance|userprogress)\//i),
    assignmentProbeVisited: Number(ap.visited || 0), assignmentProbeFailed: Number(ap.failed || 0), assignmentProbeRows: Number(ap.rows || 0),
    quizProbeVisited: Number(qp.visited || 0), quizProbeFailed: Number(qp.failed || 0), quizProbeRows: Number(qp.rows || 0),
    announcementProbeVisited: Number(anp.visited || 0), announcementProbeFailed: Number(anp.failed || 0), announcementProbeRows: Number(anp.rows || 0),
    gradeProbeVisited: Number(gp.visited || 0), gradeProbeFailed: Number(gp.failed || 0), gradeProbeRows: Number(gp.rows || 0),
    courseToolProbeVisited: Number(ctp.visited || 0), courseToolProbeFailed: Number(ctp.failed || 0), courseToolProbeRows: Number(ctp.rows || 0)
  };
}

function buildPageVisitChecks(c) {
  const area = {
    assignment: "1 rubric details/feedback and 4 assignment feedback", quiz: "2 quiz/exam released results",
    grade: "3 grade item feedback/comments", announcement: "5 announcement details/attachments", tools: "6 disabled/empty course tools"
  };
  return [
    { label: "Assignment probe page summary", area: area.assignment, status: c.assignmentProbeVisited > 0 ? "found" : "unproven", evidence: `${c.assignmentProbeVisited} visited, ${c.assignmentProbeFailed} failed, ${c.assignmentProbeRows} rows from audit.totals.apiSummary.assignmentProbePages` },
    { label: "Assignment history pages visited", area: area.assignment, status: c.assignmentHistoryPages > 0 ? "found" : "unproven", evidence: `${c.assignmentHistoryPages} pages with folders_history.d2l requested or saved` },
    { label: "Assignment feedback pages visited", area: area.assignment, status: c.assignmentFeedbackPages > 0 ? "found" : "unproven", evidence: `${c.assignmentFeedbackPages} pages with folder_user_view_feedback.d2l requested or saved` },
    { label: "Quiz probe page summary", area: area.quiz, status: c.quizProbeVisited > 0 ? "found" : "unproven", evidence: `${c.quizProbeVisited} visited, ${c.quizProbeFailed} failed, ${c.quizProbeRows} rows from audit.totals.apiSummary.quizProbePages` },
    { label: "Quiz attempt result pages visited", area: area.quiz, status: c.quizAttemptPages > 0 ? "found" : "unproven", evidence: `${c.quizAttemptPages} pages with quiz_submissions_attempt.d2l requested or saved` },
    { label: "Quiz submission pages visited", area: area.quiz, status: c.quizSubmissionPages > 0 ? "found" : "unproven", evidence: `${c.quizSubmissionPages} pages with quiz_submissions.d2l requested or saved` },
    { label: "Quiz summary pages visited", area: area.quiz, status: c.quizSummaryPages > 0 ? "found" : "unproven", evidence: `${c.quizSummaryPages} pages with quiz_summary.d2l requested or saved` },
    { label: "Announcement probe page summary", area: area.announcement, status: c.announcementProbeVisited > 0 ? "found" : "unproven", evidence: `${c.announcementProbeVisited} visited, ${c.announcementProbeFailed} failed, ${c.announcementProbeRows} rows from audit.totals.apiSummary.announcementProbePages` },
    { label: "Announcement detail pages visited", area: area.announcement, status: c.announcementDetailPages > 0 ? "found" : "unproven", evidence: `${c.announcementDetailPages} pages with /d2l/le/news/{course}/{item}/view requested or saved` },
    { label: "Grade probe page summary", area: area.grade, status: c.gradeProbeVisited > 0 ? "found" : "unproven", evidence: `${c.gradeProbeVisited} visited, ${c.gradeProbeFailed} failed, ${c.gradeProbeRows} rows from audit.totals.apiSummary.gradeProbePages` },
    { label: "Visible gradebook pages visited", area: area.grade, status: c.gradePages > 0 ? "found" : "unproven", evidence: `${c.gradePages} pages with grades/my_grades/main.d2l requested or saved` },
    { label: "Secondary course tool probe summary", area: area.tools, status: c.courseToolProbeVisited > 0 ? "found" : "unproven", evidence: `${c.courseToolProbeVisited} visited, ${c.courseToolProbeFailed} failed, ${c.courseToolProbeRows} rows from audit.totals.apiSummary.courseToolProbePages` },
    { label: "Secondary course tool pages visited", area: area.tools, status: c.courseToolPages > 0 ? "found" : "unproven", evidence: `${c.courseToolPages} pages with classlist/checklist/group/selfassess/survey/attendance/userprogress requested or saved` }
  ];
}

export function pageVisitChecksFromManifest(manifest) {
  const counts = buildProbeCounts(manifest);
  return { ...counts, checks: buildPageVisitChecks(counts) };
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
