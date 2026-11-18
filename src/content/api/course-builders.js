(function initCourseBuildersModule(global) {
  const content = global.D2LExtractorContent ||= {};
  const shared = global.D2LExtractorShared;
  const { normalizeText } = shared;
  const {
    firstRichText,
    fileNameFromUrl,
    directDownloadUrl,
    absoluteUrl,
    resolveDue,
    flattenTocModules,
    flattenTocTopics,
    mergeGradeValues,
    gradeDisplay,
    addApiProbeRow
  } = content;

  const CALENDAR_EVENT_LABELS = Object.freeze({ 2: "Available", 3: "Availability Ends", 6: "Due" });
  const GRADE_TOOL_SOURCES = Object.freeze({ 51000: "quiz", 3000: "discussionTopic", 2000: "assignment" });

  function buildModuleRows(tocData, orgUnitId) {
    const apiItems = [];
    for (const module of flattenTocModules(tocData?.Modules)) {
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
    return apiItems;
  }

  function buildTopicRows(tocData, orgUnitId) {
    const apiItems = [];
    for (const topic of flattenTocTopics(tocData?.Modules)) {
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
    return apiItems;
  }

  function buildModuleAndTopicRows(tocData, orgUnitId) {
    return [...buildModuleRows(tocData, orgUnitId), ...buildTopicRows(tocData, orgUnitId)];
  }

  function buildQuizRows(quizzesData, byEntity, orgUnitId) {
    const apiItems = [];
    for (const quiz of quizzesData?.Objects || []) {
      const due = resolveDue(quiz.DueDate, quiz.EndDate, byEntity.get(`D2L.LE.Quizzing.Quiz:${quiz.QuizId}`));
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
    return apiItems;
  }

  function buildCalendarEventRows(eventList, orgUnitId) {
    const apiItems = [];
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
    return apiItems;
  }

  function createGradeItemEntry(name, id, definition, value, tool, toolSource, linkedIds, feedbackText, rubricText, orgUnitId) {
    return {
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
    };
  }

  function buildGradeRows(gradeDefsData, gradeValsData, quizzesData, assignmentFolderByGradeItem, orgUnitId) {
    const apiItems = [];
    const quizByGradeItem = new Map((quizzesData?.Objects || []).filter((q) => q.GradeItemId).map((q) => [String(q.GradeItemId), String(q.QuizId)]));
    for (const { definition, value } of mergeGradeValues(gradeDefsData, gradeValsData)) {
      const name = normalizeText(definition?.Name || value?.GradeObjectName || "");
      if (!name && !value) continue;
      const id = definition?.Id ?? value?.GradeObjectIdentifier ?? "";
      const feedbackText = firstRichText(value?.Comments, value?.Comment, value?.Feedback, value?.FeedbackText, value?.Assessment?.Feedback, value?.Assessment?.Comments, value?.PrivateComments);
      const rubricText = firstRichText(value?.RubricAssessment, value?.RubricFeedback, value?.Rubric, value?.Assessment?.RubricFeedback, value?.Assessment?.Rubric);
      const tool = definition?.AssociatedTool || null;
      const toolSource = GRADE_TOOL_SOURCES[tool?.ToolId] || "";
      const linkedIds = {
        ...(assignmentFolderByGradeItem.has(String(id)) ? { associatedAssignmentFolderId: assignmentFolderByGradeItem.get(String(id)) } : {}),
        ...(quizByGradeItem.has(String(id)) ? { associatedQuizId: quizByGradeItem.get(String(id)) } : {}),
        ...(toolSource === "discussionTopic" && tool?.ToolItemId != null ? { associatedDiscussionTopicId: String(tool.ToolItemId) } : {})
      };
      apiItems.push(createGradeItemEntry(name, id, definition, value, tool, toolSource, linkedIds, feedbackText, rubricText, orgUnitId));
      if (feedbackText || rubricText) {
        apiItems.push({
          source: "gradeFeedback",
          title: `${name || `Grade item ${id}`} feedback`,
          description: [feedbackText, rubricText].filter(Boolean).join("\n\n"),
          url: `${window.location.origin}/d2l/lms/grades/my_grades/main.d2l?ou=${orgUnitId}`,
          status: "feedbackAvailable",
          columns: { displayedGrade: gradeDisplay(value), pointsEarned: value?.PointsNumerator ?? "", pointsPossible: value?.PointsDenominator ?? definition?.MaxPoints ?? "", feedbackText, rubricText },
          ids: { courseOrgUnitId: orgUnitId, gradeObjectId: String(id), ...linkedIds }
        });
      }
    }
    return apiItems;
  }

  function recordCoreApiProbes(apiItems, orgUnitId, info) {
    const listLength = (data) => (Array.isArray(data) ? data.length : 0);
    const { toc, quizzes, dropbox, events, gradeDefs, gradeVals, gradeMetadataResult, newsResult, discussionResult, secondaryResults } = info;
    addApiProbeRow(apiItems, orgUnitId, "content table of contents", toc.status, { evidenceCount: flattenTocTopics(toc.data?.Modules).length }, { includeAvailable: true });
    addApiProbeRow(apiItems, orgUnitId, "quizzes", quizzes.status, { evidenceCount: (quizzes.data?.Objects || []).length }, { includeAvailable: true });
    addApiProbeRow(apiItems, orgUnitId, "assignments", dropbox.status, { evidenceCount: listLength(dropbox.data) }, { includeAvailable: true });
    addApiProbeRow(apiItems, orgUnitId, "calendar", events.status, { evidenceCount: Array.isArray(events.data) ? events.data.length : 0 }, { includeAvailable: true });
    addApiProbeRow(apiItems, orgUnitId, "grade definitions", gradeDefs.status, { evidenceCount: listLength(gradeDefs.data) }, { includeAvailable: true });
    addApiProbeRow(apiItems, orgUnitId, "grade values", gradeVals.status, { evidenceCount: listLength(gradeVals.data) }, { includeAvailable: true });
    addApiProbeRow(apiItems, orgUnitId, "grade setup", gradeMetadataResult.setupStatus, { evidenceCount: (gradeMetadataResult.items || []).filter((item) => item.source === "gradeSetup").length }, { includeAvailable: true });
    addApiProbeRow(apiItems, orgUnitId, "grade categories", gradeMetadataResult.categoriesStatus, { evidenceCount: (gradeMetadataResult.items || []).filter((item) => item.source === "gradeCategory").length }, { includeAvailable: true });
    addApiProbeRow(apiItems, orgUnitId, "final grade", gradeMetadataResult.finalGradeStatus, { evidenceCount: (gradeMetadataResult.items || []).filter((item) => item.source === "finalGrade").length }, { includeAvailable: true });
    addApiProbeRow(apiItems, orgUnitId, "announcements", newsResult.status, { evidenceCount: (newsResult.items || []).filter((item) => item.source === "announcement").length }, { includeAvailable: true });
    addApiProbeRow(apiItems, orgUnitId, "discussion forums", discussionResult.status, { evidenceCount: (discussionResult.items || []).filter((item) => item.source === "discussionForum").length }, { includeAvailable: true });
    for (const [topicId, status] of Object.entries(discussionResult.topicStatuses || {})) {
      addApiProbeRow(apiItems, orgUnitId, "discussion topic", status, { discussionTopicId: topicId });
    }
    for (const [topicId, status] of Object.entries(discussionResult.postStatuses || {})) {
      addApiProbeRow(apiItems, orgUnitId, "discussion posts", status, { discussionTopicId: topicId });
    }
    for (const [toolName, res] of Object.entries(secondaryResults)) {
      addApiProbeRow(apiItems, orgUnitId, toolName, res.status, { evidenceCount: (res.items || []).length }, { includeAvailable: true });
    }
  }

  function buildQuizAndDropboxStatuses(quizzes, dropbox) {
    const dropboxMySubmissions = Array.isArray(dropbox.data)
      ? Object.fromEntries(dropbox.data.map((folder) => [String(folder.Id), folder._mySubmissionsStatus || "notAttempted"]))
      : {};
    const quizAttempts = quizzes.data?.Objects
      ? Object.fromEntries(quizzes.data.Objects.map((quiz) => [String(quiz.QuizId), quiz._attemptsStatus || "notAttempted"]))
      : {};
    const quizAttemptDetails = quizzes.data?.Objects
      ? Object.fromEntries(quizzes.data.Objects.map((quiz) => [String(quiz.QuizId), quiz._attemptDetailStatuses || {}]))
      : {};
    const quizQuestions = quizzes.data?.Objects
      ? Object.fromEntries(quizzes.data.Objects.map((quiz) => [String(quiz.QuizId), quiz._questionsStatus || "notAttempted"]))
      : {};
    return { dropboxMySubmissions, quizAttempts, quizAttemptDetails, quizQuestions };
  }

  function buildApiStatusMap(core, quizListResult) {
    const {
      toc, quizzes, dropbox, events, gradeDefs, gradeVals,
      gradeMetadataResult, newsResult, discussionResult, checklistResult,
      surveyResult, groupResult, classlistResult, contentProgressResult,
      overviewResult, offeringResult, completionResult, dropboxCategories
    } = core;
    const subStatuses = buildQuizAndDropboxStatuses(quizzes, dropbox);
    return {
      toc: toc.status,
      quizzes: quizzes.status,
      quizList: quizListResult?.status ?? "",
      dropbox: dropbox.status,
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
      ...subStatuses
    };
  }

  function buildApiCountsMap(allItems) {
    const count = (source) => allItems.filter((i) => i.source === source).length;
    return {
      topics: count("contentTopic"), contentModules: count("contentModule"), contentCompletion: count("contentCompletion"),
      assignmentAttachments: count("assignmentAttachment"), courseOverview: count("courseOverview"),
      courseOverviewAttachments: count("courseOverviewAttachment"), quizzes: count("quiz"),
      quizQuestions: count("quizQuestion"), assignments: count("assignment"),
      assignmentSubmissions: count("assignmentSubmission"), assignmentFeedback: count("assignmentFeedback"),
      submittedFiles: count("submittedFile"), quizAttempts: count("quizAttempt"), quizListRows: count("quizListRow"),
      checklistItems: count("checklistItem"), surveys: count("survey"), surveyAttempts: count("surveyAttempt"),
      surveyQuestions: count("surveyQuestion"), groups: count("group"), classlistEntries: count("classlistEntry"),
      progressRecords: count("progressRecord"), announcements: count("announcement"),
      announcementAttachments: count("announcementAttachment"), discussionForums: count("discussionForum"),
      discussionTopics: count("discussionTopic"), discussionPosts: count("discussionPost"),
      syllabusPolicies: count("syllabusPolicy"), rubrics: count("rubric"),
      rubricAssessments: count("rubricFeedback"), calendarEvents: count("calendarEvent"),
      gradeItems: count("gradeItem"), gradeSetup: count("gradeSetup"), gradeCategories: count("gradeCategory"),
      finalGrade: count("finalGrade"), gradeFeedback: count("gradeFeedback"), apiProbes: count("apiProbe")
    };
  }

  function buildCourseApiPayload(orgUnitId, allItems, core, quizListResult) {
    return {
      orgUnitId,
      apiStatus: buildApiStatusMap(core, quizListResult),
      counts: buildApiCountsMap(allItems),
      items: allItems
    };
  }

  Object.assign(content, {
    buildCourseApiPayload,
    CALENDAR_EVENT_LABELS,
    GRADE_TOOL_SOURCES,
    buildModuleAndTopicRows,
    buildQuizRows,
    buildCalendarEventRows,
    buildGradeRows,
    recordCoreApiProbes
  });
})(globalThis);
