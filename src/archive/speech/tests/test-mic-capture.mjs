// Voice mode's microphone (src/dashboard/voice/mic-capture.js and mic-worklet.js): asks for a mono
// microphone, opens it at 16 kHz, hands over 160 ms pieces, says why it could not start, and
// lets go of the microphone on stop, on a stop mid-prompt and when the device goes away.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (file) => fs.readFileSync(new URL(`../src/dashboard/voice/${file}`, import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve));

// ---- the worklet: 128-sample blocks in, 2560-sample pieces out -----------------------------------
{
  let Processor = null;
  const registered = {};
  const context = vm.createContext({ Float32Array, AudioWorkletProcessor: class { constructor() { this.port = { posted: [], postMessage: (data) => this.port.posted.push(data) }; } }, registerProcessor: (name, cls) => { registered[name] = cls; } });
  vm.runInContext(read("mic-worklet.js"), context);
  Processor = registered["d2l-mic-pieces"];
  assert.ok(Processor, "the worklet registers d2l-mic-pieces");
  const node = new Processor();
  let next = 0;
  const block = (size) => { const data = new Float32Array(size); for (let i = 0; i < size; i += 1) data[i] = (next++ % 1000) / 1000; return [[data]]; };
  for (let i = 0; i < 19; i += 1) assert.equal(node.process(block(128)), true);
  assert.equal(node.port.posted.length, 0, "19 blocks (2432 samples) are not yet a piece");
  node.process(block(128));
  assert.equal(node.port.posted.length, 1);
  assert.equal(node.port.posted[0].length, 2560, "20 blocks make one piece of 2560 samples");
  assert.equal(node.port.posted[0][1], Math.fround(0.001));
  assert.equal(node.port.posted[0][2559], Math.fround((2559 % 1000) / 1000), "the samples are in order, none lost");
  node.process(block(100)); node.process(block(2600)); // odd sizes still cut at 2560
  assert.deepEqual(node.port.posted.map((piece) => piece.length), [2560, 2560], "a block that crosses the edge is split, the rest kept for the next piece");
  assert.equal(node.process([[]]), true, "a block with no input is skipped and the worklet stays alive");
  assert.equal(node.process([]), true);
}

// ---- the capture ---------------------------------------------------------------------------------
const context = vm.createContext({ Float32Array, Promise, setTimeout, queueMicrotask });
vm.runInContext(read("mic-capture.js"), context);
const dash = context.D2LDashboard;

