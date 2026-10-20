(function initPeopleAndGapOrganizerModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, normalizedDate, fnv1a, ORGANIZER_VERSION } = shared;

  const EXTRACTION_CAPABILITIES = Object.freeze([
    { id: "assignmentSubmissions", label: "Assignment submissions and feedback", probes: ["assignment my submissions"], emptyWhen: ["assignments"], sources: ["assignmentSubmission", "assignmentFeedback", "submittedFile"] },
    { id: "quizAttempts", label: "Quiz attempts and released results", probes: ["quiz attempts"], sources: ["quizAttempt", "quizAttemptRow", "quizSubmission", "quizSummaryRow", "quizListRow"] },
    { id: "quizQuestions", label: "Quiz questions and question results", probes: ["quiz questions"], sources: ["quizQuestion", "quizQuestionResult"] },
    { id: "grades", label: "Gradebook values", probes: ["grade setup"], sources: ["gradeItem"] },
    { id: "finalGrade", label: "Final grade", probes: ["final grade"], sources: ["finalGrade"] },
    { id: "gradeFeedback", label: "Written grade feedback", probes: [], sources: ["gradeFeedback"] },
    { id: "rubrics", label: "Rubrics and criterion feedback", probes: [], sources: ["rubric", "rubricFeedback", "rubricCriterionFeedback"] },
    { id: "announcements", label: "Announcements", probes: [], sources: ["announcement"] },
    { id: "announcementAttachments", label: "Announcement attachments", probes: [], sources: ["announcementAttachment"], contextSources: ["announcement"] },
    { id: "discussionTopics", label: "Discussion topics", probes: ["discussion topic"], emptyWhen: ["discussion forums"], sources: ["discussionTopic"] },
    { id: "discussionPosts", label: "Discussion posts and replies", probes: ["discussion posts"], emptyWhen: ["discussion forums"], sources: ["discussionPost", "discussionReply"] },
    { id: "checklists", label: "Checklists", probes: ["checklists"], sources: ["checklistItem"] },
    { id: "surveys", label: "Surveys and attempts", probes: ["surveys"], sources: ["survey", "surveyAttempt", "surveyQuestion"] },
    { id: "groups", label: "Groups", probes: ["groups"], sources: ["group"] },
    { id: "classlist", label: "Classlist", probes: ["classlist"], sources: ["classlistEntry"] },
    { id: "progress", label: "Content progress", probes: ["content user progress"], sources: ["progressRecord"] },
    { id: "courseOverview", label: "Course overview and attachment", probes: ["course overview"], sources: ["courseOverview", "courseOverviewAttachment"] },
    { id: "attendance", label: "Attendance", probes: ["attendance"], sources: ["attendanceRecord"] },
    { id: "externalSystems", label: "External course systems", probes: [], sources: ["externalLink"], externalBoundary: true }
  ]);

  function relation(from, toId, signal, value, createdAt) {
    return {
      relationshipId: `${from.entityId}::derivedFrom::${toId}`,
      courseId: from.courseId,
      fromId: from.entityId,
      toId,
      type: "derivedFrom",
      confidence: 1,
      classification: "confirmed",
      evidence: [{ signal, value: normalizeText(value), weight: 1 }],
      organizerVersion: ORGANIZER_VERSION,
      createdAt
    };
  }

  function buildPersonKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const entities = [];
    const relationships = [];
    for (const record of (evidenceRecords || []).filter((item) => item.source === "classlistEntry")) {
      const userId = normalizeText(record.platformIds?.userId);
      if (!userId) continue;
      const columns = record.fields?.columns || {};
      const entity = {
        entityId: `person:${record.courseId}:${userId}`,
        entityType: "person",
        courseId: record.courseId,
        userId,
        displayName: record.title || `User ${userId}`,
        roleId: normalizeText(columns.roleId),
        roleName: normalizeText(columns.roleName),
        presence: record.status || "visible",
        lastAccessedAt: normalizedDate(columns.lastAccessed),
        profileIdentifier: normalizeText(columns.profileIdentifier),
        description: record.description || "",
        urls: { classlist: record.urls?.item || "" },
        primaryEvidenceId: record.evidenceId,
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      };
      entities.push(entity);
      relationships.push(relation(entity, record.evidenceId, "matchingUserId", userId, createdAt));
    }
    return { entities, relationships };
  }

  function buildExternalResourceKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const entities = [];
    const relationships = [];
    for (const record of (evidenceRecords || []).filter((item) => item.source === "externalLink")) {
      const url = normalizeText(record.urls?.item || record.urls?.canonical);
      if (!url) continue;
      const entity = {
        entityId: `external:${record.courseId}:${fnv1a(url)}`,
        entityType: "externalResource",
        courseId: record.courseId,
        canonicalTitle: record.title || url,
        status: record.status || "linkOnly",
        description: record.description || "",
        url,
        linkKind: normalizeText(record.fields?.columns?.linkKind) || "external",
        extractionBoundary: "intentionallyUnsupportedExternalSystem",
        primaryEvidenceId: record.evidenceId,
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      };
      entities.push(entity);
      relationships.push(relation(entity, record.evidenceId, "matchingExternalUrl", url, createdAt));
    }
    return { entities, relationships };
  }

  function capabilityEvidence(records, capability) {
    const sourceSet = new Set([...(capability.sources || []), ...(capability.contextSources || [])]);
    return records.filter((record) => {
      if (sourceSet.has(record.source)) return true;
      if (record.source !== "apiProbe") return false;
      const title = normalizeText(record.title).toLowerCase();
      return capability.probes.some((probe) => title.startsWith(probe));
    });
  }

  function extractionClassification(capability, sourceRecords, probes, contextRecords, parentProbes = []) {
    const statuses = new Set(probes.map((record) => record.status));
    if (capability.externalBoundary && sourceRecords.length) return "intentionallyUnsupportedExternalSystem";
    if (statuses.has("blocked")) return "permissionBlocked";
    if (sourceRecords.length) return "extracted";
    // The parent tool answered with nothing (no assignment folders, no forums), so the course has none of these either.
    if (parentProbes.some((record) => record.status === "availableEmpty")) return "unavailableCourseData";
    if (capability.id === "announcementAttachments" && contextRecords.length) {
      const counts = contextRecords.map((record) => Number(record.fields?.columns?.attachmentCount)).filter(Number.isFinite);
      if (counts.length && counts.every((count) => count === 0)) return "unavailableCourseData";
    }
    if (statuses.has("notEnabledOrHidden") || statuses.has("availableEmpty")) return "unavailableCourseData";
    if (statuses.has("available")) return "extracted";
    return "untestedCapability";
  }

  function classificationReason(classification, sourceCount, probeCount) {
    const reasons = {
      extracted: `D2L exposed ${sourceCount} normalized evidence record(s)${probeCount ? ` across ${probeCount} probe result(s)` : ""}.`,
      permissionBlocked: "At least one authenticated read-only D2L request returned a permission block; any visible evidence remains preserved.",
      unavailableCourseData: "D2L reported the capability as empty, hidden, disabled, or unavailable for this course.",
      untestedCapability: "No conclusive source record or capability-specific probe is present in this archive.",
      intentionallyUnsupportedExternalSystem: "D2L exposed a link, but the linked third-party system is outside the authorized D2L archive boundary."
    };
    return reasons[classification] || "Coverage state is unknown.";
  }

  function buildExtractionStateKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const records = evidenceRecords || [];
    const courseId = normalizeText(records[0]?.courseId);
    if (!courseId) return { entities: [], relationships: [] };
    const entities = [];
    const relationships = [];
    for (const capability of EXTRACTION_CAPABILITIES) {
      const sourceRecords = records.filter((record) => capability.sources.includes(record.source));
      const contextRecords = records.filter((record) => (capability.contextSources || []).includes(record.source));
      const probes = records.filter((record) => record.source === "apiProbe" && capability.probes.some((probe) => normalizeText(record.title).toLowerCase().startsWith(probe)));
      const related = capabilityEvidence(records, capability);
      const parentProbes = records.filter((record) => record.source === "apiProbe" && (capability.emptyWhen || []).some((probe) => normalizeText(record.title).toLowerCase().startsWith(probe)));
      const classification = extractionClassification(capability, sourceRecords, probes, contextRecords, parentProbes);
      const statusCounts = Object.fromEntries([...new Set(probes.map((record) => record.status || "unknown"))]
        .sort().map((status) => [status, probes.filter((record) => (record.status || "unknown") === status).length]));
      const sourceCounts = Object.fromEntries(capability.sources.map((source) => [source, sourceRecords.filter((record) => record.source === source).length]));
      const entity = {
        entityId: `extraction:${courseId}:${capability.id}`,
        entityType: "extractionState",
        courseId,
        capabilityId: capability.id,
        canonicalTitle: capability.label,
        classification,
        isGap: classification !== "extracted",
        coverage: classification === "extracted" ? "covered" : (sourceRecords.length ? "partial" : classification),
        reason: classificationReason(classification, sourceRecords.length, probes.length),
        sourceCounts,
        probeStatusCounts: statusCounts,
        evidenceCount: related.length,
        probeStates: probes.map((record) => ({
          evidenceId: record.evidenceId,
          status: record.status || "unknown",
          title: record.title,
          targetIds: record.platformIds || {},
          evidenceCount: Number(record.fields?.columns?.evidenceCount || 0)
        })),
        primaryEvidenceId: related[0]?.evidenceId || "",
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      };
      entities.push(entity);
      for (const record of related) relationships.push(relation(entity, record.evidenceId, "capabilityEvidence", capability.id, createdAt));
    }
    return { entities, relationships };
  }

  Object.assign(background, {
    EXTRACTION_CAPABILITIES,
    buildPersonKnowledge,
    buildExternalResourceKnowledge,
    buildExtractionStateKnowledge
  });
})(globalThis);
