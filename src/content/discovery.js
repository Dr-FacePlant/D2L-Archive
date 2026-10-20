(function initContentDiscovery(global) {
  const shared = global.D2LExtractorShared;
  const content = global.D2LExtractorContent ||= {};
  const { normalizeText, isSafeReadOnlyUrl } = shared;
  const { queryAll, absoluteUrl, getOrgUnitId, classifyPage, getCourse, generatedAssignmentProbeLinks } = content;

function isLikelyReadOnlyD2LUrl(rawUrl) {
    return isSafeReadOnlyUrl(rawUrl, window.location.href);
  }

  function dedupeByUrl(records) {
    const seen = new Set();
    return records.filter((record) => {
      if (!record.url || seen.has(record.url)) return false;
      seen.add(record.url);
      return true;
    });
  }

  function courseToolLinks(courseOrgUnitId, courseTitle) {
    if (!courseOrgUnitId || courseOrgUnitId === "6629") return [];
    const base = "https://kennesaw.view.usg.edu";
    return [
      ["Course Home", `${base}/d2l/home/${courseOrgUnitId}`],
      ["Content", `${base}/d2l/le/content/${courseOrgUnitId}/Home`],
      ["Discussions", `${base}/d2l/le/${courseOrgUnitId}/discussions/List`],
      ["Assignments", `${base}/d2l/lms/dropbox/user/folders_list.d2l?ou=${courseOrgUnitId}&isprv=0`],
      ["Quizzes", `${base}/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${courseOrgUnitId}`],
      ["Classlist", `${base}/d2l/lms/classlist/classlist.d2l?ou=${courseOrgUnitId}`],
      ["Grades", `${base}/d2l/lms/grades/my_grades/main.d2l?ou=${courseOrgUnitId}`],
      ["Calendar", `${base}/d2l/le/calendar/${courseOrgUnitId}`],
      ["Checklist", `${base}/d2l/lms/checklist/checklists.d2l?ou=${courseOrgUnitId}`],
      ["Groups", `${base}/d2l/lms/group/group_list.d2l?ou=${courseOrgUnitId}`],
      ["Links", `${base}/d2l/lms/links/view_links.d2l?ou=${courseOrgUnitId}`],
      ["Self Assessments", `${base}/d2l/lms/selfassess/selfassess.d2l?ou=${courseOrgUnitId}`],
      ["Surveys", `${base}/d2l/lms/survey/surveys.d2l?ou=${courseOrgUnitId}`],
      ["Attendance", `${base}/d2l/lms/attendance/registers/registers_list.d2l?ou=${courseOrgUnitId}`],
      ["Progress", `${base}/d2l/le/userprogress/${courseOrgUnitId}/Summary`]
    ].map(([title, url]) => ({
      title: `${courseTitle ? `${courseTitle} - ` : ""}${title}`,
      url,
      sourcePageType: "generatedCourseTool",
      courseOrgUnitId
    }));
  }

  function discoverCrawlLinks() {
    const pageType = classifyPage();
    const orgUnitId = getOrgUnitId();
    const links = queryAll("a[href]")
      .map((link) => {
        const url = absoluteUrl(link.getAttribute("href"));
        return {
          title: normalizeText(link.getAttribute("aria-label") || link.textContent || link.title),
          url,
          sourcePageType: pageType,
          courseOrgUnitId: orgUnitId
        };
      })
      .filter((record) => record.title && isLikelyReadOnlyD2LUrl(record.url));

    const courseHomeLinks = links.filter((record) => {
      const match = record.url.match(/\/d2l\/home\/(\d+)/);
      return match && match[1] !== "6629";
    });
    const generatedFromCourseCards = courseHomeLinks.flatMap((record) => {
      const courseOrgUnitId = record.url.match(/\/d2l\/home\/(\d+)/)?.[1] || null;
      return courseToolLinks(courseOrgUnitId, record.title);
    });
    const generatedFromCurrentCourse = courseToolLinks(orgUnitId, getCourse().title);
    const assignmentProbeLinks = pageType === "assignments" ? generatedAssignmentProbeLinks(orgUnitId) : [];
    const navAndToolLinks = links.filter((record) => {
      return [
        /\/d2l\/le\/content\//,
        /\/discussions\//,
        /\/dropbox\//,
        /\/quizzing\//,
        /\/grades\//,
        /\/calendar\//,
        /\/classlist\//,
        /\/checklist\//,
        /\/competencies\//,
        /\/group\//,
        /\/links\//,
        /\/locker\//,
        /\/selfassess\//,
        /\/survey\//,
        /\/attendance\//,
        /\/userprogress\//,
        /\/wcs\/media-library\//,
        /\/common\/dialogs\/quickLink\/quickLink\.d2l/
      ].some((pattern) => pattern.test(record.url));
    });

    return {
      pageType,
      pageUrl: window.location.href,
      courseOrgUnitId: orgUnitId,
      links: dedupeByUrl([
        ...courseHomeLinks,
        ...generatedFromCourseCards,
        ...generatedFromCurrentCourse,
        ...assignmentProbeLinks,
        ...navAndToolLinks
      ])
    };
  }

  Object.assign(content, { isLikelyReadOnlyD2LUrl, dedupeByUrl, courseToolLinks, discoverCrawlLinks });
})(globalThis);
