// File preview: one loader for Content rows, assignment files and Related
// items. It loads the file from D2L (or, failing that, the saved copy), works
// out what it is from its first bytes, and shows PDFs, pictures, D2L pages and
// Word files. PowerPoint and Excel files show as the PDF D2L made of them,
// found through the topic's D2L page. When it can't, it says why: signed out,
// missing, no access, too big, offline, or a kind of file the viewer can't show.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const run = (file) => vm.runInThisContext(read(file), { filename: file });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const ORIGIN = "https://kennesaw.view.usg.edu";
const topic = (id) => `${ORIGIN}/d2l/le/content/9/topics/files/download/${id}/DirectFileTopicDownload`;
const view = (id) => `${ORIGIN}/d2l/le/content/9/viewContent/${id}/View`;
const MB = 1024 * 1024;

// ------------------------------------------------------------ fake browser
const cache = new Map();
globalThis.D2LDashboard = {
  appModules: { escapeRegex: (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), state: { account: { id: "student" } } },
  fileCache: { getFile: async (scope, url) => cache.get(url) || null, keepFile: async (scope, url, blob) => { cache.set(url, blob); } }
};

// D2L's answers, by address: { status, type, body, url, length } or "throw".
const d2l = new Map();
let fetches = 0;
const sentCookies = new Map();
globalThis.fetch = async (url, options = {}) => {
  fetches += 1;
  sentCookies.set(url, options.credentials);
  const answer = d2l.get(url);
  if (!answer || answer === "throw") throw new TypeError("Failed to fetch");
  const body = answer.body;
  const headers = new Headers({ "content-type": answer.type || "" });
  if (answer.length) headers.set("content-length", String(answer.length));
  return { ok: (answer.status || 200) < 300, status: answer.status || 200, url: answer.url || url, headers, blob: async () => new Blob([body ?? ""], { type: answer.type || "" }), text: async () => String(body ?? "") };
};

