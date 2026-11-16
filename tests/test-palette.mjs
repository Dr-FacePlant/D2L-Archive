import fs from "node:fs";
import path from "node:path";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = (file) => fs.readFileSync(path.join(root, file), "utf8");

// ---- a small archive, and a clock that never moves ---------------------------------
const NOW = new Date(2026, 10, 4, 9, 0);
const at = (days, hour = 23, minute = 59) => new Date(2026, 10, 4 + days, hour, minute).toISOString();
const courses = [{ courseId: "101", code: "CO.000.CSCI1301.1.20272", title: "Intro to Computing" }, { courseId: "202", code: "CO.000.BIOL1107.1.20272", title: "Biology" }];
const work = (id, type, course, title, dueAt) => ({ entityId: id, entityType: type, courseId: course, canonicalTitle: title, pointsPossible: 10, dates: { dueAt }, urls: {}, attempts: { source: "none" } });
const post = (id, course, title, publishedAt) => ({ entityId: id, entityType: "announcement", courseId: course, canonicalTitle: title, body: `<p>${title} body</p>`, dates: { publishedAt }, urls: {} });
const entities = [
  work("assignment:101:1", "assignmentBundle", "101", "Lab 4", at(2)),
  work("quiz:101:9", "quizBundle", "101", "Quiz 3", at(4)),
  work("assignment:202:5", "assignmentBundle", "202", "Stain Reflection", at(1)),
  work("assignment:101:3", "assignmentBundle", "101", "Project 2", at(20)),
  work("assignment:101:0", "assignmentBundle", "101", "Lab 3", at(-3)),
  work("assignment:202:6", "assignmentBundle", "202", "Slide Report", at(6)),
  work("assignment:303:1", "assignmentBundle", "303", "Other Course Essay", at(1)),
  post("announcement:101:1", "101", "Lab moved to Friday", at(-1, 8, 0)),
  post("announcement:202:2", "202", "Bring a lab coat", at(-3, 8, 0)),
  post("announcement:101:3", "101", "Welcome", at(-30, 8, 0)),
  post("announcement:202:4", "202", "Safety rules", at(-9, 8, 0))
];
const index = dash.buildIndex({ now: NOW.toISOString(), courses: [...courses, { courseId: "303", code: "CO.000.HIST1100.1.20272", title: "History" }], entities, settings: {} });
const label = (courseId) => index.courseById.get(courseId).label;
// Hide course 303 the way the dashboard does: visible is the set of course ids shown.
index.visible.delete("303");

// ---- searchModel keeps the type, kind and course on each item ---------------------------
const found = dash.searchModel(index, { query: "lab", entities: [{ entityId: "assignment:101:1" }, { entityId: "announcement:101:1" }], evidence: [] });
const lab = found.groups.flatMap((group) => group.items).find((item) => item.id === "assignment:101:1");
check(lab && lab.type === "assignmentBundle" && lab.kind && lab.course === label("101"), `a search item should carry its type, kind and course (got ${JSON.stringify(lab)})`);
check(lab && lab.sub === `${lab.kind} · ${lab.course}`, "the old one-line sub text is unchanged");

