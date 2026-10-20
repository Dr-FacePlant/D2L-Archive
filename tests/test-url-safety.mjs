import { loadBackgroundHooks } from "./test-production-loader.mjs";

const { isSafeReadOnlyUrl } = loadBackgroundHooks();

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

assertEqual(isSafeReadOnlyUrl("https://kennesaw.view.usg.edu/d2l/home/12345"), true, "course home is safe");
assertEqual(isSafeReadOnlyUrl("https://kennesaw.view.usg.edu/d2l/lms/grades/my_grades/main.d2l?ou=12345"), true, "grades page is safe");
assertEqual(isSafeReadOnlyUrl("https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folders_history.d2l?db=99&ou=12345"), true, "assignment history page is safe");
assertEqual(isSafeReadOnlyUrl("https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folder_user_view_feedback.d2l?db=99&ou=12345"), true, "assignment feedback page is safe");
assertEqual(isSafeReadOnlyUrl("https://kennesaw.view.usg.edu/d2l/lms/dropbox/user/folder_submit_files.d2l?db=99&ou=12345"), false, "assignment submit page is blocked");
assertEqual(isSafeReadOnlyUrl("https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_start.d2l?qi=22&ou=12345"), false, "quiz start page is blocked");
assertEqual(isSafeReadOnlyUrl("https://kennesaw.view.usg.edu/d2l/le/12345/discussions/posts/create"), false, "discussion post create page is blocked");
assertEqual(isSafeReadOnlyUrl("https://kennesaw.view.usg.edu/d2l/mail/inbox"), false, "mail page is blocked");
assertEqual(isSafeReadOnlyUrl("https://example.com/d2l/home/12345"), false, "non-D2L origin is blocked");

console.log("URL safety production tests passed.");
