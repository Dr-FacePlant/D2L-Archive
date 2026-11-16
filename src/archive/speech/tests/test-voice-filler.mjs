import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ AbortController, Float32Array, console });
for (const file of ["ask/response/phonon-playback.js", "voice/speakable-sentences.js", "voice/listen/heard-text.js", "voice/filler-lines.js", "voice/voice-mode.js"]) {
  vm.runInContext(fs.readFileSync(new URL(`../src/dashboard/${file}`, import.meta.url), "utf8"), context);
}
const dash = context.D2LDashboard;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { const out = {}; out.promise = new Promise((resolve, reject) => Object.assign(out, { resolve, reject })); return out; };

// ---- which line, and when none ----
{
  const filler = dash.createFiller();
  filler.startQuestion();
  assert.equal(filler.forLookup("upcoming_due", 0), "Let me check what's due.");
  assert.equal(filler.forLookup("search_archive", 0), null, "one line for a round, however many lookups it starts");
  assert.equal(filler.forLookup("search_past_messages", 1), "Looking back through our chat.");
  assert.equal(filler.forLookup("search_archive", 2), null, "two lines for a question, then quiet");
  assert.equal(filler.forWait(), null);
  filler.startQuestion();
  assert.equal(filler.forLookup("upcoming_due", 0), "Checking your due dates.", "the next question uses the other wording");
  assert.equal(filler.forLookup("chat_log", 1), "Looking back through our chat.");
}
{
  const filler = dash.createFiller({ most: 5 });
  const said = [filler.forLookup("search_past_messages", 0), filler.forLookup("chat_log", 1), filler.forLookup("search_past_messages", 2)];
  assert.deepEqual(said, ["Looking back through our chat.", "Checking what we talked about.", "Looking back through our chat."], "the same words never come twice running");
  assert.deepEqual([filler.forWait(), filler.forWait()], ["One moment.", "Still working on it."]);
  for (const name of ["search_archive", "upcoming_due", "item_details", "constructor", "__proto__", "", undefined]) {
    const line = dash.createFiller().forLookup(name, 0);
    assert.equal(typeof line, "string", `a line for ${String(name)}`);
    if (!Object.hasOwn(dash.FILLER_LINES, name)) assert.equal(line, "One moment.", "a name that is not a tool of ours gets the plain line");
  }
  for (const lines of Object.values(dash.FILLER_LINES)) for (const line of lines) assert.ok(/^[A-Z][^<>]*[.]$/.test(line) && line.length < 40, `${line} is a short plain sentence`);
}

// ---- voice mode: the lines are spoken while Ask works, and never over the answer ----
function build({ filler = true } = {}) {
  const timers = [], talks = [], asks = [];
  const mic = { start: () => Promise.resolve(true), stop() {}, message: "" };
  const listener = { load: () => Promise.resolve(), reset() {}, waiting: [], feed() { const d = deferred(); this.waiting.push(d); return d.promise; } };
  const speaker = {
    prepare: () => Promise.resolve(true), stop() {},
    begin({ onPlaying }) {
      const finished = deferred();
      const talk = { said: [], kept: [], stopped: false, say(text, { keep = false } = {}) { (keep ? this.kept : this.said).push(text); }, end: () => finished.promise, stop() { this.stopped = true; }, play: onPlaying, finish: (ok = true) => finished.resolve(ok) };
      talks.push(talk);
      return talk;
    }
  };
  const ask = { send(question, hooks) { const d = deferred(); asks.push({ question, ...hooks, ...d }); return d.promise; } };
  const states = [];
  const voice = dash.createVoiceMode({
    mic, listener, speaker, ask, nudgeMs: 6000, onChange: (snapshot) => states.push(snapshot.state),
    newFiller: filler ? undefined : () => null,
    setTimer: (run, ms) => { const entry = { id: timers.length + 1, ms, live: true, run: () => { entry.live = false; run(); } }; timers.push(entry); return entry.id; },
    clearTimer: (id) => { const found = timers.find((timer) => timer.id === id); if (found) found.live = false; }
  });
  const live = () => timers.filter((timer) => timer.live);
  // Starts voice, hears one short question and lets the timer send it: Ask is now working.
  const question = async () => {
    await voice.start();
    voice.piece(new Float32Array(2560));
    listener.waiting.shift().resolve({ words: ["▁what", "▁is", "▁due"], ended: true });
    await tick();
    live().find((timer) => timer.ms !== 6000).run();
  };
  return { voice, talks, asks, live, states, question, timers };
}

