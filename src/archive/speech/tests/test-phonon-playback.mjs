import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ AbortController, Float32Array, console });
vm.runInContext(fs.readFileSync(new URL("../src/dashboard/ask/response/phonon-playback.js", import.meta.url), "utf8"), context);
const dash = context.D2LDashboard;

function audio() {
  return {
    currentTime: 0, destination: {}, closed: false, buffers: [],
    resume: async () => {},
    close() { this.closed = true; return Promise.resolve(); },
    createBuffer(_channels, length, rate) { const data = new Float32Array(length); this.buffers.push(data); return { duration: length / rate, getChannelData: () => data }; },
    createBufferSource() { return { connect() {}, start() { queueMicrotask(() => this.onended()); }, stop() {} }; }
  };
}

const events = [], contexts = [], calls = [];
let disposed = 0;
const engine = { sampleRate: 24000, dispose() { disposed++; }, async *stream(text) { calls.push(text); yield new Float32Array(240); } };
const playback = dash.createPhononPlayback({
  fileUrl: (file) => `chrome-extension://test/${file}`,
  importRuntime: async (url) => ({ PhononTTS: { load: async (options) => { calls.push({ url, options }); return engine; } } }),
  createAudioContext: () => { const result = audio(); contexts.push(result); return result; },
  onChange: (event) => events.push(event.state)
});

assert.equal(await playback.play("**Hello** [class](https://example.com)"), true);
assert.equal(calls[1].trim(), "Hello class");
assert.equal(calls[0].url, "chrome-extension://test/vendor/phonon-tts/index.js");
assert.equal(calls[0].options.model.weights.f32, "chrome-extension://test/models/phonon-31m-en/model.safetensors");
assert.equal(calls[0].options.model.voices.default, "chrome-extension://test/models/phonon-31m-en/maeve-voice.safetensors", "Maeve is the voice");
assert.equal(calls[0].options.device, "cpu");
assert.equal(calls[0].options.threads, 1);
assert.equal(calls[0].options.cache, false);
assert.deepEqual(events, ["loading", "playing", "idle"]);
assert.equal(contexts[0].closed, true);
playback.dispose();
assert.equal(disposed, 1);

let finishLoad, signalLoad, canceledDisposals = 0;
const loadStarted = new Promise((resolve) => { signalLoad = resolve; });
const pendingEngine = { ...engine, dispose() { canceledDisposals++; } };
const pending = dash.createPhononPlayback({
  fileUrl: (file) => `chrome-extension://test/${file}`,
  importRuntime: async () => ({ PhononTTS: { load: () => new Promise((resolve) => { finishLoad = resolve; signalLoad(); }) } }),
  createAudioContext: audio
});
const request = pending.play("Hello");
await loadStarted;
pending.stop(); finishLoad(pendingEngine);
assert.equal(await request, false);
await Promise.resolve();
assert.equal(canceledDisposals, 1);
assert.equal(pending.state, "idle");

// ---- a talk: sentences handed in while the answer is still being written ----
const tick = () => new Promise((resolve) => setImmediate(resolve));
const makeTalker = (stream) => {
  const log = { events: [], spoken: [], contexts: [], loads: 0 };
  const voice = { sampleRate: 24000, dispose() {}, stream: (text, options) => { log.spoken.push(text); return stream(text, options); } };
  const talker = dash.createPhononPlayback({
    fileUrl: (file) => `chrome-extension://test/${file}`,
    importRuntime: async () => ({ PhononTTS: { load: async () => { log.loads++; return voice; } } }),
    createAudioContext: () => { const result = audio(); log.contexts.push(result); return result; },
    onChange: (event) => log.events.push(event.state)
  });
  return { talker, log };
};
{
  const { talker, log } = makeTalker(async function* () { yield new Float32Array(240); yield new Float32Array(240); });
  assert.equal(await talker.prepare(), true);
  assert.equal(await talker.prepare(), true);
  assert.equal(log.loads, 1, "the voice is loaded once, ahead of time");
  let playing = 0;
  const talk = talker.begin({ onPlaying: () => playing++ });
  talk.say("One.");
  await tick();
  talk.say("");
  talk.say("Two.");
  await tick();
  talk.say("Three.");
  assert.equal(await talk.end(), true);
  assert.deepEqual(log.spoken, ["One.", "Two.", "Three."], "each sentence is spoken in turn");
  assert.equal(playing, 1, "it says when the first sound starts, once");
  assert.deepEqual(log.events, ["loading", "playing", "idle"]);
  assert.equal(log.contexts.length, 1, "one audio context for the whole talk");
  assert.equal(log.contexts[0].closed, true);
}
{
  const { talker, log } = makeTalker(async function* () { yield new Float32Array(240); });
  const talk = talker.begin();
  assert.equal(await talk.end(), true, "a talk with nothing to say ends quietly");
  assert.deepEqual(log.events, ["loading", "idle"]);
}
{
  const { talker, log } = makeTalker(async function* (_text, { signal }) { await new Promise((resolve) => signal.addEventListener("abort", resolve)); });
  const talk = talker.begin();
  talk.say("Never finishes.");
  await tick();
  const ended = talk.end();
  talk.stop();
  assert.equal(await ended, false, "stopping ends the talk with false");
  assert.equal(talker.state, "idle");
  assert.equal(log.contexts[0].closed, true);
  talk.say("Too late.");
  assert.deepEqual(log.spoken, ["Never finishes."], "nothing is said after a stop");
}
{
  const { talker, log } = makeTalker(async function* () { yield new Float32Array(240); });
  const first = talker.begin();
  first.say("First.");
  const second = talker.begin();
  second.say("Second.");
  assert.equal(await first.end(), false, "a new talk replaces the one before");
  assert.equal(await second.end(), true);
  assert.deepEqual(log.spoken.filter((text) => text === "Second."), ["Second."]);
}
{
  const { talker, log } = makeTalker(async function* () { throw new Error("voice broke"); });
  const talk = talker.begin();
  talk.say("Oops.");
  assert.equal(await talk.end(), false);
  assert.equal(talker.state, "error");
  assert.equal(log.contexts[0].closed, true);
}

