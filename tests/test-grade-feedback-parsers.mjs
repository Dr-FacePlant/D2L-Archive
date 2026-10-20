import { loadContentHooks } from "./test-production-loader.mjs";

const { gradeFeedbackRow } = loadContentHooks();

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const ordinaryGrade = gradeFeedbackRow({ title: "Quiz 1", points: "9 / 10", grade: "90%", commentsAndAssessments: "", url: "" });
assertEqual(ordinaryGrade, null, "ordinary grade row does not emit grade feedback");

const commentFeedback = gradeFeedbackRow({
  title: "Paper",
  points: "95 / 100",
  grade: "95%",
  commentsAndAssessments: "Instructor comment: strong thesis.",
  url: "https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=9900001"
});
assertEqual(commentFeedback.source, "gradeFeedback", "comment grade row emits gradeFeedback");
assertEqual(commentFeedback.status, "feedbackAvailable", "comment grade feedback has feedbackAvailable status");
assertEqual(commentFeedback.columns.feedbackText, "Instructor comment: strong thesis.", "comment grade feedback preserves feedbackText");
assertEqual(commentFeedback.columns.rubricText, "", "comment grade feedback does not invent rubric text");

const rubricFeedback = gradeFeedbackRow({
  title: "Project",
  points: "18 / 20",
  grade: "90%",
  commentsAndAssessments: "Rubric: Organization level 4. Feedback: tighten citation format.",
  url: "https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=9900001"
});
assertEqual(rubricFeedback.columns.rubricText, "Rubric: Organization level 4. Feedback: tighten citation format.", "rubric grade feedback preserves rubricText");

console.log("Grade feedback production tests passed.");
