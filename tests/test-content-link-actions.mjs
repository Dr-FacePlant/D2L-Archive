import { loadDashboard } from "./test-dashboard-loader.mjs";

const dash = loadDashboard();
const row = (item) => dash.resourceRow(item, "");
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const iconButtons = (html) => (html.match(/class="icon-btn"/g) || []).length;
const rowIcons = (html) => (html.match(/class="row-icon"/g) || []).length;

const external = row({
  id: "resource:course:link",
  title: "Course web link",
  type: "Link",
  icon: "link",
  external: "https://example.com/lesson",
  d2lUrl: "https://kennesaw.view.usg.edu/d2l/le/content/9900001/viewContent/1001/View"
});
check(external.startsWith("<a "), "a link row should make the whole row the link");
check(external.includes('href="https://example.com/lesson"'), "the link row should open the external link");
check(external.includes('data-confirm-external="Course web link"'), "the link row should name the destination in its prompt");
check(!external.includes("data-d2l-link"), "a link row should not add a second D2L link");
check(iconButtons(external) === 0 && rowIcons(external) === 1, "the link row should keep one decorative side icon, not a second button");

const file = row({
  id: "resource:course:file",
  title: "Reading.pdf",
  type: "File",
  icon: "file",
  localPath: "/tmp/Reading.pdf",
  d2lUrl: "https://kennesaw.view.usg.edu/d2l/le/content/9900001/viewContent/1002/View"
});
check(file.startsWith("<a "), "a saved file with a D2L original should stay a real link");
check(file.includes('href="https://kennesaw.view.usg.edu/d2l/le/content/9900001/viewContent/1002/View"'), "the saved file row should link to its D2L original for a new tab");
check(file.includes("data-file-open") && file.includes('data-path="/tmp/Reading.pdf"'), "a plain click on the saved file row should open its file chooser");
check(file.includes('data-name="Reading.pdf"') && file.includes("data-d2l="), "the file chooser should carry the file's D2L handoff");
check(!file.includes('data-action="preview-file"') && !file.includes("data-d2l-link") && iconButtons(file) === 0, "the saved file row should not keep a second preview or D2L button");
check(rowIcons(file) === 1, "the saved file row should keep one decorative side icon");

const localOnly = row({
  id: "resource:course:local",
  title: "Notes.txt",
  type: "File",
  icon: "file",
  localPath: "/tmp/Notes.txt"
});
check(localOnly.startsWith("<button "), "a saved file without a D2L original should stay one preview button");
check(localOnly.includes('data-action="preview-file"'), "the local-only file should preview directly");

const d2lOnly = row({
  id: "resource:course:topic",
  title: "Topic",
  type: "Topic",
  d2lUrl: "https://kennesaw.view.usg.edu/d2l/le/content/9900001/viewContent/1003/View"
});
check(d2lOnly.startsWith("<a "), "a D2L-only topic should make the whole row the link");
check(d2lOnly.includes("data-d2l-link") && d2lOnly.includes("viewContent/1003/View"), "a D2L-only topic should link to D2L");
check(d2lOnly.includes('data-confirm-title="Topic"'), "a D2L topic should name itself in the prompt, not the whole row");
check(!d2lOnly.includes("data-confirm-external"), "a D2L topic does not need an external-link label");
check(iconButtons(d2lOnly) === 0 && rowIcons(d2lOnly) === 1, "a D2L topic should keep one decorative side icon");

const preview = dash.filePreview({ name: "Reading.pdf", localPath: "/tmp/Reading.pdf", d2lUrl: "https://kennesaw.view.usg.edu/d2l/le/content/9900001/viewContent/1002/View" });
check(preview.includes(">Open in D2L"), "the file preview should keep a labelled D2L link");
check(/<a class="btn" href="https:\/\/kennesaw\.view\.usg\.edu\/[^"]*"[^>]*data-d2l-link>Open in D2L/.test(preview), "the D2L link in a preview should be a labelled link");

check(dash.isOutboundLink("https://example.com/lesson"), "external links leave the archive");
check(dash.isOutboundLink("https://kennesaw.view.usg.edu/d2l/home"), "D2L links leave the archive");
check(!dash.isOutboundLink("#/resources"), "dashboard routes stay in the archive");
check(!dash.isOutboundLink("mailto:help@example.com"), "mail links belong to the mail app");
check(!dash.isOutboundLink("popup.html"), "extension pages are not web destinations");

const confirm = dash.linkConfirmPanel({ title: "<Unsafe>", domain: "example.com" });
check(confirm.includes("Open this link?"), "the prompt should name the action");
check(confirm.includes("&lt;Unsafe&gt;") && confirm.includes("example.com"), "the prompt should escape and name the destination");
check(confirm.includes("in this tab") && !confirm.includes("new tab"), "a confirmed link should open in the current tab");
check(confirm.includes('data-action="close-link-confirm"') && confirm.includes('data-action="confirm-link"'), "the prompt should offer cancel and open");

const d2lConfirm = dash.linkConfirmPanel({ title: "Topic", domain: "kennesaw.view.usg.edu", kind: "d2l" });
check(d2lConfirm.includes("Open in D2L?"), "the D2L prompt should name D2L");
check(d2lConfirm.includes("D2L course site"), "the D2L prompt should name the destination kind");
check(d2lConfirm.includes("Open in D2L"), "the D2L prompt should have a D2L action");

const fileChooser = dash.fileOpenPanel({ name: "Reading.pdf" });
check(fileChooser.includes("How do you want to open this file?"), "the saved file chooser should ask what to do");
check(fileChooser.includes("Reading.pdf") && fileChooser.includes("Saved in your archive"), "the chooser should name the saved file");
check(fileChooser.includes('data-action="preview-confirmed-file"'), "the chooser should offer the saved copy");
check(fileChooser.includes('data-action="open-confirmed-d2l"'), "the chooser should offer the D2L original");
check(fileChooser.includes('data-action="close-link-confirm"'), "the chooser should offer cancel");

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Content rows are one whole-row control; outbound links confirm in this tab; saved files offer preview or D2L.");