// The background's D2L-tab fallback (a file, a topic page, or where an open
// topic page's viewer gets its PDF), and the saved copies on this computer.
let tabReply = { ok: false, reason: "no-tab" };
let pageReply = { ok: false, reason: "no-tab" };
let openedReply = { ok: false, reason: "no-tab" };
let opened = [];
let asked = 0;
const saved = new Map();
let fileAccess = true;
globalThis.chrome = {
  runtime: { id: "test", sendMessage: async (message) => {
    asked += 1;
    if (message.type === "D2L_VIEWER_PDF") return opened.push(message.url) && openedReply;
    return message.type !== "D2L_FETCH_FILE" ? null : message.page ? pageReply : tabReply;
  } },
  downloads: { search: async ({ filenameRegex }) => [...saved.keys()].filter((name) => new RegExp(filenameRegex).test(name)).map((filename) => ({ filename })) },
  extension: { isAllowedFileSchemeAccess: (reply) => reply(fileAccess) }
};
globalThis.XMLHttpRequest = class {
  open(method, url) { this.url = decodeURIComponent(url.replace(/^file:\/\//, "")); }
  send() { this.response = saved.get(this.url) || null; setTimeout(() => this.response ? this.onload() : this.onerror()); }
};
let online = true;
Object.defineProperty(globalThis, "navigator", { configurable: true, get: () => ({ onLine: online }) });
// A Word file is drawn by the bundled docx-preview library in the browser;
// here a stand-in draws a known page.
globalThis.document = { createElement: () => ({ innerHTML: "" }) };
globalThis.docx = { renderAsync: async (data, body, styles) => { body.innerHTML = '<section class="docx"><p>Hello from Word</p></section>'; styles.innerHTML = "<style>.docx{color:#000}</style>"; } };

for (const file of ["src/dashboard/format.js", "src/dashboard/model.js", "src/vendor/jszip.min.js", "src/dashboard/preview-formats.js", "src/dashboard/app-preview.js"]) run(file);
const { loadFile } = globalThis.D2LDashboard.appModules;
const { DOCX_TYPE, pdfSource, pdfAddress, d2lAddress } = globalThis.D2LDashboard.previewFormats;

const zipOf = async (files) => {
  const zip = new globalThis.JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
};
const reset = () => { cache.clear(); d2l.clear(); sentCookies.clear(); saved.clear(); fetches = 0; asked = 0; opened = []; tabReply = { ok: false, reason: "no-tab" }; pageReply = { ok: false, reason: "no-tab" }; openedReply = { ok: false, reason: "no-tab" }; fileAccess = true; online = true; };

// -------------------------------------------------------------- formats
reset();
d2l.set(topic(1), { type: "application/pdf", body: "%PDF-1.4\n%Test 3 Review\n" });
let shown = await loadFile({ name: "Test 3 Review.pdf", downloadUrl: topic(1) });
check(shown.state === "ready" && shown.kind === "pdf" && shown.mime === "application/pdf" && shown.src.startsWith("blob:"), "a D2L PDF should load and show as a PDF");
check(cache.has(topic(1)), "a loaded file should be kept for next time");
const before = fetches;
shown = await loadFile({ name: "Test 3 Review.pdf", downloadUrl: topic(1) });
check(shown.state === "ready" && fetches === before, "opening it again should use the kept copy, not D2L");

reset();
d2l.set(topic(2), { type: "application/octet-stream", body: "%PDF-1.7\n" });
shown = await loadFile({ name: "", downloadUrl: topic(2) });
check(shown.kind === "pdf" && shown.mime === "application/pdf", "a PDF sent with no name and a vague type should be known by its first bytes");

reset();
d2l.set(topic(3), { type: "application/x-zip-compressed", body: await zipOf({ "Module 10 Objectives.html": '<!DOCTYPE html>\n<html><head>\n</head><body style="font-family: \'Lato\', sans-serif;"><p>By the end of this module, students will have demonstrated</p><p><iframe src="/d2l/common/dialogs/quickLink/quickLink.d2l?ou=1&amp;type=lti" height="402"></iframe></p><a href="/d2l/home/9">Course home</a></body></html>' }) });
shown = await loadFile({ name: "", downloadUrl: topic(3) });
check(shown.state === "ready" && shown.kind === "page", "a D2L page (a .zip with one .html file) should show as a page");
check(shown.html.includes(`<base href="${ORIGIN}/" target="_blank">`), "a D2L page's links should point at D2L and open in a new tab");
check(shown.html.includes("By the end of this module") && !/<iframe/i.test(shown.html) && shown.html.includes("only plays in D2L"), "an embedded video or tool should become a note that says to open it in D2L");
check(shown.mime === "text/html" && shown.src.startsWith("blob:"), "a D2L page should download as its .html file, not the .zip");

reset();
d2l.set(topic(4), { type: "application/octet-stream", body: await zipOf({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document/>" }) });
shown = await loadFile({ name: "", downloadUrl: topic(4) });
check(shown.state === "ready" && shown.kind === "docx" && shown.html.includes("Hello from Word") && shown.html.includes(".docx{color:#000}"), "a Word file should show as a page with its styles");
check(shown.mime === DOCX_TYPE, "a Word file should download as a .docx");

reset();
d2l.set(topic(5), { type: "application/octet-stream", body: await zipOf({ "ppt/presentation.xml": "<p:presentation/>" }) });
shown = await loadFile({ name: "Week 4 Slides", downloadUrl: topic(5) });
check(shown.state === "unsupported" && shown.label === "PowerPoint files" && shown.src && /presentationml/.test(shown.mime), "PowerPoint should be named, and still offer Download as a .pptx");

// D2L makes a PDF of a PowerPoint when it's uploaded, and its topic page's
// file viewer says where. The markup is D2L's own, from a saved topic page.
const viewerPage = (where) => `<div class="d2l-fileviewer"><div class="d2l-fileviewer-pdf-pdfjs" id="d2l_1_94_554" data-location="${where}" data-title="Week 4 Slides.pptx" data-culture="en-us" data-is-download-enabled="1"></div></div>`;
const slides = await zipOf({ "ppt/presentation.xml": "<p:presentation/>" });
check(pdfSource('<div class="d2l-fileviewer"><div class="d2l-fileviewer-pdf-pdfjs" id="d2l_1_94_554" data-location="/content/enforced/317522-013925-01-1248-1-700/Introduction%20(2).pdf?ou=317522" data-title="Introduction (2).pdf">')?.url === `${ORIGIN}/content/enforced/317522-013925-01-1248-1-700/Introduction%20(2).pdf?ou=317522`, "D2L's file viewer should give the PDF's address");
check(pdfSource('<div class="d2l-fileviewer-text" data-location="/content/enforced/1/Notes.html?ou=1">') === null && pdfSource("<p>No viewer</p>") === null && pdfSource("") === null, "a web page viewer, or no viewer, should give no address");
check(!pdfSource(viewerPage("https://elsewhere.example.com/Slides.pdf"))?.url, "a PDF address off D2L should be ignored");
// A PowerPoint's page often names no PDF yet. D2L's viewer script
// (D2L.LP.FileViewerRenders.DocumentToPdf) asks D2L for it once the page is
// open, then sets the viewer's data-location. The extension doesn't send that
// request; it opens the page out of sight in a D2L tab and reads the viewer.
const convertingPage = `<div class="d2l-fileviewer"><div class="d2l-documentToPdfViewer" id="d2l_1_7_123" data-d2l-viewmode="render"><div class="d2l-documentToPdfViewer-render"><div class="d2l-fileviewer-pdf-pdfjs" data-title="Week 4 Slides.pptx" data-is-download-enabled="1"></div></div></div></div>`;
check(pdfSource(convertingPage)?.later === true && pdfSource('<div class="d2l-fileviewer-pdf-pdfjs" data-title="Slides.pptx"></div>')?.later === true, "a page whose PDF viewer doesn't say where yet should say to look once it's open");
check(d2lAddress("/d2l/x?a=1&amp;b=2") === `${ORIGIN}/d2l/x?a=1&b=2` && d2lAddress("https://elsewhere.example.com/x") === "" && d2lAddress("") === "", "addresses should be made whole, and only D2L counts");
reset();
d2l.set(topic(44), { type: "application/octet-stream", body: slides });
d2l.set(view(44), { type: "text/html", body: convertingPage });
d2l.set(`${ORIGIN}/content/enforced/9-ABC/Week%204%20Slides.pdf?ou=9`, { type: "application/pdf", body: "%PDF-1.5\n" });
openedReply = { ok: true, location: "/content/enforced/9-ABC/Week%204%20Slides.pdf?ou=9" };
shown = await loadFile({ name: "", downloadUrl: topic(44) });
check(shown.kind === "pdf" && shown.pdf?.startsWith("blob:") && /presentationml/.test(shown.mime), "a PowerPoint whose page names its PDF only once open should show that PDF");
check(opened.length === 1 && opened[0] === view(44), "the topic page should be opened in a D2L tab to read where its PDF is");
reset();
d2l.set(topic(45), { type: "application/octet-stream", body: slides });
d2l.set(view(45), { type: "text/html", body: "<p>No viewer</p>" });
shown = await loadFile({ name: "", downloadUrl: topic(45) });
check(shown.state === "unsupported" && opened.length === 0, "a page with no PDF viewer shouldn't be opened");
reset();
d2l.set(topic(46), { type: "application/octet-stream", body: slides });
d2l.set(view(46), { type: "text/html", body: convertingPage });
openedReply = { ok: true, location: "https://elsewhere.example.com/46.pdf" };
shown = await loadFile({ name: "", downloadUrl: topic(46) });
check(shown.state === "unsupported" && shown.src && fetches === 2, "a PDF address off D2L from the open page should be ignored, leaving the note and Download");
// KSU's slides page names a signed link in D2L's PDF store on Amazon S3
// (measured on a real topic, 2026-10-28). The store lets any page read it,
// but only without cookies.
const STORE = "https://d2l-docbuilder-prod-us-east-1-converted.s3.us-east-1.amazonaws.com/857f39d7-a377-40a5-9272-5bb63ea6aafe/c73756461f9ebf1e0ba03438b33b5410.pdf";
const signed = `${STORE}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=abc`;
check(pdfSource(viewerPage(signed.replace(/&/g, "&amp;")))?.url === signed && pdfAddress(signed) === signed, "D2L's PDF store should count as where a viewer's PDF is");
check(pdfAddress("http://d2l-docbuilder-prod-us-east-1-converted.s3.us-east-1.amazonaws.com/x.pdf") === "" && pdfAddress("https://other-bucket.s3.us-east-1.amazonaws.com/x.pdf") === "" && pdfAddress("https://d2l-docbuilder-prod.s3.amazonaws.com.example.com/x.pdf") === "", "only D2L's own store, over https, should count");
reset();
d2l.set(topic(48), { type: "application/octet-stream", body: slides });
d2l.set(view(48), { type: "text/html", body: viewerPage(signed.replace(/&/g, "&amp;")) });
d2l.set(signed, { type: "application/pdf", body: "%PDF-1.7\n" });
shown = await loadFile({ name: "", downloadUrl: topic(48) });
check(shown.state === "ready" && shown.kind === "pdf" && opened.length === 0, "slides whose page names a PDF in D2L's store should show that PDF");
check(sentCookies.get(signed) === "omit" && sentCookies.get(view(48)) === "include" && cache.has(`${topic(48)}#pdf`), "the store should be asked without cookies, and its PDF kept under the topic");
reset();
d2l.set(topic(49), { type: "application/octet-stream", body: slides });
d2l.set(view(49), { type: "text/html", body: convertingPage });
d2l.set(signed, { type: "application/pdf", body: "%PDF-1.7\n" });
openedReply = { ok: true, location: signed };
shown = await loadFile({ name: "", downloadUrl: topic(49) });
check(shown.kind === "pdf" && opened.length === 1, "a PDF in D2L's store found once the page is open should show too");
reset();
// D2L makes a PDF of a Word file too. It shows in place of the Word viewer,
// and Download still saves the .docx.
const word = await zipOf({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document/>" });
d2l.set(topic(50), { type: "application/octet-stream", body: word });
d2l.set(view(50), { type: "text/html", body: viewerPage(signed.replace(/&/g, "&amp;")) });
d2l.set(signed, { type: "application/pdf", body: "%PDF-1.7\n" });
shown = await loadFile({ name: "", downloadUrl: topic(50) });
check(shown.state === "ready" && shown.kind === "pdf" && shown.pdf?.startsWith("blob:") && shown.mime === DOCX_TYPE, "a Word file whose page names a PDF should show that PDF and download as a .docx");
check(sentCookies.get(signed) === "omit" && cache.has(`${topic(50)}#pdf`), "a Word file's PDF should be asked for without cookies and kept under the topic");
reset();
d2l.set(topic(51), { type: "application/octet-stream", body: word });
d2l.set(view(51), { type: "text/html", body: "<p>No viewer here.</p>" });
shown = await loadFile({ name: "", downloadUrl: topic(51) });
check(shown.state === "ready" && shown.kind === "docx" && shown.html.includes("Hello from Word") && opened.length === 0, "a Word file whose page names no PDF should still show in the Word viewer");
reset();
d2l.set(topic(52), { type: "application/octet-stream", body: word });
d2l.set(view(52), { type: "text/html", body: convertingPage });
d2l.set(signed, { type: "application/pdf", body: "%PDF-1.7\n" });
openedReply = { ok: true, location: signed };
shown = await loadFile({ name: "", downloadUrl: topic(52) });
check(shown.kind === "pdf" && opened.length === 1 && opened[0] === view(52), "a Word file whose PDF is named once its page is open should show that PDF");
reset();
d2l.set(topic(47), { type: "application/octet-stream", body: slides });
d2l.set(view(47), { type: "text/html", body: convertingPage });
shown = await loadFile({ name: "", downloadUrl: topic(47) });
check(shown.state === "unsupported" && shown.label === "PowerPoint files" && shown.src, "with no D2L tab to open the page in, the note and Download should stay");
reset();
d2l.set(topic(40), { type: "application/octet-stream", body: slides });
d2l.set(view(40), { type: "text/html; charset=utf-8", body: viewerPage("/content/enforced/9-ABC/Week%204%20Slides.pdf?d2lSessionVal=x&amp;ou=9") });
d2l.set(`${ORIGIN}/content/enforced/9-ABC/Week%204%20Slides.pdf?d2lSessionVal=x&ou=9`, { type: "application/pdf", body: "%PDF-1.5\n" });
shown = await loadFile({ name: "Week 4 Slides", downloadUrl: topic(40) });
check(shown.state === "ready" && shown.kind === "pdf" && shown.pdf?.startsWith("blob:"), "a PowerPoint should show as the PDF D2L made of it");
check(/presentationml/.test(shown.mime) && shown.src !== shown.pdf, "Download should still save the original .pptx");
check(cache.has(`${topic(40)}#pdf`), "D2L's PDF should be kept for next time");
let seen = fetches;
shown = await loadFile({ name: "Week 4 Slides", downloadUrl: topic(40) });
check(shown.kind === "pdf" && fetches === seen, "opening the slides again should use the kept copies, not D2L");
reset();
d2l.set(topic(41), { type: "application/octet-stream", body: slides });
d2l.set(view(41), { type: "text/html", url: `${ORIGIN}/d2l/login` });
d2l.set(`${ORIGIN}/content/enforced/9-ABC/Slides.pdf?ou=9`, { type: "application/pdf", body: "%PDF-1.5\n" });
pageReply = { ok: true, html: viewerPage("/content/enforced/9-ABC/Slides.pdf?ou=9") };
shown = await loadFile({ name: "", downloadUrl: topic(41) });
check(shown.kind === "pdf", "the topic page should load through a signed-in D2L tab when the dashboard can't");
reset();
d2l.set(topic(42), { type: "application/octet-stream", body: slides });
d2l.set(view(42), { type: "text/html", body: viewerPage(topic(42)) });
shown = await loadFile({ name: "", downloadUrl: topic(42) });
check(shown.state === "unsupported" && shown.label === "PowerPoint files", "a viewer that points at the PowerPoint itself, not a PDF, should leave the note");
reset();
d2l.set(topic(43), { type: "application/octet-stream", body: slides });
shown = await loadFile({ name: "", downloadUrl: topic(43) });
check(shown.state === "unsupported" && shown.src, "with no D2L page to read, a PowerPoint should still say what it is and offer Download");

reset();
d2l.set(topic(6), { type: "application/zip", body: await zipOf({ "notes/a.txt": "a" }) });
shown = await loadFile({ name: "", downloadUrl: topic(6) });
check(shown.state === "unsupported" && shown.label === "Zip folders" && fetches === 1, "a real zip folder should say what it is, without looking for a PDF of it");

reset();
d2l.set(topic(7), { type: "application/msword", body: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) });
shown = await loadFile({ name: "Essay.doc", downloadUrl: topic(7) });
check(shown.state === "unsupported" && shown.label === "Older Word files (.doc)", "an older Word file should be named");

reset();
d2l.set(topic(8), { type: "image/png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
shown = await loadFile({ name: "", downloadUrl: topic(8) });
check(shown.state === "ready" && shown.kind === "image", "a picture should show by its type");

// ------------------------------------------------------- failure reasons
reset();
d2l.set(topic(10), { type: "text/html", body: "<html>Sign in</html>", url: `${ORIGIN}/d2l/login?sessionExpired=1` });
shown = await loadFile({ name: "", downloadUrl: topic(10) });
check(shown.state === "signed-out" && asked === 1, "D2L's sign-in page should mean signed out, after asking an open D2L tab");

reset();
d2l.set(topic(11), { type: "text/html", body: "<html>Sign in</html>", url: `${ORIGIN}/d2l/login` });
tabReply = { ok: true, dataUrl: `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n").toString("base64")}`, type: "application/pdf" };
shown = await loadFile({ name: "", downloadUrl: topic(11) });
check(shown.state === "ready" && shown.kind === "pdf", "a file the dashboard can't load should load through a signed-in D2L tab");

reset();
d2l.set(topic(12), { status: 404, type: "text/html" });
shown = await loadFile({ name: "", downloadUrl: topic(12) });
check(shown.state === "not-found" && asked === 0, "a missing file should say so without asking a D2L tab");

reset();
d2l.set(topic(13), { status: 403, type: "text/html" });
tabReply = { ok: false, reason: "no-access", status: 403 };
shown = await loadFile({ name: "", downloadUrl: topic(13) });
check(shown.state === "no-access", "D2L refusing the file should say so");

reset();
d2l.set(topic(14), { type: "video/mp4", body: "x", length: 200 * MB });
shown = await loadFile({ name: "", downloadUrl: topic(14) });
check(shown.state === "too-large" && shown.size === 200 * MB && shown.limit === 100 * MB && asked === 0, "a file over the limit should say how big it is, without downloading it");

reset();
d2l.set(topic(15), { type: "text/html", url: `${ORIGIN}/d2l/login` });
tabReply = { ok: false, reason: "too-large", size: 60 * MB, limit: 50 * MB };
shown = await loadFile({ name: "", downloadUrl: topic(15) });
check(shown.state === "too-large" && shown.limit === 50 * MB, "the D2L tab's own size limit should be reported");

reset();
d2l.set(topic(16), "throw");
online = false;
shown = await loadFile({ name: "", downloadUrl: topic(16) });
check(shown.state === "offline" && asked === 0, "no internet should say so");
online = true;
shown = await loadFile({ name: "", downloadUrl: topic(16) });
check(shown.state === "no-answer", "D2L not answering should say so");

reset();
d2l.set(topic(17), { status: 500, type: "text/html" });
shown = await loadFile({ name: "", downloadUrl: topic(17) });
check(shown.state === "http" && shown.status === 500, "a D2L error should keep its number");

// ------------------------------------------------- the saved copy fallback
reset();
d2l.set(topic(20), { type: "text/html", url: `${ORIGIN}/d2l/login` });
saved.set("/Users/student/Downloads/D2L Export/Reading.pdf", new Blob(["%PDF-1.4\n"]));
shown = await loadFile({ name: "Reading", localPath: "D2L Export/Reading.pdf", downloadUrl: topic(20) });
check(shown.state === "ready" && shown.kind === "pdf", "the saved copy should show when D2L can't hand the file over");
fileAccess = false;
shown = await loadFile({ name: "Reading", localPath: "D2L Export/Reading.pdf", downloadUrl: topic(20) });
check(shown.state === "signed-out" && shown.hint === "access", "with file access off, the D2L reason should come first, with a hint about the saved copy");
shown = await loadFile({ name: "Reading", localPath: "D2L Export/Reading.pdf", downloadUrl: "" });
check(shown.state === "access", "a saved copy alone, with file access off, should ask for file access");
fileAccess = true;
shown = await loadFile({ name: "Reading", localPath: "D2L Export/Gone.pdf", downloadUrl: "" });
check(shown.state === "missing", "no D2L file and no saved copy should say there's nothing to show");
fetches = 0;
shown = await loadFile({ name: "Tool", localPath: "", downloadUrl: `${ORIGIN}/d2l/common/dialogs/quickLink/quickLink.d2l?ou=1` });
check(shown.state === "missing" && fetches === 0, "a quick link to a tool is not a file and shouldn't be loaded");

// ------------------------------------------ the background's D2L-tab load
const background = read("background.js");
const inTabSource = background.slice(background.indexOf("async (fileUrl, limit, page = false) =>"), background.indexOf("\n  });\n  return injection?.result"));
const inTab = vm.runInThisContext(`(${inTabSource})`);
globalThis.FileReader = class { readAsDataURL(blob) { blob.arrayBuffer().then((bytes) => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`; this.onload(); }); } };
reset();
d2l.set(topic(30), { type: "text/html", url: `${ORIGIN}/d2l/login` });
d2l.set(topic(31), { status: 404, type: "text/html" });
d2l.set(topic(32), { status: 403, type: "text/html" });
d2l.set(topic(33), { type: "text/html" });
d2l.set(topic(34), { type: "application/pdf", body: "x", length: 60 * MB });
d2l.set(topic(35), { type: "application/pdf", body: "%PDF-1.4\n" });
d2l.set(topic(36), { status: 502, type: "text/html" });
const tab = async (id) => inTab(topic(id), 50 * MB);
check((await tab(30)).reason === "signed-out", "in a D2L tab, the sign-in page should mean signed out");
check((await tab(31)).reason === "not-found" && (await tab(32)).reason === "no-access", "in a D2L tab, 404 and 403 should be told apart");
check((await tab(33)).reason === "not-file", "in a D2L tab, a web page instead of a file should say so");
check((await tab(34)).reason === "too-large" && (await tab(34)).limit === 50 * MB, "in a D2L tab, a file over 50 MB should be refused with its size");
check((await tab(36)).reason === "http" && (await tab(36)).status === 502, "in a D2L tab, other errors should keep their number");
const good = await tab(35);
check(good.ok && good.dataUrl.startsWith("data:application/pdf;base64,"), "in a D2L tab, a file should come back as a data URL");
d2l.set(view(37), { type: "text/html", body: "<html>Week 4</html>" });
check((await inTab(view(37), 50 * MB, true)).html === "<html>Week 4</html>", "in a D2L tab, a topic page should come back as text");
check((await inTab(topic(35), 50 * MB, true)).reason === "not-file", "in a D2L tab, asking for a page and getting a file should say so");
check(background.includes("message.page === true") && background.includes("!url.startsWith(`${D2L_ORIGIN}/`)"), "the D2L tab should load D2L's PDF copies, which live outside /d2l/");
const openStart = background.indexOf("async (pageUrl, wait) =>");
const openInTab = vm.runInThisContext(`(${background.slice(openStart, background.indexOf("\n  });\n  return injection?.result", openStart))})`);
const frames = [];
const realDocument = globalThis.document;
const realTimeout = globalThis.setTimeout;
// A frame whose page sets the viewer's address on its third look.
globalThis.document = {
  documentElement: { append: (frame) => { frame.attached = true; } },
  createElement: () => {
    const frame = { looks: 0, style: {}, setAttribute() {}, remove() { frame.removed = true; } };
    Object.defineProperty(frame, "contentDocument", { get: () => ({ querySelector: () => (frame.looks += 1) >= 3 && frame.src === view(50) ? { getAttribute: () => "/content/enforced/9-ABC/50.pdf" } : null }) });
    frames.push(frame);
    return frame;
  }
};
globalThis.setTimeout = (next) => realTimeout(next, 0);
const read50 = await openInTab(view(50), 5000);
check(read50.ok && read50.location === "/content/enforced/9-ABC/50.pdf" && frames[0].src === view(50) && frames[0].attached && frames[0].removed, "in a D2L tab, the open page's viewer address should be read, and the page closed");
check(frames[0].style.cssText.includes("visibility:hidden") && frames[0].style.cssText.includes("left:-10000px"), "the opened page should stay out of sight");
const read51 = await openInTab(view(51), 30);
check(!read51.ok && read51.reason === "no-answer" && frames[1].removed, "a page that never names a PDF should give up and close");
globalThis.setTimeout = realTimeout;
globalThis.document = realDocument;
check(background.includes('message?.type === "D2L_VIEWER_PDF"') && background.includes("/\\/viewContent\\/\\d+\\/View$/.test(url)) return { ok: false, error: \"Not a D2L topic page.\" }"), "only D2L topic pages should be opened in a D2L tab");
check(!/method:\s*["']POST["']/.test(background), "the background should never send D2L a POST either");
check(/reason: "no-tab"/.test(background) && /reason: "no-answer"/.test(background), "no D2L tab and no answer should each have a reason");

// ---------------------------------------------------------------- messages
const dash = loadDashboard();
const note = (view) => dash.previewNote(view);
check(/sign in to D2L in another tab/i.test(note({ state: "signed-out" })), "signed out should say to sign in");
check(/couldn't find/.test(note({ state: "not-found" })) && /hidden|link or a tool/.test(note({ state: "no-access" })), "missing and refused files should each be explained");
check(note({ state: "too-large", size: 200 * MB, limit: 100 * MB }) === "This file is 200 MB, more than the 100 MB that can be previewed here. Open it in D2L instead.", "too big should give the size and the limit");
check(/internet/.test(note({ state: "offline" })) && /error 500/.test(note({ state: "http", status: 500 })), "offline and D2L errors should be explained");
check(note({ state: "signed-out", hint: "access" }).includes("Allow access to file URLs"), "with a saved copy that can't be read, the note should say how to allow it");
check(note({ state: "unsupported", label: "PowerPoint files", d2lUrl: "x", src: "blob:x" }) === "PowerPoint files can't be shown here. Open it in D2L to read it.", "a named file the viewer can't show should say what it is and to open it in D2L");
check(note({ state: "unsupported", label: "Excel files", src: "blob:x" }) === "Excel files can't be shown here. Download it to read it.", "with no D2L page, it should say to download it");

// -------------------------------------------------------------- the viewer
const page = dash.filePreview({ name: "Module 10 Objectives", state: "ready", kind: "page", html: '<p class="x">Hi</p>', src: "blob:p", mime: "text/html", d2lUrl: `${ORIGIN}/d2l/le/content/9/viewContent/3/View` });
check(page.includes('<iframe class="doc-frame" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="&lt;p class=&quot;x&quot;&gt;Hi&lt;/p&gt;"'), "a page should show in a sandboxed frame, its markup escaped");
check(!/allow-scripts|allow-same-origin/.test(page), "the page frame must not run scripts or reach the dashboard");
check(page.includes('href="blob:p" download="Module 10 Objectives.html"') && page.includes(">Open in D2L"), "a loaded page should offer Download and Open in D2L");
const named = dash.filePreview({ name: "Reading.pdf", state: "ready", kind: "pdf", src: "blob:r", mime: "application/pdf" });
check(named.includes('download="Reading.pdf"'), "a name that already has its extension should keep it");
check(dash.filePreview({ name: "Slides", state: "unsupported", label: "PowerPoint files", src: "blob:s", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }).includes('download="Slides.pptx"'), "a file the viewer can't show should still offer Download");
check(!dash.filePreview({ name: "Reading.pdf", state: "loading" }).includes("download="), "a file still loading should offer no Download");
const slideView = dash.filePreview({ name: "Week 4 Slides", state: "ready", kind: "pdf", src: "blob:pptx", pdf: "blob:pdf", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
check(slideView.includes('<iframe src="blob:pdf"') && slideView.includes('href="blob:pptx" download="Week 4 Slides.pptx"'), "slides should show D2L's PDF and download the original .pptx");
check(dash.relatedPeek({ title: "Week 4 Slides", state: "unsupported", label: "PowerPoint files", src: "blob:s", mime: "application/zip", d2lUrl: "x", at: 0, count: 1 }).includes('download="Week 4 Slides.zip"'), "the side panel should offer Download for a file it can't show");

// ------------------------------------------------- where previews start
const row = (item) => dash.resourceRow({ id: "r", title: "Test 3 Review", type: "File", icon: "file", localPath: "", external: "", ...item }, "");
const d2lFile = row({ downloadUrl: topic(1), d2lUrl: `${ORIGIN}/d2l/le/content/9/viewContent/1/View` });
check(d2lFile.startsWith("<a ") && d2lFile.includes("data-preview") && d2lFile.includes(`data-download="${topic(1)}"`), "a Content file with no saved copy should preview from D2L");
check(!d2lFile.includes("data-d2l-link") && d2lFile.includes("viewContent/1/View"), "the row should stay a link to D2L for a new tab, without the Open in D2L prompt");
const onlyDownload = row({ downloadUrl: topic(1), d2lUrl: "" });
check(onlyDownload.startsWith("<button ") && onlyDownload.includes('data-action="preview-file"'), "a D2L file with no topic page should be a preview button");
const linkTopic = row({ downloadUrl: topic(1), external: "https://syllabus.example.com/kennesaw", d2lUrl: `${ORIGIN}/d2l/le/content/9/viewContent/2/View` });
check(linkTopic.includes("data-confirm-external") && !linkTopic.includes("data-preview"), "a link or tool topic (like Simple Syllabus) should open, not preview");
const quizTopic = row({ type: "Quiz", downloadUrl: `${ORIGIN}/d2l/lms/quizzing/user/quiz_summary.d2l?ou=9&qi=12`, d2lUrl: `${ORIGIN}/d2l/le/content/9/viewContent/4/View` });
check(quizTopic.includes("data-d2l-link") && !quizTopic.includes("data-preview"), "a quiz, discussion or assignment topic keeps a D2L page address, and should open in D2L, not preview");
const quickLink = row({ downloadUrl: `${ORIGIN}/d2l/common/dialogs/quickLink/quickLink.d2l?ou=1`, d2lUrl: `${ORIGIN}/d2l/le/content/9/viewContent/2/View` });
check(quickLink.includes("data-d2l-link") && !quickLink.includes("data-preview"), "a D2L tool should open in D2L");
check(dash.fileRow({ name: "Rubric.pdf", downloadUrl: `${ORIGIN}/d2l/api/le/1.75/9/dropbox/folders/1/attachments/2`, url: `${ORIGIN}/d2l/api/le/1.75/9/dropbox/folders/1/attachments/2` }).includes('data-action="preview-file"'), "an assignment file D2L can hand over should offer Preview");
check(dash.fileRow({ name: "Elsewhere", url: "https://example.com/file" }).includes("Download from D2L"), "a file the viewer can't load should keep its link");

// ---------------------------------------------------------------- wiring
const html = read("dashboard.html");
check(html.indexOf("src/dashboard/preview-formats.js") > 0 && html.indexOf("src/dashboard/preview-formats.js") < html.indexOf("src/dashboard/app-preview.js"), "the formats should load before the viewer");
check(!/src\/vendor\//.test(html), "the bundled libraries should load only when a .zip or Word file is opened");
check(/JSZip v3\.10\.2/.test(read("src/vendor/jszip.min.js")) && /docx-preview/.test(read("src/vendor/docx-preview.min.js").slice(0, 300)) && /Apache License/.test(read("src/vendor/docx-preview.min.js").slice(0, 300)), "the bundled libraries should keep their license notices");
const events = read("src/dashboard/app-events.js");
check(events.includes('link.hasAttribute("data-preview")') && !/data-file-open|preview-confirmed-file|open-confirmed-d2l/.test(events + read("src/dashboard/render.js") + read("src/dashboard/app-overlay.js")), "a file row should open the viewer directly; the Preview-or-D2L box is gone");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("File preview loads from D2L or the saved copy, shows PDFs, pictures, D2L pages, Word files and D2L's PDFs of slides, and explains every refusal.");