// ---- the list before typing ---------------------------------------------------------------------
const home = dash.paletteHome({ index, now: NOW });
const due = home.groups.find((group) => group.name === "Due soon");
check(due && due.rows.map((row) => row.title).join("|") === "Stain Reflection|Lab 4|Quiz 3", `Due soon should list the next three by date (got ${due?.rows.map((row) => row.title).join("|")})`);
check(due.rows[0].tag === label("202") && due.rows[0].right === "Tomorrow, 11:59 PM", `a due row shows its course and when (got ${due.rows[0].tag} / ${due.rows[0].right})`);
check(due.rows[1].right === "in 2 days", `later days read "in 2 days" (got ${due.rows[1].right})`);
check(due.rows.every((row) => row.route && row.route.startsWith("#/")), "every row has a route to open");
check(!due.rows.some((row) => /Lab 3|Project 2|Slide|Other Course/.test(row.title)), "past work, work beyond 14 days, work past the first three and hidden courses stay out");
const skipped = dash.paletteHome({ index, now: NOW, skip: new Set(["assignment:202:5"]) });
check(skipped.groups[0].rows[0].title === "Lab 4", "work marked done or skipped leaves the list");
const news = home.groups.find((group) => group.name === "Latest announcements");
check(news && news.rows.map((row) => row.title).join("|") === "Lab moved to Friday|Bring a lab coat|Safety rules", `announcements run newest first, three at most (got ${news?.rows.map((row) => row.title).join("|")})`);
check(news.rows[0].right === "Yesterday" && news.rows[0].tag === label("101"), "an announcement shows its course and how long ago");
check(dash.paletteHome({ index: null }).groups.length === 0 && dash.paletteHome().groups.length === 0, "no archive yet means an empty list, not an error");
check(dash.paletteHome({ index: dash.buildIndex({ now: NOW.toISOString(), courses: [], entities: [], settings: {} }), now: NOW }).groups.length === 0, "an empty archive means an empty list");

// ---- the list while typing --------------------------------------------------------------------------
const many = Array.from({ length: 12 }, (_, n) => work(`assignment:101:${100 + n}`, "assignmentBundle", "101", `Essay ${n}`, at(n + 1)));
const bigIndex = dash.buildIndex({ now: NOW.toISOString(), courses, entities: many, settings: {} });
const hits = dash.paletteHits({ index: bigIndex, result: { entities: many.map((entity) => ({ entityId: entity.entityId })), evidence: [] }, query: "essay" });
check(hits.groups.length === 1 && hits.groups[0].rows.length === 8, `typing shows at most 8 hits (got ${hits.groups[0]?.rows.length})`);
check(hits.total === 12 && hits.allRoute === "#/search?q=essay", `the full count and the Search page link are kept (got ${hits.total} ${hits.allRoute})`);
check(hits.groups[0].name === "In your archive · 12 results", `the heading counts every hit (got ${hits.groups[0].name})`);
check(hits.groups[0].rows[0].tag && hits.groups[0].rows[0].right === label("101"), "a hit shows its kind and course");
const none = dash.paletteHits({ index, result: { entities: [], evidence: [] }, query: "zzz" });
check(none.groups.length === 0 && none.total === 0 && none.query === "zzz", "no hits means no group");
check(dash.paletteHits({ index: null, result: null, query: "x" }).groups.length === 0, "no archive or no answer yet means no hits");

// ---- what the arrow keys can reach ----------------------------------------------------------------------
const kinds = (view) => dash.paletteOptions(view).map((option) => option.kind).join(",");
check(kinds(hits) === `${"hit,".repeat(8)}all`.replace(/,$/, ""), `with a query: the hits, then See all (got ${kinds(hits)})`);
check(dash.paletteOptions(hits).at(-1).route === "#/search?q=essay", "See all opens the Search page");
check(kinds(none) === "", "with a query and no hits, no options left");
check(kinds(home) === "hit,hit,hit,hit,hit,hit", `with no query, only the rows (got ${kinds(home)})`);
const oneHit = dash.paletteHits({ index, result: { entities: [{ entityId: "assignment:101:1" }], evidence: [] }, query: "lab 4" });
check(kinds(oneHit) === "hit", "no See all when every hit is already on screen");
check(dash.paletteStart(dash.paletteOptions(hits)) === 0, "the highlight starts on the first hit, so Enter opens it");
check(dash.paletteStart(dash.paletteOptions(none)) === -1, "with no hits nothing is highlighted");
check(dash.paletteStart(dash.paletteOptions(home)) === 0, "with no query it starts on the first row");
check(dash.paletteStart([]) === -1, "nothing to highlight in an empty list");

