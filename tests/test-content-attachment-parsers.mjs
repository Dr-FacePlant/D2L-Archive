function looksLikeFileUrl(href) {
  if (/\/d2l\/lms\/dropbox\/user\/(?:folder_submit_files|folders_history|folder_user_view_feedback)\.d2l/i.test(href)) return false;
  return /\/d2l\/api\/.*\/files?\//i.test(href)
    || /\/d2l\/api\/.*\/attachments?\//i.test(href)
    || /\/d2l\/common\/dialog\/file/i.test(href)
    || /[?&](?:fileId|fid|cfql|download)=/i.test(href)
    || /\/d2l\/lms\/dropbox\/.*(?:file|download|get)/i.test(href)
    || /\/d2l\/lp\/(?:file|files|attachments)\//i.test(href)
    || /\/content\/enforced\//i.test(href)
    || /\.(?:pdf|docx?|pptx?|xlsx?|csv|txt|rtf|zip|png|jpe?g|gif|heic|mp4|mov|m4a|mp3)(?:[?#]|$)/i.test(href);
}

function contentAttachmentRow({ href, label, contentTitle, contentObjectId }) {
  if (!href || !label || !looksLikeFileUrl(href)) return null;
  return {
    source: "contentAttachment",
    title: label,
    url: href,
    downloadUrl: href,
    suggestedFileName: label,
    columns: {
      recoveredFrom: "contentViewerLink",
      contentTitle
    },
    ids: { courseOrgUnitId: "9900003", contentObjectId }
  };
}

function contentViewerTopicRow({ title, bodyText, iframeSrc, externalActionRaw, attachmentCount, contentObjectId }) {
  const type = bodyText.match(/PDF document|HTML document|Word document|PowerPoint|Video|File|External Resource/i)?.[0] || null;
  const lastVisitedMatch = bodyText.match(/Last Visited\s+([A-Za-z]+ \d{1,2}, \d{4})/);
  return {
    source: "contentTopic",
    title,
    description: bodyText.match(/Activity Details[\s\S]{0,120}/)?.[0] ? bodyText.match(/Activity Details[\s\S]{0,120}/)[0].replace(/\s+/g, " ").trim() : title,
    type,
    url: iframeSrc || "https://kennesaw.view.usg.edu/d2l/le/content/9900003/viewContent/12345/View",
    status: /you have viewed this topic/i.test(bodyText) ? "viewed" : /task: view/i.test(bodyText) ? "notViewed" : null,
    lastVisited: lastVisitedMatch ? lastVisitedMatch[1] : null,
    columns: {
      recoveredFrom: "contentViewerPage",
      ...(externalActionRaw ? { externalActionRaw } : {}),
      attachmentCount
    },
    ids: { courseOrgUnitId: "9900003", contentObjectId }
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const enforcedFile = contentAttachmentRow({
  href: "https://kennesaw.view.usg.edu/content/enforced/9900003/week-1-handout.pdf",
  label: "week-1-handout.pdf",
  contentTitle: "Week 1 Overview",
  contentObjectId: "12345"
});

assertEqual(enforcedFile.source, "contentAttachment", "content viewer file emits contentAttachment");
assertEqual(enforcedFile.columns.recoveredFrom, "contentViewerLink", "content viewer file records recovery source");
assertEqual(enforcedFile.columns.contentTitle, "Week 1 Overview", "content viewer file keeps content title");
assertEqual(enforcedFile.ids.contentObjectId, "12345", "content viewer file keeps content object id");

const lpFile = contentAttachmentRow({
  href: "https://kennesaw.view.usg.edu/d2l/lp/files/temp/slides.pptx?download=1",
  label: "slides.pptx",
  contentTitle: "Lecture Slides",
  contentObjectId: "999"
});

assertEqual(lpFile.suggestedFileName, "slides.pptx", "content viewer file keeps suggested file name");

const ordinaryContentLink = contentAttachmentRow({
  href: "https://kennesaw.view.usg.edu/d2l/le/content/9900003/viewContent/222/View",
  label: "Next topic",
  contentTitle: "Week 1 Overview",
  contentObjectId: "12345"
});

assertEqual(ordinaryContentLink, null, "ordinary content navigation link is not mistaken for attachment");

const topicRow = contentViewerTopicRow({
  title: "Week 1 Overview",
  bodyText: "Activity Details HTML document Last Visited September 20, 2026 You have viewed this topic",
  iframeSrc: "",
  externalActionRaw: "D2L.O('launch')",
  attachmentCount: 2,
  contentObjectId: "12345"
});

assertEqual(topicRow.source, "contentTopic", "content viewer page emits contentTopic");
assertEqual(topicRow.columns.recoveredFrom, "contentViewerPage", "content viewer topic records recovery source");
assertEqual(topicRow.columns.attachmentCount, 2, "content viewer topic counts attachments");
assertEqual(topicRow.status, "viewed", "content viewer topic records viewed status");
assertEqual(topicRow.lastVisited, "September 20, 2026", "content viewer topic keeps last visited date");

console.log("Content attachment parser tests passed.");
