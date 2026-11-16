// Builds the in-browser model runtime that Ask loads from vendor/ask-runtime/.
//
//   node tools/build-ask-runtime.mjs <packages-dir> <output-dir>
//
// <packages-dir> is any folder where `npm install @huggingface/transformers esbuild`
// has been run. Nothing is installed into this project. The output is one script
// (Transformers.js with its WebGPU ONNX runtime bundled in) and the runtime's WASM.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [packagesArg, outArg] = process.argv.slice(2);
if (!packagesArg || !outArg) {
  console.error("usage: node tools/build-ask-runtime.mjs <packages-dir> <output-dir>");
  process.exit(1);
}
const modules = path.resolve(packagesArg, "node_modules");
const out = path.resolve(outArg);
const entry = path.join(modules, "@huggingface/transformers/dist/transformers.web.js");
const wasmFiles = ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"];
for (const file of [entry, ...wasmFiles.map((name) => path.join(modules, "onnxruntime-web/dist", name))]) {
  if (!fs.existsSync(file)) {
    console.error(`missing ${file}. Run: npm install @huggingface/transformers esbuild (in ${packagesArg})`);
    process.exit(1);
  }
}

const esbuild = await import(pathToFileURL(path.join(modules, "esbuild/lib/main.js")).href);
fs.mkdirSync(out, { recursive: true });
await esbuild.build({ entryPoints: [entry], bundle: true, format: "esm", platform: "browser", outfile: path.join(out, "transformers.bundle.js"), logLevel: "warning" });
for (const name of wasmFiles) fs.copyFileSync(path.join(modules, "onnxruntime-web/dist", name), path.join(out, name));

const version = (name) => JSON.parse(fs.readFileSync(path.join(modules, name, "package.json"), "utf8")).version;
fs.writeFileSync(path.join(out, "NOTICE.md"), `# Ask runtime

Built by tools/build-ask-runtime.mjs. Runs LFM3-1.7B inside the browser, on the GPU.

- @huggingface/transformers ${version("@huggingface/transformers")}: Apache License 2.0, https://github.com/huggingface/transformers.js
- onnxruntime-web ${version("onnxruntime-web")}: MIT License, https://github.com/microsoft/onnxruntime

The model files are not here. They go in models/, see tools/get-ask-model.mjs.
`);
for (const name of fs.readdirSync(out)) console.log(`${name}  ${(fs.statSync(path.join(out, name)).size / 1e6).toFixed(1)} MB`);
