import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const context = vm.createContext({ Float32Array, BigInt64Array, BigInt, console });
for (const file of ["src/dashboard/voice/listen/eou-engine.js", "src/dashboard/voice/listen/listen-stream.js"]) vm.runInContext(read(file), context);
const dash = context.D2LDashboard;

// ---- the listening model, with a stand-in for the runtime ----
class Tensor { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } }
const STATES = ["audio_cache", "mel_cache", "cache_last_channel", "cache_last_time", "cache_last_channel_len", "pred_h", "pred_c", "last_token"];
const vocabText = "<blank>\n▁what\n▁is\n▁due\nmor\n";
function fakeSession(replies) {
  const runs = [];
  return {
    runs,
    async run(inputs) {
      const reply = replies[runs.length] || [];
      runs.push(inputs);
      const out = { tokens: new Tensor("int64", BigInt64Array.from(reply.map(BigInt)), [reply.length]), num_tokens: new Tensor("int64", BigInt64Array.from([BigInt(reply.length)]), [1]) };
      for (const name of STATES) out[`${name}_out`] = new Tensor("float32", new Float32Array([runs.length]), [1]);
      return out;
    }
  };
}

const session = fakeSession([[1, 2], [3, 4, 1024], [1025], [], [99]]);
const engine = dash.createEouEngine({ ort: { Tensor }, session, vocabText });
const piece = () => new Float32Array(2560);

assert.deepEqual(JSON.parse(JSON.stringify(await engine.run(piece()))), { words: ["▁what", "▁is"], ended: false });
const first = session.runs[0];
assert.equal(first.audio.dims[0], 2560);
assert.equal(first.last_token.data[0], 1026n, "it starts from the blank token");
assert.equal(first.cache_last_channel_len.data[0], 0n);
assert.ok(first.mel_cache.data.every((value) => value === Math.fround(Math.log(Math.fround(2 ** -24)))), "the sound memory starts as silence");

assert.deepEqual(JSON.parse(JSON.stringify(await engine.run(piece()))), { words: ["▁due", "mor"], ended: true }, "an end marker is told apart from words");
for (const name of STATES) assert.equal(session.runs[1][name].data[0], 1, `${name} carries from one piece to the next`);

assert.deepEqual(JSON.parse(JSON.stringify(await engine.run(piece()))), { words: [], ended: true }, "an end of break counts as an end");
assert.deepEqual(JSON.parse(JSON.stringify(await engine.run(piece()))), { words: [], ended: false });
assert.deepEqual(JSON.parse(JSON.stringify(await engine.run(piece()))), { words: [], ended: false }, "a token that is not in the word list is skipped");

engine.reset();
await engine.run(piece());
assert.equal(session.runs[5].pred_h.data.length, 640);
assert.equal(session.runs[5].last_token.data[0], 1026n, "reset starts a new utterance");
assert.equal(session.runs[5].audio_cache.data[0], 0);

await assert.rejects(() => engine.run(new Float32Array(100)), /2560 samples/);

const warmSession = fakeSession([]);
const warmed = dash.createEouEngine({ ort: { Tensor }, session: warmSession, vocabText });
await warmed.warm();
await warmed.run(piece());
assert.equal(warmSession.runs.length, 2);
assert.equal(warmSession.runs[1].last_token.data[0], 1026n, "warming up leaves no memory behind");
assert.equal(warmSession.runs[1].audio_cache.data[0], 0);

// ---- the page's side of the worker ----
const workers = [];
class FakeWorker {
  constructor(url) { this.url = url; this.sent = []; this.terminated = false; workers.push(this); }
  postMessage(message, transfer) { this.sent.push({ message, transfer }); }
  terminate() { this.terminated = true; }
  say(data) { this.onmessage?.({ data }); }
}
const listener = dash.createListenStream({ fileUrl: (path) => `chrome-extension://test/${path}`, createWorker: (url) => new FakeWorker(url) });

await assert.rejects(() => listener.feed(piece()), /not loaded/);
const loading = listener.load();
assert.equal(listener.load(), loading, "two loads share one worker");
assert.equal(workers.length, 1);
assert.equal(workers[0].url, "chrome-extension://test/src/dashboard/voice/listen/listen-worker.js");
assert.deepEqual(JSON.parse(JSON.stringify(workers[0].sent[0].message)), { type: "load", base: "chrome-extension://test/" });
assert.equal(listener.ready, false);
workers[0].say({ type: "ready", seconds: 1 });
await loading;
assert.equal(listener.ready, true);
await listener.load();
assert.equal(workers.length, 1, "a loaded listener is not loaded again");

const a = piece(), b = piece();
const one = listener.feed(a), two = listener.feed(b);
const [sentA, sentB] = workers[0].sent.slice(1);
assert.equal(sentA.message.type, "piece");
assert.equal(sentA.message.audio, a);
assert.equal(sentA.transfer.length, 1);
assert.equal(sentA.transfer[0], a.buffer, "the piece is handed over, not copied");
assert.notEqual(sentA.message.id, sentB.message.id);
workers[0].say({ type: "heard", id: sentB.message.id, words: ["▁is"], ended: true });
workers[0].say({ type: "heard", id: sentA.message.id, words: ["▁what"], ended: false });
assert.deepEqual(JSON.parse(JSON.stringify(await two)), { words: ["▁is"], ended: true }, "each piece gets its own answer");
assert.deepEqual(JSON.parse(JSON.stringify(await one)), { words: ["▁what"], ended: false });

const broken = listener.feed(piece());
workers[0].say({ type: "error", id: workers[0].sent.at(-1).message.id, message: "bad piece" });
await assert.rejects(() => broken, /bad piece/);
assert.equal(listener.ready, true, "one bad piece does not stop listening");

listener.reset();
assert.deepEqual(JSON.parse(JSON.stringify(workers[0].sent.at(-1).message)), { type: "reset" });

const stranded = listener.feed(piece());
listener.dispose();
await assert.rejects(() => stranded, /Listening stopped/);
assert.equal(workers[0].terminated, true);
assert.equal(listener.ready, false);
listener.reset();
assert.equal(workers[0].sent.at(-1).message.type, "piece", "nothing is sent to a stopped worker");

// loading again after a stop starts a fresh worker; a worker that fails to load is dropped
const again = listener.load();
assert.equal(workers.length, 2);
workers[1].say({ type: "error", message: "model missing" });
await assert.rejects(() => again, /model missing/);
assert.equal(workers[1].terminated, true);
const third = listener.load();
workers[2].onerror({ message: "script failed" });
await assert.rejects(() => third, /script failed/);

// ---- the worker file: it answers one message at a time, and says so when it was not loaded ----
const posted = [];
const worker = vm.createContext({ Float32Array, console, performance, importScripts: (file) => { assert.equal(file, "eou-engine.js"); vm.runInContext(read("src/dashboard/voice/listen/eou-engine.js"), worker); }, postMessage: (message) => posted.push(message) });
vm.runInContext(read("src/dashboard/voice/listen/listen-worker.js"), worker);
worker.onmessage({ data: { type: "piece", id: 7, audio: piece() } });
worker.onmessage({ data: { type: "reset" } });
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(posted[0].type, "error");
assert.equal(posted[0].id, 7);
assert.match(posted[0].message, /not been loaded/);
assert.equal(posted.length, 2, "an error for the reset too, since nothing is loaded");

console.log("Voice listening: model pieces, memory, reset, worker messages and cleanup passed.");
