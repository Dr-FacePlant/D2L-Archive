import { loadBackgroundHooks } from "./test-production-loader.mjs";

const { archivePathFromDownloadItem, isDownloadCandidate } = loadBackgroundHooks();

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

for (const prefix of ["d2l-export", "d2l-api-export", "d2l-course-export", "d2l-page-probe-export"]) {
  const relative = `D2L Export/${prefix}-2026-09-19T02-15-24-745Z/courses/123/files/Content (11).html`;
  assertEqual(
    archivePathFromDownloadItem({ filename: `/Users/student/Downloads/${relative}` }, `${relative}.fallback`),
    relative,
    `${prefix} path keeps Chrome final filename and conflict suffix`
  );
}

assertEqual(
  archivePathFromDownloadItem(null, "D2L Export/d2l-export-example/courses/123/files/fallback.pdf"),
  "D2L Export/d2l-export-example/courses/123/files/fallback.pdf",
  "download path falls back when Chrome item is unavailable"
);

assertEqual(isDownloadCandidate({
  source: "discussionAttachment",
  itemUrl: "https://kennesaw.view.usg.edu/d2l/le/9900002/discussions/posts/52243862/ViewAttachment?fileId=215839635",
  title: "DSC09876.jpg"
}), true, "discussion attachment is downloadable");

assertEqual(isDownloadCandidate({
  source: "submittedFile",
  itemUrl: "https://kennesaw.view.usg.edu/d2l/api/le/1.75/9900002/dropbox/folders/1/submissions/2/files/3",
  title: "paper.docx"
}), true, "submitted file is downloadable");

assertEqual(isDownloadCandidate({
  source: "announcementAttachment",
  itemUrl: "https://kennesaw.view.usg.edu/d2l/api/le/1.75/9900002/news/1/attachments/2",
  title: "notice.pdf"
}), true, "announcement attachment is downloadable");

assertEqual(isDownloadCandidate({
  source: "discussionTopic",
  itemUrl: "https://kennesaw.view.usg.edu/d2l/le/9900002/discussions/topics/3359437/View",
  title: "Introduce yourself"
}), false, "discussion topic page is not treated as a file");

console.log("Download path production tests passed.");
