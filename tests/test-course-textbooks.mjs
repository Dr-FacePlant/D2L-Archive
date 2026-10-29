import fs from "node:fs";
import path from "node:path";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();
const NOW = "2026-10-22T12:00:00.000Z";

// ---- detection -----------------------------------------------------------
const detected = dash.parseTextbookMentions(`
  <b>Required Text:</b> World of Art, 8th Edition. ISBN 978-0-13-467929-7
  <p>Textbook: Traditions &amp; Encounters 6e — https://www.mheducation.com/heps-and-encounters-6e</p>
  Week 1 Announcements — text messages welcome.
`);
check(detected.length === 2, `syllabus lines should detect two textbooks, got ${JSON.stringify(detected)}`);
check(detected[0]?.title === "World of Art" && detected[0]?.meta === "8th edition", "an edition tail should become the subtitle instead of the title");
check(!/\bISBN/.test(detected[0]?.title || ""), "an ISBN tail should never stay in the title");
check(detected[1]?.links?.[0]?.url === "https://www.mheducation.com/heps-and-encounters-6e" && detected[1]?.title === "Traditions & Encounters 6e", "an HTML entity in a captured title should read normally, and a link beside it should move into the links list");
check(dash.parseTextbookMentions("Text messages welcome. Please text me.").length === 0, "plain phrases with the word 'text' should not fabricate entries");

// ---- safety --------------------------------------------------------------
const dangerous = dash.normalizeTextbookEntries([
  { title: "Okay Book", links: [{ url: "javascript:alert(1)" }] },
  { title: "" },
  { title: `x${"n".repeat(400)}` },
  { title: "Covered Book", cover: "data:text/html;base64,PGNvZGU+", cover2: "" },
  null,
  "nope"
]);
check(dangerous.length === 3, `only safe entries are kept, got ${dangerous.length}`);
check(dangerous[0].links.length === 0, "a javascript: link must be dropped");
check(dangerous[1].title.length === 140, "titles are truncated");
check(dangerous[2].cover === "" && dangerous[2].title === "Covered Book", "a non-image cover must be dropped");
check(dash.safeLinkUrl("https://ok.example.com/book") === "https://ok.example.com/book", "an https link survives");
check(dash.normalizeTextbookEntries([{ title: "a" }, { title: "b" }, { title: "c" }, { title: "d" }, { title: "e" }, { title: "f" }]).length === 4, "the shelf holds at most four entries");

// ---- the shelf renders on the course page --------------------------------
const courses = [
  { courseId: "1001", code: "ART 1107", title: "Art in Society S2 2026", tint: "linear-gradient(135deg,#1e3a5f,#224768)", ink: "#ffffff" }
];
const syllabusText = [{ entityId: "policy:1001", entityType: "coursePolicy", courseId: "1001", policyType: "courseOverview", canonicalTitle: "Welcome to ART 1107", body: "Required Text: World of Art, 8th Edition." }];
const entries = [{ title: "World of Art", meta: "8th edition", cover: "", links: [{ title: "Publisher", url: "https://vadds.student.pearson.com/art" }] }];
const index = dash.buildIndex({ now: NOW, courses, entities: syllabusText, settings: {}, courseTextbooks: { "1001": { entries } } });
const model = dash.courseHomeModel(index, "1001");
check(model.textbooks.length === 1 && model.textbooks[0].title === "World of Art", "saved shelf entries should reach the course model");
check(index.courseById.get("1001").textbooks.length === 1, "the syllabus text should also be detected with no saved entries");
const html = dash.courseHomePage(model);
check(html.includes("Textbooks &amp; links") && html.includes("sec-textbooks"), "the shelf block should have its card and head");
check(html.indexOf("sec-textbooks") < html.indexOf("sec-announcements") && html.indexOf("instructor-contact-card") < html.indexOf("sec-textbooks"), "the shelf sits after the instructor card and before announcements");
check(html.includes(`data-action="edit-textbook"`), "each shelf item should own an edit pencil");
check(html.includes('href="https://vadds.student.pearson.com/art"'), "the item link should point at its saved URL");
check(html.includes("textbook-cover-default") && html.includes("World of Art"), "a cover drawn from the course theme should carry the title");
check(html.includes('data-action="add-textbook"'), "the shelf should offer Add item");
check((html.match(/data-action="add-textbook"/g) || []).length === 2, "Add item lives in the head and in the list");
check(html.includes('aria-label="Edit World of Art, 8th edition"'), "the pencil should name what it edits");

