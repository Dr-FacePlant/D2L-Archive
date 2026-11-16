import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ AbortController, Float32Array, console, setTimeout, clearTimeout });
for (const file of ["src/dashboard/ask/response/phonon-playback.js", "src/dashboard/voice/speakable-sentences.js", "src/dashboard/voice/listen/heard-text.js", "src/dashboard/voice/voice-mode.js"]) {
  vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context);
}
const dash = context.D2LDashboard;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { const out = {}; out.promise = new Promise((resolve, reject) => Object.assign(out, { resolve, reject })); return out; };

// Everything voice mode talks to is a stand-in that the test drives by hand.
function build({ micWorks = true, quiet = { quietMs: 500 } } = {}) {
  const log = [], changes = [], timers = [];
  const mic = { starts: 0, stops: 0, message: "", start() { this.starts += 1; if (!micWorks) this.message = "No microphone was found."; return Promise.resolve(micWorks); }, stop() { this.stops += 1; } };
  const listener = { loads: 0, resets: 0, pieces: [], waiting: [], loadResult: Promise.resolve(), load() { this.loads += 1; return this.loadResult; }, reset() { this.resets += 1; }, feed(piece) { this.pieces.push(piece); const d = deferred(); this.waiting.push(d); return d.promise; } };
  const talks = [];
  const speaker = {
    prepared: 0, stops: 0, prepare() { this.prepared += 1; return Promise.resolve(true); }, stop() { this.stops += 1; },
    begin({ onPlaying }) {
      const finished = deferred();
      const talk = { said: [], ended: false, stopped: false, say(text) { this.said.push(text); }, end() { this.ended = true; return finished.promise; }, stop() { this.stopped = true; }, play() { onPlaying(); }, finish(ok = true) { finished.resolve(ok); } };
      talks.push(talk);
      return talk;
    }
  };
  const asks = [];
  const ask = { send(question, { onText }) { const d = deferred(); asks.push({ question, write: onText, ...d }); return d.promise; } };
  const voice = dash.createVoiceMode({
    mic, listener, speaker, ask, ...quiet, fallbackMs: 2500,
    onChange: (snapshot) => changes.push(JSON.parse(JSON.stringify(snapshot))),
    setTimer: (run, ms) => { const entry = { id: timers.length + 1, ms, live: true, run: () => { entry.live = false; run(); } }; timers.push(entry); return entry.id; },
    clearTimer: (id) => { const found = timers.find((timer) => timer.id === id); if (found) found.live = false; }
  });
  const live = () => timers.filter((timer) => timer.live);
  // Hands the next waiting piece the result and lets the voice mode react.
  const hear = async (words = [], ended = false) => { voice.piece(new Float32Array(2560)); listener.waiting.shift().resolve({ words, ended }); await tick(); };
  return { voice, mic, listener, speaker, ask, talks, asks, changes, timers, live, hear, log };
}

