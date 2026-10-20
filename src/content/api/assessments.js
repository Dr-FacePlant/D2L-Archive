(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;
  const { absoluteUrl, apiGet, apiList, richText, firstRichText, gradeDisplay, D2L_API_MODERN_VERSION } = content;

async function collectDropboxSubmissionItems(orgUnitId, folder) {
  const items = [];
  const folderId = folder.Id;
  const result = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/dropbox/folders/${folderId}/submissions/mysubmissions/`);
  if (!result.ok) {
    return { status: result.status, items };
  }

  for (const entity of apiList(result.data)) {
    const entityName = normalizeText(entity.Entity?.DisplayName || entity.EntityName || entity.UserName || "My submission");
    const feedback = entity.Feedback || entity.Assessment || null;
    // Valence nests files under each submission: Submissions[].Files[].
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

async function collectCourseOverviewItems(orgUnitId) {
  const items = [];
  const overviewResult = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/overview`);
  const attachmentUrl = `${window.location.origin}/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/overview/attachment`;
  if (overviewResult.ok) {
    const overview = overviewResult.data || {};
    const title = normalizeText(overview.Title || overview.Name || "Course overview");
    items.push({
      source: "courseOverview",
      title,
      description: firstRichText(overview.Description, overview.Text, overview.Content, overview.Overview),
      url: `${window.location.origin}/d2l/le/content/${orgUnitId}/Home`,
      status: "available",
      columns: {
        recoveredFrom: "courseOverviewApi",
        lastModified: overview.LastModified || "",
        hasAttachment: overview.HasAttachment ?? overview.AttachmentId != null ?? ""
      },
      ids: { courseOrgUnitId: orgUnitId }
    });
  }
  const attachmentResult = await fetch(attachmentUrl, { credentials: "include", method: "HEAD" })
    .then((response) => ({ ok: response.ok, status: response.status, contentType: response.headers.get("content-type") || "" }))
    .catch((error) => ({ ok: false, status: 0, contentType: "", error: error?.message || "fetch failed" }));
  if (attachmentResult.ok) {
    items.push({
      source: "courseOverviewAttachment",
      title: "Course overview attachment",
      description: "File attached to the course content overview.",
      url: attachmentUrl,
      downloadUrl: attachmentUrl,
      suggestedFileName: `course-overview-${orgUnitId}`,
      columns: {
        recoveredFrom: "courseOverviewAttachmentApi",
        contentType: attachmentResult.contentType
      },
      ids: { courseOrgUnitId: orgUnitId }
    });
  }
  return { status: overviewResult.status, attachmentStatus: attachmentResult.status, items };
}