// ---- drawing ------------------------------------------------------------------------------------------------------
const html = dash.paletteList({ ...hits, query: "essay" }, 0);
check(/id="palette-opt-0"[^>]*aria-selected="true"/.test(html) && /id="palette-opt-1"[^>]*aria-selected="false"/.test(html), "only the highlighted row is selected");
check(html.includes('id="palette-opt-8"') && html.includes("See all 12 results") && !html.includes('id="palette-opt-9"'), "rows are numbered in order, See all last");
check(html.includes("<mark>Essay</mark> 0"), "the match is marked in the title");
check(html.includes('href="#/'), "hits are real links, so a new tab still works");
const evil = dash.paletteList({ query: '<img src=x onerror="boom()">', groups: [{ name: "In your archive · 1 result", rows: [{ id: "a", type: "announcement", title: '<script>boom()</script>', tag: "<b>x</b>", right: "&", route: '#/x"onmouseover="boom()' }] }], total: 1, allRoute: '#/search?q=x' }, 0);
check(!/<script|<img|<b>/.test(evil) && !/"onmouseover=/.test(evil), "titles, tags, routes and the query are escaped");
check(dash.paletteList(home, 0).includes("Due soon") && !dash.paletteList(home, 0).includes("palette-ask"), "no Ask row before typing");
check(dash.paletteList({ query: "", groups: [], total: 0, allRoute: "" }, -1).includes("Nothing due soon"), "an empty home explains itself");
check(dash.paletteList({ query: "qq", groups: [], total: 0, allRoute: "", pending: true }, 0).includes("Searching…"), "a search on its way says so");
check(dash.paletteList({ query: "qq", groups: [], total: 0, allRoute: "" }, 0).includes("Nothing in your archive matches “qq”."), "no hits says so");
const shell = dash.paletteShell();
check(/role="dialog"[^>]*aria-modal="true"/.test(shell) && /id="palette-input"[^>]*role="combobox"/.test(shell) && shell.includes('id="palette-list"') && shell.includes("data-palette-close"), "the dialog is labelled, has a combobox input, a list and a click-away layer");

// ---- the page and the source ------------------------------------------------------------------------------------------
const page = src("dashboard.html");
check(/<button[^>]*class="palette-trigger"[^>]*data-palette-open/.test(page), "the top bar has the button that opens the pop-up");
check(!/<form[^>]*top-search/.test(page) && /id="search-panel"[^>]*hidden/.test(page), "the old search box is gone, but the hidden panel node stays (Esc handling reads it)");
check(/id="palette-root"[^>]*hidden/.test(page) && page.includes("src/dashboard/palette.css"), "the pop-up layer starts hidden and its styles are linked");
const order = (file) => page.indexOf(`src/dashboard/${file}`);
check(order("model-search.js") < order("model-palette.js") && order("render-search.js") < order("render-palette.js") && order("app-events.js") < order("app-palette.js") && order("app-render.js") < order("app-palette.js"), "the pop-up scripts load after the ones they use");
const code = ["model-palette.js", "render-palette.js", "app-palette.js"].map((file) => src(`src/dashboard/${file}`)).join("\n");
check(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|eval\(|innerHTML\s*=\s*(?=\S)(?!dash\.palette|"")/.test(code.replace(/\/\/.*$/gm, "")), "the pop-up makes no network requests and sets innerHTML only from its own renderers");
check([...code.matchAll(/api\("([^"]+)"/g)].every((match) => match[1] === "search.query"), "the pop-up reads the archive only through search.query");
check(Number(fs.readFileSync(path.join(root, "src/dashboard/palette.css"), "utf8").match(/z-index:\s*(\d+)/)[1]) === 150, "the pop-up sits above the detail layer (140) and below the file viewer (200)");

if (failures.length) {
  console.error(failures.map((message) => `FAIL: ${message}`).join("\n"));
  process.exit(1);
}
console.log("Palette tests passed.");
