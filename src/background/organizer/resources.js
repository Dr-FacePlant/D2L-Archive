(function initResourceOrganizerModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, normalizedDate, ORGANIZER_VERSION } = shared;

  function relation(from, toId, type, signal, value, createdAt) {
    return {
      relationshipId: `${from.entityId}::${type}::${toId}`,
      courseId: from.courseId,
      fromId: from.entityId,
      toId,
      type,
      confidence: 1,
      classification: "confirmed",
      evidence: [{ signal, value: normalizeText(value), weight: 1 }],
      organizerVersion: ORGANIZER_VERSION,
      createdAt
    };
  }

  function learningResourceEntityId(courseId, contentObjectId) {
    return `resource:${courseId}:${contentObjectId}`;
  }

  function calendarEventEntityId(courseId, calendarEventId) {
    return `calendar:${courseId}:${calendarEventId}`;
  }

  function calendarTargetEntityId(record) {
    const columns = record.fields?.columns || {};
    const targetId = normalizeText(columns.entityId);
    const type = normalizeText(columns.entityType).toLowerCase();
    if (!targetId) return "";
    if (type.includes("dropbox")) return `assignment:${record.courseId}:${targetId}`;
    if (type.includes("discussion")) return `discussionForum:${record.courseId}:${targetId}`;
    if (type.includes("content")) return learningResourceEntityId(record.courseId, targetId);
    if (type.includes("quiz")) return `quiz:${record.courseId}:${targetId}`;
    return "";
  }

  function buildLearningResourceKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const records = evidenceRecords || [];
    const entities = [];
    const relationships = [];
    const byContentId = new Map();

    for (const record of records.filter((item) => item.source === "contentTopic" || item.source === "contentModule")) {
      const contentObjectId = normalizeText(record.platformIds?.contentObjectId || record.platformIds?.contentModuleId) || record.evidenceId.split(":").at(-1);
      if (!contentObjectId) continue;
      const columns = record.fields?.columns || {};
      const isModule = record.source === "contentModule";
      const entity = {
        entityId: learningResourceEntityId(record.courseId, contentObjectId),
        entityType: "learningResource",
        courseId: record.courseId,
        canonicalTitle: record.title || `Course resource ${contentObjectId}`,
        status: record.status || (record.fields?.columns?.isBroken ? "broken" : "available"),
        resourceType: normalizeText(record.fields?.columns?.topicType || record.type || record.source),
        module: normalizeText(record.fields?.columns?.module),
        description: record.description || "",
        dates: {
          dueAt: record.dates?.dueAt || null,
          availableFrom: record.dates?.availableFrom || null,
          availableUntil: record.dates?.availableUntil || null
        },
        urls: {
          item: record.urls?.item || "",
          download: record.urls?.download || "",
          d2l: record.urls?.item || "",
          // A Link topic's real destination outside D2L.
          external: /^link$/i.test(columns.topicType || "") ? normalizeText(columns.resolvedTarget || record.urls?.download) : ""
        },
        isModule,
        order: Number.isFinite(Number(columns.tocOrder)) ? Number(columns.tocOrder) : null,
        moduleId: isModule ? contentObjectId : normalizeText(columns.moduleId),
        moduleTitle: isModule ? record.title : normalizeText(columns.moduleTitle),
        parentModuleId: normalizeText(columns.parentModuleId),
        moduleStartsAt: isModule ? normalizedDate(columns.startDate) : normalizedDate(columns.moduleStartDate),
        completionType: normalizeText(columns.completionType),
        isExempt: columns.isExempt === true,
        localFilePath: record.local?.filePath || "",
        attachmentCount: 0,
        progress: null,
        primaryEvidenceId: record.evidenceId,
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      };
      entities.push(entity);
      byContentId.set(`${record.courseId}:${contentObjectId}`, entity);
      relationships.push(relation(entity, record.evidenceId, "sameAs", "matchingContentObjectId", contentObjectId, createdAt));
    }

    for (const record of records) {
      const contentObjectId = normalizeText(record.platformIds?.contentObjectId);
      const entity = byContentId.get(`${record.courseId}:${contentObjectId}`);
      if (!entity) continue;
      if (record.source === "contentAttachment") {
        relationships.push(relation(entity, record.evidenceId, "hasAttachment", "matchingContentObjectId", contentObjectId, createdAt));
        entity.attachmentCount += 1;
      } else if (record.source === "progressRecord") {
        relationships.push(relation(entity, record.evidenceId, "hasProgress", "matchingContentObjectId", contentObjectId, createdAt));
        const columns = record.fields?.columns || {};
        entity.progress = {
          status: record.status || "",
          completionType: normalizeText(columns.completionType),
          completedAt: normalizedDate(columns.completionDate),
          visits: Number.isFinite(Number(columns.visits)) ? Number(columns.visits) : null,
          totalTime: Number.isFinite(Number(columns.totalTime)) ? Number(columns.totalTime) : null,
          lastVisitedAt: normalizedDate(columns.lastVisited)
        };
      }
    }
    return { entities, relationships };
  }

  function buildCalendarKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const entities = [];
    const relationships = [];
    const byEventId = new Map();
    for (const record of (evidenceRecords || []).filter((item) => item.source === "calendarEvent")) {
      const eventId = normalizeText(record.platformIds?.calendarEventId);
      if (!eventId) continue;
      const columns = record.fields?.columns || {};
      const targetEntityId = calendarTargetEntityId(record);
      const entity = {
        entityId: calendarEventEntityId(record.courseId, eventId),
        entityType: "calendarEvent",
        courseId: record.courseId,
        canonicalTitle: record.title || `Calendar event ${eventId}`,
        status: record.status || "scheduled",
        description: record.description || "",
        dates: {
          startAt: normalizedDate(columns.startDateTime) || record.dates?.dueAt || null,
          endAt: normalizedDate(columns.endDateTime) || null,
          dueAt: record.dates?.dueAt || normalizedDate(columns.endDateTime || columns.startDateTime)
        },
        targetEntityId: targetEntityId || null,
        sourceEntityType: normalizeText(columns.entityType),
        // D2L lists events as "<title> - Due", "- Available", "- Availability Ends".
        eventLabel: normalizeText(columns.eventLabel),
        courseCode: normalizeText(columns.orgUnitCode),
        urls: {
          d2l: normalizeText(columns.viewUrl) || record.urls?.item || "",
          item: record.urls?.item || ""
        },
        attachmentCount: 0,
        primaryEvidenceId: record.evidenceId,
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      };
      entities.push(entity);
      byEventId.set(`${record.courseId}:${eventId}`, entity);
      relationships.push(relation(entity, record.evidenceId, "sameAs", "matchingCalendarEventId", eventId, createdAt));
      if (targetEntityId) relationships.push(relation(entity, targetEntityId, "references", "calendarEntityId", columns.entityId, createdAt));
    }
    for (const record of (evidenceRecords || []).filter((item) => item.source === "calendarAttachment")) {
      const eventId = normalizeText(record.platformIds?.calendarEventId);
      const entity = byEventId.get(`${record.courseId}:${eventId}`);
      if (!entity) continue;
      relationships.push(relation(entity, record.evidenceId, "hasAttachment", "matchingCalendarEventId", eventId, createdAt));
      entity.attachmentCount += 1;
    }
    return { entities, relationships };
  }

  function buildCoursePolicyKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const entities = [];
    const relationships = [];
    for (const record of (evidenceRecords || []).filter((item) => ["syllabusPolicy", "courseOverview"].includes(item.source))) {
      const sourceId = normalizeText(record.platformIds?.contentObjectId || record.platformIds?.newsItemId) || record.evidenceId.split(":").at(-1);
      const entity = {
        entityId: `policy:${record.courseId}:${record.source}:${sourceId}`,
        entityType: "coursePolicy",
        courseId: record.courseId,
        canonicalTitle: record.title || "Course policy",
        status: record.status || "available",
        body: record.description || "",
        policyType: record.source,
        dates: { availableFrom: record.dates?.availableFrom || null, availableUntil: record.dates?.availableUntil || null },
        primaryEvidenceId: record.evidenceId,
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      };
      entities.push(entity);
      relationships.push(relation(entity, record.evidenceId, "sameAs", "matchingPolicySourceId", sourceId, createdAt));
      const newsItemId = normalizeText(record.platformIds?.newsItemId);
      if (newsItemId) relationships.push(relation(entity, `announcement:${record.courseId}:${newsItemId}`, "derivedFrom", "matchingNewsItemId", newsItemId, createdAt));
    }
    return { entities, relationships };
  }

  function buildStudentProgressKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const entities = [];
    const relationships = [];
    for (const record of (evidenceRecords || []).filter((item) => item.source === "progressRecord")) {
      const contentObjectId = normalizeText(record.platformIds?.contentObjectId);
      const userId = normalizeText(record.platformIds?.userId) || "self";
      if (!contentObjectId) continue;
      const columns = record.fields?.columns || {};
      const entity = {
        entityId: `progress:${record.courseId}:${userId}:${contentObjectId}`,
        entityType: "studentProgress",
        courseId: record.courseId,
        contentObjectId,
        status: record.status || "unknown",
        completionType: normalizeText(columns.completionType),
        completedAt: normalizedDate(columns.completionDate),
        visits: Number.isFinite(Number(columns.visits)) ? Number(columns.visits) : null,
        totalTime: Number.isFinite(Number(columns.totalTime)) ? Number(columns.totalTime) : null,
        lastVisitedAt: normalizedDate(columns.lastVisited),
        primaryEvidenceId: record.evidenceId,
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      };
      entities.push(entity);
      relationships.push(relation(entity, record.evidenceId, "sameAs", "matchingContentObjectIdAndUserId", `${contentObjectId}:${userId}`, createdAt));
      relationships.push(relation(entity, learningResourceEntityId(record.courseId, contentObjectId), "progressFor", "matchingContentObjectId", contentObjectId, createdAt));
    }
    const completion = completionKnowledge(evidenceRecords, createdAt);
    entities.push(...completion.entities);
    relationships.push(...completion.relationships);
    return { entities, relationships };
  }

  // D2L's own completion counts ("26 of 70"), one per course and per module.
  function completionKnowledge(evidenceRecords, createdAt) {
    const entities = [];
    const relationships = [];
    for (const record of (evidenceRecords || []).filter((item) => item.source === "contentCompletion")) {
      const columns = record.fields?.columns || {};
      const scope = normalizeText(record.platformIds?.completionScope) || "course";
      const completed = Number(columns.completedItems);
      const required = Number(columns.requiredItems);
      const entity = {
        entityId: `progress:${record.courseId}:completion:${scope}`,
        entityType: "studentProgress",
        courseId: record.courseId,
        progressKind: scope === "course" ? "courseCompletion" : "moduleCompletion",
        contentObjectId: scope.startsWith("module:") ? scope.slice("module:".length) : "",
        title: record.title || "",
        status: "tracked",
        completedItems: Number.isFinite(completed) ? completed : null,
        requiredItems: Number.isFinite(required) ? required : null,
        urls: { d2l: record.urls?.item || "" },
        primaryEvidenceId: record.evidenceId,
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      };
      entities.push(entity);
      relationships.push(relation(entity, record.evidenceId, "sameAs", "matchingCompletionScope", scope, createdAt));
    }
    return { entities, relationships };
  }

  function buildCourseToolKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const sources = new Set(["checklistItem", "survey", "surveyAttempt", "surveyQuestion", "group", "courseToolPage"]);
    const entities = [];
    const relationships = [];
    for (const record of (evidenceRecords || []).filter((item) => sources.has(item.source))) {
      const suffix = record.evidenceId.replace(`${record.courseId}:${record.source}:`, "");
      const entity = {
        entityId: `tool:${record.courseId}:${record.source}:${suffix}`,
        entityType: "courseToolItem",
        courseId: record.courseId,
        toolType: record.source,
        canonicalTitle: record.title || record.source,
        status: record.status || "unknown",
        description: record.description || "",
        dates: { dueAt: record.dates?.dueAt || null, availableFrom: record.dates?.availableFrom || null, availableUntil: record.dates?.availableUntil || null },
        category: normalizeText(record.fields?.columns?.checklistTitle || record.fields?.columns?.categoryName),
        // The checklist's own page, as D2L's calendar links it.
        urls: { d2l: record.platformIds?.checklistId ? `https://kennesaw.view.usg.edu/d2l/lms/checklist/viewchecklist.d2l?ou=${record.courseId}&checklistId=${record.platformIds.checklistId}` : record.urls?.item || "" },
        primaryEvidenceId: record.evidenceId,
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      };
      entities.push(entity);
      relationships.push(relation(entity, record.evidenceId, "sameAs", "matchingToolEvidenceId", record.evidenceId, createdAt));
    }
    return { entities, relationships };
  }

  Object.assign(background, {
    learningResourceEntityId,
    calendarEventEntityId,
    calendarTargetEntityId,
    buildLearningResourceKnowledge,
    buildCalendarKnowledge,
    buildCoursePolicyKnowledge,
    buildStudentProgressKnowledge,
    buildCourseToolKnowledge
  });
})(globalThis);
