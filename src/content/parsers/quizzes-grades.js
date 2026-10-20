(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;
  const {
    queryAll,
    queryOne,
    absoluteUrl,
    getOrgUnitId,
    headingText,
    pageText,
    linkRecord,
    extractTableRows,
    compactLabelValueRows
  } = content;

function quizIdsFromUrl(url = window.location.href) {
  const text = String(url || "");
  return {
    quizId: text.match(/[?&]qi=(\d+)/)?.[1] || text.match(/[?&]quizId=(\d+)/)?.[1] || "",
    attemptId: text.match(/[?&]ai=(\d+)/)?.[1] || text.match(/[?&]attemptId=(\d+)/)?.[1] || ""
  };
}

function quizScoreText(text) {
  return text.match(/\b(?:Overall Grade|Score|Grade|Attempt Score|Final Score)\b\s*:?\s*(?:\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?%|Complete|Incomplete)/i)?.[0] || "";
}

function quizQuestionRowsFromText(text, ids) {
  const normalized = normalizeText(text);
  if (!/\bQuestion\s+\d+/i.test(normalized)) return [];
  return normalized
    .split(/(?=\bQuestion\s+\d+\b)/i)
    .map((chunk) => normalizeText(chunk))
    .filter((chunk) => /^Question\s+\d+\b/i.test(chunk))
    .map((chunk) => {
      const questionNumber = chunk.match(/^Question\s+(\d+)/i)?.[1] || "";
      const scoreText = chunk.match(/\b(?:Score|Points|Grade)\b\s*:?\s*(?:\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:point|points|pts)|\d+(?:\.\d+)?%)/i)?.[0]
        || chunk.match(/\b\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*(?:point|points|pts)?\b/i)?.[0]
        || "";
      const feedbackText = chunk.match(/\b(?:Question Feedback|Feedback|Instructor Feedback|Comment)\b\s*:?\s*([^]+?)(?=\s+\b(?:Question\s+\d+|Score|Points|Grade|Response|Answer|Correct Answer)\b|$)/i)?.[1]?.trim() || "";
      const responseText = chunk.match(/\b(?:Your Answer|Response|Selected Answer|Answer)\b\s*:?\s*([^]+?)(?=\s+\b(?:Feedback|Score|Points|Grade|Correct Answer|Question\s+\d+)\b|$)/i)?.[1]?.trim() || "";
      return {
        source: "quizQuestionResult",
        title: questionNumber ? `Question ${questionNumber}` : "Quiz question result",
        description: chunk.slice(0, 2400),
        url: window.location.href,
        status: scoreText || feedbackText ? "resultVisible" : "checked",
        columns: {
          recoveredFrom: "quizQuestionResultText",
          questionNumber,
          scoreText,
          responseText: responseText.slice(0, 800),
          feedbackText: feedbackText.slice(0, 800)
        },
        ids: { courseOrgUnitId: getOrgUnitId(), ...ids, questionNumber }
      };
    });
}

function extractQuizResultRows(source) {
  const rows = extractTableRows(source);
  const text = pageText();
  const ids = quizIdsFromUrl();
  const labelValues = compactLabelValueRows(text, ["Attempt", "Attempt Number", "Started", "Completed", "Score", "Grade", "Overall Grade", "Feedback", "Submission View"]);
  const scoreText = quizScoreText(text);
  const hasResultText = /attempt|overall grade|score|grade|feedback|submission view|completed|started/i.test(text);
  if (hasResultText) {
    const rawQuizDescription = source === "quizSummaryRow"
      ? text.match(/\bDescription\b\s*([^]+?)(?=\s+\bQuiz Details\b|\s+\bCurrent User\b|\s+\bTime Limit\b|$)/i)?.[1]?.trim().slice(0, 1200) || ""
      : "";
    const summaryFields = source === "quizSummaryRow" ? {
      descriptionText: /^Quiz Details$/i.test(rawQuizDescription) ? "" : rawQuizDescription,
      currentUserText: text.match(/\bCurrent User\b\s*([^]+?)(?=\s+\bTime Limit\b|\s+\bAvailability\b|\s+\bAttempts\b|$)/i)?.[1]?.trim() || "",
      timeLimitText: text.match(/\bTime Limit\b\s*([^]+?)(?=\s+\bAvailability\b|\s+\bAttempts\b|$)/i)?.[1]?.trim() || "",
      availabilityText: text.match(/\bAvailability\b\s*([^]+?)(?=\s+\bAttempts\b|$)/i)?.[1]?.trim() || "",
      attemptsText: text.match(/\bAttempts\s+Allowed\s*-\s*\d+\s*,\s*Completed\s*-\s*\d+/i)?.[0]?.replace(/^Attempts\s+/i, "") || "",
      attemptsAllowed: text.match(/\bAllowed\s*-\s*(\d+)/i)?.[1] || "",
      attemptsCompleted: text.match(/\bCompleted\s*-\s*(\d+)/i)?.[1] || "",
      periodStatusText: text.match(/\b(?:Quiz Period Over|Attempts Completed|Not available|Available)\b/i)?.[0] || ""
    } : {};
    rows.push({
      source,
      title: headingText(1) || headingText() || (source === "quizSummaryRow" ? "Quiz summary" : source === "quizAttemptRow" ? "Quiz attempt" : "Quiz submission"),
      description: text.slice(0, 2400),
      url: window.location.href,
      status: scoreText || /overall grade|score|grade/i.test(text) ? "resultVisible" : source === "quizSummaryRow" ? "summaryVisible" : /feedback is not available|not available/i.test(text) ? "resultUnavailable" : "checked",
      columns: {
        recoveredFrom: "quizResultPageText",
        scoreText,
        ...summaryFields,
        ...(source === "quizSummaryRow" ? {} : labelValues)
      },
      ids: { courseOrgUnitId: getOrgUnitId(), ...ids }
    });
  }
  return [...rows, ...quizQuestionRowsFromText(text, ids)];
}

