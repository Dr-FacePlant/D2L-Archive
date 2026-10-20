import { loadContentHooks } from "./test-production-loader.mjs";

const hooks = loadContentHooks();
for (const name of ["apiList", "resolveDue", "mergeGradeValues", "derivedStudentUsefulRows", "apiProbeStatus", "addApiProbeRow", "collectCourseApi"]) {
  if (typeof hooks[name] !== "function") throw new Error(`Valence API helper ${name} did not load`);
}

const due = hooks.resolveDue("", "", { EndDateTime: "2026-10-01T12:00:00Z" });
if (due.value !== "2026-10-01T12:00:00Z" || due.source !== "calendarEntityJoin") throw new Error("calendar entity due-date fallback changed");

const merged = hooks.mergeGradeValues(
  [{ Id: 1, Name: "Paper" }, { Id: 2, Name: "Quiz" }],
  [{ GradeObjectIdentifier: 2, DisplayedGrade: "9 / 10" }, { GradeObjectIdentifier: 3, DisplayedGrade: "Extra" }]
);
if (merged.length !== 3) throw new Error("grade definition/value join lost unmatched evidence");
if (merged[1].value?.DisplayedGrade !== "9 / 10") throw new Error("grade definition/value join changed matching behavior");

if (hooks.apiList({ Objects: [{ Id: 1 }] }).length !== 1) throw new Error("Objects API list normalization changed");
if (hooks.apiList({ Items: [{ Id: 2 }] }).length !== 1) throw new Error("Items API list normalization changed");

const derived = hooks.derivedStudentUsefulRows({
  source: "contentTopic",
  title: "Course syllabus and grading policy",
  description: "Includes the assignment rubric"
});
const sources = new Set(derived.map((row) => row.source));
if (!sources.has("syllabusPolicy") || !sources.has("rubric")) throw new Error("student-useful derived API rows changed");

console.log("Valence API modules loaded and pure contracts passed.");
