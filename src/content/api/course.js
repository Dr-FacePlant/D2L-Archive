(function initCourseApiModule(global) {
  const content = global.D2LExtractorContent ||= {};
  const shared = global.D2LExtractorShared;
  const { normalizeText } = shared;
  const {
    D2L_API_VERSION,
    D2L_API_MODERN_VERSION,
    apiGet,
    apiList,
    indexEventsByEntity,
    resolveDue,
    addApiProbeRow,
    appendDerivedRows,
    collectNewsItems,
    collectDiscussionItems,
    collectChecklistItems,
    collectSurveyItems,
    collectGroupItems,
    collectClasslistItems,
    collectContentProgressItems,
    collectCourseOverviewItems,
    collectCourseOfferingItems,
    collectContentCompletionItems,
    collectMyUserId,
    collectRubricItems,
    collectDropboxSubmissionItems,
    collectQuizAttemptItems,
    collectQuizQuestionItems,
    collectQuizListItems,
    collectGradeMetadataItems,
    buildModuleAndTopicRows,
    buildQuizRows,
    buildCalendarEventRows,
    buildGradeRows,
    recordCoreApiProbes,
    buildCourseApiPayload
  } = content;

  function buildAttachmentRows(folder, attachments, orgUnitId) {
    const items = [];
    for (const file of attachments) {
      const fileName = normalizeText(file.FileName || `assignment-attachment-${file.FileId}`);
      const downloadUrl = `${window.location.origin}/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/dropbox/folders/${folder.Id}/attachments/${file.FileId}`;
      items.push({
        source: "assignmentAttachment",
        title: fileName,
        description: normalizeText(`${normalizeText(folder.Name)} attachment ${fileName}`),
        url: downloadUrl,
        downloadUrl,
        suggestedFileName: fileName,
        columns: { size: file.Size ?? "" },
        ids: { courseOrgUnitId: orgUnitId, dropboxFolderId: String(folder.Id), fileId: String(file.FileId ?? "") }
      });
    }
    return items;
  }

  async function collectDropboxRows(orgUnitId, dropboxData, dropboxCategoryNames, byEntity, myUserId) {
    const apiItems = [];
    const assignmentFolderByGradeItem = new Map();
    for (const folder of Array.isArray(dropboxData) ? dropboxData : []) {
      const startDate = folder.Availability?.StartDate || folder.StartDate || "";
      const endDate = folder.Availability?.EndDate || folder.EndDate || "";
      const due = resolveDue(folder.DueDate, endDate, byEntity.get(`D2L.LE.Dropbox.Dropbox:${folder.Id}`));
      if (folder.GradeItemId) assignmentFolderByGradeItem.set(String(folder.GradeItemId), String(folder.Id));
      const attachments = apiList(folder.Attachments);
      apiItems.push({
        source: "assignment",
        title: normalizeText(folder.Name),
        description: normalizeText(folder.CustomInstructions?.Text || ""),
        url: `${window.location.origin}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${folder.Id}&ou=${orgUnitId}`,
        dueAtText: due.value,
        availabilityText: [startDate && `Opens ${startDate}`, endDate && `Closes ${endDate}`].filter(Boolean).join(" | "),
        columns: {
          dueAtSource: due.source, startDate, endDate, gradeItemId: folder.GradeItemId ?? "", categoryId: folder.CategoryId ?? "",
          categoryName: dropboxCategoryNames.get(String(folder.CategoryId ?? "")) || "", scoreOutOf: folder.Assessment?.ScoreDenominator ?? "",
          rubricCount: apiList(folder.Assessment?.Rubrics).length, submissionType: folder.SubmissionType ?? "", groupTypeId: folder.GroupTypeId ?? "",
          completionType: folder.CompletionType ?? "", attachments: attachments.map((f) => ({ name: normalizeText(f.FileName || ""), size: f.Size ?? "", fileId: String(f.FileId ?? "") }))
        },
        ids: { courseOrgUnitId: orgUnitId, dropboxFolderId: String(folder.Id) }
      });
      apiItems.push(...buildAttachmentRows(folder, attachments, orgUnitId));
      if (apiList(folder.Assessment?.Rubrics).length) {
        const rubricResult = await collectRubricItems(orgUnitId, "Dropbox", folder.Id, { dropboxFolderId: String(folder.Id) }, myUserId, folder.Name || "");
        apiItems.push(...rubricResult.items);
      }
      const submissionResult = await collectDropboxSubmissionItems(orgUnitId, folder);
      apiItems.push(...submissionResult.items);
      folder._mySubmissionsStatus = submissionResult.status;
      addApiProbeRow(apiItems, orgUnitId, "assignment my submissions", submissionResult.status, { dropboxFolderId: String(folder.Id), assignmentTitle: normalizeText(folder.Name), evidenceCount: submissionResult.items.length }, { includeAvailable: true });
    }
    return { apiItems, assignmentFolderByGradeItem };
  }

  async function collectQuizProbeRows(orgUnitId, quizzesData) {
    const apiItems = [];
    let attemptsForbidden = false;
    let questionsForbidden = false;
    for (const quiz of quizzesData?.Objects || []) {
      const attemptResult = attemptsForbidden ? { status: 403, attemptDetailStatuses: {}, items: [] } : await collectQuizAttemptItems(orgUnitId, quiz);
      if (Number(attemptResult.status) === 403) attemptsForbidden = true;
      apiItems.push(...attemptResult.items);
      quiz._attemptsStatus = attemptResult.status;
      quiz._attemptDetailStatuses = attemptResult.attemptDetailStatuses || {};
      addApiProbeRow(apiItems, orgUnitId, "quiz attempts", attemptResult.status, {
        quizId: String(quiz.QuizId),
        quizTitle: normalizeText(quiz.Name),
        evidenceCount: attemptResult.items.length
      }, { includeAvailable: true });
      for (const [attemptId, status] of Object.entries(attemptResult.attemptDetailStatuses || {})) {
        addApiProbeRow(apiItems, orgUnitId, "quiz attempt detail", status, {
          quizId: String(quiz.QuizId),
          attemptId,
          evidenceCount: status >= 200 && status < 300 ? 1 : 0
        }, { includeAvailable: true });
      }
      const questionResult = questionsForbidden ? { status: 403, items: [] } : await collectQuizQuestionItems(orgUnitId, quiz);
      if (Number(questionResult.status) === 403) questionsForbidden = true;
      apiItems.push(...questionResult.items);
      quiz._questionsStatus = questionResult.status;
      addApiProbeRow(apiItems, orgUnitId, "quiz questions", questionResult.status, {
        quizId: String(quiz.QuizId),
        quizTitle: normalizeText(quiz.Name),
        evidenceCount: questionResult.items.length
      }, { includeAvailable: true });
    }
    const hasActiveQuiz = (quizzesData?.Objects || []).some((quiz) => quiz.IsActive !== false);
    const quizListResult = hasActiveQuiz ? await collectQuizListItems(orgUnitId) : null;
    if (quizListResult) {
      apiItems.push(...quizListResult.items);
      addApiProbeRow(apiItems, orgUnitId, "quiz list page", quizListResult.status, { evidenceCount: quizListResult.items.length }, { includeAvailable: true });
    }
    return { apiItems, quizListResult };
  }

  const CATEGORY_GROUPS = Object.freeze({
    priority: ["obligations", "announcements", "calendar", "discussions", "grades", "materials"],
    obligations: ["obligations"],
    announcements: ["announcements"],
    calendar: ["calendar"],
    discussions: ["discussions"],
    grades: ["grades"],
    materials: ["materials"],
    secondary: ["secondary"]
  });

  async function fetchCoreApis(orgUnitId, category, myUserId) {
    const included = (name) => !category || (CATEGORY_GROUPS[category] || []).includes(name);
    const base = `/d2l/api/le/${D2L_API_VERSION}/${orgUnitId}`;
    const deferredApi = { ok: false, status: "deferred", data: null };
    const deferred = { status: "deferred", items: [] };
    const request = (name, url) => (included(name) ? apiGet(url) : Promise.resolve(deferredApi));
    const collect = (name, fn) => (included(name) ? fn() : Promise.resolve(deferred));

    const [
      toc, quizzes, dropbox, events, gradeDefs, gradeVals,
      gradeMetadataResult, newsResult, discussionResult, checklistResult,
      surveyResult, groupResult, classlistResult, contentProgressResult,
      overviewResult, offeringResult, completionResult, dropboxCategories
    ] = await Promise.all([
      request("materials", `${base}/content/toc`),
      request("obligations", `${base}/quizzes/`),
      request("obligations", `${base}/dropbox/folders/`),
      request("calendar", `${base}/calendar/events/?startDateTime=2026-01-01T00:00:00.000Z&endDateTime=2027-06-30T00:00:00.000Z`),
      request("grades", `${base}/grades/`),
      request("grades", `${base}/grades/values/myGradeValues/`),
      collect("grades", () => collectGradeMetadataItems(orgUnitId)),
      collect("announcements", () => collectNewsItems(orgUnitId)),
      collect("discussions", () => collectDiscussionItems(orgUnitId, myUserId)),
      collect("obligations", () => collectChecklistItems(orgUnitId)),
      collect("secondary", () => collectSurveyItems(orgUnitId)),
      collect("secondary", () => collectGroupItems(orgUnitId)),
      collect("secondary", () => collectClasslistItems(orgUnitId)),
      collect("secondary", () => collectContentProgressItems(orgUnitId)),
      collect("secondary", () => collectCourseOverviewItems(orgUnitId)),
      collect("materials", () => collectCourseOfferingItems(orgUnitId)),
      collect("secondary", () => collectContentCompletionItems(orgUnitId)),
      request("obligations", `/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/dropbox/categories/`)
    ]);

    return {
      toc, quizzes, dropbox, events, gradeDefs, gradeVals,
      gradeMetadataResult, newsResult, discussionResult, checklistResult,
      surveyResult, groupResult, classlistResult, contentProgressResult,
      overviewResult, offeringResult, completionResult, dropboxCategories
    };
  }

  async function collectCourseApi(orgUnitId, options = {}) {
    const category = String(options.category || (options.priorityOnly === true ? "priority" : ""));
    const needsStudentIdentity = !category || ["priority", "obligations", "discussions", "grades"].includes(category);
    const myUserId = needsStudentIdentity ? await collectMyUserId() : "";
    const core = await fetchCoreApis(orgUnitId, category, myUserId);
    const { toc, quizzes, dropbox, dropboxCategories, events, gradeDefs, gradeVals } = core;
    const { newsResult, discussionResult, gradeMetadataResult, checklistResult, surveyResult, groupResult, classlistResult, contentProgressResult, overviewResult, offeringResult, completionResult } = core;

    const dropboxCategoryNames = new Map(apiList(dropboxCategories.data).map((c) => [String(c.Id), normalizeText(c.Name)]));
    const eventList = Array.isArray(events.data) ? events.data : [];
    const byEntity = indexEventsByEntity(eventList);

    const apiItems = [
      ...buildModuleAndTopicRows(toc.data, orgUnitId),
      ...buildQuizRows(quizzes.data, byEntity, orgUnitId)
    ];

    const { apiItems: dropboxItems, assignmentFolderByGradeItem } = await collectDropboxRows(orgUnitId, dropbox.data, dropboxCategoryNames, byEntity, myUserId);
    apiItems.push(...dropboxItems);

    const { apiItems: quizProbeItems, quizListResult } = await collectQuizProbeRows(orgUnitId, quizzes.data);
    apiItems.push(...quizProbeItems);

    apiItems.push(...buildCalendarEventRows(eventList, orgUnitId));
    apiItems.push(...(newsResult.items || []), ...(discussionResult.items || []), ...(gradeMetadataResult.items || []));
    apiItems.push(...(checklistResult.items || []), ...(surveyResult.items || []), ...(groupResult.items || []));
    apiItems.push(...(classlistResult.items || []), ...(contentProgressResult.items || []), ...(overviewResult.items || []));
    apiItems.push(...(offeringResult.items || []), ...(completionResult.items || []));

    const secondaryResults = {
      checklists: checklistResult, surveys: surveyResult, groups: groupResult,
      classlist: classlistResult, "content user progress": contentProgressResult,
      "course overview": overviewResult, "course offering": offeringResult,
      "content completion": completionResult, "course overview attachment": { status: overviewResult.attachmentStatus, items: (overviewResult.items || []).filter((i) => i.source === "courseOverviewAttachment") }
    };
    recordCoreApiProbes(apiItems, orgUnitId, { toc, quizzes, dropbox, events, gradeDefs, gradeVals, gradeMetadataResult, newsResult, discussionResult, secondaryResults });
    apiItems.push(...buildGradeRows(gradeDefs.data, gradeVals.data, quizzes.data, assignmentFolderByGradeItem, orgUnitId));

    const allItems = appendDerivedRows(apiItems);
    return buildCourseApiPayload(orgUnitId, allItems, core, quizListResult);
  }

  async function collectCourseApiWithAccount(orgUnitId, options = {}) {
    const whoami = () => (content.fetchVerifiedAccountId ? content.fetchVerifiedAccountId().catch(() => "") : Promise.resolve(""));
    const startId = await whoami();
    const payload = await collectCourseApi(orgUnitId, options);
    const endId = await whoami();
    return { ...payload, account: { startId, endId } };
  }

  Object.assign(content, { collectCourseApi, collectCourseApiWithAccount });
})(globalThis);
