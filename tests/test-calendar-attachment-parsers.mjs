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

function calendarAttachmentRow({ href, label, calendarEventTitle, calendarEventId }) {
  if (!href || !label || !looksLikeFileUrl(href)) return null;
  return {
    source: "calendarAttachment",
    title: label,
    url: href,
    downloadUrl: href,
    suggestedFileName: label,
    columns: {
      recoveredFrom: "calendarEventDetailLink",
      calendarEventTitle
    },
    ids: { courseOrgUnitId: "9900003", calendarEventId }
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const apiFile = calendarAttachmentRow({
  href: "https://kennesaw.view.usg.edu/d2l/api/le/1/9900003/calendar/events/99/attachments/456",
  label: "exam-review.pdf",
  calendarEventTitle: "Exam Review",
  calendarEventId: "99"
});

assertEqual(apiFile.source, "calendarAttachment", "calendar detail attachment emits calendarAttachment");
assertEqual(apiFile.columns.recoveredFrom, "calendarEventDetailLink", "calendar detail attachment records recovery source");
assertEqual(apiFile.columns.calendarEventTitle, "Exam Review", "calendar detail attachment keeps event title");
assertEqual(apiFile.ids.calendarEventId, "99", "calendar detail attachment keeps event id");

const contentFile = calendarAttachmentRow({
  href: "https://kennesaw.view.usg.edu/content/enforced/9900003/project-rubric.docx",
  label: "project-rubric.docx",
  calendarEventTitle: "Project Due",
  calendarEventId: "100"
});

assertEqual(contentFile.suggestedFileName, "project-rubric.docx", "calendar detail attachment keeps file name");

const calendarDetail = calendarAttachmentRow({
  href: "https://kennesaw.view.usg.edu/d2l/le/calendar/9900003/event/100/detailsview",
  label: "Project Due",
  calendarEventTitle: "Project Due",
  calendarEventId: "100"
});

assertEqual(calendarDetail, null, "calendar event detail link is not mistaken for attachment");

console.log("Calendar attachment parser tests passed.");
