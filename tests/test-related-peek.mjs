// A Work & grades or Content pill in Related items opens a side panel over the
// pop-up. Work and grades get a short summary. A content topic shows its PDF,
// image, video, audio or text file; Word files, links and D2L pages get a plain
// note with Open in D2L. Esc and the scrim close only the panel.
process.env.TZ = "America/New_York";

import fs from "node:fs";
import path from "node:path";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const dash = loadDashboard();
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

// The panel markup, one state at a time.
const base = { mode: "content", title: "Step 2 Validation Form: Take to Museum", icon: "doc", meta: "Museum visit · File", d2lUrl: "https://kennesaw.view.usg.edu/d2l/le/content/9/viewContent/2/View", downloadUrl: "", localPath: "", external: "", at: 1, count: 6 };
const panel = (patch) => dash.relatedPeek({ ...base, ...patch });

const pdf = panel({ state: "ready", kind: "pdf", src: "blob:x", mime: "application/pdf" });
check(pdf.includes('<iframe src="blob:x"'), "a PDF should show in a frame");
check(pdf.includes('href="blob:x" download="Step 2 Validation Form: Take to Museum.pdf"'), "a loaded file should offer Download with its type's extension");
check(/<a class="btn btn-primary" href="https:\/\/kennesaw[^"]*" rel="noopener noreferrer" data-d2l-link data-confirm-title="Step 2 Validation Form: Take to Museum">Open in D2L/.test(pdf), "Open in D2L should be a D2L link, which asks Open in D2L? first");
check(pdf.includes("Museum visit · File") && !pdf.includes("Viewed"), "the header should say the module and type, and not claim it is viewed");
check(panel({ state: "ready", kind: "pdf", src: "blob:x", meta: "Museum visit · File · Viewed" }).includes("Museum visit · File · Viewed"), "the header should show the line the model gives it");
check(pdf.includes('data-action="peek-step" data-step="-1"') && pdf.includes("2 of 6") && !/data-step="(-1|1)"[^>]*disabled/.test(pdf), "the arrows and position should show, both enabled in the middle");
check(/data-step="-1"[^>]*disabled/.test(panel({ state: "page", at: 0 })) && /data-step="1"[^>]*disabled/.test(panel({ state: "page", at: 5 })), "the first item should have no previous arrow and the last no next arrow");
check(!panel({ state: "page", count: 1, at: 0 }).includes("peek-pager"), "a lone item should show no arrows");
check(!panel({ state: "loading" }).includes("download=") && panel({ state: "loading" }).includes("Opening the file…"), "a loading file should say so and offer no Download");

// Things the panel can't show say so, and still offer Open in D2L.
const word = panel({ state: "unsupported" });
check(word.includes(dash.escapeHtml("This kind of file can't be shown here. Open it in D2L to read it.")), "a Word or PowerPoint file should say it can't be shown here");
check(word.includes("data-d2l-link") && !word.includes("download="), "an unshown file should still offer Open in D2L and no Download");
check(/D2L page|page in D2L/.test(panel({ state: "page" })), "a D2L page should say what it is");
const link = panel({ state: "link", external: "https://www.youtube.com/watch?v=abc", d2lUrl: "" });
check(link.includes("This links to youtube.com") && link.includes('data-confirm-external="Step 2 Validation Form: Take to Museum"') && link.includes("Open link"), "a link with no D2L page should name the site and offer Open link through the leave-the-archive prompt");
check(panel({ state: "stale" }).includes('data-action="reload-page"'), "a stale page should offer Reload");

// Work and grades: a summary, a link to the full pop-up, no file loading.
const quiz = { mode: "summary", title: "Week 3 Quiz", icon: "quiz", meta: "Quiz · Week 3", facts: [{ k: "Due", v: "Fri, Oct 30 · 11:59 PM" }, { k: "Worth", v: "10 points" }, { k: "Status", v: "Open" }], text: "Ten questions.", d2lUrl: "https://kennesaw.view.usg.edu/d2l/lms/quizzing/user/quiz_summary.d2l?ou=9&qi=12", route: "#/quiz/quizBundle%3A9%3A12", at: 0, count: 3, state: "summary" };
const summary = dash.relatedPeek(quiz);
check(summary.includes('<div class="fact"><div class="k">Due</div><div class="v">Fri, Oct 30 · 11:59 PM</div></div>') && summary.includes(">Worth<") && summary.includes(">Status<"), "a quiz summary should list Due, Worth and Status");
check(summary.includes('<p class="peek-text">Ten questions.</p>') && summary.includes("Quiz · Week 3"), "a quiz summary should show its description and where it sits");
check(summary.includes('<a class="btn" href="#/quiz/quizBundle%3A9%3A12">Open full page</a>') && summary.includes("data-d2l-link") && !summary.includes("download=") && !summary.includes("viewer-body"), "a summary should link to the full pop-up and D2L, and show no file frame");
check(dash.relatedPeek({ ...quiz, text: "", facts: [], d2lUrl: "" }).includes("No description.") && !dash.relatedPeek({ ...quiz, d2lUrl: "" }).includes("Open in D2L"), "a summary with no description or D2L link should say so and offer only the full page");
check(!panel({ state: "page" }).includes("Open full page"), "a content item should not offer a full page");

