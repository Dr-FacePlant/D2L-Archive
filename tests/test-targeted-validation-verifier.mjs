import { verifyTargetedValidation } from "../tools/verify-targeted-validation.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const plan = {
  exportedAt: "2026-09-19T13:57:57.537Z",
  pageEvidence: {
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
    contentTopicRows: 0,
    contentSnapshotRows: 0,
    contentAttachmentRows: 0,
    changeReportAvailable: 0
  },
  prioritySections: [
    {
      label: "Quiz released result pages",
      urls: [
        "https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_submissions_attempt.d2l?ou=9900002&qi=7&ai=9"
      ]
    },
    {
      label: "Announcement detail pages",
      urls: [
        "https://kennesaw.view.usg.edu/d2l/le/news/9900002/123/view"
      ]
    },
    {
      label: "Visible gradebook pages",
      urls: [
        "https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=9900002"
      ]
    },
    {
      label: "Secondary course tool pages",
      urls: [
        "https://kennesaw.view.usg.edu/d2l/lms/checklist/checklists.d2l?ou=9900002"
      ]
    },
    {
      label: "Content page snapshots",
      urls: [
        "https://kennesaw.view.usg.edu/d2l/le/content/9900002/viewContent/8877/View"
      ]
    },
    {
      label: "Change detection daily update",
      urls: []
    }
  ]
};

const manifest = {
  exportedAt: "2026-09-19T14:30:00.000Z",
  rows: [
    { source: "quizQuestionResult", title: "Question 1" },
    { source: "announcementLink", title: "Study guide" },
    { source: "gradeFeedback", title: "Project feedback" },
    { source: "courseToolPage", title: "Checklist", status: "availableEmpty" },
    { source: "contentTopic", title: "Week 1", localPageTextPath: "courses/Test/pages/week-1.md" },
    { source: "contentAttachment", title: "Slides" }
  ],
  pages: [
    {
      page: {
        url: "https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_submissions_attempt.d2l?qi=7&ou=9900002&ai=9",
        title: "Quiz Attempt"
      }
    },
    {
      pageUrl: "https://kennesaw.view.usg.edu/d2l/le/news/9900002/123/view"
    },
    {
      pageUrl: "https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=9900002"
    },
    {
      pageUrl: "https://kennesaw.view.usg.edu/d2l/lms/checklist/checklists.d2l?ou=9900002"
    },
    {
      pageUrl: "https://kennesaw.view.usg.edu/d2l/le/content/9900002/viewContent/8877/View"
    }
  ],
  changeReport: { available: true, totals: { added: 1, newlyFeedback: 1 } }
};

const report = verifyTargetedValidation({
  archiveRoot: "/tmp/fake-export",
  manifest,
  plan,
  planPath: "/tmp/fake-export/targeted-validation-plan.json"
});

const quiz = report.sections.find((section) => section.label === "Quiz released result pages");
const news = report.sections.find((section) => section.label === "Announcement detail pages");
const grades = report.sections.find((section) => section.label === "Visible gradebook pages");
const tools = report.sections.find((section) => section.label === "Secondary course tool pages");
const content = report.sections.find((section) => section.label === "Content page snapshots");
const change = report.sections.find((section) => section.label === "Change detection daily update");

assert(quiz.status === "partial", "targeted validation verifier closes quiz proof gaps without hiding open gaps");
assert(quiz.nextAction.includes("quiz summary/result pages"), "targeted validation verifier suggests quiz parser next action");
assert(quiz.closedProofGaps.includes("no quiz attempt result pages"), "targeted validation verifier recognizes visited quiz attempt page");
assert(quiz.closedProofGaps.includes("no quizQuestionResult rows"), "targeted validation verifier recognizes quiz question result rows");
assert(quiz.openProofGaps.includes("no quiz submission pages"), "targeted validation verifier keeps baseline gaps open until proven");
assert(news.status === "partial", "targeted validation verifier recognizes useful announcement detail link rows");
assert(news.area === "5 announcement details/attachments", "targeted validation verifier maps announcement section to goal area");
assert(news.closedProofGaps.includes("no announcement detail pages"), "targeted validation verifier recognizes visited announcement detail page");
assert(news.closedProofGaps.includes("no announcementLink rows"), "targeted validation verifier recognizes announcement link rows");
assert(news.openProofGaps.includes("no announcementAttachment rows"), "targeted validation verifier keeps attachment gap open when only links are found");
assert(grades.status === "covered", "targeted validation verifier closes grade proof gaps");
assert(grades.nextAction.includes("No action needed"), "targeted validation verifier marks covered sections as no action needed");
assert(tools.status === "covered", "targeted validation verifier recognizes courseToolPage rows");
assert(tools.area === "6 disabled/empty course tools", "targeted validation verifier maps tool section to goal area");
assert(content.status === "covered", "targeted validation verifier closes content snapshot proof gaps");
assert(content.area === "7 content page text/HTML snapshots", "targeted validation verifier maps content section to goal area");
assert(change.status === "covered", "targeted validation verifier closes change detection proof gaps");
assert(change.area === "8 change detection/daily update mode", "targeted validation verifier maps change section to goal area");
assert(report.totals.visitedPlannedUrls === 5, "targeted validation verifier counts visited planned URLs");
assert(report.totals.openProofGaps === 2, "targeted validation verifier counts open proof gaps");
assert(report.areaCoverage.some((area) => area.area === "2 quiz/exam released results" && area.partial === 1), "targeted validation verifier summarizes area coverage");

const missingUrlReport = verifyTargetedValidation({
  manifest: { rows: [], pages: [] },
  plan: {
    pageEvidence: { announcementPages: 0, announcementAttachmentRows: 0, announcementLinkRows: 0 },
    prioritySections: [
      {
        label: "Announcement detail pages",
        urls: ["https://kennesaw.view.usg.edu/d2l/le/news/9900002/999/view"]
      }
    ]
  }
});
assert(missingUrlReport.sections[0].nextAction.includes("Run the missing planned URLs"), "targeted validation verifier suggests rerunning missing URLs");

console.log("Targeted validation verifier tests passed.");
