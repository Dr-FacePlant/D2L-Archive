(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;
  const {
    absoluteUrl, D2L_API_VERSION, D2L_API_MODERN_VERSION, apiGet, apiList, flattenTocTopics, flattenTocModules, directDownloadUrl,
    fileNameFromUrl, indexEventsByEntity, resolveDue, mergeGradeValues,
    gradeDisplay, firstRichText, appendDerivedRows, addApiProbeRow,
    collectDropboxSubmissionItems, collectQuizAttemptItems, collectQuizQuestionItems, collectQuizListItems,
    collectCourseOverviewItems, collectGradeMetadataItems, collectNewsItems,
    collectDiscussionItems, collectChecklistItems, collectSurveyItems,
    collectGroupItems, collectClasslistItems, collectContentProgressItems,
    collectCourseOfferingItems, collectContentCompletionItems, collectMyUserId, collectRubricItems
  } = content;

// Valence calendar EventType, named the way D2L's calendar list labels it
// ("Quiz 5 - Available", "Quiz 5 - Due", "Quiz 5 - Availability Ends").
const CALENDAR_EVENT_LABELS = Object.freeze({ 2: "Available", 3: "Availability Ends", 6: "Due" });

// AssociatedTool.ToolId on a grade item says which D2L tool feeds it.
const GRADE_TOOL_SOURCES = Object.freeze({ 51000: "quiz", 3000: "discussionTopic", 2000: "assignment" });

async function collectCourseApi(orgUnitId, options = {}) {
  const category = String(options.category || (options.priorityOnly === true ? "priority" : ""));
  const categoryGroups = {
    priority: ["obligations", "announcements", "calendar", "discussions", "grades", "materials"],
    obligations: ["obligations"], announcements: ["announcements"], calendar: ["calendar"],
    discussions: ["discussions"], grades: ["grades"], materials: ["materials"], secondary: ["secondary"]
  };
  const included = (name) => !category || (categoryGroups[category] || []).includes(name);
  const base = `/d2l/api/le/${D2L_API_VERSION}/${orgUnitId}`;
  const needsStudentIdentity = !category || ["priority", "obligations", "discussions", "grades"].includes(category);
  const myUserId = needsStudentIdentity ? await collectMyUserId() : "";
  const deferred = { status: "deferred", items: [] };
  const deferredApi = { ok: false, status: "deferred", data: null };
  const request = (name, url) => included(name) ? apiGet(url) : Promise.resolve(deferredApi);
  const collect = (name, fn) => included(name) ? fn() : Promise.resolve(deferred);
  const [toc, quizzes, dropbox, events, gradeDefs, gradeVals, gradeMetadataResult, newsResult, discussionResult, checklistResult, surveyResult, groupResult, classlistResult, contentProgressResult, overviewResult, offeringResult, completionResult, dropboxCategories] = await Promise.all([
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
  const dropboxCategoryNames = new Map(apiList(dropboxCategories.data).map((category) => [String(category.Id), normalizeText(category.Name)]));

  const eventList = Array.isArray(events.data) ? events.data : [];
  const byEntity = indexEventsByEntity(eventList);
  const apiItems = [];

  for (const module of flattenTocModules(toc.data?.Modules)) {
    apiItems.push({
      source: "contentModule",
      title: normalizeText(module.Title),
      description: firstRichText(module.Description),
      url: `${window.location.origin}/d2l/le/content/${orgUnitId}/Home?itemIdentifier=D2L.LE.Content.ContentObject.ModuleCO-${module.ModuleId}`,
      type: "Module",
      availabilityText: [module.StartDateTime, module.EndDateTime].filter(Boolean).join(" - "),
      columns: {
        module: module.modulePath || "",
        startDate: module.StartDateTime || "",
        endDate: module.EndDateTime || "",
        tocOrder: module.tocOrder,
        depth: module.depth,
        parentModuleId: module.parentModuleId || "",
        isHidden: !!module.IsHidden,
        isLocked: !!module.IsLocked
      },
      ids: { courseOrgUnitId: orgUnitId, contentModuleId: String(module.ModuleId) }
    });
  }

  for (const topic of flattenTocTopics(toc.data?.Modules)) {
    const isFile = topic.TypeIdentifier === "File";
    const target = isFile ? directDownloadUrl(orgUnitId, topic.TopicId) : absoluteUrl(topic.Url || "");
    apiItems.push({
      source: "contentTopic",
      title: normalizeText(topic.Title),
      description: normalizeText(topic.Description?.Text || topic.Description?.Html || topic.modulePath || ""),
      url: `${window.location.origin}/d2l/le/content/${orgUnitId}/viewContent/${topic.TopicId}/View`,
      type: topic.TypeIdentifier || "",
      downloadUrl: target,
      suggestedFileName: fileNameFromUrl(topic.Url, `${topic.TopicId}`),
      availabilityText: topic.StartDateTime || topic.EndDateTime || "",
      columns: {
        module: topic.modulePath || "",
        moduleId: String(topic.moduleId ?? ""),
        moduleTitle: topic.moduleTitle || "",
        moduleStartDate: topic.moduleStartDate || "",
        tocOrder: topic.tocOrder,
        topicType: topic.TypeIdentifier || "",
        activityType: topic.ActivityType ?? "",
        startDate: topic.StartDateTime || "",
        endDate: topic.EndDateTime || "",
        completionType: topic.CompletionType ?? "",
        isExempt: !!topic.IsExempt,
        unread: topic.Unread ?? "",
        isBroken: !!topic.IsBroken,
        resolvedTarget: target || ""
      },
      ids: { courseOrgUnitId: orgUnitId, contentObjectId: String(topic.TopicId) }
    });
  }

  for (const quiz of quizzes.data?.Objects || []) {
    const due = resolveDue(quiz.DueDate, quiz.EndDate, byEntity.get(`D2L.LE.Quizzing.Quiz:${quiz.QuizId}`));
    // Description and Instructions are { Text: { Text, Html }, IsDisplayed }.
    const timeLimit = quiz.SubmissionTimeLimit || {};
    apiItems.push({
      source: "quiz",
      title: normalizeText(quiz.Name),
      description: firstRichText(quiz.Description?.IsDisplayed === false ? "" : quiz.Description?.Text, quiz.Instructions?.IsDisplayed ? quiz.Instructions?.Text : ""),
      url: `${window.location.origin}/d2l/lms/quizzing/user/quiz_summary.d2l?ou=${orgUnitId}&qi=${quiz.QuizId}`,
      dueAtText: due.value,
      columns: {
        dueAtSource: due.source,
        startDate: quiz.StartDate || "",
        endDate: quiz.EndDate || "",
        attempts: quiz.AttemptsAllowed ?? "",
        timeLimitMinutes: timeLimit.IsEnforced ? timeLimit.TimeLimitValue ?? "" : "",
        gradeItemId: quiz.GradeItemId ?? "",
        isActive: quiz.IsActive ?? "",
        lateSubmissionOption: quiz.LateSubmissionInfo?.LateSubmissionOption ?? ""
      },
      ids: { courseOrgUnitId: orgUnitId, quizId: String(quiz.QuizId) }
    });
  }

  // Dropbox folders carry their open/close window under Availability and name
  // their grade column; the grade rows below use it for an exact assignment link.
  const assignmentFolderByGradeItem = new Map();
  for (const folder of Array.isArray(dropbox.data) ? dropbox.data : []) {
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
        dueAtSource: due.source,
        startDate,
        endDate,
        gradeItemId: folder.GradeItemId ?? "",
        categoryId: folder.CategoryId ?? "",
        categoryName: dropboxCategoryNames.get(String(folder.CategoryId ?? "")) || "",
        scoreOutOf: folder.Assessment?.ScoreDenominator ?? "",
        rubricCount: apiList(folder.Assessment?.Rubrics).length,
        submissionType: folder.SubmissionType ?? "",
        groupTypeId: folder.GroupTypeId ?? "",
        completionType: folder.CompletionType ?? "",
        attachments: attachments.map((file) => ({ name: normalizeText(file.FileName || ""), size: file.Size ?? "", fileId: String(file.FileId ?? "") }))
      },
      ids: { courseOrgUnitId: orgUnitId, dropboxFolderId: String(folder.Id) }
    });
    for (const file of attachments) {
      const fileName = normalizeText(file.FileName || `assignment-attachment-${file.FileId}`);
      const downloadUrl = `${window.location.origin}/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/dropbox/folders/${folder.Id}/attachments/${file.FileId}`;
      apiItems.push({
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

    if (apiList(folder.Assessment?.Rubrics).length) {
      const rubricResult = await collectRubricItems(orgUnitId, "Dropbox", folder.Id, { dropboxFolderId: String(folder.Id) }, myUserId, folder.Name || "");
      apiItems.push(...rubricResult.items);
    }

    const submissionResult = await collectDropboxSubmissionItems(orgUnitId, folder);
    apiItems.push(...submissionResult.items);
    folder._mySubmissionsStatus = submissionResult.status;
    addApiProbeRow(apiItems, orgUnitId, "assignment my submissions", submissionResult.status, {
      dropboxFolderId: String(folder.Id),
      assignmentTitle: normalizeText(folder.Name),
      evidenceCount: submissionResult.items.length
    }, { includeAvailable: true });
  }

  // Students get 403 on the quiz attempts/questions routes; after one 403 skip that route for the rest of this pass.
  let attemptsForbidden = false;
  let questionsForbidden = false;
  for (const quiz of quizzes.data?.Objects || []) {
    const attemptResult = attemptsForbidden
      ? { status: 403, attemptDetailStatuses: {}, items: [] }
      : await collectQuizAttemptItems(orgUnitId, quiz);
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

    const questionResult = questionsForbidden
      ? { status: 403, items: [] }
      : await collectQuizQuestionItems(orgUnitId, quiz);
    if (Number(questionResult.status) === 403) questionsForbidden = true;
    apiItems.push(...questionResult.items);
    quiz._questionsStatus = questionResult.status;
    addApiProbeRow(apiItems, orgUnitId, "quiz questions", questionResult.status, {
      quizId: String(quiz.QuizId),
      quizTitle: normalizeText(quiz.Name),
      evidenceCount: questionResult.items.length
    }, { includeAvailable: true });
  }

  // The attempts API is closed to students, so the Quiz List page supplies how
  // many attempts they used. Only asked when the course has an active quiz.
  const hasActiveQuiz = (quizzes.data?.Objects || []).some((quiz) => quiz.IsActive !== false);
  const quizListResult = hasActiveQuiz ? await collectQuizListItems(orgUnitId) : null;
  if (quizListResult) {
    apiItems.push(...quizListResult.items);
    addApiProbeRow(apiItems, orgUnitId, "quiz list page", quizListResult.status, { evidenceCount: quizListResult.items.length }, { includeAvailable: true });
  }

  for (const event of eventList) {
    apiItems.push({
      source: "calendarEvent",
      title: normalizeText(event.Title),
      description: normalizeText(event.Description?.Text || ""),
      url: event.AssociatedEntity?.Link || event.CalendarEventViewUrl || "",
      dueAtText: event.EndDateTime || "",
      columns: {
        startDateTime: event.StartDateTime || "",
        endDateTime: event.EndDateTime || "",
        entityType: event.AssociatedEntity?.AssociatedEntityType || "",
        entityId: event.AssociatedEntity?.AssociatedEntityId ?? "",
        // The detail page id differs from CalendarEventId; only this URL opens it.
        viewUrl: event.CalendarEventViewUrl || "",
        eventType: event.EventType ?? "",
        eventLabel: CALENDAR_EVENT_LABELS[event.EventType] || "",
        isAllDay: event.IsAllDayEvent ?? "",
        orgUnitCode: event.OrgUnitCode || "",
        locationName: event.LocationName || ""
      },
      ids: { courseOrgUnitId: orgUnitId, calendarEventId: String(event.CalendarEventId) }
    });
  }

  apiItems.push(...(newsResult.items || []));
  apiItems.push(...(discussionResult.items || []));
  apiItems.push(...(gradeMetadataResult.items || []));
  apiItems.push(...(checklistResult.items || []));
  apiItems.push(...(surveyResult.items || []));
  apiItems.push(...(groupResult.items || []));
  apiItems.push(...(classlistResult.items || []));
  apiItems.push(...(contentProgressResult.items || []));
  apiItems.push(...(overviewResult.items || []));
  apiItems.push(...(offeringResult.items || []));
  apiItems.push(...(completionResult.items || []));

  // Record successful core-tool probes too, so "course has none" is an explicit state rather than a silent gap.
  const listLength = (data) => (Array.isArray(data) ? data.length : 0);
  addApiProbeRow(apiItems, orgUnitId, "content table of contents", toc.status, { evidenceCount: flattenTocTopics(toc.data?.Modules).length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "quizzes", quizzes.status, { evidenceCount: (quizzes.data?.Objects || []).length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "assignments", dropbox.status, { evidenceCount: listLength(dropbox.data) }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "calendar", events.status, { evidenceCount: eventList.length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "grade definitions", gradeDefs.status, { evidenceCount: listLength(gradeDefs.data) }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "grade values", gradeVals.status, { evidenceCount: listLength(gradeVals.data) }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "grade setup", gradeMetadataResult.setupStatus, { evidenceCount: (gradeMetadataResult.items || []).filter((item) => item.source === "gradeSetup").length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "grade categories", gradeMetadataResult.categoriesStatus, { evidenceCount: (gradeMetadataResult.items || []).filter((item) => item.source === "gradeCategory").length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "final grade", gradeMetadataResult.finalGradeStatus, { evidenceCount: (gradeMetadataResult.items || []).filter((item) => item.source === "finalGrade").length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "announcements", newsResult.status, { evidenceCount: (newsResult.items || []).filter((item) => item.source === "announcement").length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "discussion forums", discussionResult.status, { evidenceCount: (discussionResult.items || []).filter((item) => item.source === "discussionForum").length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "checklists", checklistResult.status, { evidenceCount: (checklistResult.items || []).length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "surveys", surveyResult.status, { evidenceCount: (surveyResult.items || []).length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "groups", groupResult.status, { evidenceCount: (groupResult.items || []).length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "classlist", classlistResult.status, { evidenceCount: (classlistResult.items || []).length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "content user progress", contentProgressResult.status, { evidenceCount: (contentProgressResult.items || []).length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "course overview", overviewResult.status, { evidenceCount: (overviewResult.items || []).filter((item) => item.source === "courseOverview").length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "course offering", offeringResult.status, { evidenceCount: (offeringResult.items || []).length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "content completion", completionResult.status, { evidenceCount: (completionResult.items || []).length }, { includeAvailable: true });
  addApiProbeRow(apiItems, orgUnitId, "course overview attachment", overviewResult.attachmentStatus, { evidenceCount: (overviewResult.items || []).filter((item) => item.source === "courseOverviewAttachment").length }, { includeAvailable: true });
  for (const [topicId, status] of Object.entries(discussionResult.topicStatuses || {})) {
    addApiProbeRow(apiItems, orgUnitId, "discussion topic", status, { discussionTopicId: topicId });
  }
  for (const [topicId, status] of Object.entries(discussionResult.postStatuses || {})) {
    addApiProbeRow(apiItems, orgUnitId, "discussion posts", status, { discussionTopicId: topicId });
  }

  const quizByGradeItem = new Map((quizzes.data?.Objects || []).filter((quiz) => quiz.GradeItemId).map((quiz) => [String(quiz.GradeItemId), String(quiz.QuizId)]));
  for (const { definition, value } of mergeGradeValues(gradeDefs.data, gradeVals.data)) {
    // Category totals arrive as values with no definition; name them from D2L, not from the score.
    const name = normalizeText(definition?.Name || value?.GradeObjectName || "");
    if (!name && !value) continue;
    const id = definition?.Id ?? value?.GradeObjectIdentifier ?? "";
    const feedbackText = firstRichText(
      value?.Comments,
      value?.Comment,
      value?.Feedback,
      value?.FeedbackText,
      value?.Assessment?.Feedback,
      value?.Assessment?.Comments,
      value?.PrivateComments
    );
    const rubricText = firstRichText(
      value?.RubricAssessment,
      value?.RubricFeedback,
      value?.Rubric,
      value?.Assessment?.RubricFeedback,
      value?.Assessment?.Rubric
    );
    const tool = definition?.AssociatedTool || null;
    const toolSource = GRADE_TOOL_SOURCES[tool?.ToolId] || "";
    const linkedIds = {
      ...(assignmentFolderByGradeItem.has(String(id)) ? { associatedAssignmentFolderId: assignmentFolderByGradeItem.get(String(id)) } : {}),
      ...(quizByGradeItem.has(String(id)) ? { associatedQuizId: quizByGradeItem.get(String(id)) } : {}),
      ...(toolSource === "discussionTopic" && tool?.ToolItemId != null ? { associatedDiscussionTopicId: String(tool.ToolItemId) } : {})
    };
    apiItems.push({
      source: "gradeItem",
      title: name || `Grade item ${id}`,
      description: normalizeText(definition?.Description?.Text || ""),
      url: `${window.location.origin}/d2l/lms/grades/my_grades/main.d2l?ou=${orgUnitId}`,
      type: definition?.GradeType || value?.GradeObjectTypeName || "",
      columns: {
        displayedGrade: gradeDisplay(value),
        pointsEarned: value?.PointsNumerator ?? "",
        pointsPossible: value?.PointsDenominator ?? definition?.MaxPoints ?? "",
        maxPoints: definition?.MaxPoints ?? "",
        weightedNumerator: value?.WeightedNumerator ?? "",
        weightedDenominator: value?.WeightedDenominator ?? "",
        weight: definition?.Weight ?? "",
        gradeCategory: definition?.CategoryId ?? "",
        // Category subtotals arrive as values with GradeObjectType 9 and no definition.
        gradeObjectType: value?.GradeObjectType ?? "",
        isCategoryTotal: value?.GradeObjectType === 9 || value?.GradeObjectTypeName === "Category",
        isBonus: definition?.IsBonus ?? "",
        excludeFromFinal: definition?.ExcludeFromFinalGradeCalculation ?? "",
        isHidden: definition?.IsHidden ?? "",
        associatedToolId: tool?.ToolId ?? "",
        associatedToolItemId: tool?.ToolItemId ?? "",
        gradedAt: value?.LastModified || "",
        releasedAt: value?.ReleasedDate || "",
        isGraded: value != null,
        commentsAndAssessments: feedbackText || rubricText
      },
      ids: { courseOrgUnitId: orgUnitId, gradeObjectId: String(id), ...linkedIds }
    });
    if (feedbackText || rubricText) {
      apiItems.push({
        source: "gradeFeedback",
        title: `${name || `Grade item ${id}`} feedback`,
        description: [feedbackText, rubricText].filter(Boolean).join("\n\n"),
        url: `${window.location.origin}/d2l/lms/grades/my_grades/main.d2l?ou=${orgUnitId}`,
        status: "feedbackAvailable",
        columns: {
          displayedGrade: gradeDisplay(value),
          pointsEarned: value?.PointsNumerator ?? "",
          pointsPossible: value?.PointsDenominator ?? definition?.MaxPoints ?? "",
          feedbackText,
          rubricText
        },
        ids: { courseOrgUnitId: orgUnitId, gradeObjectId: String(id), ...linkedIds }
      });
    }
  }

  const allItems = appendDerivedRows(apiItems);

  return {
    orgUnitId,
    apiStatus: {
      toc: toc.status,
      quizzes: quizzes.status,
      quizList: quizListResult?.status ?? "",
      dropbox: dropbox.status,
      dropboxMySubmissions: Array.isArray(dropbox.data)
        ? Object.fromEntries(dropbox.data.map((folder) => [String(folder.Id), folder._mySubmissionsStatus || "notAttempted"]))
        : {},
      calendar: events.status,
      gradeDefinitions: gradeDefs.status,
      gradeValues: gradeVals.status,
      gradeSetup: gradeMetadataResult.setupStatus,
      gradeCategories: gradeMetadataResult.categoriesStatus,
      finalGrade: gradeMetadataResult.finalGradeStatus,
      news: newsResult.status,
      discussionForums: discussionResult.status,
      checklists: checklistResult.status,
      surveys: surveyResult.status,
      groups: groupResult.status,
      classlist: classlistResult.status,
      contentUserProgress: contentProgressResult.status,
      courseOverview: overviewResult.status,
      courseOverviewAttachment: overviewResult.attachmentStatus,
      courseOffering: offeringResult.status,
      contentCompletion: completionResult.status,
      contentCompletionModules: completionResult.moduleStatus,
      dropboxCategories: dropboxCategories.status,
      discussionTopics: discussionResult.topicStatuses,
      discussionPosts: discussionResult.postStatuses,
      checklistItems: checklistResult.itemStatuses,
      checklistCategories: checklistResult.categoryStatuses,
      surveyAttempts: surveyResult.attemptStatuses,
      surveyQuestions: surveyResult.questionStatuses,
      groupsByCategory: groupResult.groupStatuses,
      quizAttempts: quizzes.data?.Objects
        ? Object.fromEntries(quizzes.data.Objects.map((quiz) => [String(quiz.QuizId), quiz._attemptsStatus || "notAttempted"]))
        : {},
      quizAttemptDetails: quizzes.data?.Objects
        ? Object.fromEntries(quizzes.data.Objects.map((quiz) => [String(quiz.QuizId), quiz._attemptDetailStatuses || {}]))
        : {},
      quizQuestions: quizzes.data?.Objects
        ? Object.fromEntries(quizzes.data.Objects.map((quiz) => [String(quiz.QuizId), quiz._questionsStatus || "notAttempted"]))
        : {}
    },
    counts: {
      topics: allItems.filter((i) => i.source === "contentTopic").length,
      contentModules: allItems.filter((i) => i.source === "contentModule").length,
      contentCompletion: allItems.filter((i) => i.source === "contentCompletion").length,
      assignmentAttachments: allItems.filter((i) => i.source === "assignmentAttachment").length,
      courseOverview: allItems.filter((i) => i.source === "courseOverview").length,
      courseOverviewAttachments: allItems.filter((i) => i.source === "courseOverviewAttachment").length,
      quizzes: allItems.filter((i) => i.source === "quiz").length,
      quizQuestions: allItems.filter((i) => i.source === "quizQuestion").length,
      assignments: allItems.filter((i) => i.source === "assignment").length,
      assignmentSubmissions: allItems.filter((i) => i.source === "assignmentSubmission").length,
      assignmentFeedback: allItems.filter((i) => i.source === "assignmentFeedback").length,
      submittedFiles: allItems.filter((i) => i.source === "submittedFile").length,
      quizAttempts: allItems.filter((i) => i.source === "quizAttempt").length,
      quizListRows: allItems.filter((i) => i.source === "quizListRow").length,
      checklistItems: allItems.filter((i) => i.source === "checklistItem").length,
      surveys: allItems.filter((i) => i.source === "survey").length,
      surveyAttempts: allItems.filter((i) => i.source === "surveyAttempt").length,
      surveyQuestions: allItems.filter((i) => i.source === "surveyQuestion").length,
      groups: allItems.filter((i) => i.source === "group").length,
      classlistEntries: allItems.filter((i) => i.source === "classlistEntry").length,
      progressRecords: allItems.filter((i) => i.source === "progressRecord").length,
      announcements: allItems.filter((i) => i.source === "announcement").length,
      announcementAttachments: allItems.filter((i) => i.source === "announcementAttachment").length,
      discussionForums: allItems.filter((i) => i.source === "discussionForum").length,
      discussionTopics: allItems.filter((i) => i.source === "discussionTopic").length,
      discussionPosts: allItems.filter((i) => i.source === "discussionPost").length,
      syllabusPolicies: allItems.filter((i) => i.source === "syllabusPolicy").length,
      rubrics: allItems.filter((i) => i.source === "rubric").length,
      rubricAssessments: allItems.filter((i) => i.source === "rubricFeedback").length,
      calendarEvents: allItems.filter((i) => i.source === "calendarEvent").length,
      gradeItems: allItems.filter((i) => i.source === "gradeItem").length,
      gradeSetup: allItems.filter((i) => i.source === "gradeSetup").length,
      gradeCategories: allItems.filter((i) => i.source === "gradeCategory").length,
      finalGrade: allItems.filter((i) => i.source === "finalGrade").length,
      gradeFeedback: allItems.filter((i) => i.source === "gradeFeedback").length,
      apiProbes: allItems.filter((i) => i.source === "apiProbe").length
    },
    items: allItems
  };
}


  // The same pass that collects also asks D2L who this session is, before and
  // after, so the background can refuse data collected under another account.
  async function collectCourseApiWithAccount(orgUnitId, options = {}) {
    const whoami = () => (content.fetchVerifiedAccountId ? content.fetchVerifiedAccountId().catch(() => "") : Promise.resolve(""));
    const startId = await whoami();
    const payload = await collectCourseApi(orgUnitId, options);
    const endId = await whoami();
    return { ...payload, account: { startId, endId } };
  }

  Object.assign(content, { collectCourseApi, collectCourseApiWithAccount });
})();
