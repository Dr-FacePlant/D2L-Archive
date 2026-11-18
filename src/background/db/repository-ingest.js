(function initArchiveRepositoryIngestModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, normalizedDate, normalizeEvidenceRow, APP_DB_VERSION, ORGANIZER_VERSION } = shared;

  function inferSemester(title) {
    return normalizeText(title).match(/(?:Spring|Summer|Fall|Winter) Semester \d{4}/i)?.[0] || "";
  }

  function courseFromEvidence(record, now) {
    return {
      courseId: record.courseId,
      title: record.courseTitle || record.courseId,
      code: normalizeText(record.fields?.columns?.courseCode),
      semester: inferSemester(record.courseTitle),
      active: true,
      firstSeenAt: now,
      lastSeenAt: now,
      sourceRecordIds: []
    };
  }

  async function updateCourseFromRecord(stores, record, ingestedAt) {
    const existingCourse = await stores.courses.get(record.courseId);
    const course = existingCourse || courseFromEvidence(record, ingestedAt);
    course.title = record.courseTitle || course.title;
    course.semester ||= inferSemester(course.title);
    if (record.source === "courseOffering") {
      const columns = record.fields?.columns || {};
      course.code = normalizeText(columns.courseCode) || course.code || "";
      course.startsAt = normalizedDate(columns.startDate) || course.startsAt || null;
      course.endsAt = normalizedDate(columns.endDate) || course.endsAt || null;
    }
    course.lastSeenAt = ingestedAt;
    course.sourceRecordIds = [...new Set([...(course.sourceRecordIds || []), record.evidenceId])];
    await stores.courses.put(course);
  }

  async function recordEvidenceChange(stores, existing, record, syncRunId, ingestedAt) {
    const changeType = existing ? (existing.contentHash === record.contentHash ? "unchanged" : "updated") : "added";
    if (changeType !== "unchanged") {
      await stores.changes.put({
        changeId: `${syncRunId}:${record.evidenceId}:${changeType}`,
        syncRunId, courseId: record.courseId, evidenceId: record.evidenceId,
        type: changeType, recordedAt: ingestedAt
      });
    }
  }

  async function ingestSingleEvidence(stores, record, syncRunId, ingestedAt, counts, touchedCourses) {
    const existing = await stores.evidence.get(record.evidenceId);
    if (!existing) {
      counts.added += 1;
    } else if (existing.contentHash === record.contentHash) {
      counts.unchanged += 1;
      record.revision = existing.revision;
      record.firstSeenAt = existing.firstSeenAt;
    } else {
      counts.updated += 1;
      await stores.evidenceRevisions.put(existing);
      record.revision = Number(existing.revision || 1) + 1;
      record.firstSeenAt = existing.firstSeenAt;
    }
    record.lastSeenAt = ingestedAt;
    await stores.evidence.put(record);
    touchedCourses.add(record.courseId);
    await recordEvidenceChange(stores, existing, record, syncRunId, ingestedAt);
    await updateCourseFromRecord(stores, record, ingestedAt);
  }

  async function purgeMissingSnapshotEvidence(stores, syncRunId, ingestedAt, touchedCourses, incomingEvidenceIds, counts, evidenceRecords) {
    for (const existing of await stores.evidence.getAll()) {
      if (!touchedCourses.has(existing.courseId) || incomingEvidenceIds.has(existing.evidenceId)) continue;
      await stores.evidenceRevisions.put(existing);
      await stores.evidence.delete(existing.evidenceId);
      await stores.changes.put({
        changeId: `${syncRunId}:${existing.evidenceId}:removed`,
        syncRunId, courseId: existing.courseId, evidenceId: existing.evidenceId,
        type: "removed", recordedAt: ingestedAt
      });
      counts.removed += 1;
    }
    for (const courseId of touchedCourses) {
      const course = await stores.courses.get(courseId);
      if (!course) continue;
      course.sourceRecordIds = evidenceRecords.filter((record) => record.courseId === courseId).map((r) => r.evidenceId);
      await stores.courses.put(course);
    }
  }

  async function ingestRows(adapter, now, rows, ingestOptions = {}) {
    const ingestedAt = ingestOptions.ingestedAt || now();
    const syncRunId = normalizeText(ingestOptions.syncRunId) || `run-${ingestedAt.replace(/[^0-9]/g, "")}`;
    const normalizedRecords = (rows || []).map((row) => normalizeEvidenceRow(row, {
      extractorVersion: ingestOptions.extractorVersion || "", syncRunId, extractedAt: ingestedAt
    }));
    const evidenceRecords = [...new Map(normalizedRecords.map((record) => [record.evidenceId, record])).values()];

    return adapter.runTransaction(["courses", "evidence", "evidenceRevisions", "syncRuns", "changes", "meta"], "readwrite", async (stores) => {
      const revisionMeta = await stores.meta.get("databaseRevision");
      const databaseRevision = Number(revisionMeta?.value || 0) + 1;
      const counts = { added: 0, updated: 0, unchanged: 0, removed: 0, courses: 0 };
      const touchedCourses = new Set();
      const incomingEvidenceIds = new Set(evidenceRecords.map((r) => r.evidenceId));

      for (const record of evidenceRecords) {
        await ingestSingleEvidence(stores, record, syncRunId, ingestedAt, counts, touchedCourses);
      }
      if (ingestOptions.completeCourseSnapshot === true) {
        await purgeMissingSnapshotEvidence(stores, syncRunId, ingestedAt, touchedCourses, incomingEvidenceIds, counts, evidenceRecords);
      }
      counts.courses = touchedCourses.size;
      const syncRun = {
        syncRunId, correlationId: normalizeText(ingestOptions.correlationId), mode: ingestOptions.mode || "ingestRows",
        status: "ingested", startedAt: ingestOptions.startedAt || ingestedAt, completedAt: ingestedAt,
        extractorVersion: ingestOptions.extractorVersion || "", categoryFreshness: ingestOptions.categoryFreshness || {},
        databaseRevision, counts
      };
      await stores.syncRuns.put(syncRun);
      await stores.meta.put({ key: "databaseRevision", value: databaseRevision });
      await stores.meta.put({ key: "schemaVersion", value: APP_DB_VERSION });
      await stores.meta.put({ key: "organizerVersion", value: ORGANIZER_VERSION });
      await stores.meta.put({ key: "latestSyncRunId", value: syncRunId });
      return { syncRunId, databaseRevision, counts, evidenceIds: evidenceRecords.map((r) => r.evidenceId) };
    });
  }

  Object.assign(background, {
    inferSemester,
    courseFromEvidence,
    ingestRows
  });
})(globalThis);
