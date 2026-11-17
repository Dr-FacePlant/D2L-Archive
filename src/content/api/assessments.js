(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;
  const { absoluteUrl, apiGet, apiList, richText, firstRichText, gradeDisplay, D2L_API_MODERN_VERSION } = content;

  function buildDropboxSubmissionEntities(orgUnitId, folder, entity, items) {
    const folderId = folder.Id;
    const entityName = normalizeText(entity.Entity?.DisplayName || entity.EntityName || entity.UserName || "My submission");
    const feedback = entity.Feedback || entity.Assessment || null;
    const submissionList = apiList(entity.Submissions);
    const nested = submissionList.some((submission) => Array.isArray(submission?.Files));
    const submissions = nested
      ? submissionList.flatMap((submission) => apiList(submission.Files).map((file) => ({ ...file, _submission: submission })))
      : apiList(entity.Submissions || entity.Files || entity.Attachments || entity.SubmissionFiles);
    const latestSubmission = submissionList.map((submission) => submission.SubmissionDate).filter(Boolean).sort().at(-1) || "";
    const submittedAt = entity.SubmittedDate || entity.LastSubmissionDate || latestSubmission || entity.CompletionDate || "";

    items.push({
      source: "assignmentSubmission",
      title: `${normalizeText(folder.Name)} submission`,
      description: normalizeText(`${entityName} ${richText(entity.Comments || entity.Comment || entity.Feedback)}`),
      url: `${window.location.origin}/d2l/lms/dropbox/user/folders_history.d2l?db=${folderId}&ou=${orgUnitId}`,
      status: submittedAt ? "submitted" : "submissionRecord",
      dueAtText: folder.DueDate || "",
      columns: {
        submittedAt,
        entityName,
        fileCount: submissions.length,
        submissions: nested ? submissionList.map((submission) => ({
          id: String(submission.Id ?? ""),
          submittedAt: submission.SubmissionDate || "",
          fileCount: apiList(submission.Files).length,
          comment: richText(submission.Comment)
        })) : [],
        feedbackPublished: !!feedback,
        feedbackText: richText(feedback?.Feedback || feedback?.Comments || feedback?.Comment),
        score: feedback?.Score ?? feedback?.ScoreNumerator ?? ""
      },
      ids: { courseOrgUnitId: orgUnitId, dropboxFolderId: String(folderId), submissionId: String(entity.SubmissionId || entity.Id || "") }
    });

    if (feedback) {
      items.push({
        source: "assignmentFeedback",
        title: `${normalizeText(folder.Name)} feedback`,
        description: richText(feedback.Feedback || feedback.Comments || feedback.Comment || feedback),
        url: `${window.location.origin}/d2l/lms/dropbox/user/folder_user_view_feedback.d2l?db=${folderId}&ou=${orgUnitId}`,
        status: "feedbackAvailable",
        columns: {
          score: feedback.Score ?? feedback.ScoreNumerator ?? "",
          outOf: feedback.OutOf ?? feedback.ScoreDenominator ?? "",
          lastModified: feedback.LastModified || feedback.FeedbackLastModified || ""
        },
        ids: { courseOrgUnitId: orgUnitId, dropboxFolderId: String(folderId), submissionId: String(entity.SubmissionId || entity.Id || "") }
      });
    }

    for (const file of submissions) {
      const fileId = file.FileId || file.Id || file.SubmissionFileId;
      const submissionId = file._submission?.Id || entity.SubmissionId || entity.Id || "";
      const fileName = normalizeText(file.FileName || file.Name || file.DisplayName || `submission-file-${fileId || submissions.indexOf(file) + 1}`);
      const downloadUrl = file.DownloadUrl
        ? absoluteUrl(file.DownloadUrl)
        : fileId && submissionId
          ? `${window.location.origin}/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/dropbox/folders/${folderId}/submissions/${submissionId}/files/${fileId}`
          : "";
      items.push({
        source: "submittedFile",
        title: fileName,
        description: normalizeText(`${normalizeText(folder.Name)} submitted file ${fileName}`),
        url: downloadUrl || `${window.location.origin}/d2l/lms/dropbox/user/folders_history.d2l?db=${folderId}&ou=${orgUnitId}`,
        downloadUrl,
        suggestedFileName: fileName,
        columns: { size: file.Size ?? "", submittedAt: file._submission?.SubmissionDate || "" },
        ids: { courseOrgUnitId: orgUnitId, dropboxFolderId: String(folderId), submissionId: String(submissionId), fileId: String(fileId || "") }
      });
    }
  }

  async function collectDropboxSubmissionItems(orgUnitId, folder) {
    const items = [];
    const folderId = folder.Id;
    const result = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/dropbox/folders/${folderId}/submissions/mysubmissions/`);
    if (!result.ok) return { status: result.status, items };
    for (const entity of apiList(result.data)) {
      buildDropboxSubmissionEntities(orgUnitId, folder, entity, items);
    }
    return { status: result.status, items };
  }

async function collectQuizAttemptItems(orgUnitId, quiz) {
  const items = [];
  const attemptDetailStatuses = {};
  const quizId = quiz.QuizId;
  const result = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/quizzes/${quizId}/attempts/`);
  if (!result.ok) {
    return { status: result.status, attemptDetailStatuses, items };
  }

  for (const attempt of apiList(result.data)) {
    const attemptId = attempt.AttemptId || attempt.Id;
    const detailResult = attemptId
      ? await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/quizzes/${quizId}/attempts/${attemptId}`)
      : { ok: false, status: "noAttemptId", data: null };
    attemptDetailStatuses[String(attemptId || "")] = detailResult.status;
    const detail = detailResult.ok ? detailResult.data : {};
    const mergedAttempt = { ...attempt, ...detail };
    items.push({
      source: "quizAttempt",
      title: `${normalizeText(quiz.Name)} attempt ${mergedAttempt.AttemptNumber ?? mergedAttempt.AttemptId ?? ""}`.trim(),
      description: firstRichText(
        mergedAttempt.AttemptFeedback,
        mergedAttempt.Feedback,
        mergedAttempt.SubmissionView?.Message,
        mergedAttempt.OverallFeedback
      ),
      url: `${window.location.origin}/d2l/lms/quizzing/user/quiz_submissions_attempt.d2l?ou=${orgUnitId}&qi=${quizId}&ai=${attempt.AttemptId}`,
      status: mergedAttempt.Completed ? "completed" : "inProgressOrUnavailable",
      dueAtText: mergedAttempt.AttemptDueDate || quiz.DueDate || "",
      columns: {
        recoveredFrom: detailResult.ok ? "quizAttemptDetailApi" : "quizAttemptsApi",
        attemptNumber: mergedAttempt.AttemptNumber ?? "",
        score: mergedAttempt.Score ?? mergedAttempt.ScoreNumerator ?? "",
        scoreOutOf: mergedAttempt.ScoreDenominator ?? quiz.ScoreOutOf ?? "",
        started: mergedAttempt.Started || "",
        completed: mergedAttempt.Completed || "",
        feedbackPublished: !!mergedAttempt.IsPublished,
        feedbackLastModified: mergedAttempt.FeedbackLastModified || "",
        isRetakeIncorrectOnly: !!mergedAttempt.IsRetakeIncorrectOnly,
        attemptDetailStatus: detailResult.status,
        submissionView: normalizeText(JSON.stringify(mergedAttempt.SubmissionView || {})).slice(0, 1200)
      },
      ids: { courseOrgUnitId: orgUnitId, quizId: String(quizId), attemptId: String(attempt.AttemptId || "") }
    });
  }

  return { status: result.status, attemptDetailStatuses, items };
}

function htmlText(html) {
  return normalizeText(String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&"));
}

// D2L renders the student Quiz List on the server: a header row per section
// ("Current Quizzes", "Past Quizzes"), then one row per quiz that names it in
// GoToQuiz(<quizId>, …) and ends with an Attempts cell such as "1 / 1".
function quizListRowsFromHtml(html) {
  const rows = [];
  let section = "";
  for (const chunk of String(html || "").split(/<tr\b/i).slice(1)) {
    const rowHtml = chunk.split(/<\/tr>/i)[0];
    // Each piece starts inside the cell's opening tag; drop its attributes.
    const cells = rowHtml.split(/<t[dh]\b/i).slice(1).map((cell) => cell.slice(cell.indexOf(">") + 1));
    const quizId = rowHtml.match(/GoToQuiz\(\s*(\d+)/)?.[1] || "";
    if (!quizId) {
      section = htmlText(cells[0]).match(/^(?:Current|Future|Past) Quizzes\b/i)?.[0] || section;
      continue;
    }
    const attempts = htmlText(cells.at(-1)).match(/^(\d+)\s*\/\s*(\S+)$/);
    if (!attempts) continue;
    const allowed = /^\d+$/.test(attempts[2]) ? Number(attempts[2]) : null;
    rows.push({
      quizId,
      title: htmlText(rowHtml.match(/GoToQuiz\([^>]*>([^]*?)<\/a>/i)?.[1]),
      section,
      evaluationStatus: cells.length > 2 ? htmlText(cells[1]) : "",
      attemptsCompleted: Number(attempts[1]),
      attemptsAllowed: allowed,
      attemptsUnlimited: allowed === null
    });
  }
  return rows;
}

// Students get 403 on the attempts API, but the Quiz List page shows how many
// attempts they used on every quiz in the course, in one read-only request.
async function collectQuizListItems(orgUnitId) {
  const url = `${window.location.origin}/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${orgUnitId}`;
  let response;
  try {
    response = await fetch(url, { credentials: "include" });
  } catch (error) {
    return { status: 0, items: [], error: error?.message || "fetch failed" };
  }
  if (!response.ok) return { status: response.status, items: [] };
  const rows = quizListRowsFromHtml(await response.text());
  const items = rows.map((row) => ({
    source: "quizListRow",
    title: row.title,
    description: normalizeText(`${row.title} attempts ${row.attemptsCompleted} / ${row.attemptsUnlimited ? "unlimited" : row.attemptsAllowed}`),
    url,
    status: row.attemptsCompleted > 0 ? "attempted" : "notAttempted",
    columns: {
      recoveredFrom: "quizListPage",
      section: row.section,
      evaluationStatus: row.evaluationStatus,
      attemptsCompleted: row.attemptsCompleted,
      attemptsAllowed: row.attemptsAllowed ?? "",
      attemptsUnlimited: row.attemptsUnlimited
    },
    ids: { courseOrgUnitId: orgUnitId, quizId: row.quizId }
  }));
  // A page with no quiz rows is a login redirect or a changed layout, not "no attempts".
  return { status: items.length ? response.status : "unparsed", items };
}

async function collectQuizQuestionItems(orgUnitId, quiz) {
  const quizId = quiz.QuizId;
  const result = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/quizzes/${quizId}/questions/`);
  const items = [];
  if (!result.ok) return { status: result.status, items };
  for (const question of apiList(result.data)) {
    const questionId = question.QuestionId || question.Id;
    items.push({
      source: "quizQuestion",
      title: normalizeText(question.Name || question.Text?.Text || question.Text || question.QuestionText?.Text || `Quiz question ${questionId || ""}`),
      description: firstRichText(question.Text, question.QuestionText, question.Description, question.Feedback),
      url: `${window.location.origin}/d2l/lms/quizzing/user/quiz_summary.d2l?ou=${orgUnitId}&qi=${quizId}`,
      type: question.Type || question.QuestionType || "",
      columns: {
        recoveredFrom: "quizQuestionsApi",
        quizTitle: normalizeText(quiz.Name),
        points: question.Points ?? "",
        difficulty: question.Difficulty ?? "",
        bonus: question.Bonus ?? "",
        mandatory: question.Mandatory ?? "",
        sortOrder: question.SortOrder ?? ""
      },
      ids: { courseOrgUnitId: orgUnitId, quizId: String(quizId), quizQuestionId: String(questionId || "") }
    });
  }
  return { status: result.status, items };
}


  Object.assign(content, {
    collectDropboxSubmissionItems, collectQuizAttemptItems, quizListRowsFromHtml, collectQuizListItems,
    collectQuizQuestionItems
  });
})();
