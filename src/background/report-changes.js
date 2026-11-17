(function initBackgroundReportModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { aiIndexRecord, createExportSummary, feedbackSignal, summarizeChanges } = shared;

  // Compare each course only against its own last export, so a run covering
  // different courses does not report every other course's rows as removed.
  function scopeSummaryToCourses(stored, courseIds) {
    if (!stored?.rows?.length) return stored || null;
    const rows = stored.rows.filter((row) => courseIds.has(row.courseOrgUnitId || ""));
    const times = [...courseIds].map((id) => stored.courseExportedAt?.[id]).filter(Boolean).sort();
    return { ...stored, exportedAt: rows.length ? (times[times.length - 1] || stored.exportedAt || "") : "", rows };
  }

  function mergeExportSummaries(stored, current) {
    const courseIds = new Set(current.rows.map((row) => row.courseOrgUnitId || ""));
    const kept = (stored?.rows || []).filter((row) => !courseIds.has(row.courseOrgUnitId || ""));
    const courseExportedAt = { ...(stored?.courseExportedAt || {}) };
    for (const id of courseIds) courseExportedAt[id] = current.exportedAt;
    return { ...current, courseExportedAt, rows: [...kept, ...current.rows] };
  }

  Object.assign(background, { aiIndexRecord, createExportSummary, feedbackSignal, summarizeChanges, scopeSummaryToCourses, mergeExportSummaries });
})(globalThis);
