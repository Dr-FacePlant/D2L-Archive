(() => {
  const shared = globalThis.D2LExtractorShared ||= {};

  function classifyUrl(rawUrl) {
    const url = String(rawUrl || "");
    let pathname = "";
    try {
      pathname = new URL(url, shared.D2L_ORIGIN).pathname;
    } catch {
      return "unknown";
    }
    if (/\/d2l\/home\/?$/.test(pathname)) return "dashboard";
    if (/\/d2l\/home\/\d+/.test(url)) return "courseHome";
    if (/\/d2l\/le\/content\/\d+\//.test(url)) return "content";
    if (/\/d2l\/(?:le|lms)\/news\//.test(url)) return "announcementDetail";
    if (/\/discussions\/(?:List|topics\/\d+\/View|threads\/\d+\/View)/i.test(url) || /\/d2l\/p\/le\/discussions\/\d+/.test(url)) return "discussions";
    if (/\/dropbox\/user\/folders_list\.d2l/.test(url)) return "assignments";
    if (/\/dropbox\/user\/folders_history\.d2l/.test(url)) return "assignmentSubmissions";
    if (/\/dropbox\/user\/folder_user_view_feedback\.d2l/.test(url)) return "assignmentFeedback";
    if (/\/quizzing\/user\/quizzes_list\.d2l/.test(url)) return "quizzes";
    if (/\/quizzing\/user\/quiz_submissions_attempt\.d2l/.test(url)) return "quizAttempt";
    if (/\/quizzing\/user\/quiz_submissions\.d2l/.test(url)) return "quizSubmissions";
    if (/\/quizzing\/user\/quiz_summary\.d2l/.test(url)) return "quizSummary";
    if (/\/grades\/my_grades\/main\.d2l/.test(url)) return "grades";
    if (/\/d2l\/le\/calendar\//.test(url)) return "calendar";
    if (/\/lms\/classlist\/classlist\.d2l/.test(url)) return "classlist";
    if (/\/lms\/checklist\//.test(url)) return "checklist";
    if (/\/lms\/survey\//.test(url)) return "survey";
    if (/\/lms\/selfassess\//.test(url)) return "selfAssessment";
    if (/\/lms\/group\//.test(url)) return "group";
    if (/\/lms\/links\//.test(url)) return "courseLink";
    if (/\/lms\/attendance\//.test(url)) return "attendance";
    if (/\/le\/userprogress\//.test(url)) return "userProgress";
    if (/\/d2l\/mediaLibrary\//.test(url) || /\/wcs\/media-library\//.test(url)) return "mediaLibrary";
    return "unknown";
  }

  function canonicalUrl(rawUrl) {
    if (!rawUrl) return rawUrl;
    try {
      const parsed = new URL(rawUrl);
      const moduleItem = parsed.searchParams.get("itemIdentifier");
      if (moduleItem) {
        const match = moduleItem.match(/ModuleCO-(\d+)/i) || moduleItem.match(/Topic-(\d+)/i);
        if (match) return `${parsed.origin}/d2l/le/content/canonical-item/${match[1]}`;
      }
      const viewContent = parsed.pathname.match(/\/viewContent\/(\d+)\//);
      if (viewContent) return `${parsed.origin}/d2l/le/content/canonical-item/${viewContent[1]}`;
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return rawUrl;
    }
  }

  function isSafeReadOnlyUrl(rawUrl, baseUrl = shared.D2L_ORIGIN) {
    if (!rawUrl) return false;
    let parsed;
    try {
      parsed = new URL(rawUrl, baseUrl);
    } catch {
      return false;
    }
    if (parsed.origin !== shared.D2L_ORIGIN) return false;
    if (!parsed.pathname.startsWith("/d2l/")) return false;
    return ![
      /\/folder_submit_files\.d2l/i,
      /\/dropbox\/user\/folder_submit/i,
      /\/discussions\/posts\/create/i,
      /\/discussions\/threads\/create/i,
      /\/quizzing\/user\/attempt/i,
      /\/quizzing\/user\/quiz_start/i,
      /\/navigateContent\//i,
      /\/error\//i,
      /invalid_ou_type/i,
      /\/lms\/discussions\/admin\/subscriptions\.d2l/i,
      /\/mail\//i,
      /\/settings/i,
      /\/profile/i,
      /\/delete/i
    ].some((pattern) => pattern.test(parsed.href));
  }

  Object.assign(shared, { classifyUrl, canonicalUrl, isSafeReadOnlyUrl });
})();
