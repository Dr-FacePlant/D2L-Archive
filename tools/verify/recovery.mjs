import {
  walkFiles as walkFilesHelper,
  normalizeText as normalizeTextHelper,
  extractDueText,
  extractAvailabilityText,
  baseRecoveredRow,
  assignmentFolderIdFromSnapshot,
  compactAssignmentLabelValues,
  sourceForRecoveredFile as sourceForRecoveredFileHelper,
  parsePageSnapshot as parsePageSnapshotHelper,
  parseRecoveredFile as parseRecoveredFileHelper,
  parseDiscussionFeedback
} from "./recovery-helpers.mjs";

function parseContentTopic(snapshot, text, parseJson) {
  const rows = [];
  if (/\/viewContent\/\d+\/View/i.test(snapshot.itemUrl || "")) {
    const contentObjectId = snapshot.itemUrl.match(/\/viewContent\/(\d+)\/View/i)?.[1] || "";
    const title = snapshot.title.replace(/\s+-\s+[^-]+ Section .*$/i, "").trim();
    const type = text.match(/\b(Web Page|File|Link|Discussion Topic|Checklist|Quiz|Assignment|External Resource)\b/i)?.[1] || "";
    rows.push({
      ...baseRecoveredRow(snapshot, "contentTopic", title || snapshot.title, text.slice(0, 1200)),
      type,
      dueAtText: extractDueText(text),
      availabilityText: extractAvailabilityText(text),
      columns: JSON.stringify({
        recoveredFrom: "contentPageText",
        contentObjectId,
        completionText: text.match(/\d+(?:\.\d+)?\s*%\s*\d+\s+of\s+\d+\s+topics complete/i)?.[0] || text.match(/\d+(?:\.\d+)?\s*%\s*\d+\s+of\s+\d+\s+items complete/i)?.[0] || ""
      }),
      ids: JSON.stringify({ ...parseJson(snapshot.ids), contentObjectId })
    });
  }
  return rows;
}

function parseQuizzes(snapshot, text) {
  const rows = [];
  const quizPattern = /((?:Quiz|Test|Final|Exam|GA Bonus Quiz)[^]*?)(?=(?:Quiz|Test|Final|Exam|GA Bonus Quiz)\s+\d|Past Quizzes|Future Quizzes|Current Quizzes|$)/gi;
  for (const match of text.matchAll(quizPattern)) {
    const chunk = match[1].replace(/^(Current|Future|Past) Quizzes\s+/i, "").trim();
    const title = chunk.match(/^(.+?)\s+Due on\s+/i)?.[1] || "";
    if (!title || title.length > 120) continue;
    const due = chunk.match(/Due on\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)/)?.[1] || extractDueText(chunk);
    const availability = chunk.match(/Available on\s+(.+?)(?=\s+\d+\s*\/\s*\d+|Feedback:|$)/)?.[0] || "";
    const attempts = chunk.match(/(\d+\s*\/\s*\d+)/)?.[1] || "";
    rows.push({
      ...baseRecoveredRow(snapshot, "quiz", title, chunk),
      dueAtText: due,
      availabilityText: availability,
      columns: JSON.stringify({ recoveredFrom: "quizPageText", attempts })
    });
  }
  return rows;
}

function parseAssignments(snapshot, text) {
  const rows = [];
  const assignmentPattern = /([A-Z0-9][^\n]+?)\s+(?:Due on\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}|Not submitted|Submitted|\d+\s+Submission|\d+\s+Files?|Score|Feedback:)([^]*?)(?=(?:[A-Z0-9][^\n]+?)\s+(?:Due on|Not submitted|Submitted|\d+\s+Submission|Score|Feedback:)|$)/gi;
  for (const match of text.matchAll(assignmentPattern)) {
    const title = match[1].trim();
    if (!title || /Assignments\s+-|Course Home|Content Syllabus/i.test(title)) continue;
    const chunk = match[0].trim();
    rows.push({
      ...baseRecoveredRow(snapshot, "assignment", title, chunk),
      dueAtText: extractDueText(chunk),
      availabilityText: extractAvailabilityText(chunk),
      columns: JSON.stringify({ recoveredFrom: "assignmentPageText", details: compactAssignmentLabelValues(chunk) })
    });
  }
  return rows;
}

