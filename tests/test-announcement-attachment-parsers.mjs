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

function newsItemIdFromUrl(href) {
  return String(href || "").match(/\/news\/\d+\/(\d+)\/view/i)?.[1]
    || String(href || "").match(/[?&](?:newsId|nid)=(\d+)/i)?.[1]
    || String(href || "").match(/\/news\/(\d+)(?:[/?#]|$)/i)?.[1]
    || "";
}

function announcementLinkSource(href) {
  if (!href || href.startsWith("javascript:")) return "";
  if (looksLikeFileUrl(href)) return "announcementAttachment";
  if (/\/d2l\/(?:le|lms)\/news\/\d+\/\d+\/view/i.test(href)) return "";
  return "announcementLink";
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

assertEqual(looksLikeFileUrl("https://kennesaw.view.usg.edu/d2l/api/le/1/9900001/news/123/attachments/456"), true, "announcement API attachment URL is captured");
assertEqual(looksLikeFileUrl("https://kennesaw.view.usg.edu/d2l/lp/files/temp/announcement.pdf"), true, "announcement lp file URL is captured");
assertEqual(looksLikeFileUrl("https://kennesaw.view.usg.edu/content/enforced/9900001/syllabus.docx"), true, "announcement content file URL is captured");
assertEqual(looksLikeFileUrl("https://kennesaw.view.usg.edu/d2l/le/news/9900001/123/view"), false, "announcement detail page URL is not mistaken for an attachment");
assertEqual(looksLikeFileUrl("https://kennesaw.view.usg.edu/d2l/home/9900001"), false, "course home URL is not mistaken for an attachment");
assertEqual(newsItemIdFromUrl("https://kennesaw.view.usg.edu/d2l/le/news/9900002/7061660/view"), "7061660", "announcement detail parser keeps news item id instead of course id");
assertEqual(newsItemIdFromUrl("https://kennesaw.view.usg.edu/d2l/lms/news/main.d2l?ou=9900002&newsId=7061660"), "7061660", "announcement detail parser keeps query news id");
assertEqual(announcementLinkSource("https://kennesaw.view.usg.edu/d2l/le/news/9900001/123/view"), "", "announcement detail self-link is ignored");
assertEqual(announcementLinkSource("https://example.com/study-guide"), "announcementLink", "announcement detail external link is captured separately");
assertEqual(announcementLinkSource("https://kennesaw.view.usg.edu/content/enforced/9900001/syllabus.docx"), "announcementAttachment", "announcement detail file link remains an attachment");

console.log("Announcement attachment parser tests passed.");
