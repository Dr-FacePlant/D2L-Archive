import { appSource } from "./app-source.mjs";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const dash = loadDashboard();
const app = appSource();
const about = dash.settingsSection({ section: "about" });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(!about.includes("How this dashboard is paid for"), "Settings > About should not offer the paid-for page");
check(about.includes("Extractor tools (advanced)"), "Settings > About should keep the extractor tools link");
check(typeof dash.aboutPage === "undefined", "the standalone About page renderer should be removed");
check(app.includes('href="#/settings/about"'), "the profile menu About link should open Settings > About");
check(!app.includes("dash.aboutPage"), "the app should no longer render a standalone About page");
check(!app.includes('case "about"'), "the standalone About route should be removed");
check(app.includes('location.replace("#/settings/about")'), "old #/about links should redirect to Settings > About");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("About is one Settings section; old #/about links redirect.");
