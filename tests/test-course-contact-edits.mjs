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

const courses = [
  { courseId: "1001", code: "ART 1107", title: "Art in Society" },
  { courseId: "1002", code: "POLS 1101", title: "American Government" }
];
const entities = [
  {
    entityId: "person:1001:instructor:1",
    entityType: "person",
    courseId: "1001",
    roleName: "Instructor",
    displayName: "Carrico, Sarah",
    email: "detected@kennesaw.edu",
    description: "Office hours: Mon 2-4"
  }
];
const overrides = {
  "1001": {
    0: { name: "Sarah Carrico", email: "manual@kennesaw.edu", officeHours: "" }
  }
};
const index = dash.buildIndex({ now: NOW, courses, entities, settings: {}, courseContactOverrides: overrides });
const edited = dash.courseHomeModel(index, "1001");
check(edited.contacts.length === 1, "a detected instructor should keep one editable contact");
check(edited.contacts[0].name === "Sarah Carrico", "a manual name should replace the detected name");
check(edited.contacts[0].email === "manual@kennesaw.edu", "a manual email should replace the detected email");
check(edited.contacts[0].officeHours === "", "a manual empty value should replace detected office hours");
const editedHtml = dash.courseHomePage(edited);
check(editedHtml.includes("Instructor: Sarah Carrico"), "the edited name should render");
check(editedHtml.includes("manual@kennesaw.edu"), "the edited email should render");
check((editedHtml.match(/data-action="edit-instructor"/g) || []).length === 4, "name, email, office hours and syllabus should each have an edit pencil");
check(!/<span>(?:Copy|Visit)<\/span>/.test(editedHtml) && !editedHtml.includes('class="copy-label"'), "copy and visit should be icon-only, with no text label");
check(editedHtml.includes('aria-label="Edit syllabus link"'), "the syllabus pencil should name what it edits");
check(editedHtml.includes('class="instructor-actions"'), "each row should group its action buttons");
check(editedHtml.includes('data-field="email"'), "the email row should carry its edit field");
check(editedHtml.includes('data-edit-value="manual@kennesaw.edu"'), "the editor should start from the saved value");
check(editedHtml.includes('aria-label="Edit instructor name"'), "the pencil should name the field it edits");
check(editedHtml.includes('aria-label="Edit office hours"'), "the office-hours pencil should name its field");
check(!/Edited|Undo|Reset|Add email|Add hours/.test(editedHtml), "the card must not show provenance, undo or add-link controls");

const empty = dash.courseHomeModel(index, "1002");
check(empty.contacts.length === 1, "a course without a detected instructor should still get an editable contact");
check(empty.contacts[0].name === "" && empty.contacts[0].email === "" && empty.contacts[0].officeHours === "", "a missing contact should start empty");
const emptyHtml = dash.courseHomePage(empty);
check(emptyHtml.includes("Instructor: N/A"), "a missing instructor name should read N/A");
check(emptyHtml.includes("Email: N/A"), "a missing email should read N/A");
check(emptyHtml.includes("Office hours: N/A"), "missing office hours should read N/A");
check((emptyHtml.match(/data-action="edit-instructor"/g) || []).length === 4, "missing values and a missing syllabus should still be editable");
check((emptyHtml.match(/class="instructor-copy"[^>]*disabled/g) || []).length === 3, "copy should stay visible but disabled when a row has no value");
check(/class="instructor-visit"[^>]*disabled/.test(emptyHtml), "visit should stay visible but disabled when no syllabus is found");

// A saved syllabus link replaces the detected syllabus and drives the Visit button.
const link = "https://simplesyllabus.com/doc/abc";
const linkedIndex = dash.buildIndex({ now: NOW, courses, entities, settings: {}, courseContactOverrides: { "1002": { syllabus: { url: link } } } });
const linked = dash.courseHomeModel(linkedIndex, "1002");
check(linked.syllabus?.url === link && linked.syllabusOverride === link, "a saved syllabus link should become the course syllabus");
const linkedHtml = dash.courseHomePage(linked);
check(linkedHtml.includes(`href="${link}"`), "Visit should point at the saved link");
check(linkedHtml.includes('data-field="syllabus"') && linkedHtml.includes(`data-edit-value="${link}"`), "the syllabus editor should start from the saved link");
const unsafeIndex = dash.buildIndex({ now: NOW, courses, entities, settings: {}, courseContactOverrides: { "1002": { syllabus: { url: "javascript:alert(1)" } } } });
const unsafeModel = dash.courseHomeModel(unsafeIndex, "1002");
check(unsafeModel.syllabus === null && !dash.courseHomePage(unsafeModel).includes("javascript:"), "an unsafe saved link should never reach an href");

const events = read("src/dashboard/app-events.js");
const css = read("src/dashboard/dashboard.css");
const hoverRule = css.split("\n").find((line) => line.startsWith(".instructor-copy:hover, .instructor-edit:hover, .instructor-visit:hover")) || "";
check(hoverRule.includes("background: var(--hover-soft)") && !hoverRule.includes("border-color"), "icon buttons should hover like Cancel: a fill, with no border change");
const archive = read("src/dashboard/app-archive.js");
check(events.includes("async function saveContactOverride"), "saving a contact edit should be wired");
check(events.includes("async function saveSyllabusOverride") && events.includes("dash.safeSyllabusUrl(value)"), "saving a syllabus link should be wired and validated");
check(events.includes('dash.icon(copied ? "check" : "close", 15)'), "copy feedback should swap the icon, not a text label");
check(events.includes("dash.accountBinding.scopedKey(COURSE_OVERRIDES_KEY, state.account.id)"), "edits should be stored per D2L account");
check(events.includes(`input.placeholder = "Type the instructor's name"`) && events.includes(`input.placeholder = "Type the instructor's email address"`) && events.includes('input.placeholder = "Type the office hours, like Mon and Wed 2–4 PM"'), "the name, email and office hours editors should each say what to type");
check(events.includes('save.type = "submit"') && events.includes('cancel.textContent = "Cancel"'), "the inline editor should offer Save and Cancel");
check(archive.includes("courseContactOverrides: await dash.accountBinding.loadScoped"), "the account binder should load saved edits");
check(archive.includes("courseContactOverrides: state.courseContactOverrides"), "saved edits should reach the course model");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Course contact edits apply over detected values, stay editable, and persist per account.");
