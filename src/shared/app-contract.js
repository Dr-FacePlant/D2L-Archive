(() => {
  const shared = globalThis.D2LExtractorShared ||= {};

  const APP_API_MESSAGE_TYPE = "D2L_APP_API_REQUEST";
  const APP_API_PROTOCOL_VERSION = "1";
  const APP_DB_NAME = "d2l-student-archive";
  const APP_DB_VERSION = 3;
  const ORGANIZER_VERSION = "8";

  const ENTITY_TYPES = Object.freeze([
    "assignmentBundle",
    "quizBundle",
    "gradeRecord",
    "announcement",
    "discussionForum",
    "discussionThread",
    "learningResource",
    "calendarEvent",
    "coursePolicy",
    "studentProgress",
    "courseToolItem",
    "person",
    "externalResource",
    "extractionState"
  ]);

  const RELATIONSHIP_TYPES = Object.freeze([
    "sameAs",
    "hasInstructions",
    "hasFile",
    "hasSubmission",
    "hasSubmittedFile",
    "hasFeedback",
    "hasRubric",
    "hasGrade",
    "hasDeadline",
    "hasSummary",
    "hasAttempt",
    "hasQuestion",
    "hasQuestionResult",
    "hasAccessProbe",
    "hasAttachment",
    "hasPost",
    "belongsToForum",
    "hasProgress",
    "progressFor",
    "references",
    "derivedFrom",
    "mentionedByAnnouncement"
  ]);

  const APP_API_ERROR_CODES = Object.freeze({
    INVALID_REQUEST: "INVALID_REQUEST",
    INVALID_PARAMS: "INVALID_PARAMS",
    METHOD_NOT_FOUND: "METHOD_NOT_FOUND",
    NOT_FOUND: "NOT_FOUND",
    STORAGE_ERROR: "STORAGE_ERROR",
    ACCOUNT_UNKNOWN: "ACCOUNT_UNKNOWN",
    ACCOUNT_QUARANTINED: "ACCOUNT_QUARANTINED",
    INTERNAL_ERROR: "INTERNAL_ERROR"
  });

  const APP_API_METHODS = Object.freeze([
    "system.getCapabilities",
    "system.getDatabaseStatus",
    "system.getAccountContext",
    "courses.list",
    "courses.get",
    "courses.getOverview",
    "evidence.list",
    "evidence.get",
    "entities.list",
    "entities.get",
    "entities.getBundle",
    "relationships.list",
    "assignments.list",
    "quizzes.list",
    "grades.list",
    "announcements.list",
    "discussions.list",
    "resources.list",
    "calendar.list",
    "policies.list",
    "progress.list",
    "tools.list",
    "people.list",
    "externalResources.list",
    "gaps.list",
    "dashboard.getOverview",
    "dashboard.getUpcoming",
    "dashboard.getRecentChanges",
    "dashboard.getUpdates",
    "search.query",
    "sync.getState",
    "sync.getQueue",
    "sync.getRun",
    "activity.list",
    "activity.getSummary",
    "archive.ingestRows",
    "archive.ingestExtraction",
    "organizer.runCourse",
    "organizer.runChanged",
    "organizer.rebuildAll",
    "relationships.confirm",
    "relationships.reject"
  ]);

  function appApiError(code, message, details = {}) {
    return { code, message, details };
  }

  function appApiResponse(request, data, meta = {}) {
    return {
      protocolVersion: APP_API_PROTOCOL_VERSION,
      requestId: String(request?.requestId || ""),
      ok: true,
      data,
      meta: {
        databaseRevision: Number(meta.databaseRevision || 0),
        generatedAt: meta.generatedAt || new Date().toISOString()
      }
    };
  }

  function appApiErrorResponse(request, error) {
    return {
      protocolVersion: APP_API_PROTOCOL_VERSION,
      requestId: String(request?.requestId || ""),
      ok: false,
      error
    };
  }

  function validateAppApiRequest(message) {
    if (!message || message.type !== APP_API_MESSAGE_TYPE) {
      return appApiError(APP_API_ERROR_CODES.INVALID_REQUEST, "Unsupported application API message type.");
    }
    if (message.protocolVersion !== APP_API_PROTOCOL_VERSION) {
      return appApiError(APP_API_ERROR_CODES.INVALID_REQUEST, "Unsupported application API protocol version.", {
        expected: APP_API_PROTOCOL_VERSION,
        received: String(message.protocolVersion || "")
      });
    }
    if (!String(message.requestId || "").trim()) {
      return appApiError(APP_API_ERROR_CODES.INVALID_REQUEST, "requestId is required.");
    }
    if (!APP_API_METHODS.includes(message.method)) {
      return appApiError(APP_API_ERROR_CODES.METHOD_NOT_FOUND, `Unknown application API method: ${String(message.method || "")}`);
    }
    if (message.params !== undefined && (message.params === null || typeof message.params !== "object" || Array.isArray(message.params))) {
      return appApiError(APP_API_ERROR_CODES.INVALID_PARAMS, "params must be an object.");
    }
    return null;
  }

  Object.assign(shared, {
    APP_API_MESSAGE_TYPE,
    APP_API_PROTOCOL_VERSION,
    APP_DB_NAME,
    APP_DB_VERSION,
    ORGANIZER_VERSION,
    ENTITY_TYPES,
    RELATIONSHIP_TYPES,
    APP_API_ERROR_CODES,
    APP_API_METHODS,
    appApiError,
    appApiResponse,
    appApiErrorResponse,
    validateAppApiRequest
  });
})();