function parseSubmissions(snapshot, text) {
  const rows = [];
  const assignmentTitle = snapshot.title.replace(/^View Submissions\s+-\s+/i, "").replace(/\s+-\s+[^-]+ Section .*$/i, "").trim();
  const folderId = assignmentFolderIdFromSnapshot(snapshot);
  const submissionPattern = /Submission\s+#?(\d+)[^]*?(?=(?:Submission\s+#?\d+)|$)/gi;
  for (const match of text.matchAll(submissionPattern)) {
    const chunk = match[0];
    const submittedAt = chunk.match(/Date Submitted:\s*([A-Z][a-z]{2,9}\s+\d{1,2},?\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)/i)?.[1]
      || chunk.match(/Submitted:\s*([A-Z][a-z]{2,9}\s+\d{1,2},?\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)/i)?.[1]
      || "";
    const submittedFiles = [...chunk.matchAll(/([^\n\r]+\.(?:docx?|pdf|zip|py|sql|txt|pptx?|xlsx?))\b/gi)].map((m) => m[1]);
    rows.push({
      ...baseRecoveredRow(snapshot, "assignmentSubmission", `${assignmentTitle || snapshot.title} - Submission ${match[1]}`, chunk),
      status: "submitted",
      columns: JSON.stringify({ recoveredFrom: "submissionHistoryPageText", folderId, submissionNumber: match[1], submittedAt, submittedFiles })
    });
    for (const fileName of submittedFiles) {
      rows.push({
        ...baseRecoveredRow(snapshot, "submittedFile", fileName, chunk),
        status: "submitted",
        columns: JSON.stringify({ recoveredFrom: "submissionHistoryPageText", folderId, submissionNumber: match[1], submittedAt, fileName })
      });
    }
  }
  return rows;
}

function parseFeedback(snapshot, text) {
  const rows = [];
  const assignmentTitle = snapshot.title.replace(/^View Feedback\s+-\s+/i, "").replace(/\s+-\s+[^-]+ Section .*$/i, "").trim();
  const folderId = assignmentFolderIdFromSnapshot(snapshot);
  const score = text.match(/Score\s+([0-9.]+\s*\/\s*[0-9.]+)/i)?.[1] || text.match(/Overall Grade[^:]*:\s*([0-9.]+\s*\/\s*[0-9.]+)/i)?.[1] || "";
  const feedbackText = text.match(/Feedback Date\s+[^\n]+\n([^]*?)(?=(?:Rubrics|Individual Feedback|Done|$))/i)?.[1]?.trim()
    || text.match(/Instructor Feedback\s*\n([^]*?)(?=(?:Rubrics|Individual Feedback|Done|$))/i)?.[1]?.trim()
    || "";
  rows.push({
    ...baseRecoveredRow(snapshot, "assignmentFeedback", `${assignmentTitle || snapshot.title} - Feedback`, text),
    status: "graded",
    columns: JSON.stringify({ recoveredFrom: "assignmentFeedbackPageText", folderId, score, feedbackText })
  });
  if (/rubric|criteria|criterion|level achieved/i.test(text)) {
    rows.push({
      ...baseRecoveredRow(snapshot, "rubricFeedback", `${assignmentTitle || snapshot.title} - Rubric Feedback`, text),
      status: "graded",
      columns: JSON.stringify({ recoveredFrom: "assignmentFeedbackPageText", folderId, score })
    });
  }
  return rows;
}

function parseCourseHome(snapshot, text) {
  const rows = [];
  const announcementArea = text.split(/\bCalendar\b/i)[0] || text;
  const postedPattern = /(.{8,160}?)\s+Posted\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)/g;
  for (const match of announcementArea.matchAll(postedPattern)) {
    const title = match[1].replace(/^.*?\bAnnouncements\s+/i, "").replace(/\s+/g, " ").trim();
    if (!title || /Content Browser|Course Home|Calendar$/i.test(title)) continue;
    rows.push({
      ...baseRecoveredRow(snapshot, "announcement", title.slice(-140), match[0]),
      columns: JSON.stringify({ recoveredFrom: "courseHomeAnnouncementText", postedAt: match[2] })
    });
  }
  return rows;
}