// Titles are escaped everywhere.
const evil = panel({ title: '<img src=x onerror=alert(1)>', state: "page" });
check(!evil.includes("<img src=x") && evil.includes("&lt;img src=x"), "a topic title with markup should be escaped");

// The panel is a dialog with a labelled close button, over a scrim that closes it.
check(pdf.includes('<div class="peek-scrim" data-action="close-peek"></div>') && pdf.includes('role="dialog" aria-modal="true"') && pdf.includes('aria-label="Close preview"'), "the panel should be a dialog with a scrim and a close button");

// Wiring.
const css = read("src/dashboard/dashboard.css");
const preview = read("src/dashboard/app-preview.js");
const events = read("src/dashboard/app-events.js");
const render = read("src/dashboard/app-render.js");
check(/\.detail-panel \{ position: relative;/.test(css) && /#related-peek \{ position: absolute; inset: 54px 0 0; z-index: 30; \}/.test(css), "the panel should sit inside the pop-up, under its header");
check(/\.peek \{[^}]*width: 48%;/.test(css) && /\.rel-pill\.sel \{/.test(css) && /@media \(max-width: 760px\) \{ \.peek \{ width: 100%; \} \}/.test(css), "the panel should take about half the pop-up, the open pill should stay lit, and a narrow screen should fill it");
check(!/\.rel-tip-(facts|foot|body|title|meta)|\.rel-chip/.test(css), "the old rich hover card styles should be gone");
check(css.includes(".rel:has(:focus-visible) .rel-tip") && !css.includes(".rel:focus-within .rel-tip"), "closing the panel hands focus back to the pill, which should not pop its hover tip unless the keyboard is in use");
check(/#related-peek\.open \.peek, #related-peek\.open \.peek-scrim \{ animation: none; \}/.test(css) && preview.includes('node.classList.toggle("open", !fresh)'), "the panel should slide in once; loading a file or stepping should swap its contents without replaying the slide");
check(preview.includes("async function loadFile") && preview.includes("const shown = await loadFile(base);") && preview.includes("await loadFile({ ...item, name: \"\" })"), "the panel and the Content screen's viewer should share one file loader");
check(preview.includes("part.inert = true") && preview.includes("part.inert = false"), "the pop-up behind the panel should be inert while it is open");
check(preview.includes("state.peek?.ticket !== ticket") && preview.includes("URL.revokeObjectURL"), "a slow load should not replace a newer item, and old file URLs should be released");
check(preview.includes('item.external ? "link" : "page"') && preview.includes("isD2lFileUrl(item.downloadUrl)") && preview.includes('if (item.mode === "summary") return "summary";'), "only a D2L file or a saved copy should be loaded; summaries and the rest are described");
check(events.includes('action === "peek-item"') && events.includes('action === "peek-step"') && events.includes('action === "close-peek"'), "the pill, the arrows and the scrim should be wired");
check(/if \(state\.peek\) \{\s*event\.preventDefault\(\);\s*closePeek\(\);\s*return;\s*\}/.test(events), "Esc should close the panel before the pop-up");
check(events.includes('state.peek ? document.getElementById("related-peek")'), "Tab should stay inside the panel while it is open");
check(render.includes("closePeek({ restoreFocus: false })") && render.includes("titleOf() !== shown"), "closing the pop-up or moving to another item should close the panel");
check(read("src/dashboard/app-state.js").includes("peek: null"), "the panel's state should start empty");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Related pills open a side panel that summarizes work, shows files, explains the rest, and closes on Esc without closing the pop-up.");
