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

// 2. Test fallback to coursePolicy overview and Simple Syllabus
const mockRawWithOverview = {
  now: "2026-10-22T00:00:00.000Z",
  courses: [
    { courseId: "102", code: "HIST 102", title: "World History" },
    { courseId: "104", code: "ART 104", title: "Art in Society" }
  ],
  entities: [
    {
      entityId: "policy:102:courseOverview:1",
      entityType: "coursePolicy",
      courseId: "102",
      canonicalTitle: "Course Syllabus Overview",
      policyType: "courseOverview",
      body: "<p>Welcome to History. Office hours: Mon/Wed 2-4pm. Email: prof.history@univ.edu</p>"
    },
    {
      entityId: "policy:104:syllabusPolicy:1",
      entityType: "coursePolicy",
      courseId: "104",
      canonicalTitle: "Simple Syllabus",
      policyType: "syllabusPolicy",
      body: "Course syllabus for Art in Society"
    }
  ]
};

const indexOverview = dash.buildIndex(mockRawWithOverview);
const courseHomeOverview = dash.courseHomeModel(indexOverview, "102");
check(courseHomeOverview.syllabus !== null, "courseOverview policy should be detected as fallback syllabus");
check(courseHomeOverview.syllabus?.title === "Course Syllabus Overview", "Fallback syllabus title matches policy");

const courseHomeArt = dash.courseHomeModel(indexOverview, "104");
check(courseHomeArt.syllabus !== null, "Simple Syllabus policy should be detected as syllabus");
check(courseHomeArt.syllabus?.title === "Simple Syllabus", "Simple Syllabus title matches");

// Check contact extraction fallback from courseOverview
const histCourse = indexOverview.courses.find((c) => c.courseId === "102");
check(histCourse.instructorContacts.length > 0, "Contact info should be extracted from courseOverview fallback");
check(histCourse.instructorContacts[0].email === "prof.history@univ.edu", "Extracted email should match overview content");
check(histCourse.instructorContacts[0].officeHours.includes("Mon/Wed 2-4pm"), "Extracted office hours should match overview content");

// 3. Test filtering out student helpdesk and student emails in favor of instructor email
const mockRawWithFiltering = {
  now: "2026-10-22T00:00:00.000Z",
  courses: [
    { courseId: "103", code: "CRJU 103", title: "Criminal Justice" }
  ],
  entities: [
    {
      entityId: "person:103:instructor:1",
      entityType: "person",
      courseId: "103",
      displayName: "Giardina, Donovan",
      roleName: "Instructor"
    },
    {
      entityId: "policy:103:syllabusPolicy:exam1",
      entityType: "coursePolicy",
      courseId: "103",
      canonicalTitle: "Exam 1",
      body: "If you have issues with Respondus, contact studenthelpdesk@kennesaw.edu or call the helpdesk."
    },
    {
      entityId: "announcement:103:announcement:firstweek",
      entityType: "announcement",
      courseId: "103",
      canonicalTitle: "First Week Hello!",
      body: "Hi everyone! I am Dr. Donovan Giardina. Email me at dgiardi1@kennesaw.edu if you need anything. Taraya (tnelso98@students.kennesaw.edu) is our SI leader."
    }
  ]
};

const indexFilter = dash.buildIndex(mockRawWithFiltering);
const crjuCourse = indexFilter.courses.find((c) => c.courseId === "103");
check(crjuCourse.instructorContacts.length === 1, "Should have 1 instructor contact");
check(crjuCourse.instructorContacts[0].name === "Donovan Giardina", "Instructor name formatted correctly");
check(crjuCourse.instructorContacts[0].email === "dgiardi1@kennesaw.edu", `Should extract instructor email dgiardi1@kennesaw.edu, not student helpdesk or SI student email (got: ${crjuCourse.instructorContacts[0].email})`);

// 4. Test rendering of syllabus visit link
const renderedHtml = dash.courseHomePage(courseHomeOverview);
check(renderedHtml.includes("Syllabus: Course Syllabus Overview"), "Course home page should render detected syllabus title");
check(renderedHtml.includes("Visit"), "Visit link should be present");
check(!renderedHtml.includes('disabled aria-label="Syllabus not available"'), "Visit button should not be disabled");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Syllabus detection, Simple Syllabus fallback, and email filtering tests passed.");