function parseGrades(snapshot, text) {
  const rows = [];
  const gradePattern = /([A-Z][^]*?)\s+(\d+(?:\.\d+)?|-) ?\/ ?(\d+(?:\.\d+)?)/g;
  for (const match of text.matchAll(gradePattern)) {
    const title = match[1].split(/Grade Item|Points|Grade|Comments and Assessments/).pop().trim().slice(-120);
    if (!title || title.length < 3) continue;
    rows.push({
      ...baseRecoveredRow(snapshot, "gradeItem", title, match[0]),
      status: match[2] === "-" ? "notGraded" : "graded",
      columns: JSON.stringify({ recoveredFrom: "gradePageText", pointsEarned: match[2], pointsPossible: match[3] })
    });
  }
  return rows;
}

function parseDiscussion(snapshot, text, parseJson) {
  const rows = [];
  if (/Discussion|Start a New Thread|View Graded Rubric/i.test(text)) {
    rows.push(...parseDiscussionFeedback(snapshot, text, parseJson));
  }
  if (snapshot.itemUrl && /\/discussions\/topics\/(\d+)\/View/i.test(snapshot.itemUrl)) {
    const topicId = snapshot.itemUrl.match(/\/discussions\/topics\/(\d+)\/View/i)[1];
    const title = snapshot.title.replace(/\s+-\s+[^-]+ Section .*$/i, "").trim();
    rows.push({
      ...baseRecoveredRow(snapshot, "discussionTopic", title || snapshot.title, text.slice(0, 1200)),
      gate: /must post first/i.test(text) ? "mustPostFirst" : "",
      columns: JSON.stringify({ recoveredFrom: "discussionTopicPageText", topicId, visiblePosts: /must post first/i.test(text) ? "blockedUntilStudentPosts" : "unknown" }),
      ids: JSON.stringify({ ...parseJson(snapshot.ids), discussionTopicId: topicId })
    });
    const rubricTitle = text.match(/Rubrics\s+(.+?Rubric)\b/i)?.[1] || "";
    if (rubricTitle) {
      rows.push({
        ...baseRecoveredRow(snapshot, "rubric", rubricTitle, text.slice(0, 800)),
        gate: /must post first/i.test(text) ? "mustPostFirst" : "",
        columns: JSON.stringify({ recoveredFrom: "discussionTopicPageText", topicId, rubricContext: title || snapshot.title }),
        ids: JSON.stringify({ ...parseJson(snapshot.ids), discussionTopicId: topicId })
      });
    }
  }
  if (snapshot.itemUrl && /\/discussions\/threads\/(\d+)\/View/i.test(snapshot.itemUrl)) {
    const threadId = snapshot.itemUrl.match(/\/discussions\/threads\/(\d+)\/View/i)[1];
    const title = snapshot.title.replace(/\s+-\s+[^-]+ Section .*$/i, "").trim();
    const author = text.match(/View profile card for\s+(.+?)\s+/i)?.[1] || "";
    const postedAt = text.match(/\bposted\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)\b/i)?.[1] || "";
    rows.push({
      ...baseRecoveredRow(snapshot, "discussionPost", title || snapshot.title, text.slice(0, 1600)),
      status: /Unread post/i.test(text) ? "unread" : "",
      columns: JSON.stringify({ recoveredFrom: "discussionThreadPageText", threadId, author, postedAt, repliesVisible: /Reply to Thread/i.test(text) ? "yes" : "unknown" }),
      ids: JSON.stringify({ ...parseJson(snapshot.ids), postId: threadId })
    });
  }
  return rows;
}

function parseAssignmentContent(snapshot, text, parseJson) {
  const rows = [];
  if (/\/viewContent\/\d+\/View/i.test(snapshot.itemUrl || "") && (/Upload Submission|Task:\s*Submit to complete this assignment/i.test(text) || /Assignment|Homework|Dropbox|Project|Submission/i.test(snapshot.title))) {
    const contentObjectId = snapshot.itemUrl.match(/\/viewContent\/(\d+)\/View/i)?.[1] || "";
    const title = snapshot.title.replace(/\s+-\s+[^-]+ Section .*$/i, "").trim();
    const isSubmissionPage = /Upload Submission|Task:\s*Submit to complete this assignment|Dropbox|Submission/i.test(`${text} ${snapshot.title}`);
    rows.push({
      ...baseRecoveredRow(snapshot, isSubmissionPage ? "assignment" : "assignmentInstruction", title || snapshot.title, text.slice(0, 1400)),
      status: /Submitted|View Feedback/i.test(text) ? "submittedOrFeedbackVisible" : /Upload Submission|Submit to complete/i.test(text) ? "submissionOpen" : "",
      dueAtText: extractDueText(text),
      availabilityText: extractAvailabilityText(text),
      columns: JSON.stringify({ recoveredFrom: "assignmentContentPageText", contentObjectId, uploadSubmissionVisible: /Upload Submission/i.test(text), commentsVisible: /Comments/i.test(text) }),
      ids: JSON.stringify({ ...parseJson(snapshot.ids), contentObjectId })
    });
  }
  return rows;
}