function rig({ rate = 16000, getUserMedia, addModule } = {}) {
  const log = { asked: [], contexts: [], modules: [], tracksStopped: 0, closed: 0, states: [], messages: [], pieces: [], ended: null };
  const track = { stop() { log.tracksStopped += 1; }, addEventListener(type, fn) { if (type === "ended") log.ended = fn; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const node = { port: { onmessage: null } };
  const mediaDevices = { getUserMedia: getUserMedia || (async (constraints) => { log.asked.push(constraints); return stream; }) };
  const capture = dash.createMicCapture({
    mediaDevices,
    fileUrl: (path) => `chrome-extension://test/${path}`,
    createAudioContext: (options) => {
      const made = { options, sampleRate: rate, audioWorklet: { addModule: addModule || (async (url) => { log.modules.push(url); }) }, resume: async () => {}, createMediaStreamSource: () => ({ connect() {}, disconnect() {} }), close: async () => { log.closed += 1; } };
      log.contexts.push(made); return made;
    },
    createNode: () => node,
    onChange: (event) => { log.states.push(event.state); log.messages.push(event.message); },
    onPiece: (piece) => log.pieces.push(piece)
  });
  return { capture, log, node, track, mediaDevices };
}

// starts: mono, echo cancelling, 16 kHz, the worklet from the extension, pieces arrive, stop lets go
{
  const { capture, log, node } = rig();
  assert.equal(await capture.start(), true);
  assert.deepEqual(log.states, ["asking", "listening"]);
  assert.deepEqual(JSON.parse(JSON.stringify(log.asked[0])), { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  assert.equal(log.contexts[0].options.sampleRate, 16000);
  assert.deepEqual(log.modules, ["chrome-extension://test/src/dashboard/voice/mic-worklet.js"]);
  const piece = new Float32Array(2560);
  node.port.onmessage({ data: piece });
  assert.equal(log.pieces[0], piece, "a piece from the worklet reaches onPiece untouched");
  assert.equal(await capture.start(), true);
  assert.equal(log.asked.length, 1, "starting while listening asks the browser nothing new");
  capture.stop();
  assert.deepEqual(log.states, ["asking", "listening", "idle"]);
  assert.equal(log.tracksStopped, 1, "stop lets go of the microphone");
  assert.equal(log.closed, 1);
  assert.equal(node.port.onmessage, null, "no more pieces after stop");
  capture.stop();
  assert.equal(log.states.length, 3, "stopping twice says nothing more");
  assert.equal(await capture.start(), true, "it can start again after a stop");
  assert.equal(log.asked.length, 2);
}

// two starts at once share one request
{
  const { capture, log } = rig();
  const [a, b] = await Promise.all([capture.start(), capture.start()]);
  assert.deepEqual([a, b], [true, true]);
  assert.equal(log.asked.length, 1);
}

// why it could not start
for (const [name, state, text] of [["NotAllowedError", "blocked", /blocked/], ["SecurityError", "blocked", /blocked/], ["NotFoundError", "no-mic", /No microphone/], ["NotReadableError", "busy", /in use/], ["WeirdError", "error", /could not be started/]]) {
  const { capture, log } = rig({ getUserMedia: async () => { throw Object.assign(new Error(""), { name }); } });
  assert.equal(await capture.start(), false);
  assert.equal(log.states.at(-1), state, `${name} is ${state}`);
  assert.equal(capture.state, state);
  assert.match(log.messages.at(-1), text);
}
{
  const messages = [];
  const capture = dash.createMicCapture({ mediaDevices: undefined, onChange: (event) => messages.push(event) });
  assert.equal(await capture.start(), false);
  assert.equal(messages.at(-1).state, "unavailable");
}

// a browser that gives another sample rate: refuses clearly and lets go of the microphone
{
  const { capture, log } = rig({ rate: 48000 });
  assert.equal(await capture.start(), false);
  assert.equal(log.states.at(-1), "error");
  assert.equal(log.tracksStopped, 1, "the microphone is released when the start fails");
  assert.equal(log.closed, 1);
}
{
  const { capture, log } = rig({ addModule: async () => { throw new Error("worklet blocked"); } });
  assert.equal(await capture.start(), false);
  assert.equal(log.tracksStopped, 1);
  assert.equal(log.states.at(-1), "error");
}

// stop while the browser is still asking: the microphone that arrives late is let go
{
  let answer = null;
  const log = { stopped: 0 };
  const track = { stop() { log.stopped += 1; }, addEventListener() {} };
  const { capture } = rig({ getUserMedia: () => new Promise((resolve) => { answer = () => resolve({ getTracks: () => [track], getAudioTracks: () => [track] }); }) });
  const first = capture.start();
  assert.equal(capture.state, "asking");
  capture.stop();
  assert.equal(capture.state, "idle");
  answer();
  assert.equal(await first, false);
  assert.equal(log.stopped, 1, "a late permission does not leave the microphone open");
  assert.equal(capture.state, "idle");
}

// the device goes away or the permission is taken back mid-session
{
  const { capture, log, node } = rig();
  await capture.start();
  log.ended();
  assert.equal(capture.state, "error");
  assert.equal(log.tracksStopped, 1);
  node.port.onmessage?.({ data: new Float32Array(2560) });
  assert.equal(log.pieces.length, 0, "no pieces after the microphone is lost");
  await tick();
}

// the reason it could not start stays readable for the caller
{
  const { capture } = rig({ getUserMedia: async () => { throw Object.assign(new Error("denied"), { name: "NotFoundError" }); } });
  assert.equal(capture.message, "");
  await capture.start();
  assert.equal(capture.message, "No microphone was found.");
  capture.stop();
  assert.equal(capture.message, "", "stopping clears it");
}

console.log("Mic capture tests passed.");
