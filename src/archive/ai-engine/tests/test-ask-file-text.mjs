// Ask reads the text inside course files: PDFs through the bundled pdf.js, Word files
// through the bundled zip reader, PowerPoint through the PDF D2L made of it, and D2L
// pages and text files as they are. Each file is read once and kept on this computer;
// search_archive then finds text inside files, and item_details shows it.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
// Node calls the loader that lets the reader import pdf.js experimental, and pdf.js in Node
// says it can't draw pages. Neither matters for reading text, so neither is printed.
process.removeAllListeners("warning");
process.on("warning", (warning) => { if (warning.name !== "ExperimentalWarning") console.error(warning); });
const quietly = async (work) => {
  const { log, warn } = console;
  console.log = console.warn = () => {};
  try { return await work(); } finally { Object.assign(console, { log, warn }); }
};
const pdfjsUrl = (file) => pathToFileURL(path.join(root, "src/vendor/pdfjs", file)).href;
const [pdfjs] = await quietly(() => Promise.all(["pdf.min.mjs", "pdf.worker.min.mjs"].map((file) => import(pdfjsUrl(file)))));
const run =(file) => vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const ORIGIN = "https://kennesaw.view.usg.edu";
const topic = (id) => `${ORIGIN}/d2l/le/content/101/topics/files/download/${id}/DirectFileTopicDownload`;
const attachment = (id) => `${ORIGIN}/d2l/api/le/1.75/101/dropbox/folders/1/attachments/${id}`;

// A one-font PDF: each page is a list of text lines.
function makePdf(pages) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesId = objects.length + 1 + pages.length * 2;
  const kids = [];
  for (const lines of pages) {
    const ops = lines.map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 18} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
    const content = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: "application/pdf" });
}

// ---- a fake D2L: what it hands over for each address -----------------------------------------
const d2l = new Map();
const madePdfs = new Map();
const asked = [];
globalThis.D2LDashboard = { appModules: {
  fileFromD2l: async (url, options) => { asked.push({ url, keep: options?.keep }); return d2l.has(url) ? d2l.get(url) : { reason: "not-found" }; },
  pdfFromD2l: async (url, options) => { asked.push({ url, keep: options?.keep, pdf: true }); return madePdfs.get(url) || null; }
} };
let extensionRoot = path.join(root, "missing");
globalThis.chrome = { runtime: { getURL: (file) => pathToFileURL(path.join(extensionRoot, file)).href } };
for (const file of ["src/dashboard/format.js", "src/dashboard/model.js", "src/vendor/jszip.min.js", "src/dashboard/preview-formats.js", "src/dashboard/ask/file-text-store.js", "src/dashboard/ask/file-text-reader.js"]) run(file);
const dash = globalThis.D2LDashboard;

const zipOf = async (files) => {
  const zip = new globalThis.JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return new Blob([await zip.generateAsync({ type: "uint8array" })]);
};
let next = 0;
async function readAs(name, answer, extra = {}) {
  const url = topic(next += 1);
  d2l.set(url, answer);
  return dash.askReadFileText({ url, name, size: 0, ...extra });
}

