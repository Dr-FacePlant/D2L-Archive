(function initCourseFilesModule(global) {
  const background = global.D2LExtractorBackground ||= {};

function entityDueAt(entity) {
  return entity?.dates?.dueAt || entity?.dates?.availableUntil || null;
}

function courseKnowledgeSummaryMarkdown(courseTitle, courseId, entities, upcoming) {
  const counts = Object.fromEntries([...new Set(entities.map((entity) => entity.entityType))]
    .sort()
    .map((type) => [type, entities.filter((entity) => entity.entityType === type).length]));
  return [
    `# ${courseTitle}`,
    "",
    `- Course ID: ${courseId}`,
    `- Semantic entities: ${entities.length}`,
    `- Entity types: ${JSON.stringify(counts)}`,
    "",
    "## Upcoming",
    "",
    ...(upcoming.length
      ? upcoming.slice(0, 30).map((entity) => `- ${entity.dueAt} - ${entity.canonicalTitle || entity.entityId} (${entity.entityType})`)
      : ["- No dated upcoming entities in this archive."]),
    "",
    "## Query Files",
    "",
    "- `knowledge-index.json` contains normalized entities and relationships.",
    "- `upcoming-work.json` contains dated semantic work without linked calendar duplicates.",
    "- `grades.json` contains normalized grade records.",
    "- `people.json` contains normalized classlist people.",
    "- `external-resources.json` contains D2L links to third-party course systems.",
    "- `extraction-gaps.json` explains covered, absent, blocked, untested, and external-boundary capabilities.",
    "- `items.json` and `ai-index.ndjson` retain the original flat extraction rows."
  ].join("\n");
}

// The one definition of a course's knowledge-index.json and course-summary.md,
// shared by the export path. `entities` and `relationships`
// may span several courses; only this course's are kept.
function buildCourseKnowledgeFiles({ courseId, courseTitle, entities, relationships, organizerVersion = entities[0]?.organizerVersion || "", now = Date.now() }) {
  const courseEntities = entities.filter((entity) => entity.courseId === courseId);
  const entityIds = new Set(courseEntities.map((entity) => entity.entityId));
  const courseRelationships = relationships.filter((relationship) => entityIds.has(relationship.fromId));
  const upcoming = courseEntities
    .map((entity) => ({ ...entity, dueAt: entityDueAt(entity) }))
    .filter((entity) => {
      const due = Date.parse(entity.dueAt || "");
      return !(entity.entityType === "calendarEvent" && entity.targetEntityId) && Number.isFinite(due) && due >= now;
    })
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  return {
    courseEntities,
    upcoming,
    knowledgeIndexJson: JSON.stringify({
      courseOrgUnitId: courseId,
      courseTitle,
      organizerVersion,
      entities: courseEntities,
      relationships: courseRelationships
    }, null, 2),
    courseSummaryMarkdown: courseKnowledgeSummaryMarkdown(courseTitle, courseId, courseEntities, upcoming)
  };
}

// Builds the same files straight from an account archive, reading it the way an
// export does after ingest. Nothing is crawled, downloaded, or written.
async function buildArchiveCourseFiles(repository, { courseIds = null, now = Date.now() } = {}) {
  const courses = (await repository.listCourses({ active: true }))
    .filter((course) => !courseIds || courseIds.includes(String(course.courseId)));
  const courseIdSet = new Set(courses.map((course) => String(course.courseId)));
  const entities = (await repository.listEntities({})).filter((entity) => courseIdSet.has(entity.courseId));
  const relationships = await repository.listRelationships({});
  return courses.map((course) => {
    const courseId = String(course.courseId);
    const courseTitle = course.title || courseId;
    const { knowledgeIndexJson, courseSummaryMarkdown, courseEntities } = buildCourseKnowledgeFiles({ courseId, courseTitle, entities, relationships, now });
    return { courseId, courseTitle, entityCount: courseEntities.length, knowledgeIndexJson, courseSummaryMarkdown };
  });
}

  Object.assign(background, { entityDueAt, courseKnowledgeSummaryMarkdown, buildCourseKnowledgeFiles, buildArchiveCourseFiles });
})(globalThis);
