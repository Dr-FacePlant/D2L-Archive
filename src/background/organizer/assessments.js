(function initAssessmentOrganizerModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { createOrganizerMeta } = background;
  const { normalizeText, ORGANIZER_VERSION } = shared;
  const { numberOrNull, normalizedAssessmentTitle, titleMatch, minutesFromText, rubricSummary, quizStatus } = background;

  const QUIZ_RELATIONSHIP_BY_SOURCE = Object.freeze({
    quiz: "sameAs",
    quizSummaryRow: "hasSummary",
    quizListRow: "hasSummary",
    quizAttempt: "hasAttempt",
    quizAttemptRow: "hasAttempt",
    quizSubmission: "hasAttempt",
    quizQuestion: "hasQuestion",
    quizQuestionResult: "hasQuestionResult",
    quizFeedback: "hasFeedback",
    apiProbe: "hasAccessProbe"
  });

  const D2L_ORIGIN = "https://kennesaw.view.usg.edu";

  function quizEntityId(courseId, quizId) {
    return `quiz:${courseId}:${quizId}`;
  }

  function gradeEntityId(courseId, gradeObjectId) {
    return `grade:${courseId}:${gradeObjectId}`;
  }

  function relationship(entity, record, type, signal, value, createdAt, confidence = 1, classification = "confirmed") {
    return {
      relationshipId: `${entity.entityId}::${type}::${record.evidenceId}`,
      courseId: entity.courseId,
      fromId: entity.entityId,
      toId: record.evidenceId,
      type,
      confidence,
      classification,
      evidence: [{ signal, value: normalizeText(value), weight: confidence }],
      organizerVersion: ORGANIZER_VERSION,
      createdAt
    };
  }

  function createQuizBundle(record, quizId, createdAt) {
    return {
      entityId: quizEntityId(record.courseId, quizId),
      entityType: "quizBundle",
      courseId: record.courseId,
      canonicalTitle: record.title || `Quiz ${quizId}`,
      aliases: [],
      status: record.status || "",
      dates: { dueAt: record.dates?.dueAt || null, availableFrom: record.dates?.availableFrom || null, availableUntil: record.dates?.availableUntil || null },
      description: /^\[object Object\]$/.test(record.description || "") ? "" : record.description || "",
      dueAtSource: normalizeText(record.fields?.columns?.dueAtSource),
      timeLimitMinutes: numberOrNull(record.fields?.columns?.timeLimitMinutes),
      gradeItemId: normalizeText(record.fields?.columns?.gradeItemId),
      gradeEntityId: null,
      isActive: record.fields?.columns?.isActive !== false,
      attempts: {
        allowed: record.fields?.columns?.attempts?.IsUnlimited ? null : numberOrNull(record.fields?.columns?.attempts?.NumberOfAttemptsAllowed),
        unlimited: record.fields?.columns?.attempts?.IsUnlimited === true,
        completed: 0,
        source: "none"
      },
      score: null,
      urls: {
        d2l: record.urls?.item || `${D2L_ORIGIN}/d2l/lms/quizzing/user/quiz_summary.d2l?ou=${record.courseId}&qi=${quizId}`,
        submissions: `${D2L_ORIGIN}/d2l/lms/quizzing/user/quiz_submissions.d2l?qi=${quizId}&ou=${record.courseId}`
      },
      access: { attempts: "unknown", questions: "unknown", feedback: "unknown" },
      ...createOrganizerMeta(record, createdAt)
    };
  }

  function enrichQuizAttempts(entity, related) {
    const summaries = related.filter((r) => r.source === "quizSummaryRow");
    const attempts = related.filter((r) => ["quizAttempt", "quizAttemptRow", "quizSubmission"].includes(r.source));
    const completedVals = summaries.map((r) => numberOrNull(r.fields?.columns?.attemptsCompleted)).filter((v) => v !== null);
    const allowedVals = summaries.map((r) => numberOrNull(r.fields?.columns?.attemptsAllowed)).filter((v) => v !== null);
    const listCompleted = related.filter((r) => r.source === "quizListRow").map((r) => numberOrNull(r.fields?.columns?.attemptsCompleted)).filter((v) => v !== null);
    entity.attempts.completed = Math.max(attempts.length, ...completedVals, ...listCompleted, 0);
    entity.attempts.source = attempts.length ? "attemptsApi" : completedVals.length ? "quizSummaryPage" : listCompleted.length ? "quizListPage" : "none";
    if (allowedVals.length) entity.attempts.allowed = allowedVals.at(-1);
    entity.timeLimitMinutes ??= summaries.map((r) => minutesFromText(r.fields?.columns?.timeLimitText)).find((v) => v !== null) ?? null;
    const scoreRecord = [...attempts, ...summaries].find((r) => normalizeText(r.fields?.columns?.scoreText || r.fields?.columns?.displayedGrade));
    entity.score = scoreRecord ? normalizeText(scoreRecord.fields.columns.scoreText || scoreRecord.fields.columns.displayedGrade) : null;
  }

  function enrichQuizAccess(entity, related) {
    for (const probe of related.filter((r) => r.source === "apiProbe")) {
      const type = normalizeText(probe.type || probe.title).toLowerCase();
      const status = probe.status === "blocked" ? "blocked" : probe.status === "available" ? "available" : probe.status || "unproven";
      if (type.includes("attempt") && entity.access.attempts !== "available") entity.access.attempts = status;
      if (type.includes("question") && entity.access.questions !== "available") entity.access.questions = status;
      if (type.includes("feedback") && entity.access.feedback !== "available") entity.access.feedback = status;
    }
    if (related.some((r) => ["quizAttempt", "quizAttemptRow", "quizSubmission"].includes(r.source))) entity.access.attempts = "available";
    if (related.some((r) => ["quizQuestion", "quizQuestionResult"].includes(r.source))) entity.access.questions = "available";
    if (related.some((r) => r.source === "quizFeedback" || r.source === "rubricFeedback")) entity.access.feedback = "available";
  }

  function linkQuizGrade(entity, gradeItems, relationships, createdAt) {
    const directGrade = entity.gradeItemId ? gradeItems.find((g) => normalizeText(g.platformIds?.gradeObjectId) === entity.gradeItemId) : null;
    if (directGrade) {
      entity.gradeEntityId = gradeEntityId(directGrade.courseId, normalizeText(directGrade.platformIds?.gradeObjectId));
      relationships.push(relationship(entity, directGrade, "hasGrade", "matchingGradeItemId", entity.gradeItemId, createdAt));
      return;
    }
    for (const gradeItem of gradeItems) {
      const match = titleMatch(entity.canonicalTitle, gradeItem.title);
      if (match) {
        entity.gradeEntityId = gradeEntityId(gradeItem.courseId, normalizeText(gradeItem.platformIds?.gradeObjectId));
        relationships.push(relationship(entity, gradeItem, "hasGrade", match.signal, match.value, createdAt, match.confidence, match.classification));
        break;
      }
    }
  }

  function buildQuizKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const records = evidenceRecords || [];
    const entities = [];
    const relationships = [];
    const byQuizId = new Map();

    for (const record of records.filter((r) => r.source === "quiz")) {
      const quizId = normalizeText(record.platformIds?.quizId);
      if (!quizId) continue;
      const entity = createQuizBundle(record, quizId, createdAt);
      entities.push(entity);
      byQuizId.set(`${record.courseId}:${quizId}`, entity);
      relationships.push(relationship(entity, record, "sameAs", "matchingQuizId", quizId, createdAt));
    }

    for (const record of records) {
      const quizId = normalizeText(record.platformIds?.quizId);
      const entity = byQuizId.get(`${record.courseId}:${quizId}`);
      if (!entity || record.source === "quiz") continue;
      const type = QUIZ_RELATIONSHIP_BY_SOURCE[record.source];
      if (!type) continue;
      if (record.source === "apiProbe" && !/^quiz\b/i.test(record.type || record.title || "")) continue;
      relationships.push(relationship(entity, record, type, "matchingQuizId", quizId, createdAt));
    }

    const recordsById = new Map(records.map((r) => [r.evidenceId, r]));
    const gradeItems = records.filter((r) => r.source === "gradeItem");
    for (const entity of entities) {
      const related = relationships.filter((rel) => rel.fromId === entity.entityId).map((rel) => recordsById.get(rel.toId)).filter(Boolean);
      entity.aliases = [...new Set(related.map((r) => r.title).filter((t) => t && t !== entity.canonicalTitle))];
      enrichQuizAttempts(entity, related);
      enrichQuizAccess(entity, related);
      entity.status = quizStatus(entity, createdAt);
      linkQuizGrade(entity, gradeItems.filter((g) => g.courseId === entity.courseId), relationships, createdAt);
    }

    return { entities, relationships };
  }

  function collectGradeSetupAndCategories(records) {
    const setupByCourse = new Map();
    for (const record of records.filter((r) => r.source === "gradeSetup")) {
      const columns = record.fields?.columns || {};
      let parsed = {};
      try { parsed = JSON.parse(record.description || "{}"); } catch { parsed = {}; }
      setupByCourse.set(record.courseId, {
        gradingSystem: normalizeText(columns.gradingSystem || parsed.GradingSystem),
        isNullGradeZero: columns.isNullGradeZero === true || columns.isNullGradeZero === "true" || parsed.IsNullGradeZero === true
      });
    }
    const rubricsByOwner = new Map();
    for (const record of records.filter((r) => r.source === "rubricFeedback" || r.source === "rubric")) {
      const ids = record.platformIds || {};
      const key = ids.discussionTopicId ? `${record.courseId}:topic:${ids.discussionTopicId}` : ids.dropboxFolderId ? `${record.courseId}:folder:${ids.dropboxFolderId}` : "";
      if (key && (!rubricsByOwner.has(key) || record.source === "rubricFeedback")) rubricsByOwner.set(key, record);
    }
    const categories = new Map();
    for (const record of records.filter((r) => r.source === "gradeCategory")) {
      const columns = record.fields?.columns || {};
      categories.set(`${record.courseId}:${normalizeText(record.platformIds?.gradeCategoryId)}`, {
        name: record.title,
        weight: numberOrNull(columns.weight),
        maxPoints: numberOrNull(columns.maxPoints),
        lowestToDrop: numberOrNull(columns.numberOfLowestToDrop) || 0,
        highestToDrop: numberOrNull(columns.numberOfHighestToDrop) || 0
      });
    }
    return { setupByCourse, rubricsByOwner, categories };
  }

  function createGradeEntity(record, gradeObjectId, setupByCourse, categories, rubricsByOwner, createdAt) {
    const columns = record.fields?.columns || {};
    const isGraded = columns.isGraded === true || columns.isGraded === "true" || normalizeText(columns.displayedGrade);
    const setup = setupByCourse.get(record.courseId) || { gradingSystem: "", isNullGradeZero: false };
    const isCategoryTotal = columns.isCategoryTotal === true || Number(columns.gradeObjectType) === 9 || (record.source === "gradeItem" && /^category$/i.test(record.type || ""));
    const categoryId = isCategoryTotal ? gradeObjectId : normalizeText(columns.gradeCategory && columns.gradeCategory !== 0 ? columns.gradeCategory : "");
    const category = categories.get(`${record.courseId}:${categoryId}`) || null;
    const weightedNumerator = numberOrNull(columns.weightedNumerator);
    const weightedDenominator = numberOrNull(columns.weightedDenominator);
    const weighted = /weight/i.test(setup.gradingSystem);
    const ids = record.platformIds || {};
    const rubricRecord = ids.associatedDiscussionTopicId
      ? rubricsByOwner.get(`${record.courseId}:topic:${ids.associatedDiscussionTopicId}`)
      : ids.associatedAssignmentFolderId ? rubricsByOwner.get(`${record.courseId}:folder:${ids.associatedAssignmentFolderId}`) : null;
    return {
      entity: {
        entityId: gradeEntityId(record.courseId, gradeObjectId),
        entityType: "gradeRecord",
        courseId: record.courseId,
        canonicalTitle: record.title || (gradeObjectId === "final" ? "Final grade" : `Grade ${gradeObjectId}`),
        aliases: [],
        status: isGraded ? "graded" : "ungraded",
        grade: {
          displayed: normalizeText(columns.displayedGrade),
          pointsEarned: numberOrNull(columns.pointsEarned ?? columns.points),
          pointsPossible: numberOrNull(columns.pointsPossible),
          weight: numberOrNull(columns.weight),
          categoryId: normalizeText(columns.gradeCategory || record.platformIds?.gradeCategoryId),
          weightAchieved: weighted && (weightedNumerator !== null || weightedDenominator !== null) ? { numerator: weightedNumerator, denominator: weightedDenominator } : null
        },
        kind: record.source === "finalGrade" ? "final" : isCategoryTotal ? "category" : "item",
        rubric: rubricSummary(rubricRecord),
        category: categoryId ? { id: categoryId, name: category?.name || "", weight: category?.weight ?? null, lowestToDrop: category?.lowestToDrop || 0, highestToDrop: category?.highestToDrop || 0 } : null,
        gradingSystem: setup.gradingSystem,
        ungradedCountsAsZero: setup.isNullGradeZero,
        isDropped: Boolean(weighted && isGraded && !isCategoryTotal && weightedDenominator === 0 && (category?.lowestToDrop || category?.highestToDrop)),
        isBonus: columns.isBonus === true,
        excludedFromFinal: columns.excludeFromFinal === true,
        sourceEntityId: ids.associatedQuizId ? `quiz:${record.courseId}:${ids.associatedQuizId}` : ids.associatedAssignmentFolderId ? `assignment:${record.courseId}:${ids.associatedAssignmentFolderId}` : ids.associatedDiscussionTopicId ? `discussionThread:${record.courseId}:${ids.associatedDiscussionTopicId}` : null,
        urls: {
          d2l: record.urls?.item || `${D2L_ORIGIN}/d2l/lms/grades/my_grades/main.d2l?ou=${record.courseId}`,
          quizAttempts: ids.associatedQuizId ? `${D2L_ORIGIN}/d2l/lms/quizzing/user/quiz_submissions.d2l?qi=${ids.associatedQuizId}&ou=${record.courseId}` : ""
        },
        description: record.source === "gradeItem" ? record.description || "" : "",
        feedback: normalizeText(columns.commentsAndAssessments || columns.feedbackText || (record.source === "finalGrade" ? record.description : "")),
        dates: { gradedAt: record.dates?.gradedAt || null },
        primaryEvidenceId: record.evidenceId,
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      },
      rubricRecord,
      ids
    };
  }

  function buildGradeKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const records = evidenceRecords || [];
    const entities = [];
    const relationships = [];
    const byGradeId = new Map();
    const { setupByCourse, rubricsByOwner, categories } = collectGradeSetupAndCategories(records);

    for (const record of records) {
      if (record.source !== "gradeItem" && record.source !== "finalGrade") continue;
      const gradeObjectId = normalizeText(record.platformIds?.gradeObjectId) || (record.source === "finalGrade" ? "final" : "");
      if (!gradeObjectId) continue;
      const { entity, rubricRecord, ids } = createGradeEntity(record, gradeObjectId, setupByCourse, categories, rubricsByOwner, createdAt);
      entities.push(entity);
      byGradeId.set(`${record.courseId}:${gradeObjectId}`, entity);
      relationships.push(relationship(entity, record, "sameAs", "matchingGradeObjectId", gradeObjectId, createdAt));
      if (rubricRecord) relationships.push(relationship(entity, rubricRecord, "hasRubric", "matchingAssociatedToolItem", ids.associatedDiscussionTopicId || ids.associatedAssignmentFolderId, createdAt));
    }

    for (const record of records) {
      if (record.source !== "gradeFeedback") continue;
      const gradeObjectId = normalizeText(record.platformIds?.gradeObjectId);
      const entity = byGradeId.get(`${record.courseId}:${gradeObjectId}`);
      if (!entity) continue;
      relationships.push(relationship(entity, record, "hasFeedback", "matchingGradeObjectId", gradeObjectId, createdAt));
      entity.feedback ||= normalizeText(record.fields?.columns?.feedbackText || record.description);
      entity.dates.gradedAt ||= record.dates?.gradedAt || null;
    }

    return { entities, relationships };
  }

  Object.assign(background, {
    QUIZ_RELATIONSHIP_BY_SOURCE,
    quizEntityId,
    gradeEntityId,
    rubricSummary,
    normalizedAssessmentTitle,
    titleMatch,
    buildQuizKnowledge,
    buildGradeKnowledge
  });
})(globalThis);