function parseChecklistAndCalendar(snapshot, text, parseJson) {
  const rows = [];
  if (/checklist/i.test(`${snapshot.pageType} ${snapshot.title} ${snapshot.itemUrl}`)) {
    const checklistId = snapshot.itemUrl?.match(/[?&]checklistId=(\d+)/)?.[1] || snapshot.itemUrl?.match(/\/viewContent\/(\d+)\/View/i)?.[1] || "";
    const itemPattern = /(?:Completed at|Due on|Due at|Available until|Available on)?\s*([A-Z0-9][^\n]+?)(?:Completed at|Due on|Due at|Available until|Available on|$)/gi;
    for (const match of text.matchAll(itemPattern)) {
      const itemTitle = match[1]
        .replace(/^.*?\bCompleted at\s+.*?\\s+/i, "")
        .replace(/^(?:\d{1,2}:\d{2}\s+[AP]M\s+on\s+[A-Z][a-z]+,\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*)+/i, "")
        .replace(/^.*?\b[AP]M\s+on\s+[A-Z][a-z]+,\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!itemTitle || /Course Home|Previous Next|Faculty Resources/i.test(itemTitle)) continue;
      const chunk = match[0];
      rows.push({
        ...baseRecoveredRow(snapshot, "checklistItem", itemTitle.slice(-160), chunk),
        status: /Completed at/i.test(chunk) ? "completed" : "open",
        dueAtText: extractDueText(chunk),
        columns: JSON.stringify({ recoveredFrom: "checklistPageText", checklistId, completedAt: chunk.match(/Completed at\s+(.+)$/i)?.[1] || "" }),
        ids: JSON.stringify({ ...parseJson(snapshot.ids), checklistId })
      });
    }
  }
  if (snapshot.pageType === "calendar" && /\/calendar\/\d+\/event\/(\d+)\/detailsview/i.test(snapshot.itemUrl || "")) {
    const eventId = snapshot.itemUrl.match(/\/event\/(\d+)\/detailsview/i)[1];
    const title = snapshot.title.replace(/\s+-\s+[^-]+ Section .*$/i, "").trim();
    rows.push({
      ...baseRecoveredRow(snapshot, "calendarEvent", title || snapshot.title, text.slice(0, 1000)),
      dueAtText: extractDueText(text),
      availabilityText: extractAvailabilityText(text) || text.match(/Starts\s+[A-Z][a-z]{2,9}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M/)?.[0] || "",
      columns: JSON.stringify({ recoveredFrom: "calendarDetailPageText", eventId, taskText: /Tasks Add a task/i.test(text) ? "tasksWidgetVisible" : "" }),
      ids: JSON.stringify({ ...parseJson(snapshot.ids), calendarEventId: eventId })
    });
  }
  return rows;
}

function parseQuizSubmissions(snapshot, text) {
  const rows = [];
  if (snapshot.pageType === "quizSubmissions") {
    const quizTitle = snapshot.title.match(/Quiz Submissions\s+-\s+(.+?)(?:\s+-\s+|$)/i)?.[1] || snapshot.title;
    for (const match of text.matchAll(/Attempt\s+(\d+)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?:\s*-\s*([\d.]+)\s*%)?/gi)) {
      rows.push({
        ...baseRecoveredRow(snapshot, "quizSubmission", `${quizTitle} - Attempt ${match[1]}`, match[0]),
        status: "graded",
        columns: JSON.stringify({ recoveredFrom: "quizSubmissionPageText", attempt: match[1], pointsEarned: match[2], pointsPossible: match[3], percent: match[4] || "" })
      });
    }
    const overall = text.match(/Overall Grade[^:]*:\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?:\s*-\s*([\d.]+)\s*%)?/i);
    if (overall) {
      rows.push({
        ...baseRecoveredRow(snapshot, "quizSummaryRow", `${quizTitle} - Overall Grade`, overall[0]),
        status: "graded",
        columns: JSON.stringify({ recoveredFrom: "quizSubmissionPageText", pointsEarned: overall[1], pointsPossible: overall[2], percent: overall[3] || "" })
      });
    }
  }
  return rows;
}

