// Static rules for the dashboard tab: opened from the toolbar icon, only local
// scripts (extension pages may not run inline or remote code), read-only API
// calls, and sponsor slides loaded as data.
import fs from "node:fs";
import path from "node:path";
import { appSource } from "./app-source.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const manifest = JSON.parse(read("manifest.json"));
check(!manifest.action?.default_popup, "toolbar icon must open the dashboard tab, not a popup");
const dashboardHtml = read("dashboard.html");
const header = dashboardHtml.slice(dashboardHtml.indexOf('<header class="topbar">'), dashboardHtml.indexOf("</header>"));
check((header.match(/data-menu-toggle/g) || []).length === 1 && header.includes('id="profile-button"') && header.includes('aria-controls="account-menu"') && !header.includes('id="more-button"') && !header.includes('id="help-menu"'), "the header should have one profile button that opens the account menu, and no Help or ⋯ button");
check(/id="account-menu"[\s\S]*id="sync-button"[\s\S]*>Sync from D2L<[\s\S]*>Settings<[\s\S]*data-action="account-help"[\s\S]*>Help &amp; campus links<[\s\S]*class="overlay-only"[\s\S]*id="overlay-close"[\s\S]*>Close D2L Archive</.test(header), "the account menu should list Sync, Settings, Help & campus links, and Close (only over D2L), in words");
check(!header.includes(">About<") && !header.includes(">Open D2L<"), "the account menu should not contain About or Open D2L");
check(/id="account-menu"[^>]*>\s*<div class="account-header">[\s\S]*?id="sync-hint"[\s\S]*?class="account-avatar-recess"[\s\S]*?<div class="account-slider">/.test(header) && header.indexOf('class="account-avatar-recess"') < header.indexOf('id="sync-button"'), "the account card should open with one header (account info and sync status left, avatar recess right) above the sliding panes");
check(header.includes('id="account-help" inert') && header.includes('data-action="account-back"') && header.includes("KSU Libraries") && header.includes("Writing Center"), "the Help links should sit on their own slide, with a Back row");
check(!dashboardHtml.includes("sync-note") && !/id="overlay-close"[^>]*\bhidden\b/.test(header), "Close should show through the embedded class, not a hidden flag");
const syncStatus = read("src/dashboard/app-sync.js");
check(syncStatus.includes('$("#profile-button")') && syncStatus.includes('more.classList.toggle("syncing", running)') && syncStatus.includes('$("#sync-hint")') && syncStatus.includes('$("#sync-label")'), "the profile button should show the sync ring and the menu should say when it last ran");
const accountEvents = read("src/dashboard/app-events.js");
check(accountEvents.includes("function showAccountView") && accountEvents.includes('action === "account-help"') && accountEvents.includes('event.key === "Escape" && state.menu'), "the account menu should slide to Help and back, and close on Esc");
check(accountEvents.includes('classList.remove("view-help")'), "closing the menu should reset it to the main list");
const dashboardRender = read("src/dashboard/render-dashboard.js");
check(/firstRunPage[\s\S]{0,700}data-action="sync"/.test(dashboardRender) && dashboardRender.includes("Sync from D2L"), "first run should offer its own Sync from D2L action");
check(manifest.permissions.includes("downloads.open"), "opening archived files needs downloads.open");
const background = read("background.js");
check(/chrome\.action\?\.onClicked\?\.addListener\(\(tab\) => \{ openArchive\(tab\); \}\)/.test(background), "the toolbar icon must open the archive (overlay on D2L, dashboard tab elsewhere)");
check(/async function openArchive\(tab\) \{\s*if \(!\(await toggleOverlay\(tab\)\)\) await openDashboard\(\);/.test(background), "off D2L, the toolbar icon must still open the dashboard tab");
check(background.includes('chrome.runtime.getURL(DASHBOARD_PATH)') && background.includes('const DASHBOARD_PATH = "dashboard.html"'), "dashboard path changed");

const html = read("dashboard.html");
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
check(scripts.length > 0, "dashboard.html loads no scripts");
for (const [, attrs, body] of scripts) {
  const src = attrs.match(/src="([^"]+)"/)?.[1] || "";
  check(src && !body.trim(), "dashboard.html must not contain inline scripts (MV3 blocks them)");
  check(src && !/^https?:|^\/\//.test(src), `dashboard script must be local: ${src}`);
  check(!src || fs.existsSync(path.join(repoRoot, src)), `dashboard script missing: ${src}`);
}
for (const href of [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1])) {
  check(!/^https?:/.test(href) && fs.existsSync(path.join(repoRoot, href)), `dashboard stylesheet must be local and present: ${href}`);
}
const css = read("src/dashboard/dashboard.css");
for (const url of [...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1])) {
  check(fs.existsSync(path.join(repoRoot, "src/dashboard", url)), `dashboard asset missing: ${url}`);
}

