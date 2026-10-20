(function initAssignmentOrganizerModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, ORGANIZER_VERSION } = shared;

  const ASSIGNMENT_RELATIONSHIP_BY_SOURCE = Object.freeze({
    assignment: "sameAs",
    assignmentInstruction: "hasInstructions",
    contentTopic: "hasInstructions",
    contentAttachment: "hasFile",
    assignmentAttachment: "hasFile",
    assignmentSubmission: "hasSubmission",
    submittedFile: "hasSubmittedFile",
    assignmentFeedback: "hasFeedback",
    gradeFeedback: "hasFeedback",
    rubric: "hasRubric",
    rubricFeedback: "hasRubric",
    rubricCriterionFeedback: "hasRubric",
    gradeItem: "hasGrade",
    calendarEvent: "hasDeadline",
    announcement: "mentionedByAnnouncement"
  });

  function assignmentFolderId(record) {
    const ids = record?.platformIds || {};
    return normalizeText(ids.dropboxFolderId || ids.assignmentFolderId || ids.associatedAssignmentFolderId || ids.linkedAssignmentFolderId);
  }

  const D2L_ORIGIN = "https://kennesaw.view.usg.edu";

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function assignmentEntityId(courseId, folderId) {
    return `assignment:${courseId}:${folderId}`;
  }

  function relationshipId(fromId, type, toId) {
    return `${fromId}::${type}::${toId}`;
  }

  function isConcreteAssignmentSubmission(record) {
    if (record?.source !== "assignmentSubmission") return false;
    const columns = record.fields?.columns || {};
    return record.status === "submitted"
      || Boolean(record.dates?.submittedAt)
      || Boolean(normalizeText(record.platformIds?.submissionId))
      || Number(columns.fileCount || columns.submittedFileCount || 0) > 0
      || Boolean(normalizeText(columns.submitted || columns.date_submitted));
  }

  function exactRelationship(entity, record, type, signal, value, createdAt) {
    return {
      relationshipId: relationshipId(entity.entityId, type, record.evidenceId),
      courseId: entity.courseId,
      fromId: entity.entityId,
      toId: record.evidenceId,
      type,
      confidence: 1,
      classification: "confirmed",
      evidence: [{ signal, value: normalizeText(value), weight: 1 }],
      organizerVersion: ORGANIZER_VERSION,
      createdAt
    };
  }

  function buildExactAssignmentKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const records = evidenceRecords || [];
    const entities = [];
    const relationships = [];
    const entitiesByFolder = new Map();
    const assignmentByContentObject = new Map();

    for (const record of records) {
      if (record.source !== "assignment") continue;
      const folderId = assignmentFolderId(record);
      if (!folderId) continue;
      const columns = record.fields?.columns || {};
      const query = `db=${folderId}&grpid=0&isprv=0&bp=0&ou=${record.courseId}`;
      const entity = {
        entityId: assignmentEntityId(record.courseId, folderId),
        entityType: "assignmentBundle",
        courseId: record.courseId,
        canonicalTitle: record.title || `Assignment ${folderId}`,
        aliases: [],
        status: record.status || "",
        dates: {
          dueAt: record.dates?.dueAt || null,
          availableFrom: record.dates?.availableFrom || null,
          availableUntil: record.dates?.availableUntil || null,
          submittedAt: null,
          gradedAt: null
        },
        summary: record.description || "",
        // "apiEndDate" means D2L has no due date and dueAt holds the close date.
        dueAtSource: normalizeText(columns.dueAtSource),
        pointsPossible: numberOrNull(columns.scoreOutOf),
        category: normalizeText(columns.categoryName),
        submissionType: columns.submissionType === "" ? null : Number(columns.submissionType),
        groupTypeId: normalizeText(columns.groupTypeId),
        attachments: Array.isArray(columns.attachments) ? columns.attachments.map((file) => ({ name: normalizeText(file.name), size: numberOrNull(file.size) })) : [],
        rubricCount: numberOrNull(columns.rubricCount) || 0,
        gradeItemId: normalizeText(columns.gradeItemId),
        gradeEntityId: normalizeText(columns.gradeItemId) ? `grade:${record.courseId}:${normalizeText(columns.gradeItemId)}` : null,
        submissionCount: 0,
        feedbackCount: 0,
        score: null,
        urls: {
          d2l: `${D2L_ORIGIN}/d2l/lms/dropbox/user/folder_submit_files.d2l?${query}`,
          history: `${D2L_ORIGIN}/d2l/lms/dropbox/user/folders_history.d2l?${query}`,
          feedback: `${D2L_ORIGIN}/d2l/lms/dropbox/user/folder_user_view_feedback.d2l?${query}`
        },
        conflicts: [],
        primaryEvidenceId: record.evidenceId,
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      };
      entities.push(entity);
      entitiesByFolder.set(`${record.courseId}:${folderId}`, entity);
      relationships.push(exactRelationship(entity, record, "sameAs", "matchingAssignmentFolderId", folderId, createdAt));
    }

    for (const record of records) {
      const folderId = assignmentFolderId(record);
      const entity = folderId ? entitiesByFolder.get(`${record.courseId}:${folderId}`) : null;
      if (!entity || record.source === "assignment") continue;
      if (record.source === "assignmentSubmission" && !isConcreteAssignmentSubmission(record)) continue;
      const type = ASSIGNMENT_RELATIONSHIP_BY_SOURCE[record.source];
      if (!type) continue;
      const signal = record.platformIds?.associatedAssignmentFolderId
        ? "associatedAssignmentFolderId"
        : record.platformIds?.linkedAssignmentFolderId
          ? "linkedAssignmentFolderId"
          : "matchingAssignmentFolderId";
      relationships.push(exactRelationship(entity, record, type, signal, folderId, createdAt));
      const contentObjectId = normalizeText(record.platformIds?.contentObjectId);
      if (type === "hasInstructions" && contentObjectId) assignmentByContentObject.set(`${record.courseId}:${contentObjectId}`, entity);
    }

    for (const record of records) {
      if (record.source !== "contentAttachment") continue;
      const contentObjectId = normalizeText(record.platformIds?.contentObjectId);
      const entity = assignmentByContentObject.get(`${record.courseId}:${contentObjectId}`);
      if (!entity) continue;
      if (!relationships.some((relationship) => relationship.fromId === entity.entityId && relationship.toId === record.evidenceId)) {
        relationships.push(exactRelationship(entity, record, "hasFile", "matchingContentObjectId", contentObjectId, createdAt));
      }
    }

    const recordsById = new Map(records.map((record) => [record.evidenceId, record]));
    for (const entity of entities) {
      const related = relationships.filter((relationship) => relationship.fromId === entity.entityId).map((relationship) => recordsById.get(relationship.toId)).filter(Boolean);
      const aliases = related.map((record) => record.title).filter((title) => title && title !== entity.canonicalTitle);
      entity.aliases = [...new Set(aliases)];
      const submissions = related.filter(isConcreteAssignmentSubmission);
      const grades = related.filter((record) => record.source === "gradeItem" || record.source === "gradeFeedback");
      if (submissions.length || related.some((record) => record.status === "submitted")) entity.status = "submitted";
      entity.submissionCount = submissions.length;
      const rubric = related.find((record) => record.source === "rubricFeedback") || related.find((record) => record.source === "rubric");
      entity.rubric = rubric ? global.D2LExtractorBackground.rubricSummary(rubric) : null;
      entity.feedbackCount = related.filter((record) => record.source === "assignmentFeedback").length;
      const gradeRecord = related.find((record) => record.source === "gradeItem" && (record.fields?.columns?.isGraded === true || normalizeText(record.fields?.columns?.displayedGrade)));
      if (gradeRecord) {
        const gradeColumns = gradeRecord.fields.columns;
        entity.score = {
          displayed: normalizeText(gradeColumns.displayedGrade),
          pointsEarned: numberOrNull(gradeColumns.pointsEarned),
          pointsPossible: numberOrNull(gradeColumns.pointsPossible)
        };
        entity.status = "graded";
      }
      entity.dates.submittedAt = submissions.map((record) => record.dates?.submittedAt).filter(Boolean).sort().at(-1) || null;
      entity.dates.gradedAt = grades.map((record) => record.dates?.gradedAt).filter(Boolean).sort().at(-1) || null;
      const dueDates = [...new Set(related.map((record) => record.dates?.dueAt).filter(Boolean))];
      if (!entity.dates.dueAt && dueDates.length) entity.dates.dueAt = dueDates[0];
      if (dueDates.some((date) => entity.dates.dueAt && date !== entity.dates.dueAt)) {
        entity.conflicts.push({ type: "dueDate", values: [...new Set([entity.dates.dueAt, ...dueDates])], evidenceIds: related.filter((record) => record.dates?.dueAt).map((record) => record.evidenceId) });
      }
    }

    return { entities, relationships };
  }

  Object.assign(background, { ASSIGNMENT_RELATIONSHIP_BY_SOURCE, assignmentFolderId, assignmentEntityId, relationshipId, isConcreteAssignmentSubmission, buildExactAssignmentKnowledge });
})(globalThis);
