import { loadDashboard } from "./test-dashboard-loader.mjs";

const dash = loadDashboard();
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

// 1. Test syllabus detection via alternative titles (e.g., Course Outline)
const mockRawWithOutline = {
  now: "2026-10-22T00:00:00.000Z",
  courses: [
    { courseId: "101", code: "CS 101", title: "Computer Science I" }
  ],
  entities: [
    {
      entityId: "res:101:topic:1",
      entityType: "learningResource",
      courseId: "101",
      canonicalTitle: "Course Outline & Policies",
      isModule: false,
      moduleId: "mod1",
      resourceType: "File"
    },
    {
      entityId: "res:101:mod:1",
      entityType: "learningResource",
      courseId: "101",
      canonicalTitle: "Syllabus & Info",
      isModule: true,
      moduleId: "mod1"
    }
  ]
};

const indexOutline = dash.buildIndex(mockRawWithOutline);
const courseHomeOutline = dash.courseHomeModel(indexOutline, "101");
check(courseHomeOutline.syllabus !== null, "Course Outline should be detected as syllabus");
check(courseHomeOutline.syllabus?.title === "Course Outline & Policies", "Detected syllabus title should match topic title");

// 2. Test fallback to coursePolicy overview when no TOC syllabus topic exists
const mockRawWithOverview = {
  now: "2026-10-22T00:00:00.000Z",
  courses: [
    { courseId: "102", code: "HIST 102", title: "World History" }
  ],
  entities: [
    {
      entityId: "policy:102:courseOverview:1",
      entityType: "coursePolicy",
      courseId: "102",
      canonicalTitle: "Course Syllabus Overview",
      policyType: "courseOverview",
      body: "<p>Welcome to History. Office hours: Mon/Wed 2-4pm. Email: prof.history@univ.edu</p>"
    }
  ]
};

const indexOverview = dash.buildIndex(mockRawWithOverview);
const courseHomeOverview = dash.courseHomeModel(indexOverview, "102");
check(courseHomeOverview.syllabus !== null, "courseOverview policy should be detected as fallback syllabus");
check(courseHomeOverview.syllabus?.title === "Course Syllabus Overview", "Fallback syllabus title matches policy");

// Check contact extraction fallback from courseOverview
const histCourse = indexOverview.courses.find((c) => c.courseId === "102");
check(histCourse.instructorContacts.length > 0, "Contact info should be extracted from courseOverview fallback");
check(histCourse.instructorContacts[0].email === "prof.history@univ.edu", "Extracted email should match overview content");
check(histCourse.instructorContacts[0].officeHours.includes("Mon/Wed 2-4pm"), "Extracted office hours should match overview content");

// 3. Test contact extraction from syllabus learningResource description
const mockRawWithSyllabusResource = {
  now: "2026-10-22T00:00:00.000Z",
  courses: [
    { courseId: "103", code: "MATH 103", title: "Calculus I" }
  ],
  entities: [
    {
      entityId: "res:103:topic:1",
      entityType: "learningResource",
      courseId: "103",
      canonicalTitle: "Syllabus",
      isModule: false,
      description: "Instructor: Dr. Euler. Office hours: Tue/Thu 10am - 12pm | Location: Hall 101. Email: euler@math.edu"
    },
    {
      entityId: "person:103:instructor:1",
      entityType: "person",
      courseId: "103",
      displayName: "Euler, Leonhard",
      roleName: "Instructor"
    }
  ]
};

const indexMath = dash.buildIndex(mockRawWithSyllabusResource);
const mathCourse = indexMath.courses.find((c) => c.courseId === "103");
check(mathCourse.instructorContacts.length === 1, "Instructor contact should exist");
check(mathCourse.instructorContacts[0].name === "Leonhard Euler", "Instructor name should format properly");
check(mathCourse.instructorContacts[0].email === "euler@math.edu", "Email should be extracted from syllabus resource description");
check(mathCourse.instructorContacts[0].officeHours === "Tue/Thu 10am - 12pm", "Office hours should be extracted from syllabus resource description");

// 4. Test rendering of syllabus visit link
const renderedHtml = dash.courseHomePage(courseHomeOverview);
check(renderedHtml.includes("Syllabus: Course Syllabus Overview"), "Course home page should render detected syllabus title");
check(renderedHtml.includes("Visit"), "Visit link should be present");
check(!renderedHtml.includes('disabled aria-label="Syllabus not available"'), "Visit button should not be disabled");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Syllabus detection and contact extraction tests passed.");
