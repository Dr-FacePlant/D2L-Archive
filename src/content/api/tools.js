(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;
  const { apiGet, apiList, richText, firstRichText, D2L_API_MODERN_VERSION, D2L_LP_API_VERSION } = content;

async function collectChecklistItems(orgUnitId) {
  const items = [];
  const itemStatuses = {};
  const categoryStatuses = {};
  const result = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/checklists/`);
  if (!result.ok) return { status: result.status, itemStatuses, categoryStatuses, items };

  for (const checklist of apiList(result.data)) {
    const checklistId = checklist.Id || checklist.ChecklistId;
    if (!checklistId) continue;
    const checklistTitle = normalizeText(checklist.Name || `Checklist ${checklistId}`);
    items.push({
      source: "courseToolPage",
      title: checklistTitle,
      description: richText(checklist.Description),
      url: `${window.location.origin}/d2l/lms/checklist/checklists.d2l?ou=${orgUnitId}`,
      status: "available",
      type: "checklist",
      columns: {
        recoveredFrom: "checklistApi",
        toolSource: "checklist",
        emptyStateText: "",
        blockedText: ""
      },
      ids: { courseOrgUnitId: orgUnitId, checklistId: String(checklistId) }
    });

    const categoriesResult = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/checklists/${checklistId}/categories/`);
    categoryStatuses[String(checklistId)] = categoriesResult.status;
    const categoriesById = new Map(apiList(categoriesResult.data).map((category) => [String(category.CategoryId || category.Id || ""), category]));

    const itemsResult = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/checklists/${checklistId}/items/`);
    itemStatuses[String(checklistId)] = itemsResult.status;
    if (!itemsResult.ok) continue;

    for (const entry of apiList(itemsResult.data)) {
      const itemId = entry.ChecklistItemId || entry.Id;
      const categoryId = String(entry.CategoryId || "");
      const category = categoriesById.get(categoryId);
      items.push({
        source: "checklistItem",
        title: normalizeText(entry.Name || `Checklist item ${itemId || ""}`),
        description: richText(entry.Description),
        url: `${window.location.origin}/d2l/lms/checklist/checklists.d2l?ou=${orgUnitId}`,
        dueAtText: entry.DueDate || "",
        status: entry.IsCompleted ? "completed" : "visible",
        columns: {
          recoveredFrom: "checklistApi",
          checklistTitle,
          categoryName: normalizeText(category?.Name || ""),
          sortOrder: entry.SortOrder ?? ""
        },
        ids: { courseOrgUnitId: orgUnitId, checklistId: String(checklistId), checklistItemId: String(itemId || ""), checklistCategoryId: categoryId }
      });
    }
  }
  return { status: result.status, itemStatuses, categoryStatuses, items };
}

async function collectSurveyItems(orgUnitId) {
  const items = [];
  const attemptStatuses = {};
  const questionStatuses = {};
  const result = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/surveys/`);
  if (!result.ok) return { status: result.status, attemptStatuses, questionStatuses, items };

  for (const survey of apiList(result.data)) {
    const surveyId = survey.SurveyId || survey.Id;
    if (!surveyId) continue;
    const title = normalizeText(survey.Name || `Survey ${surveyId}`);
    items.push({
      source: "survey",
      title,
      description: firstRichText(survey.Description?.Text, survey.Description, survey.Submission, survey.Footer?.Text),
      url: `${window.location.origin}/d2l/lms/survey/surveys.d2l?ou=${orgUnitId}`,
      status: survey.IsActive === false ? "inactive" : "visible",
      availabilityText: [survey.StartDate, survey.EndDate].filter(Boolean).join(" - "),
      columns: {
        recoveredFrom: "surveyApi",
        isAnonymous: survey.IsAnonymous ?? "",
        hasInstantFeedback: survey.HasInstantFeedback ?? "",
        attemptsAllowedTypeId: survey.UserResponses?.AttemptsAllowedTypeId ?? "",
        numberOfAttempts: survey.UserResponses?.NumberOfAttempts ?? ""
      },
      ids: { courseOrgUnitId: orgUnitId, surveyId: String(surveyId) }
    });

    const attemptsResult = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/surveys/${surveyId}/attempts/`);
    attemptStatuses[String(surveyId)] = attemptsResult.status;
    for (const attempt of apiList(attemptsResult.data)) {
      items.push({
        source: "surveyAttempt",
        title: `${title} attempt ${attempt.AttemptNumber ?? attempt.AttemptId ?? ""}`.trim(),
        description: normalizeText(`Started ${attempt.Started || ""} Completed ${attempt.Completed || ""}`),
        url: `${window.location.origin}/d2l/lms/survey/survey_attempts.d2l?ou=${orgUnitId}&surveyId=${surveyId}`,
        status: attempt.Completed ? "completed" : "started",
        columns: {
          recoveredFrom: "surveyAttemptsApi",
          attemptNumber: attempt.AttemptNumber ?? "",
          started: attempt.Started || "",
          completed: attempt.Completed || ""
        },
        ids: { courseOrgUnitId: orgUnitId, surveyId: String(surveyId), surveyAttemptId: String(attempt.AttemptId || "") }
      });
    }

    const questionsResult = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/surveys/${surveyId}/questions/`);
    questionStatuses[String(surveyId)] = questionsResult.status;
    for (const question of apiList(questionsResult.data)) {
      const questionId = question.QuestionId || question.Id;
      items.push({
        source: "surveyQuestion",
        title: normalizeText(question.Name || question.Text?.Text || question.Text || `Survey question ${questionId || ""}`),
        description: firstRichText(question.Text, question.Description, question.QuestionText),
        url: `${window.location.origin}/d2l/lms/survey/surveys.d2l?ou=${orgUnitId}`,
        type: question.Type || question.QuestionType || "",
        columns: {
          recoveredFrom: "surveyQuestionsApi",
          surveyTitle: title,
          points: question.Points ?? "",
          sortOrder: question.SortOrder ?? ""
        },
        ids: { courseOrgUnitId: orgUnitId, surveyId: String(surveyId), surveyQuestionId: String(questionId || "") }
      });
    }
  }
  return { status: result.status, attemptStatuses, questionStatuses, items };
}

