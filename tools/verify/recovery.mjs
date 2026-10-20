export function createRecoveryTools({ fs, path, archiveRoot, parseJson }) {
function walkFiles(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(fullPath));
    else found.push(fullPath);
  }
  return found;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractDueText(text) {
  return text.match(/Due(?: on)?:?\s+[A-Z][a-z]{2,9}\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s+[AP]M)?/)?.[0]
    || text.match(/Due\s+[A-Z][a-z]{2,9}\s+\d{1,2}\s+at\s+\d{1,2}:\d{2}\s+[AP]M/)?.[0]
    || text.match(/Due at\s+\d{1,2}:\d{2}\s+[AP]M\s+on\s+[A-Z][a-z]+,\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}/)?.[0]
    || text.match(/Due\s+[A-Z][a-z]{2,9}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M/)?.[0]
    || "";
}

function extractAvailabilityText(text) {
  return text.match(/Available on\s+[A-Z][a-z]{2,9}\s+\d{1,2},?\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M(?:.*?)(?=\.|$)/)?.[0]
    || text.match(/Available until\s+[A-Z][a-z]{2,9}\s+\d{1,2},?\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M(?:.*?)(?=\.|$)/)?.[0]
    || "";
}

function parsePageSnapshot(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const title = text.match(/^#\s+(.+)$/m)?.[1] || path.basename(filePath, ".md");
  const url = text.match(/^- URL:\s*(.*)$/m)?.[1] || "";
  const pageType = text.match(/^- Page type:\s*(.*)$/m)?.[1] || "unknown";
  const course = text.match(/^- Course:\s*(.*)$/m)?.[1] || "";
  const courseOrgUnitId = text.match(/^- Course org unit:\s*(.*)$/m)?.[1] || "";
  const body = text.split("\n## Text\n").slice(1).join("\n## Text\n").trim();
  return {
    crawledAt: "",
    pageType,
    pageTitle: title,
    pageUrl: url,
    courseOrgUnitId,
    courseTitle: course,
    source: pageType === "unknown" ? "recoveredPage" : `${pageType}Page`,
    title,
    description: body.slice(0, 2000),
    status: "",
    gate: "",
    type: "",
    dueAtText: extractDueText(body),
    availabilityText: extractAvailabilityText(body),
    itemUrl: url,
    downloadUrl: "",
    suggestedFileName: "",
    historyUrl: "",
    feedbackUrl: "",
    localPath: "",
    downloadError: "",
    localPageTextPath: path.relative(path.dirname(archiveRoot), filePath),
    localPageTextSnippet: body.replace(/\s+/g, " ").trim().slice(0, 1200),
    ids: JSON.stringify({ courseOrgUnitId }),
    columns: JSON.stringify({ recoveredFrom: "pageSnapshot", filePath })
  };
}

function baseRecoveredRow(snapshot, source, title, description = "") {
  return {
    ...snapshot,
    source,
    title: title || snapshot.title,
    description: description || snapshot.description,
    columns: JSON.stringify({ ...parseJson(snapshot.columns), recoveredAs: source })
  };
}

function assignmentFolderIdFromSnapshot(snapshot) {
  return (snapshot.itemUrl || "").match(/[?&]db=(\d+)/)?.[1] || "";
}

function compactAssignmentLabelValues(text) {
  const labels = ["Submitted", "Submission Date", "Date Submitted", "Last Submitted", "Status", "Score", "Grade", "Overall Feedback", "Feedback", "Comments", "Rubric", "Level Achieved"];
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const out = {};
  for (const label of labels) {
    const pattern = new RegExp(`\\b${label}\\b\\s*:?\\s*([^]+?)(?=\\s+(?:${labels.join("|")})\\b\\s*:?|$)`, "i");
    const value = normalized.match(pattern)?.[1]?.trim();
    if (value) out[label.replace(/\s+/g, "_").toLowerCase()] = value.slice(0, 800);
  }
  return out;
}

function recoveredRowsFromPage(snapshot) {
  const text = snapshot.description || "";
  const rows = [snapshot];

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

  if (snapshot.pageType === "quizzes") {
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
  }

  if (snapshot.pageType === "assignments") {
    const assignmentChunks = text.split(/(?=Due on\s+|Not Submitted|Submitted|Unread|View Feedback)/i);
    for (const chunk of assignmentChunks) {
      const title = chunk.match(/(?:Dropbox for|Assignment|Project|Paper|Submission)\s+(.{3,120}?)(?=\s+Due|\s+Not Submitted|\s+Submitted|\s+Unread|$)/i)?.[0] || "";
      if (!title || /Assignments\s+-|Course Home|Content Syllabus/i.test(title)) continue;
      const due = chunk.match(/Due on\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)/)?.[1] || "";
      rows.push({
        ...baseRecoveredRow(snapshot, "assignment", title, chunk.slice(0, 1000)),
        status: /Not Submitted/i.test(chunk) ? "notSubmitted" : /Submitted/i.test(chunk) ? "submitted" : "",
        dueAtText: due,
        columns: JSON.stringify({ recoveredFrom: "assignmentPageText" })
      });
    }
  }

  if (snapshot.pageType === "assignmentSubmissions" || /\/dropbox\/user\/folders_history\.d2l/i.test(snapshot.itemUrl || "")) {
    const assignmentFolderId = assignmentFolderIdFromSnapshot(snapshot);
    const title = snapshot.title.replace(/\s+-\s+[^-]+ Section .*$/i, "").trim() || "Assignment submission history";
    const submittedAtText = text.match(/\b(?:Submitted|Submission Date|Date Submitted|Last Submitted)\b\s*:?\s*([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}[^.]{0,60})/i)?.[0] || "";
    const fileCountText = text.match(/\b(\d+)\s+(?:file|files|attachment|attachments)\b/i)?.[1] || "";
    rows.push({
      ...baseRecoveredRow(snapshot, "assignmentSubmission", title, text.slice(0, 1800)),
      status: /not submitted|no submission/i.test(text) ? "notSubmittedVisible" : /submitted|submission/i.test(text) ? "submissionHistoryVisible" : "checked",
      columns: JSON.stringify({
        recoveredFrom: "assignmentSubmissionHistoryPageText",
        assignmentFolderId,
        submittedAtText,
        fileCountText,
        ...compactAssignmentLabelValues(text)
      }),
      ids: JSON.stringify({ ...parseJson(snapshot.ids), assignmentFolderId, dropboxFolderId: assignmentFolderId })
    });
    for (const match of text.matchAll(/([A-Za-z0-9][^.\n]{2,160}\.(?:pdf|docx?|pptx?|xlsx?|csv|txt|rtf|zip|png|jpe?g|heic|mp4|mov|m4a|mp3))/gi)) {
      rows.push({
        ...baseRecoveredRow(snapshot, "submittedFile", match[1].trim(), match[0]),
        status: "filenameRecovered",
        columns: JSON.stringify({ recoveredFrom: "assignmentSubmissionHistoryPageText", assignmentFolderId }),
        ids: JSON.stringify({ ...parseJson(snapshot.ids), assignmentFolderId, dropboxFolderId: assignmentFolderId })
      });
    }
  }

  if (snapshot.pageType === "assignmentFeedback" || /\/dropbox\/user\/folder_user_view_feedback\.d2l/i.test(snapshot.itemUrl || "")) {
    const assignmentFolderId = assignmentFolderIdFromSnapshot(snapshot);
    const title = snapshot.title.replace(/\s+-\s+[^-]+ Section .*$/i, "").trim() || "Assignment feedback";
    const scoreText = text.match(/\b(?:Score|Grade|Overall Grade|Feedback)\b\s*:?\s*(?:\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?%|Complete|Incomplete)/i)?.[0] || "";
    rows.push({
      ...baseRecoveredRow(snapshot, "assignmentFeedback", title, text.slice(0, 1800)),
      status: /no feedback|feedback is not available|not graded/i.test(text) ? "noFeedbackVisible" : "feedbackPageVisible",
      columns: JSON.stringify({
        recoveredFrom: "assignmentFeedbackPageText",
        assignmentFolderId,
        scoreText,
        ...compactAssignmentLabelValues(text)
      }),
      ids: JSON.stringify({ ...parseJson(snapshot.ids), assignmentFolderId, dropboxFolderId: assignmentFolderId })
    });
    const rubricLevel = text.match(/Level Achieved:\s*([^]+?)(?=\s+Last Visited|\s+Previous Next|\s+Overall Feedback|$)/i)?.[1]?.trim() || "";
    if (/rubric|criteria|criterion|level achieved/i.test(text)) {
      rows.push({
        ...baseRecoveredRow(snapshot, "rubricFeedback", `${title} - Rubric Feedback`, rubricLevel || text.slice(0, 1000)),
        status: scoreText || rubricLevel ? "gradedOrVisible" : "rubricVisible",
        columns: JSON.stringify({ recoveredFrom: "assignmentFeedbackPageText", assignmentFolderId, rubricLevel }),
        ids: JSON.stringify({ ...parseJson(snapshot.ids), assignmentFolderId, dropboxFolderId: assignmentFolderId })
      });
    }
  }

  if (snapshot.pageType === "courseHome") {
    const announcementArea = text.split(/\bCalendar\b/i)[0] || text;
    const postedPattern = /(.{8,160}?)\s+Posted\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)/g;
    for (const match of announcementArea.matchAll(postedPattern)) {
      const title = match[1]
        .replace(/^.*?\bAnnouncements\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!title || /Content Browser|Course Home|Calendar$/i.test(title)) continue;
      rows.push({
        ...baseRecoveredRow(snapshot, "announcement", title.slice(-140), match[0]),
        columns: JSON.stringify({
          recoveredFrom: "courseHomeAnnouncementText",
          postedAt: match[2]
        })
      });
    }
  }

  if (snapshot.pageType === "grades") {
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
  }

  if (/Discussion|Start a New Thread|View Graded Rubric/i.test(text)) {
    const topicId = snapshot.itemUrl.match(/\/discussions\/topics\/(\d+)\/View/i)?.[1] || "";
    const contentObjectId = snapshot.itemUrl.match(/\/viewContent\/(\d+)\/View/i)?.[1] || "";
    const title = snapshot.title.replace(/\s+-\s+[^-]+ Section .*$/i, "").trim();
    const feedbackScore = text.match(/\bFeedback\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+([\d.]+)\s*%/i)
      || text.match(/\bAssessment Grade\s+([\d.]+)\s*%/i);
    if (feedbackScore) {
      rows.push({
        ...baseRecoveredRow(snapshot, "discussionFeedback", `${title || snapshot.title} - Feedback`, feedbackScore[0]),
        status: "graded",
        columns: JSON.stringify({
          recoveredFrom: "discussionVisibleFeedbackText",
          topicId,
          contentObjectId,
          pointsEarned: feedbackScore[2] ? feedbackScore[1] : "",
          pointsPossible: feedbackScore[2] || "",
          percent: feedbackScore[3] || feedbackScore[1] || ""
        }),
        ids: JSON.stringify({ ...parseJson(snapshot.ids), discussionTopicId: topicId, contentObjectId })
      });
    }
    const rubricLevel = text.match(/Level Achieved:\s*([^]+?)(?=\s+Last Visited|\s+Previous Next|$)/i)?.[1]?.trim() || "";
    if (rubricLevel) {
      rows.push({
        ...baseRecoveredRow(snapshot, "rubricFeedback", `${title || snapshot.title} - Rubric Feedback`, rubricLevel),
        status: "graded",
        columns: JSON.stringify({
          recoveredFrom: "discussionVisibleFeedbackText",
          topicId,
          contentObjectId,
          levelAchieved: rubricLevel
        }),
        ids: JSON.stringify({ ...parseJson(snapshot.ids), discussionTopicId: topicId, contentObjectId })
      });
    }
  }

  if (/\/viewContent\/\d+\/View/i.test(snapshot.itemUrl || "") && (/Upload Submission|Task:\s*Submit to complete this assignment/i.test(text) || /Assignment|Homework|Dropbox|Project|Submission/i.test(snapshot.title))) {
    const contentObjectId = snapshot.itemUrl.match(/\/viewContent\/(\d+)\/View/i)?.[1] || "";
    const title = snapshot.title.replace(/\s+-\s+[^-]+ Section .*$/i, "").trim();
    const isSubmissionPage = /Upload Submission|Task:\s*Submit to complete this assignment|Dropbox|Submission/i.test(`${text} ${snapshot.title}`);
    rows.push({
      ...baseRecoveredRow(snapshot, isSubmissionPage ? "assignment" : "assignmentInstruction", title || snapshot.title, text.slice(0, 1400)),
      status: /Submitted|View Feedback/i.test(text) ? "submittedOrFeedbackVisible" : /Upload Submission|Submit to complete/i.test(text) ? "submissionOpen" : "",
      dueAtText: extractDueText(text),
      availabilityText: extractAvailabilityText(text),
      columns: JSON.stringify({
        recoveredFrom: "assignmentContentPageText",
        contentObjectId,
        uploadSubmissionVisible: /Upload Submission/i.test(text),
        commentsVisible: /Comments/i.test(text)
      }),
      ids: JSON.stringify({ ...parseJson(snapshot.ids), contentObjectId })
    });
  }

  if (/checklist/i.test(`${snapshot.pageType} ${snapshot.title} ${snapshot.itemUrl}`)) {
    const checklistId = snapshot.itemUrl.match(/[?&]checklistId=(\d+)/)?.[1] || snapshot.itemUrl.match(/\/viewContent\/(\d+)\/View/i)?.[1] || "";
    const normalizedChecklistText = text.replace(/Completed at/g, " Completed at");
    const itemPattern = /(.{8,180}?)\s+Due(?: at\s+\d{1,2}:\d{2}\s+[AP]M\s+on\s+[A-Z][a-z]+,\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}|\s+[A-Z][a-z]{2,9}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)(?:\s+Completed at\s+.*?(?=(?:\s+[A-Z].{8,180}?\s+Due)|$))?/g;
    for (const match of normalizedChecklistText.matchAll(itemPattern)) {
      const itemTitle = match[1]
        .replace(/^.*?\bChecklist\s+\d+\s+/i, "")
        .replace(/^List\s+\d+\s+/i, "")
        .replace(/^.*?\bCompleted at\s+.*?\s+/i, "")
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
        columns: JSON.stringify({
          recoveredFrom: "checklistPageText",
          checklistId,
          completedAt: chunk.match(/Completed at\s+(.+)$/i)?.[1] || ""
        }),
        ids: JSON.stringify({ ...parseJson(snapshot.ids), checklistId })
      });
    }
  }

  if (snapshot.pageType === "calendar" && /\/calendar\/\d+\/event\/\d+\/detailsview/i.test(snapshot.itemUrl || "")) {
    const eventId = snapshot.itemUrl.match(/\/event\/(\d+)\/detailsview/i)?.[1] || "";
    const title = snapshot.title.replace(/\s+-\s+[^-]+ Section .*$/i, "").trim();
    rows.push({
      ...baseRecoveredRow(snapshot, "calendarEvent", title || snapshot.title, text.slice(0, 1000)),
      dueAtText: extractDueText(text),
      availabilityText: extractAvailabilityText(text) || text.match(/Starts\s+[A-Z][a-z]{2,9}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M/)?.[0] || "",
      columns: JSON.stringify({
        recoveredFrom: "calendarDetailPageText",
        eventId,
        taskText: /Tasks Add a task/i.test(text) ? "tasksWidgetVisible" : ""
      }),
      ids: JSON.stringify({ ...parseJson(snapshot.ids), calendarEventId: eventId })
    });
  }

  if (snapshot.pageType === "quizSubmissions") {
    const quizTitle = snapshot.title.match(/Quiz Submissions\s+-\s+(.+?)(?:\s+-\s+|$)/i)?.[1] || snapshot.title;
    for (const match of text.matchAll(/Attempt\s+(\d+)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?:\s*-\s*([\d.]+)\s*%)?/gi)) {
      rows.push({
        ...baseRecoveredRow(snapshot, "quizSubmission", `${quizTitle} - Attempt ${match[1]}`, match[0]),
        status: "graded",
        columns: JSON.stringify({
          recoveredFrom: "quizSubmissionPageText",
          attempt: match[1],
          pointsEarned: match[2],
          pointsPossible: match[3],
          percent: match[4] || ""
        })
      });
    }
    const overall = text.match(/Overall Grade[^:]*:\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?:\s*-\s*([\d.]+)\s*%)?/i);
    if (overall) {
      rows.push({
        ...baseRecoveredRow(snapshot, "quizSummaryRow", `${quizTitle} - Overall Grade`, overall[0]),
        status: "graded",
        columns: JSON.stringify({
          recoveredFrom: "quizSubmissionPageText",
          pointsEarned: overall[1],
          pointsPossible: overall[2],
          percent: overall[3] || ""
        })
      });
    }
  }

  if (/\/discussions\/topics\/\d+\/View/i.test(snapshot.itemUrl || "")) {
    const topicId = snapshot.itemUrl.match(/\/discussions\/topics\/(\d+)\/View/i)?.[1] || "";
    const title = snapshot.title.replace(/\s+-\s+[^-]+ Section .*$/i, "").trim();
    rows.push({
      ...baseRecoveredRow(snapshot, "discussionTopic", title || snapshot.title, text.slice(0, 1200)),
      gate: /must post first/i.test(text) ? "mustPostFirst" : "",
      columns: JSON.stringify({
        recoveredFrom: "discussionTopicPageText",
        topicId,
        visiblePosts: /must post first/i.test(text) ? "blockedUntilStudentPosts" : "unknown"
      }),
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

  if (/\/discussions\/threads\/\d+\/View/i.test(snapshot.itemUrl || "")) {
    const threadId = snapshot.itemUrl.match(/\/discussions\/threads\/(\d+)\/View/i)?.[1] || "";
    const title = snapshot.title.replace(/\s+-\s+[^-]+ Section .*$/i, "").trim();
    const author = text.match(/View profile card for\s+(.+?)\s+/i)?.[1] || "";
    const postedAt = text.match(/\bposted\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)\b/i)?.[1] || "";
    rows.push({
      ...baseRecoveredRow(snapshot, "discussionPost", title || snapshot.title, text.slice(0, 1600)),
      status: /Unread post/i.test(text) ? "unread" : "",
      columns: JSON.stringify({
        recoveredFrom: "discussionThreadPageText",
        threadId,
        author,
        postedAt,
        repliesVisible: /Reply to Thread/i.test(text) ? "yes" : "unknown"
      }),
      ids: JSON.stringify({ ...parseJson(snapshot.ids), postId: threadId })
    });
  }

  return rows;
}

function sourceForRecoveredFile(filePath) {
  const name = path.basename(filePath);
  if (/quickLink\.html$/i.test(name)) return "externalLink";
  if (/syllabus|schedule|policy|office|instructor|professor/i.test(name)) return "syllabusPolicy";
  if (/rubric|criteria/i.test(name)) return "rubric";
  return "recoveredFile";
}

function parseRecoveredFile(filePath) {
  const courseFolder = filePath.match(/\/courses\/([^/]+)\//)?.[1] || "";
  const courseOrgUnitId = courseFolder.match(/^(\d+)/)?.[1] || "";
  const courseTitle = courseFolder.replace(/^\d+-/, "").replace(/-/g, " ");
  const title = path.basename(filePath);
  const sourceName = sourceForRecoveredFile(filePath);
  return {
    crawledAt: "",
    pageType: "recoveredFile",
    pageTitle: "",
    pageUrl: "",
    courseOrgUnitId,
    courseTitle,
    source: sourceName,
    title,
    description: title,
    status: "",
    gate: "",
    type: path.extname(filePath).slice(1),
    dueAtText: "",
    availabilityText: "",
    itemUrl: "",
    downloadUrl: "",
    suggestedFileName: title,
    historyUrl: "",
    feedbackUrl: "",
    localPath: path.relative(path.dirname(archiveRoot), filePath),
    downloadError: "",
    localPageTextPath: "",
    ids: JSON.stringify({ courseOrgUnitId }),
    columns: JSON.stringify({ recoveredFrom: "downloadedFile", filePath })
  };
}

function recoverManifestFromArchive(root) {
  const pageFiles = walkFiles(path.join(root, "courses")).filter((file) => file.includes(`${path.sep}pages${path.sep}`) && file.endsWith(".md"));
  const downloadedFiles = walkFiles(path.join(root, "courses")).filter((file) => file.includes(`${path.sep}files${path.sep}`));
  const rows = [
    ...pageFiles.flatMap((file) => recoveredRowsFromPage(parsePageSnapshot(file))),
    ...downloadedFiles.map(parseRecoveredFile)
  ];
  return {
    exportedAt: new Date().toISOString(),
    phase: "recovered",
    recovered: true,
    recovery: {
      reason: "manifest.json was missing; reconstructed from page snapshots and downloaded files",
      pageSnapshots: pageFiles.length,
      downloadedFiles: downloadedFiles.length
    },
    rows,
    audit: {
      generatedAt: new Date().toISOString(),
      totals: {
        pagesVisited: pageFiles.length,
        rows: rows.length,
        courses: new Set(rows.map((row) => row.courseOrgUnitId).filter(Boolean)).size,
        skipped: 0,
        failed: "unknown",
        uncertain: "unknown",
        warnings: 1
      }
    }
  };
}

  return {
    walkFiles,
    normalizeText,
    extractDueText,
    extractAvailabilityText,
    parsePageSnapshot,
    baseRecoveredRow,
    assignmentFolderIdFromSnapshot,
    compactAssignmentLabelValues,
    recoveredRowsFromPage,
    sourceForRecoveredFile,
    parseRecoveredFile,
    recoverManifestFromArchive
  };
}