// Course pictures load from dashboard.html, so their paths resolve from the extension root.
for (const url of [...read("src/dashboard/model.js").matchAll(/image: "([^"]+)"/g)].map((m) => m[1])) {
  check(fs.existsSync(path.join(repoRoot, url)), `course picture missing (paths resolve from dashboard.html): ${url}`);
}

const modelFiles = ["model.js", "model-archive.js", "model-updates.js", "model-work.js", "model-details.js", "model-resources.js", "model-dashboard.js", "model-courses.js", "model-grades.js", "model-calendar.js", "model-search.js", "model-routes.js"];
const renderFiles = ["render.js", "render-dashboard.js", "render-updates.js", "render-courses.js", "render-calendar.js", "render-work.js", "render-details.js", "render-grades.js", "render-resources.js", "render-search.js", "render-settings.js"];
const appFiles = ["app-state.js", "app-plumbing.js", "app-overlay.js", "app-files.js", "app-preview.js", "app-appearance.js", "app-archive.js", "app-render.js", "app-sync.js", "app-events.js", "app-selfcheck.js", "app.js"];
const dashboardJs = ["format.js", ...modelFiles, ...renderFiles, ...appFiles].map((file) => read(`src/dashboard/${file}`)).join("\n");
check(!/\beval\s*\(|new Function\s*\(|importScripts|<script/i.test(dashboardJs.replace(/!\/<script\/i\.test/g, "")), "dashboard code must not evaluate or inject code");
check(!/\bscheduleSlide\b/.test(dashboardJs), "boot must not call the removed sponsor slideshow scheduler");
const writeMethods = ["archive.ingestRows", "archive.ingestExtraction", "organizer.runCourse", "organizer.runChanged", "organizer.rebuildAll", "relationships.confirm", "relationships.reject"];
for (const method of writeMethods) check(!dashboardJs.includes(`"${method}"`), `dashboard must stay read-only but calls ${method}`);
const calls = [...appSource().matchAll(/api\("([^"]+)"/g)].map((m) => m[1]);
const readMethods = read("src/background/app-api.js").match(/IMPLEMENTED_READ_METHODS = Object\.freeze\(\[([\s\S]*?)\]\)/)[1];
for (const method of calls) check(readMethods.includes(`"${method}"`), `dashboard calls ${method}, which is not a read method`);
check(!/fetch\([^)]*kennesaw/i.test(dashboardJs), "dashboard must not call D2L directly");
check(!/D2L_ACTION_(PREPARE|COMMIT)/.test(dashboardJs), "dashboard action UI must stay read-only, with no D2L change boundary");
check(!read("dashboard.html").includes('id="action-confirm"') && !read("dashboard.html").includes("This action changes D2L"), "dashboard must not carry an action confirmation dialog");

// The study card names what its link opens, and shows no course-progress line.
const studyCard = read("src/dashboard/render-dashboard.js");
check(studyCard.includes('class="study-lnk" href="#/work?type=quiz">All quizzes &amp; tests') && !studyCard.includes("See everything ahead"), "the study card's link should say it opens all quizzes and tests");
check(!studyCard.includes("Prep ${done"), "the study card should not show a Prep percentage");
check(css.includes(".study-banner .promo-label { margin-top: 13px; }") && css.includes(".study-banner .prow { margin-bottom: 13px; }"), "the study card should keep its height now the Prep line is gone");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Dashboard static rules hold.");
