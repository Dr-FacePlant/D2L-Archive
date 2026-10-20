(function initBackgroundModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { parseColumns, isSafeReadOnlyUrl, flattenItem } = shared;
  const { navigateAndExtract } = background;

function assignmentProbeTasksFromApiItems(orgUnitId, items) {
  const tasks = [];
  const seenFolders = new Set();
  for (const item of items || []) {
    if (item?.source !== "assignment") continue;
    const ids = item.ids || {};
    const folderId = ids.dropboxFolderId || ids.assignmentFolderId || String(item.url || "").match(/[?&]db=(\d+)/)?.[1] || "";
    if (!folderId || seenFolders.has(folderId)) continue;
    seenFolders.add(folderId);
    const title = item.title || `Assignment ${folderId}`;
    tasks.push({
      title: `${title} - Submission history`,
      url: `https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folders_history.d2l?db=${folderId}&ou=${orgUnitId}`,
      expectedPageType: "assignmentSubmissions",
      courseOrgUnitId: orgUnitId,
      sourcePageType: "apiAssignmentProbe"
    });
    tasks.push({
      title: `${title} - Feedback`,
      url: `https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folder_user_view_feedback.d2l?db=${folderId}&ou=${orgUnitId}`,
      expectedPageType: "assignmentFeedback",
      courseOrgUnitId: orgUnitId,
      sourcePageType: "apiAssignmentProbe"
    });
  }
  return tasks.filter((task) => isSafeReadOnlyUrl(task.url));
}

function quizProbeTasksFromApiItems(orgUnitId, items) {
  const tasks = [];
  const seen = new Set();
  for (const item of items || []) {
    if (item?.source !== "quiz" && item?.source !== "quizAttempt") continue;
    const ids = parseColumns({ columns: item.ids ? JSON.stringify(item.ids) : "{}" });
    const quizId = ids.quizId || String(item.url || item.feedbackUrl || "").match(/[?&](?:qi|quizId)=(\d+)/)?.[1] || "";
    if (!quizId) continue;
    const title = item.title || `Quiz ${quizId}`;
    const summaryKey = `summary:${quizId}`;
    if (!seen.has(summaryKey)) {
      seen.add(summaryKey);
      tasks.push({
        title: `${title} - Summary`,
        url: `https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_summary.d2l?ou=${orgUnitId}&qi=${quizId}`,
        expectedPageType: "quizSummary",
        courseOrgUnitId: orgUnitId,
        sourcePageType: "apiQuizProbe"
      });
    }
    const attemptId = ids.attemptId || String(item.url || "").match(/[?&](?:ai|attemptId)=(\d+)/)?.[1] || "";
    const attemptKey = `attempt:${quizId}:${attemptId}`;
    if (attemptId && !seen.has(attemptKey)) {
      seen.add(attemptKey);
      tasks.push({
        title: `${title} - Attempt ${attemptId}`,
        url: `https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_submissions_attempt.d2l?ou=${orgUnitId}&qi=${quizId}&ai=${attemptId}`,
        expectedPageType: "quizAttempt",
        courseOrgUnitId: orgUnitId,
        sourcePageType: "apiQuizProbe"
      });
    }
  }
  return tasks.filter((task) => isSafeReadOnlyUrl(task.url));
}

function announcementProbeTasksFromApiItems(orgUnitId, items) {
  const tasks = [];
  const seen = new Set();
  for (const item of items || []) {
    if (item?.source !== "announcement") continue;
    const ids = parseColumns({ columns: item.ids ? JSON.stringify(item.ids) : "{}" });
    const newsItemId = ids.newsItemId || String(item.url || "").match(/\/news\/\d+\/(\d+)\/view/i)?.[1] || "";
    const url = item.url || (newsItemId ? `https://kennesaw.view.usg.edu/d2l/le/news/${orgUnitId}/${newsItemId}/view` : "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    tasks.push({
      title: `${item.title || `Announcement ${newsItemId || tasks.length + 1}`} - Detail`,
      url,
      expectedPageType: "announcementDetail",
      courseOrgUnitId: orgUnitId,
      sourcePageType: "apiAnnouncementProbe"
    });
  }
  return tasks.filter((task) => isSafeReadOnlyUrl(task.url));
}

// When D2L blocks the topics API (403) the Discussions List page still shows the
// open topics, so the page becomes the fallback evidence for that course.
function discussionListProbeTasksFromApiItems(orgUnitId, items) {
  const blocked = (items || []).some((item) => item?.source === "apiProbe"
    && /^discussion topic$/i.test(item.type || "")
    && item.status === "blocked");
  if (!blocked) return [];
  const url = `https://kennesaw.view.usg.edu/d2l/le/${orgUnitId}/discussions/List`;
  return isSafeReadOnlyUrl(url) ? [{
    title: "Discussions - List",
    url,
    expectedPageType: "discussions",
    courseOrgUnitId: orgUnitId,
    sourcePageType: "discussionListProbe"
  }] : [];
}

