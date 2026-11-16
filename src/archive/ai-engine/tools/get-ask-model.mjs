// Downloads the models the extension runs into models/, so it can load them from its own folder.
//
//   node tools/get-ask-model.mjs [models-dir] [--voice]
//
// Always: the model Ask runs (LFM3-1.7B, ONNX, 4-bit weights, about 1.4 GB) into models/LiquidAI/LFM3-1.7B-ONNX/.
// --voice: also the model voice mode listens with (NVIDIA Parakeet-Realtime-EOU-120M, int8, about 194 MB, under the
// NVIDIA Open Model License) into models/parakeet-eou/, with its license and notice. Each of those files is checked
// against its SHA-256 (see models/parakeet-eou/README.md) and a file that does not match is not kept.
//
// Files already on disk at the right size are skipped, so it is safe to run again.
// This is the only thing in the project that downloads the models; the extension
// itself never goes online for them.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const models = path.resolve(args.find((arg) => !arg.startsWith("--")) || path.join(root, "models"));
const sets = [{
  target: path.join(models, "LiquidAI/LFM3-1.7B-ONNX"),
  base: "https://huggingface.co/LiquidAI/LFM3-1.7B-ONNX/resolve/main",
  files: ["config.json", "generation_config.json", "tokenizer_config.json", "chat_template.jinja", "tokenizer.json", "onnx/model_q4f16.onnx", "onnx/model_q4f16.onnx_data"].map((name) => ({ name }))
}];
if (args.includes("--voice")) sets.push({
  target: path.join(models, "parakeet-eou"),
  base: "https://huggingface.co/imbcmdth/parakeet-realtime-eou-120m-onnx/resolve/main",
  files: [
    { name: "parakeet_realtime_eou_120m.int8.onnx", sha256: "7dbdf3e4f539a78819c71d1fc8c0aaf0be8d34417661a16e643cd47e17c319fd" },
    { name: "vocab.txt", sha256: "8fe6871fa1df0813fee690d5e5ba8dfd7a66f028b12fce32ab7d51a1d1704e6f" },
    { name: "LICENSE", sha256: "65e8ba6069b1263ce3a473e2e466a07e68c8d85c6b4c3805616eb3e357af1008" },
    { name: "NOTICE", sha256: "5fc60716a9ba57f3792e71ed776b4065671c64d0c2db716698f4d646ad833eb1" }
  ]
});

const hashOf = async (file) => { const hash = crypto.createHash("sha256"); await pipeline(fs.createReadStream(file), hash); return hash.digest("hex"); };

for (const { target, base, files } of sets) {
  for (const { name, sha256 } of files) {
    const destination = path.join(target, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const response = await fetch(`${base}/${name}`);
    if (!response.ok) throw new Error(`${name}: the download answered ${response.status}`);
    const size = Number(response.headers.get("content-length")) || 0;
    if (size && fs.existsSync(destination) && fs.statSync(destination).size === size) {
      await response.body.cancel();
      console.log(`have  ${name}`);
      continue;
    }
    console.log(`get   ${name}${size ? `  ${(size / 1e6).toFixed(0)} MB` : ""}`);
    // Written under a temporary name, so a stopped download never leaves a half file where the extension looks.
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(`${destination}.part`));
    if (sha256 && (await hashOf(`${destination}.part`)) !== sha256) {
      fs.rmSync(`${destination}.part`);
      throw new Error(`${name}: what came down is not the expected file (SHA-256 differs), so it was thrown away`);
    }
    fs.renameSync(`${destination}.part`, destination);
  }
  console.log(`Done. The model is in ${target}`);
}
