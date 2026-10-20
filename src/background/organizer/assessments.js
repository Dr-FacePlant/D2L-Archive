(function initAssessmentOrganizerModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, ORGANIZER_VERSION } = shared;

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

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizedAssessmentTitle(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function titleMatch(left, right) {
    const a = normalizedAssessmentTitle(left);
    const b = normalizedAssessmentTitle(right);
    if (!a || !b) return null;
    if (a === b) return { confidence: 0.95, classification: "likely", signal: "normalizedTitleExact", value: a };
    // "Quiz 1" (quiz tool) and "Quiz1" (grade column) name the same item.
    if (/^(?:quiz|test|exam)/.test(a) && a.replace(/ /g, "") === b.replace(/ /g, "")) return { confidence: 0.9, classification: "likely", signal: "normalizedTitleIgnoringSpaces", value: a.replace(/ /g, "") };
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length > b.length ? a : b;
    const tokens = shorter.split(" ").filter(Boolean);
    const assessmentLike = /^(?:quiz|test|exam)\b/.test(shorter) && tokens.some((token) => /\d/.test(token));
    if (assessmentLike && shorter.length >= 6 && longer.startsWith(`${shorter} `)) {
      return { confidence: 0.85, classification: "likely", signal: "normalizedAssessmentTitlePrefix", value: shorter };
    }
    return null;
  }

  const D2L_ORIGIN = "https://kennesaw.view.usg.edu";

  function minutesFromText(text) {
    const match = normalizeText(text).match(/(\d+)\s*minute/i);
    return match ? Number(match[1]) : null;
  }

  // A scored rubric ("View Graded Rubric"), trimmed to what a page shows.
  function rubricSummary(record) {
    if (!record) return null;
    const columns = record.fields?.columns || {};
    const criteria = Array.isArray(columns.criteria) ? columns.criteria : [];
    return {
      name: record.title,
      // D2L returns an empty assessment before grading; only scores count.
      assessed: record.source === "rubricFeedback" && (numberOrNull(columns.overallScore) !== null || criteria.some((entry) => numberOrNull(entry.score) !== null)),
      overallScore: numberOrNull(columns.overallScore),
      overallLevel: normalizeText(columns.overallLevel),
      overallFeedback: normalizeText(columns.overallFeedback),
      criteria: criteria.map((entry) => ({
        name: normalizeText(entry.name),
        level: normalizeText(entry.level),
        score: numberOrNull(entry.score),
        outOf: numberOrNull(entry.outOf),
        feedback: normalizeText(entry.feedback)
      }))
    };
  }

  function quizStatus(entity, createdAt) {
    if (entity.attempts.completed > 0) return "attempted";
    const now = Date.parse(createdAt);
    const start = Date.parse(entity.dates.availableFrom || "");
    const end = Date.parse(entity.dates.availableUntil || entity.dates.dueAt || "");
    if (Number.isFinite(start) && now < start) return "upcoming";
    if (Number.isFinite(end) && now > end) return "closed";
    if (Number.isFinite(start) || Number.isFinite(end)) return "available";
    return entity.status || "unknown";
  }

  function buildQuizKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const records = evidenceRecords || [];
    const entities = [];
    const relationships = [];
    const byQuizId = new Map();

    for (const record of records) {
      if (record.source !== "quiz") continue;
      const quizId = normalizeText(record.platformIds?.quizId);
      if (!quizId) continue;
      const entity = {
        entityId: quizEntityId(record.courseId, quizId),
        entityType: "quizBundle",
        courseId: record.courseId,
        canonicalTitle: record.title || `Quiz ${quizId}`,
        aliases: [],
        status: record.status || "",
        dates: {
          dueAt: record.dates?.dueAt || null,
          availableFrom: record.dates?.availableFrom || null,
          availableUntil: record.dates?.availableUntil || null
        },
        description: /^\[object Object\]$/.test(record.description || "") ? "" : record.description || "",
        // "apiEndDate" means D2L has no due date and dueAt holds the close date.
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
        conflicts: [],
        primaryEvidenceId: record.evidenceId,
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      };
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

    const recordsById = new Map(records.map((record) => [record.evidenceId, record]));
    for (const entity of entities) {
      const related = relationships
        .filter((item) => item.fromId === entity.entityId)
        .map((item) => recordsById.get(item.toId))
        .filter(Boolean);
      entity.aliases = [...new Set(related.map((record) => record.title).filter((title) => title && title !== entity.canonicalTitle))];
      const summaries = related.filter((record) => record.source === "quizSummaryRow");
      const attempts = related.filter((record) => ["quizAttempt", "quizAttemptRow", "quizSubmission"].includes(record.source));
      const completedValues = summaries.map((record) => numberOrNull(record.fields?.columns?.attemptsCompleted)).filter((value) => value !== null);
      const allowedValues = summaries.map((record) => numberOrNull(record.fields?.columns?.attemptsAllowed)).filter((value) => value !== null);
      // The Quiz List page row: what the normal sync can read for a student.
      const listCompletedValues = related
        .filter((record) => record.source === "quizListRow")
        .map((record) => numberOrNull(record.fields?.columns?.attemptsCompleted))
        .filter((value) => value !== null);
      entity.attempts.completed = Math.max(attempts.length, ...completedValues, ...listCompletedValues, 0);
      entity.attempts.source = attempts.length ? "attemptsApi"
        : completedValues.length ? "quizSummaryPage"
          : listCompletedValues.length ? "quizListPage" : "none";
      if (allowedValues.length) entity.attempts.allowed = allowedValues.at(-1);
      entity.timeLimitMinutes ??= summaries.map((record) => minutesFromText(record.fields?.columns?.timeLimitText)).find((value) => value !== null) ?? null;
      const scoreRecord = [...attempts, ...summaries].find((record) => normalizeText(record.fields?.columns?.scoreText || record.fields?.columns?.displayedGrade));
      entity.score = scoreRecord ? normalizeText(scoreRecord.fields.columns.scoreText || scoreRecord.fields.columns.displayedGrade) : null;
      for (const probe of related.filter((record) => record.source === "apiProbe")) {
        const probeType = normalizeText(probe.type || probe.title).toLowerCase();
        const state = probe.status === "blocked" ? "blocked" : probe.status || "available";
        if (probeType.includes("attempt")) entity.access.attempts = state;
        if (probeType.includes("question")) entity.access.questions = state;
      }
      if (attempts.length) entity.access.attempts = "available";
      if (related.some((record) => record.source === "quizQuestion" || record.source === "quizQuestionResult")) entity.access.questions = "available";
      if (related.some((record) => record.source === "quizFeedback" || normalizeText(record.fields?.columns?.feedbackText))) entity.access.feedback = "available";
      entity.status = quizStatus(entity, createdAt);

      // The quiz names its grade column (GradeItemId); fall back to titles only
      // for archives made before that field was kept.
      const exactGrade = entity.gradeItemId
        ? records.find((record) => record.source === "gradeItem" && record.courseId === entity.courseId && normalizeText(record.platformIds?.gradeObjectId) === entity.gradeItemId)
        : null;
      if (exactGrade) {
        relationships.push(relationship(entity, exactGrade, "hasGrade", "matchingGradeItemId", entity.gradeItemId, createdAt));
        entity.gradeEntityId = gradeEntityId(entity.courseId, entity.gradeItemId);
      } else {
        for (const grade of records.filter((record) => record.source === "gradeItem" && record.courseId === entity.courseId)) {
          const match = titleMatch(entity.canonicalTitle, grade.title);
          if (!match) continue;
          relationships.push(relationship(entity, grade, "hasGrade", match.signal, match.value, createdAt, match.confidence, match.classification));
          entity.gradeEntityId ||= gradeEntityId(entity.courseId, normalizeText(grade.platformIds?.gradeObjectId));
        }
      }
    }

    return { entities, relationships };
  }

  function buildGradeKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const records = evidenceRecords || [];
    const entities = [];
    const relationships = [];
    const byGradeId = new Map();

    // Course-wide gradebook rules: points vs weighted, ungraded-as-zero, and
    // each category's name, weight and drop rule.
    const setupByCourse = new Map();
    for (const record of records.filter((item) => item.source === "gradeSetup")) {
      const columns = record.fields?.columns || {};
      let parsed = {};
      try { parsed = JSON.parse(record.description || "{}"); } catch { parsed = {}; }
      setupByCourse.set(record.courseId, {
        gradingSystem: normalizeText(columns.gradingSystem || parsed.GradingSystem),
        isNullGradeZero: columns.isNullGradeZero === true || columns.isNullGradeZero === "true" || parsed.IsNullGradeZero === true
      });
    }
    const rubricsByOwner = new Map();
    for (const record of records.filter((item) => item.source === "rubricFeedback" || item.source === "rubric")) {
      const ids = record.platformIds || {};
      const key = ids.discussionTopicId ? `${record.courseId}:topic:${ids.discussionTopicId}` : ids.dropboxFolderId ? `${record.courseId}:folder:${ids.dropboxFolderId}` : "";
      // A scored copy wins over the blank rubric.
      if (key && (!rubricsByOwner.has(key) || record.source === "rubricFeedback")) rubricsByOwner.set(key, record);
    }
    const categories = new Map();
    for (const record of records.filter((item) => item.source === "gradeCategory")) {
      const columns = record.fields?.columns || {};
      categories.set(`${record.courseId}:${normalizeText(record.platformIds?.gradeCategoryId)}`, {
        name: record.title,
        weight: numberOrNull(columns.weight),
        maxPoints: numberOrNull(columns.maxPoints),
        lowestToDrop: numberOrNull(columns.numberOfLowestToDrop) || 0,
        highestToDrop: numberOrNull(columns.numberOfHighestToDrop) || 0
      });
    }

    for (const record of records) {
      if (record.source !== "gradeItem" && record.source !== "finalGrade") continue;
      const gradeObjectId = normalizeText(record.platformIds?.gradeObjectId) || (record.source === "finalGrade" ? "final" : "");
      if (!gradeObjectId) continue;
      const columns = record.fields?.columns || {};
      const isGraded = columns.isGraded === true || columns.isGraded === "true" || normalizeText(columns.displayedGrade);
      const setup = setupByCourse.get(record.courseId) || { gradingSystem: "", isNullGradeZero: false };
      // Older archives only name the category total by its type ("Category").
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
      const entity = {
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
          weightAchieved: weighted && (weightedNumerator !== null || weightedDenominator !== null)
            ? { numerator: weightedNumerator, denominator: weightedDenominator }
            : null
        },
        // A "Calculated" grade item (e.g. a Midterm that sums other items) is a
        // regular row on D2L's My Grades; the final grade arrives as finalGrade.
        kind: record.source === "finalGrade" ? "final" : isCategoryTotal ? "category" : "item",
        rubric: rubricSummary(rubricRecord),
        category: categoryId ? { id: categoryId, name: category?.name || "", weight: category?.weight ?? null, lowestToDrop: category?.lowestToDrop || 0, highestToDrop: category?.highestToDrop || 0 } : null,
        gradingSystem: setup.gradingSystem,
        ungradedCountsAsZero: setup.isNullGradeZero,
        // D2L's "Dropped!": a graded item in a drop-lowest category that the
        // weighted gradebook counts as 0 / 0.
        isDropped: Boolean(weighted && isGraded && !isCategoryTotal && weightedDenominator === 0 && (category?.lowestToDrop || category?.highestToDrop)),
        isBonus: columns.isBonus === true,
        excludedFromFinal: columns.excludeFromFinal === true,
        sourceEntityId: ids.associatedQuizId
          ? `quiz:${record.courseId}:${ids.associatedQuizId}`
          : ids.associatedAssignmentFolderId
            ? `assignment:${record.courseId}:${ids.associatedAssignmentFolderId}`
            : ids.associatedDiscussionTopicId
              ? `discussionThread:${record.courseId}:${ids.associatedDiscussionTopicId}`
              : null,
        urls: {
          d2l: record.urls?.item || `${D2L_ORIGIN}/d2l/lms/grades/my_grades/main.d2l?ou=${record.courseId}`,
          quizAttempts: ids.associatedQuizId ? `${D2L_ORIGIN}/d2l/lms/quizzing/user/quiz_submissions.d2l?qi=${ids.associatedQuizId}&ou=${record.courseId}` : ""
        },
        // A grade item's description is the instructor's column note, not feedback.
        description: record.source === "gradeItem" ? record.description || "" : "",
        feedback: normalizeText(columns.commentsAndAssessments || columns.feedbackText || (record.source === "finalGrade" ? record.description : "")),
        dates: { gradedAt: record.dates?.gradedAt || null },
        primaryEvidenceId: record.evidenceId,
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      };
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
