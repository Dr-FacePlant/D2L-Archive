(function initCommunicationOrganizerModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { createOrganizerMeta } = background;
  const { normalizeText, normalizedDate, ORGANIZER_VERSION } = shared;

  const relation = background.createOrganizerRelation;

  const D2L_ORIGIN = "https://kennesaw.view.usg.edu";

  function announcementEntityId(courseId, newsItemId) {
    return `announcement:${courseId}:${newsItemId}`;
  }

  function discussionForumEntityId(courseId, forumId) {
    return `discussionForum:${courseId}:${forumId}`;
  }

  function discussionThreadEntityId(courseId, topicId) {
    return `discussionThread:${courseId}:${topicId}`;
  }

  function createAnnouncementEntity(record, newsItemId, createdAt) {
    return {
      entityId: announcementEntityId(record.courseId, newsItemId),
      entityType: "announcement",
      courseId: record.courseId,
      canonicalTitle: record.title || `Announcement ${newsItemId}`,
      aliases: [],
      status: record.status || "visible",
      body: "",
      author: "",
      dates: { publishedAt: null, availableFrom: null, availableUntil: null, modifiedAt: null },
      attachmentCount: 0,
      isPinned: false,
      urls: { d2l: `${D2L_ORIGIN}/d2l/le/news/${record.courseId}/${newsItemId}/view?ou=${record.courseId}` },
      primaryEvidenceId: record.evidenceId,
      organizerVersion: ORGANIZER_VERSION,
      createdAt,
      updatedAt: createdAt
    };
  }

  function mergeAnnouncementRecord(entity, record, newsItemId, createdAt, relationships) {
    const fromApi = record.provenance?.pageType === "valenceApi";
    if ((fromApi && record.description) || (!entity.bodyFromApi && (record.description || "").length > entity.body.length)) {
      entity.body = record.description || "";
      entity.primaryEvidenceId = record.evidenceId;
      entity.bodyFromApi = fromApi;
    }
    if (record.status) entity.status = record.status;
    const columns = record.fields?.columns || {};
    entity.author ||= normalizeText(columns.author || columns.createdBy || columns.postedBy);
    entity.dates.publishedAt ||= normalizedDate(columns.publishedDate || columns.postedAtText || columns.startDate);
    entity.dates.availableFrom ||= record.dates?.availableFrom || null;
    entity.dates.availableUntil ||= record.dates?.availableUntil || null;
    entity.dates.modifiedAt ||= normalizedDate(columns.lastModified);
    entity.isPinned ||= columns.isPinned === true;
    relationships.push(relation(entity, record.evidenceId, "sameAs", "matchingNewsItemId", newsItemId, createdAt));
  }

  function linkAnnouncementAttachmentsAndAliases(records, entities, byNewsId, relationships) {
    for (const record of records.filter((item) => item.source === "announcementAttachment")) {
      const newsItemId = normalizeText(record.platformIds?.newsItemId);
      const entity = byNewsId.get(`${record.courseId}:${newsItemId}`);
      if (!entity) continue;
      relationships.push(relation(entity, record.evidenceId, "hasAttachment", "matchingNewsItemId", newsItemId, entity.createdAt));
      entity.attachmentCount += 1;
    }

    const recordsById = new Map(records.map((r) => [r.evidenceId, r]));
    for (const entity of entities) {
      entity.aliases = [...new Set(relationships
        .filter((item) => item.fromId === entity.entityId)
        .map((item) => recordsById.get(item.toId)?.title)
        .filter((title) => title && title !== entity.canonicalTitle))];
    }
  }

  function buildAnnouncementKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const records = evidenceRecords || [];
    const entities = [];
    const relationships = [];
    const byNewsId = new Map();

    for (const record of records.filter((item) => item.source === "announcement")) {
      const newsItemId = normalizeText(record.platformIds?.newsItemId);
      if (!newsItemId) continue;
      const key = `${record.courseId}:${newsItemId}`;
      let entity = byNewsId.get(key);
      if (!entity) {
        entity = createAnnouncementEntity(record, newsItemId, createdAt);
        entities.push(entity);
        byNewsId.set(key, entity);
      }
      mergeAnnouncementRecord(entity, record, newsItemId, createdAt, relationships);
    }

    linkAnnouncementAttachmentsAndAliases(records, entities, byNewsId, relationships);
    return { entities, relationships };
  }

  function buildDiscussionForums(records, createdAt) {
    const entities = [];
    const relationships = [];
    const forums = new Map();
    for (const record of records.filter((item) => item.source === "discussionForum")) {
      const forumId = normalizeText(record.platformIds?.discussionForumId);
      if (!forumId) continue;
      const entity = {
        entityId: discussionForumEntityId(record.courseId, forumId),
        entityType: "discussionForum",
        courseId: record.courseId,
        canonicalTitle: record.title || `Discussion forum ${forumId}`,
        status: record.status || "unknown",
        description: record.description || "",
        dates: { availableFrom: record.dates?.availableFrom || null, availableUntil: record.dates?.availableUntil || null },
        access: { topics: "unknown" },
        primaryEvidenceId: record.evidenceId,
        organizerVersion: ORGANIZER_VERSION,
        createdAt,
        updatedAt: createdAt
      };
      entities.push(entity);
      forums.set(`${record.courseId}:${forumId}`, entity);
      relationships.push(relation(entity, record.evidenceId, "sameAs", "matchingDiscussionForumId", forumId, createdAt));
    }
    return { entities, relationships, forums };
  }

  function createTopicEntity(record, topicId, createdAt) {
    return {
      entityId: discussionThreadEntityId(record.courseId, topicId),
      entityType: "discussionThread",
      courseId: record.courseId,
      forumId: normalizeText(record.platformIds?.discussionForumId),
      canonicalTitle: record.title || `Discussion topic ${topicId}`,
      aliases: [],
      status: record.status || "unknown",
      gate: record.gate || "",
      topicType: normalizeText(record.fields?.columns?.topicType),
      groupTypeId: normalizeText(record.fields?.columns?.groupTypeId),
      prompt: "",
      dates: { availableFrom: record.dates?.availableFrom || null, availableUntil: record.dates?.availableUntil || null },
      forumTitle: normalizeText(record.fields?.columns?.forumTitle),
      posts: { count: 0, replies: 0, threads: 0, mine: 0, mineThreads: 0, mineReplies: 0, lastPostAt: null },
      grading: { pointsPossible: null, pointsEarned: null, percent: null, feedback: "" },
      gradeEntityId: null,
      access: { posts: "unknown" },
      hasUnread: record.fields?.columns?.hasUnread === true,
      recoveredFrom: normalizeText(record.fields?.columns?.recoveredFrom) || "discussionTopicsApi",
      urls: { d2l: record.urls?.item || `${D2L_ORIGIN}/d2l/le/${record.courseId}/discussions/topics/${topicId}/View` },
      attachmentCount: 0,
      ...createOrganizerMeta(record, createdAt)
    };
  }

  function buildDiscussionTopics(records, createdAt) {
    const entities = [];
    const relationships = [];
    const threads = new Map();
    for (const record of records.filter((item) => item.source === "discussionTopic")) {
      const topicId = normalizeText(record.platformIds?.discussionTopicId);
      if (!topicId) continue;
      const key = `${record.courseId}:${topicId}`;
      let entity = threads.get(key);
      if (!entity) {
        entity = createTopicEntity(record, topicId, createdAt);
        entities.push(entity);
        threads.set(key, entity);
      }
      if ((record.description || "").length > entity.prompt.length) entity.prompt = record.description || "";
      entity.status = record.status || entity.status;
      entity.gate = record.gate || entity.gate;
      const columns = record.fields?.columns || {};
      entity.topicType ||= normalizeText(columns.topicType);
      entity.groupTypeId ||= normalizeText(columns.groupTypeId);
      entity.grading.pointsPossible ??= Number.isFinite(Number(columns.scoreOutOf)) ? Number(columns.scoreOutOf) : null;
      relationships.push(relation(entity, record.evidenceId, "sameAs", "matchingDiscussionTopicId", topicId, createdAt));
    }
    return { entities, relationships, threads };
  }

  function linkThreadsToForums(threads, forums, relationships, createdAt) {
    for (const entity of threads.values()) {
      let forum = forums.get(`${entity.courseId}:${entity.forumId}`);
      if (!forum && entity.forumTitle) {
        forum = [...forums.values()].find((candidate) => candidate.courseId === entity.courseId && normalizeText(candidate.canonicalTitle) === entity.forumTitle) || null;
        if (forum) entity.forumId = forum.entityId.split(":").at(-1);
      }
      if (forum) {
        entity.forumTitle ||= forum.canonicalTitle;
        entity.forumDescription = forum.description || "";
        relationships.push(relation(entity, forum.entityId, "belongsToForum", entity.forumId ? "matchingDiscussionForumId" : "matchingForumHeading", entity.forumId || entity.forumTitle, createdAt));
      }
    }
  }

  function postTopicKey(record) {
    const topicId = normalizeText(record.platformIds?.discussionTopicId);
    return `${record.courseId}:${topicId.match(/^(\\d+):(\\d+)$/)?.[2] || topicId}`;
  }

  function collectMyThreadStarts(records) {
    const myThreadStarts = new Set();
    for (const record of records) {
      const columns = record.source === "discussionPost" ? record.fields?.columns || {} : null;
      if (columns && !normalizeText(columns.parentPostId) && columns.isMine === true) myThreadStarts.add(`${postTopicKey(record)}:${normalizeText(columns.threadId)}`);
    }
    return myThreadStarts;
  }

  function applyPostRecord(thread, record, resolvedTopicId, myThreadStarts, relationships, createdAt) {
    relationships.push(relation(thread, record.evidenceId, "hasPost", "matchingDiscussionTopicId", resolvedTopicId, createdAt));
    const postColumns = record.fields?.columns || {};
    thread.posts.count += 1;
    if (normalizeText(postColumns.parentPostId)) thread.posts.replies += 1;
    else thread.posts.threads += 1;
    if (postColumns.isMine === true) {
      thread.posts.mine += 1;
      if (!normalizeText(postColumns.parentPostId)) thread.posts.mineThreads += 1;
      else if (!myThreadStarts.has(`${postTopicKey(record)}:${normalizeText(postColumns.threadId)}`)) thread.posts.mineReplies += 1;
    }
    const postedAt = normalizedDate(postColumns.createdDate);
    if (postedAt && (!thread.posts.lastPostAt || postedAt > thread.posts.lastPostAt)) thread.posts.lastPostAt = postedAt;
    thread.access.posts = "available";
  }

  function applyGradeRecord(record, threads, relationships, createdAt) {
    const assocTopic = normalizeText(record.platformIds?.associatedDiscussionTopicId);
    const graded = assocTopic && threads.get(`${record.courseId}:${assocTopic}`);
    if (!graded) return;
    const gradeObjectId = normalizeText(record.platformIds?.gradeObjectId);
    relationships.push(relation(graded, record.evidenceId, "hasGrade", "matchingAssociatedToolItemId", gradeObjectId, createdAt));
    graded.gradeEntityId = `grade:${record.courseId}:${gradeObjectId}`;
    const columns = record.fields?.columns || {};
    if (columns.isGraded === true) {
      graded.grading.pointsEarned = Number.isFinite(Number(columns.pointsEarned)) && columns.pointsEarned !== "" ? Number(columns.pointsEarned) : graded.grading.pointsEarned;
      graded.grading.pointsPossible = Number.isFinite(Number(columns.pointsPossible)) && columns.pointsPossible !== "" ? Number(columns.pointsPossible) : graded.grading.pointsPossible;
      graded.grading.displayed = normalizeText(columns.displayedGrade);
    }
  }

  function applyFeedbackOrProbe(record, thread, forum, resolvedTopicId, topicId, relationships, createdAt) {
    if (thread && record.source === "discussionFeedback") {
      relationships.push(relation(thread, record.evidenceId, "hasFeedback", "matchingDiscussionTopicId", resolvedTopicId, createdAt));
      const columns = record.fields?.columns || {};
      thread.grading.pointsEarned = Number.isFinite(Number(columns.pointsEarned)) ? Number(columns.pointsEarned) : null;
      thread.grading.pointsPossible = Number.isFinite(Number(columns.pointsPossible)) ? Number(columns.pointsPossible) : thread.grading.pointsPossible;
      thread.grading.percent = Number.isFinite(Number(columns.percent)) ? Number(columns.percent) : null;
      thread.grading.feedback = record.description || "";
    } else if (record.source === "apiProbe" && /^discussion\\b/i.test(record.type || record.title || "")) {
      if (thread) {
        relationships.push(relation(thread, record.evidenceId, "hasAccessProbe", "matchingDiscussionTopicId", resolvedTopicId, createdAt));
        if (/post/i.test(record.type || record.title || "")) thread.access.posts = record.status === "blocked" ? "blocked" : record.status || "available";
      } else if (forum) {
        relationships.push(relation(forum, record.evidenceId, "hasAccessProbe", "matchingDiscussionForumId", topicId, createdAt));
        forum.access.topics = record.status === "blocked" ? "blocked" : record.status || "available";
      }
    }
  }

  function attachDiscussionRecords(records, threads, forums, relationships, createdAt) {
    const myThreadStarts = collectMyThreadStarts(records);
    for (const record of records) {
      const topicId = normalizeText(record.platformIds?.discussionTopicId);
      const resolvedTopicId = topicId.match(/^(\\d+):(\\d+)$/)?.[2] || topicId;
      const thread = threads.get(`${record.courseId}:${resolvedTopicId}`);
      if (thread && record.source === "discussionPost") {
        applyPostRecord(thread, record, resolvedTopicId, myThreadStarts, relationships, createdAt);
      } else if (thread && (record.source === "rubricFeedback" || record.source === "rubric")) {
        relationships.push(relation(thread, record.evidenceId, "hasRubric", "matchingDiscussionTopicId", resolvedTopicId, createdAt));
        if (!thread.rubric || record.source === "rubricFeedback") thread.rubric = global.D2LExtractorBackground.rubricSummary(record);
      } else if (thread && record.source === "discussionAttachment") {
        relationships.push(relation(thread, record.evidenceId, "hasAttachment", "matchingDiscussionTopicId", resolvedTopicId, createdAt));
        thread.attachmentCount += 1;
      } else if (record.source === "gradeItem") {
        applyGradeRecord(record, threads, relationships, createdAt);
      } else {
        const forum = forums.get(`${record.courseId}:${topicId}`);
        applyFeedbackOrProbe(record, thread, forum, resolvedTopicId, topicId, relationships, createdAt);
      }
    }
  }

  function buildDiscussionKnowledge(evidenceRecords, options = {}) {
    const createdAt = options.createdAt || new Date().toISOString();
    const records = evidenceRecords || [];
    const { entities: forumEntities, relationships: forumRels, forums } = buildDiscussionForums(records, createdAt);
    const { entities: topicEntities, relationships: topicRels, threads } = buildDiscussionTopics(records, createdAt);
    const entities = [...forumEntities, ...topicEntities];
    const relationships = [...forumRels, ...topicRels];
    linkThreadsToForums(threads, forums, relationships, createdAt);
    attachDiscussionRecords(records, threads, forums, relationships, createdAt);
    return { entities, relationships };
  }

  function discussionKnowledgeByType(evidenceRecords, entityType, options = {}) {
    const knowledge = buildDiscussionKnowledge(evidenceRecords, options);
    const entityIds = new Set(knowledge.entities.filter((entity) => entity.entityType === entityType).map((entity) => entity.entityId));
    return {
      entities: knowledge.entities.filter((entity) => entityIds.has(entity.entityId)),
      relationships: knowledge.relationships.filter((item) => entityIds.has(item.fromId))
    };
  }

  function buildDiscussionForumKnowledge(evidenceRecords, options = {}) {
    return discussionKnowledgeByType(evidenceRecords, "discussionForum", options);
  }

  function buildDiscussionThreadKnowledge(evidenceRecords, options = {}) {
    return discussionKnowledgeByType(evidenceRecords, "discussionThread", options);
  }

  Object.assign(background, {
    announcementEntityId,
    discussionForumEntityId,
    discussionThreadEntityId,
    buildAnnouncementKnowledge,
    buildDiscussionKnowledge,
    buildDiscussionForumKnowledge,
    buildDiscussionThreadKnowledge
  });
})(globalThis);
