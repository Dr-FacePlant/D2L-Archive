(function initBackgroundModule(global) {
  const shared = global.D2LExtractorShared;
  const background = global.D2LExtractorBackground ||= {};
  const { normalizeText, slug, createDataUrl, flattenItem, parseColumns } = shared;
  const {
    sleep,
    PAGE_LOAD_DELAY_MS,
    sendToTab,
    waitForTabReady,
    collectAssignmentProbePages,
    collectQuizProbePages,
    collectAnnouncementProbePages,
    collectGradeProbePages,
    collectCourseToolProbePages
  } = background;

function extensionForRow(row) {
  const text = `${row.type} ${row.title} ${row.itemUrl}`.toLowerCase();
  if (text.includes("pdf")) return "pdf";
  if (text.includes("powerpoint") || text.includes(".ppt")) return "pptx";
  if (text.includes("word") || text.includes(".doc")) return "docx";
  if (text.includes(".xlsx") || text.includes("excel")) return "xlsx";
  if (text.includes(".csv")) return "csv";
  if (text.includes("video")) return "html";
  return "html";
}

function isDownloadCandidate(row) {
  if (!row.itemUrl || !row.itemUrl.startsWith("https://kennesaw.view.usg.edu/d2l/")) return false;
  if (row.source === "submittedFile" || row.source === "announcementAttachment") return true;
  if (row.source === "discussionAttachment") {
    if (/javascript:/i.test(row.itemUrl)) return false;
    return /\/discussions\/posts\/\d+\/ViewAttachment(?:\?|$)/i.test(row.itemUrl);
  }
  if (row.source !== "contentTopic" && row.source !== "contentAttachment" && row.source !== "link") return false;
  if (/javascript:/i.test(row.itemUrl)) return false;
  if (/\/discussions\//i.test(row.itemUrl)) return false;
  if (/\/quizzing\//i.test(row.itemUrl)) return false;
  if (/\/grades\//i.test(row.itemUrl)) return false;
  return /viewContent|content|pdf|doc|ppt|xlsx|file/i.test(`${row.itemUrl} ${row.type} ${row.title}`);
}

// Every course the crawl touched gets one Valence API pass. The API carries what
// the rendered pages never show: quiz/assignment due dates, each topic's real
// file, and the full-semester calendar. Rows from the API replace the scraped
// contentTopic/quiz/assignment/calendarEvent rows rather than sitting alongside
// them, so the manifest has one authoritative row per item.
const API_REPLACEABLE_SOURCES = new Set([
  "contentTopic", "contentAttachment", "courseOverview", "courseOverviewAttachment",
  "quiz", "quizAttempt", "quizQuestion", "assignment", "assignmentSubmission", "assignmentFeedback",
  "submittedFile", "calendarEvent", "calendarAttachment", "gradeItem", "gradeFeedback",
  "gradeSetup", "gradeCategory", "finalGrade", "announcement", "announcementAttachment",
  "discussionForum", "discussionTopic", "discussionPost", "discussionAttachment", "externalLink",
  "syllabusPolicy", "rubric", "rubricFeedback", "checklistItem", "survey", "surveyAttempt",
  "surveyQuestion", "group", "classlistEntry", "progressRecord", "courseToolPage", "apiProbe"
]);

function purgeObsoleteCourseRows(rows, orgUnitId) {
  const before = rows.length;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const columns = parseColumns(rows[index]);
    const isLiveTopic = rows[index].source === "discussionTopic" && columns.recoveredFrom === "discussionTopicPage";
    const isLiveAttach = rows[index].source === "discussionAttachment" && /^discussion(?:Page|VisiblePost|Attachment)/.test(columns.recoveredFrom || "");
    if (rows[index].courseOrgUnitId === orgUnitId && API_REPLACEABLE_SOURCES.has(rows[index].source) && !isLiveTopic && !isLiveAttach) {
      rows.splice(index, 1);
    }
  }
  return before - rows.length;
}

function appendCoursePayloadRows(rows, orgUnitId, payload, pages) {
  const course = pages.find((page) => page.course?.orgUnitId === orgUnitId)?.course || {};
  const pagePayload = {
    pageType: "valenceApi",
    page: { url: `https://kennesaw.view.usg.edu/d2l/home/${orgUnitId}`, title: course.title || orgUnitId },
    course: { orgUnitId, title: course.title || "" },
    apiStatus: payload.apiStatus, apiCounts: payload.counts, extractor: { extractedAt: new Date().toISOString() }
  };
  for (const item of payload.items || []) {
    const row = flattenItem(pagePayload, item);
    row.downloadUrl = item.downloadUrl || "";
    row.suggestedFileName = item.suggestedFileName || "";
    rows.push(row);
  }
  return payload.items?.length || 0;
}

async function collectCourseProbes(tab, orgUnitId, course, items, rows, pages) {
  const ap = await collectAssignmentProbePages(tab, orgUnitId, course, items, rows, pages);
  const qp = await collectQuizProbePages(tab, orgUnitId, course, items, rows, pages);
  const anp = await collectAnnouncementProbePages(tab, orgUnitId, course, items, rows, pages);
  const gp = await collectGradeProbePages(tab, orgUnitId, course, rows, pages);
  const ctp = await collectCourseToolProbePages(tab, orgUnitId, course, rows, pages);
  return { ap, qp, anp, gp, ctp };
}

function mergeProbeSummaries(summary, orgUnitId, payload, probes) {
  const add = (dest, src) => { dest.visited += src.visited; dest.failed += src.failed; dest.rows += src.rows; };
  add(summary.assignmentProbePages, probes.ap);
  add(summary.quizProbePages, probes.qp);
  add(summary.announcementProbePages, probes.anp);
  add(summary.gradeProbePages, probes.gp);
  add(summary.courseToolProbePages, probes.ctp);
  summary.courses.push({
    orgUnitId, counts: payload.counts, apiStatus: payload.apiStatus,
    assignmentProbePages: probes.ap, quizProbePages: probes.qp,
    announcementProbePages: probes.anp, gradeProbePages: probes.gp, courseToolProbePages: probes.ctp
  });
}

async function collectOneCourseApi(tab, orgUnitId, rows, pages, summary) {
  try {
    await chrome.tabs.update(tab.id, { url: `https://kennesaw.view.usg.edu/d2l/home/${orgUnitId}` });
    await sleep(PAGE_LOAD_DELAY_MS);
    await waitForTabReady(tab.id);
    const response = await sendToTab(tab.id, { type: "D2L_COLLECT_COURSE_API", orgUnitId });
    if (!response?.ok) {
      summary.failed.push({ orgUnitId, error: response?.error || "no response" });
      return;
    }
    const payload = response.payload;
    summary.replaced += purgeObsoleteCourseRows(rows, orgUnitId);
    summary.added += appendCoursePayloadRows(rows, orgUnitId, payload, pages);
    const course = pages.find((page) => page.course?.orgUnitId === orgUnitId)?.course || {};
    const probes = await collectCourseProbes(tab, orgUnitId, course, payload.items || [], rows, pages);
    mergeProbeSummaries(summary, orgUnitId, payload, probes);
  } catch (error) {
    summary.failed.push({ orgUnitId, error: error?.message || "collection failed" });
  }
}

async function collectApiRows(tab, rows, pages) {
  const summary = {
    courses: [], replaced: 0, added: 0, failed: [],
    assignmentProbePages: { visited: 0, failed: 0, rows: 0 },
    quizProbePages: { visited: 0, failed: 0, rows: 0 },
    announcementProbePages: { visited: 0, failed: 0, rows: 0 },
    gradeProbePages: { visited: 0, failed: 0, rows: 0 },
    courseToolProbePages: { visited: 0, failed: 0, rows: 0 }
  };
  if (!tab) return summary;
  const orgUnitIds = [...new Set(rows.map((row) => row.courseOrgUnitId).filter((id) => id && id !== "6629"))];
  for (const orgUnitId of orgUnitIds) {
    await collectOneCourseApi(tab, orgUnitId, rows, pages, summary);
  }
  return summary;
}

function archivePathFromDownloadItem(item, fallbackPath) {
  const filename = item?.filename || "";
  const match = filename.match(/(?:^|\/)(D2L Export\/d2l-(?:export|api-export|course-export|page-probe-export)-[^/]+\/.*)$/);
  return match?.[1] || filename || fallbackPath;
}

async function waitForDownloadComplete(downloadId, timeoutMs = 120000) {
  const current = await chrome.downloads.search({ id: downloadId });
  if (current?.[0]?.state === "complete" || current?.[0]?.state === "interrupted") return current[0];

  return new Promise((resolve) => {
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(listener);
      try {
        const [item] = await chrome.downloads.search({ id: downloadId });
        resolve(item || null);
      } catch {
        resolve(null);
      }
    };
    const listener = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete" || delta.error) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    chrome.downloads.onChanged.addListener(listener);
  });
}

// A dashboard sync can point a row at the copy an earlier archive already
// downloaded from the same URL, instead of downloading every file again
// (CRJU alone is about 2.5 GB). Only a completed download whose file still
// exists on disk counts.
async function archivedCopyFor(target) {
  try {
    const matches = await chrome.downloads.search({ url: target, state: "complete", exists: true, orderBy: ["-endTime"], limit: 5 });
    const item = matches.find((match) => /[\\/]D2L Export[\\/]/.test(match.filename || ""));
    return item ? archivePathFromDownloadItem(item, "") : "";
  } catch {
    return "";
  }
}

// Course files are downloaded only when the student turns the setting on. A
// missing or unreadable setting means off, so an older profile never starts
// writing files after an update.
async function courseFileDownloadsEnabled() {
  try {
    const stored = await chrome.storage.local.get("dashboardSettings");
    return stored?.dashboardSettings?.downloadCourseFiles === true;
  } catch {
    return false;
  }
}

async function downloadCourseFiles(rows, archiveRoot, options = {}) {
  let downloaded = 0;
  const allowDownloads = options.downloadFiles === true
    ? true
    : options.downloadFiles === false
      ? false
      : await courseFileDownloadsEnabled();
  // Activity is only recorded into a known account's archive; otherwise it is skipped.
  const activityRepository = options.repository || await background.activeArchiveRepository().catch(() => null);
  for (const row of rows) {
    const target = row.downloadUrl || (isDownloadCandidate(row) ? row.itemUrl : "");
    if (!target) continue;
    if (!/^https?:/i.test(target)) continue;
    if (options.reuseArchivedFiles) {
      const reused = await archivedCopyFor(target);
      if (reused) {
        row.localPath = reused;
        await activityRepository?.recordActivity({ operation: "download.file", category: "download", status: "skipped", courseId: row.courseOrgUnitId, itemId: row.evidenceId || row.itemUrl, source: "archive-reuse", details: { localPath: reused } }).catch(() => {});
        continue;
      }
    }

    // Files already on disk stay linked even when new downloads are off.
    if (!allowDownloads) {
      row.localPath = row.localPath || "";
      continue;
    }

    const courseFolder = slug(`${row.courseOrgUnitId || "unknown"}-${row.courseTitle || "course"}`, row.courseOrgUnitId || "course");
    const suggested = row.suggestedFileName || "";
    const fileName = /\.[a-z0-9]{2,5}$/i.test(suggested)
      ? `${slug(row.title, "content")}-${suggested}`
      : `${slug(row.title, "content")}.${extensionForRow(row)}`;
    const localPath = `${archiveRoot}/courses/${courseFolder}/files/${fileName}`;

    try {
      const downloadId = await chrome.downloads.download({
        url: target,
        filename: localPath,
        saveAs: false,
        conflictAction: "uniquify"
      });
      const item = await waitForDownloadComplete(downloadId);
      if (item?.state === "interrupted") {
        row.localPath = "";
        row.downloadError = item.error || "download interrupted";
      } else {
        row.localPath = archivePathFromDownloadItem(item, localPath);
        if (row.localPath) {
          downloaded += 1;
          await activityRepository?.recordActivity({ operation: "download.file", category: "download", status: "completed", courseId: row.courseOrgUnitId, itemId: row.evidenceId || row.itemUrl, source: "d2l", details: { localPath: row.localPath } }).catch(() => {});
        } else {
          row.downloadError = "download finished but no local path was reported";
          await activityRepository?.recordActivity({ operation: "download.file", category: "download", status: "failed", courseId: row.courseOrgUnitId, itemId: row.evidenceId || row.itemUrl, source: "d2l", error: row.downloadError }).catch(() => {});
        }
      }
    } catch (error) {
      row.localPath = "";
      row.downloadError = error?.message || "download failed";
      await activityRepository?.recordActivity({ operation: "download.file", category: "download", status: "failed", courseId: row.courseOrgUnitId, itemId: row.evidenceId || row.itemUrl, source: "d2l", error: row.downloadError }).catch(() => {});
    }
  }
  return downloaded;
}

// Text exports are thousands of small files per sync. Their history records
// make the browser's downloads list huge (13k records froze Vivaldi for minutes
// after each launch), so each one is erased from history once it lands. The
// file on disk stays. Course-file records are kept: archivedCopyFor needs them.
function eraseFromHistoryWhenDone(downloadId) {
  if (!downloadId) return;
  waitForDownloadComplete(downloadId)
    .then((item) => {
      if (item?.state === "complete") return chrome.downloads.erase({ id: downloadId });
    })
    .catch(() => {});
}

async function downloadText(path, text, mimeType, saveAs = false) {
  const downloadId = await chrome.downloads.download({
    url: createDataUrl(text, mimeType),
    filename: path,
    saveAs,
    conflictAction: "overwrite"
  });
  if (!saveAs) eraseFromHistoryWhenDone(downloadId);
}

  Object.assign(background, { extensionForRow, isDownloadCandidate, collectApiRows, archivePathFromDownloadItem, waitForDownloadComplete, archivedCopyFor, courseFileDownloadsEnabled, downloadCourseFiles, downloadText, eraseFromHistoryWhenDone });
})(globalThis);
