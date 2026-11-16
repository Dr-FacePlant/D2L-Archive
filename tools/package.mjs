import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dryRun = process.argv.includes("--dry-run");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const archivedSpeech = (file) =>
  file.startsWith("src/dashboard/voice/") ||
  file === "src/dashboard/ask/response/phonon-playback.js" ||
  file.startsWith("src/archive/speech/");

const shipped = (file) => {
  if (archivedSpeech(file)) return false;
  if (file.startsWith("_") || file.split("/").some((part) => part.startsWith("_"))) return false;
  if (file.startsWith("src/verify/")) return false;
  if (file === "manifest.json" || file === "README.md") return true;
  if (/^(background\.js|content\.js|popup\.(html|js|css)|dashboard\.html)$/.test(file)) return true;
  // A bundled library's license goes with it.
  if (file.startsWith("src/vendor/") && /(^|\/)LICENSE[^/]*$/.test(file)) return true;
  if (file.startsWith("src/")) return /\.(m?js|css|html)$/.test(file);
  if (file.startsWith("icons/")) return true;
  return false;
};

const tracked = spawnSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).stdout
  .split("\0")
  .filter(Boolean);

const files = [...new Set(tracked.filter(shipped))].sort();
const failures = [];

for (const file of files) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) failures.push(`${file} is listed but missing on disk`);
}
const allowed = (file) =>
  file === "manifest.json" || file === "README.md" ||
  /^(background\.js|content\.js|popup\.(html|js|css)|dashboard\.html)$/.test(file) ||
  (file.startsWith("src/") && !archivedSpeech(file)) || file.startsWith("icons/");
for (const file of files) {
  if (!allowed(file)) failures.push(`${file} should not be in the store package`);
  if (file.startsWith("_")) failures.push(`${file} has an underscore prefix`);
  if (archivedSpeech(file) || file.startsWith("vendor/phonon-tts/") || file.startsWith("models/phonon-31m-en/")) failures.push(`${file} is archived speech and must stay out of the store package`);
}
for (const forbidden of ["docs/", "tests/", "tools/"]) {
  if (files.some((file) => file.startsWith(forbidden))) failures.push(`${forbidden} must not be packaged`);
}
for (const required of ["manifest.json", "background.js", "content.js", "dashboard.html", "popup.html", "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png", "src/vendor/pdfjs/pdf.min.mjs", "src/vendor/pdfjs/pdf.worker.min.mjs", "src/vendor/pdfjs/LICENSE"]) {
  if (!files.includes(required)) failures.push(`missing required file: ${required}`);
}
if (!manifest.icons?.["128"] || !manifest.action?.default_icon?.["128"]) failures.push("manifest.json is missing 128px icons");

if (failures.length) {
  for (const failure of failures) console.error(`package: ${failure}`);
  process.exit(1);
}

const outDir = path.join(root, "dist");
const zipPath = path.join(outDir, `d2l-archive-${manifest.version}.zip`);

if (dryRun) {
  console.log(`package: ${files.length} files would be zipped to dist/d2l-archive-${manifest.version}.zip`);
  for (const file of files) console.log(`  ${file}`);
  console.log("package: dry run OK");
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(zipPath, { force: true });
const zipped = spawnSync("zip", ["-X", "-q", zipPath, ...files], { cwd: root, stdio: "inherit" });
if (zipped.status !== 0) {
  console.error("package: zip failed");
  process.exit(1);
}
const listed = spawnSync("unzip", ["-l", zipPath], { encoding: "utf8" }).stdout;
const entries = listed.split("\n").filter((line) => /^\s+\d+.*\s\S/.test(line)).length;
console.log(`package: wrote dist/d2l-archive-${manifest.version}.zip (${files.length} files, ${entries} zip entries)`);
