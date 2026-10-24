import fs from "node:fs";
import path from "node:path";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();

const overrides = {
  "1001": {
    0: { name: "Sarah Carrico", email: "manual@kennesaw.edu", officeHours: "" }
  },
  "1002": {
    0: { email: "gov@kennesaw.edu" }
  }
};

const document = dash.contactBackupDocument(overrides, { exportedAt: "2026-10-24T12:00:00.000Z" });
check(document.kind === dash.CONTACT_BACKUP_KIND, "the backup should name its kind");
check(document.version === 1, "the backup should carry a version");
check(document.exportedAt === "2026-10-24T12:00:00.000Z", "the backup should keep the export time");
check(dash.contactEditCount(overrides) === 4, "four edited fields should be counted");

const parsed = dash.parseContactBackup(JSON.stringify(document));
check(parsed.ok === true, "a document this app wrote should parse");
check(parsed.courses === 2 && parsed.fields === 4, "parsing should report courses and fields");
check(parsed.overrides["1001"][0].email === "manual@kennesaw.edu", "an edited email should survive the round trip");
check(parsed.overrides["1001"][0].officeHours === "", "a cleared office-hours value should survive the round trip");

check(dash.parseContactBackup("not json").ok === false, "invalid JSON should be refused");
check(dash.parseContactBackup(JSON.stringify({ kind: "something-else", overrides })).ok === false, "another kind of backup should be refused");
check(dash.parseContactBackup(JSON.stringify({ version: 99, overrides })).ok === false, "a newer backup version should be refused");
check(dash.parseContactBackup(JSON.stringify({ kind: dash.CONTACT_BACKUP_KIND })).ok === false, "a backup with no edits should be refused");
check(dash.parseContactBackup(JSON.stringify({ overrides: { "1001": { 0: { nickname: "Sarah" } } } })).ok === false, "a backup with only unknown fields should be refused");

const dirty = dash.parseContactBackup(JSON.stringify({
  overrides: {
    " 1001 ": { 0: { name: "  Sarah Carrico  ", email: 42, officeHours: "Mon 2-4" } },
    "__proto__": { 0: { name: "polluted" } },
    "1003": { "-1": { name: "bad index" }, 0: { name: "ok" } }
  }
}));
check(dirty.ok === true, "a forgiving backup should still import");
check(dirty.overrides["1001"][0].name === "Sarah Carrico", "values should be trimmed");
check(!("email" in dirty.overrides["1001"][0]), "a non-string value should be dropped");
check(!Object.prototype.hasOwnProperty.call(dirty.overrides, "__proto__"), "prototype keys should be dropped");
check(dirty.overrides["1003"][0].name === "ok" && Object.keys(dirty.overrides["1003"]).join(",") === "0", "only valid contact indexes should be kept");

const merged = dash.mergeContactOverrides(overrides, { "1001": { 0: { email: "new@kennesaw.edu" } } });
check(merged.changed === 1, "only a differing field should count as a change");
check(merged.next["1001"][0].email === "new@kennesaw.edu", "the imported value should win");
check(merged.next["1001"][0].name === "Sarah Carrico", "untouched fields should stay");
check(merged.next["1002"][0].email === "gov@kennesaw.edu", "untouched courses should stay");
const same = dash.mergeContactOverrides(overrides, overrides);
check(same.changed === 0, "re-importing the same edits should change nothing");

// A saved syllabus link travels in the same backup, web links only.
const withSyllabus = { "1001": { 0: { name: "Sarah Carrico" }, syllabus: { url: "https://simplesyllabus.com/doc/abc" } } };
check(dash.contactEditCount(withSyllabus) === 2, "a syllabus link should count as one edit");
const syllabusRoundTrip = dash.parseContactBackup(JSON.stringify(dash.contactBackupDocument(withSyllabus)));
check(syllabusRoundTrip.ok === true && syllabusRoundTrip.overrides["1001"].syllabus.url === "https://simplesyllabus.com/doc/abc", "a syllabus link should survive the round trip");
const unsafe = dash.parseContactBackup(JSON.stringify({ overrides: { "1001": { syllabus: { url: "javascript:alert(1)" } } } }));
check(unsafe.ok === false, "a backup holding only an unsafe syllabus link should be refused");
check(dash.safeSyllabusUrl("ftp://example.edu/x") === "" && dash.safeSyllabusUrl("not a link") === "" && dash.safeSyllabusUrl("") === "", "only http and https links should pass");
check(dash.safeSyllabusUrl("  https://example.edu/syllabus  ") === "https://example.edu/syllabus", "a pasted link should be trimmed");
const syllabusMerge = dash.mergeContactOverrides(withSyllabus, { "1001": { syllabus: { url: "https://example.edu/new" } } });
check(syllabusMerge.changed === 1 && syllabusMerge.next["1001"].syllabus.url === "https://example.edu/new", "an imported syllabus link should win");
check(syllabusMerge.next["1001"][0].name === "Sarah Carrico", "a syllabus import should leave contacts alone");

const settings = read("src/dashboard/render-settings.js");
const events = read("src/dashboard/app-events.js");
const appearance = read("src/dashboard/app-appearance.js");
const html = read("dashboard.html");
check(settings.includes('data-action="export-contact-edits"'), "Storage should offer exporting contact edits");
check(settings.includes('data-action="import-contact-edits"'), "Storage should offer importing contact edits");
check(events.includes("async function exportContactEdits"), "exporting contact edits should be wired");
check(events.includes("async function importContactEdits"), "importing contact edits should be wired");
check(events.includes("dash.accountBinding.scopedKey(COURSE_OVERRIDES_KEY, state.account.id)"), "imported edits should be stored per D2L account");
check(events.includes('operation: "contacts.import"') && events.includes('operation: "contacts.export"'), "backups should be recorded in activity history");
check(appearance.includes("model.contactEdits = dash.contactEditCount"), "Settings should show how many edits exist");
check(html.includes("model-contact-backup.js"), "the dashboard should load the backup model");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Contact edits export to a portable backup and import back without erasing newer edits.");
