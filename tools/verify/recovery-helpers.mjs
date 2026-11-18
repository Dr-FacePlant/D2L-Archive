export function walkFiles(fs, path, dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(fs, path, fullPath));
    else found.push(fullPath);
  }
  return found;
}

export function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function extractDueText(text) {
  return text.match(/Due(?: on)?:?\s+[A-Z][a-z]{2,9}\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s+[AP]M)?/)?.[0]
    || text.match(/Due\s+[A-Z][a-z]{2,9}\s+\d{1,2}\s+at\s+\d{1,2}:\d{2}\s+[AP]M/)?.[0]
    || text.match(/Due at\s+\d{1,2}:\d{2}\s+[AP]M\s+on\s+[A-Z][a-z]+,\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}/)?.[0]
    || text.match(/Due\s+[A-Z][a-z]{2,9}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M/)?.[0]
    || "";
}

export function extractAvailabilityText(text) {
  return text.match(/Available on\s+[A-Z][a-z]{2,9}\s+\d{1,2},?\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M(?:.*?)(?=\.|$)/)?.[0]
    || text.match(/Available until\s+[A-Z][a-z]{2,9}\s+\d{1,2},?\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M(?:.*?)(?=\.|$)/)?.[0]
    || "";
}

export function baseRecoveredRow(snapshot, source, title, description = "") {
  return {
    ...snapshot,
    source,
    title,
    description: description ? description.slice(0, 1500) : "",
    signature: `${snapshot.courseOrgUnitId || ""}::${source}::${title}`
  };
}

export function assignmentFolderIdFromSnapshot(snapshot) {
  return snapshot.itemUrl.match(/\/dropbox\/user\/folder_submit_files\.d2l\?[^\s"']*?\bdb=(\d+)/i)?.[1]
    || snapshot.itemUrl.match(/\/dropbox\/user\/folders_history\.d2l\?[^\s"']*?\bdb=(\d+)/i)?.[1]
    || snapshot.itemUrl.match(/\/dropbox\/user\/folder_user_view_feedback\.d2l\?[^\s"']*?\bdb=(\d+)/i)?.[1]
    || "";
}

export function compactAssignmentLabelValues(text) {
  const labels = ["Due Date", "Due", "Submit by", "Score", "Feedback", "Submitted", "Completion Status"];
  const out = [];
  for (const label of labels) {
    const rx = new RegExp(`(?:^|\\n)\\s*${label}\\s*\\n\\s*([^\\n]+)`, "i");
    const val = text.match(rx)?.[1]?.trim();
    if (val) out.push(`${label}: ${val}`);
  }
  return out.join(" | ");
}

export function sourceForRecoveredFile(filePath, path) {
  const name = path.basename(filePath);
  if (/quickLink\.html$/i.test(name)) return "externalLink";
  if (/syllabus|schedule|policy|office|instructor|professor/i.test(name)) return "syllabusPolicy";
  if (/rubric|criteria/i.test(name)) return "rubric";
  return "recoveredFile";
}

export function parsePageSnapshot(filePath, fs, path) {
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
    source: pageType,
    title,
    description: body,
    status: "",
    gate: "",
    type: "",
    dueAtText: "",
    availabilityText: "",
    itemUrl: url,
    downloadUrl: "",
    suggestedFileName: "",
    historyUrl: "",
    feedbackUrl: "",
    localPath: "",
    downloadError: "",
    localPageTextPath: filePath,
    ids: JSON.stringify({ courseOrgUnitId }),
    columns: "{}"
  };
}

export function parseRecoveredFile(filePath, path, archiveRoot) {
  const courseFolder = filePath.match(/\/courses\/([^/]+)\//)?.[1] || "";
  const courseOrgUnitId = courseFolder.match(/^(\d+)/)?.[1] || "";
  const courseTitle = courseFolder.replace(/^\d+-/, "").replace(/-/g, " ");
  const title = path.basename(filePath);
  const sourceName = sourceForRecoveredFile(filePath, path);
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

export function parseDiscussionFeedback(snapshot, text, parseJson) {
  const rows = [];
  const topicId = snapshot.itemUrl.match(/\/discussions\/topics\/(\d+)\/View/i)?.[1] || "";
  const contentObjectId = snapshot.itemUrl.match(/\/viewContent\/(\d+)\/View/i)?.[1] || "";
  const title = snapshot.title.replace(/\s+-\s+[^-]+ Section .*$/i, "").trim();
  const feedbackScore = text.match(/\bFeedback\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+([\d.]+)\s*%/i) || text.match(/\bAssessment Grade\s+([\d.]+)\s*%/i);
  if (feedbackScore) {
    rows.push({
      ...baseRecoveredRow(snapshot, "discussionFeedback", `${title || snapshot.title} - Feedback`, feedbackScore[0]),
      status: "graded",
      columns: JSON.stringify({ recoveredFrom: "discussionVisibleFeedbackText", topicId, contentObjectId, pointsEarned: feedbackScore[2] ? feedbackScore[1] : "", pointsPossible: feedbackScore[2] || "", percent: feedbackScore[3] || feedbackScore[1] || "" }),
      ids: JSON.stringify({ ...parseJson(snapshot.ids), discussionTopicId: topicId, contentObjectId })
    });
  }
  const rubricLevel = text.match(/Level Achieved:\s*([^]+?)(?=\s+Last Visited|\s+Previous Next|$)/i)?.[1]?.trim() || "";
  if (rubricLevel) {
    rows.push({
      ...baseRecoveredRow(snapshot, "rubricFeedback", `${title || snapshot.title} - Rubric Feedback`, rubricLevel),
      status: "graded",
      columns: JSON.stringify({ recoveredFrom: "discussionVisibleFeedbackText", topicId, contentObjectId, levelAchieved: rubricLevel }),
      ids: JSON.stringify({ ...parseJson(snapshot.ids), discussionTopicId: topicId, contentObjectId })
    });
  }
  return rows;
}
