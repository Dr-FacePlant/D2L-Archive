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

function isDiscussionAttachmentUrl(href) {
  return /\/d2l\/le\/\d+\/discussions\/posts\/\d+\/ViewAttachment(?:\?|$)/i.test(href || "");
}

function visibleDiscussionAttachmentRow({ href, label, postSubject, postId }) {
  if (!href || !label || (!looksLikeFileUrl(href) && !isDiscussionAttachmentUrl(href))) return null;
  return {
    source: "discussionAttachment",
    title: label,
    url: href,
    downloadUrl: href,
    suggestedFileName: label,
    columns: {
      recoveredFrom: "discussionVisiblePostLink",
      postSubject
    },
    ids: { courseOrgUnitId: "9900003", postId }
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const apiFile = visibleDiscussionAttachmentRow({
  href: "https://kennesaw.view.usg.edu/d2l/api/le/1/9900003/discussions/forums/1/topics/2/posts/3/attachments/4",
  label: "reply-notes.pdf",
  postSubject: "Week 2 reply",
  postId: "3"
});

assertEqual(apiFile.source, "discussionAttachment", "visible discussion attachment emits discussionAttachment");
assertEqual(apiFile.columns.recoveredFrom, "discussionVisiblePostLink", "visible discussion attachment records recovery source");
assertEqual(apiFile.columns.postSubject, "Week 2 reply", "visible discussion attachment keeps post subject");
assertEqual(apiFile.ids.postId, "3", "visible discussion attachment keeps post id");

const contentFile = visibleDiscussionAttachmentRow({
  href: "https://kennesaw.view.usg.edu/content/enforced/9900003/peer-response.docx",
  label: "peer-response.docx",
  postSubject: "Peer response",
  postId: ""
});

assertEqual(contentFile.suggestedFileName, "peer-response.docx", "visible discussion attachment keeps file name");

const d2lViewAttachment = visibleDiscussionAttachmentRow({
  href: "https://kennesaw.view.usg.edu/d2l/le/9900002/discussions/posts/52243862/ViewAttachment?fileId=215839635",
  label: "DSC09876.jpg",
  postSubject: "Photo critique",
  postId: "52243862"
});

assertEqual(looksLikeFileUrl(d2lViewAttachment.downloadUrl), true, "D2L discussion ViewAttachment URL is file-like");
assertEqual(isDiscussionAttachmentUrl(d2lViewAttachment.downloadUrl), true, "D2L discussion ViewAttachment URL is recognized");
assertEqual(d2lViewAttachment.source, "discussionAttachment", "D2L discussion ViewAttachment emits discussionAttachment");

const topicLink = visibleDiscussionAttachmentRow({
  href: "https://kennesaw.view.usg.edu/d2l/le/9900003/discussions/topics/44/View",
  label: "Discussion 4",
  postSubject: "Discussion 4",
  postId: ""
});

assertEqual(topicLink, null, "discussion topic link is not mistaken for attachment");

console.log("Discussion attachment parser tests passed.");
