import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const contract = JSON.parse(fs.readFileSync(path.join(repoRoot, "refactor-baseline-contract.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
const content = fs.readFileSync(path.join(repoRoot, "content.js"), "utf8");
const background = fs.readFileSync(path.join(repoRoot, "background.js"), "utf8");
const backgroundSupport = [...background.matchAll(/"(src\/(?:shared|background)\/[^"\n]+\.js)"/g)]
  .map((match) => fs.readFileSync(path.join(repoRoot, match[1]), "utf8"))
  .join("\n");
const contentSupport = manifest.content_scripts[0].js
  .filter((file) => file !== "content.js")
  .map((file) => fs.readFileSync(path.join(repoRoot, file), "utf8"))
  .join("\n");
const sharedConstants = fs.readFileSync(path.join(repoRoot, "src/shared/constants.js"), "utf8");
const popup = fs.readFileSync(path.join(repoRoot, "popup.js"), "utf8");
const popupHtml = fs.readFileSync(path.join(repoRoot, "popup.html"), "utf8");
const popupSupport = [...popupHtml.matchAll(/<script\s+src="([^"]+\.js)"/g)]
  .map((match) => fs.readFileSync(path.join(repoRoot, match[1]), "utf8"))
  .join("\n");
const runtimeSource = `${contentSupport}\n${content}\n${backgroundSupport}\n${background}\n${popupSupport}\n${popup}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version), `Invalid current extension version ${manifest.version}`);

for (const message of contract.messages) {
  assert(runtimeSource.includes(message), `Missing compatibility message ${message}`);
}

let previousColumnIndex = -1;
for (const column of contract.csvColumns) {
  const columnIndex = sharedConstants.indexOf(`\"${column}\"`);
  assert(columnIndex > previousColumnIndex, `CSV column ${column} is missing or out of order`);
  previousColumnIndex = columnIndex;
}

for (const fileName of contract.requiredArchiveFiles) {
  assert(runtimeSource.includes(fileName), `Missing archive output contract ${fileName}`);
}

const requiredSources = new Set(
  Object.values(contract.capabilityEvidence).flatMap((evidence) => evidence.requiredSources || [])
);
for (const source of requiredSources) {
  assert(runtimeSource.includes(source), `Missing extraction source contract ${source}`);
}

const baselinePackagePath = path.resolve(repoRoot, contract.baselinePackage);
if (fs.existsSync(baselinePackagePath)) {
  const packageSha256 = crypto.createHash("sha256").update(fs.readFileSync(baselinePackagePath)).digest("hex");
  assert(packageSha256 === contract.baselinePackageSha256, "Baseline package checksum changed");
} else {
  console.log(`Baseline package not present at ${baselinePackagePath}; checksum check skipped.`);
}

console.log("Refactor baseline contract tests passed.");
