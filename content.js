(() => {
const D2L_EXTRACTOR_VERSION = "0.9.0";
  globalThis.D2LExtractorContent.buildVersion = D2L_EXTRACTOR_VERSION;
  const { normalizeText } = globalThis.D2LExtractorShared;
  const {
    looksLikeFileUrl,
    isExternalResourceUrl,
    isDiscussionAttachmentUrl,
    discussionTopicIdFromUrl,
    compactLabelValueRows,
    isUsefulAssignmentSubmissionRow,
    quizIdsFromUrl,
    quizScoreText,
    quizQuestionRowsFromText,
    gradeFeedbackRow,
    apiProbeStatus,
    addApiProbeRow,
    collectCourseApi,
    collectCourseApiWithAccount,
    extractVisiblePage,
    discoverCrawlLinks,
    safeProbeTask,
    probePayloadReady,
    installContentMessaging,
    devReloadHashRequested,
    devSameTabSyncRequest,
    normalizeAction,
    actionRoute,
    actionDigest,
    assignmentBody,
    discussionBody,
    prepareD2lAction,
    commitD2lAction
  } = globalThis.D2LExtractorContent;

  try {
    document.documentElement.setAttribute("data-d2l-extractor-build", D2L_EXTRACTOR_VERSION);
  } catch {}

  globalThis.__D2LExtractorContentTestHooks = Object.freeze({
    normalizeText,
    looksLikeFileUrl,
    isExternalResourceUrl,
    isDiscussionAttachmentUrl,
    discussionTopicIdFromUrl,
    compactLabelValueRows,
    isUsefulAssignmentSubmissionRow,
    quizIdsFromUrl,
    quizScoreText,
    quizQuestionRowsFromText,
    gradeFeedbackRow,
    apiProbeStatus,
    addApiProbeRow,
    apiList: globalThis.D2LExtractorContent.apiList,
    resolveDue: globalThis.D2LExtractorContent.resolveDue,
    mergeGradeValues: globalThis.D2LExtractorContent.mergeGradeValues,
    derivedStudentUsefulRows: globalThis.D2LExtractorContent.derivedStudentUsefulRows,
    extractDiscussionListTopics: globalThis.D2LExtractorContent.extractDiscussionListTopics,
    collectCourseApi,
    collectCourseApiWithAccount,
    extractVisiblePage,
    discoverCrawlLinks,
    safeProbeTask,
    probePayloadReady,
    installContentMessaging,
    devReloadHashRequested,
    devRuntimeCheckRequested: globalThis.D2LExtractorContent.devRuntimeCheckRequested,
    maybeReportDevRuntimeCheck: globalThis.D2LExtractorContent.maybeReportDevRuntimeCheck,
    buildVersion: D2L_EXTRACTOR_VERSION,
    devRuntimeStatus: () => document.getElementById("d2l-extractor-dev-runtime-status")?.textContent || "",
    devRuntimeTitle: () => document.title,
    devSameTabSyncRequest,
    normalizeAction,
    actionRoute,
    actionDigest,
    assignmentBody,
    discussionBody,
    prepareD2lAction,
    commitD2lAction
  });

  installContentMessaging();
})();
