function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function discussionTopicIdFromUrl(url) {
  return String(url || "").match(/\/discussions\/topics\/(\d+)\/View/i)?.[1] || "";
}

function classifyDiscussionUrl(url) {
  return /\/discussions\/(?:List|topics\/\d+\/View|threads\/\d+\/View)/.test(url) || /\/d2l\/p\/le\/discussions\/\d+/.test(url)
    ? "discussions"
    : "unknown";
}

function discussionPageRows({ url, title, bodyText, courseOrgUnitId }) {
  const topicId = discussionTopicIdFromUrl(url);
  if (!topicId) return [];
  const text = normalizeText(bodyText);
  const feedback = text.match(/\bFeedback\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*%/i);
  const rows = [{
    source: "discussionTopic",
    title,
    description: text.slice(0, 2400),
    url,
    status: /locked/i.test(text) ? "locked" : "visible",
    gate: /must post first/i.test(text) ? "mustPostFirst" : "",
    columns: {
      recoveredFrom: "discussionTopicPage",
      visibleFeedback: feedback?.[0] || "",
      pointsEarned: feedback?.[1] || "",
      pointsPossible: feedback?.[2] || "",
      percent: feedback?.[3] || ""
    },
    ids: { courseOrgUnitId, discussionTopicId: topicId }
  }];

  if (feedback) {
    rows.push({
      source: "discussionFeedback",
      title: `${title} - Feedback`,
      description: feedback[0],
      url,
      status: "graded",
      columns: {
        recoveredFrom: "discussionTopicPage",
        pointsEarned: feedback[1],
        pointsPossible: feedback[2],
        percent: feedback[3]
      },
      ids: { courseOrgUnitId, discussionTopicId: topicId }
    });
  }

  return rows;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const rows = discussionPageRows({
  url: "https://kennesaw.view.usg.edu/d2l/le/9900002/discussions/topics/3359437/View",
  title: "Module 1 Homework - Meet Your Classmates Discussion Post",
  courseOrgUnitId: "9900002",
  bodyText: `
    Module 1 Homework - Meet Your Classmates Discussion Post
    Must post first.
    Feedback
    10 / 10 100 %
    Start a New Thread
    Mia Vitale posted Aug 30, 2026 3:15 PM
  `
});

assertEqual(rows.length, 2, "discussion topic page emits topic and feedback rows");
assertEqual(rows[0].source, "discussionTopic", "first row is discussion topic");
assertEqual(rows[0].gate, "mustPostFirst", "topic gate captures must-post-first state");
assertEqual(rows[0].columns.visibleFeedback, "Feedback 10 / 10 100 %", "topic row keeps visible feedback text");
assertEqual(rows[0].columns.pointsEarned, "10", "topic row keeps points earned");
assertEqual(rows[0].ids.discussionTopicId, "3359437", "topic id is parsed from URL");
assertEqual(rows[1].source, "discussionFeedback", "second row is discussion feedback");
assertEqual(rows[1].status, "graded", "feedback row is graded");
assertEqual(rows[1].columns.pointsPossible, "10", "feedback row keeps points possible");
assertEqual(rows[1].columns.percent, "100", "feedback row keeps percentage");
assertEqual(classifyDiscussionUrl("https://kennesaw.view.usg.edu/d2l/le/9900002/discussions/topics/3359437/View"), "discussions", "discussion topic view URL is classified as discussions");
assertEqual(classifyDiscussionUrl("https://kennesaw.view.usg.edu/d2l/le/9900002/discussions/threads/23625137/View"), "discussions", "discussion thread view URL is classified as discussions");

console.log("Discussion page parser tests passed.");
