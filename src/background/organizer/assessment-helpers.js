(function initAssessmentHelpersModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText } = shared;

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

  function minutesFromText(text) {
    const match = normalizeText(text).match(/(\d+)\s*minute/i);
    return match ? Number(match[1]) : null;
  }

  function rubricSummary(record) {
    if (!record) return null;
    const columns = record.fields?.columns || {};
    const criteria = Array.isArray(columns.criteria) ? columns.criteria : [];
    return {
      name: record.title,
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

  Object.assign(background, {
    numberOrNull,
    normalizedAssessmentTitle,
    titleMatch,
    minutesFromText,
    rubricSummary,
    quizStatus
  });
})(globalThis);
