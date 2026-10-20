import { loadBackgroundHooks } from "./test-production-loader.mjs";

const { courseToolProbeTasksForCourse, isSafeReadOnlyUrl } = loadBackgroundHooks();
const tasks = courseToolProbeTasksForCourse("9900002");
const expectedTypes = ["classlist", "checklist", "group", "selfAssessment", "survey", "attendance", "userProgress"];

if (tasks.length !== expectedTypes.length) throw new Error("one course should create seven secondary-tool probes");
if (!tasks.every((task) => task.sourcePageType === "courseToolProbe" && task.courseOrgUnitId === "9900002")) throw new Error("course-tool probe metadata changed");
for (const type of expectedTypes) {
  if (!tasks.some((task) => task.expectedPageType === type)) throw new Error(`missing ${type} course-tool probe`);
}
if (!tasks.every((task) => isSafeReadOnlyUrl(task.url))) throw new Error("course-tool probes should all be read-only safe");
if (!tasks.every((task) => !/quiz_start|folder_submit|posts\/new|mail|settings|delete/i.test(task.url))) throw new Error("course-tool probes contain a side-effect URL");

console.log("Course tool probe production tests passed.");
