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
check(dash.safeLinkUrl("website.com") === "https://website.com/" && dash.safeLinkUrl("www.site.org/a b".replace(" ", "")) === "https://www.site.org/ab", "a bare website.com is read as https");
check(dash.safeLinkUrl("javascript:alert(1)") === "" && dash.safeLinkUrl("ftp://x.example.com") === "" && dash.safeLinkUrl("not a link") === "" && dash.safeLinkUrl("word") === "", "schemes other than http(s) and non-addresses are still refused");
check(dash.normalizeTextbookEntries([{ title: "a" }, { title: "b" }, { title: "c" }, { title: "d" }, { title: "e" }, { title: "f" }, { title: "g" }, { title: "h" }, { title: "i" }, { title: "j" }]).length === 8, "the shelf holds at most eight entries");

// ---- the shelf renders on the course page --------------------------------
const courses = [
  { courseId: "1001", code: "ART 1107", title: "Art in Society S2 2026", tint: "linear-gradient(135deg,#1e3a5f,#224768)", ink: "#ffffff" }
];
const syllabusText = [{ entityId: "policy:1001", entityType: "coursePolicy", courseId: "1001", policyType: "courseOverview", canonicalTitle: "Welcome to ART 1107", body: "Required Text: World of Art, 8th Edition." }];
const entries = [{ title: "World of Art", meta: "8th edition", cover: "", links: [{ title: "Publisher", url: "https://vadds.student.pearson.com/art" }] }];
const index = dash.buildIndex({ now: NOW, courses, entities: syllabusText, settings: {}, courseTextbooks: { "1001": { entries } } });
const model = dash.courseHomeModel(index, "1001");
check(model.textbooks.length === 1 && model.textbooks[0].title === "World of Art", "saved shelf entries should reach the course model");
check(index.courseById.get("1001").textbooks.length === 0, "the shelf must stay empty until the user adds something, even when the syllabus names a book");
const html = dash.courseHomePage(model);
check(html.includes("Textbooks &amp; Links") && html.includes("sec-textbooks"), "the shelf block should have its card and head");
check(/<a class="textbook-frame" href="https:\/\/vadds\.student\.pearson\.com\/art"/.test(html) && !html.includes("textbook-link\""), "a book's cover is itself the link, with no text link row under it");
check(html.indexOf("sec-textbooks") < html.indexOf("sec-announcements") && html.indexOf("instructor-contact-card") < html.indexOf("sec-textbooks"), "the shelf sits after the instructor card and before announcements");
check(html.includes(`data-action="edit-textbook"`), "each shelf item should own an edit pencil");
check(html.includes('href="https://vadds.student.pearson.com/art"'), "the item link should point at its saved URL");
check(html.includes("textbook-cover-default") && html.includes("World of Art"), "a cover drawn from the course theme should carry the title");
check((html.match(/data-action="add-textbook"/g) || []).length === 1, "the card head owns the only Add button");
check(html.includes('aria-label="Edit World of Art, 8th edition"'), "the pencil should name what it edits");

const emptyModel = dash.courseHomeModel(dash.buildIndex({ now: NOW, courses, entities: [], settings: {} }), "1001");
const emptyHtml = dash.courseHomePage(emptyModel);
check(emptyHtml.includes("Nothing added yet") && !emptyHtml.includes("<b>") && emptyHtml.includes('data-action="add-textbook"'), "an empty course keeps the block with the head Add button");
check(!emptyHtml.includes("textbook-shelf\""), "an empty course should not render a shelf");

