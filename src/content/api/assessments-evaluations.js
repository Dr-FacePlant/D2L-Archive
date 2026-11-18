(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;
  const { apiGet, apiList, richText, firstRichText, gradeDisplay, D2L_API_MODERN_VERSION } = content;

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

  function appendGradeCategoryItems(categoriesData, orgUnitId, items) {
    for (const category of apiList(categoriesData)) {
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
          isNullGradeZero: setup.data?.IsNullGradeZero ?? ""
        },
        ids: { courseOrgUnitId: orgUnitId }
      });
    }
    if (categories.ok) {
      appendGradeCategoryItems(categories.data, orgUnitId, items);
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

  function appendRubricEntity(rubric, orgUnitId, objectType, objectId, ownerIds, ownerTitle, assessment, items) {
    const levelsById = new Map();
    const criteria = [];
    for (const group of apiList(rubric.CriteriaGroups)) {
      const levels = apiList(group.Levels);
      for (const level of levels) levelsById.set(String(level.Id), level);
      const outOf = Math.max(0, ...levels.map((level) => Number(level.Points) || 0));
      for (const criterion of apiList(group.Criteria)) criteria.push({ id: String(criterion.Id), name: normalizeText(criterion.Name), outOf, levels: levels.map((level) => normalizeText(level.Name)) });
    }
    for (const level of apiList(rubric.OverallLevels)) levelsById.set(String(level.Id), level);
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

  async function collectRubricItems(orgUnitId, objectType, objectId, ownerIds, myUserId = "", ownerTitle = "") {
    const result = await apiGet(`/d2l/api/le/unstable/${orgUnitId}/rubrics?objectType=${objectType}&objectId=${objectId}`);
    const items = [];
    if (!result.ok) return { status: result.status, items };
    for (const rubric of apiList(result.data)) {
      const assessment = myUserId && rubric.IsScoreVisibleToAssessedUsers !== false
        ? await apiGet(`/d2l/api/le/unstable/${orgUnitId}/assessment?assessmentType=Rubric&objectType=${objectType}&objectId=${objectId}&rubricId=${rubric.RubricId}&userId=${myUserId}`)
        : { ok: false, status: "notRequested" };
      appendRubricEntity(rubric, orgUnitId, objectType, objectId, ownerIds, ownerTitle, assessment, items);
    }
    return { status: result.status, items };
  }

  Object.assign(content, {
    collectRubricItems,
    collectCourseOverviewItems,
    collectGradeMetadataItems
  });
})();