export function recoveredRowsFromPage(snapshot, parseJson = JSON.parse) {
  const text = snapshot.description || "";
  const rows = [snapshot];
  rows.push(...parseContentTopic(snapshot, text, parseJson));
  if (snapshot.pageType === "quizzes") rows.push(...parseQuizzes(snapshot, text));
  if (snapshot.pageType === "assignments") rows.push(...parseAssignments(snapshot, text));
  if (snapshot.pageType === "assignmentSubmissions" || /\/dropbox\/user\/folders_history\.d2l/i.test(snapshot.itemUrl || "")) rows.push(...parseSubmissions(snapshot, text));
  if (snapshot.pageType === "assignmentFeedback" || /\/dropbox\/user\/folder_user_view_feedback\.d2l/i.test(snapshot.itemUrl || "")) rows.push(...parseFeedback(snapshot, text));
  if (snapshot.pageType === "courseHome") rows.push(...parseCourseHome(snapshot, text));
  if (snapshot.pageType === "grades") rows.push(...parseGrades(snapshot, text));
  rows.push(...parseDiscussion(snapshot, text, parseJson));
  rows.push(...parseAssignmentContent(snapshot, text, parseJson));
  rows.push(...parseChecklistAndCalendar(snapshot, text, parseJson));
  rows.push(...parseQuizSubmissions(snapshot, text));
  return rows;
}

export function recoverManifestFromArchive({ root, fs, path, archiveRoot, parseJson = JSON.parse }) {
  const pageFiles = walkFilesHelper(fs, path, path.join(root, "courses")).filter((file) => file.includes(`${path.sep}pages${path.sep}`) && file.endsWith(".md"));
  const downloadedFiles = walkFilesHelper(fs, path, path.join(root, "courses")).filter((file) => file.includes(`${path.sep}files${path.sep}`));
  const rows = [
    ...pageFiles.flatMap((file) => recoveredRowsFromPage(parsePageSnapshotHelper(file, fs, path), parseJson)),
    ...downloadedFiles.map((file) => parseRecoveredFileHelper(file, path, archiveRoot))
  ];
  return {
    exportedAt: new Date().toISOString(), phase: "recovered", recovered: true,
    recovery: {
      reason: "manifest.json was missing; reconstructed from page snapshots and downloaded files",
      pageSnapshots: pageFiles.length, downloadedFiles: downloadedFiles.length
    },
    rows,
    audit: {
      generatedAt: new Date().toISOString(),
      totals: {
        pagesVisited: pageFiles.length, rows: rows.length,
        courses: new Set(rows.map((row) => row.courseOrgUnitId).filter(Boolean)).size,
        skipped: 0, failed: "unknown", uncertain: "unknown", warnings: 1
      }
    }
  };
}

export function createRecoveryTools({ fs, path, archiveRoot, parseJson }) {
  return {
    walkFiles: (dir) => walkFilesHelper(fs, path, dir),
    normalizeText: normalizeTextHelper,
    extractDueText,
    extractAvailabilityText,
    parsePageSnapshot: (filePath) => parsePageSnapshotHelper(filePath, fs, path),
    baseRecoveredRow,
    assignmentFolderIdFromSnapshot,
    compactAssignmentLabelValues,
    recoveredRowsFromPage: (snapshot) => recoveredRowsFromPage(snapshot, parseJson),
    sourceForRecoveredFile: (filePath) => sourceForRecoveredFileHelper(filePath, path),
    parseRecoveredFile: (filePath) => parseRecoveredFileHelper(filePath, path, archiveRoot),
    recoverManifestFromArchive: (root) => recoverManifestFromArchive({ root, fs, path, archiveRoot, parseJson })
  };
}