const fullModel = { ...model, textbooks: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ title: `Book ${n}`, meta: "", cover: "", links: [] })) };
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
check(events.includes('beginTextbookEdit(actionNode.dataset.courseId') && !events.includes("closest(\".sec-textbooks\")"), "add and edit open the pop-up editor straight from the stored course id");
check(events.includes("[data-textbook-editor]") && events.includes('textbookEditor || document.getElementById("textbook-layer")'), "Escape should close the shelf editor pop-up");
check(events.includes('document.getElementById("textbook-layer")?.remove()'), "the pop-up closes by removing its layer");
check(events.includes("textbookEntriesFor(courseId).slice(0, dash.MAX_TEXTBOOK_ENTRIES)"), "removal works from the list the card rendered");
check(css.includes(".textbook-shelf") && css.includes(".textbook-cover-default") && css.includes(".textbook-editor"), "the shelf, default cover and editor each need CSS");
check(css.includes(".textbook-layer") && css.includes(".textbook-panel") && css.includes(".textbook-panel-head"), "the editor pop-up needs its layer, panel and head styles");
check(!css.includes(".textbook-add-row") && !html.includes("textbook-add-row"), "the list-bottom Add row is gone — the head plus is the only way to add");
check(css.includes(".sec-textbooks { order: 2; }") && css.includes(".sec-announcements { order: 3; }"), "on phones the shelf keeps the second spot before announcements");
// ---- links are app tiles, not books --------------------------------------
const mixed = dash.normalizeTextbookEntries([
  { title: "Class Portal", kind: "link", tone: "rose", mark: "letter", meta: "Grades and messages", links: [{ url: "https://portal.school.edu" }, { url: "https://second.example.com" }] },
  { title: "Odd Tone", kind: "link", tone: "<script>", links: [{ url: "https://odd.example.com" }] },
  { title: "Plain Book" }
]);
check(mixed[0].kind === "link" && mixed[0].tone === "rose" && mixed[0].mark === "letter" && mixed[0].links.length === 1, "a link keeps its tone and letter mark, and only its first address");
check(mixed[1].tone === "violet", "an unknown tone falls back to violet");
check(mixed[2].kind === "book" && !("tone" in mixed[2]), "an entry with no kind is a book");
const linkModel = { ...model, textbooks: mixed };
const linkHtml = dash.courseHomePage(linkModel);
check(linkHtml.includes('class="link-tile tone-rose"') && linkHtml.includes('href="https://portal.school.edu/"') && linkHtml.includes('data-confirm-external="Class Portal"'), "a link tile is a rounded tile that opens its address through the confirm step");
check(linkHtml.includes("link-tile-letter") && linkHtml.includes("textbook-art"), "a letter-mark link shows its first letter, bottom-aligned in the art row");
check((linkHtml.match(/data-action="edit-textbook"/g) || []).length === 3, "links and books each own an edit pencil");
check(linkHtml.includes("textbook-cover-default"), "a book beside the links still gets the book cover");
check(events.includes("textbook-kind-tabs") && events.includes('form.dataset.kind === "link"') && events.includes("TEXTBOOK_LINK_TONES"), "the editor has Textbook | Link tabs and saves a link entry");
check(css.includes(".link-tile") && css.includes(".tone-violet") && css.includes(".textbook-kind-tabs"), "link tiles, tones and the editor tabs need CSS");
// ---- popup size, cover preview, centered icon ------------------------------
const toned = dash.normalizeTextbookEntries([{ title: "Toned", tone: "green" }, { title: "Plain", tone: "nope" }]);
check(toned[0].tone === "green" && !("tone" in toned[1]), "a book keeps a valid cover color and drops an unknown one");
const tonedHtml = dash.courseHomePage({ ...model, textbooks: toned });
check(tonedHtml.includes("textbook-cover-default tone-green"), "a book with a saved cover color draws its default cover in that color");
check(/\.textbook-panel \{[^}]*\bheight: min\(700px/.test(css) && !/\.textbook-panel \{[^}]*max-height: min/.test(css), "the pop-up has one fixed height, not a max-height that grows with the tab");
check(/\.link-tile \{[^}]*display: flex; align-items: center; justify-content: center/.test(css) && css.includes(".link-tile svg"), "the link icon is centered in its tile");
check(css.includes(".textbook-field > span") && !/\.textbook-field span[ ,{]/.test(css), "the field caption rule must not reach the previews nested inside the field");
check(!events.includes("linkUrl2") && !events.includes("Extra link") && !events.includes("linkNote") && !events.includes("Short note"), "the pop-up has no extra-link field and no short-note field");
check(/\.textbook-panel \.textbook-field \.instructor-edit-input \{[^}]*height: 42px/.test(css) && /\.textbook-panel \.textbook-editor-actions \.btn \{[^}]*height: 40px/.test(css), "the pop-up's fields and buttons are sized for the larger panel");
check(events.includes("textbook-frame is-preview") && events.includes("__coverState") && events.includes("Default book"), "the Textbook tab has a live cover preview with Default and Upload choices");
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
