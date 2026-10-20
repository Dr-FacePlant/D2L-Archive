(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;
  const {
    queryAll,
    queryOne,
    absoluteUrl,
    looksLikeFileUrl,
    isDiscussionAttachmentUrl,
    getOrgUnitId,
    discussionAttachmentRowFromLink
  } = content;

// D2L date text such as "Sep 27, 2026 8:00 AM", read in the browser's time zone
// (the same zone D2L renders it in).
function listDateToIso(text) {
  const parsed = new Date(String(text || "").replace(/\s+/g, " ").trim());
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

// The Discussions List page groups topics under forum <h2> headings and shows a
// topic's window ("Available on … until …") even when the topics API is 403.
function extractDiscussionListTopics() {
  if (!/\/discussions\/List/i.test(window.location.pathname)) return [];
  const nodes = [...document.querySelectorAll("h2, a[href*='/discussions/topics/']")];
  const topics = [];
  const seen = new Set();
  let forumTitle = "";
  for (const node of nodes) {
    if (node.tagName === "H2") {
      forumTitle = normalizeText(node.textContent);
      continue;
    }
    const href = node.getAttribute("href") || "";
    if (/[?&]filters=/i.test(href)) continue;
    const topicId = href.match(/\/topics\/(\d+)\//)?.[1] || "";
    if (!topicId || seen.has(topicId)) continue;
    seen.add(topicId);
    const title = normalizeText(node.textContent);
    const cell = node.closest("th, td, li") || node.parentElement;
    const text = normalizeText(cell?.textContent || "");
    const from = text.match(/Available on ([A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M)/)?.[1] || "";
    const until = text.match(/Available until ([A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M)/)?.[1] || "";
    // The topic prompt renders inside <d2l-html-block html="…">, whose text lives
    // in a shadow root; the attribute holds the same HTML.
    const htmlBlock = cell?.querySelector?.("d2l-html-block[html]");
    const blockText = htmlBlock
      ? normalizeText(new DOMParser().parseFromString(htmlBlock.getAttribute("html") || "", "text/html").body?.textContent || "")
      : "";
    const prompt = blockText || normalizeText(text
      .replace(title, "")
      .replace(/You must start a thread before you can read and reply to other threads/gi, "")
      .replace(/Contains unread posts/gi, "")
      .replace(/[A-Z][a-z]{2} \d{1,2} - [A-Z][a-z]{2} \d{1,2}/, "")
      .replace(/Available (?:on|until) [A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M/g, "")
      .replace(/Access restricted (?:before|after) availability (?:starts|ends)\./gi, "")
      .replace(/Must post first\./gi, ""));
    topics.push({
      source: "discussionTopic",
      title,
      description: prompt,
      url: absoluteUrl(href),
      status: "visible",
      gate: /must post first/i.test(text) ? "mustPostFirst" : "",
      availabilityText: [from, until].filter(Boolean).join(" - "),
      columns: {
        recoveredFrom: "discussionListPage",
        forumTitle,
        startDate: listDateToIso(from),
        endDate: listDateToIso(until),
        hasUnread: /Contains unread posts/i.test(text)
      },
      ids: { courseOrgUnitId: getOrgUnitId(), discussionTopicId: topicId }
    });
  }
  return topics;
}

function extractDiscussions() {
  const listTopics = extractDiscussionListTopics();
  if (listTopics.length) return listTopics;
  const topicLinks = queryAll("a[href*='/discussions/topics/']");
  const topics = topicLinks.map((link) => {
    const href = link.getAttribute("href") || "";
    const topicId = href.match(/\/topics\/(\d+)\//)?.[1] || null;
    const row = link.closest("tr, li, div");
    const text = normalizeText(row?.textContent || link.textContent);
    return {
      source: "discussionTopic",
      title: normalizeText(link.textContent || link.getAttribute("aria-label")),
      description: text,
      url: absoluteUrl(href),
      status: /unread/i.test(text) ? "containsUnread" : null,
      gate: /must post first|start a thread before/i.test(text) ? "mustPostFirst" : null,
      ids: { courseOrgUnitId: getOrgUnitId(), discussionTopicId: topicId }
    };
  });

  const forums = queryAll("h2, [role='heading'][aria-level='2']")
    .map((node) => ({
      source: "discussionForum",
      title: normalizeText(node.textContent),
      description: normalizeText(node.parentElement?.textContent || node.textContent),
      ids: { courseOrgUnitId: getOrgUnitId() }
    }))
    .filter((item) => item.title && !/Tool Navigation/i.test(item.title));

  return [...forums, ...topics];
}

function discussionTopicIdFromUrl(url = window.location.href) {
  return String(url || "").match(/\/discussions\/topics\/(\d+)\/View/i)?.[1] || "";
}

function extractDiscussionPageMeta() {
  const topicId = discussionTopicIdFromUrl();
  if (!topicId) return [];
  const bodyText = normalizeText(queryOne("body")?.textContent || "");
  const title = normalizeText(queryOne("h1, [role='heading'][aria-level='1']")?.textContent || document.title.replace(/\s+-\s+Kennesaw State University$/i, ""));
  const feedback = bodyText.match(/\bFeedback\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*%/i);
  const rows = [{
    source: "discussionTopic",
    title,
    description: bodyText.slice(0, 2400),
    url: window.location.href,
    status: /locked/i.test(bodyText) ? "locked" : "visible",
    gate: /must post first/i.test(bodyText) ? "mustPostFirst" : "",
    columns: {
      recoveredFrom: "discussionTopicPage",
      visibleFeedback: feedback?.[0] || "",
      pointsEarned: feedback?.[1] || "",
      pointsPossible: feedback?.[2] || "",
      percent: feedback?.[3] || ""
    },
    ids: { courseOrgUnitId: getOrgUnitId(), discussionTopicId: topicId }
  }];

  if (feedback) {
    rows.push({
      source: "discussionFeedback",
      title: `${title} - Feedback`,
      description: feedback[0],
      url: window.location.href,
      status: "graded",
      columns: {
        recoveredFrom: "discussionTopicPage",
        pointsEarned: feedback[1],
        pointsPossible: feedback[2],
        percent: feedback[3]
      },
      ids: { courseOrgUnitId: getOrgUnitId(), discussionTopicId: topicId }
    });
  }

  return rows;
}

function extractDiscussionPosts() {
  const postNodes = queryAll("article, [data-testid*='post'], [class*='post'], [id*='post']");
  const rows = [];
  const seen = new Set();
  for (const node of postNodes) {
    const text = normalizeText(node.textContent || "");
    if (!text || text.length < 20 || seen.has(text.slice(0, 160))) continue;
    seen.add(text.slice(0, 160));
    const subject = normalizeText(node.querySelector?.("h1, h2, h3, [class*='subject'], [class*='title']")?.textContent || text.slice(0, 100));
    const postId = node.id?.match(/(\d+)/)?.[1] || "";
    rows.push({
      source: "discussionPost",
      title: subject,
      description: text.slice(0, 4000),
      url: window.location.href,
      status: /unread/i.test(text) ? "unread" : "",
      ids: { courseOrgUnitId: getOrgUnitId(), postId }
    });
    for (const link of Array.from(node.querySelectorAll?.("a[href]") || [])) {
      const href = absoluteUrl(link.getAttribute("href"));
      const label = normalizeText(link.textContent || link.getAttribute("aria-label") || link.title);
      if (!href || !label || (!looksLikeFileUrl(href) && !isDiscussionAttachmentUrl(href))) continue;
      const attachment = discussionAttachmentRowFromLink(link, {
        postId,
        postSubject: subject,
        recoveredFrom: "discussionVisiblePostLink"
      });
      if (attachment) rows.push(attachment);
    }
  }
  return rows;
}

function extractDiscussionAttachments() {
  const seen = new Set();
  return queryAll("a[href]")
    .map((link) => {
      const href = absoluteUrl(link.getAttribute("href"));
      if (!isDiscussionAttachmentUrl(href) || seen.has(href)) return null;
      seen.add(href);
      return discussionAttachmentRowFromLink(link, {
        recoveredFrom: "discussionPageAttachmentLink"
      });
    })
    .filter(Boolean);
}

function dedupeDiscussionAttachments(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (item?.source !== "discussionAttachment") return true;
    const key = item.downloadUrl || item.url || item.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


  Object.assign(content, { extractDiscussionListTopics, listDateToIso,
    extractDiscussions,
    discussionTopicIdFromUrl,
    extractDiscussionPageMeta,
    extractDiscussionPosts,
    extractDiscussionAttachments,
    dedupeDiscussionAttachments
  });
})();
