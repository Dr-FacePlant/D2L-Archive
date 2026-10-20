import { loadBackgroundHooks } from "./test-production-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
const { contentScriptFiles } = loadBackgroundHooks();
const files = contentScriptFiles(manifest);

if (files.length !== manifest.content_scripts[0].js.length) {
  throw new Error("Fallback injector did not preserve the complete content-script list");
}
if (files[0] !== "src/shared/constants.js" || files.at(-1) !== "content.js") {
  throw new Error(`Fallback injector order is invalid: ${JSON.stringify(files)}`);
}

console.log("Content-script fallback injection tests passed.");
