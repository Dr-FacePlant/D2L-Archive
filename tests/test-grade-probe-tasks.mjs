import { loadBackgroundHooks } from "./test-production-loader.mjs";

const { gradeProbeTasksForCourse, isSafeReadOnlyUrl } = loadBackgroundHooks();
const tasks = gradeProbeTasksForCourse("9900002");

if (tasks.length !== 1) throw new Error("one course should create one gradebook probe");
if (tasks[0].url !== "https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=9900002") throw new Error("grade probe should use student gradebook URL");
if (tasks[0].expectedPageType !== "grades" || tasks[0].sourcePageType !== "gradeProbe") throw new Error("grade probe metadata changed");
if (!isSafeReadOnlyUrl(tasks[0].url)) throw new Error("grade probe URL should be read-only safe");

console.log("Grade probe production tests passed.");