{
  const t = build();
  await t.question();
  assert.equal(t.voice.state, "thinking");
  assert.deepEqual(t.live().map((timer) => timer.ms), [6000], "a wait is being counted from the question");

  // Quiet for too long: the plain line, then the other wording, then no more.
  t.live()[0].run();
  assert.deepEqual(t.talks[0].kept, ["One moment."]);
  assert.deepEqual(t.live().map((timer) => timer.ms), [6000], "and the count starts over");
  t.live()[0].run();
  assert.deepEqual(t.talks[0].kept, ["One moment.", "Still working on it."]);
  t.live()[0].run();
  assert.equal(t.talks[0].kept.length, 2, "two lines for a question");
  assert.equal(t.live().length, 0, "and nothing is left counting");
  assert.equal(t.voice.state, "thinking", "a line is not the answer: the bar still says it is thinking");
  assert.deepEqual(t.talks[0].said, []);

  t.asks[0].resolve({ answer: "", failed: false });
  await tick();
  t.talks[0].finish(true);
  await tick();
  assert.equal(t.voice.state, "listening");
}
{
  // A lookup names what is being looked up, and the count of quiet starts again from it.
  const t = build();
  await t.question();
  const before = t.live()[0].id;
  t.asks[0].onLookup("upcoming_due", 0);
  assert.deepEqual(t.talks[0].kept, ["Let me check what's due."]);
  assert.equal(t.live().length, 1);
  assert.notEqual(t.live()[0].id, before, "the quiet is counted from the line");
  t.asks[0].onLookup("search_archive", 0);
  assert.equal(t.talks[0].kept.length, 1, "a second lookup in the same round says nothing");
  assert.equal(t.asks[0].spoken, true, "voice tells Ask the question was spoken, so the answer will be heard");
  t.asks[0].onLookup("search_archive", 1);
  assert.deepEqual(t.talks[0].kept, ["Let me check what's due.", "Searching your course files."]);
  t.asks[0].onLookup("item_details", 2);
  assert.equal(t.talks[0].kept.length, 2);
  t.asks[0].resolve({ answer: "", failed: false });
  await tick();
  assert.equal(t.live().length, 0, "no timer outlives the question");
}
{
  // Once the answer's first sentence is on its way no line is spoken, and the count of quiet stops.
  const t = build();
  await t.question();
  t.asks[0].onText("Lab four is due Friday. Quiz");
  assert.deepEqual(t.talks[0].said, ["Lab four is due Friday."]);
  assert.equal(t.live().length, 0, "answering ends the wait");
  t.asks[0].onLookup("upcoming_due", 1);
  assert.deepEqual(t.talks[0].kept, [], "nothing is said over or after the answer starts");
  t.asks[0].resolve({ answer: "Lab four is due Friday. Quiz three is due Sunday.", failed: false });
  await tick();
  assert.equal(t.live().length, 0);
}
{
  // Stopping, a failed Ask and a busy Ask all leave nothing counting and nothing more said.
  const t = build();
  await t.question();
  t.asks[0].onLookup("upcoming_due", 0);
  t.voice.stop();
  t.live()[0]?.run();
  assert.deepEqual(t.talks[0].kept, ["Let me check what's due."], "nothing is said after stop");
  t.asks[0].onLookup("search_archive", 1);
  assert.equal(t.talks[0].kept.length, 1);
  t.asks[0].resolve({ answer: "", failed: false });
  await tick();
  assert.equal(t.live().length, 0);

  const failed = build();
  await failed.question();
  failed.asks[0].onLookup("upcoming_due", 0);
  failed.asks[0].reject(new Error("boom"));
  await tick();
  assert.deepEqual(failed.talks[0].said, ["Sorry, something went wrong."]);
  assert.equal(failed.live().length, 0);

  const busy = build();
  await busy.question();
  busy.asks[0].resolve(undefined);
  await tick();
  assert.equal(busy.talks[0].stopped, true, "when Ask did not take the question the talk is stopped");
  assert.equal(busy.live().length, 0);
}
{
  // Without a filler everything is as it was: no lines, no timers.
  const t = build({ filler: false });
  await t.question();
  assert.equal(t.live().length, 0);
  t.asks[0].onLookup("upcoming_due", 0);
  assert.deepEqual(t.talks[0].kept, []);
  t.asks[0].resolve({ answer: "", failed: false });
  await tick();
  assert.equal(t.live().length, 0);
}

console.log("Voice filler lines: choice, spacing, never over the answer and clean-up passed.");
