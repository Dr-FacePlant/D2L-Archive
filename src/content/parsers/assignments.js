(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText, compactLabelValueRows } = globalThis.D2LExtractorShared;
  const { queryAll, absoluteUrl, getOrgUnitId, looksLikeFileUrl, headingText, pageText } = content;

function extractTableRows(source) {
  const tables = queryAll("table");
  const rows = [];

  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll("tr:first-child th, tr:first-child td")).map((cell) => normalizeText(cell.textContent));
    for (const row of Array.from(table.querySelectorAll("tr")).slice(1)) {
      const cells = Array.from(row.children).map((cell) => normalizeText(cell.textContent));
      if (!cells.some(Boolean)) continue;

      const firstLink = row.querySelector("a[href]");
      const record = {
        source,
        title: normalizeText(firstLink?.textContent || cells[0]),
        description: normalizeText(row.textContent),
        url: absoluteUrl(firstLink?.getAttribute("href")),
        columns: {},
        ids: { courseOrgUnitId: getOrgUnitId() }
      };

      headers.forEach((header, index) => {
        if (header) record.columns[header] = cells[index] || "";
      });

      const assignmentId = record.url?.match(/[?&]db=(\d+)/)?.[1] || null;
      if (assignmentId) record.ids.assignmentFolderId = assignmentId;

      rows.push(record);
    }
  }

  return rows.filter((row) => row.title && !/^No Category$/i.test(row.title));
}