// ---- a whole round: start, a question, the answer spoken, listening again ----
{
  const t = build();
  assert.equal(t.voice.state, "off");
  const started = t.voice.start();
  assert.equal(t.voice.state, "starting");
  assert.equal(await started, true);
  assert.equal(t.voice.state, "listening");
  assert.equal(t.listener.loads, 1);
  assert.equal(t.speaker.prepared, 1);
  assert.equal(t.mic.starts, 1);
  assert.equal(await t.voice.start(), true, "starting twice does nothing more");
  assert.equal(t.listener.loads, 1);

  await t.hear(["▁what", "▁is"]);
  assert.equal(t.changes.at(-1).heard, "what is", "the words show as they are heard");
  assert.equal(t.live().at(-1).ms, 2500, "with no end heard yet it waits the longer time");
  await t.hear(["▁due"], true);
  assert.equal(t.live().length, 1, "only one timer runs at a time");
  assert.equal(t.live()[0].ms, 500, "after the end of the question only a short quiet is left");
  assert.equal(t.voice.state, "listening");

  t.live()[0].run();
  assert.equal(t.voice.state, "thinking");
  assert.equal(t.mic.stops, 1, "the microphone is off while Ask works");
  assert.equal(t.asks[0].question, "What is due?");
  assert.equal(t.changes.at(-1).question, "What is due?");
  assert.equal(t.talks.length, 1);

  t.asks[0].write("Lab four is due Friday. Quiz");
  assert.deepEqual(t.talks[0].said, ["Lab four is due Friday."], "a sentence is spoken as soon as it is whole");
  assert.equal(t.changes.at(-1).answer, "Lab four is due Friday. Quiz");
  t.talks[0].play();
  assert.equal(t.voice.state, "speaking");
  t.asks[0].write("Lab four is due Friday. Quiz three is due Sunday.");
  assert.equal(t.talks[0].said.length, 1);
  t.asks[0].resolve({ answer: "Lab four is due Friday. Quiz three is due Sunday.", failed: false });
  await tick();
  assert.deepEqual(t.talks[0].said, ["Lab four is due Friday.", "Quiz three is due Sunday."]);
  assert.equal(t.talks[0].ended, true);
  assert.equal(t.mic.starts, 1, "still not listening while the voice is talking");
  t.talks[0].finish(true);
  await tick();
  assert.equal(t.voice.state, "listening");
  assert.equal(t.mic.starts, 2, "listening again once the answer is spoken");
  assert.equal(t.listener.resets, 2);
  assert.equal(t.changes.at(-1).heard, "");

  // a pause inside a question: words after the end carry on the same question
  await t.hear(["▁what"]);
  await t.hear([], true);
  await t.hear(["▁about", "▁friday"]);
  assert.equal(t.live().length, 1);
  assert.equal(t.live()[0].ms, 2500, "more words after the end start the wait over");
  await t.hear([], true);
  t.live()[0].run();
  assert.equal(t.asks[1].question, "What about friday?");
  t.asks[1].resolve({ answer: "", failed: false });
  await tick();
  t.talks[1].finish(true);
  await tick();
  assert.equal(t.voice.state, "listening", "an empty answer speaks nothing and listens again");
  assert.deepEqual(t.talks[1].said, []);

  t.voice.stop();
  assert.equal(t.voice.state, "off");
  assert.equal(t.mic.stops, 3);
  assert.ok(t.speaker.stops >= 1);
  assert.equal(t.live().length, 0, "no timer is left running");
}

// ---- stopping while it is thinking or speaking: nothing more is said or heard ----
{
  const t = build();
  await t.voice.start();
  await t.hear(["▁hello"], true);
  t.live()[0].run();
  t.asks[0].write("Hello there. How");
  t.voice.stop();
  assert.equal(t.voice.state, "off");
  assert.equal(t.speaker.stops, 1);
  t.asks[0].write("Hello there. How are you? Fine.");
  t.asks[0].resolve({ answer: "Hello there. How are you? Fine.", failed: false });
  await tick();
  assert.deepEqual(t.talks[0].said, ["Hello there."], "nothing is spoken after stop");
  assert.equal(t.mic.starts, 1, "and it does not start listening");
  assert.equal(t.voice.state, "off");
  t.voice.piece(new Float32Array(2560));
  assert.equal(t.listener.pieces.length, 1, "pieces are ignored when not listening");
}

// ---- words that arrive late are not part of the next stretch ----
{
  const t = build();
  await t.voice.start();
  t.voice.piece(new Float32Array(2560));
  t.voice.piece(new Float32Array(2560));
  t.listener.waiting.shift().resolve({ words: ["▁hello"], ended: true });
  await tick();
  t.live()[0].run();
  t.listener.waiting.shift().resolve({ words: ["▁noise"], ended: false });
  await tick();
  assert.equal(t.changes.at(-1).heard, "", "the piece still being heard when the question went off is dropped");
  t.asks[0].resolve({ answer: "Hi.", failed: false });
  await tick();
  t.talks[0].finish(true);
  await tick();
  assert.equal(t.voice.state, "listening");
}

