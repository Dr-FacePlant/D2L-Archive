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
check((editedHtml.match(/data-action="edit-instructor"/g) || []).length === 3, "name, email and office hours should each have an edit pencil");
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
check((emptyHtml.match(/data-action="edit-instructor"/g) || []).length === 3, "missing values should still be editable");

const events = read("src/dashboard/app-events.js");
const archive = read("src/dashboard/app-archive.js");
check(events.includes("async function saveContactOverride"), "saving a contact edit should be wired");
check(events.includes("dash.accountBinding.scopedKey(COURSE_OVERRIDES_KEY, state.account.id)"), "edits should be stored per D2L account");
check(events.includes('save.type = "submit"') && events.includes('cancel.textContent = "Cancel"'), "the inline editor should offer Save and Cancel");
check(archive.includes("courseContactOverrides: await dash.accountBinding.loadScoped"), "the account binder should load saved edits");
check(archive.includes("courseContactOverrides: state.courseContactOverrides"), "saved edits should reach the course model");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Course contact edits apply over detected values, stay editable, and persist per account.");
