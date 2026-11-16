import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Voice mode hears the microphone and speaks answers. Nothing it hears or says leaves this computer,
// and no sound is kept. These are the files it is made of; each is read with its comments removed.
const root = new URL("..", import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full); else if (entry.name.endsWith(".js")) files.push(full);
  }
})(path.join(root, "src/dashboard/voice"));
files.push(path.join(root, "src/dashboard/ask/response/phonon-playback.js"));
assert.ok(files.length >= 9, "the voice files were found");

const code = (file) => fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const name = (file) => path.relative(path.join(root, "src/dashboard"), file);
const worker = path.join(root, "src/dashboard/voice/listen/listen-worker.js");

for (const file of files) {
  const text = code(file);
  assert.ok(!/https?:\/\//.test(text), `${name(file)} names no web address`);
  assert.ok(!/XMLHttpRequest|WebSocket|sendBeacon|EventSource|RTCPeerConnection|navigator\.share/.test(text), `${name(file)} has no way to send anything out`);
  assert.ok(!/MediaRecorder|indexedDB|localStorage|sessionStorage|chrome\.storage|createObjectURL|new Blob|\.download\b/.test(text), `${name(file)} records and keeps no sound`);
  if (file !== worker) assert.ok(!/\bfetch\s*\(|importScripts/.test(text.replace("importRuntime(fileUrl(RUNTIME))", "")), `${name(file)} loads nothing itself`);
}

// The listening worker reads its runtime and its model, and only from this extension's own address.
const text = code(worker);
const fetches = [...text.matchAll(/\bfetch\s*\(([^)]*)\)/g)].map((found) => found[1]);
assert.equal(fetches.length, 2, "it reads the model and its word list");
assert.ok(fetches.every((use) => use.startsWith("`${base}${MODEL}")), "both reads are of files inside the extension");
const imports = [...text.matchAll(/\bimport\s*\(([^)]*)\)/g)].map((found) => found[1]);
assert.deepEqual(imports, ["`${base}${ORT}ort.wasm.min.mjs`"], "it loads only the bundled runtime");
assert.deepEqual([...text.matchAll(/importScripts\(([^)]*)\)/g)].map((found) => found[1]), ['"eou-engine.js"']);

console.log("Voice local-only checks passed: nothing is sent out, no sound is kept.");
