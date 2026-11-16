import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// The files voice mode listens with: their licenses sit beside them, they are the files that were checked,
// the download tool knows their checksums, and the store package leaves them out.
const root = new URL("..", import.meta.url).pathname;
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const sha = (...parts) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, ...parts))).digest("hex");

// The listening runtime: onnxruntime-web 1.31.1, MIT, copied unchanged.
const RUNTIME = {
  "ort.wasm.min.mjs": ["c21d9c326d453a4a61398270c804d5979e118540597cb0c07f7b3d64e6098234", 53725],
  "ort-wasm-simd-threaded.mjs": ["30ed0b5cd1182ede931fea448afb567d4dc705ec957af09f108a2be5f770dac3", 24738],
  "ort-wasm-simd-threaded.wasm": ["4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d", 14848852]
};
const notice = read("vendor/voice-ort/NOTICE.md");
assert.ok(read("vendor/voice-ort/LICENSE").startsWith("MIT License"), "the runtime's MIT license is shipped with it");
for (const [file, [hash, size]] of Object.entries(RUNTIME)) {
  assert.equal(sha("vendor/voice-ort", file), hash, `${file} is the file that was checked`);
  assert.equal(fs.statSync(path.join(root, "vendor/voice-ort", file)).size, size, `${file} is the size that was checked`);
  assert.ok(notice.includes(hash) && notice.includes(size.toLocaleString("en-US")), `the notice lists ${file} with its checksum and size`);
}

// The extension may run WebAssembly, which the runtime needs; nothing wider than that.
const csp = JSON.parse(read("manifest.json")).content_security_policy.extension_pages;
assert.ok(/script-src 'self' 'wasm-unsafe-eval'(;|$)/.test(csp), "pages may run WebAssembly and nothing else is let in");
assert.ok(!/unsafe-eval'(?!;)|unsafe-inline|https?:/.test(csp.replace("'wasm-unsafe-eval'", "")), "the page rules name no web address and allow no inline code");

// The listening model: its license and notice come with it, and the download tool checks every file.
const MODEL = {
  "parakeet_realtime_eou_120m.int8.onnx": [194020988, "7dbdf3e4f539a78819c71d1fc8c0aaf0be8d34417661a16e643cd47e17c319fd"],
  "vocab.txt": [5207, "8fe6871fa1df0813fee690d5e5ba8dfd7a66f028b12fce32ab7d51a1d1704e6f"],
  "LICENSE": [10378, "65e8ba6069b1263ce3a473e2e466a07e68c8d85c6b4c3805616eb3e357af1008"],
  "NOTICE": [67, "5fc60716a9ba57f3792e71ed776b4065671c64d0c2db716698f4d646ad833eb1"]
};
const tool = read("tools/get-ask-model.mjs");
const modelNote = read("models/parakeet-eou/README.md");
for (const [file, [size, hash]] of Object.entries(MODEL)) {
  assert.ok(tool.includes(hash), `the download tool checks ${file}`);
  assert.ok(modelNote.includes(hash) && modelNote.includes(size.toLocaleString("en-US")), `the model note lists ${file} with its checksum and size`);
}
assert.ok(/--voice/.test(tool) && /sha256 &&/.test(tool) && /rmSync/.test(tool), "a downloaded file that does not match is thrown away");
assert.ok(/Licensed by NVIDIA Corporation under the NVIDIA Open Model License/.test(read("models/parakeet-eou/NOTICE")), "the notice carries the line the agreement asks for");
assert.ok(/NVIDIA Open Model License Agreement/.test(read("models/parakeet-eou/LICENSE")), "the agreement is shipped beside the model");
assert.ok(/read the agreement again|Read the agreement again/i.test(modelNote), "the model note tells whoever publishes this to read the agreement again");

// When the model files are on this computer they are the ones that were checked.
const present = path.join(root, "models/parakeet-eou/parakeet_realtime_eou_120m.int8.onnx");
if (fs.existsSync(present)) {
  for (const [file, [size, hash]] of Object.entries(MODEL)) {
    assert.equal(fs.statSync(path.join(root, "models/parakeet-eou", file)).size, size, `${file} is the size that was checked`);
    assert.equal(sha("models/parakeet-eou", file), hash, `${file} is the file that was checked`);
  }
}

// The speaking voice: Maeve (Phonon voice catalog, Apache-2.0), a voice file in the layout the model reads, also named in the notice.
const MAEVE = ["56494ee67d533ad227ff0dfd0b1c13ff5aa91f1ad6e596e66c2986ba3005e844", 256136];
assert.equal(sha("models/phonon-31m-en/maeve-voice.safetensors"), MAEVE[0], "maeve-voice.safetensors is the file that was checked");
assert.equal(fs.statSync(path.join(root, "models/phonon-31m-en/maeve-voice.safetensors")).size, MAEVE[1]);
assert.ok(read("vendor/phonon-tts/NOTICE.md").includes(MAEVE[0]) && /Maeve/.test(read("vendor/phonon-tts/NOTICE.md")), "the notice credits the voice");
assert.ok(fs.existsSync(path.join(root, "models/phonon-31m-en/default-voice.safetensors")), "the model's own voice stays as the fallback");

// Speech source and local models remain available for restoring the archived feature.
const page = read("dashboard.html");
assert.ok(fs.existsSync(path.join(root, "src/dashboard/voice/voice-mode.js")), "the live voice source remains on disk");
assert.ok(fs.existsSync(path.join(root, "src/dashboard/ask/response/phonon-playback.js")), "the read-aloud source remains on disk");
assert.ok(fs.existsSync(path.join(root, "src/archive/speech/ask-response-actions.js")), "the previous read-aloud action wiring is archived locally");
assert.ok(!/src\/dashboard\/voice\//.test(page) && !/phonon-playback\.js/.test(page), "dashboard.html does not load archived speech modules");

// The store package excludes both speech implementations while retaining their local files.
const packed = spawnSync(process.execPath, [path.join(root, "tools/package.mjs"), "--dry-run"], { encoding: "utf8" });
assert.equal(packed.status, 0, "the package list can be made");
assert.ok(/would be zipped/.test(packed.stdout), "the package list says what it would zip");
assert.ok(!/models\/parakeet|vendor\/voice-ort|src\/dashboard\/voice\//.test(packed.stdout), "the listening runtime, model and UI code are not packaged");
assert.ok(!/phonon-playback|vendor\/phonon-tts|models\/phonon-31m-en/.test(packed.stdout), "the read-aloud code, runtime and model are not packaged");
assert.ok(!/vendor\/ask-runtime|models\/LiquidAI/.test(packed.stdout), "Ask's separate model runtime and model remain outside the package");

console.log("voice files: ok");