function gradeProbeTasksForCourse(orgUnitId) {
  const url = `https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=${orgUnitId}`;
  const task = {
    title: "Grades - Visible gradebook",
    url,
    expectedPageType: "grades",
    courseOrgUnitId: orgUnitId,
    sourcePageType: "gradeProbe"
  };
  return isSafeReadOnlyUrl(url) ? [task] : [];
}

function courseToolProbeTasksForCourse(orgUnitId) {
  const base = "https://kennesaw.view.usg.edu";
  return [
    ["Classlist", `${base}/d2l/lms/classlist/classlist.d2l?ou=${orgUnitId}`, "classlist"],
    ["Checklist", `${base}/d2l/lms/checklist/checklists.d2l?ou=${orgUnitId}`, "checklist"],
    ["Groups", `${base}/d2l/lms/group/group_list.d2l?ou=${orgUnitId}`, "group"],
    ["Self Assessments", `${base}/d2l/lms/selfassess/selfassess.d2l?ou=${orgUnitId}`, "selfAssessment"],
    ["Surveys", `${base}/d2l/lms/survey/surveys.d2l?ou=${orgUnitId}`, "survey"],
    ["Attendance", `${base}/d2l/lms/attendance/registers/registers_list.d2l?ou=${orgUnitId}`, "attendance"],
    ["Progress", `${base}/d2l/le/userprogress/${orgUnitId}/Summary`, "userProgress"]
  ].map(([title, url, expectedPageType]) => ({
    title: `${title} - Tool check`,
    url,
    expectedPageType,
    courseOrgUnitId: orgUnitId,
    sourcePageType: "courseToolProbe"
  })).filter((task) => isSafeReadOnlyUrl(task.url));
}

async function collectAssignmentProbePages(tab, orgUnitId, course, apiItems, rows, pages) {
  const summary = { visited: 0, failed: 0, rows: 0 };
  if (!tab?.id && tab?.mode !== "frame") return summary;
  for (const task of assignmentProbeTasksFromApiItems(orgUnitId, apiItems)) {
    try {
      const payload = await navigateAndExtract(tab.mode === "frame" ? tab : tab.id, task);
      if (!payload.course?.orgUnitId) {
        payload.course = { ...(payload.course || {}), orgUnitId, title: course.title || "" };
      }
      payload.crawlTask.sourcePageType = task.sourcePageType;
      pages.push(payload);
      const items = Array.isArray(payload.items) ? payload.items : [];
      rows.push(...items.map((item) => flattenItem(payload, item)));
      summary.visited += 1;
      summary.rows += items.length;
    } catch (error) {
      if (error?.code === "D2L_SYNC_CANCELED") throw error;
      pages.push({
        pageType: "failed",
        page: { url: task.url, title: task.title || task.url },
        course: { orgUnitId, title: course.title || "" },
        items: [],
        error: error?.message || "Assignment probe page extraction failed.",
        crawlTask: task
      });
      summary.failed += 1;
    }
  }
  return summary;
}

async function collectQuizProbePages(tab, orgUnitId, course, apiItems, rows, pages) {
  const summary = { visited: 0, failed: 0, rows: 0 };
  if (!tab?.id && tab?.mode !== "frame") return summary;
  for (const task of quizProbeTasksFromApiItems(orgUnitId, apiItems)) {
    try {
      const payload = await navigateAndExtract(tab.mode === "frame" ? tab : tab.id, task);
      if (!payload.course?.orgUnitId) {
        payload.course = { ...(payload.course || {}), orgUnitId, title: course.title || "" };
      }
      payload.crawlTask.sourcePageType = task.sourcePageType;
      pages.push(payload);
      const items = Array.isArray(payload.items) ? payload.items : [];
      rows.push(...items.map((item) => flattenItem(payload, item)));
      summary.visited += 1;
      summary.rows += items.length;
    } catch (error) {
      if (error?.code === "D2L_SYNC_CANCELED") throw error;
      pages.push({
        pageType: "failed",
        page: { url: task.url, title: task.title || task.url },
        course: { orgUnitId, title: course.title || "" },
        items: [],
        error: error?.message || "Quiz probe page extraction failed.",
        crawlTask: task
      });
      summary.failed += 1;
    }
  }
  return summary;
}

async function collectAnnouncementProbePages(tab, orgUnitId, course, apiItems, rows, pages) {
  const summary = { visited: 0, failed: 0, rows: 0 };
  if (!tab?.id && tab?.mode !== "frame") return summary;
  for (const task of announcementProbeTasksFromApiItems(orgUnitId, apiItems)) {
    try {
      const payload = await navigateAndExtract(tab.mode === "frame" ? tab : tab.id, task);
      if (!payload.course?.orgUnitId) {
        payload.course = { ...(payload.course || {}), orgUnitId, title: course.title || "" };
      }
      payload.crawlTask.sourcePageType = task.sourcePageType;
      pages.push(payload);
      const items = Array.isArray(payload.items) ? payload.items : [];
      rows.push(...items.map((item) => flattenItem(payload, item)));
      summary.visited += 1;
      summary.rows += items.length;
    } catch (error) {
      if (error?.code === "D2L_SYNC_CANCELED") throw error;
      pages.push({
        pageType: "failed",
        page: { url: task.url, title: task.title || task.url },
        course: { orgUnitId, title: course.title || "" },
        items: [],
        error: error?.message || "Announcement probe page extraction failed.",
        crawlTask: task
      });
      summary.failed += 1;
    }
  }
  return summary;
}

