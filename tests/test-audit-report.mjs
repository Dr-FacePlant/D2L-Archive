import { loadBackgroundHooks } from "./test-production-loader.mjs";

const {
  assignmentProbePageLines,
  quizProbePageLines,
  announcementProbePageLines,
  gradeProbePageLines,
  courseToolProbePageLines
} = loadBackgroundHooks();

function assertIncludes(text, snippet, label) {
  if (!text.includes(snippet)) {
    throw new Error(`${label}: missing ${JSON.stringify(snippet)}`);
  }
}

const populated = assignmentProbePageLines({
  assignmentProbePages: { visited: 4, failed: 1, rows: 3 },
  courses: [
    { orgUnitId: "111", assignmentProbePages: { visited: 2, failed: 0, rows: 2 } },
    { orgUnitId: "222", assignmentProbePages: { visited: 2, failed: 1, rows: 1 } }
  ]
}).join("\n");

assertIncludes(populated, "## Assignment Probe Pages", "audit includes assignment probe section");
assertIncludes(populated, "Read-only probe pages visited: 4", "audit includes visited count");
assertIncludes(populated, "Read-only probe page failures: 1", "audit includes failed count");
assertIncludes(populated, "Rows extracted from those pages: 3", "audit includes extracted row count");
assertIncludes(populated, "| 111 | 2 | 0 | 2 |", "audit includes per-course first row");
assertIncludes(populated, "| 222 | 2 | 1 | 1 |", "audit includes per-course second row");

const empty = assignmentProbePageLines({
  assignmentProbePages: { visited: 0, failed: 0, rows: 0 },
  courses: []
}).join("\n");

assertIncludes(empty, "No assignment history/feedback page visits were recorded", "audit explains unproven assignment probe pages");

const quizPopulated = quizProbePageLines({
  quizProbePages: { visited: 3, failed: 1, rows: 5 },
  courses: [
    { orgUnitId: "111", quizProbePages: { visited: 2, failed: 0, rows: 4 } },
    { orgUnitId: "222", quizProbePages: { visited: 1, failed: 1, rows: 1 } }
  ]
}).join("\n");

assertIncludes(quizPopulated, "## Quiz Probe Pages", "audit includes quiz probe section");
assertIncludes(quizPopulated, "Read-only probe pages visited: 3", "audit includes quiz probe visited count");
assertIncludes(quizPopulated, "Read-only probe page failures: 1", "audit includes quiz probe failed count");
assertIncludes(quizPopulated, "| 111 | 2 | 0 | 4 |", "audit includes per-course quiz first row");
assertIncludes(quizPopulated, "| 222 | 1 | 1 | 1 |", "audit includes per-course quiz second row");

const quizEmpty = quizProbePageLines({
  quizProbePages: { visited: 0, failed: 0, rows: 0 },
  courses: []
}).join("\n");

assertIncludes(quizEmpty, "No quiz summary/attempt result page visits were recorded", "audit explains unproven quiz probe pages");

const announcementPopulated = announcementProbePageLines({
  announcementProbePages: { visited: 2, failed: 0, rows: 6 },
  courses: [
    { orgUnitId: "111", announcementProbePages: { visited: 1, failed: 0, rows: 3 } },
    { orgUnitId: "222", announcementProbePages: { visited: 1, failed: 0, rows: 3 } }
  ]
}).join("\n");

assertIncludes(announcementPopulated, "## Announcement Probe Pages", "audit includes announcement probe section");
assertIncludes(announcementPopulated, "Read-only probe pages visited: 2", "audit includes announcement probe visited count");
assertIncludes(announcementPopulated, "| 111 | 1 | 0 | 3 |", "audit includes per-course announcement first row");
assertIncludes(announcementPopulated, "| 222 | 1 | 0 | 3 |", "audit includes per-course announcement second row");

const announcementEmpty = announcementProbePageLines({
  announcementProbePages: { visited: 0, failed: 0, rows: 0 },
  courses: []
}).join("\n");

assertIncludes(announcementEmpty, "No announcement detail page visits were recorded", "audit explains unproven announcement probe pages");

const gradePopulated = gradeProbePageLines({
  gradeProbePages: { visited: 2, failed: 0, rows: 42 },
  courses: [
    { orgUnitId: "111", gradeProbePages: { visited: 1, failed: 0, rows: 20 } },
    { orgUnitId: "222", gradeProbePages: { visited: 1, failed: 0, rows: 22 } }
  ]
}).join("\n");

assertIncludes(gradePopulated, "## Grade Probe Pages", "audit includes grade probe section");
assertIncludes(gradePopulated, "Read-only probe pages visited: 2", "audit includes grade probe visited count");
assertIncludes(gradePopulated, "| 111 | 1 | 0 | 20 |", "audit includes per-course grade first row");
assertIncludes(gradePopulated, "| 222 | 1 | 0 | 22 |", "audit includes per-course grade second row");

const gradeEmpty = gradeProbePageLines({
  gradeProbePages: { visited: 0, failed: 0, rows: 0 },
  courses: []
}).join("\n");

assertIncludes(gradeEmpty, "No visible gradebook page visits were recorded", "audit explains unproven grade probe pages");

const courseToolPopulated = courseToolProbePageLines({
  courseToolProbePages: { visited: 14, failed: 1, rows: 8 },
  courses: [
    { orgUnitId: "111", courseToolProbePages: { visited: 7, failed: 0, rows: 3 } },
    { orgUnitId: "222", courseToolProbePages: { visited: 7, failed: 1, rows: 5 } }
  ]
}).join("\n");

assertIncludes(courseToolPopulated, "## Course Tool Probe Pages", "audit includes course tool probe section");
assertIncludes(courseToolPopulated, "Read-only probe pages visited: 14", "audit includes course tool probe visited count");
assertIncludes(courseToolPopulated, "| 111 | 7 | 0 | 3 |", "audit includes per-course tool first row");
assertIncludes(courseToolPopulated, "| 222 | 7 | 1 | 5 |", "audit includes per-course tool second row");

const courseToolEmpty = courseToolProbePageLines({
  courseToolProbePages: { visited: 0, failed: 0, rows: 0 },
  courses: []
}).join("\n");

assertIncludes(courseToolEmpty, "disabled or empty course tools remain ambiguous", "audit explains unproven course tool probe pages");

console.log("Audit report tests passed.");
