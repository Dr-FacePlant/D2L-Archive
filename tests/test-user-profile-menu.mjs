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
check(app.includes('id="profile-menu"') && app.includes('id="profile-avatar"') && app.includes('href="#/settings"'), "the sidebar profile menu or Settings entry is missing");
check(app.includes('href="#/about"') && app.includes("Open D2L") && !app.includes("popup.html") && !app.includes("Extractor tools"), "the compact profile menu should contain only Settings, About, and Open D2L");
check(!app.includes('id="profile-name"') && !app.includes("profile-copy") && app.includes("M9 0a9 9"), "the sidebar should show only the official Brightspace profile image or profile-default icon, never the student's name");
check(!app.includes("Sync reminders and visible courses") && !app.includes("Privacy, support and project details"), "profile menu actions should not include descriptive subtitles");
check(css.includes(".nav-profile { margin-top: auto") && css.includes(".profile-menu { position: fixed"), "the profile control is not anchored to the bottom of the sidebar");
check(app.includes("changes[PROFILE_KEY]") && app.includes("renderUserProfile"), "the dashboard does not react when D2L saves a profile image");

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}
console.log("D2L profile capture and sidebar account menu passed.");