async function collectDiscussionListProbePages(tab, orgUnitId, course, apiItems, rows, pages) {
  const summary = { visited: 0, failed: 0, rows: 0 };
  if (!tab?.id && tab?.mode !== "frame") return summary;
  for (const task of discussionListProbeTasksFromApiItems(orgUnitId, apiItems)) {
    try {
      const payload = await navigateAndExtract(tab.mode === "frame" ? tab : tab.id, task);
      if (!payload.course?.orgUnitId) {
        payload.course = { ...(payload.course || {}), orgUnitId, title: course.title || "" };
      }
      payload.crawlTask.sourcePageType = task.sourcePageType;
      pages.push(payload);
      const items = (Array.isArray(payload.items) ? payload.items : []).filter((item) => item?.source === "discussionTopic" && item.ids?.discussionTopicId);
      rows.push(...items.map((item) => flattenItem(payload, item)));
      summary.visited += 1;
      summary.rows += items.length;
    } catch (error) {
      if (error?.code === "D2L_SYNC_CANCELED") throw error;
      pages.push({
        pageType: "failed",
        page: { url: task.url, title: task.title || task.url },
        course: { orgUnitId, title: course.title || "" },
        items: [],
        error: error?.message || "Discussion list probe page extraction failed.",
        crawlTask: task
      });
      summary.failed += 1;
    }
  }
  return summary;
}

async function collectGradeProbePages(tab, orgUnitId, course, rows, pages) {
  const summary = { visited: 0, failed: 0, rows: 0 };
  if (!tab?.id && tab?.mode !== "frame") return summary;
  for (const task of gradeProbeTasksForCourse(orgUnitId)) {
    try {
      const payload = await navigateAndExtract(tab.mode === "frame" ? tab : tab.id, task);
      if (!payload.course?.orgUnitId) {
        payload.course = { ...(payload.course || {}), orgUnitId, title: course.title || "" };
      }
      payload.crawlTask.sourcePageType = task.sourcePageType;
      pages.push(payload);
      const items = Array.isArray(payload.items) ? payload.items : [];
      rows.push(...items.map((item) => flattenItem(payload, item)));
      summary.visited += 1;
      summary.rows += items.length;
    } catch (error) {
      if (error?.code === "D2L_SYNC_CANCELED") throw error;
      pages.push({
        pageType: "failed",
        page: { url: task.url, title: task.title || task.url },
        course: { orgUnitId, title: course.title || "" },
        items: [],
        error: error?.message || "Grade probe page extraction failed.",
        crawlTask: task
      });
      summary.failed += 1;
    }
  }
  return summary;
}

async function collectCourseToolProbePages(tab, orgUnitId, course, rows, pages) {
  const summary = { visited: 0, failed: 0, rows: 0 };
  if (!tab?.id && tab?.mode !== "frame") return summary;
  for (const task of courseToolProbeTasksForCourse(orgUnitId)) {
    try {
      const payload = await navigateAndExtract(tab.mode === "frame" ? tab : tab.id, task);
      if (!payload.course?.orgUnitId) {
        payload.course = { ...(payload.course || {}), orgUnitId, title: course.title || "" };
      }
      payload.crawlTask.sourcePageType = task.sourcePageType;
      pages.push(payload);
      const items = Array.isArray(payload.items) ? payload.items : [];
      rows.push(...items.map((item) => flattenItem(payload, item)));
      summary.visited += 1;
      summary.rows += items.length;
    } catch (error) {
      if (error?.code === "D2L_SYNC_CANCELED") throw error;
      pages.push({
        pageType: "failed",
        page: { url: task.url, title: task.title || task.url },
        course: { orgUnitId, title: course.title || "" },
        items: [],
        error: error?.message || "Course tool probe page extraction failed.",
        crawlTask: task
      });
      summary.failed += 1;
    }
  }
  return summary;
}

  Object.assign(background, { discussionListProbeTasksFromApiItems, collectDiscussionListProbePages, assignmentProbeTasksFromApiItems, quizProbeTasksFromApiItems, announcementProbeTasksFromApiItems, gradeProbeTasksForCourse, courseToolProbeTasksForCourse, collectAssignmentProbePages, collectQuizProbePages, collectAnnouncementProbePages, collectGradeProbePages, collectCourseToolProbePages });
})(globalThis);