function gradeFeedbackRow({ title, points, grade, commentsAndAssessments, url }) {
  if (!/feedback|comment|rubric|assessment/i.test(commentsAndAssessments || "")) return null;
  return {
    source: "gradeFeedback",
    title: `${title} feedback`,
    description: commentsAndAssessments,
    url,
    status: "feedbackAvailable",
    columns: {
      displayedGrade: grade,
      points,
      feedbackText: commentsAndAssessments,
      rubricText: /rubric/i.test(commentsAndAssessments || "") ? commentsAndAssessments : ""
    },
    ids: { courseOrgUnitId: getOrgUnitId() }
  };
}

function extractGrades() {
  const rows = [];
  const tables = queryAll("table");
  for (const table of tables) {
    const headerRow = table.querySelector("tr");
    const headerText = normalizeText(headerRow?.textContent || "");
    if (!/Grade Item/i.test(headerText) || !/Points/i.test(headerText)) continue;
    const headers = Array.from(headerRow?.children || []).map((cell) => normalizeText(cell.textContent));
    const indexFor = (patterns, fallback) => {
      const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
      return index >= 0 ? index : fallback;
    };
    const titleIndex = indexFor([/grade item/i, /^item$/i, /^name$/i], 0);
    const pointsIndex = indexFor([/points/i, /score/i], 1);
    const gradeIndex = indexFor([/^grade$/i, /displayed grade/i, /value/i], 2);
    const commentsIndex = indexFor([/comments/i, /assessment/i, /feedback/i, /rubric/i], 3);

    const tableRows = Array.from(table.querySelectorAll("tr")).slice(1);
    for (const row of tableRows) {
      const cells = Array.from(row.children);
      const title = normalizeText(cells[titleIndex]?.textContent || cells[0]?.textContent);
      if (!title || /^Points$/i.test(title)) continue;
      const attemptsLink = row.querySelector("a[href*='quiz_submissions']");
      const url = absoluteUrl(attemptsLink?.getAttribute("href"));
      const points = normalizeText(cells[pointsIndex]?.textContent || cells[1]?.textContent);
      const grade = normalizeText(cells[gradeIndex]?.textContent || cells[2]?.textContent);
      const commentsAndAssessments = normalizeText(cells[commentsIndex]?.textContent || cells[3]?.textContent);
      rows.push({
        source: "gradeItem",
        title,
        description: normalizeText(row.textContent),
        status: /- \//.test(points) ? "notGraded" : "graded",
        url,
        columns: {
          points,
          grade,
          commentsAndAssessments
        },
        ids: { courseOrgUnitId: getOrgUnitId() }
      });
      const feedback = gradeFeedbackRow({ title, points, grade, commentsAndAssessments, url });
      if (feedback) rows.push(feedback);
    }
  }
  return rows;
}

function extractQuizzes() {
  const rows = [];
  const tables = queryAll("table");
  for (const table of tables) {
    const headerText = normalizeText(table.querySelector("tr")?.textContent || "");
    if (!/Quizzes/i.test(headerText) && !/Attempts/i.test(headerText)) continue;

    let section = "";
    for (const row of Array.from(table.querySelectorAll("tr")).slice(1)) {
      const cells = Array.from(row.children);
      const firstCellText = normalizeText(cells[0]?.textContent);
      if (/^(Future|Past|Current) Quizzes$/i.test(firstCellText)) {
        section = firstCellText;
        continue;
      }

      const titleLink = row.querySelector("a");
      const title = normalizeText(titleLink?.getAttribute("aria-label") || titleLink?.textContent || firstCellText);
      if (!title || /Evaluation Status|Attempts/i.test(title)) continue;

      const rowText = normalizeText(row.textContent);
      const feedbackLink = row.querySelector("a[href*='quiz_submissions']");
      rows.push({
        source: "quiz",
        title,
        description: rowText,
        status: section || "",
        url: absoluteUrl(titleLink?.getAttribute("href")),
        feedbackUrl: absoluteUrl(feedbackLink?.getAttribute("href")),
        dueAtText: rowText.match(/Due on [A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M/)?.[0] || "",
        availabilityText: rowText.match(/Available on .*?(?=(Feedback:|\d+\s*\/\s*\d+|$))/)?.[0] || "",
        columns: {
          evaluationStatus: normalizeText(cells[1]?.textContent),
          attempts: normalizeText(cells[2]?.textContent)
        },
        ids: { courseOrgUnitId: getOrgUnitId() }
      });
    }
  }
  return rows;
}


  Object.assign(content, {
    quizIdsFromUrl,
    quizScoreText,
    quizQuestionRowsFromText,
    extractQuizResultRows,
    gradeFeedbackRow,
    extractGrades,
    extractQuizzes
  });
})();