async function collectGradeMetadataItems(orgUnitId) {
  const [setup, categories, finalGrade] = await Promise.all([
    apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/grades/setup/`),
    apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/grades/categories/`),
    apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/grades/final/values/myGradeValue`)
  ]);
  const items = [];
  if (setup.ok) {
    items.push({
      source: "gradeSetup",
      title: "Gradebook setup",
      description: normalizeText(JSON.stringify(setup.data || {})).slice(0, 3000),
      url: `${window.location.origin}/d2l/lms/grades/my_grades/main.d2l?ou=${orgUnitId}`,
      status: "available",
      columns: {
        recoveredFrom: "gradeSetupApi",
        gradingSystem: setup.data?.GradingSystem || "",
        // When true D2L shows ungraded items as 0 (ART shows "0 / 5").
        isNullGradeZero: setup.data?.IsNullGradeZero ?? ""
      },
      ids: { courseOrgUnitId: orgUnitId }
    });
  }
  if (categories.ok) {
    for (const category of apiList(categories.data)) {
      const categoryId = category.Id || category.CategoryId;
      items.push({
        source: "gradeCategory",
        title: normalizeText(category.Name || `Grade category ${categoryId || ""}`),
        description: firstRichText(category.Description, category.ShortName),
        url: `${window.location.origin}/d2l/lms/grades/my_grades/main.d2l?ou=${orgUnitId}`,
        status: category.IsHidden ? "hidden" : "visible",
        columns: {
          recoveredFrom: "gradeCategoriesApi",
          weight: category.Weight ?? "",
          maxPoints: category.MaxPoints ?? "",
          canExceedMaxPoints: category.CanExceedMax ?? category.CanExceedMaxPoints ?? "",
          excludeFromFinalGradeCalculation: category.ExcludeFromFinalGrade ?? category.ExcludeFromFinalGradeCalculation ?? "",
          numberOfLowestToDrop: category.NumberOfLowestToDrop ?? "",
          numberOfHighestToDrop: category.NumberOfHighestToDrop ?? "",
          sortOrder: category.SortOrder ?? ""
        },
        ids: { courseOrgUnitId: orgUnitId, gradeCategoryId: String(categoryId || "") }
      });
    }
  }
  if (finalGrade.ok && finalGrade.data) {
    const value = finalGrade.data.GradeValue || finalGrade.data;
    items.push({
      source: "finalGrade",
      title: "Final grade",
      description: firstRichText(value?.Comments, value?.Comment, value?.Feedback, value?.PrivateComments),
      url: `${window.location.origin}/d2l/lms/grades/my_grades/main.d2l?ou=${orgUnitId}`,
      status: value ? "visible" : "empty",
      columns: {
        recoveredFrom: "finalGradeApi",
        displayedGrade: gradeDisplay(value),
        pointsEarned: value?.PointsNumerator ?? "",
        pointsPossible: value?.PointsDenominator ?? "",
        weightedNumerator: value?.WeightedNumerator ?? "",
        weightedDenominator: value?.WeightedDenominator ?? ""
      },
      ids: { courseOrgUnitId: orgUnitId, gradeObjectId: "final" }
    });
  }
  return { setupStatus: setup.status, categoriesStatus: categories.status, finalGradeStatus: finalGrade.status, items };
}


// "View Graded Rubric": D2L serves a topic's or folder's rubric and the
// student's own scored copy from its unstable rubric API (GET only). objectType
// is "Discussion" (topic id) or "Dropbox" (folder id).
async function collectRubricItems(orgUnitId, objectType, objectId, ownerIds, myUserId = "", ownerTitle = "") {
  const result = await apiGet(`/d2l/api/le/unstable/${orgUnitId}/rubrics?objectType=${objectType}&objectId=${objectId}`);
  const items = [];
  if (!result.ok) return { status: result.status, items };
  for (const rubric of apiList(result.data)) {
    const levelsById = new Map();
    const criteria = [];
    for (const group of apiList(rubric.CriteriaGroups)) {
      const levels = apiList(group.Levels);
      for (const level of levels) levelsById.set(String(level.Id), level);
      const outOf = Math.max(0, ...levels.map((level) => Number(level.Points) || 0));
      for (const criterion of apiList(group.Criteria)) criteria.push({ id: String(criterion.Id), name: normalizeText(criterion.Name), outOf, levels: levels.map((level) => normalizeText(level.Name)) });
    }
    for (const level of apiList(rubric.OverallLevels)) levelsById.set(String(level.Id), level);
    const assessment = myUserId && rubric.IsScoreVisibleToAssessedUsers !== false
      ? await apiGet(`/d2l/api/le/unstable/${orgUnitId}/assessment?assessmentType=Rubric&objectType=${objectType}&objectId=${objectId}&rubricId=${rubric.RubricId}&userId=${myUserId}`)
      : { ok: false, status: "notRequested" };
    const outcome = assessment.ok ? assessment.data : null;
    const scored = criteria.map((criterion) => {
      const found = apiList(outcome?.CriteriaOutcome).find((entry) => String(entry.CriterionId) === criterion.id);
      return {
        name: criterion.name,
        level: found ? normalizeText(levelsById.get(String(found.LevelId))?.Name || "") : "",
        score: found?.Score ?? "",
        outOf: criterion.outOf,
        feedback: richText(found?.Feedback)
      };
    });
    const overall = outcome?.OverallOutcome || null;
    items.push({
      source: outcome ? "rubricFeedback" : "rubric",
      title: normalizeText(rubric.Name || "Rubric"),
      description: outcome
        ? scored.map((entry) => `${entry.name}: ${entry.level || "not scored"}${entry.score !== "" ? ` (${entry.score} / ${entry.outOf})` : ""}`).join("; ")
        : criteria.map((criterion) => criterion.name).join("; "),
      url: `${window.location.origin}/d2l/home/${orgUnitId}`,
      status: outcome ? "assessed" : assessment.status === 403 ? "blocked" : "notAssessed",
      columns: {
        recoveredFrom: "rubricsApi",
        objectType,
        objectTitle: normalizeText(ownerTitle),
        rubricName: normalizeText(rubric.Name || ""),
        overallScore: overall?.Score ?? "",
        overallLevel: overall ? normalizeText(levelsById.get(String(overall.LevelId))?.Name || "") : "",
        overallFeedback: richText(overall?.Feedback),
        criteria: scored,
        assessmentStatus: assessment.status
      },
      ids: { courseOrgUnitId: orgUnitId, ...ownerIds, rubricId: String(rubric.RubricId), rubricObjectKey: `${objectType}:${objectId}:${rubric.RubricId}` }
    });
  }
  return { status: result.status, items };
}

  Object.assign(content, {
    collectRubricItems,
    collectDropboxSubmissionItems, collectQuizAttemptItems, quizListRowsFromHtml, collectQuizListItems,
    collectQuizQuestionItems, collectCourseOverviewItems, collectGradeMetadataItems
  });
})();
