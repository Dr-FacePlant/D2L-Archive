import { appSource } from "./app-source.mjs";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

function loadProfileModule() {
  const window = {};
  window.top = {};
  window.self = window;
  const context = vm.createContext({ URL, Date, Promise, setTimeout, window, D2LExtractorContent: {} });
  context.globalThis = context;
  vm.runInContext(read("src/content/user-profile.js"), context, { filename: "user-profile.js" });
  return context.D2LExtractorContent;
}

const profile = loadProfileModule();
const data = {};
const storage = { get: async (key) => ({ [key]: data[key] }), set: async (values) => Object.assign(data, values) };
const calls = [];
const fetchImpl = async (url, options) => {
  calls.push([url, options?.credentials]);
  if (url.includes("users/whoami")) return { ok: true, json: async () => ({ FirstName: "Taylor", LastName: "Student", ProfileIdentifier: "profile-1" }) };
  return { ok: true, blob: async () => ({ type: "image/png", size: 2048 }) };
};
const saved = await profile.captureUserProfile({ fetchImpl, storage, toDataUrl: async () => "data:image/png;base64,PROFILE", now: () => new Date("2026-09-30T12:00:00Z") });
check(saved?.displayName === "Taylor Student" && !("initials" in saved), "profile capture should keep identity for accessibility without generating a replacement avatar");
check(saved?.accountId === "profile-1", "profile capture does not retain a stable D2L account identifier");
check(saved?.dataUrl === "data:image/png;base64,PROFILE", "profile capture does not save the Brightspace profile image");
check(calls.some(([url]) => url.includes("/users/whoami")) && calls.some(([url]) => url.includes("/profile/myProfile/image?size=96")), "profile capture does not use the Brightspace identity and image endpoints");
check(calls.every(([, credentials]) => credentials === "include"), "profile capture does not use the signed-in D2L session");

const identityOk = await profile.inspectVerifiedAccount({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ProfileIdentifier: "private-id" }) }) });
check(identityOk.ok && identityOk.reason === "verified" && identityOk.fields.includes("ProfileIdentifier"), "read-only identity diagnostics should identify a recognized account field without returning its value");
check(!Object.hasOwn(identityOk, "accountId") || identityOk.accountId === "private-id", "internal identity diagnostics should return the id only to the caller that performs verification");
const identityHttpError = await profile.inspectVerifiedAccount({ fetchImpl: async () => ({ ok: false, status: 403 }) });
check(identityHttpError.reason === "http-error" && identityHttpError.status === 403, "identity diagnostics should distinguish an authenticated endpoint rejection");
const identityMissing = await profile.inspectVerifiedAccount({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ DisplayName: "Student" }) }) });
check(identityMissing.reason === "identity-field-missing" && identityMissing.fields.length === 0, "identity diagnostics should distinguish a successful response without a recognized identifier");

calls.length = 0;
await profile.captureUserProfile({ fetchImpl, storage, toDataUrl: async () => "unused", now: () => new Date("2026-10-02T12:00:00Z") });
check(calls.length === 1 && calls[0][0].includes("users/whoami"), "cached profile identity should refresh without redownloading the profile image");

const noImageData = {};
const noImageStorage = { get: async (key) => ({ [key]: noImageData[key] }), set: async (values) => Object.assign(noImageData, values) };
await profile.captureUserProfile({
  fetchImpl: async (url) => url.includes("users/whoami")
    ? { ok: true, json: async () => ({ DisplayName: "Student User" }) }
    : { ok: false, status: 404 },
  storage: noImageStorage,
  now: () => new Date("2026-09-30T12:00:00Z")
});
check(noImageData.dashboardProfile?.displayName === "Student User" && !noImageData.dashboardProfile?.dataUrl, "a missing D2L profile image should retain identity for the fallback");
check(noImageData.dashboardProfile?.accountId === "", "missing account identifier should remain explicitly unverified");

const manifest = JSON.parse(read("manifest.json"));
const scripts = manifest.content_scripts[0].js;
check(scripts.includes("src/content/user-profile.js") && scripts.indexOf("src/content/user-profile.js") > scripts.indexOf("src/content/school-logo.js"), "profile capture is not loaded on D2L pages");