async function collectGroupItems(orgUnitId) {
  const items = [];
  const groupStatuses = {};
  const result = await apiGet(`/d2l/api/lp/${D2L_LP_API_VERSION}/${orgUnitId}/groupcategories/`);
  if (!result.ok) return { status: result.status, groupStatuses, items };

  for (const category of apiList(result.data)) {
    const categoryId = category.GroupCategoryId || category.Id;
    if (!categoryId) continue;
    const categoryTitle = normalizeText(category.Name || `Group category ${categoryId}`);
    items.push({
      source: "courseToolPage",
      title: categoryTitle,
      description: richText(category.Description),
      url: `${window.location.origin}/d2l/lms/group/group_list.d2l?ou=${orgUnitId}`,
      status: "available",
      type: "groups",
      columns: {
        recoveredFrom: "groupCategoryApi",
        toolSource: "group",
        enrollmentStyle: category.EnrollmentStyle ?? "",
        autoEnroll: category.AutoEnroll ?? "",
        maxUsersPerGroup: category.MaxUsersPerGroup ?? "",
        selfEnrollmentStartDate: category.SelfEnrollmentStartDate || "",
        selfEnrollmentExpiryDate: category.SelfEnrollmentExpiryDate || ""
      },
      ids: { courseOrgUnitId: orgUnitId, groupCategoryId: String(categoryId) }
    });

    const groupsResult = await apiGet(`/d2l/api/lp/${D2L_LP_API_VERSION}/${orgUnitId}/groupcategories/${categoryId}/groups/`);
    groupStatuses[String(categoryId)] = groupsResult.status;
    if (!groupsResult.ok) continue;
    for (const group of apiList(groupsResult.data)) {
      const groupId = group.GroupId || group.Id;
      items.push({
        source: "group",
        title: normalizeText(group.Name || `Group ${groupId || ""}`),
        description: richText(group.Description),
        url: `${window.location.origin}/d2l/lms/group/group_list.d2l?ou=${orgUnitId}`,
        status: "visible",
        columns: {
          recoveredFrom: "groupsApi",
          categoryName: categoryTitle,
          code: group.Code || "",
          enrollmentCount: Array.isArray(group.Enrollments) ? group.Enrollments.length : ""
        },
        ids: { courseOrgUnitId: orgUnitId, groupCategoryId: String(categoryId), groupId: String(groupId || "") }
      });
    }
  }
  return { status: result.status, groupStatuses, items };
}