function updateAssignmentRecordFromLink(link, byId) {
  const href = absoluteUrl(link.getAttribute("href"));
  const assignmentFolderId = href?.match(/[?&]db=(\d+)/)?.[1] || null;
  if (!assignmentFolderId) return;

  const row = link.closest("tr, li, div");
  const rowText = normalizeText(row?.textContent || link.textContent);
  const existing = byId.get(assignmentFolderId) || {
    source: "assignment",
    title: "",
    description: "",
    url: href,
    status: "",
    ids: { courseOrgUnitId: getOrgUnitId(), assignmentFolderId },
    columns: {},
    historyUrl: `${window.location.origin}/d2l/lms/dropbox/user/folders_history.d2l?db=${assignmentFolderId}&ou=${getOrgUnitId()}`,
    feedbackUrl: `${window.location.origin}/d2l/lms/dropbox/user/folder_user_view_feedback.d2l?db=${assignmentFolderId}&ou=${getOrgUnitId()}`
  };

  const linkText = normalizeText(link.textContent || link.getAttribute("aria-label") || link.title);
  const aria = normalizeText(link.getAttribute("aria-label"));
  const candidateTitle = aria
    .replace(/^Dropbox for /i, "")
    .replace(/^Submit files to /i, "")
    .replace(/^Submission history for /i, "")
    .replace(/^View Feedback$/i, "");

  if (!existing.title && candidateTitle && !/^(Not Submitted|Unread|View Feedback|\d+ Submission)/i.test(candidateTitle)) {
    existing.title = candidateTitle;
  }

  existing.description = existing.description.length > rowText.length ? existing.description : rowText;
  if (/Not Submitted/i.test(rowText)) existing.status = "notSubmitted";
  if (/\d+\s+Submission/i.test(rowText)) existing.status = "submitted";
  if (/Unread/i.test(rowText)) existing.feedbackStatus = "unreadFeedback";

  const due = rowText.match(/Due on [A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M/)?.[0] || null;
  const availability = rowText.match(/[A-Z][a-z]{2} \d{1,2} - [A-Z][a-z]{2} \d{1,2}/)?.[0] || null;
  if (due) existing.dueAtText = due;
  if (availability) existing.availabilityText = availability;

  if (/history/i.test(href)) existing.historyUrl = href;
  else if (/feedback/i.test(href)) existing.feedbackUrl = href;
  else existing.url = href;

  if (linkText) existing.columns.lastSeenLinkText = linkText;
  byId.set(assignmentFolderId, existing);
}

function extractAssignments() {
  const tableRows = extractTableRows("assignment");
  const folderLinks = queryAll("a[href*='db='], a[href*='folder_submit_files.d2l'], a[href*='folders_history.d2l'], a[href*='folder_user_view_feedback.d2l']");
  const byId = new Map();

  for (const link of folderLinks) {
    updateAssignmentRecordFromLink(link, byId);
  }

  const linkRows = Array.from(byId.values()).filter((item) => item.title || item.description);
  const seenIds = new Set(tableRows.map((item) => item.ids?.assignmentFolderId).filter(Boolean));
  const combined = [
    ...tableRows,
    ...linkRows.filter((item) => !seenIds.has(item.ids.assignmentFolderId))
  ];

  return combined.length ? combined : extractAssignmentsFallback();
}

function extractAssignmentsFallback() {
  const seen = new Set();
  return queryAll("a[href*='/dropbox/user/'], a[href*='/dropbox/']")
    .map((link) => {
      const href = absoluteUrl(link.getAttribute("href"));
      const title = normalizeText(link.getAttribute("aria-label") || link.textContent);
      if (!href || !title || seen.has(href)) return null;
      seen.add(href);

      const row = link.closest("li, tr, article, div");
      const rowText = normalizeText(row?.textContent || title);
      return {
        source: "assignment",
        title,
        description: rowText,
        url: href,
        status: /Not Submitted/i.test(rowText) ? "notSubmitted" : /\d+\s+Submission/i.test(rowText) ? "submitted" : "",
        dueAtText: rowText.match(/Due on [A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M/)?.[0] || null,
        historyUrl: href.match(/[?&]db=(\d+)/)
          ? `${window.location.origin}/d2l/lms/dropbox/user/folders_history.d2l?db=${href.match(/[?&]db=(\d+)/)?.[1]}&ou=${getOrgUnitId()}`
          : "",
        feedbackUrl: href.match(/[?&]db=(\d+)/)
          ? `${window.location.origin}/d2l/lms/dropbox/user/folder_user_view_feedback.d2l?db=${href.match(/[?&]db=(\d+)/)?.[1]}&ou=${getOrgUnitId()}`
          : "",
        ids: { courseOrgUnitId: getOrgUnitId(), assignmentFolderId: href.match(/[?&]db=(\d+)/)?.[1] || "" }
      };
    })
    .filter(Boolean);
}

function assignmentFolderIdFromUrl(url = window.location.href) {
  return String(url || "").match(/[?&]db=(\d+)/)?.[1] || "";
}

function isDiscussionAttachmentUrl(href) {
  return /\/d2l\/le\/\d+\/discussions\/posts\/\d+\/ViewAttachment(?:\?|$)/i.test(href || "");
}

function discussionAttachmentRowFromLink(link, context = {}) {
  const href = absoluteUrl(link.getAttribute("href"));
  const label = normalizeText(link.textContent || link.getAttribute("aria-label") || link.title);
  if (!href || !label || !isDiscussionAttachmentUrl(href)) return null;
  const postId = context.postId || href.match(/\/posts\/(\d+)\//i)?.[1] || "";
  return {
    source: "discussionAttachment",
    title: label,
    description: normalizeText(link.closest("li, tr, div, section")?.textContent || label).slice(0, 1200),
    url: href,
    downloadUrl: href,
    suggestedFileName: label,
    columns: {
      recoveredFrom: context.recoveredFrom || "discussionAttachmentLink",
      ...(context.postSubject ? { postSubject: context.postSubject } : {})
    },
    ids: { courseOrgUnitId: getOrgUnitId(), postId }
  };
}

const SUBMISSION_FILE_SELECTOR = [
  "a[href*='dropbox'][href*='file']", "a[href*='dropbox'][href*='download']", "a[href*='download']",
  "a[href*='GetFile']", "a[href*='viewFile.d2lfile']", "a[href*='fileId=']", "a[href*='/files/']",
  "a[href*='/lp/file']", "a[href*='/lp/files']", "a[href*='/content/enforced/']", "a[href$='.pdf']",
  "a[href$='.doc']", "a[href$='.docx']", "a[href$='.ppt']", "a[href$='.pptx']", "a[href$='.xls']",
  "a[href$='.xlsx']", "a[href$='.csv']", "a[href$='.zip']"
].join(", ");

function submittedFileRows(context = {}) {
  const rows = [];
  const seen = new Set();
  for (const link of queryAll(SUBMISSION_FILE_SELECTOR)) {
    const href = absoluteUrl(link.getAttribute("href"));
    const text = normalizeText(link.textContent || link.getAttribute("aria-label") || link.title);
    if (!href || !text || !looksLikeFileUrl(href)) continue;
    if (/^\s*(view|open|details?|feedback|rubric)\s*$/i.test(text)) continue;
    const key = `${href}::${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const container = link.closest("li, tr, article, section, div");
    rows.push({
      source: "submittedFile",
      title: text,
      description: normalizeText(container?.textContent || text).slice(0, 1200),
      url: href,
      downloadUrl: href,
      suggestedFileName: text,
      columns: {
        recoveredFrom: context.recoveredFrom || "assignmentPageLink",
        submittedAtText: context.submittedAtText || ""
      },
      ids: {
        courseOrgUnitId: getOrgUnitId(),
        assignmentFolderId: context.assignmentFolderId || assignmentFolderIdFromUrl(),
        dropboxFolderId: context.assignmentFolderId || assignmentFolderIdFromUrl()
      }
    });
  }
  return rows;
}

// compactLabelValueRows provided by shared

function generatedAssignmentProbeLinks(orgUnitId) {
  if (!orgUnitId) return [];
  const byFolder = new Map();
  for (const link of queryAll("a[href*='db='], a[href*='folder_submit_files.d2l'], a[href*='folders_history.d2l'], a[href*='folder_user_view_feedback.d2l']")) {
    const href = absoluteUrl(link.getAttribute("href"));
    const folderId = href?.match(/[?&]db=(\d+)/)?.[1] || "";
    if (!folderId || byFolder.has(folderId)) continue;
    const row = link.closest("tr, li, article, div");
    const title = normalizeText(link.getAttribute("aria-label") || link.textContent || row?.textContent || `Assignment ${folderId}`)
      .replace(/^Dropbox for /i, "")
      .replace(/^Submit files to /i, "")
      .replace(/^Submission history for /i, "")
      .replace(/^View Feedback$/i, "");
    byFolder.set(folderId, [
      {
        title: `${title || `Assignment ${folderId}`} - Submission history`,
        url: `${window.location.origin}/d2l/lms/dropbox/user/folders_history.d2l?db=${folderId}&ou=${orgUnitId}`,
        sourcePageType: "generatedAssignmentProbe",
        courseOrgUnitId: orgUnitId
      },
      {
        title: `${title || `Assignment ${folderId}`} - Feedback`,
        url: `${window.location.origin}/d2l/lms/dropbox/user/folder_user_view_feedback.d2l?db=${folderId}&ou=${orgUnitId}`,
        sourcePageType: "generatedAssignmentProbe",
        courseOrgUnitId: orgUnitId
      }
    ]);
  }
  return Array.from(byFolder.values()).flat();
}

function extractAssignmentSubmissions() {
  const rows = extractTableRows("assignmentSubmission").filter(isUsefulAssignmentSubmissionRow);
  const text = pageText();
  const assignmentFolderId = assignmentFolderIdFromUrl();
  const submittedAtText = text.match(/\b(?:Submitted|Submission Date|Date Submitted|Last Submitted)\b\s*:?\s*([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}[^.]{0,60})/i)?.[0] || "";
  const fileLinks = submittedFileRows({ assignmentFolderId, submittedAtText, recoveredFrom: "assignmentSubmissionHistoryPage" });
  const labelValues = compactLabelValueRows(text, ["Submitted", "Submission Date", "Date Submitted", "Last Submitted", "Status", "Score", "Grade", "Feedback"]);

  const summary = /submission|submitted|file|feedback|score|grade|no submission|not submitted/i.test(text)
    ? [{
        source: "assignmentSubmission",
        title: headingText(1) || headingText() || "Assignment submission history",
        description: text.slice(0, 2400),
        url: window.location.href,
        status: /not submitted|no submission/i.test(text) ? "notSubmittedVisible" : /submitted|submission/i.test(text) ? "submissionHistoryVisible" : "checked",
        columns: {
          recoveredFrom: "assignmentSubmissionHistoryPage",
          submittedAtText,
          submittedFileCount: fileLinks.length,
          ...labelValues
        },
        ids: { courseOrgUnitId: getOrgUnitId(), assignmentFolderId, dropboxFolderId: assignmentFolderId }
      }]
    : [];

  return [...rows, ...summary, ...fileLinks];
}

function isUsefulAssignmentSubmissionRow(row) {
  const columnLabels = Object.keys(row?.columns || {}).join(" ");
  return Boolean(row?.ids?.assignmentFolderId || row?.ids?.submissionId)
    || /\b(?:submission id|submissions?|date submitted|submission date|last submitted|status|score|grade|feedback)\b/i.test(columnLabels);
}

  Object.assign(content, {
    compactLabelValueRows,
    extractTableRows,
    extractAssignments,
    extractAssignmentsFallback,
    assignmentFolderIdFromUrl,
    isDiscussionAttachmentUrl,
    discussionAttachmentRowFromLink,
    submittedFileRows,
    generatedAssignmentProbeLinks,
    isUsefulAssignmentSubmissionRow,
    extractAssignmentSubmissions
  });
})();