const shell = read("dashboard.html");
const app = appSource();
const css = read("src/dashboard/dashboard.css");
check(!shell.includes('href="#/settings" aria-label="Settings"'), "the old top-bar Settings gear still exists");
check(shell.includes('id="account-menu"') && shell.includes('id="profile-avatar"') && shell.includes('href="#/settings"'), "the account menu or Settings entry is missing");
check(!shell.includes('href="#/settings/about"') && !shell.includes("Open D2L") && !shell.includes("popup.html") && !shell.includes("Extractor tools"), "the account menu should not link About or Open D2L");
check(shell.includes('id="profile-name"') && app.includes('"profile-name"') && !app.includes("profile-copy") && app.includes("M9 0a9 9") && shell.includes('id="profile-name">Your account</b>'), "the profile flyout header should display the student's name via profile-name, defaulting to Your account");
check(!shell.includes("Sync reminders and visible courses") && !shell.includes("Privacy, support and project details"), "profile menu actions should not include descriptive subtitles");
const topbar = shell.slice(shell.indexOf('<header class="topbar">'), shell.indexOf("</header>"));
check(topbar.includes('id="profile-button"') && !app.includes('class="nav-profile') && !css.includes(".nav-profile") && css.includes(".account-menu { top: -7px; right: -7px; width: 254px"), "the profile control should sit at the top right, not the bottom of the sidebar");
const accountMenu = shell.slice(shell.indexOf('id="account-menu"'), shell.indexOf('id="account-main"'));
check(accountMenu.includes('class="account-header"') && accountMenu.includes('id="profile-name">Your account</b>') && accountMenu.includes('id="sync-hint"') && accountMenu.indexOf('class="account-who"') < accountMenu.indexOf('class="account-avatar-recess"') && accountMenu.indexOf('class="account-header"') < accountMenu.indexOf('class="account-slider"'), "the account card header should hold the account info and sync status on the left and the avatar recess on the right, above the sliding panes");
check(!shell.includes('class="account-head"') && (shell.match(/class="profile-avatar"/g) || []).length === 1, "the avatar should live only in the top-bar button; the card nests that button instead of repeating it");
check(/\.account-header \.account-avatar-recess \{[^}]*width: 48px; height: 48px;[^}]*border-radius: 50%/.test(css) && /\.profile-trigger\[aria-expanded="true"\] \{[^}]*z-index: 41/.test(css), "the avatar recess should be a 48px circle and the open trigger should sit above the card");
// Geometry: the 42px trigger's centre is 21px from the menu-root's top and right edges.
// The card starts 7px out (1px border + 6px side padding), the header is 54px tall and the
// 48px recess is pulled 3px into the padding, so its centre must land on the trigger's.
const num = (re) => Number((css.match(re) || [])[1]);
const trigger = num(/\.profile-trigger \{[^}]*?width: (\d+)px/);
const out = -num(/\.account-menu \{ top: (-\d+)px/);
const rightOut = -num(/\.account-menu \{[^}]*?right: (-\d+)px/);
const sidePad = num(/\.account-menu \{[^}]*?padding: 0 (\d+)px/);
const headerMin = num(/\.account-header \{[^}]*?min-height: (\d+)px/);
const recess = num(/\.account-avatar-recess \{[^}]*?width: (\d+)px/);
const pull = -num(/\.account-avatar-recess \{[^}]*?margin-right: (-\d+)px/);
check(out - 1 === rightOut - 1 && headerMin / 2 - (out - 1) === trigger / 2, "the card header should be vertically centred on the closed profile button");
check(recess / 2 - pull - (rightOut - 1 - sidePad) === trigger / 2, "the avatar recess should be horizontally centred on the closed profile button, so opening causes no visual jump");
check(app.includes("changes[PROFILE_KEY]") && app.includes("renderUserProfile"), "the dashboard does not react when D2L saves a profile image");

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}
console.log("D2L profile capture and the top-bar account menu passed.");
