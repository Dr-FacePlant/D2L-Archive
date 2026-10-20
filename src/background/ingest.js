(function initArchiveIngestModule(global) {
  const background = global.D2LExtractorBackground ||= {};
  const {
    buildExactAssignmentKnowledge,
    buildQuizKnowledge,
    buildGradeKnowledge,
    buildAnnouncementKnowledge,
    buildDiscussionForumKnowledge,
    buildDiscussionThreadKnowledge,
    buildLearningResourceKnowledge,
    buildCalendarKnowledge,
    buildCoursePolicyKnowledge,
    buildStudentProgressKnowledge,
    buildCourseToolKnowledge,
    buildPersonKnowledge,
    buildExternalResourceKnowledge,
    buildExtractionStateKnowledge
  } = background;

  async function allEvidenceForCourse(repository, courseId) {
    const items = [];
    let offset = 0;
    while (true) {
      const page = await repository.listEvidence({ courseId, offset, limit: 500 });
      items.push(...page.items);
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    }
    return items;
  }

  async function ingestAndOrganizeRows(rows, options = {}) {
    const repository = options.repository || await background.activeArchiveRepository();
    const syncRunId = options.syncRunId || `export-${new Date().toISOString().replace(/[^0-9]/g, "")}`;
    const ingest = await repository.ingestRows(rows, {
      syncRunId,
      extractorVersion: options.extractorVersion || chrome.runtime.getManifest().version,
      mode: options.mode || "export",
      startedAt: options.startedAt,
      ingestedAt: options.ingestedAt,
      completeCourseSnapshot: options.completeCourseSnapshot === true,
      categoryFreshness: options.categoryFreshness || {},
      correlationId: options.correlationId || ""
    });
    const courseIds = [...new Set((rows || []).map((row) => String(row.courseOrgUnitId || "")).filter((courseId) => courseId && courseId !== "unknown"))];
    const courseSummaries = [];
    const organizedEvidence = [];
    for (const courseId of courseIds) {
      const evidence = await allEvidenceForCourse(repository, courseId);
      organizedEvidence.push(...evidence);
      const organizers = [
        ["assignmentBundle", buildExactAssignmentKnowledge],
        ["quizBundle", buildQuizKnowledge],
        ["gradeRecord", buildGradeKnowledge],
        ["announcement", buildAnnouncementKnowledge],
        ["discussionForum", buildDiscussionForumKnowledge],
        ["discussionThread", buildDiscussionThreadKnowledge],
        ["learningResource", buildLearningResourceKnowledge],
        ["calendarEvent", buildCalendarKnowledge],
        ["coursePolicy", buildCoursePolicyKnowledge],
        ["studentProgress", buildStudentProgressKnowledge],
        ["courseToolItem", buildCourseToolKnowledge],
        ["person", buildPersonKnowledge],
        ["externalResource", buildExternalResourceKnowledge],
        ["extractionState", buildExtractionStateKnowledge]
      ];
      const organized = { entities: 0, relationships: 0, entityTypes: {} };
      for (const [entityType, build] of organizers) {
        const knowledge = build(evidence, { createdAt: options.ingestedAt });
        const persisted = await repository.replaceCourseKnowledge(courseId, entityType, knowledge);
        organized.entities += persisted.entities;
        organized.relationships += persisted.relationships;
        organized.entityTypes[entityType] = persisted;
      }
      courseSummaries.push({ courseId, evidence: evidence.length, ...organized });
    }
    const courseIdSet = new Set(courseIds);
    const entities = (await repository.listEntities({})).filter((entity) => courseIdSet.has(entity.courseId));
    const entityIds = new Set(entities.map((entity) => entity.entityId));
    const relationships = (await repository.listRelationships({})).filter((relationship) => entityIds.has(relationship.fromId));
    return {
      syncRunId,
      databaseRevision: ingest.databaseRevision,
      ingest: ingest.counts,
      courses: courseSummaries,
      entityCount: entities.length,
      relationshipCount: relationships.length,
      evidence: organizedEvidence,
      entities,
      relationships
    };
  }

  // Re-derives every course's entities from the evidence already stored, for
  // when a newer organizer reads the same evidence differently. D2L is not
  // contacted and no evidence changes.
  async function reorganizeArchiveIfStale(options = {}) {
    const repository = options.repository || await background.activeArchiveRepository();
    const current = global.D2LExtractorShared.ORGANIZER_VERSION;
    const stored = await repository.getMeta("organizerVersion");
    const courses = await repository.listCourses({});
    if (!courses.length || (stored === current && options.force !== true)) return { reorganized: false, organizerVersion: current, courses: 0 };
    const createdAt = options.createdAt || new Date().toISOString();
    const builders = [
      ["assignmentBundle", buildExactAssignmentKnowledge],
      ["quizBundle", buildQuizKnowledge],
      ["gradeRecord", buildGradeKnowledge],
      ["announcement", buildAnnouncementKnowledge],
      ["discussionForum", buildDiscussionForumKnowledge],
      ["discussionThread", buildDiscussionThreadKnowledge],
      ["learningResource", buildLearningResourceKnowledge],
      ["calendarEvent", buildCalendarKnowledge],
      ["coursePolicy", buildCoursePolicyKnowledge],
      ["studentProgress", buildStudentProgressKnowledge],
      ["courseToolItem", buildCourseToolKnowledge],
      ["person", buildPersonKnowledge],
      ["externalResource", buildExternalResourceKnowledge],
      ["extractionState", buildExtractionStateKnowledge]
    ];
    for (const course of courses) {
      const evidence = await allEvidenceForCourse(repository, course.courseId);
      for (const [entityType, build] of builders) {
        await repository.replaceCourseKnowledge(course.courseId, entityType, build(evidence, { createdAt }));
      }
    }
    return { reorganized: true, organizerVersion: current, previousVersion: stored || "", courses: courses.length };
  }

  Object.assign(background, { allEvidenceForCourse, ingestAndOrganizeRows, reorganizeArchiveIfStale });
})(globalThis);