// If Maeve's file is not there, the model's own voice is used and nothing else changes; if neither loads, it fails as before.
{
  const tried = [];
  const loadWith = (missing) => dash.createPhononPlayback({
    fileUrl: (file) => `chrome-extension://test/${file}`,
    importRuntime: async () => ({ PhononTTS: { load: async ({ model }) => { tried.push(model.voices.default.split("/").pop()); if (missing.some((name) => model.voices.default.endsWith(name))) throw new Error("no such voice file"); return { sampleRate: 24000, dispose() {}, async *stream() { yield new Float32Array(240); } }; } } }),
    createAudioContext: audio
  });
  assert.equal(await loadWith(["maeve-voice.safetensors"]).play("Hello."), true);
  assert.deepEqual(tried, ["maeve-voice.safetensors", "default-voice.safetensors"], "the model's own voice is tried when Maeve's file is missing");
  tried.length = 0;
  assert.equal(await loadWith(["maeve-voice.safetensors", "default-voice.safetensors"]).play("Hello."), false, "with no voice at all it fails, as before");
  assert.deepEqual(tried, ["maeve-voice.safetensors", "default-voice.safetensors"]);
}

// ---- short lines that come back (voice mode's "One moment.") are made once and played again ----
{
  // The engine hands out one buffer over and over, as a real one may; what is kept must not change when it is reused.
  const shared = new Float32Array(4);
  const { talker, log } = makeTalker(async function* () { shared.fill(7); yield shared; shared.fill(0); });
  let playing = 0;
  const first = talker.begin({ onPlaying: () => playing++ });
  first.say("One moment.", { keep: true });
  assert.equal(await first.end(), true);
  assert.equal(playing, 0, "a kept line is not the answer starting");
  assert.deepEqual(log.events, ["loading", "playing", "idle"], "it is still heard");
  const second = talker.begin({ onPlaying: () => playing++ });
  second.say("One moment.", { keep: true });
  second.say("The answer.");
  assert.equal(await second.end(), true);
  assert.deepEqual(log.spoken, ["One moment.", "The answer."], "the kept line was not made again");
  assert.equal(playing, 1, "the answer starting is said once, after the kept line");
  assert.equal(log.contexts[1].buffers.length, 2, "both were played");
  assert.equal(log.contexts[1].buffers[0][0], 7, "the kept line plays as it was made");
  const third = talker.begin();
  third.say("The answer."); third.say("The answer.", { keep: false });
  assert.equal(await third.end(), true);
  assert.equal(log.spoken.filter((text) => text === "The answer.").length, 3, "lines that are not kept are made every time");
  talker.dispose();
  const fourth = talker.begin();
  fourth.say("One moment.", { keep: true });
  assert.equal(await fourth.end(), true);
  assert.equal(log.spoken.filter((text) => text === "One moment.").length, 2, "nothing is kept past the speaker");
}
{
  // A line cut off part way is not kept as if it were whole.
  let made = 0;
  const { talker, log } = makeTalker(async function* (_text, { signal }) {
    made += 1; yield new Float32Array(240);
    if (made === 1) await new Promise((resolve) => signal.addEventListener("abort", resolve));
  });
  const first = talker.begin();
  first.say("Hold on.", { keep: true });
  await tick();
  const ended = first.end(); first.stop();
  assert.equal(await ended, false);
  const second = talker.begin();
  second.say("Hold on.", { keep: true });
  assert.equal(await second.end(), true);
  assert.deepEqual(log.spoken, ["Hold on.", "Hold on."], "a stopped line is made again, not replayed short");
}

console.log("Phonon playback: local files, audio, cancellation and cleanup passed.");
