// Ask's answers as Markdown (src/dashboard/ask/answer-markdown.js): tables, headings,
// lists and code show as they should, and nothing the model writes can become a script,
// a picture fetched from the web, or a link that runs code.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { loadDashboard } from "./test-dashboard-loader.mjs";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dash = loadDashboard();
const md = (text, live = false) => dash.askAnswerMarkdownHtml(text, { live });

// ---- what an answer can show ---------------------------------------------------------------
const table = md("| Item | Due |\n|---|---|\n| Lab 4 | Fri 11:59 PM |\n| Quiz 3 | Sun |");
check(/^<div class="ask-table"><table>/.test(table) && table.includes("<th>Item</th>") && table.includes("<td>Lab 4</td>") && table.includes("<td>Sun</td>"), "a table becomes a real table, in a box that can scroll sideways");
check(md("### Due this week").includes("<h3>Due this week</h3>"), "a heading becomes a heading");
check(md("1. Lab 4\n2. Quiz 3").includes("<ol>\n<li>Lab 4</li>") && md("- Lab 4\n* Quiz 3").includes("<li>Lab 4</li>"), "numbered and bulleted lists become lists");
check(md("```\nlet x = 1;\n```").includes("<pre><code>let x = 1;\n</code></pre>") && md("Run `node a.js`").includes("<code>node a.js</code>"), "code shows as code");
check(md("**Lab 4** and *Quiz 3* and ~~old~~").includes("<strong>Lab 4</strong> and <em>Quiz 3</em> and <s>old</s>"), "bold, italics and strikethrough show");
check(md("Lab 4: Friday\nQuiz 3: Sunday") === "<p>Lab 4: Friday<br>\nQuiz 3: Sunday</p>\n", "a single new line stays a new line, as the model writes its lists of dates");

// ---- nothing in an answer becomes markup, a picture or a risky link ------------------------
const raw = md(`<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n<a href="https://x.edu">x</a>`);
check(!/<script|<img|<a /.test(raw) && raw.includes("&lt;script&gt;") && raw.includes("&lt;img src=x onerror=alert(1)&gt;"), "HTML in an answer shows as text");
check(!md("![chart](https://tracker.example/pixel.png)").includes("<img"), "a picture in an answer is never loaded (it would be a request leaving this computer)");
for (const href of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "vbscript:x", "chrome-extension://abc/x.html", "#/settings"]) {
  check(!md(`[open](${href})`).includes("<a"), `a link to ${href} stays text`);
}
const link = md("[syllabus](https://kennesaw.view.usg.edu/d2l/home) or [mail](mailto:prof@kennesaw.edu)");
check(link.includes('<a href="https://kennesaw.view.usg.edu/d2l/home" target="_blank" rel="noopener noreferrer">syllabus</a>') && link.includes('href="mailto:prof@kennesaw.edu"'), "web and mail links open in a new tab, after the dashboard's leaving-the-archive check");
check(!md("see https://x.edu").includes("<a"), "a bare address is not turned into a link");

// ---- an answer still being written ---------------------------------------------------------
check(md("Lab 4 is **due Fri", true) === "<p>Lab 4 is **due Fri</p>\n", "before remend has loaded, a half-written answer still renders, just unclosed");
dash.askCloseMarks = (await import(path.join(root, "src/vendor/remend/index.js"))).default;
const half = md("Lab 4 is **due Fri", true);
check(half.includes("<strong>due Fri</strong>") && !half.includes("**"), "half-written bold shows as bold, with no stray stars");
const halfLink = md("See [the syllabus](https://kennesaw.view", true);
check(!halfLink.includes("<a") && !halfLink.includes("streamdown") && halfLink.includes("the syllabus"), "a half-written link shows only its words, with no made-up address");
check(md("Use `node a", true).includes("<code>node a</code>"), "half-written code shows as code");
check(md("It costs $5 and $10", true).includes("$5 and $10"), "dollar signs are money, not math");
check(md("Lab 4 is **due Fri").includes("**due Fri"), "a finished answer is not closed up: it is shown as written");

// ---- in the chat ---------------------------------------------------------------------------
const base = { engineState: "ready", reason: "", progress: 0, messages: [], busy: false, status: "", reading: { state: "ready", passages: 12, courses: 2 } };
const thread = dash.askThreadHtml({ ...base, messages: [{ role: "user", text: "| a | b |\n|---|---|\n| 1 | 2 |" }, { role: "assistant", text: "| a | b |\n|---|---|\n| 1 | 2 |", usedArchive: true }] });
check((thread.match(/<table>/g) || []).length === 1 && thread.includes('class="ask-bubble">| a | b |'), "only answers are read as Markdown; your message shows as typed");
const live = dash.askLiveHtml({ ...base, busy: true, live: { trace: [], answer: "- **Lab" } });
check(live.includes('class="ask-bubble ask-answer"') && live.includes("<li><strong>Lab</strong></li>"), "the answer being written is shown as Markdown too, closed as it goes");

// ---- if the library were missing, answers still show as plain text --------------------------
const bare = vm.createContext({ D2LDashboard: { escapeHtml: dash.escapeHtml } });
vm.runInContext(fs.readFileSync(path.join(root, "src/dashboard/ask/answer-markdown.js"), "utf8"), bare);
check(bare.D2LDashboard.askAnswerMarkdownHtml("<b>Lab</b>\nQuiz") === "<p>&lt;b&gt;Lab&lt;/b&gt;<br>Quiz</p>", "without markdown-it an answer is escaped text with its line breaks");

// ---- the libraries load from inside the extension, the first time Ask opens -----------------
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
check(html.indexOf("src/dashboard/ask/answer-markdown.js") > 0 && html.indexOf("src/dashboard/ask/answer-markdown.js") < html.indexOf("src/dashboard/render-ask.js") && !html.includes("markdown-it") && !html.includes("remend"), "the answer setup loads before the Ask screen; the libraries are not loaded with the dashboard");
for (const file of Object.values(dash.ASK_MARKDOWN_LIBRARIES)) check(fs.existsSync(path.join(root, file)), `Ask loads ${file} from inside the extension, and it is there`);
check(/async function mounted\(\) \{\n\s+life\.stay\(\);\n\s+dash\.askLoadAnswerMarkdown\(\)\.then\(\(\) => refresh\(\)/.test(fs.readFileSync(path.join(root, "src/dashboard/app-ask.js"), "utf8")), "the libraries load when Ask opens, and the chat is redrawn as Markdown once they have");
const readme = fs.readFileSync(path.join(root, "src/vendor/README.md"), "utf8");
for (const file of ["markdown-it/markdown-it.umd.min.js", "remend/index.js"]) {
  check(readme.includes(`\`${file}\``) && fs.existsSync(path.join(root, "src/vendor", path.dirname(file), "LICENSE")), `${file} is listed in src/vendor/README.md with its license beside it`);
}

if (failures.length) {
  console.error(failures.map((message) => `FAIL: ${message}`).join("\n"));
  process.exit(1);
}
console.log("Ask Markdown tests passed.");