const emptyModel = dash.courseHomeModel(dash.buildIndex({ now: NOW, courses, entities: [], settings: {} }), "1001");
const emptyHtml = dash.courseHomePage(emptyModel);
check(emptyHtml.includes("No textbook found") && emptyHtml.includes('data-action="add-textbook"'), "an empty course should keep the block with its Add item button");
check(!emptyHtml.includes("textbook-shelf\""), "an empty course should not render a shelf");

const fullModel = { ...model, textbooks: [1, 2, 3, 4].map((n) => ({ title: `Book ${n}`, meta: "", cover: "", links: [] })) };
const fullHtml = dash.courseHomePage(fullModel);
check((fullHtml.match(/data-action="add-textbook"/g) || []).length === 0, "a full shelf should drop the add buttons");

// ---- the editor and persistence are wired -------------------------------
const events = read("src/dashboard/app-events.js");
const css = read("src/dashboard/dashboard.css");
const htmlDoc = read("dashboard.html");
const loader = read("tests/test-dashboard-loader.mjs");
check(htmlDoc.includes("src/dashboard/model-textbooks.js"), "dashboard.html should load the textbook model before the archive");
check(loader.includes("model-textbooks.js"), "the dashboard test loader should include the textbook model");
check(events.includes("async function persistTextbookEntries") && events.includes("dash.normalizeTextbookEntries"), "saving shelf entries should be wired through the sanitizer");
check(events.includes("dash.accountBinding.scopedKey(COURSE_TEXTBOOKS_KEY, state.account.id)"), "shelf edits should be stored per D2L account");
check(events.includes('form.matches("[data-textbook-editor]")'), "the submit listener should route the shelf editor");
check(events.includes("beginTextbookEdit(actionNode.closest(\".sec-textbooks\")"), "editing and adding route through one in-card editor");
check(events.includes("[data-textbook-editor]") && events.includes("closeTextbookEdit(textbookEditor.closest(\".sec-textbooks\"))"), "Escape should close the shelf editor");
check(events.includes("textbookEntriesFor(courseId).slice(0, dash.MAX_TEXTBOOK_ENTRIES)"), "removal works from the list the card rendered");
check(css.includes(".textbook-shelf") && css.includes(".textbook-cover-default") && css.includes(".textbook-editor"), "the shelf, default cover and editor each need CSS");
check(css.includes(".sec-textbooks { order: 2; }") && css.includes(".sec-announcements { order: 3; }"), "on phones the shelf keeps the second spot before announcements");
const search = read("src/dashboard/app-state.js");
const plumbing = read("src/dashboard/app-plumbing.js");
const archive = read("src/dashboard/app-archive.js");
check(search.includes('const COURSE_TEXTBOOKS_KEY = "dashboardCourseTextbooks"'), "the storage key should be named beside the other keys");
check(plumbing.includes("COURSE_TEXTBOOKS_KEY"), "plumbing should hand the storage key to the event module");
check(archive.includes("dash.accountBinding.loadScoped(chrome.storage.local, COURSE_TEXTBOOKS_KEY"), "the account binder should load saved shelf entries");
check(archive.includes("courseTextbooks: state.courseTextbooks"), "saved entries should reach the course model");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Course textbook shelf detects, renders, edits and persists safely.");
