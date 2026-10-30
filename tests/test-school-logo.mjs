import { appSource } from "./app-source.mjs";
// School logo: the sync copies the logo from the D2L header, and the dashboard
// corner shows it (or a plain icon) instead of any "SA" / "Student Archive" text.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

// ---- sync side: find and save the header logo
const ORIGIN = "https://school.example.edu";
function loadLogoModule() {
  const context = vm.createContext({
    URL, setTimeout, Date, Promise,
    window: {},
    D2LExtractorContent: {
      queryOne: () => null,
      absoluteUrl: (value) => new URL(value, `${ORIGIN}/d2l/home`).href
    }
  });
  context.globalThis = context;
  vm.runInContext(read("src/content/school-logo.js"), context, { filename: "school-logo.js" });
  return context.D2LExtractorContent;
}
const logo = loadLogoModule();
// Real KSU header (measured 2026-09-28): <d2l-labs-navigation-link-image class="d2l-navigation-s-logo" src="...">.
// The fake DOM answers only selectors that match that element, as querySelector would.
const header = (attrs) => (selector) => [".d2l-navigation-s-logo[src]", "d2l-labs-navigation-link-image[src]"].includes(selector) ? { getAttribute: (name) => attrs[name] ?? null } : null;
const memoryStorage = () => {
  const data = {};
  return { data, get: async (key) => ({ [key]: data[key] }), set: async (values) => Object.assign(data, values) };
};
const imageResponse = (type, size = 2000) => ({ ok: true, blob: async () => ({ type, size }) });

const found = logo.findSchoolLogo(header({ src: "/d2l/lp/navbars/6606/theme/viewimage/42/view?v=1", text: "Example University" }));
check(found?.sourceUrl === `${ORIGIN}/d2l/lp/navbars/6606/theme/viewimage/42/view?v=1`, "logo: header image URL is read from d2l-navigation-link-image");
check(found?.alt === "Example University", "logo: school name is kept as the image's alt text");
check(logo.findSchoolLogo(() => null) === null, "logo: a page with no header logo finds nothing");

const storage = memoryStorage();
let fetched = [];
const saved = await logo.captureSchoolLogo({
  find: header({ src: "/logo.png", text: "Example University" }),
  fetchImpl: async (url, options) => { fetched.push([url, options.credentials]); return imageResponse("image/png"); },
  storage,
  toDataUrl: async () => "data:image/png;base64,AAAA",
  now: () => new Date("2026-09-28T12:00:00Z")
});
check(saved?.dataUrl === "data:image/png;base64,AAAA" && storage.data.schoolLogo?.dataUrl === saved.dataUrl, "logo: the sync saves the logo as an image the dashboard can show offline");
check(fetched.length === 1 && fetched[0][0] === `${ORIGIN}/logo.png` && fetched[0][1] === "include", "logo: the logo is read once from the school's own D2L");

fetched = [];
await logo.captureSchoolLogo({ find: header({ src: "/logo.png" }), fetchImpl: async () => { fetched.push(1); return imageResponse("image/png"); }, storage, toDataUrl: async () => "x", now: () => new Date("2026-09-28T12:00:00Z") });
check(fetched.length === 0, "logo: a recent copy of the same logo is not downloaded again");

const rejectStore = memoryStorage();
await logo.captureSchoolLogo({ find: header({ src: "/page.html" }), fetchImpl: async () => imageResponse("text/html"), storage: rejectStore, toDataUrl: async () => "x" });
await logo.captureSchoolLogo({ find: header({ src: "/huge.png" }), fetchImpl: async () => imageResponse("image/png", 5 * 1024 * 1024), storage: rejectStore, toDataUrl: async () => "x" });
check(!rejectStore.data.schoolLogo, "logo: non-images and oversized files are not saved");

const manifest = JSON.parse(read("manifest.json"));
const scripts = manifest.content_scripts[0].js;
check(scripts.includes("src/content/school-logo.js") && scripts.indexOf("src/content/school-logo.js") > scripts.indexOf("src/content/dom.js"), "logo: capture script runs on D2L pages after the DOM helpers");

// ---- dashboard side: corner shows the logo, never the old name
const html = read("dashboard.html");
const brand = html.match(/<a class="brand"[\s\S]*?<\/a>/)?.[0] || "";
check(brand.includes('id="school-logo"') && brand.includes('id="brand-fallback"') && brand.includes("src/dashboard/img/d2l-brightspace.png"), "corner: has a logo image that starts as the D2L Brightspace wordmark");
check(!/>\s*SA\s*</.test(brand) && !/Student Archive|D2L Archive/i.test(brand), "corner: no SA badge or Student Archive name");

function cornerDom() {
  const img = { hidden: true, alt: "", src: "", removeAttribute(name) { this[name] = ""; } };
  const fallback = { hidden: false };
  return { img, fallback, $: (selector) => ({ "#school-logo": img, "#brand-fallback": fallback })[selector] || null };
}
const app = appSource();
const renderSource = app.match(/function renderSchoolLogo\(logo\) \{[\s\S]*?\n {2}\}/)?.[0];
check(Boolean(renderSource), "corner: dashboard has renderSchoolLogo");
if (renderSource) {
  const run = (value) => {
    const dom = cornerDom();
    vm.runInNewContext(`${renderSource}; renderSchoolLogo(value);`, { $: dom.$, value });
    return dom;
  };
  const withLogo = run({ dataUrl: "data:image/png;base64,AAAA", alt: "Example University" });
  check(!withLogo.img.hidden && withLogo.fallback.hidden && withLogo.img.src.startsWith("data:image/") && withLogo.img.alt === "Example University", "corner: saved logo is shown");
  const noLogo = run(null);
  check(!noLogo.img.hidden && noLogo.fallback.hidden && noLogo.img.src === "src/dashboard/img/d2l-brightspace.png" && noLogo.img.alt === "D2L Brightspace", "corner: with no saved logo the D2L Brightspace wordmark shows");
  const badLogo = run({ dataUrl: "https://tracker.example/x.png" });
  check(badLogo.img.src === "src/dashboard/img/d2l-brightspace.png" && !/tracker/.test(badLogo.img.src), "corner: only saved image data is shown, never a remote URL");
}
check(/onChanged\?\.addListener[\s\S]{0,120}LOGO_KEY/.test(app), "corner: logo updates when a sync saves a new one");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("School logo capture and dashboard corner checks passed.");
