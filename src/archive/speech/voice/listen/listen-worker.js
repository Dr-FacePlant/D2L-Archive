// Runs the listening model off the page's thread, so listening can't slow the page down.
// Messages in: { type: "load", base } | { type: "reset" } | { type: "piece", id, audio }.
// Messages out: { type: "ready", seconds } | { type: "heard", id, words, ended } | { type: "error", id?, message }.
// `base` is this extension's own address; the runtime and the model are read from there and nowhere else.
importScripts("eou-engine.js");

const ORT = "vendor/voice-ort/";
const MODEL = "models/parakeet-eou/";
let engine = null;
let queue = Promise.resolve();

async function load(base) {
  const started = performance.now();
  const missing = () => { throw new Error("The listening model files are missing from this extension. Run node tools/get-ask-model.mjs --voice, then reload it."); };
  const ort = await import(`${base}${ORT}ort.wasm.min.mjs`).catch(missing);
  ort.env.wasm.wasmPaths = `${base}${ORT}`;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const [bytes, vocabText] = await Promise.all([
    fetch(`${base}${MODEL}parakeet_realtime_eou_120m.int8.onnx`).then((reply) => (reply.ok ? reply.arrayBuffer() : missing())),
    fetch(`${base}${MODEL}vocab.txt`).then((reply) => (reply.ok ? reply.text() : missing()))
  ]).catch(missing);
  const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  engine = globalThis.D2LDashboard.createEouEngine({ ort, session, vocabText });
  await engine.warm();
  postMessage({ type: "ready", seconds: +((performance.now() - started) / 1000).toFixed(2) });
}

async function handle(data) {
  if (data.type === "load") return load(data.base);
  if (!engine) throw new Error("The listener has not been loaded.");
  if (data.type === "reset") return engine.reset();
  if (data.type === "piece") {
    const { words, ended } = await engine.run(data.audio);
    postMessage({ type: "heard", id: data.id, words, ended });
  }
}

// One message at a time: the pieces share the model's memory.
onmessage = ({ data }) => {
  queue = queue.then(() => handle(data)).catch((error) => postMessage({ type: "error", id: data.id, message: String(error?.message || error) }));
};
