import { loadContentHooks } from "./test-production-loader.mjs";

const { compactLabelValueRows, quizIdsFromUrl, quizScoreText, quizQuestionRowsFromText } = loadContentHooks();

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const ids = quizIdsFromUrl("https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_submissions_attempt.d2l?ou=9900001&qi=12345&ai=67890");
assertEqual(ids.quizId, "12345", "quiz result parser captures quiz id");
assertEqual(ids.attemptId, "67890", "quiz result parser captures attempt id");

const labels = compactLabelValueRows(
  "Attempt: 1 Started: Sep 18, 2026 10:00 PM Completed: Sep 18, 2026 10:20 PM Score: 8 / 10 Feedback: Review chapter 2",
  ["Attempt", "Attempt Number", "Started", "Completed", "Score", "Grade", "Overall Grade", "Feedback", "Submission View"]
);
assertEqual(labels.attempt, "1", "quiz result parser captures attempt number");
assertEqual(labels.started, "Sep 18, 2026 10:00 PM", "quiz result parser captures started time");
assertEqual(labels.completed, "Sep 18, 2026 10:20 PM", "quiz result parser captures completed time");
assertEqual(labels.score, "8 / 10", "quiz result parser captures score");
assertEqual(labels.feedback, "Review chapter 2", "quiz result parser captures feedback");
assertEqual(quizScoreText("Overall Grade: 9 / 10 - 90%"), "Overall Grade: 9 / 10", "quiz parser captures overall grade score");

const questionRows = quizQuestionRowsFromText(
  "Question 1 Your Answer: Blue Feedback: Correct Score: 1 / 1 Question 2 Selected Answer: Red Feedback: Review color theory Points: 0 / 1",
  { quizId: "12345", attemptId: "67890" }
);
assertEqual(questionRows.length, 2, "quiz question parser emits visible question results");
assertEqual(questionRows[0].source, "quizQuestionResult", "quiz parser emits first-class result rows");
assertEqual(questionRows[0].columns.responseText, "Blue", "quiz parser captures response text");
assertEqual(questionRows[0].columns.feedbackText, "Correct", "quiz parser captures question feedback");
assertEqual(questionRows[0].columns.scoreText, "Score: 1 / 1", "quiz parser captures question score");
assertEqual(questionRows[1].ids.attemptId, "67890", "quiz parser preserves attempt id");

const d2lQuestionRows = quizQuestionRowsFromText(
  "Question 1 0 / 1 point Your Answer: A Correct Answer: B Question Feedback: Review section 3 Question 2 1 / 1 point Response: C Comment: Nice",
  { quizId: "12345", attemptId: "67890" }
);
assertEqual(d2lQuestionRows.length, 2, "quiz parser emits D2L-style bare score rows");
assertEqual(d2lQuestionRows[0].columns.scoreText, "0 / 1 point", "quiz parser captures bare points score");
assertEqual(d2lQuestionRows[0].columns.feedbackText, "Review section 3", "quiz parser captures feedback label");
assertEqual(d2lQuestionRows[1].columns.feedbackText, "Nice", "quiz parser captures comment label");

console.log("Quiz result production tests passed.");