// D2L's paged class list returns 25 people a page (it ignores pageSize, measured
// live Sep 28, 2026) and puts the next page's site-relative URL in Next. Reading
// only the first page stopped every course at 25 people,
// which left out ART's and HIST's instructors. Follow Next (same site only)
// until it runs out, up to 20 pages / 500 people.
function nextClasslistPage(next) {
  if (typeof next !== "string" || !next) return "";
  try {
    const url = new URL(next, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}` : "";
  } catch {
    return "";
  }
}

async function collectClasslistItems(orgUnitId) {
  const items = [];
  const users = [];
  const seenPages = new Set();
  let status = 0;
  let url = `/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/classlist/paged/?pageSize=200`;
  while (url && !seenPages.has(url) && seenPages.size < 20 && users.length < 500) {
    seenPages.add(url);
    const result = await apiGet(url);
    if (!status) status = result.status;
    if (!result.ok) {
      if (!users.length) return { status: result.status, items };
      break;
    }
    users.push(...apiList(result.data));
    url = nextClasslistPage(result.data?.Next);
  }
  for (const user of users.slice(0, 500)) {
    const userId = user.Identifier || user.UserId || user.Id;
    items.push({
      source: "classlistEntry",
      title: normalizeText(user.DisplayName || `${user.FirstName || ""} ${user.LastName || ""}` || `Classlist user ${userId || ""}`),
      description: normalizeText([user.ClasslistRoleDisplayName || user.RoleName, user.Email, user.LastAccessed ? `Last accessed ${user.LastAccessed}` : ""].filter(Boolean).join(" | ")),
      url: `${window.location.origin}/d2l/lms/classlist/classlist.d2l?ou=${orgUnitId}`,
      // Online presence flips between runs; keep it out of change detection.
      status: "visible",
      columns: {
        recoveredFrom: "classlistApi",
        roleId: user.RoleId ?? "",
        // The paged classlist names the role ClasslistRoleDisplayName ("Instructor").
        roleName: user.ClasslistRoleDisplayName || user.RoleName || "",
        lastAccessed: user.LastAccessed || "",
        profileIdentifier: user.ProfileIdentifier || ""
      },
      ids: { courseOrgUnitId: orgUnitId, userId: String(userId || "") }
    });
  }
  return { status, items };
}

async function collectContentProgressItems(orgUnitId) {
  const result = await apiGet(`/d2l/api/le/unstable/${orgUnitId}/content/userprogress/?pageSize=1000`);
  const items = [];
  if (!result.ok) return { status: result.status, items };
  for (const progress of apiList(result.data).slice(0, 1000)) {
    const objectId = progress.ObjectId || progress.TopicId || progress.ContentObjectId;
    items.push({
      source: "progressRecord",
      title: `Content progress ${objectId || ""}`.trim(),
      description: normalizeText(`Progress ${progress.Completed || progress.CompletionDate || ""} visits ${progress.Visits || ""} time ${progress.TotalTime || progress.TimeSpent || ""}`),
      url: objectId ? `${window.location.origin}/d2l/le/content/${orgUnitId}/viewContent/${objectId}/View` : `${window.location.origin}/d2l/le/userprogress/${orgUnitId}/Summary`,
      status: progress.CompletionDate || progress.Completed ? "completedOrProgressed" : "progressVisible",
      columns: {
        recoveredFrom: "contentUserProgressApi",
        completionType: progress.CompletionType ?? "",
        completionDate: progress.CompletionDate || "",
        visits: progress.Visits ?? "",
        totalTime: progress.TotalTime ?? progress.TimeSpent ?? "",
        lastVisited: progress.LastVisited || progress.LastAccessed || ""
      },
      ids: { courseOrgUnitId: orgUnitId, contentObjectId: String(objectId || ""), userId: String(progress.UserId || "") }
    });
  }
  return { status: result.status, items };
}

// Course codes and term dates come from the current user's enrollment;
// /lp/courses/<ou> may be unavailable to students.
async function collectCourseOfferingItems(orgUnitId) {
  const result = await apiGet(`/d2l/api/lp/${D2L_LP_API_VERSION}/enrollments/myenrollments/${orgUnitId}`);
  if (!result.ok || !result.data?.OrgUnit) return { status: result.status, items: [] };
  const { OrgUnit: unit, Access: access = {} } = result.data;
  return {
    status: result.status,
    items: [{
      source: "courseOffering",
      title: normalizeText(unit.Name || `Course ${orgUnitId}`),
      description: normalizeText(unit.Code || ""),
      url: `${window.location.origin}/d2l/home/${orgUnitId}`,
      status: access.IsActive === false ? "inactive" : "active",
      columns: {
        recoveredFrom: "myEnrollmentApi",
        courseCode: unit.Code || "",
        startDate: access.StartDate || "",
        endDate: access.EndDate || "",
        roleName: access.ClasslistRoleName || "",
        canAccess: access.CanAccess ?? ""
      },
      ids: { courseOrgUnitId: orgUnitId }
    }]
  };
}

// D2L's own completion tracking: level 1 is the whole course ("26 of 70"),
// level 2 is each top-level module ("0 of 4 topics complete").
async function collectContentCompletionItems(orgUnitId) {
  const [course, modules] = await Promise.all([
    apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/content/completions/mycount/?level=1`),
    apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/content/completions/mycount/?level=2`)
  ]);
  const items = [];
  for (const [level, result] of [[1, course], [2, modules]]) {
    if (!result.ok) continue;
    for (const count of apiList(result.data)) {
      const objectId = String(count.ObjectId ?? "");
      items.push({
        source: "contentCompletion",
        title: normalizeText(count.Title || (level === 1 ? "Course completion" : `Module ${objectId}`)),
        description: `${count.CompletedItems ?? 0} of ${count.RequiredItems ?? 0} required items complete`,
        url: level === 1 || objectId === "0"
          ? `${window.location.origin}/d2l/le/content/${orgUnitId}/Home`
          : `${window.location.origin}/d2l/le/content/${orgUnitId}/Home?itemIdentifier=D2L.LE.Content.ContentObject.ModuleCO-${objectId}`,
        status: "tracked",
        columns: {
          recoveredFrom: "contentCompletionsApi",
          level,
          completedItems: count.CompletedItems ?? "",
          requiredItems: count.RequiredItems ?? ""
        },
        ids: { courseOrgUnitId: orgUnitId, completionScope: level === 1 ? "course" : `module:${objectId}` }
      });
    }
  }
  return { status: course.status, moduleStatus: modules.status, items };
}

async function collectMyUserId() {
  const result = await apiGet(`/d2l/api/lp/${D2L_LP_API_VERSION}/users/whoami`);
  return result.ok ? String(result.data?.Identifier || "") : "";
}


  Object.assign(content, {
    collectChecklistItems, collectSurveyItems, collectGroupItems,
    collectClasslistItems, collectContentProgressItems,
    collectCourseOfferingItems, collectContentCompletionItems, collectMyUserId
  });
})();
