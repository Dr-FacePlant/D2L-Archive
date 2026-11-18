(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText, compactLabelValueRows } = globalThis.D2LExtractorShared;
  const { queryAll, absoluteUrl, getOrgUnitId, headingText, pageText, submittedFileRows, assignmentFolderIdFromUrl } = content;

  function makeRubricCriterionItem({ recoveredFrom, rubricTitle, criterionName, rubricLevel, scoreText, feedbackText, index, description, url, assignmentFolderId, orgUnitId }) {
    return {
      source: "rubricCriterionFeedback",
      title: criterionName || `${rubricTitle || "Rubric criterion"} ${index + 1}`,
      description: (description || "").slice(0, 1600),
      url,
      status: scoreText || rubricLevel || feedbackText ? "criterionFeedbackVisible" : "criterionVisible",
      columns: {
        recoveredFrom,
        rubricTitle,
        criterionName,
        rubricLevel,
        scoreText,
        feedbackText: (feedbackText || "").slice(0, 800)
      },
      ids: { courseOrgUnitId: orgUnitId, assignmentFolderId, dropboxFolderId: assignmentFolderId, criterionNumber: String(index + 1) }
    };
  }

  function parseRubricCriterionChunks(text) {
    return normalizeText(text)
      .split(/(?=\b(?:Criterion|Criteria)\b\s*:?\s*)/i)
      .map((chunk) => normalizeText(chunk))
      .filter((chunk) => /\b(?:Criterion|Criteria)\b/i.test(chunk) && /\b(?:Level Achieved|Score|Feedback|Comments)\b/i.test(chunk));
  }

  function rubricCriterionRows(optionsOrText, maybeTitle) {
    const options = typeof optionsOrText === "object" && optionsOrText !== null
      ? optionsOrText
      : { text: optionsOrText, rubricTitle: maybeTitle };
    const { text, rubricTitle, assignmentFolderId, url, orgUnitId } = options;
    const chunks = parseRubricCriterionChunks(text);
    return chunks.map((chunk, index) => {
      const criterionName = chunk.match(/\b(?:Criterion|Criteria)\b\s*:?\s*([^]+?)(?=\s+\b(?:Level Achieved|Score|Feedback|Comments|Criterion|Criteria)\b|$)/i)?.[1]?.trim() || "";
      const rubricLevel = chunk.match(/\bLevel Achieved\b\s*:?\s*([^]+?)(?=\s+\b(?:Score|Feedback|Comments|Criterion|Criteria)\b|$)/i)?.[1]?.trim() || "";
      const scoreText = chunk.match(/\bScore\b\s*:?\s*(?:\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:point|points|pts)|\d+(?:\.\d+)?%)/i)?.[0] || "";
      const feedbackText = chunk.match(/\b(?:Feedback|Comments)\b\s*:?\s*([^]+?)(?=\s+\b(?:Criterion|Criteria|Score|Level Achieved)\b|$)/i)?.[1]?.trim() || "";
      return makeRubricCriterionItem({
        recoveredFrom: "assignmentFeedbackPageRubricCriterion",
        rubricTitle, criterionName, rubricLevel, scoreText, feedbackText, index,
        description: chunk,
        url: url || (typeof window !== "undefined" ? window.location?.href : ""),
        assignmentFolderId,
        orgUnitId: orgUnitId || (typeof getOrgUnitId === "function" ? getOrgUnitId() : "")
      });
    });
  }

  function rubricCriterionRowsFromTable(node, rubricTitle, assignmentFolderId) {
    return Array.from(node.querySelectorAll?.("tr") || [])
      .slice(1)
      .map((row, index) => {
        const cells = Array.from(row.children || []);
        const rowText = normalizeText(row.textContent || "");
        if (!rowText || !/\b(?:Score|Feedback|Comments|Level|Achieved|\d+(?:\.\d+)?\s*\/\s*\d+)/i.test(rowText)) return null;
        if (/^(Criteria|Criterion|Level|Score|Feedback|Comments)\b/i.test(rowText) && cells.length < 2) return null;
        const criterionName = normalizeText(cells[0]?.textContent || rowText.match(/^([^]+?)(?=\s+\b(?:Level|Score|Feedback|Comments)\b|\s+\d+(?:\.\d+)?\s*\/\s*\d+)/i)?.[1] || "").slice(0, 240);
        const rubricLevel = normalizeText(cells.find((cell) => /\b(?:Level|Achieved|Exemplary|Excellent|Proficient|Good|Needs|Unsatisfactory)\b/i.test(cell.textContent || ""))?.textContent || "");
        const scoreText = rowText.match(/\b(?:Score\b\s*:?\s*)?(?:\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:point|points|pts)|\d+(?:\.\d+)?%)/i)?.[0] || "";
        const feedbackText = rowText.match(/\b(?:Feedback|Comments)\b\s*:?\s*([^]+?)(?=\s+\b(?:Criterion|Criteria|Score|Level Achieved)\b|$)/i)?.[1]?.trim() || "";
        return makeRubricCriterionItem({
          recoveredFrom: "assignmentFeedbackPageRubricTableRow",
          rubricTitle, criterionName, rubricLevel, scoreText, feedbackText, index,
          description: rowText, url: window.location.href, assignmentFolderId, orgUnitId: getOrgUnitId()
        });
      })
      .filter(Boolean);
  }

  function parseRubricBlocks(assignmentFolderId) {
    return queryAll("[class*='rubric'], [id*='rubric'], a[href*='rubric']")
      .flatMap((node) => {
        const rubricText = normalizeText(node.textContent || "");
        const rubricLevel = rubricText.match(/Level Achieved:\s*([^]+?)(?=\s+(?:Overall Feedback|Feedback|Comments|Score|Grade|Rubric|Level Achieved)\b|$)/i)?.[1]?.trim() || "";
        const rubricTitle = normalizeText(node.querySelector?.("h1, h2, h3, a")?.textContent || rubricText).slice(0, 180);
        const rubricRow = {
          source: "rubricFeedback",
          title: rubricTitle,
          description: rubricText,
          url: absoluteUrl(node.getAttribute?.("href")),
          columns: {
            recoveredFrom: "assignmentFeedbackPageRubricBlock",
            rubricLevel
          },
          ids: { courseOrgUnitId: getOrgUnitId(), assignmentFolderId, dropboxFolderId: assignmentFolderId }
        };
        const criterionList = rubricCriterionRows({
          text: rubricText, rubricTitle, assignmentFolderId, url: window.location.href, orgUnitId: getOrgUnitId()
        });
        return [rubricRow, ...criterionList, ...rubricCriterionRowsFromTable(node, rubricTitle, assignmentFolderId)];
      })
      .filter((item) => item.title);
  }

  function extractAssignmentFeedback() {
    const text = pageText();
    const assignmentFolderId = assignmentFolderIdFromUrl();
    const rubricBlocks = parseRubricBlocks(assignmentFolderId);
    const fileLinks = submittedFileRows({ assignmentFolderId, recoveredFrom: "assignmentFeedbackPage" });
    const labelValues = compactLabelValueRows(text, ["Overall Feedback", "Feedback", "Comments", "Score", "Grade", "Rubric", "Level Achieved"]);
    const scoreText = text.match(/\b(?:Score|Grade|Overall Grade|Feedback)\b\s*:?\s*(?:\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?%|Complete|Incomplete)/i)?.[0] || "";
    const feedbackSummary = /feedback|score|grade|rubric|comment/i.test(text)
      ? [{
          source: "assignmentFeedback",
          title: headingText(1) || "Assignment feedback",
          description: text.slice(0, 2000),
          url: window.location.href,
          status: /no feedback|feedback is not available|not graded/i.test(text) ? "noFeedbackVisible" : "feedbackPageVisible",
          columns: {
            recoveredFrom: "assignmentFeedbackPage",
            scoreText,
            submittedFileCount: fileLinks.length,
            ...labelValues
          },
          ids: { courseOrgUnitId: getOrgUnitId(), assignmentFolderId, dropboxFolderId: assignmentFolderId }
        }]
      : [];

    return [...rubricBlocks, ...feedbackSummary, ...fileLinks];
  }

  Object.assign(content, {
    makeRubricCriterionItem,
    rubricCriterionRows,
    extractAssignmentFeedback
  });
})();
