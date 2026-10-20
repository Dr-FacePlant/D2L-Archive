import { loadBackgroundHooks } from "./test-production-loader.mjs";

const { assignmentProbeTasksFromApiItems } = loadBackgroundHooks();

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const tasks = assignmentProbeTasksFromApiItems("9900002", [
  { source: "assignment", title: "Module 2 Homework", url: "https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folder_submit_files.d2l?db=4468062&ou=9900002", ids: { dropboxFolderId: "4468062" } },
  { source: "assignment", title: "Duplicate Module 2 Homework", url: "https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folder_submit_files.d2l?db=4468062&ou=9900002", ids: {} },
  { source: "assignment", title: "Module 4 Homework", url: "https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folder_submit_files.d2l?db=4468063&ou=9900002", ids: {} },
  { source: "quiz", title: "Quiz should not become assignment probes", ids: { quizId: "99" } }
]);

assert(tasks.length === 4, "two unique assignment folders create four read-only probe tasks");
assert(tasks.filter((task) => task.expectedPageType === "assignmentSubmissions").length === 2, "each folder gets one history probe");
assert(tasks.filter((task) => task.expectedPageType === "assignmentFeedback").length === 2, "each folder gets one feedback probe");
assert(tasks.every((task) => task.courseOrgUnitId === "9900002"), "all probe tasks keep course org unit id");
assert(tasks.every((task) => task.sourcePageType === "apiAssignmentProbe"), "all probe tasks mark source page type");
assert(tasks.every((task) => /folders_history\.d2l|folder_user_view_feedback\.d2l/.test(task.url)), "probe tasks only use read-only assignment URLs");
assert(tasks.every((task) => !/folder_submit_files\.d2l|quiz_start|attempt/i.test(task.url)), "probe tasks never use submit or attempt URLs");
assert(tasks.some((task) => /db=4468062/.test(task.url)), "probe tasks include folder id from ids");
assert(tasks.some((task) => /db=4468063/.test(task.url)), "probe tasks include folder id parsed from url");

console.log("Assignment probe production tests passed.");
