import { appSource } from "./app-source.mjs";
// Settings > Appearance (Oct 1, 2026): Light, Dark or Match my computer, six
// accent colors, backgrounds (colors or your own picture) and see-through
// cards, in a Settings pop-up with its sections listed on the left. Every
// text color is checked for 4.5:1 contrast in both themes, including over the
// darkest and lightest picture a student could pick.
import fs from "node:fs";
import path from "node:path";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const dash = loadDashboard();
const look = dash.appearance;
const css = fs.readFileSync(path.join(repoRoot, "src/dashboard/dashboard.css"), "utf8");
const app = appSource();
const shell = fs.readFileSync(path.join(repoRoot, "dashboard.html"), "utf8");
const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

// Token blocks: the light :root, the dark theme, accents and backgrounds.
const blocks = new Map();
for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:^|\n)(:root[^{]*)\{([^}]*)\}/g)) {
  const selector = match[1].trim();
  const tokens = blocks.get(selector) || {};
  for (const [, name, value] of match[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens[name] = value.trim();
  blocks.set(selector, tokens);
}
const light = blocks.get(":root");
const dark = blocks.get(':root[data-mode="dark"]');
check(light && dark, "A1: the light and dark token blocks should both exist");
// Swatches show each accent's button color, the same in both themes.
// --wall-scrim, --glass-fill and --glass-bg are mixed from the theme's own colors.
const lightNames = Object.keys(light || {}).filter((name) => !["--font", "--wall-scrim", "--glass-fill", "--glass-bg", "--control-h", "--control-h-lg", "--control-radius"].includes(name) && !/^--accent-(blue|green|purple|rose|orange|teal)$/.test(name));
const missing = lightNames.filter((name) => !(name in (dark || {})));
check(!missing.length, `A1: the dark theme should set every light color, missing ${missing.join(", ")}`);
check(/:root\[data-mode="dark"\]\s*\{[^}]*color-scheme:\s*dark/.test(css), "A1: the dark theme should switch form controls and scrollbars to dark");

const ACCENT_KEYS = ["--accent", "--accent-hover", "--accent-rgb", "--link", "--link-hover", "--link-rgb", "--nav-on", "--nav-on-ink", "--cal-selected", "--cal-hover", "--unread"];
const palette = (mode, accent) => {
  const tokens = { ...(mode === "dark" ? { ...light, ...dark } : light) };
  if (accent !== "blue") Object.assign(tokens, blocks.get(`:root[data-accent="${accent}"]`), mode === "dark" ? blocks.get(`:root[data-mode="dark"][data-accent="${accent}"]`) : {});
  return tokens;
};
for (const accent of Object.keys(look.ACCENTS).filter((key) => key !== "blue")) {
  for (const selector of [`:root[data-accent="${accent}"]`, `:root[data-mode="dark"][data-accent="${accent}"]`]) {
    const names = Object.keys(blocks.get(selector) || {});
    check(ACCENT_KEYS.every((name) => names.includes(name)), `A2: ${selector} should set every accent color`);
  }
  check(light[`--accent-${accent}`] === blocks.get(`:root[data-accent="${accent}"]`)?.["--accent"], `A2: the ${accent} swatch should show the ${accent} accent`);
}

const hex = (value) => /^#[0-9A-Fa-f]{6}$/.test(String(value));
const toHex = (color) => `#${color.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
const resolveColor = (value, tokens, seen = new Set()) => {
  const raw = String(value || "").trim();
  if (hex(raw)) return raw;
  const variable = raw.match(/^var\((--[\w-]+)\)$/);
  if (variable) {
    if (seen.has(variable[1])) return raw;
    return resolveColor(tokens[variable[1]] || raw, tokens, new Set([...seen, variable[1]]));
  }
  const mixed = raw.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/i);
  if (mixed) {
    const first = resolveColor(mixed[1], tokens, seen);
    const second = resolveColor(mixed[3], tokens, seen);
    if (hex(first) && hex(second)) return toHex(look.mix(look.rgb(first), look.rgb(second), Number(mixed[2]) / 100));
  }
  return raw;
};
const ratio = (a, b) => look.contrast(look.rgb(a), look.rgb(b));
function readable(mode, accent, text, ground, need = 4.5) {
  const tokens = palette(mode, accent);
  const fg = resolveColor(tokens[text] || text, tokens);
  const bg = resolveColor(tokens[ground] || ground, tokens);
  if (!hex(fg) || !hex(bg)) return failures.push(`A3: ${mode}/${accent} ${text} on ${ground} isn't a resolvable color (${fg} on ${bg})`);
  const value = ratio(fg, bg);
  check(value >= need, `A3: ${mode}/${accent} ${text} on ${ground} is ${value.toFixed(2)}:1, needs ${need}:1`);
}
for (const mode of ["light", "dark"]) {
  for (const accent of Object.keys(look.ACCENTS)) {
    for (const ground of ["--surface", "--ground"]) {
      for (const text of ["--ink", "--ink-2", "--ink-3", "--ink-4", "--muted", "--link"]) readable(mode, accent, text, ground);
    }
    readable(mode, accent, "--on-accent", "--accent");
    readable(mode, accent, "--nav-on-ink", "--nav-on");
    readable(mode, accent, "--ink", "--cal-selected");
  }
  for (const [text, ground] of [["--good", "--good-tint"], ["--info", "--info-tint"], ["--bad", "--bad-tint"], ["--warn", "--warn-tint"], ["--neutral", "--neutral-tint"], ["--attention-ink", "--attention-tint"], ["--on-ink", "--ink"], ["--grade-book-ink", "--grade-book-tint"], ["--grade-letter-ink", "--grade-letter-tint"], ["--ink", "--mark"], ["--promo-title", "--promo-1"], ["--promo-body", "--promo-3"]]) {
    readable(mode, "blue", text, ground);
  }
}

// A4: the readability math in appearance.js uses the same colors as the CSS.
check(look.GROUND.light === light["--ground"] && look.GROUND.dark === dark["--ground"], "A4: appearance.js page colors should match --ground in both themes");
for (const mode of ["light", "dark"]) {
  const expected = [palette(mode, "blue")["--ink-4"], ...Object.keys(look.ACCENTS).map((accent) => palette(mode, accent)["--link-hover"])];
  check(JSON.stringify(look.WEAKEST_TEXT[mode]) === JSON.stringify(expected), `A4: ${mode} weakest text should be --ink-4 and every accent's --link-hover (${expected.join(" ")})`);
}
check(/:root\[data-mode\]\[data-background\]:not\(\[data-background="default"\]\)\s*\{\s*--muted:\s*var\(--ink-4\);\s*--link:\s*var\(--link-hover\);/.test(css), "A4: on a background, secondary text and links should take their deeper shade");

// A5: every background color keeps the deeper text readable in both themes.
for (const key of Object.keys(look.BACKGROUNDS).filter((name) => name !== "default" && name !== "image")) {
  for (const mode of ["light", "dark"]) {
    const ground = palette(mode, "blue")[`--bg-${key}`];
    check(hex(ground) && blocks.get(`:root[data-background="${key}"]`)?.["--ground"] === `var(--bg-${key})`, `A5: the ${key} background should set the page color`);
    for (const text of look.WEAKEST_TEXT[mode]) check(ratio(text, ground) >= 4.5, `A5: ${mode} ${text} on the ${key} background is ${ratio(text, ground).toFixed(2)}:1`);
  }
}

// A6/A7: pictures. The picture is veiled at most 25%; cards and the frosted
// strips over it turn as solid as that picture needs, and at that point the
// weakest text still reaches 4.5:1 over every sampled pixel, in both themes.
check(look.PICTURE_VEIL <= 0.25, `A6: the picture should be covered at most 25% (is ${look.PICTURE_VEIL * 100}%)`);
check(look.SURFACE.light === light["--surface"] && look.SURFACE.dark === dark["--surface"], "A6: appearance.js card colors should match --surface in both themes");
const pictures = {
  black: [[0, 0, 0]],
  white: [[255, 255, 255]],
  gray: [[128, 128, 128]],
  photo: Array.from({ length: 400 }, (_, i) => [(i * 97) % 256, (i * 57) % 256, (i * 31) % 256])
};
const floors = {};
for (const [name, pixels] of Object.entries(pictures)) {
  for (const mode of ["light", "dark"]) {
    const floor = look.glassFor(pixels, mode);
    floors[`${name}/${mode}`] = floor;
    check(floor >= look.GLASS_MIN && floor <= 100 && floor % 5 === 0, `A6: ${name}/${mode} card floor ${floor} should be a 5% step from ${look.GLASS_MIN} to 100`);
    const ground = look.rgb(look.GROUND[mode]);
    const surface = look.rgb(look.SURFACE[mode]);
    let worst = Infinity;
    for (const pixel of pixels) {
      const card = look.mix(surface, look.mix(ground, pixel, look.PICTURE_VEIL), floor / 100);
      for (const text of look.WEAKEST_TEXT[mode].map(look.rgb)) worst = Math.min(worst, look.contrast(text, card));
    }
    check(worst >= 4.5, `A6: ${name} picture in ${mode}: weakest text on cards is ${worst.toFixed(2)}:1 at ${floor}% solid`);
  }
}
check(floors["white/light"] === look.GLASS_MIN && floors["black/dark"] === look.GLASS_MIN, `A6: a picture matching the theme allows the most see-through (${JSON.stringify(floors)})`);
check(floors["gray/light"] < 100 && floors["gray/dark"] < 100, `A6: a mid-gray picture still allows see-through cards (${JSON.stringify(floors)})`);
const picked = look.normalize({ background: "image", wallpaper: { savedAt: "2026-10-01T00:00:00.000Z", minGlass: { light: 70, dark: 55 } }, glass: 45 });
check(look.glassFloor(picked, "light") === 100 && look.glassFloor(look.normalize({ background: "mint" }), "light") === 100, "A7: all cards are always solid");

// A8: saved choices are cleaned up.
const cleaned = look.normalize({ theme: "neon", accent: "gold", background: "image", glass: 10 });
check(cleaned.theme === "light" && cleaned.accent === "blue" && cleaned.background === "default" && cleaned.glass === 100 && cleaned.wallpaper === null, "A8: legacy image and glass choices are removed");
check(look.normalize({ background: "image", wallpaper: { savedAt: "2026-10-01T00:00:00.000Z" }, glass: 10 }).background === "default" && look.normalize({ glass: 140 }).glass === 100, "A8: legacy appearance settings normalize to solid preset cards");
check(look.normalize({ theme: "system" }).theme === "system", "A8: Match my computer is kept");

// A9: course colors switch with the theme and stay readable in both.
const index = dash.buildIndex({ now: "2026-10-01T12:00:00.000Z", courses: ["ART 9001", "HIST 9002", "POLS 9003", "CRJU 9004", "MATH 1111", "ENGL 1101", "BIOL 1107", "CHEM 1211", "PSYC 1101", "COMM 1110"].map((code, i) => ({ courseId: String(i + 1), code, title: code })), entities: [] });
for (const course of index.allCourses) {
  const tint = String(course.tint).match(/^light-dark\((#[0-9A-F]{6}), color-mix\(in srgb, (#[0-9A-F]{6}) 18%, var\(--surface\)\)\)$/i);
  const ink = String(course.ink).match(/^light-dark\((#[0-9A-F]{6}), color-mix\(in srgb, (#[0-9A-F]{6}) 55%, var\(--ink\)\)\)$/i);
  if (!tint || !ink) {
    failures.push(`A9: ${course.code} colors should switch with the theme (${course.tint} / ${course.ink})`);
    continue;
  }
  check(ratio(ink[1], tint[1]) >= 4.5, `A9: ${course.code} light course text is ${ratio(ink[1], tint[1]).toFixed(2)}:1`);
  const darkTint = look.mix(look.rgb(tint[2]), look.rgb(dark["--surface"]), 0.18);
  const darkInk = look.mix(look.rgb(ink[2]), look.rgb(dark["--ink"]), 0.55);
  check(look.contrast(darkInk, darkTint) >= 4.5, `A9: ${course.code} dark course text is ${look.contrast(darkInk, darkTint).toFixed(2)}:1`);
}

// A10: the Settings pop-up and its sections.
const base = { look: look.normalize(null), choices: look, sync: { label: "Synced today" }, settings: { reminderHours: 24 }, courses: index.allCourses.slice(0, 2), visible: new Set(["1"]) };
const shellHtml = dash.settingsShell("sync");
check(shellHtml.includes('role="dialog"') && shellHtml.includes('aria-modal="true"') && shellHtml.includes('data-action="close-detail"') && shellHtml.includes('aria-label="Settings sections"'), "A10: Settings should open as a closable pop-up with a section list");
check((shellHtml.match(/class="settings-tab"/g) || []).length === 6 && /href="#\/settings\/sync" aria-current="page"/.test(shellHtml), "A10: the six sections should be listed with the open one marked");
check(["Appearance", "Courses", "Sync", "Storage", "About"].every((label) => shellHtml.includes(`${label}</a>`)), "A10: section names should read Appearance, Courses, Sync, Storage, About");
const appearance = dash.settingsSection({ ...base, section: "appearance" });
check(["Light", "Dark", "Match my computer"].every((label) => appearance.includes(`>${label}</button>`)) && /data-key="theme" data-value="light" aria-pressed="true"/.test(appearance), "A10: Theme should offer Light, Dark and Match my computer");
check((appearance.match(/class="swatch"/g) || []).length === 6 && /data-value="blue" aria-pressed="true"/.test(appearance), "A10: six accent colors should be offered with blue chosen");
check((appearance.match(/class="tile"/g) || []).length === 6 && !appearance.includes("Use your own image") && !appearance.includes("Your image"), "A10: six preset backgrounds should show without an image option");
check(!appearance.includes('type="range"') && !appearance.includes("See-through cards"), "A10: the see-through cards setting should be removed");
const withPicture = dash.settingsSection({ ...base, section: "appearance", look: look.normalize({ background: "image", wallpaper: { savedAt: "2026-10-01T00:00:00.000Z", minGlass: { light: 65, dark: 60 } }, glass: 50 }), wallpaperUrl: "blob:chrome-extension://x/1" });
check(!withPicture.includes("Your image") && !withPicture.includes("glass-range") && !withPicture.includes("Remove image"), "A10: legacy picture data should not recreate removed controls");
check(dash.settingsSection({ ...base, section: "courses" }).includes('role="switch"'), "A10: Courses keeps its show/hide switches");
check(dash.settingsSection({ ...base, section: "sync" }).includes('class="btn btn-primary" type="button" data-action="sync"') && dash.settingsSection({ ...base, section: "sync" }).includes("Sync now") && dash.settingsSection({ ...base, section: "sync" }).includes('data-action="set-reminder"'), "A10: Sync keeps its primary Sync now action and the reminder");
const storage = dash.settingsSection({ ...base, section: "storage", storage: { previews: { count: 3, bytes: 5 * 1024 * 1024 } } });
check(storage.includes("3 files · 5.0 MB") && storage.includes('data-action="clear-previews"') && !storage.includes("Background image"), "A10: Storage shows saved previews without the removed picture setting");
check(dash.settingsSection({ ...base, section: "nowhere" }).startsWith("<h2>Appearance</h2>"), "A10: an unknown section opens Appearance");

// A11: Settings opens over the page instead of replacing it.
check(dash.isLayerRoute("#/settings") && dash.isLayerRoute("#/settings/storage") && !dash.isDetailRoute("#/settings") && !dash.isLayerRoute("#/about"), "A11: #/settings should open over the page");
check(/renderDetailRoute[\s\S]*route\.name === "settings"[\s\S]*mountDetailShell\(context, "settings"\)/.test(app), "A11: the settings route should mount the pop-up");

// A12: the look applies before anything paints, and the picture stays saved.
const head = shell.slice(0, shell.indexOf("</head>"));
check(head.indexOf("appearance.js") > -1 && head.indexOf("appearance.js") < head.indexOf("dashboard.css"), "A12: appearance.js should load in <head> before the stylesheet");
check(!app.includes("data-action=set-glass") && !app.includes("data-action=pick-wallpaper"), "A12: removed wallpaper and glass controls should have no UI handlers");
check(!css.includes("data-glass") && css.includes("solid surfaces"), "A12: cards should have no transparency mode");

// A13: picture-specific frosted strips are no longer part of the appearance system.
if (false) {
for (const selector of [".page > .page-head", ".page > .toolbar", ".page > .search-count", ".page > .empty"]) {
  check(new RegExp(`:root\\[data-background="image"\\] :is\\([^)]*${selector.replace(/[.>]/g, (c) => `\\${c}`).replace(/ /g, "\\s*")}`).test(css), `A13: ${selector} should get a frosted strip over a picture`);
}
check(/:root\[data-background="image"\] \.page > \.back-link \{[^}]*background: var\(--glass-bg\)/.test(css), "A13: Back to Courses should get a frosted strip over a picture");
}
check(!css.includes('data-background="image"') && !css.includes("--glass-bg"), "A13: picture-only frosted styling should be removed");

if (failures.length) {
  console.error(`Appearance checks failed (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Appearance checks passed.");