// ---- a piece still being heard from the last stretch does not land in the next one ----
{
  const t = build();
  await t.voice.start();
  await t.hear(["▁hi"], true);
  t.voice.piece(new Float32Array(2560));
  t.live()[0].run();
  t.asks[0].resolve({ answer: "Hello.", failed: false });
  await tick();
  t.talks[0].finish(true);
  await tick();
  assert.equal(t.voice.state, "listening");
  t.listener.waiting.shift().resolve({ words: ["▁stale"], ended: false });
  await tick();
  assert.equal(t.changes.at(-1).heard, "", "a result from before the answer is left out");
  assert.equal(t.live().length, 0);
}

// ---- a question sent only when something was heard ----
{
  const t = build();
  await t.voice.start();
  await t.hear([], true);
  assert.equal(t.live().length, 0, "an end with no words starts nothing");
  await t.hear(["▁uh"]);
  t.live()[0].run();
  assert.equal(t.asks[0].question, "Uh");
}

// ---- the first time the microphone opens it says so ----
{
  const t = build();
  const gate = deferred();
  t.mic.start = function () { this.starts += 1; return gate.promise; };
  const started = t.voice.start();
  await tick(); await tick();
  assert.equal(t.voice.state, "starting");
  assert.equal(t.changes.at(-1).message, "Opening the microphone…", "while the microphone opens, it is not yet listening");
  gate.resolve(true);
  assert.equal(await started, true);
  assert.equal(t.voice.state, "listening");
  assert.equal(t.changes.at(-1).message, "");
}

// ---- the quiet after the end of a question is short unless told otherwise ----
{
  const t = build({ quiet: {} });
  await t.voice.start();
  await t.hear(["▁due"], true);
  assert.equal(t.live()[0].ms, 250);
}

// ---- when something goes wrong ----
{
  const t = build({ micWorks: false });
  assert.equal(await t.voice.start(), false);
  assert.equal(t.voice.state, "off");
  assert.equal(t.changes.at(-1).message, "No microphone was found.");
}
{
  const t = build();
  t.listener.loadResult = Promise.reject(new Error("model missing"));
  assert.equal(await t.voice.start(), false);
  assert.equal(t.voice.state, "off");
  assert.match(t.changes.at(-1).message, /Voice could not start: model missing/);
  assert.equal(t.mic.starts, 0);
}
{
  const t = build();
  await t.voice.start();
  t.voice.piece(new Float32Array(2560));
  t.listener.waiting.shift().reject(new Error("worker crashed"));
  await tick();
  assert.equal(t.voice.state, "off");
  assert.match(t.changes.at(-1).message, /Listening stopped: worker crashed/);
  assert.equal(t.mic.stops, 1);
}
{
  const t = build();
  await t.voice.start();
  await t.hear(["▁hi"], true);
  t.live()[0].run();
  t.asks[0].resolve(undefined);
  await tick();
  assert.equal(t.voice.state, "listening");
  assert.match(t.changes.at(-1).message, /Ask is busy/);
  assert.equal(t.talks[0].stopped, true);
  assert.equal(t.mic.starts, 2);
}
{
  const t = build();
  await t.voice.start();
  await t.hear(["▁hi"], true);
  t.live()[0].run();
  t.asks[0].resolve({ answer: "Something went wrong: x", failed: true });
  await tick();
  assert.deepEqual(t.talks[0].said, ["Sorry, something went wrong."], "an error is told in a few plain words, not read out");
  t.talks[0].finish(true);
  await tick();
  assert.equal(t.voice.state, "listening");
}
{
  const t = build();
  await t.voice.start();
  await t.hear(["▁hi"], true);
  t.live()[0].run();
  t.asks[0].reject(new Error("model crashed"));
  await tick();
  assert.deepEqual(t.talks[0].said, ["Sorry, something went wrong."]);
}
{
  const t = build();
  await t.voice.start();
  await t.hear(["▁hi"], true);
  t.live()[0].run();
  t.asks[0].resolve({ answer: "Hello.", failed: false });
  await tick();
  t.talks[0].finish(false);
  await tick();
  assert.equal(t.voice.state, "listening", "if the voice fails, it listens again");
  assert.match(t.changes.at(-1).message, /could not speak/);
}

console.log("Voice mode: listen, think, speak, listen again, stop and failures passed.");