// ---- reading one file ---------------------------------------------------------------------------
const SYLLABUS = makePdf([["CS 1301 Syllabus", "Instructor: Dr. Rivera"], ["Midterm exam: Thursday, October 15, 2026, in class", "Grades: A >= 90, B < 90"]]);
const noPdfReader = await readAs("Syllabus.pdf", { blob: SYLLABUS }).then(() => null, (error) => error);
check(noPdfReader?.stopAll && /The PDF reader couldn't be loaded/.test(noPdfReader.message), `a PDF reader that won't load stops the reading instead of marking each file unreadable, got ${noPdfReader}`);
extensionRoot = root;

const syllabus = await readAs("Syllabus.pdf", { blob: SYLLABUS });
check(pdfjs.GlobalWorkerOptions.workerSrc === pdfjsUrl("pdf.worker.min.mjs"), `pdf.js reads in its own worker, the bundled one, got ${pdfjs.GlobalWorkerOptions.workerSrc}`);
check(syllabus.state === "read" && syllabus.pages === 2 && !syllabus.cut, `a PDF is read with the bundled pdf.js once it loads, got ${JSON.stringify(syllabus)}`);
check(syllabus.text === "CS 1301 Syllabus\nInstructor: Dr. Rivera\nMidterm exam: Thursday, October 15, 2026, in class\nGrades: A >= 90, B < 90", `its lines and pages are kept in order, got ${JSON.stringify(syllabus.text)}`);
check(syllabus.pageText?.[0] === "CS 1301 Syllabus\nInstructor: Dr. Rivera" && syllabus.pageText?.[1].startsWith("Midterm exam:"), "PDF text keeps its page numbers for dossier source citations");
check(asked.at(-1).keep === false, "a file read for Ask is not added to the saved previews");

const scan = await readAs("Scanned notes.pdf", { blob: makePdf([[], [], ["Scanned by the copier on 11/02/2026"]]) });
check(scan.state === "scan" && scan.pages === 3 && !("text" in scan), `a PDF of pictures of pages is a scan, got ${JSON.stringify(scan)}`);
const line = "Chapter review: sorting, searching and recursion with worked examples for every lab. ";
const book = await readAs("Reader.pdf", { blob: makePdf(Array.from({ length: 24 }, () => Array.from({ length: 40 }, () => line))) });
check(book.state === "read" && book.cut === true && book.text.length === 60000 && book.pages === 24, `a long PDF is kept to its first 60,000 characters, got ${book.state} ${book.text?.length} ${book.cut}`);
const broken = await readAs("Broken.pdf", { blob: new Blob(["%PDF-1.4\nnot a real file"]) });
check(broken.state === "failed", `a PDF that can't be opened is marked unreadable, got ${JSON.stringify(broken)}`);

const WORD = "<?xml version=\"1.0\"?><w:document><w:body><w:p><w:r><w:t>Lab 4: Sorting</w:t></w:r></w:p><w:p><w:r><w:t>Due</w:t><w:tab/><w:t>Friday &amp; bring a laptop</w:t><w:br/><w:t xml:space=\"preserve\">Grade &lt;= 20 points &#8212; caf&#xE9;</w:t></w:r></w:p></w:body></w:document>";
const word = await readAs("Lab 4.docx", { blob: await zipOf({ "[Content_Types].xml": "<Types/>", "word/document.xml": WORD }) });
check(word.state === "read" && word.text === "Lab 4: Sorting\nDue Friday & bring a laptop\nGrade <= 20 points — café", `a Word file's paragraphs, tabs, breaks and characters are read, got ${JSON.stringify(word)}`);
const blankWord = await readAs("Blank.docx", { blob: await zipOf({ "word/document.xml": "<w:document><w:body><w:p><w:r><w:t> </w:t></w:r></w:p></w:body></w:document>" }) });
check(blankWord.state === "empty", `a Word file with no words has no text, got ${JSON.stringify(blankWord)}`);

const page = await readAs("", { blob: await zipOf({ "Week 1.html": "<html><head><style>p { color: red }</style></head><body><h1>Week 1</h1><p>Office hours: Tuesdays 2&ndash;4 PM in J&#x2011;204 &amp; online &lt;Teams&gt;</p><script>alert(1)</script></body></html>" }) });
check(page.state === "read" && page.text === "Week 1\nOffice hours: Tuesdays 2–4 PM in J‑204 & online <Teams>", `a D2L page is read as its words, got ${JSON.stringify(page)}`);
const notes = await readAs("notes.txt", { blob: new Blob(["Bring   a calculator.\n\n\nNo phones <ever>."], { type: "text/plain" }) });
check(notes.state === "read" && notes.text === "Bring a calculator.\nNo phones <ever>.", `a text file is read as it is, with spaces tidied, got ${JSON.stringify(notes)}`);

const picture = await readAs("diagram.png", { blob: new Blob(["not really a picture"], { type: "image/png" }) });
check(picture.state === "unsupported" && picture.what === "picture" && !asked.at(-1).pdf, `a picture is named, and D2L isn't asked for a PDF of it, got ${JSON.stringify(picture)}`);
const slidesUrl = topic(next + 1);
madePdfs.set(slidesUrl, makePdf([["Week 4 slides: binary search runs in log n steps"]]));
const slides = await readAs("Week 4.pptx", { blob: await zipOf({ "ppt/presentation.xml": "<p:presentation/>" }) });
check(slides.state === "read" && /binary search runs in log n steps/.test(slides.text) && asked.at(-1).pdf && asked.at(-1).keep === false, `a PowerPoint is read from the PDF D2L made of it, got ${JSON.stringify(slides)}`);
const noPdf = await readAs("Grades.xlsx", { blob: await zipOf({ "xl/workbook.xml": "<workbook/>" }) });
check(noPdf.state === "unsupported" && noPdf.what === "file", `an Excel file with no PDF from D2L can't be read, got ${JSON.stringify(noPdf)}`);
const folder = await readAs("Starter.zip", { blob: await zipOf({ "src/main.py": "print(1)" }) });
check(folder.state === "unsupported" && !asked.at(-1).pdf, "a zip folder is not sent looking for a PDF");

const before = asked.length;
const huge = await readAs("Lecture.mp4", { blob: new Blob([]) }, { size: 15 * 1024 * 1024 + 1 });
check(huge.state === "too-large" && asked.length === before, "a file the archive says is over 15 MB is skipped without asking D2L");
check((await readAs("Video.pdf", { blob: new Blob([new Uint8Array(15 * 1024 * 1024 + 1)]) })).state === "too-large", "a file over 15 MB from D2L is not read");
check((await readAs("Big.pdf", { reason: "too-large", size: 9e7 })).state === "too-large", "a file D2L says is too big is too large");
check((await readAs("Gone.pdf", { reason: "not-found" })).state === "unavailable", "a file D2L doesn't have is unavailable");
check((await readAs("Elsewhere.pdf", null)).state === "unavailable", "an address that isn't a D2L file is unavailable");
check((await readAs("Later.pdf", { reason: "signed-out" })).state === "signed-out" && (await readAs("Later.pdf", { reason: "offline" })).state === "offline", "signed out or offline is said as it is, to try again later");

// ---- the files in the archive ---------------------------------------------------------------------
const lab = { entityId: "assignment:101:1", entityType: "assignmentBundle", courseId: "101", canonicalTitle: "Lab 4" };
const entities = [
  { entityId: "resource:101:8", entityType: "learningResource", courseId: "101", canonicalTitle: "Syllabus", resourceType: "File", urls: { download: topic(1001) } },
  { entityId: "resource:101:9", entityType: "learningResource", courseId: "101", canonicalTitle: "Course site", resourceType: "Link", urls: { download: "https://example.com/site" } },
  { entityId: "resource:101:0", entityType: "learningResource", courseId: "101", canonicalTitle: "Start Here", isModule: true, urls: { download: topic(1000) } },
  lab
];
const evidence = [
  { source: "assignmentAttachment", courseId: "101", title: "lab4-rubric.pdf", urls: { download: attachment(1) }, size: 2048, platformIds: { dropboxFolderId: "1" } },
  { source: "assignmentAttachment", courseId: "101", title: "lab4-rubric copy.pdf", urls: { download: attachment(1) }, platformIds: { dropboxFolderId: "1" } },
  { source: "contentAttachment", courseId: "101", title: "Syllabus again", urls: { download: topic(1001) }, platformIds: { contentObjectId: "8" } },
  { source: "announcementAttachment", courseId: "101", title: "outside.pdf", urls: { download: "https://example.com/outside.pdf" }, platformIds: { newsItemId: "5" } },
  { source: "assignmentFeedback", courseId: "101", title: "feedback.pdf", urls: { download: attachment(2) } }
];
const files = dash.askCourseFiles(entities, evidence, new Map([[lab.entityId, lab]]));
check(files.length === 2 && files[0].url === topic(1001) && files[0].ownerId === "resource:101:8" && files[0].owner === "Syllabus", `a Content file is listed once, as its own item, got ${JSON.stringify(files)}`);
check(files[1].url === attachment(1) && files[1].name === "lab4-rubric.pdf" && files[1].ownerId === "assignment:101:1" && files[1].owner === "Lab 4" && files[1].size === 2048, `an attached file is listed with the item it belongs to; links, modules, feedback and files off D2L are not, got ${JSON.stringify(files[1])}`);

const known = new Map([[topic(1001), { state: "read", text: "Midterm exam: Thursday, October 15, 2026", name: "Syllabus" }]]);
d2l.set(attachment(1), { blob: makePdf([["Rubric: 10 points for a working sort, 10 for clean code"]]) });
d2l.set(attachment(3), { reason: "signed-out" });
d2l.set(attachment(4), { blob: new Blob(["Bring your own laptop."], { type: "text/plain" }) });
const kept = [];
const progress = [];
let outcome = await dash.askReadCourseFiles({ files, known, keep: async (url, record) => { kept.push([url, record]); }, onProgress: (step) => progress.push(step) });
check(outcome.state === "done" && outcome.done === 1 && outcome.total === 1, `only files not read before are read, got ${JSON.stringify(outcome)}`);
check(!asked.some((one) => one.url === topic(1001)) && kept.length === 1 && kept[0][0] === attachment(1) && kept[0][1].state === "read" && kept[0][1].name === "lab4-rubric.pdf" && kept[0][1].readAt, "each new file is kept as it is read, with its name and when");
check(known.get(attachment(1))?.state === "read" && progress.length === 1 && progress[0].done === 1 && progress[0].total === 1 && progress[0].name === "lab4-rubric.pdf", `progress is told after each file, got ${JSON.stringify(progress)}`);

const more = [3, 4].map((id) => ({ url: attachment(id), name: `file ${id}`, courseId: "101" }));
const stoppedAt = known.size;
outcome = await dash.askReadCourseFiles({ files: more, known, keep: async () => {} });
check(outcome.state === "signed-out" && outcome.done === 0 && outcome.total === 2 && known.size === stoppedAt, `signed out, reading stops at once and nothing is kept, so it's tried again next time, got ${JSON.stringify(outcome)}`);
const stop = new AbortController();
outcome = await dash.askReadCourseFiles({ files: [more[1], more[0]], known, keep: async () => {}, signal: stop.signal, onProgress: () => stop.abort() });
check(outcome.state === "stopped" && outcome.done === 1 && outcome.total === 2 && known.has(attachment(4)), `Stop ends the reading after the file being read, got ${JSON.stringify(outcome)}`);
const brokenReader = await dash.askReadCourseFiles({ files: [{ url: topic(1002), name: "x.pdf" }], known, keep: async () => {} }).then(() => null, (error) => error);
check(brokenReader === null, "files after a reader that loaded fine are not stopped");

const passages = dash.askFilePassages([...files, { url: attachment(9), name: "scan.pdf" }], new Map([...known, [attachment(9), { state: "scan" }]]));
check(passages.length === 2 && passages[0].partOf === "" && passages[0].title === "Syllabus" && passages[1].partOf === "Lab 4" && passages[1].ownerId === "assignment:101:1" && /Rubric/.test(passages[1].text), `each file read is a passage, with the item it belongs to, got ${JSON.stringify(passages)}`);

// ---- kept on this computer, per D2L account ----------------------------------------------------------
const rows = new Map();
let storeReads = 0;
const store = dash.createFileTextStore({ getAll: async () => { storeReads += 1; return [...rows.values()]; }, put: async (record) => { rows.set(record.key, record); }, remove: async (keys) => keys.forEach((key) => rows.delete(key)) });
await store.keep("student-1", topic(1), { state: "read", text: "one" });
await store.keep("student-2", topic(1), { state: "scan" });
await store.keep("", topic(2), { state: "read", text: "nobody" });
const mine = await store.all(" student-1 ");
check(mine.size === 1 && mine.get(topic(1))?.text === "one" && rows.size === 2, "each account sees only its own files; with no account nothing is kept");
await store.clear("student-1");
check(rows.size === 1 && (await store.all("student-2")).get(topic(1))?.state === "scan", "clearing one account leaves the other's");
const readsBefore = storeReads;
check((await store.all("")).size === 0 && storeReads === readsBefore, "with no account the store isn't even opened");

// ---- searching and describing what the files say --------------------------------------------------------
const app = loadDashboard();
const now = new Date(2026, 10, 4, 9, 0);
const courses = [{ courseId: "101", label: "CS 1301" }];
const longText = `Rubric. ${"Each criterion is worth points. ".repeat(100)}`;
const texts = new Map([
  [topic(1001), { state: "read", text: "CS 1301 Syllabus\nMidterm exam: Thursday, October 15, 2026, in class\nGrades: B < 90 and C > 70" }],
  [attachment(1), { state: "read", text: longText }],
  ...[2, 3, 4].map((id) => [attachment(id), { state: "read", text: `Starter file ${id} for the sorting lab.` }]),
  [attachment(5), { state: "scan" }],
  [topic(1003), { state: "unsupported", what: "picture" }]
]);
const appEntities = [
  { ...entities[0], dates: {} },
  { entityId: "resource:101:10", entityType: "learningResource", courseId: "101", canonicalTitle: "Class diagram", resourceType: "File", urls: { download: topic(1003) } },
  { ...lab, attachments: ["lab4-rubric.pdf", "starter-2.zip", "starter-3.zip", "starter-4.zip", "lab4-scan.pdf"].map((name) => ({ name })), dates: { dueAt: new Date(2026, 10, 6, 23, 59).toISOString() } }
];
const appEvidence = [["lab4-rubric.pdf", 1], ["starter-2.zip", 2], ["starter-3.zip", 3], ["starter-4.zip", 4], ["lab4-scan.pdf", 5]]
  .map(([title, id]) => ({ source: "assignmentAttachment", courseId: "101", title, urls: { download: attachment(id) }, platformIds: { dropboxFolderId: "1" } }));
const index = app.buildIndex({ now, courses: [{ courseId: "101", code: "CS1301", title: "Intro to Computing" }], entities: appEntities, settings: {} });
const appFiles = app.askCourseFiles(appEntities, appEvidence, index.byId);
const passageIndex = app.buildPassageIndex({ entities: appEntities, courses, files: app.askFilePassages(appFiles, texts) });
const ctx = { passageIndex, index, now, checklistDone: {}, hiddenWork: {}, fileTexts: texts, bundleFor: async (id) => (id === lab.entityId ? { evidence: appEvidence } : null) };

const midterm = await app.runAskTool(ctx, "search_archive", { query: "midterm exam date" });
const hit = midterm.result.results?.[0];
check(hit?.kind === "File" && hit.title === "Syllabus" && /October 15, 2026/.test(hit.text) && !("part_of" in hit), `search_archive finds a date inside a syllabus PDF, got ${JSON.stringify(midterm.result)}`);
const grades = (await app.runAskTool(ctx, "search_archive", { query: "grades" })).result.results?.find((one) => one.kind === "File");
check(/B < 90 and C > 70/.test(grades?.text), `a "<" in a file's text is kept, not taken for a tag, got ${JSON.stringify(grades)}`);
const rubric = (await app.runAskTool(ctx, "search_archive", { query: "criterion worth points" })).result.results?.[0];
check(rubric?.title === "lab4-rubric.pdf" && rubric.part_of === "Lab 4", `a file attached to an item says which item, got ${JSON.stringify(rubric)}`);

const labItem = (await app.runAskTool(ctx, "item_details", { title: "Lab 4" })).result.item;
const [first, second, third, fourth, fifth] = labItem?.files || [];
check(first?.name === "lab4-rubric.pdf" && first.text.length === 1500 && first.text.endsWith("…") && first.text.startsWith("Rubric. Each criterion"), `an attached file's text is cut to 1,500 characters, got ${JSON.stringify(first)?.slice(0, 200)}`);
check(second?.text === "Starter file 2 for the sorting lab." && third?.text && !fourth?.text && fourth?.note === "too many files to show its text; search_archive finds it", `at most 3 files show their text, got ${JSON.stringify(labItem?.files)}`);
check(fifth?.note === "a scan; can't be read yet", `a scan says it can't be read yet, got ${JSON.stringify(fifth)}`);
const syllabusItem = (await app.runAskTool(ctx, "item_details", { title: "Syllabus" })).result.item;
check(/Midterm exam: Thursday, October 15, 2026/.test(syllabusItem?.file_text) && /B < 90 and C > 70/.test(syllabusItem.file_text) && !("file" in syllabusItem), `a Content file gives its text, got ${JSON.stringify(syllabusItem)}`);
const diagram = (await app.runAskTool(ctx, "item_details", { title: "Class diagram" })).result.item;
check(diagram?.file === "a picture; can't be read" && !("file_text" in diagram), `a file that can't be read says why, got ${JSON.stringify(diagram)}`);
const unread = (await app.runAskTool({ ...ctx, fileTexts: new Map() }, "item_details", { title: "Syllabus" })).result.item;
check(!("file_text" in unread) && !("file" in unread), "a file not read yet adds nothing");

// ---- what the Ask page says while reading -----------------------------------------------------------
const reading = app.askFilesHtml({ files: { state: "reading", done: 12, total: 40 } });
check(/Reading files 12 of 40/.test(reading) && /data-ask-files-stop/.test(reading) && /<progress[^>]*max="40" value="12"/.test(reading), "while reading it shows how far along it is, with a Stop button");
check(/Read 40 course files\. Ask can search inside them\./.test(app.askFilesHtml({ files: { state: "done", done: 40, total: 40 } })), "when done it says how many files were read");
check(/Stopped after 3 of 40 files\. The rest are read the next time you start Ask\./.test(app.askFilesHtml({ files: { state: "stopped", done: 3, total: 40 } })), "stopped, it says the rest are read next time");
check(/Sign in to D2L so Ask can read your files\./.test(app.askFilesHtml({ files: { state: "signed-out", done: 0, total: 4 } })) && !/data-ask-files-stop/.test(app.askFilesHtml({ files: { state: "done", done: 1, total: 1 } })), "signed out, it says to sign in; Stop shows only while reading");
check(app.askFilesHtml({ files: null }) === "", "nothing to read shows nothing");

if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("ask file text: reads PDFs, Word files and pages once, and finds text inside them");
