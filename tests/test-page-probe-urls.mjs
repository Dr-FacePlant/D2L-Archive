import { loadBackgroundHooks } from "./test-production-loader.mjs";

const { safePageProbeUrls } = loadBackgroundHooks();
const valid = "https://kennesaw.view.usg.edu/d2l/home/9900004";
const unsafe = "https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_start.d2l?ou=9900004";

const result = safePageProbeUrls([valid, valid, unsafe, "https://example.com/d2l/home/1"]);
if (result.length !== 1 || result[0] !== valid) {
  throw new Error(`Unexpected safe page-probe URLs: ${JSON.stringify(result)}`);
}

console.log("Page-probe URL production tests passed.");
